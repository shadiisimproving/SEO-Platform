"""Search Console screen numbers, second round (expert review 2026-11-17, accuracy/search-console.md 3.3, 3.5, 3.6, 3.8,
3.9, 4b, and competitors-exports.md W12, W13, W15).

Golden numbers, worked out by hand. The page /a/ has 10 clicks, 100 impressions at position 5 every day: 28 days hold
280 clicks, 2,800 impressions, a 10% click rate and position 5.0. Its jump link /a/#part has 0 clicks and 100 impressions
at position 9 every day: 2,800 more impressions that must never pull /a/'s click rate to 5% or its position to 7.0.
"""
import io
import json
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook
from sqlalchemy import text

from seo.collectors import common, gsc
from seo.exports import fmt, registry, xlsx_out
from seo.insights import data as insights_data, engine as insights_engine, movement
from seo.metrics import period, search, service, today as today_view
from seo.pages import service as pages

HOST = "shop-one.test"
PAGE, JUMP, OTHER = f"https://{HOST}/a/", f"https://{HOST}/a/#part", f"https://{HOST}/b/"


@pytest.fixture
def end(engine):
    return common.google_today(engine) - timedelta(days=3)


def _site(engine, end):
    with engine.begin() as conn:
        site = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'own')"), {"h": HOST, "u": f"https://{HOST}/"}).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from, fresh_through) VALUES (:s, 'gsc', :d, :f, :t)"),
                     {"s": site, "d": end, "f": end + timedelta(days=1), "t": end + timedelta(days=2)})
    return site


def _page_day(conn, site, day, page, clicks, impressions, position):
    conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, :i, :pos)"),
                 {"s": site, "d": day, "h": common.digest(page), "p": page, "c": clicks, "i": impressions, "pos": position})


def _pair(conn, site, day, query, page, clicks, impressions, position):
    conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :p, :c, :i, :pos)"),
                 {"s": site, "d": day, "h": common.digest(f"{query}\n{page}"), "q": query, "p": page, "c": clicks, "i": impressions, "pos": position})


def _jump_site(engine, end, days=56):
    """/a/ and its jump link, every day for `days` days ending on end, plus 2 fresh days."""
    site = _site(engine, end)
    with engine.begin() as conn:
        for n in range(-2, days):
            day = end - timedelta(days=n)
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, 10, 200, 7)"), {"s": site, "d": day})
            _page_day(conn, site, day, PAGE, 10, 100, 5)
            _page_day(conn, site, day, JUMP, 0, 100, 9)
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'shoes', 10, 200, 7)"),
                         {"s": site, "d": day, "h": common.digest("shoes")})
            _pair(conn, site, day, "shoes", PAGE, 10, 100, 5)
            _pair(conn, site, day, "shoes", JUMP, 0, 100, 9)
    return site


def _browser_scope(engine, site, end):
    to = end + timedelta(days=2)  # what Pages and Content send: the browser's 28 days ending yesterday
    scope = service.Scope(engine, site, (to - timedelta(days=27)).isoformat(), to.isoformat(), (to - timedelta(days=55)).isoformat(), (to - timedelta(days=28)).isoformat())
    scope.search_args = service.search_args({"range": "28d", "compare": "prev"})
    return scope


# ---- 3.3 #section jump links -----------------------------------------------------------------------------------------


def test_content_and_pages_count_a_page_from_its_own_address_and_jump_links_apart(engine, end):
    site = _jump_site(engine, end)
    row = next(r for r in service.content(_browser_scope(engine, site, end))["pages"] if r["key"] == "/a/")
    # It used to say 5,600 impressions and position 7.0 (so a 5% click rate) for a page Google shows at 10% and 5.0.
    assert (row["clicks"], row["impressions"], row["position"], row["jump_impressions"]) == (280, 2800, 5.0, 2800)
    listed = next(r for r in pages.listing(_browser_scope(engine, site, end))["pages"] if r["path"] == "/a/")
    assert (listed["clicks"], listed["impressions"], listed["position"], listed["jump_impressions"]) == (280, 2800, 5.0, 2800)
    assert (listed["clicks_before"], listed["change"]) == (280, 0)


