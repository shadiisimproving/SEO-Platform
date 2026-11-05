"""Both scans always read the whole website, however long it takes: in short chunks, surviving kills, pausing for the daily budget.

Uses the real test database, queue and API. The websites are held in memory. A chunk here ends after a number of pages rather than
after 40 seconds, because the fake internet answers at once.
"""
import os
import signal
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from seo.core import budget
from seo.crawl.fetch import PoliteFetcher
from seo.health import audit, service as health
from seo.links import service as links
from seo.web import create_app
from seo.worker import queue, runner
from tests.kill_scan_worker import HOME, big_site, chunks_of, good

ROOT = Path(__file__).resolve().parent.parent
GONE = "/gone"
OUTSIDE = "https://far.example/gone"


class Site:
    """Answers instead of the network, and remembers what it was asked and when."""

    def __init__(self, pages):
        self.pages = pages
        self.robots = "User-agent: *\nDisallow: /private\n"
        self.requests = []
        self.times = []
        self.on_request = None

    def __call__(self, request):
        url = str(request.url)
        self.requests.append(url)
        self.times.append(time.monotonic())
        if self.on_request:
            self.on_request(url)
        if request.url.host != "shop.example":
            return httpx.Response(404 if url == OUTSIDE else 200, html="<a href='https://far.example/deeper'>x</a>")
        path = request.url.raw_path.decode()
        if path == "/robots.txt":
            if isinstance(self.robots, int):
                return httpx.Response(self.robots, text="no")
            return httpx.Response(200, text=self.robots, headers={"content-type": "text/plain"})
        answer = self.pages.get(path, 404)
        if isinstance(answer, int):
            return httpx.Response(answer, text="An error page")
        if isinstance(answer, tuple):
            return httpx.Response(answer[0], headers={"location": answer[1]})
        return httpx.Response(200, html=answer)

    def page_requests(self):
        return [u for u in self.requests if not u.endswith("/robots.txt")]


class World:
    def __init__(self, engine, site, client, lock_dir):
        self.engine, self.site, self.client, self.lock_dir = engine, site, client, lock_dir
        self.own = links.add_site(engine, HOME, "own", is_allowed=lambda url: True)["id"]

    # ---- the worker, one run of the job at a time ---------------------------------------------------
    def chunk(self) -> bool:
        """Runs the job once, the way the worker does. False if no job was due."""
        jobs = queue.claim(self.engine, "crawl", "test-worker")
        if not jobs:
            return False
        runner._run_one(self.engine, jobs[0], "test-worker", runner._registry, 180, 60)
        return True

    def to_the_end(self) -> int:
        chunks = 0
        while self.chunk():
            chunks += 1
            assert chunks < 5000
        return chunks

    def tick(self):
        return runner.tick(self.engine, "crawl", lock_dir=self.lock_dir, budget_seconds=20, db_wait_seconds=1)

    def killed_chunk(self, run, after_requests: int):
        """A chunk whose process is killed, with nothing said to the database. Its lease runs out and the job goes back in the queue."""
        job = queue.claim(self.engine, "crawl", "doomed")[0]
        asked = []

        class Killed(BaseException):
            pass

        def kill(url):
            asked.append(url)
            if len(asked) > after_requests:
                raise Killed()

        self.site.on_request = kill
        with pytest.raises(Killed):
            run(job, self.engine)
        self.site.on_request = None
        self.sql("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = :i", i=job.id)
        assert queue.recover_expired(self.engine) == {"requeued": 1, "dead": 0}
        return asked

    # ---- the database -----------------------------------------------------------------------------
    def sql(self, statement: str, **params) -> None:
        with self.engine.begin() as conn:
            conn.execute(text(statement), params)

    def value(self, statement: str, **params):
        with self.engine.connect() as conn:
            return conn.execute(text(statement), params).scalar()

    def job(self) -> dict:
        with self.engine.connect() as conn:
            rows = conn.execute(text("SELECT * FROM jobs")).mappings().all()
        assert len(rows) == 1
        return dict(rows[0])

    def saved(self) -> int:
        return self.value("SELECT COUNT(*) FROM crawl_states")

    def next_day(self) -> None:
        self.sql("UPDATE crawl_budget SET day = day - INTERVAL 1 DAY")
        self.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3) WHERE status = 'queued'")

    # ---- the API ----------------------------------------------------------------------------------
    def start_scan(self, **options) -> int:
        reply = self.client.post("/api/links/scan", json={"site_id": self.own, "check_external": False, **options})
        assert reply.status_code == 202, reply.get_json()
        return reply.get_json()["scan_id"]

    def scan(self, scan_id) -> dict:
        return self.scan_all(scan_id)["scan"]

    def scan_all(self, scan_id) -> dict:
        reply = self.client.get(f"/api/links/scans/{scan_id}")
        assert reply.status_code == 200
        return reply.get_json()

    def issue(self, scan_id, target_part) -> dict:
        found = [i for i in self.scan_all(scan_id)["issues"] if target_part in i["target_url"]]
        assert len(found) == 1, found
        return found[0]

    def start_test(self) -> int:
        reply = self.client.post("/api/health/audit", json={"site_id": self.own})
        assert reply.status_code == 202, reply.get_json()
        return reply.get_json()["audit_id"]

    def test_of(self, audit_id) -> dict:
        return self.test_all(audit_id)["audit"]

    def test_all(self, audit_id) -> dict:
        reply = self.client.get(f"/api/health/audits/{audit_id}")
        assert reply.status_code == 200
        return reply.get_json()

    def alerts(self) -> list[dict]:
        return self.client.get("/api/alerts").get_json()["alerts"]


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    site = Site(big_site(30))
    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(site)))
    monkeypatch.setattr(links, "time_up_factory", chunks_of(3))
    monkeypatch.setattr(health, "certificate_check", lambda host: 200)
    client = create_app(engine=engine, url_allowed=lambda url: True, auth=False).test_client()
    return World(engine, site, client, tmp_path)


def asked_once(world, pages=30):
    counted = Counter(world.site.page_requests())
    assert len(counted) == pages
    assert set(counted.values()) == {1}


def change(world, n, links_=(), pages=30, **changes):
    """Page n still links to the pages after it, so the crawl can still reach them all."""
    world.site.pages[f"/p{n}"] = good(f"Page {n}", links_=tuple(f"/p{m}" for m in (n * 2 + 1, n * 2 + 2) if m <= pages) + tuple(links_), **changes)


EARLY_AND_LATE = [HOME, f"{HOME}p29"]


def with_broken_links(world):
    """A broken page found early, and a broken link to another website, both on the first page read and on one read late."""
    world.site.pages["/"] = good("Page 0", links_=(GONE, OUTSIDE, "/p1", "/p2"))
    change(world, 29, (GONE, OUTSIDE))


# ---- the links checker reads the whole site across chunks -------------------------------------------

