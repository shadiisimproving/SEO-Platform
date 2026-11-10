"""Site health API: the monthly test and its alerts. A test starts from a site ID, never from an address."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from seo.core.errors import Refused
from seo.health import indexing as page_indexing  # also registers the indexing check's job handler
from seo.health import service

health_api = Blueprint("health_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


def _body(allowed: set[str]) -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    extra = sorted(set(body) - allowed)
    if extra:
        raise Refused(f"Only {', '.join(sorted(allowed))} are accepted. This request also sent: {', '.join(extra)}.")
    return body


@health_api.get("/health/sites")
def sites():
    return jsonify(sites=service.sites(_engine()))


@health_api.patch("/health/sites/<int:site_id>")
def settings(site_id: int):
    return jsonify(service.update_settings(_engine(), site_id, **_body({"monthly"})))


@health_api.post("/health/audit")
def start():
    if request.args:
        raise Refused(f"Only a site ID is accepted. This request also sent: {', '.join(sorted(request.args))}.")
    body = _body({"site_id"})
    return jsonify(audit_id=service.start(_engine(), body.get("site_id"))), 202


@health_api.get("/health/sites/<int:site_id>/indexing")
def indexing(site_id: int):
    return jsonify(page_indexing.summary(_engine(), site_id))


@health_api.post("/health/sites/<int:site_id>/indexing")
def indexing_now(site_id: int):
    page_indexing.summary(_engine(), site_id)  # refuses a site that isn't mine
    return jsonify(queued=page_indexing.enqueue(_engine(), site_id)), 202


@health_api.get("/health/sites/<int:site_id>/audits")
def history(site_id: int):
    return jsonify(audits=service.history(_engine(), site_id))


@health_api.get("/health/audits/<int:audit_id>")
def detail(audit_id: int):
    return jsonify(service.detail(_engine(), audit_id))


@health_api.post("/health/audits/<int:audit_id>/stop")
def stop(audit_id: int):
    service.stop(_engine(), audit_id)
    return jsonify(ok=True)


@health_api.get("/alerts")
def alerts():
    return jsonify(alerts=service.alerts(_engine()))


@health_api.post("/alerts/<int:alert_id>/seen")
def seen(alert_id: int):
    service.acknowledge(_engine(), alert_id, _body({"seen"}).get("seen", True) if request.data else True)
    return jsonify(ok=True)
