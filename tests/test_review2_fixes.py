"""Code review round 2 of fix-all-2026-11-17 (2026-11-18): each finding with a known answer worked out by hand.

Made-up sites only (the product is for other accounts too).
"""
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, ga4, http
from seo.metrics import ga4_checks, leads, service
from tests.test_collectors import _google, key, world  # noqa: F401 - fixtures
from tests.test_ga4_numbers import _day, _scope, site  # noqa: F401 - fixtures

END = date(2026, 11, 16)
ORGANIC = {"channel": "Organic Search", "source": "google", "medium": "organic", "manual_source": "google", "manual_medium": "organic", "campaign": "(organic)", "page": "/contact/", "host": "mine.example"}


def _answer(groups):
    from tests import ga4_fake

    return lambda request: ga4_fake.answer(request, groups)


def _stored_leads(engine, site_id, day=None):
    with engine.connect() as conn:
        where = "AND day = :d" if day else ""
        return {table: conn.execute(text(f"SELECT SUM(leads) FROM {table} WHERE site_id = :s {where}"), {"s": site_id, "d": day}).scalar()
                for table in ("ga4_source_daily", "ga4_page_daily")}


# ---- 1: a visit with two ticked lead events is one lead ---------------------------------------------------------------


def test_three_enquiries_firing_form_submit_and_generate_lead_are_three_leads(world):
    _google(world)
    # 10 visits; 3 of them sent the form, and each of those 3 fired both form_submit and generate_lead.
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 10, "users": 10, "events": {"form_submit": (3, 3), "generate_lead": (3, 3)},
                                           "visits_with": [{"form_submit", "generate_lead"}] * 3}])
    day = common.today(world.engine) - timedelta(days=1)
    leads.set_events(world.engine, world.site, ["form_submit", "generate_lead"])
    ga4._one_day(world.engine, world.site, "t", "123456", day)
    assert _stored_leads(world.engine, world.site) == {"ga4_source_daily": 3.0, "ga4_page_daily": 3.0}  # was 6
    # Ticked again, the day's stored "any ticked event" sessions give the same 3.
    leads.recompute(world.engine, world.site)
    assert _stored_leads(world.engine, world.site)["ga4_source_daily"] == 3.0


def test_after_a_tick_change_a_day_counts_its_biggest_event_until_it_is_read_again(world):
    _google(world)
    # form_submit on 3 visits, generate_lead on 2, one visit had both: 4 visits with a lead.
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 10, "users": 10, "events": {"form_submit": (3, 3), "generate_lead": (2, 2)},
                                           "visits_with": [{"form_submit"}, {"form_submit"}, {"form_submit", "generate_lead"}, {"generate_lead"}]}])
    day = common.today(world.engine) - timedelta(days=1)
    ga4._one_day(world.engine, world.site, "t", "123456", day)  # read before any tick
    leads.set_events(world.engine, world.site, ["form_submit", "generate_lead"])
    assert _stored_leads(world.engine, world.site)["ga4_source_daily"] == 3.0  # the bigger event: never more than the truth (was 5)
    assert ga4.days_to_reread(world.engine, world.site) == 1  # that day's leads are read again
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE coverage SET saved_at = UTC_TIMESTAMP(3)"))
    assert ga4.collect(world.engine, world.site) is True  # (it also reads the window's other days, never read yet)
    assert _stored_leads(world.engine, world.site, day)["ga4_source_daily"] == 4.0
    assert ga4.days_to_reread(world.engine, world.site) == 0
    leads.set_events(world.engine, world.site, ["form_submit"])  # one tick: that event's own sessions, exact at once
    assert _stored_leads(world.engine, world.site, day)["ga4_source_daily"] == 3.0 and ga4.days_to_reread(world.engine, world.site) == 0


# ---- 5 and 11: the history read again reaches 0 and goes a batch a run ------------------------------------------------