def test_a_site_far_bigger_than_one_chunk_is_read_to_the_end(world):
    with_broken_links(world)
    scan_id = world.start_scan()
    job_id = world.job()["id"]
    chunks = world.to_the_end()
    assert chunks >= 10  # 32 pages, 3 at a time
    scan = world.scan(scan_id)
    assert scan["status"] == "complete"
    assert scan["pages_read"] == 32
    assert scan["pages_not_read"] == 0
    assert Counter(world.site.page_requests()).most_common(1)[0][1] == 1  # every page read exactly once
    assert world.issue(scan_id, GONE)["pages"] == EARLY_AND_LATE
    job = world.job()
    assert (job["id"], job["status"], job["attempts"], job["lease_losses"], job["active_key"]) == (job_id, "done", 0, 0, None)


def test_every_page_is_in_the_results_exactly_as_in_one_long_run(world, monkeypatch):
    with_broken_links(world)
    scan_id = world.start_scan(check_external=True)
    assert world.to_the_end() >= 10
    in_chunks = world.scan_all(scan_id)
    assert in_chunks["scan"]["status"] == "complete"
    monkeypatch.setattr(links, "time_up_factory", lambda: lambda: False)
    other = world.start_scan(check_external=True)
    assert world.to_the_end() == 1
    in_one = world.scan_all(other)
    def what(data):
        return sorted((i["category"], i["target_url"], i["status_code"], i["reason"], tuple(i["pages"])) for i in data["issues"])
    assert what(in_chunks) == what(in_one)
    assert what(in_one)  # it did find something
    for field in ("pages_read", "links_checked", "skipped_robots", "too_large", "pages_not_read", "external_not_checked"):
        assert in_chunks["scan"][field] == in_one["scan"][field], field


def test_between_chunks_it_is_running_and_says_how_far_it_got(world):
    scan_id = world.start_scan()
    job_id = world.job()["id"]
    assert world.scan(scan_id)["status"] == "queued"
    world.chunk()
    scan = world.scan(scan_id)
    assert scan["status"] == "running"
    assert scan["pages_read"] == 3
    assert scan["pages_not_read"] == 4  # found, and not read yet: the bar shows read / (read + left)
    assert scan["finished_at"] is None and scan["stop_reason"] is None and scan["paused_until"] is None
    job = world.job()
    assert (job["id"], job["status"], job["active_key"], job["attempts"], job["lease_owner"]) == (job_id, "queued", f"links:{world.own}", 0, None)
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 409  # still under way


def test_progress_numbers_are_saved_during_a_chunk_not_only_at_its_end(world):
    scan_id = world.start_scan()
    seen = []

    def look(url):
        if not url.endswith("/robots.txt"):
            seen.append(tuple(world.value(f"SELECT {c} FROM link_scans WHERE id = :i", i=scan_id) for c in ("pages_read", "pages_not_read")))

    world.site.on_request = look
    world.chunk()
    assert seen[0] == (0, 0)
    assert seen[1] == (1, 2)


def test_when_it_started_is_not_changed_by_later_chunks(world):
    scan_id = world.start_scan()
    world.chunk()
    world.sql("UPDATE link_scans SET started_at = '2026-01-02 03:04:05.000' WHERE id = :i", i=scan_id)
    world.chunk()
    assert world.scan(scan_id)["started_at"] == "2026-01-02T03:04:05Z"


def test_requests_keep_counting_across_chunks(world):
    scan_id = world.start_scan()
    world.to_the_end()
    assert world.scan(scan_id)["requests_used"] == budget.used_today(world.engine) == len(world.site.requests)


def test_a_chunk_is_about_40_seconds_by_the_clock(monkeypatch):
    monkeypatch.undo()
    assert links.CHUNK_SECONDS == 40
    monkeypatch.setattr(links, "CHUNK_SECONDS", 0.05)
    time_up = links.time_up_factory()
    assert time_up() is False
    time.sleep(0.06)
    assert time_up() is True


def test_links_to_other_websites_are_checked_across_chunks_and_never_read(world):
    world.site.pages = {"/": good("Home", links_=tuple(f"https://far.example/{n}" for n in range(10)) + (OUTSIDE,))}
    scan_id = world.start_scan(check_external=True)
    world.chunk()
    scan = world.scan(scan_id)
    assert scan["external_left"] > 0
    assert scan["status"] == "running"
    world.to_the_end()
    scan = world.scan(scan_id)
    assert scan["status"] == "complete"
    assert (scan["links_checked"], scan["external_left"], scan["external_not_checked"]) == (12, 0, 0)
    counted = Counter(u for u in world.site.page_requests() if "far.example" in u)
    assert len(counted) == 11 and set(counted.values()) == {1}
    assert not [u for u in world.site.requests if "deeper" in u]
    assert world.issue(scan_id, "far.example/gone")["pages"] == [HOME]


def test_off_site_pages_are_never_read_across_chunks(world):
    change(world, 1, ("https://far.example/a",))
    change(world, 20, ("https://far.example/a", "/away"))
    world.site.pages["/away"] = (302, "https://far.example/landing")
    scan_id = world.start_scan(check_external=True)
    world.to_the_end()
    assert world.scan(scan_id)["status"] == "complete"
    asked = [u for u in world.site.requests if "far.example" in u]
    assert [u for u in asked if not u.endswith("/robots.txt")] == ["https://far.example/a"]
    assert world.issue(scan_id, "/away")["category"] == "redirect"


def test_the_setting_for_links_to_other_websites_holds_across_chunks(world):
    with_broken_links(world)
    scan_id = world.start_scan(check_external=False)
    world.to_the_end()
    assert not [u for u in world.site.requests if "far.example" in u]
    assert world.scan(scan_id)["external_not_checked"] == 1


# ---- no limit, for the button and the schedule ------------------------------------------------------

def above_the_old_limits(world, monkeypatch):
    world.site.pages = big_site(510)
    monkeypatch.setattr(links, "time_up_factory", lambda: lambda: False)


def test_the_button_reads_every_page_of_a_site_above_the_old_limit(world, monkeypatch):
    above_the_old_limits(world, monkeypatch)
    scan = world.scan(world.start_scan())
    assert scan["max_pages"] is None
    world.tick()
    scan = world.scan(scan["id"])
    assert (scan["status"], scan["pages_read"], scan["stopped_at_limit"], scan["max_pages"]) == ("complete", 511, False, None)


def test_the_weekly_check_reads_every_page_of_a_site_above_the_old_limit(world, monkeypatch):
    above_the_old_limits(world, monkeypatch)
    assert links.enqueue_due(world.engine) == [world.own]
    world.tick()
    assert world.value("SELECT pages_read FROM link_scans") == 511
    assert world.value("SELECT max_pages FROM link_scans") is None


def test_the_health_button_reads_every_page_of_a_site_above_the_old_limit(world, monkeypatch):
    above_the_old_limits(world, monkeypatch)
    audit_id = world.start_test()
    world.tick()
    result = world.test_of(audit_id)
    assert (result["status"], result["pages_read"], result["pages_seen"], result["stopped_at_limit"], result["max_pages"]) == ("complete", 511, 511, False, None)


def test_the_monthly_test_reads_every_page_of_a_site_above_the_old_limit(world, monkeypatch):
    above_the_old_limits(world, monkeypatch)
    assert health.enqueue_due(world.engine) == [world.own]
    world.tick()
    assert world.value("SELECT pages_read FROM health_audits") == 511
    assert world.value("SELECT max_pages FROM health_audits") is None


