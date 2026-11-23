"""Keywords by ranking: Top, Trending up and Trending down from our checks and from Search Console, similar keywords grouped."""
from datetime import timedelta

from sqlalchemy import text

from seo.collectors.common import digest
from seo.metrics import rank_trends
from seo.web import create_app
from tests.test_insights_mix import check, keyword
from tests.test_search import END, site  # noqa: F401

HOME = "https://shop-one.test/"


def week(engine, site_id, words, now=None, before=None, shown=20):
    """One search over the last 7 final days (position `now`) and the first 7 of the 28-day trend line (position `before`)."""
    with engine.begin() as conn:
        for back in [*range(7), *range(21, 28)]:
            position = now if back < 7 else before
            if position is None:
                continue
            conn.execute(
                text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 0, :i, :p)"),
                {"s": site_id, "d": END - timedelta(days=back), "h": digest(words), "q": words, "i": shown, "p": position},
            )


def names(rows):
    return [row["keyword"] for row in rows]


def test_similar_words():
    same = rank_trends.words_of
    assert same("business setup services in dubai") & same("Business setup companies in Dubai") == {"business", "setup", "dubai"}
    assert same("créer une société à Dubaï") == same("creer societe dubai")
    assert same("how to") == {"how", "to"}  # only small words: they are kept, so the keyword still has a name


def test_our_checks_split_into_top_up_and_down(engine, site):
    up = keyword(engine, site, "lost passport")
    down = keyword(engine, site, "business setup dubai")
    steady = keyword(engine, site, "golden visa")
    absent = keyword(engine, site, "freezone licence")
    keyword(engine, site, "never checked")
    for kid, before, now in ((up, 8, 3), (down, 2, 6), (steady, 1, 1)):
        check(engine, kid, [(before, HOME)], ago=3)
        check(engine, kid, [(now, HOME)], ago=1)
    check(engine, absent, [(4, "https://rival.test/")], ago=1)

    found = rank_trends.rank_trends(engine, site)["checks"]
    assert found["state"] == "ok" and found["tracked"] == 5 and found["tools"] == ["SerpApi"]
    assert names(found["top"]) == ["golden visa", "lost passport", "business setup dubai"]
    assert found["counts"] == {"top": 3, "up": 1, "down": 1}
    assert [(r["keyword"], r["was"], r["now"], r["places"]) for r in found["up"]] == [("lost passport", 8, 3, 5)]
    assert [(r["keyword"], r["was"], r["now"], r["places"]) for r in found["down"]] == [("business setup dubai", 2, 6, -4)]


def test_a_change_of_tool_is_not_a_move(engine, site):
    kid = keyword(engine, site, "lost passport")
    check(engine, kid, [(9, HOME)], ago=3, tool="SerpApi")
    check(engine, kid, [(2, HOME)], ago=1, tool="Bright Data")
    found = rank_trends.rank_trends(engine, site)["checks"]
    assert found["counts"]["up"] == 0 and found["counts"]["top"] == 1


def test_similar_keywords_go_under_the_first_of_them(engine, site):
    for words, position in (("lost passport", 2), ("lost passport fees", 5), ("lost passport in dubai", 7), ("company formation", 4)):
        check(engine, keyword(engine, site, words), [(position, HOME)])
    top = rank_trends.rank_trends(engine, site)["checks"]["top"]
    assert names(top) == ["lost passport", "company formation"]
    assert [(s["keyword"], s["now"]) for s in top[0]["similar"]] == [("lost passport fees", 5), ("lost passport in dubai", 7)]
    assert top[0]["similar_count"] == 2 and top[1]["similar"] == []


def test_states_before_any_result(engine, site):
    assert rank_trends.rank_trends(engine, site)["checks"]["state"] == "no_keywords"
    kid = keyword(engine, site, "lost passport")
    assert rank_trends.rank_trends(engine, site)["checks"]["state"] == "not_checked"
    check(engine, kid, [(1, "https://rival.test/")])
    assert rank_trends.rank_trends(engine, site)["checks"]["state"] == "not_ranked"
    assert rank_trends.rank_trends(engine, site)["gsc"]["state"] == "not_connected"


