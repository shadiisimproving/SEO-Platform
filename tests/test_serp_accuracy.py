"""Rank checks made true (expert review 2026-11-17, accuracy/rankings.md 3.1-3.8, analytics.md W4, search-console.md 3.2).

Every expected number is worked out by hand in the test, so a wrong rule can't pass by agreeing with itself. The sites are
made up (.example): real data stays in the live database.
"""
import json

import httpx
from sqlalchemy import text

from seo.serp import store
from seo.serp.tools import SerpApi

# ---- 1. SerpApi: what it searched, from where, and each address once -------------------------------------------------


def _serpapi(*pages, seen=None):
    queue = list(pages)

    def answer(request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(200, content=json.dumps(queue.pop(0)).encode())

    return SerpApi("SECRETKEY", client=httpx.Client(transport=httpx.MockTransport(answer)))


def _page(urls, **extra):
    return {"organic_results": [{"position": i + 1, "link": url, "title": "T"} for i, url in enumerate(urls)], **extra}


def test_serpapi_searches_from_the_keywords_country_with_its_google_domain_and_no_num():
    seen = []
    _serpapi(_page(["https://one.example/"]), seen=seen).search("créer société dubai", "google", "FR", "fr", "desktop", 10)
    params = seen[0].url.params
    assert params["location"] == "France" and params["google_domain"] == "google.fr" and params["gl"] == "fr" and params["hl"] == "fr"
    assert "num" not in params


def test_a_country_serpapi_has_no_name_for_still_sends_gl_alone():
    seen = []
    _serpapi(_page(["https://one.example/"]), seen=seen).search("x", "google", "XK", "sq", "desktop", 10)
    params = seen[0].url.params
    assert params["gl"] == "xk" and "location" not in params and "google_domain" not in params


def test_serpapi_keeps_what_it_searched_with_and_the_query_its_page_showed():
    body = _page(["https://one.example/"], search_parameters={"engine": "google", "q": "vivre à dubai", "google_domain": "google.fr", "api_key": "LEAK"},
                 search_information={"query_displayed": "vivre"})
    answer = _serpapi(body).search("vivre à dubai", "google", "FR", "fr", "desktop", 10)
    assert answer.query_shown == "vivre"
    assert answer.asked == {"engine": "google", "q": "vivre à dubai", "google_domain": "google.fr"}  # never the key


def test_an_address_on_two_serpapi_pages_counts_once_and_the_rows_under_it_move_up():
    """Page 1: a, b, c … j (10). Page 2 repeats a (Google's #1 again at #11), then k, l. Without repeats: k is #11, l #12."""
    first = [f"https://{c}.example/" for c in "abcdefghij"]
    found = _serpapi(_page(first), _page(["https://a.example/", "https://k.example/", "https://l.example/"])).search("x", "google", "FR", "fr", "desktop", 20)
    assert [(row.position, row.url) for row in found.results][-3:] == [(10, "https://j.example/"), (11, "https://k.example/"), (12, "https://l.example/")]
    assert len(found.results) == 12 and found.charged == 2


# ---- 1-2. a check about another query, or one every other tool contradicts, is suspect -------------------------------
from seo.serp.tools import Answer, Found  # noqa: E402
from tests.test_refresh import ME, track, world  # noqa: E402, F401  (world is a fixture)

HONEST = [f"https://s{i}.example/p" for i in range(10)]  # the page every honest tool sees
WRONG = [f"https://w{i}.example/p" for i in range(10)]  # another query's page


def put(world, keyword_id, tool, urls, hours_ago=0.0, mine_at=None, ai="not_captured", cited=(), shown="", depth=10):
    rows = [Found(i + 1, url, "T") for i, url in enumerate(urls)]
    if mine_at:
        rows[mine_at - 1] = Found(mine_at, f"https://{ME}/", "Mine")
    answer = Answer(tool, "FR", depth, rows, ai, list(cited), 1, {}, shown)
    check = store.save_check(world.engine, keyword_id, "google", answer, "refresh")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL :m MINUTE WHERE id = :i"), {"m": int(hours_ago * 60), "i": check})
    return check


def status(world, check_id):
    with world.engine.connect() as conn:
        return tuple(conn.execute(text("SELECT status, error FROM serp_checks WHERE id = :i"), {"i": check_id}).one())


def rejudge(world, keyword_id):
    with world.engine.begin() as conn:
        target = conn.execute(text("SELECT id FROM serp_targets WHERE keyword_id = :k AND engine = 'google'"), {"k": keyword_id}).scalar()
        return store.judge_target(conn, target)




def test_a_page_that_showed_another_query_is_suspect_with_the_query_named(world):
    [k] = track(world, "vivre à dubai")
    check = put(world, k, "SerpApi", HONEST, shown="vivre")
    assert status(world, check) == ("suspect", "SerpApi's page showed results for “vivre”, not for this keyword.")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT query_shown FROM serp_checks WHERE id = :i"), {"i": check}).scalar() == "vivre"


def test_the_same_query_with_other_accents_or_case_is_not_another_query(world):
    [k] = track(world, "creer societe dubai")
    assert status(world, put(world, k, "SerpApi", HONEST, shown="Créer Société Dubaï"))[0] == "ok"


def test_a_check_two_other_tools_contradict_together_is_suspect_and_never_shown(world):
    """HasData and Searlo see the same 10 sites within the hour; SerpApi's page shares 3 of them (fewer than 4)."""
    [k] = track(world, "creer societe dubai")
    hasdata = put(world, k, "HasData", HONEST, hours_ago=2, mine_at=1)
    searlo = put(world, k, "Searlo", HONEST[:8] + ["https://x1.example/", "https://x2.example/"], hours_ago=1.5, mine_at=1)
    serpapi = put(world, k, "SerpApi", HONEST[:3] + WRONG[:7], hours_ago=1)  # newest, but wrong: we're not in it
    assert status(world, hasdata)[0] == status(world, searlo)[0] == "ok"
    state, why = status(world, serpapi)
    assert state == "suspect" and why.startswith("Shares fewer than 4 of its top 10 sites with ")
    from tests.test_refresh import row_of
    view = row_of(world, k)
    assert view["main"]["tool"] == "Searlo" and view["main"]["p"] == 1  # the newest check that isn't suspect
    assert [s["check_id"] for s in view["suspects"]] == [serpapi]


def test_an_older_check_becomes_suspect_when_two_later_tools_agree_against_it(world):
    [k] = track(world, "ouvrir societe dubai")
    serpapi = put(world, k, "SerpApi", WRONG, hours_ago=3)
    assert status(world, serpapi)[0] == "ok"  # alone, nothing to judge by
    put(world, k, "HasData", HONEST, hours_ago=2)
    assert status(world, serpapi)[0] == "ok"  # two tools that disagree prove nothing yet
    put(world, k, "Searlo", HONEST, hours_ago=1)
    assert status(world, serpapi)[0] == "suspect"


def test_two_tools_that_only_disagree_with_each_other_are_both_kept(world):
    [k] = track(world, "a")
    one, two = put(world, k, "HasData", HONEST, hours_ago=2), put(world, k, "Searlo", WRONG, hours_ago=1)
    assert status(world, one)[0] == status(world, two)[0] == "ok" and rejudge(world, k) == []


def test_a_check_its_own_tool_backs_is_kept_and_checks_two_days_apart_never_judge_each_other(world):
    [k] = track(world, "b")
    put(world, k, "Searlo", WRONG, hours_ago=30)
    searlo = put(world, k, "Searlo", WRONG, hours_ago=1)  # the same answer twice: a real page, not a glitch
    put(world, k, "HasData", HONEST, hours_ago=2), put(world, k, "SerpApi", HONEST, hours_ago=2)
    assert status(world, searlo)[0] == "ok"
    [far] = track(world, "c")
    old = put(world, far, "SerpApi", WRONG, hours_ago=60)
    put(world, far, "HasData", HONEST, hours_ago=2), put(world, far, "Searlo", HONEST, hours_ago=1)
    assert status(world, old)[0] == "ok"  # 58 hours apart: Google may really have changed


# ---- 3. one rule picks the check every screen shows ------------------------------------------------------------------


def test_keywords_and_competitors_show_the_same_check(world):
    """SerpApi first in the order but oldest; HasData newest from France; Searlo newer still but from the UAE (away)."""
    from tests.test_refresh import row_of

    [k] = track(world, "creer societe dubai")
    put(world, k, "SerpApi", HONEST, hours_ago=5, mine_at=7)
    hasdata = put(world, k, "HasData", HONEST, hours_ago=3, mine_at=1)
    away = store.save_check(world.engine, k, "google", Answer("Searlo", "AE", 10, [Found(1, f"https://{ME}/", "M")], "not_captured", [], 1), "refresh")
    assert row_of(world, k)["main"]["check_id"] == hasdata
    [check] = store.latest_checks(world.engine, world.site, "google")
    assert check.id == hasdata and check.id != away


def test_the_same_keyword_spelt_with_accents_is_a_witness_and_googles_own_links_are_not_a_site(world):
    """Only Searlo checked "creer societe dubai" beside SerpApi; HasData checked "créer société dubai". Both see HONEST."""
    plain, accented = track(world, "creer societe dubai", "créer société dubai")
    put(world, plain, "Searlo", HONEST, hours_ago=3)
    put(world, accented, "HasData", HONEST, hours_ago=2)
    serpapi = put(world, plain, "SerpApi", WRONG, hours_ago=1)
    assert status(world, serpapi)[0] == "suspect"
    [other] = track(world, "d")
    put(world, other, "Searlo", HONEST, hours_ago=3)
    put(world, other, "Bright Data", ["https://www.google.com/goto?url=CAES"] * 10, hours_ago=2)  # google.com rows: no witness
    lone = put(world, other, "SerpApi", WRONG, hours_ago=1)
    assert status(world, lone)[0] == "ok"


def test_the_script_marks_stored_checks_by_the_same_rule_dry_run_first_and_only_once(world):
    import importlib.util
    import pathlib

    spec = importlib.util.spec_from_file_location("mark", pathlib.Path(__file__).resolve().parent.parent / "scripts" / "mark_contradicted_checks.py")
    mark = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mark)
    [k] = track(world, "e")
    serpapi = put(world, k, "SerpApi", WRONG, hours_ago=3)
    with world.engine.begin() as conn:  # as saved before the rule existed: two agreeing checks, nobody judged
        conn.execute(text("INSERT INTO serp_checks (target_id, tool, real_location, depth, status, checked_at) SELECT target_id, 'HasData', 'FR', 10, 'ok', checked_at FROM serp_checks WHERE id = :i"), {"i": serpapi})
        conn.execute(text("INSERT INTO serp_checks (target_id, tool, real_location, depth, status, checked_at) SELECT target_id, 'Searlo', 'FR', 10, 'ok', checked_at FROM serp_checks WHERE id = :i"), {"i": serpapi})
        for check_id in (serpapi + 1, serpapi + 2):
            for i, url in enumerate(HONEST):
                conn.execute(text("INSERT INTO serp_results (check_id, position, url, host, domain, title) VALUES (:c, :p, :u, :h, :h, 'T')"), {"c": check_id, "p": i + 1, "u": url, "h": f"s{i}.example"})
    monkey = mark.run(world.engine, apply=False)
    assert [i for i, _ in monkey["marked"]] == [serpapi] and status(world, serpapi)[0] == "ok"
    done = mark.run(world.engine, apply=True)
    assert done["tools"] == {"SerpApi on google": 1} and status(world, serpapi)[0] == "suspect"
    assert mark.run(world.engine, apply=True)["marked"] == []


