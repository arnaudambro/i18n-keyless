"""Shared fixtures: the conformance vectors of the monorepo and a scripted transport.

No network, no key: every request the port makes lands in :class:`FakeTransport`, which
either answers from a script (a list of transport outcomes, as the vectors spell them) or
routes it to a canned answer per endpoint.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence

import pytest

from i18n_keyless import Config, I18nKeyless
from i18n_keyless.http import HttpRequest, HttpResponse, NetworkError, RequestTimeout

VECTORS = Path(__file__).resolve().parents[3] / "conformance" / "vectors"
API = "https://api.test"


def load_vector(name: str) -> Dict[str, Any]:
    path = VECTORS / f"{name}.json"
    if not path.is_file():
        pytest.skip(f"no conformance vector at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def envelope(translations: Any, **extra: Any) -> Dict[str, Any]:
    return {"ok": True, "data": {"translations": translations, "uniqueId": "srv_x", "lastRefresh": "1700000000000", **extra}, "error": "", "message": ""}


def translate_envelope(languages: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """The whole stored row, as the API answers `POST /translate` (PROTOCOL.md 4.1)."""
    return {
        "ok": True,
        "data": {"translation": {**languages, "languages": languages, "id": 4213, "namespace": "default"}},
        "error": "",
        "message": "",
    }


class FakeTransport:
    """Records every request; answers from a script, else from the canned endpoints."""

    def __init__(
        self,
        all_languages: Optional[Dict[str, Dict[str, str]]] = None,
        translation: Optional[Dict[str, Optional[str]]] = None,
        script: Optional[Sequence[Dict[str, Any]]] = None,
        on_request: Optional[Callable[[HttpRequest], Optional[HttpResponse]]] = None,
    ) -> None:
        self.all_languages = all_languages if all_languages is not None else {"fr": {}, "en": {}, "es": {}}
        self.translation = translation if translation is not None else {}
        self.script: List[Dict[str, Any]] = list(script or [])
        self.on_request = on_request
        self.requests: List[HttpRequest] = []
        self.lock = threading.Lock()

    def __call__(self, request: HttpRequest, timeout_s: float) -> HttpResponse:
        with self.lock:
            self.requests.append(request)
            scripted = self.script.pop(0) if self.script else None
        if scripted is not None:
            return answer(scripted)
        if self.on_request is not None:
            custom = self.on_request(request)
            if custom is not None:
                return custom
        return self.route(request)

    def route(self, request: HttpRequest) -> HttpResponse:
        path = request.url.split("?", 1)[0]
        if request.method == "POST" and path.endswith("/translate/last-used-translations"):
            return json_response({"ok": True, "error": "", "message": ""})
        if request.method == "POST" and path.endswith("/translate"):
            if self.translation:
                return json_response(translate_envelope(self.translation))
            # Like the mock server: the key itself in every language it knows.
            key = json.loads(request.body or b"{}").get("key", "")
            return json_response(translate_envelope({lang: key for lang in self.all_languages}))
        if request.method == "GET":
            return json_response(envelope(self.all_languages))
        return HttpResponse(404, "Not Found")

    def posts(self, suffix: str = "/translate") -> List[HttpRequest]:
        return [r for r in self.requests if r.method == "POST" and r.url.split("?", 1)[0].endswith(suffix)]

    def gets(self) -> List[HttpRequest]:
        return [r for r in self.requests if r.method == "GET"]

    def bodies(self, suffix: str = "/translate") -> List[Dict[str, Any]]:
        return [json.loads(r.body or b"{}") for r in self.posts(suffix)]


def json_response(body: Any, status: int = 200, reason: str = "OK", headers: Optional[Dict[str, str]] = None) -> HttpResponse:
    return HttpResponse(status, reason, {k.lower(): v for k, v in (headers or {}).items()}, json.dumps(body).encode("utf-8"))


def answer(outcome: Dict[str, Any]) -> HttpResponse:
    """A transport outcome as the vectors spell it: an HTTP answer, a network error or a timeout."""
    if "networkError" in outcome:
        raise NetworkError(outcome["networkError"])
    if outcome.get("timeout"):
        raise RequestTimeout("timeout")
    body = b"{not json" if outcome.get("invalidJson") else json.dumps(outcome["body"]).encode("utf-8") if "body" in outcome else b""
    return HttpResponse(outcome["status"], outcome.get("statusText", ""), {k.lower(): v for k, v in outcome.get("headers", {}).items()}, body)


def make_client(transport: Optional[FakeTransport] = None, **overrides: Any) -> I18nKeyless:
    """An initialised client on a fake transport, with the backoff sleeps recorded."""
    transport = transport or FakeTransport()
    config = Config(
        api_key=overrides.pop("api_key", "test-key"),
        api_url=overrides.pop("api_url", API),
        primary=overrides.pop("primary", "fr"),
        supported=overrides.pop("supported", ["fr", "en", "es"]),
        transport=transport,
        **overrides,
    )
    client = I18nKeyless()
    client.init(config)
    assert client.api is not None
    client.api.sleeper = client.sleeps.append  # type: ignore[attr-defined]
    return client


@pytest.fixture(autouse=True)
def _record_sleeps(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every client made in a test records its backoff sleeps instead of sleeping."""
    original_init = I18nKeyless.__init__

    def patched(self: I18nKeyless) -> None:
        original_init(self)
        self.sleeps = []  # type: ignore[attr-defined]

    monkeypatch.setattr(I18nKeyless, "__init__", patched)


def today() -> str:
    from i18n_keyless.client import _today

    return _today()
