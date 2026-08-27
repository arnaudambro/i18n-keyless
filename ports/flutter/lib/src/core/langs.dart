/// Every language i18n-keyless can translate into: the 50 App Store localizations
/// collapsed onto bare language codes, plus the handful of variants that are a
/// different translation (`zh-Hans` / `zh-Hant`, `pt-BR`, `es-MX`, `fr-CA`, `en-GB`).
///
/// The wire format is the [code] (`fr`, `pt-BR`, `zh-Hans`), exactly the strings the
/// JavaScript SDKs send in v3. [appStoreLocale] is the App Store Connect listing slot.
enum Lang {
  ar('ar', 'ar-SA'),
  bn('bn', 'bn'),
  ca('ca', 'ca'),
  zhHans('zh-Hans', 'zh-Hans'),
  zhHant('zh-Hant', 'zh-Hant'),
  hr('hr', 'hr'),
  cs('cs', 'cs'),
  da('da', 'da'),
  nl('nl', 'nl-NL'),
  en('en', 'en-US'),
  enGB('en-GB', 'en-GB'),
  fi('fi', 'fi'),
  fr('fr', 'fr-FR'),
  frCA('fr-CA', 'fr-CA'),
  de('de', 'de-DE'),
  el('el', 'el'),
  gu('gu', 'gu'),
  he('he', 'he'),
  hi('hi', 'hi'),
  hu('hu', 'hu'),
  id('id', 'id'),
  it('it', 'it'),
  ja('ja', 'ja'),
  kn('kn', 'kn'),
  ko('ko', 'ko'),
  ms('ms', 'ms'),
  ml('ml', 'ml'),
  mr('mr', 'mr'),
  no('no', 'no'),
  or('or', 'or'),
  pl('pl', 'pl'),
  pt('pt', 'pt-PT'),
  ptBR('pt-BR', 'pt-BR'),
  pa('pa', 'pa'),
  ro('ro', 'ro'),
  ru('ru', 'ru'),
  sk('sk', 'sk'),
  sl('sl', 'sl'),
  es('es', 'es-ES'),
  esMX('es-MX', 'es-MX'),
  sv('sv', 'sv'),
  ta('ta', 'ta'),
  te('te', 'te'),
  th('th', 'th'),
  tr('tr', 'tr'),
  uk('uk', 'uk'),
  ur('ur', 'ur'),
  vi('vi', 'vi');

  const Lang(this.code, this.appStoreLocale);

  /// The v3 wire code (`fr`, `pt-BR`, `zh-Hans`).
  final String code;

  /// The App Store Connect locale shortcode for this language.
  final String appStoreLocale;

  /// The [Lang] whose [code] equals [code], case-insensitive, or `null`.
  ///
  /// This is an exact match on the 48 codes. To map any BCP-47 tag (`fr-CH`, `zh_TW`,
  /// `es-419`) onto a supported language, use [resolveLang].
  static Lang? fromCode(String? code) {
    if (code == null) return null;
    return _byLowercase[code.trim().toLowerCase()];
  }

  @override
  String toString() => code;
}

/// The 48 supported languages, in the order of the JavaScript `AVAILABLE_LANGS` array.
const List<Lang> availableLangs = Lang.values;

/// The 48 supported codes (`ar`, `bn`, ..., `vi`), same order as [availableLangs].
final List<String> availableLangCodes =
    List.unmodifiable(Lang.values.map((lang) => lang.code));

final Map<String, Lang> _byLowercase = {
  for (final lang in Lang.values) lang.code.toLowerCase(): lang,
};

/// The App Store Connect locale shortcode for a [Lang]: `toAppStoreLocale(Lang.fr)`
/// is `fr-FR`, `toAppStoreLocale(Lang.pt)` is `pt-PT`.
String toAppStoreLocale(Lang lang) => lang.appStoreLocale;

/// Chinese is selected by script, not by region, so the common region tags are spelled
/// out.
const Map<String, Lang> _chineseRegionScripts = {
  'cn': Lang.zhHans,
  'sg': Lang.zhHans,
  'hans': Lang.zhHans,
  'tw': Lang.zhHant,
  'hk': Lang.zhHant,
  'mo': Lang.zhHant,
  'hant': Lang.zhHant,
};

/// Resolves any BCP-47 locale tag (`Platform.localeName`, `Localizations.localeOf`,
/// an `Accept-Language` entry) onto a supported [Lang], most specific match first:
///
/// ```dart
/// resolveLang('pt-BR');  // Lang.ptBR   exact variant
/// resolveLang('pt-AO');  // Lang.pt     no Angolan variant: the bare language
/// resolveLang('zh-TW');  // Lang.zhHant
/// resolveLang('zh_CN');  // Lang.zhHans underscores are accepted
/// resolveLang('es-419'); // Lang.esMX   Latin America
/// resolveLang('xx');     // null
/// ```
///
/// Pass [supported] to only ever get a language you ship: a `pt-BR` device on an app
/// that only ships `pt` gets `pt`, and [fallback] answers when nothing matches.
Lang? resolveLang(
  String? tag, {
  Iterable<Lang>? supported,
  Lang? fallback,
}) {
  final usable = supported?.toSet();
  for (final candidate in _langCandidates(tag)) {
    if (usable == null || usable.contains(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

List<Lang> _langCandidates(String? tag) {
  if (tag == null) return const [];
  final normalized = tag.replaceAll('_', '-').trim().toLowerCase();
  if (normalized.isEmpty) return const [];
  final parts = normalized.split('-');
  final language = parts.first;
  final region = parts.last;
  final candidates = <Lang>[];
  void push(Lang? lang) {
    if (lang != null && !candidates.contains(lang)) candidates.add(lang);
  }

  // 1. the tag as written ("pt-BR", "zh-Hans")
  push(_byLowercase[normalized]);

  // 2. Chinese resolves by script and never falls back to a bare language
  if (language == 'zh') {
    push(_chineseRegionScripts[region] ?? Lang.zhHans);
    return candidates;
  }

  // 3. UN M49 code for Latin America, which is what the es-MX slot covers
  if (normalized == 'es-419') push(Lang.esMX);

  // 4. the bare language ("pt-AO" -> "pt")
  push(_byLowercase[language]);
  return candidates;
}