# ---- 4. the AI Overview watch reads the tool that can see AI Overviews ------------------------------------------------


def test_the_ai_overview_watch_uses_the_newest_check_that_looked_and_names_its_tool(world):
    """3 keywords. a: SerpApi saw an overview citing us, then Searlo (blind to them) checked later. b: SerpApi saw none.
    c: only Searlo. Truth: 2 checked (with SerpApi), 1 overview, cited in 1, 1 not checked."""
    from seo.competitors import ai_watch

    a, b, c = track(world, "a", "b", "c")
    put(world, a, "SerpApi", HONEST, hours_ago=30, ai="present", cited=[f"https://{ME}/guide"])
    put(world, a, "Searlo", HONEST, hours_ago=1)
    put(world, b, "SerpApi", HONEST, hours_ago=30, ai="absent")
    put(world, c, "Searlo", HONEST, hours_ago=1)
    watch = ai_watch.watch(world.engine, world.site)
    s = watch["summary"]
    assert (s["tracked"], s["captured"], s["with_overview"], s["cited_me"], s["not_captured"], s["tools"]) == (3, 2, 1, 1, 1, ["SerpApi"])
    rows = {r["keyword"]: r for r in watch["keywords"]}
    assert rows["a"]["tool"] == "SerpApi" and rows["a"]["state"] == "present" and rows["a"]["cited_me"] is True
    assert rows["c"]["not_checked"] is True and rows["c"]["tool"] is None


