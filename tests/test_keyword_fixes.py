"""Keyword numbers made true (expert review 2026-11-17, fixes #1, #6, #9, #10, #15, #16 and the Refresh that one engine stopped).

Every number here is worked out by hand in the test, so a wrong rule can't pass by agreeing with itself.
"""
import importlib.util
import pathlib

import httpx
import pytest
from sqlalchemy import text

from seo.competitors import keywords as keyword_lists
from seo.insights import mix
from seo.metrics import search
from seo.serp import connections, rankings, refresh, store
from seo.serp.tools import Answer, DuckDuckGoDirect, Found, SerpApi, depth_read
from tests.test_refresh import ME, Fake, ask, row_of, save, track, world  # noqa: F401  (world is a fixture)


def tiles(world):
    return rankings.listing(world.engine, world.site)["tiles"]["google"]


# ---- #1 a keyword that leaves (or enters) the depth checked is a move --------------------------------------------------


def test_a_keyword_that_falls_out_of_the_top_10_is_down_and_takes_one_from_the_top_10(world):
    [k] = track(world, "a")
    save(world, k, position=4)
    save(world, k, position=None)  # depth 10: not in the top 10 any more
    view = row_of(world, k)
    assert view["move"] == "lost" and view["was"] == 4 and view["change"] is None
    tile = tiles(world)
    assert tile["down"] == 1 and tile["up"] == 0 and tile["lost"] == 1 and tile["compared"] == 1
    assert tile["top10_change"] == -1  # was 0 forever at depth 10
    assert tile["top10"] == 0 and tile["not_ranked"] == 1


def test_a_keyword_that_comes_into_the_top_10_is_up_and_adds_one(world):
    [k] = track(world, "a")
    save(world, k, position=None)
    save(world, k, position=6)
    view = row_of(world, k)
    assert view["move"] == "new" and view["was"] is None
    tile = tiles(world)
    assert (tile["up"], tile["down"], tile["new"], tile["top10_change"], tile["compared"]) == (1, 0, 1, 1, 1)


def test_still_out_is_compared_but_neither_up_nor_down_and_never_first_check(world):
    [k] = track(world, "a")
    save(world, k, position=None)
    save(world, k, position=None)
    save(world, k, position=None)
    view = row_of(world, k)
    assert view["move"] == "out" and view["change_note"] is None
    tile = tiles(world)
    assert (tile["up"], tile["down"], tile["top10_change"], tile["compared"]) == (0, 0, 0, 1)


def test_only_one_check_has_no_move(world):
    [k] = track(world, "a")
    save(world, k, position=None)
    assert row_of(world, k)["move"] is None


def test_mixed_moves_add_up_to_the_hand_count(world):
    """Five keywords: 4→out (−1 top 10), out→6 (+1), 12→8 at depth 20 (+1), 3→2 (up, 0), 2→11 at depth 20 (−1)."""
    a, b, c, d, e = track(world, "a", "b", "c", "d", "e")
    save(world, a, position=4), save(world, a, position=None)
    save(world, b, position=None), save(world, b, position=6)
    save(world, c, depth=20, position=12), save(world, c, depth=20, position=8)
    save(world, d, position=3), save(world, d, position=2)
    save(world, e, depth=20, position=2), save(world, e, depth=20, position=11)
    tile = tiles(world)
    assert tile["up"] == 3  # b new, c +4, d +1
    assert tile["down"] == 2  # a lost, e −9
    assert tile["top10_change"] == -1 + 1 + 1 + 0 - 1 == 0
    assert tile["compared"] == 5


# ---- #16 the main tool's result has an age limit ----------------------------------------------------------------------


def test_the_main_tools_result_wins_while_it_is_14_days_old_or_less(world):
    [k] = track(world, "a")
    connections.save_setting(world.engine, "main_tool", "Bright Data")
    save(world, k, tool="Bright Data", position=3, at=None)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 13 DAY"))
    save(world, k, tool="SerpApi", position=15, depth=20)
    view = row_of(world, k)
    assert view["main"]["tool"] == "Bright Data" and "passed_over" not in view["main"] and view["main"]["old"] is False


def test_a_main_tool_result_older_than_14_days_gives_way_to_a_newer_one_and_says_so(world):
    [k] = track(world, "a")
    connections.save_setting(world.engine, "main_tool", "Bright Data")
    save(world, k, tool="Bright Data", position=3)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 120 DAY"))
    save(world, k, tool="SerpApi", position=5)
    view = row_of(world, k)
    assert view["main"]["tool"] == "SerpApi" and view["main"]["p"] == 5 and view["main"]["old"] is False
    assert view["main"]["passed_over"]["tool"] == "Bright Data" and 119.9 < view["main"]["passed_over"]["age_days"] < 120.1
    assert [o["tool"] for o in view["others"]] == ["Bright Data"]
    # Every other screen reads the same choice (store.latest_checks).
    [check] = store.latest_checks(world.engine, world.site, "google")
    assert check.tool == "SerpApi"


