// Replays the language-neutral vectors of `conformance/vectors/*.json` (see
// `conformance/README.md` and `docs/PROTOCOL.md` at the repository root).
//
// The vectors are read from the repository at test time. When the directory is not
// there (a copy of the package outside the monorepo), the whole suite is skipped.
//
// Cases for a server runtime (`node`, `react-server`) are not applicable: this port is
// a device SDK and always reports `react-client`. They are listed as skipped.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:i18n_keyless/i18n_keyless_core.dart';

final Directory vectorsDir = Directory('../../conformance/vectors');

Map<String, dynamic> loadVector(String name) =>
    jsonDecode(File('${vectorsDir.path}/$name').readAsStringSync())
        as Map<String, dynamic>;

List<Map<String, dynamic>> casesOf(Map<String, dynamic> vector,
        [String field = 'cases']) =>
    (vector[field] as List).cast<Map<String, dynamic>>();

String nameOf(Map<String, dynamic> c) =>
    c['name']?.toString() ?? jsonEncode(c['input']);

Lang langOf(Object? code) => Lang.fromCode(code as String)!;

TranslationOptions optionsOf(Object? raw) {
  final o = (raw as Map?)?.cast<String, dynamic>() ?? const {};
  final forced = o['forceTemporary'] as Map?;
  return TranslationOptions(
    context: o['context'] as String?,
    namespace: o['namespace'] as String?,
    unpersistedNamespace: o['unpersistedNamespace'] == true,
    replace: (o['replace'] as Map?)?.cast<String, String>(),
    originLanguage:
        o['originLanguage'] == null ? null : langOf(o['originLanguage']),
    forceTemporary: forced == null
        ? null
        : {for (final e in forced.entries) langOf(e.key): e.value as String},
  );
}

final RegExp deviceIdPattern = RegExp(r'^[0-9A-Z_a-z]{16}$');

/// Exact header set: every expected header present with its value, and no other.
void expectHeaders(http.BaseRequest request, Map<String, dynamic> expected) {
  final actual = {
    for (final e in request.headers.entries) e.key.toLowerCase(): e.value,
  };
  for (final e in expected.entries) {
    final value = actual[e.key.toLowerCase()];
    switch (e.value) {
      case r'$SDK_VERSION':
        expect(value, i18nKeylessVersion, reason: 'header ${e.key}');
      // The vectors are the react package's: a device case expects `react-client`.
      // This port is the same kind of client (a device) under its own label.
      case 'react-client' when e.key.toLowerCase() == 'sdk':
        expect(value, i18nKeylessSdkRuntime, reason: 'header ${e.key}');
      case r'$DEVICE_ID':
        expect(value, matches(deviceIdPattern), reason: 'header ${e.key}');
      default:
        expect(value, e.value, reason: 'header ${e.key}');
    }
  }
  expect(actual.keys.toSet(), expected.keys.map((k) => k.toLowerCase()).toSet(),
      reason: 'exact header set');
}

http.Response envelope(Map<String, dynamic> data) => http.Response(
    jsonEncode({'ok': true, 'data': data, 'error': '', 'message': ''}), 200,
    headers: {'content-type': 'application/json'});

/// A backend that answers every route `ok`, records requests, and can hold `POST
/// /translate` answers until [release] completes (for the queue scenarios).
class Transport {
  Transport({this.dictionary = const {}});

  final Map<String, String> dictionary;
  final List<http.Request> requests = [];
  Completer<void>? gate;
  int inFlightTranslates = 0;
  int peakInFlightTranslates = 0;

  List<http.Request> get translates => requests
      .where((r) => r.method == 'POST' && r.url.path == '/translate')
      .toList();
  List<http.Request> get dictionaries =>
      requests.where((r) => r.method == 'GET').toList();
  List<http.Request> get usages => requests
      .where((r) => r.url.path == '/translate/last-used-translations')
      .toList();

