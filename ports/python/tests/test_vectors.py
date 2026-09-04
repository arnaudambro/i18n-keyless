"""Replays the shared conformance vectors of the monorepo (conformance/vectors/*.json).

Every file is replayed. `storage-keys.json` is asserted for what it says about a server
(nothing to persist): this port has no persistent storage, so its key names and hydration
order do not apply (PORT_CHECKLIST.md, section 1, "Storage"). The device-only cases of the
other files (a `unique_id` header, `react-client` runtimes) are replayed with the server
rule: `sdk: python`, no device id.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any, Dict, List

import pytest

import i18n_keyless as i18n
from i18n_keyless import ApiClient, Config, I18nKeyless
from i18n_keyless.http import DEFAULT_API_URL, decide, dictionary_url, etag_cache_key
from i18n_keyless.langs import APP_STORE_LOCALES

from conftest import API, FakeTransport, answer, envelope, json_response, load_vector, make_client, today

SDK_VERSION = re.compile(r"^\d+\.\d+\.\d+")


def api(api_key: str = "k", api_url: str = API, **kw: Any) -> ApiClient:
    client = ApiClient(api_key, api_url, **kw)
    client.sleeper = lambda ms: sleeps.append(ms)
    return client


sleeps: List[int] = []


@pytest.fixture(autouse=True)
def _clear_sleeps() -> None:
    sleeps.clear()


def assert_server_headers(headers: Dict[str, str], expected: Dict[str, str], name: str) -> None:
    """The exact header set of a server port: the vector's, with the server identity."""
    wanted = {k: v for k, v in expected.items() if k not in ("sdk", "unique_id", "Version")}
    got = {k: v for k, v in headers.items() if k not in ("sdk", "Version")}
    assert got == wanted, name
    assert headers["sdk"] == "python", name
    assert SDK_VERSION.match(headers["Version"]), name
    assert int(headers["Version"].split(".")[0]) >= 3, name
    assert "unique_id" not in headers, name


# -- pure rules --------------------------------------------------------------------------


def test_resolve_lang() -> None:
    for case in load_vector("resolve-lang")["cases"]:
        inp = case["input"]
        got = i18n.resolve_lang(inp.get("tag"), supported=inp.get("supported"), fallback=inp.get("fallback"))
        assert got == case["expected"], case["name"]


def test_languages() -> None:
    for case in load_vector("languages")["cases"]:
        check = case["check"]
        if check == "availableLangs":
            assert list(i18n.AVAILABLE_LANGS) == case["expected"], case["name"]
        elif check == "rename":
            # No v2 dialect in this port: the v2 code is simply not a language.
            assert not i18n.is_lang(case["input"]), case["name"]
            assert i18n.is_lang(case["expected"]), case["name"]
        elif check == "stillAvailable":
            assert all(i18n.is_lang(code) for code in case["input"]), case["name"]
        elif check == "absent":
            assert not i18n.is_lang(case["input"]), case["name"]
        elif check == "regionalized":
            assert sorted(code for code in i18n.AVAILABLE_LANGS if "-" in code) == case["expected"], case["name"]
        else:
            pytest.fail(f"unknown check {check}")


def test_app_store_locales() -> None:
    vector = load_vector("app-store-locales")
    for case in vector["cases"]:
        assert i18n.to_app_store_locale(case["input"]) == case["expected"]
    assert len(set(APP_STORE_LOCALES.values())) == vector["distinctSlots"]


def test_storage_key() -> None:
    for case in load_vector("storage-key")["cases"]:
        assert i18n.storage_key_for(case["input"]["key"], case["input"].get("context")) == case["expected"], case["name"]


def test_replace() -> None:
    for case in load_vector("replace")["cases"]:
        assert i18n.apply_replace(case["input"]["text"], case["input"].get("replace")) == case["expected"], case["name"]


def test_namespace_and_origin_language() -> None:
    for case in load_vector("namespace")["cases"]:
        options = case["input"].get("options") or {}
        if case["fn"] == "resolveNamespace":
            got = i18n.resolve_namespace(options.get("namespace"), (case["input"].get("config") or {}).get("defaultNamespace"))
        else:
            got = i18n.resolve_origin_language(options.get("originLanguage"), case["input"]["primary"])
        assert got == case["expected"], case["name"]


def test_queue_id() -> None:
    vector = load_vector("queue")
    assert i18n.CONCURRENCY == vector["concurrency"]
    for case in vector["cases"]:
        assert i18n.queue_id_for(case["input"]["namespace"], case["input"]["key"]) == case["expected"], case["name"]