def test_days_older_than_the_window_are_not_counted_as_left_to_read(world):
    _google(world)
    newest = common.today(world.engine) - timedelta(days=1)
    with world.engine.begin() as conn:  # 3 days inside the window, 10 older ones collect() never reads
        for n in list(range(3)) + list(range(ga4.HISTORY_DAYS + 1, ga4.HISTORY_DAYS + 11)):
            conn.execute(text("INSERT INTO coverage (site_id, source, day, `rows`, saved_at) VALUES (:s, 'ga4', :d, 3, UTC_TIMESTAMP(3))"), {"s": world.site, "d": newest - timedelta(days=n)})
    assert ga4.days_to_reread(world.engine, world.site) == 3  # was 13, and it never went below 10
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 5, "users": 5, "events": {}}])
    assert ga4.collect(world.engine, world.site) is True
    assert ga4.days_to_reread(world.engine, world.site) == 0


def test_the_history_is_read_again_a_batch_a_run_and_a_quota_stop_is_not_a_failure(world):
    from seo.collectors import jobs
    from seo.worker.runner import RunAgain

    _google(world)
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 5, "users": 5, "events": {}}])
    newest = common.today(world.engine) - timedelta(days=1)
    with world.engine.begin() as conn:
        for n in range(100):
            conn.execute(text("INSERT INTO coverage (site_id, source, day, `rows`, saved_at) VALUES (:s, 'ga4', :d, 3, UTC_TIMESTAMP(3))"), {"s": world.site, "d": newest - timedelta(days=n)})
    # The 4 recent days are always read; then 30 old ones, and the job waits an hour.
    assert ga4.collect(world.engine, world.site, budget_seconds=600) == ga4.LATER
    assert ga4.days_to_reread(world.engine, world.site) == 100 - ga4.REREAD_DAYS - ga4.BACKLOG_DAYS_PER_RUN
    job = type("Job", (), {"payload": {"site_id": world.site, "source": "ga4"}})()
    with pytest.raises(RunAgain) as again:
        jobs.run(job, world.engine)
    assert again.value.delay_seconds == ga4.BACKLOG_PAUSE_SECONDS  # was RunAgain(0), back to back
    # Google's quota runs out during the re-read: what was saved stays, the source isn't shown as failing.
    world.answers["runReport"] = httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED", "message": "Exhausted property tokens per hour."}})
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE coverage SET saved_at = UTC_TIMESTAMP(3)"))
    assert ga4.collect(world.engine, world.site) == ga4.LATER
    assert common.source_row(world.engine, world.site, "ga4")["last_error"] is None


# ---- 2: visits change without the unusual days, a day against a day ---------------------------------------------------


def test_a_steady_100_a_day_with_a_5_day_burst_is_no_change(engine, site):
    from seo.metrics import today as today_view

    start = END - timedelta(days=27)
    for n in range(-120, 28):  # 100 a day in both periods; 1,000 a day on the first 5 days of this one
        _day(engine, site, start + timedelta(days=n), 1000 if 0 <= n < 5 else 100)
    got = ga4_checks.unusual_change(engine, [site], start, END, start - timedelta(days=28), start - timedelta(days=1))
    assert (got["visits"], got["visits_before"]) == (2300, 2800)  # 23 kept days x 100, 28 x 100
    assert got["change"] == 0.0  # was -17.9%
    row = today_view.today(engine, site, {"range": "28d"})
    assert row["results"]["visits"]["unusual"]["change"] == 0


def test_a_normal_day_between_two_bursts_stays_in(engine, site):
    start = END - timedelta(days=27)
    for n in range(-120, 28):  # bursts on days 0 and 2 (one run: 2 days apart); day 1 is a normal 100
        _day(engine, site, start + timedelta(days=n), 1000 if n in (0, 2) else 100)
    got = ga4_checks.unusual_change(engine, [site], start, END, start - timedelta(days=28), start - timedelta(days=1))
    assert [(r["from"], r["to"], r["days"], r["visits"]) for r in got["runs"]] == [(start.isoformat(), (start + timedelta(days=2)).isoformat(), 2, 2000)]
    assert got["visits"] == 2600 and got["change"] == 0.0  # 26 kept days, day 1 among them (was 2,500 over 25)


# ---- 3: a row's panel gives the row's lead rate ------------------------------------------------------------------------


