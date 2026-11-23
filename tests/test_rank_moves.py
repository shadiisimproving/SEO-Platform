"""The one Up / Down rule for keywords (seo/serp/moves.py, owner's SEO decision 2026-11-23): a move of 1 place or more,
lost counts as Down, new as Up; on Search Console (the trend line's first 7 days against its last 7) and on our checks."""
from datetime import date, timedelta

from sqlalchemy import text

from seo.collectors.common import digest
from seo.serp import moves, rankings
from tests.test_insights_mix import check, keyword
from tests.test_search import END, site  # noqa: F401

HOME = "https://shop-one.test/"


def kind(was_i, was_p, now_i, now_p, covered=True):
    found = moves.search_console(was_i, was_p * was_i, now_i, now_p * now_i, covered)
    return found and found["kind"]


def test_one_place_is_the_threshold():
    assert kind(20, 6.0, 20, 5.0) == "up"
    assert kind(20, 5.0, 20, 6.0) == "down"
    assert kind(20, 5.0, 20, 5.9) == "same"  # 0.9 of a place: no move
    assert kind(20, 5.4, 20, 4.8) == "same"  # half a place counted before 2026-11-23, not now
    assert moves.search_console(20, 120.0, 20, 100.0)["places"] == 1.0


def test_lost_is_down_and_new_is_up():
    assert kind(20, 4.0, 0, 0) == "lost" and moves.direction("lost") == -1
    assert kind(0, 0, 20, 4.0) == "new" and moves.direction("new") == 1
    assert kind(5, 4.0, 0, 0) is None  # 5 impressions before: too few to say it ranked
    assert kind(5, 4.0, 20, 4.0) is None  # a few before: neither new nor a move
    assert kind(0, 0, 20, 4.0, covered=False) is None  # data doesn't reach the first window: never "new"
    assert [moves.direction(k) for k in ("up", "down", "same", "out", None)] == [1, -1, 0, 0, 0]


def test_of_checks_reads_the_like_for_like_move():
    assert moves.of_checks({"move": "lost", "was": 4, "change": None, "main": {"p": None}}) == {"kind": "lost", "was": 4, "now": None, "places": 0}
    assert moves.of_checks({"move": "up", "was": 8, "change": 5, "main": {"p": 3}})["places"] == 5
    assert moves.of_checks({"move": None}) is None


def days(engine, site_id, words, positions, shown=20):
    """Search Console rows `back` days before END: {back: position}."""
    with engine.begin() as conn:
        for back, position in positions.items():
            conn.execute(
                text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 0, :i, :p)"),
                {"s": site_id, "d": END - timedelta(days=back), "h": digest(words), "q": words, "i": shown, "p": position},
            )


def by_name(listing):
    return {row["keyword"]: row for row in listing["rows"]}


def test_keywords_rows_carry_the_search_console_move_and_the_tiles_count_it(engine, site):
    for words in ("lost passport", "golden visa", "company formation", "freezone licence", "steady one"):
        keyword(engine, site, words)
    first, last = range(21, 28), range(7)
    days(engine, site, "lost passport", {**{b: 8.0 for b in first}, **{b: 5.0 for b in last}})  # up 3
    days(engine, site, "golden visa", {b: 4.0 for b in first})  # lost
    days(engine, site, "company formation", {b: 6.0 for b in last})  # new
    days(engine, site, "freezone licence", {**{b: 3.0 for b in first}, **{b: 4.0 for b in last}})  # down 1, exactly the threshold
    days(engine, site, "steady one", {**{b: 3.0 for b in first}, **{b: 3.6 for b in last}})  # 0.6: no move
    listing = rankings.listing(engine, site)
    rows = by_name(listing)
    assert {k: (r["gsc_move"] or {}).get("kind") for k, r in rows.items()} == {
        "lost passport": "up", "golden visa": "lost", "company formation": "new", "freezone licence": "down", "steady one": "same",
    }
    assert rows["golden visa"]["gsc_move"]["was"] == 4.0 and rows["golden visa"]["gsc_move"]["now"] is None
    assert all("i" in point for point in rows["lost passport"]["gsc_daily"])
    assert listing["tiles"]["google"]["search_console"] == {"up": 2, "down": 2, "lost": 1, "new": 1}
    assert listing["tiles"]["bing"]["search_console"] is None


def test_our_checks_tiles_count_lost_and_new(engine, site):
    lost, new, up = keyword(engine, site, "lost passport"), keyword(engine, site, "golden visa"), keyword(engine, site, "company formation")
    check(engine, lost, [(4, HOME)], ago=3)
    check(engine, lost, [(4, "https://rival.test/")], ago=1)
    check(engine, new, [(3, "https://rival.test/")], ago=3)
    check(engine, new, [(6, HOME)], ago=1)
    check(engine, up, [(5, HOME)], ago=3)
    check(engine, up, [(4, HOME)], ago=1)  # one place: a move
    tiles = rankings.listing(engine, site)["tiles"]["google"]
    assert (tiles["up"], tiles["down"], tiles["lost"], tiles["new"]) == (2, 1, 1, 1)


def test_by_bucket_search_console_positions_say_lost_and_new(engine, site):
    keyword(engine, site, "golden visa")
    keyword(engine, site, "company formation")
    days(engine, site, "golden visa", {b: 4.0 for b in range(14, 21)})
    days(engine, site, "company formation", {b: 6.0 for b in range(7)})
    found = rankings.gsc_positions(engine, site, END - timedelta(days=14), END)
    moved = {key: (row["move"] or {}).get("kind") for key, row in found["rows"].items()}
    assert sorted(moved.values()) == ["lost", "new"]
    # Asked about a "before" earlier than Search Console's first day: no move at all, never "new".
    early = rankings.gsc_positions(engine, site, date(2026, 1, 1), END)
    assert all(row["move"] is None for row in early["rows"].values())


def test_the_keywords_export_counts_up_and_down_on_the_ranking_the_chips_used(engine, site):
    from seo.exports import views_search

    for words in ("lost passport", "golden visa"):
        keyword(engine, site, words)
    days(engine, site, "lost passport", {**{b: 8.0 for b in range(21, 28)}, **{b: 5.0 for b in range(7)}})  # Search Console: up
    days(engine, site, "golden visa", {b: 4.0 for b in range(21, 28)})  # Search Console: lost

    def tiles(source):
        report = views_search.keywords(engine, {"site_id": str(site), "engine": "google", "source": source})
        return {tile.label: tile.value for tile in report.tiles}

    assert (tiles("gsc")["Moved up"], tiles("gsc")["Moved down"]) == (1, 1)
    assert (tiles("checks")["Moved up"], tiles("checks")["Moved down"]) == (0, 0)  # no checks yet
