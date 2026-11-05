"""Mediators, live checks of backlinks, and the numbers Today shows about them."""
from __future__ import annotations

import re

from flask import Blueprint, current_app, jsonify, request

from seo.backlinks import live, mediators, service, todo
from seo.competitors.keywords import require_own
from seo.core.errors import Refused

backlinks_api = Blueprint("backlinks_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


@backlinks_api.get("/backlinks/summary")
def summary():
    raw = request.args.get("site_id")
    if raw in (None, ""):
        return jsonify(live.summary(_engine()))
    if not re.fullmatch(r"[0-9]{1,18}", raw):
        raise Refused("site_id must be a number.")
    with _engine().connect() as conn:
        require_own(conn, int(raw))
    return jsonify(live.summary(_engine(), int(raw)))


@backlinks_api.get("/backlinks/<int:backlink_id>")
def one(backlink_id: int):
    return jsonify(service.get_one(_engine(), backlink_id))


@backlinks_api.post("/backlinks/<int:backlink_id>/check")
def check(backlink_id: int):
    return jsonify(queued=live.check_now(_engine(), backlink_id)), 202


@backlinks_api.get("/backlinks/<int:backlink_id>/checks")
def checks(backlink_id: int):
    return jsonify(checks=live.history(_engine(), backlink_id))


@backlinks_api.post("/backlinks/todo/move")
def todo_move():
    body = _body()
    return jsonify(todo.move_prospects(_engine(), body.get("prospect_ids"), body.get("mediator"), body.get("link_type")))


@backlinks_api.post("/backlinks/todo/move-back")
def todo_move_back():
    body = _body()
    return jsonify(todo.move_back(_engine(), body.get("ids"), body.get("details")))


@backlinks_api.post("/backlinks/todo/sent")
def todo_sent():
    body = _body()
    return jsonify(todo.mark_sent(_engine(), body.get("ids"), body.get("sent")))


@backlinks_api.patch("/backlinks/<int:backlink_id>/todo")
def todo_update(backlink_id: int):
    return jsonify(saved=todo.update(_engine(), backlink_id, _body()))


@backlinks_api.post("/backlinks/<int:backlink_id>/placed")
def todo_placed(backlink_id: int):
    return jsonify(todo.mark_placed(_engine(), backlink_id, _body().get("live_url")))


@backlinks_api.get("/mediators")
def list_mediators():
    return jsonify(mediators=mediators.list_all(_engine()))


@backlinks_api.post("/mediators")
def create_mediator():
    return jsonify(mediators.create(_engine(), _body())), 201


@backlinks_api.patch("/mediators/<int:mediator_id>")
def update_mediator(mediator_id: int):
    return jsonify(mediators.update(_engine(), mediator_id, _body()))
