"""AI search: which visits count as AI, lead rates that wait for enough visits, Copilot citations against the right visits,
Clarity live as a second opinion, the freshness of each source and the next actions. Made-up sites only."""
import json
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from seo.collectors import common
from seo.metrics import ai_search, service
from seo.web import create_app

ROOT = Path(__file__).resolve().parent.parent
D1, D2 = date(2026, 10, 1), date(2026, 10, 2)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('T', 'robot', 'x', 'y')"))
        for source, prop in (("gsc", "sc-domain:mine.example"), ("ga4", "1")):
            conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, :c, 1, :p, :d)"), {"s": site_id, "c": source, "p": prop, "d": D2})
    return site_id


def _ga4(engine, site_id, day, channel, source, medium, sessions, leads=0, engaged=None):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events, engaged_sessions) VALUES (:s, :d, :h, :c, :o, :m, :x, :x, :k, :e)"),
            {"s": site_id, "d": day, "h": common.digest(channel, source, medium), "c": channel, "o": source, "m": medium, "x": sessions, "k": leads, "e": engaged},
        )


def _gsc_page(engine, site_id, day, page, clicks):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions) VALUES (:s, :d, :h, :p, :c, :c)"), {"s": site_id, "d": day, "h": common.digest(page), "p": page, "c": clicks})


def _referral(engine, site_id, day, domain, path, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ga4_referral_daily (site_id, day, row_hash, domain, path, sessions, key_events) VALUES (:s, :d, :h, :o, :p, :x, :k)"), {"s": site_id, "d": day, "h": common.digest(domain, path), "o": domain, "p": path, "x": sessions, "k": leads})


def _campaign(engine, site_id, day, source, medium, campaign, path, sessions, leads=0):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ga4_campaign_daily (site_id, day, row_hash, source, medium, campaign, path, sessions, key_events) VALUES (:s, :d, :h, :o, :m, :c, :p, :x, :k)"), {"s": site_id, "d": day, "h": common.digest(source, medium, campaign, path), "o": source, "m": medium, "c": campaign, "p": path, "x": sessions, "k": leads})


def _download(engine, site_id, start, end, data, uploaded_days_ago=0):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO clarity_reports (site_id, kind, period_start, period_end, data, uploaded_at) VALUES (:s, 'ai', :a, :b, :d, UTC_TIMESTAMP(3) - INTERVAL :u DAY)"),
            {"s": site_id, "a": start, "b": end, "d": json.dumps(data), "u": uploaded_days_ago},
        )


def _scope(engine, site_id="all", compare=False):
    return service.Scope(engine, site_id, D1.isoformat(), D2.isoformat(), "2026-09-01" if compare else None, "2026-09-02" if compare else None)


# ---- which visits are AI -------------------------------------------------------------------------------------


def test_chatgpt_tagged_with_no_medium_counts_although_ga4_files_it_as_unassigned(engine, site):
    _ga4(engine, site, D1, "Unassigned", "chatgpt.com", "(not set)", 9, 1)
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 4)
    _ga4(engine, site, D1, "Organic Social", "perplexity.ai", "social", 2)
    answer = service.ai_search(_scope(engine))
    assert answer["sessions"] == 15
    assert {k: answer["sources"][0][k] for k in ("source", "sessions", "leads", "rate")} == {"source": "chatgpt.com", "sessions": 13, "leads": 1.0, "rate": None}


def test_ga4s_own_ai_channel_and_a_channel_rule_naming_one_count_too(engine, site):
    _ga4(engine, site, D1, "AI Assistant", "new-assistant.example", "referral", 5)
    _ga4(engine, site, D1, "Referral", "other-bot.example", "referral", 3)
    _ga4(engine, site, D1, "Referral", "blog.example", "referral", 50)
    assert service.ai_search(_scope(engine))["sessions"] == 5
    service.add_rule(engine, "channel", "other-bot.example/*", "AI assistants")
    assert service.ai_search(_scope(engine))["sessions"] == 8


