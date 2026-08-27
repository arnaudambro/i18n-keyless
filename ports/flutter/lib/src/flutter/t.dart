import 'package:flutter/widgets.dart';

import '../core/langs.dart';
import '../core/types.dart';
import 'resolve.dart';
import 'scope.dart';

/// A [Text] whose content is translated: `T('Bonjour')`.
///
/// Renders the source text at once, then the translation as soon as it lands in the
/// cache or the language changes. Every [Text] layout parameter is accepted.
///
/// ```dart
/// T('Bonjour {name}', replace: {'{name}': user.name}, style: theme.textTheme.titleLarge)
/// T('8 heures', context: 'durée')
/// ```
class T extends StatelessWidget {
  const T(
    this.text, {
    super.key,
    this.context,
    this.namespace,
    this.replace,
    this.unpersistedNamespace = false,
    this.forceTemporary,
    this.originLanguage,
    this.debug = false,
    this.style,
    this.strutStyle,
    this.textAlign,
    this.textDirection,
    this.locale,
    this.softWrap,
    this.overflow,
    this.textScaler,
    this.maxLines,
    this.semanticsLabel,
    this.textWidthBasis,
    this.textHeightBehavior,
    this.selectionColor,
  });

  /// The text in the primary language. Leading and trailing whitespace is trimmed.
  final String text;

  /// Disambiguates meaning ("8 heures": a clock time or a duration).
  final String? context;

  /// A fetch/storage partition.
  final String? namespace;

  /// Placeholders to replace, delimiters included: `{'{name}': user.name}`.
  final Map<String, String>? replace;
  final bool unpersistedNamespace;

  /// Your own translation per language.
  final Map<Lang, String>? forceTemporary;

  /// For user generated content: the language [text] is written in.
  final Lang? originLanguage;
  final bool debug;

  final TextStyle? style;
  final StrutStyle? strutStyle;
  final TextAlign? textAlign;
  final TextDirection? textDirection;
  final Locale? locale;
  final bool? softWrap;
  final TextOverflow? overflow;
  final TextScaler? textScaler;
  final int? maxLines;
  final String? semanticsLabel;
  final TextWidthBasis? textWidthBasis;
  final TextHeightBehavior? textHeightBehavior;
  final Color? selectionColor;

  TranslationOptions get options => TranslationOptions(
        context: context,
        namespace: namespace,
        replace: replace,
        unpersistedNamespace: unpersistedNamespace,
        forceTemporary: forceTemporary,
        originLanguage: originLanguage,
        debug: debug,
      );

  @override
  Widget build(BuildContext buildContext) {
    final client = I18nKeyless.of(buildContext);
    return Text(
      resolveText(client, text, options),
      style: style,
      strutStyle: strutStyle,
      textAlign: textAlign,
      textDirection: textDirection,
      locale: locale,
      softWrap: softWrap,
      overflow: overflow,
      textScaler: textScaler,
      maxLines: maxLines,
      semanticsLabel: semanticsLabel,
      textWidthBasis: textWidthBasis,
      textHeightBehavior: textHeightBehavior,
      selectionColor: selectionColor,
    );
  }
}
