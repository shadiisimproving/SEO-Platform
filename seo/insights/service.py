"""Reading findings for the Insights screen and Today, and the owner's choices on them (Not useful)."""
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.collectors.common import digest
from seo.core.errors import NotFound, Refused
from seo.insights import rules

GROUPS = ("first", "changed", "decline", "wins", "leads", "technical", "impact")
FIRST_SHOWN = 15
LIST_ROWS = 300


def _sites(engine: Engine, site_id) -> list[int]:
    with engine.connect() as conn:
        if site_id in (None, "", "all"):
            return [r[0] for r in conn.execute(text("SELECT id FROM sites WHERE kind = 'own'")).all()]
        try:
            wanted = int(site_id)
        except (TypeError, ValueError) as exc:
            raise Refused("That site isn't one of yours.") from exc
        if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": wanted}).first():
            raise Refused("That site isn't one of yours.")
        return [wanted]


def _row(row) -> dict:
    evidence = row["evidence"] if isinstance(row["evidence"], dict) else json.loads(row["evidence"] or "{}")
    return {
        "id": row["id"], "key": row["finding_key"], "site_id": row["site_id"], "host": row["host"], "kind": row["kind"], "group": row["grp"],
        "query": row["query"], "page": row["page"], "severity": row["severity"], "at_stake": row["at_stake"], "status": row["status"],
        "evidence": evidence, "data_through": row["data_through"].isoformat() if row["data_through"] else None,
        "first_seen": row["first_seen"].isoformat() + "Z", "task": row.get("task_status"),
    }


_SELECT = (
    "SELECT f.*, s.host, (SELECT t.status FROM tasks t WHERE t.deleted_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(t.source, '$.type')) = 'search' "
    "AND JSON_UNQUOTE(JSON_EXTRACT(t.source, '$.key')) = f.finding_key ORDER BY t.id DESC LIMIT 1) task_status "
    "FROM search_findings f JOIN sites s ON s.id = f.site_id "
)


def _fetch(engine: Engine, where: str, values: dict, lists: tuple[str, ...] = ()) -> list[dict]:
    statement = text(_SELECT + where)
    for name in ("sites", *lists):
        statement = statement.bindparams(bindparam(name, expanding=True))
    with engine.connect() as conn:
        return [_row(r) for r in conn.execute(statement, values).mappings().all()]


def _one_per_subject(rows: list[dict]) -> list[dict]:
    """To do first names each query or page once: its biggest finding, with the others counted on it."""
    kept, by_subject = [], {}
    for row in rows:
        subject = (row["site_id"], row["query"] or row["page"] or row["key"])
        if subject in by_subject:
            by_subject[subject]["also"].append(row["kind"])
            continue
        row["also"] = []
        by_subject[subject] = row
        kept.append(row)
    return kept


def listing(engine: Engine, site_id, group: str = "first", status: str = "open") -> dict:
    if group not in GROUPS:
        raise Refused("That isn't a group of insights.")
    if status not in ("open", "dismissed", "gone", "done"):
        raise Refused("That isn't a state of an insight.")
    sites = _sites(engine, site_id)
    if not sites:
        return {"group": group, "rows": [], "counts": {}, "summary": None}
    where = "WHERE f.site_id IN :sites AND f.status = :st AND f.kind <> 'change' "
    values = {"sites": sites, "st": status}
    if group == "first":
        where += "AND f.severity <> 'info' "
    elif group != "first":
        where += "AND f.grp = :g "
        values["g"] = group
    rows = _fetch(engine, where + f"ORDER BY f.at_stake DESC, f.id LIMIT {LIST_ROWS}", values)
    if group == "first":
        rows = _one_per_subject(rows)[:FIRST_SHOWN]
    return {"group": group, "status": status, "rows": rows, "counts": counts(engine, sites), "summary": summary(engine, sites)}


def counts(engine: Engine, sites: list[int]) -> dict:
    statement = text(
        "SELECT grp, COUNT(*) n, SUM(at_stake) stake FROM search_findings WHERE site_id IN :sites AND status = 'open' AND kind <> 'change' GROUP BY grp"
    ).bindparams(bindparam("sites", expanding=True))
    with engine.connect() as conn:
        found = {r["grp"]: {"open": int(r["n"]), "at_stake": round(float(r["stake"] or 0))} for r in conn.execute(statement, {"sites": sites}).mappings().all()}
    return found


