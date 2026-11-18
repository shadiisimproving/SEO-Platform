"""Last rankings and links fixes before the deploy (accuracy/final-rankings-links.md, 2026-11-18).

Every expected number is worked out by hand in the test. The sites are made up (.example): real data stays in the live database.
"""
from seo.backlinks import anchors


# ---- 5. a curly apostrophe or a non-breaking space never changes an anchor's kind ------------------------------------


def test_curly_quotes_and_non_breaking_spaces_fold_before_matching():
    keywords = [anchors.clean("création d'entreprise à dubaï")]
    assert keywords == ["creation d entreprise a dubai"]
    assert anchors.clean("création d’entreprise à Dubai") == "creation d entreprise a dubai"
    for mark in ("’", "‘", "ʼ", "'"):
        assert anchors.kind(f"création d{mark}entreprise à Dubai", [], keywords) == anchors.EXACT
    assert anchors.clean("“créer société dubai”") == "creer societe dubai"
    assert anchors.kind("“créer société dubai”", [], ["creer societe dubai"]) == anchors.EXACT


# ---- 1-2. "Tools disagree" also when one tool found me and another didn't; a third tool, never the newest alone, decides --
from sqlalchemy import text  # noqa: E402

from seo.serp import connections, rankings, store  # noqa: E402
from tests.test_refresh import ME, row_of, track, world  # noqa: E402, F401  (world is a fixture)
from tests.test_serp_accuracy import HONEST, put  # noqa: E402


def _competitors_check(world, k):
    return next(c for c in store.latest_checks(world.engine, world.site, "google") if c.keyword_id == k)


def test_found_in_one_tools_top_10_and_missing_from_anothers_is_a_disagreement(world):
    """'cout de la vie dubai': Searlo #9, HasData (newest, top 10) doesn't find me. 10 + 1 - 9 = 2 places, under the gap of 3,
    but #9 is inside the top 10 HasData read: that's a disagreement. No third tool: both answers on the row."""
    [k] = track(world, "cout de la vie dubai")
    searlo = put(world, k, "Searlo", HONEST, hours_ago=2, mine_at=9)
    hasdata = put(world, k, "HasData", HONEST, hours_ago=1)
    view = row_of(world, k)
    assert view["main"]["check_id"] == hasdata and view["main"]["p"] is None
    assert view["disagree"] == {"tools": ["HasData", "Searlo"], "diff": 2, "also": {"check_id": searlo, "tool": "Searlo", "p": 9, "depth": 10}}
    assert _competitors_check(world, k).id == hasdata


def test_a_place_past_the_other_tools_depth_is_no_disagreement(world):
    """Searlo #18 at depth 50, HasData not in its top 10: both can be true."""
    [k] = track(world, "a")
    put(world, k, "Searlo", HONEST + [f"https://t{i}.example/" for i in range(10)], hours_ago=2, mine_at=18, depth=50)
    put(world, k, "HasData", HONEST, hours_ago=1)
    assert row_of(world, k)["disagree"] is None


def test_a_third_tool_settles_it_and_the_newest_miss_is_not_shown(world):
    """'emirates id': Searlo #2 and HasData #2, then SerpApi (newest) not in its top 10. Each #2 is backed by the other tool:
    the newer #2 (HasData) is shown, on Keywords and in Competitors alike, and the row still says the tools disagree."""
    [k] = track(world, "emirates id")
    put(world, k, "Searlo", HONEST, hours_ago=3, mine_at=2)
    hasdata = put(world, k, "HasData", HONEST, hours_ago=2.9, mine_at=2)
    put(world, k, "SerpApi", HONEST, hours_ago=2)
    view = row_of(world, k)
    assert view["main"]["check_id"] == hasdata and view["main"]["p"] == 2
    assert view["disagree"] == {"tools": ["HasData", "SerpApi"], "diff": 9, "backed_by": ["Searlo"]}
    assert _competitors_check(world, k).id == hasdata
    tiles = rankings.listing(world.engine, world.site)["tiles"]["google"]
    assert (tiles["ranked"], tiles["top10"], tiles["not_ranked"]) == (1, 1, 0)


def test_two_tools_apart_with_no_third_show_both_positions(world):
    """'ouvrir entreprise dubai': Searlo #4 (07:45), SerpApi #37 at depth 50 two hours later. The newest stays, with the other."""
    [k] = track(world, "ouvrir entreprise dubai")
    searlo = put(world, k, "Searlo", HONEST, hours_ago=3, mine_at=4)
    serpapi = put(world, k, "SerpApi", HONEST + [f"https://t{i}.example/" for i in range(40)], hours_ago=1, mine_at=37, depth=50)
    view = row_of(world, k)
    assert view["main"]["check_id"] == serpapi and view["main"]["p"] == 37
    assert view["disagree"] == {"tools": ["SerpApi", "Searlo"], "diff": 33, "also": {"check_id": searlo, "tool": "Searlo", "p": 4, "depth": 10}}


def test_a_tool_repeating_itself_never_settles_a_dispute(world):
    """'vivre à dubai': Searlo missed me twice (30 h and 1 h ago), HasData #7 between. Searlo's own second run isn't a third tool."""
    [k] = track(world, "vivre à dubai")
    put(world, k, "Searlo", HONEST, hours_ago=30)
    hasdata = put(world, k, "HasData", HONEST, hours_ago=20, mine_at=7)
    searlo = put(world, k, "Searlo", HONEST + [f"https://t{i}.example/" for i in range(10)], hours_ago=1, depth=20)
    view = row_of(world, k)
    assert view["main"]["check_id"] == searlo
    assert view["disagree"]["also"] == {"check_id": hasdata, "tool": "HasData", "p": 7, "depth": 10} and view["disagree"]["diff"] == 14


