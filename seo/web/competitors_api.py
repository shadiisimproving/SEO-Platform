"""Competitors API: keyword lists, suggestions, profiles, page pairs, link gaps, AI Overview watch and notes.

Everything is asked for from one of my own sites, by ID. A competitor is only reachable through a site
that watches it.
"""
from __future__ import annotations

import re

from flask import Blueprint, current_app, g, jsonify, request, send_file

from seo.backlinks import service as backlinks
from seo.backlinks.cleaner import CleanerError, check_upload
from seo.competitors import ai_watch, collective, gaps, keywords, notes, pairs, profile, suggest, tracking
from seo.core.errors import Refused
from seo.serp import connections
from seo.web.auth import require_admin

competitors_api =Blueprint("competitors_api", __name__, url_prefix="/api")


@competitors_api.errorhandler(CleanerError)
def bad_file(error: CleanerError):
    return jsonify(error=str(error), headers=getattr(error, "headers", None), code=error.code), 400


def _engine():
    return current_app.config["ENGINE"]


def _allowed():
    return current_app.config["URL_ALLOWED"]


def _body(allowed: set[str], required: tuple[str, ...] = ()) -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    extra = sorted(set(body) - allowed)
    if extra:
        raise Refused(f"Only {', '.join(sorted(allowed))} are accepted. This request also sent: {', '.join(extra)}.")
    for name in required:
        if body.get(name) in (None, ""):
            raise Refused(f"{name} is required.")
    return body


def _number(value) -> int | None:
    return int(value) if isinstance(value, str) and re.fullmatch(r"[0-9]{1,18}", value) else None


def _site_arg() -> int:
    value = _number(request.args.get("site_id"))
    if value is None:
        raise Refused("site_id is required.")
    return value


# ---- keyword lists -----------------------------------------------------------------------------

@competitors_api.post("/keywords/upload")
def upload_keywords():
    if request.files.get("file"):
        file = request.files["file"]
        form = request.form
        site_id = _number(form.get("site_id"))
        if site_id is None:
            raise Refused("site_id is required.")
        data = file.read()
        check_upload(file.filename or "", len(data))  # a spreadsheet read as text would turn into junk keywords, and spend free checks on them
        run = keywords.upload(_engine(), site_id, data, form.get("country", ""), form.get("language", ""), file.filename)
    else:
        body = _body({"site_id", "text", "country", "language"}, ("site_id", "text"))
        run = keywords.upload(_engine(), body["site_id"], body["text"], body.get("country", ""), body.get("language", ""))
    return jsonify(run), 202


@competitors_api.post("/keywords/refresh")
def refresh_keywords():
    body = _body({"site_id"}, ("site_id",))
    return jsonify(keywords.refresh(_engine(), body["site_id"])), 202


@competitors_api.get("/keywords/runs/<int:run_id>")
def keyword_run(run_id: int):
    return jsonify(keywords.run_dict(_engine(), run_id))


# ---- the list of competitors and suggestions --------------------------------------------------

@competitors_api.get("/competitors")
def list_competitors():
    site_id = _site_arg()
    return jsonify(competitors=tracking.apply_to_overview(_engine(), site_id, profile.overview(_engine(), site_id)))


@competitors_api.post("/competitors")
def add_competitor():
    body = _body({"site_id", "address"}, ("site_id", "address"))
    return jsonify(suggest.add_competitor(_engine(), body["site_id"], body["address"], "manual", _allowed())), 201


@competitors_api.post("/competitors/many")
def add_many_competitors():
    body = _body({"site_id", "addresses"}, ("site_id", "addresses"))
    return jsonify(suggest.add_many(_engine(), body["site_id"], body["addresses"], _allowed())), 200


@competitors_api.put("/competitors/<int:competitor_id>/tracking")
def set_tracking(competitor_id: int):
    body = _body({"site_id", "tracking"}, ("site_id", "tracking"))
    return jsonify(tracking.set_tracking(_engine(), body["site_id"], competitor_id, body["tracking"]))