@pytest.mark.parametrize("path", ["links", "health"])
def test_a_page_limit_can_no_longer_be_saved(world, path):
    assert world.client.patch(f"/api/{path}/sites/{world.own}", json={"max_pages": 5}).status_code == 400
    site = next(s for s in world.client.get(f"/api/{path}/sites").get_json()["sites"] if s["id"] == world.own)
    assert site.get("max_pages") is None


def test_a_page_limit_can_no_longer_be_asked_for(world):
    assert world.client.post("/api/links/scan", json={"site_id": world.own, "max_pages": 5}).status_code == 400
    assert world.client.post("/api/health/audit", json={"site_id": world.own, "max_pages": 5}).status_code == 400


def test_the_site_list_no_longer_offers_limits(world):
    answer = world.client.get("/api/links/sites").get_json()
    assert "large_scan_pages" not in answer and "max_pages_limit" not in answer


# ---- a killed worker loses at most one chunk ---------------------------------------------------------

def test_a_kill_repeats_only_that_chunk(world):
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    world.chunk()
    before = set(world.site.page_requests())
    assert len(before) == 6
    lost = world.killed_chunk(links.run_scan_job, after_requests=2)  # robots.txt, a page, and it dies asking for the next
    lost_pages = [u for u in lost if not u.endswith("/robots.txt")]
    assert len(lost_pages) == 2
    assert world.scan(scan_id)["status"] == "running"
    world.to_the_end()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"]) == ("complete", 32)
    counted = Counter(world.site.page_requests())
    assert {u for u, n in counted.items() if n == 2} == set(lost_pages)
    assert max(counted.values()) == 2
    assert not before & set(lost_pages)  # nothing from the chunks that were saved is read again
    assert world.issue(scan_id, GONE)["pages"] == EARLY_AND_LATE  # no page listed twice
    assert world.value("SELECT COUNT(*) FROM link_issues WHERE scan_id = :i", i=scan_id) == 1
    # What was really sent, the lost chunk included, but for the one request it died waiting for.
    assert world.scan(scan_id)["requests_used"] == budget.used_today(world.engine) == len(world.site.requests) - 1


def test_a_kill_after_the_last_save_of_a_finished_scan_finishes_it_once(world):
    with_broken_links(world)
    scan_id = world.start_scan()
    world.to_the_end()
    # The worker died after writing the results, before telling the queue. Its job comes back to a finished scan.
    world.sql("UPDATE jobs SET status = 'queued', active_key = 'links:x', finished_at = NULL")
    asked = len(world.site.requests)
    world.chunk()
    assert len(world.site.requests) == asked
    assert world.value("SELECT COUNT(*) FROM link_issues WHERE scan_id = :i", i=scan_id) == 1


def test_a_worker_killed_for_real_loses_at_most_one_chunk(world, tmp_path):
    scan_id = world.start_scan()
    worker = subprocess.Popen([sys.executable, "-m", "tests.kill_scan_worker", str(tmp_path)], cwd=ROOT, env={**os.environ, "SEO_LOCK_DIR": str(tmp_path)})
    try:
        deadline = time.time() + 30
        while time.time() < deadline:
            if world.value("SELECT pages_read FROM link_scans WHERE id = :i", i=scan_id) >= 8 and world.saved():
                break
            assert worker.poll() is None
            time.sleep(0.01)
        else:
            raise AssertionError("the worker never got that far")
    finally:
        os.kill(worker.pid, signal.SIGKILL)
        worker.wait()
    assert world.scan(scan_id)["status"] == "running"
    time.sleep(2.2)  # let its 2 s lease run out, if it was in a chunk when it died, which nobody has told the database
    assert queue.recover_expired(world.engine)["dead"] == 0
    assert world.job()["status"] == "queued"
    world.to_the_end()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"], scan["pages_not_read"]) == ("complete", 31, 0)
    assert world.saved() == 0
    # Only what this process read is known here, and it read fewer than all of them: the rest were saved before the kill.
    assert 0 < len(set(world.site.page_requests())) < 31


def test_kills_again_and_again_with_chunks_in_between_never_end_the_scan(world):
    world.site.pages = big_site(100)
    scan_id = world.start_scan()
    for _ in range(queue.MAX_LEASE_LOSSES * 2):
        assert world.killed_chunk(links.run_scan_job, after_requests=1)
        assert world.job()["lease_losses"] == 1
        assert world.chunk() is True
        assert world.job()["lease_losses"] == 0
    world.to_the_end()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"]) == ("complete", 101)
    assert world.job()["attempts"] == 0


def test_chunks_never_count_as_failed_attempts_or_lost_leases(world):
    world.site.pages = big_site(60)
    scan_id = world.start_scan()
    runs = 0
    while world.chunk():
        runs += 1
        job = world.job()
        assert (job["attempts"], job["lease_losses"]) == (0, 0)
    assert runs > queue.MAX_LEASE_LOSSES * 3
    assert world.scan(scan_id)["status"] == "complete"


def test_a_scan_that_only_ever_kills_its_process_still_ends(world):
    world.site.pages = big_site(100)
    scan_id = world.start_scan()
    world.chunk()
    world.sql("UPDATE link_scans SET created_at = created_at - INTERVAL 1 HOUR WHERE id = :i", i=scan_id)
    for loss in range(1, queue.MAX_LEASE_LOSSES):
        world.killed_chunk(links.run_scan_job, after_requests=1)
        assert world.job()["lease_losses"] == loss
    job = queue.claim(world.engine, "crawl", "doomed")[0]
    world.sql("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = :i", i=job.id)
    assert queue.recover_expired(world.engine) == {"requeued": 0, "dead": 1}
    scan = world.scan(scan_id)
    assert scan["status"] == "failed"
    assert "worker stopped" in scan["error"]
    assert world.saved() == 0


# ---- other jobs get turns ----------------------------------------------------------------------------

def test_other_jobs_in_the_lane_run_between_chunks(world, monkeypatch):
    order = []
    monkeypatch.setitem(runner._registry, "test.other", lambda job, engine: order.append("other"))
    world.start_scan()
    queue.enqueue(world.engine, "crawl", "test.other")
    queue.enqueue(world.engine, "crawl", "test.other")
    world.site.on_request = lambda url: order.append("scan") if url.endswith("/robots.txt") else None
    world.chunk()
    world.tick()
    assert order[:3] == ["scan", "other", "other"]
    assert order.count("scan") > 3


def test_the_links_checker_and_the_health_test_of_a_site_take_turns(world):
    first_scan = world.start_scan()
    audit_id = world.start_test()
    whose = []
    for _ in range(4):
        world.chunk()
        whose.append((world.scan(first_scan)["pages_read"], world.test_of(audit_id)["pages_read"]))
    assert whose == [(3, 0), (3, 3), (6, 3), (6, 6)]


# ---- out of the daily budget: a pause, not an end ----------------------------------------------------

def out_of_budget_after(world, requests):
    budget.charge(world.engine, budget.DAILY_CRAWL_REQUESTS - requests)


