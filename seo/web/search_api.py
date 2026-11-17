"""Search → Overview: Search Console the way its own screen shows it. See seo/metrics/search.py."""
from __future__ import annotations

from datetime import date

from flask import Blueprint, current_app, g, jsonify, request

from seo.core.errors import Refused
from seo.imports import gsc_ai_report
from seo.metrics import search
from seo.metrics.service import Scope

search_api = Blueprint("search_api", __name__, url_prefix="/api/search")


def _engine():
    return current_app.config["ENGINE"]


def _site_id(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise Refused("Pick one site.") from exc


@search_api.get("/overview")
def overview():
    scope, window = search.scope_for(_engine(), request.args)
    return jsonify(search.overview(scope, window, fresh=request.args.get("fresh") == "1", page=request.args.get("only_page") or None))


@search_api.get("/breakdown")
def breakdown():
    scope, window = search.scope_for(_engine(), request.args)
    args = request.args
    # include_fresh=1 with an exact query or page filter: that row also counts the days not final yet (see search.breakdown).
    fresh_to = date.fromisoformat(window["fresh_to"]) if args.get("include_fresh") == "1" and window.get("fresh_to") else None
    return jsonify(search.breakdown(scope, args.get("dim", "query"), args.get("show", "all"), args.get("brand", "all"), search.filter_from(args), fresh_to=fresh_to))


@search_api.get("/opportunities")
def opportunities():
    scope, _window = search.scope_for(_engine(), request.args)
    return jsonify(search.opportunities(scope, request.args.get("kind", "almost")))


@search_api.get("/detail")
def detail():
    scope, _window = search.scope_for(_engine(), request.args)
    return jsonify(search.detail(scope, request.args.get("query") or None, request.args.get("page") or None))


@search_api.get("/brand")
def brand():
    from seo.metrics import service

    scope = Scope(_engine(), request.args.get("site_id"), "2000-01-01", "2000-01-01")
    return jsonify(service.rules(_engine(), "brand", scope.site_ids))


@search_api.post("/brand")
def add_brand():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return jsonify(search.add_brand_word(_engine(), body.get("site_id"), body.get("word"))), 201


@search_api.post("/verify")
def verify():
    body = request.get_json(silent=True) or {}
    site_id = _site_id(body.get("site_id"))
    if body.get("fix"):
        return jsonify(search.fix(_engine(), site_id)), 202
    return jsonify(search.verify(_engine(), site_id))


@search_api.post("/notes")
def add_note():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    user = g.get("user")
    return jsonify(search.add_note(_engine(), body.get("site_id"), body.get("day"), body.get("text"), user["id"] if user else None)), 201


@search_api.delete("/notes/<int:note_id>")
def delete_note(note_id: int):
    search.delete_note(_engine(), note_id)
    return jsonify(ok=True)


@search_api.get("/countries")
def target_countries():
    return jsonify(search.countries_setting(_engine(), request.args.get("site_id")))


@search_api.put("/countries")
def set_target_countries():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return jsonify(search.set_countries(_engine(), body.get("site_id"), body.get("countries")))


@search_api.post("/ai-report")
def upload_ai_report():
    """Search Console's generative AI report (AI Overviews and AI Mode), as its Export downloads it: a zip or CSV files."""
    if (request.content_length or 0) > gsc_ai_report.MAX_FILES * gsc_ai_report.MAX_BYTES + 65536:
        raise Refused("Too large together. Upload fewer at once.")
    files = [(upload.filename or "", upload.read(gsc_ai_report.MAX_BYTES + 1)) for upload in request.files.getlist("file")]
    user = g.get("user")
    return jsonify(gsc_ai_report.import_files(_engine(), request.form.get("site_id"), files, user["id"] if user else None)), 201


@search_api.get("/ai-report")
def ai_report():
    scope = Scope(_engine(), request.args.get("site_id"), "2000-01-01", "2000-01-01")
    return jsonify(gsc_ai_report.latest(_engine(), scope.site_ids))
