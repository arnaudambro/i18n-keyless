package io.i18nkeyless

/**
 * Every language i18n-keyless can translate into: the App Store localizations collapsed
 * onto bare language codes, plus the variants that are a different translation
 * (`zh-Hans` / `zh-Hant`, `pt-BR`, `es-MX`, `fr-CA`, `en-GB`).
 *
 * The wire format is [code] (`fr`, `pt-BR`, `zh-Hans`): exactly the strings the JavaScript
 * SDKs send in v3. [appStoreLocale] is the App Store Connect listing slot. The entries are
 * in the order of the JavaScript `AVAILABLE_LANGS` array.
 */
enum class Lang(val code: String, val appStoreLocale: String) {
    AR("ar", "ar-SA"),
    BN("bn", "bn"),
    CA("ca", "ca"),
    ZH_HANS("zh-Hans", "zh-Hans"),
    ZH_HANT("zh-Hant", "zh-Hant"),
    HR("hr", "hr"),
    CS("cs", "cs"),
    DA("da", "da"),
    NL("nl", "nl-NL"),
    EN("en", "en-US"),
    EN_GB("en-GB", "en-GB"),
    FI("fi", "fi"),
    FR("fr", "fr-FR"),
    FR_CA("fr-CA", "fr-CA"),
    DE("de", "de-DE"),
    EL("el", "el"),
    GU("gu", "gu"),
    HE("he", "he"),
    HI("hi", "hi"),
    HU("hu", "hu"),
    ID("id", "id"),
    IT("it", "it"),
    JA("ja", "ja"),
    KN("kn", "kn"),
    KO("ko", "ko"),
    MS("ms", "ms"),
    ML("ml", "ml"),
    MR("mr", "mr"),
    NO("no", "no"),
    OR("or", "or"),
    PL("pl", "pl"),
    PT("pt", "pt-PT"),
    PT_BR("pt-BR", "pt-BR"),
    PA("pa", "pa"),
    RO("ro", "ro"),
    RU("ru", "ru"),
    SK("sk", "sk"),
    SL("sl", "sl"),
    ES("es", "es-ES"),
    ES_MX("es-MX", "es-MX"),
    SV("sv", "sv"),
    TA("ta", "ta"),
    TE("te", "te"),
    TH("th", "th"),
    TR("tr", "tr"),
    UK("uk", "uk"),
    UR("ur", "ur"),
    VI("vi", "vi");

    override fun toString(): String = code

    companion object {
        private val byLowercase: Map<String, Lang> = entries.associateBy { it.code.lowercase() }

        /**
         * The [Lang] whose [code] equals [code], case-insensitive, or `null`.
         *
         * An exact match on the 48 codes. To map any BCP-47 tag (`fr-CH`, `zh_TW`, `es-419`)
         * onto a supported language, use [resolveLang].
         */
        fun fromCode(code: String?): Lang? = code?.let { byLowercase[it.trim().lowercase()] }
    }
}

/** The 48 supported languages, in the reference order. */
val AVAILABLE_LANGS: List<Lang> = Lang.entries

/** The 48 supported codes (`ar`, `bn`, ..., `vi`), same order as [AVAILABLE_LANGS]. */
val AVAILABLE_LANG_CODES: List<String> = AVAILABLE_LANGS.map { it.code }

/** The App Store Connect locale shortcode: `toAppStoreLocale(Lang.FR)` is `fr-FR`. */
fun toAppStoreLocale(lang: Lang): String = lang.appStoreLocale

/** Chinese is selected by script, not by region, so the common region tags are spelled out. */
private val chineseRegionScripts = mapOf(
    "cn" to Lang.ZH_HANS,
    "sg" to Lang.ZH_HANS,
    "hans" to Lang.ZH_HANS,
    "tw" to Lang.ZH_HANT,
    "hk" to Lang.ZH_HANT,
    "mo" to Lang.ZH_HANT,
    "hant" to Lang.ZH_HANT,
)

/**
 * Resolves any BCP-47 locale tag (`Locale.getDefault().toLanguageTag()`, an
 * `Accept-Language` entry) onto a supported [Lang], most specific match first:
 *
 * ```
 * resolveLang("pt-BR")   // Lang.PT_BR   exact variant
 * resolveLang("pt-AO")   // Lang.PT      no Angolan variant: the bare language
 * resolveLang("zh-TW")   // Lang.ZH_HANT
 * resolveLang("zh_CN")   // Lang.ZH_HANS underscores are accepted
 * resolveLang("es-419")  // Lang.ES_MX   Latin America
 * resolveLang("xx")      // null
 * ```
 *
 * Pass [supported] to only ever get a language you ship: a `pt-BR` device on an app that
 * only ships `pt` gets `pt`, and [fallback] answers when nothing matches.
 */
fun resolveLang(tag: String?, supported: Iterable<Lang>? = null, fallback: Lang? = null): Lang? {
    val usable = supported?.toSet()
    for (candidate in langCandidates(tag)) {
        if (usable == null || candidate in usable) return candidate
    }
    return fallback
}

private fun langCandidates(tag: String?): List<Lang> {
    if (tag == null) return emptyList()
    val normalized = tag.replace('_', '-').trim().lowercase()
    if (normalized.isEmpty()) return emptyList()
    val parts = normalized.split('-')
    val language = parts.first()
    val region = parts.last()
    val candidates = ArrayList<Lang>()
    fun push(lang: Lang?) {
        if (lang != null && lang !in candidates) candidates.add(lang)
    }

    // 1. the tag as written ("pt-BR", "zh-Hans")
    push(Lang.fromCode(normalized))

    // 2. Chinese resolves by script and never falls back to a bare language
    if (language == "zh") {
        push(chineseRegionScripts[region] ?: Lang.ZH_HANS)
        return candidates
    }

    // 3. UN M49 code for Latin America, which is what the es-MX slot covers
    if (normalized == "es-419") push(Lang.ES_MX)

    // 4. the bare language ("pt-AO" -> "pt")
    push(Lang.fromCode(language))
    return candidates
}
