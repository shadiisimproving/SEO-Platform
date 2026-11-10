"""The monthly health test and its alerts, through the real database, worker and API.

The website is a fixture held in memory and the certificate check is replaced, so nothing here touches the internet.
"""
import json
import socket
import ssl
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote, urlsplit

import httpx
import pytest
from sqlalchemy import text

from seo.core import budget
from seo.crawl.fetch import PoliteFetcher
from seo.health import audit, service as health
from seo.links import service as links
from seo.web import create_app
from seo.worker.__main__ import main
from seo.worker.runner import tick

TEXT = "An ordinary paragraph of readable text about coffee, how it is roasted and how it gets delivered. " * 3
HOME = "https://shop.example/"


def good(name: str, title=None, description=None, h1=None, text_=TEXT, links_=(), head="", body="", lang="en") -> str:
    """A page with nothing wrong with it, unless an argument says otherwise."""
    title = name if title is None else title
    description = f"About {name}" if description is None else description
    headings = (name,) if h1 is None else h1
    anchors = "".join(f'<a href="{href}">{href}</a>' for href in links_)
    return (
        f'<!doctype html><html lang="{lang}"><head><title>{title}</title>'
        + (f'<meta name="description" content="{description}">' if description else "") + head + "</head><body><main>"
        + "".join(f"<h1>{h}</h1>" for h in headings) + f"<p>{text_}</p>{anchors}{body}</main></body></html>"
    )


def healthy_pages(*extra_links) -> dict:
    return {
        "/": good("Home", links_=("/a", "/b", "/c", "/d", *extra_links)),
        "/a": good("Page A"), "/b": good("Page B"), "/c": good("Page C"), "/d": good("Page D"),
    }


class FakeSite:
    """Answers instead of the network. A page is HTML, a status code, or (redirect code, where to)."""

    def __init__(self):
        self.pages = healthy_pages()
        self.robots = "User-agent: *\nDisallow: /private\n"
        self.seconds = {}  # path -> how long the answer "took"
        self.requests = []
        self.on_request = None
        self.unreachable = False

    def __call__(self, request):
        url = str(request.url)
        self.requests.append(url)
        if self.on_request:
            self.on_request(url)
        if self.unreachable:
            raise httpx.ConnectError("Connection refused")
        path = unquote(request.url.raw_path.decode())
        if path == "/robots.txt":
            if isinstance(self.robots, int):
                return httpx.Response(self.robots, text="no")
            return httpx.Response(200, text=self.robots, headers={"content-type": "text/plain"})
        answer = self.pages.get(path, 404)
        if isinstance(answer, int):
            return httpx.Response(answer, text="An error page")
        if isinstance(answer, tuple):
            return httpx.Response(answer[0], headers={"location": answer[1]})
        if isinstance(answer, bytes):
            return httpx.Response(200, content=answer, headers={"content-type": "application/pdf"})
        return httpx.Response(200, html=answer)


class ClockedFetcher(PoliteFetcher):
    """Reports the time the fixture says an answer took, so a slow page needs no real wait."""

    def __init__(self, site: FakeSite):
        super().__init__(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(site))
        self.site = site

    def get(self, url, **options):
        result = super().get(url, **options)
        result.request_seconds = self.site.seconds.get(urlsplit(url).path, result.request_seconds)
        return result


class World:
    def __init__(self, engine, site, client, lock_dir):
        self.engine, self.site, self.client, self.lock_dir = engine, site, client, lock_dir
        self.days_left = 200
        self.own = links.add_site(engine, HOME, "own", is_allowed=lambda url: True)["id"]
        self.rival = links.add_site(engine, "https://rival.example/", "competitor", is_allowed=lambda url: True)["id"]

    def tick(self):
        return tick(self.engine, "crawl", lock_dir=self.lock_dir, budget_seconds=20, db_wait_seconds=1)

    def start(self, site_id=None) -> int:
        reply = self.client.post("/api/health/audit", json={"site_id": site_id or self.own})
        assert reply.status_code == 202, reply.get_json()
        return reply.get_json()["audit_id"]

    def detail(self, audit_id) -> dict:
        reply = self.client.get(f"/api/health/audits/{audit_id}")
        assert reply.status_code == 200
        return reply.get_json()

    def run_test(self, site_id=None) -> dict:
        audit_id = self.start(site_id)
        self.tick()
        for _ in range(3):  # a start page that fails is asked again in a later chunk before the test settles (F67)
            data = self.detail(audit_id)
            if data["audit"]["status"] not in ("queued", "running") or data["audit"].get("paused_until"):
                return data
            self.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3) WHERE status = 'queued'")
            self.tick()
        return self.detail(audit_id)

    def stop(self, audit_id):
        return self.client.post(f"/api/health/audits/{audit_id}/stop")

    def sql(self, statement: str, **params) -> None:
        with self.engine.begin() as conn:
            conn.execute(text(statement), params)

    def value(self, statement: str, **params):
        with self.engine.connect() as conn:
            return conn.execute(text(statement), params).scalar()

    def alerts(self) -> list[dict]:
        return self.client.get("/api/alerts").get_json()["alerts"]

    def open_kinds(self) -> list[str]:
        return sorted(a["kind"] for a in self.alerts())

    def site_row(self) -> dict:
        return next(s for s in self.client.get("/api/health/sites").get_json()["sites"] if s["id"] == self.own)

    def past_test(self, score, pages=10, status="complete", at_limit=False, site=(), issues=None, site_id=None) -> int:
        """A test written directly into the table, so the alert rules can be tried with exact scores."""
        counts = json.dumps({"pages_seen": pages, "issues": issues or {}, "site": list(site)})
        with self.engine.begin() as conn:
            return conn.execute(
                text(
                    "INSERT INTO health_audits (site_id, status, trigger_kind, max_pages, score, pages_read, stopped_at_limit, counts, finished_at) "
                    "VALUES (:s, :st, 'monthly', 500, :sc, :p, :l, :c, UTC_TIMESTAMP(3))"
                ),
                {"s": site_id or self.own, "st": status, "sc": score, "p": pages, "l": at_limit, "c": counts},
            ).lastrowid

    def judged(self, score, site_id=None, **options) -> list[str]:
        """A test that has just finished with this score: which alerts does it raise?"""
        return health.raise_alerts(self.engine, site_id or self.own, self.past_test(score, site_id=site_id, **options))


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    site = FakeSite()
    monkeypatch.setattr(links, "fetcher_factory", lambda: ClockedFetcher(site))
    client = create_app(engine=engine, url_allowed=lambda url: True, auth=False).test_client()
    w = World(engine, site, client, tmp_path)
    monkeypatch.setattr(health, "certificate_check", lambda host: w.days_left)
    return w


# ---- a whole test ------------------------------------------------------------------------------

def test_a_healthy_site_scores_100_and_raises_nothing(world):
    data = world.run_test()
    result = data["audit"]
    assert result["status"] == "complete"
    assert result["score"] == 100
    assert (result["pages_read"], result["pages_seen"], result["skipped_robots"], result["pages_not_read"]) == (5, 5, 0, 0)
    assert result["counts"] == {} and result["site_problems"] == []
    assert result["trigger"] == "button"
    assert result["created_at"] and result["finished_at"]
    assert world.alerts() == []


def test_the_test_stays_on_my_site(world):
    world.site.pages["/"] = good("Home", links_=("/a", "https://far.example/gone", "/away"))
    world.site.pages["/away"] = (302, "https://far.example/landing")
    data = world.run_test()
    assert not [u for u in world.site.requests if "far.example" in u]
    assert data["audit"]["counts"] == {}
    assert data["audit"]["score"] == 100


# Each check on its own: code, pages added or replaced, and exactly what the test must then find, by path.
EVERY_CHECK = [
    ("broken_pages", {"/gone": 404}, {"broken_pages": ["/gone"], "broken_links": ["/"]}),
    ("broken_links", {"/gone": 410, "/gone2": 404}, {"broken_pages": ["/gone", "/gone2"], "broken_links": ["/"]}),
    ("server_errors", {"/down": 500, "/down2": 503}, {"server_errors": ["/down", "/down2"]}),
    ("noindex", {"/a": good("Page A", head='<meta name="robots" content="noindex, follow">')}, {"noindex": ["/a"]}),
    ("canonical_elsewhere", {"/a": good("Page A", head='<link rel="canonical" href="/b">')}, {"canonical_elsewhere": ["/a"]}),
    ("no_title", {"/a": good("Page A", title="")}, {"no_title": ["/a"]}),
    ("duplicate_title", {"/a": good("Page A", title="Same"), "/b": good("Page B", title="same")}, {"duplicate_title": ["/a", "/b"]}),
    ("no_h1", {"/a": good("Page A", h1=())}, {"no_h1": ["/a"]}),
    ("many_h1", {"/a": good("Page A", h1=("One", "Two"))}, {"many_h1": ["/a"]}),
    ("no_meta", {"/a": good("Page A", description="")}, {"no_meta": ["/a"]}),
    ("duplicate_meta", {"/a": good("Page A", description="Same"), "/b": good("Page B", description="SAME")}, {"duplicate_meta": ["/a", "/b"]}),
    ("images_no_alt", {"/a": good("Page A", body='<img src="/x.png"><img src="/y.png" alt="y">')}, {"images_no_alt": ["/a"]}),
    ("almost_no_text", {"/a": good("Page A", text_="Short.")}, {"almost_no_text": ["/a"]}),
    ("redirect_chains", {"/c1": (301, "/c2"), "/c2": (301, "/c3"), "/c3": (301, "/a")}, {"redirect_chains": ["/c1"]}),
]


