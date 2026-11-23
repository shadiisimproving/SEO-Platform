"""Search Console countries and devices (expert review 2026-11-17, accuracy/search-console.md 3.1).

The tables were added on 2026-11-09 and only held the days read since. These tests pin the three fixes with golden numbers:

- the collector fills every missing country and device day over Google's 16 months, in batches across hourly runs, under
  its own coverage name (gsc_dims), until the countries and the devices add up to the site's totals on every period;
- the history check takes a table's own first day, never the general Search Console read's;
- Insights' "one country or device carries the change" waits for each table's own history.
"""
import json
import math
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, gsc
from seo.insights import data, movement
from seo.metrics import period, search
from tests.test_collectors import _google, key, world  # noqa: F401 - fixtures
from tests.test_insights import BEFORE, NOW, World, site  # noqa: F401 - site is a fixture

HOME = "https://shop-one.test/"


def _clicks(day: date) -> int:
    return day.toordinal() % 7 + 3  # 3 to 9 a day, never the same week to week


def _split(day: date) -> dict:
    """What fake Google gives per dimension for one day: the parts add up to the day's total, as on the real one."""
    total = _clicks(day)
    return {
        "country": [("are", total - total // 3), ("fra", total // 3)],
        "device": [("MOBILE", total - total // 4), ("DESKTOP", total // 4)],
    }


def _golden_google(calls: list, first: date | None = None):
    """first: Google's first day for the site (none before it)."""
    def answer(request):
        body = json.loads(request.content)
        dims, start, end = body["dimensions"], date.fromisoformat(body["startDate"]), date.fromisoformat(body["endDate"])
        calls.append((tuple(dims), start))
        if first and dims == ["date"]:
            start = max(start, first)
        elif first and start < first:
            return httpx.Response(200, json={})
        if dims == ["date"]:
            days = [start + timedelta(days=n) for n in range((end - start).days + 1)]
            return httpx.Response(200, json={"rows": [{"keys": [d.isoformat()], "clicks": _clicks(d), "impressions": _clicks(d) * 10, "position": 5.0} for d in days]})
        if dims in (["country"], ["device"]):
            return httpx.Response(200, json={"rows": [{"keys": [k], "clicks": c, "impressions": c * 10, "position": 5.0} for k, c in _split(start)[dims[0]]]})
        if dims == ["page"]:
            return httpx.Response(200, json={"rows": [{"keys": [HOME], "clicks": _clicks(start), "impressions": _clicks(start) * 10, "position": 5.0}]})
        if dims == ["query"]:
            return httpx.Response(200, json={"rows": [{"keys": ["shoes"], "clicks": _clicks(start), "impressions": _clicks(start) * 10, "position": 5.0}]})
        return httpx.Response(200, json={"rows": [{"keys": ["shoes", HOME], "clicks": _clicks(start), "impressions": _clicks(start) * 10, "position": 5.0}]})
    return answer


def _as_before_the_fix(w, today: date, dims_days: int = 13):
    """The live state on 2026-11-17: the general read covers all 16 months, the country and device tables only their last 13 days."""
    oldest = today - timedelta(days=gsc.HISTORY_DAYS)
    with w.engine.begin() as conn:
        day = oldest
        while day <= today:
            conn.execute(text("INSERT INTO coverage (site_id, source, day, saved_at) VALUES (:s, 'gsc', :d, UTC_TIMESTAMP(3))"), {"s": w.site, "d": day})
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, 5)"), {"s": w.site, "d": day, "c": _clicks(day), "i": _clicks(day) * 10})
            conn.execute(text("INSERT INTO coverage (site_id, source, day, saved_at, note) VALUES (:s, 'gsc_country', :d, UTC_TIMESTAMP(3), 'are')"), {"s": w.site, "d": day})
            if (today - day).days < dims_days:
                for dim, rows in _split(day).items():
                    for k, c in rows:
                        conn.execute(text(f"INSERT INTO gsc_{dim} (site_id, day, {dim}, clicks, impressions, position) VALUES (:s, :d, :k, :c, :i, 5)"), {"s": w.site, "d": day, "k": k, "c": c, "i": c * 10})
            day += timedelta(days=1)
        conn.execute(text("INSERT INTO site_search_countries (site_id, country) VALUES (:s, 'are')"), {"s": w.site})


def _sums(engine, site_id, range_key):
    scope, window = period.scope_for(engine, {"site_id": str(site_id), "range": range_key, "compare": "none"})
    with engine.connect() as conn:
        total = conn.execute(text("SELECT SUM(clicks) FROM gsc_daily WHERE site_id = :s AND day BETWEEN :a AND :b"), {"s": site_id, "a": window["from"], "b": window["to"]}).scalar()
    parts = {dim: sum(r["clicks"] for r in search.breakdown(scope, dim, "all", limit=1000)["rows"]) for dim in ("country", "device")}
    return int(total), parts, window


def test_the_backfill_fills_16_months_of_countries_and_devices_in_batches_until_they_add_up(world):
    _google(world)
    calls = []
    world.answers["searchAnalytics"] = _golden_google(calls)
    today = common.google_today(world.engine)
    _as_before_the_fix(world, today)

    total, parts, window = _sums(world.engine, world.site, "16m")
    assert parts["country"] < total / 10  # the bug: 13 days shown as 16 months

    missing = gsc.HISTORY_DAYS + 1  # every day from the oldest Google keeps through today, none yet under gsc_dims
    runs = 0
    while True:
        calls.clear()
        assert gsc.collect(world.engine, world.site) is True  # a batch never asks to run again at once: the next hourly run goes on
        runs += 1
        dims_calls = [c for c in calls if c[0] in (("country",), ("device",))]
        assert len(dims_calls) <= 2 * gsc.DIMS_DAYS_PER_RUN  # polite: one batch a run
        pending = common.pending_days(world.engine, world.site, gsc.DIMS_SOURCE, today, today - timedelta(days=gsc.HISTORY_DAYS), 0)
        if not pending:
            break
        assert runs < 50
    assert runs == math.ceil(missing / gsc.DIMS_DAYS_PER_RUN)

    for range_key in ("16m", "28d", "3m", "7d"):
        total, parts, window = _sums(world.engine, world.site, range_key)
        assert parts == {"country": total, "device": total}, (range_key, window["from"], window["to"])
    _scope, window = period.scope_for(world.engine, {"site_id": str(world.site), "range": "28d", "compare": "prev"})
    assert window["rows_compare"]["country"] is True and window["rows_compare"]["device"] is True

    calls.clear()  # finished: an hourly run reads no old country or device day again
    gsc.collect(world.engine, world.site)
    assert not [c for c in calls if c[0] in (("country",), ("device",)) and c[1] < today - timedelta(days=gsc.REREAD_DAYS)]


def test_the_backfill_is_resumable_and_never_reads_before_googles_first_day(world):
    _google(world)
    calls = []
    world.answers["searchAnalytics"] = _golden_google(calls)
    today = common.google_today(world.engine)
    gsc.collect(world.engine, world.site, budget_seconds=0)  # killed at once: nothing marked read that wasn't
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM coverage WHERE source = :c"), {"c": gsc.DIMS_SOURCE}).scalar() == 0
    # A site Google has only 30 days for: the backfill stops at its first day.
    with world.engine.begin() as conn:
        for table in ("gsc_daily", "gsc_page", "gsc_query", "gsc_query_page", "gsc_country", "gsc_device", "coverage"):
            conn.execute(text(f"DELETE FROM {table}"))
    calls.clear()
    world.answers["searchAnalytics"] = _golden_google(calls, first=today - timedelta(days=29))
    for _ in range(5):
        gsc.collect(world.engine, world.site)
    general = {c[1] for c in calls if c[0] == ("page",)}  # the general read asks every report of every day it reads, as before
    assert not [c for c in calls if c[0] in (("country",), ("device",)) and c[1] < today - timedelta(days=29) and c[1] not in general]
    _scope, window = period.scope_for(world.engine, {"site_id": str(world.site), "range": "7d", "compare": "none"})
    assert window["rows_from"]["country"] == (today - timedelta(days=29)).isoformat()  # where Google's data starts, not before


def test_the_general_read_marks_its_country_and_device_days_too(world):
    _google(world)
    world.answers["searchAnalytics"] = _golden_google([])
    gsc.collect(world.engine, world.site)
    today = common.google_today(world.engine)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT `rows` FROM coverage WHERE site_id = :s AND source = :c AND day = :d"), {"s": world.site, "c": gsc.DIMS_SOURCE, "d": today}).scalar() == 4


# ---- the history check ---------------------------------------------------------------------------------------------


@pytest.fixture
def end(engine):
    return common.google_today(engine) - timedelta(days=3)


def _live_like(engine, end, dims_days=13, daily_days=486, coverage_from=None, host="shop-one.test"):
    """Totals, pages and queries for daily_days days; countries and devices for the last dims_days; the general read's
    coverage from coverage_from (default: the first daily day)."""
    with engine.begin() as conn:
        site = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'own')"), {"h": host, "u": f"https://{host}/"}).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through) VALUES (:s, 'gsc', :d)"), {"s": site, "d": end})
        first = end - timedelta(days=daily_days - 1)
        cover = coverage_from or first
        day = min(first, cover)
        while day <= end:
            if day >= cover:
                conn.execute(text("INSERT INTO coverage (site_id, source, day) VALUES (:s, 'gsc', :d)"), {"s": site, "d": day})
            if day >= first:
                conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, 10, 100, 5)"), {"s": site, "d": day})
                for table, key, column in (("gsc_page", "page_hash", "page"), ("gsc_query", "query_hash", "query")):
                    conn.execute(text(f"INSERT INTO {table} (site_id, day, {key}, {column}, clicks, impressions, position) VALUES (:s, :d, 'h', 'x', 10, 100, 5)"), {"s": site, "d": day})
            if (end - day).days < dims_days:
                conn.execute(text("INSERT INTO gsc_country (site_id, day, country, clicks, impressions, position) VALUES (:s, :d, 'fra', 10, 100, 5)"), {"s": site, "d": day})
                conn.execute(text("INSERT INTO gsc_device (site_id, day, device, clicks, impressions, position) VALUES (:s, :d, 'MOBILE', 10, 100, 5)"), {"s": site, "d": day})
            day += timedelta(days=1)
    return site


def test_country_and_device_history_starts_on_their_own_first_day_not_the_general_reads(engine, end):
    site = _live_like(engine, end)
    scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "prev"})
    dims_first = (end - timedelta(days=12)).isoformat()
    assert window["compare_from"]  # the totals compare
    assert window["rows_from"]["country"] == dims_first and window["rows_from"]["device"] == dims_first
    assert window["rows_compare"] == {"query": True, "page": True, "country": False, "device": False}
    gaining = search.breakdown(scope, "country", "gaining")
    assert gaining["rows"] == [] and gaining["compare_unavailable"] == "rows_history" and gaining["rows_from"] == dims_first
    assert "new" not in search.breakdown(scope, "device", "all")["counts"]  # no "New" made from missing days


