"""Link and competitor numbers, second round (SEO expert review 2026-11-17, accuracy/links.md and competitors-exports.md W4, W14).

Every answer here is worked out by hand from the rows each test writes:
1. The file's spam score still wins on Link gaps (owner, 2026-11-10), but the app's own flag stays on the row as a note
   (since 2026-11-18 a hard fact, such as a redirect, beats the file: tests/test_spam_facts.py).
2. A file that doesn't say which links are followed leaves the follow status unknown, counted apart.
3. A domain whose links were all last seen more than 6 months before its file is an old link, counted apart.
4. The anchor type comes from the anchor the link checker read on the page; a type set by hand only when nothing was read.
5. One spam line everywhere: a score above 30 is spam, 30 itself is not.
6. The Competitors export tiles count distinct keywords, not a sum over rivals.
7. A page pair's "shared keywords" is counted the way its ahead / behind is: one check per keyword, both pages in it.
"""
from sqlalchemy import text

from seo.backlinks import cleaner, protect
from seo.competitors import gaps, pairs
from seo.exports import registry
from tests.test_competitors_backend import add_rival, seed, world  # noqa: F401  (world is a fixture)

# An Ubersuggest export: no nofollow and no lost column. It was saved on the day of the upload, so "now" is its date.
# old.example: its only link was last seen on 2026-01-02 -> more than 6 months before the file.
# fresh.example: two links, one old and one seen last month -> not old.
# mixed.example: an old link to this rival, and (below) a Common Crawl row for a second rival with no date -> not old.
UBERSUGGEST = (
    "No,Source Page Title,Source URL,Target URL,Domain Authority,Page Authority,Spam Score,Anchor Text,First Seen,Last Seen\n"
    '1,"Old","https://old.example/a","https://rival.example/",40,20,1,"rival","2023-01-01","2025-01-02"\n'
    '2,"Fresh","https://fresh.example/a","https://rival.example/",40,20,1,"rival","2023-01-01","2025-01-02"\n'
    '3,"Fresh","https://fresh.example/b","https://rival.example/x",40,22,1,"rival x","2023-01-01","{recent}"\n'
    '4,"Moved","https://moved.example/a","https://rival.example/",30,10,3,"pbn","2025-01-01","{recent}"\n'
    '5,"Down","https://down.example/a","https://rival.example/",30,10,3,"down","2025-01-01","{recent}"\n'
    '6,"Thirty","https://thirty.example/a","https://rival.example/",30,10,30,"thirty","2025-01-01","{recent}"\n'
)


def _file():
    with_dates = UBERSUGGEST.replace("{recent}", _days_ago(30))
    return with_dates.encode("utf-8")


def _days_ago(n):
    from datetime import date, timedelta
    return (date.today() - timedelta(days=n)).isoformat()


def _gaps(world):  # noqa: F811
    answer = gaps.link_gaps(world.engine, world.own)
    return answer, {g["domain"]: g for g in answer["gaps"] + answer["filtered"]}


def _checked(world, verdicts):  # noqa: F811
    """What the app's own home-page check said about each domain, as the worker saves it."""
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'good', reason = NULL"))
        for domain, (reason, to) in verdicts.items():
            conn.execute(
                text("UPDATE link_domains SET quality = 'spam', reason = :r, redirect_to = :t, checked_at = '2026-11-11 08:00:00' WHERE domain = :d"),
                {"r": reason, "t": to, "d": domain},
            )


# ---- 1. the app's own flag stays on a row the file's score keeps ----------------------------------------------------

