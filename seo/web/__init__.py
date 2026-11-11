"""The web app: its APIs, and the screens when a folder is given. Login guards everything, unless a test switches it off."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from flask import Flask, jsonify, send_from_directory
from sqlalchemy import Engine

from seo import config
from seo.core.errors import Refused
from seo.crawl.guard import is_public_url


MAX_REQUEST_BYTES = 26 * 1024 * 1024
# Routes whose answer keeps its own Cache-Control. Only a site's logo image (/api/logos/<domain>): the list of known logos,
# a logo not found, and every other API answer stay no-store.
KEEPS_OWN_CACHING = frozenset({"logos_api.image"})


def create_app(engine: Engine | None = None, url_allowed: Callable[[str], bool] = is_public_url, screens_dir: str | Path | None = None, auth: bool = True, secret_key: str | None = None) -> Flask:
    from seo.core.db import make_engine
    from seo.metrics import backlink_traffic
    from seo.web.competitors_api import competitors_api
    from seo.web.health_api import health_api
    from seo.web.keywords_api import keywords_api
    from seo.web.links_api import links_api
    from seo.web.logos_api import logos_api
    from seo.web.metrics_api import metrics_api
    from seo.web.sources_api import sources_api
    from seo.web.tasks_api import tasks_api
    from seo.web.backlinks_api import backlinks_api
    from seo.web.uptime_api import uptime_api
    from seo.web.search_api import search_api
    from seo.web.insights_api import insights_api
    from seo.web.notifications_api import notifications_api
    from seo.web.exports_api import exports_api

    backlink_traffic.install()
    app = Flask(__name__, static_folder=None)
    app.config["ENGINE"] = engine if engine is not None else make_engine()
    app.config["URL_ALLOWED"] = url_allowed
    app.register_blueprint(links_api)
    app.register_blueprint(competitors_api)
    app.register_blueprint(keywords_api)
    app.register_blueprint(health_api)
    app.register_blueprint(logos_api)
    app.register_blueprint(tasks_api)
    app.register_blueprint(backlinks_api)
    app.register_blueprint(uptime_api)
    app.register_blueprint(sources_api)
    app.register_blueprint(metrics_api)
    app.register_blueprint(search_api)
    app.register_blueprint(insights_api)
    app.register_blueprint(notifications_api)
    app.register_blueprint(exports_api)
    app.config["AUTH_ON"] = auth
    if auth:
        from seo.core import crypto
        from seo.web.auth import install

        install(app, secret_key or crypto.derived_secret("session"), https=config.get("SEO_HTTPS", "") == "1")

    # The largest thing anyone sends is a note's file. Past that, nothing is read into memory.
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify(error=f"That upload is too large. The limit is {MAX_REQUEST_BYTES // (1024 * 1024)} MB."), 413

    @app.errorhandler(Refused)
    def refused(error: Refused):
        return jsonify(error=str(error)), error.http

    # One answer for every error under /api/: a sentence a person can read, never Flask's HTML page or a trace (F166).
    @app.errorhandler(Exception)
    def any_error(error: Exception):
        from flask import request
        from werkzeug.exceptions import HTTPException

        if isinstance(error, HTTPException):
            if request.path.startswith("/api/"):
                words = API_ERROR_WORDS.get(error.code or 500, "That didn't work. Try again.")
                return jsonify(error=words), error.code
            if error.code == 404 and screens_dir:
                return not_found_page(), 404
            return error
        app.logger.exception("Unhandled error on %s", request.path)
        if request.path.startswith("/api/"):
            return jsonify(error=API_ERROR_WORDS[500]), 500
        return error_page(), 500

    if screens_dir:
        folder = str(screens_dir)
        files = Path(folder)

        def versioned(page: str) -> str:
            """The page with ?v=<size and time of each file> on its scripts and styles, so a browser keeps them until a deploy changes them."""
            html = (files / page).read_text(encoding="utf-8")

            def stamp(match: re.Match) -> str:
                name = match.group(2)
                try:
                    info = (files / name).stat()
                except OSError:
                    return match.group(0)
                return f'{match.group(1)}="{name}?v={info.st_mtime_ns:x}{info.st_size:x}"'

            return re.sub(r'\b(src|href)="([\w./-]+\.(?:js|css))"', stamp, html)

        def html_answer(page: str):
            from flask import Response
            return Response(versioned(page), mimetype="text/html")

        @app.get("/")
        def index():
            return html_answer("index.html")

        @app.get("/boot.js")
        def boot():
            """Runs before the screens, so they know they're served and which sites are real, with no wait and no flash of sample data."""
            from flask import Response, g
            from sqlalchemy import text as sql

            from seo.accounts.service import team_names
            with app.config["ENGINE"].connect() as conn:
                sites = [dict(row) for row in conn.execute(sql("SELECT id, host FROM sites WHERE kind = 'own' ORDER BY host")).mappings().all()]
                today = conn.execute(sql("SELECT UTC_DATE()")).scalar().isoformat()
                conn_has_openrouter = conn.execute(sql("SELECT 1 FROM connections WHERE tool = 'OpenRouter'")).first()
            data = {"served": True, "today": today, "sites": sites, "team": team_names(app.config["ENGINE"]) if auth else [], "user": g.get("user"), "summaries_on": bool(conn_has_openrouter)}
            return Response(f"window.BOOT = {json.dumps(data).replace('<', chr(92) + 'u003c')};", mimetype="text/javascript")

        @app.get("/login")
        def login_page():
            return html_answer("login.html")

        @app.get("/<path:name>")
        def screen_file(name):
            return send_from_directory(folder, name)

    @app.after_request
    def caching(response):
        """The API, the pages and boot.js are never kept. A script or style asked for with ?v= is kept a year: its address changes
        with the file. Anything else is checked each time (an answer of 304 when it hasn't changed).
        One API answer keeps the header its route set: a site's logo (a day). With no-store, every redraw downloaded each logo again."""
        from flask import request
        path = request.path
        if request.endpoint in KEEPS_OWN_CACHING and response.status_code < 400 and "Cache-Control" in response.headers:
            return response
        if path.startswith("/api/") or path in ("/", "/login", "/boot.js") or path.endswith(".html") or response.status_code >= 400:
            response.headers["Cache-Control"] = "no-store"
        elif request.args.get("v"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response

    return app


API_ERROR_WORDS = {
    400: "Couldn't read that request. Reload and try again.",
    401: "Please sign in.",
    403: "You can't do that with this account.",
    404: "That address isn't part of the app.",
    405: "That address doesn't take this kind of request.",
    409: "Someone else changed this meanwhile. Reload and try again.",
    413: f"That upload is too large. The limit is {MAX_REQUEST_BYTES // (1024 * 1024)} MB.",
    429: "Too many requests. Try again in a minute.",
    500: "Something went wrong on the server. Try again, or tell your admin.",
    502: "The server didn't answer. Try again in a minute.",
    503: "Server busy. Try again in a minute.",
}

_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title_en} · SEO Command Center</title>
<style>
  :root {{ --bg:#f6f7f9; --card:#fff; --ink:#1f2937; --sec:#4b5563; --main:#1d4ed8; --on-main:#fff; color-scheme: light; }}
  @media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#0f141b; --card:#18202b; --ink:#e5e9f0; --sec:#aab4c3; --main:#6b9bff; --on-main:#0b1220; color-scheme: dark; }} }}
  :root[data-theme="dark"] {{ --bg:#0f141b; --card:#18202b; --ink:#e5e9f0; --sec:#aab4c3; --main:#6b9bff; --on-main:#0b1220; color-scheme: dark; }}
  body {{ margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; box-sizing:border-box; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
  main {{ width:min(420px,100%); background:var(--card); border-radius:16px; padding:28px; box-shadow:0 1px 3px rgb(0 0 0 / .08), 0 12px 32px rgb(0 0 0 / .06); }}
  h1 {{ font-size:20px; margin:0 0 8px; }} p {{ margin:0 0 20px; color:var(--sec); }}
  a {{ display:inline-flex; align-items:center; min-height:40px; padding:0 16px; border-radius:10px; background:var(--main); color:var(--on-main); text-decoration:none; font-weight:600; }}
  a:focus-visible {{ outline:3px solid var(--ink); outline-offset:2px; }}
</style></head>
<body><main><h1 id="t">{title_en}</h1><p id="s">{body_en}</p><a href="{root}" id="home">Go to Today</a></main>
<script>
(function () {{
  var get = function (k) {{ try {{ return localStorage.getItem("seocc2-" + k); }} catch (e) {{ return null; }} }};
  var theme = get("theme"); if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  if (get("lang") === "fr") {{
    document.documentElement.lang = "fr"; document.title = "{title_fr} · SEO Command Center";
    document.getElementById("t").textContent = "{title_fr}"; document.getElementById("s").textContent = "{body_fr}";
    document.getElementById("home").textContent = "Aller à Aujourd'hui";
  }}
}})();
</script></body></html>"""


def _root() -> str:
    from flask import request
    return (request.script_root or "") + "/"


def not_found_page() -> str:
    return _PAGE.format(root=_root(), 
        title_en="This page doesn't exist", body_en="The address may be mistyped, or the page was moved. Today has everything else.",
        title_fr="Cette page n'existe pas", body_fr="L'adresse est peut-être mal saisie, ou la page a été déplacée. Aujourd'hui donne accès à tout le reste.",
    )


def error_page() -> str:
    return _PAGE.format(root=_root(), 
        title_en="Something went wrong", body_en="The server couldn't show this page. Try again in a minute.",
        title_fr="Un problème est survenu", body_fr="Le serveur n'a pas pu afficher cette page. Réessayez dans une minute.",
    )
