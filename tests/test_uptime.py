"""Uptime, certificate and domain expiry, on the real test database with the websites held in memory."""
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import text

from seo.core import budget
from seo.crawl.fetch import PoliteFetcher
from seo.links import service as links
from seo.uptime import service as uptime
from seo.web import create_app
from seo.worker.runner import tick

ALLOW = lambda url: True  # noqa: E731


class Site:
    def __init__(self):
        self.answer = 200
        self.requests = []

    def __call__(self, request):
        self.requests.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if isinstance(self.answer, Exception):
            raise self.answer
        return httpx.Response(self.answer, html="<title>hello</title>")


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    site = Site()
    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=ALLOW, transport=httpx.MockTransport(site)))
    monkeypatch.setattr(uptime, "is_allowed", ALLOW)
    monkeypatch.setattr(uptime, "CONFIRM_AFTER_SECONDS", 0)
    monkeypatch.setattr(uptime, "internet_ok", lambda: True)
    monkeypatch.setattr(uptime, "certificate_read", lambda host: uptime.Certificate(datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=200)))
    monkeypatch.setattr(uptime, "rdap_lookup", lambda domain: date.today() + timedelta(days=300))

    class World:
        pass

    w = World()
    w.engine, w.site, w.client = engine, site, create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client()
    w.own = links.add_site(engine, "https://shop.example/", "own", is_allowed=ALLOW)["id"]
    w.rival = links.add_site(engine, "https://rival.example/", "competitor", is_allowed=ALLOW)["id"]
    w.tick = lambda: tick(engine, "crawl", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)

    def check():
        assert w.client.post(f"/api/uptime/sites/{w.own}/check").status_code == 202
        w.tick()

    w.check = check
    w.state = lambda: next(s for s in w.client.get("/api/uptime/sites").get_json()["sites"] if s["id"] == w.own)

    def query(sql, **args):
        with engine.connect() as conn:
            return conn.execute(text(sql), args).mappings().all()

    w.query = query
    w.alerts = lambda: query("SELECT kind, severity, title, acknowledged_at FROM alerts ORDER BY id")
    return w


def test_a_site_never_checked_is_unknown_not_up(world):
    state = world.state()
    assert state["state"] == "unknown" and state["reason"] == "never_checked"
    assert state["uptime_percent"] is None
    assert all(day["state"] == "unknown" for day in state["days"]) and state["days_not_watched"] == 30


def test_a_check_says_up_and_counts_the_day(world):
    world.check()
    state = world.state()
    assert state["state"] == "up" and state["uptime_percent"] == 100.0
    assert state["days"][-1]["state"] == "up" and state["days_not_watched"] == 29


def test_a_check_gone_stale_reads_as_unknown_never_up(world):
    world.check()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_monitors SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 46 MINUTE"))
    state = world.state()
    assert state["state"] == "unknown" and state["reason"] == "too_old"


def test_a_days_gap_stays_unknown_between_good_days(world):
    world.check()
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO uptime_days (site_id, day, up_checks) VALUES (:s, UTC_DATE() - INTERVAL 2 DAY, 5)"), {"s": world.own})
    days = world.state()["days"]
    assert [d["state"] for d in days[-3:]] == ["up", "unknown", "up"]


def test_going_down_opens_one_incident_and_one_alert(world):
    world.site.answer = 500
    world.check()
    world.check()
    state = world.state()
    assert state["state"] == "down" and state["reason"] == "server_error" and state["http_status"] == 500
    assert len(world.query("SELECT id FROM uptime_incidents")) == 1
    downs = [a for a in world.alerts() if a["kind"] == "uptime_down"]
    assert len(downs) == 1 and downs[0]["severity"] == "crit" and downs[0]["title"] == "shop.example is down"


def test_coming_back_closes_the_incident_and_the_alert_says_so(world):
    world.site.answer = 500
    world.check()
    world.site.answer = 200
    world.check()
    incident = world.query("SELECT ended_at FROM uptime_incidents")[0]
    assert incident["ended_at"] is not None
    alert = [a for a in world.alerts() if a["kind"] == "uptime_down"][0]
    assert alert["severity"] == "warn" and "back up" in alert["title"]
    assert world.state()["state"] == "up"


def test_one_failure_that_clears_on_the_second_read_is_not_an_outage(world, monkeypatch):
    answers = iter([500])

    class Once(Site):
        def __call__(self, request):
            if request.url.path == "/":
                code = next(answers, 200)
                return httpx.Response(code, html="x")
            return httpx.Response(404)

    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=ALLOW, transport=httpx.MockTransport(Once())))
    world.check()
    assert world.state()["state"] == "up"
    assert world.query("SELECT id FROM uptime_incidents") == []