def test_landing_pages_take_tagged_visits_once(engine, site):
    _referral(engine, site, D1, "chatgpt.com", "/visa/", 6, 1)
    _campaign(engine, site, D1, "chatgpt.com", "(not set)", "(not set)", "/visa", 4)  # utm_source only: not in the referral table
    _campaign(engine, site, D1, "chatgpt.com", "referral", "(not set)", "/visa/", 6)  # already in the referral table
    _campaign(engine, site, D1, "newsletter", "email", "nov", "/visa/", 99)
    pages = service.ai_search(_scope(engine))["pages"]
    assert pages == [{"host": "mine.example", "path": "/visa/", "sessions": 10, "leads": 1.0, "google": None, "type": "Other pages", "by": [{"source": "chatgpt.com", "sessions": 10}]}]


def test_landing_pages_say_their_page_type_their_assistants_and_their_google_clicks(engine, site):
    _referral(engine, site, D1, "chatgpt.com", "/blog/visa-guide/", 5, 1)
    _referral(engine, site, D1, "www.perplexity.ai", "/blog/visa-guide/", 2)
    _campaign(engine, site, D1, "chatgpt.com", "(not set)", "(not set)", "/blog/costs/", 3)
    _referral(engine, site, D2, "gemini.google.com", "/", 4)
    _gsc_page(engine, site, D1, "https://mine.example/blog/visa-guide", 40)
    _gsc_page(engine, site, D2, "https://mine.example/blog/visa-guide/?x=1", 2)  # the same page written another way
    _gsc_page(engine, site, D2, "https://mine.example/", 90)
    _gsc_page(engine, site, date(2026, 9, 30), "https://mine.example/", 500)  # not one of the period's days
    answer = service.ai_search(_scope(engine))
    assert answer["google_clicks_known"] is True
    by_path = {p["path"]: p for p in answer["pages"]}
    assert by_path["/blog/visa-guide/"]["google"] == 42 and by_path["/blog/costs/"]["google"] == 0 and by_path["/"]["google"] == 90
    assert by_path["/blog/visa-guide/"]["by"] == [{"source": "chatgpt.com", "sessions": 5}, {"source": "perplexity.ai", "sessions": 2}]
    assert by_path["/"]["type"] == "Home page" and by_path["/blog/costs/"]["type"] == "/blog/"
    types = answer["page_types"]
    assert [t["type"] for t in types] == ["/blog/", "Home page"]
    blog = types[0]
    assert blog["pages"] == 2 and blog["sessions"] == 10 and blog["share"] == round(10 / 14, 4) and blog["leads"] == 1.0
    assert blog["rate"] is None  # under 30 AI visits, like every AI lead rate
    assert blog["google"] == 42
    assert blog["by"] == [{"source": "chatgpt.com", "sessions": 8}, {"source": "perplexity.ai", "sessions": 2}]


def test_page_types_follow_the_conversions_screens_rules(engine, site):
    _referral(engine, site, D1, "chatgpt.com", "/visa-dubai/", 3)
    _referral(engine, site, D1, "chatgpt.com", "/visa-golden/", 2)
    service.add_rule(engine, "category", "/visa-*", "Visa pages")
    types = service.ai_search(_scope(engine))["page_types"]
    assert types[0]["type"] == "Visa pages" and types[0]["pages"] == 2 and types[0]["sessions"] == 5


def test_without_search_console_the_google_column_is_unknown_not_zero(engine, site):
    _referral(engine, site, D1, "chatgpt.com", "/visa/", 3)
    answer = service.ai_search(_scope(engine))
    assert answer["google_clicks_known"] is False and answer["pages"][0]["google"] is None and answer["page_types"][0]["google"] is None


