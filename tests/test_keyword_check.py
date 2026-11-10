"""Keyword check: typed keywords, searched only when asked, showing which competitors rank. Made-up sites only."""
import pytest

from seo.competitors import probe, suggest, tracking
from seo.core.errors import Conflict, Refused
from tests.test_competitors_backend import FakeTool, add_rival, rows, scalar, world  # noqa: F401  (world is a fixture)


def tool(world, results, **kw):
    t = FakeTool(results=results, **kw)
    world.tools["google"] = [t]
    return t


def test_adding_keywords_spends_nothing_and_stays_out_of_my_list(world):
    t = tool(world, {"*": ["https://rival.example/a"]})
    answer = probe.add(world.engine, world.own, "setup dubai\nfree zone\nsetup dubai", "AE", "fr")
    assert answer == {"added": 2, "already": 0}
    assert t.calls == [] and world.drain("refresh") is not None and t.calls == []
    assert scalar(world.engine, "SELECT COUNT(*) FROM site_keywords") == 0
    assert [k["checked"] for k in probe.listing(world.engine, world.own)["keywords"]] == [False, False]


def test_the_estimate_counts_searches_and_free_checks_without_searching(world):
    t = tool(world, {}, free_monthly=10)
    probe.add(world.engine, world.own, "a\nb\nc")
    e = probe.estimate(world.engine, world.own)
    assert e["searches"] == 3 and e["can_now"] == 3 and e["tools"][0]["free_left"] == 10 and t.calls == []


def test_a_check_lists_each_competitor_that_ranks_with_its_position(world):
    one, two = add_rival(world, "rival.example"), add_rival(world, "other.example")
    tool(world, {"setup dubai": ["https://other.example/x", "https://me.example/p", "https://unknown.example/", "https://rival.example/y"]})
    probe.add(world.engine, world.own, "setup dubai")
    probe.start(world.engine, world.own)
    world.drain("refresh")
    row = probe.listing(world.engine, world.own)["keywords"][0]
    assert row["me"]["position"] == 2
    assert [(c["host"], c["position"]) for c in row["competitors"]] == [("other.example", 1), ("rival.example", 4)]
    assert {c["id"] for c in row["competitors"]} == {one, two}


def test_it_never_feeds_competitor_suggestions(world):
    tool(world, {"*": ["https://stranger.example/"]})
    probe.add(world.engine, world.own, "k1\nk2\nk3")
    probe.start(world.engine, world.own)
    world.drain("refresh")
    assert suggest.suggestions(world.engine, world.own)["suggestions"] == []


def test_competitors_not_on_are_left_out_and_counted(world):
    rival = add_rival(world)
    tracking.set_tracking(world.engine, world.own, rival, "pages")
    tool(world, {"*": ["https://rival.example/a"]})
    probe.add(world.engine, world.own, "k1")
    probe.start(world.engine, world.own)
    world.drain("refresh")
    out = probe.listing(world.engine, world.own)
    assert out["keywords"][0]["competitors"] == [] and out["competitors_hidden"] == 1


def test_it_stops_at_the_free_checks_and_keeps_what_it_found(world):
    t = tool(world, {"*": ["https://rival.example/a"]}, free_monthly=2)
    probe.add(world.engine, world.own, "a\nb\nc")
    run = probe.start(world.engine, world.own)
    world.drain("refresh")
    done = probe.run_dict(world.engine, run["id"])
    assert len(t.calls) == 2 and done["status"] == "waiting" and done["checked"] == 2 and "no free checks" in done["reason"]


def test_one_keywords_own_button_checks_only_that_one(world):
    t = tool(world, {"*": ["https://rival.example/a"]})
    probe.add(world.engine, world.own, "a\nb")
    first = probe.listing(world.engine, world.own)["keywords"][-1]["id"]
    probe.start(world.engine, world.own, [first])
    world.drain("refresh")
    assert len(t.calls) == 1


def test_no_tool_is_refused_and_a_second_run_waits_for_the_first(world):
    probe.add(world.engine, world.own, "a")
    with pytest.raises(Refused, match="No search tool"):
        probe.start(world.engine, world.own)
    tool(world, {})
    probe.start(world.engine, world.own)
    with pytest.raises(Conflict):
        probe.start(world.engine, world.own)


def test_a_failed_keyword_is_counted_and_the_rest_carry_on(world):
    tool(world, {"*": ["https://rival.example/a"]}, fail=["b"])
    probe.add(world.engine, world.own, "a\nb\nc")
    run = probe.start(world.engine, world.own)
    world.drain("refresh")
    done = probe.run_dict(world.engine, run["id"])
    assert done["status"] == "complete" and done["checked"] == 2 and done["failed"] == 1


def test_remove_and_limits(world, monkeypatch):
    probe.add(world.engine, world.own, "a")
    kid = probe.listing(world.engine, world.own)["keywords"][0]["id"]
    probe.remove(world.engine, world.own, kid)
    assert probe.listing(world.engine, world.own)["keywords"] == []
    monkeypatch.setattr(probe, "MAX_KEYWORDS", 2)
    with pytest.raises(Refused, match="at most 2"):
        probe.add(world.engine, world.own, "a\nb\nc")


def test_the_routes(world):
    rival = add_rival(world)
    tool(world, {"*": ["https://rival.example/a"]})
    added = world.client.post("/api/keyword-check/keywords", json={"site_id": world.own, "keywords": "a\nb", "country": "AE", "language": "fr"})
    assert added.status_code == 201
    estimate = world.client.post("/api/keyword-check/estimate", json={"site_id": world.own}).get_json()
    assert estimate["searches"] == 2
    assert world.client.post("/api/keyword-check/run", json={"site_id": world.own}).status_code == 202
    world.drain("refresh")
    page = world.client.get(f"/api/keyword-check?site_id={world.own}").get_json()
    assert all(k["competitors"][0]["id"] == rival for k in page["keywords"])
    assert world.client.post("/api/keyword-check/run", json={"site_id": rival}).status_code in (400, 404)  # a competitor isn't my site
    assert rows(world.engine, "SELECT trigger_kind FROM serp_checks GROUP BY trigger_kind") == [{"trigger_kind": "keyword_check"}]


def test_add_to_my_keywords_tracks_it_without_a_search_and_keeps_it_here(world):
    t = tool(world, {"*": ["https://rival.example/a", "https://me.example/p"]})
    probe.add(world.engine, world.own, "free zone cost")
    kid = probe.listing(world.engine, world.own)["keywords"][0]["id"]
    probe.start(world.engine, world.own)
    world.drain("refresh")
    searched = len(t.calls)
    answer = world.client.post(f"/api/keyword-check/keywords/{kid}/track", json={"site_id": world.own}).get_json()
    assert answer == {"tracked": True, "added": True}
    world.drain("refresh")
    assert len(t.calls) == searched  # no search for it
    assert scalar(world.engine, "SELECT COUNT(*) FROM site_keywords WHERE site_id = :s AND keyword_id = :k", s=world.own, k=kid) == 1
    row = probe.listing(world.engine, world.own)["keywords"][0]
    assert row["tracked"] is True and row["me"]["position"] == 2
    assert probe.track(world.engine, world.own, kid)["added"] is False  # twice is fine


def test_only_a_keyword_from_the_list_can_be_tracked(world):
    with pytest.raises(Exception, match="isn't in the list"):
        probe.track(world.engine, world.own, 999999)