@competitors_api.delete("/competitors/<int:competitor_id>")
def remove_competitor(competitor_id: int):
    suggest.remove_competitor(_engine(), _site_arg(), competitor_id)
    return jsonify(ok=True)


def _optional_site_arg() -> int | None:
    """Missing means all my sites. Anything else must be a number, and one of my own."""
    return None if request.args.get("site_id") is None else _site_arg()


@competitors_api.get("/collective/rivals")
def collective_rivals():
    return jsonify(collective.rivals(_engine(), _optional_site_arg()))


@competitors_api.get("/collective/keywords")
def collective_keywords():
    return jsonify(collective.keywords(_engine(), _optional_site_arg()))


@competitors_api.get("/collective/moves")
def collective_moves():
    return jsonify(collective.moves(_engine(), _optional_site_arg()))


@competitors_api.get("/collective/links")
def collective_links():
    return jsonify(collective.links(_engine(), _optional_site_arg()))


@competitors_api.get("/competitors/suggestions")
def list_suggestions():
    return jsonify(suggest.suggestions(_engine(), _site_arg()))


@competitors_api.post("/competitors/suggestions/<action>")
def decide_suggestion(action: str):
    body = _body({"site_id", "domain"}, ("site_id", "domain"))
    if action == "accept":
        return jsonify(suggest.accept(_engine(), body["site_id"], body["domain"], _allowed()))
    if action == "dismiss":
        suggest.dismiss(_engine(), body["site_id"], body["domain"])
    elif action == "restore":
        suggest.restore(_engine(), body["site_id"], body["domain"])
    else:
        raise Refused("Accept, dismiss or restore.")
    return jsonify(ok=True)


@competitors_api.get("/competitors/<int:competitor_id>/profile")
def competitor_profile(competitor_id: int):
    site_id = _site_arg()
    return jsonify(tracking.apply_to_profile(_engine(), site_id, profile.profile(_engine(), site_id, competitor_id)))


@competitors_api.post("/competitors/<int:competitor_id>/crawl")
def crawl_now(competitor_id: int):
    with _engine().connect() as conn:
        site_id = _site_arg()
        pairs._competitor(conn, site_id, competitor_id)
        if tracking.of_site(conn, site_id).get(competitor_id) == tracking.OFF:
            raise Refused("Tracking is off for this competitor, so its pages aren't read. Turn it on, or to Pages only, first.")
    suggest.queue_crawl(_engine(), competitor_id)
    return jsonify(ok=True), 202


# ---- page against page --------------------------------------------------------------------------

@competitors_api.get("/page-pairs")
def list_pairs():
    return jsonify(pairs=pairs.list_pairs(_engine(), _site_arg(), _number(request.args.get("competitor_id")), request.args.get("include_hidden") == "1"))


@competitors_api.post("/page-pairs")
def create_pair():
    body = _body({"site_id", "competitor_id", "my_url", "their_url"}, ("site_id", "competitor_id", "my_url", "their_url"))
    return jsonify(pairs.create_pair(_engine(), body["site_id"], body["competitor_id"], body["my_url"], body["their_url"])), 201


@competitors_api.get("/page-pairs/<int:pair_id>")
def pair_detail(pair_id: int):
    return jsonify(pairs.pair_detail(_engine(), pair_id))


@competitors_api.patch("/page-pairs/<int:pair_id>")
def update_pair(pair_id: int):
    return jsonify(pairs.update_pair(_engine(), pair_id, **_body({"my_url", "their_url", "hidden"})))


@competitors_api.post("/page-pairs/<int:pair_id>/automatic")
def pair_automatic(pair_id: int):
    return jsonify(pairs.back_to_automatic(_engine(), pair_id))


@competitors_api.post("/page-pairs/<int:pair_id>/read")
def read_pair(pair_id: int):
    pairs.queue_reads(_engine(), pair_id)
    return jsonify(ok=True), 202


@competitors_api.get("/sites/<int:site_id>/pages")
def site_pages(site_id: int):
    return jsonify(pages=pairs.page_options(_engine(), site_id))