def test_engaged_visits_per_assistant_with_their_change(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 10, engaged=8)
    _ga4(engine, site, D2, "Unassigned", "chatgpt.com", "(not set)", 10, engaged=6)
    _ga4(engine, site, D1, "Referral", "gemini.google.com", "referral", 2, engaged=2)
    _ga4(engine, site, date(2026, 9, 1), "Referral", "chatgpt.com", "referral", 10, engaged=5)
    answer = service.ai_search(_scope(engine, compare=True))
    chat, gemini = answer["sources"]
    assert chat["source"] == "chatgpt.com" and chat["engaged"] == 0.7 and chat["engaged_sessions"] == 14
    assert chat["before"] == 10 and chat["change"] == 100.0
    assert chat["engaged_before"] == 0.5 and chat["engaged_change"] == 20.0  # points
    assert gemini["engaged"] == 1.0 and gemini["before"] == 0 and gemini["change"] is None and gemini["engaged_change"] is None  # new
    assert answer["engaged"] == {"sessions": 16, "known": 22, "rate": round(16 / 22, 4)}


def test_days_read_before_engaged_sessions_existed_never_count_as_zero(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 10)  # NULL: read before the column
    _ga4(engine, site, D2, "Referral", "perplexity.ai", "referral", 4)
    _ga4(engine, site, D2, "Unassigned", "perplexity.ai", "(not set)", 4, engaged=3)
    chat, perplexity = service.ai_search(_scope(engine))["sources"]
    assert chat["engaged"] is None and chat["engaged_partial"] is False
    assert perplexity["engaged"] == 0.75 and perplexity["engaged_partial"] is True
    assert chat["before"] is None  # no comparison asked


def test_lead_rate_waits_for_30_visits_and_always_has_its_counts(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 12, 1)
    _ga4(engine, site, D1, "Organic Search", "google", "organic", 400, 8)
    answer = service.ai_search(_scope(engine))
    assert answer["rate"] == {"value": None, "visits": 12, "leads": 1.0, "needs": 30}
    assert answer["organic"]["value"] == 0.02
    _ga4(engine, site, D2, "Referral", "chatgpt.com", "referral", 18, 2)
    answer = service.ai_search(_scope(engine))
    assert answer["rate"]["value"] == 0.1 and answer["sources"][0]["rate"] == 0.1


def test_weekly_chart_has_gaps_for_weeks_with_no_data_and_counts_leads(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7, 2)
    weekly = service.ai_search(_scope(engine))["weekly"]
    assert len(weekly) == 8 and weekly[-1]["end"] == D1.isoformat()  # the period is cut back to GA4's last day
    assert weekly[-1]["sessions"] == 7 and weekly[-1]["leads"] == 2
    assert weekly[0]["sessions"] is None  # no GA4 day in it: a gap, not a zero


# ---- Copilot citations ---------------------------------------------------------------------------------------


def test_copilot_citations_are_set_against_copilot_and_bing_visits_only_on_the_files_days(engine, site):
    _download(engine, site, date(2026, 9, 1), date(2026, 9, 28), {"citations": 20, "share_of_authority": 18.0}, 30)
    _download(engine, site, D1, D2, {"citations": 26, "share_of_authority": 14.0, "pages": [{"url": "https://mine.example/visa/", "citations": 9}, {"url": "https://mine.example/cost", "citations": 1}]})
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 40)
    _referral(engine, site, D1, "chatgpt.com", "/visa/", 40)
    _referral(engine, site, D1, "copilot.microsoft.com", "/visa/", 2)
    _referral(engine, site, D1, "www.bing.com", "/visa/", 1)
    _referral(engine, site, date(2026, 9, 30), "copilot.microsoft.com", "/visa/", 50)  # not one of the file's days
    copilot = service.ai_search(_scope(engine))["copilot"]
    s = copilot["sites"][0]
    assert copilot["citations"] == 26 and copilot["share"] == 14.0
    assert s["before"]["citations"] == 20 and s["before"]["share"] == 18.0
    assert s["pages"][0] == {"url": "https://mine.example/visa/", "path": "/visa/", "citations": 9, "visits": 3}
    assert s["pages"][1]["visits"] == 0 and s["queries"] is None


