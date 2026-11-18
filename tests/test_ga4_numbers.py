"""Google Analytics numbers made true (SEO review 2026-11-17, accuracy/analytics.md W1-W3, W5, W6, W8-W11).

Every figure here is worked out by hand from the rows the test stores."""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors import common, ga4
from seo.metrics import ai_search, ga4_checks, leads, service, today as today_view
from tests.test_collectors import GA4_GROUPS, _ga4_answer, _google, key, world  # noqa: F401 - fixtures

END = date(2026, 11, 16)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('T', 'robot', 'x', 'y')"))
        for source, prop in (("gsc", "sc-domain:mine.example"), ("ga4", "1")):
            conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, :c, 1, :p, :d)"), {"s": site_id, "c": source, "p": prop, "d": END})
    return site_id


def _day(engine, site_id, day, sessions, key_events=0.0, channel="Organic Search", source="google", medium="organic", lead_visits=0, coverage=True):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events, leads) VALUES (:s, :d, :h, :c, :o, :m, :x, :x, :k, :l)"),
            {"s": site_id, "d": day, "h": common.digest(channel, source, medium), "c": channel, "o": source, "m": medium, "x": sessions, "k": key_events, "l": lead_visits},
        )
        if coverage:
            conn.execute(text("INSERT IGNORE INTO coverage (site_id, source, day, `rows`) VALUES (:s, 'ga4', :d, 1)"), {"s": site_id, "d": day})


def _scope(engine, site_id, start, end, cstart=None, cend=None):
    return service.Scope(engine, site_id, start.isoformat(), end.isoformat(), cstart.isoformat() if cstart else None, cend.isoformat() if cend else None)


# ---- the collector: hosts, key events by name, referrals (W1, W2, W3) ---------------------------------------


def test_a_referral_without_campaign_is_stored_and_another_sites_visits_are_left_out(world):
    _google(world)
    world.answers["runReport"] = _ga4_answer
    day = common.today(world.engine) - timedelta(days=1)
    ga4._one_day(world.engine, world.site, "t", "123456", day)
    with world.engine.connect() as conn:
        # W3: GA4 writes "(referral)" as the campaign of a plain referral; it used to drop every row.
        assert conn.execute(text("SELECT domain, path, sessions FROM ga4_referral_daily")).all() == [("blog.example", "/a/", 4)]
        # W2: 9 + 41 + 4 + 3 = 57 visits on mine.example and www.mine.example; other-site.example's 20 stay out.
        assert conn.execute(text("SELECT SUM(sessions) FROM ga4_source_daily")).scalar() == 57
        assert conn.execute(text("SELECT SUM(sessions) FROM ga4_page_daily")).scalar() == 57
        assert conn.execute(text("SELECT COUNT(*) FROM ga4_campaign_daily WHERE path = '/other/'")).scalar() == 0
        assert sorted(conn.execute(text("SELECT host, own, sessions FROM ga4_host_daily")).all()) == [("mine.example", 1, 16), ("other-site.example", 0, 20), ("www.mine.example", 1, 41)]
        # W1: key events by name, own host only: generate_lead 2 + 1, page_view_booking 5.
        assert sorted(conn.execute(text("SELECT event_name, SUM(key_events), SUM(sessions) FROM ga4_key_event_daily WHERE report = 'source' GROUP BY event_hash")).all()) == [("generate_lead", 3.0, 3), ("page_view_booking", 5.0, 3)]
        assert conn.execute(text("SELECT SUM(key_events), SUM(leads) FROM ga4_source_daily")).one() == (8.0, 0.0)  # nothing ticked: no lead
        assert conn.execute(text("SELECT COUNT(*) FROM coverage WHERE source = :l"), {"l": ga4.LAYOUT}).scalar() == 1


