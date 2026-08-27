import 'package:flutter/widgets.dart';

import '../core/client.dart';
import '../core/langs.dart';
import '../core/types.dart';
import 'resolve.dart';
import 'scope.dart';

/// `context.t('Bonjour')`: the translated string, for a `hintText`, a `tooltip`, a
/// `SnackBar`, a string handed to another widget. Same options as [T].
///
/// The calling widget subscribes to the scope, so it rebuilds when the translation
/// lands or the language changes.
extension I18nKeylessBuildContext on BuildContext {
  /// The translation of [text] in the current language, or [text] until it lands.
  String t(
    String text, {
    String? context,
    String? namespace,
    Map<String, String>? replace,
    bool unpersistedNamespace = false,
    Map<Lang, String>? forceTemporary,
    Lang? originLanguage,
    bool debug = false,
  }) =>
      resolveText(
        I18nKeyless.of(this),
        text,
        TranslationOptions(
          context: context,
          namespace: namespace,
          replace: replace,
          unpersistedNamespace: unpersistedNamespace,
          forceTemporary: forceTemporary,
          originLanguage: originLanguage,
          debug: debug,
        ),
      );

  /// The client of the nearest [I18nKeylessScope]: `context.i18n.setCurrentLanguage(Lang.en)`.
  I18nKeylessClient get i18n => I18nKeyless.of(this);
}
