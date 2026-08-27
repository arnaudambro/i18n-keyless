/// The storage i18n-keyless persists its cache in: translations per namespace, delta
/// cursors, the current language, usage analytics and the device id.
///
/// Every method is async so any backend fits: `shared_preferences`, Hive, a file, a
/// database. [MemoryStorage] is the default when none is given (nothing survives a
/// restart, which is fine for a test or a server process).
abstract class I18nKeylessStorage {
  Future<String?> getItem(String key);
  Future<void> setItem(String key, String value);
  Future<void> removeItem(String key);
}

/// An in-memory [I18nKeylessStorage] backed by a map. The default storage.
class MemoryStorage implements I18nKeylessStorage {
  final Map<String, String> _map = {};

  /// A read-only view, for tests and debugging.
  Map<String, String> get entries => Map.unmodifiable(_map);

  @override
  Future<String?> getItem(String key) async => _map[key];

  @override
  Future<void> setItem(String key, String value) async => _map[key] = value;

  @override
  Future<void> removeItem(String key) async => _map.remove(key);

  void clear() => _map.clear();
}

/// The namespace used when none is provided. It reuses the legacy storage keys so the
/// key names are identical to the JavaScript SDKs.
const String defaultNamespace = 'default';

/// The storage keys, identical to `i18n-keyless-react`.
abstract final class StorageKeys {
  static const uniqueId = 'i18n-keyless-user-id';
  static const lastRefresh = 'i18n-keyless-last-refresh';
  static const translations = 'i18n-keyless-translations';
  static const currentLanguage = 'i18n-keyless-current-language';

  /// usage keyed by namespace: `{ "<namespace>": { "key__context": "YYYY-MM-DD" } }`
  static const translationsUsage = 'i18n-keyless-translations-usage';

  /// JSON array of the namespaces persisted, so hydration knows what to load.
  static const namespaces = 'i18n-keyless-namespaces';

  /// JSON array of the namespaces that hold origin-language (UGC) keys.
  static const originNamespaces = 'i18n-keyless-origin-namespaces';

  static const List<String> all = [
    uniqueId,
    lastRefresh,
    translations,
    currentLanguage,
    translationsUsage,
    namespaces,
    originNamespaces,
  ];

  /// The key holding the translations of one namespace. The default namespace reuses
  /// the legacy key; other namespaces get a `__<namespace>` suffix.
  static String translationsKeyFor(String namespace) =>
      namespace == defaultNamespace
          ? translations
          : '${translations}__$namespace';

  /// The key holding the delta cursor of one namespace.
  static String lastRefreshKeyFor(String namespace) =>
      namespace == defaultNamespace
          ? lastRefresh
          : '${lastRefresh}__$namespace';
}