# -- transport ---------------------------------------------------------------------------


def test_retry_decision() -> None:
    for case in load_vector("retry-decision")["cases"]:
        decision = decide(case["input"]["status"], case["input"].get("statusText"))
        assert decision.action == case["expected"]["action"], case["input"]
        if "error" in case["expected"]:
            assert decision.error == case["expected"]["error"], case["input"]


def test_backoff_schedule() -> None:
    vector = load_vector("backoff")
    assert i18n.TIMEOUT_MS == vector["timeoutMs"]
    assert i18n.MAX_ATTEMPTS == vector["maxAttempts"]
    assert list(i18n.RETRY_DELAYS_MS) == vector["delaysMs"]
    client = api()
    for case in vector["cases"]:
        assert client.delay_after(case["input"]["failedAttempt"]) == case["expected"]["waitMs"], case["name"]


def test_backoff_scenarios() -> None:
    vector = load_vector("backoff")
    for scenario in vector["scenarios"]:
        sleeps.clear()
        transport = FakeTransport(script=scenario["responses"])
        client = api(transport=transport)
        etag = 'W/"x"' if scenario["name"] == "304 ends the call at once" else None

        result = client.fetch_dictionary("en", "default", etag)

        assert len(transport.requests) == scenario["expected"]["attempts"], scenario["name"]
        assert sleeps == scenario["expected"]["sleepsMs"], scenario["name"]
        assert result == scenario["expected"]["result"], scenario["name"]


def test_dictionary_request() -> None:
    for case in load_vector("dictionary-request")["cases"]:
        inp, expected = case["input"], case["expected"]
        config = inp["config"]
        if "handler" in expected:
            # A custom getAllTranslations replaces the request and receives no argument.
            calls: List[Any] = []
            client = make_client(get_all_translations_for_all_languages=lambda: calls.append(()) or envelope({}))
            assert calls == [()], case["name"]
            assert client.api is not None and client.api.transport.requests == [], case["name"]  # type: ignore[attr-defined]
            continue
        transport = FakeTransport()
        client = api(config["API_KEY"], config.get("API_URL"), transport=transport)
        etag = inp.get("knownEtag")
        if inp.get("knownEtagFor"):
            # An ETag remembered for another language must not leak into this request.
            assert etag_cache_key(config["API_KEY"], inp["knownEtagFor"]["lang"], None) != expected["etagCacheKey"]
        client.fetch_dictionary(inp["targetLanguage"], inp.get("namespace"), etag, inp.get("lastRefresh"))

        (request,) = transport.requests
        assert request.method == expected["method"], case["name"]
        assert request.url == expected["url"], case["name"]
        assert_server_headers(request.headers, expected["headers"], case["name"])
        assert etag_cache_key(config["API_KEY"], inp["targetLanguage"], inp.get("namespace")) == expected["etagCacheKey"], case["name"]


def test_dictionary_response(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="i18n_keyless")
    for case in load_vector("dictionary-response")["cases"]:
        inp, expected = case["input"], case["expected"]
        responses = case.get("responses") or [case["response"]]
        transport = FakeTransport(script=responses)
        client = api(inp["config"]["API_KEY"], DEFAULT_API_URL, transport=transport)
        known_etag = inp.get("knownEtag")

        result = client.fetch_dictionary(inp["targetLanguage"], "default", known_etag)

        if "attempts" in expected:
            assert len(transport.requests) == expected["attempts"], case["name"]
        if expected["result"] is None:
            assert not result.get("ok") or result.get("notModified"), case["name"]
        else:
            assert result == expected["result"], case["name"]
        # The ETag a caller keeps afterwards: the new one, else the one it had on a 304.
        remembered = known_etag if result.get("notModified") else result.get("etag")
        assert remembered == expected["etagRemembered"], case["name"]
        next_url = client.dictionary_url(inp["targetLanguage"], "default", remembered, "1700000000")
        assert next_url == expected["nextRequest"]["url"], case["name"]
        if "warning" in expected:
            # The envelope's message is surfaced as a warning, once, by the client that
            # consumes the answer (see test_translation_client_logs_the_message).
            assert result.get("message") == expected["warning"], case["name"]


def test_dictionary_message_is_logged_once_as_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="i18n_keyless")
    case = next(c for c in load_vector("dictionary-response")["cases"] if "warning" in c["expected"])
    body = dict(case["response"]["body"])
    body["data"] = {"translations": {"en": {}}, "uniqueId": None, "lastRefresh": "1"}
    make_client(FakeTransport(script=[{"status": 200, "body": body}]))
    assert [r.getMessage() for r in caplog.records].count(f"i18n-keyless: {case['expected']['warning']}") == 1


