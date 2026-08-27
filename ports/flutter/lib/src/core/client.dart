import 'dart:async';
import 'dart:convert';

import 'api.dart';
import 'langs.dart';
import 'pqueue.dart';
import 'storage.dart';
import 'types.dart';
import 'unique_id.dart';
import 'version.dart';

/// The storage key of a translation: `"key__context"` when a context is given, the key
/// itself otherwise (an empty context counts as none, like the JavaScript SDKs).
String storageKeyFor(String key, String? context) =>
    context != null && context.isNotEmpty ? '${key}__$context' : key;

final RegExp _regexSpecials = RegExp(r'[.*+?^${}()|[\]\\]');

String _escapeRegex(String value) =>
    value.replaceAllMapped(_regexSpecials, (match) => '\\${match[0]}');

/// Replaces every placeholder of [replace] in [text] in one pass. Regex-special
/// characters in the placeholders are escaped, so `{name}`, `$price` or `(x)` all work.
/// An empty replacement keeps the placeholder, like the JavaScript SDKs.
String applyReplace(String text, Map<String, String>? replace) {
  if (replace == null || replace.isEmpty) return text;
  final pattern = replace.keys.map(_escapeRegex).join('|');
  return text.replaceAllMapped(RegExp(pattern), (match) {
    final matched = match[0]!;
    final replacement = replace[matched];
    return replacement == null || replacement.isEmpty ? matched : replacement;
  });
}

/// The effective namespace of a call: the per-call [TranslationOptions.namespace], else
/// the config `defaultNamespace`, else the literal `default`. Empty strings fall through.
String resolveNamespace(TranslationOptions? options, String? configDefault) {
  final namespace = options?.namespace;
  if (namespace != null && namespace.isNotEmpty) return namespace;
  if (configDefault != null && configDefault.isNotEmpty) return configDefault;
  return defaultNamespace;
}

/// The origin language of a UGC key: the per-call [TranslationOptions.originLanguage]
/// when it exists and differs from [primary], `null` otherwise (regular flow).
Lang? resolveOriginLanguage(TranslationOptions? options, Lang primary) {
  final origin = options?.originLanguage;
  if (origin == null || origin == primary) return null;
  return origin;
}

/// The id of a translate task in the queue: `namespace:key`. The context and the origin
/// language are not part of it (protocol section 15, item 1).
String queueIdFor(String namespace, String key) => '$namespace:$key';

/// The in-memory ETag map key of one dictionary: `apiKey|lang|namespace`.
String etagCacheKey(String apiKey, String lang, [String? namespace]) =>
    '$apiKey|$lang|${namespace == null || namespace.isEmpty ? defaultNamespace : namespace}';

/// The URL of `GET /translate/:lang` (protocol section 4.2). Without an ETag the delta
/// cursor travels as `last_refresh=` (a null cursor is written literally as `null`, an
/// empty one as empty); with an ETag the cursor leaves the URL. The default namespace
/// never appears; another namespace is URL-encoded.
String buildDictionaryUrl({
  required String apiUrl,
  required String lang,
  String? lastRefresh,
  String? namespace,
  String? etag,
}) {
  final namespaceQuery =
      namespace != null && namespace.isNotEmpty && namespace != defaultNamespace
          ? '&namespace=${Uri.encodeComponent(namespace)}'
          : '';
  final String query;
  if (etag != null) {
    query = namespaceQuery.isEmpty ? '' : '?${namespaceQuery.substring(1)}';
  } else {
    query = '?last_refresh=${lastRefresh ?? 'null'}$namespaceQuery';
  }
  return '$apiUrl/translate/$lang$query';
}

/// The translation engine: a pure-Dart port of `i18n-keyless-core` plus the store of
/// `i18n-keyless-react`, with no Flutter import.
///
/// ```dart
/// final i18n = I18nKeylessClient();
/// await i18n.init(I18nKeylessConfig(
///   apiKey: 'YOUR_API_KEY',
///   languages: LanguagesConfig(primary: Lang.fr, supported: [Lang.fr, Lang.en]),
///   storage: SharedPreferencesStorage(),
/// ));
/// i18n.getTranslation('Bonjour'); // 'Bonjour' now, 'Hello' once it lands
/// ```
///
/// Lookups are synchronous. A miss is queued for translation (30 concurrent requests,
/// one per key), and when the queue drains the dictionary of the current language is
/// fetched in bulk and merged into the cache. Every change goes out on [changes] and to
/// [addListener] listeners. Nothing here ever throws on a network error, and a stored
/// translation is never cleared by a failed request.
class I18nKeylessClient {
  I18nKeylessClient({PQueue? queue, I18nKeylessApi? api})
      : _queue = queue ?? PQueue(concurrency: 30),
        _injectedApi = api {
    _queue.onEmpty(_onQueueEmpty);
  }