def added_links(changes: dict) -> tuple:
    return tuple(path for path in changes if path not in healthy_pages())


def findings(data: dict) -> dict:
    return {c["code"]: [urlsplit(p).path for p in c["pages"]] for c in data["checks"] if c["count"]}


@pytest.mark.parametrize("code,changes,expected", EVERY_CHECK, ids=[c[0] for c in EVERY_CHECK])
def test_each_check_finds_its_problem_and_nothing_else(world, code, changes, expected):
    world.site.pages = {**healthy_pages(*added_links(changes)), **changes}
    data = world.run_test()
    assert data["audit"]["status"] == "complete"
    assert findings(data) == expected
    assert data["audit"]["counts"] == {check: len(pages) for check, pages in expected.items()}
    assert data["audit"]["score"] < 100
    assert data["audit"]["site_problems"] == []


def test_a_slow_page_is_found(world):
    world.site.seconds = {"/a": 6.0}
    data = world.run_test()
    assert findings(data) == {"slow_pages": ["/a"]}
    assert data["audit"]["score"] < 100


def test_no_check_is_left_untested():
    assert {case[0] for case in EVERY_CHECK} | {"slow_pages"} == set(audit.CHECKS)


def test_a_page_with_many_problems_counts_each_kind_once(world):
    world.site.pages["/a"] = good("Page A", title="", description="", h1=(), text_="Short.", body='<img src="/x.png">')
    data = world.run_test()
    assert findings(data) == {"no_title": ["/a"], "no_meta": ["/a"], "no_h1": ["/a"], "almost_no_text": ["/a"], "images_no_alt": ["/a"]}


def test_a_redirect_to_a_page_already_read_is_not_counted_twice(world):
    world.site.pages = {**healthy_pages("/old"), "/old": (301, "/a")}
    data = world.run_test()
    assert data["audit"]["pages_seen"] == 5
    assert data["audit"]["counts"] == {}


def test_pages_the_crawl_could_not_judge_lower_nothing(world):
    world.site.pages = {
        **healthy_pages("/private/x", "/blocked", "/login", "/challenge", "/file.pdf", "/limited"),
        "/blocked": 403, "/login": 401, "/challenge": "<html><title>Just a moment...</title></html>", "/file.pdf": b"%PDF", "/limited": 429,
    }
    data = world.run_test()
    result = data["audit"]
    assert result["status"] == "complete"
    assert result["score"] == 100
    assert result["counts"] == {}
    assert result["skipped_robots"] == 1
    assert result["pages_seen"] == 5
    assert not [u for u in world.site.requests if "/private" in u]


def test_one_unusable_link_on_a_page_does_not_end_the_test(world):
    world.site.pages["/"] = good("Home", links_=("/a", "/bad&#127;link", "/b"))
    data = world.run_test()
    assert data["audit"]["status"] == "complete"
    assert data["audit"]["pages_seen"] == 3


def test_requests_count_inside_the_daily_budget(world):
    data = world.run_test()
    # robots.txt, 5 pages, and the 4 usual sitemap addresses asked for the orphan pages (none here)
    assert budget.used_today(world.engine) == len(world.site.requests) == data["audit"]["requests_used"] == 10


def test_a_test_has_no_limit(world):
    result = world.run_test()["audit"]
    assert (result["max_pages"], result["pages_read"], result["stopped_at_limit"], result["pages_not_read"]) == (None, 5, False, 0)


def test_a_limit_written_on_a_test_by_hand_is_obeyed_and_said(world):
    audit_id = world.start()
    world.sql("UPDATE health_audits SET max_pages = 2 WHERE id = :i", i=audit_id)
    world.tick()
    result = world.detail(audit_id)["audit"]
    assert (result["max_pages"], result["pages_read"], result["stopped_at_limit"], result["pages_not_read"]) == (2, 2, True, 3)
    assert result["status"] == "complete"


def test_the_job_holds_no_address(world):
    world.start()
    with world.engine.connect() as conn:
        lane, payload = conn.execute(text("SELECT lane, payload FROM jobs")).first()
    assert lane == "crawl"
    assert json.loads(payload).keys() == {"audit_id"}


def test_a_job_run_twice_does_not_double_the_issues(world):
    world.site.pages["/a"] = good("Page A", title="")
    audit_id = world.start()
    job = type("J", (), {"payload": {"audit_id": audit_id}})
    health.run_audit(job, world.engine)
    world.sql("UPDATE health_audits SET status = 'running' WHERE id = :i", i=audit_id)
    health.run_audit(job, world.engine)
    assert world.value("SELECT COUNT(*) FROM health_issues WHERE audit_id = :i AND code <> 'links_in'", i=audit_id) == 1
    assert world.value("SELECT COUNT(*) FROM health_issues WHERE audit_id = :i AND code = 'links_in'", i=audit_id) == 1


def test_the_job_of_a_finished_test_does_nothing(world):
    audit_id = world.run_test()["audit"]["id"]
    asked = len(world.site.requests)
    health.run_audit(type("J", (), {"payload": {"audit_id": audit_id}}), world.engine)
    assert len(world.site.requests) == asked


# ---- whole-site problems -------------------------------------------------------------------------

def test_a_start_page_answering_with_an_error_is_a_whole_site_problem(world):
    world.site.pages["/"] = 500
    data = world.run_test()
    assert data["audit"]["status"] == "complete"
    assert data["audit"]["site_problems"] == ["start_page_down"]
    assert data["site_problems"] == [{"code": "start_page_down", "meaning": audit.SITE_CHECKS["start_page_down"][0]}]
    assert findings(data) == {"server_errors": ["/"]}
    assert data["audit"]["score"] == 100 - 60 - 16
    assert "health_site" in world.open_kinds()


def test_a_missing_start_page_is_a_whole_site_problem(world):
    world.site.pages["/"] = 404
    data = world.run_test()
    assert data["audit"]["site_problems"] == ["start_page_down"]
    assert findings(data) == {"broken_pages": ["/"]}


def test_an_unreachable_site_is_a_whole_site_problem_not_a_perfect_score(world):
    world.site.unreachable = True
    data = world.run_test()
    assert data["audit"]["status"] == "complete"
    assert data["audit"]["site_problems"] == ["start_page_down"]
    assert data["audit"]["pages_seen"] == 0
    assert data["audit"]["score"] == 40
    assert "health_site" in world.open_kinds()


def test_a_server_failing_on_everything_is_a_whole_site_problem_not_a_perfect_score(world):
    world.site.robots = 500
    world.site.pages = {"/": 500}
    data = world.run_test()
    assert data["audit"]["status"] == "complete"
    assert data["audit"]["site_problems"] == ["robots_down"]
    assert data["audit"]["score"] == 40
    assert [u for u in world.site.requests] == ["https://shop.example/robots.txt"]  # stays out, as robots.txt rules say
    alert = next(a for a in world.alerts() if a["kind"] == "health_site")
    assert "robots.txt" in alert["title"]


def test_a_start_page_in_a_redirect_loop_is_a_whole_site_problem(world):
    world.site.pages["/"] = (302, "/")
    data = world.run_test()
    assert data["audit"]["site_problems"] == ["start_page_down"]


def test_a_start_page_hidden_from_search_engines_is_a_whole_site_problem(world):
    world.site.pages["/"] = good("Home", head='<meta name="robots" content="noindex">', links_=("/a",))
    data = world.run_test()
    assert data["audit"]["site_problems"] == ["start_page_noindex"]
    assert "health_site" in world.open_kinds()
    assert "hidden from search engines" in next(a for a in world.alerts() if a["kind"] == "health_site")["title"]


@pytest.mark.parametrize("days,problem", [
    (200, None), (15, None), (14, "ssl_expiring"), (1, "ssl_expiring"), (0, "ssl_expiring"), (-1, "ssl_expired"), (-300, "ssl_expired"), (None, "ssl_error"),
])
def test_the_certificate(world, days, problem):
    world.days_left = days
    data = world.run_test()
    assert data["audit"]["site_problems"] == ([problem] if problem else [])
    assert ("health_site" in world.open_kinds()) is bool(problem)
    assert data["audit"]["score"] == 100 - (audit.SITE_CHECKS[problem][1] if problem else 0)


