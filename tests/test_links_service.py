"""The main rule, enforced on the server and again in the worker, plus history, Stop, budget and the weekly check.

Uses the real test database and worker. The websites are a fixture held in memory.
"""
import csv
import io

import httpx
import pytest
from sqlalchemy import text

from seo.core import budget
from seo.crawl.fetch import PoliteFetcher
from seo.links import service
from seo.web import create_app
from seo.worker.runner import tick

PAGES = {
    "shop.co.ae/robots.txt": "User-agent: *\nDisallow: /private\n",
    "shop.co.ae/": '<a href="/a">a</a><a href="/gone">g</a><a href="/old">o</a><a href="/away">w</a><a href="/private/x">p</a><a href="https://far.example/403">e</a>',
    "shop.co.ae/a": '<a href="/gone">g</a><a href="https://far.example/403">e</a><a href="https://far.example/formula">f</a>',
    "shop.co.ae/old": (301, "/old2"), "shop.co.ae/old2": (301, "/old3"), "shop.co.ae/old3": (301, "/a"),
    "shop.co.ae/away": (302, "https://other.co.ae/landing"),
    "other.co.ae/landing": '<a href="https://other.co.ae/deeper">d</a>',
    "far.example/403": 403,
    "far.example/formula": 404,
}


class Fixture:
    def __init__(self, pages):
        self.pages = pages
        self.requests = []
        self.on_request = None

    def __call__(self, request):
        self.requests.append(str(request.url))
        if self.on_request:
            self.on_request(str(request.url))
        if request.url.path == "/robots.txt":
            found = self.pages.get(f"{request.url.host}/robots.txt")
            return httpx.Response(200, text=found) if found else httpx.Response(404)
        page = self.pages.get(f"{request.url.host}{request.url.raw_path.decode()}")
        if page is None:
            return httpx.Response(404, text="nope")
        if isinstance(page, int):
            return httpx.Response(page, text="no")
        if isinstance(page, tuple):
            return httpx.Response(page[0], headers={"location": page[1]})
        return httpx.Response(200, html=page)


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    fixture = Fixture(PAGES)
    monkeypatch.setattr(service, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture)))
    app = create_app(engine=engine, url_allowed=lambda url: True, auth=False)

    class World:
        pass

    w = World()
    w.engine, w.fixture, w.client = engine, fixture, app.test_client()
    w.own = service.add_site(engine, "https://shop.co.ae/", "own", is_allowed=lambda url: True)["id"]
    w.rival = service.add_site(engine, "https://rival.example/", "competitor", is_allowed=lambda url: True)["id"]
    w.tick = lambda: tick(engine, "crawl", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)

    def count(table):
        with engine.connect() as conn:
            return conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()

    w.jobs = lambda: count("jobs")
    w.scans = lambda: count("link_scans")
    return w


# ---- telling my sites from competitors ----------------------------------------------------------

def test_a_site_has_an_explicit_kind(world):
    with world.engine.connect() as conn:
        kinds = dict(conn.execute(text("SELECT host, kind FROM sites")).all())
    assert kinds == {"shop.co.ae": "own", "rival.example": "competitor"}


def test_database_refuses_any_other_kind(world):
    with pytest.raises(Exception):
        with world.engine.begin() as conn:
            conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('x.example', 'https://x.example/', 'friend')"))


def test_dropdown_list_has_only_my_sites(world):
    sites = world.client.get("/api/links/sites").get_json()["sites"]
    assert [s["host"] for s in sites] == ["shop.co.ae"]


def test_adding_sites_through_the_api(world):
    made = world.client.post("/api/sites", json={"address": "blog.mine.example", "kind": "own"})
    assert made.status_code == 201
    assert made.get_json()["host"] == "blog.mine.example"
    assert made.get_json()["start_url"] == "https://blog.mine.example/"
    hosts = [s["host"] for s in world.client.get("/api/links/sites").get_json()["sites"]]
    assert "blog.mine.example" in hosts
    world.client.post("/api/sites", json={"address": "rival-two.example", "kind": "competitor"})
    assert "rival-two.example" not in [s["host"] for s in world.client.get("/api/links/sites").get_json()["sites"]]


