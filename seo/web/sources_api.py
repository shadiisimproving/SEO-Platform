"""Connections: pasted keys, tests and which site uses what. Keys only come in here. Only their last 4 characters ever go out."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import text

from seo.collectors import jobs
from seo.collectors.http import SourceError
from seo.core.errors import Refused
from seo.imports import clarity_archive, clarity_reports
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


@sources_api.post("/clarity-reports")
def import_clarity_reports():
    """Clarity's dashboard downloads, several CSVs at once. Send preview=1 first to see which site and period each one is."""
    require_admin()
    if (request.content_length or 0) > clarity_reports.MAX_FILES * clarity_reports.MAX_BYTES + 65536:
        raise Refused("Too large together. Upload fewer at once.")
    files = [(upload.filename or "", upload.read(clarity_reports.MAX_BYTES + 1)) for upload in request.files.getlist("file")]
    site = request.form.get("site_id") or None
    try:
        site_id = int(site) if site else None
    except ValueError as exc:
        raise Refused("That site isn't one of yours.") from exc
    user = getattr(g, "user", None)
    return jsonify(clarity_reports.import_files(
        _engine(), files, site_id=site_id, preview=request.form.get("preview") == "1", user_id=user["id"] if user else None,
    ))


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
    only = (request.get_json(silent=True) or {}).get("sources")
    if only is not None and (not isinstance(only, list) or not all(isinstance(x, str) and x in jobs.COLLECTORS for x in only)):
        raise Refused("sources must be a list of data sources, such as ga4 or clarity.")
    entries = jobs.collect_now_jobs(_engine(), site_id, only)
    # A full Refresh data also reads the site's own pages now, instead of waiting for the nightly read (owner, 2026-11-10).
    # "Refresh this one" names its sources, so it stays a data read only.
    pages = only is None and _queue_own_read(site_id)
    # And DuckDuckGo's positions, which have no site-owner tool to read (owner, 2026-11-11). Free tool only; keywords
    # checked lately are left out, so pressing it twice doesn't search twice.
    rankings = only is None and _queue_duckduckgo(site_id)
    return jsonify(started=[e["source"] for e in entries if e["new"]], jobs=entries, pages=pages, rankings=rankings), 202


def _queue_duckduckgo(site_id: int) -> bool:
    from seo.serp import auto_ddg

    return auto_ddg.queue_site(_engine(), site_id) is not None


def _queue_own_read(site_id: int) -> bool:
    from seo.competitors import suggest
    from seo.links import service as links_service

    with _engine().connect() as conn:
        kind = conn.execute(text("SELECT kind FROM sites WHERE id = :s"), {"s": site_id}).scalar()
    if kind != links_service.OWN:
        return False
    suggest.queue_crawl(_engine(), site_id)
    return True


@sources_api.get("/collect-jobs")
def collect_jobs():
    """Where the reads started by Refresh data are, so the screen redraws when they finish, not after a guess."""
    raw = [part for part in request.args.get("ids", "").split(",") if part.strip()]
    if len(raw) > 100 or not all(part.strip().isdigit() for part in raw):
        raise Refused("ids must be up to 100 job numbers, separated by commas.")
    return jsonify(jobs=jobs.job_states(_engine(), [int(part) for part in raw]))


@sources_api.put("/app-keys/<source>")
def save_key(source: str):
    require_admin()
    saved = service.save_app_key(_engine(), source, _body().get("key"))
    if source == "ahrefs":
        from seo.backlinks import ahrefs  # read the linking websites' traffic now, not at the next nightly run
        ahrefs.enqueue(_engine())
    return jsonify(saved)


@sources_api.post("/app-keys/<source>/test")
def test_key(source: str):
    require_admin()
    return jsonify(service.test_app_key(_engine(), source))


@sources_api.delete("/app-keys/<source>")
def remove_key(source: str):
    require_admin()
    service.remove_app_key(_engine(), source)
    return jsonify(ok=True)