def test_not_being_able_to_connect_for_the_check_says_nothing_about_the_certificate(world, monkeypatch):
    def cannot_connect(host):
        raise TimeoutError("timed out")

    monkeypatch.setattr(health, "certificate_check", cannot_connect)
    data = world.run_test()
    assert data["audit"]["status"] == "complete"
    assert data["audit"]["score"] == 100
    assert world.alerts() == []


def test_a_site_without_https_has_no_certificate_to_check(world):
    world.sql("UPDATE sites SET start_url = 'http://shop.example/' WHERE id = :i", i=world.own)
    world.days_left = -1
    assert world.run_test()["audit"]["site_problems"] == []


def test_the_certificate_is_checked_on_the_address_of_the_start_page(world, monkeypatch):
    world.sql("UPDATE sites SET start_url = 'https://www.shop.example/' WHERE id = :i", i=world.own)
    asked = []
    monkeypatch.setattr(health, "certificate_check", lambda host: asked.append(host) or 200)
    world.run_test()
    assert asked == ["www.shop.example"]


class FakeConnection:
    def __init__(self, certificate=None, error=None):
        self.certificate, self.error = certificate, error

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def wrap_socket(self, raw, server_hostname=None):
        if self.error:
            raise self.error
        return self

    def getpeercert(self):
        return self.certificate


def certificate_days(monkeypatch, certificate=None, error=None, connect_error=None):
    fake = FakeConnection(certificate, error)

    def connect(address, timeout=None):
        if connect_error:
            raise connect_error
        return fake

    monkeypatch.setattr(socket, "create_connection", connect)
    monkeypatch.setattr(ssl, "create_default_context", lambda: fake)
    return health.days_left_on_certificate("shop.example")


def test_days_left_on_a_good_certificate(monkeypatch):
    expires = (datetime.now(timezone.utc) + timedelta(days=30, hours=1)).strftime("%b %d %H:%M:%S %Y GMT")
    assert certificate_days(monkeypatch, {"notAfter": expires}) == 30


def test_an_expired_certificate_says_expired_not_unverifiable(monkeypatch):
    error = ssl.SSLCertVerificationError("certificate has expired")
    error.verify_code = 10  # what OpenSSL gives an expired certificate
    assert certificate_days(monkeypatch, error=error) < 0


def test_a_certificate_that_cannot_be_trusted_gives_no_number(monkeypatch):
    error = ssl.SSLCertVerificationError("self-signed certificate")
    error.verify_code = 18
    assert certificate_days(monkeypatch, error=error) is None
    assert certificate_days(monkeypatch, error=ssl.SSLError("handshake failure")) is None
    assert certificate_days(monkeypatch, {}) is None
    assert certificate_days(monkeypatch, {"notAfter": "not a date"}) is None


def test_no_connection_is_not_a_certificate_answer(monkeypatch):
    with pytest.raises(OSError):
        certificate_days(monkeypatch, connect_error=TimeoutError("timed out"))


# ---- a test that could not do its job --------------------------------------------------------------

@pytest.mark.parametrize("answer,reason", [
    (403, "blocked"), (401, "blocked"), (429, "slow down"), ((302, "https://far.example/landing"), "another website"), (b"%PDF", "readable"),
])
def test_a_site_that_could_not_be_read_gets_no_score(world, answer, reason):
    world.site.pages["/"] = answer
    result = world.run_test()["audit"]
    assert result["status"] == "failed"
    assert result["score"] is None
    assert result["pages_seen"] == 0
    assert reason in result["error"]
    assert world.open_kinds() == ["health_failed"]
    assert not [u for u in world.site.requests if "far.example" in u]


def test_a_site_whose_robots_txt_refuses_the_test_gets_no_score(world):
    world.site.robots = "User-agent: *\nDisallow: /\n"
    result = world.run_test()["audit"]
    assert result["status"] == "failed"
    assert result["score"] is None
    assert "robots.txt" in result["error"]
    assert result["skipped_robots"] == 1
    assert world.site.requests == ["https://shop.example/robots.txt"]
    assert world.site_row()["last_score"] is None
    assert world.open_kinds() == ["health_failed"]


def test_a_test_that_read_nothing_never_compares(world):
    world.run_test()
    world.site.pages["/"] = 403
    world.run_test()
    world.site.pages["/"] = good("Home", links_=("/a", "/b", "/c", "/d"))
    data = world.run_test()
    assert data["previous_score"] == 100
    assert world.open_kinds() == ["health_failed"]


def test_a_crash_during_the_crawl_is_reported_not_left_running(world):
    def boom(url):
        if url.endswith("/a"):
            raise RuntimeError("something unexpected")

    world.site.on_request = boom
    audit_id = world.start()
    assert world.tick().failed == 0
    result = world.detail(audit_id)["audit"]
    assert result["status"] == "failed"
    assert "RuntimeError" in result["error"]
    assert result["score"] is None
    assert result["finished_at"]
    assert world.open_kinds() == ["health_failed"]
    alert = world.alerts()[0]
    assert alert["severity"] == "warn" and alert["audit_id"] == audit_id
    world.site.on_request = None
    assert world.run_test()["audit"]["status"] == "complete"


def test_a_crash_after_the_crawl_is_reported_not_left_running(world, monkeypatch):
    def boom(host):
        raise RuntimeError("something unexpected")

    monkeypatch.setattr(health, "certificate_check", boom)
    audit_id = world.start()
    world.tick()
    assert world.detail(audit_id)["audit"]["status"] == "failed"
    assert world.open_kinds() == ["health_failed"]


def test_a_failed_test_can_be_tried_again_at_once(world, monkeypatch):
    monkeypatch.setattr(health, "extract", lambda *a, **k: 1 / 0)
    assert world.run_test()["audit"]["status"] == "failed"
    monkeypatch.undo()
    monkeypatch.setattr(links, "fetcher_factory", lambda: ClockedFetcher(world.site))
    monkeypatch.setattr(health, "certificate_check", lambda host: 200)
    assert world.run_test()["audit"]["status"] == "complete"


def test_a_new_failure_replaces_the_open_failure_alert(world):
    world.site.pages["/"] = 403
    world.run_test()
    world.run_test()
    assert world.open_kinds() == ["health_failed"]


def test_cron_retrying_a_failed_test_does_not_repeat_an_alert_someone_has_seen(world):
    world.site.pages["/"] = 403
    world.run_test()
    world.client.post(f"/api/alerts/{world.alerts()[0]['id']}/seen")
    world.run_test()
    assert world.alerts() == []
    # A new month is news again.
    world.sql("UPDATE alerts SET created_at = created_at - INTERVAL 40 DAY")
    world.run_test()
    assert world.open_kinds() == ["health_failed"]


def abandon(world, status="running") -> int:
    """A test whose worker kept dying: the queue has given up on the job, and the test is still marked as under way."""
    audit_id = world.start()
    world.sql("UPDATE jobs SET status = 'dead', active_key = NULL")
    world.sql("UPDATE health_audits SET status = :st, created_at = created_at - INTERVAL 1 HOUR WHERE id = :i", st=status, i=audit_id)
    return audit_id


@pytest.mark.parametrize("status", ["queued", "running"])
def test_a_test_whose_job_is_gone_does_not_block_the_month_for_ever(world, status):
    stuck = abandon(world, status)
    assert health.enqueue_due(world.engine) == [world.own]
    result = world.detail(stuck)["audit"]
    assert result["status"] == "failed"
    assert result["error"] and result["finished_at"]
    assert world.open_kinds() == ["health_failed"]
    world.tick()
    assert world.site_row()["last_score"] == 100


def test_the_button_works_after_a_test_whose_job_is_gone(world):
    stuck = abandon(world)
    assert world.run_test()["audit"]["status"] == "complete"
    assert world.detail(stuck)["audit"]["status"] == "failed"


def test_stop_on_a_test_whose_job_is_gone_ends_it(world):
    stuck = abandon(world)
    assert world.stop(stuck).status_code == 409  # it can never stop by itself, and it's already over
    assert world.detail(stuck)["audit"]["status"] == "failed"


def test_a_test_under_way_is_not_taken_for_abandoned(world):
    audit_id = world.start()
    world.sql("UPDATE health_audits SET status = 'running', created_at = created_at - INTERVAL 1 HOUR WHERE id = :i", i=audit_id)
    assert health.enqueue_due(world.engine) == []
    assert world.detail(audit_id)["audit"]["status"] == "running"


def test_a_test_just_started_is_not_taken_for_abandoned(world):
    audit_id = world.start()
    world.sql("UPDATE jobs SET status = 'dead', active_key = NULL")
    assert health.enqueue_due(world.engine) == []  # its job may be a moment away
    assert world.detail(audit_id)["audit"]["status"] == "queued"