# ---- link gaps ------------------------------------------------------------------------------------

@competitors_api.get("/link-gaps")
def list_gaps():
    return jsonify(gaps.link_gaps(_engine(), _site_arg()))


@competitors_api.post("/link-gaps/import")
def import_gaps():
    file = request.files.get("file")
    form = request.form
    if file is None:
        raise Refused("Choose a CSV file.")
    site_id, competitor_id = _number(form.get("site_id")), _number(form.get("competitor_id"))
    if site_id is None or competitor_id is None:
        raise Refused("site_id and competitor_id are required.")
    return jsonify(gaps.import_referrers(_engine(), site_id, competitor_id, file.read(), file.filename or "file.csv"))


@competitors_api.post("/link-gaps/decide")
def decide_gap():
    body = _body({"site_id", "domain", "decision"}, ("site_id", "domain", "decision"))
    gaps.decide(_engine(), body["site_id"], body["domain"], body["decision"])
    return jsonify(ok=True)


@competitors_api.post("/link-gaps/edit")
def edit_gap():
    body = _body({"domain", "authority", "authority_label", "sample_url", "add_competitors", "remove_competitors"}, ("domain",))
    gaps.save_edit(_engine(), by=g.user["name"] if g.get("user") else None, **body)
    return jsonify(ok=True)


@competitors_api.post("/link-gaps/add-domain")
def add_gap_domain():
    body = _body({"domain", "competitors", "authority", "authority_label", "sample_url"}, ("domain",))
    return jsonify(gaps.add_domain(_engine(), by=g.user["name"] if g.get("user") else None, **body))


@competitors_api.post("/link-gaps/edit/reset")
def reset_gap_edit():
    body = _body({"domain"}, ("domain",))
    gaps.reset_edit(_engine(), body["domain"])
    return jsonify(ok=True)


@competitors_api.post("/link-gaps/add")
def add_gaps():
    body = _body({"site_id", "domains"}, ("site_id", "domains"))
    return jsonify(gaps.add_to_prospects(_engine(), body["site_id"], body["domains"]))


@competitors_api.get("/prospects")
def list_prospects():
    return jsonify(prospects=gaps.list_prospects(_engine(), _site_arg()))


@competitors_api.post("/prospects")
def add_prospects():
    """Links chosen from a CSV. /link-gaps/add is the other way in, for domains on the gap list."""
    body = _body({"site_id", "rows", "file", "authority_label"}, ("site_id",))
    return jsonify(gaps.add_csv_prospects(_engine(), body["site_id"], body.get("rows"), body.get("file"), body.get("authority_label")))


@competitors_api.post("/prospects/remove")
def remove_prospects():
    body = _body({"ids"}, ("ids",))
    return jsonify(removed=gaps.remove_prospects(_engine(), body["ids"]))


@competitors_api.patch("/prospects/<int:prospect_id>")
def update_prospect(prospect_id: int):
    body = _body({"owner", "stage", "rating"})
    extra = {"rating": body["rating"]} if "rating" in body else {}
    gaps.update_prospect(_engine(), prospect_id, body.get("owner"), body.get("stage"), **extra)
    return jsonify(ok=True)


@competitors_api.delete("/prospects/<int:prospect_id>")
def delete_prospect(prospect_id: int):
    gaps.delete_prospect(_engine(), prospect_id)
    return jsonify(ok=True)


@competitors_api.post("/backlinks")
def log_backlink():
    body = _body({"site_id", "source_url", "status"}, ("site_id", "source_url"))
    return jsonify(gaps.log_backlink(_engine(), body["site_id"], body["source_url"], body.get("status", "live"))), 201


@competitors_api.get("/backlinks")
def list_backlinks():
    return jsonify(backlinks=backlinks.list_for_site(_engine(), _site_arg()))


@competitors_api.post("/backlinks/bulk")
def save_backlinks():
    answer = backlinks.save_many(_engine(), _body({"rows"}, ("rows",))["rows"])
    return jsonify(answer), 201 if answer["saved"] else 200


