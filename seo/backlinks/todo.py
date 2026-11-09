"""To do: links chosen from In consideration, on their way to a mediator.

A To do link is a backlink with status planned, so duplicates, mediators and what a prospect knew work as for any other.
It never counts in the top cards and is never read by the monthly check, because it doesn't exist yet. Once placed, its real
article address replaces the one it had, since a guest post's page doesn't exist until it's published.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Engine, bindparam, text

from seo.backlinks import mediators, service
from seo.competitors import gaps
from seo.core.errors import NotFound, Refused

MAX_AT_ONCE = 5000
_MAX_URL, _MAX_MEDIATOR, _MAX_TYPE, _MAX_OWNER = 2048, 180, 100, 100


def _ids(values) -> list[int]:
    if not isinstance(values, list) or not values or len(values) > MAX_AT_ONCE or not all(type(i) is int for i in values):
        raise Refused("Send the list of links.")
    return list(dict.fromkeys(values))


def _web_address(value, word: str) -> str:
    if not isinstance(value, str):
        raise Refused(f"{word} must be a web address.")
    address = value.strip()
    if len(address) > _MAX_URL or not address.lower().startswith(("http://", "https://")) or address.split() != [address] or len(address) < 10:
        raise Refused(f"{word} must be a web address starting with https://.")
    return address


def _mediator_name(value) -> str:
    name = value.strip() if isinstance(value, str) else ""
    if not name:
        raise Refused("Choose a mediator.")
    if len(name) > _MAX_MEDIATOR:
        raise Refused(f"A mediator's name can be up to {_MAX_MEDIATOR} characters.")
    return name


def _link_type(value) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > _MAX_TYPE:
        raise Refused(f"A link type must be text, up to {_MAX_TYPE} characters.")
    return value.strip() or None


def _planned_rows(conn, ids: list[int]) -> list:
    query = text("SELECT * FROM backlinks WHERE id IN :ids FOR UPDATE").bindparams(bindparam("ids", expanding=True))
    rows = conn.execute(query, {"ids": ids}).mappings().all()
    if len(rows) != len(ids):
        raise NotFound("That link doesn't exist.")
    if any(row["status"] != service.PLANNED for row in rows):
        raise Refused("Only a link in To do can change here.")
    return rows


def move_prospects(engine: Engine, prospect_ids, mediator, link_type=None) -> dict:
    """In consideration to To do. `details` is what a backlink has no place for, handed back so that Undo can restore it."""
    ids, name, kind = _ids(prospect_ids), _mediator_name(mediator), _link_type(link_type)
    query = text("SELECT * FROM prospects WHERE id IN :ids ORDER BY id").bindparams(bindparam("ids", expanding=True))
    with engine.connect() as conn:
        prospects = conn.execute(query, {"ids": ids}).mappings().all()
    if len(prospects) != len(ids):
        raise NotFound("That prospect doesn't exist.")
    answer = service.save_many(engine, [
        {"site_id": p["site_id"], "source_url": p["url"], "status": service.PLANNED, "mediator": name, "link_type": kind, "owner": (p["owner"] or "")[:_MAX_OWNER] or None}
        for p in prospects
    ])
    by_key = {(p["site_id"], service.source_key(p["url"])): p for p in prospects}
    details = {}
    for row in answer["saved"]:
        p = by_key.get((row["site_id"], service.source_key(row["source_url"])))
        if p is not None:
            details[str(row["id"])] = {"stage": p["stage"], "source_file": p["source_file"], "source_kind": p["source_kind"]}
    return {**answer, "details": details}


def move_back(engine: Engine, ids, details=None) -> dict:
    """To do back to In consideration: an Undo, or a change of mind. A domain already in consideration stays as it is there."""
    chosen = _ids(ids)
    known = details if isinstance(details, dict) else {}
    with engine.begin() as conn:
        rows = _planned_rows(conn, chosen)
        for row in rows:
            extra = known.get(str(row["id"]))
            extra = extra if isinstance(extra, dict) else {}
            stage = extra.get("stage") if extra.get("stage") in gaps.PROSPECT_STAGES else "new"
            kind = extra.get("source_kind") if extra.get("source_kind") in ("csv", "link_gap") else "csv"
            source_file = extra.get("source_file") if isinstance(extra.get("source_file"), str) else None
            conn.execute(
                text(
                    "INSERT IGNORE INTO prospects (site_id, url, domain, authority, authority_label, spam_score, source_file, source_kind, owner, stage, page_authority, rating) "
                    "VALUES (:s, :u, :d, :a, :l, :sp, :f, :k, :o, :st, :pa, :r)"
                ),
                {"s": row["site_id"], "u": row["source_url"], "d": row["domain"], "a": row["authority"], "l": row["authority_label"], "sp": row["spam_score"], "f": (source_file or "")[:255] or None, "k": kind, "o": row["owner"], "st": stage, "pa": row["page_authority"], "r": row["rating"]},
            )
        conn.execute(text("DELETE FROM backlinks WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)), {"ids": chosen})
    sites = {row["site_id"] for row in rows}
    domains = {row["domain"] for row in rows}
    return {"prospects": [p for site_id in sorted(sites) for p in gaps.list_prospects(engine, site_id) if p["domain"] in domains]}


def update(engine: Engine, backlink_id: int, body: dict) -> dict:
    """The article, link type and mediator of one link in To do. Only what's sent changes."""
    allowed = {"article_url", "link_type", "mediator"}
    extra = sorted(set(body) - allowed)
    if extra or not body:
        raise Refused(f"Only {', '.join(sorted(allowed))} can change here.")
    values, sets = {"i": backlink_id}, []
    if "article_url" in body:
        raw = body["article_url"]
        values["a"] = _web_address(raw, "The article link") if raw not in (None, "") and str(raw).strip() else None
        sets.append("article_url = :a")
    if "link_type" in body:
        values["t"] = _link_type(body["link_type"])
        sets.append("link_type = :t")
    if "mediator" in body:
        values["m"] = _mediator_name(body["mediator"])
        sets.append("mediator = :m")
    with engine.begin() as conn:
        row = _planned_rows(conn, [backlink_id])[0]
        conn.execute(text(f"UPDATE backlinks SET {', '.join(sets)} WHERE id = :i"), values)
        if "mediator" in body:
            mediators.ensure_from_rows(conn, [{**service.mediator_fields(row), "mediator": values["m"]}])
        return service.rows_by_id(conn, [backlink_id])[0]