# ---- the daily budget -------------------------------------------------------------------------------

def test_a_test_with_no_budget_left_pauses_and_says_so(world):
    budget.charge(world.engine, budget.DAILY_CRAWL_REQUESTS)
    world.days_left = -1
    result = world.run_test()["audit"]
    assert result["status"] == "running"
    assert result["stop_reason"] is None
    assert result["paused_until"]
    assert result["score"] is None  # nothing was read, so a score would be made up
    assert result["site_problems"] == []
    assert world.site.requests == []
    assert world.alerts() == []
    assert world.site_row()["last_score"] is None


def test_budget_running_out_part_way_pauses_the_test(world):
    budget.charge(world.engine, budget.DAILY_CRAWL_REQUESTS - 2)  # room for robots.txt and the start page
    result = world.run_test()["audit"]
    assert result["status"] == "running"
    assert result["stop_reason"] is None
    assert result["paused_until"]
    assert result["pages_read"] == 1
    assert result["pages_not_read"] == 4
    assert result["stopped_at_limit"] is False
    assert result["finished_at"] is None
    assert world.alerts() == []


def test_a_test_out_of_budget_is_still_this_months_test(world):
    budget.charge(world.engine, budget.DAILY_CRAWL_REQUESTS)
    world.run_test()
    assert health.enqueue_due(world.engine) == []  # it's under way, and it carries on tomorrow
    assert counted(world) == (1, 1)


# ---- Stop ------------------------------------------------------------------------------------------

def test_stop_before_it_starts(world):
    audit_id = world.start()
    assert world.stop(audit_id).status_code == 200
    result = world.detail(audit_id)["audit"]
    assert result["status"] == "stopped"
    assert result["stop_reason"] == "user"
    assert result["stop_requested"] is True
    assert result["finished_at"]
    assert world.tick().failed == 0
    assert world.site.requests == []
    assert world.detail(audit_id)["audit"]["status"] == "stopped"


def test_a_test_can_be_started_again_right_after_stopping_it(world):
    first = world.start()
    world.stop(first)
    second = world.start()
    assert second != first
    world.tick()
    assert world.detail(second)["audit"]["status"] == "complete"
    assert world.detail(first)["audit"]["status"] == "stopped"


def test_stop_while_running_keeps_what_was_found_and_says_so(world, monkeypatch):
    monkeypatch.setattr(health, "STOP_POLL_SECONDS", 0)
    world.site.pages["/"] = good("Home", title="", links_=("/a", "/b"))
    audit_id = world.start()

    def stop_after_home(url):
        if url == HOME:
            assert world.stop(audit_id).status_code == 200

    world.site.on_request = stop_after_home
    assert world.tick().failed == 0
    result = world.detail(audit_id)["audit"]
    assert result["status"] == "stopped"
    assert result["stop_reason"] == "user"
    assert result["pages_read"] == 1
    assert result["counts"] == {"no_title": 1}
    assert not [u for u in world.site.requests if u.endswith(("/a", "/b"))]
    assert world.alerts() == []


def test_stop_of_a_running_test_is_seen_when_its_job_runs_again(world):
    audit_id = world.start()
    world.sql("UPDATE health_audits SET status = 'running' WHERE id = :i", i=audit_id)
    assert world.stop(audit_id).status_code == 200
    assert world.detail(audit_id)["audit"]["status"] == "running"
    world.tick()
    result = world.detail(audit_id)["audit"]
    assert (result["status"], result["stop_reason"]) == ("stopped", "user")
    assert world.site.requests == []


def test_a_finished_test_cannot_be_stopped(world):
    audit_id = world.run_test()["audit"]["id"]
    assert world.stop(audit_id).status_code == 409
    assert world.detail(audit_id)["audit"]["status"] == "complete"


def test_stopping_a_test_that_does_not_exist(world):
    assert world.stop(999999).status_code == 404


def test_a_job_with_nothing_behind_it_does_nothing(world):
    audit_id = world.start()
    world.sql("DELETE FROM health_audits WHERE id = :i", i=audit_id)
    assert world.tick().failed == 0
    assert world.site.requests == []


def test_a_deleted_sites_job_does_nothing(world):
    world.start()
    world.sql("DELETE FROM sites WHERE id = :i", i=world.own)
    result = world.tick()
    assert (result.processed, result.failed) == (1, 0)
    assert world.site.requests == []
    assert world.value("SELECT COUNT(*) FROM health_audits") == 0


# ---- refused requests -------------------------------------------------------------------------------

def counted(world) -> tuple:
    return world.value("SELECT COUNT(*) FROM jobs"), world.value("SELECT COUNT(*) FROM health_audits")


def test_a_competitor_is_refused(world):
    assert world.client.post("/api/health/audit", json={"site_id": world.rival}).status_code == 403
    assert counted(world) == (0, 0)


def test_an_unknown_site_is_refused(world):
    assert world.client.post("/api/health/audit", json={"site_id": 999999}).status_code == 404
    assert counted(world) == (0, 0)


@pytest.mark.parametrize("body", [
    {"url": "https://far.example/"},
    {"start_url": "https://far.example/"},
    {"host": "far.example"},
    {"site_id": "OWN", "url": "https://far.example/"},
    {"site_id": "OWN", "start_url": "https://far.example/"},
    {"site_id": "OWN", "host": "far.example"},
    {"site_id": "OWN", "max_pages": 5},
    {"site_id": "OWN", "anything": 1},
    {"site_id": "https://far.example/"},
    {"site_id": "1"},
    {"site_id": 1.0},
    {"site_id": True},
    {"site_id": None},
    {"site_id": [1]},
    {},
    [],
    "https://far.example/",
])
def test_a_request_with_anything_but_a_site_id_is_refused(world, body):
    if isinstance(body, dict):
        body = {k: (world.own if v == "OWN" else v) for k, v in body.items()}
    assert world.client.post("/api/health/audit", json=body).status_code == 400
    assert counted(world) == (0, 0)


def test_an_address_in_the_query_string_is_refused(world):
    assert world.client.post("/api/health/audit?url=https://far.example/", json={"site_id": world.own}).status_code == 400
    assert counted(world) == (0, 0)


def test_a_request_that_is_not_json_is_refused(world):
    assert world.client.post("/api/health/audit", data="site_id=1").status_code == 400
    assert counted(world) == (0, 0)


def test_a_second_test_of_a_site_under_test_is_refused(world):
    world.start()
    assert world.client.post("/api/health/audit", json={"site_id": world.own}).status_code == 409
    assert counted(world) == (1, 1)


def test_the_worker_refuses_a_site_that_became_a_competitor(world):
    audit_id = world.start()
    world.sql("UPDATE sites SET kind = 'competitor' WHERE id = :i", i=world.own)
    assert world.tick().failed == 0
    assert world.site.requests == []  # not one request
    with world.engine.connect() as conn:
        status, error, score = conn.execute(text("SELECT status, error, score FROM health_audits WHERE id = :i"), {"i": audit_id}).first()
    assert status == "failed"
    assert "own" in error
    assert score is None
    assert world.alerts() == []


def test_a_competitor_has_no_settings_or_history_here(world):
    assert world.client.patch(f"/api/health/sites/{world.rival}", json={"monthly": False}).status_code == 403
    assert world.client.get(f"/api/health/sites/{world.rival}/audits").status_code == 403
    assert world.client.patch("/api/health/sites/999999", json={"monthly": False}).status_code == 404
    assert world.client.get("/api/health/sites/999999/audits").status_code == 404


def test_a_test_that_does_not_exist(world):
    assert world.client.get("/api/health/audits/999999").status_code == 404


# ---- the site list and its settings --------------------------------------------------------------------

def test_the_site_list_has_only_my_sites(world):
    sites = world.client.get("/api/health/sites").get_json()["sites"]
    assert [s["host"] for s in sites] == ["shop.example"]
    assert sites[0] == {
        "id": world.own, "host": "shop.example", "monthly": True, "max_pages": None, "last_score": None, "last_tested_at": None,
        "next_test_at": sites[0]["next_test_at"], "open_alerts": 0,
    }


def test_settings_can_be_changed(world):
    reply = world.client.patch(f"/api/health/sites/{world.own}", json={"monthly": False})
    assert reply.status_code == 200
    assert reply.get_json()["monthly"] is False
    assert world.site_row()["monthly"] is False


@pytest.mark.parametrize("body", [
    {"max_pages": 0}, {"max_pages": 1}, {"max_pages": 2001}, {"max_pages": "many"}, {"max_pages": True}, {"max_pages": None},
    {"monthly": "yes"}, {"monthly": 1}, {"weekly": True}, {"url": "https://far.example/"}, [],
])
def test_bad_settings_are_refused(world, body):
    assert world.client.patch(f"/api/health/sites/{world.own}", json=body).status_code == 400
    assert world.site_row()["max_pages"] is None and world.site_row()["monthly"] is True


