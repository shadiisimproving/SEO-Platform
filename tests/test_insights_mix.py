"""Rank and clicks: saved rank checks read beside Search Console. Each signal fires, and stays quiet where the two sources
can't honestly be compared: another country, another depth, an old check, a place beyond the depth checked."""
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from seo.collectors.common import digest
from seo.insights import data, engine as insights, mix, movement, rules, service
from seo.serp import store
from seo.serp.tools import Answer, Found
from tests.test_insights import BEFORE, END, FRESH, NOW, World, _found, site  # noqa: F401

HOME = "https://shop-one.test/"


def keyword(engine, site, words, country="fr", language="fr"):
    with engine.begin() as conn:
        kid = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, :l)"), {"k": words, "h": store.keyword_hash(words), "c": country, "l": language}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
    return kid


def check(engine, kid, results, ago=1, depth=10, location="FR", tool="SerpApi", ai="not_captured", cited=()):
    at = (datetime.now(UTC) - timedelta(days=ago)).strftime("%Y-%m-%d %H:%M:%S")
    return store.save_check(engine, kid, "google", Answer(tool, location, depth, [Found(p, u) for p, u in results], ai_state=ai, ai_citations=list(cited)), "refresh", at=at)


def search_console(engine, site, words, page=HOME + "page", clicks=1, shown=10, position=6.0, country="fra"):
    """28 days of one search, worldwide and in one country (or worldwide only with country=None)."""
    w = World(engine, site)
    w.spread(*NOW, words, page, clicks, shown, position)
    w.save()
    if country:
        with engine.begin() as conn:
            for back in range(28):
                conn.execute(
                    text("INSERT INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :c, :h, :q, :k, :i, :p)"),
                    {"s": site, "d": END - timedelta(days=back), "c": country, "h": digest(words), "q": words, "k": clicks, "i": shown, "p": position},
                )


def rival(engine, site, host="rival.test"):
    with engine.begin() as conn:
        rid = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'competitor')"), {"h": host, "u": f"https://{host}/"}).lastrowid
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source, tracking) VALUES (:s, :r, 'manual', 'on')"), {"s": site, "r": rid})


def signals(engine, site):
    found = mix.signals(data.load(engine, site))
    return {f.kind: f for f in found.findings}, found


def mine(place):
    return [(place, HOME + "page")]


def test_a_drop_seen_once_is_to_check_and_stays_out_of_the_totals(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=6.0)
    check(engine, k, [(15, HOME + "page")], depth=20)
    f = signals(engine, site)[0]["rank_drop"]
    assert f.evidence["confirmed"] is False and f.severity == "info" and f.evidence["scraped"] == 15 and f.evidence["position"] == 6.0


def test_a_drop_an_earlier_check_confirms_counts(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=6.0)
    check(engine, k, [(6, HOME + "page")], ago=10, depth=20)
    check(engine, k, [(15, HOME + "page")], ago=1, depth=20)
    f = signals(engine, site)[0]["rank_drop"]
    assert f.evidence["confirmed"] is True and f.evidence["was"] == 6 and f.at_stake > 0 and f.severity == "normal"


def test_a_lasting_difference_between_the_sources_is_not_a_drop(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=6.0)
    check(engine, k, [(15, HOME + "page")], ago=10, depth=20)
    check(engine, k, [(15, HOME + "page")], ago=1, depth=20)
    assert "rank_drop" not in signals(engine, site)[0]


def test_no_comparison_without_numbers_for_the_country_checked(engine, site):
    k = keyword(engine, site, "blue shoes", country="us", language="en")
    search_console(engine, site, "blue shoes", position=6.0, country="fra")
    check(engine, k, [(15, HOME + "page")], location="US", depth=20)
    assert "rank_drop" not in signals(engine, site)[0]


def test_a_check_at_another_depth_cannot_confirm(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=6.0)
    check(engine, k, [(6, HOME + "page")], ago=10, depth=30)
    check(engine, k, [(15, HOME + "page")], ago=1, depth=20)
    assert signals(engine, site)[0]["rank_drop"].evidence["confirmed"] is False


