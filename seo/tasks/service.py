"""Tasks: one board the whole team shares, per website, like the SEO board the owner already knows.

A task can come from a finding (a ranking drop, a broken link, a failed health check). `source` says where it came
from, and one finding has at most one open task: see `Task.open_source_key`. Deleting keeps the task, so it can be undone.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date
from urllib.parse import urlsplit

from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from seo.competitors.keywords import _iso, require_own
from seo.core.errors import Conflict, NotFound, Refused

STATUSES = ("todo", "doing", "done")
PRIORITIES = ("low", "medium", "high")
SOURCE_TYPES = ("keyword", "health", "link", "competitor", "alert", "backlink", "search", "other")
ALREADY_OPEN = "This finding already has an open task."
CHANGED_MEANWHILE = "Someone else changed this task while you had it open."

# name: (the longest it can be, what to call it in a message)
_TEXT = {
    "title": (300, "The title"),
    "description": (20000, "The description"),
    "kind": (40, "The type"),
    "hypothesis": (300, "The hypothesis"),
    "note": (20000, "The note"),
    "owner_label": (100, "The owner's name"),
}
# name: (the longest one can be, what to call one in a message). What a task is about, so it can show on those screens.
_LISTS = {
    "pages": (500, "A page address"),
    "keywords": (190, "A keyword"),
}
_MAX_LINKED = 50
FIELDS = {*_TEXT, *_LISTS, "status", "priority", "site_id", "due", "impact", "hours_estimate", "hours_spent"}
_MAX_SOURCE_BYTES = 16000
_MAX_COMMENT = 2000
_MAX_COMMENTS = 500


def _load(value, empty):
    """MariaDB hands JSON back as text or as a value, depending on the driver."""
    if value is None or value == "":
        return empty
    return json.loads(value) if isinstance(value, str) else value


def _dict(row) -> dict:
    source = _load(row["source"], None)
    return {
        "id": row["id"], "title": row["title"], "description": row["description"] or "", "status": row["status"],
        "priority": row["priority"], "site_id": row["site_id"], "site_host": row["site_host"] or "",
        "due": row["due_date"].isoformat() if row["due_date"] else "", "kind": row["kind"] or "",
        "hypothesis": row["hypothesis"] or "", "impact": row["impact"], "hours_estimate": row["hours_estimate"],
        "hours_spent": row["hours_spent"], "note": row["note"] or "", "owner_label": row["owner_label"] or "",
        "pages": _load(row["pages"], []), "keywords": _load(row["keywords"], []),
        "comments": _load(row["comments"], []), "source": source, "completed_on": row["completed_at"].date().isoformat() if row["completed_at"] else "",
        "created_at": _iso(row["created_at"]), "updated_at": _iso(row["updated_at"]),
        # Exact to the millisecond, because two saves can land in the same second.
        "version": row["updated_at"].isoformat(timespec="milliseconds"),
    }


def _one(conn, task_id: int, *, lock: bool = False) -> dict:
    row = conn.execute(
        text(f"SELECT * FROM tasks WHERE id = :i AND deleted_at IS NULL{' FOR UPDATE' if lock else ''}"), {"i": task_id}
    ).mappings().first()
    if row is None:
        raise NotFound("That task doesn't exist.")
    return row


def _hash(key: str) -> str:
    # URLs can be longer than an index allows, and a hash has one length.
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _clean_source(source) -> tuple[str | None, str | None]:
    """The source as stored, and the hash that keeps one open task per finding."""
    if source is None:
        return None, None
    if not isinstance(source, dict):
        raise Refused("source must be an object.")
    extra = sorted(set(source) - {"type", "label", "host", "facts", "link", "key"})
    if extra:
        raise Refused(f"source can't carry: {', '.join(extra)}.")
    if source.get("type") not in SOURCE_TYPES:
        raise Refused("That isn't a kind of finding this app knows.")
    for name in ("label", "host", "link", "key"):
        if source.get(name) is not None and not isinstance(source[name], str):
            raise Refused(f"source {name} must be text.")
    # The link is drawn as a link later, so it can only move around inside the app.
    if source.get("link") and not source["link"].startswith("#"):
        raise Refused("source link must be a place inside the app.")
    facts = source.get("facts")
    if facts is not None and not (isinstance(facts, list) and all(isinstance(fact, str) for fact in facts)):
        raise Refused("source facts must be a list of text.")
    stored = json.dumps(source, ensure_ascii=False)
    if len(stored.encode("utf-8")) > _MAX_SOURCE_BYTES:
        raise Refused("Finding too long to keep with the task.")
    return stored, _hash(source["key"]) if source.get("key") else None


def _clean_list(name: str, value) -> str | None:
    """The same word twice, or in other capitals, is kept once, as first written."""
    longest, word = _LISTS[name]
    if value is None:
        value = []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise Refused(f"{name} must be a list of text.")
    kept: dict[str, str] = {}
    for item in value:
        item = item.strip()
        if len(item) > longest:
            raise Refused(f"{word} is too long. It can hold {longest:,} characters.")
        if item:
            kept.setdefault(item.casefold(), item)
    if len(kept) > _MAX_LINKED:
        raise Refused(f"A task can list {_MAX_LINKED} {name} at most.")
    return json.dumps(list(kept.values()), ensure_ascii=False) if kept else None


def _clean(conn, body: dict) -> dict:
    """Only what was sent changes, so moving a card sends the status and nothing else."""
    values: dict = {}
    for name in _LISTS:
        if name in body:
            values[name] = _clean_list(name, body[name])
    for name, (longest, word) in _TEXT.items():
        if name not in body:
            continue
        value = body[name]
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise Refused(f"{word} must be text.")
        value = value.strip()
        if len(value) > longest:
            raise Refused(f"{word} is too long. It can hold {longest:,} characters.")
        if name == "title" and not value:
            raise Refused("A task needs a title.")
        values[name] = value or None
    if "status" in body:
        if body["status"] not in STATUSES:
            raise Refused("That isn't a status a task can have.")
        values["status"] = body["status"]
    if "priority" in body:
        if body["priority"] not in PRIORITIES:
            raise Refused("That isn't a priority a task can have.")
        values["priority"] = body["priority"]
    if "due" in body:
        raw = body["due"]
        if raw in (None, ""):
            values["due_date"] = None
        else:
            try:
                values["due_date"] = date.fromisoformat(raw)
            except (TypeError, ValueError):
                raise Refused("Write the due date as YYYY-MM-DD.") from None
    if "impact" in body:
        impact = body["impact"]
        if impact not in (None, "") and (type(impact) is not int or not 1 <= impact <= 5):
            raise Refused("Impact goes from 1 to 5.")
        values["impact"] = None if impact in (None, "") else impact
    for name, word in (("hours_estimate", "The estimate"), ("hours_spent", "The time spent")):
        if name in body:
            hours = body[name]
            if hours in (None, ""):
                values[name] = None
            elif type(hours) not in (int, float) or not 0 <= hours <= 1000:
                raise Refused(f"{word} needs to be a number of hours from 0 to 1,000.")
            else:
                values[name] = hours
    if "site_id" in body:
        if body["site_id"] is None:
            values["site_id"], values["site_host"] = None, None
        else:
            site = require_own(conn, body["site_id"])
            values["site_id"], values["site_host"] = site["id"], site["host"]
    return values


class _Checks:
    """What the latest full health test and links check of each site found. One query per site, however many tasks ask."""

    def __init__(self, conn):
        self.conn = conn
        self.health: dict[int, dict | None] = {}
        self.links: dict[int, dict | None] = {}

    def latest_health(self, site_id: int) -> dict | None:
        if site_id not in self.health:
            row = self.conn.execute(text(
                "SELECT id, created_at, pages_not_read, counts FROM health_audits WHERE site_id = :s AND status = 'complete' ORDER BY id DESC LIMIT 1"
            ), {"s": site_id}).mappings().first()
            found = None
            if row is not None and not row["pages_not_read"]:  # a test that couldn't read every page can't say a problem has gone
                codes = {r[0] for r in self.conn.execute(text("SELECT code FROM health_issues WHERE audit_id = :a AND page_count > 0"), {"a": row["id"]})}
                codes |= set(_load(row["counts"], {}).get("site", []))
                found = {"at": row["created_at"], "found": codes}
            self.health[site_id] = found
        return self.health[site_id]

    def latest_links(self, site_id: int) -> dict | None:
        if site_id not in self.links:
            row = self.conn.execute(text(
                "SELECT s.id, s.created_at, s.pages_not_read, s.too_large, s.external_not_checked, s.stopped_at_limit, x.host "
                "FROM link_scans s JOIN sites x ON x.id = s.site_id WHERE s.site_id = :s AND s.status = 'complete' ORDER BY s.id DESC LIMIT 1"
            ), {"s": site_id}).mappings().first()
            found = None
            if row is not None and not row["pages_not_read"] and not row["too_large"] and not row["stopped_at_limit"]:
                targets = {r[0] for r in self.conn.execute(text("SELECT target_url FROM link_issues WHERE scan_id = :a"), {"a": row["id"]})}
                found = {"at": row["created_at"], "found": targets, "external_read": not row["external_not_checked"], "host": row["host"]}
            self.links[site_id] = found
        return self.links[site_id]


def _is_outside(url: str, host: str) -> bool:
    name = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    return name != host and not name.endswith(f".{host}")


def _finding_now(checks: _Checks, row) -> dict | None:
    """Whether a check run since says this finding has gone, or come back. Only a suggestion: nothing closes a task by itself."""
    source = _load(row["source"], None) or {}
    kind, _, rest = (source.get("key") or "").partition("|")
    site_text, _, what = rest.partition("|")
    if kind not in ("health", "link") or not site_text.isdigit() or not what:
        return None
    site_id = int(site_text)
    latest = checks.latest_health(site_id) if kind == "health" else checks.latest_links(site_id)
    if latest is None:
        return None
    # A link to another website can only be judged by a check that followed those links.
    if kind == "link" and not latest["external_read"] and _is_outside(what, latest["host"]):
        return None
    # The check must have started after the moment that matters, or it can't know about the fix or the return.
    since = row["completed_at"] if row["status"] == "done" else row["created_at"]
    if since is None or latest["at"] <= since:
        return None
    there = what in latest["found"]
    if row["status"] != "done" and not there:
        return {"state": "gone", "by": kind, "at": _iso(latest["at"])}
    if row["status"] == "done" and there:
        return {"state": "back", "by": kind, "at": _iso(latest["at"])}
    return None


def list_tasks(engine: Engine) -> list[dict]:
    """All of them: the board filters in the browser, so a filter never loses what's being typed."""
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY id DESC")).mappings().all()
        checks = _Checks(conn)
        return [{**_dict(row), "finding": _finding_now(checks, row)} for row in rows]