def test_one_page_written_two_ways_in_the_download_is_one_row(engine, site):
    _download(engine, site, D1, D2, {"citations": 5, "pages": [{"url": "https://mine.example/a", "citations": 3}, {"url": "https://mine.example/a/?ref=x", "citations": 2}]})
    pages = service.ai_search(_scope(engine))["copilot"]["sites"][0]["pages"]
    assert [(p["path"], p["citations"]) for p in pages] == [("/a/", 5)]


def test_copilot_visits_are_unknown_when_ga4_has_none_of_the_files_days(engine, site):
    _download(engine, site, date(2026, 6, 1), date(2026, 6, 28), {"citations": 3, "pages": [{"url": "https://mine.example/a/", "citations": 3}]})
    s = service.ai_search(_scope(engine))["copilot"]["sites"][0]
    assert s["pages"][0]["visits"] is None and s["copilot_visits"] is None


def test_questions_find_the_page_google_already_shows_for_them(engine, site):
    with engine.begin() as conn:
        for query, page, clicks in (("company setup cost dubai", "https://mine.example/cost/", 9), ("company setup cost dubai", "https://mine.example/", 1), ("visa price", "https://mine.example/visa/", 4)):
            conn.execute(
                text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :p, :c, 100, 5)"),
                {"s": site, "d": D1, "h": common.digest(query, page), "q": query, "p": page, "c": clicks},
            )
    _download(engine, site, D1, D2, {"citations": 4, "queries": [
        {"query": "Company setup cost Dubai", "citations": 2, "share": 9.0},
        {"query": "how much does a company setup cost in dubai", "citations": 1, "share": 30.0},
        {"query": "best beach in spain", "citations": 1, "share": 5.0},
    ]})
    queries = service.ai_search(_scope(engine))["copilot"]["sites"][0]["queries"]
    assert queries[0]["page"] == {"url": "https://mine.example/cost/", "path": "/cost/", "query": "company setup cost dubai", "match": "exact"}
    assert queries[1]["page"]["path"] == "/cost/" and queries[1]["page"]["match"] == "close"
    assert queries[2]["page"] is None


def test_match_page_needs_real_shared_words():
    candidates = [{"query": "visa dubai price", "page": "/visa/", "clicks": 3, "impressions": 30}]
    assert ai_search.match_page("Visa Dubai price", candidates)["match"] == "exact"
    assert ai_search.match_page("what is the price of a dubai visa", candidates)["page"] == "/visa/"
    assert ai_search.match_page("the price of the moon", candidates) is None
    assert ai_search.match_page("", candidates) is None


# ---- Clarity live, beside GA4 ----------------------------------------------------------------------------------


def test_clarity_live_is_a_second_opinion_on_the_days_both_have_and_never_added(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7)
    _ga4(engine, site, D2, "Referral", "chatgpt.com", "referral", 5)
    with engine.begin() as conn:
        for day, refs in ((D2, [{"source": "chatgpt.com", "sessions": 8}, {"source": "google.com", "sessions": 90}]), (D2 + timedelta(days=5), [{"source": "chatgpt.com", "sessions": 40}])):
            conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions, referrers) VALUES (:s, :d, 100, :r)"), {"s": site, "d": day, "r": json.dumps(refs)})
    answer = service.ai_search(_scope(engine))
    # The read on 2 Oct covers 1 Oct, which GA4 has. The read 5 days later is outside the period.
    assert answer["second_opinion"] == {"days": 1, "clarity": 8, "ga4": 7, "last_read": D2.isoformat()}
    assert answer["sessions"] == 12


