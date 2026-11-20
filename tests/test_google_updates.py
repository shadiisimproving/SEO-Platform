"""Google updates: Google's list read and kept, and what each update did to a site's Search Console clicks."""
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, http
from seo.metrics import google_updates as gu
from seo.metrics import search
from seo.metrics.service import Scope
from seo.web import create_app

END = date(2026, 11, 7)  # the last final day
CORE = {
    "id": "core1", "begin": "2026-10-01T16:00:00+00:00", "end": "2026-10-10T08:00:00+00:00", "external_desc": "October 2026 core update",
    "service_name": "Ranking", "uri": "incidents/core1",
}
ROLLING = {"id": "core2", "begin": "2026-11-02T18:06:00+00:00", "external_desc": "November 2026 core update", "service_name": "Ranking", "uri": "incidents/core2"}
CRAWL = {"id": "crawl1", "begin": "2026-10-20T10:00:00+00:00", "external_desc": "Crawling issue", "service_name": "Crawling"}


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through) VALUES (:s, 'gsc', :d)"), {"s": site_id, "d": END})
    return site_id


@pytest.fixture
def feed(monkeypatch):
    state = {"items": [CORE, ROLLING, CRAWL], "status": 200, "calls": 0}

    def fake(request):
        state["calls"] += 1
        assert str(request.url) == gu.FEED
        return httpx.Response(state["status"], json=state["items"])

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    return state


def _days(engine, site, start, end, clicks, position):
    with engine.begin() as conn:
        day = start
        while day <= end:
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p)"), {"s": site, "d": day, "c": clicks, "i": clicks * 20, "p": position})
            day += timedelta(days=1)


def _rows(engine, site, table, name, start, end, clicks, position):
    key, column = ("page_hash", "page") if table == "gsc_page" else ("query_hash", "query")
    with engine.begin() as conn:
        day = start
        while day <= end:
            conn.execute(
                text(f"INSERT INTO {table} (site_id, day, {key}, {column}, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, :i, :p)"),
                {"s": site, "d": day, "h": common.digest(name), "n": name, "c": clicks, "i": clicks * 20 + 5, "p": position},
            )
            day += timedelta(days=1)


# ---- Google's list ----------------------------------------------------------------------------------

def test_only_ranking_updates_are_kept():
    found = gu.parse([CORE, ROLLING, CRAWL, {"service_name": "Ranking"}, "rubbish"])
    assert [u["id"] for u in found] == ["core1", "core2"]
    assert found[0]["began"] == date(2026, 10, 1) and found[0]["ended"] == date(2026, 10, 10) and found[0]["kind"] == "core"
    assert found[1]["ended"] is None and found[1]["url"] == "https://status.search.google.com/incidents/core2"
    assert gu.parse({"not": "a list"}) == []


@pytest.mark.parametrize("name,kind", [("March 2026 core update", "core"), ("August 2025 spam update", "spam"), ("November 2023 reviews update", "reviews"), ("Something else", "other")])
def test_kind_of(name, kind):
    assert gu.kind_of(name) == kind


def test_the_list_is_read_once_then_kept_and_a_failure_keeps_it(engine, feed):
    assert gu.refresh(engine) is True and feed["calls"] == 1
    assert gu.refresh(engine) is False and feed["calls"] == 1  # read less than 12 hours ago
    feed["status"] = 500
    assert gu.refresh(engine, force=True) is False
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM google_updates")).scalar() == 2
    feed["status"], feed["items"] = 200, [{**ROLLING, "end": "2026-11-16T10:00:00+00:00"}]
    gu.refresh(engine, force=True)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT ended FROM google_updates WHERE id = 'core2'")).scalar() == date(2026, 11, 16)


# ---- the days compared -----------------------------------------------------------------------------

def test_the_days_before_are_the_same_weekdays_just_before_it_began():
    span = gu.windows(date(2026, 10, 1), date(2026, 10, 10), END)
    assert span["after"] == (date(2026, 10, 11), date(2026, 10, 24)) and span["days"] == 14
    assert span["before"] == (date(2026, 9, 13), date(2026, 9, 26))  # 4 weeks back: ends before Oct 1, same weekdays
    assert span["before"][0].weekday() == span["after"][0].weekday()