def test_one_bad_setting_changes_nothing(world):
    assert world.client.patch(f"/api/health/sites/{world.own}", json={"monthly": False, "max_pages": 0}).status_code == 400
    assert world.site_row()["monthly"] is True


def test_the_site_list_shows_the_last_finished_test(world):
    finished = world.run_test()["audit"]
    world.past_test(10, status="stopped")
    world.past_test(20, status="failed")
    row = world.site_row()
    assert row["last_score"] == 100
    assert row["last_tested_at"] == finished["finished_at"]


# ---- next_test_at ------------------------------------------------------------------------------------

def next_month(world) -> str:
    return world.value("SELECT DATE_FORMAT(LAST_DAY(UTC_DATE()) + INTERVAL 1 DAY, '%Y-%m-%dT00:00:00Z')")


def today(world) -> str:
    return world.value("SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%dT00:00:00Z')")


def test_a_site_never_tested_is_due_now(world):
    assert world.site_row()["next_test_at"] == today(world)


def test_a_test_finished_this_month_means_next_month(world):
    world.run_test()
    assert world.site_row()["next_test_at"] == next_month(world)


def test_a_test_finished_in_an_earlier_month_means_due_now(world):
    world.run_test()
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 40 DAY")
    assert world.site_row()["next_test_at"] == today(world)


@pytest.mark.parametrize("status", ["stopped", "failed"])
def test_a_test_that_did_not_finish_still_means_due_now(world, status):
    world.past_test(90, status=status)
    assert world.site_row()["next_test_at"] == today(world)


def test_with_monthly_off_there_is_no_next_test(world):
    assert world.client.patch(f"/api/health/sites/{world.own}", json={"monthly": False}).get_json()["next_test_at"] is None
    world.run_test()
    assert world.site_row()["next_test_at"] is None
    world.client.patch(f"/api/health/sites/{world.own}", json={"monthly": True})
    assert world.site_row()["next_test_at"] == next_month(world)


# ---- once a month -----------------------------------------------------------------------------------

def test_monthly_queues_each_of_my_sites_once(world):
    second = links.add_site(world.engine, "https://second.example/", "own", is_allowed=lambda url: True)["id"]
    assert health.enqueue_due(world.engine) == [world.own, second]
    assert health.enqueue_due(world.engine) == []  # already queued
    assert counted(world) == (2, 2)
    assert world.value("SELECT trigger_kind FROM health_audits LIMIT 1") == "monthly"


def test_competitors_never_queue(world):
    health.enqueue_due(world.engine)
    assert world.value("SELECT COUNT(*) FROM health_audits WHERE site_id = :i", i=world.rival) == 0


def test_monthly_off_skips_the_site(world):
    world.client.patch(f"/api/health/sites/{world.own}", json={"monthly": False})
    assert health.enqueue_due(world.engine) == []


def test_a_complete_test_uses_up_the_month(world):
    health.enqueue_due(world.engine)
    world.tick()
    assert world.value("SELECT status FROM health_audits") == "complete"
    assert health.enqueue_due(world.engine) == []


def test_a_button_test_uses_up_the_month_too(world):
    world.run_test()
    assert health.enqueue_due(world.engine) == []


def test_a_test_under_way_is_not_queued_again(world):
    health.enqueue_due(world.engine)
    world.sql("UPDATE health_audits SET status = 'running'")
    assert health.enqueue_due(world.engine) == []
    assert counted(world) == (1, 1)


def test_a_stopped_test_does_not_use_up_the_month(world):
    audit_id = world.start()
    world.stop(audit_id)
    assert health.enqueue_due(world.engine) == [world.own]


def test_a_test_stopped_part_way_does_not_use_up_the_month(world):
    world.past_test(90, status="stopped")
    assert health.enqueue_due(world.engine) == []  # not again within the day: it would restart every hour
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 25 HOUR")
    assert health.enqueue_due(world.engine) == [world.own]


def test_a_failed_test_does_not_use_up_the_month(world):
    world.past_test(None, status="failed")
    assert health.enqueue_due(world.engine) == []
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 25 HOUR")
    assert health.enqueue_due(world.engine) == [world.own]


def test_a_test_that_read_no_page_does_not_use_up_the_month(world):
    world.past_test(40, pages=0, site=("start_page_down",))
    world.sql("UPDATE health_audits SET pages_read = 0, created_at = created_at - INTERVAL 25 HOUR")
    assert health.enqueue_due(world.engine) == [world.own]


def test_a_complete_test_last_month_does_not_use_up_this_one(world):
    world.run_test()
    world.sql("UPDATE health_audits SET created_at = LAST_DAY(UTC_DATE() - INTERVAL 1 MONTH) + INTERVAL 1 DAY - INTERVAL 1 SECOND")  # the last second of last month
    assert health.enqueue_due(world.engine) == [world.own]


def test_the_first_moment_of_this_month_counts_as_this_month(world):
    world.run_test()
    world.sql("UPDATE health_audits SET created_at = LAST_DAY(UTC_DATE() - INTERVAL 1 MONTH) + INTERVAL 1 DAY")
    assert health.enqueue_due(world.engine) == []


def test_the_same_month_of_another_year_does_not_count(world):
    world.run_test()
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 1 YEAR")
    assert health.enqueue_due(world.engine) == [world.own]


def test_a_month_of_daily_runs_tests_once_when_all_goes_well(world):
    for _ in range(3):
        health.enqueue_due(world.engine)
        world.tick()
    assert world.value("SELECT COUNT(*) FROM health_audits") == 1


# ---- the alert rules: a drop -----------------------------------------------------------------------------

def test_a_first_test_never_claims_a_drop(world):
    assert world.judged(95) == []
    assert world.alerts() == []


def test_a_drop_of_5_points_alerts(world):
    world.past_test(90, issues={"no_title": 1, "no_h1": 2})
    audit_id = world.past_test(85, issues={"no_title": 3, "no_h1": 2, "broken_pages": 1})
    assert health.raise_alerts(world.engine, world.own, audit_id) == ["health_drop"]
    alert = world.alerts()[0]
    assert alert["kind"] == "health_drop"
    assert alert["severity"] == "warn"
    assert alert["title"] == "shop.example: health fell from 90 to 85"
    assert alert["host"] == "shop.example" and alert["site_id"] == world.own and alert["audit_id"] == audit_id
    assert alert["seen"] is False and alert["created_at"]
    assert alert["detail"]["before"] == 90 and alert["detail"]["after"] == 85
    assert alert["detail"]["worse"] == [{"code": "broken_pages", "before": 0, "after": 1}, {"code": "no_title", "before": 1, "after": 3}]  # the costliest first


def test_a_drop_of_4_points_does_not(world):
    world.past_test(90)
    assert world.judged(86) == []


def test_a_rise_does_not(world):
    world.past_test(80)
    assert world.judged(95) == []


def test_a_drop_to_a_low_score_is_critical_and_only_one_alert(world):
    world.past_test(75)
    assert world.judged(65) == ["health_drop"]
    assert world.alerts()[0]["severity"] == "crit"


def test_every_finished_test_compares_with_the_one_before(world):
    world.past_test(90)
    assert world.judged(84) == ["health_drop"]
    assert world.judged(82) == []  # 2 points from 84, not 8 from 90
    assert world.alerts()[0]["title"].endswith("from 90 to 84")


# ---- what can be compared -----------------------------------------------------------------------------

@pytest.mark.parametrize("before,now,comparable", [
    (100, 100, True), (100, 50, True), (100, 200, True), (100, 49, False), (100, 201, False), (10, 1000, False), (1000, 10, False),
])
def test_only_a_test_of_similar_size_compares(world, before, now, comparable):
    world.past_test(90, pages=before)
    assert world.judged(70, pages=now) == (["health_drop"] if comparable else [])


@pytest.mark.parametrize("before,now,comparable", [(False, False, True), (True, True, True), (False, True, False), (True, False, False)])
def test_a_test_that_hit_the_page_limit_only_compares_with_another_that_did(world, before, now, comparable):
    world.past_test(90, pages=100, at_limit=before)
    assert world.judged(70, pages=100, at_limit=now) == (["health_drop"] if comparable else [])


def test_size_means_pages_really_looked_at_not_pages_asked_for(world):
    world.past_test(90, pages=100)
    audit_id = world.past_test(70, pages=100)
    world.sql("UPDATE health_audits SET counts = :c WHERE id = :i", c=json.dumps({"pages_seen": 3, "issues": {}, "site": []}), i=audit_id)  # most pages blocked this time
    assert health.raise_alerts(world.engine, world.own, audit_id) == []


def test_it_looks_back_past_a_test_of_another_size(world):
    world.past_test(90, pages=100)
    world.past_test(88, pages=10)
    assert world.judged(70, pages=100) == ["health_drop"]
    assert world.alerts()[0]["title"].endswith("from 90 to 70")


