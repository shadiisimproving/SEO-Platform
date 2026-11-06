"""Links checker API. A scan is started from a site ID, never from an address.

POST /api/links/scan refuses any request carrying anything else, so a hand-written request
with a URL gets the same answer from the server as the screen would give.
"""
from __future__ import annotations

from flask import Blueprint, Response, current_app, jsonify, request

from seo.backlinks import logos
from seo.links import service
from seo.core.errors import Refused

links_api = Blueprint("links_api", __name__, url_prefix="/api")

SCAN_FIELDS = {"site_id", "check_external"}
SETTING_FIELDS = {"weekly", "check_external", "setup_not_used"}


def _engine():
    return current_app.config["ENGINE"]


def _json_body(allowed: set[str] | None = None) -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    if allowed is not None:
        extra = sorted(set(body) - allowed)
        if extra:
            raise Refused(f"Only {', '.join(sorted(allowed))} are accepted. This request also sent: {', '.join(extra)}.")
    return body


@links_api.get("/links/sites")
def list_own_sites():
    return jsonify(sites=service.own_sites(_engine()), seconds_per_page=service.SECONDS_PER_PAGE)


@links_api.post("/sites")
def add_site():
    body = _json_body({"address", "kind"})
    site = service.add_site(_engine(), body.get("address"), body.get("kind"), is_allowed=current_app.config["URL_ALLOWED"])
    logos.queue_for(_engine(), [site["host"]])  # its icon, for the site menu, read later by the crawl lane
    return jsonify(site), 201


@links_api.patch("/links/sites/<int:site_id>")
def update_site(site_id: int):
    body = _json_body(SETTING_FIELDS)
    return jsonify(service.update_settings(_engine(), site_id, **body))


@links_api.post("/links/scan")
def start_scan():
    if request.args:
        raise Refused(f"Only a site ID is accepted. This request also sent: {', '.join(sorted(request.args))}.")
    body = _json_body(SCAN_FIELDS)
    if "site_id" not in body:
        raise Refused("site_id is required.")
    scan_id = service.start_scan(_engine(), body["site_id"], body.get("check_external"))
    return jsonify(scan_id=scan_id), 202


@links_api.get("/links/sites/<int:site_id>/scans")
def scan_history(site_id: int):
    return jsonify(scans=service.list_scans(_engine(), site_id))


@links_api.get("/links/scans/<int:scan_id>")
def scan_detail(scan_id: int):
    return jsonify(service.get_scan(_engine(), scan_id))


@links_api.post("/links/scans/<int:scan_id>/stop")
def stop_scan(scan_id: int):
    service.stop_scan(_engine(), scan_id)
    return jsonify(ok=True)


@links_api.delete("/links/scans/<int:scan_id>")
def delete_scan(scan_id: int):
    service.delete_scan(_engine(), scan_id)
    return jsonify(ok=True)


@links_api.get("/links/scans/<int:scan_id>/export.csv")
def export_scan(scan_id: int):
    body = service.scan_csv(_engine(), scan_id)
    return Response(body, mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="links-scan-{scan_id}.csv"'})