def test_search_console_last_7_days_against_the_first_7_of_the_trend_line(engine, site):
    week(engine, site, "lost passport", now=3.0, before=7.5)
    week(engine, site, "always improving", now=9.0, before=4.0)
    week(engine, site, "golden visa", now=5.0, before=5.4)  # under one place: not a move
    week(engine, site, "new this week", now=2.0)  # not shown before: it entered, an Up
    week(engine, site, "gone quiet", before=6.0)  # shown before, not at all now: lost, a Down
    week(engine, site, "rare search", now=1.0, before=1.0, shown=1)  # 7 impressions a week: left out
    tracked = keyword(engine, site, "Lost Passport")

    found = rank_trends.rank_trends(engine, site)["gsc"]
    assert found["state"] == "ok" and found["through"] == str(END) and found["from"] == str(END - timedelta(days=6))
    assert found["before_from"] == str(END - timedelta(days=27)) and found["before_through"] == str(END - timedelta(days=21))
    assert names(found["top"]) == ["new this week", "lost passport", "golden visa", "always improving"]
    assert [(r["keyword"], r["move"], r["was"], r["now"], r["places"]) for r in found["up"]] == [("new this week", "new", None, 2.0, 0), ("lost passport", "up", 7.5, 3.0, 4.5)]
    assert [(r["keyword"], r["move"], r["was"], r["now"], r["places"]) for r in found["down"]] == [("gone quiet", "lost", 6.0, None, 0), ("always improving", "down", 4.0, 9.0, -5.0)]
    assert found["counts"] == {"top": 4, "up": 2, "down": 2}
    assert found["up"][1]["keyword_id"] == tracked and found["down"][1]["keyword_id"] is None
    assert found["top"][0]["was"] is None and found["top"][0]["places"] == 0


def test_search_console_too_new_to_say_new(engine, site):
    """Search Console connected last week: nothing reaches the first window, so nothing is "new"."""
    with engine.begin() as conn:
        for back in range(7):
            conn.execute(
                text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 0, 20, 3)"),
                {"s": site, "d": END - timedelta(days=back), "h": digest("fresh site"), "q": "fresh site"},
            )
    found = rank_trends.rank_trends(engine, site)["gsc"]
    assert names(found["top"]) == ["fresh site"] and found["counts"]["up"] == 0 and found["top"][0]["move"] is None


def test_our_checks_count_lost_as_down_and_new_as_up(engine, site):
    lost = keyword(engine, site, "lost passport")
    new = keyword(engine, site, "golden visa")
    check(engine, lost, [(4, HOME)], ago=3)
    check(engine, lost, [(4, "https://rival.test/")], ago=1)  # not in the top 10 now
    check(engine, new, [(3, "https://rival.test/")], ago=3)
    check(engine, new, [(6, HOME)], ago=1)
    found = rank_trends.rank_trends(engine, site)["checks"]
    assert found["counts"] == {"top": 1, "up": 1, "down": 1}
    assert [(r["keyword"], r["move"], r["was"], r["now"]) for r in found["down"]] == [("lost passport", "lost", 4, None)]
    assert [(r["keyword"], r["move"], r["was"], r["now"]) for r in found["up"]] == [("golden visa", "new", None, 6)]


def test_the_route_answers_for_one_site_and_for_all(engine, site):
    check(engine, keyword(engine, site, "lost passport"), [(2, HOME)])
    client = create_app(engine=engine, auth=False).test_client()
    one = client.get(f"/api/rank-trends?site_id={site}").get_json()
    every = client.get("/api/rank-trends").get_json()
    assert names(one["checks"]["top"]) == names(every["checks"]["top"]) == ["lost passport"]
    assert one["checks"]["top"][0]["host"] == "shop-one.test"
