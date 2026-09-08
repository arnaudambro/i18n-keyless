import 'dart:convert';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;

import '../core/bundle.dart';
import '../core/langs.dart';

/// Builds an [I18nKeylessBundle] from the files of the precompiled bundle shipped as
/// Flutter assets: `<directory>/manifest.json` and one `<directory>/<namespace>/<lang>.json`
/// per dictionary (the output of the MCP `export_bundle` tool or of
/// `GET /translate/bundle`). Declare the directory in `pubspec.yaml`:
///
/// ```yaml
/// flutter:
///   assets:
///     - assets/i18n-keyless/
///     - assets/i18n-keyless/default/
/// ```
///
/// ```dart
/// final bundle = await loadI18nKeylessBundleFromAssets('assets/i18n-keyless');
/// await i18n.init(I18nKeylessConfig(..., bundle: bundle));
/// ```
///
/// Reads through [assetBundle] (`rootBundle` by default). A dictionary the manifest lists
/// but the assets lack is logged by the client and fetched as before.
Future<I18nKeylessBundle> loadI18nKeylessBundleFromAssets(
  String directory, {
  AssetBundle? assetBundle,
}) async {
  final assets = assetBundle ?? rootBundle;
  final root = directory.endsWith('/')
      ? directory.substring(0, directory.length - 1)
      : directory;
  final manifestText = await assets.loadString('$root/manifest.json');
  final manifest = BundleManifest.fromJson(
      (jsonDecode(manifestText) as Map).cast<String, dynamic>());
  return I18nKeylessBundle(
    manifest: manifest,
    load: (String namespace, Lang lang) async {
      final text = await assets.loadString('$root/$namespace/${lang.code}.json');
      final decoded = jsonDecode(text);
      if (decoded is! Map) return null;
      return {
        for (final entry in decoded.entries)
          if (entry.value is String) entry.key.toString(): entry.value as String,
      };
    },
  );
}