def test_beyond_the_depth_is_a_drop_only_when_the_average_was_well_inside_it(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=8.0)
    check(engine, k, [(1, "https://other.test/")])
    assert "rank_drop" not in signals(engine, site)[0]


def test_beyond_the_depth_from_a_high_average_is_a_drop(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=4.0)
    check(engine, k, [(1, "https://other.test/")])
    assert signals(engine, site)[0]["rank_drop"].evidence["scraped"] is None


def test_an_old_check_says_nothing_moved(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=6.0)
    check(engine, k, [(15, HOME + "page")], ago=rules.MIX_FRESH_DAYS + 1, depth=20)
    assert "rank_drop" not in signals(engine, site)[0]


def test_too_few_impressions_say_nothing(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", shown=1, clicks=0, position=6.0)
    check(engine, k, [(15, HOME + "page")], depth=20)
    assert "rank_drop" not in signals(engine, site)[0]


def test_a_climb(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=15.0)
    check(engine, k, [(4, HOME + "page")], depth=20)
    f = signals(engine, site)[0]["rank_rise"]
    assert f.severity == "info" and f.at_stake == 0


def test_a_followed_rival_that_passed_me(engine, site):
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "blue shoes", position=4.0)
    check(engine, k, [(3, HOME + "page"), (5, "https://rival.test/a")], ago=10)
    check(engine, k, [(2, "https://rival.test/a"), (4, HOME + "page")], ago=1)
    found = mix.signals(data.load(engine, site)).findings[0]
    assert found.kind == "rival_passed" and found.evidence["passed"] == [{"host": "rival.test", "position": 2, "before": 5, "you_fell": False}]


def test_a_rival_that_was_already_above_did_not_pass_me(engine, site):
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "blue shoes", position=4.0)
    check(engine, k, [(2, "https://rival.test/a"), (3, HOME + "page")], ago=10)
    check(engine, k, [(2, "https://rival.test/a"), (4, HOME + "page")], ago=1)
    assert "rival_passed" not in signals(engine, site)[0]


def test_a_site_not_followed_is_no_rival(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=30.0)
    check(engine, k, [(1, "https://stranger.test/a")])
    assert "rival_gap" not in signals(engine, site)[0]


def test_rivals_lead_where_people_really_search(engine, site):
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "blue shoes", clicks=0, position=30.0)
    check(engine, k, [(1, "https://rival.test/a")])
    f = signals(engine, site)[0]["rival_gap"]
    assert f.at_stake > 0 and f.evidence["rivals"][0]["host"] == "rival.test" and f.evidence["scraped"] is None


def test_rivals_lead_with_no_demand_is_not_said(engine, site):
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "other words", clicks=0, position=30.0)
    check(engine, k, [(1, "https://rival.test/a")])
    assert "rival_gap" not in signals(engine, site)[0]


