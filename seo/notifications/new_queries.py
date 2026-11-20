"""Searches on Google a site has never shown up for before: one notification per site per day, listing them.

- "Never before" means no row for that query on any earlier saved day (up to 16 months are kept).
- A search is announced once it has reached MIN_IMPRESSIONS over the days since it first showed: one impression at
  position 60 is noise; ten is someone searching for it. It has CATCH_UP_DAYS to get there, then it isn't news any more.
- It runs after every finished Search Console pull, and reads the not-final days too: a search that showed up is real
  even while the day's numbers still move.
- One notification per site per day of data (the newest day looked at): a later pull the same day adds to it and makes
  it unread again, rather than ringing once per search. Each search is announced once, ever (a quiet row keeps it).
- A site needs 28 days of history first, or every query of a newly connected site would look new. The very first check
  starts at its last final day, so connecting Search Console doesn't ring for old searches.

Older single-search notifications (new_query, new_query_more) are still shown as they were.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.collectors.common import digest
from seo.worker import queue
from seo.worker.runner import handler

KIND = "new_query"  # one search, from before grouping; also the mark's kind
MORE_KIND = "new_query_more"
GROUP_KIND = "new_queries"  # the day's new searches for one site
QUIET_KIND = "new_query_quiet"  # one announced search: kept read and never shown, so it isn't announced again
SHOWN_KINDS = (GROUP_KIND, KIND, MORE_KIND, "social_ready")  # social_ready: the morning's drafts (seo.social.service._bell)
LANE = "collectors"

MIN_HISTORY_DAYS = 28
MIN_IMPRESSIONS = 10  # over the days since the search first showed, all its rows added up. The one place this is set.
CATCH_UP_DAYS = 7  # a search has this long to reach the floor; after a long pause, only the last week is looked at
LISTED = 200  # searches listed in one notification, the most shown first
KEPT_DAYS = 180


def _days(conn, site_id: int) -> tuple[date, date, date, date] | None:
    """First saved day, last final day, last saved day of any kind, and the day the first check started from."""
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


def _pages(conn, site_id: int, since: date, queries: list[str]) -> dict[str, str]:
    """The page that showed most for each search since it appeared."""
    if not queries:
        return {}
    statement = text(
        "SELECT query, page, SUM(impressions) i FROM gsc_query_page WHERE site_id = :s AND day >= :d AND query IN :q GROUP BY pair_hash, query, page"
    ).bindparams(bindparam("q", expanding=True))
    best: dict[str, tuple[int, str]] = {}
    for r in conn.execute(statement, {"s": site_id, "d": since, "q": queries}).mappings().all():
        shown = int(r["i"] or 0)
        if r["query"] not in best or shown > best[r["query"]][0]:
            best[r["query"]] = (shown, r["page"])
    return {query: page for query, (_, page) in best.items()}


def _new_since(conn, site_id: int, since: date) -> list[dict]:
    """Searches whose first day ever is on or after `since`, not announced yet, with their numbers since then."""
    rows = conn.execute(
        text(
            "SELECT q.query_hash, MAX(q.query) query, MIN(q.day) first_day, SUM(q.clicks) clicks, SUM(q.impressions) impressions, "
            "SUM(q.position * q.impressions) / NULLIF(SUM(q.impressions), 0) position FROM gsc_query q "
            "WHERE q.site_id = :s AND q.day >= :d "
            "AND NOT EXISTS (SELECT 1 FROM gsc_query o WHERE o.site_id = :s AND o.query_hash = q.query_hash AND o.day < :d) "
            "AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.site_id = :s AND n.kind IN (:k, :quiet) AND n.subject_key = q.query_hash) "
            "GROUP BY q.query_hash HAVING SUM(q.impressions) >= :m ORDER BY impressions DESC, clicks DESC, position, query"
        ),
        {"s": site_id, "d": since, "m": MIN_IMPRESSIONS, "k": KIND, "quiet": QUIET_KIND},
    ).mappings().all()
    return [dict(r) for r in rows]


def _title(count: int, first: str) -> str:
    return f"New search: “{first}”" if count == 1 else f"{count} new searches"


def check(engine: Engine, site_id: int) -> dict:
    with engine.begin() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s AND kind = 'own'"), {"s": site_id}).scalar()
        known = _days(conn, site_id) if host else None
        if known is None:
            return {"site_id": site_id, "added": 0, "days": []}
        first_day, last_final, last_day, mark = known
        if mark is None:  # the first check: only what shows from the last final day on
            mark = (last_final or last_day) - timedelta(days=1)
            conn.execute(
                text("INSERT INTO notification_marks (site_id, kind, through) VALUES (:s, :k, :t) ON DUPLICATE KEY UPDATE through = VALUES(through)"),
                {"s": site_id, "k": KIND, "t": mark},
            )
        since = max(mark + timedelta(days=1), last_day - timedelta(days=CATCH_UP_DAYS - 1), first_day + timedelta(days=MIN_HISTORY_DAYS))
        added = 0
        looked = []
        if since <= last_day:
            looked = [(since + timedelta(days=n)).isoformat() for n in range((last_day - since).days + 1)]
            added = _announce(conn, site_id, host, last_day, _new_since(conn, site_id, since))
        conn.execute(text(f"DELETE FROM notifications WHERE site_id = :s AND created_at < UTC_TIMESTAMP(3) - INTERVAL {KEPT_DAYS} DAY"), {"s": site_id})
    return {"site_id": site_id, "added": added, "days": looked}


def _announce(conn, site_id: int, host: str, day: date, new: list[dict]) -> int:
    """Adds the new searches to the site's notification for `day`, made unread again for everyone. Returns how many."""
    if not new:
        return 0
    pages = _pages(conn, site_id, min(r["first_day"] for r in new), [r["query"] for r in new])
    listed = [
        {"query": r["query"], "first_day": r["first_day"].isoformat(), "impressions": int(r["impressions"] or 0), "clicks": int(r["clicks"] or 0),
         "position": round(float(r["position"]), 1) if r["position"] is not None else None, "page": pages.get(r["query"])}
        for r in new
    ]
    key = digest("new-queries", day)
    held = conn.execute(text("SELECT id, detail FROM notifications WHERE site_id = :s AND kind = :k AND subject_key = :key"), {"s": site_id, "k": GROUP_KIND, "key": key}).mappings().first()
    before, before_count = [], 0
    if held:
        old = held["detail"] if isinstance(held["detail"], dict) else json.loads(held["detail"] or "{}")
        before = old.get("queries") or []
        before_count = int(old.get("count") or len(before))
    queries = sorted(before + listed, key=lambda q: (-q["impressions"], -q["clicks"], q["query"]))
    count = before_count + len(listed)
    detail = {"host": host, "day": day.isoformat(), "count": count, "queries": queries[:LISTED], "min_impressions": MIN_IMPRESSIONS}
    title = _title(count, queries[0]["query"])
    body = json.dumps(detail, ensure_ascii=False, default=str)
    if held:
        conn.execute(text("UPDATE notifications SET title = :t, detail = :d, read_at = NULL, created_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"t": title[:300], "d": body, "i": held["id"]})
        conn.execute(text("DELETE FROM notification_reads WHERE notification_id = :i"), {"i": held["id"]})
    else:
        conn.execute(
            text("INSERT INTO notifications (site_id, kind, subject_key, title, detail) VALUES (:s, :k, :key, :t, :d)"),
            {"s": site_id, "k": GROUP_KIND, "key": key, "t": title[:300], "d": body},
        )
    for r in new:  # settled now: never announced again
        conn.execute(
            text("INSERT IGNORE INTO notifications (site_id, kind, subject_key, title, read_at) VALUES (:s, :k, :key, :t, UTC_TIMESTAMP(3))"),
            {"s": site_id, "k": QUIET_KIND, "key": r["query_hash"], "t": r["query"][:300]},
        )
    return len(new)


def enqueue(engine: Engine, site_id: int) -> int | None:
    return queue.enqueue(engine, LANE, "new-queries", {"site_id": site_id}, dedupe_key=f"new-queries|{site_id}")


@handler("new-queries")
def run_job(job: queue.ClaimedJob, engine: Engine) -> None:
    check(engine, job.payload["site_id"])