def test_an_old_main_result_with_nothing_newer_stays_and_is_marked_old(world):
    [k] = track(world, "a")
    save(world, k, tool="Bright Data", position=3)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 30 DAY"))
    view = row_of(world, k)
    assert view["main"]["tool"] == "Bright Data" and view["main"]["old"] is True


# ---- #15 the page that ranked, apart from Search Console's most-shown page --------------------------------------------


def test_the_page_column_is_the_ranking_url_and_search_consoles_page_is_named_apart(world):
    [k] = track(world, "moulin")
    save(world, k, position=4)  # the check found https://me.example/page
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, UTC_DATE() - INTERVAL 5 DAY, 'q', 'moulin', 3, 90, 4.0)"), {"s": world.site})
        conn.execute(text(
            "INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, UTC_DATE() - INTERVAL 5 DAY, 'p1', 'moulin', :u, 3, 90, 4.0)"
        ), {"s": world.site, "u": f"https://{ME}/other"})
    row = next(r for r in rankings.listing(world.engine, world.site)["rows"] if r["keyword_id"] == k)
    assert row["ranking_url"] == f"https://{ME}/page" and row["page"] == f"https://{ME}/page"
    assert row["gsc_page"] == f"https://{ME}/other"
    detail = rankings.detail(world.engine, world.site, k, "google")
    assert [c["url"] for c in detail["checks"]] == [f"https://{ME}/page"]


def test_a_ranking_url_swap_between_two_like_for_like_checks_is_marked(world):
    [k] = track(world, "a")
    save(world, k, position=4)
    store.save_check(world.engine, k, "google", Answer("SerpApi", "FR", 10, [Found(3, f"https://{ME}/new-page", "Mine")], "not_captured", [], 1), "refresh")
    view = row_of(world, k)
    assert view["change"] == 1 and view["url_changed"] is True


# ---- #6 accents: folded to match Search Console, never to merge keywords -----------------------------------------------
# Google ranks "créer société dubai" and "creer societe dubai" differently (live, 2026-11-17: 46 against 7), and the owner
# tracks both on purpose. So a keyword's identity keeps its accents; only the matching of engine numbers folds them.


def test_the_matching_key_folds_latin_accents_and_case_but_the_identity_keeps_accents():
    assert store.keyword_key("Café  en Grains") == store.keyword_key("cafe en grains") == "cafe en grains"
    assert store.keyword_key("Création société Dubaï") == "creation societe dubai"
    assert store.keyword_key("bœuf") == "boeuf"
    assert store.keyword_key("がっこう") != store.keyword_key("かっこう")  # Japanese marks change the word: kept
    assert store.keyword_hash("café") != store.keyword_hash("cafe")  # two spellings, two keywords
    assert store.keyword_hash("CAFÉ") == store.keyword_hash("café")  # case and spacing still don't split one
    assert store.clean_keyword("Café  en Grains") == "Café en Grains"


def _two_spellings_in_search_console(world):
    with world.engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES "
            "(:s, UTC_DATE() - INTERVAL 5 DAY, 'a', 'cafe en grains', 20, 560, 6.5), (:s, UTC_DATE() - INTERVAL 5 DAY, 'b', 'café en grains', 2, 40, 8.0)"
        ), {"s": world.site})


def _rows(world):
    return {r["keyword"]: r for r in rankings.listing(world.engine, world.site)["rows"]}


def test_one_spelling_tracked_gets_every_spelling_added_up_and_says_so(world):
    track(world, "café en grains")
    _two_spellings_in_search_console(world)
    row = _rows(world)["café en grains"]
    google = row["engines"]["google"]
    assert google["impressions"] == 560 + 40 == 600 and google["clicks"] == 22
    assert google["own"] == pytest.approx((6.5 * 560 + 8.0 * 40) / 600)  # 6.6, weighted by impressions
    assert row["other_spellings"] is True


def test_both_spellings_tracked_each_gets_only_its_own_query_and_nothing_counts_twice(world):
    track(world, "café en grains", "cafe en grains")
    _two_spellings_in_search_console(world)
    rows = _rows(world)
    assert (rows["cafe en grains"]["impressions"], rows["cafe en grains"]["engines"]["google"]["own"]) == (560, 6.5)
    assert (rows["café en grains"]["impressions"], rows["café en grains"]["engines"]["google"]["own"]) == (40, 8.0)
    assert rows["cafe en grains"]["other_spellings"] is False and rows["café en grains"]["other_spellings"] is False
    # The keyword panel asks for one keyword: it still knows the site tracks both spellings.
    k = rows["café en grains"]["keyword_id"]
    assert rankings.detail(world.engine, world.site, k, "google")["row"]["impressions"] == 40


def test_rank_and_clicks_follows_the_same_rule():
    shared = store.shared_keys(["café en grains", "cafe en grains", "moulin à café"])
    assert shared == {"cafe en grains"}
    assert mix._key("CAFE en grains", shared) == mix._key("cafe en grains", shared) != mix._key("café en grains", shared)
    assert mix._key("moulin a cafe", shared) == mix._key("moulin à café", shared)  # tracked once: spellings join