def test_budget_running_out_pauses_until_just_after_midnight_and_stays_running(world):
    with_broken_links(world)
    out_of_budget_after(world, 6)
    scan_id = world.start_scan()
    world.chunk()  # robots.txt and 3 pages
    world.chunk()  # robots.txt and 1 page, then there's no room
    scan = world.scan(scan_id)
    assert scan["status"] == "running"
    assert scan["stop_reason"] is None and scan["finished_at"] is None
    assert scan["pages_read"] == 4
    assert scan["pages_not_read"] > 0
    assert scan["paused_until"]
    assert 0 <= world.value("SELECT TIMESTAMPDIFF(SECOND, UTC_DATE() + INTERVAL 1 DAY, paused_until) FROM link_scans") <= 600
    job = world.job()
    assert job["status"] == "queued"
    assert job["active_key"] == f"links:{world.own}"
    assert (job["attempts"], job["lease_losses"]) == (0, 0)
    assert 0 <= world.value("SELECT TIMESTAMPDIFF(SECOND, UTC_DATE() + INTERVAL 1 DAY, run_after) FROM jobs") <= 600
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 409


def test_while_paused_the_lane_does_nothing_for_it(world):
    out_of_budget_after(world, 0)
    scan_id = world.start_scan()
    world.chunk()
    assert world.site.requests == []
    assert world.scan(scan_id)["paused_until"]
    assert world.chunk() is False
    assert world.tick().processed == 0
    assert world.site.requests == []


def test_it_carries_on_the_next_day_and_finishes(world):
    with_broken_links(world)
    out_of_budget_after(world, 6)
    scan_id = world.start_scan()
    world.chunk()
    world.chunk()
    read_on_day_one = set(world.site.page_requests())
    world.next_day()
    world.to_the_end()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"], scan["pages_not_read"], scan["paused_until"]) == ("complete", 32, 0, None)
    assert Counter(world.site.page_requests()).most_common(1)[0][1] == 1
    assert read_on_day_one < set(world.site.page_requests())
    assert world.issue(scan_id, GONE)["pages"] == EARLY_AND_LATE
    assert world.saved() == 0


def test_a_scan_with_no_budget_at_all_on_its_first_day_carries_on_too(world):
    out_of_budget_after(world, 0)
    scan_id = world.start_scan()
    world.chunk()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"]) == ("running", 0)
    world.next_day()
    world.to_the_end()
    assert world.scan(scan_id)["pages_read"] == 31


def test_if_the_new_day_has_no_room_either_it_pauses_again(world):
    out_of_budget_after(world, 0)
    scan_id = world.start_scan()
    world.chunk()
    world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3)")
    world.chunk()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"]) == ("running", 0)
    assert scan["paused_until"]
    assert world.site.requests == []


def test_carrying_on_clears_the_pause(world):
    out_of_budget_after(world, 0)
    scan_id = world.start_scan()
    world.chunk()
    world.next_day()
    world.chunk()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["paused_until"]) == ("running", None)
    assert scan["pages_read"] == 3


def test_paused_for_budget_is_not_a_stop_reason_any_more(world):
    out_of_budget_after(world, 0)
    scan_id = world.start_scan()
    world.chunk()
    assert world.scan(scan_id)["stop_reason"] is None
    assert world.value("SELECT COUNT(*) FROM link_scans WHERE stop_reason = 'budget'") == 0


# ---- Stop, at any moment -----------------------------------------------------------------------------

def test_stop_between_chunks_ends_it_at_once_and_keeps_what_was_found(world):
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
    scan = world.scan(scan_id)  # no worker has run since
    assert (scan["status"], scan["stop_reason"], scan["stop_requested"]) == ("stopped", "user", True)
    assert scan["finished_at"]
    assert scan["pages_read"] == 3
    assert scan["pages_not_read"] == 3
    assert world.issue(scan_id, GONE)["pages"] == [HOME]
    assert world.saved() == 0
    assert world.job()["status"] == "done"
    asked = len(world.site.requests)
    assert world.chunk() is False
    assert len(world.site.requests) == asked


def test_a_scan_can_be_started_again_right_after_stopping_it_between_chunks(world):
    scan_id = world.start_scan()
    world.chunk()
    world.client.post(f"/api/links/scans/{scan_id}/stop")
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 202


def test_stop_during_a_budget_pause_ends_it_at_once_and_keeps_what_was_found(world):
    with_broken_links(world)
    out_of_budget_after(world, 4)
    scan_id = world.start_scan()
    world.chunk()
    world.chunk()
    assert world.scan(scan_id)["paused_until"]
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
    scan = world.scan(scan_id)
    assert (scan["status"], scan["stop_reason"], scan["paused_until"]) == ("stopped", "user", None)
    assert scan["pages_read"] == 3
    assert world.issue(scan_id, GONE)["pages"] == [HOME]
    assert world.saved() == 0
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 202  # not tomorrow: now


def test_stop_during_a_pause_with_nothing_read_yet_ends_it_at_once(world):
    out_of_budget_after(world, 0)
    scan_id = world.start_scan()
    world.chunk()
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"]) == ("stopped", 0)


def test_a_stop_seen_at_the_start_of_a_chunk_finishes_from_the_saved_state(world):
    """It got there as the worker claimed the job, or the API's own finish never ran."""
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    jobs = queue.claim(world.engine, "crawl", "test-worker")
    world.sql("UPDATE link_scans SET stop_requested = 1 WHERE id = :i", i=scan_id)
    asked = len(world.site.requests)
    runner._run_one(world.engine, jobs[0], "test-worker", runner._registry, 180, 60)
    scan = world.scan(scan_id)
    assert (scan["status"], scan["stop_reason"], scan["pages_read"]) == ("stopped", "user", 3)
    assert world.issue(scan_id, GONE)["pages"] == [HOME]
    assert len(world.site.requests) == asked  # nothing more was read
    assert world.saved() == 0


def test_a_stop_with_no_saved_state_yet_ends_without_reading_anything(world):
    scan_id = world.start_scan()
    jobs = queue.claim(world.engine, "crawl", "test-worker")
    world.sql("UPDATE link_scans SET status = 'running', stop_requested = 1 WHERE id = :i", i=scan_id)
    runner._run_one(world.engine, jobs[0], "test-worker", runner._registry, 180, 60)
    scan = world.scan(scan_id)
    assert (scan["status"], scan["stop_reason"], scan["pages_read"]) == ("stopped", "user", 0)
    assert world.site.requests == []


def test_stop_during_a_chunk_keeps_all_of_it(world, monkeypatch):
    monkeypatch.setattr(links, "STOP_POLL_SECONDS", 0)
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    held = world.job()["id"]

    def stop_at_p3(url):
        if url.endswith("/p3"):
            assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
            assert world.scan(scan_id)["status"] == "running"  # a worker holds it, and it will say

    world.site.on_request = stop_at_p3
    world.chunk()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["stop_reason"]) == ("stopped", "user")
    assert scan["pages_read"] == 5
    assert world.job()["id"] == held and world.job()["status"] == "done"
    assert world.saved() == 0


