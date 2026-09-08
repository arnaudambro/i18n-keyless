/// The precompiled bundle (docs/PROTOCOL.md, sections 4.5 and 7.4): dictionaries exported
/// at build time (`GET /translate/bundle`, or the MCP `export_bundle` tool) and shipped
/// with the app as assets, one file per (namespace, language) plus `manifest.json`. At
/// boot and on a language switch a covered dictionary is seeded from the file instead of
/// fetched, with the bundle's cursor, so the only network traffic left is a miss.
///
/// The pure functions here are replayed by `conformance/vectors/bundle-seed.json`.
library;

import 'dart:async';

import 'langs.dart';
import 'types.dart';

/// One namespace of the manifest: its cursor and the languages that have a file.
class BundleNamespace {
  const BundleNamespace({required this.lastRefresh, required this.languages});

  factory BundleNamespace.fromJson(Map<String, dynamic> json) =>
      BundleNamespace(
        lastRefresh: json['lastRefresh']?.toString() ?? '',
        languages: (json['languages'] as List?)
                ?.map((code) => code.toString())
                .toList() ??
            const [],
      );

  /// The export time, epoch ms as a string: the delta cursor seeded with the file.
  final String lastRefresh;

  /// The language codes that have a `<namespace>/<lang>.json` file.
  final List<String> languages;
}

/// `manifest.json`: the bundle without its dictionaries.
///
/// ```json
/// { "primaryLanguage": "fr", "languages": ["en", "fr"], "exportedAt": "1757000000000",
///   "namespaces": { "default": { "lastRefresh": "1757000000000", "languages": ["en", "fr"] } } }
/// ```
class BundleManifest {
  const BundleManifest({
    required this.primaryLanguage,
    required this.languages,
    required this.exportedAt,
    required this.namespaces,
  });

  factory BundleManifest.fromJson(Map<String, dynamic> json) {
    final rawNamespaces = json['namespaces'];
    return BundleManifest(
      primaryLanguage: json['primaryLanguage']?.toString() ?? '',
      languages: (json['languages'] as List?)
              ?.map((code) => code.toString())
              .toList() ??
          const [],
      exportedAt: json['exportedAt']?.toString() ?? '',
      namespaces: {
        if (rawNamespaces is Map)
          for (final entry in rawNamespaces.entries)
            if (entry.value is Map)
              entry.key.toString(): BundleNamespace.fromJson(
                  (entry.value as Map).cast<String, dynamic>()),
      },
    );
  }

  final String primaryLanguage;
  final List<String> languages;
  final String exportedAt;

  /// Per namespace, in manifest order.
  final Map<String, BundleNamespace> namespaces;
}

/// Reads one file of the bundle: the dictionary of `<namespace>/<lang>.json`, or `null`
/// when the app has no such file. Called only for a pair the manifest covers.
typedef BundleLoader = FutureOr<Translations?> Function(
    String namespace, Lang lang);

/// The bundle handed to [I18nKeylessConfig.bundle]: the parsed manifest and a loader.
///
/// The files are app assets, so the SDK takes a loader, not a path. In a Flutter app,
/// `loadI18nKeylessBundleFromAssets('assets/i18n-keyless')` (from `i18n_keyless.dart`)
/// builds one on `rootBundle`; in pure Dart, hand your own loader:
///
/// ```dart
/// I18nKeylessBundle(
///   manifest: BundleManifest.fromJson(jsonDecode(manifestText)),
///   load: (namespace, lang) async =>
///       (jsonDecode(await readFile('$namespace/${lang.code}.json')) as Map).cast(),
/// )
/// ```
class I18nKeylessBundle {
  const I18nKeylessBundle({required this.manifest, required this.load});

  final BundleManifest manifest;
  final BundleLoader load;
}

/// The seed of one namespace: a dictionary and the cursor that goes with it.
class BundleSeed {
  const BundleSeed({required this.translations, required this.lastRefresh});

  final Translations translations;
  final String? lastRefresh;
}

/// What storage holds for one namespace: its slice, its cursor, and the language it is in.
class StoredSeed {
  const StoredSeed({
    required this.translations,
    required this.lastRefresh,
    required this.lang,
  });

  final Translations translations;
  final String? lastRefresh;
  final String lang;
}

/// True when the manifest lists [lang] under [namespace].
bool bundleCovers(BundleManifest? manifest, String namespace, String lang) {
  final entry = manifest?.namespaces[namespace];
  return entry != null && entry.languages.contains(lang);
}

/// The namespaces the manifest lists, in manifest order.
List<String> bundleNamespaces(BundleManifest? manifest) =>
    manifest == null ? const [] : manifest.namespaces.keys.toList();

/// The precedence between the bundle and what storage holds for the same namespace.
///
/// The bundle is the base. Storage wins only when it is strictly newer (its cursor is a
/// larger number than the bundle's) AND it is in the language being seeded: a device that
/// fetched after a human review keeps the reviewed text, and a slice left by another
/// language is never mixed in. A storage cursor that is empty or not a number is never
/// newer.
BundleSeed mergeBundleWithStorage(
    BundleSeed bundle, StoredSeed? stored, String lang) {
  if (stored == null || stored.lang != lang) return bundle;
  final storedRaw = stored.lastRefresh;
  if (storedRaw == null || storedRaw.isEmpty) return bundle;
  final storedCursor = num.tryParse(storedRaw);
  final bundleCursor = num.tryParse(bundle.lastRefresh ?? '');
  if (storedCursor == null || !storedCursor.isFinite) return bundle;
  // A bundle cursor that is not a number reads as NaN in JavaScript: nothing is greater.
  if (bundleCursor == null || !(storedCursor > bundleCursor)) return bundle;
  return BundleSeed(
    translations: {...bundle.translations, ...stored.translations},
    lastRefresh: storedRaw,
  );
}

/// Loads one covered dictionary from the bundle. `null` when the manifest does not cover
/// the pair, when the loader yields nothing, or when it throws (a missing file at runtime
/// is a miss like any other: the caller falls back to the fetch).
Future<BundleSeed?> loadBundleSeed(
  I18nKeylessBundle? bundle,
  String namespace,
  Lang lang, {
  void Function(String message)? log,
}) async {
  if (bundle == null || !bundleCovers(bundle.manifest, namespace, lang.code)) {
    return null;
  }
  try {
    final translations = await bundle.load(namespace, lang);
    if (translations == null) return null;
    return BundleSeed(
      translations: translations,
      lastRefresh: bundle.manifest.namespaces[namespace]!.lastRefresh,
    );
  } catch (error) {
    log?.call('bundle.load failed for $namespace ${lang.code}: $error');
    return null;
  }
}