def test_windows_while_rolling_out_and_too_early():
    span = gu.windows(date(2026, 11, 2), None, END)  # 5 days since the day after it began
    assert span["days"] == 5 and span["rolling"] and span["partial"] and span["after"] == (date(2026, 11, 3), date(2026, 11, 7))
    assert span["before"] == (date(2026, 10, 27), date(2026, 10, 31))
    assert gu.windows(date(2026, 11, 6), None, END) is None


@pytest.mark.parametrize("before,after,swing,last_year,want", [
    (100, 70, None, None, "lost"), (100, 130, None, None, "gained"), (100, 95, None, None, "normal"), (10, 5, None, None, "little"), (0, 40, None, None, "gained"),
    (100, 80, 12.0, None, "normal"),  # -20% on a site that usually swings ±12%: inside its 2 × 12 = 24%
    (100, 70, 12.0, None, "lost"),
    (100, 70, None, -20.0, "season"),  # last year fell 20% in the same weeks: more than half of this year's 30%
    (100, 70, None, -5.0, "lost"), (100, 70, None, 20.0, "lost"),
])
def test_verdict(before, after, swing, last_year, want):
    assert gu.verdict({"clicks": before}, {"clicks": after}, swing, last_year) == want


@pytest.mark.parametrize("row,want", [
    ({"position_before": 3.0, "position_after": 8.0}, "position_down"), ({"position_before": 8.0, "position_after": 3.0}, "position_up"),
    ({"position_before": 4.0, "position_after": 4.2, "impressions_before": 100, "impressions_after": 60}, "searched_less"),
    ({"position_before": 4.0, "position_after": 4.2, "impressions_before": 100, "impressions_after": 95}, "click_rate"),
])
def test_why_a_page_moved(row, want):
    assert gu.why(row) == want


def test_sections():
    pages = [{"name": "https://s.test/blog/a/", "clicks_before": 30, "clicks_after": 10}, {"name": "https://s.test/blog/b/", "clicks_before": 10, "clicks_after": 5},
             {"name": "https://s.test/visa/x/", "clicks_before": 5, "clicks_after": 15}, {"name": "https://s.test/about/", "clicks_before": 4, "clicks_after": 4}]
    found = gu.sections(pages)
    assert found["down"] == [{"name": "/blog/", "pages": 2, "clicks_before": 40, "clicks_after": 15, "change": -25}]
    assert found["up"][0]["name"] == "/visa/" and gu.section_of("https://s.test/about/") == "/"
    assert gu.sections(pages[:2]) == {"down": [], "up": []}  # one section is the whole site


# ---- on a site ---------------------------------------------------------------------------------------

def test_a_site_that_lost_clicks_after_an_update(engine, site, feed):
    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 8.0)
    _rows(engine, site, "gsc_page", "https://shop-one.test/visa/", date(2026, 9, 13), date(2026, 10, 24), 0, 4.0)  # clicks set by day below
    with engine.begin() as conn:
        conn.execute(text("UPDATE gsc_page SET clicks = IF(day < '2026-10-01', 6, 1), position = IF(day < '2026-10-01', 3.0, 9.0)"))
    _rows(engine, site, "gsc_query", "visa dubai", date(2026, 10, 11), date(2026, 10, 24), 2, 6.0)
    answer = gu.listing(engine, site)
    core = next(u for u in answer["updates"] if u["id"] == "core1")
    assert core["verdict"] == "lost" and core["clicks_pct"] == -40.0 and core["before"]["clicks"] == 280 and core["after"]["clicks"] == 168
    assert core["before"]["position"] == 5.0 and core["after"]["position"] == 8.0 and core["position_change"] == 3.0
    assert core["usual_swing"] is None and core["threshold"] == 10.0 and core["brand_out"] is False  # too little history for a usual swing
    rolling = next(u for u in answer["updates"] if u["id"] == "core2")
    assert rolling["verdict"] == "normal" and rolling["rolling"] and rolling["days"] == 5  # clicks were flat around it
    detail = gu.detail(engine, site, "core1")
    page = detail["pages"]["down"][0]
    assert page["name"] == "https://shop-one.test/visa/" and page["clicks_before"] == 84 and page["clicks_after"] == 14 and page["position_after"] == 9.0 and page["why"] == "position_down"
    assert detail["queries"]["up"][0]["name"] == "visa dubai" and detail["queries"]["up"][0]["clicks_after"] == 28 and detail["pages"]["up"] == []
    assert detail["edits"]["count"] is None and detail["rivals"] == {"checked": 0, "items": []}  # the site was never read, nor ranked


