import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:i18n_keyless/i18n_keyless_core.dart';

/// A fake i18n-keyless backend: the subset of the HTTP protocol the client uses.
class FakeServer {
  FakeServer({Map<String, Map<String, String>>? dictionaries})
      : dictionaries = dictionaries ?? {};

  /// language code -> translations
  final Map<String, Map<String, String>> dictionaries;
  final List<http.Request> requests = [];
  final List<Map<String, dynamic>> translateBodies = [];
  final List<Map<String, dynamic>> usageBodies = [];

  /// When set, `GET /translate/:lang` sends this ETag and answers 304 to a matching
  /// `If-None-Match`.
  String? etag;

  /// When set, every `GET /translate/:lang` answers this status with no body.
  int? fetchStatus;

  int get fetchCount => requests
      .where((r) => r.method == 'GET' && r.url.path.startsWith('/translate/'))
      .length;
  int get translateCount => requests
      .where((r) => r.method == 'POST' && r.url.path == '/translate')
      .length;
  int get usageCount => requests
      .where((r) =>
          r.method == 'POST' &&
          r.url.path == '/translate/last-used-translations')
      .length;

  http.Client get client => MockClient((request) async {
        requests.add(request);
        final path = request.url.path;
        if (request.method == 'POST' && path == '/translate') {
          translateBodies.add(jsonDecode(request.body) as Map<String, dynamic>);
          return _json({
            'ok': true,
            'data': {'translation': <String, String>{}},
            'error': '',
            'message': '',
          });
        }
        if (request.method == 'POST' &&
            path == '/translate/last-used-translations') {
          usageBodies.add(jsonDecode(request.body) as Map<String, dynamic>);
          return _json({'ok': true, 'message': ''});
        }
        if (request.method == 'GET' && path.startsWith('/translate/')) {
          if (fetchStatus != null) return http.Response('', fetchStatus!);
          final lang = path.substring('/translate/'.length);
          final namespace = request.url.queryParameters['namespace'];
          final dictionaryKey = namespace == null ? lang : '$lang@$namespace';
          final currentEtag = etag;
          if (currentEtag != null &&
              request.headers['if-none-match'] == currentEtag) {
            return http.Response('', 304, headers: {'etag': currentEtag});
          }
          return _json({
            'ok': true,
            'data': {
              'translations': dictionaries[dictionaryKey] ?? <String, String>{},
              'uniqueId': 'server-minted-id',
              'lastRefresh': '1700000000000',
            },
            'error': '',
            'message': '',
          }, headers: {
            if (currentEtag != null) 'etag': currentEtag,
          });
        }
        return _json({'ok': false, 'error': 'not found'}, status: 404);
      });

  http.Response _json(Map<String, dynamic> body,
          {int status = 200, Map<String, String> headers = const {}}) =>
      http.Response(jsonEncode(body), status,
          headers: {'content-type': 'application/json', ...headers});
}

I18nKeylessConfig configFor(
  FakeServer server, {
  I18nKeylessStorage? storage,
  Lang? initWithDefault,
  bool sendUsage = true,
  String? defaultNamespace,
  List<Lang> supported = const [Lang.fr, Lang.en, Lang.es],
}) =>
    I18nKeylessConfig(
      apiKey: 'test-key',
      apiUrl: 'https://api.test',
      languages: LanguagesConfig(
        primary: Lang.fr,
        supported: supported,
        initWithDefault: initWithDefault,
      ),
      storage: storage,
      sendUsage: sendUsage,
      defaultNamespace: defaultNamespace,
      httpClient: server.client,
      logger: (_) {},
    );

Future<I18nKeylessClient> bootClient(
  FakeServer server, {
  I18nKeylessStorage? storage,
  Lang? initWithDefault,
  bool sendUsage = true,
  String? defaultNamespace,
  bool idle = true,
}) async {
  final client = I18nKeylessClient();
  await client.init(configFor(
    server,
    storage: storage,
    initWithDefault: initWithDefault,
    sendUsage: sendUsage,
    defaultNamespace: defaultNamespace,
  ));
  if (idle) await client.waitForIdle();
  return client;
}

