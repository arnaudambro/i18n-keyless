"""Renders the two pages on a scripted transport: no backend, no key needed."""

from __future__ import annotations

import json

import pytest

import i18n_keyless as i18n
from i18n_keyless.http import HttpRequest, HttpResponse

import app

# Translations as the all-languages endpoint returns them (the port bulk-loads every
# language at init). The strings are the mock server's fixtures.
TRANSLATIONS = {
    "fr": {},
    "en": {
        "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.": "Here is a phrase available in all your languages, you can change it if you want.",
        "8 heures__heure": "8 AM",
        "8 heures__durée": "8 hours",
        "Langue : {{current_lang}}": "Language: {{current_lang}}",
        "Changer de langue": "Switch language",
        "Accueil": "Home",
        "À propos": "About",
        "À propos de cette démo": "About this demo",
        "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.": "This text is rendered with the getTranslation() function instead of the <T> component.",
    },
    "es": {"Accueil": "Inicio"},
}


def transport(request: HttpRequest, timeout_s: float) -> HttpResponse:
    if request.method == "GET":
        body = {"ok": True, "data": {"translations": TRANSLATIONS, "uniqueId": "srv", "lastRefresh": "1"}, "error": "", "message": ""}
    else:
        key = json.loads(request.body or b"{}").get("key", "")
        body = {"ok": True, "data": {"translation": {"languages": {"fr": key}}}, "error": "", "message": ""}
    return HttpResponse(200, "OK", {}, json.dumps(body).encode("utf-8"))


@pytest.fixture(autouse=True)
def _init() -> None:
    app.init_i18n(transport=transport)
    yield
    i18n.reset()


def test_home_is_translated_for_lang_en() -> None:
    html = app.render_home("en")
    assert "Here is a phrase available in all your languages, you can change it if you want." in html
    assert "8 AM" in html  # 8 heures / heure
    assert "8 hours" in html  # 8 heures / durée
    assert "Language: en" in html  # replace
    assert 'lang="en"' in html


def test_home_is_the_french_source_for_the_primary_language() -> None:
    html = app.render_home("fr")
    assert "Voici une phrase disponible dans toutes vos langues" in html
    assert "Langue : fr" in html


def test_about_page_uses_its_own_strings() -> None:
    assert "This text is rendered with the getTranslation() function" in app.render_about("en")
    assert "Inicio" in app.render_about("es")  # the link back home, in Spanish


def test_the_language_comes_from_the_query() -> None:
    assert app.lang_from_query("lang=en") == "en"
    assert app.lang_from_query("lang=en_US") == "en"
    assert app.lang_from_query("lang=pt") == "fr"  # not served: the primary
    assert app.lang_from_query("") == "fr"
