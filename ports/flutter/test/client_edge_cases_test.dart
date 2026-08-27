// The branches the main suites do not reach: state before init, config validation,
// corrupt or legacy storage, debug logging, error paths of every custom handler and
// HTTP answer, the boot race, dispose, and the small helpers of the core.
import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:i18n_keyless/i18n_keyless_core.dart';
import 'package:i18n_keyless/src/core/unique_id.dart' show secureRandomFactory;

http.Response _json(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json'});

/// A backend whose answers are chosen per route by the test.
class Server {
  Server({
    this.translate,
    this.dictionary,
    this.dictionaries = const {},
  });

  /// The body of `POST /translate`. Defaults to `ok`.
  Map<String, dynamic>? translate;

  /// The body of every `GET /translate/:lang`. Defaults to an `ok` envelope around
  /// [dictionaries].
  Map<String, dynamic>? dictionary;

  /// `lang` or `lang@namespace` -> translations.
  final Map<String, Map<String, String>> dictionaries;
  final List<http.Request> requests = [];

  List<http.Request> get translates => requests
      .where((r) => r.method == 'POST' && r.url.path == '/translate')
      .toList();
  List<http.Request> get fetches =>
      requests.where((r) => r.method == 'GET').toList();

  http.Client get client => MockClient((request) async {
        requests.add(request);
        final path = request.url.path;
        if (request.method == 'POST' && path == '/translate') {
          return _json(translate ??
              {'ok': true, 'data': {}, 'error': '', 'message': ''});
        }
        if (request.method == 'GET' && path.startsWith('/translate/')) {
          if (dictionary != null) return _json(dictionary!);
          final lang = path.substring('/translate/'.length);
          final namespace = request.url.queryParameters['namespace'];
          final key = namespace == null ? lang : '$lang@$namespace';
          return _json({
            'ok': true,
            'data': {
              'translations': dictionaries[key] ?? <String, String>{},
              'uniqueId': 'server-minted-id',
              'lastRefresh': '1700000000000',
            },
            'error': '',
            'message': '',
          });
        }
        return _json({'ok': true, 'message': ''});
      });
}

/// Every read waits for [gate]: hydration stays open until the test says so.
class GatedStorage extends MemoryStorage {
  GatedStorage(this.gate);

  final Future<void> gate;

  @override
  Future<String?> getItem(String key) async {
    await gate;
    return super.getItem(key);
  }
}

I18nKeylessConfig configFor(
  Server server, {
  I18nKeylessStorage? storage,
  Lang initWithDefault = Lang.en,
  bool debug = false,
  List<String>? logs,
  HandleTranslate? handleTranslate,
  GetAllTranslations? getAllTranslations,
  SendTranslationsUsage? sendTranslationsUsage,
}) =>
    I18nKeylessConfig(
      apiKey: 'test-key',
      apiUrl: 'https://api.test/',
      languages: LanguagesConfig(
        primary: Lang.fr,
        supported: const [Lang.fr, Lang.en],
        initWithDefault: initWithDefault,
      ),
      storage: storage,
      debug: debug,
      handleTranslate: handleTranslate,
      getAllTranslations: getAllTranslations,
      sendTranslationsUsage: sendTranslationsUsage,
      httpClient: server.client,
      logger: logs == null ? (_) {} : logs.add,
    );

/// Lets every microtask and zero-length timer run.
Future<void> settle([int turns = 5]) async {
  for (var i = 0; i < turns; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  group('state before init', () {
    test('config throws a StateError, the getters need init', () {
      final client = I18nKeylessClient();
      expect(client.isInitialized, isFalse);
      expect(() => client.config, throwsStateError);
      expect(client.uniqueId, isNull);
      expect(client.lastRefresh, isNull);
      expect(client.translations, isEmpty);
      expect(client.dictionaryEtags, isEmpty);
      expect(client.namespacesAwaitingFetch, isEmpty);
    });

    test('dispose before init is a no-op that closes the changes stream',
        () async {
      final client = I18nKeylessClient();
      final done = client.changes.toList();
      client.dispose();
      expect(await done, isEmpty);
    });
  });

  group('config validation', () {
    test('init rejects an empty supported list', () {
      final client = I18nKeylessClient();
      expect(
        () => client.init(I18nKeylessConfig(
          apiKey: 'k',
          languages: const LanguagesConfig(primary: Lang.fr, supported: []),
        )),
        throwsArgumentError,
      );
      expect(client.isInitialized, isFalse);
    });

    test('initWithDefault and primary are added to the supported list',
        () async {
      final server = Server();
      final client = I18nKeylessClient();
      await client.init(I18nKeylessConfig(
        apiKey: 'k',
        apiUrl: 'https://api.test',
        languages: const LanguagesConfig(
          primary: Lang.fr,
          supported: [Lang.es],
          initWithDefault: Lang.en,
        ),
        httpClient: server.client,
        logger: (_) {},
      ));
      await client.waitForIdle();
      expect(client.primaryLanguage, Lang.fr);
      expect(client.supportedLanguages, [Lang.es, Lang.en, Lang.fr]);
      expect(client.currentLanguage, Lang.en);
      expect(
          () => client.supportedLanguages.add(Lang.ja), throwsUnsupportedError);
      expect(client.lastRefresh, '1700000000000');
    });
  });

  group('hydration edge cases', () {
    test('a corrupt JSON entry is logged and ignored', () async {
      final storage = MemoryStorage();
      await storage.setItem(StorageKeys.namespaces, '{not json');
      await storage.setItem(StorageKeys.translations, '[1, 2');
      final logs = <String>[];
      final server = Server(dictionaries: {
        'en': {'Bonjour': 'Hello'},
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage: storage, logs: logs));
      expect(logs.where((l) => l.contains('Error parsing item')).length, 2);
      await client.waitForIdle();
      expect(client.getTranslation('Bonjour'), 'Hello');
    });

    test('debug logs every hydration step and discards a legacy flat usage',
        () async {
      final storage = MemoryStorage();
      // The v2 shape: keys at the top level instead of one bucket per namespace.
      await storage.setItem(
          StorageKeys.translationsUsage, jsonEncode({'Bonjour': '2025-01-01'}));
      await storage.setItem(StorageKeys.originNamespaces, jsonEncode(['ugc']));
      final logs = <String>[];
      final server = Server();
      final client = I18nKeylessClient();
      await client
          .init(configFor(server, storage: storage, logs: logs, debug: true));
      await client.waitForIdle();
      expect(logs, contains(startsWith('i18n-keyless: hydrate: uniqueId ')));
      expect(logs, contains('i18n-keyless: hydrate: 0 translations'));
      expect(logs,
          contains('i18n-keyless: hydrate: discarding legacy flat usage'));
      expect(logs, contains('i18n-keyless: hydrate: currentLanguage en'));
      // The legacy usage was not sent: no usage POST left.
      expect(
          server.requests
              .where((r) => r.url.path == '/translate/last-used-translations'),
          isEmpty);
    });

    test('the primary language still fetches the namespaces holding UGC keys',
        () async {
      final storage = MemoryStorage();
      await storage.setItem(StorageKeys.originNamespaces, jsonEncode(['ugc']));
      final server = Server(dictionaries: {
        'fr@ugc': {'Hola': 'Bonjour'},
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage: storage));
      await client.waitForIdle();
      server.requests.clear();

      await client.setCurrentLanguage(Lang.fr);
      await client.waitForIdle();
      expect(server.fetches.length, 1);
      expect(server.fetches.single.url.path, '/translate/fr');
      expect(server.fetches.single.url.queryParameters['namespace'], 'ugc');
      expect(
          client.getTranslation('Hola',
              namespace: 'ugc', originLanguage: Lang.es),
          'Bonjour');
    });
  });

  group('debug logging', () {
    test('a debug lookup logs the resolution and the queued miss', () async {
      final logs = <String>[];
      final server = Server();
      final client = I18nKeylessClient();
      await client.init(configFor(server, logs: logs));
      await client.waitForIdle();
      logs.clear();
      expect(client.getTranslation('Bonjour', debug: true, context: 'salut'),
          'Bonjour');
      expect(logs, contains('i18n-keyless: translate "Bonjour" (en): Bonjour'));
      expect(logs,
          contains('i18n-keyless: translateKey "Bonjour" (salut) [default]'));
      await client.waitForIdle();
      expect(logs, contains(startsWith('i18n-keyless: translate response: ')));
    });

    test('an unsupported language logs the fallback in debug', () async {
      final logs = <String>[];
      final server = Server();
      final client = I18nKeylessClient();
      await client.init(configFor(server, logs: logs, debug: true));
      await client.waitForIdle();
      await client.setCurrentLanguage(Lang.ja);
      expect(client.currentLanguage, Lang.fr);
      expect(
          logs,
          contains(
              'i18n-keyless: language ja is not supported, fallback to fr'));
    });

    test('without a logger, messages go to print', () async {
      final printed = <String>[];
      await runZoned(
        () async {
          final client = I18nKeylessClient();
          await client.init(I18nKeylessConfig(
            apiKey: 'k',
            languages: const LanguagesConfig(
                primary: Lang.fr,
                supported: [Lang.fr, Lang.en],
                initWithDefault: Lang.en),
            handleTranslate: (_) async =>
                const HandleTranslateResult(ok: true, message: 'handled'),
            getAllTranslations: () async =>
                const TranslationsResponse(ok: true),
          ));
          await client.waitForIdle();
          client.getTranslation('Bonjour', debug: true);
          await client.waitForIdle();
        },
        zoneSpecification: ZoneSpecification(
          print: (self, parent, zone, line) => printed.add(line),
        ),
      );
      expect(
          printed, contains('i18n-keyless: translate "Bonjour" (en): Bonjour'));
      expect(printed, contains('i18n-keyless: handled'));
    });
  });

  group('error paths', () {
    test('a translate answer with ok=false is logged, not thrown', () async {
      final logs = <String>[];
      final server = Server(translate: {
        'ok': false,
        'error': 'quota exceeded',
        'message': 'upgrade your plan',
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, logs: logs));
      await client.waitForIdle();
      expect(client.getTranslation('Bonjour'), 'Bonjour');
      await client.waitForIdle();
      expect(server.translates.length, 1);
      expect(
          logs,
          contains(
              'i18n-keyless: Error translating key "Bonjour": quota exceeded'));
      expect(logs, contains('i18n-keyless: upgrade your plan'));
    });

    test('a custom handleTranslate that throws is caught', () async {
      final logs = <String>[];
      final server = Server();
      final client = I18nKeylessClient();
      await client.init(configFor(
        server,
        logs: logs,
        handleTranslate: (_) async => throw StateError('boom'),
        getAllTranslations: () async => const TranslationsResponse(ok: true),
      ));
      await client.waitForIdle();
      expect(client.getTranslation('Bonjour'), 'Bonjour');
      await client.waitForIdle();
      expect(logs,
          contains('i18n-keyless: Error translating key: Bad state: boom'));
      expect(server.requests, isEmpty);
    });

    test('a custom getAllTranslations that throws keeps the cache', () async {
      final logs = <String>[];
      final storage = MemoryStorage();
      await storage.setItem(
          StorageKeys.translations, jsonEncode({'Bonjour': 'Hello'}));
      final server = Server();
      final client = I18nKeylessClient();
      await client.init(configFor(
        server,
        storage: storage,
        logs: logs,
        handleTranslate: (_) async => const HandleTranslateResult(ok: true),
        getAllTranslations: () async => throw StateError('offline'),
      ));
      await client.waitForIdle();
      expect(
          logs,
          contains(
              'i18n-keyless: fetch all translations error: Bad state: offline'));
      expect(client.getTranslation('Bonjour'), 'Hello');
      expect(storage.entries[StorageKeys.translations],
          jsonEncode({'Bonjour': 'Hello'}));
    });

    test('a dictionary answer with ok=false is logged and ignored', () async {
      final logs = <String>[];
      final server = Server(dictionary: {
        'ok': false,
        'data': {
          'translations': {'Bonjour': 'Hello'}
        },
        'error': 'invalid api key',
        'message': '',
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, logs: logs));
      await client.waitForIdle();
      expect(
          logs,
          contains(
              'i18n-keyless: fetch all translations error: invalid api key'));
      expect(client.translations, isEmpty);
    });

    test('a custom sendTranslationsUsage that throws keeps the usage',
        () async {
      final logs = <String>[];
      final storage = MemoryStorage();
      await storage.setItem(
          StorageKeys.translationsUsage,
          jsonEncode({
            'default': {'Bonjour': '2025-01-01'}
          }));
      final server = Server();
      final client = I18nKeylessClient();
      await client.init(configFor(
        server,
        storage: storage,
        logs: logs,
        handleTranslate: (_) async => const HandleTranslateResult(ok: true),
        getAllTranslations: () async => const TranslationsResponse(ok: true),
        sendTranslationsUsage: (_) async => throw StateError('down'),
      ));
      await client.waitForIdle();
      expect(
          logs,
          contains(
              'i18n-keyless: send translations usage error: Bad state: down'));
      expect(
          storage.entries[StorageKeys.translationsUsage],
          jsonEncode({
            'default': {'Bonjour': '2025-01-01'}
          }));
    });
  });

  group('unpersisted namespace', () {
    test('a landed translation notifies but is never written', () async {
      final storage = MemoryStorage();
      final server = Server(dictionaries: {
        'en@tmp': {'Bonjour': 'Hello'},
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage: storage));
      await client.waitForIdle();
      var notifications = 0;
      client.addListener(() => notifications++);
      expect(
          client.getTranslation('Bonjour',
              namespace: 'tmp', unpersistedNamespace: true),
          'Bonjour');
      await client.waitForIdle();
      expect(notifications, 1);
      expect(
          client.getTranslation('Bonjour',
              namespace: 'tmp', unpersistedNamespace: true),
          'Hello');
      expect(storage.entries.keys, isNot(contains(contains('__tmp'))));
      // The index only lists the persisted namespaces (the boot fetch wrote it).
      expect(storage.entries[StorageKeys.namespaces], jsonEncode(['default']));
    });
  });

  group('boot race', () {
    test('a request queued during hydration waits for the device id', () async {
      final gate = Completer<void>();
      final storage = GatedStorage(gate.future);
      await storage.setItem(StorageKeys.uniqueId, 'stored-device-id');
      final server = Server();
      final client = I18nKeylessClient();
      final init = client.init(configFor(server, storage: storage));
      expect(client.isInitialized, isTrue);
      expect(client.getTranslation('Bonjour'), 'Bonjour');
      await settle();
      expect(server.requests, isEmpty);

      gate.complete();
      await init;
      await client.waitForIdle();
      expect(server.translates.length, 1);
      for (final request in server.requests) {
        expect(request.headers['unique_id'], 'stored-device-id');
      }
    });

    test('a custom fetch that lands before hydration hands over its id',
        () async {
      final gate = Completer<void>();
      final storage = GatedStorage(gate.future);
      final server = Server();
      final client = I18nKeylessClient();
      final init = client.init(configFor(
        server,
        storage: storage,
        handleTranslate: (_) async => const HandleTranslateResult(ok: true),
        getAllTranslations: () async => const TranslationsResponse(
          ok: true,
          translations: {'Bonjour': 'Hello'},
          uniqueId: 'server-minted-id',
        ),
      ));
      expect(client.uniqueId, isNull);
      expect(client.getTranslation('Bonjour'), 'Bonjour');
      await settle();
      // Custom handlers do not wait for the gate: the dictionary landed and, with
      // no id yet, the one the server echoed was adopted.
      expect(client.getTranslation('Bonjour'), 'Hello');
      expect(client.uniqueId, 'server-minted-id');

      gate.complete();
      await init;
      await client.waitForIdle();
      expect(isUniqueId(client.uniqueId), isTrue);
      expect(storage.entries[StorageKeys.uniqueId], client.uniqueId);
    });
  });

  group('dispose', () {
    test('drops the listeners, closes the stream and stops the queue handler',
        () async {
      final server = Server(dictionaries: {
        'en': {'Bonjour': 'Hello'},
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server));
      await client.waitForIdle();
      var notifications = 0;
      client.addListener(() => notifications++);
      final closed = client.changes.toList();
      server.requests.clear();

      client.dispose();
      expect(await closed, isEmpty);
      expect(client.getTranslation('Au revoir'), 'Au revoir');
      await client.waitForIdle();
      // The miss was still posted, but the empty queue no longer bulk-fetches.
      expect(server.translates.length, 1);
      expect(server.fetches, isEmpty);
      expect(notifications, 0);
      expect(client.getTranslation('Bonjour'), 'Hello');
    });

    test('an injected api is not closed by the client', () async {
      final server = Server();
      final api = I18nKeylessApi(client: server.client);
      final client = I18nKeylessClient(api: api);
      await client.init(configFor(server));
      await client.waitForIdle();
      client.dispose();
      final result = await api
          .get(Uri.parse('https://api.test/translate/en'), headers: const {});
      expect(result.ok, isTrue);
    });
  });

  group('helpers', () {
    test('I18nKeylessApi.close closes only a client it created', () async {
      final server = Server();
      final shared = I18nKeylessApi(client: server.client);
      shared.close();
      final result = await shared
          .get(Uri.parse('https://api.test/translate/en'), headers: const {});
      expect(result.ok, isTrue);

      // An owned client is closed; a later request fails without the network.
      final owned = I18nKeylessApi(retryDelays: const []);
      owned.close();
      final failed = await owned
          .get(Uri.parse('http://127.0.0.1:9/translate/en'), headers: const {});
      expect(failed.ok, isFalse);
      expect(failed.error, isNotEmpty);
    });

    test('the response classes keep what they are given', () {
      // Built at runtime, not const: the constructors themselves execute.
      final usage = UsageResponse(ok: DateTime.now().year > 0, message: 'm');
      expect(usage.ok, isTrue);
      expect(usage.message, 'm');
      final handled =
          HandleTranslateResult(ok: usage.ok, translation: {'en': 'Hello'});
      expect(handled.translation, {'en': 'Hello'});
      expect(handled.message, '');
    });

    test('MemoryStorage.clear empties the map', () async {
      final storage = MemoryStorage();
      await storage.setItem('a', '1');
      expect(storage.entries, {'a': '1'});
      storage.clear();
      expect(storage.entries, isEmpty);
      expect(await storage.getItem('a'), isNull);
    });

    test('PQueue hands a task error to its caller and stays usable', () async {
      final queue = PQueue(concurrency: 1);
      var empties = 0;
      queue.onEmpty(() => empties++);
      await expectLater(queue.add(() async => throw StateError('task failed')),
          throwsStateError);
      expect(queue.isIdle, isTrue);
      expect(empties, 1);
      expect(await queue.add(() async => 42), 42);
    });

    test('Lang prints as its code', () {
      expect(Lang.fr.toString(), 'fr');
      expect('${Lang.zhHans}', 'zh-Hans');
      expect(Lang.values.map((lang) => '$lang').toList(), availableLangCodes);
    });

    test('generateUniqueId falls back to the default PRNG', () {
      final original = secureRandomFactory;
      secureRandomFactory = () => throw UnsupportedError('no secure source');
      try {
        final id = generateUniqueId();
        expect(isUniqueId(id), isTrue);
        expect(RegExp(r'^[0-9A-Za-z_]{16}$').hasMatch(id), isTrue);
      } finally {
        secureRandomFactory = original;
      }
      // The seam is the real constructor by default.
      expect(secureRandomFactory(), isA<Random>());
    });
  });
}
