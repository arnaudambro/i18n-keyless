import 'package:http/http.dart' as http;

import 'langs.dart';
import 'storage.dart';

/// The translations for a language: `{ "un texte": "a text" }`. A key with a context is
/// stored as `"key__context"`.
typedef Translations = Map<String, String>;

/// Usage per key: `{ "un texte": "2025-06-23" }` (date of last use, `YYYY-MM-DD`).
typedef TranslationsUsage = Map<String, String>;

/// A custom `POST /translate` replacement: called with the source text on a miss.
typedef HandleTranslate = Future<HandleTranslateResult> Function(String key);

/// A custom `GET /translate/:lang` replacement: returns the whole dictionary of the
/// current language.
typedef GetAllTranslations = Future<TranslationsResponse> Function();

/// A custom `POST /translate/last-used-translations` replacement. It receives the
/// default-namespace usage bucket, like the JavaScript SDKs hand their custom handler.
typedef SendTranslationsUsage = Future<UsageResponse> Function(
  TranslationsUsage usage,
);

/// A log sink. Defaults to `print`.
typedef I18nKeylessLogger = void Function(String message);

/// What a [HandleTranslate] handler returns.
class HandleTranslateResult {
  const HandleTranslateResult({
    required this.ok,
    this.message = '',
    this.translation = const {},
  });

  final bool ok;
  final String message;

  /// The translation of the key per language code, when the handler has it.
  final Map<String, String> translation;
}

/// The answer of `POST /translate/last-used-translations`.
class UsageResponse {
  const UsageResponse({required this.ok, this.message = ''});

  final bool ok;
  final String message;
}

/// The answer of `GET /translate/:lang`: `{ ok, data: { translations, uniqueId,
/// lastRefresh }, error, message }`, plus the `ETag` header when the API sent one.
class TranslationsResponse {
  const TranslationsResponse({
    required this.ok,
    this.translations = const {},
    this.uniqueId,
    this.lastRefresh,
    this.error = '',
    this.message = '',
    this.etag,
    this.notModified = false,
  });

  /// The `304 Not Modified` answer: nothing changed, keep the stored dictionary.
  const TranslationsResponse.notModified() : this(ok: true, notModified: true);

  /// Parses the JSON body of a `200`.
  factory TranslationsResponse.fromJson(Map<String, dynamic> json,
      {String? etag}) {
    final data = json['data'];
    final rawTranslations =
        data is Map<String, dynamic> ? data['translations'] : null;
    final translations = <String, String>{};
    if (rawTranslations is Map) {
      for (final entry in rawTranslations.entries) {
        final value = entry.value;
        if (value is String) translations[entry.key.toString()] = value;
      }
    }
    return TranslationsResponse(
      ok: json['ok'] == true,
      translations: translations,
      uniqueId:
          data is Map<String, dynamic> ? data['uniqueId']?.toString() : null,
      lastRefresh:
          data is Map<String, dynamic> ? data['lastRefresh']?.toString() : null,
      error: json['error']?.toString() ?? '',
      message: json['message']?.toString() ?? '',
      etag: etag,
    );
  }

  final bool ok;
  final Translations translations;
  final String? uniqueId;
  final String? lastRefresh;
  final String error;
  final String message;

  /// ETag of this payload, replayed as `If-None-Match` on the next fetch.
  final String? etag;

  /// True when the API answered `304 Not Modified`.
  final bool notModified;
}

/// The languages of the project.
class LanguagesConfig {
  const LanguagesConfig({
    required this.primary,
    required this.supported,
    this.fallback,
    this.initWithDefault,
    this.skipCurrentLanguageHydration = false,
  });

  /// The language the source strings are written in.
  final Lang primary;

  /// The languages the user can switch to. [primary] and [initWithDefault] are added
  /// when missing.
  final List<Lang> supported;

  /// Used when [I18nKeylessClient.setCurrentLanguage] receives an unsupported language.
  /// Defaults to [primary].
  final Lang? fallback;

  /// The language of the first launch, before any stored choice. Defaults to [primary].
  final Lang? initWithDefault;

  /// When true, the stored language is ignored at boot and [initWithDefault] is used.
  /// Useful when the language comes from somewhere else (a deep link, an account).
  final bool skipCurrentLanguageHydration;
}

/// The options of one translation call. Every field is also a named parameter of
/// `getTranslation`, `T(...)` and `context.t(...)`.
class TranslationOptions {
  const TranslationOptions({
    this.context,
    this.namespace,
    this.unpersistedNamespace = false,
    this.debug = false,
    this.forceTemporary,
    this.replace,
    this.originLanguage,
  });

  /// Disambiguates meaning: "8 heures" as a clock time vs a duration. Stored as
  /// `"key__context"`.
  final String? context;

  /// A fetch/storage partition, not a semantic key. Defaults to
  /// [I18nKeylessConfig.defaultNamespace], then `"default"`.
  final String? namespace;

  /// When true, this namespace lives in memory only: never persisted, never reloaded.
  final bool unpersistedNamespace;

  /// Logs the resolution of this one string.
  final bool debug;

  /// Your own translation per language, when the AI one is not satisfactory.
  final Map<Lang, String>? forceTemporary;

  /// Placeholders to replace in the translated text. The keys include the delimiters:
  /// `{'{name}': user.name}`. Regex-special characters in keys are escaped.
  final Map<String, String>? replace;

  /// For user generated content: the language this text is written in when it is not
  /// the primary one.
  final Lang? originLanguage;
}

/// Everything [I18nKeylessClient.init] needs.
class I18nKeylessConfig {
  const I18nKeylessConfig({
    required this.apiKey,
    required this.languages,
    this.apiUrl,
    this.defaultNamespace,
    this.storage,
    this.sendUsage = true,
    this.debug = false,
    this.handleTranslate,
    this.getAllTranslations,
    this.sendTranslationsUsage,
    this.onInit,
    this.onSetLanguage,
    this.httpClient,
    this.logger,
  });

  /// The API key from https://i18n-keyless.com. Always required, even with custom
  /// handlers or a self-hosted [apiUrl] (protocol section 2.1).
  final String apiKey;

  /// A self-hosted backend. Defaults to `https://api.i18n-keyless.com`.
  final String? apiUrl;

  final LanguagesConfig languages;

  /// The namespace applied to every call that has none. Defaults to `"default"`.
  final String? defaultNamespace;

  /// Where the cache lives. Defaults to [MemoryStorage]; use
  /// `SharedPreferencesStorage` on a device.
  final I18nKeylessStorage? storage;

  /// When false, usage analytics are neither recorded nor sent (the equivalent of the
  /// JavaScript `ssr: true`). Translate-on-miss still works.
  final bool sendUsage;

  /// Logs every step.
  final bool debug;

  /// Custom handlers. When set, they replace the HTTP calls.
  final HandleTranslate? handleTranslate;
  final GetAllTranslations? getAllTranslations;
  final SendTranslationsUsage? sendTranslationsUsage;

  /// Called once hydration is done, with the language the app starts in.
  final void Function(Lang lang)? onInit;

  /// Called on every [I18nKeylessClient.setCurrentLanguage].
  final void Function(Lang lang)? onSetLanguage;

  /// The HTTP client. Inject a `MockClient` in tests.
  final http.Client? httpClient;

  /// Where logs go. Defaults to `print`.
  final I18nKeylessLogger? logger;
}
