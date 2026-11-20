"""Content → Content tracker: the published pieces, one piece's months, and what a person sets on a piece."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from seo.content import tracker
from seo.core.errors import Refused
from seo.metrics import service as metrics

content_api = Blueprint("content_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


@content_api.get("/content/tracker")
def listing():
    args = request.args
    scope = metrics.Scope(_engine(), args.get("site_id"), args.get("from"), args.get("to"), args.get("compare_from"), args.get("compare_to"))
    return jsonify(tracker.listing(scope))


@content_api.get("/content/tracker/piece")
def piece():
    raw = request.args.get("site_id", "")
    if not raw.isdigit():
        raise Refused("site_id must be a number.")
    return jsonify(tracker.detail(_engine(), int(raw), request.args.get("page", ""), request.args.get("query") or None))


@content_api.post("/content/tracker")
def save():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return jsonify(tracker.save(_engine(), body, by=g.user["name"] if g.get("user") else None))