  final PQueue _queue;
  final I18nKeylessApi? _injectedApi;
  I18nKeylessApi? _api;
  I18nKeylessConfig? _config;
  I18nKeylessStorage _storage = MemoryStorage();

  late Lang _primary;
  late List<Lang> _supported;
  late Lang _fallback;
  late Lang _initWithDefault;
  Lang _currentLanguage = Lang.en;

  String? _uniqueId;
  String? _lastRefresh;
  final Map<String, String> _translations = {};
  final Map<String, Map<String, String>> _translationsByNamespace = {};
  final List<String> _namespaces = [];
  final Set<String> _unpersistedNamespaces = {};
  final Map<String, String> _lastRefreshByNamespace = {};
  final Map<String, Map<String, String>> _usageByNamespace = {};
  final List<String> _originNamespaces = [];

  /// Namespaces that had a miss since the last bulk fetch, mapped to `unpersisted`.
  final Map<String, bool> _namespacesToFetch = {};

  /// Keys in flight on `POST /translate`.
  final Set<String> _translating = {};

  /// Misses already queued for the current language, cleared when their namespace's
  /// bulk fetch lands: a rebuild of the same widget does not re-request the same key.
  final Set<String> _requestedMisses = {};

  /// ETags of the dictionaries fetched this session, keyed by `apiKey|lang|namespace`.
  final Map<String, String> _etags = {};

  Completer<void>? _readyGate;
  final Set<Future<void>> _inFlight = {};
  final List<void Function()> _listeners = [];
  final StreamController<void> _changes = StreamController<void>.broadcast();
  bool _usageWriteScheduled = false;
  bool _disposed = false;

  // ---------------------------------------------------------------------------
  // Public state

  bool get isInitialized => _config != null;

  I18nKeylessConfig get config {
    final config = _config;
    if (config == null) {
      throw StateError('i18n-keyless: config is not initialized. Call init().');
    }
    return config;
  }

  Lang get currentLanguage => _currentLanguage;

  Lang get primaryLanguage => _primary;

  List<Lang> get supportedLanguages => List.unmodifiable(_supported);

  /// The flat translation map of the current language, merged across namespaces.
  Map<String, String> get translations => Map.unmodifiable(_translations);

  String? get uniqueId => _uniqueId;

  /// The delta cursor of the default namespace, as last returned by the API.
  String? get lastRefresh => _lastRefresh;

  /// The ETags remembered this session, keyed by [etagCacheKey]. In memory only.
  Map<String, String> get dictionaryEtags => Map.unmodifiable(_etags);

  /// Seeds the ETag of one dictionary, so the next fetch revalidates with
  /// `If-None-Match` instead of downloading. For tests and custom transports.
  void seedEtag(String etag, {required Lang lang, String? namespace}) {
    _etags[etagCacheKey(config.apiKey, lang.code, namespace)] = etag;
  }

  /// The namespaces that had a miss since the last bulk fetch, mapped to their
  /// `unpersisted` flag. Diagnostic: the queue's empty handler drains it.
  Map<String, bool> get namespacesAwaitingFetch =>
      Map.unmodifiable(_namespacesToFetch);

  /// Fires after every change of the language or of the translations.
  Stream<void> get changes => _changes.stream;

  void addListener(void Function() listener) => _listeners.add(listener);

  void removeListener(void Function() listener) => _listeners.remove(listener);

  // ---------------------------------------------------------------------------
  // Init

