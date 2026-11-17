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

from sqlalchemy import Engine, bindparam, text

from seo.collectors import common, http
from seo.sources import credentials
from seo.sources.service import encode_property

ROW_LIMIT = 25000  # Google's most per request. A report that fills it is marked partial.
HISTORY_DAYS = 486  # Google keeps 16 months
REREAD_DAYS = 5  # final days Google may still revise, read again once a day
HOT_MINUTES = 50  # days that aren't final yet are read again when older than this
DAY_TABLES = ("gsc_page", "gsc_query", "gsc_query_page", "gsc_country", "gsc_device")

# Queries per target country: the query report again with a country filter, so a French site's positions are France's,
# not a world average. Google allows 25,000 rows a request and about 50,000 rows a day per search type: the countries
# share that, and a report that fills its share is marked partial.
COUNTRY_SOURCE = "gsc_country"  # its own line in coverage, so the history fills in apart from the main reports
COUNTRY_DAYS = 120  # kept and read: insights look back 90 days at most, Keywords 28
DAY_ROW_BUDGET = 50000
MAX_COUNTRIES = 3
AUTO_COUNTRIES, AUTO_SECOND_SHARE = 2, 0.25  # none chosen: the top country by clicks, and the second if it has a quarter of its clicks
AUTO_DAYS = 28

# Countries and devices have their own line in coverage. Their tables came on 2026-11-09, after the general read had
# already marked 16 months as read, so they only held the days read since (expert review 2026-11-17, 3.1). The general
# read marks the days it reads under both names; the days it never read for countries and devices are filled in by a
# backfill: newest first, a batch each hourly run, so it never takes the run's whole share and starts again where it was.
# Not "gsc_country": that name is the queries-per-country report's (COUNTRY_SOURCE above).
DIMS_SOURCE = "gsc_dims"
DIMS_DAYS_PER_RUN = 60  # two calls a day (country, device): 120 calls a run, against Google's 1,200 a minute per site


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
    # The JSON reply says firstIncompleteDate; Google's reference table writes it first_incomplete_date, which never comes.
    metadata = reply.get("metadata") or {}
    incomplete = metadata.get("firstIncompleteDate") or metadata.get("first_incomplete_date")
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
        common.save_coverage(conn, site_id, DIMS_SOURCE, day, len(reports["country"]) + len(reports["device"]))


def _dims_day(engine: Engine, site_id: int, token: str, prop: str, day: date) -> None:
    """One day's countries and devices alone, replaced whole: the backfill of the days the general read had already done."""
    reports = {dim: _query(token, prop, day, day, [dim], ROW_LIMIT).get("rows", []) for dim in ("country", "device")}
    with engine.begin() as conn:
        for dim in reports:
            conn.execute(text(f"DELETE FROM gsc_{dim} WHERE site_id = :s AND day = :d"), {"s": site_id, "d": day})
            rows = _rows(site_id, day, reports[dim], ("k",), None)
            if rows:
                conn.execute(text(f"INSERT INTO gsc_{dim} (site_id, day, {dim}, clicks, impressions, position) VALUES (:s, :d, :k, :c, :i, :p)"), rows)
        common.save_coverage(conn, site_id, DIMS_SOURCE, day, sum(len(rows) for rows in reports.values()))


def _dims_backfill(engine: Engine, site_id: int, token: str, prop: str, newest: date, oldest: date, deadline: float) -> None:
    """Countries and devices for the days never read for them, newest first, at most DIMS_DAYS_PER_RUN a run. Never before
    Google's first day for the site: there is nothing to read there. It asks coverage what's missing, so a stopped run goes
    on where it was and a finished one reads nothing (recent days are the general read's)."""
    with engine.connect() as conn:
        first = conn.execute(text("SELECT MIN(day) FROM gsc_daily WHERE site_id = :s"), {"s": site_id}).scalar()
    if first is None:
        return
    days = common.pending_days(engine, site_id, DIMS_SOURCE, newest, max(oldest, first), 0)
    for day in days[:DIMS_DAYS_PER_RUN]:
        if time.monotonic() >= deadline:
            return  # the next hourly run carries on: a backfill never asks the lane to run again at once
        _dims_day(engine, site_id, token, prop, day)


def _prune(engine: Engine, site_id: int, oldest: date) -> None:
    """Google keeps 16 months, so older days are gone from Search Console too, and stay out of the database."""
    with engine.begin() as conn:
        for table in ("gsc_daily", *DAY_TABLES):
            conn.execute(text(f"DELETE FROM {table} WHERE site_id = :s AND day < :o"), {"s": site_id, "o": oldest})
        conn.execute(text("DELETE FROM coverage WHERE site_id = :s AND source IN ('gsc', :g) AND day < :o"), {"s": site_id, "g": DIMS_SOURCE, "o": oldest})


def _save_fresh(engine: Engine, site_id: int, fresh_from: date | None, fresh_through: date | None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE site_sources SET fresh_from = :f, fresh_through = :t WHERE site_id = :s AND source = 'gsc'"),
            {"s": site_id, "f": fresh_from, "t": fresh_through},
        )


