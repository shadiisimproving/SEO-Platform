"""The wrong numbers the review of 10 November reproduced (code-review.md, stage 3), each on made-up rows: they must stay fixed.

F7 clicks at stake counted several times, F8 comparisons past the stored days, F9 / F112 sentences and percentages from days
that aren't final or have no data yet, F12 a day read while fresh that became final, F13 "24 hours" as 24 rows, F109 a drop
that comes back after a done task, F110 "lost places" from 2 impressions, and Today and Overview giving two numbers for one range.
"""
import json
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, gsc, http
from seo.collectors.common import digest
from seo.insights import engine as insights, movement, service
from seo.metrics import search, today
from seo.metrics.service import Scope, channels
from seo.sources import credentials

END = date(2026, 11, 7)  # newest day Google has; END-1 and END aren't final
FINAL = END - timedelta(days=2)


@pytest.fixture
def site(engine):
    search._live_cache.clear()
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('site-one.example', 'https://site-one.example/', 'own')")).lastrowid
        conn.execute(
            text("INSERT INTO site_sources (site_id, source, data_through, fresh_from, fresh_through) VALUES (:s, 'gsc', :d, :f, :t)"),
            {"s": site_id, "d": FINAL, "f": END - timedelta(days=1), "t": END},
        )
    return site_id


def _flat(engine, site, days, clicks=100, shown=1000, position=5.0, last=END, fresh=None):
    """`days` days of Search Console totals ending on `last`; fresh = {day: clicks} for the days that aren't final."""
    with engine.begin() as conn:
        for n in range(days):
            day = last - timedelta(days=n)
            c = (fresh or {}).get(day, clicks)
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p)"), {"s": site, "d": day, "c": c, "i": shown, "p": position})


def _scope(engine, site, range_key="28d", compare="prev", **extra):
    return search.scope_for(engine, {"site_id": str(site), "range": range_key, "compare": compare, **extra})


# ---- F8: no comparison where the earlier period isn't stored ---------------------------------------


def test_f8_twelve_months_on_a_flat_site_has_no_made_up_rise(engine, site):
    _flat(engine, site, 486)
    for range_key, compare in (("12m", "prev"), ("16m", "prev"), ("6m", "yoy"), ("12m", "yoy")):
        scope, window = _scope(engine, site, range_key, compare)
        found = search.overview(scope, window)
        # "google": further back than the 16 months Google keeps; "history": not stored that far back (yet)
        assert window["compare_from"] is None and window["compare_unavailable"] in ("history", "google"), (range_key, compare)
        assert found["before"] is None and found["answer"]["kind"] == "summary", (range_key, compare)
    scope, window = _scope(engine, site, "28d", "prev")
    assert window["compare_from"] and search.overview(scope, window)["answer"]["kind"] == "steady"


# ---- F9: the sentence and the totals count final days only ------------------------------------------


def test_f9_seven_days_on_a_flat_site_is_steady_and_the_fresh_days_are_drawn_after(engine, site):
    _flat(engine, site, 60, fresh={END: 30, END - timedelta(days=1): 90})
    scope, window = _scope(engine, site, "7d", "prev")
    found = search.overview(scope, window)
    assert window["to"] == FINAL.isoformat() and window["final_through"] == FINAL.isoformat() and window["fresh_to"] == END.isoformat()
    assert found["totals"]["clicks"] == 700 and found["before"]["clicks"] == 700
    assert found["answer"]["kind"] == "steady"
    tail = [(p["day"], p["fresh"]) for p in found["series"][-3:]]
    assert tail == [(FINAL.isoformat(), False), ((END - timedelta(days=1)).isoformat(), True), (END.isoformat(), True)]
    assert len(found["compare_series"]) == 7  # the period before lines up with the 7 counted days


def test_f9_a_custom_range_into_the_fresh_days_is_cut_back_to_the_last_final_day(engine, site):
    _flat(engine, site, 60, fresh={END: 30})
    scope, window = _scope(engine, site, "custom", "prev", **{"from": (END - timedelta(days=9)).isoformat(), "to": END.isoformat()})
    assert window["to"] == FINAL.isoformat() and window["from"] == (END - timedelta(days=9)).isoformat()


# ---- One number for one range on Today and Overview ----------------------------------------------------