def test_almost_there_when_both_agree(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", clicks=0, position=12.0)
    check(engine, k, [(11, HOME + "page")], depth=20)
    assert signals(engine, site)[0]["striking"].at_stake > 0


@pytest.mark.parametrize("state,cited,word", [("present", [], "overview"), ("present", [HOME + "page"], "cited"), ("absent", [], "none"), ("not_captured", [], "not-captured")])
def test_ranked_but_not_clicked_says_what_the_page_of_results_held(engine, site, state, cited, word):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", clicks=0, shown=10, position=3.0)
    check(engine, k, mine(3), ai=state, cited=cited)
    assert signals(engine, site)[0]["rank_no_click"].evidence["ai"] == word


def test_google_shows_another_page_than_the_one_people_click(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", page=HOME + "clicked/", clicks=2, position=6.0)
    check(engine, k, [(6, HOME + "other/")])
    f = signals(engine, site)[0]["page_switch"]
    assert f.evidence["clicked_page"] == HOME + "clicked/" and f.evidence["ranking_page"] == HOME + "other/"


def test_the_same_page_spelled_differently_is_no_switch(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", page=HOME + "clicked/", clicks=2, position=6.0)
    check(engine, k, [(6, "http://www.shop-one.test/clicked")])
    assert "page_switch" not in signals(engine, site)[0]


def test_tracked_with_no_searches_seen(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "other words")
    check(engine, k, [(1, "https://other.test/")])
    assert signals(engine, site)[0]["no_demand"].severity == "info"


def test_never_checked_says_nothing(engine, site):
    keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes")
    found = mix.signals(data.load(engine, site))
    assert found.findings == [] and found.needs == {"mix": "checks"}


def test_one_row_per_keyword_with_the_rest_listed(engine, site):
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", page=HOME + "clicked/", clicks=0, shown=10, position=3.0)
    check(engine, k, [(3, HOME + "other/")], depth=20)
    found = mix.signals(data.load(engine, site)).findings
    assert [f.kind for f in found] == ["rank_no_click"]


def test_a_confirmed_drop_comes_before_a_standing_gap_worth_more(engine, site):
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "blue shoes", clicks=0, shown=100, position=9.0)
    check(engine, k, [(1, "https://rival.test/a"), (9, HOME + "page")], ago=10, depth=30)
    check(engine, k, [(1, "https://rival.test/a"), (18, HOME + "page")], ago=1, depth=30)
    found = mix.signals(data.load(engine, site)).findings
    assert [f.kind for f in found] == ["rank_drop"] and "rival_gap" in found[0].evidence["also"]


def test_listing_gives_the_tab_and_its_coverage(engine, site):
    k = keyword(engine, site, "blue shoes")
    keyword(engine, site, "never checked")
    search_console(engine, site, "blue shoes", position=6.0)
    check(engine, k, [(15, HOME + "page")], depth=20)
    insights.run(engine, site)
    got = service.listing(engine, site, "mix", "open")
    assert [r["kind"] for r in got["rows"]] == ["rank_drop"]
    assert got["coverage"]["tracked"] == 2 and got["coverage"]["with_search"] == 1 and got["coverage"]["checked"] == 1 and got["coverage"]["recent"] == 1


def test_worth_tracking_moves_to_the_tab_on_the_next_run(engine, site):
    search_console(engine, site, "untracked words", shown=10, position=6.0, country=None)
    insights.run(engine, site)
    with engine.begin() as conn:
        conn.execute(text("UPDATE search_findings SET grp = 'wins' WHERE kind = 'track'"))
    insights.run(engine, site)
    assert _found(engine, site, "track")[0]["grp"] == "mix"


def test_finishing_a_keyword_check_runs_insights_again(engine, site):
    from seo.competitors import keywords as kw

    with engine.begin() as conn:
        run = conn.execute(text("INSERT INTO keyword_uploads (site_id, file_name, engine, kind, status, total) VALUES (:s, 'x', 'google', 'refresh', 'running', 1)"), {"s": site}).lastrowid
    kw._finish(engine, run, "complete")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = 'insights'")).scalar() == 1


# ---- The sentence on top -------------------------------------------------------------------------


def test_one_page_is_named_when_it_explains_the_change_and_hidden_never_is(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "a big page search", HOME + "big/", 3, 30, 4)
    w.spread(*NOW, "a big page search", HOME + "big/", 1, 30, 4)
    w.spread(*BEFORE, "small search", HOME + "small/", 1, 30, 4)
    w.spread(*NOW, "small search", HOME + "small/", 1, 30, 4)
    day, extra = BEFORE[0], {}
    while day <= BEFORE[1]:
        extra[day] = 5  # rare searches: far more of the fall than any named query
        day += timedelta(days=1)
    w.save(extra)
    e = movement.breakdown(data.load(engine, site)).findings[0].evidence
    assert e["parts"]["hidden"] < 0 and abs(e["parts"]["hidden"]) > abs(e["parts"]["appeal"]) and e["main"] != "hidden"
    assert [p["path"] for p in e["explains"]] == ["/big/"] and e["pages"][0]["change"] == -56


def test_top_three_are_named_when_no_page_explains_most(engine, site):
    w = World(engine, site)
    for n in range(4):
        w.spread(*BEFORE, f"search {n}", HOME + f"p{n}/", 2, 30, 4)
        w.spread(*NOW, f"search {n}", HOME + f"p{n}/", 1, 30, 4)
    w.save()
    e = movement.breakdown(data.load(engine, site)).findings[0].evidence
    assert len(e["explains"]) == 3


def test_recover_and_win_never_count_one_search_twice():
    rows = [
        {"site_id": 1, "kind": "query_down", "grp": "changed", "query": "a", "page": "p", "finding_key": "1", "at_stake": 10},
        {"site_id": 1, "kind": "almost", "grp": "wins", "query": "a", "page": "p", "finding_key": "2", "at_stake": 30},
        {"site_id": 1, "kind": "almost", "grp": "wins", "query": "b", "page": "q", "finding_key": "3", "at_stake": 7},
    ]
    assert service.recover_and_win(rows) == (10, 7)


def test_summary_has_the_days_for_the_graph(engine, site):
    w = World(engine, site)
    w.spread(BEFORE[0], NOW[1], "a search", HOME, 1, 30, 4)
    w.save()
    insights.run(engine, site)
    s = service.summary(engine, [site])
    assert len(s["days"]) == 56 and s["days"][-1]["day"] == END.isoformat()


# ---- SEO review 2026-11-17: "Rival passed you" -------------------------------------------------------------------

def test_a_one_place_swap_is_not_a_rival_passing_me(engine, site):
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "blue shoes", position=4.0)
    check(engine, k, [(3, HOME + "page"), (4, "https://rival.test/a")], ago=10)
    check(engine, k, [(3, "https://rival.test/a"), (4, HOME + "page")], ago=1)
    assert "rival_passed" not in signals(engine, site)[0]


def test_when_only_i_fell_it_says_i_fell_below_the_rival(engine, site):
    """I drop from #3 to #8, the rival stays at #5: it didn't pass me, I fell below it."""
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "blue shoes", position=4.0)
    check(engine, k, [(3, HOME + "page"), (5, "https://rival.test/a")], ago=10)
    check(engine, k, [(5, "https://rival.test/a"), (8, HOME + "page")], ago=1)
    f = signals(engine, site)[0]["rival_passed"]
    assert f.evidence["passed"] == [{"host": "rival.test", "position": 5, "before": 5, "you_fell": True}]