  http.Client get client => MockClient((request) async {
        requests.add(request);
        if (request.method == 'POST' && request.url.path == '/translate') {
          inFlightTranslates++;
          if (inFlightTranslates > peakInFlightTranslates) {
            peakInFlightTranslates = inFlightTranslates;
          }
          if (gate != null) await gate!.future;
          inFlightTranslates--;
          return envelope({'translation': <String, String>{}});
        }
        if (request.method == 'GET') {
          return envelope({
            'translations': dictionary,
            'uniqueId': null,
            'lastRefresh': '1',
          });
        }
        return http.Response(jsonEncode({'ok': true, 'message': ''}), 200);
      });
}

/// A transport that plays scripted outcomes (`{status, statusText, headers, body,
/// invalidJson, networkError, timeout}`) in order, then repeats the last one.
class ScriptedTransport {
  ScriptedTransport(this.outcomes);

  final List<Map<String, dynamic>> outcomes;
  final List<http.Request> requests = [];

  http.Client get client => MockClient((request) {
        requests.add(request);
        final index = requests.length - 1;
        final outcome =
            outcomes[index < outcomes.length ? index : outcomes.length - 1];
        if (outcome['timeout'] == true) {
          return Completer<http.Response>().future;
        }
        if (outcome['networkError'] != null) {
          throw http.ClientException(outcome['networkError'] as String);
        }
        final status = outcome['status'] as int;
        final headers =
            (outcome['headers'] as Map?)?.cast<String, String>() ?? const {};
        final String body;
        if (outcome['invalidJson'] == true) {
          body = '{not json';
        } else if (outcome['body'] != null) {
          body = jsonEncode(outcome['body']);
        } else {
          body = '';
        }
        return Future.value(http.Response(body, status,
            headers: headers, reasonPhrase: outcome['statusText'] as String?));
      });
}

class RecordingStorage extends MemoryStorage {
  final List<String> reads = [];

  @override
  Future<String?> getItem(String key) {
    reads.add(key);
    return super.getItem(key);
  }
}

I18nKeylessConfig configFrom(
  Map<String, dynamic> raw, {
  required http.Client httpClient,
  I18nKeylessStorage? storage,
  Lang? initWithDefault,
  HandleTranslate? handleTranslate,
  GetAllTranslations? getAllTranslations,
  SendTranslationsUsage? sendTranslationsUsage,
  I18nKeylessLogger? logger,
}) {
  final languages = (raw['languages'] as Map).cast<String, dynamic>();
  return I18nKeylessConfig(
    apiKey: raw['API_KEY'] as String,
    apiUrl: raw['API_URL'] as String?,
    defaultNamespace: raw['defaultNamespace'] as String?,
    languages: LanguagesConfig(
      primary: langOf(languages['primary']),
      supported: (languages['supported'] as List).map(langOf).toList(),
      initWithDefault: initWithDefault,
    ),
    storage: storage,
    httpClient: httpClient,
    handleTranslate: handleTranslate,
    getAllTranslations: getAllTranslations,
    sendTranslationsUsage: sendTranslationsUsage,
    logger: logger ?? (_) {},
  );
}

