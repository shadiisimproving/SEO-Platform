"""Search → Insights: what the code found in Search Console data. See seo/insights/."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from seo.core.errors import Refused
from seo.insights import engine as insights_engine, service

insights_api = Blueprint("insights_api", __name__, url_prefix="/api/insights")


def _engine():
    return current_app.config["ENGINE"]


@insights_api.get("")
def listing():
    args = request.args
    return jsonify(service.listing(_engine(), args.get("site_id"), args.get("group", "first"), args.get("status", "open")))


@insights_api.get("/<int:finding_id>")
def one(finding_id: int):
    return jsonify(service.one(_engine(), finding_id))


@insights_api.post("/<int:finding_id>/dismiss")
def dismiss(finding_id: int):
    body = request.get_json(silent=True) or {}
    return jsonify(service.dismiss(_engine(), finding_id, undo=bool(body.get("undo"))))


@insights_api.post("/run")
def run():
    """Run again now, for one site: the first time after setup, or after changing brand words. It reads saved days only."""
    body = request.get_json(silent=True) or {}
    sites = service._sites(_engine(), body.get("site_id"))
    if not sites:
        raise Refused("Add a site first.")
    return jsonify([insights_engine.run(_engine(), site_id) for site_id in sites])
