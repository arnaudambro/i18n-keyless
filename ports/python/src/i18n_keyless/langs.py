"""The 48 language codes of protocol v3, locale resolution and the App Store slots.

A port of ``AVAILABLE_LANGS``, ``resolveLang`` and ``toAppStoreLocale`` from
``i18n-keyless-core`` (``packages/core/types.ts``), replayed against
``conformance/vectors/languages.json``, ``resolve-lang.json`` and ``app-store-locales.json``.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

#: The 48 languages i18n-keyless translates into, as the API spells them (v3), in the
#: reference order. Any of them can be a project's primary language.
AVAILABLE_LANGS: Tuple[str, ...] = (
    "ar", "bn", "ca", "zh-Hans", "zh-Hant", "hr", "cs", "da", "nl", "en", "en-GB", "fi",
    "fr", "fr-CA", "de", "el", "gu", "he", "hi", "hu", "id", "it", "ja", "kn", "ko", "ms",
    "ml", "mr", "no", "or", "pl", "pt", "pt-BR", "pa", "ro", "ru", "sk", "sl", "es", "es-MX",
    "sv", "ta", "te", "th", "tr", "uk", "ur", "vi",
)  # fmt: skip

#: The App Store Connect listing slot of each code. Not a wire concern: a convenience every
#: SDK ships identically, so an app can upload its store listing in every language.
APP_STORE_LOCALES: Dict[str, str] = {
    "ar": "ar-SA", "bn": "bn", "ca": "ca", "zh-Hans": "zh-Hans", "zh-Hant": "zh-Hant",
    "hr": "hr", "cs": "cs", "da": "da", "nl": "nl-NL", "en": "en-US", "en-GB": "en-GB",
    "fi": "fi", "fr": "fr-FR", "fr-CA": "fr-CA", "de": "de-DE", "el": "el", "gu": "gu",
    "he": "he", "hi": "hi", "hu": "hu", "id": "id", "it": "it", "ja": "ja", "kn": "kn",
    "ko": "ko", "ms": "ms", "ml": "ml", "mr": "mr", "no": "no", "or": "or", "pl": "pl",
    "pt": "pt-PT", "pt-BR": "pt-BR", "pa": "pa", "ro": "ro", "ru": "ru", "sk": "sk",
    "sl": "sl", "es": "es-ES", "es-MX": "es-MX", "sv": "sv", "ta": "ta", "te": "te",
    "th": "th", "tr": "tr", "uk": "uk", "ur": "ur", "vi": "vi",
}  # fmt: skip

# Chinese is selected by script, not by region, and a region does not name its script, so
# the common region tags are spelled out. Anything else under `zh` is Simplified.
_CHINESE_SCRIPTS: Dict[str, str] = {
    "cn": "zh-Hans", "sg": "zh-Hans", "hans": "zh-Hans",
    "tw": "zh-Hant", "hk": "zh-Hant", "mo": "zh-Hant", "hant": "zh-Hant",
}  # fmt: skip

_BY_LOWERCASE: Dict[str, str] = {lang.lower(): lang for lang in AVAILABLE_LANGS}
_LANGS = frozenset(AVAILABLE_LANGS)


def is_lang(code: object) -> bool:
    """Whether ``code`` is one of the 48 v3 codes (``cn`` and ``cz`` are not)."""
    return isinstance(code, str) and code in _LANGS


def _candidates(tag: Optional[str]) -> List[str]:
    """The codes a tag may stand for, most specific first, without duplicates."""
    if tag is None:
        return []
    normalized = tag.replace("_", "-").strip().lower()
    if not normalized:
        return []
    parts = normalized.split("-")
    language, last = parts[0], parts[-1]
    found: List[str] = []

    def push(lang: Optional[str]) -> None:
        if lang and lang not in found:
            found.append(lang)

    # 1. the tag as written ("pt-BR", "zh-Hans")
    push(_BY_LOWERCASE.get(normalized))
    # 2. Chinese resolves by script and never falls back to a bare language
    if language == "zh":
        push(_CHINESE_SCRIPTS.get(last, "zh-Hans"))
        return found
    # 3. the UN M49 code for Latin America is what the es-MX slot really covers
    if normalized == "es-419":
        push("es-MX")
    # 4. the bare language ("pt-AO" -> "pt")
    push(_BY_LOWERCASE.get(language))
    return found


def resolve_lang(
    tag: Optional[str],
    *,
    supported: Optional[Sequence[str]] = None,
    fallback: Optional[str] = None,
) -> Optional[str]:
    """Map a BCP-47 style tag (``pt_BR``, ``zh-TW``, ``en-US``) onto a supported code.

    The first candidate present in ``supported`` (when given) wins, else ``fallback``, else
    ``None``: never a guess. Use it to turn an ``Accept-Language`` value or a user setting
    into the language passed to :func:`i18n_keyless.t`.
    """
    for candidate in _candidates(tag):
        if supported is None or candidate in supported:
            return candidate
    return fallback


def to_app_store_locale(lang: str) -> str:
    """``to_app_store_locale("fr")`` is ``"fr-FR"``: the App Store Connect slot of a code."""
    return APP_STORE_LOCALES[lang]