@competitors_api.put("/backlinks/<int:backlink_id>")
def update_backlink(backlink_id: int):
    return jsonify(backlinks.update_one(_engine(), backlink_id, _body(set(backlinks.ROW_FIELDS))))


@competitors_api.post("/backlinks/<int:backlink_id>/ignore")
def ignore_backlink(backlink_id: int):
    return jsonify(backlinks.ignore_found(_engine(), backlink_id, _body({"ignored"}, ("ignored",)).get("ignored")))


@competitors_api.delete("/backlinks/<int:backlink_id>")
def delete_backlink(backlink_id: int):
    backlinks.delete_one(_engine(), backlink_id)
    return jsonify(ok=True)


# ---- AI Overview watch ------------------------------------------------------------------------------

@competitors_api.get("/ai-watch")
def ai_overview_watch():
    return jsonify(ai_watch.watch(_engine(), _site_arg()))


# ---- notes ---------------------------------------------------------------------------------------------

@competitors_api.get("/notes")
def list_notes():
    return jsonify(notes=notes.list_notes(_engine(), request.args.get("scope") or None, _number(request.args.get("competitor_id")), request.args.get("page_url") or None, _number(request.args.get("site_id")), request.args.get("screen") or None))


@competitors_api.post("/notes")
def create_note():
    body = _body({"scope", "body", "site_id", "competitor_id", "page_url", "screen"}, ("scope",))
    return jsonify(notes.create(_engine(), body["scope"], body.get("body", ""), body.get("site_id"), body.get("competitor_id"), body.get("page_url"), body.get("screen"))), 201


@competitors_api.patch("/notes/<int:note_id>")
def update_note(note_id: int):
    return jsonify(notes.update(_engine(), note_id, _body({"body"}).get("body")))


@competitors_api.delete("/notes/<int:note_id>")
def delete_note(note_id: int):
    notes.delete(_engine(), note_id)
    return jsonify(ok=True)


@competitors_api.post("/notes/<int:note_id>/restore")
def restore_note(note_id: int):
    return jsonify(notes.restore(_engine(), note_id))


@competitors_api.post("/notes/<int:note_id>/files")
def add_note_file(note_id: int):
    # Checked before the form is read, so an oversized upload never gets written anywhere.
    if request.content_length is None or request.content_length > notes.MAX_FILE_BYTES + notes.UPLOAD_OVERHEAD:
        raise Refused(notes.TOO_LARGE)
    upload = request.files.get("file")
    if upload is None:
        raise Refused("Choose a file to add.")
    return jsonify(notes.add_file(_engine(), note_id, upload.filename, upload.stream)), 201


@competitors_api.get("/note-files/<int:file_id>")
def note_file(file_id: int):
    found = notes.get_file(_engine(), file_id)
    image = found["image_type"]
    reply = send_file(found["path"], mimetype=image or "application/octet-stream", as_attachment=not image, download_name=found["name"], conditional=True, max_age=0)
    reply.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    reply.headers["Cache-Control"] = "private, no-cache"
    return reply


@competitors_api.delete("/note-files/<int:file_id>")
def delete_note_file(file_id: int):
    notes.delete_file(_engine(), file_id)
    return jsonify(ok=True)


@competitors_api.post("/note-files/<int:file_id>/restore")
def restore_note_file(file_id: int):
    return jsonify(notes.restore_file(_engine(), file_id))


# ---- search tool keys ----------------------------------------------------------------------------------

@competitors_api.get("/connections/<tool>")
def connection_status(tool: str):
    return jsonify(connections.status(_engine(), tool))


@competitors_api.put("/connections/<tool>")
def connection_save(tool: str):
    require_admin()
    body = _body({"key", "zone"})
    saved = connections.save_key(_engine(), tool, body.get("key", ""), zone=body.get("zone"))
    keywords.resume_waiting(_engine())  # lists that were waiting for a tool carry on
    return jsonify(saved)


@competitors_api.delete("/connections/<tool>")
def connection_remove(tool: str):
    require_admin()
    connections.remove_key(_engine(), tool)
    return jsonify(ok=True)
