// The precompiled bundle (docs/PROTOCOL.md 7.4): a namespace the manifest covers in the
// current language is seeded from the shipped file, with the bundle's cursor, instead of
// fetched, at boot and on a language switch. Storage wins only when newer and in the same
// language. Everything not covered keeps the fetch, and a miss still POSTs.
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:i18n_keyless/i18n_keyless.dart';

const bundleCursor = '1757000000000';

final manifest = BundleManifest.fromJson({
  'primaryLanguage': 'fr',
  'languages': ['en', 'es', 'fr'],
  'exportedAt': bundleCursor,
  'namespaces': {
    'default': {
      'lastRefresh': bundleCursor,
      'languages': ['en', 'es', 'fr']
    },
    'checkout': {
      'lastRefresh': bundleCursor,
      'languages': ['en']
    },
  },
});

const files = <String, Map<String, String>>{
  'default/en.json': {'Bonjour': 'Hello', 'Merci': 'Thanks'},
  'default/es.json': {'Bonjour': 'Hola', 'Merci': 'Gracias'},
  'default/fr.json': {'Bonjour': 'Bonjour', 'Merci': 'Merci'},
  'checkout/en.json': {'Panier': 'Cart'},
};

class Loads {
  final List<String> calls = [];
  I18nKeylessBundle bundle({bool failing = false}) => I18nKeylessBundle(
        manifest: manifest,
        load: (namespace, lang) async {
          calls.add('$namespace/${lang.code}');
          if (failing) throw StateError('missing');
          return files['$namespace/${lang.code}.json'];
        },
      );
}

/// A backend that records requests and answers every dictionary from the API.
class Server {
  final List<http.Request> requests = [];
  List<http.Request> get dictionaries =>
      requests.where((r) => r.method == 'GET').toList();
  List<http.Request> get translates => requests
      .where((r) => r.method == 'POST' && r.url.path == '/translate')
      .toList();

  http.Client get client => MockClient((request) async {
        requests.add(request);
        http.Response json(Map<String, dynamic> body) =>
            http.Response(jsonEncode(body), 200,
                headers: {'content-type': 'application/json'});
        if (request.method == 'GET') {
          return json({
            'ok': true,
            'data': {
              'translations': {'Fetched': 'From the API'},
              'uniqueId': null,
              'lastRefresh': '111',
            },
            'error': '',
            'message': '',
          });
        }
        return json({'ok': true, 'data': {}, 'error': '', 'message': ''});
      });
}

I18nKeylessConfig configFor(
  Server server,
  MemoryStorage storage, {
  I18nKeylessBundle? bundle,
  LanguagesConfig? languages,
}) =>
    I18nKeylessConfig(
      apiKey: 'k',
      apiUrl: 'https://api.test',
      languages: languages ??
          const LanguagesConfig(
              primary: Lang.fr, supported: [Lang.fr, Lang.en, Lang.es]),
      storage: storage,
      bundle: bundle,
      httpClient: server.client,
      logger: (_) {},
    );

Future<MemoryStorage> storageWith(Map<String, String> entries) async {
  final storage = MemoryStorage();
  for (final entry in entries.entries) {
    await storage.setItem(entry.key, entry.value);
  }
  return storage;
}