void main() {
  if (!vectorsDir.existsSync()) {
    test('conformance vectors', () {},
        skip: 'conformance/vectors not found at ${vectorsDir.absolute.path}');
    return;
  }

  group('storage-key.json', () {
    for (final c in casesOf(loadVector('storage-key.json'))) {
      test(nameOf(c), () {
        final input = c['input'] as Map;
        expect(
            storageKeyFor(input['key'] as String, input['context'] as String?),
            c['expected']);
      });
    }
  });

  group('replace.json', () {
    for (final c in casesOf(loadVector('replace.json'))) {
      test(nameOf(c), () {
        final input = c['input'] as Map;
        expect(
          applyReplace(input['text'] as String,
              (input['replace'] as Map?)?.cast<String, String>()),
          c['expected'],
        );
      });
    }
  });

  group('namespace.json', () {
    final vector = loadVector('namespace.json');
    test('default namespace constant', () {
      expect(defaultNamespace, vector['defaultNamespace']);
    });
    for (final c in casesOf(vector)) {
      test(nameOf(c), () {
        final input = c['input'] as Map;
        final options =
            input['options'] == null ? null : optionsOf(input['options']);
        if (c['fn'] == 'resolveNamespace') {
          final config = (input['config'] as Map).cast<String, dynamic>();
          expect(
              resolveNamespace(options, config['defaultNamespace'] as String?),
              c['expected']);
        } else {
          expect(resolveOriginLanguage(options, langOf(input['primary']))?.code,
              c['expected']);
        }
      });
    }
  });

  group('resolve-lang.json', () {
    for (final c in casesOf(loadVector('resolve-lang.json'))) {
      test(nameOf(c), () {
        final input = c['input'] as Map;
        expect(
          resolveLang(
            input['tag'] as String?,
            supported: (input['supported'] as List?)?.map(langOf),
            fallback:
                input['fallback'] == null ? null : langOf(input['fallback']),
          )?.code,
          c['expected'],
        );
      });
    }
  });

  group('languages.json', () {
    for (final c in casesOf(loadVector('languages.json'))) {
      test(nameOf(c), () {
        switch (c['check']) {
          case 'availableLangs':
            expect(availableLangCodes, c['expected']);
          case 'rename':
            expect(Lang.fromCode(c['input'] as String), isNull);
            expect(availableLangCodes, contains(c['expected']));
          case 'stillAvailable':
            expect(availableLangCodes, containsAll(c['input'] as List));
          case 'absent':
            expect(availableLangCodes, isNot(contains(c['input'])));
          case 'regionalized':
            expect(
                availableLangCodes.where((code) => code.contains('-')).toSet(),
                (c['expected'] as List).toSet());
          default:
            fail('unknown check ${c['check']}');
        }
      });
    }
  });

  group('app-store-locales.json', () {
    final vector = loadVector('app-store-locales.json');
    test('48 distinct slots', () {
      expect(availableLangs.map(toAppStoreLocale).toSet().length,
          vector['distinctSlots']);
    });
    for (final c in casesOf(vector)) {
      test(nameOf(c), () {
        expect(toAppStoreLocale(langOf(c['input'])), c['expected']);
      });
    }
  });

  group('unique-id.json', () {
    final vector = loadVector('unique-id.json');
    test('generation: shape, alphabet, storage key', () {
      final pattern = RegExp(vector['idPattern'] as String);
      for (var i = 0; i < 200; i++) {
        final id = generateUniqueId();
        expect(id.length, vector['idLength']);
        expect(id, matches(pattern));
        expect(isUniqueId(id), isTrue);
      }
      expect(StorageKeys.uniqueId, vector['storageKey']);
    });
    for (final c in casesOf(vector)) {
      test(nameOf(c), () {
        expect(isUniqueId(c['input']), c['expected']);
      });
    }
  });

  group('backoff.json', () {
    final vector = loadVector('backoff.json');
    test('constants', () {
      expect(I18nKeylessApi.defaultTimeout.inMilliseconds, vector['timeoutMs']);
      expect(I18nKeylessApi.defaultRetryDelays.map((d) => d.inMilliseconds),
          vector['delaysMs']);
      expect(
          I18nKeylessApi.defaultRetryDelays.length + 1, vector['maxAttempts']);
    });
    for (final c in casesOf(vector)) {
      test(nameOf(c), () {
        final failed = (c['input'] as Map)['failedAttempt'] as int;
        final expected = c['expected'] as Map;
        final delays = I18nKeylessApi.defaultRetryDelays;
        if (failed <= delays.length) {
          expect(delays[failed - 1].inMilliseconds, expected['waitMs']);
          expect(failed + 1, expected['nextAttempt']);
        } else {
          expect(expected['waitMs'], isNull);
          expect(expected['nextAttempt'], isNull);
        }
      });
    }
    for (final s in casesOf(vector, 'scenarios')) {
      test(nameOf(s), () async {
        final transport = ScriptedTransport(
            (s['responses'] as List).cast<Map<String, dynamic>>());
        final sleeps = <int>[];
        final api = I18nKeylessApi(
          client: transport.client,
          sleep: (d) async => sleeps.add(d.inMilliseconds),
          timeout: const Duration(milliseconds: 20),
        );
        final result = await api
            .get(Uri.parse('https://api.test/translate/en'), headers: {});
        final expected = s['expected'] as Map;
        expect(api.attempts, expected['attempts']);
        expect(sleeps, expected['sleepsMs']);
        final expectedResult =
            (expected['result'] as Map).cast<String, dynamic>();
        expect(result.ok, expectedResult['ok']);
        if (expectedResult.containsKey('error')) {
          expect(result.error, expectedResult['error']);
        }
        if (expectedResult.containsKey('notModified')) {
          expect(result.notModified, expectedResult['notModified']);
        }
        if (expectedResult['ok'] == true && !result.notModified) {
          expect(result.json, expectedResult);
        }
      });
    }
  });

  group('retry-decision.json', () {
    for (final c in casesOf(loadVector('retry-decision.json'))) {
      test(nameOf(c), () async {
        final input = (c['input'] as Map).cast<String, dynamic>();
        final expected = c['expected'] as Map;
        final outcome = {
          ...input,
          if (input['status'] == 200) 'body': {'ok': true},
          if (input['status'] == 200) 'headers': {'etag': '"e1"'},
        };
        final transport = ScriptedTransport([outcome]);
        final sleeps = <int>[];
        final api = I18nKeylessApi(
            client: transport.client, sleep: (d) async => sleeps.add(1));
        final result = await api
            .get(Uri.parse('https://api.test/translate/en'), headers: {});
        switch (expected['action']) {
          case 'parse-body':
            expect(api.attempts, 1);
            expect(result.ok, isTrue);
            expect(result.json, {'ok': true});
            expect(result.etag, '"e1"');
          case 'not-modified':
            expect(api.attempts, 1);
            expect(result.ok, isTrue);
            expect(result.notModified, isTrue);
          case 'fail':
            expect(api.attempts, 1);
            expect(sleeps, isEmpty);
            expect(result.ok, isFalse);
            expect(result.error, expected['error']);
          case 'retry':
            expect(api.attempts, 3);
            expect(sleeps.length, 2);
            expect(result.ok, isFalse);
            expect(result.error, expected['error']);
          default:
            fail('unknown action ${expected['action']}');
        }
      });
    }
  });

  group('queue.json', () {
    final vector = loadVector('queue.json');
    test('constants', () {
      expect(PQueue().concurrency, vector['concurrency']);
      expect(vector['idRule'], "namespace + ':' + key");
    });
    for (final c in casesOf(vector)) {
      test(nameOf(c), () {
        final input = c['input'] as Map;
        expect(queueIdFor(input['namespace'] as String, input['key'] as String),
            c['expected']);
      });
    }
    for (final s in casesOf(vector, 'scenarios')) {
      test(nameOf(s), () async {
        final transport = Transport()..gate = Completer<void>();
        final storage = MemoryStorage();
        await storage.setItem(StorageKeys.currentLanguage, 'en');
        final seeded = s['translations'] as Map?;
        if (seeded != null) {
          await storage.setItem(StorageKeys.translations, jsonEncode(seeded));
        }
        final client = I18nKeylessClient();
        await client.init(I18nKeylessConfig(
          apiKey: 'k-queue',
          apiUrl: 'https://api.test',
          languages: const LanguagesConfig(
              primary: Lang.fr,
              supported: [Lang.fr, Lang.en, Lang.es, Lang.pt]),
          storage: storage,
          httpClient: transport.client,
          logger: (_) {},
        ));
        final calls = s['calls'] is String
            ? List.generate(31, (i) => {'key': 'key-$i'})
            : (s['calls'] as List).cast<Map<String, dynamic>>();
        for (final call in calls) {
          client.translate(call['key'] as String, optionsOf(call['options']));
        }
        // Let the queue hand its tasks to the transport, then open the gate.
        for (var i = 0; i < 10; i++) {
          await Future<void>.delayed(Duration.zero);
        }
        transport.gate!.complete();
        await client.waitForIdle();
        final expected = s['expected'] as Map;
        expect(transport.translates.length, expected['requests']);
        if (expected.containsKey('peakInFlight')) {
          expect(transport.peakInFlightTranslates, expected['peakInFlight']);
        }
      });
    }
  });

  group('translation-lookup.json', () {
    for (final c in casesOf(loadVector('translation-lookup.json'))) {
      test(nameOf(c), () async {
        final input = c['input'] as Map;
        final store = (input['store'] as Map).cast<String, dynamic>();
        final storage = MemoryStorage();
        await storage.setItem(
            StorageKeys.currentLanguage, store['currentLanguage'] as String);
        final translations =
            (store['translations'] as Map).cast<String, String>();
        if (translations.isNotEmpty) {
          await storage.setItem(
              StorageKeys.translations, jsonEncode(translations));
        }
        final transport = Transport();
        final client = I18nKeylessClient();
        await client.init(I18nKeylessConfig(
          apiKey: 'k-lookup',
          apiUrl: 'https://api.test',
          defaultNamespace: store['defaultNamespace'] as String?,
          languages: LanguagesConfig(
            primary: langOf(store['primary']),
            supported: const [Lang.fr, Lang.en, Lang.es],
          ),
          storage: storage,
          httpClient: transport.client,
          logger: (_) {},
        ));
        final text = client.translate(
            input['key'] as String, optionsOf(input['options']));
        final queued = client.namespacesAwaitingFetch.entries
            .map((e) => {'namespace': e.key, 'unpersisted': e.value})
            .toList();
        final expected = c['expected'] as Map;
        expect(text, expected['text']);
        expect(queued, expected['queued']);
        await client.waitForIdle();
      });
    }
  });

  group('translate-request.json', () {
    for (final c in casesOf(loadVector('translate-request.json'))) {
      final input = (c['input'] as Map).cast<String, dynamic>();
      final runtime = input['runtime'] as String;
      if (runtime != 'react-client') {
        test(nameOf(c), () {},
            skip: 'runtime $runtime is not applicable to a device SDK');
        continue;
      }
      test(nameOf(c), () async {
        final config = (input['config'] as Map).cast<String, dynamic>();
        final expected = c['expected'] as Map;
        final storage = MemoryStorage();
        await storage.setItem(
            StorageKeys.currentLanguage, input['currentLanguage'] as String);
        if (input['translations'] != null) {
          await storage.setItem(
              StorageKeys.translations, jsonEncode(input['translations']));
        }
        final transport = Transport();
        final handlerArgs = <String>[];
        final client = I18nKeylessClient();
        await client.init(configFrom(
          config,
          httpClient: transport.client,
          storage: storage,
          handleTranslate: config['handleTranslate'] == true
              ? (key) async {
                  handlerArgs.add(key);
                  return const HandleTranslateResult(ok: true);
                }
              : null,
        ));
        client.translate(input['key'] as String, optionsOf(input['options']));
        await client.waitForIdle();
        if (expected['http'] == false) {
          expect(transport.translates, isEmpty);
          expect(handlerArgs, expected['handlerArgs']);
          return;
        }
        final request = transport.translates.single;
        expect(request.url.toString(), expected['url']);
        expect(request.method, expected['method']);
        expectHeaders(
            request, (expected['headers'] as Map).cast<String, dynamic>());
        expect(jsonDecode(request.body), expected['body']);
      });
    }
  });

  group('dictionary-request.json', () {
    final vector = loadVector('dictionary-request.json');
    for (final c in casesOf(vector)) {
      final input = (c['input'] as Map).cast<String, dynamic>();
      final runtime = input['runtime'] as String;
      if (runtime != 'react-client') {
        test(nameOf(c), () {},
            skip: 'runtime $runtime is not applicable to a device SDK');
        continue;
      }
      final config = (input['config'] as Map).cast<String, dynamic>();
      final expected = c['expected'] as Map;
      final target = input['targetLanguage'] as String;
      final namespace = input['namespace'] as String?;
      final knownEtag = input['knownEtag'] as String?;
      test('${nameOf(c)}: URL and ETag key', () {
        if (expected['http'] == false) return;
        expect(
          buildDictionaryUrl(
            apiUrl: config['API_URL'] as String? ?? defaultApiUrl,
            lang: target,
            lastRefresh: input['lastRefresh'] as String?,
            namespace: namespace,
            etag: knownEtag,
          ),
          expected['url'],
        );
        expect(etagCacheKey(config['API_KEY'] as String, target, namespace),
            expected['etagCacheKey']);
      });
      test('${nameOf(c)}: headers on the wire', () async {
        final transport = Transport();
        var handlerCalls = 0;
        final client = I18nKeylessClient();
        await client.init(configFrom(
          config,
          httpClient: transport.client,
          getAllTranslations: config['getAllTranslations'] == true
              ? () async {
                  handlerCalls++;
                  return const TranslationsResponse(ok: true);
                }
              : null,
        ));
        if (knownEtag != null) {
          client.seedEtag(knownEtag,
              lang: langOf(target), namespace: namespace);
        }
        final otherEtag = input['knownEtagFor'] as Map?;
        if (otherEtag != null) {
          client.seedEtag(otherEtag['etag'] as String,
              lang: langOf(otherEtag['lang']));
        }
        // A miss in the namespace, then the drain of the queue fetches it.
        await client.setCurrentLanguage(langOf(target));
        client.translate('Bonjour', TranslationOptions(namespace: namespace));
        await client.waitForIdle();
        if (expected['http'] == false) {
          expect(transport.dictionaries, isEmpty);
          expect(handlerCalls, greaterThan(0));
          return;
        }
        final request = transport.dictionaries.last;
        expect(request.method, expected['method']);
        expect(request.url.path, Uri.parse(expected['url'] as String).path);
        expectHeaders(
            request, (expected['headers'] as Map).cast<String, dynamic>());
      });
    }
  });

  group('dictionary-response.json', () {
    for (final c in casesOf(loadVector('dictionary-response.json'))) {
      test(nameOf(c), () async {
        final input = (c['input'] as Map).cast<String, dynamic>();
        final apiKey = (input['config'] as Map)['API_KEY'] as String;
        final expected = (c['expected'] as Map).cast<String, dynamic>();
        final outcomes = c['responses'] != null
            ? (c['responses'] as List).cast<Map<String, dynamic>>()
            : [(c['response'] as Map).cast<String, dynamic>()];
        final transport = ScriptedTransport(outcomes);
        final api = I18nKeylessApi(
          client: transport.client,
          sleep: (_) async {},
          timeout: const Duration(milliseconds: 20),
        );
        final logs = <String>[];
        final storage = MemoryStorage();
        await storage.setItem(
            StorageKeys.translations, jsonEncode({'Existing': 'Kept'}));
        final client = I18nKeylessClient(api: api);
        await client.init(I18nKeylessConfig(
          apiKey: apiKey,
          languages: const LanguagesConfig(
              primary: Lang.fr, supported: [Lang.fr, Lang.en]),
          storage: storage,
          logger: logs.add,
        ));
        if (input['knownEtag'] != null) {
          client.seedEtag(input['knownEtag'] as String, lang: Lang.en);
        }
        // The first request of this (API key, language): the language switch.
        await client.setCurrentLanguage(Lang.en);
        if (expected.containsKey('attempts')) {
          expect(api.attempts, expected['attempts']);
        }
        final result = expected['result'] as Map?;
        expect(client.translations['Existing'], 'Kept',
            reason: 'the stored dictionary is kept');
        if (result == null) {
          expect(client.translations.containsKey('Bonjour'), isFalse);
        } else {
          final data = (result['data'] as Map).cast<String, dynamic>();
          final incoming = (data['translations'] as Map).cast<String, String>();
          for (final e in incoming.entries) {
            expect(client.translations[e.key], e.value);
          }
        }
        if (expected['warning'] != null) {
          expect(logs, contains('i18n-keyless: ${expected['warning']}'));
        }
        final remembered = client.dictionaryEtags[etagCacheKey(apiKey, 'en')];
        expect(remembered, expected['etagRemembered']);
        final next = (expected['nextRequest'] as Map).cast<String, dynamic>();
        expect(
          buildDictionaryUrl(
            apiUrl: defaultApiUrl,
            lang: 'en',
            lastRefresh: '1700000000',
            etag: remembered,
          ),
          next['url'],
        );
        expect(remembered, next['ifNoneMatch']);
      });
    }
  });

  group('usage-request.json', () {
    for (final c in casesOf(loadVector('usage-request.json'))) {
      final input = (c['input'] as Map).cast<String, dynamic>();
      final runtime = input['runtime'] as String;
      if (runtime != 'react-client') {
        test(nameOf(c), () {},
            skip: 'runtime $runtime is not applicable to a device SDK');
        continue;
      }
      test(nameOf(c), () async {
        final config = (input['config'] as Map).cast<String, dynamic>();
        final expected = c['expected'] as Map;
        final storage = MemoryStorage();
        final usage = input['usage'] as Map;
        if (usage.isNotEmpty) {
          await storage.setItem(
              StorageKeys.translationsUsage, jsonEncode(usage));
        }
        final transport = Transport();
        final handlerArgs = <Map<String, String>>[];
        final client = I18nKeylessClient();
        if ((config['API_KEY'] as String).isEmpty) {
          // `init` refuses an empty key, so nothing can be sent.
          await expectLater(
            client.init(configFrom(config,
                httpClient: transport.client, storage: storage)),
            throwsArgumentError,
          );
          expect(transport.requests, isEmpty);
          return;
        }
        await client.init(configFrom(
          config,
          httpClient: transport.client,
          storage: storage,
          sendTranslationsUsage: config['sendTranslationsUsage'] == true
              ? (bucket) async {
                  handlerArgs.add(bucket);
                  return const UsageResponse(ok: true);
                }
              : null,
        ));
        await client.waitForIdle();
        if (expected['http'] == false) {
          expect(transport.usages, isEmpty);
          if (expected['handlerArgs'] != null) {
            expect(handlerArgs, expected['handlerArgs']);
          }
          return;
        }
        final request = transport.usages.single;
        expect(request.url.toString(), expected['url']);
        expect(request.method, expected['method']);
        expectHeaders(
            request, (expected['headers'] as Map).cast<String, dynamic>());
        expect(jsonDecode(request.body), expected['body']);
      });
    }
  });

  group('usage-reporting.json', () {
    for (final c in casesOf(loadVector('usage-reporting.json'))) {
      final input = (c['input'] as Map).cast<String, dynamic>();
      final isDevice = input['package'] == 'react' &&
          input['hasWindow'] == true &&
          input['ssr'] != true;
      if (!isDevice) {
        test(nameOf(c), () {},
            skip: 'server runtimes are not applicable to a device SDK');
        continue;
      }
      test(nameOf(c), () async {
        final expected = c['expected'] as Map;
        // The react package reports `react-client`; this port reports its own device
        // label, which the vector's `serverLabels` rule classifies as a device.
        expect(expected['runtime'], 'react-client');
        expect(i18nKeylessSdkRuntime, 'flutter');
        final storage = MemoryStorage();
        await storage.setItem(
            StorageKeys.translationsUsage,
            jsonEncode({
              'default': {'x': '2026-01-01'}
            }));
        final transport = Transport();
        final client = I18nKeylessClient();
        await client.init(I18nKeylessConfig(
          apiKey: 'k-reporting',
          languages: const LanguagesConfig(
              primary: Lang.fr, supported: [Lang.fr, Lang.en]),
          storage: storage,
          httpClient: transport.client,
          logger: (_) {},
        ));
        // The boot POST first, so the record below is not swept by its success.
        await client.waitForIdle();
        client.translate('Bonjour');
        await client.waitForIdle();
        expect(transport.usages.isNotEmpty, expected['sendsUsage']);
        final recorded =
            jsonDecode((await storage.getItem(StorageKeys.translationsUsage))!)
                as Map;
        expect((recorded['default'] as Map).containsKey('Bonjour'),
            expected['recordsUsage']);
        expect(transport.usages.first.headers.containsKey('unique_id'),
            expected['sendsUniqueId']);
      });
    }
  });

  group('storage-keys.json', () {
    final vector = loadVector('storage-keys.json');
    test('fixed key names', () {
      final fixed = (vector['fixedKeys'] as Map).cast<String, dynamic>();
      expect((fixed['uniqueId'] as Map)['key'], StorageKeys.uniqueId);
      expect((fixed['currentLanguage'] as Map)['key'],
          StorageKeys.currentLanguage);
      expect((fixed['lastRefresh'] as Map)['key'], StorageKeys.lastRefresh);
      expect((fixed['translations'] as Map)['key'], StorageKeys.translations);
      expect((fixed['translationsUsage'] as Map)['key'],
          StorageKeys.translationsUsage);
      expect((fixed['namespaces'] as Map)['key'], StorageKeys.namespaces);
      expect((fixed['originNamespaces'] as Map)['key'],
          StorageKeys.originNamespaces);
    });
    test('hydration order', () async {
      final storage = RecordingStorage();
      final client = I18nKeylessClient();
      await client.init(I18nKeylessConfig(
        apiKey: 'k-order',
        languages: const LanguagesConfig(
            primary: Lang.fr, supported: [Lang.fr, Lang.en]),
        storage: storage,
        httpClient: Transport().client,
        logger: (_) {},
      ));
      expect(storage.reads, [
        StorageKeys.uniqueId,
        StorageKeys.namespaces,
        StorageKeys.translations,
        StorageKeys.lastRefresh,
        StorageKeys.originNamespaces,
        StorageKeys.translationsUsage,
        StorageKeys.currentLanguage,
        StorageKeys.lastRefresh,
      ]);
    });
    for (final c in casesOf(vector)) {
      test(nameOf(c), () async {
        switch (c['fn']) {
          case 'translationsKeyFor':
            expect(StorageKeys.translationsKeyFor(c['input'] as String),
                c['expected']);
          case 'lastRefreshKeyFor':
            expect(StorageKeys.lastRefreshKeyFor(c['input'] as String),
                c['expected']);
          case 'clearI18nKeylessStorage':
            final index =
                ((c['input'] as Map)['namespacesIndex'] as List).cast<String>();
            final expected = c['expected'] as Map;
            final storage = MemoryStorage();
            await storage.setItem(StorageKeys.namespaces, jsonEncode(index));
            for (final key in [
              ...(expected['deleted'] as List).cast<String>(),
              ...(expected['kept'] as List).cast<String>(),
            ]) {
              if (!storage.entries.containsKey(key)) {
                await storage.setItem(
                    key,
                    key == StorageKeys.uniqueId
                        ? 'deviceIdABCDEF12'
                        : key.contains('translations') ||
                                key.contains('namespaces')
                            ? '{}'
                            : 'x');
              }
            }
            final client = I18nKeylessClient();
            await client.init(I18nKeylessConfig(
              apiKey: 'k-clear',
              languages: const LanguagesConfig(
                  primary: Lang.fr, supported: [Lang.fr, Lang.en]),
              storage: storage,
              httpClient: Transport().client,
              logger: (_) {},
            ));
            await client.waitForIdle();
            await client.clearStorageAndStore();
            for (final key in (expected['deleted'] as List).cast<String>()) {
              expect(storage.entries.containsKey(key), isFalse, reason: key);
            }
            for (final key in (expected['kept'] as List).cast<String>()) {
              expect(storage.entries[key], 'deviceIdABCDEF12', reason: key);
            }
          default:
            fail('unknown fn ${c['fn']}');
        }
      });
    }
  });
}
