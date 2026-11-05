"""Uptime API: my own websites only, always from a site ID."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from seo.core.errors import Refused
from seo.uptime import service

uptime_api = Blueprint("uptime_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


@uptime_api.get("/uptime/sites")
def sites():
    return jsonify(service.sites(_engine()))


@uptime_api.post("/uptime/sites/<int:site_id>/check")
def check(site_id: int):
    return jsonify(queued=service.check_now(_engine(), site_id)), 202


@uptime_api.patch("/uptime/sites/<int:site_id>")
def update(site_id: int):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    extra = sorted(set(body) - {"watching", "domain_expires_on"})
    if extra:
        raise Refused(f"Only watching and domain_expires_on are accepted. This request also sent: {', '.join(extra)}.")
    return jsonify(service.update(_engine(), site_id, body))