def test_page_profile_and_panel_count_the_page_from_its_own_address(engine, end):
    site = _jump_site(engine, end)
    google = pages.profile(engine, site, PAGE)["google_28d"]
    assert (google["clicks"], google["impressions"], google["position"], google["jump_impressions"]) == (280, 2800, 5.0, 2800)
    panel = service.page_detail(_browser_scope(engine, site, end), "/a/", HOST)
    t = panel["totals"]
    assert (t["clicks"], t["impressions"], t["click_rate"], t["position"]) == (280, 2800, 0.1, 5.0)  # it said 0.05 and 7.0
    assert panel["jump"] == {"impressions": 2800, "clicks": 0}
    assert {d["impressions"] for d in panel["days"]} == {100}
    shoes = next(q for q in panel["queries"] if q["query"] == "shoes")
    assert (shoes["clicks"], shoes["impressions"], shoes["position"]) == (280, 2800, 5.0)


def test_two_pages_compete_never_pits_a_page_against_its_own_jump_links(engine, end):
    site = _jump_site(engine, end, days=28)
    scope, _window = period.scope_for(engine, {"site_id": str(site), "range": "28d", "compare": "none"})
    assert search.opportunities(scope, "compete")["rows"] == []  # /a/ 50% against /a/#part 50% used to be a row
    with engine.begin() as conn:  # a real second page: 60 impressions a day against /a/'s own 100
        for n in range(28):
            _pair(conn, site, end - timedelta(days=n), "shoes", OTHER, 1, 60, 6)
    rows = search.opportunities(scope, "compete")["rows"]
    assert [[(p["page"], p["share"]) for p in r["pages"]] for r in rows] == [[(PAGE, 62), (OTHER, 38)]]  # 2,800 : 1,680 of 4,480 (62.5 rounds to even)


# ---- 3.5 Today's big-drop alert -------------------------------------------------------------------------------------------


def test_a_raised_alert_takes_the_findings_new_numbers_and_today_ranks_on_them(engine, end):
    site = _site(engine, end)
    evidence = {"path": "/a/", "percent": -57, "clicks": 43, "clicks_before": 101}
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO search_findings (site_id, kind, grp, finding_key, page, severity, at_stake, evidence, status, first_seen) "
                          "VALUES (:s, 'page_down', 'decline', 'k1', :p, 'big', 62.1, :e, 'open', UTC_TIMESTAMP(3) - INTERVAL 9 DAY)"),
                     {"s": site, "p": PAGE, "e": json.dumps(evidence)})
        conn.execute(text("INSERT INTO alerts (site_id, kind, severity, title, detail) VALUES (:s, 'search_drop', 'crit', '/a/: −60% Google clicks', :d)"),
                     {"s": site, "d": json.dumps({"finding_key": "k1", "finding": "page_down", "detail": "~80 clicks/month at stake"})})
    insights_engine._alerts(engine, SimpleNamespace(site_id=site))
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT title, detail FROM alerts WHERE site_id = :s"), {"s": site}).mappings().all()
    assert len(rows) == 1 and rows[0]["title"] == "/a/: −57% Google clicks"
    assert json.loads(rows[0]["detail"])["detail"] == "~62 clicks/month at stake"
    item = next(i for i in today_view._attention(engine, site) if i["kind"] == "search_drop")
    assert item["stake"] == 62 and item["words"]["title"][1]["percent"] == 57  # it ranked on 80 and said 60%


# ---- 3.6 Insights "Why": hidden searches carrying most of the change ------------------------------------------------------


def test_when_hidden_searches_are_most_of_the_change_no_main_cause_is_named(engine, end):
    site = _site(engine, end)
    with engine.begin() as conn:
        for n in range(56):
            day, now = end - timedelta(days=n), n < 28
            # The site: 10 clicks a day before, 5 now (−140). The one listed search: 2 a day before, 1 now (−28, its click rate).
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, 1000, 5)"), {"s": site, "d": day, "c": 5 if now else 10})
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'shoes', :c, 100, 5)"),
                         {"s": site, "d": day, "h": common.digest("shoes"), "c": 1 if now else 2})
            _page_day(conn, site, day, PAGE, 5 if now else 10, 1000, 5)
    e = movement.breakdown(insights_data.load(engine, site)).findings[0].evidence
    assert e["change"] == -140 and e["parts"]["appeal"] == -28 and e["parts"]["hidden"] == -112
    assert e["main"] is None  # it named "lower click rate (−28)" for a fall that is 80% hidden searches


# ---- W13 / 3.8 Pages and Content exports: Google's own days, and the Change column -----------------------------------------


