"""A search on Google the site has never shown up for before: one notification per query, the first day it appears.

- "Never before" means no row for that query on any earlier saved day (up to 16 months are kept).
- It runs after every finished Search Console pull, and looks at the not-final days too: a query that showed up is real
  even while the day's numbers still move, so the bell rings within the hour, not 2–3 days later.
- Each query is announced once, ever (unique subject per site). A day is looked at again until it's final, then never.
- A site needs 28 days of history first, or every query of a newly connected site would look new.
- The very first check of a site starts at its last final day, so connecting Search Console doesn't ring for old days.
- More than 50 new queries on one day: the 50 with the most impressions get their own, the rest share one.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.collectors.common import digest
from seo.worker import queue
from seo.worker.runner import handler

KIND = "new_query"
MORE_KIND = "new_query_more"
QUIET_KIND = "new_query_quiet"  # one of the extras a "more" notification lists: kept read and never shown, so it isn't announced later
SHOWN_KINDS = (KIND, MORE_KIND)
LANE = "collectors"

MIN_HISTORY_DAYS = 28
MIN_IMPRESSIONS = 1
CATCH_UP_DAYS = 7  # after a long pause, only the last week is announced
MAX_PER_DAY = 50
MORE_LISTED = 200
KEPT_DAYS = 180


def _days(conn, site_id: int) -> tuple[date, date, date, date] | None:
    """First saved day, last final day, last saved day of any kind, and where the check got to."""
    row = conn.execute(
        text(
            "SELECT MIN(day) first_day, MAX(day) last_day, "
            "MAX(IF(day < COALESCE((SELECT fresh_from FROM site_sources WHERE site_id = :s AND source = 'gsc'), '9999-12-31'), day, NULL)) last_final "
            "FROM gsc_query WHERE site_id = :s"
        ),
        {"s": site_id},
    ).mappings().first()
    if not row or row["last_day"] is None:
        return None
    mark = conn.execute(text("SELECT through FROM notification_marks WHERE site_id = :s AND kind = :k"), {"s": site_id, "k": KIND}).scalar()
    return row["first_day"], row["last_final"], row["last_day"], mark


def _pages(conn, site_id: int, day: date, queries: list[str]) -> dict[str, str]:
    """The page that showed most for each query that day."""
    if not queries:
        return {}
    statement = text("SELECT query, page, impressions FROM gsc_query_page WHERE site_id = :s AND day = :d AND query IN :q").bindparams(bindparam("q", expanding=True))
    best: dict[str, tuple[int, str]] = {}
    for r in conn.execute(statement, {"s": site_id, "d": day, "q": queries}).mappings().all():
        if r["query"] not in best or r["impressions"] > best[r["query"]][0]:
            best[r["query"]] = (r["impressions"], r["page"])
    return {query: page for query, (_, page) in best.items()}


def _new_on(conn, site_id: int, day: date) -> list[dict]:
    rows = conn.execute(
        text(
            "SELECT q.query_hash, q.query, q.clicks, q.impressions, q.position FROM gsc_query q "
            "WHERE q.site_id = :s AND q.day = :d AND q.impressions >= :m "
            "AND NOT EXISTS (SELECT 1 FROM gsc_query o WHERE o.site_id = :s AND o.query_hash = q.query_hash AND o.day < :d) "
            "AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.site_id = :s AND n.kind IN (:k, :quiet) AND n.subject_key = q.query_hash) "
            "ORDER BY q.impressions DESC, q.clicks DESC, q.position, q.query"
        ),
        {"s": site_id, "d": day, "m": MIN_IMPRESSIONS, "k": KIND, "quiet": QUIET_KIND},
    ).mappings().all()
    return [dict(r) for r in rows]


def _add(conn, site_id: int, kind: str, key: str, title: str, detail: dict) -> int:
    return conn.execute(
        text("INSERT IGNORE INTO notifications (site_id, kind, subject_key, title, detail) VALUES (:s, :k, :key, :t, :d)"),
        {"s": site_id, "k": kind, "key": key, "t": title[:300], "d": json.dumps(detail, ensure_ascii=False, default=str)},
    ).rowcount


def check(engine: Engine, site_id: int) -> dict:
    with engine.begin() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s AND kind = 'own'"), {"s": site_id}).scalar()
        known = _days(conn, site_id) if host else None
        if known is None:
            return {"site_id": site_id, "added": 0, "days": []}
        first_day, last_final, last_day, mark = known
        if mark is not None:
            start = mark + timedelta(days=1)
        else:
            start = last_final or last_day
        start = max(start, last_day - timedelta(days=CATCH_UP_DAYS - 1))
        added, looked = 0, []
        day = start
        while day <= last_day:
            if (day - first_day).days >= MIN_HISTORY_DAYS:
                looked.append(day.isoformat())
                added += _announce(conn, site_id, host, day)
            day += timedelta(days=1)
        if last_final is not None and (mark is None or last_final > mark):
            conn.execute(
                text("INSERT INTO notification_marks (site_id, kind, through) VALUES (:s, :k, :t) ON DUPLICATE KEY UPDATE through = VALUES(through)"),
                {"s": site_id, "k": KIND, "t": last_final},
            )
        conn.execute(text(f"DELETE FROM notifications WHERE site_id = :s AND created_at < UTC_TIMESTAMP(3) - INTERVAL {KEPT_DAYS} DAY"), {"s": site_id})
    return {"site_id": site_id, "added": added, "days": looked}


def _announce(conn, site_id: int, host: str, day: date) -> int:
    new = _new_on(conn, site_id, day)
    if not new:
        return 0
    own, rest = new[:MAX_PER_DAY], new[MAX_PER_DAY:]
    pages = _pages(conn, site_id, day, [r["query"] for r in own])
    added = 0
    # The bell lists the newest id first, so the extras go in first and the most shown query last: it then reads top down.
    if rest:
        listed = [{"query": r["query"], "impressions": int(r["impressions"] or 0), "position": round(r["position"], 1) if r["position"] is not None else None} for r in rest[:MORE_LISTED]]
        detail = {"host": host, "day": day.isoformat(), "count": len(rest), "queries": listed}
        added += _add(conn, site_id, MORE_KIND, digest("new-query-more", day), f"{len(rest)} more new searches", detail)
        for r in rest:  # settled now, so a later look at the same day doesn't announce them one by one
            conn.execute(
                text("INSERT IGNORE INTO notifications (site_id, kind, subject_key, title, read_at) VALUES (:s, :k, :key, :t, UTC_TIMESTAMP(3))"),
                {"s": site_id, "k": QUIET_KIND, "key": r["query_hash"], "t": r["query"][:300]},
            )
    for r in reversed(own):
        detail = {
            "host": host, "query": r["query"], "day": day.isoformat(), "clicks": int(r["clicks"] or 0), "impressions": int(r["impressions"] or 0),
            "position": round(r["position"], 1) if r["position"] is not None else None, "page": pages.get(r["query"]),
        }
        added += _add(conn, site_id, KIND, r["query_hash"], f"New search: “{r['query']}”", detail)
    return added


def enqueue(engine: Engine, site_id: int) -> int | None:
    return queue.enqueue(engine, LANE, "new-queries", {"site_id": site_id}, dedupe_key=f"new-queries|{site_id}")


@handler("new-queries")
def run_job(job: queue.ClaimedJob, engine: Engine) -> None:
    check(engine, job.payload["site_id"])