def test_country_days_read_with_no_rows_still_count_as_history(engine, end):
    site = _live_like(engine, end)
    with engine.begin() as conn:  # the backfill read those days; the site just had no country rows on them
        for n in range(13, 60):
            conn.execute(text("INSERT INTO coverage (site_id, source, day) VALUES (:s, :c, :d)"), {"s": site, "c": "gsc_dims", "d": end - timedelta(days=n)})
    _scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "prev"})
    assert window["rows_from"]["country"] == (end - timedelta(days=59)).isoformat()
    assert window["rows_compare"]["country"] is True and window["rows_compare"]["device"] is True


def test_coverage_from_before_google_had_any_day_never_moves_a_table_start(engine, end):
    """Site 2 live: coverage 'gsc' from 2025-07-19, daily data from 2026-07-15. rows_from must say where data starts."""
    site = _live_like(engine, end, daily_days=126, coverage_from=end - timedelta(days=485))
    _scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "prev"})
    first = (end - timedelta(days=125)).isoformat()
    assert window["history_from"] == first
    assert window["rows_from"]["page"] == first and window["rows_from"]["query"] == first


# ---- Insights: one country or device carries the change ------------------------------------------------------------


def _countries(engine, site_id, first, last, fra, others):
    with engine.begin() as conn:
        day = first
        while day <= last:
            for country, clicks in (("fra", fra), ("esp", others)):
                conn.execute(text("INSERT INTO gsc_country (site_id, day, country, clicks, impressions, position) VALUES (:s, :d, :k, :c, :i, 5)"), {"s": site_id, "d": day, "k": country, "c": clicks, "i": clicks * 20})
            day += timedelta(days=1)


