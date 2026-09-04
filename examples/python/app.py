"""i18n-keyless · Python (a server, no framework).

Two pages served by the standard library's HTTP server, rendered in the language of the
`?lang=` query with the `i18n-keyless` package: `init()` once at start, `t()` in the
handler, `context` for an ambiguous string, `replace` for a placeholder, and a switcher.

    uv run app.py            # http://localhost:3000  (try /?lang=en, /about?lang=es)

Source strings are written in French: `fr` is the primary language. With a real key
(`I18N_KEYLESS_API_KEY`) the service translates them on demand; without one the app talks
to the offline mock backend of `examples/_mock-server`.
"""

from __future__ import annotations

import os
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit

import i18n_keyless as i18n

PRIMARY = "fr"
SUPPORTED = ["fr", "en", "es"]
MOCK_URL = "http://localhost:8787"


def init_i18n(**overrides: Any) -> None:
    """Once, at process start. The Python port bulk-loads every language up front."""
    key = os.environ.get("I18N_KEYLESS_API_KEY")
    i18n.init(
        api_key=key or "demo",
        # With a real key, api_url defaults to https://api.i18n-keyless.com. Without one,
        # use the local mock backend so the demo runs offline.
        api_url=None if key else MOCK_URL,
        primary=PRIMARY,
        supported=SUPPORTED,
        **overrides,
    )


def lang_from_query(query: str) -> str:
    """`?lang=pt_BR` and `?lang=zh-TW` map onto the served codes; anything else is French."""
    requested: Optional[str] = (parse_qs(query).get("lang") or [None])[0]
    return i18n.resolve_lang(requested, supported=SUPPORTED, fallback=PRIMARY) or PRIMARY


def switcher(lang: str, path: str) -> str:
    links = " · ".join(f'<a href="{path}?lang={code}">{code}</a>' for code in SUPPORTED)
    label = i18n.t("Langue : {{current_lang}}", lang, replace={"{{current_lang}}": lang})
    return f"<nav><p>{escape(label)}</p><p>{escape(i18n.t('Changer de langue', lang))} : {links}</p></nav>"


def page(lang: str, title: str, body: str, path: str) -> str:
    other = "/about" if path == "/" else "/"
    other_label = i18n.t("À propos", lang) if path == "/" else i18n.t("Accueil", lang)
    return (
        "<!doctype html>\n"
        f'<html lang="{lang}"><head><meta charset="utf-8"><title>{escape(title)}</title></head>'
        f"<body><h1>{escape(title)}</h1>{body}{switcher(lang, path)}"
        f'<p><a href="{other}?lang={lang}">{escape(other_label)}</a></p></body></html>'
    )


def render_home(lang: str) -> str:
    intro = i18n.t(
        "Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le souhaitez.",
        lang,
    )
    # `context` disambiguates "8 heures": "8 AM" (a time) vs "8 hours" (a duration).
    as_time = i18n.t("8 heures", lang, context="heure")
    as_duration = i18n.t("8 heures", lang, context="durée")
    body = f"<p>{escape(intro)}</p><p>8 heures → {escape(as_time)} (heure) · {escape(as_duration)} (durée)</p>"
    return page(lang, i18n.t("Accueil", lang), body, "/")


def render_about(lang: str) -> str:
    text = i18n.t("Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>.", lang)
    body = f"<p>{escape(text)}</p>"
    return page(lang, i18n.t("À propos de cette démo", lang), body, "/about")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (http.server's name)
        url = urlsplit(self.path)
        lang = lang_from_query(url.query)
        if url.path == "/":
            html = render_home(lang)
        elif url.path == "/about":
            html = render_about(lang)
        else:
            self.send_error(404)
            return
        payload = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    init_i18n()
    port = int(os.environ.get("PORT", "3000"))
    server = ThreadingHTTPServer(("", port), Handler)
    print(f"i18n-keyless · Python on http://localhost:{port}  (try /?lang=en, /about?lang=es)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        i18n.flush_usage()


if __name__ == "__main__":
    main()