def test_translate_request() -> None:
    for case in load_vector("translate-request")["cases"]:
        inp, expected = case["input"], case["expected"]
        config, options = inp["config"], inp.get("options") or {}
        if "handler" in expected:
            calls: List[Any] = []
            client = make_client(
                api_key=config["API_KEY"],
                supported=config["languages"]["supported"],
                handle_translate=lambda key: calls.append([key]) or {"ok": True, "data": {"translation": {}}},
            )
            client.t(inp["key"], inp["currentLanguage"], context=options.get("context"), namespace=options.get("namespace"))
            assert calls == [expected["handlerArgs"]], case["name"]
            assert client.api is not None and client.api.transport.posts() == [], case["name"]  # type: ignore[attr-defined]
            continue
        translations = {inp["currentLanguage"]: dict(inp.get("translations") or {})}
        transport = FakeTransport(all_languages=translations)
        client = make_client(
            transport,
            api_key=config["API_KEY"],
            api_url=config.get("API_URL"),
            primary=config["languages"]["primary"],
            supported=config["languages"]["supported"],
            default_namespace=config.get("defaultNamespace"),
        )

        client.t(
            inp["key"],
            inp["currentLanguage"],
            context=options.get("context"),
            namespace=options.get("namespace"),
            force_temporary=options.get("forceTemporary"),
            origin_language=options.get("originLanguage"),
        )

        (request,) = transport.posts()
        assert request.url == expected["url"], case["name"]
        assert request.method == expected["method"], case["name"]
        assert_server_headers(request.headers, expected["headers"], case["name"])
        assert json.loads(request.body or b"") == expected["body"], case["name"]


def test_usage_request() -> None:
    for case in load_vector("usage-request")["cases"]:
        inp, expected = case["input"], case["expected"]
        config = inp["config"]
        transport = FakeTransport()
        handler_calls: List[Any] = []
        handler = (lambda bucket: handler_calls.append([bucket]) or {"ok": True, "error": "", "message": ""}) if config.get("sendTranslationsUsage") else None
        client = I18nKeyless()
        client.init(
            Config(
                api_key=config["API_KEY"],
                api_url=config.get("API_URL") or (API if not config["API_KEY"] else None),
                primary=config["languages"]["primary"],
                supported=config["languages"]["supported"],
                transport=transport,
                send_translations_usage=handler,
            )
        )
        transport.requests.clear()
        client._usage = {ns: dict(bucket) for ns, bucket in inp["usage"].items()}  # noqa: SLF001 (seeding the map)

        result = client.flush_usage()

        if "handler" in expected:
            assert handler_calls == [expected["handlerArgs"]], case["name"]
            assert transport.requests == [], case["name"]
            continue
        if expected.get("http") is False:
            assert result is None, case["name"]
            assert transport.requests == [], case["name"]
            continue
        (request,) = transport.posts("/translate/last-used-translations")
        assert request.url == expected["url"], case["name"]
        assert request.method == expected["method"], case["name"]
        assert_server_headers(request.headers, expected["headers"], case["name"])
        assert json.loads(request.body or b"") == expected["body"], case["name"]


# -- runtime and identity ----------------------------------------------------------------


def test_usage_reporting_python_is_a_server_label() -> None:
    vector = load_vector("usage-reporting")
    label = next((c for c in vector["serverLabels"]["cases"] if c["label"] == "python"), None)
    assert label, "usage-reporting.json must list `python` as a server label"
    assert label["expected"] is True
    assert i18n.SDK == "python"
    node = next(c for c in vector["cases"] if c["input"].get("package") == "node")["expected"]
    # `python` follows the node rules: records usage, sends it, no device id.
    assert node == {"runtime": "node", "recordsUsage": True, "sendsUsage": True, "sendsUniqueId": False}
    assert "python" in vector["usageFlush"]
    assert i18n.USAGE_FLUSH_MS == 10_000

    # End to end: a served key is recorded, and the map leaves with the server identity.
    transport = FakeTransport(all_languages={"fr": {}, "en": {"Bonjour": "Hello"}})
    client = make_client(transport)
    assert client.t("Bonjour", "en") == "Hello"
    client.flush_usage()
    (request,) = transport.posts("/translate/last-used-translations")
    assert request.headers["sdk"] == "python"
    assert "unique_id" not in request.headers
    assert json.loads(request.body or b"")["translationsUsageByNamespace"] == {"default": {"Bonjour": today()}}