def test_today_and_overview_give_the_same_clicks_for_the_last_28_days(engine, site):
    _flat(engine, site, 70, clicks=113, fresh={END: 8, END - timedelta(days=1): 40})
    overview = search.overview(*_scope(engine, site, "28d", "prev"))
    board = today.today(engine, site)["results"]["clicks"]
    assert board["value"] == overview["totals"]["clicks"] == 28 * 113
    assert board["change"] == 0
    seven = today.today(engine, site, {"range": "7d", "compare": "prev"})
    assert seven["results"]["clicks"]["value"] == search.overview(*_scope(engine, site, "7d", "prev"))["totals"]["clicks"] == 7 * 113
    assert seven["results"]["days"] == 7 and seven["results"]["window"]["to"] == FINAL.isoformat()


# ---- F13: 24 hours are 24 hours ------------------------------------------------------------------------


@pytest.fixture
def google(engine, site, monkeypatch):
    answers = {}

    def fake(request):
        body = json.loads(request.content)
        handler = answers.get(tuple(body["dimensions"]))
        return handler(body) if handler else httpx.Response(200, json={"rows": []})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    monkeypatch.setattr(credentials, "token_override", lambda connection_id: "fake-token")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO google_connections (id, label, kind, secret, last4) VALUES (1, 'T', 'robot', 'x', 'y')"))
        conn.execute(text("UPDATE site_sources SET connection_id = 1, property = 'sc-domain:site-one.example' WHERE site_id = :s"), {"s": site})
    return answers


def test_f13_a_small_site_with_impressions_in_14_hours_a_day_gets_24_hours_not_24_rows(engine, site, google):
    def hours(body):
        rows = [{"keys": [f"2026-11-0{day}T{hour:02d}:00:00-08:00"], "clicks": 1, "impressions": 10, "position": 5.0} for day in (6, 7, 8) for hour in range(5, 19)]
        return httpx.Response(200, json={"rows": rows})
    google[("hour",)] = hours
    found = search.overview(*_scope(engine, site, "24h", "prev"))
    assert found["granularity"] == "hour"
    assert found["totals"]["clicks"] == 14 and found["before"]["clicks"] == 14  # 8 Nov 05:00–18:00 against 7 Nov 05:00–18:00
    assert all(p["day"].startswith("2026-11-08") for p in found["series"])


# ---- F112: a traffic period that runs past GA4's last day ---------------------------------------------


def test_f112_last_7_days_ending_today_compares_6_days_with_6(engine):
    with engine.begin() as conn:
        site = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('site-one.example', 'https://site-one.example/', 'own')")).lastrowid
        last = date(2026, 11, 9)
        conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, 'ga4', NULL, NULL, :d)"), {"s": site, "d": last})
        for n in range(40):
            conn.execute(
                text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, 'h', 'Organic Search', 'google', 'organic', 100, 90, 1)"),
                {"s": site, "d": last - timedelta(days=n)},
            )
    today_ = last + timedelta(days=1)  # the screen's "Last 7 days" ends today, which GA4 has no rows for yet
    scope = Scope(engine, site, (today_ - timedelta(days=6)).isoformat(), today_.isoformat(), (today_ - timedelta(days=13)).isoformat(), (today_ - timedelta(days=7)).isoformat())
    found = channels(scope)
    assert found["total"]["sessions"] == 600 and found["before"]["sessions"] == 600
    assert found["period"] == {"from": "2026-11-04", "to": "2026-11-09", "compare_from": "2026-10-28", "compare_to": "2026-11-02", "trimmed": True}


# ---- F12: a day read while fresh is read again once it's final ---------------------------------------


