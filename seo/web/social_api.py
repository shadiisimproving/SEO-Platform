"""Social: the owner's screen (signed in), and the four routes the outside helpers use with the site's token.

The helpers (the Claude Code writing task in Anthropic's cloud, a Grok run elsewhere) never sign in: they send
`Authorization: Bearer scs_...`. The token only opens /api/social/bot/*, for its own site, and nothing else.
"""
from __future__ import annotations

import threading
import time
from datetime import date

from flask import Blueprint, current_app, g, jsonify, request

from seo.core.errors import Refused
from seo.social import service, skill

social_api = Blueprint("social_api", __name__, url_prefix="/api/social")
BOT_PREFIX = "/api/social/bot/"
BOT_MAX_BYTES = 512 * 1024
BOT_PER_MINUTE = 30
_calls: dict[int, list[float]] = {}
_lock = threading.Lock()


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


def _site_arg():
    return request.args.get("site_id") if request.method == "GET" else (request.get_json(silent=True) or {}).get("site_id")


class BotRefused(Refused):
    http = 401


def _too_many(site_id: int) -> bool:
    now = time.monotonic()
    with _lock:
        recent = [t for t in _calls.get(site_id, []) if now - t < 60]
        recent.append(now)
        _calls[site_id] = recent
        return len(recent) > BOT_PER_MINUTE


@social_api.before_request
def bot_token():
    """The helpers' routes: a token instead of a session, a size cap and a few calls a minute."""
    if not request.path.startswith(BOT_PREFIX):
        return None
    if (request.content_length or 0) > BOT_MAX_BYTES:
        return jsonify(error="Too large."), 413
    request.max_content_length = BOT_MAX_BYTES  # a body sent in chunks has no length up front: it stops here too
    sent = request.headers.get("Authorization", "")
    site_id = service.site_for_token(_engine(), sent[7:].strip() if sent.lower().startswith("bearer ") else None)
    if site_id is None:
        return jsonify(error="Unknown token. Make a new one in Social → Writing guide → Helpers."), 401
    if _too_many(site_id):
        return jsonify(error="Too many calls. Wait a minute."), 429
    g.social_site = site_id
    return None


# ---- the helpers ----

@social_api.get("/bot/brief")
def bot_brief():
    return jsonify(service.brief(_engine(), g.social_site))


@social_api.post("/bot/inbox")
def bot_inbox():
    return jsonify(service.inbox(_engine(), g.social_site, _body()))


@social_api.post("/bot/targets")
def bot_targets():
    body = _body()
    return jsonify(added=service.add_targets(_engine(), g.social_site, body.get("targets")))


@social_api.post("/bot/stage")
def bot_stage():
    return jsonify(service.report_stage(_engine(), g.social_site, _body()))


# ---- the owner's screen ----

@social_api.get("/day")
def day():
    wanted = request.args.get("date")
    try:
        chosen = date.fromisoformat(wanted) if wanted else None
    except ValueError:
        raise Refused("That date isn't one I can read.") from None
    return jsonify(service.day_view(_engine(), _site_arg(), chosen))


@social_api.patch("/items/<int:social_item_id>")
def update_item(social_item_id: int):
    return jsonify(service.update_item(_engine(), social_item_id, _body()))


@social_api.post("/targets")
def add_target():
    body = _body()
    return jsonify(service.add_comment_target(_engine(), body.get("site_id"), body.get("url"), body.get("text"), body.get("lang")))


def _for_this_person(view: dict) -> dict:
    """The newsletter mailbox and the token's last characters are Settings-like: admins only, like every other key."""
    user = g.get("user")
    if current_app.config.get("AUTH_ON") and (user is None or user["role"] != "admin"):
        view["mail"] = {"host": None, "user": None, "set": view["mail"]["set"]}
        view["token"] = {"set": view["token"]["set"], "last4": None}
    return view


@social_api.get("/settings")
def settings():
    return jsonify(_for_this_person(service.settings(_engine(), _site_arg())))


@social_api.put("/guide")
def save_guide():
    body = _body()
    return jsonify(_for_this_person(service.save_guide(_engine(), body.get("site_id"), body)))


@social_api.post("/skill")
def upload_skill():
    """A writing skill (SKILL.md, .zip or .skill) uploaded as the Writing guide."""
    upload = request.files.get("file")
    if upload is None:
        raise Refused("Choose the skill file.")
    data = upload.read(skill.MAX_UPLOAD + 1)
    return jsonify(_for_this_person(service.load_skill(_engine(), request.form.get("site_id"), upload.filename or "SKILL.md", data)))


@social_api.post("/rules")
def add_rule():
    body = _body()
    return jsonify(_for_this_person(service.add_rule(_engine(), body.get("site_id"), body.get("text"))))


@social_api.post("/rules/remove")
def remove_rule():
    body = _body()
    return jsonify(_for_this_person(service.remove_rule(_engine(), body.get("site_id"), str(body.get("id") or ""))))


@social_api.post("/proposals")
def answer_proposal():
    body = _body()
    return jsonify(_for_this_person(service.answer_proposal(_engine(), body.get("site_id"), str(body.get("id") or ""), body.get("accept") is True)))


@social_api.post("/sources")
def add_source():
    body = _body()
    return jsonify(_for_this_person(service.add_source(_engine(), body.get("site_id"), body.get("kind"), body.get("address"), body.get("label"))))


@social_api.post("/sources/remove")
def remove_source():
    body = _body()
    source_id = body.get("id")
    if not isinstance(source_id, int):
        raise Refused("Say which source.")
    return jsonify(_for_this_person(service.remove_source(_engine(), body.get("site_id"), source_id)))


@social_api.put("/mailbox")
def save_mailbox():
    from seo.web.auth import require_admin

    require_admin()  # a mailbox password: admins only, like every other key
    body = _body()
    return jsonify(service.save_mailbox(_engine(), body.get("site_id"), body))


@social_api.post("/token")
def new_token():
    from seo.web.auth import require_admin

    require_admin()
    body = _body()
    return jsonify(service.new_token(_engine(), body.get("site_id")))


@social_api.post("/gather")
def gather_now():
    """"Read my sources now": the feeds and the mailbox, without waiting for the morning. Grok stays with the cron."""
    body = _body()
    site = service.settings(_engine(), body.get("site_id"))["site_id"]
    today = service.today()
    return jsonify(rss=service.gather_feeds(_engine(), site, today, budget=40, timeout=10), mail=service.gather_mail(_engine(), site, today), day=service.day_view(_engine(), site))
