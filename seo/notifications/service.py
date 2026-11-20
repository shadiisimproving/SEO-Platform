"""What the bell shows, and marking things read. Read is each person's own once people sign in (notification_reads);
without sign-in, the one shared read_at stands for the team."""
from __future__ import annotations

import json

from sqlalchemy import Engine, bindparam, text

from seo.accounts import access
from seo.core.errors import NotFound, Refused
from seo.notifications.new_queries import SHOWN_KINDS as QUERY_KINDS

SHOWN_KINDS = (*QUERY_KINDS, "google_update")  # new searches, and Google updates starting and ending (seo/metrics/google_updates.py)

SHOWN = 60


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def _site(site_id) -> int | None:
    if site_id in (None, "", "all"):
        return None
    try:
        wanted = int(site_id)
    except (TypeError, ValueError):
        raise Refused("site_id must be a number.") from None
    access.require_site(wanted)  # chosen access: one of their sites
    return wanted


def _read_sql(user_id: int | None) -> str:
    """Whether a notification is read: by this person when someone is signed in, by the team without sign-in."""
    if user_id is None:
        return "n.read_at IS NOT NULL"
    return "EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = :u)"


def listing(engine: Engine, site_id=None, user_id: int | None = None) -> dict:
    site = _site(site_id)
    values = {"s": site, "kinds": list(SHOWN_KINDS), "u": user_id}
    clause = "AND n.site_id = :s" if site is not None else access.site_clause("n.site_id", values).lstrip()  # "all sites" is all of *their* sites
    read = _read_sql(user_id)
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT n.*, s.host, {read} AS is_read FROM notifications n JOIN sites s ON s.id = n.site_id WHERE n.kind IN :kinds {clause} ORDER BY n.id DESC LIMIT {SHOWN}").bindparams(bindparam("kinds", expanding=True)),
            values,
        ).mappings().all()
        unread = conn.execute(
            text(f"SELECT COUNT(*) FROM notifications n WHERE n.kind IN :kinds AND NOT {read} {clause}").bindparams(bindparam("kinds", expanding=True)), values
        ).scalar()
    items = []
    for r in rows:
        detail = r["detail"]
        if isinstance(detail, str):
            detail = json.loads(detail or "{}")
        items.append({"id": r["id"], "site_id": r["site_id"], "host": r["host"], "kind": r["kind"], "title": r["title"], "detail": detail or {}, "created_at": _iso(r["created_at"]), "read": bool(r["is_read"])})
    return {"items": items, "unread": int(unread or 0)}


def mark(engine: Engine, notification_id: int, read: bool = True, user_id: int | None = None) -> None:
    if type(read) is not bool:
        raise Refused("read must be true or false.")
    with engine.begin() as conn:
        if not conn.execute(text("SELECT 1 FROM notifications WHERE id = :i"), {"i": notification_id}).first():
            raise NotFound("That notification doesn't exist.")
        if user_id is None:
            conn.execute(text(f"UPDATE notifications SET read_at = {'COALESCE(read_at, UTC_TIMESTAMP(3))' if read else 'NULL'} WHERE id = :i"), {"i": notification_id})
        elif read:
            conn.execute(text("INSERT IGNORE INTO notification_reads (notification_id, user_id) VALUES (:i, :u)"), {"i": notification_id, "u": user_id})
        else:
            conn.execute(text("DELETE FROM notification_reads WHERE notification_id = :i AND user_id = :u"), {"i": notification_id, "u": user_id})


def mark_all(engine: Engine, site_id=None, user_id: int | None = None) -> int:
    """Only for the person who pressed it: the others still see theirs as unread."""
    site = _site(site_id)
    values = {"s": site, "kinds": list(SHOWN_KINDS), "u": user_id}
    clause = "AND n.site_id = :s" if site is not None else access.site_clause("n.site_id", values).lstrip()  # "all sites" is all of *their* sites
    with engine.begin() as conn:
        if user_id is None:
            return conn.execute(
                text(f"UPDATE notifications n SET n.read_at = UTC_TIMESTAMP(3) WHERE n.read_at IS NULL AND n.kind IN :kinds {clause}").bindparams(bindparam("kinds", expanding=True)), values,
            ).rowcount
        return conn.execute(
            text(
                f"INSERT INTO notification_reads (notification_id, user_id) SELECT n.id, :u FROM notifications n WHERE n.kind IN :kinds {clause} "
                f"AND NOT {_read_sql(user_id)}"
            ).bindparams(bindparam("kinds", expanding=True)),
            values,
        ).rowcount
