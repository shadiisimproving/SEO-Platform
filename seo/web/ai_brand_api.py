"""AI search → What AI says: questions, the price first, a run on the owner's yes, and the answers. See seo/ai_brand/."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from seo.ai_brand import service
from seo.core.errors import Refused

ai_brand_api = Blueprint("ai_brand_api", __name__, url_prefix="/api/ai-brand")


def _engine():
    return current_app.config["ENGINE"]


def _site(value) -> int:
    if isinstance(value, bool):
        raise Refused("Pick one site.")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    raise Refused("Pick one site.")


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


@ai_brand_api.get("")
def overview():
    return jsonify(service.state(_engine(), _site(request.args.get("site_id"))))


@ai_brand_api.put("/brand")
def save_brand():
    body = _body()
    return jsonify(service.save_brand(_engine(), _site(body.get("site_id")), body.get("brand"), body.get("aliases")))


@ai_brand_api.post("/questions")
def add_question():
    body = _body()
    return jsonify(service.add_question(_engine(), _site(body.get("site_id")), body.get("text"), body.get("source") or "owner", body.get("rival_id"))), 201


@ai_brand_api.put("/questions/<int:brand_question_id>")
def edit_question(brand_question_id: int):
    return jsonify(service.edit_question(_engine(), brand_question_id, _body()))


@ai_brand_api.delete("/questions/<int:brand_question_id>")
def remove_question(brand_question_id: int):
    service.remove_question(_engine(), brand_question_id)
    return jsonify(ok=True)


@ai_brand_api.post("/suggest")
def suggest():
    return jsonify(service.suggestions(_engine(), _site(_body().get("site_id"))))


@ai_brand_api.post("/estimate")
def estimate():
    body = _body()
    return jsonify(service.estimate(_engine(), _site(body.get("site_id")), body.get("engines")))


@ai_brand_api.post("/runs")
def start():
    body = _body()
    user = g.get("user") or {}
    return jsonify(service.start(_engine(), _site(body.get("site_id")), body.get("engines"), user.get("id"))), 201


@ai_brand_api.get("/runs/<int:brand_run_id>")
def run(brand_run_id: int):
    return jsonify(service.run_dict(_engine(), brand_run_id))


@ai_brand_api.post("/runs/<int:brand_run_id>/check-site")
def check_site(brand_run_id: int):
    """"On your site?" again for every point of a run, after the site's pages were read again. Uses the site's AI when chosen."""
    service.check_site(_engine(), brand_run_id, again=True)
    return jsonify(service.run_dict(_engine(), brand_run_id))


@ai_brand_api.post("/read-pages")
def read_pages():
    """Reads the site's own pages now (free), so "On your site?" can check against them. Then Check again."""
    return jsonify(service.read_my_pages(_engine(), _site(_body().get("site_id")))), 202