def test_adding_my_own_site_starts_reading_its_pages_at_once(world):
    """Owner, 2026-11-09: "it should read them once added", not wait for the nightly run."""
    def reads(site_id):
        with world.engine.connect() as conn:
            job = conn.execute(text("SELECT 1 FROM jobs WHERE kind = 'competitors.crawl' AND payload LIKE :p"), {"p": f'%"competitor_id": {site_id}}}%'}).first()
            state = conn.execute(text("SELECT status FROM competitor_crawls WHERE competitor_id = :s"), {"s": site_id}).scalar()
        return job is not None, state

    mine = world.client.post("/api/sites", json={"address": "blog.mine.example", "kind": "own"}).get_json()["id"]
    assert reads(mine) == (True, "queued")
    rival = world.client.post("/api/sites", json={"address": "rival-two.example", "kind": "competitor"}).get_json()["id"]
    assert reads(rival) == (False, None)  # a competitor is read once a site of mine watches it, not on its own


@pytest.mark.parametrize("body", [{"address": "", "kind": "own"}, {"address": "not a site", "kind": "own"}, {"address": "x.example", "kind": "friend"}, {"address": "x.example"}, {}])
def test_bad_site_requests_are_refused(world, body):
    assert world.client.post("/api/sites", json=body).status_code == 400


def test_same_host_cannot_be_both(world):
    refused = world.client.post("/api/sites", json={"address": "https://rival.example/x", "kind": "own"})
    assert refused.status_code == 409
    assert "competitor" in refused.get_json()["error"]


def test_private_addresses_cannot_be_added(engine):
    client = create_app(engine=engine, auth=False).test_client()  # the real guard
    assert client.post("/api/sites", json={"address": "http://127.0.0.1/", "kind": "own"}).status_code == 400
    assert client.post("/api/sites", json={"address": "http://localhost:8000/", "kind": "own"}).status_code == 400


# ---- the scan API takes a site ID, and only for my sites ---------------------------------------------

def test_competitor_id_is_refused(world):
    refused = world.client.post("/api/links/scan", json={"site_id": world.rival})
    assert refused.status_code == 403
    assert world.jobs() == 0 and world.scans() == 0


def test_unknown_id_is_refused(world):
    assert world.client.post("/api/links/scan", json={"site_id": 999999}).status_code == 404
    assert world.jobs() == 0 and world.scans() == 0


@pytest.mark.parametrize("body", [
    {"url": "https://far.example/"},
    {"start_url": "https://far.example/"},
    {"site_id": "USE_OWN", "url": "https://far.example/"},
    {"site_id": "USE_OWN", "start_url": "https://far.example/"},
    {"site_id": "USE_OWN", "host": "far.example"},
    {"site_id": "https://far.example/"},
    {"site_id": True},
    {"site_id": None},
    {"site_id": [1]},
    {},
])
def test_a_hand_written_request_with_a_url_is_refused(world, body):
    body = {k: (world.own if v == "USE_OWN" else v) for k, v in body.items()}
    refused = world.client.post("/api/links/scan", json=body)
    assert refused.status_code == 400, refused.get_json()
    assert world.jobs() == 0 and world.scans() == 0


def test_a_url_in_the_query_string_is_refused(world):
    assert world.client.post(f"/api/links/scan?url=https://far.example/", json={"site_id": world.own}).status_code == 400
    assert world.jobs() == 0


def test_a_request_that_is_not_json_is_refused(world):
    assert world.client.post("/api/links/scan", data="site_id=1").status_code == 400
    assert world.jobs() == 0


@pytest.mark.parametrize("pages", [0, -1, 1, 2001, "many", True, 1.5])
def test_a_page_limit_is_refused(world, pages):
    assert world.client.post("/api/links/scan", json={"site_id": world.own, "max_pages": pages}).status_code == 400


def test_the_job_holds_no_address(world):
    world.client.post("/api/links/scan", json={"site_id": world.own})
    with world.engine.connect() as conn:
        payload = conn.execute(text("SELECT payload FROM jobs")).scalar()
    assert "http" not in str(payload)
    assert "shop" not in str(payload)


def test_second_scan_of_a_running_site_is_refused(world):
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 202
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 409


# ---- the worker checks again --------------------------------------------------------------------------

