import 'package:flutter_test/flutter_test.dart';
import 'package:i18n_keyless/i18n_keyless.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // `SharedPreferences.setMockInitialValues` only mocks the legacy API; the async
    // API the adapter is built on has its own in-memory platform.
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.empty();
  });

  group('SharedPreferencesStorage', () {
    test('a missing key reads as null', () async {
      final storage = SharedPreferencesStorage();
      expect(await storage.getItem('missing'), isNull);
    });

    test('setItem, getItem and removeItem round trip', () async {
      final storage = SharedPreferencesStorage();
      await storage.setItem(StorageKeys.translations, '{"Bonjour":"Hello"}');
      expect(await storage.getItem(StorageKeys.translations),
          '{"Bonjour":"Hello"}');
      await storage.setItem(StorageKeys.translations, '{}');
      expect(await storage.getItem(StorageKeys.translations), '{}');
      await storage.removeItem(StorageKeys.translations);
      expect(await storage.getItem(StorageKeys.translations), isNull);
    });

    test('removing a missing key does not throw', () async {
      final storage = SharedPreferencesStorage();
      await storage.removeItem('missing');
      expect(await storage.getItem('missing'), isNull);
    });

    test('an injected SharedPreferencesAsync is used as is', () async {
      final preferences = SharedPreferencesAsync();
      await preferences.setString('seeded', 'value');
      final storage = SharedPreferencesStorage(preferences);
      expect(await storage.getItem('seeded'), 'value');
      await storage.setItem('other', 'x');
      expect(await preferences.getString('other'), 'x');
    });

    test('works as the storage of a client across two inits', () async {
      final client = I18nKeylessClient();
      await client.init(I18nKeylessConfig(
        apiKey: 'k',
        languages: const LanguagesConfig(
            primary: Lang.fr,
            supported: [Lang.fr, Lang.en],
            initWithDefault: Lang.en),
        storage: SharedPreferencesStorage(),
        handleTranslate: (_) async => const HandleTranslateResult(ok: true),
        getAllTranslations: () async => const TranslationsResponse(
            ok: true, translations: {'Bonjour': 'Hello'}, lastRefresh: '1'),
        logger: (_) {},
      ));
      await client.waitForIdle();
      expect(client.getTranslation('Bonjour'), 'Hello');
      final preferences = SharedPreferencesAsync();
      expect(await preferences.getString(StorageKeys.translations),
          '{"Bonjour":"Hello"}');
      expect(await preferences.getString(StorageKeys.currentLanguage), 'en');
      expect(
          await preferences.getString(StorageKeys.uniqueId), client.uniqueId);

      // A second client on the same preferences hydrates from them.
      final again = I18nKeylessClient();
      await again.init(I18nKeylessConfig(
        apiKey: 'k',
        languages: const LanguagesConfig(
            primary: Lang.fr, supported: [Lang.fr, Lang.en]),
        storage: SharedPreferencesStorage(),
        handleTranslate: (_) async => const HandleTranslateResult(ok: true),
        getAllTranslations: () async => const TranslationsResponse(ok: true),
        logger: (_) {},
      ));
      expect(again.currentLanguage, Lang.en);
      expect(again.getTranslation('Bonjour'), 'Hello');
      expect(again.uniqueId, client.uniqueId);
      await again.waitForIdle();
    });
  });
}