def test_a_file_score_still_wins_except_over_a_hard_fact_and_the_app_flag_stays_on_the_row(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    _checked(world, {"moved.example": ("leads_elsewhere", "cvgorilla.example"), "down.example": ("site_down", None)})
    answer, rows = _gaps(world)
    moved, down, fresh = rows["moved.example"], rows["down.example"], rows["fresh.example"]
    # A file score of 3 means good, except for a hard fact like a redirect, which is flagged and keeps its note (owner, 2026-11-18).
    assert (moved["quality"], moved["flagged_by"], down["quality"]) == ("spam", "system", "good")
    assert moved["app_flag"] == {"reason": "leads_elsewhere", "words": "Redirects to another site", "to": "cvgorilla.example", "weak": False, "at": "2026-11-11T08:00:00Z", "over_file": 3}
    # Site down can be stale, so it is the weak kind and carries the day it was seen.
    assert down["app_flag"]["reason"] == "site_down" and down["app_flag"]["weak"] is True and down["app_flag"]["at"].startswith("2026-11-11")
    assert fresh["app_flag"] is None
    assert answer["funnel"]["app_flagged"] == 1 and answer["funnel"]["app_flagged_weak"] == 1  # only good ones count: down.example


def test_a_domain_the_file_has_no_score_for_is_flagged_as_before_with_no_second_note(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, b"Source url,Toxic score\nhttps://moved.example/post,\n", "links.csv")
    _checked(world, {"moved.example": ("leads_elsewhere", None)})
    answer, rows = _gaps(world)
    assert (rows["moved.example"]["quality"], rows["moved.example"]["flagged_by"], rows["moved.example"]["app_flag"]) == ("spam", "system", None)
    assert answer["funnel"]["app_flagged"] == 0


def test_a_domain_kept_by_a_person_shows_no_app_flag(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    _checked(world, {"moved.example": ("leads_elsewhere", "cvgorilla.example")})
    gaps.decide(world.engine, world.own, "moved.example", "keep")
    _, rows = _gaps(world)
    assert rows["moved.example"]["app_flag"] is None


# ---- 2. follow status unknown ---------------------------------------------------------------------------------------

def test_a_file_with_no_follow_column_leaves_every_row_unknown_and_counts_them(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    _checked(world, {})
    answer, rows = _gaps(world)
    assert all(g["followed"] is None for g in rows.values())
    good = [g for g in rows.values() if g["quality"] == "good"]
    assert answer["funnel"]["follow_unknown"] == len(good) == 5  # old, fresh, moved, down and thirty (30 is not above 30, item 5)
    assert answer["funnel"]["not_followed"] == 0


# ---- 3. old links -------------------------------------------------------------------------------------------------

def test_a_domain_whose_links_are_all_older_than_6_months_before_its_file_is_an_old_link(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    _checked(world, {})
    answer, rows = _gaps(world)
    assert rows["old.example"]["old_link"] == {"last_seen": "2025-01-02"}
    assert rows["fresh.example"]["old_link"] is None  # one of its two links is recent
    assert rows["moved.example"]["old_link"] is None
    assert answer["funnel"]["old"] == 1


def test_six_months_is_counted_from_the_file_not_from_today(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    with world.engine.begin() as conn:  # the file was uploaded on 2025-03-01: two months after the link was last seen
        conn.execute(text("UPDATE competitor_referrers SET last_seen_at = '2025-03-01 10:00:00'"))
    _checked(world, {})
    _, rows = _gaps(world)
    assert rows["old.example"]["old_link"] is None


def test_a_domain_another_source_lists_without_a_date_is_not_called_old(world):  # noqa: F811
    rival = add_rival(world)
    other = add_rival(world, host="second.example")
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    gaps.import_common_crawl(world.engine, other, [{"domain": "old.example"}], "CC-MAIN-2026-40")
    _checked(world, {})
    _, rows = _gaps(world)
    assert rows["old.example"]["competitor_count"] == 2 and rows["old.example"]["old_link"] is None


def test_months_are_calendar_months():
    from datetime import date
    assert gaps.months_before(date(2026, 11, 10), 6) == date(2026, 5, 10)
    assert gaps.months_before(date(2026, 8, 31), 6) == date(2026, 2, 28)


# ---- 4. anchor type from the anchor read on the page ----------------------------------------------------------------

def test_the_anchor_read_on_the_page_decides_the_type_over_a_hand_set_one(world):  # noqa: F811
    reply = world.client.post("/api/backlinks/bulk", json={"rows": [
        {"site_id": world.own, "source_url": "https://news.example/a", "anchor": "Me Example", "anchor_kind": "brand"},
        {"site_id": world.own, "source_url": "https://blog.example/b", "anchor": "Me Example", "anchor_kind": "brand"},
    ]})
    assert reply.status_code == 201, reply.get_data(as_text=True)
    with world.engine.begin() as conn:  # the link checker found the first link, with the words "click here" on the page
        conn.execute(text("UPDATE backlinks SET seen_anchor = 'click here', check_outcome = 'found' WHERE source_url = 'https://news.example/a'"))
    rows = {r["source_url"]: r for r in world.client.get(f"/api/backlinks?site_id={world.own}").get_json()["backlinks"]}
    read, typed = rows["https://news.example/a"], rows["https://blog.example/b"]
    assert (read["anchor_type"], read["anchor_by_hand"], read["anchor_read"]) == ("generic", False, "click here")
    assert (typed["anchor_type"], typed["anchor_by_hand"], typed["anchor_read"]) == ("brand", True, None)


# ---- 5. one spam line -----------------------------------------------------------------------------------------------

def test_a_score_of_30_is_not_spam_anywhere_and_31_is():
    assert cleaner.is_spam_score(30) is False and cleaner.is_spam_score(30.5) is True and cleaner.is_spam_score(None) is False
    assert protect.suggested({"spam_score": 30}) is False and protect.suggested({"spam_score": 31}) is True


def test_link_gaps_keep_a_domain_scored_exactly_30(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    _checked(world, {})
    _, rows = _gaps(world)
    assert rows["thirty.example"]["quality"] == "good"


# ---- 6. Competitors export: distinct keywords -----------------------------------------------------------------------

def test_competitors_export_tiles_count_each_keyword_once(world):  # noqa: F811
    add_rival(world)
    add_rival(world, host="second.example")
    # k1: both rivals ahead of me. k2: I am ahead of both. k3: only the first rival ranks. k4: the first ahead, the second behind.
    seed(world.engine, world.own, "k1", ["rival.example/a", "second.example/a", "me.example/a"])
    seed(world.engine, world.own, "k2", ["me.example/a", "rival.example/a", "second.example/a"])
    seed(world.engine, world.own, "k3", ["rival.example/a"])
    seed(world.engine, world.own, "k4", ["rival.example/a", "me.example/a", "second.example/a"])
    report = registry.build(world.engine, "competitors", {"site_id": str(world.own)}, "en")
    tiles = {tile.label: tile.value for tile in report.tiles}
    # Summed over the two rivals these were 6 shared, 3 ahead of them, 3 they ahead.
    assert tiles["Keywords shared"] == 3  # k1, k2, k4
    assert tiles["Where I am ahead"] == 1  # k2: ahead of every rival there
    assert tiles["Where they are ahead"] == 3  # k1, k3, k4: the rows of the second sheet
    assert tiles["Where they are ahead"] == len(report.tables[1].rows)


# ---- 7. a page pair's shared keywords ---------------------------------------------------------------------------------

def test_a_pair_counts_shared_keywords_the_way_its_ahead_and_behind_do(world):  # noqa: F811
    rival = add_rival(world)
    seed(world.engine, world.own, "beans", ["https://rival.example/a", "https://me.example/a"])
    seed(world.engine, world.own, "grinder", ["https://me.example/a", "https://rival.example/a"])
    # "spoon": Google shows only my page; DuckDuckGo shows both. One check speaks for a keyword (Google), so it isn't shared.
    seed(world.engine, world.own, "spoon", ["https://me.example/a"])
    seed(world.engine, world.own, "spoon", ["https://rival.example/a", "https://me.example/a"], tool="DuckDuckGo direct", search_engine="duckduckgo")
    pairs.refresh_auto_pairs(world.engine, world.own)
    pair = pairs.list_pairs(world.engine, world.own, rival)[0]
    assert pair["ranking"]["shared"] == 2 and (pair["ranking"]["they_ahead"], pair["ranking"]["i_ahead"]) == (1, 1)
    assert pair["shared_keywords"] == 2
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT shared_keywords FROM page_pairs WHERE id = :i"), {"i": pair["id"]}).scalar() == 2
    report = registry.build(world.engine, "page-pairs", {"site_id": str(world.own)}, "en")
    assert report.tables[0].rows[0]["shared_keywords"] == 2