def test_worker_refuses_a_site_that_became_a_competitor(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE sites SET kind = 'competitor' WHERE id = :i"), {"i": world.own})
    world.tick()
    assert world.fixture.requests == []  # not one request
    scan = world.client.get(f"/api/links/scans/{scan_id}").get_json()["scan"]
    assert scan["status"] == "failed"
    assert "own" in scan["error"]


def test_worker_does_nothing_if_the_scan_was_deleted(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    with world.engine.begin() as conn:
        conn.execute(text("DELETE FROM link_scans WHERE id = :i"), {"i": scan_id})
    result = world.tick()
    assert result.failed == 0
    assert world.fixture.requests == []


def test_competitor_history_is_refused(world):
    assert world.client.get(f"/api/links/sites/{world.rival}/scans").status_code == 403
    assert world.client.patch(f"/api/links/sites/{world.rival}", json={"weekly": True}).status_code == 403


# ---- a whole scan ---------------------------------------------------------------------------------------

def run_scan(world, **options):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own, **options}).get_json()["scan_id"]
    world.tick()
    return world.client.get(f"/api/links/scans/{scan_id}").get_json()


def grouped(data):
    return {c: [i["target_url"] for i in data["issues"] if i["category"] == c] for c in ("broken", "unverified", "redirect", "slow")}


def test_full_scan_groups_and_scope(world):
    data = run_scan(world)
    scan, groups = data["scan"], grouped(data)
    assert scan["status"] == "complete"
    assert groups["broken"] == ["https://shop.co.ae/gone", "https://far.example/formula"]
    assert groups["unverified"] == ["https://far.example/403"]
    assert groups["redirect"] == ["https://shop.co.ae/old", "https://shop.co.ae/away"]
    assert data["counts"] == {"broken": 2, "unverified": 1, "redirect": 2, "slow": 0}
    assert scan["skipped_robots"] == 1
    assert scan["stopped_at_limit"] is False
    # Nothing on another site was read, and the off-site redirect target was not even asked for.
    assert not [u for u in world.fixture.requests if "other.co.ae" in u]
    assert not [u for u in world.fixture.requests if "/private" in u]


def test_bug6_reasons_hops_and_timings_are_stored(world):
    data = run_scan(world)
    by_target = {i["target_url"]: i for i in data["issues"]}
    chain = by_target["https://shop.co.ae/old"]
    assert chain["hops"] == 3
    assert chain["final_url"] == "https://shop.co.ae/a"
    assert "3" in chain["reason"]
    assert by_target["https://far.example/403"]["reason"] == "Blocked by site"
    assert by_target["https://far.example/403"]["status_code"] == 403
    assert "other.co.ae/landing" in by_target["https://shop.co.ae/away"]["reason"]
    # It survives a fresh read from the database.
    with world.engine.connect() as conn:
        stored = conn.execute(text("SELECT reason, hops FROM link_issues WHERE target_url = 'https://shop.co.ae/old'")).first()
    assert stored.hops == 3 and "3" in stored.reason


def test_target_lists_every_page_that_contains_it(world):
    data = run_scan(world)
    gone = next(i for i in data["issues"] if i["target_url"].endswith("/gone"))
    assert gone["pages"] == ["https://shop.co.ae/", "https://shop.co.ae/a"]
    assert len([u for u in world.fixture.requests if u.endswith("/gone")]) == 1


def test_a_scan_has_no_limit(world):
    scan = run_scan(world)["scan"]
    assert (scan["max_pages"], scan["stopped_at_limit"], scan["pages_not_read"]) == (None, False, 0)