def test_a_site_that_always_swings_this_much_did_not_lose(engine, site, feed):
    """Clicks alternate 26 and 20 a day, a fortnight each, for months: a fall from 20 to 15 is inside its usual swing."""
    day, n = date(2026, 4, 5), 0
    while day <= date(2026, 9, 26):
        block = (date(2026, 9, 26) - day).days // 14
        _days(engine, site, day, day, 20 if block % 2 == 0 else 26, 5.0)
        day += timedelta(days=1)
    _days(engine, site, date(2026, 9, 27), END, 15, 5.0)
    core = gu.effect(Scope(engine, site, "2026-01-01", "2026-01-01"), gu.parse([CORE])[0])
    assert core["clicks_pct"] == -25.0 and core["usual_swing"] > 12 and core["verdict"] == "normal"


def test_brand_searches_are_left_out(engine, site, feed):
    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 14, 5.0)  # 6 fewer clicks a day...
    _rows(engine, site, "gsc_query", "shop one prices", date(2026, 9, 1), date(2026, 9, 30), 6, 1.0)  # ...all of them people typing the brand
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, 'brand', 'Shop One')"), {"s": site})
    core = gu.effect(Scope(engine, site, "2026-01-01", "2026-01-01"), gu.parse([CORE])[0])
    assert core["brand_out"] and core["before"]["clicks"] == 14 * 14 and core["after"]["clicks"] == 14 * 14 and core["verdict"] == "normal"
    assert core["all_clicks_pct"] == -30.0 and core["before"]["brand_clicks"] == 84


def test_the_same_dip_last_year_is_probably_the_season(engine, site, feed):
    _days(engine, site, date(2025, 8, 1), date(2025, 9, 30), 20, 5.0)
    _days(engine, site, date(2025, 10, 1), date(2025, 10, 31), 12, 5.0)
    _days(engine, site, date(2025, 11, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    core = gu.effect(Scope(engine, site, "2026-01-01", "2026-01-01"), gu.parse([CORE])[0])
    assert core["clicks_pct"] == -40.0 and core["last_year_pct"] == -40.0 and core["verdict"] == "season"


def test_a_loss_is_followed_up(engine, site, feed):
    _days(engine, site, date(2026, 6, 1), date(2026, 8, 19), 20, 5.0)
    _days(engine, site, date(2026, 8, 20), date(2026, 9, 15), 12, 5.0)
    _days(engine, site, date(2026, 9, 16), END, 20, 5.0)
    august = gu.parse([{**CORE, "id": "aug", "begin": "2026-08-20T10:00:00+00:00", "end": "2026-08-25T10:00:00+00:00"}])[0]
    found = gu.effect(Scope(engine, site, "2026-01-01", "2026-01-01"), august)
    assert found["verdict"] == "lost" and found["recovery"]["pct"] == 100
    assert "recovery" not in gu.effect(Scope(engine, site, "2026-01-01", "2026-01-01"), gu.parse([CORE])[0])  # not a loss, or too recent


def test_my_own_edits_in_those_weeks(engine, site, feed):
    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    with engine.begin() as conn:
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop-one.test')")).lastrowid
        page = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, first_seen_at) VALUES (:d, 'https://shop-one.test/visa/', 'h1', '2026-09-20')"), {"d": domain}).lastrowid
        for kind, at in (("title", "2026-10-02 10:00"), ("h1", "2026-10-03 10:00"), ("title", "2026-11-05 10:00")):  # the last one is after the days compared
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, detected_at) VALUES (:p, :d, :k, :a)"), {"p": page, "d": domain, "k": kind, "a": at})
    edits = gu.detail(engine, site, "core1" if gu.refresh(engine) else "core1")["edits"]
    assert edits["count"] == 1 and edits["items"][0]["kinds"] == ["h1", "title"] and edits["partial"] and edits["reading_since"] == "2026-09-20"