def test_a_country_table_that_starts_inside_the_period_raises_no_france_plus_85(engine, site):
    w = World(engine, site)
    w.spread(BEFORE[0], NOW[1], "shoes", HOME, 10, 100, 5)
    w.save()
    _countries(engine, site, NOW[1] - timedelta(days=12), NOW[1], fra=7, others=3)  # 13 days only: France "+91 (0 before)"
    ctx = data.load(engine, site)
    assert ctx.has_before  # pages and queries do compare
    result = movement.segments(ctx)
    assert not [f for f in result.findings if f.kind == "segment"]
    assert "segment" in result.ran  # an old false finding goes away
    assert result.needs.get("segment_country") == (NOW[1] - timedelta(days=12)).isoformat()


def test_a_country_with_full_history_still_carries_the_change(engine, site):
    w = World(engine, site)
    w.spread(BEFORE[0], NOW[1], "shoes", HOME, 10, 100, 5)
    w.save()
    _countries(engine, site, *BEFORE, fra=6, others=4)
    _countries(engine, site, *NOW, fra=2, others=4)
    found = [f for f in movement.segments(data.load(engine, site)).findings if f.kind == "segment"]
    assert len(found) == 1 and found[0].evidence["segment"] == "fra" and found[0].evidence["clicks"] == 56 and found[0].evidence["clicks_before"] == 168