def test_a_limit_written_on_a_scan_by_hand_is_obeyed_and_said(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET max_pages = 1 WHERE id = :i"), {"i": scan_id})
    world.tick()
    scan = world.client.get(f"/api/links/scans/{scan_id}").get_json()["scan"]
    assert scan["stopped_at_limit"] is True
    assert scan["pages_read"] == 1
    assert scan["pages_not_read"] > 0


def test_external_setting_is_honoured(world):
    data = run_scan(world, check_external=False)
    assert not [u for u in world.fixture.requests if "far.example" in u]
    assert data["scan"]["external_not_checked"] == 2


def test_a_job_run_twice_does_not_double_the_issues(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    job = type("J", (), {"payload": {"scan_id": scan_id}})
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET status = 'running' WHERE id = :i"), {"i": scan_id})
    service.run_scan_job(job, world.engine)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET status = 'running' WHERE id = :i"), {"i": scan_id})
    service.run_scan_job(job, world.engine)
    data = world.client.get(f"/api/links/scans/{scan_id}").get_json()
    assert data["counts"]["broken"] == 2


# ---- stop -----------------------------------------------------------------------------------------------

def test_stop_before_it_starts(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
    assert world.client.get(f"/api/links/scans/{scan_id}").get_json()["scan"]["status"] == "stopped"
    world.tick()
    assert world.fixture.requests == []


def test_a_scan_can_be_started_again_right_after_stopping_it(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    world.client.post(f"/api/links/scans/{scan_id}/stop")
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 202


def test_stop_while_running_keeps_what_was_found_and_says_so(world, monkeypatch):
    monkeypatch.setattr(service, "STOP_POLL_SECONDS", 0)
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]

    def stop_after_home(url):
        if url.endswith("shop.co.ae/"):
            world.client.post(f"/api/links/scans/{scan_id}/stop")

    world.fixture.on_request = stop_after_home
    world.tick()
    scan = world.client.get(f"/api/links/scans/{scan_id}").get_json()["scan"]
    assert scan["status"] == "stopped"
    assert scan["stop_reason"] == "user"
    assert scan["pages_read"] == 1


def test_stop_on_a_finished_scan_changes_nothing(world):
    scan_id = run_scan(world)["scan"]["id"]
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 409
    assert world.client.get(f"/api/links/scans/{scan_id}").get_json()["scan"]["status"] == "complete"


# ---- the daily budget -------------------------------------------------------------------------------------

def test_requests_count_inside_the_daily_budget(world):
    run_scan(world)
    assert budget.used_today(world.engine) == len(world.fixture.requests)


def test_a_scan_pauses_when_the_budget_is_used_up(world):
    budget.charge(world.engine, budget.DAILY_CRAWL_REQUESTS)
    data = run_scan(world)
    assert data["scan"]["status"] == "running"
    assert data["scan"]["stop_reason"] is None
    assert data["scan"]["paused_until"]
    assert world.fixture.requests == []


# ---- history and export ---------------------------------------------------------------------------------------

def test_history_is_per_site_and_a_scan_can_be_reopened_or_deleted(world):
    other = service.add_site(world.engine, "https://mine-two.example/", "own", is_allowed=lambda url: True)["id"]
    first = run_scan(world)["scan"]["id"]
    second = run_scan(world)["scan"]["id"]
    listed = world.client.get(f"/api/links/sites/{world.own}/scans").get_json()["scans"]
    assert [s["id"] for s in listed] == [second, first]
    assert listed[0]["counts"]["broken"] == 2
    assert world.client.get(f"/api/links/sites/{other}/scans").get_json()["scans"] == []
    assert len(world.client.get(f"/api/links/scans/{first}").get_json()["issues"]) == 5
    assert world.client.delete(f"/api/links/scans/{first}").status_code == 200
    assert world.client.get(f"/api/links/scans/{first}").status_code == 404
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM link_issues WHERE scan_id = :i"), {"i": first}).scalar() == 0


def test_a_running_scan_cannot_be_deleted(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    assert world.client.delete(f"/api/links/scans/{scan_id}").status_code == 409


def test_csv_export_has_one_row_per_page(world):
    scan_id = run_scan(world)["scan"]["id"]
    reply = world.client.get(f"/api/links/scans/{scan_id}/export.csv")
    assert reply.status_code == 200
    assert "text/csv" in reply.headers["Content-Type"]
    assert "attachment" in reply.headers["Content-Disposition"]
    rows = list(csv.DictReader(io.StringIO(reply.get_data(as_text=True).lstrip("﻿"))))
    gone = [r for r in rows if r["Target URL"].endswith("/gone")]
    assert [r["Linking page"] for r in gone] == ["https://shop.co.ae/", "https://shop.co.ae/a"]
    assert gone[0]["Group"] == "Broken"
    assert gone[0]["Status code"] == "404"
    assert gone[0]["Reason"] == "Page not found"


def test_csv_export_cannot_carry_a_spreadsheet_formula(world):
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO link_scans (id, site_id, status, max_pages, check_external) VALUES (77, :s, 'complete', 10, 1)"), {"s": world.own})
        conn.execute(text("INSERT INTO link_issues (scan_id, category, target_url, reason, pages) VALUES (77, 'broken', '=HYPERLINK(1)', '+bad', '[\"@page\"]')"))
    text_out = world.client.get("/api/links/scans/77/export.csv").get_data(as_text=True)
    assert "'=HYPERLINK(1)" in text_out and "'+bad" in text_out and "'@page" in text_out


# ---- once a week ---------------------------------------------------------------------------------------------------

def age_scans(world, days):
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET created_at = UTC_TIMESTAMP(3) - INTERVAL :d DAY"), {"d": days})


def test_weekly_check_queues_my_site_once(world):
    assert service.enqueue_due(world.engine) == [world.own]
    assert service.enqueue_due(world.engine) == []  # already queued
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT trigger_kind FROM link_scans")).scalar() == "weekly"
    assert world.jobs() == 1


def test_weekly_check_never_queues_a_competitor(world):
    service.enqueue_due(world.engine)
    with world.engine.connect() as conn:
        sites = [r[0] for r in conn.execute(text("SELECT site_id FROM link_scans"))]
    assert world.rival not in sites


def test_weekly_check_waits_seven_days_after_a_finished_scan(world):
    service.enqueue_due(world.engine)
    world.tick()
    assert service.enqueue_due(world.engine) == []
    age_scans(world, 6)
    assert service.enqueue_due(world.engine) == []
    age_scans(world, 8)
    assert service.enqueue_due(world.engine) == [world.own]


def test_a_button_scan_counts_as_this_weeks_check(world):
    run_scan(world)
    assert service.enqueue_due(world.engine) == []


def test_a_stopped_or_failed_scan_does_not_count(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    world.client.post(f"/api/links/scans/{scan_id}/stop")
    world.tick()
    assert service.enqueue_due(world.engine) == [world.own]


def test_weekly_check_can_be_turned_off_per_site(world):
    reply = world.client.patch(f"/api/links/sites/{world.own}", json={"weekly": False})
    assert reply.status_code == 200
    assert reply.get_json()["weekly"] is False
    assert service.enqueue_due(world.engine) == []


def test_weekly_check_uses_the_saved_settings(world):
    world.client.patch(f"/api/links/sites/{world.own}", json={"check_external": False})
    service.enqueue_due(world.engine)
    world.tick()
    assert not [u for u in world.fixture.requests if "far.example" in u]
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT status FROM link_scans")).scalar() == "complete"


def test_site_list_says_when_the_next_check_is(world):
    site = world.client.get("/api/links/sites").get_json()["sites"][0]
    assert site["weekly"] is True and site["last_checked_at"] is None
    run_scan(world)
    site = world.client.get("/api/links/sites").get_json()["sites"][0]
    assert site["last_checked_at"] and site["next_check_at"] > site["last_checked_at"]


def test_command_line_runs_the_weekly_check(world, capsys, monkeypatch):
    from seo.worker import __main__ as cli

    monkeypatch.setattr(cli, "make_engine", lambda test=False: world.engine)
    assert cli.main(["links-due"]) == 0
    assert "1 site" in capsys.readouterr().out


# ---- a scan whose job died ---------------------------------------------------------------------

def abandon(world, status="running"):
    """A scan whose worker kept dying: the queue has given up on the job, and the scan is still marked as under way."""
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET status = 'dead', active_key = NULL"))
        conn.execute(text("UPDATE link_scans SET status = :st, created_at = created_at - INTERVAL 1 HOUR WHERE id = :i"), {"st": status, "i": scan_id})
    return scan_id


def scan_of(world, scan_id):
    return world.client.get(f"/api/links/scans/{scan_id}").get_json()["scan"]


@pytest.mark.parametrize("status", ["queued", "running"])
def test_a_scan_whose_job_is_gone_ends_and_says_why(world, status):
    scan = scan_of(world, abandon(world, status))
    assert scan["status"] == "failed"
    assert "worker stopped" in scan["error"] and scan["finished_at"]


def test_history_shows_a_scan_whose_job_is_gone_as_failed(world):
    stuck = abandon(world)
    scans = world.client.get(f"/api/links/sites/{world.own}/scans").get_json()["scans"]
    assert [(s["id"], s["status"]) for s in scans] == [(stuck, "failed")]


def test_the_run_button_works_after_a_scan_whose_job_is_gone(world):
    stuck = abandon(world)
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 202
    assert scan_of(world, stuck)["status"] == "failed"
    world.tick()
    assert world.client.get(f"/api/links/sites/{world.own}/scans").get_json()["scans"][0]["status"] == "complete"


def test_the_weekly_check_is_not_blocked_by_a_scan_whose_job_is_gone(world):
    abandon(world)
    assert service.enqueue_due(world.engine) == [world.own]


def test_stop_and_delete_work_on_a_scan_whose_job_is_gone(world):
    stuck = abandon(world)
    assert world.client.post(f"/api/links/scans/{stuck}/stop").status_code == 409  # it's already over
    assert scan_of(world, stuck)["status"] == "failed"
    assert world.client.delete(f"/api/links/scans/{stuck}").status_code == 200


def test_a_worker_dying_again_and_again_ends_the_scan(world):
    """The real path: each time the worker dies its job goes back in the queue, until the queue gives up."""
    from seo.worker import queue

    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET status = 'running', created_at = created_at - INTERVAL 1 HOUR WHERE id = :i"), {"i": scan_id})
    for _ in range(queue.MAX_LEASE_LOSSES):
        assert scan_of(world, scan_id)["status"] == "running"
        assert queue.claim(world.engine, "crawl", "doomed-worker")
        with world.engine.begin() as conn:
            conn.execute(text("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND"))
        queue.recover_expired(world.engine)
    assert scan_of(world, scan_id)["status"] == "failed"


def test_a_worker_gone_with_nothing_left_to_notice_ends_the_scan(world):
    """Cron has stopped too, so nothing marks the job dead. Its lease ran out long ago, and it must not spin for ever."""
    from seo.worker import queue

    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    assert queue.claim(world.engine, "crawl", "gone-worker")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET status = 'running', created_at = created_at - INTERVAL 1 HOUR WHERE id = :i"), {"i": scan_id})
        conn.execute(text("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 HOUR"))
    assert scan_of(world, scan_id)["status"] == "failed"
    # Its job is let go as well, so a new scan isn't refused because of it.
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 202


def test_a_scan_under_way_is_not_taken_for_dead(world):
    from seo.worker import queue

    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    assert queue.claim(world.engine, "crawl", "live-worker")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET status = 'running', created_at = created_at - INTERVAL 1 HOUR WHERE id = :i"), {"i": scan_id})
    assert scan_of(world, scan_id)["status"] == "running"
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 409


def test_a_lease_only_just_run_out_gets_time_for_its_worker_to_come_back(world):
    from seo.worker import queue

    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    assert queue.claim(world.engine, "crawl", "slow-worker")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET status = 'running', created_at = created_at - INTERVAL 1 HOUR WHERE id = :i"), {"i": scan_id})
        conn.execute(text("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 30 SECOND"))
    assert scan_of(world, scan_id)["status"] == "running"


def test_a_scan_waiting_for_the_worker_is_not_taken_for_dead(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_scans SET created_at = created_at - INTERVAL 1 HOUR WHERE id = :i"), {"i": scan_id})
    assert scan_of(world, scan_id)["status"] == "queued"  # its job is in the queue, so it can still run


def test_a_scan_just_started_is_not_taken_for_dead(world):
    scan_id = world.client.post("/api/links/scan", json={"site_id": world.own}).get_json()["scan_id"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET status = 'dead', active_key = NULL"))
    assert scan_of(world, scan_id)["status"] == "queued"  # it's written a moment before its job


def test_a_stopped_weekly_scan_does_not_start_again_within_the_week(world):
    """F106: only a complete scan used to count, so a stopped or failed weekly scan started again at the next hourly call."""
    assert service.enqueue_due(world.engine) == [world.own]
    with world.engine.connect() as conn:
        scan_id = conn.execute(text("SELECT id FROM link_scans")).scalar()
    world.client.post(f"/api/links/scans/{scan_id}/stop")
    world.tick()
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT status FROM link_scans")).scalar() == "stopped"
    assert service.enqueue_due(world.engine) == []
    age_scans(world, 8)
    assert service.enqueue_due(world.engine) == [world.own]


def test_a_failed_weekly_scan_does_not_start_again_within_the_week(world):
    service.enqueue_due(world.engine)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET status = 'dead', active_key = NULL"))
        conn.execute(text("UPDATE link_scans SET status = 'failed', finished_at = UTC_TIMESTAMP(3)"))
    assert service.enqueue_due(world.engine) == []