def create(engine: Engine, body: dict) -> dict:
    extra = sorted(set(body) - FIELDS - {"source"})
    if extra:
        raise Refused(f"A task can't carry: {', '.join(extra)}.")
    if not isinstance(body.get("title"), str) or not body["title"].strip():
        raise Refused("A task needs a title.")
    source, key = _clean_source(body.get("source"))
    try:
        with engine.begin() as conn:
            values = _clean(conn, body)
            done = values.get("status") == "done"
            columns = {**values, "source": source, "open_source_key": None if done else key}
            names = ", ".join(columns)
            marks = ", ".join(f":{name}" for name in columns)
            finished = ", completed_at" if done else ""
            finished_mark = ", UTC_TIMESTAMP(3)" if done else ""
            task_id = conn.execute(text(f"INSERT INTO tasks ({names}{finished}) VALUES ({marks}{finished_mark})"), columns).lastrowid
            return _dict(_one(conn, task_id))
    except IntegrityError as error:
        if "open_source_key" in str(error.orig):
            raise Conflict(ALREADY_OPEN) from None
        raise


def update(engine: Engine, task_id: int, body: dict) -> dict:
    """`expected_version` is the version the person was looking at. If someone else saved since, nothing changes."""
    expected = body.get("expected_version")
    body = {name: value for name, value in body.items() if name != "expected_version"}
    extra = sorted(set(body) - FIELDS)
    if extra:
        raise Refused(f"A task can't carry: {', '.join(extra)}.")
    try:
        with engine.begin() as conn:
            before = _one(conn, task_id, lock=True)
            if expected is not None and expected != before["updated_at"].isoformat(timespec="milliseconds"):
                raise Conflict(CHANGED_MEANWHILE)
            values = _clean(conn, body)
            sets = [f"{name} = :{name}" for name in values] + ["updated_at = UTC_TIMESTAMP(3)"]
            new_status = values.get("status", before["status"])
            if new_status != before["status"]:
                source = _load(before["source"], None) or {}
                if new_status == "done":
                    sets += ["completed_at = UTC_TIMESTAMP(3)", "open_source_key = NULL"]
                elif before["status"] == "done":
                    # Reopened: it's the open task for its finding again, unless another one has taken over.
                    sets += ["completed_at = NULL", "open_source_key = :reopened_key"]
                    values["reopened_key"] = _hash(source["key"]) if source.get("key") else None
            conn.execute(text(f"UPDATE tasks SET {', '.join(sets)} WHERE id = :task_id"), {**values, "task_id": task_id})
            return _dict(_one(conn, task_id))
    except IntegrityError as error:
        if "open_source_key" in str(error.orig):
            raise Conflict(ALREADY_OPEN) from None
        raise


