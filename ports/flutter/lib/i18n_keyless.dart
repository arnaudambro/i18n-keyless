/// i18n-keyless for Flutter: no ARB files, no `flutter gen-l10n`, no keys. Write
/// `T('Bonjour')` and ship 48 languages at runtime.
///
/// ```dart
/// final i18n = I18nKeylessClient();
/// await i18n.init(I18nKeylessConfig(
///   apiKey: 'YOUR_API_KEY',
///   languages: LanguagesConfig(primary: Lang.fr, supported: [Lang.fr, Lang.en]),
///   storage: SharedPreferencesStorage(),
/// ));
/// runApp(I18nKeylessScope(client: i18n, child: const MyApp()));
///
/// // anywhere below:
/// T('Bonjour le monde');
/// context.t('Votre email');
/// I18nKeyless.of(context).setCurrentLanguage(Lang.en);
/// ```
library;

export 'i18n_keyless_core.dart';
export 'src/flutter/context_extension.dart';
export 'src/flutter/scope.dart';
export 'src/flutter/t.dart';
export 'src/storage/shared_preferences_storage.dart';
