"""Connections: pasted keys, tests and which site uses what. Keys only come in here. Only their last 4 characters ever go out."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from seo.collectors import jobs
from seo.collectors.http import SourceError
from seo.core.errors import Refused
from seo.imports import clarity_archive
from seo.sources import service
from seo.web.auth import require_admin

sources_api = Blueprint("sources_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


@sources_api.get("/sources")
def overview():
    return jsonify(service.overview(_engine()))


@sources_api.post("/clarity-archive")
def import_clarity_archive():
    """The old Clarity data, once. Send preview=1 first to see what it would add."""
    require_admin()
    # Checked before the form is read, so an oversized upload never gets written anywhere. The margin is the form's own wrapping.
    if (request.content_length or 0) > clarity_archive.MAX_BYTES + 4096:
        raise Refused(f"The file is too large. The limit is {clarity_archive.MAX_BYTES // (1024 * 1024)} MB.")
    upload = request.files.get("file")
    if upload is None:
        raise Refused("Choose the file first.")
    data = clarity_archive.read_upload(upload.filename or "", upload.read(clarity_archive.MAX_BYTES + 1))
    return jsonify(clarity_archive.import_archive(_engine(), data, preview=request.form.get("preview") == "1"))


@sources_api.post("/google-connections")
def add_google():
    require_admin()
    body = _body()
    return jsonify(service.add_google(_engine(), body.get("label"), body.get("kind"), body.get("key"))), 201


@sources_api.post("/google-connections/<int:connection_id>/test")
def test_google(connection_id: int):
    require_admin()
    return jsonify(service.test_google(_engine(), connection_id))


@sources_api.delete("/google-connections/<int:connection_id>")
def remove_google(connection_id: int):
    require_admin()
    service.remove_google(_engine(), connection_id)
    return jsonify(ok=True)


@sources_api.put("/sites/<int:site_id>/sources/<source>")
def save_source(site_id: int, source: str):
    require_admin()
    return jsonify(service.save_site_source(_engine(), site_id, source, _body()))


@sources_api.post("/sites/<int:site_id>/collect")
def collect(site_id: int):
    return jsonify(started=jobs.collect_now(_engine(), site_id)), 202


@sources_api.put("/app-keys/<source>")
def save_key(source: str):
    require_admin()
    return jsonify(service.save_app_key(_engine(), source, _body().get("key")))


@sources_api.post("/app-keys/<source>/test")
def test_key(source: str):
    require_admin()
    return jsonify(service.test_app_key(_engine(), source))


@sources_api.delete("/app-keys/<source>")
def remove_key(source: str):
    require_admin()
    service.remove_app_key(_engine(), source)
    return jsonify(ok=True)