def test_a_test_that_read_no_pages_is_never_compared_with(world):
    world.past_test(90)
    world.past_test(40, pages=0, site=["start_page_down"])
    assert world.judged(70) == ["health_drop"]
    assert world.alerts()[0]["title"].endswith("from 90 to 70")


@pytest.mark.parametrize("status", ["stopped", "failed"])
def test_a_test_that_did_not_finish_is_never_compared_with(world, status):
    world.past_test(90)
    world.past_test(40, status=status)
    assert world.judged(88) == []
    world.past_test(99, status=status)
    assert world.judged(80) == ["health_drop"]
    assert world.alerts()[0]["title"].endswith("from 88 to 80")


# ---- the alert rules: a low score -------------------------------------------------------------------------

def test_a_first_test_with_a_low_score_says_so_without_claiming_a_drop(world):
    assert world.judged(60, issues={"no_title": 2}) == ["health_low"]
    alert = world.alerts()[0]
    assert alert["title"] == "shop.example: health is low at 60"
    assert alert["severity"] == "warn"
    assert "before" not in alert["detail"]
    assert alert["detail"]["after"] == 60
    assert alert["detail"]["worse"] == [{"code": "no_title", "before": 0, "after": 2}]


def test_70_is_not_low_and_69_is(world):
    assert world.judged(70) == []
    world.sql("DELETE FROM health_audits")
    assert world.judged(69) == ["health_low"]


def test_a_very_low_score_is_critical(world):
    world.judged(49)
    assert world.alerts()[0]["severity"] == "crit"


def test_a_low_score_that_stays_the_same_does_not_alert_again(world):
    assert world.judged(60) == ["health_low"]
    assert world.judged(60) == []
    assert world.judged(60) == []
    assert len(world.alerts()) == 1


def test_a_low_score_that_stays_the_same_stays_quiet_after_being_seen(world):
    world.judged(60)
    world.client.post(f"/api/alerts/{world.alerts()[0]['id']}/seen")
    assert world.judged(60) == []
    assert world.judged(63) == []
    assert world.alerts() == []


def test_a_low_score_that_gets_worse_after_being_seen_alerts_again(world):
    world.judged(60)
    world.client.post(f"/api/alerts/{world.alerts()[0]['id']}/seen")
    assert world.judged(58) == ["health_low"]
    assert world.alerts()[0]["title"].endswith("low at 58")


def test_a_low_score_that_gets_worse_while_the_alert_is_open_replaces_it(world):
    world.judged(60)
    assert world.judged(58) == ["health_low"]
    assert [a["title"] for a in world.alerts()] == ["shop.example: health is low at 58"]


def test_worse_is_measured_from_what_the_last_alert_said(world):
    assert world.judged(60) == ["health_low"]
    assert world.judged(65) == []
    assert world.judged(61) == []  # worse than last month, but not worse than the alert already said
    assert world.judged(59) == ["health_low"]


def test_a_low_score_of_another_size_does_not_repeat_the_alert(world):
    assert world.judged(60, pages=10) == ["health_low"]
    assert world.judged(60, pages=500) == []


def test_after_a_drop_the_same_low_score_stays_quiet(world):
    world.past_test(90)
    assert world.judged(60) == ["health_drop"]
    assert world.judged(60) == []
    assert world.judged(58) == ["health_low"]


def test_going_back_under_the_line_is_news_again(world):
    assert world.judged(60, pages=10) == ["health_low"]
    assert world.judged(85, pages=10) == []
    assert world.judged(65, pages=500) == ["health_low"]
    assert world.alerts()[0]["title"].endswith("low at 65")


def test_going_under_the_line_without_a_big_drop_alerts(world):
    world.past_test(72)
    assert world.judged(69) == ["health_low"]


def test_a_partial_test_does_not_interrupt_a_low_spell(world):
    assert world.judged(60) == ["health_low"]
    world.past_test(90, status="stopped")
    assert world.judged(60) == []


# ---- the alert rules: the whole site, and partial tests ---------------------------------------------------------

@pytest.mark.parametrize("code", audit.SITE_CHECKS)
def test_a_whole_site_problem_alerts_on_its_own(world, code):
    assert world.judged(95, site=[code]) == ["health_site"]
    alert = world.alerts()[0]
    assert alert["severity"] == "crit"
    assert alert["title"] == f"shop.example: {audit.SITE_CHECKS[code][0].lower()}"
    assert alert["detail"] == {"site": [code], "score": 95}


def test_every_whole_site_problem_is_named(world):
    world.judged(0, site=["start_page_down", "ssl_expired"])
    alert = next(a for a in world.alerts() if a["kind"] == "health_site")
    assert audit.SITE_CHECKS["start_page_down"][0].lower() in alert["title"]
    assert audit.SITE_CHECKS["ssl_expired"][0].lower() in alert["title"]


def test_a_whole_site_problem_and_a_drop_are_two_alerts(world):
    world.past_test(95)
    assert world.judged(55, site=["ssl_expired"]) == ["health_site", "health_drop"]
    assert world.open_kinds() == ["health_drop", "health_site"]
    drop = next(a for a in world.alerts() if a["kind"] == "health_drop")
    assert drop["detail"]["site"] == ["ssl_expired"]  # says why, when no page got worse


def test_a_whole_site_problem_on_a_first_test_does_not_claim_a_drop(world):
    assert world.judged(40, pages=0, site=["start_page_down"]) == ["health_site", "health_low"]


def test_a_partial_test_never_says_health_fell(world, monkeypatch):
    monkeypatch.setattr(health, "STOP_POLL_SECONDS", 0)
    assert world.run_test()["audit"]["score"] == 100
    world.site.pages["/"] = good("Home", title="", description="", h1=(), text_="Short.", links_=("/a", "/b", "/c", "/d"))
    audit_id = world.start()
    world.site.on_request = lambda url: world.stop(audit_id) if url == HOME else None
    world.tick()
    world.site.on_request = None
    partial = world.detail(audit_id)
    assert partial["audit"]["status"] == "stopped"
    assert partial["audit"]["score"] < 95  # it looks like a fall, from one page out of five
    assert world.alerts() == []
    assert world.site_row()["last_score"] == 100
    # The next complete test compares with the last complete one, and now the fall is real.
    full = world.run_test()
    assert full["audit"]["status"] == "complete"
    assert full["previous_score"] == 100
    assert world.open_kinds() == ["health_drop"]
    assert world.alerts()[0]["title"] == f"shop.example: health fell from 100 to {full['audit']['score']}"


def test_a_test_stopped_by_a_person_raises_nothing(world, monkeypatch):
    monkeypatch.setattr(health, "STOP_POLL_SECONDS", 0)
    world.days_left = -1
    world.site.pages["/"] = good("Home", title="", description="", h1=(), text_="Short.", links_=("/a",))
    audit_id = world.start()
    world.site.on_request = lambda url: world.stop(audit_id) if url == HOME else None
    world.tick()
    assert world.detail(audit_id)["audit"]["status"] == "stopped"
    assert world.alerts() == []


def test_the_whole_story_through_the_worker(world):
    assert world.run_test()["audit"]["score"] == 100
    assert world.alerts() == []
    # A month later a page has gone and another lost its title.
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 40 DAY")
    world.site.pages["/a"] = 404
    world.site.pages["/b"] = good("Page B", title="")
    assert health.enqueue_due(world.engine) == [world.own]
    world.tick()
    alerts = world.alerts()
    assert [a["kind"] for a in alerts] == ["health_drop"]
    worse = {w["code"]: (w["before"], w["after"]) for w in alerts[0]["detail"]["worse"]}
    assert worse == {"broken_pages": (0, 1), "broken_links": (0, 1), "no_title": (0, 1)}
    row = world.site_row()
    assert row["open_alerts"] == 1
    assert row["last_score"] == alerts[0]["detail"]["after"] < 95
    # Marked as seen, it goes. The site stays as it is, so no new alert comes.
    world.client.post(f"/api/alerts/{alerts[0]['id']}/seen")
    assert world.site_row()["open_alerts"] == 0
    assert world.run_test()["audit"]["score"] == row["last_score"]
    assert world.alerts() == []


# ---- one open alert per kind per site, and marking as seen -------------------------------------------------------

def test_a_new_alert_replaces_the_open_one_of_its_kind(world):
    world.past_test(90)
    world.judged(80)
    world.past_test(90)
    world.judged(70)
    assert [a["title"] for a in world.alerts()] == ["shop.example: health fell from 90 to 70"]
    # Nobody saw the old one, so it isn't kept as if someone had.
    assert health.alerts(world.engine, include_seen=True)[0]["seen"] is False
    assert world.value("SELECT COUNT(*) FROM alerts") == 1


