"""The translation client: the node SDK's behaviour (PROTOCOL.md, section 13) in Python.

One in-memory store per (namespace, language), filled by ``GET /translate/`` at :meth:`I18nKeyless.init`,
a synchronous :meth:`I18nKeyless.t` that POSTs a missing key on the spot (at most 30 in
flight, concurrent misses of one key collapsed into one request), a bulk refetch of every
namespace that missed once the queue drains, and usage analytics flushed on a 10 s
debounce from a daemon thread.

A request handler calls :meth:`t`: it never raises and falls back to the source text. A
script or a build step calls :meth:`t_or_raise`: a failed request is an error there, not a
page in the wrong language.
"""

from __future__ import annotations

import copy
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Mapping, Optional, Sequence

from .http import (
    RETRY_DELAYS_MS,
    TIMEOUT_MS,
    ApiClient,
    Transport,
    etag_cache_key,
)
from .langs import AVAILABLE_LANGS
from .text import (
    DEFAULT_NAMESPACE,
    apply_replace,
    resolve_namespace,
    resolve_origin_language,
    storage_key_for,
)

log = logging.getLogger("i18n_keyless")

#: At most this many ``POST /translate`` in flight at once, process-wide (the SDK queue).
CONCURRENCY = 30
#: Usage is POSTed at most once per window, cumulative, like the node SDK.
USAGE_FLUSH_MS = 10_000

# What a `handle_translate` / `get_all_translations_for_all_languages` /
# `send_translations_usage` handler returns: the same envelopes the API sends.
Handler = Callable[..., Mapping[str, Any]]


class TranslationError(Exception):
    """A ``POST /translate`` that failed, raised by :meth:`I18nKeyless.t_or_raise` only.

    ``__cause__`` carries the underlying failure when there is one. :meth:`I18nKeyless.t`
    swallows it after logging and returns the source text instead.
    """


class NotInitialized(RuntimeError):
    """:meth:`I18nKeyless.t_or_raise` was called before :meth:`I18nKeyless.init`."""


@dataclass
class Config:
    """What :func:`i18n_keyless.init` takes. Only ``api_key``, ``primary`` and ``supported``
    are required in the common case.

    The three network modes, in priority order: a custom handler when given, else the
    self-hosted ``api_url``, else the official service. ``api_key`` is sent in every mode.
    """

    #: Your project's key: https://i18n-keyless.com/#get-api-key
    api_key: str = ""
    #: The language the source strings are written in (``en``, ``fr``, ``pt-BR``...).
    primary: str = ""
    #: Every language the app serves. A new string is translated into all of them at once,
    #: and the API stores the list as the project's languages.
    supported: Sequence[str] = ()
    #: A self-hosted backend or a proxy that speaks the wire format. No trailing slash.
    api_url: Optional[str] = None
    #: The namespace of every call that passes none. Absent means ``default``.
    default_namespace: Optional[str] = None
    #: Log every step at DEBUG level on the ``i18n_keyless`` logger.
    debug: bool = False
    #: Called once at init with the primary language.
    on_init: Optional[Callable[[str], None]] = None
    #: ``handle_translate(key)`` replaces ``POST /translate``. It receives the key only.
    handle_translate: Optional[Handler] = None
    #: ``get_all_translations_for_all_languages()`` replaces ``GET /translate/``.
    get_all_translations_for_all_languages: Optional[Handler] = None
    #: ``send_translations_usage(default_bucket)`` replaces the usage POST. It receives the
    #: ``default`` namespace's map only (or ``{}``), like the JavaScript SDKs call it.
    send_translations_usage: Optional[Handler] = None
    timeout_ms: int = TIMEOUT_MS
    retry_delays_ms: Sequence[int] = RETRY_DELAYS_MS
    concurrency: int = CONCURRENCY
    usage_flush_ms: int = USAGE_FLUSH_MS
    #: The HTTP transport. Tests script it; an app never needs to.
    transport: Optional[Transport] = None

    @property
    def languages(self) -> Dict[str, Any]:
        """The ``languages`` block as the JavaScript SDKs spell it."""
        return {"primary": self.primary, "supported": list(self.supported)}