def _export_args(site, end):
    to = end + timedelta(days=2)
    return {"site_id": str(site), "from": (to - timedelta(days=27)).isoformat(), "to": to.isoformat(),
            "compare_from": (to - timedelta(days=55)).isoformat(), "compare_to": (to - timedelta(days=28)).isoformat(), "range": "28d", "compare": "prev"}


@pytest.mark.parametrize("view", ["pages", "content"])
def test_pages_and_content_exports_say_googles_own_days(engine, end, view):
    site = _jump_site(engine, end)
    report = registry.build(engine, view, _export_args(site, end))
    google = dict(report.filters).get("Google numbers")
    assert google == (end - timedelta(days=27), end)  # the header said only the browser's days, two later
    assert fmt.filter_value("en", google) == fmt.period("en", end - timedelta(days=27), end)
    columns = [c.label for c in report.tables[0].columns]
    assert "Jump-link impressions" in columns
    if view == "pages":
        assert "Clicks before" in columns and "Change" in columns
        row = next(r for r in report.tables[0].rows if r["url"].endswith("/a/"))
        assert (row["clicks"], row["clicks_before"], row["change"]) == (280, 280, 0)


# ---- W12 / W15 the Overview export --------------------------------------------------------------------------------------


def test_overview_export_charts_only_the_counted_days_and_writes_places_better_or_worse(engine, end):
    site = _site(engine, end)
    with engine.begin() as conn:
        for n in range(-2, 56):
            day, now = end - timedelta(days=n), n < 28
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, 100, :p)"),
                         {"s": site, "d": day, "c": 3 if n >= 0 else 1, "p": (6.3 if now else 5.0) if n >= 0 else 9})
    report = registry.build(engine, "overview", {"site_id": str(site), "range": "28d", "compare": "prev"})
    chart = report.charts[0]
    assert len(chart.labels) == 28 and sum(chart.series[0].values) == 84  # it drew 30 days (86 clicks) under a 28-day header
    assert any("aren't final yet" in note for note in report.notes)
    report.lang = "en"
    body = xlsx_out.write(report)
    sheet = load_workbook(io.BytesIO(body)).worksheets[0]
    cell = next(row[2] for row in sheet.iter_rows() if row[0].value == "Average position")
    # Keywords' rule: + is better. 5.0 → 6.3 is 1.3 places worse, so −1.3 "places worse" (it wrote +1.3 "places").
    assert cell.value == pytest.approx(-1.3) and cell.number_format == '+0.0" places better";-0.0" places worse";"same place"'
    report.lang = "fr"
    sheet = load_workbook(io.BytesIO(xlsx_out.write(report))).worksheets[0]
    cell = next(row[2] for row in sheet.iter_rows() if row[0].value == "Position moyenne")
    assert cell.number_format == '+0.0" places gagnées";-0.0" places perdues";"même place"'


# ---- 3.9 Last 24 hours without the live connection ----------------------------------------------------------------------------


def test_24_hours_without_google_says_it_shows_the_last_saved_days(engine, end, monkeypatch):
    site = _site(engine, end)
    with engine.begin() as conn:
        for n in range(-2, 10):
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, 3, 100, 5)"), {"s": site, "d": end - timedelta(days=n)})

    def offline(*_a, **_k):
        raise ConnectionError("Google can't be reached")

    monkeypatch.setattr(search, "_live_series", offline)
    scope, window = period.scope_for(engine, {"site_id": str(site), "range": "24h", "compare": "prev"})
    data = search.overview(scope, window)
    assert data["hourly"] is False and data["saved_days"] == {"from": (end + timedelta(days=1)).isoformat(), "to": (end + timedelta(days=2)).isoformat(), "days": 2}
    assert data["totals"]["clicks"] == 6


# ---- 4b 16 months of Google data are kept whole ------------------------------------------------------------------------------


def test_the_collector_keeps_16_full_months_and_the_days_google_still_has():
    # Google's 16 months ending on the last final day (15 Nov) start on 16 Jul; its own export made on 15 Nov started on 14 Jul.
    assert date(2026, 11, 17) - timedelta(days=gsc.HISTORY_DAYS) <= period.months_back(date(2026, 11, 15), 16) == date(2025, 7, 16)
    assert date(2026, 11, 15) - timedelta(days=gsc.HISTORY_DAYS) <= date(2025, 7, 14)  # it kept from 17 Jul: 3 days short
