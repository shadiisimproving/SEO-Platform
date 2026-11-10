"""The bell: GET the newest notifications with the unread count, mark one or all read. See seo/notifications/."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from seo.notifications import service

notifications_api = Blueprint("notifications_api", __name__, url_prefix="/api/notifications")


def _engine():
    return current_app.config["ENGINE"]


def _user() -> int | None:
    user = g.get("user")
    return user["id"] if user else None


@notifications_api.get("")
def listing():
    return jsonify(service.listing(_engine(), request.args.get("site_id"), _user()))


@notifications_api.post("/<int:notification_id>/read")
def read(notification_id: int):
    body = request.get_json(silent=True) or {}
    service.mark(_engine(), notification_id, body.get("read", True), _user())
    return jsonify(ok=True)


@notifications_api.post("/read-all")
def read_all():
    body = request.get_json(silent=True) or {}
    return jsonify(marked=service.mark_all(_engine(), body.get("site_id"), _user()))
