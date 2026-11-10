"""The pool fault of 2026-11-10: backlinks calls hung 30 s, then answered 500.

The cause was a request holding one connection while it asked for a second (ahrefs.connected inside list_for_site's
connection). A few requests at once each held one and all waited for another. These tests reproduce that, and check that
no screen route used here takes a second connection while it holds one.
"""
import threading
import traceback

import pytest
from sqlalchemy import create_engine, event

from seo.backlinks import ahrefs, service
from seo.links import service as links
from seo.web import create_app

ALLOW = lambda url: True  # noqa: E731


@pytest.fixture
def site(engine, monkeypatch):
    monkeypatch.setattr(service.logos, "queue_for", lambda engine, domains: None)
    site_id = links.add_site(engine, "https://shop-one.test/", "own", is_allowed=ALLOW)["id"]
    service.save_many(engine, [{"site_id": site_id, "source_url": "https://blog.example/post", "target_url": "/page/"}])
    return site_id


def test_several_backlinks_lists_at_once_never_wait_for_a_second_connection(engine, site, monkeypatch):
    """Two requests, a pool of two: each held one connection and waited for a second, so both timed out."""
    small = create_engine(engine.url, pool_size=2, max_overflow=0, pool_timeout=2, connect_args={"init_command": "SET time_zone='+00:00'"})
    together = threading.Barrier(2, timeout=5)
    real = ahrefs.connected

    def connected(eng):
        together.wait()  # both requests reach this point at the same moment, as on a busy screen
        return real(eng)

    monkeypatch.setattr(ahrefs, "connected", connected)
    errors = []

    def one():
        try:
            assert len(service.list_for_site(small, site)) == 1
        except Exception as exc:  # noqa: BLE001 - collected for the assert below
            errors.append(f"{type(exc).__name__}: {exc}")

    threads = [threading.Thread(target=one) for _ in range(2)]
    [t.start() for t in threads]
    [t.join(20) for t in threads]
    small.dispose()
    assert errors == []


def test_no_route_here_takes_a_second_connection_while_it_holds_one(engine, site):
    held, nested = threading.local(), []

    @event.listens_for(engine.pool, "checkout")
    def out(*_):
        held.n = getattr(held, "n", 0) + 1
        if held.n > 1:
            nested.append(" <- ".join(f"{f.name}:{f.lineno}" for f in reversed(traceback.extract_stack()[-8:-1]) if "/seo/" in f.filename))

    @event.listens_for(engine.pool, "checkin")
    def back(*_):
        held.n = max(0, getattr(held, "n", 1) - 1)

    client = create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client()
    routes = [
        f"/api/backlinks?site_id={site}", f"/api/health/sites/{site}/audits", f"/api/links/sites/{site}/scans", "/api/uptime/sites",
        "/api/health/sites", "/api/links/sites", "/api/tools", "/api/alerts", f"/api/rankings?site_id={site}",
    ]
    for route in routes:
        held.n = 0
        assert client.get(route).status_code == 200, route
    assert nested == []
