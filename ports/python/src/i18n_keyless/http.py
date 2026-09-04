"""The HTTP layer: the four routes of the wire format and the network policy of the SDKs.

A port of ``packages/core/api.ts`` (``fetchWithRetry``) and of the request builders in
``packages/core/service.ts`` / ``packages/node/service.ts``: a per-attempt timeout, three
attempts with fixed backoff on a network error, a timeout, a 429, a 5xx or an unparsable
200 body; no retry on any other status; nothing ever raised out of :meth:`ApiClient.fetch`.
Replayed against ``conformance/vectors/backoff.json``, ``retry-decision.json``,
``translate-request.json``, ``dictionary-request.json``, ``dictionary-response.json`` and
``usage-request.json``.

The transport is a plain callable so the test suite scripts it without a network. The
default one is :func:`urllib_transport`, on the standard library only.
"""

from __future__ import annotations

import json
import logging
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Mapping, Optional, Sequence

from .text import DEFAULT_NAMESPACE
from .version import __version__

log = logging.getLogger("i18n_keyless")

#: The official service. ``api_url`` replaces it for a self-hosted backend or a proxy.
DEFAULT_API_URL = "https://api.i18n-keyless.com"

#: Per-attempt timeout. One call is bounded by ``MAX_ATTEMPTS * TIMEOUT_MS`` plus backoff.
TIMEOUT_MS = 10_000
#: Backoff before attempt 2 and attempt 3. Nothing is waited after the last attempt.
RETRY_DELAYS_MS: Sequence[int] = (500, 1500)
#: Total attempts for one call: the first try plus one per backoff delay.
MAX_ATTEMPTS = len(RETRY_DELAYS_MS) + 1

#: The ``sdk`` header. ``python`` is registered on the API as a server label, counted like
#: ``node``: a server sends no ``unique_id``, the API counts it by its source connection,
#: which the client cannot shape.
SDK = "python"

# The characters `encodeURIComponent` leaves alone, so a namespace travels byte for byte
# like the JavaScript SDKs send it.
_URI_COMPONENT_SAFE = "-_.!~*'()"


class NetworkError(Exception):
    """The transport could not get an HTTP answer (DNS, connection, reset...)."""


class RequestTimeout(NetworkError):
    """No answer within the per-attempt timeout. Reported as the error string ``timeout``."""


@dataclass
class HttpRequest:
    method: str
    url: str
    headers: Dict[str, str]
    body: Optional[bytes] = None


@dataclass
class HttpResponse:
    status: int
    reason: str
    headers: Dict[str, str] = field(default_factory=dict)
    body: bytes = b""

    def header(self, name: str) -> Optional[str]:
        return self.headers.get(name.lower())


#: ``transport(request, timeout_seconds)`` answers with a response or raises
#: :class:`NetworkError` / :class:`RequestTimeout`. Any other exception is a bug and surfaces.
Transport = Callable[[HttpRequest, float], HttpResponse]


def urllib_transport(request: HttpRequest, timeout_s: float) -> HttpResponse:
    """The default transport, on ``urllib``: one attempt, no retry, no redirect surprise.

    ``urllib`` raises on every non-2xx status; those answers are turned back into a plain
    response so the retry policy, not the transport, decides what a 304, a 429 or a 500 does.
    """
    req = urllib.request.Request(request.url, data=request.body, headers=request.headers, method=request.method)
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as res:
            return HttpResponse(res.status, res.reason or "", _lower_keys(res.headers.items()), res.read())
    except urllib.error.HTTPError as error:
        return HttpResponse(error.code, error.reason or "", _lower_keys(error.headers.items()), error.read())
    except (socket.timeout, TimeoutError) as error:
        raise RequestTimeout("timeout") from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, (socket.timeout, TimeoutError)):
            raise RequestTimeout("timeout") from error
        raise NetworkError(str(error.reason)) from error
    except OSError as error:
        raise NetworkError(str(error)) from error


def _lower_keys(items: Any) -> Dict[str, str]:
    return {str(name).lower(): str(value) for name, value in items}


def is_retryable_status(status: int) -> bool:
    """Only 429 and 5xx are transient. Every other non-200, non-304 status answers now."""
    return status == 429 or status >= 500


def http_error_message(status: int, reason: Optional[str]) -> str:
    """The ``error`` string of a failed status: the status text, else ``HTTP <code>``."""
    return reason or f"HTTP {status}"


@dataclass(frozen=True)
class Decision:
    """What one HTTP status does to one attempt (``retry-decision.json``)."""

    action: str  # "parse-body" | "not-modified" | "fail" | "retry"
    error: Optional[str] = None


def decide(status: int, reason: Optional[str]) -> Decision:
    if status == 200:
        return Decision("parse-body")
    if status == 304:
        return Decision("not-modified")
    error = http_error_message(status, reason)
    return Decision("retry" if is_retryable_status(status) else "fail", error)


def dictionary_url(
    api_url: Optional[str],
    lang: Optional[str],
    namespace: Optional[str],
    etag: Optional[str],
    last_refresh: Optional[str],
) -> str:
    """The URL of a dictionary fetch: ``GET /translate/<lang>`` or ``GET /translate/`` (all).

    The default namespace never appears in the query; another one travels URL-encoded.
    Without a known ETag the cursor travels as ``last_refresh=`` (``None`` written literally
    as ``null``); with one, the cursor leaves the URL and freshness travels in
    ``If-None-Match``, so the URL is stable for shared HTTP caches.
    """
    namespace_query = (
        f"&namespace={urllib.parse.quote(namespace, safe=_URI_COMPONENT_SAFE)}"
        if namespace and namespace != DEFAULT_NAMESPACE
        else ""
    )
    if etag:
        query = f"?{namespace_query[1:]}" if namespace_query else ""
    else:
        cursor = "null" if last_refresh is None else last_refresh
        query = f"?last_refresh={cursor}{namespace_query}"
    return f"{api_url or DEFAULT_API_URL}/translate/{lang or ''}{query}"


