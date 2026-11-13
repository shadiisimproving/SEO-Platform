"""Tasks API: the board the whole team shares."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from seo.core.errors import Refused
from seo.tasks import options, service

tasks_api = Blueprint("tasks_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


@tasks_api.get("/tasks")
def tasks():
    return jsonify(tasks=service.list_tasks(_engine()))


@tasks_api.post("/tasks")
def create():
    return jsonify(service.create(_engine(), _body(), by=g.user["name"] if g.get("user") else None)), 201


@tasks_api.patch("/tasks/<int:task_id>")
def update(task_id: int):
    return jsonify(service.update(_engine(), task_id, _body()))


@tasks_api.delete("/tasks/<int:task_id>")
def delete(task_id: int):
    service.delete(_engine(), task_id)
    return jsonify(ok=True)


@tasks_api.post("/tasks/<int:task_id>/restore")
def restore(task_id: int):
    return jsonify(service.restore(_engine(), task_id))


@tasks_api.post("/tasks/<int:task_id>/comments")
def comment(task_id: int):
    body = _body()
    # Signed in, a comment carries the account's name, whatever was sent.
    name = g.user["name"] if g.get("user") else body.get("name")
    return jsonify(service.add_comment(_engine(), task_id, body.get("text"), name))


@tasks_api.get("/tasks/options")
def task_options():
    """What a task can be about, for one of my sites."""
    raw = request.args.get("site_id", "")
    if not raw.isdigit():
        raise Refused("site_id must be a number.")
    return jsonify(options.for_site(_engine(), int(raw)))
