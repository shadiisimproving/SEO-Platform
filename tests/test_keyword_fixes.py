"""Keyword numbers made true (expert review 2026-11-17, fixes #1, #6, #9, #10, #15, #16 and the Refresh that one engine stopped).

Every number here is worked out by hand in the test, so a wrong rule can't pass by agreeing with itself.
"""
import hashlib
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
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, UTC_DATE(), 'q', 'moulin', 3, 90, 4.0)"), {"s": world.site})
        conn.execute(text(
            "INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, UTC_DATE(), 'p1', 'moulin', :u, 3, 90, 4.0)"
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


# ---- #6 accents and case: one key ---------------------------------------------------------------------------------------


def test_the_keyword_key_folds_latin_accents_and_case_but_not_other_scripts():
    assert store.keyword_key("Café  en Grains") == store.keyword_key("cafe en grains") == "cafe en grains"
    assert store.keyword_key("Création société Dubaï") == "creation societe dubai"
    assert store.keyword_key("bœuf") == "boeuf"
    assert store.keyword_key("がっこう") != store.keyword_key("かっこう")  # Japanese marks change the word: kept
    assert store.keyword_hash("café") == store.keyword_hash("CAFE")
    assert store.clean_keyword("Café  en Grains") == "Café en Grains"  # the text shown stays as typed


def test_search_console_spellings_add_up_under_the_tracked_keyword(world):
    [k] = track(world, "café en grains")
    with world.engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES "
            "(:s, UTC_DATE(), 'a', 'cafe en grains', 20, 560, 6.5), (:s, UTC_DATE(), 'b', 'café en grains', 2, 40, 8.0)"
        ), {"s": world.site})
    row = next(r for r in rankings.listing(world.engine, world.site)["rows"] if r["keyword_id"] == k)
    google = row["engines"]["google"]
    assert google["impressions"] == 600 and google["clicks"] == 22
    assert google["own"] == pytest.approx((6.5 * 560 + 8.0 * 40) / 600)  # 6.6, weighted by impressions
    assert row["spellings"] == 2


def test_track_on_an_unaccented_query_does_not_make_a_second_keyword(world):
    track(world, "café en grains")
    answer = keyword_lists.upload(world.engine, world.site, "cafe en grains\nCAFÉ EN GRAINS", country="FR", language="fr")
    assert answer["total"] == 1  # the two spellings in the list are one keyword
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM keywords")).scalar() == 1
        assert conn.execute(text("SELECT keyword FROM keywords")).scalar() == "café en grains"


def test_queries_and_rank_and_clicks_know_the_unaccented_spelling_is_tracked():
    assert search._match("abonnement cafe") == search._match("Abonnement Café")
    assert mix._key("moulin à café") == "moulin a cafe"


# ---- the migration that merges stored twins ---------------------------------------------------------------------------


def _migration():
    path = next(pathlib.Path(__file__).parent.parent.joinpath("migrations", "versions").glob("*_keywords_one_key_for_accents.py"))
    spec = importlib.util.spec_from_file_location("one_key_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _old_hash(words):
    return hashlib.sha256(store.clean_keyword(words).casefold().encode("utf-8")).hexdigest()


def test_the_migration_merges_accent_twins_without_losing_a_check_and_is_safe_twice(world):
    other = world.client.application  # noqa: F841 - the app is built; only the database matters here
    with world.engine.begin() as conn:
        for words in ("café en grains", "cafe en grains", "moulin"):
            conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, 'FR', 'fr')"), {"k": words, "h": _old_hash(words)})
        ids = dict(conn.execute(text("SELECT keyword, id FROM keywords")).all())
        for words in ("café en grains", "cafe en grains"):
            conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": world.site, "k": ids[words]})
        conn.execute(text("INSERT INTO notes (scope, site_id, keyword, keyword_hash, body) VALUES ('keyword', :s, 'Café en grains', :h, 'n')"), {"s": world.site, "h": _old_hash("Café en grains")})
    keep, gone = ids["café en grains"], ids["cafe en grains"]
    save(world, keep, position=5)
    save(world, gone, position=4)
    save(world, gone, position=3, name="bing")
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO credit_ledger (tool, amount, keyword_id) VALUES ('SerpApi', 1, :k)"), {"k": gone})
        conn.execute(text("INSERT INTO tasks (title, about) VALUES ('t', :a)"), {"a": f'{{"items": [{{"kind": "ranking", "ref": "{gone}:google", "label": "x"}}]}}'})
    migration = _migration()
    with world.engine.begin() as conn:
        done = migration.merge_spellings(conn)
    assert done == {"merged": 1, "notes": 1}
    with world.engine.connect() as conn:
        assert dict(conn.execute(text("SELECT keyword, keyword_hash FROM keywords")).all()) == {"café en grains": store.keyword_hash("cafe en grains"), "moulin": store.keyword_hash("moulin")}
        assert conn.execute(text("SELECT keyword_id FROM site_keywords")).scalars().all() == [keep]
        assert conn.execute(text("SELECT COUNT(*) FROM serp_targets WHERE keyword_id = :k"), {"k": keep}).scalar() == 2  # google + bing
        assert conn.execute(text("SELECT COUNT(*) FROM serp_checks c JOIN serp_targets t ON t.id = c.target_id WHERE t.keyword_id = :k"), {"k": keep}).scalar() == 3
        assert conn.execute(text("SELECT keyword_id FROM credit_ledger")).scalar() == keep
        assert f'"{keep}:google"' in conn.execute(text("SELECT about FROM tasks")).scalar()
        assert conn.execute(text("SELECT keyword_hash FROM notes")).scalar() == store.keyword_hash("cafe en grains")
    view = row_of(world, keep)
    assert view["move"] == "up" and view["change"] == 1  # both histories on one line: 5, then 4
    with world.engine.begin() as conn:
        assert migration.merge_spellings(conn) == {"merged": 0, "notes": 0}


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