def test_a_check_that_may_have_missed_me_backs_only_a_find(world):
    """Bright Data with hidden addresses (suspect, but not marked by the cross-tool rule) found me at #2: it backs HasData's #2
    against Searlo's miss. Had it not found me, it would say nothing."""
    [k] = track(world, "créer société llc dubaï")
    hidden = put(world, k, "Bright Data", HONEST, hours_ago=4, mine_at=2)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET status = 'suspect', error = 'Google hid the address of 7 results in this check, so it can''t say whether you''re there.' WHERE id = :i"), {"i": hidden})
    hasdata = put(world, k, "HasData", HONEST, hours_ago=3, mine_at=2)
    put(world, k, "Searlo", HONEST + [f"https://t{i}.example/" for i in range(10)], hours_ago=1, depth=20)
    assert row_of(world, k)["main"]["check_id"] == hasdata
    assert _competitors_check(world, k).id == hasdata


def test_the_owners_main_tool_still_wins_and_shows_the_other_answer_beside_it(world):
    [k] = track(world, "b")
    serpapi = put(world, k, "SerpApi", HONEST, hours_ago=1)
    put(world, k, "Searlo", HONEST, hours_ago=3, mine_at=2)
    hasdata = put(world, k, "HasData", HONEST, hours_ago=2, mine_at=2)
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO serp_settings (name, value) VALUES ('main_tool', 'SerpApi') ON DUPLICATE KEY UPDATE value = 'SerpApi'"))
    view = row_of(world, k)
    assert view["main"]["check_id"] == serpapi
    assert view["disagree"]["also"]["check_id"] == hasdata and view["disagree"]["also"]["p"] == 2
    assert _competitors_check(world, k).id == serpapi


from tests.test_insights import site  # noqa: E402, F401  (a fixture)
from tests.test_insights_mix import HOME, check, keyword, rival, search_console, signals  # noqa: E402


def test_a_miss_another_tool_of_the_same_days_contradicts_raises_no_drop_and_no_rival_gap(engine, site):
    """'emirates id': France average 6, Searlo #2, then SerpApi not in its top 10: no rank drop. 'vivre à dubai': a rival at
    #1, HasData has me #7, Searlo (newer, top 20) doesn't find me: no rival gap. Where I stand isn't settled."""
    k = keyword(engine, site, "emirates id")
    search_console(engine, site, "emirates id", shown=10, position=6.0)
    check(engine, k, [(2, HOME + "page")], ago=0.3, tool="Searlo")
    check(engine, k, [(1, "https://x.test/")], ago=0.2, tool="SerpApi")
    rival(engine, site)
    v = keyword(engine, site, "vivre à dubai")
    search_console(engine, site, "vivre à dubai", clicks=0, shown=10, position=30.0)
    check(engine, v, [(1, "https://rival.test/a"), (7, HOME + "page")], ago=0.5, tool="HasData")
    check(engine, v, [(1, "https://rival.test/a")], ago=0.1, depth=20, tool="Searlo")
    found = signals(engine, site)[0]
    assert "rank_drop" not in found and "rival_gap" not in found


# ---- 7. stored checks with repeated addresses: each address once, the rows under it moved up --------------------------
import importlib.util  # noqa: E402
from pathlib import Path  # noqa: E402


def _migration():
    path = Path(__file__).parent.parent / "migrations" / "versions" / "20261118_b8d0f2a4c6e9_serp_results_without_repeats.py"
    spec = importlib.util.spec_from_file_location("without_repeats", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_stored_check_with_repeats_reads_its_place_without_them(world):
    """'ouvrir entreprise dubai', check 438: 4 addresses (#1, #2, #7, #24) come back at #10, #11, #13 and #34, and the site is
    at #37. Without the repeats it is 37 - 4 = #33. A hidden row ('') keeps its place and two hidden rows never merge."""
    [k] = track(world, "ouvrir entreprise dubai")
    urls = [f"https://u{i}.example/" for i in range(1, 46)]
    for at, first in ((10, 1), (11, 2), (13, 7), (34, 24)):
        urls[at - 1] = urls[first - 1]
    urls[4] = urls[5] = ""  # #5 and #6: addresses Google hid
    urls[36] = f"https://{ME}/zone-franche/"
    with world.engine.begin() as conn:
        target = store.target_id(conn, k, "google")
        check = conn.execute(text("INSERT INTO serp_checks (target_id, tool, real_location, depth, status, ai_state, trigger_kind, checked_at) VALUES (:t, 'SerpApi', 'FR', 50, 'ok', 'not_captured', 'refresh', UTC_TIMESTAMP(3))"), {"t": target}).lastrowid
        for place, url in enumerate(urls, 1):
            host = url.split("/")[2] if url else "hidden.example"
            conn.execute(text("INSERT INTO serp_results (check_id, position, url, host, domain, title) VALUES (:c, :p, :u, :h, :h, 'T')"), {"c": check, "p": place, "u": url, "h": host})
    assert row_of(world, k)["main"]["p"] == 37
    with world.engine.begin() as conn:
        assert _migration().remove_repeats(conn) == 1
        rows = conn.execute(text("SELECT position, url FROM serp_results WHERE check_id = :c ORDER BY position"), {"c": check}).all()
    assert [r[0] for r in rows] == list(range(1, 42)) and [r[1] for r in rows][4:6] == ["", ""]
    assert len({r[1] for r in rows if r[1]}) == 39
    assert row_of(world, k)["main"]["p"] == 33
    with world.engine.begin() as conn:
        assert _migration().remove_repeats(conn) == 0  # once
