"""i18n-keyless for Python: keyless translations for a server, a script or a build step.

Write the source string where a key would go and let the API translate it once, for every
language::

    import i18n_keyless as i18n

    i18n.init(api_key="...", primary="en", supported=["en", "fr", "es"])
    i18n.t("Welcome to our app", "fr")                      # "Bienvenue dans notre application"
    i18n.t("8 hours", "fr", context="duration")             # one string, two meanings
    i18n.t("Hello {{name}}", "es", replace={"{{name}}": "Ada"})

The module-level functions drive one shared :class:`I18nKeyless` instance; build your own
for several projects in one process. The wire protocol is ``docs/PROTOCOL.md`` of the
i18n-keyless repository; this port sends ``sdk: python`` (a server label: no device id,
usage analytics like the node SDK) and ``Version: 3.6.1``.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Sequence

from .client import (
    CONCURRENCY,
    USAGE_FLUSH_MS,
    Config,
    I18nKeyless,
    Lookup,
    Miss,
    NotInitialized,
    TranslationError,
)
from .http import DEFAULT_API_URL, MAX_ATTEMPTS, RETRY_DELAYS_MS, SDK, TIMEOUT_MS, ApiClient
from .langs import APP_STORE_LOCALES, AVAILABLE_LANGS, is_lang, resolve_lang, to_app_store_locale
from .text import (
    DEFAULT_NAMESPACE,
    apply_replace,
    queue_id_for,
    resolve_namespace,
    resolve_origin_language,
    storage_key_for,
)
from .version import __version__

__all__ = [
    "APP_STORE_LOCALES",
    "AVAILABLE_LANGS",
    "CONCURRENCY",
    "DEFAULT_API_URL",
    "DEFAULT_NAMESPACE",
    "MAX_ATTEMPTS",
    "RETRY_DELAYS_MS",
    "SDK",
    "TIMEOUT_MS",
    "USAGE_FLUSH_MS",
    "ApiClient",
    "Config",
    "I18nKeyless",
    "Lookup",
    "Miss",
    "NotInitialized",
    "TranslationError",
    "__version__",
    "apply_replace",
    "client",
    "flush_usage",
    "get_supported_languages",
    "init",
    "is_lang",
    "queue_id_for",
    "reset",
    "resolve_lang",
    "resolve_namespace",
    "resolve_origin_language",
    "storage_key_for",
    "t",
    "t_or_raise",
    "to_app_store_locale",
    "wait_idle",
]

#: The shared instance the module-level functions drive.
client = I18nKeyless()


def init(config: Optional[Config] = None, **fields: Any) -> Config:
    """Configure the shared client and load its translations. Once, at process start.

    Pass a :class:`Config`, or its fields as keyword arguments::

        init(api_key="...", primary="en", supported=["en", "fr"])
    """
    if config is None:
        config = Config(**fields)
    elif fields:
        raise TypeError("i18n-keyless: pass a Config or keyword fields, not both")
    return client.init(config)


def t(
    key: str,
    lang: str,
    *,
    context: Optional[str] = None,
    namespace: Optional[str] = None,
    replace: Optional[Mapping[str, str]] = None,
    force_temporary: Optional[Mapping[str, str]] = None,
    origin_language: Optional[str] = None,
    unpersisted_namespace: bool = False,
    debug: bool = False,
) -> str:
    """Translate ``key`` into ``lang``. Never raises: a failure returns the source text."""
    return client.t(
        key,
        lang,
        context=context,
        namespace=namespace,
        replace=replace,
        force_temporary=force_temporary,
        origin_language=origin_language,
        unpersisted_namespace=unpersisted_namespace,
        debug=debug,
    )


def t_or_raise(
    key: str,
    lang: str,
    *,
    context: Optional[str] = None,
    namespace: Optional[str] = None,
    replace: Optional[Mapping[str, str]] = None,
    force_temporary: Optional[Mapping[str, str]] = None,
    origin_language: Optional[str] = None,
    unpersisted_namespace: bool = False,
    debug: bool = False,
) -> str:
    """Translate ``key`` into ``lang``. A failed request raises :class:`TranslationError`."""
    return client.t_or_raise(
        key,
        lang,
        context=context,
        namespace=namespace,
        replace=replace,
        force_temporary=force_temporary,
        origin_language=origin_language,
        unpersisted_namespace=unpersisted_namespace,
        debug=debug,
    )


def flush_usage() -> Optional[Dict[str, Any]]:
    """Send the usage analytics now. Call it before a script exits."""
    return client.flush_usage()


def wait_idle(timeout: Optional[float] = None) -> None:
    """Wait for the background refetch that follows a batch of misses."""
    client.wait_idle(timeout)


def get_supported_languages() -> Sequence[str]:
    return client.get_supported_languages()


def reset() -> None:
    """Forget everything. For tests."""
    client.reset()