def _check(engine, target, day, results):
    with engine.begin() as conn:
        check = conn.execute(text("INSERT INTO serp_checks (target_id, tool, depth, checked_at) VALUES (:t, 'SerpApi', 20, :d)"), {"t": target, "d": f"{day} 09:00"}).lastrowid
        for position, host in enumerate(results, 1):
            conn.execute(text("INSERT INTO serp_results (check_id, position, url, host, domain) VALUES (:c, :p, :u, :h, :h)"), {"c": check, "p": position, "u": f"https://{host}/x", "h": host})


def test_who_rose_where_i_fell(engine, site, feed):
    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    targets = []
    with engine.begin() as conn:
        for word in ("visa dubai", "company setup", "steady one"):
            keyword = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash) VALUES (:k, :h)"), {"k": word, "h": common.digest(word)}).lastrowid
            conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": keyword})
            targets.append(conn.execute(text("INSERT INTO serp_targets (keyword_id, engine) VALUES (:k, 'google')"), {"k": keyword}).lastrowid)
    _check(engine, targets[0], "2026-09-20", ["shop-one.test", "a.test", "rival.test"])
    _check(engine, targets[0], "2026-10-15", ["rival.test", "a.test", "shop-one.test"])
    _check(engine, targets[1], "2026-09-25", ["b.test", "shop-one.test", "c.test", "d.test"])
    _check(engine, targets[1], "2026-10-12", ["b.test", "rival.test", "c.test", "d.test"])  # rival new on the page, I dropped out
    _check(engine, targets[2], "2026-09-25", ["shop-one.test", "e.test"])
    _check(engine, targets[2], "2026-10-12", ["shop-one.test", "e.test"])  # unchanged: says nothing
    rivals = gu.detail(engine, site, "core1" if gu.refresh(engine) else "core1")["rivals"]
    assert rivals["checked"] == 3 and rivals["items"][0] == {"domain": "rival.test", "keywords": ["visa dubai", "company setup"], "best": 1, "count": 2}
    assert [x["domain"] for x in rivals["items"]] == ["rival.test"]  # a.test stayed 2nd: it didn't rise


def test_the_bell_once_per_update_and_state(engine, site, feed):
    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    gu.refresh(engine)
    assert gu.announce(engine, today=date(2026, 11, 8)) == 2  # the rolling one started, the October one ended with a loss
    assert gu.announce(engine, today=date(2026, 11, 9)) == 0
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT title, detail FROM notifications WHERE kind = 'google_update' ORDER BY id")).mappings().all()
    assert sorted(r["title"] for r in rows) == ["Google started the November 2026 core update", "October 2026 core update: lost"]
    client = create_app(engine=engine, auth=False).test_client()
    shown = client.get(f"/api/notifications?site_id={site}").get_json()
    assert {i["kind"] for i in shown["items"]} == {"google_update"} and shown["unread"] == 2


def test_today_lists_a_loss(engine, site, feed, monkeypatch):
    from seo.metrics import today

    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    gu.refresh(engine)
    monkeypatch.setattr(gu, "TODAY_DAYS", 10_000)  # the test's October is behind the real clock
    rows = today._google_update_rows(engine, None)
    assert len(rows) == 1 and rows[0]["title"] == "October 2026 core update: you lost 40% of clicks" and rows[0]["link"] == "#overview?site=shop-one.test&update=core1"
    assert rows[0]["kind"] == "google_update" and rows[0]["rank"] == today.LOSING_RESULTS