def delete(engine: Engine, task_id: int) -> None:
    """Keeps the text for Undo, and stops holding its finding: a new task can be made from it now."""
    with engine.begin() as conn:
        _one(conn, task_id, lock=True)
        conn.execute(text("UPDATE tasks SET deleted_at = UTC_TIMESTAMP(3), open_source_key = NULL WHERE id = :i"), {"i": task_id})


def restore(engine: Engine, task_id: int) -> dict:
    try:
        with engine.begin() as conn:
            row = conn.execute(text("SELECT * FROM tasks WHERE id = :i FOR UPDATE"), {"i": task_id}).mappings().first()
            if row is None:
                raise NotFound("That task doesn't exist.")
            source = _load(row["source"], None) or {}
            key = _hash(source["key"]) if source.get("key") and row["status"] != "done" else None
            conn.execute(text("UPDATE tasks SET deleted_at = NULL, open_source_key = :k WHERE id = :i"), {"k": key, "i": task_id})
            return _dict(_one(conn, task_id))
    except IntegrityError as error:
        if "open_source_key" in str(error.orig):
            raise Conflict("Can't restore: a newer task covers this finding.") from None
        raise


def add_comment(engine: Engine, task_id: int, comment, name=None) -> dict:
    if not isinstance(comment, str) or not comment.strip():
        raise Refused("A comment needs some text.")
    if len(comment) > _MAX_COMMENT:
        raise Refused(f"That comment is too long. It can hold {_MAX_COMMENT:,} characters.")
    if name is not None and not isinstance(name, str):
        raise Refused("The name must be text.")
    with engine.begin() as conn:
        row = _one(conn, task_id, lock=True)  # two people commenting at once must not lose either
        comments = _load(row["comments"], [])
        if len(comments) >= _MAX_COMMENTS:
            raise Refused("Too many comments. Start a new task.")
        moment = conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar()
        # The name is kept as written, so a thread stays readable after someone leaves the team.
        comments.append({"name": (name or "").strip()[:100], "text": comment.strip(), "at": _iso(moment)})
        conn.execute(
            text("UPDATE tasks SET comments = :c, updated_at = UTC_TIMESTAMP(3) WHERE id = :i"),
            {"c": json.dumps(comments, ensure_ascii=False), "i": task_id},
        )
        return _dict(_one(conn, task_id))
