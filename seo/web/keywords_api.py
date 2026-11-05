"""Keywords, Refresh, and the tools behind them."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from seo.core.errors import Refused
from seo.serp import connections, rankings, refresh
from seo.web.auth import require_admin

keywords_api = Blueprint("keywords_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


def _site_arg(required: bool = False) -> int | None:
    value = request.args.get("site_id", "")
    if value.isdigit() and len(value) <= 18:
        return int(value)
    if required:
        raise Refused("site_id is required.")
    return None


def _me() -> str | None:
    user = g.get("user")
    return user["name"] if user else None


@keywords_api.get("/rankings")
def listing():
    return jsonify(rankings.listing(_engine(), _site_arg()))


@keywords_api.get("/rankings/queries")
def queries():
    return jsonify(rankings.queries(_engine(), _site_arg(), request.args.get("engine", "google")))


@keywords_api.get("/rankings/<int:keyword_id>")
def detail(keyword_id: int):
    return jsonify(rankings.detail(_engine(), _site_arg(True), keyword_id, request.args.get("engine", "google")))


@keywords_api.delete("/rankings/<int:keyword_id>")
def forget(keyword_id: int):
    rankings.forget(_engine(), _site_arg(True), keyword_id)
    return jsonify(ok=True)


@keywords_api.post("/rankings/<int:keyword_id>/restore")
def restore(keyword_id: int):
    rankings.follow_again(_engine(), _site_arg(True), keyword_id)
    return jsonify(ok=True)


# ---- Refresh ------------------------------------------------------------------------------------------

@keywords_api.post("/refresh/preview")
def preview():
    return jsonify(refresh.preview(_engine(), _body()))


@keywords_api.post("/refresh/runs")
def start():
    return jsonify(refresh.start(_engine(), _body(), _me())), 202


@keywords_api.get("/refresh/runs")
def active():
    return jsonify(runs=refresh.active_runs(_engine()))


@keywords_api.get("/refresh/runs/<int:run_id>")
def run(run_id: int):
    return jsonify(refresh.run_dict(_engine(), run_id))


@keywords_api.post("/refresh/runs/<int:run_id>/cancel")
def cancel(run_id: int):
    return jsonify(refresh.cancel(_engine(), run_id))


# ---- tools --------------------------------------------------------------------------------------------

@keywords_api.get("/tools")
def tools():
    return jsonify(connections.tool_list(_engine()))


@keywords_api.put("/tools/order")
def order():
    require_admin()
    body = _body()
    return jsonify(order=connections.set_order(_engine(), body.get("engine"), body.get("order")))


@keywords_api.patch("/tools/settings")
def settings():
    require_admin()
    body = _body()
    return jsonify(settings={name: connections.save_setting(_engine(), name, value) for name, value in body.items()})


@keywords_api.put("/tools/<tool>/paid")
def paid(tool: str):
    require_admin()
    return jsonify(paid_on=connections.set_paid(_engine(), tool, _body().get("on")))


@keywords_api.post("/tools/<tool>/test")
def test(tool: str):
    require_admin()
    return jsonify(connections.test_tool(_engine(), tool))
