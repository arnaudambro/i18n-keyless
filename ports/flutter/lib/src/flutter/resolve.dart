import 'package:flutter/foundation.dart';

import '../core/client.dart';
import '../core/types.dart';

final Set<String> _warnedAboutWhitespace = {};

/// The whitespace rule of `<I18nKeylessText>`: the source text is trimmed before it
/// becomes the key, and a debug build warns once per text that carried leading or
/// trailing whitespace (it would otherwise change the key).
String resolveText(
  I18nKeylessClient client,
  String text,
  TranslationOptions options,
) {
  final sourceText = text.trim();
  assert(() {
    if (sourceText != text && _warnedAboutWhitespace.add(text)) {
      debugPrint(
        'i18n-keyless received text with leading/trailing whitespace: "$text". '
        'This may cause inconsistencies in translations. Consider trimming the text.',
      );
    }
    return true;
  }());
  return client.translate(sourceText, options);
}
