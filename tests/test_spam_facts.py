"""Hard facts beat the file's spam score on Link gaps (owner decision, 2026-11-18, replacing the 10 Nov rule).

The uploaded file's spam score still decides, except when the app's own check found a hard fact: the site redirects to
another website, the domain is parked, or there is no home page. "Site down" alone can be stale, so the file still decides
there and the row keeps its note. A person's Not spam / Mark as spam beats everything.

Known answers, from the rows each test writes (file scores 5, 10, 3, 5, 5 are all "good" by the file: only above 30 is spam):
- moved.example   score 5,  redirects to cvgorilla.example -> flagged by the system, "leads_elsewhere"
- parked.example  score 10, parked                         -> flagged by the system, "parked"
- gone.example    score 3,  no home page                   -> flagged by the system, "no_home_page"
- down.example    score 5,  site down                      -> good, with the app's note (weak)
- words.example   score 5,  spam words on its home page    -> good, with the app's note (not a hard fact)
- clean.example   score 5,  nothing found                  -> good, no note
So: 3 flagged, 3 good, 2 of the good ones with a note.
"""
from sqlalchemy import text

from seo.competitors import gaps, insights, quality
from tests.test_competitors_backend import add_rival, world  # noqa: F401  (world is a fixture)

FILE = (
    "No,Source Page Title,Source URL,Target URL,Domain Authority,Page Authority,Spam Score,Anchor Text,First Seen,Last Seen\n"
    '1,"Moved","https://moved.example/a","https://rival.example/",30,10,5,"a","2025-01-01","{recent}"\n'
    '2,"Parked","https://parked.example/a","https://rival.example/",30,10,10,"b","2025-01-01","{recent}"\n'
    '3,"Gone","https://gone.example/a","https://rival.example/",30,10,3,"c","2025-01-01","{recent}"\n'
    '4,"Down","https://down.example/a","https://rival.example/",30,10,5,"d","2025-01-01","{recent}"\n'
    '5,"Words","https://words.example/a","https://rival.example/",30,10,5,"e","2025-01-01","{recent}"\n'
    '6,"Clean","https://clean.example/a","https://rival.example/",30,10,5,"f","2025-01-01","{recent}"\n'
)
CHECKS = {
    "moved.example": ("leads_elsewhere", "cvgorilla.example"), "parked.example": ("parked", None), "gone.example": ("no_home_page", None),
    "down.example": ("site_down", None), "words.example": ("spam_words", None),
}


def _file():
    from datetime import date, timedelta
    return FILE.replace("{recent}", (date.today() - timedelta(days=30)).isoformat()).encode("utf-8")


def _setup(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, _file(), "ubersuggest.csv")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'good', reason = NULL"))
        for domain, (reason, to) in CHECKS.items():
            conn.execute(text("UPDATE link_domains SET quality = 'spam', reason = :r, redirect_to = :t, checked_at = '2026-11-18 08:00:00' WHERE domain = :d"),
                         {"r": reason, "t": to, "d": domain})
    return rival


def _rows(world):  # noqa: F811
    answer = gaps.link_gaps(world.engine, world.own)
    return answer, {g["domain"]: g for g in answer["gaps"] + answer["filtered"]}


def test_the_rule_itself():
    assert quality.verdict(5, "spam", "leads_elsewhere") == ("spam", "leads_elsewhere", "system")
    assert quality.verdict(10, "spam", "parked") == ("spam", "parked", "system")
    assert quality.verdict(3, "spam", "no_home_page") == ("spam", "no_home_page", "system")
    assert quality.verdict(5, "spam", "site_down") == ("good", None, None)
    assert quality.verdict(5, "spam", "spam_words") == ("good", None, None)
    assert quality.verdict(5, "spam", "leads_elsewhere", "keep") == ("good", None, None)  # the person's Not spam wins
    assert quality.verdict(50, "spam", "leads_elsewhere") == ("spam", "spam_score", "file")  # the file already says spam: its reason stays
    assert quality.verdict(None, "spam", "leads_elsewhere") == ("spam", "leads_elsewhere", "system")  # no file score: as before


def test_hard_facts_go_under_flagged_whatever_the_file_score(world):  # noqa: F811
    _setup(world)
    answer, rows = _rows(world)
    for domain, reason in (("moved.example", "leads_elsewhere"), ("parked.example", "parked"), ("gone.example", "no_home_page")):
        assert (rows[domain]["quality"], rows[domain]["reason"], rows[domain]["flagged_by"]) == ("spam", reason, "system"), domain
    # The row keeps what the app saw, where it leads and the score it overruled.
    moved = rows["moved.example"]
    assert moved["redirect_to"] == "cvgorilla.example"
    assert moved["app_flag"]["over_file"] == 5 and moved["app_flag"]["to"] == "cvgorilla.example"
    assert rows["parked.example"]["app_flag"]["over_file"] == 10
    assert answer["funnel"]["filtered"] == 3 and answer["funnel"]["good"] == 3


def test_site_down_alone_keeps_the_file_score_with_its_note(world):  # noqa: F811
    _setup(world)
    answer, rows = _rows(world)
    down, words, clean = rows["down.example"], rows["words.example"], rows["clean.example"]
    assert (down["quality"], down["flagged_by"]) == ("good", None)
    assert down["app_flag"]["reason"] == "site_down" and down["app_flag"]["weak"] is True
    assert words["quality"] == "good" and words["app_flag"]["reason"] == "spam_words"
    assert clean["quality"] == "good" and clean["app_flag"] is None
    assert answer["funnel"]["app_flagged"] == 2 and answer["funnel"]["app_flagged_weak"] == 1


def test_a_persons_not_spam_on_a_redirect_puts_it_back_in_good(world):  # noqa: F811
    _setup(world)
    gaps.decide(world.engine, world.own, "moved.example", "keep")
    answer, rows = _rows(world)
    moved = rows["moved.example"]
    assert (moved["quality"], moved["flagged_by"], moved["kept"], moved["app_flag"]) == ("good", None, True, None)
    assert answer["funnel"]["filtered"] == 2 and answer["funnel"]["good"] == 4


def test_the_competitor_card_counts_follow(world):  # noqa: F811
    rival = _setup(world)
    with world.engine.connect() as conn:
        card = insights._links(conn, world.own, rival, "rival.example")
    assert (card["linking_domains"], card["linking_flagged"]) == (3, 3)
