"""The web app: its APIs, and the screens when a folder is given. Login guards everything, unless a test switches it off."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from flask import Flask, jsonify, send_from_directory
from sqlalchemy import Engine

from seo import config
from seo.core.errors import Refused
from seo.crawl.guard import is_public_url


MAX_REQUEST_BYTES = 26 * 1024 * 1024


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

    if screens_dir:
        folder = str(screens_dir)

        @app.get("/")
        def index():
            return send_from_directory(folder, "index.html")

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
            return send_from_directory(folder, "login.html")

        @app.get("/<path:name>")
        def screen_file(name):
            return send_from_directory(folder, name)

        @app.after_request
        def no_cache(response):
            response.headers["Cache-Control"] = "no-store"
            return response

    return app