def test_clarity_has_its_own_weeks_with_gaps_and_days_read_and_never_touches_ga4(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7)
    with engine.begin() as conn:
        for day, refs in ((D2, [{"source": "chatgpt.com", "sessions": 8}, {"source": "google.com", "sessions": 90}]), (D1, [{"source": "perplexity.ai", "sessions": 2}])):
            conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions, referrers) VALUES (:s, :d, 100, :r)"), {"s": site, "d": day, "r": json.dumps(refs)})
    answer = service.ai_search(_scope(engine))
    weeks = answer["clarity_weekly"]
    assert [(w["start"], w["end"]) for w in weeks] == [(w["start"], w["end"]) for w in answer["weekly"]]  # the two charts share their weeks
    assert weeks[-1]["sessions"] == 10 and weeks[-1]["days"] == 2  # the read on D covers D-1; google.com isn't AI
    assert weeks[0]["sessions"] is None and weeks[0]["days"] == 0  # no read that week: a gap, not a zero
    assert answer["weekly"][-1]["sessions"] == 7  # GA4's own count, with nothing from Clarity in it


def test_no_clarity_reads_leaves_every_clarity_week_a_gap(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7)
    assert all(w["sessions"] is None and w["days"] == 0 for w in service.ai_search(_scope(engine))["clarity_weekly"])


def test_no_clarity_live_reads_gives_no_second_opinion(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7)
    assert service.ai_search(_scope(engine))["second_opinion"] is None


# ---- freshness -------------------------------------------------------------------------------------------------


def _states(engine):
    return {s["id"]: s for s in service.ai_search(_scope(engine))["source_states"]}


def test_ga4_goes_amber_when_more_than_two_days_behind_and_red_when_failing(engine, site):
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET data_through = UTC_DATE() - INTERVAL 2 DAY WHERE source = 'ga4'"))
    assert _states(engine)["ga4"]["state"] == "ok"
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET data_through = UTC_DATE() - INTERVAL 3 DAY WHERE source = 'ga4'"))
    assert _states(engine)["ga4"]["state"] == "old"
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_error = 'The Data API is off.', last_ok_at = UTC_TIMESTAMP(3) - INTERVAL 4 DAY, last_attempt_at = UTC_TIMESTAMP(3) WHERE source = 'ga4'"))
    ga4 = _states(engine)["ga4"]["sites"][0]
    assert ga4["state"] == "failing" and ga4["error"] == "The Data API is off." and ga4["last_ok_at"] and ga4["last_attempt_at"]


def test_ga4_is_retrying_once_a_passing_test_queued_a_read(engine, site):
    from seo.collectors import jobs

    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET data_through = UTC_DATE() - INTERVAL 1 DAY, last_ok_at = UTC_TIMESTAMP(3) - INTERVAL 3 DAY, last_attempt_at = NULL, last_error = NULL WHERE source = 'ga4'"))
    jobs.enqueue_one(engine, site, "ga4")
    assert _states(engine)["ga4"]["state"] == "retrying"


def test_clarity_live_goes_amber_after_48_hours_and_says_when_its_data_is_lost(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source, secret, last_ok_at, last_attempt_at) VALUES (:s, 'clarity', 'x', UTC_TIMESTAMP(3) - INTERVAL 47 HOUR, UTC_TIMESTAMP(3) - INTERVAL 47 HOUR)"), {"s": site})
    assert _states(engine)["clarity_live"]["state"] == "ok"
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_ok_at = UTC_TIMESTAMP(3) - INTERVAL 52 HOUR WHERE source = 'clarity'"))
    live = _states(engine)["clarity_live"]["sites"][0]
    assert live["state"] == "old" and live["lost_in_hours"] == 20


def test_a_clarity_download_goes_amber_14_days_after_its_period(engine, site):
    with engine.connect() as conn:
        today = conn.execute(text("SELECT UTC_DATE()")).scalar()
    _download(engine, site, today - timedelta(days=40), today - timedelta(days=14), {"citations": 1})
    assert _states(engine)["clarity_download"]["state"] == "ok"
    with engine.begin() as conn:
        conn.execute(text("UPDATE clarity_reports SET period_end = :d"), {"d": today - timedelta(days=15)})
    assert _states(engine)["clarity_download"]["state"] == "old"