def mark_sent(engine: Engine, ids, sent) -> dict:
    chosen = _ids(ids)
    if type(sent) is not bool:
        raise Refused("Sent is yes or no.")
    with engine.begin() as conn:
        _planned_rows(conn, chosen)
        value = "UTC_TIMESTAMP(3)" if sent else "NULL"
        conn.execute(text(f"UPDATE backlinks SET sent_at = {value} WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)), {"ids": chosen})
        return {"saved": service.rows_by_id(conn, chosen)}


def mark_placed(engine: Engine, backlink_id: int, live_url) -> dict:
    """It's published: the real address replaces the old one, and it's Live in Done. The monthly check reads it from now on."""
    address = _web_address(live_url, "The article's address")
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM backlinks WHERE id = :i"), {"i": backlink_id}).mappings().all()
    if not rows:
        raise NotFound("That link doesn't exist.")
    row = rows[0]
    if row["status"] != service.PLANNED:
        raise Refused("Only a link in To do can be marked as placed.")
    fields = {field: row[field] for field in (*service.LIMITS, "anchor_kind")}
    fields["placed"] = fields["placed"] or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return service.update_one(engine, backlink_id, {**fields, "site_id": row["site_id"], "source_url": address, "status": service.LIVE, "cost": float(row["cost"]) if row["cost"] is not None else None})
