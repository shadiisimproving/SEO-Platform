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