@pytest.mark.parametrize("code,reason", [(403, "turned_away"), (401, "turned_away"), (429, "rate_limited")])
def test_a_site_turning_the_app_away_is_unknown_not_down(world, code, reason):
    world.site.answer = code
    world.check()
    state = world.state()
    assert state["state"] == "unknown" and state["reason"] == reason
    assert world.query("SELECT id FROM uptime_incidents") == []
    assert [a for a in world.alerts() if a["kind"] == "uptime_down"] == []


def test_our_own_connection_failing_is_unknown_not_down(world, monkeypatch):
    monkeypatch.setattr(uptime, "internet_ok", lambda: False)
    world.site.answer = httpx.ConnectError("no route")
    world.check()
    state = world.state()
    assert state["state"] == "unknown" and state["reason"] == "our_connection"
    assert world.query("SELECT id FROM uptime_incidents") == []


def test_no_answer_with_the_internet_working_is_down(world):
    world.site.answer = httpx.ConnectError("no route")
    world.check()
    assert world.state()["reason"] == "no_answer" and world.state()["state"] == "down"


def test_an_unknown_read_does_not_end_an_outage(world):
    world.site.answer = 500
    world.check()
    world.site.answer = 403
    world.check()
    assert world.query("SELECT ended_at FROM uptime_incidents")[0]["ended_at"] is None


def test_a_competitor_is_refused_in_the_api_and_in_the_worker(world):
    assert world.client.post(f"/api/uptime/sites/{world.rival}/check").status_code == 403
    assert world.client.patch(f"/api/uptime/sites/{world.rival}", json={"watching": False}).status_code == 403
    assert all(s["id"] != world.rival for s in world.client.get("/api/uptime/sites").get_json()["sites"])
    from seo.worker import queue

    queue.enqueue(world.engine, "crawl", uptime.JOB_KIND, payload={"site_id": world.rival}, dedupe_key="sneaky")
    world.tick()
    assert world.site.requests == []
    assert world.query("SELECT * FROM site_monitors WHERE site_id = :s", s=world.rival) == []


def test_private_addresses_are_refused_by_the_real_guard(engine, monkeypatch, tmp_path):
    """A site that came to point at a private address reads as unknown, and nothing connects to it."""
    site = links.add_site(engine, "https://shop.example/", "own", is_allowed=ALLOW)["id"]
    with engine.begin() as conn:
        conn.execute(text("UPDATE sites SET start_url = 'https://127.0.0.1/'"))
    monkeypatch.setattr(uptime, "rdap_lookup", lambda domain: date.today() + timedelta(days=300))
    called = []
    monkeypatch.setattr(uptime, "certificate_read", lambda host: called.append(host))
    uptime.check_now(engine, site)
    tick(engine, "crawl", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    answer = uptime.sites(engine)["sites"][0]
    assert answer["state"] == "unknown" and answer["reason"] == "refused"
    assert called == []


def test_uptime_due_queues_only_what_is_due_and_respects_not_watching(world):
    assert uptime.enqueue_due(world.engine) == [world.own]
    world.tick()
    assert uptime.enqueue_due(world.engine) == []
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_monitors SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 20 MINUTE"))
    assert uptime.enqueue_due(world.engine) == [world.own]
    world.tick()
    world.client.patch(f"/api/uptime/sites/{world.own}", json={"watching": False})
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_monitors SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 20 MINUTE"))
    assert uptime.enqueue_due(world.engine) == []
    state = world.state()
    assert state["watching"] is False and state["state"] == "unknown" and state["reason"] == "not_watching"


def test_checks_count_in_the_daily_budget_but_never_stop_when_it_is_used(world):
    """F14: a big scan that used the day's requests by 14:00 used to stop every uptime check until midnight."""
    world.check()
    assert budget.used_today(world.engine) >= 2  # robots.txt and the page
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE crawl_budget SET used = :n"), {"n": budget.DAILY_CRAWL_REQUESTS})
    world.site.answer = 503
    world.check()
    assert world.state()["state"] == "down"  # the alert still comes
    assert budget.used_today(world.engine) > budget.DAILY_CRAWL_REQUESTS  # and it is still counted


def test_uptime_has_its_own_lane_and_a_crawl_tick_takes_it_before_a_scan(world, tmp_path):
    from seo.links import service as links_service
    from seo.worker import queue
    links_service.start_scan(world.engine, world.own)
    assert uptime.enqueue_due(world.engine) == [world.own]
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT lane FROM jobs WHERE kind = 'uptime.check'")).scalar() == "uptime"
    owner = "test"
    from seo.worker.runner import _claim_next
    first = _claim_next(world.engine, "crawl", owner, 60)
    assert first[0].kind == "uptime.check"
    queue.complete(world.engine, first[0].id, owner)


def test_the_uptime_lane_runs_on_its_own(world, tmp_path):
    assert uptime.enqueue_due(world.engine) == [world.own]
    result = tick(world.engine, "uptime", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    assert result.processed == 1 and world.state()["state"] == "up"


def test_a_check_that_landed_a_minute_late_is_still_due_at_the_next_call(world):
    """F161: due meant "older than 14 minutes", so a check 13 min 50 s old at the next 15-minute call waited 30 minutes."""
    world.check()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_monitors SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 830 SECOND"))
    assert uptime.enqueue_due(world.engine) == [world.own]


def test_the_uptime_due_command_queues_and_checks(world, monkeypatch, capsys, tmp_path):
    from seo.worker import __main__ as cli
    monkeypatch.setattr(cli, "make_engine", lambda test=False: world.engine)
    monkeypatch.setenv("SEO_LOCK_DIR", str(tmp_path))
    assert cli.main(["uptime-due", "--budget", "20"]) == 0
    assert "queued 1 site, checked 1" in capsys.readouterr().out
    assert world.state()["state"] == "up"


def test_a_certificate_near_its_end_alerts_once_and_a_renewal_clears_it(world, monkeypatch):
    monkeypatch.setattr(uptime, "certificate_read", lambda host: uptime.Certificate(datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=10, hours=1)))
    world.check()
    world.check()
    alerts = [a for a in world.alerts() if a["kind"] == "ssl_expiry"]
    assert len(alerts) == 1 and alerts[0]["severity"] == "warn" and "expires on" in alerts[0]["title"]
    assert world.state()["certificate"]["state"] == "expiring" and world.state()["certificate"]["days_left"] == 10
    monkeypatch.setattr(uptime, "certificate_read", lambda host: uptime.Certificate(datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=90)))
    world.check()
    assert [a for a in world.alerts() if a["kind"] == "ssl_expiry"] == []
    assert world.state()["certificate"]["state"] == "ok"


