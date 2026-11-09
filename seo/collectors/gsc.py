"""Search Console. Written from Google's documentation and tested on a fake: it has not yet run on a real connection.

It asks for fresh data (dataState "all"), the same early numbers the Search Console screen shows for the last 2 or 3 days.
Google says in metadata.first_incomplete_date which day isn't final yet: from that day on, days are read again every hour
until they're final. data_through stays the last final day, because other screens compare whole days.

Days are Pacific time, as Google counts them. Totals per day come in one call. Pages, queries, query and page pairs,
countries and devices go a day at a time, newest first, in resumable chunks.
"""
from __future__ import annotations

import time
from datetime import date, timedelta

from sqlalchemy import Engine, text

from seo.collectors import common, http
from seo.sources import credentials
from seo.sources.service import encode_property

ROW_LIMIT = 25000  # Google's most per request. A report that fills it is marked partial.
HISTORY_DAYS = 486  # Google keeps 16 months
REREAD_DAYS = 5  # final days Google may still revise, read again once a day
HOT_MINUTES = 50  # days that aren't final yet are read again when older than this
DAY_TABLES = ("gsc_page", "gsc_query", "gsc_query_page", "gsc_country", "gsc_device")


def _query(token: str, prop: str, start: date, end: date, dimensions: list[str], limit: int, data_state: str = "all", extra: dict | None = None) -> dict:
    reply = http.request(
        "POST", f"https://www.googleapis.com/webmasters/v3/sites/{encode_property(prop)}/searchAnalytics/query", "Search Console",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": dimensions, "rowLimit": limit,
            "type": "web", "dataState": data_state, **(extra or {}),
        },
    )
    return reply.json()


def _spine(engine: Engine, site_id: int, token: str, prop: str, start: date, end: date) -> tuple[date | None, date | None]:
    """Saves every day's totals. Returns the newest day Google has and its first day that isn't final yet."""
    reply = _query(token, prop, start, end, ["date"], ROW_LIMIT)
    rows = reply.get("rows", [])
    with engine.begin() as conn:
        for row in rows:
            conn.execute(
                text(
                    "INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p) "
                    "ON DUPLICATE KEY UPDATE clicks = :c, impressions = :i, position = :p"
                ),
                {"s": site_id, "d": row["keys"][0], "c": int(row.get("clicks", 0)), "i": int(row.get("impressions", 0)), "p": row.get("position")},
            )
    newest = date.fromisoformat(max(row["keys"][0] for row in rows)) if rows else None
    incomplete = (reply.get("metadata") or {}).get("first_incomplete_date")
    return newest, date.fromisoformat(incomplete) if incomplete else None


def _rows(site_id: int, day: date, found: list[dict], key_names: tuple[str, ...], with_hash: str | None) -> list[dict]:
    out = []
    for row in found:
        values = {"s": site_id, "d": day, "c": int(row.get("clicks", 0)), "i": int(row.get("impressions", 0)), "p": row.get("position")}
        for name, value in zip(key_names, row["keys"]):
            values[name] = value[:500] if name == "q" else value
        if with_hash:
            values["h"] = common.digest(*row["keys"]) if with_hash == "all" else common.digest(row["keys"][0])
        out.append(values)
    return out


def _one_day(engine: Engine, site_id: int, token: str, prop: str, day: date) -> None:
    reports = {name: _query(token, prop, day, day, dims, ROW_LIMIT).get("rows", []) for name, dims in (
        ("page", ["page"]), ("query", ["query"]), ("pair", ["query", "page"]), ("country", ["country"]), ("device", ["device"]),
    )}
    full = any(len(rows) >= ROW_LIMIT for rows in reports.values())
    inserts = (
        ("gsc_page", "INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :v, :c, :i, :p)", _rows(site_id, day, reports["page"], ("v",), "first")),
        ("gsc_query", "INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, :c, :i, :p)", _rows(site_id, day, reports["query"], ("q",), "first")),
        ("gsc_query_page", "INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :v, :c, :i, :p)", _rows(site_id, day, reports["pair"], ("q", "v"), "all")),
        ("gsc_country", "INSERT INTO gsc_country (site_id, day, country, clicks, impressions, position) VALUES (:s, :d, :k, :c, :i, :p)", _rows(site_id, day, reports["country"], ("k",), None)),
        ("gsc_device", "INSERT INTO gsc_device (site_id, day, device, clicks, impressions, position) VALUES (:s, :d, :k, :c, :i, :p)", _rows(site_id, day, reports["device"], ("k",), None)),
    )
    with engine.begin() as conn:
        # Google may revise a day. Replace it whole, so a row it dropped doesn't stay.
        for table in DAY_TABLES:
            conn.execute(text(f"DELETE FROM {table} WHERE site_id = :s AND day = :d"), {"s": site_id, "d": day})
        for _table, sql, rows in inserts:
            if rows:
                conn.execute(text(sql), rows)
        count = sum(len(rows) for rows in reports.values())
        common.save_coverage(conn, site_id, "gsc", day, count, "partial" if full else "ok", note=f"Google's limit of {ROW_LIMIT} rows a report was reached for this day." if full else None)


def _prune(engine: Engine, site_id: int, oldest: date) -> None:
    """Google keeps 16 months, so older days are gone from Search Console too, and stay out of the database."""
    with engine.begin() as conn:
        for table in ("gsc_daily", *DAY_TABLES):
            conn.execute(text(f"DELETE FROM {table} WHERE site_id = :s AND day < :o"), {"s": site_id, "o": oldest})
        conn.execute(text("DELETE FROM coverage WHERE site_id = :s AND source = 'gsc' AND day < :o"), {"s": site_id, "o": oldest})


def _save_fresh(engine: Engine, site_id: int, fresh_from: date | None, fresh_through: date | None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE site_sources SET fresh_from = :f, fresh_through = :t WHERE site_id = :s AND source = 'gsc'"),
            {"s": site_id, "f": fresh_from, "t": fresh_through},
        )


def collect(engine: Engine, site_id: int, budget_seconds: float = 40) -> bool:
    """True when nothing is left to read. False means there's more, and the job goes back in the queue."""
    src = common.source_row(engine, site_id, "gsc")
    token = credentials.access_token(engine, src["connection_id"])
    today = common.google_today(engine)
    oldest = today - timedelta(days=HISTORY_DAYS)
    deadline = time.monotonic() + budget_seconds
    newest, fresh_from = _spine(engine, site_id, token, src["property"], oldest, today)
    _prune(engine, site_id, oldest)
    if newest is None:
        common.succeeded(engine, site_id, "gsc")
        return True
    # The last final day: the day before Google's first incomplete one, never past the newest day it has.
    final = min(newest, fresh_from - timedelta(days=1)) if fresh_from else newest
    hot_from = fresh_from if fresh_from and fresh_from <= newest else None
    _save_fresh(engine, site_id, hot_from, newest if hot_from else None)
    common.succeeded(engine, site_id, "gsc")  # "data through" waits for the keywords and pages of that day, which screens read
    for day in common.pending_days(engine, site_id, "gsc", newest, oldest, REREAD_DAYS, hot_from=hot_from, hot_minutes=HOT_MINUTES):
        if time.monotonic() >= deadline:
            return False
        _one_day(engine, site_id, token, src["property"], day)
        common.succeeded(engine, site_id, "gsc", day if day <= final else None)
    common.succeeded(engine, site_id, "gsc", final)
    return True