def test_ticked_key_events_are_the_leads_on_every_table_and_past_days(world):
    _google(world)
    world.answers["runReport"] = _ga4_answer
    day = common.today(world.engine) - timedelta(days=1)
    ga4._one_day(world.engine, world.site, "t", "123456", day)
    listed = leads.events(world.engine, world.site)
    assert [(e["name"], e["key_events"], e["lead"]) for e in listed["events"]] == [("page_view_booking", 5, False), ("generate_lead", 3, False)]
    assert listed["kind"] == "key_events"
    leads.set_events(world.engine, world.site, ["generate_lead"])  # applied to the day already stored
    with world.engine.connect() as conn:
        # Organic /b/: 2 visits with a lead. Referral blog.example (7 visits): 1 with generate_lead; the bl-1 visits only had page_view_booking.
        assert dict(conn.execute(text("SELECT channel, leads FROM ga4_source_daily")).all()) == {"Organic Search": 2.0, "Referral": 1.0}
        assert dict(conn.execute(text("SELECT path, leads FROM ga4_page_daily")).all()) == {"/a/": 1.0, "/b/": 2.0}
        assert conn.execute(text("SELECT leads FROM ga4_referral_daily")).scalar() == 1.0
    answer = service.channels(_scope(world.engine, world.site, day, day))
    assert answer["lead_kind"] == "leads" and answer["total"] == {"sessions": 57, "leads": 3.0, "converted": 3.0}
    # A day read later gets its leads at once.
    ga4._one_day(world.engine, world.site, "t", "123456", day - timedelta(days=1))
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT SUM(leads) FROM ga4_source_daily WHERE day = :d"), {"d": day - timedelta(days=1)}).scalar() == 3.0
    leads.set_events(world.engine, world.site, [])
    assert service.channels(_scope(world.engine, world.site, day, day))["lead_kind"] == "key_events"


def test_old_days_are_read_again_newest_first_and_empty_ones_are_skipped(world):
    _google(world)
    world.answers["runReport"] = _ga4_answer
    newest = common.today(world.engine) - timedelta(days=1)
    with world.engine.begin() as conn:  # the old layout read every day; days older than 100 days were empty
        for n in range(ga4.HISTORY_DAYS + 1):
            conn.execute(text("INSERT INTO coverage (site_id, source, day, `rows`, saved_at) VALUES (:s, 'ga4', :d, :r, UTC_TIMESTAMP(3))"), {"s": world.site, "d": newest - timedelta(days=n), "r": 0 if n > 100 else 3})
    assert ga4.days_to_reread(world.engine, world.site) == 101
    assert ga4.collect(world.engine, world.site, budget_seconds=0) is False  # stopped at once: carries on next run
    ga4._skip_empty_days(world.engine, world.site, newest - timedelta(days=ga4.REREAD_DAYS))
    pending = common.pending_days(world.engine, world.site, ga4.LAYOUT, newest, newest - timedelta(days=ga4.HISTORY_DAYS), ga4.REREAD_DAYS)
    assert pending[0] == newest and len(pending) == 101  # the 101 days with data, newest first; the empty ones are done
    # A batch a run (code review 2026-11-18, #11): 4 recent days, then 30 old ones per run, until none is left.
    runs = 0
    while (done := ga4.collect(world.engine, world.site, budget_seconds=60)) == ga4.LATER:
        runs += 1
    assert done is True and runs == 3  # 97 old days: 30 + 30 + 30, and the last 7 in the fourth run
    assert ga4.days_to_reread(world.engine, world.site) == 0


def test_other_hosts_warn_when_they_are_a_tenth_of_the_visits(engine, site):
    with engine.begin() as conn:
        for host, own, visits in (("mine.example", 1, 255), ("creer-societe-dubai.fr", 0, 310)):
            conn.execute(text("INSERT INTO ga4_host_daily (site_id, day, host_hash, host, own, sessions) VALUES (:s, :d, :h, :n, :o, :x)"), {"s": site, "d": END, "h": common.digest(host), "n": host, "o": own, "x": visits})
    assert ga4_checks.other_hosts(engine, site) == [{"host": "creer-societe-dubai.fr", "sessions": 310, "share": round(310 / 565, 3)}]
    with engine.begin() as conn:
        conn.execute(text("UPDATE ga4_host_daily SET sessions = 20 WHERE own = 0"))
    assert ga4_checks.other_hosts(engine, site) == []  # 20 of 275 is under a tenth