def test_a_server_sends_no_device_id() -> None:
    vector = load_vector("unique-id")
    assert "A server runtime sends no id" in vector["description"]
    transport = FakeTransport()
    make_client(transport)
    assert transport.requests, "init fetches the dictionary"
    for request in transport.requests:
        assert "unique_id" not in request.headers
        assert request.headers["sdk"] == "python"


def test_storage_keys_do_not_apply_to_a_server() -> None:
    """A server persists nothing: no device id, no dictionary on disk, no cursor."""
    vector = load_vector("storage-keys")
    assert vector["fixedKeys"]["uniqueId"]["key"] == "i18n-keyless-user-id"
    client = make_client()
    assert not hasattr(client, "storage")
    # The cursor is never stored either: every dictionary fetch of this port sends an
    # empty `last_refresh` (or the ETag), never a persisted value.
    assert client.api is not None
    assert client.api.dictionary_url(None, "default", None, "") == f"{API}/translate/?last_refresh="


# -- resolution and the queue ------------------------------------------------------------


def test_translation_lookup() -> None:
    for case in load_vector("translation-lookup")["cases"]:
        store, options = case["input"]["store"], case["input"].get("options") or {}
        client = make_client(
            FakeTransport(all_languages={store["currentLanguage"]: dict(store["translations"])}),
            primary=store["primary"],
            supported=[store["primary"], store["currentLanguage"], "es", "en"],
            default_namespace=store.get("defaultNamespace"),
        )

        lookup = client.lookup(
            case["input"]["key"],
            store["currentLanguage"],
            context=options.get("context"),
            namespace=options.get("namespace"),
            force_temporary=options.get("forceTemporary"),
            origin_language=options.get("originLanguage"),
            unpersisted_namespace=options.get("unpersistedNamespace", False),
        )

        text = i18n.apply_replace(lookup.text, options.get("replace"))
        assert text == case["expected"]["text"], case["name"]
        queued = [{"namespace": lookup.miss.namespace, "unpersisted": lookup.miss.unpersisted}] if lookup.miss else []
        assert queued == case["expected"]["queued"], case["name"]


def test_queue_scenarios() -> None:
    """A batch is one page rendering its strings in turn: each call blocks for its request.

    Two scenarios are not replayed, on purpose: the SDK queue's id ignores the context and
    the origin language (a limitation the client path reproduces, PROTOCOL.md section 15,
    item 1), while this port answers each call from its own request, so two contexts of one
    key in one batch are two requests, like the Rails and Laravel ports.
    """
    for scenario in load_vector("queue")["scenarios"]:
        if not isinstance(scenario["calls"], list):
            continue  # "31 distinct keys": test_queue_concurrency_peak
        if any(k in (call.get("options") or {}) for call in scenario["calls"] for k in ("context", "originLanguage")):
            continue
        transport = FakeTransport(all_languages={"fr": {}, "en": dict(scenario.get("translations") or {})})
        client = make_client(transport)
        for call in scenario["calls"]:
            options = call.get("options") or {}
            client.t(call["key"], "en", namespace=options.get("namespace"), force_temporary=options.get("forceTemporary"))
        client.wait_idle()
        assert len(transport.posts()) == scenario["expected"]["requests"], scenario["name"]


def test_queue_concurrency_peak() -> None:
    vector = load_vector("queue")
    scenario = next(s for s in vector["scenarios"] if s["calls"] == "31 distinct keys")
    gate = threading.Event()
    state = {"in_flight": 0, "peak": 0}
    lock = threading.Lock()

    def block_posts(request: Any) -> Any:
        if request.method != "POST" or not request.url.endswith("/translate"):
            return None
        with lock:
            state["in_flight"] += 1
            state["peak"] = max(state["peak"], state["in_flight"])
        gate.wait(5)
        with lock:
            state["in_flight"] -= 1
        return None

    transport = FakeTransport(on_request=block_posts)
    client = make_client(transport)
    threads = [threading.Thread(target=client.t, args=(f"Clé {n}", "en")) for n in range(31)]
    for thread in threads:
        thread.start()
    deadline = time.time() + 5
    while time.time() < deadline and state["peak"] < vector["concurrency"]:
        time.sleep(0.01)
    time.sleep(0.05)  # give the 31st a chance to (wrongly) enter
    assert state["peak"] == scenario["expected"]["peakInFlight"]
    gate.set()
    for thread in threads:
        thread.join()
    client.wait_idle()
    assert len(transport.posts()) == scenario["expected"]["requests"]
