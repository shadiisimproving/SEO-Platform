"""The side panel behind each table row (simpler screens, change 6), and the answers folded together for them (change 7).

Each panel adds up to the row it opens from, a day a source didn't report is a gap rather than a zero, and asking for a
fold is the only way an existing answer gains anything. Made-up sites only.
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors import common
from seo.core.errors import Refused
from seo.links import service as links
from seo.metrics import service
from seo.serp.store import to_ascii_host
from seo.web import create_app

D1, D2, D3 = date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3)
B1, B2 = date(2026, 9, 29), date(2026, 9, 30)  # the two days before D1 and D2


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('T', 'robot', 'x', 'y')"))
        for source, prop in (("gsc", "sc-domain:mine.example"), ("ga4", "1")):
            conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, :c, 1, :p, :d)"), {"s": site_id, "c": source, "p": prop, "d": D2})
    return site_id


@pytest.fixture
def other(engine, site):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')")).lastrowid


def _ga4(engine, site_id, day, channel, source, medium, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, :c, :o, :m, :x, :x, :k)"),
            {"s": site_id, "d": day, "h": common.digest(channel, source, medium), "c": channel, "o": source, "m": medium, "x": sessions, "k": leads},
        )


def _page(engine, site_id, day, path, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, :h, :p, :x, :x, :k)"),
            {"s": site_id, "d": day, "h": common.digest(path), "p": path, "x": sessions, "k": leads},
        )


def _shown(engine, site_id, day, page, clicks, impressions, position):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, :i, :o)"),
            {"s": site_id, "d": day, "h": common.digest(page), "p": page, "c": clicks, "i": impressions, "o": position},
        )


def _search(engine, site_id, day, query, page, clicks, impressions, position):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :p, :c, :i, :o)"),
            {"s": site_id, "d": day, "h": common.digest(query, page), "q": query, "p": page, "c": clicks, "i": impressions, "o": position},
        )


def _referral(engine, site_id, day, domain, path, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_referral_daily (site_id, day, row_hash, domain, path, sessions, key_events) VALUES (:s, :d, :h, :o, :p, :x, :k)"),
            {"s": site_id, "d": day, "h": common.digest(domain, path), "o": domain, "p": path, "x": sessions, "k": leads},
        )


def _scope(engine, site_id="all", start=D1, end=D2, before=(B1, B2)):
    compare = before or (None, None)
    return service.Scope(engine, site_id, start.isoformat(), end.isoformat(), compare[0] and compare[0].isoformat(), compare[1] and compare[1].isoformat())


# ---- a channel ---------------------------------------------------------------------------------------------------


def test_a_channel_panel_adds_up_to_its_row(engine, site):
    _ga4(engine, site, D1, "Organic Search", "google", "organic", 60, 3)
    _ga4(engine, site, D2, "Organic Search", "bing", "organic", 20, 1)
    _ga4(engine, site, D2, "Direct", "(direct)", "(none)", 20)
    _ga4(engine, site, B1, "Organic Search", "google", "organic", 40, 1)
    row = next(r for r in service.channels(_scope(engine))["channels"] if r["channel"] == "Organic Search")
    panel = service.channel_detail(_scope(engine), "Organic Search")
    assert panel["kind"] == "channel" and panel["found"] is True
    for key in ("sessions", "leads", "rate", "share"):
        assert panel["totals"][key] == row[key], key
    assert panel["totals"]["sessions"] == 80 and panel["change"] == row["change"] == 100.0
    assert panel["before"] == {"sessions": 40, "leads": 1.0, "rate": 0.025}
    assert [(s["source"], s["sessions"], s["before"], s["change"]) for s in panel["sources"]] == [("google", 60, 40, 50.0), ("bing", 20, None, None)]
    assert [(m["medium"], m["sessions"]) for m in panel["mediums"]] == [("organic", 80)] and panel["sources_total"] == 2
    assert panel["days"] == [{"day": "2026-10-01", "sessions": 60, "leads": 3.0}, {"day": "2026-10-02", "sessions": 20, "leads": 1.0}]
    assert panel["days_before"] == [{"day": "2026-09-29", "sessions": 40, "leads": 1.0}]
    assert panel["period"] == service.channels(_scope(engine))["period"]


def test_a_day_ga4_reported_counts_at_zero_and_a_day_it_did_not_is_a_gap(engine, site):
    _ga4(engine, site, D1, "Direct", "(direct)", "(none)", 5)
    _ga4(engine, site, D3, "Referral", "blog.example", "referral", 7)  # nothing at all on D2
    days = service.channel_detail(_scope(engine, end=D3, before=None), "Referral")["days"]
    assert days == [{"day": "2026-10-01", "sessions": 0, "leads": 0.0}, {"day": "2026-10-03", "sessions": 7, "leads": 0.0}]


def test_a_channel_rule_decides_which_panel_a_visit_is_in(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7)
    service.add_rule(engine, "channel", "chatgpt.com/*", "AI assistants")
    assert service.channel_detail(_scope(engine), "AI assistants")["totals"]["sessions"] == 7
    referral = service.channel_detail(_scope(engine), "Referral")
    assert referral["found"] is False and referral["totals"]["sessions"] == 0  # GA4 has the days: a real zero


def test_a_channel_panel_with_no_data_is_unknown_not_zero(engine, site):
    panel = service.channel_detail(_scope(engine), "Direct")
    assert panel["totals"] is None and panel["before"] is None and panel["change"] is None and panel["days"] == [] and panel["found"] is False


def test_the_period_before_is_cut_to_as_many_days_as_the_period_has(engine, site):
    start, end = D1, D1 + timedelta(days=6)  # 7 days asked, GA4 has 6 of them
    for back in range(1, 8):
        _ga4(engine, site, start - timedelta(days=back), "Direct", "(direct)", "(none)", 10)
    for ahead in range(6):
        _ga4(engine, site, start + timedelta(days=ahead), "Direct", "(direct)", "(none)", 10)
    before = (start - timedelta(days=7), start - timedelta(days=1))
    panel = service.channel_detail(_scope(engine, start=start, end=end, before=before), "Direct")
    assert panel["period"]["trimmed"] is True and panel["period"]["to"] == (start + timedelta(days=5)).isoformat()
    assert panel["period"]["compare_to"] == (start - timedelta(days=2)).isoformat()
    assert panel["totals"]["sessions"] == 60 and panel["before"]["sessions"] == 60 and panel["change"] == 0.0
    conversions = service.conversions(_scope(engine, start=start, end=end, before=before))
    assert conversions["before"]["sessions"] == 60 and conversions["period"] == panel["period"]


# ---- a referring site ---------------------------------------------------------------------------------------------


def test_a_referrer_panel_adds_up_to_its_row_and_lists_its_landing_pages(engine, site):
    _ga4(engine, site, D1, "Referral", "blog.example", "referral", 12, 2)
    _ga4(engine, site, D2, "Referral", "blog.example", "referral", 3)
    _ga4(engine, site, B2, "Referral", "blog.example", "referral", 5)
    _referral(engine, site, D1, "blog.example", "/visa", 10, 2)
    _referral(engine, site, D2, "blog.example", "/visa/?x=1", 1)
    _referral(engine, site, D2, "blog.example", "/contact/", 2)
    _referral(engine, site, D2, "news.example", "/visa/", 50)  # another site
    row = service.channels(_scope(engine))["referrers"][0]
    panel = service.referrer_detail(_scope(engine), "blog.example")
    assert panel["totals"]["sessions"] == row["sessions"] == 15 and panel["totals"]["leads"] == row["leads"] == 2
    assert panel["before"]["sessions"] == 5 and panel["change"] == 200.0
    assert [(p["host"], p["path"], p["sessions"]) for p in panel["pages"]] == [("mine.example", "/visa/", 11), ("mine.example", "/contact/", 2)]
    assert panel["pages_total"] == 2


# ---- a page -------------------------------------------------------------------------------------------------------


def _visa_page(engine, site_id):
    _page(engine, site_id, D1, "/visa", 30, 2)
    _page(engine, site_id, D2, "/visa/", 10, 1)
    _page(engine, site_id, D2, "/contact/", 4)
    _shown(engine, site_id, D1, "https://mine.example/visa/?x=1", 12, 100, 4)
    _shown(engine, site_id, D2, "https://mine.example/visa/", 8, 100, 6)
    _referral(engine, site_id, D1, "chatgpt.com", "/visa/", 5, 1)
    _referral(engine, site_id, D2, "perplexity.ai", "/visa", 2)
    _referral(engine, site_id, D2, "blog.example", "/visa/", 9)  # not an assistant


def test_a_page_panel_adds_up_to_its_content_row(engine, site):
    _visa_page(engine, site)
    row = next(r for r in service.content(_scope(engine))["pages"] if r["path"] == "/visa/")
    panel = service.page_detail(_scope(engine), "/visa/", "mine.example")
    for key in ("sessions", "leads", "clicks", "impressions", "position", "ai"):
        assert panel["totals"][key] == row[key], key
    assert panel["totals"]["sessions"] == 40 and panel["totals"]["clicks"] == 20 and panel["totals"]["position"] == 5.0 and panel["totals"]["ai"] == 7
    assert panel["category"] == row["category"] and panel["url"] == "https://mine.example/visa/" and panel["found"] is True
    assert panel["addresses"] == ["https://mine.example/visa/", "https://mine.example/visa/?x=1"]
    assert [(a["source"], a["sessions"]) for a in panel["ai_sources"]] == [("chatgpt.com", 5), ("perplexity.ai", 2)]
    assert panel["days"] == [
        {"day": "2026-10-01", "sessions": 30, "leads": 2.0, "clicks": 12, "impressions": 100, "position": 4.0},
        {"day": "2026-10-02", "sessions": 10, "leads": 1.0, "clicks": 8, "impressions": 100, "position": 6.0},
    ]
    assert panel["before"] == {"sessions": None, "leads": None, "rate": None, "clicks": None, "impressions": None, "click_rate": None, "position": None, "ai": None}


def test_a_page_panel_lists_the_searches_that_bring_it(engine, site):
    for address in ("https://mine.example/visa/", "https://mine.example/visa/?x=1", "https://mine.example/contact/"):
        _shown(engine, site, D1, address, 1, 10, 5)
    _search(engine, site, D1, "visa seville", "https://mine.example/visa/", 5, 50, 3)
    _search(engine, site, D1, "visa seville", "https://mine.example/visa/?x=1", 1, 10, 9)  # the same page under another address
    _search(engine, site, D2, "spain visa", "https://mine.example/visa/", 2, 40, 8)
    _search(engine, site, D1, "contact us", "https://mine.example/contact/", 9, 90, 1)  # another page
    _search(engine, site, B1, "visa seville", "https://mine.example/visa/", 4, 40, 4)  # the period before
    queries = service.page_detail(_scope(engine), "https://mine.example/visa/")["queries"]
    assert [(q["query"], q["clicks"], q["impressions"]) for q in queries] == [("visa seville", 6, 60), ("spain visa", 2, 40)]
    assert queries[0]["position"] == 4.0 and queries[0]["clicks_before"] == 4 and queries[0]["change"] == 2
    assert queries[1]["clicks_before"] == 0 and queries[1]["change"] == 2


def test_a_page_panel_leaves_a_source_with_nothing_for_it_blank(engine, site):
    _shown(engine, site, D1, "https://mine.example/x/", 3, 9, 4)
    panel = service.page_detail(_scope(engine), "/x/", "mine.example")
    assert panel["totals"]["sessions"] is None and panel["totals"]["leads"] is None and panel["totals"]["rate"] is None and panel["totals"]["ai"] is None
    assert panel["totals"]["clicks"] == 3 and all(day["sessions"] is None for day in panel["days"])


def test_a_page_day_the_source_reported_is_zero_and_a_missing_day_is_a_gap(engine, site):
    _page(engine, site, D1, "/visa/", 5)
    _page(engine, site, D2, "/contact/", 3)  # GA4 reported D2, without the page
    days = service.page_detail(_scope(engine, end=D3, before=None), "/visa/", "mine.example")["days"]
    assert [(d["day"], d["sessions"], d["clicks"]) for d in days] == [("2026-10-01", 5, None), ("2026-10-02", 0, None)]


def test_a_search_console_lag_never_makes_a_page_look_like_it_fell(engine, site):
    start, end = D1, D1 + timedelta(days=6)
    for back in range(1, 8):
        _shown(engine, site, start - timedelta(days=back), "https://mine.example/visa/", 10, 100, 5)
    for ahead in range(5):  # Search Console has 5 of the 7 days
        _shown(engine, site, start + timedelta(days=ahead), "https://mine.example/visa/", 10, 100, 5)
    panel = service.page_detail(_scope(engine, "all", start, end, (start - timedelta(days=7), start - timedelta(days=1))), "/visa/", "mine.example")
    assert panel["periods"]["gsc"]["trimmed"] is True and panel["periods"]["gsc"]["compare_to"] == (start - timedelta(days=3)).isoformat()
    assert panel["totals"]["clicks"] == 50 and panel["before"]["clicks"] == 50


def test_a_page_panel_at_all_sites_needs_to_know_whose_page(engine, site, other):
    _page(engine, site, D1, "/contact/", 30)
    _page(engine, other, D1, "/contact/", 5)
    with pytest.raises(Refused):
        service.page_detail(_scope(engine), "/contact/")
    assert service.page_detail(_scope(engine), "/contact/", "other.example")["totals"]["sessions"] == 5
    assert service.page_detail(_scope(engine), "https://www.other.example/contact/")["totals"]["sessions"] == 5
    assert service.page_detail(_scope(engine, site), "/contact/")["totals"]["sessions"] == 30
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.example', 'https://rival.example/', 'competitor')"))
    with pytest.raises(Refused):
        service.page_detail(_scope(engine), "/contact/", "rival.example")
    with pytest.raises(Refused):
        service.page_detail(_scope(engine, site), "/contact/", "other.example")  # not in the site picked


# ---- an assistant -------------------------------------------------------------------------------------------------


def test_an_assistant_panel_adds_up_to_its_ai_search_row(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7, 1)
    _ga4(engine, site, D2, "Unassigned", "chatgpt.com", "(not set)", 3)  # ChatGPT's own tagged links: any channel counts
    _ga4(engine, site, D2, "Referral", "perplexity.ai", "referral", 4)
    _ga4(engine, site, D2, "Direct", "(direct)", "(none)", 50)
    _ga4(engine, site, B1, "Referral", "chatgpt.com", "referral", 5)
    _referral(engine, site, D1, "chatgpt.com", "/visa/", 6, 1)
    _referral(engine, site, D1, "perplexity.ai", "/visa/", 4)
    row = next(s for s in service.ai_search(_scope(engine))["sources"] if s["source"] == "chatgpt.com")
    panel = service.assistant_detail(_scope(engine), "ChatGPT.com")
    assert panel["source"] == "chatgpt.com" and panel["found"] is True
    assert panel["totals"]["sessions"] == row["sessions"] == 10 and panel["totals"]["leads"] == row["leads"] == 1
    assert panel["totals"]["rate"] == row["rate"] is None  # fewer than 30 visits: no rate yet
    assert panel["totals"]["share"] == round(10 / 14, 4)
    assert panel["before"]["sessions"] == 5 and panel["change"] == 100.0
    assert [(p["path"], p["sessions"]) for p in panel["pages"]] == [("/visa/", 6)]
    assert sum(week["sessions"] or 0 for week in panel["weekly"]) == 15 and panel["weekly"][-1]["end"] == "2026-10-02"
    assert [d["sessions"] for d in panel["days"]] == [7, 3]


def test_an_assistant_ga4_did_not_name_has_no_pages(engine, site):
    _ga4(engine, site, D1, "AI Assistant", "(not set)", "(not set)", 4)
    panel = service.assistant_detail(_scope(engine), "(not set)")
    assert panel["totals"]["sessions"] == 4 and panel["pages"] is None and panel["pages_total"] is None


# ---- Conversions and Channels: the period before, day by day ----------------------------------------------------------


def test_conversions_compares_with_the_period_before(engine, site):
    _ga4(engine, site, D1, "Organic Search", "google", "organic", 80, 4)
    _ga4(engine, site, D2, "Direct", "(direct)", "(none)", 20, 1)
    _ga4(engine, site, B1, "Organic Search", "google", "organic", 50, 2)
    answer = service.conversions(_scope(engine))
    assert answer["sessions"] == 100 and answer["leads"] == 5 and answer["rate"] == 0.05  # as before
    assert answer["before"] == {"sessions": 50, "leads": 2.0, "rate": 0.04}
    assert answer["changes"] == {"sessions": 100.0, "leads": 150.0, "rate_points": 1.0}
    assert answer["days"] == [{"day": "2026-10-01", "sessions": 80, "leads": 4.0}, {"day": "2026-10-02", "sessions": 20, "leads": 1.0}]
    assert answer["days_before"] == [{"day": "2026-09-29", "sessions": 50, "leads": 2.0}]
    assert answer["period"]["from"] == "2026-10-01" and answer["period"]["compare_from"] == "2026-09-29"


def test_conversions_with_no_comparison_or_no_data_before_says_unknown(engine, site):
    _ga4(engine, site, D1, "Direct", "(direct)", "(none)", 20, 1)
    alone = service.conversions(_scope(engine, before=None))
    assert alone["before"] is None and alone["changes"] == {} and alone["days_before"] is None
    empty_before = service.conversions(_scope(engine))
    assert empty_before["before"] is None and empty_before["days_before"] == []


def test_channels_days_add_up_to_the_totals(engine, site):
    _ga4(engine, site, D1, "Organic Search", "google", "organic", 80, 4)
    _ga4(engine, site, D2, "Direct", "(direct)", "(none)", 20, 1)
    _ga4(engine, site, B2, "Direct", "(direct)", "(none)", 9)
    answer = service.channels(_scope(engine))
    assert sum(d["sessions"] for d in answer["days"]) == answer["total"]["sessions"] == 100
    assert sum(d["leads"] for d in answer["days"]) == answer["total"]["leads"] == 5
    assert answer["days_before"] == [{"day": "2026-09-30", "sessions": 9, "leads": 0.0}]
    assert service.channels(_scope(engine, before=None))["days_before"] is None


# ---- folds: one request for a whole simpler screen --------------------------------------------------------------------


def _client(engine):
    return create_app(engine=engine, auth=False).test_client()


def test_without_include_every_answer_is_as_it_was(engine, site):
    client, query = _client(engine), f"from={D1}&to={D2}"
    assert not {"setup", "backlinks"} & set(client.get("/api/today").get_json())
    assert not {"clarity", "speed", "clarity_reports"} & set(client.get(f"/api/metrics/content?{query}").get_json())
    assert "logos" not in client.get(f"/api/metrics/channels?{query}").get_json()


def test_include_refuses_a_part_it_does_not_have(engine, site):
    client, query = _client(engine), f"from={D1}&to={D2}"
    assert client.get("/api/today?include=nope").status_code == 400
    assert client.get(f"/api/metrics/content?{query}&include=setup").status_code == 400
    assert client.get(f"/api/metrics/channels?{query}&include=logos,speed").status_code == 400


def test_today_folds_the_setup_facts_and_the_backlinks_numbers(engine, site, other):
    with engine.begin() as conn:
        keyword = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash) VALUES ('visa seville', 'k1')")).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": keyword})
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.example', 'https://rival.example/', 'competitor')")).lastrowid
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id) VALUES (:s, :r)"), {"s": site, "r": rival})
        conn.execute(text("INSERT INTO health_audits (site_id) VALUES (:s)"), {"s": other})
        conn.execute(text("UPDATE sites SET setup_not_used = '[\"checks\"]' WHERE id = :s"), {"s": site})
        conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, status, target_url) VALUES (:s, 'https://blog.example/a', 'blog.example', 'lost', 'https://mine.example/')"), {"s": site})
        conn.execute(text("UPDATE backlinks SET lost_at = UTC_TIMESTAMP(3)"))
    client = _client(engine)
    one = client.get(f"/api/today?site_id={site}&include=setup,backlinks").get_json()
    assert one["setup"] == [{"site_id": site, "host": "mine.example", "keywords": True, "competitors": True, "checks": False, "not_used": ["checks"]}]
    assert one["backlinks"] == client.get(f"/api/backlinks/summary?site_id={site}").get_json() and one["backlinks"]["lost_this_week"] == 1
    every = client.get("/api/today?include=setup").get_json()
    assert [(s["host"], s["keywords"], s["checks"]) for s in every["setup"]] == [("mine.example", True, False), ("other.example", False, True)]
    assert "backlinks" not in every
    listed = {s["id"]: s["setup_not_used"] for s in links.own_sites(engine)}
    assert all(s["not_used"] == listed[s["site_id"]] for s in every["setup"])


def test_content_folds_clarity_speed_and_the_clarity_downloads_as_their_own_routes_answer(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions, scroll_depth, rage_clicks, dead_clicks) VALUES (:s, :d, 40, 55.5, 2, 3)"), {"s": site, "d": D1})
        conn.execute(text("INSERT INTO cwv_runs (site_id, url, strategy, performance, lcp_ms, inp_ms, cls) VALUES (:s, 'https://mine.example/', 'mobile', 91, 1800, 120, 0.02)"), {"s": site})
    client, query = _client(engine), f"from={D1}&to={D2}&site_id={site}"
    folded = client.get(f"/api/metrics/content?{query}&include=clarity,speed,clarity_reports").get_json()
    assert folded["clarity"] == client.get(f"/api/metrics/clarity?{query}").get_json() and folded["clarity"]["sessions"] == 40
    assert folded["speed"] == client.get(f"/api/metrics/speed?{query}").get_json() and folded["speed"]["runs"][0]["performance"] == 91
    assert folded["clarity_reports"] == client.get(f"/api/metrics/clarity-reports?{query}").get_json()
    plain = client.get(f"/api/metrics/content?{query}").get_json()
    assert {k: v for k, v in folded.items() if k not in ("clarity", "speed", "clarity_reports")} == plain


def test_channels_folds_which_referrers_have_an_icon(engine, site):
    _ga4(engine, site, D1, "Referral", "ps.adnet.example", "referral", 4)
    _ga4(engine, site, D1, "Referral", "blog.example", "referral", 2)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_logos (domain, status) VALUES ('adnet.example', 'found'), ('blog.example', 'none')"))
    answer = _client(engine).get(f"/api/metrics/channels?from={D1}&to={D2}&include=logos").get_json()
    assert answer["logos"] == ["adnet.example"]


def test_known_logos_follow_the_way_a_screen_looks_them_up(engine):
    accented = "straße.example"
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_logos (domain, status) VALUES ('adnet.example', 'found'), (:a, 'found'), ('example', 'found')"), {"a": to_ascii_host(accented)})
    assert service.known_logos(engine, ["ps.adnet.example", "google", "(direct)", None]) == ["adnet.example"]
    assert service.known_logos(engine, [f"shop.{accented}"]) == sorted([accented, to_ascii_host(accented)])
    assert service.known_logos(engine, []) == []


# ---- the routes -------------------------------------------------------------------------------------------------------


def test_the_panel_routes_answer_and_refuse_what_they_cannot(engine, site):
    _visa_page(engine, site)
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7, 1)
    client, query = _client(engine), f"from={D1}&to={D2}&compare_from={B1}&compare_to={B2}"
    for address in ("channel?name=Referral", "referrer?domain=chatgpt.com", "page?path=/visa/&host=mine.example", "assistant?source=chatgpt.com"):
        answer = client.get(f"/api/metrics/{address}&{query}")
        assert answer.status_code == 200, address
    assert client.get(f"/api/metrics/page?path=/visa/&host=mine.example&{query}").get_json()["totals"]["sessions"] == 40
    for address in ("channel?x=1", "referrer?x=1", "page?host=mine.example", "assistant?x=1", "page?path=/visa/&host=nobody.example", f"channel?name={'x' * 191}"):
        assert client.get(f"/api/metrics/{address}&{query}").status_code == 400, address
    assert client.get("/api/metrics/channel?name=Direct&from=nope&to=2026-10-01").status_code == 400