void main() {
  group('key format', () {
    test('a context is stored as key__context, an empty context as the key',
        () {
      expect(storageKeyFor('8 heures', 'durée'), '8 heures__durée');
      expect(storageKeyFor('8 heures', null), '8 heures');
      expect(storageKeyFor('8 heures', ''), '8 heures');
    });

    test('lookups use the context key', () async {
      final server = FakeServer(dictionaries: {
        'en': {
          '8 heures': '8 hours',
          '8 heures__heure': '8 AM',
        },
      });
      final client = await bootClient(server, initWithDefault: Lang.en);
      expect(client.getTranslation('8 heures'), '8 hours');
      expect(client.getTranslation('8 heures', context: 'heure'), '8 AM');
    });
  });

  group('replace', () {
    test('replaces every placeholder in one pass, regex specials included', () {
      expect(
        applyReplace('Bonjour {name}, {name} !', {'{name}': 'Ana'}),
        'Bonjour Ana, Ana !',
      );
      expect(
        applyReplace(r'Prix: $price (x) [y] a.b c*d e+f g?h i|j k^l m\n', {
          r'$price': '10',
          '(x)': 'X',
          '[y]': 'Y',
          'a.b': 'AB',
          'c*d': 'CD',
          'e+f': 'EF',
          'g?h': 'GH',
          'i|j': 'IJ',
          'k^l': 'KL',
          r'm\n': 'MN',
        }),
        'Prix: 10 X Y AB CD EF GH IJ KL MN',
      );
    });

    test('an empty replacement keeps the placeholder (JavaScript parity)', () {
      expect(applyReplace('a {x} b', {'{x}': ''}), 'a {x} b');
      expect(applyReplace('a {x} b', {}), 'a {x} b');
      expect(applyReplace('a {x} b', null), 'a {x} b');
    });

    test('applies to the translated text, and to the source before init',
        () async {
      final server = FakeServer(dictionaries: {
        'en': {'Bonjour {name}': 'Hello {name}'},
      });
      final fresh = I18nKeylessClient();
      expect(
        fresh.getTranslation('Bonjour {name}', replace: {'{name}': 'Ana'}),
        'Bonjour Ana',
      );
      final client = await bootClient(server, initWithDefault: Lang.en);
      expect(
        client.getTranslation('Bonjour {name}', replace: {'{name}': 'Ana'}),
        'Hello Ana',
      );
    });
  });

  group('priority queue', () {
    test('runs at most `concurrency` tasks at once and empties once', () async {
      final queue = PQueue(concurrency: 2);
      var running = 0;
      var maxRunning = 0;
      var emptied = 0;
      queue.onEmpty(() => emptied++);
      final completers = List.generate(5, (_) => Completer<void>());
      final futures = <Future<void>>[];
      for (var i = 0; i < 5; i++) {
        futures.add(queue.add(() async {
          running++;
          maxRunning = maxRunning > running ? maxRunning : running;
          await completers[i].future;
          running--;
        }));
      }
      expect(queue.pending, 2);
      expect(queue.size, 3);
      for (final completer in completers) {
        completer.complete();
        await Future<void>.delayed(Duration.zero);
      }
      await Future.wait(futures);
      expect(maxRunning, 2);
      expect(queue.isIdle, isTrue);
      expect(emptied, 1);
    });

    test('dedupes a waiting id and hands back the same future', () async {
      final queue = PQueue(concurrency: 1);
      final gate = Completer<void>();
      var runs = 0;
      unawaited(queue.add(() => gate.future));
      final first = queue.add(() async => ++runs, id: 'k');
      final second = queue.add(() async => ++runs, id: 'k');
      expect(identical(first, second), isTrue);
      expect(queue.size, 1);
      gate.complete();
      expect(await first, 1);
      expect(await second, 1);
      expect(runs, 1);
    });

    test('higher priority runs first, equal priorities keep their order',
        () async {
      final queue = PQueue(concurrency: 1);
      final gate = Completer<void>();
      final order = <String>[];
      unawaited(queue.add(() => gate.future));
      unawaited(queue.add(() async => order.add('low-1'), priority: 0));
      unawaited(queue.add(() async => order.add('high-1'), priority: 1));
      unawaited(queue.add(() async => order.add('low-2'), priority: 0));
      unawaited(queue.add(() async => order.add('high-2'), priority: 1));
      gate.complete();
      await queue.whenIdle();
      expect(order, ['high-1', 'high-2', 'low-1', 'low-2']);
    });

    test('the client sends one POST /translate per missing key', () async {
      final server = FakeServer();
      final client = await bootClient(server, initWithDefault: Lang.en);
      client.getTranslation('Bonjour');
      client.getTranslation('Bonjour');
      client.getTranslation('Bonjour');
      client.getTranslation('Au revoir');
      await client.waitForIdle();
      expect(server.translateCount, 2);
      expect(server.translateBodies.map((b) => b['key']),
          containsAll(['Bonjour', 'Au revoir']));
      // The bulk fetch that follows the batch: one for the namespace, plus the boot one.
      expect(server.fetchCount, 2);
    });
  });

  group('retry policy', () {
    Future<(ApiResult, List<Duration>, int)> run(
      List<http.Response Function()> answers, {
      Duration? timeout,
    }) async {
      var call = 0;
      final delays = <Duration>[];
      final api = I18nKeylessApi(
        client: MockClient((_) async =>
            answers[call++ < answers.length ? call - 1 : answers.length - 1]()),
        sleep: (duration) async => delays.add(duration),
        timeout: timeout ?? const Duration(seconds: 10),
      );
      final result = await api
          .get(Uri.parse('https://api.test/translate/en'), headers: {});
      return (result, delays, api.attempts);
    }

    test('retries 5xx with the backoff schedule, then succeeds', () async {
      final (result, delays, attempts) = await run([
        () => http.Response('', 500),
        () => http.Response('', 503),
        () => http.Response('{"ok":true}', 200),
      ]);
      expect(result.ok, isTrue);
      expect(attempts, 3);
      expect(delays, [
        const Duration(milliseconds: 500),
        const Duration(milliseconds: 1500),
      ]);
    });

    test('gives up after the schedule and never throws', () async {
      final (result, delays, attempts) = await run([
        () => http.Response('', 500),
      ]);
      expect(result.ok, isFalse);
      expect(result.statusCode, 500);
      expect(attempts, 3);
      expect(delays.length, 2);
    });

    test('does not retry a 4xx other than 429', () async {
      for (final status in [400, 401, 403, 404]) {
        final (result, delays, attempts) = await run([
          () => http.Response('', status),
        ]);
        expect(result.ok, isFalse);
        expect(result.statusCode, status);
        expect(attempts, 1, reason: 'status $status');
        expect(delays, isEmpty);
      }
    });

    test('retries 429', () async {
      final (result, _, attempts) = await run([
        () => http.Response('', 429),
        () => http.Response('{"ok":true}', 200),
      ]);
      expect(result.ok, isTrue);
      expect(attempts, 2);
    });

    test('retries a network error', () async {
      final (result, _, attempts) = await run([
        () => throw http.ClientException('connection refused'),
        () => http.Response('{"ok":true}', 200),
      ]);
      expect(result.ok, isTrue);
      expect(attempts, 2);
    });

    test('times out at the configured duration', () async {
      final api = I18nKeylessApi(
        client: MockClient((_) => Completer<http.Response>().future),
        sleep: (_) async {},
        timeout: const Duration(milliseconds: 20),
      );
      final result = await api
          .get(Uri.parse('https://api.test/translate/en'), headers: {});
      expect(result.ok, isFalse);
      expect(result.error, 'timeout');
      expect(api.attempts, 3);
    });

    test('a 304 is reported as not modified, a 200 carries its ETag', () async {
      final (notModified, _, _) = await run([() => http.Response('', 304)]);
      expect(notModified.ok, isTrue);
      expect(notModified.notModified, isTrue);
      final (ok, _, _) = await run([
        () => http.Response('{"ok":true}', 200, headers: {'etag': '"v7"'}),
      ]);
      expect(ok.etag, '"v7"');
    });
  });

  group('bulk fetch and ETag', () {
    test('replays the ETag and keeps the cache on 304', () async {
      final server = FakeServer(dictionaries: {
        'en': {'Bonjour': 'Hello'},
      })
        ..etag = '"v1"';
      final client = await bootClient(server, initWithDefault: Lang.en);
      expect(client.getTranslation('Bonjour'), 'Hello');
      expect(server.fetchCount, 1);
      expect(
          server.requests.first.headers.containsKey('if-none-match'), isFalse);

      // A miss triggers a second bulk fetch, this time with If-None-Match.
      client.getTranslation('Au revoir');
      await client.waitForIdle();
      expect(server.fetchCount, 2);
      final second =
          server.requests.where((r) => r.method == 'GET').elementAt(1);
      expect(second.headers['if-none-match'], '"v1"');
      expect(second.url.queryParameters.containsKey('last_refresh'), isFalse);
      // 304: the stored copy is kept.
      expect(client.getTranslation('Bonjour'), 'Hello');
    });

    test('sends last_refresh as a query when there is no ETag yet', () async {
      final storage = MemoryStorage();
      await storage.setItem(StorageKeys.currentLanguage, 'en');
      await storage.setItem(StorageKeys.lastRefresh, '1699999999999');
      final server = FakeServer(dictionaries: {
        'en': {'Bonjour': 'Hello'},
      });
      final client = await bootClient(server, storage: storage);
      // Language change resets the cursor, so the boot fetch writes `null`...
      expect(server.requests.first.url.queryParameters['last_refresh'], 'null');
      // ...and the fetch after a miss replays the cursor the boot fetch returned.
      client.getTranslation('Au revoir');
      await client.waitForIdle();
      final second =
          server.requests.where((r) => r.method == 'GET').elementAt(1);
      expect(second.url.queryParameters['last_refresh'], '1700000000000');
    });

    test('a namespace goes on the query and in the storage key', () async {
      final server = FakeServer(dictionaries: {
        'en@checkout': {'Payer': 'Pay'},
      });
      final storage = MemoryStorage();
      final client =
          await bootClient(server, storage: storage, initWithDefault: Lang.en);
      client.getTranslation('Payer', namespace: 'checkout');
      await client.waitForIdle();
      final body = server.translateBodies.single;
      expect(body['namespace'], 'checkout');
      final fetch = server.requests
          .where((r) => r.method == 'GET' && r.url.path == '/translate/en')
          .last;
      expect(fetch.url.queryParameters['namespace'], 'checkout');
      expect(storage.entries['i18n-keyless-translations__checkout'],
          jsonEncode({'Payer': 'Pay'}));
      expect(jsonDecode(storage.entries[StorageKeys.namespaces]!),
          containsAll(['default', 'checkout']));
      expect(client.getTranslation('Payer', namespace: 'checkout'), 'Pay');
    });

    test('a failed fetch never clears the stored copy and never throws',
        () async {
      final storage = MemoryStorage();
      await storage.setItem(StorageKeys.currentLanguage, 'en');
      await storage.setItem(
          StorageKeys.translations, jsonEncode({'Bonjour': 'Hello'}));
      final server = FakeServer()..fetchStatus = 500;
      final client = await bootClient(server, storage: storage);
      expect(client.getTranslation('Bonjour'), 'Hello');
      expect(storage.entries[StorageKeys.translations],
          jsonEncode({'Bonjour': 'Hello'}));
      client.getTranslation('Au revoir');
      await client.waitForIdle();
      expect(client.getTranslation('Bonjour'), 'Hello');
    });
  });

  group('usage analytics', () {
    test('POSTs the stored usage once at init and clears it', () async {
      final storage = MemoryStorage();
      await storage.setItem(
        StorageKeys.translationsUsage,
        jsonEncode({
          'default': {'Bonjour': '2025-01-01'},
        }),
      );
      final server = FakeServer();
      final client = await bootClient(server, storage: storage);
      expect(server.usageCount, 1);
      final body = server.usageBodies.single;
      expect(body['primaryLanguage'], 'fr');
      expect(body['translationsUsageByNamespace'], {
        'default': {'Bonjour': '2025-01-01'},
      });
      expect(storage.entries[StorageKeys.translationsUsage], '');
      // Later lookups are recorded for the next launch, not sent now.
      client.getTranslation('Au revoir', context: 'ctx');
      await client.waitForIdle();
      expect(server.usageCount, 1);
      final recorded =
          jsonDecode(storage.entries[StorageKeys.translationsUsage]!)
              as Map<String, dynamic>;
      expect(recorded['default'], contains('Au revoir__ctx'));
    });

    test(
        'does not POST when there is nothing to send, nor when sendUsage is false',
        () async {
      final empty = FakeServer();
      await bootClient(empty);
      expect(empty.usageCount, 0);

      final storage = MemoryStorage();
      await storage.setItem(
        StorageKeys.translationsUsage,
        jsonEncode({
          'default': {'Bonjour': '2025-01-01'},
        }),
      );
      final server = FakeServer();
      final client =
          await bootClient(server, storage: storage, sendUsage: false);
      client.getTranslation('Bonjour');
      await client.waitForIdle();
      expect(server.usageCount, 0);
      expect(
          storage.entries[StorageKeys.translationsUsage],
          jsonEncode({
            'default': {'Bonjour': '2025-01-01'}
          }));
    });
  });

  group('hydration', () {
    test('serves stored translations synchronously and reuses the device id',
        () async {
      final storage = MemoryStorage();
      await storage.setItem(StorageKeys.uniqueId, 'stored-device-id');
      await storage.setItem(StorageKeys.currentLanguage, 'en');
      await storage.setItem(
          StorageKeys.translations, jsonEncode({'Bonjour': 'Hello'}));
      final server = FakeServer();
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage: storage));
      // Before any network answer.
      expect(client.currentLanguage, Lang.en);
      expect(client.getTranslation('Bonjour'), 'Hello');
      expect(client.uniqueId, 'stored-device-id');
      await client.waitForIdle();
      for (final request in server.requests) {
        expect(request.headers['unique_id'], 'stored-device-id');
        expect(request.headers['sdk'], 'flutter');
        expect(request.headers['content-type'], 'application/json');
        expect(request.headers['version'], i18nKeylessVersion);
        expect(request.headers['authorization'], 'Bearer test-key');
      }
      expect(storage.entries[StorageKeys.uniqueId], 'stored-device-id');
    });

    test('generates and persists a device id on first launch', () async {
      final storage = MemoryStorage();
      final server = FakeServer();
      final client = await bootClient(server, storage: storage);
      final id = client.uniqueId!;
      expect(id.length, 16);
      expect(isUniqueId(id), isTrue);
      expect(RegExp(r'^[0-9A-Za-z_]{16}$').hasMatch(id), isTrue);
      expect(storage.entries[StorageKeys.uniqueId], id);
      // The boot fetch is the primary language: no request at all.
      expect(server.fetchCount, 0);
      client.getTranslation('Bonjour');
      await client.setCurrentLanguage(Lang.en);
      await client.waitForIdle();
      expect(server.requests, isNotEmpty);
      for (final request in server.requests) {
        expect(request.headers['unique_id'], id);
      }
    });

    test('never adopts a server id when the device already has one', () async {
      final server = FakeServer(dictionaries: {'en': {}});
      final client = await bootClient(server, initWithDefault: Lang.en);
      expect(client.uniqueId, isNot('server-minted-id'));
    });

    test('skipCurrentLanguageHydration ignores the stored language', () async {
      final storage = MemoryStorage();
      await storage.setItem(StorageKeys.currentLanguage, 'en');
      final server = FakeServer();
      final client = I18nKeylessClient();
      await client.init(I18nKeylessConfig(
        apiKey: 'k',
        apiUrl: 'https://api.test',
        languages: const LanguagesConfig(
          primary: Lang.fr,
          supported: [Lang.fr, Lang.en],
          skipCurrentLanguageHydration: true,
        ),
        storage: storage,
        httpClient: server.client,
        logger: (_) {},
      ));
      expect(client.currentLanguage, Lang.fr);
    });

    test('a device id is generated even when the storage throws', () async {
      final server = FakeServer();
      final client = await bootClient(server, storage: _ThrowingStorage());
      expect(client.uniqueId, isNotNull);
      client.getTranslation('Bonjour');
      await client.setCurrentLanguage(Lang.en);
      await client.waitForIdle();
      expect(server.fetchCount, greaterThan(0));
    });
  });

  group('language', () {
    test('setCurrentLanguage fetches the new language and notifies', () async {
      final server = FakeServer(dictionaries: {
        'en': {'Bonjour': 'Hello'},
        'es': {'Bonjour': 'Hola'},
      });
      final client = await bootClient(server);
      var notifications = 0;
      client.addListener(() => notifications++);
      expect(client.getTranslation('Bonjour'), 'Bonjour');
      await client.setCurrentLanguage(Lang.en);
      expect(client.currentLanguage, Lang.en);
      expect(client.getTranslation('Bonjour'), 'Hello');
      await client.setCurrentLanguage(Lang.es);
      expect(client.getTranslation('Bonjour'), 'Hola');
      await client.setCurrentLanguage(Lang.fr);
      expect(client.getTranslation('Bonjour'), 'Bonjour');
      expect(notifications, greaterThanOrEqualTo(3));
      final fetched = server.requests
          .where((r) => r.method == 'GET')
          .map((r) => r.url.path)
          .toList();
      expect(fetched, ['/translate/en', '/translate/es']);
    });

    test('an unsupported language falls back', () async {
      final server = FakeServer();
      final client = await bootClient(server);
      await client.setCurrentLanguage(Lang.ja);
      expect(client.currentLanguage, Lang.fr);
    });

    test('the changes stream fires when a translation lands', () async {
      final server = FakeServer(dictionaries: {
        'en': {'Bonjour': 'Hello'},
      });
      final client = await bootClient(server, initWithDefault: Lang.en);
      server.dictionaries['en']!['Au revoir'] = 'Goodbye';
      final change = client.changes.first;
      expect(client.getTranslation('Au revoir'), 'Au revoir');
      await change;
      expect(client.getTranslation('Au revoir'), 'Goodbye');
    });
  });

  group('wire format', () {
    test('POST /translate body', () async {
      final server = FakeServer();
      final client = await bootClient(server, initWithDefault: Lang.en);
      client.getTranslation('8 heures', context: 'durée');
      client.getTranslation(
        'Salut',
        forceTemporary: {Lang.en: 'Hi'},
        originLanguage: Lang.es,
      );
      await client.waitForIdle();
      final first =
          server.translateBodies.firstWhere((b) => b['key'] == '8 heures');
      expect(first, {
        'key': '8 heures',
        'context': 'durée',
        'languages': ['fr', 'en', 'es'],
        'primaryLanguage': 'fr',
      });
      final second =
          server.translateBodies.firstWhere((b) => b['key'] == 'Salut');
      expect(second['forceTemporary'], {'en': 'Hi'});
      expect(second['originLanguage'], 'es');
      expect(second.containsKey('namespace'), isFalse);
    });

    test('defaultNamespace from the config is used and sent', () async {
      final server = FakeServer();
      final client = await bootClient(server,
          initWithDefault: Lang.en, defaultNamespace: 'app');
      client.getTranslation('Bonjour');
      await client.waitForIdle();
      expect(server.translateBodies.single['namespace'], 'app');
    });

    test('custom handlers replace the HTTP calls', () async {
      final translated = <String>[];
      var fetched = 0;
      var usageSent = 0;
      final storage = MemoryStorage();
      await storage.setItem(
          StorageKeys.translationsUsage,
          jsonEncode({
            'default': {'x': '2025-01-01'}
          }));
      final client = I18nKeylessClient();
      await client.init(I18nKeylessConfig(
        apiKey: 'k',
        languages: const LanguagesConfig(
            primary: Lang.fr,
            supported: [Lang.fr, Lang.en],
            initWithDefault: Lang.en),
        storage: storage,
        handleTranslate: (key) async {
          translated.add(key);
          return const HandleTranslateResult(ok: true);
        },
        getAllTranslations: () async {
          fetched++;
          return const TranslationsResponse(
              ok: true, translations: {'Bonjour': 'Hello'});
        },
        sendTranslationsUsage: (usage) async {
          usageSent++;
          expect(usage, {'x': '2025-01-01'});
          return const UsageResponse(ok: true);
        },
        logger: (_) {},
      ));
      await client.waitForIdle();
      expect(fetched, 1);
      expect(usageSent, 1);
      expect(client.getTranslation('Bonjour'), 'Hello');
      client.getTranslation('Au revoir');
      await client.waitForIdle();
      expect(translated, ['Au revoir']);
      expect(fetched, 2);
    });

    test('init rejects an empty api key, even with custom handlers', () async {
      final client = I18nKeylessClient();
      expect(
        () => client.init(I18nKeylessConfig(
          apiKey: '',
          languages:
              const LanguagesConfig(primary: Lang.fr, supported: [Lang.fr]),
          handleTranslate: (_) async => const HandleTranslateResult(ok: true),
          getAllTranslations: () async => const TranslationsResponse(ok: true),
        )),
        throwsArgumentError,
      );
    });
  });

  group('languages', () {
    test('48 codes, v3 spelling', () {
      expect(availableLangs.length, 48);
      expect(availableLangCodes, contains('zh-Hans'));
      expect(availableLangCodes, contains('cs'));
      expect(availableLangCodes, isNot(contains('cn')));
      expect(availableLangCodes.first, 'ar');
      expect(availableLangCodes.last, 'vi');
      expect(Lang.fromCode('pt-br'), Lang.ptBR);
      expect(Lang.fromCode('xx'), isNull);
    });

    test('toAppStoreLocale', () {
      expect(toAppStoreLocale(Lang.fr), 'fr-FR');
      expect(toAppStoreLocale(Lang.pt), 'pt-PT');
      expect(toAppStoreLocale(Lang.en), 'en-US');
      expect(toAppStoreLocale(Lang.ja), 'ja');
    });

    test('resolveLang', () {
      expect(resolveLang('pt-BR'), Lang.ptBR);
      expect(resolveLang('pt-AO'), Lang.pt);
      expect(resolveLang('fr-CH'), Lang.fr);
      expect(resolveLang('zh-TW'), Lang.zhHant);
      expect(resolveLang('zh_CN'), Lang.zhHans);
      expect(resolveLang('zh'), Lang.zhHans);
      expect(resolveLang('es-419'), Lang.esMX);
      expect(resolveLang('xx'), isNull);
      expect(resolveLang(null), isNull);
      expect(
        resolveLang('pt-BR', supported: [Lang.pt, Lang.en], fallback: Lang.en),
        Lang.pt,
      );
      expect(
        resolveLang('ja', supported: [Lang.pt, Lang.en], fallback: Lang.en),
        Lang.en,
      );
    });
  });
}

class _ThrowingStorage implements I18nKeylessStorage {
  @override
  Future<String?> getItem(String key) async => throw StateError('no storage');

  @override
  Future<void> setItem(String key, String value) async =>
      throw StateError('no storage');

  @override
  Future<void> removeItem(String key) async => throw StateError('no storage');
}
