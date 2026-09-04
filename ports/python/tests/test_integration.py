"""End-to-end behaviour of the client on a scripted transport: no network, no key."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, List

import pytest

import i18n_keyless as i18n
from i18n_keyless import Config, I18nKeyless, TranslationError
from i18n_keyless.http import HttpRequest, HttpResponse, urllib_transport

from conftest import API, FakeTransport, json_response, make_client, today, translate_envelope

DICTIONARIES = {"fr": {}, "en": {"Bonjour": "Hello", "8 heures__heure": "8 AM"}, "es": {"Bonjour": "Hola"}}


def test_init_loads_every_language_of_the_default_namespace() -> None:
    transport = FakeTransport(all_languages=DICTIONARIES)
    client = make_client(transport)
    (request,) = transport.gets()
    assert request.url == f"{API}/translate/?last_refresh="
    assert set(request.headers) == {"Content-Type", "Authorization", "Version", "sdk"}
    assert request.headers["Authorization"] == "Bearer test-key"
    assert client.translations("en") == DICTIONARIES["en"]
    assert client.translations("es") == DICTIONARIES["es"]


def test_init_targets_the_configured_default_namespace() -> None:
    transport = FakeTransport()
    make_client(transport, default_namespace="app")
    assert transport.gets()[0].url == f"{API}/translate/?last_refresh=&namespace=app"


def test_init_validates_the_config() -> None:
    with pytest.raises(ValueError, match="primary is required"):
        I18nKeyless().init(Config(api_key="k", supported=["fr"]))
    with pytest.raises(ValueError, match="supported languages are required"):
        I18nKeyless().init(Config(api_key="k", primary="fr"))
    with pytest.raises(ValueError, match="api_key"):
        I18nKeyless().init(Config(primary="fr", supported=["fr"]))
    with pytest.raises(TypeError):
        i18n.init(Config(api_key="k", primary="fr", supported=["fr"]), api_url=API)


def test_on_init_receives_the_primary_language() -> None:
    seen: List[str] = []
    make_client(on_init=seen.append)
    assert seen == ["fr"]


def test_primary_language_returns_the_key_without_a_request() -> None:
    transport = FakeTransport()
    client = make_client(transport)
    assert client.t("Bonjour", "fr") == "Bonjour"
    assert client.t("Bonjour {{name}}", "fr", replace={"{{name}}": "Ada"}) == "Bonjour Ada"
    assert transport.posts() == []


def test_hit_returns_the_stored_translation() -> None:
    transport = FakeTransport(all_languages=DICTIONARIES)
    client = make_client(transport)
    assert client.t("Bonjour", "en") == "Hello"
    assert client.t("Bonjour", "es") == "Hola"
    assert client.t("8 heures", "en", context="heure") == "8 AM"
    assert client.t("8 heures", "en", context="durée") == "8 heures"  # a context miss never reads the plain entry
    assert len(transport.posts()) == 1


def test_miss_posts_and_returns_the_answer_from_languages() -> None:
    row = {"fr": "Au revoir", "en": "Goodbye", "es": "Adiós", "id": 42}
    transport = FakeTransport(translation=row)
    client = make_client(transport)

    assert client.t("Au revoir", "en") == "Goodbye"
    assert client.t("Au revoir", "es") == "Adiós"  # cached from the same answer
    assert client.t("Au revoir", "en") == "Goodbye"

    assert len(transport.posts()) == 1
    body = transport.bodies()[0]
    assert body == {"key": "Au revoir", "languages": ["fr", "en", "es"], "primaryLanguage": "fr"}
    # The numeric row id is never mistaken for Indonesian.
    assert "Au revoir" not in client.translations("id")


def test_the_flat_keys_are_read_only_without_a_languages_map() -> None:
    """A custom backend or a mock may answer the flat shape alone."""
    def flat(request: HttpRequest) -> Any:
        if request.method == "POST" and request.url.endswith("/translate"):
            return json_response({"ok": True, "data": {"translation": {"fr": "Merci", "en": "Thanks", "id": 7}}, "error": "", "message": ""})
        return None

    client = make_client(FakeTransport(on_request=flat))
    assert client.t("Merci", "en") == "Thanks"
    assert client.translations("id") == {}


def test_a_failed_post_falls_back_to_the_source_text(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.ERROR, logger="i18n_keyless")
    def unauthorized(request: HttpRequest) -> Any:
        return HttpResponse(401, "Unauthorized") if request.method == "POST" else None

    transport = FakeTransport(on_request=unauthorized)
    client = make_client(transport)
    assert client.t("Bonjour {{name}}", "en", replace={"{{name}}": "Ada"}) == "Bonjour Ada"
    assert "Unauthorized" in caplog.text
    with pytest.raises(TranslationError, match="Unauthorized"):
        client.t_or_raise("Bonjour", "en")


def test_ok_false_on_a_200_is_a_failure() -> None:
    transport = FakeTransport(script=[{"status": 200, "body": {"ok": True, "data": {"translations": {}}}}, {"status": 200, "body": {"ok": False, "error": "quota", "data": {"translation": None}}}])
    client = make_client(transport)
    with pytest.raises(TranslationError, match="quota"):
        client.t_or_raise("Bonjour", "en")


def test_retries_a_network_error_then_uses_the_answer() -> None:
    transport = FakeTransport(
        script=[
            {"status": 200, "body": {"ok": True, "data": {"translations": {}}}},
            {"networkError": "offline"},
            {"status": 503, "statusText": "Service Unavailable"},
            {"status": 200, "body": translate_envelope({"fr": "Bonjour", "en": "Hello"})},
        ]
    )
    client = make_client(transport)
    assert client.t("Bonjour", "en") == "Hello"
    assert client.sleeps == [500, 1500]  # type: ignore[attr-defined]
    assert len(transport.posts()) == 3


def test_concurrent_misses_of_one_key_share_one_request() -> None:
    gate = threading.Event()

    def slow(request: HttpRequest) -> Any:
        if request.method == "POST" and request.url.endswith("/translate"):
            gate.wait(5)
        return None

    transport = FakeTransport(translation={"fr": "Bonjour", "en": "Hello"}, on_request=slow)
    client = make_client(transport)
    results: List[str] = []
    threads = [threading.Thread(target=lambda: results.append(client.t("Bonjour", "en"))) for _ in range(5)]
    for thread in threads:
        thread.start()
    time.sleep(0.05)
    gate.set()
    for thread in threads:
        thread.join()
    assert results == ["Hello"] * 5
    assert len(transport.posts()) == 1


def test_force_temporary_is_never_shared_and_travels() -> None:
    transport = FakeTransport(all_languages=DICTIONARIES, translation={"fr": "Bonjour", "en": "Hi there"})
    client = make_client(transport)
    assert client.t("Bonjour", "en", force_temporary={"en": "Hi there"}) == "Hi there"
    assert transport.bodies()[0]["forceTemporary"] == {"en": "Hi there"}


def test_the_refetch_follows_a_batch_of_misses() -> None:
    state = {"gets": 0}

    def count(request: HttpRequest) -> Any:
        if request.method == "GET":
            state["gets"] += 1
            if state["gets"] > 1:
                return json_response({"ok": True, "data": {"translations": {"en": {"Bonjour": "Hello (edited)"}}}, "error": "", "message": ""}, headers={"ETag": 'W/"v2"'})
        return None

    transport = FakeTransport(translation={"fr": "Bonjour", "en": "Hello"}, on_request=count)
    client = make_client(transport)
    client.t("Bonjour", "en", namespace="checkout")
    client.wait_idle(5)
    urls = [r.url for r in transport.gets()]
    assert urls == [f"{API}/translate/?last_refresh=", f"{API}/translate/?last_refresh=&namespace=checkout"]
    assert client.translations("en", "checkout")["Bonjour"] == "Hello (edited)"
    assert client.pending_namespaces() == {}


def test_a_304_keeps_the_store_and_replays_the_etag() -> None:
    answers = iter(
        [
            json_response({"ok": True, "data": {"translations": DICTIONARIES}, "error": "", "message": ""}, headers={"ETag": 'W/"v1"'}),
            HttpResponse(304, "Not Modified"),
        ]
    )

    def dictionary(request: HttpRequest) -> Any:
        return next(answers) if request.method == "GET" else None

    transport = FakeTransport(translation={"fr": "Au revoir", "en": "Goodbye"}, on_request=dictionary)
    client = make_client(transport)
    client.t("Au revoir", "en")
    client.wait_idle(5)
    first, second = transport.gets()
    assert "If-None-Match" not in first.headers
    assert second.url == f"{API}/translate/"
    assert second.headers["If-None-Match"] == 'W/"v1"'
    assert client.translations("en")["Bonjour"] == "Hello"


def test_usage_is_recorded_per_call_and_flushed_on_a_debounce() -> None:
    transport = FakeTransport(all_languages=DICTIONARIES)
    client = make_client(transport, usage_flush_ms=20)
    client.t("Bonjour", "en")
    client.t("Bonjour", "fr")  # the primary language counts too
    client.t("8 heures", "en", context="heure")
    client.t("Payer", "en", namespace="checkout")
    client.t("Hi", "en", namespace="chat-1", unpersisted_namespace=True)  # never reported
    assert transport.posts("/translate/last-used-translations") == []
    deadline = time.time() + 2
    while time.time() < deadline and not transport.posts("/translate/last-used-translations"):
        time.sleep(0.01)
    (request,) = transport.posts("/translate/last-used-translations")
    assert set(request.headers) == {"Content-Type", "Authorization", "Version", "sdk"}
    assert json.loads(request.body or b"") == {
        "primaryLanguage": "fr",
        "translationsUsageByNamespace": {"default": {"Bonjour": today(), "8 heures__heure": today()}, "checkout": {"Payer": today()}},
    }
    # Cumulative: a later flush carries everything again.
    client.t("Bonjour", "es")
    assert client.flush_usage() == {"ok": True, "error": "", "message": ""}
    assert len(transport.posts("/translate/last-used-translations")) == 2


def test_the_usage_timer_is_a_daemon_thread() -> None:
    client = make_client(usage_flush_ms=60_000)
    client.t("Bonjour", "en")
    timer = client._usage_timer  # noqa: SLF001
    assert timer is not None and timer.daemon
    client.reset()
    assert client._usage_timer is None  # noqa: SLF001


def test_custom_handlers_replace_every_request() -> None:
    calls: List[Any] = []
    client = I18nKeyless()
    client.init(
        Config(
            api_key="k",
            primary="fr",
            supported=["fr", "en"],
            transport=FakeTransport(on_request=lambda r: pytest.fail("no HTTP with handlers")),
            handle_translate=lambda key: calls.append(("translate", key)) or {"ok": True, "data": {"translation": {"fr": key, "en": "Hello"}}},
            get_all_translations_for_all_languages=lambda: calls.append(("all",)) or {"ok": True, "data": {"translations": {"en": {"Merci": "Thanks"}}}},
            send_translations_usage=lambda bucket: calls.append(("usage", bucket)) or {"ok": True},
        )
    )
    assert client.t("Merci", "en") == "Thanks"
    assert client.t("Bonjour", "en") == "Hello"
    assert client.t("Bonjour", "en") == "Hello"  # cached: the handler is not called again
    client.wait_idle(5)  # the refetch that follows the miss goes through the handler too
    client.flush_usage()
    assert calls == [("all",), ("translate", "Bonjour"), ("all",), ("usage", {"Merci": today(), "Bonjour": today()})]


def test_a_failing_handler_falls_back() -> None:
    def broken(key: str) -> Any:
        raise RuntimeError("boom")

    client = make_client(handle_translate=broken)
    assert client.t("Bonjour", "en") == "Bonjour"
    with pytest.raises(RuntimeError, match="boom"):
        client.t_or_raise("Bonjour", "en")


def test_before_init_t_returns_the_source_text(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="i18n_keyless")
    client = I18nKeyless()
    assert client.t("Bonjour {{n}}", "en", replace={"{{n}}": "1"}) == "Bonjour 1"
    assert "before init()" in caplog.text
    with pytest.raises(i18n.NotInitialized):
        client.t_or_raise("Bonjour", "en")


def test_empty_key_is_empty_and_free() -> None:
    transport = FakeTransport()
    client = make_client(transport)
    assert client.t("", "en") == ""
    assert transport.posts() == []
    assert client.pending_usage() == {}


def test_ugc_origin_language_flow() -> None:
    transport = FakeTransport(translation={"fr": "Bonjour le monde", "en": "Hello world", "es": "Hola mundo"})
    client = make_client(transport)
    assert client.t("Hola mundo", "es", origin_language="es") == "Hola mundo"  # its own language: no request
    assert client.t("Hola mundo", "en", origin_language="es") == "Hello world"
    assert transport.bodies()[0]["originLanguage"] == "es"
    assert client.t("Hola mundo", "fr", origin_language="es") == "Bonjour le monde"  # the primary is a lookup for UGC


def test_the_module_level_api_drives_the_shared_client() -> None:
    transport = FakeTransport(all_languages=DICTIONARIES)
    i18n.init(api_key="k", api_url=API, primary="fr", supported=["fr", "en"], transport=transport)
    try:
        assert i18n.t("Bonjour", "en") == "Hello"
        assert i18n.get_supported_languages() == ["fr", "en"]
        assert i18n.client.config is not None
    finally:
        i18n.reset()
    assert i18n.client.config is None


def test_urllib_transport_maps_errors() -> None:
    """A closed port is a network error, reported as a string, never raised out of fetch."""
    from i18n_keyless.http import ApiClient

    client = ApiClient("k", "http://127.0.0.1:9", transport=urllib_transport)
    client.sleeper = lambda ms: None
    result = client.translate({"key": "x"})
    assert result["ok"] is False
    assert result["error"]