def test_seen_is_not_asked_again_but_expired_is_told(world, monkeypatch):
    end = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=5)
    monkeypatch.setattr(uptime, "certificate_read", lambda host: uptime.Certificate(end))
    world.check()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE alerts SET acknowledged_at = UTC_TIMESTAMP(3) WHERE kind = 'ssl_expiry'"))
    world.check()
    assert sum(a["acknowledged_at"] is None for a in world.alerts() if a["kind"] == "ssl_expiry") == 0
    end = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    monkeypatch.setattr(uptime, "certificate_read", lambda host: uptime.Certificate(end))
    world.check()
    fresh = [a for a in world.alerts() if a["kind"] == "ssl_expiry" and a["acknowledged_at"] is None]
    assert len(fresh) == 1 and fresh[0]["severity"] == "crit"
    assert world.state()["certificate"]["state"] == "expired"


def test_a_failed_connection_says_nothing_about_the_certificate(world, monkeypatch):
    world.check()
    good = world.state()["certificate"]["expires"]

    def broken(host):
        raise OSError("refused")

    monkeypatch.setattr(uptime, "certificate_read", broken)
    world.check()
    assert world.state()["certificate"]["expires"] == good
    assert [a for a in world.alerts() if a["kind"] == "ssl_expiry"] == []


def test_a_certificate_that_cannot_be_trusted_says_so(world, monkeypatch):
    monkeypatch.setattr(uptime, "certificate_read", lambda host: uptime.Certificate(problem="untrusted"))
    world.check()
    certificate = world.state()["certificate"]
    assert certificate["problem"] == "untrusted" and certificate["expires"] is None and certificate["state"] == "unknown"


def test_a_site_without_https_has_no_certificate_to_read(world, monkeypatch):
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE sites SET start_url = 'http://shop.example/' WHERE id = :s"), {"s": world.own})
    called = []
    monkeypatch.setattr(uptime, "certificate_read", lambda host: called.append(host))
    world.check()
    assert called == [] and world.state()["certificate"]["https"] is False


def test_domain_date_from_rdap_and_expiry_alert(world, monkeypatch):
    monkeypatch.setattr(uptime, "rdap_lookup", lambda domain: date.today() + timedelta(days=9))
    world.check()
    domain = world.state()["domain"]
    assert domain["source"] == "rdap" and domain["state"] == "expiring" and domain["name"] == "shop.example"
    alert = [a for a in world.alerts() if a["kind"] == "domain_expiry"][0]
    assert alert["severity"] == "warn" and "domain name" in alert["title"]


