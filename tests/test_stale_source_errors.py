"""An old "stopped working" goes once the source works again, and Refresh data can follow its reads to the end.

The owner saw "Google Analytics: stopped working" after turning the Data API on: only the next good pull cleared it, up to 20 h
later, and the screen looked once, 6 seconds after Refresh, before the worker had run.
"""
import httpx
from sqlalchemy import text

from seo.collectors import common, jobs
from seo.sources import service
from seo.web import create_app
from seo.worker.runner import tick
from tests.test_collectors import _ga4_answer, _google, key, world  # noqa: F401  (fixtures)

OFF = "Google Analytics Data API has not been used in project 4242 before or it is disabled."


def _broken(w, source="ga4", minutes_ago=5):
    with w.engine.begin() as conn:
        conn.execute(
            text("UPDATE site_sources SET last_error = :e, last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL :m MINUTE WHERE site_id = :s AND source = :c"),
            {"e": OFF, "m": minutes_ago, "s": w.site, "c": source},
        )


def _row(w, source="ga4"):
    with w.engine.connect() as conn:
        return conn.execute(text("SELECT last_error, last_attempt_at FROM site_sources WHERE site_id = :s AND source = :c"), {"s": w.site, "c": source}).one()


def _google_answers(w, data_api_ok=True):
    w.answers["webmasters/v3/sites"] = httpx.Response(200, json={"siteEntry": [{"siteUrl": "sc-domain:mine.example"}]})
    w.answers["accountSummaries"] = httpx.Response(200, json={"accountSummaries": [{"propertySummaries": [{"property": "properties/123456", "displayName": "Mine"}]}]})
    w.answers["runReport"] = httpx.Response(200, json={"rows": []}) if data_api_ok else httpx.Response(403, json={"error": {"message": OFF}})


def test_a_passing_test_clears_the_old_error_and_reads_again_now(world):
    connection = _google(world)
    _broken(world)
    _google_answers(world)
    answer = service.test_google(world.engine, connection["id"])
    assert answer["ga4"]["ok"] and answer["reading"] == 1
    assert _row(world) == (None, None)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT status FROM jobs WHERE active_key = :k"), {"k": f"collect|{world.site}|ga4"}).scalar() == "queued"


def test_a_failing_test_keeps_the_error(world):
    connection = _google(world)
    _broken(world)
    _google_answers(world, data_api_ok=False)
    answer = service.test_google(world.engine, connection["id"])
    assert answer["ga4"]["ok"] is False and answer["reading"] == 0
    assert _row(world)[0] == OFF


def test_search_console_working_doesnt_clear_a_ga4_error(world):
    connection = _google(world)
    _broken(world, "ga4")
    _google_answers(world, data_api_ok=False)
    service.test_google(world.engine, connection["id"])
    assert _row(world, "ga4")[0] == OFF


def test_a_failed_source_is_tried_again_after_an_hour_not_twenty(world):
    _google(world)
    _broken(world, minutes_ago=30)
    assert (world.site, "ga4") not in jobs.enqueue_due(world.engine)
    _broken(world, minutes_ago=61)
    assert (world.site, "ga4") in jobs.enqueue_due(world.engine)


def test_a_working_source_still_waits_its_usual_time(world):
    _google(world)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL 61 MINUTE WHERE site_id = :s AND source = 'ga4'"), {"s": world.site})
    assert (world.site, "ga4") not in jobs.enqueue_due(world.engine)


def test_a_finished_read_with_nothing_new_still_clears_the_error(world, monkeypatch):
    _google(world)
    _broken(world)
    monkeypatch.setattr(common, "pending_days", lambda *a, **k: [])
    jobs.enqueue_one(world.engine, world.site, "ga4")
    tick(world.engine, jobs.LANE, lock_dir=world.lock, db_wait_seconds=1)
    assert _row(world)[0] is None


def test_refresh_gives_each_read_its_job_even_one_already_running(world):
    _google(world)
    service.save_site_source(world.engine, world.site, "clarity", {"token": "tok-12345678"})
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE source = 'clarity'"))
    first = {e["source"]: e for e in jobs.collect_now_jobs(world.engine, world.site)}
    assert first["ga4"]["new"] and first["ga4"]["job_id"]
    assert first["clarity"] == {"source": "clarity", "job_id": None, "new": False, "skipped": "clarity_daily"}
    again = {e["source"]: e for e in jobs.collect_now_jobs(world.engine, world.site)}
    assert again["ga4"]["new"] is False and again["ga4"]["job_id"] == first["ga4"]["job_id"]
    assert jobs.collect_now(world.engine, world.site) == []  # the old answer, kept for the other callers


def test_job_states_say_when_a_read_is_over_and_why_it_failed(world):
    _google(world)
    world.answers["runReport"] = httpx.Response(403, json={"error": {"message": OFF}})
    job_id = jobs.enqueue_one(world.engine, world.site, "ga4")
    assert jobs.job_states(world.engine, [job_id]) == [{"id": job_id, "source": "ga4", "site_id": world.site, "status": "queued"}]
    tick(world.engine, jobs.LANE, lock_dir=world.lock, db_wait_seconds=1)
    [state] = jobs.job_states(world.engine, [job_id])
    assert state["status"] == "done" and "Data API" in state["error"]


def test_job_states_only_show_collector_jobs(world):
    from seo.worker import queue
    other = queue.enqueue(world.engine, "scans", "scan", {"site_id": world.site})
    assert jobs.job_states(world.engine, [other]) == []


def test_the_route_refuses_anything_but_job_numbers(engine):
    client = create_app(engine=engine, auth=False).test_client()
    assert client.get("/api/collect-jobs?ids=1,2").status_code == 200
    assert client.get("/api/collect-jobs?ids=1;DROP").status_code == 400
    assert client.get("/api/collect-jobs?ids=" + ",".join(["1"] * 101)).status_code == 400
    assert client.get("/api/collect-jobs").get_json() == {"jobs": []}
