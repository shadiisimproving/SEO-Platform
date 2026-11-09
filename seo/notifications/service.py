"""What the bell shows, and marking things read. Read is shared by the whole team, like alerts' "seen"."""
from __future__ import annotations

import json

from sqlalchemy import Engine, bindparam, text

from seo.core.errors import NotFound, Refused
from seo.notifications.new_queries import SHOWN_KINDS

SHOWN = 60


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def _site(site_id) -> int | None:
    if site_id in (None, "", "all"):
        return None
    try:
        return int(site_id)
    except (TypeError, ValueError):
        raise Refused("site_id must be a number.") from None


def listing(engine: Engine, site_id=None) -> dict:
    site = _site(site_id)
    clause = "AND n.site_id = :s" if site is not None else ""
    values = {"s": site, "kinds": list(SHOWN_KINDS)}
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT n.*, s.host FROM notifications n JOIN sites s ON s.id = n.site_id WHERE n.kind IN :kinds {clause} ORDER BY n.id DESC LIMIT {SHOWN}").bindparams(bindparam("kinds", expanding=True)),
            values,
        ).mappings().all()
        unread = conn.execute(
            text(f"SELECT COUNT(*) FROM notifications n WHERE n.kind IN :kinds AND n.read_at IS NULL {clause}").bindparams(bindparam("kinds", expanding=True)), values
        ).scalar()
    items = []
    for r in rows:
        detail = r["detail"]
        if isinstance(detail, str):
            detail = json.loads(detail or "{}")
        items.append({"id": r["id"], "site_id": r["site_id"], "host": r["host"], "kind": r["kind"], "title": r["title"], "detail": detail or {}, "created_at": _iso(r["created_at"]), "read": r["read_at"] is not None})
    return {"items": items, "unread": int(unread or 0)}


def mark(engine: Engine, notification_id: int, read: bool = True) -> None:
    if type(read) is not bool:
        raise Refused("read must be true or false.")
    with engine.begin() as conn:
        done = conn.execute(
            text(f"UPDATE notifications SET read_at = {'COALESCE(read_at, UTC_TIMESTAMP(3))' if read else 'NULL'} WHERE id = :i"), {"i": notification_id}
        ).rowcount
        if not done and not conn.execute(text("SELECT 1 FROM notifications WHERE id = :i"), {"i": notification_id}).first():
            raise NotFound("That notification doesn't exist.")


def mark_all(engine: Engine, site_id=None) -> int:
    site = _site(site_id)
    clause = "AND site_id = :s" if site is not None else ""
    with engine.begin() as conn:
        return conn.execute(
            text(f"UPDATE notifications SET read_at = UTC_TIMESTAMP(3) WHERE read_at IS NULL AND kind IN :kinds {clause}").bindparams(bindparam("kinds", expanding=True)),
            {"s": site, "kinds": list(SHOWN_KINDS)},
        ).rowcount