  /// Validates [config], hydrates the cache from storage, then starts the bulk fetch
  /// of the current language and the usage POST in the background. Returns once the
  /// cache is hydrated: the app can render at once with the stored translations. Use
  /// [waitForIdle] to also wait for the network.
  Future<void> init(I18nKeylessConfig config) async {
    if (config.languages.supported.isEmpty) {
      throw ArgumentError(
          'i18n-keyless: languages.supported must not be empty');
    }
    if (config.apiKey.isEmpty) {
      throw ArgumentError(
        'i18n-keyless: apiKey is required. Get a key at https://i18n-keyless.com',
      );
    }
    _config = config;
    _storage = config.storage ?? MemoryStorage();
    _api = _injectedApi ?? I18nKeylessApi(client: config.httpClient);

    final languages = config.languages;
    _primary = languages.primary;
    _initWithDefault = languages.initWithDefault ?? _primary;
    _fallback = languages.fallback ?? _primary;
    _supported = List.of(languages.supported);
    if (!_supported.contains(_initWithDefault)) {
      _supported.add(_initWithDefault);
    }
    if (!_supported.contains(_primary)) _supported.add(_primary);
    _currentLanguage = _initWithDefault;

    // Close the boot race: hold every request until the device id is known, so no
    // request goes out unidentified (the API bills each of those as a new user).
    // Released in `finally` so a failed hydration can never deadlock the queue.
    _readyGate = Completer<void>();
    try {
      await _hydrate();
    } finally {
      _readyGate?.complete();
      _readyGate = null;
    }
    config.onInit?.call(_currentLanguage);
    _track(_setLanguage(_currentLanguage));
    if (config.sendUsage) _track(_sendUsage());
  }

  Future<String?> _read(String key) async {
    try {
      final value = await _storage.getItem(key);
      return value == null || value.isEmpty ? null : value;
    } catch (error) {
      _log('Error getting item $key: $error');
      return null;
    }
  }

  Future<dynamic> _readJson(String key) async {
    final raw = await _read(key);
    if (raw == null) return null;
    try {
      return jsonDecode(raw);
    } catch (error) {
      _log('Error parsing item $key: $error');
      return null;
    }
  }

  // No `Future(...)` here: it schedules a zero-length Timer, which a widget test's
  // fake clock reports as pending. An async closure starts synchronously instead.
  void _write(String key, String value) {
    Future<void> run() async => _storage.setItem(key, value);
    _track(run());
  }

  void _remove(String key) {
    Future<void> run() async => _storage.removeItem(key);
    _track(run());
  }

  Future<void> _hydrate() async {
    final debug = config.debug;
    // The device id, FIRST, before any other storage read.
    final storedUniqueId = await _read(StorageKeys.uniqueId);
    final uniqueId =
        isUniqueId(storedUniqueId) ? storedUniqueId! : generateUniqueId();
    _uniqueId = uniqueId;
    if (uniqueId != storedUniqueId) _write(StorageKeys.uniqueId, uniqueId);
    if (debug) _log('hydrate: uniqueId $uniqueId');

    // The namespaces index. With no index, the legacy default key is still read.
    final storedNamespaces = await _readJson(StorageKeys.namespaces);
    final namespacesToLoad =
        storedNamespaces is List && storedNamespaces.isNotEmpty
            ? storedNamespaces.map((namespace) => namespace.toString()).toList()
            : [defaultNamespace];
    final cursors = <String, String>{};
    for (final namespace in namespacesToLoad) {
      final slice = await _readJson(StorageKeys.translationsKeyFor(namespace));
      if (slice is Map) {
        final translations = <String, String>{
          for (final entry in slice.entries)
            if (entry.value is String)
              entry.key.toString(): entry.value as String,
        };
        _translationsByNamespace[namespace] = translations;
        _translations.addAll(translations);
        if (!_namespaces.contains(namespace)) _namespaces.add(namespace);
      }
      final lastRefresh = await _read(StorageKeys.lastRefreshKeyFor(namespace));
      if (lastRefresh != null) cursors[namespace] = lastRefresh;
    }
    // Cursors count only when at least one slice was found (reference behaviour).
    if (_namespaces.isNotEmpty) _lastRefreshByNamespace.addAll(cursors);
    if (debug) _log('hydrate: ${_translations.length} translations');

    final storedOriginNamespaces =
        await _readJson(StorageKeys.originNamespaces);
    if (storedOriginNamespaces is List) {
      _originNamespaces.addAll(storedOriginNamespaces.map((n) => n.toString()));
    }

    // Usage is keyed by namespace (values are maps). A legacy flat map is discarded.
    final storedUsage = await _readJson(StorageKeys.translationsUsage);
    if (storedUsage is Map) {
      final namespaced =
          storedUsage.values.isEmpty || storedUsage.values.first is Map;
      if (namespaced) {
        for (final entry in storedUsage.entries) {
          final bucket = entry.value;
          if (bucket is Map) {
            _usageByNamespace[entry.key.toString()] = {
              for (final usage in bucket.entries)
                usage.key.toString(): usage.value.toString(),
            };
          }
        }
      } else if (debug) {
        _log('hydrate: discarding legacy flat usage');
      }
    }

    if (config.languages.skipCurrentLanguageHydration) {
      _currentLanguage = _initWithDefault;
    } else {
      final storedLanguage =
          Lang.fromCode(await _read(StorageKeys.currentLanguage));
      _currentLanguage = storedLanguage ?? _initWithDefault;
    }
    if (debug) _log('hydrate: currentLanguage $_currentLanguage');
    _lastRefresh = await _read(StorageKeys.lastRefresh);
  }

