"""One period rule everywhere (expert review 2026-11-17, SUMMARY section 4 patterns 1 and 2).

Golden numbers, worked out by hand: a site with 10 clicks a day, every day, so 28 days hold 280 clicks whichever screen
asks. The last final day is END; the two days after it are fresh (not final) and low, and must never be counted.
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors import common
from seo.exports import fmt, registry
from seo.insights import data as insights_data, movement
from seo.metrics import period, search, service, today as today_view
from seo.pages import service as pages



@pytest.fixture
def end(engine):
    return common.google_today(engine) - timedelta(days=3)


def _site(engine, end, host="shop-one.test"):
    with engine.begin() as conn:
        site = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'own')"), {"h": host, "u": f"https://{host}/"}).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from, fresh_through) VALUES (:s, 'gsc', :d, :f, :t)"),
                     {"s": site, "d": end, "f": end + timedelta(days=1), "t": end + timedelta(days=2)})
    return site


def _days(engine, site, end, count, clicks=10, page_days=None, page="https://shop-one.test/a/"):
    """count days of totals ending on end (plus 2 fresh days of 1 click); page rows for the last page_days days (all: count)."""
    page_days = count if page_days is None else page_days
    with engine.begin() as conn:
        for n in range(-2, count):
            day = end - timedelta(days=n)
            c = 1 if n < 0 else clicks
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, 100, 5)"), {"s": site, "d": day, "c": c})
            if n < page_days:
                conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, 100, 5)"),
                             {"s": site, "d": day, "h": common.digest(page), "p": page, "c": c})
                conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'shoes', :c, 100, 5)"),
                             {"s": site, "d": day, "h": common.digest("shoes"), "c": c})


def _browser_scope(engine, site, end, extra=None):
    """What Pages and Content send: the browser's dates (28 days ending yesterday) and the shared range beside them."""
    to = end + timedelta(days=2)
    scope = service.Scope(engine, site, (to - timedelta(days=27)).isoformat(), to.isoformat(), (to - timedelta(days=55)).isoformat(), (to - timedelta(days=28)).isoformat())
    scope.search_args = service.search_args({"range": "28d", "compare": "prev", **(extra or {})})
    return scope


# ---- #4 one 28-day number on every screen ---------------------------------------------------------------------------


def test_the_same_28_days_give_the_same_clicks_on_every_screen(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 70)
    with engine.begin() as conn:  # Google's row limit hit on one day: its total is complete, so it still counts
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status) VALUES (:s, 'gsc', :d, 'partial')"), {"s": site, "d": end - timedelta(days=5)})
    want_from, want_to = (end - timedelta(days=27)).isoformat(), end.isoformat()

    scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "prev"})
    assert (window["from"], window["to"], window["days"]) == (want_from, want_to, 28)
    overview = search.overview(scope, window)
    assert overview["totals"]["clicks"] == 280 and overview["before"]["clicks"] == 280

    today = today_view.today(engine, site, {"range": "28d", "compare": "prev"})["results"]
    assert today["clicks"]["value"] == 280 and (today["window"]["from"], today["window"]["to"]) == (want_from, want_to)

    ctx = insights_data.load(engine, site)
    assert (ctx.start.isoformat(), ctx.end.isoformat()) == (want_from, want_to)
    change = movement.breakdown(ctx).findings[0].evidence
    assert change["now"]["clicks"] == 280 and change["before"]["clicks"] == 280  # it used to leave the partial day out: 270

    listed = pages.listing(_browser_scope(engine, site, end))
    row = next(r for r in listed["pages"] if r["path"] == "/a/")
    assert row["clicks"] == 280 and row["clicks_before"] == 280  # it used to count 26 days of data against 28 before
    assert (listed["gsc_window"]["from"], listed["gsc_window"]["to"]) == (want_from, want_to)

    content = service.content(_browser_scope(engine, site, end))
    assert next(r for r in content["pages"] if r["path"] == "/a/")["clicks"] == 280

    profile = pages.profile(engine, site, "/a/")
    assert profile["google_28d"]["clicks"] == 280 and profile["google_28d"]["to"] == want_to  # it used to be "28 days ending today"

    panel = service.page_detail(_browser_scope(engine, site, end), "/a/", "shop-one.test")
    assert panel["totals"]["clicks"] == 280 and panel["before"]["clicks"] == 280
    assert (panel["periods"]["gsc"]["from"], panel["periods"]["gsc"]["to"]) == (want_from, want_to)


def test_without_a_range_the_dates_sent_end_on_the_last_final_day_and_the_period_before_is_cut_alike(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 70)
    scope = _browser_scope(engine, site, end)
    scope.search_args = {}
    gsc, window = period.search_scope(scope)
    assert gsc.end == end and (gsc.compare_end - gsc.compare_start) == (gsc.end - gsc.start)  # 26 days against 26


