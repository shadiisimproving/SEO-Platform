"""Moz and Cloudflare for every website, by themselves (owner, 2026-11-09). Made-up sites, fake answers."""
import json

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import http
from seo.competitors import tracking
from seo.extras import auto, service as extras
from seo.sources import service as sources
from seo.worker.runner import tick
from tests.test_competitors_backend import add_rival, second_site, world  # noqa: F401  (world is a fixture)

MOZ = httpx.Response(200, json={"result": {"site_metrics": {"domain_authority": 40, "root_domains_to_root_domain": 120, "external_pages_to_root_domain": 900}}})
RADAR = httpx.Response(200, json={"result": {"details_0": {"bucket": "top 500 thousand", "rank": None}}})


@pytest.fixture
def apis(world, tmp_path, monkeypatch):
    from seo.core import crypto
    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)
    calls = []

    def fake(request):
        calls.append(request)
        if "api.moz.com" in str(request.url):
            return MOZ
        if "radar/ranking/domain" in str(request.url):
            return RADAR
        return httpx.Response(404, json={"error": "unknown"})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    sources.save_app_key(world.engine, "moz", "moz-token-1234")
    sources.save_app_key(world.engine, "cloudflare", "cf-token-1234")
    return calls


def moz_asked(calls):
    return [json.loads(c.content)["params"]["data"]["site_query"]["query"] for c in calls if "api.moz.com" in str(c.url)]


def numbers(engine, domain):
    with engine.connect() as conn:
        return conn.execute(text("SELECT important, domain_authority, popularity FROM moz_metrics WHERE target = :t"), {"t": domain}).mappings().first()


def test_every_website_gets_its_numbers_my_sites_first(world, apis):
    second_site(world)
    add_rival(world)
    auto.look_up(world.engine)
    asked = moz_asked(apis)
    assert asked[:2] == ["me.example", "me-two.example"] and "rival.example" in asked
    for domain in ("me.example", "me-two.example", "rival.example"):
        row = numbers(world.engine, domain)
        assert row["important"] == 1 and row["domain_authority"] == 40 and row["popularity"] == "top 500 thousand"


def test_a_domain_read_this_month_costs_nothing_the_next_night(world, apis):
    add_rival(world)
    auto.look_up(world.engine)
    first = len(apis)
    auto.look_up(world.engine)
    assert len(apis) == first  # neither Moz nor Cloudflare is asked again this month


def test_a_competitor_not_on_is_never_looked_up(world, apis):
    rival = add_rival(world)
    paused = add_rival(world, "paused.example")
    tracking.set_tracking(world.engine, world.own, paused, "pages")
    apis.clear()
    auto.look_up(world.engine)
    assert "paused.example" not in moz_asked(apis) and numbers(world.engine, "paused.example") is None
    assert "rival.example" in moz_asked(apis) and rival


def test_moz_stops_at_its_free_rows(world, apis):
    with world.engine.begin() as conn:  # 49 of the 50 free rows already used this month
        for i in range(49):
            conn.execute(text("INSERT INTO moz_metrics (target, important, fetched_at) VALUES (:t, 0, UTC_TIMESTAMP(3))"), {"t": f"used-{i}.example"})
    add_rival(world)
    auto.look_up(world.engine)
    assert moz_asked(apis) == ["me.example"]  # my site gets the last free row, the competitor waits for next month


def test_no_keys_means_no_calls_and_no_error(world, apis):
    with world.engine.begin() as conn:
        conn.execute(text("DELETE FROM connections WHERE tool IN ('Moz', 'Cloudflare Radar')"))
    add_rival(world)
    apis.clear()
    assert auto.look_up(world.engine)["moz"] is None
    assert apis == []


def test_adding_a_competitor_queues_its_numbers_and_mine(world, apis):
    add_rival(world)
    with world.engine.connect() as conn:
        payloads = [row[0] for row in conn.execute(text("SELECT payload FROM jobs WHERE kind = :k"), {"k": auto.JOB_KIND}).all()]
    assert any(set(json.loads(p)["domains"]) == {"me.example", "rival.example"} for p in payloads)
    apis.clear()
    tick(world.engine, auto.LANE, budget_seconds=20)
    assert set(moz_asked(apis)) == {"me.example", "rival.example"}


# ---- 2026-11-10: a Moz row is claimed before the call (F79), and own sites go first even when the list is older --------

def test_a_domain_claimed_by_another_lookup_isnt_fetched_twice(world, apis):
    extras.mark(world.engine, "rival.example")
    with world.engine.begin() as conn:  # the nightly job has just claimed it, and its answer isn't in yet
        conn.execute(text("UPDATE moz_metrics SET fetched_at = UTC_TIMESTAMP(3) WHERE target = 'rival.example'"))
    assert extras.fetch_moz(world.engine, ["rival.example"])["fetched"] == 0 and moz_asked(apis) == []


def test_a_lookup_that_dies_still_counts_and_a_refusal_gives_the_row_back(world, apis, monkeypatch):
    extras.mark(world.engine, "one.example")
    used = extras.moz_rows_used(world.engine)

    def broken(*args, **kwargs):
        raise http.SourceError("temporary", "Moz didn't answer in time.")

    monkeypatch.setattr(extras.http, "request", broken)
    assert extras.fetch_moz(world.engine, ["one.example"])["error"]
    assert extras.moz_rows_used(world.engine) == used + 1  # it may have been charged: never more than the free rows
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE moz_metrics SET fetched_at = NULL WHERE target = 'one.example'"))

    def refused(*args, **kwargs):
        raise http.SourceError("auth", "Moz refused the key.")

    monkeypatch.setattr(extras.http, "request", refused)
    extras.fetch_moz(world.engine, ["one.example"])
    assert extras.moz_rows_used(world.engine) == used


def test_own_sites_go_first_even_when_a_competitor_was_listed_earlier(world, apis):
    add_rival(world)
    extras.mark(world.engine, "rival.example")  # on the list before my own site
    auto.look_up(world.engine)
    assert moz_asked(apis)[0] == "me.example"