def test_a_stop_that_slipped_in_as_the_job_went_back_to_wait_is_not_left_until_tomorrow(world):
    out_of_budget_after(world, 4)
    scan_id = world.start_scan()
    world.chunk()
    world.chunk()
    # The worker had already looked when the stop came, so nobody will see it until the job's turn comes tomorrow.
    world.sql("UPDATE link_scans SET stop_requested = 1 WHERE id = :i", i=scan_id)
    assert world.scan(scan_id)["status"] == "stopped"


def test_stopping_twice_is_refused_like_any_finished_scan(world):
    scan_id = world.start_scan()
    world.chunk()
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 409


# ---- the saved state goes when its scan does ---------------------------------------------------------

def test_there_is_a_saved_state_between_chunks_and_none_at_the_end(world):
    world.start_scan()
    assert world.saved() == 0
    world.chunk()
    assert world.saved() >= 1
    assert world.value("SELECT kind FROM crawl_states LIMIT 1") == "links"
    world.to_the_end()
    assert world.saved() == 0


def test_the_state_goes_with_a_deleted_scan(world):
    scan_id = world.start_scan()
    world.chunk()
    world.client.post(f"/api/links/scans/{scan_id}/stop")
    assert world.client.delete(f"/api/links/scans/{scan_id}").status_code == 200
    assert world.saved() == 0


def test_a_scan_under_way_still_cannot_be_deleted(world):
    scan_id = world.start_scan()
    world.chunk()
    assert world.client.delete(f"/api/links/scans/{scan_id}").status_code == 409
    assert world.saved() >= 1


def test_the_state_goes_when_the_job_finds_its_scan_gone(world):
    scan_id = world.start_scan()
    world.chunk()
    world.sql("DELETE FROM link_scans WHERE id = :i", i=scan_id)
    world.chunk()
    assert world.saved() == 0
    assert world.job()["status"] == "done"


def test_the_state_goes_with_a_deleted_site(world):
    world.start_scan()
    world.start_test()
    world.chunk()
    world.chunk()
    assert world.saved() >= 2
    world.sql("DELETE FROM sites WHERE id = :i", i=world.own)
    assert world.saved() == 0


def test_a_large_state_is_saved_in_parts_and_comes_back_whole(world, monkeypatch):
    from seo.links import saved_state

    monkeypatch.setattr(saved_state, "PART_BYTES", 200)
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    assert world.saved() > 1
    world.to_the_end()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"]) == ("complete", 32)
    assert world.saved() == 0


# ---- the worker checks again, on every chunk ---------------------------------------------------------

def test_a_site_that_became_a_competitor_is_refused_on_a_later_chunk(world):
    scan_id = world.start_scan()
    world.chunk()
    asked = len(world.site.requests)
    world.sql("UPDATE sites SET kind = 'competitor' WHERE id = :i", i=world.own)
    world.chunk()
    assert len(world.site.requests) == asked
    assert world.value("SELECT status FROM link_scans WHERE id = :i", i=scan_id) == "failed"
    assert "own" in world.value("SELECT error FROM link_scans WHERE id = :i", i=scan_id)
    assert world.saved() == 0


def test_a_site_that_became_a_competitor_is_refused_during_a_pause_too(world):
    out_of_budget_after(world, 0)
    audit_id = world.start_test()
    world.chunk()
    world.sql("UPDATE sites SET kind = 'competitor' WHERE id = :i", i=world.own)
    world.next_day()
    world.chunk()
    assert world.site.requests == []
    assert world.value("SELECT status FROM health_audits WHERE id = :i", i=audit_id) == "failed"
    assert world.saved() == 0


# ---- a scan that has really been at it for days ------------------------------------------------------

def older(world, table, days=10):
    world.sql(f"UPDATE {table} SET created_at = created_at - INTERVAL :d DAY", d=days)


def test_a_scan_running_for_days_is_not_taken_for_dead_between_chunks(world):
    scan_id = world.start_scan()
    world.chunk()
    older(world, "link_scans")
    assert world.scan(scan_id)["status"] == "running"
    assert [s["status"] for s in world.client.get(f"/api/links/sites/{world.own}/scans").get_json()["scans"]] == ["running"]
    assert links.enqueue_due(world.engine) == []
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 409
    world.to_the_end()
    assert world.scan(scan_id)["status"] == "complete"


def test_a_scan_running_for_days_is_not_taken_for_dead_during_a_chunk(world):
    scan_id = world.start_scan()
    world.chunk()
    older(world, "link_scans")
    seen = []
    world.site.on_request = lambda url: seen.append(world.scan(scan_id)["status"])
    world.chunk()
    assert set(seen) == {"running"}


def test_a_scan_paused_for_budget_for_days_is_not_taken_for_dead(world):
    out_of_budget_after(world, 0)
    scan_id = world.start_scan()
    world.chunk()
    older(world, "link_scans")
    assert world.scan(scan_id)["status"] == "running"
    assert links.enqueue_due(world.engine) == []


def test_a_scan_whose_job_is_really_gone_ends_as_failed_and_keeps_what_it_had(world):
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    older(world, "link_scans")
    world.sql("UPDATE jobs SET status = 'dead', active_key = NULL")
    scan = world.scan(scan_id)
    assert scan["status"] == "failed"
    assert "worker stopped" in scan["error"]
    assert scan["pages_read"] == 3
    assert world.issue(scan_id, GONE)["pages"] == [HOME]
    assert world.saved() == 0
    assert links.enqueue_due(world.engine) == [world.own]


def test_a_scan_whose_worker_is_gone_with_nothing_left_to_notice_ends(world):
    scan_id = world.start_scan()
    world.chunk()
    assert queue.claim(world.engine, "crawl", "gone-worker")
    older(world, "link_scans")
    world.sql("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 HOUR")
    assert world.scan(scan_id)["status"] == "failed"
    assert world.saved() == 0
    assert world.client.post("/api/links/scan", json={"site_id": world.own}).status_code == 202


def test_two_requests_noticing_a_dead_scan_write_its_results_once(world):
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    older(world, "link_scans")
    world.sql("UPDATE jobs SET status = 'dead', active_key = NULL")
    assert links._finish_from_saved(world.engine, scan_id, "failed", error="first") is True
    assert links._finish_from_saved(world.engine, scan_id, "failed", error="second") is False
    assert world.value("SELECT COUNT(*) FROM link_issues WHERE scan_id = :i", i=scan_id) == 1
    assert world.scan(scan_id)["error"] == "first"


# ---- things going wrong for a moment, in a scan that may last for weeks ----------------------------------

def test_a_database_hiccup_only_costs_that_chunk(world, monkeypatch):
    scan_id = world.start_scan()
    world.chunk()
    real = budget.has_room
    fails = iter([True])

    def has_room(engine, *args):
        if next(fails, False):
            raise OperationalError("SELECT", {}, Exception("Lost connection"))
        return real(engine, *args)

    monkeypatch.setattr(budget, "has_room", has_room)
    world.chunk()
    scan = world.scan(scan_id)
    assert scan["status"] == "running"
    job = world.job()
    assert (job["status"], job["attempts"]) == ("queued", 1)
    assert "Lost connection" in job["last_error"]
    assert 30 <= world.value("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), run_after) FROM jobs") <= 60
    world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3)")
    world.to_the_end()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"]) == ("complete", 31)
    assert world.job()["attempts"] == 0