def test_an_ending_with_no_rdap_asks_for_a_date_by_hand_and_keeps_it(world, monkeypatch):
    def none(domain):
        raise uptime.NoRdap(domain)

    monkeypatch.setattr(uptime, "rdap_lookup", none)
    world.check()
    domain = world.state()["domain"]
    assert domain["problem"] == "no_rdap" and domain["expires"] is None and domain["state"] == "unknown"
    assert [a for a in world.alerts() if a["kind"] == "domain_expiry"] == []
    soon = (date.today() + timedelta(days=3)).isoformat()
    answer = world.client.patch(f"/api/uptime/sites/{world.own}", json={"domain_expires_on": soon}).get_json()
    assert answer["domain"]["source"] == "manual" and answer["domain"]["expires"] == soon and answer["domain"]["problem"] is None
    assert len([a for a in world.alerts() if a["kind"] == "domain_expiry"]) == 1
    monkeypatch.setattr(uptime, "rdap_lookup", lambda domain: date.today() + timedelta(days=400))
    world.check()
    assert world.state()["domain"]["expires"] == soon  # a date entered by hand is never replaced


def test_clearing_a_date_goes_back_to_the_registry_and_clears_its_alert(world):
    soon = (date.today() + timedelta(days=3)).isoformat()
    world.client.patch(f"/api/uptime/sites/{world.own}", json={"domain_expires_on": soon})
    answer = world.client.patch(f"/api/uptime/sites/{world.own}", json={"domain_expires_on": None}).get_json()
    assert answer["domain"]["expires"] is None and answer["domain"]["source"] is None
    assert [a for a in world.alerts() if a["kind"] == "domain_expiry"] == []
    world.check()
    assert world.state()["domain"]["source"] == "rdap"


@pytest.mark.parametrize("bad", ["soon", "2026-13-45", 20261105])
def test_a_bad_date_is_refused(world, bad):
    reply = world.client.patch(f"/api/uptime/sites/{world.own}", json={"domain_expires_on": bad})
    assert reply.status_code == 400 and "YYYY-MM-DD" in reply.get_json()["error"]


def test_only_the_known_fields_are_accepted(world):
    assert world.client.patch(f"/api/uptime/sites/{world.own}", json={"state": "up"}).status_code == 400


def test_a_registry_failure_keeps_the_last_date(world, monkeypatch):
    world.check()
    known = world.state()["domain"]["expires"]

    def down(domain):
        raise uptime.RdapFailed("network")

    monkeypatch.setattr(uptime, "rdap_lookup", down)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_monitors SET domain_checked_at = NULL"))
    world.check()
    domain = world.state()["domain"]
    assert domain["expires"] == known and domain["problem"] == "rdap_failed"


def test_the_real_rdap_reader_on_a_fake_registry(monkeypatch):
    def registry(request):
        if request.url.host == "data.iana.org":
            return httpx.Response(200, json={"services": [[["com"], ["http://old.example/", "https://rdap.example/"]]]})
        if request.url.host == "rdap.example":
            return httpx.Response(302, headers={"location": "https://other.example/domain/shop.com"})
        return httpx.Response(200, json={"events": [{"eventAction": "registration", "eventDate": "2001-01-01T00:00:00Z"}, {"eventAction": "expiration", "eventDate": "2030-03-04T05:06:07Z"}]})

    real_client = httpx.Client
    monkeypatch.setattr(uptime, "_bootstrap", None)
    monkeypatch.setattr(uptime, "is_allowed", ALLOW)
    monkeypatch.setattr(uptime.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(registry), **kw))
    assert uptime.rdap_expiry("shop.com") == date(2030, 3, 4)
    with pytest.raises(uptime.NoRdap):
        uptime.rdap_expiry("shop.ae")


def test_rdap_refuses_a_redirect_to_a_private_address(monkeypatch):
    def registry(request):
        if request.url.host == "data.iana.org":
            return httpx.Response(200, json={"services": [[["com"], ["https://rdap.example/"]]]})
        return httpx.Response(302, headers={"location": "http://10.0.0.1/secret"})

    real_client = httpx.Client
    monkeypatch.setattr(uptime, "_bootstrap", None)
    monkeypatch.setattr(uptime, "is_allowed", lambda url: "10.0.0.1" not in url)
    monkeypatch.setattr(uptime.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(registry), **kw))
    with pytest.raises(uptime.RdapFailed):
        uptime.rdap_expiry("shop.com")


def test_killed_mid_job_is_safe_to_run_twice(world):
    world.site.answer = 500
    world.check()
    world.check()
    assert len(world.query("SELECT id FROM uptime_incidents WHERE ended_at IS NULL")) == 1
