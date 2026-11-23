"""Tracking per competitor: on, pages (keyword numbers hidden, pages still read) or off (paused). Made-up sites only."""
import pytest
from sqlalchemy import text

from seo.competitors import ai_watch, collective, gaps, profile, tracking
from seo.core.errors import NotFound, Refused
from seo.metrics import today
from seo.serp.tools import PRESENT
from tests.test_competitors_backend import (  # noqa: F401  (world is a fixture)
    REFERRERS, add_page_change, add_rival, rival_row, second_site, seed, world,
)


def overview_row(world, rival, site_id=None):
    rows = tracking.apply_to_overview(world.engine, site_id or world.own, profile.overview(world.engine, site_id or world.own))
    return next(r for r in rows if r["id"] == rival)


def a_profile(world, rival):
    return tracking.apply_to_profile(world.engine, world.own, profile.profile(world.engine, world.own, rival))


def test_a_new_competitor_is_on_and_shows_its_keyword_numbers(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a", "me.example/a"])
    row = overview_row(world, rival)
    assert row["tracking"] == "on" and row["shared"] == 1 and row["they_ahead"] == 1


def test_pages_only_hides_keyword_numbers_and_on_brings_them_back(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a", "me.example/a"])
    seed(world.engine, world.own, "k2", ["rival.example/b"])
    tracking.set_tracking(world.engine, world.own, rival, "pages")
    row = overview_row(world, rival)
    assert row["tracking"] == "pages"
    assert (row["shared"], row["they_ahead"], row["i_ahead"], row["theirs_only"]) == (None, None, None, None)  # blank, not zero
    p = a_profile(world, rival)
    assert p["tracking"] == "pages" and p["keywords"] == [] and p["past_keywords"] == []
    assert p["compare"]["shared"] is None and p["compare"]["my_average"] is None and "pages" in p["compare"]
    assert not any(e["kind"].startswith(("rank_", "ai_")) for e in p["timeline"])
    tracking.set_tracking(world.engine, world.own, rival, "on")
    assert overview_row(world, rival)["shared"] == 1 and len(a_profile(world, rival)["keywords"]) == 2


def test_paused_and_pages_only_rows_go_after_the_followed_ones(world):
    first, second, third = (add_rival(world, host) for host in ("a-rival.example", "b-rival.example", "c-rival.example"))
    tracking.set_tracking(world.engine, world.own, first, "off")
    tracking.set_tracking(world.engine, world.own, second, "pages")
    rows = tracking.apply_to_overview(world.engine, world.own, profile.overview(world.engine, world.own))
    assert [r["id"] for r in rows] == [third, second, first]


def test_the_setting_is_per_site(world):
    two = second_site(world)
    rival = add_rival(world)
    add_rival(world, site_id=two)
    seed(world.engine, world.own, "k1", ["rival.example/a"])
    seed(world.engine, two, "k1", ["rival.example/a"])
    tracking.set_tracking(world.engine, world.own, rival, "off")
    assert overview_row(world, rival)["theirs_only"] is None
    assert overview_row(world, rival, two)["theirs_only"] == 1


@pytest.mark.parametrize("value", ["", "ON", "paused", None, 1])
def test_only_the_three_choices_are_accepted(world, value):
    rival = add_rival(world)
    with pytest.raises(Refused):
        tracking.set_tracking(world.engine, world.own, rival, value)


def test_a_competitor_of_another_site_or_a_rival_as_site_is_refused(world):
    two = second_site(world)
    rival = add_rival(world)
    with pytest.raises(NotFound):
        tracking.set_tracking(world.engine, two, rival, "off")
    with pytest.raises(Refused):
        tracking.set_tracking(world.engine, rival, rival, "off")


def test_ai_watch_and_collective_leave_out_what_isnt_on(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "cited", ["me.example/a", "rival.example/b"], ai=PRESENT, cited=["rival.example/b"])
    assert ai_watch.watch(world.engine, world.own)["summary"]["rivals"] == [{"host": "rival.example", "keywords": 1}]
    assert rival_row(collective.rivals(world.engine))
    tracking.set_tracking(world.engine, world.own, rival, "pages")
    assert ai_watch.watch(world.engine, world.own)["summary"]["rivals"] == []
    assert not any(r["host"] == "rival.example" for r in collective.rivals(world.engine)["rivals"])


def test_link_gaps_keep_pages_only_and_drop_off(world):
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, REFERRERS, "links.csv")
    every = {g["domain"] for g in gaps.link_gaps(world.engine, world.own)["gaps"]}
    assert every
    tracking.set_tracking(world.engine, world.own, rival, "pages")
    assert {g["domain"] for g in gaps.link_gaps(world.engine, world.own)["gaps"]} == every
    tracking.set_tracking(world.engine, world.own, rival, "off")
    assert gaps.link_gaps(world.engine, world.own)["gaps"] == []


def test_today_leaves_out_edits_of_a_paused_rival(world):
    rival = add_rival(world)
    add_page_change(world, "rival.example")
    assert today._changes(world.engine, world.own, set())[1] == 1 and today._changes(world.engine, None, set())[1] == 1
    tracking.set_tracking(world.engine, world.own, rival, "pages")
    assert today._changes(world.engine, world.own, set())[1] == 1
    tracking.set_tracking(world.engine, world.own, rival, "off")
    assert today._changes(world.engine, world.own, set()) == ([], 0) and today._changes(world.engine, None, set()) == ([], 0)


def test_moz_leaves_alone_a_rival_no_site_has_on(world):
    two = second_site(world)
    rival = add_rival(world)
    add_rival(world, site_id=two)
    tracking.set_tracking(world.engine, world.own, rival, "off")
    with world.engine.connect() as conn:
        assert tracking.hosts_not_on(conn) == set()  # still on for the second site
    tracking.set_tracking(world.engine, two, rival, "pages")
    with world.engine.connect() as conn:
        assert tracking.hosts_not_on(conn) == {"rival.example"}


def test_read_now_is_refused_when_off_and_allowed_on_pages_only(world):
    rival = add_rival(world)
    tracking.set_tracking(world.engine, world.own, rival, "off")
    answer = world.client.post(f"/api/competitors/{rival}/crawl?site_id={world.own}")
    assert answer.status_code == 400 and "off" in answer.get_json()["error"]
    tracking.set_tracking(world.engine, world.own, rival, "pages")
    assert world.client.post(f"/api/competitors/{rival}/crawl?site_id={world.own}").status_code == 202


def test_the_api_sets_and_shows_it(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a"])
    answer = world.client.put(f"/api/competitors/{rival}/tracking", json={"site_id": world.own, "tracking": "pages"})
    assert answer.status_code == 200 and answer.get_json() == {"competitor_id": rival, "tracking": "pages"}
    listed = world.client.get(f"/api/competitors?site_id={world.own}").get_json()["competitors"]
    assert listed[0]["tracking"] == "pages" and listed[0]["theirs_only"] is None
    shown = world.client.get(f"/api/competitors/{rival}/profile?site_id={world.own}").get_json()
    assert shown["tracking"] == "pages" and shown["keywords"] == []
    assert world.client.put(f"/api/competitors/{rival}/tracking", json={"site_id": world.own, "tracking": "maybe"}).status_code == 400
    assert world.client.put(f"/api/competitors/{rival}/tracking", json={"site_id": world.own, "tracking": "off", "extra": 1}).status_code == 400


def test_changing_it_never_runs_a_search(world):
    rival = add_rival(world)
    with world.engine.connect() as conn:
        before = conn.execute(text("SELECT COUNT(*) FROM serp_checks")).scalar()
    for value in ("pages", "off", "on"):
        tracking.set_tracking(world.engine, world.own, rival, value)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM serp_checks")).scalar() == before
        jobs = [row[0] for row in conn.execute(text("SELECT kind FROM jobs")).all()]
    assert all("keywords" not in kind and "refresh" not in kind for kind in jobs)


def test_off_is_left_out_of_the_daily_read_and_a_queued_read_fetches_nothing(world):
    from types import SimpleNamespace

    from seo.competitors import crawl
    from tests.test_competitors_backend import rival_site

    rival_site(world)
    rival = add_rival(world)  # queues its first read
    tracking.set_tracking(world.engine, world.own, rival, "off")
    world.requests.clear()
    crawl.run_crawl(SimpleNamespace(payload={"competitor_id": rival}), world.engine)
    assert world.requests == []  # nothing fetched once it's off
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_crawls WHERE competitor_id = :c AND status = 'queued'"), {"c": rival}).scalar() == 0
    assert rival not in crawl.enqueue_due(world.engine)  # my own site may be on the list: it's read daily too
    tracking.set_tracking(world.engine, world.own, rival, "pages")  # never read: read now
    world.drain("crawl")
    from tests.test_competitors_backend import rows as _rows
    assert world.requests, (_rows(world.engine, "SELECT id, status, last_error, run_after FROM jobs"), _rows(world.engine, "SELECT * FROM competitor_crawls"))
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE competitor_crawls SET finished_at = UTC_TIMESTAMP(3) - INTERVAL 2 DAY"))
    assert rival in crawl.enqueue_due(world.engine)
    tracking.set_tracking(world.engine, world.own, rival, "off")
    assert rival not in crawl.enqueue_due(world.engine)  # my own site may be on the list: it's read daily too