def test_worth_tracking_never_suggests_a_spelling_of_a_tracked_keyword():
    assert search._match("abonnement cafe") == search._match("Abonnement Café")


def test_tracking_another_spelling_on_purpose_keeps_both_with_their_own_history(world):
    track(world, "café en grains")
    keyword_lists.upload(world.engine, world.site, "cafe en grains", country="FR", language="fr")
    with world.engine.connect() as conn:
        assert sorted(conn.execute(text("SELECT keyword FROM keywords")).scalars().all()) == ["cafe en grains", "café en grains"]
    assert keyword_lists.parse_keywords("café en grains\ncafe en grains\nCAFE EN GRAINS") == ["café en grains", "cafe en grains"]


def test_the_kept_no_op_migration_upgrades_cleanly_and_changes_nothing(world):
    from alembic import command

    from seo.core.schema import _alembic_config

    track(world, "café en grains", "cafe en grains")
    with world.engine.begin() as conn:
        head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        conn.execute(text("UPDATE alembic_version SET version_num = 'a8b9c0d1e2f3'"))
    try:
        # Only this one step: later migrations (links, page speed) add columns the test schema already has.
        cfg = _alembic_config()
        cfg.attributes["engine"] = world.engine
        command.upgrade(cfg, "c5e7a9b1d3f2")
    finally:
        with world.engine.begin() as conn:
            now = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
            conn.execute(text("UPDATE alembic_version SET version_num = :h"), {"h": head})
    assert now == "c5e7a9b1d3f2"
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM keywords")).scalar() == 2
    path = next(pathlib.Path(__file__).parent.parent.joinpath("migrations", "versions").glob("*_c5e7a9b1d3f2_*.py"))
    spec = importlib.util.spec_from_file_location("kept_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert (module.revision, module.down_revision) == ("c5e7a9b1d3f2", "a8b9c0d1e2f3")


# ---- #10 DuckDuckGo saves the depth it really read ---------------------------------------------------------------------


def test_depth_read_rounds_down_to_a_depth_the_app_offers():
    assert depth_read(30, 10) == 10 and depth_read(50, 28) == 20 and depth_read(20, 30) == 20 and depth_read(10, 4) == 10 and depth_read(30, 30) == 30


def _ddg_html(n):
    rows = "".join(f'<div class="result"><a class="result__a" href="https://site{i}.example/">Site {i}</a></div>' for i in range(n))
    return f"<html><body>{rows}</body></html>".encode()


def test_duckduckgo_direct_asked_for_top_30_with_one_page_of_10_saves_top_10():
    tool = DuckDuckGoDirect(client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=_ddg_html(10)))), sleep=lambda s: None)
    answer = tool.search("cafe", "duckduckgo", "FR", "fr", "desktop", 30)
    assert len(answer.results) == 10 and answer.depth == 10


@pytest.mark.parametrize("which", ["direct", "serpapi"])
def test_top_30_asked_25_read_saves_top_20_and_never_a_position_past_it(which):
    """Review case: 25 results read, my site at #23. Saved depth 20, so #23 must not be kept: it reads as ">20"."""
    if which == "direct":
        html = _ddg_html(25).replace(b"https://site22.example/", b"https://me.example/")
        tool = DuckDuckGoDirect(client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=html))), sleep=lambda s: None)
    else:
        page = {"organic_results": [{"position": i + 1, "link": "https://me.example/" if i == 22 else f"https://site{i}.example/", "title": "T"} for i in range(25)]}
        tool = SerpApi("k", client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=page))))
    answer = tool.search("cafe", "duckduckgo", "FR", "fr", "desktop", 30)
    assert answer.depth == 20 and len(answer.results) == 20
    assert all(found.position <= answer.depth for found in answer.results)
    assert not any("me.example" in found.url for found in answer.results)


def test_serpapi_duckduckgo_reads_one_page_and_saves_what_it_read():
    page = {"organic_results": [{"position": i + 1, "link": f"https://site{i}.example/", "title": "T"} for i in range(10)]}
    tool = SerpApi("k", client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=page))))
    answer = tool.search("cafe", "duckduckgo", "FR", "fr", "desktop", 50)
    assert answer.depth == 10 and answer.charged == 1
    bing = tool.search("cafe", "bing", "FR", "fr", "desktop", 10)
    assert bing.depth == 10


# ---- Section 2: an engine no tool can search is skipped, and the run still finishes ------------------------------------


def test_an_engine_with_no_tool_is_skipped_with_a_sentence_and_the_run_finishes(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    ids = track(world, "one", "two")
    preview = refresh.preview(world.engine, ask(ids, engines=["google", "yandex"]))
    assert preview["checks"] == 2 and preview["unassigned"] == 0 and preview["runs_out_after"] is None and preview["no_tools_for"] == ["yandex"]
    started = refresh.start(world.engine, ask(ids, engines=["google", "yandex"]))
    assert started["total"] == 2
    world.drain()
    run = refresh.run_dict(world.engine, started["id"])
    assert run["status"] == "done" and run["done"] == 2 and run["not_run"] == 0
    assert run["stop_reason"] == "No tool can search Yandex, so it was skipped. Connect one in Settings."