def summary(engine: Engine, sites: list[int]) -> dict:
    """The sentence on top (the change breakdown of each site), the three numbers, and when it last ran."""
    changes = _fetch(engine, "WHERE f.site_id IN :sites AND f.kind = 'change' AND f.status IN ('open', 'dismissed', 'done')", {"sites": sites})
    statement = text(
        "SELECT COUNT(*) n, COALESCE(SUM(at_stake), 0) stake, "
        "(SELECT COUNT(*) FROM search_findings g WHERE g.site_id IN :sites AND g.kind <> 'change' AND g.status IN ('gone', 'done') AND COALESCE(g.gone_at, g.last_seen) > UTC_TIMESTAMP(3) - INTERVAL 30 DAY) fixed, "
        "(SELECT MAX(ran_at) FROM search_finding_runs r WHERE r.site_id IN :sites AND r.error IS NULL) ran_at "
        "FROM search_findings WHERE site_id IN :sites AND status = 'open' AND kind <> 'change' AND severity <> 'info'"
    ).bindparams(bindparam("sites", expanding=True))
    with engine.connect() as conn:
        row = conn.execute(statement, {"sites": sites}).mappings().first()
        needs = {}
        for r in conn.execute(
            text("SELECT r.counts FROM search_finding_runs r JOIN (SELECT MAX(id) id FROM search_finding_runs WHERE site_id IN :sites AND error IS NULL GROUP BY site_id) last ON last.id = r.id").bindparams(bindparam("sites", expanding=True)),
            {"sites": sites},
        ).all():
            found = r[0] if isinstance(r[0], dict) else json.loads(r[0] or "{}")
            needs.update(found.get("needs") or {})
    return {
        "changes": changes, "open": int(row["n"]), "at_stake": round(float(row["stake"])), "fixed": int(row["fixed"] or 0),
        "ran_at": row["ran_at"].isoformat() + "Z" if row["ran_at"] else None, "needs": needs, "sites": len(sites),
    }


def one(engine: Engine, finding_id: int) -> dict:
    rows = _fetch(engine, "WHERE f.id = :i AND f.site_id IN :sites", {"i": finding_id, "sites": _sites(engine, None)})
    if not rows:
        raise NotFound("That insight doesn't exist any more.")
    row = rows[0]
    row["series"] = _series(engine, row)
    return row


def _series(engine: Engine, row: dict) -> list[dict]:
    """Daily clicks and impressions of what the finding is about, for its chart: 16 weeks back from the data's last day."""
    end = date.fromisoformat(row["data_through"]) if row["data_through"] else None
    if end is None:
        return []
    start = end - timedelta(days=7 * rules.DECAY_WEEKS - 1)
    if row["query"]:
        sql, values = "SELECT day, clicks, impressions, position FROM gsc_query WHERE site_id = :s AND query_hash = :h AND day BETWEEN :a AND :b ORDER BY day", {"h": digest(row["query"])}
    elif row["page"]:
        sql, values = "SELECT day, clicks, impressions, position FROM gsc_page WHERE site_id = :s AND page_hash = :h AND day BETWEEN :a AND :b ORDER BY day", {"h": digest(row["page"])}
    else:
        sql, values = "SELECT day, clicks, impressions, position FROM gsc_daily WHERE site_id = :s AND day BETWEEN :a AND :b ORDER BY day", {}
    with engine.connect() as conn:
        found = conn.execute(text(sql), {"s": row["site_id"], "a": start, "b": end, **values}).mappings().all()
    return [{"day": r["day"].isoformat(), "clicks": int(r["clicks"] or 0), "impressions": int(r["impressions"] or 0), "position": round(r["position"], 1) if r["position"] is not None else None} for r in found]


def dismiss(engine: Engine, finding_id: int, undo: bool = False) -> dict:
    with engine.begin() as conn:
        row = conn.execute(text("SELECT id, status, at_stake FROM search_findings WHERE id = :i FOR UPDATE"), {"i": finding_id}).mappings().first()
        if row is None:
            raise NotFound("That insight doesn't exist any more.")
        if undo:
            if row["status"] == "dismissed":
                conn.execute(text("UPDATE search_findings SET status = 'open', dismissed_stake = NULL WHERE id = :i"), {"i": finding_id})
        elif row["status"] == "open":
            # At least 1 click, so one that comes back from nothing still needs to reach a real number.
            conn.execute(text("UPDATE search_findings SET status = 'dismissed', dismissed_stake = :d WHERE id = :i"), {"i": finding_id, "d": max(1.0, float(row["at_stake"]))})
        else:
            raise Refused("Only an open insight can be marked as not useful.")
    return one(engine, finding_id)


def today_rows(engine: Engine, site_id: int | None) -> list[dict]:
    """The biggest open findings for Today, one per query or page. Big ones already show there as alerts, so they're left out."""
    sites = _sites(engine, site_id)
    if not sites:
        return []
    rows = _fetch(
        engine,
        f"WHERE f.site_id IN :sites AND f.status = 'open' AND f.kind <> 'change' AND f.severity = 'normal' AND f.at_stake >= {rules.TODAY_MIN_STAKE} ORDER BY f.at_stake DESC LIMIT 60",
        {"sites": sites},
    )
    return _one_per_subject(rows)[: rules.TODAY_SHOWN]