  // ---------------------------------------------------------------------------
  // Lookup

  /// The translation of [text] in the current language, or [text] itself when it is
  /// not there yet (the miss is queued; listen to [changes] for the update). Never
  /// throws, never blocks. Before [init], returns [text] with [replace] applied.
  String getTranslation(
    String text, {
    String? context,
    String? namespace,
    Map<String, String>? replace,
    bool unpersistedNamespace = false,
    bool debug = false,
    Map<Lang, String>? forceTemporary,
    Lang? originLanguage,
  }) =>
      translate(
        text,
        TranslationOptions(
          context: context,
          namespace: namespace,
          replace: replace,
          unpersistedNamespace: unpersistedNamespace,
          debug: debug,
          forceTemporary: forceTemporary,
          originLanguage: originLanguage,
        ),
      );

  /// [getTranslation] with a [TranslationOptions] object.
  String translate(
    String text, [
    TranslationOptions options = const TranslationOptions(),
  ]) {
    if (!isInitialized) return applyReplace(text, options.replace);
    final storageKey = storageKeyFor(text, options.context);
    if (config.sendUsage) {
      _recordUsage(storageKey, options);
      if (_resolveOriginLanguage(options) != null) {
        _registerOriginNamespace(
          _resolveNamespace(options),
          options.unpersistedNamespace,
        );
      }
    }
    // The language the text is already written in: the primary language, except for
    // UGC (originLanguage). A UGC key needs a lookup even in the primary language.
    final sourceLanguage = _resolveOriginLanguage(options) ?? _primary;
    String? translation = text;
    if (_currentLanguage != sourceLanguage) {
      if (options.forceTemporary?[_currentLanguage] != null) {
        _translateKey(text, options);
      }
      translation = _translations[storageKey];
      if (translation == null || translation.isEmpty) {
        _translateKey(text, options);
      }
    }
    if (options.debug) {
      _log('translate "$text" ($_currentLanguage): ${translation ?? text}');
    }
    final resolved =
        translation == null || translation.isEmpty ? text : translation;
    return applyReplace(resolved, options.replace);
  }

  String _resolveNamespace(TranslationOptions options) =>
      resolveNamespace(options, config.defaultNamespace);

  Lang? _resolveOriginLanguage(TranslationOptions options) =>
      resolveOriginLanguage(options, _primary);

  // ---------------------------------------------------------------------------
  // Translate on miss