def test_f12_a_day_read_while_fresh_is_read_again_once_google_calls_it_final(engine, monkeypatch, tmp_path):
    from seo.core import crypto
    from seo.sources import service as sources

    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)
    lag = {"days": 2}
    asked = []

    def fake(request):
        body = json.loads(request.content)
        end = date.fromisoformat(body["endDate"])
        if body["dimensions"] == ["date"]:
            rows = [{"keys": [(end - timedelta(days=n)).isoformat()], "clicks": 10, "impressions": 100, "position": 7.0} for n in range(4)]
            return httpx.Response(200, json={"rows": rows, "metadata": {"firstIncompleteDate": (end - timedelta(days=lag["days"] - 1)).isoformat()}})
        asked.append((tuple(body["dimensions"]), body["startDate"]))
        return httpx.Response(200, json={"rows": []})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    monkeypatch.setattr(credentials, "token_override", lambda connection_id: "fake-token")
    with engine.begin() as conn:
        site = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('site-one.example', 'https://site-one.example/', 'own')")).lastrowid
    connection = sources.add_google(engine, "Team", "robot", {"client_email": "robot@x.iam.gserviceaccount.com", "private_key": "k", "private_key_id": "abcd1234"})
    sources.save_site_source(engine, site, "gsc", {"connection_id": connection["id"], "property": "sc-domain:site-one.example"})
    assert gsc.collect(engine, site) is True
    day = common.google_today(engine) - timedelta(days=1)  # not final at the first read
    with engine.begin() as conn:
        conn.execute(text("UPDATE coverage SET saved_at = UTC_TIMESTAMP(3) - INTERVAL 40 MINUTE WHERE site_id = :s"), {"s": site})
    asked.clear()
    lag["days"] = 1  # Google now calls that day final
    assert gsc.collect(engine, site) is True
    assert (("page",), day.isoformat()) in asked
    with engine.connect() as conn:
        assert conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": site}).scalar() == day
    asked.clear()
    assert gsc.collect(engine, site) is True
    assert (("page",), day.isoformat()) not in asked  # once is enough


# ---- F7, F109, F110: insights ---------------------------------------------------------------------------


IN_END = date(2026, 11, 1)


@pytest.fixture
def insight_site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('site-one.example', 'https://site-one.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from) VALUES (:s, 'gsc', :d, :f)"), {"s": site_id, "d": IN_END, "f": IN_END + timedelta(days=1)})
    return site_id


def _write(engine, site, rows):
    """rows: (day, query, page, clicks, impressions, position). Daily totals are the queries' sums."""
    daily: dict = {}
    with engine.begin() as conn:
        for day, query, page, clicks, shown, position in rows:
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, :i, :p)"), {"s": site, "d": day, "h": digest(query), "n": query, "c": clicks, "i": shown, "p": position})
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, :i, :p)"), {"s": site, "d": day, "h": digest(page), "n": page, "c": clicks, "i": shown, "p": position})
            conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :pg, :c, :i, :p)"), {"s": site, "d": day, "h": digest(query, page), "q": query, "pg": page, "c": clicks, "i": shown, "p": position})
            slot = daily.setdefault(day, [0, 0, 0.0])
            slot[0] += clicks
            slot[1] += shown
            slot[2] += position * shown
        for day, (c, i, w) in daily.items():
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p)"), {"s": site, "d": day, "c": c, "i": i, "p": w / i})


def _one_page_drop(engine, site):
    """One page and query: 10 clicks a day at position 3 before, 4 a day at position 8 for the last 28 days."""
    rows = []
    for n in range(56):
        day = IN_END - timedelta(days=n)
        rows.append((day, "boots for walking", "https://site-one.example/boots", 4 if n < 28 else 10, 300, 8.0 if n < 28 else 3.0))
    _write(engine, site, rows)


def test_f7_one_lost_page_is_counted_once_in_the_clicks_at_stake(engine, insight_site):
    _one_page_drop(engine, insight_site)
    insights.run(engine, insight_site)
    with engine.connect() as conn:
        open_ = conn.execute(text("SELECT kind, at_stake FROM search_findings WHERE site_id = :s AND status = 'open' AND kind <> 'change' AND severity <> 'info'"), {"s": insight_site}).all()
    stakes = {kind: stake for kind, stake in open_}
    assert len(stakes) >= 2 and "page_down" in stakes  # several findings say it, each true by its own rule
    headline = service.summary(engine, [insight_site])["at_stake"]
    assert headline == round(max(stakes.values()))  # the biggest estimate for that page counts, once
    assert service.counts(engine, [insight_site])["changed"]["at_stake"] <= headline


def test_f110_lost_places_needs_real_impressions_on_both_sides(engine, insight_site):
    rows = []
    for n in range(56):
        day = IN_END - timedelta(days=n)
        if n < 28:
            rows.append((day, "sofa repair", "https://site-one.example/sofa", 1, 11, 12.0))  # about 300 now, at 12
        elif n == 40:
            rows.append((day, "sofa repair", "https://site-one.example/sofa", 1, 2, 3.0))  # 2 before, at 3
        rows.append((day, "steady one", "https://site-one.example/", 5, 100, 4.0))
    _write(engine, insight_site, rows)
    from seo.insights import data
    found = movement.queries_down(data.load(engine, insight_site))
    assert "query_down" in found.ran and not [f for f in found.findings if f.query == "sofa repair"]


