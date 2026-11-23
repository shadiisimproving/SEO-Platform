"""A competitor's own page shows Page vs page, Link gaps and AI Overview for that competitor alone (2026-11-16, the owner:
"collective and also for each competitor alone"). The server narrows Link gaps and Page vs page to one competitor, before
the lists are cut, with the same number of queries as the collective answer. Made-up sites only."""
from sqlalchemy import event, text

from seo.competitors import ai_watch, gaps
from tests.test_competitors_backend import ABSENT, PRESENT, add_rival, gap_world, seed, world  # noqa: F401  (world is a fixture)


def _count(world, path):
    seen = {"n": 0}
    listen = lambda *a, **k: seen.__setitem__("n", seen["n"] + 1)  # noqa: E731
    world.client.get(path)  # warm: logos queued, caches filled
    event.listen(world.engine, "before_cursor_execute", listen)
    try:
        assert world.client.get(path).status_code == 200
    finally:
        event.remove(world.engine, "before_cursor_execute", listen)
    return seen["n"]


def _two_rivals(world):
    first = gap_world(world)
    second = add_rival(world, "rival-two.example")
    gaps.import_referrers(world.engine, world.own, second, b"Source url,Toxic Score\nhttps://unknown.example/two,2\nhttps://only-two.example/x,1\n", "two.csv")
    return first, second


def test_link_gaps_for_one_competitor_hold_only_the_domains_linking_to_it(world):
    first, second = _two_rivals(world)
    every = world.client.get(f"/api/link-gaps?site_id={world.own}").get_json()
    theirs = world.client.get(f"/api/link-gaps?site_id={world.own}&competitor_id={second}").get_json()
    every_domains = {g["domain"] for g in every["gaps"] + every["filtered"]}
    their_domains = {g["domain"] for g in theirs["gaps"] + theirs["filtered"]}
    assert their_domains < every_domains
    assert their_domains == {"unknown.example", "only-two.example"}
    assert all(any(c["id"] == second for c in g["competitors"]) for g in theirs["gaps"] + theirs["filtered"])
    # A domain shared with the other competitor still names both: that is what Shared links counts.
    shared = next(g for g in theirs["gaps"] if g["domain"] == "unknown.example")
    assert {c["id"] for c in shared["competitors"]} == {first, second} and shared["competitor_count"] == 2
    # The counts are this competitor's own, and every competitor is still listed for the upload choice.
    assert theirs["funnel"]["found"] == len(their_domains) < every["funnel"]["found"]
    assert {c["id"] for c in theirs["competitors"]} == {first, second}


def test_link_gaps_for_an_unknown_or_unreadable_competitor_id(world):
    _two_rivals(world)
    assert world.client.get(f"/api/link-gaps?site_id={world.own}&competitor_id=999999").get_json()["gaps"] == []
    # Not a number: read as no competitor, the whole list, as page-pairs does.
    whole = world.client.get(f"/api/link-gaps?site_id={world.own}").get_json()
    assert world.client.get(f"/api/link-gaps?site_id={world.own}&competitor_id=abc").get_json()["funnel"] == whole["funnel"]


def test_link_gaps_for_one_competitor_ask_no_more_queries_than_for_all(world):
    first, second = _two_rivals(world)
    every = _count(world, f"/api/link-gaps?site_id={world.own}")
    assert _count(world, f"/api/link-gaps?site_id={world.own}&competitor_id={second}") == every
    assert _count(world, f"/api/link-gaps?site_id={world.own}&competitor_id={first}") == every


def test_page_pairs_for_one_competitor_hold_only_its_pairs(world):
    first, second = add_rival(world), add_rival(world, "rival-two.example")
    with world.engine.begin() as conn:
        for n, rival in enumerate((first, first, second)):
            conn.execute(
                text("INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, source, hidden) VALUES (:s, :c, :m, :h, :t, 'manual', 0)"),
                {"s": world.own, "c": rival, "m": f"https://me.example/p{n}", "h": f"h{n}", "t": f"https://rival.example/p{n}"},
            )
    every = world.client.get(f"/api/page-pairs?site_id={world.own}").get_json()["pairs"]
    theirs = world.client.get(f"/api/page-pairs?site_id={world.own}&competitor_id={second}").get_json()["pairs"]
    assert len(every) == 3 and [p["competitor_id"] for p in theirs] == [second]
    assert _count(world, f"/api/page-pairs?site_id={world.own}&competitor_id={first}") == _count(world, f"/api/page-pairs?site_id={world.own}")


def test_ai_watch_for_one_competitor_keeps_only_its_changes_and_every_keyword(world):
    first, second = add_rival(world), add_rival(world, "rival-two.example")
    seed(world.engine, world.own, "k", ["me.example/a"], ai=ABSENT)
    seed(world.engine, world.own, "k", ["me.example/a"], ai=PRESENT, cited=["me.example/a", "rival.example/b"])
    seed(world.engine, world.own, "j", ["me.example/a"], ai=PRESENT, cited=["rival-two.example/b"])
    seed(world.engine, world.own, "j", ["me.example/a"], ai=PRESENT, cited=["rival.example/c"])
    every = ai_watch.watch(world.engine, world.own)
    theirs = world.client.get(f"/api/ai-watch?site_id={world.own}&competitor_id={first}").get_json()
    assert {c["kind"] for c in every["changes"]} > {"rival_cited"}
    assert theirs["changes"] and all(c["competitor_id"] == first for c in theirs["changes"])
    assert {(c["keyword"], c["kind"]) for c in theirs["changes"]} == {("k", "rival_cited"), ("j", "rival_cited")}
    # The rows and the counts stay whole: the page picks the keywords citing them, and says of how many overviews.
    assert theirs["keywords"] == every["keywords"] and theirs["summary"] == every["summary"]
    assert world.client.get(f"/api/ai-watch?site_id={world.own}&competitor_id={second}").get_json()["changes"] == [
        c for c in every["changes"] if c.get("competitor_id") == second]
    assert _count(world, f"/api/ai-watch?site_id={world.own}&competitor_id={first}") == _count(world, f"/api/ai-watch?site_id={world.own}")
