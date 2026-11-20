"""Mediators, live checks of backlinks, and the numbers Today shows about them."""
from __future__ import annotations

import re

from flask import Blueprint, Response, current_app, jsonify, request

from seo.backlinks import boosts, bought, live, mediators, protect, reclaim, service, todo
from seo.imports import gsc_links
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


def _site_arg(value) -> int:
    raw = str(value if value is not None else "")
    if not re.fullmatch(r"[0-9]{1,18}", raw):
        raise Refused("site_id must be a number.")
    return int(raw)


@backlinks_api.post("/backlinks/gsc-import")
def gsc_import():
    """Search Console's Links export, uploaded by hand: its API has no Links data."""
    upload = request.files.get("file")
    if upload is None:
        raise Refused("Choose the file Search Console downloaded.")
    data = upload.read(gsc_links.MAX_BYTES + 1)
    return jsonify(gsc_links.import_file(_engine(), _site_arg(request.form.get("site_id")), upload.filename or "links.csv", data))


@backlinks_api.get("/backlinks/reclaim")
def reclaim_list():
    return jsonify(pages=reclaim.list_for_site(_engine(), _site_arg(request.args.get("site_id"))))


@backlinks_api.post("/backlinks/reclaim/<int:page_id>/dismiss")
def reclaim_dismiss(page_id: int):
    reclaim.dismiss(_engine(), page_id)
    return jsonify(ok=True)


@backlinks_api.post("/backlinks/<int:backlink_id>/disavow")
def disavow(backlink_id: int):
    return jsonify(protect.mark_disavow(_engine(), backlink_id, _body().get("disavow")))


@backlinks_api.get("/backlinks/disavow.txt")
def disavow_file():
    body, _ = protect.disavow_file(_engine(), _site_arg(request.args.get("site_id")))
    return Response(body, mimetype="text/plain; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="disavow.txt"'})


@backlinks_api.get("/backlinks/budget")
def budget_get():
    return jsonify(budget=protect.get_budget(_engine(), _site_arg(request.args.get("site_id"))))


@backlinks_api.put("/backlinks/budget")
def budget_set():
    body = _body()
    return jsonify(budget=protect.set_budget(_engine(), _site_arg(body.get("site_id")), body))


@backlinks_api.get("/backlinks/bought")
def bought_links():
    """Bought links: grouped by keyword, billed and real cost, Search Console position before → after."""
    return jsonify(bought.bought(_engine(), _site_arg(request.args.get("site_id"))))


@backlinks_api.get("/backlinks/boosts")
def boosts_list():
    return jsonify(boosts.listing(_engine(), _site_arg(request.args.get("site_id"))))


@backlinks_api.post("/backlinks/boosts")
def boosts_add():
    from flask import g

    user = g.get("user")
    return jsonify(boosts.add(_engine(), _body(), user["name"] if user else None)), 201


@backlinks_api.put("/backlinks/boosts/<int:boost_id>")
def boosts_update(boost_id: int):
    return jsonify(boosts.update(_engine(), boost_id, _body()))


@backlinks_api.delete("/backlinks/boosts/<int:boost_id>")
def boosts_delete(boost_id: int):
    boosts.delete(_engine(), boost_id)
    return jsonify(ok=True)


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
