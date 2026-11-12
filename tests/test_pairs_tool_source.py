"""Page vs page: every position in the pairs list names the tool and check it came from (2026-11-12).

On the real test database: checks saved as the worker saves them, by two made-up-site tools, then read back through the API."""
from sqlalchemy import text

from seo.competitors import pairs
from tests.test_competitors_backend import add_rival, seed, world  # noqa: F401 - world is the shared fixture


def _check_row(engine, check_id):
    with engine.connect() as conn:
        return conn.execute(text("SELECT tool, checked_at FROM serp_checks WHERE id = :i"), {"i": check_id}).mappings().first()


def test_each_pair_keyword_carries_the_tool_date_and_check_of_its_positions(world):
    rival = add_rival(world)
    first = seed(world.engine, world.own, "beans", ["https://rival.example/a", "https://me.example/a"], tool="SerpApi")
    other = seed(world.engine, world.own, "grinder", ["https://me.example/a", "https://x.example/1", "https://rival.example/a"], tool="Bright Data")
    pairs.refresh_auto_pairs(world.engine, world.own)
    keywords = {k["keyword"]: k for k in pairs.list_pairs(world.engine, world.own, rival)[0]["ranking"]["keywords"]}
    for name, check_id, tool in (("beans", first, "SerpApi"), ("grinder", other, "Bright Data")):
        saved = _check_row(world.engine, check_id)
        k = keywords[name]
        assert (k["tool"], k["check_id"], k["engine"]) == (tool, check_id, "google")
        assert k["checked_at"].startswith(saved["checked_at"].strftime("%Y-%m-%dT%H:%M:%S"))
    assert (keywords["beans"]["my_position"], keywords["beans"]["their_position"]) == (2, 1)


def test_a_newer_check_by_another_tool_replaces_the_source_with_both_positions(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "beans", ["https://rival.example/a", "https://me.example/a"], tool="SerpApi")
    newer = seed(world.engine, world.own, "beans", ["https://me.example/a", "https://rival.example/a"], tool="HasData")
    pairs.refresh_auto_pairs(world.engine, world.own)
    pair = pairs.list_pairs(world.engine, world.own, rival)[0]
    k = pair["ranking"]["keywords"][0]
    # Both positions move together with the tool: never my position from one tool and theirs from another.
    assert (k["my_position"], k["their_position"], k["tool"], k["check_id"]) == (1, 2, "HasData", newer)
    sent = world.client.get(f"/api/page-pairs?site_id={world.own}").get_json()
    row = next(p for p in sent["pairs"] if p["id"] == pair["id"])["ranking"]["keywords"][0]
    assert (row["tool"], row["check_id"]) == ("HasData", newer) and row["checked_at"] == k["checked_at"]


def test_a_keyword_only_one_side_ranks_for_still_names_its_tool(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "beans", ["https://rival.example/a", "https://me.example/a"], tool="SerpApi")
    seed(world.engine, world.own, "only them", ["https://rival.example/a"], tool="Searlo")
    pairs.refresh_auto_pairs(world.engine, world.own)
    keywords = {k["keyword"]: k for k in pairs.list_pairs(world.engine, world.own, rival)[0]["ranking"]["keywords"]}
    assert keywords["only them"]["my_position"] is None and keywords["only them"]["tool"] == "Searlo"