@dataclass(frozen=True)
class Miss:
    """A key that must be sent to the API, and the namespace to refetch afterwards."""

    key: str
    context: Optional[str]
    storage_key: str
    namespace: str
    unpersisted: bool
    origin_language: Optional[str]
    force_temporary: Optional[Mapping[str, str]]


@dataclass(frozen=True)
class Lookup:
    """What the synchronous resolution returns now, before any request leaves."""

    #: The text to render now: the stored translation, or the key.
    text: str
    #: The translate request to make, or ``None`` on a hit.
    miss: Optional[Miss]


@dataclass
class _Pending:
    """One in-flight ``POST /translate`` shared by every concurrent miss of the same key."""

    done: threading.Event = field(default_factory=threading.Event)
    result: Dict[str, str] = field(default_factory=dict)
    error: Optional[BaseException] = None


def _today() -> str:
    """The UTC calendar date, ``YYYY-MM-DD``: the value of a usage entry."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _known_languages_only(translation: Any) -> Dict[str, str]:
    """The non-empty strings of a translation row, for the languages we know.

    The API returns the whole stored row. Its ``languages`` map is the authoritative
    per-language view (the flat top-level keys are the v2 shape, whose ``id`` is the numeric
    row id, not Indonesian): read from ``languages`` when it is there, and only from the
    flat keys when a custom handler or a mock answers the flat shape alone.
    """
    if not isinstance(translation, dict):
        return {}
    row = translation.get("languages")
    source = row if isinstance(row, dict) else translation
    return {lang: text for lang, text in source.items() if lang in AVAILABLE_LANGS and isinstance(text, str) and text}


class I18nKeyless:
    """A translation client. The module-level functions drive one shared instance."""

    def __init__(self) -> None:
        self._config: Optional[Config] = None
        self.api: Optional[ApiClient] = None
        self._lock = threading.RLock()
        #: namespace -> language -> storage key -> text. The namespace dimension is the one
        #: difference from the node store: the same source text may translate differently in
        #: two namespaces, and each namespace is fetched on its own.
        self._translations: Dict[str, Dict[str, Dict[str, str]]] = {}
        self._usage: Dict[str, Dict[str, str]] = {}
        self._etags: Dict[str, str] = {}
        self._in_flight: Dict[str, _Pending] = {}
        self._active_posts = 0
        self._namespaces_to_fetch: Dict[str, bool] = {}
        self._semaphore = threading.Semaphore(CONCURRENCY)
        self._usage_timer: Optional[threading.Timer] = None
        self._refetch_thread: Optional[threading.Thread] = None

    # -- configuration -----------------------------------------------------------------

    @property
    def config(self) -> Optional[Config]:
        return self._config

    def init(self, config: Config) -> Config:
        """Validate the config, then load every language of the default namespace.

        Blocks for one ``GET /translate/`` (10 s timeout, retried twice): call it once at
        process start, before the first request is served. A failed fetch is logged and the
        store starts empty: every string is then translated on its first miss.
        """
        if not config.primary:
            raise ValueError("i18n-keyless: primary is required")
        if not config.supported:
            raise ValueError("i18n-keyless: supported languages are required")
        if not (config.get_all_translations_for_all_languages and config.handle_translate):
            if not config.api_key and not config.api_url:
                raise ValueError(
                    "i18n-keyless: you didn't provide an api_key nor an api_url nor a handle_translate + "
                    "get_all_translations_for_all_languages function. You need to provide one of them to make i18n-keyless work"
                )
        with self._lock:
            self.reset()
            self._config = config
            self._semaphore = threading.Semaphore(config.concurrency)
            self.api = ApiClient(
                config.api_key,
                config.api_url,
                timeout_ms=config.timeout_ms,
                retry_delays_ms=config.retry_delays_ms,
                transport=config.transport,
            )
            self._translations = {}
        if config.on_init:
            config.on_init(config.primary)
        # The boot fetch targets the configured namespace, otherwise a project using
        # `default_namespace` boots with the (empty) default one and every key misses.
        self._refetch(config.default_namespace or DEFAULT_NAMESPACE)
        return config

    def reset(self) -> None:
        """Forget the config, the store, the usage and every timer. For tests and reloads."""
        with self._lock:
            if self._usage_timer is not None:
                self._usage_timer.cancel()
                self._usage_timer = None
            self._config = None
            self.api = None
            self._translations = {}
            self._usage = {}
            self._etags = {}
            self._in_flight = {}
            self._active_posts = 0
            self._namespaces_to_fetch = {}

    def get_supported_languages(self) -> Sequence[str]:
        return list(self._require_config().supported)

    def _require_config(self) -> Config:
        if self._config is None or self.api is None:
            raise NotInitialized("i18n-keyless: init() has not been called")
        return self._config

    # -- resolution ------------------------------------------------------------------

    def lookup(
        self,
        key: str,
        lang: str,
        *,
        context: Optional[str] = None,
        namespace: Optional[str] = None,
        force_temporary: Optional[Mapping[str, str]] = None,
        origin_language: Optional[str] = None,
        unpersisted_namespace: bool = False,
    ) -> Lookup:
        """The synchronous resolution of one text, with no request (PROTOCOL.md, section 5).

        Pure: it reads the store and says what to render now and whether a translate
        request must follow. :meth:`t` is this plus the request.
        """
        config = self._require_config()
        if not key:
            return Lookup("", None)
        resolved_namespace = resolve_namespace(namespace, config.default_namespace)
        origin = resolve_origin_language(origin_language, config.primary)
        storage_key = storage_key_for(key, context)
        # The language the key is already written in: the primary language, except for user
        # generated content. When the current language is that one, the key renders as-is:
        # no lookup and, above all, no request.
        source_language = origin or config.primary
        if lang == source_language:
            return Lookup(key, None)
        translation = self._translations.get(resolved_namespace, {}).get(lang, {}).get(storage_key) or ""
        forced = bool(force_temporary and force_temporary.get(lang))
        if translation and not forced:
            return Lookup(translation, None)
        miss = Miss(key, context or None, storage_key, resolved_namespace, unpersisted_namespace, origin, force_temporary)
        return Lookup(translation or key, miss)

    def t(
        self,
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
        """Translate ``key`` into ``lang``, translating it through the API on a miss.

        Never raises: before :meth:`init`, when the request fails, or when a custom handler
        raises, the source text (with ``replace`` applied) is returned and the failure is
        logged. Blocks for the request
        on a miss, so a page is complete when it is served: no flash of source text.
        """
        try:
            return self._resolve(
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
        except NotInitialized:
            log.warning("i18n-keyless: t() called before init(), returning the source text")
        except Exception as error:  # noqa: BLE001 (a request handler must never fail on a translation)
            log.error('i18n-keyless: translation failed for key "%s": %s', key, error)
        return apply_replace(key, replace)

    def t_or_raise(
        self,
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
        """Same as :meth:`t`, but a failed request raises :class:`TranslationError`.

        For a script or a build step, where the wrong language is worse than a crash.
        """
        return self._resolve(
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

    def _resolve(
        self,
        key: str,
        lang: str,
        *,
        context: Optional[str],
        namespace: Optional[str],
        replace: Optional[Mapping[str, str]],
        force_temporary: Optional[Mapping[str, str]],
        origin_language: Optional[str],
        unpersisted_namespace: bool,
        debug: bool,
    ) -> str:
        config = self._require_config()
        if not key:
            return ""
        verbose = debug or config.debug
        resolved_namespace = resolve_namespace(namespace, config.default_namespace)
        storage_key = storage_key_for(key, context)
        # Usage is recorded on every call, primary language included, so the API never
        # prunes a key that only ever renders in its source language. A transient
        # (unpersisted) namespace is never reported.
        if not unpersisted_namespace:
            self._record_usage(resolved_namespace, storage_key)
        lookup = self.lookup(
            key,
            lang,
            context=context,
            namespace=namespace,
            force_temporary=force_temporary,
            origin_language=origin_language,
            unpersisted_namespace=unpersisted_namespace,
        )
        if lookup.miss is None:
            if verbose:
                log.debug('i18n-keyless: "%s" resolved from the store in %s', storage_key, lang)
            return apply_replace(lookup.text, replace)
        if verbose:
            log.debug('i18n-keyless: "%s" missing in %s, translating now', storage_key, lang)
        translated = self._translate_now(lookup.miss)
        return apply_replace(translated.get(lang) or key, replace)

    # -- the translate-on-miss queue ---------------------------------------------------

    def _translate_now(self, miss: Miss) -> Dict[str, str]:
        """Send one miss, sharing the request with every concurrent miss of the same key.

        Returns the translation of every language the API answered, and caches it so the
        key never goes over the wire twice in the lifetime of the process. Raises
        :class:`TranslationError` when the request fails.
        """
        config = self._require_config()
        # Concurrent requests for the same key would otherwise fire N identical POSTs before
        # the first one comes back and fills the store. A `force_temporary` call carries a
        # caller-specific value and is never shared.
        dedup_key = f"{miss.namespace}:{miss.storage_key}:{miss.origin_language or ''}"
        can_dedup = miss.force_temporary is None
        with self._lock:
            pending = self._in_flight.get(dedup_key) if can_dedup else None
            owner = pending is None
            if owner:
                pending = _Pending()
                if can_dedup:
                    self._in_flight[dedup_key] = pending
                # Remember the namespace so the refetch that follows the batch fetches it,
                # and only it. Last write wins for the `unpersisted` flag, like core.
                self._namespaces_to_fetch[miss.namespace] = miss.unpersisted
                self._active_posts += 1
        assert pending is not None
        if not owner:
            pending.done.wait()
            if pending.error is not None:
                raise TranslationError(str(pending.error)) from pending.error
            return pending.result
        try:
            if config.handle_translate:
                response = config.handle_translate(miss.key)
                pending.result = self._cache_translation(miss.namespace, miss.storage_key, response)
            else:
                with self._semaphore:
                    pending.result = self._post(miss)
        except BaseException as error:
            pending.error = error
            raise
        finally:
            pending.done.set()
            with self._lock:
                if can_dedup:
                    self._in_flight.pop(dedup_key, None)
                self._active_posts -= 1
                drained = self._active_posts == 0 and bool(self._namespaces_to_fetch)
            if drained:
                self._schedule_refetch()
        return pending.result

    def _post(self, miss: Miss) -> Dict[str, str]:
        config = self._require_config()
        assert self.api is not None
        body: Dict[str, Any] = {
            "key": miss.key,
            "languages": list(config.supported),
            "primaryLanguage": config.primary,
        }
        if miss.context:
            body["context"] = miss.context
        # The default namespace is omitted so the wire format is unchanged for a project
        # that uses none; the API treats "no namespace" as the default.
        if miss.namespace != DEFAULT_NAMESPACE:
            body["namespace"] = miss.namespace
        if miss.force_temporary is not None:
            body["forceTemporary"] = dict(miss.force_temporary)
        if miss.origin_language:
            body["originLanguage"] = miss.origin_language
        response = self.api.translate(body)
        if not response.get("ok"):
            raise TranslationError(response.get("error") or f'i18n-keyless: API request failed for key "{miss.key}"')
        if response.get("message"):
            log.warning("i18n-keyless: %s", response["message"])
        return self._cache_translation(miss.namespace, miss.storage_key, response)

    def _cache_translation(self, namespace: str, storage_key: str, response: Any) -> Dict[str, str]:
        """Merge the languages of a translate answer into the store, and return them."""
        translation = _known_languages_only(response.get("data", {}).get("translation") if isinstance(response, dict) else None)
        with self._lock:
            bucket = self._translations.setdefault(namespace, {})
            for lang, text in translation.items():
                bucket.setdefault(lang, {})[storage_key] = text
        return translation

    # -- bulk fetch --------------------------------------------------------------------

    def _schedule_refetch(self) -> None:
        """Refetch the namespaces that missed, on a daemon thread, once the queue drained.

        The answer of ``POST /translate`` already fills the store; the refetch brings the
        cells the AI filled later and the edits made on the dashboard in the meantime.
        """
        with self._lock:
            if self._refetch_thread is not None and self._refetch_thread.is_alive():
                return
            self._refetch_thread = threading.Thread(target=self._drain_refetch, name="i18n-keyless-refetch", daemon=True)
            self._refetch_thread.start()

    def _drain_refetch(self) -> None:
        while True:
            with self._lock:
                if not self._namespaces_to_fetch or self._config is None:
                    return
                namespaces = list(self._namespaces_to_fetch)
                self._namespaces_to_fetch.clear()
            for namespace in namespaces:
                self._refetch(namespace)

    def _refetch(self, namespace: str) -> Optional[Dict[str, Any]]:
        """``GET /translate/`` for one namespace, every language at once, merged into the store."""
        config = self._require_config()
        assert self.api is not None
        etag_key = etag_cache_key(config.api_key, "all", namespace)
        etag = self._etags.get(etag_key)
        if config.get_all_translations_for_all_languages:
            response = config.get_all_translations_for_all_languages()
        else:
            response = self.api.fetch_dictionary(None, namespace, etag, last_refresh="")
        if response.get("notModified"):
            # Nothing changed server-side: keep the in-memory dictionaries as they are.
            return None
        if not response.get("ok"):
            log.error("i18n-keyless: fetch all translations error: %s", response.get("error"))
            return None
        if response.get("etag"):
            self._etags[etag_key] = response["etag"]
        if response.get("message"):
            log.warning("i18n-keyless: %s", response["message"])
        translations = response.get("data", {}).get("translations") or {}
        with self._lock:
            bucket = self._translations.setdefault(namespace, {})
            for lang, dictionary in translations.items():
                if lang in AVAILABLE_LANGS and isinstance(dictionary, dict):
                    # Merge rather than assign: new values win, keys are never removed.
                    bucket.setdefault(lang, {}).update(dictionary)
        return response

    def wait_idle(self, timeout: Optional[float] = None) -> None:
        """Block until the background refetch, if any, has finished. For tests and scripts."""
        thread = self._refetch_thread
        if thread is not None:
            thread.join(timeout)

    # -- usage analytics ---------------------------------------------------------------

    def _record_usage(self, namespace: str, storage_key: str) -> None:
        today = _today()
        with self._lock:
            bucket = self._usage.setdefault(namespace, {})
            if bucket.get(storage_key) == today:
                return
            bucket[storage_key] = today
            self._schedule_usage_flush()

    def _schedule_usage_flush(self) -> None:
        """One POST per window, not one per newly-seen key.

        A server rendering a page with hundreds of keys would otherwise POST the cumulative
        map once per key, which is what rate limits the process. The timer is a daemon
        thread: analytics never keep a script or a serverless function alive.
        """
        if self._usage_timer is not None:
            return
        config = self._require_config()
        self._usage_timer = threading.Timer(config.usage_flush_ms / 1000, self._usage_tick)
        self._usage_timer.daemon = True
        self._usage_timer.start()

    def _usage_tick(self) -> None:
        with self._lock:
            self._usage_timer = None
        self.flush_usage()

    def flush_usage(self) -> Optional[Dict[str, Any]]:
        """Send the usage map now, ahead of the debounce. Call it before a script exits.

        The map is cumulative and never cleared (the node rule). Returns the API answer, or
        ``None`` when nothing was sent.
        """
        with self._lock:
            if self._usage_timer is not None:
                self._usage_timer.cancel()
                self._usage_timer = None
            config = self._config
            if config is None or self.api is None or not self._usage:
                return None
            usage = copy.deepcopy(self._usage)
        if config.send_translations_usage:
            response = config.send_translations_usage(usage.get(DEFAULT_NAMESPACE, {}))
        elif not config.api_key:
            return None
        else:
            response = self.api.send_usage(config.primary, usage)
        if isinstance(response, dict) and response.get("message"):
            log.warning("i18n-keyless: %s", response["message"])
        if isinstance(response, dict) and not response.get("ok"):
            log.error("i18n-keyless: send translations usage error: %s", response.get("error"))
        return dict(response) if isinstance(response, dict) else None

    def pending_usage(self) -> Dict[str, Dict[str, str]]:
        """A copy of the usage map not yet confirmed by the API. For tests."""
        with self._lock:
            return copy.deepcopy(self._usage)

    def pending_namespaces(self) -> Dict[str, bool]:
        """The namespaces recorded for the next refetch, with their ``unpersisted`` flag."""
        with self._lock:
            return dict(self._namespaces_to_fetch)

    def translations(self, lang: str, namespace: str = DEFAULT_NAMESPACE) -> Dict[str, str]:
        """A copy of the dictionary held for one (namespace, language). For tests and debugging."""
        with self._lock:
            return dict(self._translations.get(namespace, {}).get(lang, {}))
