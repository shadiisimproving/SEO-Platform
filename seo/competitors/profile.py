"""One competitor, everything we know, in one place. Moves only compare like with like."""
from __future__ import annotations

import json
from sqlalchemy import Engine, text

from seo.competitors import pairs
from seo.competitors.keywords import _iso, require_own
from seo.competitors.suggest import domain_of, tracked_competitors
from seo.serp import store

MOVE_AT_LEAST = 2  # smaller moves are mostly noise
TIMELINE_LIMIT = 300


def _crawl_state(conn, competitor_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM competitor_crawls WHERE competitor_id = :c"), {"c": competitor_id}).mappings().first()
    if row is None:
        return {"status": "none"}
    return {
        "status": row["status"], "pages_known": row["pages_known"], "pages_read": row["pages_read"], "message": row["message"],
        "baseline_done": bool(row["baseline_done"]), "started_at": _iso(row["started_at"]), "finished_at": _iso(row["finished_at"]),
    }


def edits_last_30_days(conn) -> dict[int, int]:
    """By competitor. It belongs to the competitor, not to a site: never add it up across sites."""
    return dict(conn.execute(text(
        "SELECT s.id, COUNT(*) FROM sites s JOIN domains d ON d.host = s.host JOIN change_events e ON e.domain_id = d.id "
        "WHERE s.kind = 'competitor' AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL 30 DAY GROUP BY s.id"
    )).all())


def overview(engine: Engine, site_id: int) -> list[dict]:
    """Each tracked competitor with its headline numbers."""
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        tracked = tracked_competitors(conn, site_id)
        crawls = {c["id"]: _crawl_state(conn, c["id"]) for c in tracked}
        edits = edits_last_30_days(conn)
    checks = store.latest_checks(engine, site_id)
    out = []
    for competitor in tracked:
        shared = they_ahead = i_ahead = theirs_only = 0
        for check in store.one_per_keyword(checks):
            mine, theirs = check.best_on(site["host"]), check.best_on(competitor["host"])
            if theirs is None:
                continue
            if mine is None:
                theirs_only += 1
            else:
                shared += 1
                if theirs.position < mine.position:
                    they_ahead += 1
                elif mine.position < theirs.position:
                    i_ahead += 1
        out.append({
            "id": competitor["id"], "host": competitor["host"], "display": store.to_display_host(competitor["host"]), "source": competitor["source"],
            "added_at": _iso(competitor["created_at"]), "shared": shared, "they_ahead": they_ahead, "i_ahead": i_ahead, "theirs_only": theirs_only,
            "edits_30d": int(edits.get(competitor["id"], 0)), "crawl": crawls[competitor["id"]],
        })
    return sorted(out, key=lambda c: (-(c["shared"] + c["theirs_only"]), c["host"]))


def _ranking_timeline(history: list[store.Check], host: str) -> list[dict]:
    """Moves between two checks of the same keyword by the same tool, from the same place, at the same depth."""
    events: list[dict] = []
    previous: dict[tuple, store.Check] = {}
    for check in history:
        key = (check.target_id, check.tool, check.real_location, check.depth)
        before = previous.get(key)
        previous[key] = check
        if before is None:
            continue
        was, now = before.best_on(host), check.best_on(host)
        at = _iso(check.checked_at)
        common = {"at": at, "keyword": check.keyword, "tool": check.tool, "engine": check.engine}
        if was is None and now is not None:
            events.append({**common, "kind": "rank_new", "to": now.position, "url": now.url, "depth": check.depth})
        elif was is not None and now is None:
            events.append({**common, "kind": "rank_lost", "from": was.position, "url": was.url, "depth": check.depth})
        elif was is not None and now is not None and abs(was.position - now.position) >= MOVE_AT_LEAST:
            events.append({**common, "kind": "rank_up" if now.position < was.position else "rank_down", "from": was.position, "to": now.position, "url": now.url})
        had_ai, has_ai = before.cites(host), check.cites(host)
        if before.ai_state != "not_captured" and check.ai_state != "not_captured" and had_ai != has_ai:
            events.append({**common, "kind": "ai_cited" if has_ai else "ai_dropped"})
    return events


def _keyword_tables(checks: list[store.Check], history: list[store.Check], site_host: str, their_host: str) -> tuple[list[dict], list[dict]]:
    current, current_ids = [], set()
    for check in checks:
        mine, theirs = check.best_on(site_host), check.best_on(their_host)
        if mine is None and theirs is None:
            continue
        if theirs is not None:
            current_ids.add(check.target_id)
        current.append({
            "keyword": check.keyword, "country": check.country, "engine": check.engine, "tool": check.tool, "location": check.real_location, "depth": check.depth,
            "checked_at": _iso(check.checked_at), "my_position": mine.position if mine else None, "my_url": mine.url if mine else None,
            "their_position": theirs.position if theirs else None, "their_url": theirs.url if theirs else None,
            "status": "shared" if mine and theirs else "theirs_only" if theirs else "mine_only",
        })
    # Past: an earlier check showed them, and the latest check of the same kind no longer does. Another tool's list
    # going deeper or looking from elsewhere says nothing about whether they dropped out.
    latest_of = {check.target_id: check for check in checks}
    past: dict[int, dict] = {}
    for check in history:
        theirs = check.best_on(their_host)
        latest = latest_of.get(check.target_id)
        if theirs is not None and latest is not None and check.target_id not in current_ids and check.same_kind_as(latest):
            past[check.target_id] = {
                "keyword": check.keyword, "engine": check.engine, "last_position": theirs.position, "last_url": theirs.url,
                "last_seen": _iso(check.checked_at), "tool": check.tool,
            }
    return (
        sorted(current, key=lambda r: ({"shared": 0, "theirs_only": 1, "mine_only": 2}[r["status"]], r["keyword"])),
        sorted(past.values(), key=lambda r: r["keyword"]),
    )


def profile(engine: Engine, site_id: int, competitor_id: int) -> dict:
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        competitor = pairs._competitor(conn, site_id, competitor_id)
        link = conn.execute(text("SELECT source, created_at FROM site_competitors WHERE site_id = :s AND competitor_id = :c"), {"s": site_id, "c": competitor_id}).mappings().first()
        crawl = _crawl_state(conn, competitor_id)
        host = competitor["host"]
        changes = conn.execute(
            text(
                "SELECT e.id, e.kind, e.before_value, e.after_value, e.detected_at, e.summaries, p.url FROM change_events e JOIN pages p ON p.id = e.page_id "
                "JOIN domains d ON d.id = e.domain_id WHERE d.host = :h ORDER BY e.id DESC LIMIT :n"
            ),
            {"h": host, "n": TIMELINE_LIMIT},
        ).mappings().all()
        page_stats = {}
        for name, value in (("mine", site["host"]), ("theirs", host)):
            row = conn.execute(
                text(
                    # New pages are the ones the timeline calls new. A first read finds every page, and none of those is new.
                    "SELECT COUNT(*) AS pages, AVG(p.word_count) AS words, "
                    "(SELECT COUNT(*) FROM change_events e WHERE e.domain_id = MAX(d.id) AND e.kind = 'new_page' AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL 30 DAY) AS new_pages, "
                    "MAX(p.last_changed_at) AS last_changed FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host = :h AND p.content_hash IS NOT NULL"
                ),
                {"h": value},
            ).mappings().first()
            page_stats[name] = {
                "pages": int(row["pages"] or 0), "average_words": round(float(row["words"])) if row["words"] else None,
                "new_pages_30d": int(row["new_pages"] or 0), "last_changed": _iso(row["last_changed"]),
            }
    checks = store.latest_checks(engine, site_id)
    past_checks = store.history(engine, site_id)
    keywords, past = _keyword_tables(checks, past_checks, site["host"], host)
    timeline = [
        {"id": row["id"], "kind": row["kind"], "at": _iso(row["detected_at"]), "url": row["url"], "before": row["before_value"], "after": row["after_value"], "summaries": json.loads(row["summaries"]) if isinstance(row["summaries"], str) else row["summaries"]}
        for row in changes
    ] + _ranking_timeline(past_checks, host)
    timeline.sort(key=lambda e: e["at"], reverse=True)

    # The headline numbers count each keyword once, however many engines checked it.
    counted, _ = _keyword_tables(store.one_per_keyword(checks), [], site["host"], host)
    shared = [row for row in counted if row["status"] == "shared"]
    my_positions = [row["my_position"] for row in shared]
    their_positions = [row["their_position"] for row in shared]
    ai_checks = [c for c in checks if c.ai_state == "present"]
    return {
        "id": competitor_id, "host": host, "display": store.to_display_host(host), "domain": domain_of(host), "source": link["source"], "added_at": _iso(link["created_at"]),
        "site": {"id": site_id, "host": site["host"]}, "crawl": crawl,
        "compare": {
            "shared": len(shared),
            "they_ahead": sum(1 for row in shared if row["their_position"] < row["my_position"]),
            "i_ahead": sum(1 for row in shared if row["my_position"] < row["their_position"]),
            "level": sum(1 for row in shared if row["my_position"] == row["their_position"]),
            "theirs_only": sum(1 for row in counted if row["status"] == "theirs_only"),
            "mine_only": sum(1 for row in counted if row["status"] == "mine_only"),
            "my_average": round(sum(my_positions) / len(my_positions), 1) if my_positions else None,
            "their_average": round(sum(their_positions) / len(their_positions), 1) if their_positions else None,
            "ai_cited_me": sum(1 for c in ai_checks if c.cites(site["host"])),
            "ai_cited_them": sum(1 for c in ai_checks if c.cites(host)),
            "ai_overviews": len(ai_checks),
            "pages": page_stats,
        },
        "keywords": keywords,
        "past_keywords": past,
        "timeline": timeline[:TIMELINE_LIMIT],
        "pairs": pairs.list_pairs(engine, site_id, competitor_id),
    }