def test_alerts_of_other_kinds_are_not_replaced(world):
    world.judged(95, site=["ssl_expiring"])
    world.past_test(95)
    world.judged(80)
    assert world.open_kinds() == ["health_drop", "health_site"]


def test_alerts_of_other_sites_are_not_replaced(world):
    second = links.add_site(world.engine, "https://second.example/", "own", is_allowed=lambda url: True)["id"]
    world.judged(60)
    world.judged(60, site_id=second)
    assert sorted(a["host"] for a in world.alerts()) == ["second.example", "shop.example"]
    assert world.site_row()["open_alerts"] == 1


def test_a_seen_alert_is_kept_and_a_new_one_opens(world):
    world.judged(95, site=["ssl_expiring"])
    world.client.post(f"/api/alerts/{world.alerts()[0]['id']}/seen")
    world.judged(95, site=["ssl_expiring"])
    assert len(world.alerts()) == 1
    assert sorted(a["seen"] for a in health.alerts(world.engine, include_seen=True)) == [False, True]


def test_an_alert_stays_until_it_is_marked_as_seen(world):
    world.judged(60)
    world.judged(95)
    world.judged(96)
    assert world.open_kinds() == ["health_low"]


def test_marking_seen_and_not_seen(world):
    world.judged(60)
    alert = world.alerts()[0]
    assert world.site_row()["open_alerts"] == 1
    assert world.client.post(f"/api/alerts/{alert['id']}/seen").status_code == 200
    assert world.alerts() == []
    assert world.site_row()["open_alerts"] == 0
    assert health.alerts(world.engine, include_seen=True)[0]["seen"] is True
    assert world.client.post(f"/api/alerts/{alert['id']}/seen", json={"seen": False}).status_code == 200
    assert world.alerts()[0]["id"] == alert["id"]
    assert world.alerts()[0]["seen"] is False
    assert world.site_row()["open_alerts"] == 1
    assert world.client.post(f"/api/alerts/{alert['id']}/seen", json={"seen": True}).status_code == 200
    assert world.alerts() == []


def test_marking_twice_is_harmless(world):
    world.judged(60)
    alert_id = world.alerts()[0]["id"]
    assert world.client.post(f"/api/alerts/{alert_id}/seen").status_code == 200
    assert world.client.post(f"/api/alerts/{alert_id}/seen").status_code == 200
    assert world.client.post(f"/api/alerts/{alert_id}/seen", json={"seen": False}).status_code == 200
    assert world.client.post(f"/api/alerts/{alert_id}/seen", json={"seen": False}).status_code == 200
    assert len(world.alerts()) == 1


def test_an_unknown_alert(world):
    assert world.client.post("/api/alerts/999999/seen").status_code == 404
    assert world.client.post("/api/alerts/999999/seen", json={"seen": False}).status_code == 404


@pytest.mark.parametrize("body", [{"seen": "no"}, {"seen": "false"}, {"seen": 0}, {"seen": None}, {"other": True}, [False]])
def test_marking_with_anything_but_true_or_false_is_refused(world, body):
    world.judged(60)
    alert_id = world.alerts()[0]["id"]
    assert world.client.post(f"/api/alerts/{alert_id}/seen", json=body).status_code == 400
    assert len(world.alerts()) == 1


def test_marking_with_a_body_that_is_not_json_is_refused(world):
    world.judged(60)
    alert_id = world.alerts()[0]["id"]
    assert world.client.post(f"/api/alerts/{alert_id}/seen", data="seen=true").status_code == 400
    assert len(world.alerts()) == 1


def test_not_seen_cannot_make_two_open_alerts_of_a_kind(world):
    world.judged(60)
    first = world.alerts()[0]["id"]
    world.client.post(f"/api/alerts/{first}/seen")
    assert world.judged(58) == ["health_low"]
    assert world.client.post(f"/api/alerts/{first}/seen", json={"seen": False}).status_code == 409
    assert world.open_kinds() == ["health_low"]
    assert world.alerts()[0]["id"] != first


def test_critical_alerts_come_first(world):
    second = links.add_site(world.engine, "https://second.example/", "own", is_allowed=lambda url: True)["id"]
    world.judged(95, site=["ssl_expiring"])  # critical
    world.judged(60, site_id=second)  # a warning, and newer
    assert [a["severity"] for a in world.alerts()] == ["crit", "warn"]


# ---- history and detail --------------------------------------------------------------------------------------------

def test_history_lists_every_test_newest_first_and_per_site(world):
    second = links.add_site(world.engine, "https://second.example/", "own", is_allowed=lambda url: True)["id"]
    first = world.run_test()["audit"]["id"]
    stopped = world.start()
    world.stop(stopped)
    last = world.run_test()["audit"]["id"]
    audits = world.client.get(f"/api/health/sites/{world.own}/audits").get_json()["audits"]
    assert [a["id"] for a in audits] == [last, stopped, first]
    assert [a["status"] for a in audits] == ["complete", "stopped", "complete"]
    assert audits[0]["site_id"] == world.own
    assert set(audits[0]) >= {
        "id", "site_id", "status", "trigger", "max_pages", "score", "stop_reason", "stop_requested", "pages_read", "pages_seen", "skipped_robots",
        "pages_not_read", "stopped_at_limit", "requests_used", "counts", "site_problems", "error", "created_at", "finished_at",
    }
    assert world.client.get(f"/api/health/sites/{second}/audits").get_json()["audits"] == []


def test_a_test_not_yet_run_can_be_shown(world):
    data = world.detail(world.start())
    assert data["audit"]["status"] == "queued"
    assert data["audit"]["score"] is None and data["audit"]["counts"] == {} and data["site_problems"] == []
    assert data["previous_score"] is None
    assert {c["code"] for c in data["checks"]} == set(audit.CHECKS)


def test_detail_lists_every_check_with_its_meaning_found_ones_first(world):
    world.site.pages["/a"] = good("Page A", description="")
    data = world.run_test()
    assert data["audit"]["host"] == "shop.example"
    assert [c["code"] for c in data["checks"]][0] == "no_meta"
    assert {c["code"] for c in data["checks"]} == set(audit.CHECKS)
    check = data["checks"][0]
    assert check == {
        "code": "no_meta", "meaning": audit.CHECKS["no_meta"][0], "severity": "info", "weight": 3, "count": 1, "pages": ["https://shop.example/a"], "previous": None,
    }


def test_the_first_test_has_nothing_to_compare_with(world):
    data = world.run_test()
    assert data["previous_score"] is None
    assert all(c["previous"] is None for c in data["checks"])


def test_detail_gives_previous_counts_per_check(world):
    world.site.pages["/a"] = good("Page A", title="")
    world.site.pages["/b"] = good("Page B", title="")
    first = world.run_test()
    world.site.pages["/b"] = good("Page B")
    world.site.pages["/c"] = good("Page C", h1=())
    second = world.run_test()
    checks = {c["code"]: c for c in second["checks"]}
    assert second["previous_score"] == first["audit"]["score"]
    assert (checks["no_title"]["previous"], checks["no_title"]["count"]) == (2, 1)
    assert (checks["no_h1"]["previous"], checks["no_h1"]["count"]) == (0, 1)
    assert (checks["broken_pages"]["previous"], checks["broken_pages"]["count"]) == (0, 0)
    # Opening the older test still shows what it was compared with then: nothing.
    assert world.detail(first["audit"]["id"])["previous_score"] is None


@pytest.mark.parametrize("status", ["stopped", "failed", "running"])
def test_a_test_that_did_not_finish_shows_no_comparison(world, status):
    world.past_test(90, issues={"no_title": 3})
    partial = world.past_test(50, status=status, issues={"no_title": 9})
    data = world.detail(partial)
    assert data["previous_score"] is None
    assert all(c["previous"] is None for c in data["checks"])


def test_a_test_of_another_size_shows_no_comparison(world):
    world.past_test(90, pages=500, issues={"no_title": 3})
    data = world.detail(world.past_test(80, pages=10, issues={"no_title": 1}))
    assert data["previous_score"] is None
    assert all(c["previous"] is None for c in data["checks"])


def test_detail_compares_with_the_same_test_the_alert_compared_with(world):
    world.past_test(90, pages=100, issues={"no_title": 3})
    world.past_test(88, pages=10, issues={"no_title": 1})
    data = world.detail(world.past_test(70, pages=100, issues={"no_title": 7}))
    assert data["previous_score"] == 90
    assert next(c for c in data["checks"] if c["code"] == "no_title")["previous"] == 3


def test_a_partial_test_is_skipped_as_a_previous_test(world):
    world.past_test(90, issues={"no_title": 3})
    world.past_test(50, status="stopped", issues={"no_title": 9})
    data = world.detail(world.past_test(88, issues={"no_title": 4}))
    assert data["previous_score"] == 90
    assert next(c for c in data["checks"] if c["code"] == "no_title")["previous"] == 3