def test_a_search_nobody_makes_raises_no_rival_passed(engine, site):
    k = keyword(engine, site, "blue shoes")
    rival(engine, site)
    search_console(engine, site, "blue shoes", shown=1, clicks=0, position=4.0)  # 28 impressions in 28 days
    check(engine, k, [(3, HOME + "page"), (9, "https://rival.test/a")], ago=10)
    check(engine, k, [(2, "https://rival.test/a"), (4, HOME + "page")], ago=1)
    assert "rival_passed" not in signals(engine, site)[0]


def test_a_drop_or_page_switch_another_tool_of_the_same_days_does_not_see_is_not_raised(engine, site):
    """Rankings review 3.2: SerpApi #37 at 09:48, Searlo #4 the same morning, Search Console's France average 6. The tools
    disagree (33 places, past the gap of 3), so neither a rank drop nor a page switch is said."""
    k = keyword(engine, site, "blue shoes")
    search_console(engine, site, "blue shoes", position=6.0)
    check(engine, k, [(4, HOME + "page")], ago=0.3, depth=50, tool="Searlo")
    check(engine, k, [(37, HOME + "other")], ago=0.2, depth=50, tool="SerpApi")
    found = signals(engine, site)[0]
    assert "rank_drop" not in found and "page_switch" not in found