  void _translateKey(String key, TranslationOptions options) {
    if (key.isEmpty) return;
    final namespace = _resolveNamespace(options);
    final storageKey = storageKeyFor(key, options.context);
    final forced = options.forceTemporary?[_currentLanguage] != null;
    final existing = _translations[storageKey];
    if (existing != null && existing.isNotEmpty && !forced) return;

    final missId = '${_currentLanguage.code}|$namespace|$storageKey';
    if (_requestedMisses.contains(missId)) return;
    _requestedMisses.add(missId);

    // Remember this namespace so the queue's empty handler bulk-fetches it, and only it.
    _namespacesToFetch[namespace] = options.unpersistedNamespace;
    // Dedupe per namespace so the same text can be queued under two namespaces.
    final queueId = queueIdFor(namespace, key);
    if (options.debug) {
      _log('translateKey "$key" (${options.context}) [$namespace]');
    }
    _track(_queue.add(() async {
      if (_translating.contains(queueId)) return;
      _translating.add(queueId);
      try {
        final handler = config.handleTranslate;
        if (handler != null) {
          final result = await handler(key);
          if (result.message.isNotEmpty) _log(result.message);
          return;
        }
        // Wait for the device id before the first request of a session can leave.
        await _whenReady();
        final body = <String, dynamic>{
          'key': key,
          if (options.context != null) 'context': options.context,
          // Omit the default namespace so the wire format is unchanged for projects
          // that do not use namespaces.
          if (namespace != defaultNamespace) 'namespace': namespace,
          if (options.forceTemporary != null)
            'forceTemporary': {
              for (final entry in options.forceTemporary!.entries)
                entry.key.code: entry.value,
            },
          'languages': _supported.map((lang) => lang.code).toList(),
          'primaryLanguage': _primary.code,
          if (_resolveOriginLanguage(options) != null)
            'originLanguage': _resolveOriginLanguage(options)!.code,
        };
        final result = await _api!.post(
          Uri.parse('${_apiUrl()}/translate'),
          headers: _headers(),
          body: body,
        );
        if (options.debug) _log('translate response: ${result.json}');
        if (!result.ok && result.error.isNotEmpty) {
          _log('Error translating key "$key": ${result.error}');
        }
        if (result.message.isNotEmpty) _log(result.message);
      } catch (error) {
        _log('Error translating key: $error');
      } finally {
        _translating.remove(queueId);
      }
    }, priority: 1, id: queueId));
  }