def test_pages_listed_are_limited_but_the_count_is_not(world):
    paths = [f"/p{n}" for n in range(audit.MAX_PAGES_LISTED + 5)]
    world.site.pages = {"/": good("Home", links_=paths), **{path: good(path, description="") for path in paths}}
    check = next(c for c in world.run_test()["checks"] if c["code"] == "no_meta")
    assert check["count"] == audit.MAX_PAGES_LISTED + 5
    assert len(check["pages"]) == audit.MAX_PAGES_LISTED


# ---- pages in any language -------------------------------------------------------------------------------------------

FRENCH = "Votre café torréfié livré chaque mois à votre porte, sans engagement. Choisissez votre mouture, changez quand vous voulez et découvrez de nouvelles origines toute l'année. "
ARABIC = "قهوة طازجة مختصة تصلك كل شهر إلى باب منزلك من دون أي التزام. اختر الطحن الذي تفضله وغيّره متى شئت واكتشف مصادر جديدة على مدار العام مع محمصتنا المحلية. "
JAPANESE = "毎月、焙煎したてのコーヒーをご自宅へお届けします。挽き方はいつでも変更でき、一年を通じて新しい産地をお楽しみいただけます。"

LANGUAGES = {
    "fr": (FRENCH * 2, "Café en grains", "/café-en-grains"),
    "ar": (ARABIC * 2, "قهوة مختصة", "/قهوة-مختصة"),
    "ja": (JAPANESE, "コーヒー定期便", "/コーヒー定期便"),
}


def site_in(lang: str) -> dict:
    words, name, path = LANGUAGES[lang]
    other = path + "-2"
    return {
        "/": good(name + " 1", description=name + " 1", text_=words, lang=lang, links_=(path, other)),
        path: good(name + " 2", description=name + " 2", text_=words, lang=lang),
        other: good(name + " 3", description=name + " 3", text_=words, lang=lang),
    }


@pytest.mark.parametrize("lang", LANGUAGES)
def test_a_good_site_in_any_language_scores_100(world, lang):
    world.site.pages = site_in(lang)
    result = world.run_test()["audit"]
    assert result["status"] == "complete"
    assert result["counts"] == {}
    assert result["score"] == 100
    assert result["pages_seen"] == 3
    assert world.alerts() == []


@pytest.mark.parametrize("lang", LANGUAGES)
def test_a_canonical_in_percent_spelling_is_the_same_page_in_any_language(world, lang):
    from urllib.parse import quote

    pages = site_in(lang)
    path = LANGUAGES[lang][2]
    pages[path] = pages[path].replace("</title>", f'</title><link rel="canonical" href="https://shop.example{quote(path)}">')
    world.site.pages = pages
    assert world.run_test()["audit"]["counts"] == {}


@pytest.mark.parametrize("lang", LANGUAGES)
def test_one_page_linked_in_two_spellings_is_read_once_in_any_language(world, lang):
    from urllib.parse import quote

    words, name, path = LANGUAGES[lang]
    world.site.pages = {"/": good(name + " 1", description=name + " 1", text_=words, lang=lang, links_=(path, quote(path))), path: good(name + " 2", description=name + " 2", text_=words, lang=lang)}
    result = world.run_test()["audit"]
    assert result["pages_read"] == 2
    assert result["counts"] == {}


@pytest.mark.parametrize("lang", LANGUAGES)
def test_problems_on_a_page_are_found_and_stored_in_any_language(world, lang):
    words, name, path = LANGUAGES[lang]
    pages = site_in(lang)
    pages[path] = good(name + " 2", title="", description=name + " 2", text_="…", lang=lang, h1=())
    world.site.pages = pages
    data = world.run_test()
    expected = f"https://shop.example{path}"
    pages_of = {c["code"]: c["pages"] for c in data["checks"] if c["count"]}
    assert pages_of == {"no_title": [expected], "no_h1": [expected], "almost_no_text": [expected]}


# ---- the commands cron runs -----------------------------------------------------------------------------------------------

def test_health_due_command(world, capsys):
    assert main(["health-due", "--test-db"]) == 0
    assert capsys.readouterr().out.strip() == "health-due: queued 1 site"
    assert main(["health-due", "--test-db"]) == 0
    assert capsys.readouterr().out.strip() == "health-due: queued 0 sites"
    assert world.value("SELECT trigger_kind FROM health_audits") == "monthly"
    assert world.value("SELECT COUNT(*) FROM health_audits WHERE site_id = :i", i=world.rival) == 0


def test_health_due_command_says_how_many(world, capsys):
    links.add_site(world.engine, "https://second.example/", "own", is_allowed=lambda url: True)
    main(["health-due", "--test-db"])
    assert capsys.readouterr().out.strip() == "health-due: queued 2 sites"


def test_links_due_command(world, capsys):
    assert main(["links-due", "--test-db"]) == 0
    assert capsys.readouterr().out.strip() == "links-due: queued 1 site"
    assert main(["links-due", "--test-db"]) == 0
    assert capsys.readouterr().out.strip() == "links-due: queued 0 sites"
    assert world.value("SELECT COUNT(*) FROM link_scans WHERE site_id = :i", i=world.rival) == 0


def test_competitors_due_command(world, capsys):
    world.sql("INSERT INTO site_competitors (site_id, competitor_id) VALUES (:s, :c)", s=world.own, c=world.rival)
    assert main(["competitors-due", "--test-db"]) == 0
    assert capsys.readouterr().out.strip() == "competitors-due: queued 1 competitor and 1 of my sites, resumed 0 keyword lists"
    assert world.value("SELECT COUNT(*) FROM jobs WHERE kind = 'competitors.crawl'") == 2  # the competitor and my own site


def test_the_monthly_test_runs_from_the_commands_alone(world, capsys, monkeypatch, tmp_path):
    monkeypatch.setenv("SEO_LOCK_DIR", str(tmp_path))
    assert main(["health-due", "--test-db"]) == 0
    assert main(["tick", "--lane", "crawl", "--budget", "10", "--db-wait", "1", "--test-db"]) == 0
    assert "crawl: ok processed=1 failed=0" in capsys.readouterr().out
    assert world.site_row()["last_score"] == 100
    assert main(["health-due", "--test-db"]) == 0
    assert capsys.readouterr().out.strip() == "health-due: queued 0 sites"


def test_a_test_whose_worker_is_gone_with_nothing_left_to_notice_ends(world):
    """Cron has stopped too, so nothing marks the job dead. Its lease ran out long ago."""
    from seo.worker import queue

    audit_id = world.start()
    assert queue.claim(world.engine, "crawl", "gone-worker")
    world.sql("UPDATE health_audits SET status = 'running', created_at = created_at - INTERVAL 1 HOUR WHERE id = :i", i=audit_id)
    world.sql("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 HOUR")
    assert world.detail(audit_id)["audit"]["status"] == "failed"
    assert health.enqueue_due(world.engine) == [world.own]  # and its job is let go, so the next test isn't refused


def test_detail_names_the_test_it_was_compared_with(world):
    first = world.run_test()
    second = world.run_test()
    assert second["previous_audit"]["id"] == first["audit"]["id"]
    assert first["previous_audit"] is None


# ---- the internal links report (build next 10) ---------------------------------------------------------------

def test_a_test_counts_links_in_and_finds_pages_in_the_sitemap_linked_from_nowhere(world):
    world.site.pages = {
        "/": good("Home", links_=("/a", "/b")),
        "/a": good("Page A", links_=("/b",)),
        "/b": good("Page B"),
        "/lonely": good("Lonely"),
        "/sitemap.xml": '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                        + "".join(f"<url><loc>{HOME.rstrip('/')}{p}</loc></url>" for p in ("/", "/a", "/b", "/lonely")) + "</urlset>",
    }
    data = world.run_test()
    report = data["internal_links"]
    assert data["audit"]["status"] == "complete"
    counts = {row["url"]: row["links_in"] for row in report["pages"]}
    assert counts == {f"{HOME}a": 1, f"{HOME}b": 2}
    assert report["orphans"] == [f"{HOME}lonely"] and report["orphan_count"] == 1 and report["sitemap_read"]
    assert "links_in" not in data["audit"]["counts"]  # it isn't a check, and never moves the score
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT page_count FROM health_issues WHERE code = 'links_in'")).scalar() == 0


def test_important_pages_with_few_links_in_are_named(world, monkeypatch):
    from seo.health import indexing
    world.site.pages = {"/": good("Home", links_=("/a", "/b")), "/a": good("Page A", links_=("/b",)), "/b": good("Page B")}
    monkeypatch.setattr(indexing, "importance", lambda engine, site_id: {"/a": (120, 3000), "/b": (2, 40)})
    report = world.run_test()["internal_links"]
    assert [r["url"] for r in report["few_links"]] == [f"{HOME}a", f"{HOME}b"] and report["few_links"][0]["clicks"] == 120
    assert report["has_search_data"]