def test_the_channel_panel_rate_is_the_rows_and_its_sources_have_one(engine, site):
    d0 = END - timedelta(days=1)
    _day(engine, site, d0, 10, key_events=30.0)  # 30 key events in 10 visits: at most 10 visits with one
    _day(engine, site, END, 10, key_events=0.0)
    _day(engine, site, d0, 10, key_events=30.0, channel="Referral", source="blog.example", medium="referral")
    _day(engine, site, END, 10, key_events=0.0, channel="Referral", source="blog.example", medium="referral")
    rows = {c["channel"]: c for c in service.channels(_scope(engine, site, d0, END))["channels"]}
    assert rows["Organic Search"]["rate"] == 0.5  # 10 of 20 visits
    panel = service.channel_detail(_scope(engine, site, d0, END), "Organic Search")
    assert panel["totals"]["rate"] == 0.5  # was 1.0
    assert [s["rate"] for s in panel["sources"]] == [0.5] and [m["rate"] for m in panel["mediums"]] == [0.5]  # was 0.0
    referrer = service.referrer_detail(_scope(engine, site, d0, END), "blog.example")
    assert referrer["totals"]["rate"] == 0.5


def test_the_assistant_row_and_panel_give_the_same_rate(engine, site):
    from seo.metrics import ai_search

    d0 = END - timedelta(days=1)
    _day(engine, site, d0, 30, key_events=90.0, channel="Referral", source="chatgpt.com", medium="referral")
    _day(engine, site, END, 30, key_events=0.0, channel="Referral", source="chatgpt.com", medium="referral")
    row = next(r for r in ai_search.build(_scope(engine, site, d0, END))["sources"] if r["source"] == "chatgpt.com")
    panel = service.assistant_detail(_scope(engine, site, d0, END), "chatgpt.com")
    assert row["rate"] == panel["totals"]["rate"] == 0.5  # 30 of 60 visits; both said 1.0


# ---- 4: one lead rule per site on every screen -------------------------------------------------------------------------


def test_all_sites_count_the_same_leads_on_today_and_channels_when_only_one_site_picked(engine, site):
    from seo.metrics import today as today_view

    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, 'ga4', 1, '2', :d)"), {"s": other, "d": END})
    start = END - timedelta(days=27)
    for n in range(56):
        day = start - timedelta(days=28) + timedelta(days=n)
        _day(engine, site, day, 10, key_events=5.0, lead_visits=2)  # picked: 2 leads a day (5 key events)
        _day(engine, other, day, 10, key_events=4.0)  # not picked: its 4 key events a day
    leads.set_events(engine, site, ["generate_lead"])
    with engine.begin() as conn:  # set_events works leads out from stored events: put the day's 2 back
        conn.execute(text("UPDATE ga4_source_daily SET leads = 2 WHERE site_id = :s"), {"s": site})
    channels = service.channels(service.Scope(engine, "all", start.isoformat(), END.isoformat()))
    assert channels["lead_kind"] == "mixed" and channels["key_event_hosts"] == ["other.example"]
    assert channels["total"]["leads"] == 28 * (2 + 4)  # was 28 x 2: the other site counted no lead
    assert channels["total"]["converted"] == 28 * (2 + 4)
    shown = today_view.today(engine, None, {"range": "28d"})["results"]["leads"]
    assert shown["value"] == 28 * (2 + 4) and shown["kind"] == "mixed" and shown["key_event_hosts"] == ["other.example"]
    one = service.channels(_scope(engine, site, start, END))
    assert one["lead_kind"] == "leads" and one["total"]["leads"] == 56


def test_ticked_events_that_did_not_fire_say_no_leads_not_not_set_up(engine, site):
    from seo.metrics import ai_search

    _day(engine, site, END, 30, key_events=0.0, channel="Referral", source="chatgpt.com", medium="referral")
    assert ai_search.build(_scope(engine, site, END, END))["key_events_set_up"] is False
    leads.set_events(engine, site, ["generate_lead"])
    answer = ai_search.build(_scope(engine, site, END, END))
    assert answer["key_events_set_up"] is True and answer["leads"] == 0  # the screen says "No leads in this period"
    assert service.conversions(_scope(engine, site, END, END))["key_events_set_up"] is True