# ---- #2 the header prints only what was compared; one "last year" rule ---------------------------------------------


def test_last_year_is_52_weeks_back_so_weekdays_line_up(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 420)
    _scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "yoy"})
    assert window["compare_from"] == (end - timedelta(days=27 + 364)).isoformat() and window["compare_to"] == (end - timedelta(days=364)).isoformat()
    assert date.fromisoformat(window["compare_to"]).weekday() == end.weekday()


def test_a_comparison_never_made_is_never_printed_and_says_why(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 40)  # totals start 39 days before the end: the 28 before the last 28 aren't all stored
    _scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "prev"})
    assert window["compare_from"] is None and window["compare_unavailable"] == "history"
    assert window["history_from"] == (end - timedelta(days=39)).isoformat()  # so the screen can say "data starts …"
    _scope, window = period.scope_for(engine, {"site_id": str(site), "range": "16m", "compare": "prev"})
    assert window["compare_from"] is None and window["compare_unavailable"] == "google"  # 32 months back: Google never had it


# ---- #5 one "is there earlier data?" check per table ----------------------------------------------------------------


def test_page_and_search_tables_that_start_later_make_no_gains(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 70, page_days=14)  # totals for 70 days, page and search tables only for the last 14
    scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "prev"})
    assert window["compare_from"] and window["rows_compare"] == {"query": False, "page": False, "country": False, "device": False}
    assert window["rows_from"]["page"] == (end - timedelta(days=13)).isoformat()

    overview = search.overview(scope, window)
    assert overview["before"]["clicks"] == 280  # the site's totals do compare
    assert overview["queries_before"] is None
    assert not (overview["answer"].get("drivers") or [])  # no page or search named as a cause from missing history
    gaining = search.breakdown(scope, "page", "gaining")
    assert gaining["rows"] == [] and gaining["compare_unavailable"] == "rows_history" and gaining["rows_from"] == window["rows_from"]["page"]
    assert "clicks_before" not in search.breakdown(scope, "page", "all")["rows"][0]
    assert "new" not in search.breakdown(scope, "query", "all")["counts"]

    ctx = insights_data.load(engine, site)
    assert not ctx.has_before  # the page-by-page and search-by-search detectors wait
    assert movement.pages(ctx).needs == {"page_down": "history", "page_up": "history"}

    row = next(r for r in pages.listing(_browser_scope(engine, site, end))["pages"] if r["path"] == "/a/")
    assert row["clicks"] == 140 and row["clicks_before"] is None  # not "+140 gained"


def test_a_table_read_further_back_than_its_first_row_still_compares(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 70, page_days=14)
    with engine.begin() as conn:  # the read covered those days; the site just had no page rows on them
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status) VALUES (:s, 'gsc', :d, 'ok')"), {"s": site, "d": end - timedelta(days=69)})
    _scope, window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "prev"})
    assert window["rows_compare"]["page"] is True


# ---- #8 long charts: the newest week is whole -----------------------------------------------------------------------


def test_weeks_count_back_from_the_last_day_and_a_short_first_week_is_not_drawn(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 400)
    scope, window = period.scope_for(engine, {"site_id": str(site), "range": "6m", "compare": "prev"})
    found = search.overview(scope, window)
    length = window["days"]
    assert found["granularity"] == "week"
    assert all(p["days"] == 7 and p["clicks"] == 70 for p in found["series"])  # no 2-day "cliff" at the end
    assert found["series"][-1]["day"] == (end - timedelta(days=6)).isoformat()
    assert len(found["series"]) == length // 7 and found["week_left_out"]["days"] == length % 7
    assert found["totals"]["clicks"] == 10 * length  # the short week still counts
    assert all(p["days"] == 7 for p in found["compare_series"]) and len(found["compare_series"]) == len(found["series"])


# ---- #3 exports say what the screen says, with each change in its own unit -----------------------------------------


def _ga4(engine, site, last, days, leads_now, leads_before):
    with engine.begin() as conn:
        for n in range(days * 2):
            day = last - timedelta(days=n)
            leads = (leads_now if n < days else leads_before) if n % days == 0 else 0
            conn.execute(text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, 'Organic Search', 'google', 'organic', 10, 10, :k)"),
                         {"s": site, "d": day, "h": f"r{n}", "k": leads})


