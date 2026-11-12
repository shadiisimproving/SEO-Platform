"""Reading findings for the Insights screen and Today, and the owner's choices on them (Not useful)."""
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.accounts import access
from seo.collectors.common import digest
from seo.core.errors import NotFound, Refused
from seo.insights import rules

GROUPS = ("first", "changed", "decline", "wins", "leads", "technical", "impact", "mix")
FIRST_SHOWN = 15
LIST_ROWS = 300


def _sites(engine: Engine, site_id) -> list[int]:
    with engine.connect() as conn:
        if site_id in (None, "", "all"):
            return access.own_site_ids(conn)  # "all sites" is all of *their* sites
        try:
            wanted = int(site_id)
        except (TypeError, ValueError) as exc:
            raise Refused("That site isn't one of yours.") from exc
        if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": wanted}).first():
            raise Refused("That site isn't one of yours.")
        access.require_site(wanted)  # chosen access: one of their sites
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
    found = {"group": group, "status": status, "rows": rows, "counts": counts(engine, sites), "summary": summary(engine, sites)}
    if group == "mix":
        from seo.insights import mix

        found["coverage"] = mix.coverage(engine, sites)
    return found


# Findings that restate the site's own change (a country, brand searches, one day, data gaps): their clicks are already in
# the findings about its queries and pages, so the total at stake leaves them out.
SITE_WIDE = frozenset({"change", "segment", "brand_split", "odd_day", "data_gaps"})


def stake_total(rows) -> float:
    """Clicks a month at stake, each lost or winnable click counted once (code review F7).

    Several findings can be about the same clicks: a page losing clicks, its main query losing places, the same query
    "close to the top 3", the page "bringing leads". So each query counts once, at its biggest estimate; a page counts
    once, at the bigger of its own biggest estimate and the sum of its queries' ones; site-wide findings count nothing.
    """
    queries: dict = {}
    pages: dict = {}
    for row in rows:
        stake, kind = float(row["at_stake"] or 0), row["kind"]
        if kind in SITE_WIDE or stake <= 0:
            continue
        site = row["site_id"]
        if row["query"]:
            key = (site, row["query"])
            if key not in queries or stake > queries[key][0]:
                queries[key] = (stake, row["page"])
        else:
            key = (site, row["page"] or row.get("finding_key") or kind)
            pages[key] = max(stake, pages.get(key, 0.0))
    by_page: dict = {}
    total = 0.0
    for (site, _query), (stake, page) in queries.items():
        if page:
            by_page[(site, page)] = by_page.get((site, page), 0.0) + stake
        else:
            total += stake
    for key in set(by_page) | set(pages):
        total += max(by_page.get(key, 0.0), pages.get(key, 0.0))
    return total


def _stake_rows(engine: Engine, sites: list[int], where: str) -> list[dict]:
    statement = text(
        f"SELECT site_id, kind, grp, query, page, finding_key, at_stake FROM search_findings WHERE site_id IN :sites AND status = 'open' AND kind <> 'change' {where}"
    ).bindparams(bindparam("sites", expanding=True))
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(statement, {"sites": sites}).mappings().all()]


# Findings about clicks already lost; the rest are clicks that could be won.
LOSS_KINDS = frozenset({"page_down", "dropped_out", "query_down", "decay", "slide", "shown_broken", "lead_page", "rank_drop", "rival_passed", "page_switch"})


def recover_and_win(rows: list[dict]) -> tuple[int, int]:
    """The two figures on top. A query or page counted as a loss isn't counted again as something to win."""
    lost = [r for r in rows if r["kind"] in LOSS_KINDS]
    taken = {(r["site_id"], r["query"]) for r in lost if r["query"]} | {(r["site_id"], r["page"]) for r in lost if r["page"]}
    win = [r for r in rows if r["kind"] not in LOSS_KINDS and (r["site_id"], r["query"]) not in taken and (r["site_id"], r["page"]) not in taken]
    return round(stake_total(lost)), round(stake_total(win))


def _days(engine: Engine, change: dict) -> list[dict]:
    """Clicks day by day over both periods, for the small graph beside the sentence."""
    e = change["evidence"]
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT day, clicks FROM gsc_daily WHERE site_id = :s AND day BETWEEN :a AND :b ORDER BY day"), {"s": change["site_id"], "a": e["before_from"], "b": e["to"]}).mappings().all()
    return [{"day": r["day"].isoformat(), "clicks": int(r["clicks"] or 0)} for r in rows]


def counts(engine: Engine, sites: list[int]) -> dict:
    rows = _stake_rows(engine, sites, "")
    found: dict = {}
    for grp in sorted({r["grp"] for r in rows}):
        mine = [r for r in rows if r["grp"] == grp]
        found[grp] = {"open": len(mine), "at_stake": round(stake_total(mine))}
    return found


def summary(engine: Engine, sites: list[int]) -> dict:
    """The sentence on top (the change breakdown of each site), the three numbers, and when it last ran."""
    changes = _fetch(engine, "WHERE f.site_id IN :sites AND f.kind = 'change' AND f.status IN ('open', 'dismissed', 'done')", {"sites": sites})
    statement = text(
        "SELECT COUNT(*) n, "
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
    serious = _stake_rows(engine, sites, "AND severity <> 'info'")
    to_recover, to_win = recover_and_win(serious)
    return {
        "changes": changes, "open": int(row["n"]), "at_stake": round(stake_total(serious)), "fixed": int(row["fixed"] or 0), "to_recover": to_recover, "to_win": to_win,
        "days": _days(engine, changes[0]) if len(changes) == 1 and changes[0]["evidence"].get("before_from") else [],
        "ran_at": row["ran_at"].isoformat() + "Z" if row["ran_at"] else None, "needs": needs, "sites": len(sites),
    }


def one(engine: Engine, finding_id: int) -> dict:
    rows = _fetch(engine, "WHERE f.id = :i AND f.site_id IN :sites", {"i": finding_id, "sites": _sites(engine, None)})
    if not rows:
        raise NotFound("That insight doesn't exist any more.")
    row = rows[0]
    row["series"] = _series(engine, row)
    row["ai"] = _ai(engine, row)
    return row


def _ai(engine: Engine, row: dict) -> dict:
    """What AI can write for this finding, with the provider its site uses and the answers already kept (any language)."""
    from seo.extras import ai

    provider = ai.provider_of(engine, row["site_id"])
    with engine.connect() as conn:
        held = conn.execute(text("SELECT ai FROM search_findings WHERE id = :i"), {"i": row["id"]}).scalar()
    held = json.loads(held) if isinstance(held, str) else (held or {})
    kept = {}
    for slot, answer in held.items():
        purpose, lang, by = (slot.split("|") + ["", ""])[:3]
        if by == provider and answer.get("data_through") == row["data_through"]:
            kept.setdefault(lang, {})[purpose] = answer
    return {"provider": provider, "purposes": ai.purposes_for(row["kind"]), "kept": kept}


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