def test_f109_a_drop_that_comes_back_after_a_done_task_is_open_again(engine, insight_site):
    _one_page_drop(engine, insight_site)
    insights.run(engine, insight_site)
    with engine.begin() as conn:
        row = conn.execute(text("SELECT id, finding_key FROM search_findings WHERE site_id = :s AND kind = 'page_down'"), {"s": insight_site}).one()
        conn.execute(text("UPDATE search_findings SET first_seen = UTC_TIMESTAMP(3) - INTERVAL 5 DAY WHERE site_id = :s"), {"s": insight_site})  # seen 5 days ago, the task done since
        conn.execute(
            text("INSERT INTO tasks (title, status, site_id, source, updated_at) VALUES ('Fix boots', 'done', :s, :src, UTC_TIMESTAMP(3) - INTERVAL 2 DAY)"),
            {"s": insight_site, "src": json.dumps({"type": "search", "key": row.finding_key})},
        )
    insights.run(engine, insight_site)
    with engine.begin() as conn:
        assert conn.execute(text("SELECT status FROM search_findings WHERE id = :i"), {"i": row.id}).scalar() == "done"
        # It went away (the fix worked for a while), and its alert was seen…
        conn.execute(text("UPDATE search_findings SET status = 'gone', gone_at = UTC_TIMESTAMP(3) - INTERVAL 1 DAY WHERE id = :i"), {"i": row.id})
        conn.execute(text("UPDATE alerts SET acknowledged_at = UTC_TIMESTAMP(3) - INTERVAL 1 DAY, created_at = UTC_TIMESTAMP(3) - INTERVAL 3 DAY WHERE site_id = :s"), {"s": insight_site})
    insights.run(engine, insight_site)  # …and now it's back
    with engine.connect() as conn:
        assert conn.execute(text("SELECT status FROM search_findings WHERE id = :i"), {"i": row.id}).scalar() == "open"
        assert conn.execute(text("SELECT COUNT(*) FROM alerts WHERE site_id = :s AND kind = 'search_drop' AND acknowledged_at IS NULL"), {"s": insight_site}).scalar() == 1
    assert any(f["kind"] == "page_down" for f in service.today_rows(engine, insight_site)) or service.listing(engine, insight_site)["rows"]


def test_one_exact_search_first_seen_on_days_not_final_can_be_shown_with_them(engine, site):
    """The bell announces a search on its first, not-final day: opened in Overview, that one row counts those days and says
    so. Every other table and total stays final days only."""
    from seo.web import create_app

    _flat(engine, site, 60)
    with engine.begin() as conn:
        for day, clicks in ((END - timedelta(days=1), 2), (END, 1)):
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'brand new search', :c, 12, 6)"), {"s": site, "d": day, "h": digest("brand new search"), "c": clicks})
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'old search', 5, 50, 4)"), {"s": site, "d": FINAL, "h": digest("old search")})
    client = create_app(engine=engine, auth=False).test_client()
    base = f"/api/search/breakdown?site_id={site}&range=28d&compare=prev&dim=query"
    plain = client.get(f"{base}&q=brand%20new%20search&q_mode=exact").get_json()
    assert plain["rows"] == [] and plain["fresh_included"] is None  # final days only
    found = client.get(f"{base}&q=brand%20new%20search&q_mode=exact&include_fresh=1").get_json()
    assert [(r["name"], r["clicks"], r["impressions"]) for r in found["rows"]] == [("brand new search", 3, 24)]
    assert found["fresh_included"] == {"from": (FINAL + timedelta(days=1)).isoformat(), "to": END.isoformat()}
    everything = client.get(f"{base}&include_fresh=1").get_json()  # no exact filter: the days not final stay out
    assert [r["name"] for r in everything["rows"]] == ["old search"] and everything["fresh_included"] is None
    contains = client.get(f"{base}&q=brand&include_fresh=1").get_json()
    assert contains["rows"] == [] and contains["fresh_included"] is None
    assert search.overview(*_scope(engine, site))["totals"]["clicks"] == 28 * 100  # and the totals never move


def test_the_side_menu_badge_has_its_own_light_call_with_or_without_a_site(engine, site):
    from seo.web import create_app

    client = create_app(engine=engine, auth=False).test_client()
    for address in ("/api/today/attention", f"/api/today/attention?site_id={site}", "/api/today/attention?site_id=all"):
        answer = client.get(address)
        assert answer.status_code == 200 and isinstance(answer.get_json()["todo"], list)
    assert client.get("/api/today/attention?site_id=x").status_code == 400