def target_countries(engine: Engine, site_id: int) -> dict:
    """The countries this site's queries are read for: the ones chosen for it, or else its top one or two by clicks."""
    with engine.connect() as conn:
        chosen = [r[0] for r in conn.execute(text("SELECT country FROM site_search_countries WHERE site_id = :s ORDER BY created_at, country"), {"s": site_id}).all()]
        if chosen:
            return {"countries": chosen[:MAX_COUNTRIES], "chosen": True}
        top = conn.execute(
            text(
                "SELECT country, SUM(clicks) c FROM gsc_country WHERE site_id = :s AND country <> 'zzz' "
                "AND day > (SELECT MAX(day) FROM gsc_country WHERE site_id = :s) - INTERVAL :d DAY GROUP BY country ORDER BY c DESC, country LIMIT :n"
            ),
            {"s": site_id, "d": AUTO_DAYS, "n": AUTO_COUNTRIES},
        ).all()
    clicks = [int(row[1] or 0) for row in top]
    picked = [top[0][0]] if top and clicks[0] else []
    if len(top) > 1 and clicks[0] and clicks[1] >= clicks[0] * AUTO_SECOND_SHARE:
        picked.append(top[1][0])
    return {"countries": picked, "chosen": False}


def _country_day(engine: Engine, site_id: int, token: str, prop: str, day: date, wanted: list[str], key: str) -> None:
    limit = min(ROW_LIMIT, DAY_ROW_BUDGET // max(1, len(wanted)))
    reports = {
        country: _query(token, prop, day, day, ["query"], limit, extra={"dimensionFilterGroups": [{"filters": [{"dimension": "country", "operator": "equals", "expression": country}]}]}).get("rows", [])
        for country in wanted
    }
    full = any(len(rows) >= limit for rows in reports.values())
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM gsc_query_country WHERE site_id = :s AND day = :d"), {"s": site_id, "d": day})
        rows = []
        for country, found in reports.items():
            for row in _rows(site_id, day, found, ("q",), "first"):
                rows.append({**row, "k": country})
        if rows:
            conn.execute(text("INSERT INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :k, :h, :q, :c, :i, :p)"), rows)
        # The note holds the countries read, so choosing other countries reads the days again.
        common.save_coverage(conn, site_id, COUNTRY_SOURCE, day, len(rows), "partial" if full else "ok", note=key)


def _countries(engine: Engine, site_id: int, token: str, prop: str, newest: date, hot_from: date | None, reread: list[date], deadline: float) -> bool:
    wanted = target_countries(engine, site_id)["countries"]
    oldest = newest - timedelta(days=COUNTRY_DAYS - 1)
    with engine.begin() as conn:
        first = conn.execute(text("SELECT MIN(day) FROM gsc_daily WHERE site_id = :s"), {"s": site_id}).scalar()
        oldest = max(oldest, first or newest)  # no day before Google's first one
        conn.execute(text("DELETE FROM gsc_query_country WHERE site_id = :s AND day < :o"), {"s": site_id, "o": oldest})
        conn.execute(text("DELETE FROM coverage WHERE site_id = :s AND source = :c AND day < :o"), {"s": site_id, "c": COUNTRY_SOURCE, "o": oldest})
        if not wanted:
            conn.execute(text("DELETE FROM gsc_query_country WHERE site_id = :s"), {"s": site_id})
            return True
        statement = text("DELETE FROM gsc_query_country WHERE site_id = :s AND country NOT IN :w").bindparams(bindparam("w", expanding=True))
        conn.execute(statement, {"s": site_id, "w": wanted})
        key = ",".join(sorted(wanted))
        changed = {r[0] for r in conn.execute(text("SELECT day FROM coverage WHERE site_id = :s AND source = :c AND (note IS NULL OR note <> :k)"), {"s": site_id, "c": COUNTRY_SOURCE, "k": key}).all()}
    days = set(common.pending_days(engine, site_id, COUNTRY_SOURCE, newest, oldest, REREAD_DAYS, hot_from=hot_from, hot_minutes=HOT_MINUTES))
    days |= changed | {day for day in reread if day >= oldest}
    for day in sorted(days, reverse=True):
        if time.monotonic() >= deadline:
            return False
        _country_day(engine, site_id, token, prop, day, wanted, key)
    return True


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
    # Days read while they weren't final, that Google now calls final: their rows are still the early ones, so they're read
    # once more, first. Until then they stay marked not final, so no screen or insight counts them (code review F12).
    was_fresh = src["fresh_from"]
    stale = []
    if was_fresh and was_fresh <= final:
        day = final
        while day >= was_fresh:
            stale.append(day)
            day -= timedelta(days=1)
    _save_fresh(engine, site_id, stale[-1] if stale else hot_from, newest if stale or hot_from else None)
    common.succeeded(engine, site_id, "gsc")  # "data through" waits for the keywords and pages of that day, which screens read
    pending = common.pending_days(engine, site_id, "gsc", newest, oldest, REREAD_DAYS, hot_from=hot_from, hot_minutes=HOT_MINUTES)
    reread = list(stale)
    for day in stale + [d for d in pending if d not in stale]:
        if time.monotonic() >= deadline:
            return False
        _one_day(engine, site_id, token, src["property"], day)
        if stale and day in stale:
            stale.remove(day)
            if not stale:
                _save_fresh(engine, site_id, hot_from, newest if hot_from else None)
        common.succeeded(engine, site_id, "gsc", day if day <= final else None)
    common.succeeded(engine, site_id, "gsc", final)
    if not _countries(engine, site_id, token, src["property"], newest, hot_from, reread, deadline):
        return False
    _dims_backfill(engine, site_id, token, src["property"], newest, oldest, deadline)
    return True