def test_the_overview_export_has_the_updates(engine, site, feed):
    from seo.exports import csv_out, pdf_out, registry, xlsx_out

    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    gu.refresh(engine)
    report = registry.build(engine, "overview", {"site_id": str(site), "range": "28d"})
    table = next(t for t in report.tables if t.id == "google_updates")
    assert [r["name"] for r in table.rows] == ["November 2026 core update", "October 2026 core update"] and table.rows[1]["verdict"] == "Lost clicks"
    assert csv_out.write(report, "google_updates")[2] == "csv" and xlsx_out.write(report) and pdf_out.write(report)
    french = registry.build(engine, "overview", {"site_id": str(site), "range": "28d"}, lang="fr")
    assert b"Clics perdus" in csv_out.write(french, "google_updates")[0]


def test_no_data_from_before_the_update(engine, site, feed):
    _days(engine, site, date(2026, 10, 5), END, 20, 5.0)
    core = next(u for u in gu.listing(engine, site)["updates"] if u["id"] == "core1")
    assert core["verdict"] == "no_data"


def test_updates_long_before_the_data_are_left_out(engine, site, feed):
    feed["items"] = [CORE, {**CORE, "id": "old", "begin": "2025-01-10T00:00:00+00:00", "end": "2025-01-20T00:00:00+00:00", "external_desc": "January 2025 core update"}]
    _days(engine, site, date(2026, 9, 1), END, 20, 5.0)
    assert [u["id"] for u in gu.listing(engine, site)["updates"]] == ["core1"]


def test_all_my_sites_gives_one_verdict_per_site(engine, site, feed):
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-two.test', 'https://shop-two.test/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through) VALUES (:s, 'gsc', :d)"), {"s": other, "d": END})
    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    _days(engine, other, date(2026, 9, 1), END, 20, 5.0)
    answer = gu.listing(engine, "all")
    core = next(u for u in answer["updates"] if u["id"] == "core1")
    assert answer["many"] and core["verdict"] == "sites" and {(x["host"], x["verdict"]) for x in core["sites"]} == {("shop-one.test", "lost"), ("shop-two.test", "normal")}


def test_the_chart_gets_each_update_as_a_band(engine, site, feed):
    gu.refresh(engine)
    scope = Scope(engine, site, "2026-10-05", "2026-11-07")
    bands = [m for m in search.markers(scope) if m["kind"] == "google"]
    assert [(m["id"], m["day"], m["end"]) for m in bands] == [("core1", "2026-10-01", "2026-10-10"), ("core2", "2026-11-02", None)]
    assert not [m for m in search.markers(Scope(engine, site, "2026-08-01", "2026-08-31")) if m["kind"] == "google"]


def test_the_routes(engine, site, feed):
    _days(engine, site, date(2026, 9, 1), END, 20, 5.0)
    client = create_app(engine=engine, auth=False).test_client()
    listed = client.get(f"/api/search/google-updates?site_id={site}")
    assert listed.status_code == 200 and {u["id"] for u in listed.get_json()["updates"]} == {"core1", "core2"}
    one = client.get(f"/api/search/google-update?id=core1&site_id={site}")
    body = one.get_json()
    assert one.status_code == 200 and body["verdict"] == "normal" and {"pages", "sections", "devices", "countries", "edits", "rivals"} <= set(body)
    assert client.get(f"/api/search/google-update?id=nope&site_id={site}").status_code == 404


def test_edits_are_unknown_when_reading_began_after_those_weeks(engine, site, feed):
    _days(engine, site, date(2026, 9, 1), date(2026, 9, 30), 20, 5.0)
    _days(engine, site, date(2026, 10, 1), END, 12, 5.0)
    with engine.begin() as conn:
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop-one.test')")).lastrowid
        conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, first_seen_at) VALUES (:d, 'https://shop-one.test/', 'h2', '2026-11-01')"), {"d": domain})
    gu.refresh(engine)
    edits = gu.detail(engine, site, "core1")["edits"]
    assert edits["count"] is None and edits["reading_since"] == "2026-11-01"


def test_a_site_without_search_console_gets_no_bell(engine, site, feed):
    gu.refresh(engine)  # the site has no Search Console day at all
    assert gu.announce(engine, today=date(2026, 11, 8)) == 0