def test_a_database_that_keeps_failing_ends_the_scan_in_the_end(world, monkeypatch):
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()

    def has_room(engine, *args):
        raise OperationalError("SELECT", {}, Exception("Lost connection"))

    monkeypatch.setattr(budget, "has_room", has_room)
    for _ in range(links.MAX_JOB_ATTEMPTS):
        assert world.chunk() is True
        world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3) WHERE status = 'queued'")
    assert world.job()["status"] == "dead"
    older(world, "link_scans")
    scan = world.scan(scan_id)
    assert scan["status"] == "failed"
    assert world.issue(scan_id, GONE)["pages"] == [HOME]


def test_robots_txt_failing_for_a_while_loses_no_page_and_says_no_page_was_skipped(world):
    with_broken_links(world)
    scan_id = world.start_scan()
    world.chunk()
    world.site.robots = 503
    world.chunk()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"], scan["skipped_robots"]) == ("running", 3, 0)
    assert scan["paused_until"] is None  # this isn't the budget
    assert 200 <= world.value("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), run_after) FROM jobs") <= 300
    assert world.chunk() is False  # it waits
    world.site.robots = "User-agent: *\nDisallow: /private\n"
    world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3)")
    world.to_the_end()
    scan = world.scan(scan_id)
    assert (scan["status"], scan["pages_read"], scan["skipped_robots"]) == ("complete", 32, 0)


def test_a_site_asking_to_slow_down_is_given_the_time_it_asked_for(world, monkeypatch):
    answers = iter([httpx.Response(429, headers={"retry-after": "120"}, text="slow down")])
    scan_id = world.start_scan()
    site = world.site

    class Limits:
        def __call__(self, request):
            if request.url.path == "/p4":
                site.requests.append(str(request.url))
                answer = next(answers, None)
                if answer:
                    return answer
                return httpx.Response(200, html=big_site(30)["/p4"])
            return site(request)

    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(Limits())))
    world.chunk()  # home, /p1, /p2
    world.chunk()  # /p3, /p4, which says slow down, and /p5 isn't asked
    assert 100 <= world.value("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), run_after) FROM jobs") <= 120
    scan = world.scan(scan_id)
    assert scan["pages_read"] == 5
    world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3)")
    world.to_the_end()
    scan = world.scan(scan_id)
    assert scan["status"] == "complete"
    assert world.issue(scan_id, "/p4")["category"] == "unverified"


# ---- staying 3 seconds apart, across chunks ---------------------------------------------------------------

def test_the_gap_between_requests_holds_across_chunks(world, monkeypatch):
    gap = 0.12
    site = world.site
    site.pages = big_site(12)
    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=gap, is_allowed=lambda url: True, transport=httpx.MockTransport(site)))
    monkeypatch.setattr(links, "time_up_factory", chunks_of(2))
    scan_id = world.start_scan()
    assert world.to_the_end() >= 5
    assert world.scan(scan_id)["status"] == "complete"
    apart = [b - a for a, b in zip(site.times, site.times[1:])]
    assert min(apart) >= gap


def test_the_gap_a_sites_robots_txt_asks_for_holds_across_chunks(world, monkeypatch):
    site = world.site
    site.pages = big_site(1)
    site.robots = "User-agent: *\nCrawl-delay: 1\n"
    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0.01, is_allowed=lambda url: True, transport=httpx.MockTransport(site)))
    monkeypatch.setattr(links, "time_up_factory", chunks_of(1))
    world.start_scan()
    assert world.to_the_end() == 2
    apart = [b - a for a, b in zip(site.times, site.times[1:])]
    assert len(apart) == 3 and min(apart) >= 1


def test_the_gap_holds_when_the_links_checker_and_the_health_test_take_turns_on_one_site(world, monkeypatch):
    gap = 0.12
    site = world.site
    site.pages = big_site(8)
    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=gap, is_allowed=lambda url: True, transport=httpx.MockTransport(site)))
    monkeypatch.setattr(links, "time_up_factory", chunks_of(2))
    scan_id, audit_id = world.start_scan(), world.start_test()
    assert world.to_the_end() >= 6
    assert world.scan(scan_id)["status"] == "complete" and world.test_of(audit_id)["status"] == "complete"
    apart = [b - a for a, b in zip(site.times, site.times[1:])]
    assert min(apart) >= gap


def test_a_chunk_does_not_wait_out_a_gap_it_has_no_use_for(world, monkeypatch):
    slept = []
    monkeypatch.setattr(time, "sleep", slept.append)
    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=3.0, is_allowed=lambda url: True, transport=httpx.MockTransport(world.site)))
    monkeypatch.setattr(links, "time_up_factory", chunks_of(1))
    scan_id = world.start_scan()
    world.chunk()
    slept.clear()
    world.sql("UPDATE link_scans SET stop_requested = 1 WHERE id = :i", i=scan_id)
    world.chunk()
    assert slept == []


# ---- the health test: every page scored, however many chunks it takes ---------------------------------------

def findings(data: dict) -> dict:
    return {c["code"]: sorted(p.replace(HOME, "/") for p in c["pages"]) for c in data["checks"] if c["count"]}


def plant_problems(world):
    """Problems on pages read early and read late, some only visible once both have been read."""
    change(world, 1, (GONE,), title="Same title")
    change(world, 2, description="")
    change(world, 28, title="same TITLE")
    change(world, 29, (GONE,), description="", h1=())


PLANTED = {
    "duplicate_title": ["/p1", "/p28"],
    "no_meta": ["/p2", "/p29"],
    "no_h1": ["/p29"],
    "broken_pages": ["/gone"],
    "broken_links": ["/p1", "/p29"],
}


def test_a_test_in_chunks_scores_every_page_not_just_the_last_chunk(world):
    plant_problems(world)
    audit_id = world.start_test()
    chunks = world.to_the_end()
    assert chunks >= 10
    data = world.test_all(audit_id)
    result = data["audit"]
    assert (result["status"], result["pages_read"], result["pages_seen"], result["pages_not_read"]) == ("complete", 32, 32, 0)
    assert findings(data) == PLANTED
    assert result["counts"] == {code: len(pages) for code, pages in PLANTED.items()}
    assert Counter(world.site.page_requests()).most_common(1)[0][1] == 1
    assert world.saved() == 0


def test_a_test_in_chunks_gets_the_same_score_as_one_long_run(world, monkeypatch):
    plant_problems(world)
    in_chunks = world.start_test()
    world.to_the_end()
    monkeypatch.setattr(links, "time_up_factory", lambda: lambda: False)
    in_one = world.start_test()
    assert world.to_the_end() == 1
    assert world.test_of(in_chunks)["score"] == world.test_of(in_one)["score"] < 100
    assert findings(world.test_all(in_chunks)) == findings(world.test_all(in_one))


