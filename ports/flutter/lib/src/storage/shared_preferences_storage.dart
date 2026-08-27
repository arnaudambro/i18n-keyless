import 'package:shared_preferences/shared_preferences.dart';

import '../core/storage.dart';

/// An [I18nKeylessStorage] on top of `shared_preferences`, the storage to use on a
/// device so translations survive a restart.
///
/// ```dart
/// await i18n.init(I18nKeylessConfig(
///   apiKey: '...',
///   languages: LanguagesConfig(primary: Lang.fr, supported: [Lang.fr, Lang.en]),
///   storage: SharedPreferencesStorage(),
/// ));
/// ```
///
/// A large project can exceed a platform's preferences comfort zone; split it with
/// namespaces (each namespace is one entry) or write your own adapter on a file or a
/// database. Three async methods are all an adapter needs.
class SharedPreferencesStorage implements I18nKeylessStorage {
  SharedPreferencesStorage([SharedPreferencesAsync? preferences])
      : _preferences = preferences ?? SharedPreferencesAsync();

  final SharedPreferencesAsync _preferences;

  @override
  Future<String?> getItem(String key) => _preferences.getString(key);

  @override
  Future<void> setItem(String key, String value) =>
      _preferences.setString(key, value);

  @override
  Future<void> removeItem(String key) => _preferences.remove(key);
}
