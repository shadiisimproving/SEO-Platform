"""The numbers on Overview, the traffic screens, AI search, Ads and backlink traffic, from fixed stored rows."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors import common
from seo.core.errors import Refused
from seo.metrics import backlink_traffic, service, today as today_view
from seo.resources import service as resources
from seo.web import create_app

D1, D2, D3 = date(2026, 10, 1), date(2026, 10, 2), date(2026, 9, 1)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('T', 'robot', 'x', 'y')"))
        for source, prop in (("gsc", "sc-domain:mine.example"), ("ga4", "1")):
            conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, :c, 1, :p, :d)"), {"s": site_id, "c": source, "p": prop, "d": D2})
    return site_id


def _ga4(engine, site_id, day, channel, source, medium, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, :c, :o, :m, :x, :x, :k)"),
            {"s": site_id, "d": day, "h": common.digest(channel, source, medium), "c": channel, "o": source, "m": medium, "x": sessions, "k": leads},
        )


def _gsc(engine, site_id, day, clicks, shown, position):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p)"), {"s": site_id, "d": day, "c": clicks, "i": shown, "p": position})


def _query(engine, site_id, day, query, clicks, shown, position):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, :c, :i, :p)"),
            {"s": site_id, "d": day, "h": common.digest(query), "q": query, "c": clicks, "i": shown, "p": position},
        )


def _scope(engine, site_id="all", compare=False):
    return service.Scope(engine, site_id, D1.isoformat(), D2.isoformat(), D3.isoformat() if compare else None, (D3 + timedelta(days=1)).isoformat() if compare else None)


def test_position_is_weighted_by_impressions_not_averaged_per_day(engine, site):
    _gsc(engine, site, D1, 10, 1000, 2.0)
    _gsc(engine, site, D2, 10, 10, 50.0)
    totals = service.overview(_scope(engine))["totals"]
    assert totals["clicks"] == 20 and totals["impressions"] == 1010
    assert totals["position"] == pytest.approx(2.5, abs=0.1)


def test_a_day_with_no_data_is_a_gap_not_a_zero(engine, site):
    _gsc(engine, site, D1, 10, 100, 5.0)
    answer = service.overview(_scope(engine))
    assert [row["day"] for row in answer["series"]] == [D1.isoformat()]


def test_no_data_says_why_and_never_shows_zero_totals(engine):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('a.example', 'https://a.example/', 'own')"))
    answer = service.overview(_scope(engine))
    assert answer["state"] == "not_connected" and answer["totals"] is None
    assert service.channels(_scope(engine))["state"] == "not_connected"


def test_a_site_that_said_not_used_is_not_called_unconnected(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('a.example', 'https://a.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, not_used) VALUES (:s, 'gsc', 1)"), {"s": site_id})
    assert service.overview(_scope(engine, site_id))["state"] == "not_used"


def test_competitors_are_never_in_my_totals_and_cant_be_asked_for(engine, site):
    with engine.begin() as conn:
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.example', 'https://rival.example/', 'competitor')")).lastrowid
    _gsc(engine, site, D1, 10, 100, 5.0)
    _gsc(engine, rival, D1, 999, 999, 1.0)
    assert service.overview(_scope(engine))["totals"]["clicks"] == 10
    with pytest.raises(Refused):
        _scope(engine, rival)


def test_queries_gaining_and_losing_include_one_that_vanished(engine, site):
    _query(engine, site, D1, "up", 20, 100, 3)
    _query(engine, site, D3, "up", 5, 100, 6)
    _query(engine, site, D3, "gone", 9, 100, 6)
    answer = service.overview(_scope(engine, compare=True))
    assert answer["gaining"][0]["query"] == "up" and answer["gaining"][0]["change"] == 15
    assert answer["losing"][0] == {"query": "gone", "clicks": 0, "before": 9, "change": -9, "position": None}


def test_position_distribution_counts_queries(engine, site):
    _query(engine, site, D1, "a", 1, 10, 2)
    _query(engine, site, D1, "b", 1, 10, 8)
    _query(engine, site, D1, "c", 1, 10, 15)
    buckets = {row["bucket"]: row["queries"] for row in service.overview(_scope(engine))["distribution"]}
    assert buckets == {"1-3": 1, "4-10": 1, "11-20": 1, "21-50": 0, "51+": 0}


def test_channel_totals_add_up_and_shares_are_right(engine, site):
    _ga4(engine, site, D1, "Organic Search", "google", "organic", 80, 4)
    _ga4(engine, site, D1, "Direct", "(direct)", "(none)", 20, 1)
    answer = service.channels(_scope(engine))
    assert answer["total"] == {"sessions": 100, "leads": 5.0}
    assert answer["channels"][0]["channel"] == "Organic Search" and answer["channels"][0]["share"] == 0.8 and answer["channels"][0]["rate"] == 0.05


def test_a_channel_rule_applies_to_past_days(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7)
    assert service.channels(_scope(engine))["channels"][0]["channel"] == "Referral"
    rule = service.add_rule(engine, "channel", "chatgpt.com/*", "AI assistants")
    assert service.channels(_scope(engine))["channels"][0]["channel"] == "AI assistants"
    service.delete_rule(engine, rule["id"])
    assert service.channels(_scope(engine))["channels"][0]["channel"] == "Referral"


def test_more_than_five_channels_fold_into_other_and_totals_stay_right(engine, site):
    for n in range(7):
        _ga4(engine, site, D1, f"C{n}", f"s{n}", "m", 10 + n)
    answer = service.channels(_scope(engine))
    assert len(answer["series_names"]) == 6 and "Other" in answer["series_names"]
    assert sum(answer["series"][0]["values"].values()) == answer["total"]["sessions"]


def test_a_comparison_with_no_data_shows_no_change(engine, site):
    _ga4(engine, site, D1, "Direct", "(direct)", "(none)", 20)
    answer = service.channels(_scope(engine, compare=True))
    assert answer["channels"][0]["change"] is None


def test_conversions_says_when_key_events_are_not_set_up(engine, site):
    _ga4(engine, site, D1, "Direct", "(direct)", "(none)", 20)
    answer = service.conversions(_scope(engine))
    assert answer["key_events_set_up"] is False and answer["sessions"] == 20 and answer["pages"] == []


def test_content_joins_ga4_and_search_console_whatever_the_slash(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, 'h', '/visa', 30, 25, 2)"), {"s": site, "d": D1})
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'h', 'https://mine.example/visa/?x=1', 12, 100, 4)"), {"s": site, "d": D1})
    rows = service.content(_scope(engine))["pages"]
    assert len(rows) == 1 and rows[0]["path"] == "/visa/" and rows[0]["sessions"] == 30 and rows[0]["clicks"] == 12 and rows[0]["position"] == 4


def test_content_leaves_a_missing_source_blank_not_zero(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'h', 'https://mine.example/x/', 3, 9, 4)"), {"s": site, "d": D1})
    row = service.content(_scope(engine))["pages"][0]
    assert row["sessions"] is None and row["leads"] is None and row["ai"] is None


def test_ai_search_counts_ai_domains_and_the_list_can_be_edited(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7, 1)
    _ga4(engine, site, D1, "Referral", "news.perplexity.ai", "referral", 3)
    _ga4(engine, site, D1, "Referral", "notchatgpt.com", "referral", 99)
    _ga4(engine, site, D1, "Referral", "my-ai.example", "referral", 5)
    answer = service.ai_search(_scope(engine))
    assert answer["sessions"] == 10 and answer["leads"] == 1
    service.add_rule(engine, "ai_domain", "my-ai.example")
    assert service.ai_search(_scope(engine))["sessions"] == 15
    service.add_rule(engine, "ai_domain_off", "chatgpt.com")
    assert service.ai_search(_scope(engine))["sessions"] == 8


def test_ads_never_add_two_currencies_together(engine, site):
    with engine.begin() as conn:
        for name, cost, currency in (("A", 10, "EUR"), ("B", 20, "AED")):
            conn.execute(text("INSERT INTO ga4_ads_daily (site_id, day, row_hash, campaign, clicks, cost, currency, sessions, key_events) VALUES (:s, :d, :h, :c, 5, :v, :y, 5, 1)"), {"s": site, "d": D1, "h": name, "c": name, "v": cost, "y": currency})
    answer = service.ads(_scope(engine))
    assert {row["currency"]: row["cost"] for row in answer["costs"]} == {"AED": 20, "EUR": 10}
    assert answer["clicks"] == 10 and answer["linked"] is True


def _link(engine, site_id, source_url="https://blog.example/post", domain="blog.example", target="https://mine.example/page", **extra):
    columns = {"utm_source": None, "utm_medium": None, "utm_campaign": None, "placed": None, "status": "live", **extra}
    with engine.begin() as conn:
        return conn.execute(
            text("INSERT INTO backlinks (site_id, source_url, domain, status, target_url, placed, utm_source, utm_medium, utm_campaign) VALUES (:s, :u, :d, :status, :t, :placed, :utm_source, :utm_medium, :utm_campaign)"),
            {"s": site_id, "u": source_url, "d": domain, "t": target, **columns},
        ).lastrowid


def _referral(engine, site_id, day, domain, path, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ga4_referral_daily (site_id, day, row_hash, domain, path, sessions, key_events) VALUES (:s, :d, :h, :o, :p, :x, :k)"), {"s": site_id, "d": day, "h": common.digest(domain, path), "o": domain, "p": path, "x": sessions, "k": leads})
        conn.execute(text("INSERT IGNORE INTO coverage (site_id, source, day) VALUES (:s, 'ga4', :d)"), {"s": site_id, "d": day})


def _campaign(engine, site_id, day, source, medium, campaign, path, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ga4_campaign_daily (site_id, day, row_hash, source, medium, campaign, path, sessions, key_events) VALUES (:s, :d, :h, :o, :m, :c, :p, :x, :k)"), {"s": site_id, "d": day, "h": common.digest(source, medium, campaign, path), "o": source, "m": medium, "c": campaign, "p": path, "x": sessions, "k": leads})
        conn.execute(text("INSERT IGNORE INTO coverage (site_id, source, day) VALUES (:s, 'ga4', :d)"), {"s": site_id, "d": day})


def _visits(engine, site_id):
    return backlink_traffic.traffic(engine, site_id, D1.isoformat(), D2.isoformat())


def test_a_target_saved_without_its_slash_still_matches(engine, site):
    link = _link(engine, site)
    _referral(engine, site, D1, "blog.example", "/page/", 12, 2)
    assert _visits(engine, site)["links"][link] == {"visits": 12, "leads": 2, "basis": "domain", "shared_by": 1, "pages": ["/page/"]}


def test_a_tagged_link_is_counted_once_by_utm(engine, site):
    tagged = _link(engine, site, utm_source="blog", utm_medium="backlink", utm_campaign="bl-1")
    plain = _link(engine, site, source_url="https://blog.example/other", target="https://mine.example/page")
    _campaign(engine, site, D1, "blog", "backlink", "bl-1", "/page/", 3, 1)
    _campaign(engine, site, D1, "blog", "backlink", "BL-1", "/page/", 50)  # values are case sensitive
    _referral(engine, site, D1, "blog.example", "/page/", 4)
    links = _visits(engine, site)["links"]
    assert links[tagged]["visits"] == 3 and links[tagged]["basis"] == "utm"
    assert links[plain]["visits"] == 4 and links[plain]["basis"] == "domain"


def test_two_links_on_one_domain_to_one_page_share_a_number_and_say_so(engine, site):
    first = _link(engine, site)
    second = _link(engine, site, source_url="https://blog.example/two")
    _referral(engine, site, D1, "blog.example", "/page/", 12)
    links = _visits(engine, site)["links"]
    assert links[first]["shared_by"] == links[second]["shared_by"] == 2 and links[first]["visits"] == 12


def test_a_planned_link_gets_no_traffic_row(engine, site):
    link = _link(engine, site, status="planned")
    _referral(engine, site, D1, "blog.example", "/page/", 12)
    assert link not in _visits(engine, site)["links"]


def test_no_ga4_data_is_unknown_not_zero_visits(engine, site):
    _link(engine, site)
    answer = _visits(engine, site)
    assert answer == {"has_data": False, "hid_rows": False, "links": {}}


def test_ga4_hiding_rows_is_passed_on(engine, site):
    _link(engine, site)
    _referral(engine, site, D1, "blog.example", "/page/", 2)
    with engine.begin() as conn:
        conn.execute(text("UPDATE coverage SET hid_rows = 1"))
    assert _visits(engine, site)["hid_rows"] is True


def test_a_target_that_redirects_still_matches_its_final_page(engine, site):
    link = _link(engine, site, target="https://mine.example/old")
    with engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET target_final_url = 'https://mine.example/new/' WHERE id = :i"), {"i": link})
    _referral(engine, site, D1, "blog.example", "/new/", 7)
    assert _visits(engine, site)["links"][link]["visits"] == 7


def test_the_backlinks_list_shows_visits_and_says_how_they_were_matched(engine, site):
    tagged = _link(engine, site, utm_source="blog", utm_medium="backlink", utm_campaign="bl-1")
    plain = _link(engine, site, source_url="https://blog.example/two")
    other = _link(engine, site, source_url="https://blog.example/three")
    today = common.today(engine)
    _campaign(engine, site, today, "blog", "backlink", "bl-1", "/page/", 3, 1)
    _referral(engine, site, today, "blog.example", "/page/", 8)
    found = backlink_traffic.for_backlink_list(engine, site)
    assert found[tagged] == {"visits": 3, "leads": 1, "label": "utm", "shared": None}
    assert found[plain]["visits"] == 8 and found[plain]["label"] == "shared" and found[plain]["shared"] == 2 and found[other]["shared"] == 2


def test_before_and_after_a_link_stands_beside_the_sites_own_change(engine, site):
    link = _link(engine, site, placed="2026-10-01")
    with engine.begin() as conn:
        for day, clicks in ((date(2026, 9, 20), 10), (date(2026, 10, 10), 30)):
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'h', 'https://mine.example/page/', :c, 100, 5)"), {"s": site, "d": day, "c": clicks})
    _gsc(engine, site, date(2026, 9, 20), 100, 1000, 5)
    _gsc(engine, site, date(2026, 10, 10), 110, 1000, 5)
    answer = backlink_traffic.before_after(engine, link)
    assert answer["before"]["clicks"] == 10 and answer["after"]["clicks"] == 30 and answer["page_change"] == 200 and answer["site_change"] == 10 and answer["label"] == "Correlation, not proof"


def test_a_date_placed_written_by_hand_is_not_guessed(engine, site):
    link = _link(engine, site, placed="last spring")
    assert backlink_traffic.before_after(engine, link)["state"] == "no_date"


def _alert_row(engine, site_id, kind, severity, title, detail=None):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO alerts (site_id, kind, severity, title, detail) VALUES (:s, :k, :v, :t, :d)"), {"s": site_id, "k": kind, "v": severity, "t": title, "d": json.dumps(detail) if detail else None})


def _page_clicks(engine, site_id, host, name, end, was, now):
    page = f"https://{host}/{name}/"
    with engine.begin() as conn:
        for day, clicks in ((end - timedelta(days=10), was), (end, now)):
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, 100, 5)"), {"s": site_id, "d": day, "h": common.digest(page), "p": page, "c": clicks})


END = date(2026, 10, 20)


def test_today_counts_only_what_is_real_and_filters_by_site(engine, site):
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')")).lastrowid
    _alert_row(engine, site, "x", "warn", "mine")
    _alert_row(engine, other, "x", "crit", "theirs")
    assert [item["title"] for item in today_view.today(engine)["todo"]] == ["theirs", "mine"]
    assert [item["title"] for item in today_view.today(engine, site)["todo"]] == ["mine"]


def test_today_counts_down_to_clarity_data_being_lost(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source, secret, last_ok_at) VALUES (:s, 'clarity', 'x', UTC_TIMESTAMP(3) - INTERVAL 50 HOUR)"), {"s": site})
    item = next(i for i in today_view.today(engine)["todo"] if i["kind"] == "clarity_gap")
    assert item["title"] == "Clarity data lost in 22 h" and item["severity"] == "warn"


def test_today_ranks_by_what_is_being_lost_not_only_by_label(engine, site):
    _alert_row(engine, site, "health_drop", "crit", "health fell")
    _alert_row(engine, site, "source_failing", "crit", "Google data stopped working", {"error": "expired", "source": "gsc"})
    _alert_row(engine, site, "health_site", "crit", "certificate soon", {"site": ["ssl_expiring"]})
    _alert_row(engine, site, "backlink_lost", "warn", "a backlink was lost")
    _alert_row(engine, site, "uptime_down", "crit", "site is down", {"state": "down"})
    _page_clicks(engine, site, "mine.example", "fell", END, 100, 40)
    titles = [item["title"] for item in today_view.today(engine)["todo"]]
    assert titles == ["site is down", "/fell/ lost 60% of its Google clicks", "a backlink was lost", "certificate soon", "Google data stopped working", "health fell"]


def test_today_a_source_failing_on_several_sites_is_one_row(engine, site):
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')")).lastrowid
    for site_id in (site, other):
        _alert_row(engine, site_id, "source_failing", "crit", "Google data stopped working", {"error": "expired"})
    rows = today_view.today(engine)["todo"]
    assert len(rows) == 1 and rows[0]["title"] == "Google data stopped working on 2 sites" and rows[0]["host"] is None and len(rows[0]["alert_ids"]) == 2
    only = today_view.today(engine, site)["todo"]
    assert only[0]["title"] == "Google data stopped working" and only[0]["host"] == "mine.example"


def test_today_one_certificate_reported_by_two_checks_is_one_row(engine, site):
    _alert_row(engine, site, "health_site", "crit", "certificate soon", {"site": ["ssl_expiring"]})
    _alert_row(engine, site, "ssl_expiry", "warn", "certificate expires on 2026-11-17", {"state": "expiring"})
    rows = today_view.today(engine)["todo"]
    assert [row["title"] for row in rows] == ["certificate expires on 2026-11-17"] and len(rows[0]["alert_ids"]) == 2
    assert "site_codes" not in rows[0]


def test_today_a_health_problem_beyond_the_certificate_keeps_its_row(engine, site):
    _alert_row(engine, site, "health_site", "crit", "start page and certificate", {"site": ["start_page_down", "ssl_expiring"]})
    _alert_row(engine, site, "ssl_expiry", "warn", "certificate expires on 2026-11-17", {"state": "expiring"})
    assert [row["title"] for row in today_view.today(engine)["todo"]] == ["start page and certificate", "certificate expires on 2026-11-17"]


def test_today_splits_big_drops_from_smaller_moves_and_never_shows_one_twice(engine, site):
    _page_clicks(engine, site, "mine.example", "fell", END, 100, 40)  # big: goes in the to-do list
    _page_clicks(engine, site, "mine.example", "dipped", END, 100, 75)  # under 30%: only Going down
    _page_clicks(engine, site, "mine.example", "small", END, 40, 10)  # under 50 clicks before: only Going down
    _page_clicks(engine, site, "mine.example", "same", END, 100, 95)  # barely moved
    _page_clicks(engine, site, "mine.example", "tiny", END, 5, 50)  # too small before to mean anything
    _page_clicks(engine, site, "mine.example", "rose", END, 50, 80)
    data = today_view.today(engine)
    assert [item["page"] for item in data["todo"]] == ["https://mine.example/fell/"]
    assert {move["path"] for move in data["going_down"]} == {"/dipped/", "/small/"}
    assert [move["path"] for move in data["going_up"]] == ["/rose/"]


def test_today_a_site_whose_data_stopped_does_not_look_like_it_fell(engine, site):
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')")).lastrowid
    _page_clicks(engine, site, "mine.example", "fine", END, 100, 100)
    _page_clicks(engine, other, "other.example", "stopped", END - timedelta(days=20), 100, 100)  # its last day is 20 days before the other site's
    data = today_view.today(engine)
    assert data["todo"] == [] and data["going_down"] == []


def test_today_a_week_with_missing_days_is_not_compared(engine, site):
    page = "https://mine.example/gap/"
    with engine.begin() as conn:
        for back in (7, 8, 9, 10, 0):  # four days before, one day now
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, 40, 100, 5)"), {"s": site, "d": END - timedelta(days=back), "h": common.digest(page), "p": page})
    data = today_view.today(engine)
    assert data["todo"] == [] and data["going_down"] == []


def test_today_a_drop_marked_as_seen_stays_out_of_the_list_until_next_week(engine, site):
    _page_clicks(engine, site, "mine.example", "fell", END, 100, 40)
    key = today_view.today(engine)["todo"][0]["seen_key"]
    today_view.mark_drop_seen(engine, key)
    assert today_view.today(engine)["todo"] == []
    assert [move["path"] for move in today_view.today(engine)["going_down"]] == ["/fell/"]  # still true, only no longer a to-do
    today_view.mark_drop_seen(engine, key, seen=False)
    assert len(today_view.today(engine)["todo"]) == 1
    today_view.mark_drop_seen(engine, key)
    with engine.begin() as conn:
        conn.execute(text("UPDATE today_seen SET hidden_until = UTC_DATE()"))
    assert len(today_view.today(engine)["todo"]) == 1
    with pytest.raises(Refused):
        today_view.mark_drop_seen(engine, "not a key")


def test_today_keyword_moves_use_impression_weighted_position_with_thresholds(engine, site):
    before, now = END - timedelta(days=10), END
    for query, was, is_now, shown in (("rose", 7.0, 3.0, 100), ("fell", 4.0, 9.0, 100), ("barely", 5.0, 6.0, 100), ("rare", 20.0, 2.0, 10)):
        _query(engine, site, before, query, 1, shown, was)
        _query(engine, site, now, query, 1, shown, is_now)
    # A day with few impressions barely moves the average.
    _query(engine, site, now - timedelta(days=1), "rose", 1, 1, 90.0)
    data = today_view.today(engine)
    assert [(m["query"], m["was"], m["now"]) for m in data["going_up"]] == [("rose", 7, 4)]
    assert [(m["query"], m["was"], m["now"]) for m in data["going_down"]] == [("fell", 4, 9)]


def test_today_results_count_back_from_where_each_source_ends_not_from_today(engine, site):
    end = date(2026, 10, 20)
    for back in (1, 30, 56):
        _gsc(engine, site, end - timedelta(days=back), 100, 500, 5.0)
        _ga4(engine, site, end - timedelta(days=back), "Organic", "google", "organic", 50, leads=2)
    results = today_view.today(engine)["results"]
    assert results["clicks"]["value"] == 100 and results["clicks"]["change"] == -50
    assert results["visits"]["value"] == 50 and results["visits"]["change"] == -50
    assert results["leads"]["value"] == 2 and results["leads"]["change"] == -2 and results["leads"]["state"] == "ok"
    assert results["through"] == (end - timedelta(days=1)).isoformat()


def test_today_graph_points_line_up_by_day_and_a_gap_stays_empty(engine, site):
    for back, clicks in ((0, 10), (1, 20), (28, 30), (55, 5)):  # no data for most days
        _gsc(engine, site, END - timedelta(days=back), clicks, 100, 5.0)
    points = today_view.today(engine)["results"]["clicks"]["points"]
    assert len(points) == 28 and points[-1] == {"day": END.isoformat(), "now": 10, "was": 30}
    assert points[-2]["now"] == 20 and points[-2]["was"] is None
    assert points[0]["now"] is None and points[0]["was"] == 5 and points[0]["day"] == (END - timedelta(days=27)).isoformat()
    assert "_daily" not in today_view.today(engine)["sites"][0]


def test_today_graph_of_a_new_site_has_no_earlier_line(engine, site):
    _gsc(engine, site, END, 10, 100, 5.0)
    _gsc(engine, site, END - timedelta(days=30), 1, 100, 5.0)
    assert all(point["was"] is None for point in today_view.today(engine)["results"]["clicks"]["points"])


def test_today_a_new_site_has_no_change_rather_than_a_huge_one(engine, site):
    _gsc(engine, site, END, 100, 500, 5.0)
    _gsc(engine, site, END - timedelta(days=30), 1, 500, 5.0)
    clicks = today_view.today(engine)["results"]["clicks"]
    assert clicks["value"] == 100 and clicks["change"] is None


def test_today_never_shows_a_false_zero(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')"))
    data = today_view.today(engine)
    row = data["sites"][0]
    assert row["visits"] is None and row["clicks"] is None and row["leads"] is None
    assert data["results"]["visits"]["value"] is None and data["results"]["leads"]["state"] == "no_ga4"
    _ga4(engine, site, END, "Organic", "google", "organic", 50, leads=0)
    results = today_view.today(engine)["results"]
    assert results["leads"]["value"] is None and results["leads"]["state"] == "not_set_up"
    assert results["visits"]["value"] == 50 and results["visits"]["sites"] == 1 and results["visits"]["of"] == 2


def _rival(engine, site, host="rival.example"):
    with engine.begin() as conn:
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'competitor')"), {"h": host, "u": f"https://{host}/"}).lastrowid
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id) VALUES (:s, :r)"), {"s": site, "r": rival})
        domain = conn.execute(text("INSERT INTO domains (host) VALUES (:h)"), {"h": host}).lastrowid
    return rival, domain


def _edit(engine, domain, host, path, kind="title"):
    url = f"https://{host}{path}"
    with engine.begin() as conn:
        page = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar()
        if page is None:
            page = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash) VALUES (:d, :u, :h)"), {"d": domain, "u": url, "h": common.digest(url)}).lastrowid
        conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind) VALUES (:p, :d, :k)"), {"p": page, "d": domain, "k": kind})


def test_today_rival_edits_name_our_page_only_when_the_pages_compete(engine, site):
    rival, domain = _rival(engine, site)
    with engine.begin() as conn:
        pair = conn.execute(
            text("INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url) VALUES (:s, :r, 'https://mine.example/visa/', 'h', 'https://rival.example/visa/')"), {"s": site, "r": rival}
        ).lastrowid
    _edit(engine, domain, "rival.example", "/visa/")
    _edit(engine, domain, "rival.example", "/visa/", "headings")  # the same page twice is one row
    _edit(engine, domain, "rival.example", "/blog/")
    _edit(engine, domain, "rival.example", "/other/")
    data = today_view.today(engine, site)
    assert [(row["url"], row["my_url"], row["pair_id"]) for row in data["rival_changes"]] == [("https://rival.example/visa/", "https://mine.example/visa/", pair)]
    assert data["other_edits"] == 2


def test_today_a_hidden_pair_does_not_count_as_competing(engine, site):
    rival, domain = _rival(engine, site)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, hidden) VALUES (:s, :r, 'https://mine.example/a/', 'h', 'https://rival.example/a/', 1)"), {"s": site, "r": rival})
    _edit(engine, domain, "rival.example", "/a/")
    data = today_view.today(engine, site)
    assert data["rival_changes"] == [] and data["other_edits"] == 1


def test_today_shows_a_competitor_edit_only_on_its_own_sites(engine, site):
    _, domain = _rival(engine, site)
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')")).lastrowid
    _edit(engine, domain, "rival.example", "/a/")
    assert today_view.today(engine, site)["other_edits"] == 1
    assert today_view.today(engine, other)["other_edits"] == 0
    assert today_view.today(engine)["other_edits"] == 1


def test_resources_need_a_title_and_a_real_link_and_can_be_undone(engine, site):
    with pytest.raises(Refused):
        resources.create(engine, {"title": " "})
    with pytest.raises(Refused):
        resources.create(engine, {"title": "x", "url": "javascript:alert(1)"})
    made = resources.create(engine, {"title": "Brief", "url": "https://docs.example/brief", "site_id": site, "kind": "Brief"}, "Boss")
    assert made["host"] == "mine.example" and made["created_by"] == "Boss"
    resources.delete(engine, made["id"])
    assert resources.list_resources(engine) == []
    resources.restore(engine, made["id"])
    assert len(resources.list_resources(engine)) == 1


def test_the_apis_answer_and_refuse_bad_dates(engine, site):
    client = create_app(engine=engine, auth=False).test_client()
    query = f"from={D1}&to={D2}"
    for name in ("overview", "channels", "conversions", "content", "ai", "ads"):
        assert client.get(f"/api/metrics/{name}?{query}").status_code == 200, name
    assert client.get("/api/metrics/overview?from=nope&to=2026-10-01").status_code == 400
    assert client.get("/api/metrics/overview?from=2026-10-02&to=2026-10-01").status_code == 400
    assert client.get("/api/today").status_code == 200