def test_sources_not_set_up_say_so_and_the_rest_still_answer(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 7)
    states = _states(engine)
    assert states["clarity_live"]["state"] == "not_connected"
    assert states["clarity_download"]["state"] == "not_set_up"
    assert states["serp"]["state"] == "not_set_up"
    assert service.ai_search(_scope(engine))["sessions"] == 7


def test_on_all_sites_a_site_without_ga4_doesnt_hide_the_ones_with_it(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')"))
        conn.execute(text("UPDATE site_sources SET data_through = UTC_DATE() - INTERVAL 1 DAY WHERE source = 'ga4'"))
    ga4 = _states(engine)["ga4"]
    assert ga4["state"] == "ok" and {s["state"] for s in ga4["sites"]} == {"ok", "not_connected"}
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_error = 'Off.' WHERE source = 'ga4'"))
    assert _states(engine)["ga4"]["state"] == "failing"  # but a failing one always shows


# ---- next actions ----------------------------------------------------------------------------------------------

NO_AIO = {"rivals_only": []}
NO_COPILOT = {"sites": []}


def test_a_page_with_ten_ai_visits_and_no_lead_needs_a_cta_but_only_if_leads_are_tracked():
    pages = [{"host": "mine.example", "path": "/visa/", "sessions": 14, "leads": 0}, {"host": "mine.example", "path": "/small/", "sessions": 9, "leads": 0}, {"host": "mine.example", "path": "/ok/", "sessions": 30, "leads": 2}]
    actions, total = ai_search.next_actions(pages, True, NO_COPILOT, NO_AIO)
    assert [(a["kind"], a["path"]) for a in actions] == [("cta", "/visa/")] and total == 1
    assert actions[0]["key"] == "ai|cta|mine.example|/visa/"
    assert ai_search.next_actions(pages, False, NO_COPILOT, NO_AIO) == ([], 0)


def test_faq_for_questions_under_20_percent_share_lowest_first():
    copilot = {"sites": [{"host": "mine.example", "pages": [], "queries": [
        {"query": "visa cost", "citations": 3, "share": 12.0, "page": None},
        {"query": "setup cost", "citations": 5, "share": 9.0, "page": {"path": "/cost/"}},
        {"query": "won already", "citations": 9, "share": 45.0, "page": None},
    ]}]}
    actions, total = ai_search.next_actions([], True, copilot, NO_AIO)
    assert [a["query"] for a in actions] == ["setup cost", "visa cost"] and total == 2


def test_compare_when_a_rival_is_cited_in_an_ai_overview_and_i_am_not():
    aio = {"rivals_only": [{"site_id": 1, "host": "mine.example", "keyword": "Visa Dubai", "keyword_id": 7, "rivals": ["rival.example"]}]}
    actions, _ = ai_search.next_actions([], True, NO_COPILOT, aio)
    # keyword_id: the keyword on screen opens that keyword's panel (keyword-links.js)
    assert actions == [{"kind": "compare", "host": "mine.example", "site_id": 1, "keyword": "Visa Dubai", "keyword_id": 7, "rivals": ["rival.example"], "key": "ai|aio|mine.example|visa dubai", "rank": 1}]


def test_a_page_copilot_cites_often_but_sends_no_visit_needs_a_reason_to_click():
    copilot = {"sites": [{"host": "mine.example", "queries": None, "pages": [
        {"url": "https://mine.example/a/", "path": "/a/", "citations": 6, "visits": 0},
        {"url": "https://mine.example/b/", "path": "/b/", "citations": 6, "visits": None},  # GA4 doesn't know: not a "no"
        {"url": "https://mine.example/c/", "path": "/c/", "citations": 4, "visits": 0},
    ]}]}
    actions, _ = ai_search.next_actions([], True, copilot, NO_AIO)
    assert [a["path"] for a in actions] == ["/a/"]


def test_at_most_three_one_of_each_kind_first():
    pages = [{"host": "m", "path": f"/p{n}/", "sessions": 20 - n, "leads": 0} for n in range(5)]
    copilot = {"sites": [{"host": "m", "pages": [], "queries": [{"query": "q", "citations": 1, "share": 5.0, "page": None}]}]}
    aio = {"rivals_only": [{"site_id": 1, "host": "m", "keyword": "k", "rivals": ["r.example"]}]}
    actions, total = ai_search.next_actions(pages, True, copilot, aio)
    assert [a["kind"] for a in actions] == ["cta", "faq", "compare"] and total == 7
    assert [a["rank"] for a in actions] == [1, 2, 3]
    only_pages, _ = ai_search.next_actions(pages, True, NO_COPILOT, NO_AIO)
    assert [a["path"] for a in only_pages] == ["/p0/", "/p1/", "/p2/"]


def test_the_reply_carries_next_actions(engine, site):
    _ga4(engine, site, D1, "Referral", "chatgpt.com", "referral", 14, 1)  # key events are set up
    _referral(engine, site, D1, "chatgpt.com", "/visa/", 14)
    answer = service.ai_search(_scope(engine))
    assert answer["next_actions"][0]["kind"] == "cta" and answer["next_action_count"] == 1


# ---- Refresh this one ------------------------------------------------------------------------------------------


def test_refresh_can_read_just_one_source(engine, site):
    app = create_app(engine=engine, auth=False)
    client = app.test_client()
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_attempt_at = NULL"))
    answer = client.post(f"/api/sites/{site}/collect", json={"sources": ["ga4"]}).get_json()
    assert [e["source"] for e in answer["jobs"]] == ["ga4"]
    assert client.post(f"/api/sites/{site}/collect", json={"sources": ["nope"]}).status_code == 400
    assert {e["source"] for e in client.post(f"/api/sites/{site}/collect", json={}).get_json()["jobs"]} >= {"gsc"}


# ---- the screen's own helpers (node) -----------------------------------------------------------------------------


def _node(ask: dict):
    done = subprocess.run(["node", str(ROOT / "tests" / "js" / "ai_search.cjs")], input=json.dumps(ask), capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def test_five_or_more_rows_of_one_fold_into_one_line():
    rows = [{"v": 1}] * 6 + [{"v": 4}, {"v": 2}]
    assert _node({"ask": "fold", "rows": rows, "min": 5}) == {"kept": 2, "folded": 6, "all": False}
    assert _node({"ask": "fold", "rows": [{"v": 1}] * 4 + [{"v": 3}], "min": 5}) == {"kept": 5, "folded": 0, "all": False}
    assert _node({"ask": "fold", "rows": [{"v": 1}] * 7, "min": 5}) == {"kept": 0, "folded": 7, "all": True}


def test_the_donut_keeps_each_assistants_colour_and_folds_the_rest_into_other():
    rows = [{"source": "perplexity.ai", "sessions": 50}, {"source": "new-bot.example", "sessions": 20}, {"source": "chatgpt.com", "sessions": 15},
            {"source": "a.example", "sessions": 6}, {"source": "b.example", "sessions": 5}, {"source": "c.example", "sessions": 3}, {"source": "d.example", "sessions": 1}]
    got = _node({"ask": "donut", "sources": rows, "max": 5})
    assert got["total"] == 100
    parts = got["parts"]
    assert [p["source"] for p in parts] == ["perplexity.ai", "new-bot.example", "chatgpt.com", "a.example", "b.example", None]
    assert parts[0]["color"] == "var(--ch-5)" and parts[2]["color"] == "var(--ch-1)"  # known assistants keep their colour whatever their rank
    assert len({p["color"] for p in parts}) == 6 and parts[-1]["color"] == "var(--ch-other)"
    assert parts[-1]["count"] == 2 and parts[-1]["sessions"] == 4 and abs(sum(p["share"] for p in parts) - 1) < 1e-9
    assert _node({"ask": "donut", "sources": [{"source": "chatgpt.com", "sessions": 0}], "max": 5}) == {"total": 0, "parts": []}


def test_every_word_on_the_ai_search_screen_has_its_french():
    assert _node({"ask": "french"}) == []