def test_own_host_takes_www_and_subdomains():
    assert ga4.own_host("www.mine.example", "mine.example") and ga4.own_host("blog.mine.example", "www.mine.example") and ga4.own_host("(not set)", "mine.example")
    assert not ga4.own_host("creer-societe-dubai.fr", "comptabilite-dubai.com") and not ga4.own_host("notmine.example", "mine.example")


# ---- lead tracking changed (W1) --------------------------------------------------------------------------------


def _history(engine, site_id):
    """1 Jan - 30 Jun 2026, 100 visits a day: 5 key events a day, none from 19 Jan to 1 Mar, one per visit from 2 Mar to
    18 Jun, then 5 again."""
    day = date(2026, 1, 1)
    while day <= date(2026, 6, 30):
        if date(2026, 1, 19) <= day <= date(2026, 3, 1):
            events = 0
        elif date(2026, 3, 2) <= day <= date(2026, 6, 18):
            events = 100
        else:
            events = 5
        _day(engine, site_id, day, 100, events)
        day += timedelta(days=1)


def test_the_days_ga4_changed_how_it_counts_are_found(engine, site):
    _history(engine, site)
    changes = ga4_checks.tracking_changes(engine, site, "key_events")
    assert [(c["day"], c["kind"]) for c in changes] == [("2026-01-19", "stopped"), ("2026-03-02", "started"), ("2026-06-19", "fell")]


def test_a_leads_change_across_a_tracking_change_is_left_out(engine, site):
    _history(engine, site)
    # 28 days to 30 Jun against the 28 before: 19 Jun is inside, so no change, and the reason.
    answer = service.conversions(_scope(engine, site, date(2026, 6, 3), date(2026, 6, 30), date(2026, 5, 6), date(2026, 6, 2)))
    assert answer["before"]["leads"] is None and answer["changes"]["leads"] is None
    assert [c["day"] for c in answer["lead_check"]["changes"]] == ["2026-06-19"]
    assert answer["lead_kind"] == "key_events"
    # Two periods inside the one-per-visit stretch compare as usual: 2,800 against 2,800.
    calm = service.conversions(_scope(engine, site, date(2026, 4, 29), date(2026, 5, 26), date(2026, 4, 1), date(2026, 4, 28)))
    assert calm["before"]["leads"] == 2800 and calm["changes"]["leads"] == 0.0


# ---- rates never above 100%, "didn't become a lead" never below 0 (W8) -----------------------------------------


def test_lead_rate_is_visits_with_a_key_event_never_over_100_percent(engine, site):
    _day(engine, site, END, 2, 4, channel="Paid Other", source="google", medium="cpc")
    _day(engine, site, END, 100, 10)
    answer = service.conversions(_scope(engine, site, END, END))
    paid = next(r for r in answer["funnel"] if r["channel"] == "Paid Other")
    assert paid["leads"] == 4 and paid["rate"] == 1.0 and paid["lost"] == 0  # was 200% and -2
    assert answer["rate"] == round(12 / 102, 4)  # 2 + 10 visits with a key event, of 102
    rows = {r["channel"]: r for r in service.channels(_scope(engine, site, END, END))["channels"]}
    assert rows["Paid Other"]["rate"] == 1.0


# ---- too little data before (W6) ---------------------------------------------------------------------------------


def test_no_change_against_a_period_with_almost_no_data(engine, site):
    start = END - timedelta(days=27)
    for n in range(28):
        _day(engine, site, start + timedelta(days=n), 8 if n < 26 else 17)  # 242 visits
    _day(engine, site, start - timedelta(days=20), 1)  # one visit on one of the 28 days before
    row = today_view.today(engine, site, {"range": "28d"})["sites"][0]
    assert row["visits"] == 242 and row["visits_change"] is None and row["visits_note"] == "little_before"  # was +24,100%
    answer = service.channels(_scope(engine, site, start, END, start - timedelta(days=28), start - timedelta(days=1)))
    assert answer["little_before"] is True and answer["before"] is None