  void _onQueueEmpty() {
    if (_config == null || _disposed) return;
    final batch = Map.of(_namespacesToFetch);
    _namespacesToFetch.clear();
    for (final entry in batch.entries) {
      final namespace = entry.key;
      final unpersisted = entry.value;
      _track(_fetchLanguage(
        _currentLanguage,
        namespace,
        lastRefresh: _lastRefreshByNamespace[namespace],
      ).then((response) {
        _requestedMisses.removeWhere(
            (id) => id.startsWith('${_currentLanguage.code}|$namespace|'));
        _setTranslations(response, namespace, unpersisted: unpersisted);
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk fetch

  Future<TranslationsResponse?> _fetchLanguage(
    Lang lang,
    String namespace, {
    String? lastRefresh,
  }) async {
    final custom = config.getAllTranslations;
    if (custom != null) {
      try {
        return await custom();
      } catch (error) {
        _log('fetch all translations error: $error');
        return null;
      }
    }
    final etagKey = etagCacheKey(config.apiKey, lang.code, namespace);
    final etag = _etags[etagKey];
    // With an ETag in hand, freshness travels in If-None-Match and last_refresh leaves
    // the URL, which becomes stable so shared HTTP caches can hold it.
    final url = Uri.parse(buildDictionaryUrl(
      apiUrl: _apiUrl(),
      lang: lang.code,
      lastRefresh: lastRefresh,
      namespace: namespace,
      etag: etag,
    ));
    await _whenReady();
    final result = await _api!.get(url, headers: {
      ..._headers(),
      if (etag != null) 'If-None-Match': etag,
    });
    if (result.notModified) {
      if (config.debug) _log('fetch $lang [$namespace]: not modified');
      return const TranslationsResponse.notModified();
    }
    if (!result.ok || result.json == null) {
      _log('fetch all translations error: ${result.error}');
      return null;
    }
    // `result.ok` is the body's `ok`, so the parsed response is always ok here.
    final response =
        TranslationsResponse.fromJson(result.json!, etag: result.etag);
    if (response.etag != null) _etags[etagKey] = response.etag!;
    if (response.message.isNotEmpty) _log(response.message);
    return response;
  }

  void _setTranslations(
    TranslationsResponse? response,
    String namespace, {
    bool unpersisted = false,
  }) {
    if (response == null || !response.ok || response.notModified) return;
    final incoming = response.translations;
    var changed = false;
    for (final entry in incoming.entries) {
      if (_translations[entry.key] != entry.value) changed = true;
    }
    _translations.addAll(incoming);
    final slice = _translationsByNamespace.putIfAbsent(namespace, () => {});
    slice.addAll(incoming);
    final isNewNamespace = !_namespaces.contains(namespace);
    if (isNewNamespace) _namespaces.add(namespace);
    if (unpersisted) _unpersistedNamespaces.add(namespace);

    // Adopt the id the server echoed back only when this device has none: the header
    // we send is authoritative, and a new id is a new billed "user".
    if (_uniqueId == null && isUniqueId(response.uniqueId)) {
      _uniqueId = response.uniqueId;
      _write(StorageKeys.uniqueId, response.uniqueId!);
    }

    // An empty cursor is not a cursor (JavaScript truthiness).
    final lastRefresh =
        response.lastRefresh?.isNotEmpty == true ? response.lastRefresh : null;
    if (unpersisted) {
      if (lastRefresh != null) {
        _lastRefresh = lastRefresh;
        _lastRefreshByNamespace[namespace] = lastRefresh;
      }
      if (changed) _notify();
      return;
    }

    _write(StorageKeys.translationsKeyFor(namespace), jsonEncode(slice));
    if (isNewNamespace) {
      final persisted = _namespaces
          .where((n) => !_unpersistedNamespaces.contains(n))
          .toList();
      _write(StorageKeys.namespaces, jsonEncode(persisted));
    }
    if (lastRefresh != null) {
      _lastRefresh = lastRefresh;
      _lastRefreshByNamespace[namespace] = lastRefresh;
      _write(StorageKeys.lastRefreshKeyFor(namespace), lastRefresh);
    }
    if (changed) _notify();
  }

  // ---------------------------------------------------------------------------
  // Language

  /// Switches the language. An unsupported language falls back to
  /// [LanguagesConfig.fallback]. Listeners are notified at once (cached translations
  /// show immediately), and the returned future completes when the dictionary of the
  /// new language has been fetched.
  Future<void> setCurrentLanguage(Lang lang) {
    config.onSetLanguage?.call(lang);
    return _track(_setLanguage(lang));
  }

  Future<void> _setLanguage(Lang lang) async {
    final validated = _supported.contains(lang) ? lang : _fallback;
    if (config.debug && validated != lang) {
      _log('language $lang is not supported, fallback to $validated');
    }
    _currentLanguage = validated;
    // Every delta cursor is stale after a language change: reset them all and refetch
    // the full set of each known namespace.
    final known =
        _namespaces.isNotEmpty ? List.of(_namespaces) : [defaultNamespace];
    _lastRefresh = null;
    _lastRefreshByNamespace.clear();
    _requestedMisses.clear();
    _write(StorageKeys.currentLanguage, validated.code);
    for (final namespace in known) {
      if (!_unpersistedNamespaces.contains(namespace)) {
        _write(StorageKeys.lastRefreshKeyFor(namespace), '');
      }
    }
    _notify();

    List<String> toFetch;
    if (validated != _primary) {
      toFetch = known;
    } else if (_originNamespaces.isNotEmpty) {
      // The primary language still needs fetched data for the namespaces holding UGC
      // keys: their primary version is an AI translation, not the key itself.
      toFetch = List.of(_originNamespaces);
    } else {
      return;
    }
    await Future.wait(toFetch.map((namespace) =>
        _fetchLanguage(validated, namespace)
            .then((response) => _setTranslations(
                  response,
                  namespace,
                  unpersisted: _unpersistedNamespaces.contains(namespace),
                ))));
  }

  // ---------------------------------------------------------------------------
  // Usage analytics

  void _recordUsage(String storageKey, TranslationOptions options) {
    // Transient namespaces do not report usage: they would flood the prune signal.
    if (options.unpersistedNamespace) return;
    final namespace = _resolveNamespace(options);
    final today = DateTime.now().toUtc().toIso8601String().split('T').first;
    final bucket = _usageByNamespace.putIfAbsent(namespace, () => {});
    if (bucket[storageKey] == today) return;
    bucket[storageKey] = today;
    _scheduleUsageWrite();
  }

  void _scheduleUsageWrite() {
    if (_usageWriteScheduled) return;
    _usageWriteScheduled = true;
    scheduleMicrotask(() {
      _usageWriteScheduled = false;
      if (_disposed) return;
      _write(StorageKeys.translationsUsage, jsonEncode(_usageByNamespace));
    });
  }

  void _registerOriginNamespace(String namespace, bool unpersisted) {
    if (_originNamespaces.contains(namespace)) return;
    _originNamespaces.add(namespace);
    if (!unpersisted) {
      final persisted = _originNamespaces
          .where((n) => !_unpersistedNamespaces.contains(n))
          .toList();
      _write(StorageKeys.originNamespaces, jsonEncode(persisted));
    }
  }

  Future<void> _sendUsage() async {
    if (_usageByNamespace.isEmpty) return;
    final usage = {
      for (final entry in _usageByNamespace.entries)
        entry.key: Map<String, String>.of(entry.value),
    };
    bool ok;
    String message;
    try {
      final custom = config.sendTranslationsUsage;
      if (custom != null) {
        final response = await custom(usage[defaultNamespace] ?? {});
        ok = response.ok;
        message = response.message;
      } else {
        await _whenReady();
        final result = await _api!.post(
          Uri.parse('${_apiUrl()}/translate/last-used-translations'),
          headers: _headers(),
          body: {
            'primaryLanguage': _primary.code,
            'translationsUsageByNamespace': usage,
          },
        );
        ok = result.ok;
        message = result.ok ? result.message : result.error;
      }
    } catch (error) {
      _log('send translations usage error: $error');
      return;
    }
    if (message.isNotEmpty) _log(message);
    if (ok) {
      _usageByNamespace.clear();
      _write(StorageKeys.translationsUsage, '');
    }
  }

  // ---------------------------------------------------------------------------
  // Housekeeping

  /// Completes when no request, storage write or fetch is pending. For tests, and for
  /// a splash screen that wants the first dictionary before showing the app.
  Future<void> waitForIdle() async {
    while (!_queue.isIdle || _inFlight.isNotEmpty || _usageWriteScheduled) {
      await _queue.whenIdle();
      await Future.wait(List.of(_inFlight));
      await Future<void>.delayed(Duration.zero);
    }
  }

  /// Removes every cached translation, cursor and usage record from storage and from
  /// memory. The device id and the config are kept: the id identifies the install, and
  /// wiping it would bill one more "user" at the next launch.
  Future<void> clearStorageAndStore() async {
    for (final namespace in List.of(_namespaces)) {
      _remove(StorageKeys.translationsKeyFor(namespace));
      _remove(StorageKeys.lastRefreshKeyFor(namespace));
    }
    for (final key in StorageKeys.all) {
      if (key != StorageKeys.uniqueId) _remove(key);
    }
    _translations.clear();
    _translationsByNamespace.clear();
    _namespaces.clear();
    _unpersistedNamespaces.clear();
    _lastRefreshByNamespace.clear();
    _lastRefresh = null;
    _usageByNamespace.clear();
    _originNamespaces.clear();
    _requestedMisses.clear();
    _etags.clear();
    _notify();
    await waitForIdle();
  }

  void dispose() {
    _disposed = true;
    _queue.offEmpty(_onQueueEmpty);
    _listeners.clear();
    _changes.close();
    if (_injectedApi == null) _api?.close();
  }

  Future<void> _whenReady() async {
    final gate = _readyGate;
    if (gate != null) await gate.future;
  }

  String _apiUrl() {
    final url = config.apiUrl;
    if (url == null || url.isEmpty) return defaultApiUrl;
    return url.endsWith('/') ? url.substring(0, url.length - 1) : url;
  }

  Map<String, String> _headers() => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${config.apiKey}',
        'Version': i18nKeylessVersion,
        'sdk': i18nKeylessSdkRuntime,
        // Never empty: an empty header means "one brand-new user" to the API.
        'unique_id': _uniqueId ??= generateUniqueId(),
      };

  Future<void> _track(Future<void> future) {
    final tracked = future.catchError((Object error) {
      _log('$error');
    });
    _inFlight.add(tracked);
    tracked.whenComplete(() => _inFlight.remove(tracked));
    return tracked;
  }

  void _notify() {
    if (_disposed) return;
    for (final listener in List.of(_listeners)) {
      listener();
    }
    _changes.add(null);
  }

  void _log(String message) {
    final logger = _config?.logger;
    if (logger != null) {
      logger('i18n-keyless: $message');
    } else {
      // ignore: avoid_print
      print('i18n-keyless: $message');
    }
  }
}