def test_a_kill_does_not_count_a_page_twice_in_the_findings(world):
    plant_problems(world)
    audit_id = world.start_test()
    world.chunk()  # robots.txt, home, /p1, /p2: both planted early pages are saved
    world.killed_chunk(health.run_audit, after_requests=3)  # /p3, /p4, and it dies
    world.chunk()
    lost = world.killed_chunk(health.run_audit, after_requests=2)
    assert len(lost) == 3
    world.to_the_end()
    data = world.test_all(audit_id)
    result = data["audit"]
    assert (result["status"], result["pages_read"], result["pages_seen"]) == ("complete", 32, 32)
    assert findings(data) == PLANTED
    assert result["counts"] == {code: len(pages) for code, pages in PLANTED.items()}
    with world.engine.connect() as conn:
        codes = [row[0] for row in conn.execute(text("SELECT code FROM health_issues WHERE audit_id = :i"), {"i": audit_id})]
    assert sorted(codes) == sorted(PLANTED)  # one row each


def test_a_kill_repeating_a_chunk_with_problems_counts_them_once(world):
    change(world, 4, description="")
    change(world, 5, description="")
    audit_id = world.start_test()
    world.chunk()  # up to /p2
    world.killed_chunk(health.run_audit, after_requests=3)  # robots.txt, /p3, /p4, and it dies asking for /p5
    world.to_the_end()
    assert findings(world.test_all(audit_id)) == {"no_meta": ["/p4", "/p5"]}
    assert world.test_of(audit_id)["counts"] == {"no_meta": 2}


def test_a_test_paused_for_budget_stays_running_and_raises_nothing(world, monkeypatch):
    world.site.pages["/"] = good("Home", title="", description="", h1=(), text_="Short.", links_=("/p1", "/p2", "/p3"))
    calls = []
    monkeypatch.setattr(health, "certificate_check", lambda host: calls.append(host) or -1)
    out_of_budget_after(world, 3)
    audit_id = world.start_test()
    world.chunk()
    world.chunk()
    result = world.test_of(audit_id)
    assert result["status"] == "running"
    assert result["paused_until"]
    assert result["score"] is None and result["stop_reason"] is None and result["finished_at"] is None
    assert result["pages_read"] == 2
    assert world.alerts() == []
    assert calls == []  # the certificate waits for the end too
    assert health.enqueue_due(world.engine) == []  # the month's test is under way


def test_a_test_carries_on_the_next_day_and_only_then_says_what_it_found(world, monkeypatch):
    monkeypatch.setattr(health, "certificate_check", lambda host: -1)
    plant_problems(world)
    out_of_budget_after(world, 6)
    audit_id = world.start_test()
    world.chunk()
    world.chunk()
    assert world.alerts() == []
    world.next_day()
    world.to_the_end()
    data = world.test_all(audit_id)
    result = data["audit"]
    assert (result["status"], result["pages_seen"], result["paused_until"]) == ("complete", 32, None)
    assert findings(data) == PLANTED
    assert result["site_problems"] == ["ssl_expired"]
    assert "health_site" in [a["kind"] for a in world.alerts()]
    assert health.enqueue_due(world.engine) == []


def test_a_test_with_no_budget_on_its_first_day_carries_on_too(world):
    out_of_budget_after(world, 0)
    audit_id = world.start_test()
    world.chunk()
    result = world.test_of(audit_id)
    assert (result["status"], result["pages_read"], result["score"]) == ("running", 0, None)
    assert world.site.requests == []
    world.next_day()
    world.to_the_end()
    assert world.test_of(audit_id)["score"] == 100


def test_stop_between_chunks_keeps_what_the_test_found(world, monkeypatch):
    asked = []
    monkeypatch.setattr(health, "certificate_check", lambda host: asked.append(host) or -1)
    plant_problems(world)
    audit_id = world.start_test()
    world.chunk()
    assert world.client.post(f"/api/health/audits/{audit_id}/stop").status_code == 200
    data = world.test_all(audit_id)
    result = data["audit"]
    assert (result["status"], result["stop_reason"], result["pages_read"], result["pages_seen"]) == ("stopped", "user", 3, 3)
    assert result["finished_at"]
    assert result["pages_not_read"] > 0
    assert findings(data) == {"no_meta": ["/p2"]}  # the broken link on /p1 needs the page it points to, which wasn't read
    assert world.alerts() == []
    assert world.saved() == 0
    assert asked == []  # asking a website from the API, while someone waits, is no way to stop
    assert world.client.post("/api/health/audit", json={"site_id": world.own}).status_code == 202


def test_stop_during_a_budget_pause_keeps_what_the_test_found(world):
    plant_problems(world)
    out_of_budget_after(world, 4)
    audit_id = world.start_test()
    world.chunk()
    world.chunk()
    assert world.test_of(audit_id)["paused_until"]
    assert world.client.post(f"/api/health/audits/{audit_id}/stop").status_code == 200
    data = world.test_all(audit_id)
    assert (data["audit"]["status"], data["audit"]["stop_reason"], data["audit"]["paused_until"]) == ("stopped", "user", None)
    assert findings(data) == {"no_meta": ["/p2"]}
    assert world.alerts() == []
    assert world.saved() == 0
    assert health.enqueue_due(world.engine) == [world.own]  # a stopped test doesn't use up the month


def test_a_stop_seen_at_the_start_of_a_chunk_finishes_the_test_from_the_saved_state(world):
    plant_problems(world)
    audit_id = world.start_test()
    world.chunk()
    jobs = queue.claim(world.engine, "crawl", "test-worker")
    world.sql("UPDATE health_audits SET stop_requested = 1 WHERE id = :i", i=audit_id)
    asked = len(world.site.requests)
    runner._run_one(world.engine, jobs[0], "test-worker", runner._registry, 180, 60)
    data = world.test_all(audit_id)
    assert (data["audit"]["status"], data["audit"]["stop_reason"]) == ("stopped", "user")
    assert findings(data) == {"no_meta": ["/p2"]}
    assert len(world.site.requests) == asked


def test_a_stop_that_slipped_in_as_the_test_went_back_to_wait_is_not_left_until_tomorrow(world):
    out_of_budget_after(world, 4)
    audit_id = world.start_test()
    world.chunk()
    world.chunk()
    world.sql("UPDATE health_audits SET stop_requested = 1 WHERE id = :i", i=audit_id)
    assert world.test_of(audit_id)["status"] == "stopped"


def test_a_test_running_for_days_is_not_taken_for_dead(world):
    audit_id = world.start_test()
    world.chunk()
    older(world, "health_audits")
    assert world.test_of(audit_id)["status"] == "running"
    assert health.enqueue_due(world.engine) == []
    assert world.alerts() == []
    world.to_the_end()
    assert world.test_of(audit_id)["status"] == "complete"


def test_a_test_paused_for_days_is_not_taken_for_dead(world):
    out_of_budget_after(world, 0)
    audit_id = world.start_test()
    world.chunk()
    older(world, "health_audits")
    assert world.test_of(audit_id)["status"] == "running"
    assert world.alerts() == []


def test_a_test_whose_job_is_really_gone_ends_as_failed_and_its_state_goes(world):
    audit_id = world.start_test()
    world.chunk()
    older(world, "health_audits")
    world.sql("UPDATE jobs SET status = 'dead', active_key = NULL")
    result = world.test_of(audit_id)
    assert result["status"] == "failed"
    assert result["score"] is None
    assert world.saved() == 0
    assert [a["kind"] for a in world.alerts()] == ["health_failed"]


