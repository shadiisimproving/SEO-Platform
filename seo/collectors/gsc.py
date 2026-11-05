"""Search Console. Written from Google's documentation and tested on a fake: it has not yet run on a real connection.

Google lags 2-3 days and uses Pacific time. Totals per day come in one call. Pages and queries go a day at a time,
newest first, in resumable chunks.
"""
from __future__ import annotations

import time
from datetime import date, timedelta

from sqlalchemy import Engine, text

from seo.collectors import common, http
from seo.sources import credentials
from seo.sources.service import encode_property

ROW_LIMIT = 5000  # per report per site per day, from the plan's budget
HISTORY_DAYS = 486  # Google keeps 16 months
LAG_DAYS = 2
REREAD_DAYS = 5


def _query(token: str, prop: str, start: date, end: date, dimensions: list[str], limit: int) -> list[dict]:
    reply = http.request(
        "POST", f"https://www.googleapis.com/webmasters/v3/sites/{encode_property(prop)}/searchAnalytics/query", "Search Console",
        headers={"Authorization": f"Bearer {token}"},
        json={"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": dimensions, "rowLimit": limit, "type": "web"},
    )
    return reply.json().get("rows", [])


def _spine(engine: Engine, site_id: int, token: str, prop: str, start: date, end: date) -> date | None:
    rows = _query(token, prop, start, end, ["date"], 25000)
    with engine.begin() as conn:
        for row in rows:
            conn.execute(
                text(
                    "INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p) "
                    "ON DUPLICATE KEY UPDATE clicks = :c, impressions = :i, position = :p"
                ),
                {"s": site_id, "d": row["keys"][0], "c": int(row.get("clicks", 0)), "i": int(row.get("impressions", 0)), "p": row.get("position")},
            )
    return date.fromisoformat(max(row["keys"][0] for row in rows)) if rows else None


def _one_day(engine: Engine, site_id: int, token: str, prop: str, day: date) -> None:
    pages = _query(token, prop, day, day, ["page"], ROW_LIMIT)
    queries = _query(token, prop, day, day, ["query"], ROW_LIMIT)
    pairs = _query(token, prop, day, day, ["query", "page"], ROW_LIMIT)
    full = max(len(pages), len(queries), len(pairs)) >= ROW_LIMIT
    with engine.begin() as conn:
        # Google may revise a day. Replace it whole, so a row it dropped doesn't stay.
        for table in ("gsc_page", "gsc_query", "gsc_query_page"):
            conn.execute(text(f"DELETE FROM {table} WHERE site_id = :s AND day = :d"), {"s": site_id, "d": day})
        if pages:
            conn.execute(
                text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :v, :c, :i, :p)"),
                [{"s": site_id, "d": day, "h": common.digest(r["keys"][0]), "v": r["keys"][0], "c": int(r.get("clicks", 0)), "i": int(r.get("impressions", 0)), "p": r.get("position")} for r in pages],
            )
        if queries:
            conn.execute(
                text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :v, :c, :i, :p)"),
                [{"s": site_id, "d": day, "h": common.digest(r["keys"][0]), "v": r["keys"][0][:500], "c": int(r.get("clicks", 0)), "i": int(r.get("impressions", 0)), "p": r.get("position")} for r in queries],
            )
        if pairs:
            conn.execute(
                text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :v, :c, :i, :p)"),
                [{"s": site_id, "d": day, "h": common.digest(r["keys"][0], r["keys"][1]), "q": r["keys"][0][:500], "v": r["keys"][1], "c": int(r.get("clicks", 0)), "i": int(r.get("impressions", 0)), "p": r.get("position")} for r in pairs],
            )
        common.save_coverage(conn, site_id, "gsc", day, len(pages) + len(queries) + len(pairs), "partial" if full else "ok", note=f"Only the top {ROW_LIMIT} rows of a report are kept per day." if full else None)


def collect(engine: Engine, site_id: int, budget_seconds: float = 40) -> bool:
    """True when nothing is left to read. False means there's more, and the job goes back in the queue."""
    src = common.source_row(engine, site_id, "gsc")
    token = credentials.access_token(engine, src["connection_id"])
    newest = common.today(engine) - timedelta(days=LAG_DAYS)
    oldest = newest - timedelta(days=HISTORY_DAYS)
    deadline = time.monotonic() + budget_seconds
    through = _spine(engine, site_id, token, src["property"], oldest, newest)
    common.succeeded(engine, site_id, "gsc", through)
    for day in common.pending_days(engine, site_id, "gsc", newest, oldest, REREAD_DAYS):
        if time.monotonic() >= deadline:
            return False
        _one_day(engine, site_id, token, src["property"], day)
    return True