# ---- 6. old DuckDuckGo checks saved deeper than they read ------------------------------------------------------------


def test_old_duckduckgo_checks_that_read_one_page_answer_top_10(world):
    """Saved before depth_read: asked Top 20, read 10 (we're not in them) → Top 10. One that really holds 15 stays Top 20."""
    import importlib.util
    import pathlib

    from tests.test_refresh import row_of

    [k] = track(world, "vivre a dubai")
    one_page = store.save_check(world.engine, k, "duckduckgo", Answer("Bright Data", "fr-fr", 20, [Found(i + 1, u, "T") for i, u in enumerate(HONEST)], "not_captured", [], 1))
    deep = store.save_check(world.engine, k, "duckduckgo", Answer("SerpApi", "fr-fr", 20, [Found(i + 1, f"https://d{i}.example/", "T") for i in range(15)], "not_captured", [], 1))
    path = next((pathlib.Path(__file__).resolve().parent.parent / "migrations" / "versions").glob("*_f2a4c6e8b0d1_*.py"))
    spec = importlib.util.spec_from_file_location("m", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with world.engine.begin() as conn:
        conn.execute(text(migration.READ_DEPTH))
        depths = dict(conn.execute(text("SELECT id, depth FROM serp_checks")).all())
    assert depths == {one_page: 10, deep: 20}
    view = row_of(world, k, "duckduckgo")
    assert [(o["tool"], o["depth"]) for o in [view["main"], *view["others"]]] == [("SerpApi", 20), ("Bright Data", 10)]