def test_today_export_uses_the_period_on_screen_and_leads_change_is_a_count(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 70)
    _ga4(engine, site, end, 7, 14, 12)
    with engine.begin() as conn:  # GA4 has two days more than Search Console's last final day: they are not counted
        for n in (1, 2):
            conn.execute(text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, 'Organic Search', 'google', 'organic', 10, 10, 9)"),
                         {"s": site, "d": end + timedelta(days=n), "h": f"late{n}"})
    report = registry.build(engine, "today", {"site_id": str(site), "range": "7d", "compare": "prev"})
    assert report.period == (end - timedelta(days=6), end)  # 7 days, as asked (it used to export 28)
    assert report.compare == (end - timedelta(days=13), end - timedelta(days=7))
    tiles = {t.label: t for t in report.tiles}
    assert tiles["Google clicks"].value == 70 and tiles["Google clicks"].change == 0 and tiles["Google clicks"].change_kind == "change"
    # No lead event picked: the file says Key events, as the screen does (SEO review 2026-11-17, W1).
    assert tiles["Key events"].change == 2 and tiles["Key events"].change_kind == "delta"
    assert fmt.change_words("en", tiles["Key events"].change, tiles["Key events"].change_kind) == "+2"  # it printed "+2%"
    assert not any("Visits and leads" in note for note in report.notes)  # one period for all three numbers: nothing to explain
    assert [t.title for t in report.tables if t.id == "going_up"] == ["Pages and searches going up"]


def test_overview_export_gives_click_rate_in_points_and_position_in_places(engine, end):
    site = _site(engine, end)
    with engine.begin() as conn:
        for n in range(56):
            day = end - timedelta(days=n)
            now = n < 28
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, 100, :p)"),
                         {"s": site, "d": day, "c": 3 if now else 5, "p": 6.3 if now else 5.0})
    report = registry.build(engine, "overview", {"site_id": str(site), "range": "28d", "compare": "prev"})
    tiles = {t.label: t for t in report.tiles}
    assert tiles["Click rate"].change == -2 and tiles["Click rate"].change_kind == "points"  # 5 % → 3 %: −2 points, not −40 %
    assert tiles["Average position"].change == 1.3 and tiles["Average position"].change_kind == "places"  # not +26 %
    assert fmt.change_words("en", -2, "points") == "−2 pts"
    assert fmt.change_words("en", 1.3, "places") == "1.3 places worse"
    assert fmt.change_words("fr", 1.3, "places") == "recul de 1,3 place"


def test_google_analytics_screens_count_the_same_days_as_search_console(engine, end):
    """Owner, 2026-11-24: "Last 28 days" was three different periods. GA4 here has 2 days more than Search Console's last
    final day; Channels asked through GA4's last day still counts the shared 28 days: 28 x 10 visits, never 29 or 30."""
    site = _site(engine, end)
    _days(engine, site, end, 70)
    _ga4(engine, site, end + timedelta(days=2), 30, 70, 70)
    asked_to = end + timedelta(days=2)
    scope = service.Scope(engine, str(site), (asked_to - timedelta(days=27)).isoformat(), asked_to.isoformat(), (asked_to - timedelta(days=55)).isoformat(), (asked_to - timedelta(days=28)).isoformat())
    scope.search_args = {"range": "28d", "compare": "prev"}
    period.one_period(scope)
    assert (scope.start, scope.end) == (end - timedelta(days=27), end)
    assert (scope.compare_start, scope.compare_end) == (end - timedelta(days=55), end - timedelta(days=28))
    answer = service.channels(scope)
    assert (answer["period"]["from"], answer["period"]["to"]) == ((end - timedelta(days=27)).isoformat(), end.isoformat())
    assert period.shared_ends(engine) == {"all": end.isoformat(), str(site): end.isoformat()}


def test_a_custom_period_and_a_site_without_search_console_keep_their_own_days(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 70)
    asked_to = end + timedelta(days=2)
    picked = service.Scope(engine, str(site), (asked_to - timedelta(days=9)).isoformat(), asked_to.isoformat())
    picked.search_args = {"range": "custom", "from": picked.start.isoformat(), "to": picked.end.isoformat()}
    assert period.one_period(picked).end == asked_to
    with engine.begin() as conn:
        bare = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('no-console.test', 'https://no-console.test/', 'own')")).lastrowid
    other = service.Scope(engine, str(bare), (asked_to - timedelta(days=27)).isoformat(), asked_to.isoformat())
    other.search_args = {"range": "28d", "compare": "prev"}
    assert period.one_period(other).end == asked_to
    assert str(bare) not in period.shared_ends(engine)


def test_today_counts_visits_on_the_days_of_google_clicks(engine, end):
    site = _site(engine, end)
    _days(engine, site, end, 70)
    _ga4(engine, site, end + timedelta(days=2), 30, 70, 70)
    row = today_view.today(engine, site, {"range": "28d", "compare": "prev"})["sites"][0]
    assert row["visits_through"] == end.isoformat() and row["visits"] == 280 and row["visits_was"] == 280