void main() {
  group('boot', () {
    test(
        'seeds every bundled namespace in the current language, with the bundle cursor, and fetches nothing',
        () async {
      final server = Server();
      final storage = await storageWith({StorageKeys.currentLanguage: 'en'});
      final loads = Loads();
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage, bundle: loads.bundle()));
      await client.waitForIdle();

      expect(client.currentLanguage, Lang.en);
      expect(client.getTranslation('Bonjour'), 'Hello');
      expect(client.getTranslation('Panier', namespace: 'checkout'), 'Cart');
      expect(client.translations,
          {'Bonjour': 'Hello', 'Merci': 'Thanks', 'Panier': 'Cart'});
      expect(server.dictionaries, isEmpty);
      expect(loads.calls, containsAll(['default/en', 'checkout/en']));
      // Persisted like a fetched dictionary, so the delta cursor survives a reload.
      expect(storage.entries[StorageKeys.lastRefresh], bundleCursor);
      expect(storage.entries[StorageKeys.lastRefreshKeyFor('checkout')],
          bundleCursor);
      expect(jsonDecode(storage.entries[StorageKeys.namespaces]!),
          ['default', 'checkout']);
    });

    test(
        'seeds the bundled primary dictionary too, and fetches only an origin namespace the bundle does not cover',
        () async {
      final server = Server();
      final storage = await storageWith({
        StorageKeys.currentLanguage: 'fr',
        StorageKeys.originNamespaces: jsonEncode(['chat']),
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage, bundle: Loads().bundle()));
      await client.waitForIdle();

      expect(jsonDecode(storage.entries[StorageKeys.translations]!),
          {'Bonjour': 'Bonjour', 'Merci': 'Merci'});
      expect(server.dictionaries.length, 1);
      expect(server.dictionaries.single.url.toString(),
          'https://api.test/translate/fr?last_refresh=null&namespace=chat');
    });

    test('fetches a language the bundle does not cover for a namespace',
        () async {
      final server = Server();
      final storage = await storageWith({StorageKeys.currentLanguage: 'es'});
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage, bundle: Loads().bundle()));
      await client.waitForIdle();

      // default/es is bundled, checkout/es is not.
      expect(client.getTranslation('Bonjour'), 'Hola');
      expect(server.dictionaries.length, 1);
      expect(server.dictionaries.single.url.toString(),
          'https://api.test/translate/es?last_refresh=null&namespace=checkout');
      expect(
          jsonDecode(storage.entries[StorageKeys.translationsKeyFor('checkout')]!),
          {'Fetched': 'From the API'});
    });

    test(
        'keeps a stored slice on top of the bundle when it is newer and in the same language',
        () async {
      final server = Server();
      final newer = '${int.parse(bundleCursor) + 60000}';
      final storage = await storageWith({
        StorageKeys.currentLanguage: 'en',
        StorageKeys.namespaces: jsonEncode(['default']),
        StorageKeys.translations: jsonEncode({'Bonjour': 'Hello, reviewed'}),
        StorageKeys.lastRefresh: newer,
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage, bundle: Loads().bundle()));
      await client.waitForIdle();

      expect(client.getTranslation('Bonjour'), 'Hello, reviewed');
      expect(client.getTranslation('Merci'), 'Thanks');
      expect(storage.entries[StorageKeys.lastRefresh], newer);
      expect(server.dictionaries, isEmpty);
    });

    test('ignores a stored slice that is older than the bundle', () async {
      final server = Server();
      final storage = await storageWith({
        StorageKeys.currentLanguage: 'en',
        StorageKeys.namespaces: jsonEncode(['default']),
        StorageKeys.translations: jsonEncode({'Bonjour': 'Old hello'}),
        StorageKeys.lastRefresh: '${int.parse(bundleCursor) - 60000}',
      });
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage, bundle: Loads().bundle()));
      await client.waitForIdle();

      expect(client.getTranslation('Bonjour'), 'Hello');
      expect(storage.entries[StorageKeys.lastRefresh], bundleCursor);
    });

    test('never mixes in a newer stored slice written in another language',
        () async {
      final server = Server();
      // Storage holds English, the app boots in Spanish (skipCurrentLanguageHydration).
      final storage = await storageWith({
        StorageKeys.currentLanguage: 'en',
        StorageKeys.namespaces: jsonEncode(['default']),
        StorageKeys.translations: jsonEncode({'Bonjour': 'Hello'}),
        StorageKeys.lastRefresh: '${int.parse(bundleCursor) + 60000}',
      });
      final client = I18nKeylessClient();
      await client.init(configFor(
        server,
        storage,
        bundle: Loads().bundle(),
        languages: const LanguagesConfig(
          primary: Lang.fr,
          supported: [Lang.fr, Lang.en, Lang.es],
          initWithDefault: Lang.es,
          skipCurrentLanguageHydration: true,
        ),
      ));
      await client.waitForIdle();

      expect(client.currentLanguage, Lang.es);
      expect(client.getTranslation('Bonjour'), 'Hola');
      expect(jsonDecode(storage.entries[StorageKeys.translations]!),
          {'Bonjour': 'Hola', 'Merci': 'Gracias'});
      expect(storage.entries[StorageKeys.lastRefresh], bundleCursor);
    });

    test('falls back to the fetch when the loader throws', () async {
      final server = Server();
      final storage = await storageWith({StorageKeys.currentLanguage: 'en'});
      final client = I18nKeylessClient();
      await client.init(
          configFor(server, storage, bundle: Loads().bundle(failing: true)));
      await client.waitForIdle();

      expect(server.dictionaries.length, 2);
      expect(client.getTranslation('Fetched'), 'From the API');
    });
  });

  group('language switch', () {
    test(
        'seeds the new language from the bundle and never mixes the previous language in',
        () async {
      final server = Server();
      final storage = await storageWith({StorageKeys.currentLanguage: 'en'});
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage, bundle: Loads().bundle()));
      await client.waitForIdle();
      expect(server.dictionaries, isEmpty);

      await client.setCurrentLanguage(Lang.es);
      await client.waitForIdle();

      expect(client.getTranslation('Bonjour'), 'Hola');
      expect(jsonDecode(storage.entries[StorageKeys.translations]!),
          {'Bonjour': 'Hola', 'Merci': 'Gracias'});
      expect(storage.entries[StorageKeys.lastRefresh], bundleCursor);
      // checkout has no Spanish file: fetched.
      expect(server.dictionaries.length, 1);
      expect(server.dictionaries.single.url.toString(),
          'https://api.test/translate/es?last_refresh=null&namespace=checkout');
    });

    test('a miss still POSTs, and the delta after it starts from the bundle cursor',
        () async {
      final server = Server();
      final storage = await storageWith({StorageKeys.currentLanguage: 'en'});
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage, bundle: Loads().bundle()));
      await client.waitForIdle();

      expect(client.getTranslation('Nouveau'), 'Nouveau');
      await client.waitForIdle();

      expect(server.translates.length, 1);
      expect(jsonDecode(server.translates.single.body)['key'], 'Nouveau');
      expect(server.dictionaries.length, 1);
      expect(server.dictionaries.single.url.toString(),
          'https://api.test/translate/en?last_refresh=$bundleCursor');
      expect(client.getTranslation('Fetched'), 'From the API');
      expect(client.getTranslation('Bonjour'), 'Hello');
    });
  });

  group('without a bundle', () {
    test('fetches exactly as before', () async {
      final server = Server();
      final storage = await storageWith({StorageKeys.currentLanguage: 'en'});
      final client = I18nKeylessClient();
      await client.init(configFor(server, storage));
      await client.waitForIdle();

      expect(server.dictionaries.length, 1);
      expect(server.dictionaries.single.url.toString(),
          'https://api.test/translate/en?last_refresh=null');
    });
  });

  group('loadI18nKeylessBundleFromAssets', () {
    test('reads the manifest and the files through the asset bundle', () async {
      final assets = _FakeAssets({
        'assets/i18n-keyless/manifest.json': jsonEncode({
          'primaryLanguage': 'fr',
          'languages': ['en', 'fr'],
          'exportedAt': bundleCursor,
          'namespaces': {
            'default': {
              'lastRefresh': bundleCursor,
              'languages': ['en', 'fr']
            },
          },
        }),
        'assets/i18n-keyless/default/en.json': jsonEncode({'Bonjour': 'Hello'}),
      });
      final bundle = await loadI18nKeylessBundleFromAssets('assets/i18n-keyless/',
          assetBundle: assets);
      expect(bundle.manifest.primaryLanguage, 'fr');
      expect(bundle.manifest.namespaces['default']!.languages, ['en', 'fr']);
      expect(await bundle.load('default', Lang.en), {'Bonjour': 'Hello'});
      expect(bundleCovers(bundle.manifest, 'default', 'es'), isFalse);
    });
  });
}

class _FakeAssets extends CachingAssetBundle {
  _FakeAssets(this.files);

  final Map<String, String> files;

  @override
  Future<ByteData> load(String key) async {
    final text = files[key];
    if (text == null) throw StateError('asset not found: $key');
    return ByteData.sublistView(Uint8List.fromList(utf8.encode(text)));
  }
}