def test_a_crash_in_a_later_chunk_is_reported_and_its_state_goes(world, monkeypatch):
    audit_id = world.start_test()
    world.chunk()
    monkeypatch.setattr(health, "extract", lambda *a, **k: 1 / 0)
    world.chunk()
    result = world.test_of(audit_id)
    assert result["status"] == "failed"
    assert "ZeroDivisionError" in result["error"]
    assert result["score"] is None
    assert world.saved() == 0
    assert [a["kind"] for a in world.alerts()] == ["health_failed"]
    assert world.job()["status"] == "done"


def test_a_database_hiccup_only_costs_that_chunk_of_a_test(world, monkeypatch):
    plant_problems(world)
    audit_id = world.start_test()
    world.chunk()
    real = budget.has_room
    fails = iter([True])

    def has_room(engine, *args):
        if next(fails, False):
            raise OperationalError("SELECT", {}, Exception("Lost connection"))
        return real(engine, *args)

    monkeypatch.setattr(budget, "has_room", has_room)
    world.chunk()
    assert world.test_of(audit_id)["status"] == "running"
    assert world.alerts() == []
    world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3)")
    world.to_the_end()
    data = world.test_all(audit_id)
    assert data["audit"]["status"] == "complete"
    assert findings(data) == PLANTED


def test_robots_txt_failing_in_a_later_chunk_is_not_a_whole_site_problem_yet(world):
    audit_id = world.start_test()
    world.chunk()
    world.site.robots = 503
    world.chunk()
    result = world.test_of(audit_id)
    assert (result["status"], result["skipped_robots"], result["pages_read"]) == ("running", 0, 3)
    world.site.robots = "User-agent: *\n"
    world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3)")
    world.to_the_end()
    result = world.test_of(audit_id)
    assert (result["status"], result["score"], result["pages_seen"], result["site_problems"]) == ("complete", 100, 31, [])


def test_progress_numbers_of_a_test_are_saved_during_a_chunk(world):
    audit_id = world.start_test()
    seen = []

    def look(url):
        if not url.endswith("/robots.txt"):
            seen.append(tuple(world.value(f"SELECT {c} FROM health_audits WHERE id = :i", i=audit_id) for c in ("pages_read", "pages_not_read")))

    world.site.on_request = look
    world.chunk()
    assert seen[:2] == [(0, 0), (1, 2)]
    result = world.test_of(audit_id)
    assert (result["pages_read"], result["pages_not_read"]) == (3, 4)


def test_requests_of_a_test_keep_counting_across_chunks(world):
    audit_id = world.start_test()
    world.to_the_end()
    assert world.test_of(audit_id)["requests_used"] == budget.used_today(world.engine) == len(world.site.requests)


def test_findings_survive_json():
    import json

    found = audit.Findings()
    found.add("no_title", "https://shop.example/a")
    assert found.first_look("https://shop.example/a") is True
    found.site_codes.append("start_page_noindex")
    found.titles["قهوة"] = ["https://shop.example/a", "https://shop.example/b"]
    found.metas["café"] = ["https://shop.example/c"]
    back = audit.Findings.from_json(json.loads(json.dumps(found.to_json())))
    assert back == found
    assert back.first_look("https://shop.example/a") is False  # it remembers what it has looked at
    assert back.pages_seen == 1


# ---- what a big site can throw at the very end of a long scan ------------------------------------------------

def test_a_broken_link_on_more_pages_than_one_row_can_hold_still_lists_them_all(world, monkeypatch):
    monkeypatch.setattr(links, "MOST_PAGE_CHARACTERS_IN_A_ROW", 200)
    world.site.pages = {
        "/": good("Home", links_=(GONE, *(f"/p{n}" for n in range(1, 21)))),
        **{f"/p{n}": good(f"Page {n}", links_=(GONE,)) for n in range(1, 21)},
    }
    scan_id = world.start_scan()
    world.to_the_end()
    every_page = [HOME, *(f"{HOME}p{n}" for n in range(1, 21))]
    assert world.value("SELECT COUNT(*) FROM link_issues WHERE scan_id = :i", i=scan_id) > 1  # it took several rows
    data = world.scan_all(scan_id)
    assert data["counts"]["broken"] == 1
    assert len(data["issues"]) == 1
    assert data["issues"][0]["pages"] == every_page
    assert world.client.get(f"/api/links/sites/{world.own}/scans").get_json()["scans"][0]["counts"]["broken"] == 1
    rows = world.client.get(f"/api/links/scans/{scan_id}/export.csv").get_data(as_text=True).splitlines()
    assert len(rows) == 1 + len(every_page)


def test_addresses_that_differ_only_by_case_or_accent_are_counted_apart(world):
    world.site.pages = {"/": good("Home", links_=("/Gone", "/gone", "/café", "/cafe"))}
    scan_id = world.start_scan()
    world.to_the_end()
    data = world.scan_all(scan_id)
    assert data["counts"]["broken"] == 4
    assert len(data["issues"]) == 4


def test_a_link_too_long_to_store_does_not_end_a_scan_at_its_very_end(world):
    world.site.pages["/p29"] = good("Page 29", links_=("/" + "a" * 70_000,))
    scan_id = world.start_scan()
    world.to_the_end()
    data = world.scan_all(scan_id)
    assert data["scan"]["status"] == "complete"
    assert [i["category"] for i in data["issues"]] == ["unverified"]
    assert data["issues"][0]["target_url"].startswith(f"{HOME}aaaa")


def test_results_that_cannot_be_written_still_let_a_scan_end(world, monkeypatch):
    scan_id = world.start_scan()
    world.chunk()
    monkeypatch.setattr(links, "_finish_with_results", lambda *a, **k: 1 / 0)
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
    scan = world.scan(scan_id)
    assert (scan["status"], scan["stop_reason"]) == ("stopped", "user")
    assert world.saved() == 0


def test_a_saved_state_that_cannot_be_read_still_lets_a_scan_end(world):
    scan_id = world.start_scan()
    world.chunk()
    world.sql("UPDATE crawl_states SET state = 'not gzip'")
    assert world.client.post(f"/api/links/scans/{scan_id}/stop").status_code == 200
    assert world.scan(scan_id)["status"] == "stopped"


def test_a_saved_state_that_cannot_be_read_still_lets_a_test_end(world):
    audit_id = world.start_test()
    world.chunk()
    world.sql("UPDATE crawl_states SET state = 'not gzip'")
    assert world.client.post(f"/api/health/audits/{audit_id}/stop").status_code == 200
    assert world.test_of(audit_id)["status"] == "stopped"
    assert world.saved() == 0


def test_a_saved_state_that_cannot_be_read_fails_the_scan_and_says_so_when_the_worker_reads_it(world):
    scan_id = world.start_scan()
    world.chunk()
    world.sql("UPDATE crawl_states SET state = 'not gzip'")
    world.chunk()
    scan = world.scan(scan_id)
    assert scan["status"] == "failed" and scan["error"]
    assert world.saved() == 0