# ---- unusual days (W11) ----------------------------------------------------------------------------------------------


def test_a_burst_of_visits_is_marked_and_the_change_is_given_without_it(engine, site):
    # 1 May - 31 Aug: 10 visits a day, except 1-5 Aug at 1,000 a day.
    day = date(2026, 5, 1)
    while day <= date(2026, 8, 31):
        _day(engine, site, day, 1000 if date(2026, 8, 1) <= day <= date(2026, 8, 5) else 10)
        day += timedelta(days=1)
    found = ga4_checks.unusual_change(engine, [site], date(2026, 8, 1), date(2026, 8, 31), date(2026, 7, 1), date(2026, 7, 31))
    assert [(r["from"], r["to"], r["visits"], r["usual"]) for r in found["runs"]] == [("2026-08-01", "2026-08-05", 5000, 10)]
    # Without 1-5 Aug: 26 days x 10 = 260 against July's 310: -16.1%.
    assert found["visits"] == 260 and found["visits_before"] == 310 and found["change"] == -16.1
    answer = service.channels(_scope(engine, site, date(2026, 8, 1), date(2026, 8, 31), date(2026, 7, 1), date(2026, 7, 31)))
    assert answer["unusual"]["change"] == -16.1 and sorted(answer["unusual"]["days"]) == [f"2026-08-0{n}" for n in range(1, 6)]


# ---- Clarity's day (W10) -------------------------------------------------------------------------------------------


def test_the_clarity_card_reads_the_day_a_read_covers(engine, site):
    with engine.begin() as conn:
        for day, sessions in ((date(2026, 11, 1), 50), (date(2026, 11, 2), 7), (date(2026, 11, 3), 11)):
            conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions, rage_clicks, dead_clicks, scroll_depth) VALUES (:s, :d, :x, 0, 0, 40)"), {"s": site, "d": day, "x": sessions})
    # 1-2 Nov is the reads of 2 and 3 Nov: 7 + 11, through 2 Nov. It used to be 50 + 7.
    card = service.clarity(_scope(engine, site, date(2026, 11, 1), date(2026, 11, 2)))
    assert card["sessions"] == 18 and card["through"] == "2026-11-02"


# ---- Copilot and Bing, the AI list (W5, W9) ------------------------------------------------------------------------


def _campaign(engine, site_id, day, source, medium, campaign, path, sessions):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_campaign_daily (site_id, day, row_hash, source, medium, campaign, path, sessions, key_events) VALUES (:s, :d, :h, :a, :m, :c, :p, :x, 0)"),
            {"s": site_id, "d": day, "h": common.digest(source, medium, campaign, path), "a": source, "m": medium, "c": campaign, "p": path, "x": sessions},
        )


def test_copilot_card_shows_bing_search_apart_from_copilot(engine, site):
    _day(engine, site, date(2026, 10, 1), 50)
    _campaign(engine, site, date(2026, 10, 1), "bing", "organic", "(organic)", "/comment-creer/", 8)
    _campaign(engine, site, date(2026, 10, 2), "copilot.com", "(not set)", "(not set)", "/comment-creer/", 3)
    found = ai_search._copilot_visits(_scope(engine, site, date(2026, 10, 1), date(2026, 10, 31)), site, date(2026, 10, 1), date(2026, 10, 31))
    assert found == {"copilot": {"/comment-creer/": 3}, "bing": {"/comment-creer/": 8}}  # were 0 and 0


def test_perplexity_and_copilot_com_count_as_ai():
    domains = set(service.DEFAULT_AI_DOMAINS)
    assert service._is_ai("perplexity", domains) and service._is_ai("copilot.com", domains) and service._is_ai("gemini", domains)