def etag_cache_key(api_key: str, lang: str, namespace: Optional[str]) -> str:
    """Where the ETag of one dictionary is remembered: ``apiKey|lang|namespace``."""
    return f"{api_key}|{lang}|{namespace or DEFAULT_NAMESPACE}"


class ApiClient:
    """The four calls of the protocol over one retrying ``fetch``.

    Every method returns the parsed JSON envelope (``{"ok": ..., "data": ...}``), a
    ``{"ok": True, "notModified": True}`` marker on a 304, or ``{"ok": False, "error": ...}``
    on failure. Nothing raises: the caller keeps whatever it already has.
    """

    def __init__(
        self,
        api_key: str,
        api_url: Optional[str] = None,
        *,
        timeout_ms: int = TIMEOUT_MS,
        retry_delays_ms: Sequence[int] = RETRY_DELAYS_MS,
        transport: Optional[Transport] = None,
        sleeper: Optional[Callable[[int], None]] = None,
    ) -> None:
        self.api_key = api_key
        self.api_url = api_url or DEFAULT_API_URL
        self.timeout_ms = timeout_ms
        self.retry_delays_ms = tuple(retry_delays_ms)
        self.transport: Transport = transport or urllib_transport
        #: The backoff sleep, in milliseconds. Tests replace it to drive the clock.
        self.sleeper: Callable[[int], None] = sleeper or (lambda ms: time.sleep(ms / 1000))

    @property
    def max_attempts(self) -> int:
        return len(self.retry_delays_ms) + 1

    def delay_after(self, failed_attempt: int) -> Optional[int]:
        """The wait after the n-th failed attempt (1-based), ``None`` after the last one."""
        if 1 <= failed_attempt <= len(self.retry_delays_ms):
            return self.retry_delays_ms[failed_attempt - 1]
        return None

    def headers(self, extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
        """The exact header set of every request. A server sends no ``unique_id``."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "Version": __version__,
            "sdk": SDK,
        }
        if extra:
            headers.update(extra)
        return headers

    def fetch(self, method: str, url: str, body: Optional[Any] = None, extra_headers: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
        """``fetchWithRetry``: attempts, backoff and the never-throw result contract."""
        request = HttpRequest(
            method,
            url,
            self.headers(extra_headers),
            None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"),
        )
        last_error = ""
        for attempt in range(self.max_attempts):
            try:
                response = self.transport(request, self.timeout_ms / 1000)
                if response.status == 304:
                    # The caller's copy is current: no body to parse, nothing to merge.
                    return {"ok": True, "notModified": True}
                if response.status == 200:
                    try:
                        parsed = json.loads(response.body.decode("utf-8"))
                    except ValueError as error:
                        # A 200 whose body is not JSON is a failed attempt, retried like a 5xx.
                        last_error = str(error)
                    else:
                        etag = response.header("etag")
                        if etag and isinstance(parsed, dict):
                            # Surface the ETag so the caller can replay it as If-None-Match.
                            parsed["etag"] = etag
                        return parsed
                else:
                    last_error = http_error_message(response.status, response.reason)
                    if not is_retryable_status(response.status):
                        # 4xx (except 429) is not transient: answer now, do not hammer the API.
                        return {"ok": False, "error": last_error}
            except RequestTimeout:
                last_error = "timeout"
            except NetworkError as error:
                last_error = str(error) or "network error"
            delay = self.delay_after(attempt + 1)
            if delay is not None:
                self.sleeper(delay)
        return {"ok": False, "error": last_error}

    def dictionary_url(self, lang: Optional[str], namespace: Optional[str], etag: Optional[str], last_refresh: Optional[str]) -> str:
        return dictionary_url(self.api_url, lang, namespace, etag, last_refresh)

    def fetch_dictionary(
        self,
        lang: Optional[str],
        namespace: Optional[str] = None,
        etag: Optional[str] = None,
        last_refresh: Optional[str] = "",
    ) -> Dict[str, Any]:
        """``GET /translate/<lang>`` (one language) or ``GET /translate/`` (every language).

        With a known ETag the request carries ``If-None-Match`` and a 304 answers
        ``{"ok": True, "notModified": True}``: the caller keeps its dictionary.
        """
        url = self.dictionary_url(lang, namespace, etag, last_refresh)
        return self.fetch("GET", url, extra_headers={"If-None-Match": etag} if etag else None)

    def translate(self, body: Mapping[str, Any]) -> Dict[str, Any]:
        """``POST /translate``: one missing key, the whole stored row in return."""
        return self.fetch("POST", f"{self.api_url}/translate", body)

    def send_usage(self, primary_language: str, usage_by_namespace: Mapping[str, Mapping[str, str]]) -> Dict[str, Any]:
        """``POST /translate/last-used-translations``: the cumulative usage map."""
        body = {"primaryLanguage": primary_language, "translationsUsageByNamespace": usage_by_namespace}
        return self.fetch("POST", f"{self.api_url}/translate/last-used-translations", body)
