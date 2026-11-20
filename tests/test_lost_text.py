"""Pages whose text was saved as "?" while the tables were latin1 are read again and replaced, with no edit recorded
(2026-11-20, the owner: "we need the system to read it").

Made-up sites only.
"""
from sqlalchemy import text

from scripts import reread_lost_pages
from seo.core import charset
from seo.crawl import store
from tests.test_competitor_follow import first_read, next_day  # noqa: F401
from tests.test_competitor_noise import article, edits, live_pages
from tests.test_competitors_backend import rows, scalar, sitemap_xml, world  # noqa: F401  (world is a fixture)

ARABIC = "كم عدد التأشيرات في الرخصة التجارية"


def test_only_text_that_is_mostly_question_marks_is_lost():
    assert charset.lost("??? ?????? ?????? ????? | DMCC")
    assert charset.lost(["????? ???", "?? ?????", "Contact"])
    assert not charset.lost("Is a coffee subscription worth it?")
    assert not charset.lost("What?? Really")
    assert not charset.lost(["????? ???", "Hello"]) and not charset.lost("") and not charset.lost(None)


def _lose(world):
    """What latin1 did: every letter of the Arabic page became "?"."""
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE pages SET title = '?? ??? ????????? ?? ?????? ????????', h1 = JSON_ARRAY('?? ??? ????????? ?? ?????? ????????') WHERE url LIKE '%/ar/visas'"))


def _world_with_an_arabic_page(world):
    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/ar/visas"] = article(ARABIC, "نص المقال عن التأشيرات والرخص التجارية في دبي")
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/", "/ar/visas"])
    rival = first_read(world)
    _lose(world)
    return pages, rival


def test_the_next_daily_read_brings_the_title_back_and_records_no_edit(world):
    _pages, rival = _world_with_an_arabic_page(world)
    assert store.validators(world.engine, "https://rival.example/ar/visas") == (None, None)  # asked for whole, never "not changed since"
    next_day(world, rival)
    assert scalar(world.engine, "SELECT title FROM pages WHERE url LIKE '%/ar/visas'") == ARABIC
    assert edits(world) == []                                                    # nothing on their page changed
    assert scalar(world.engine, "SELECT last_changed_at FROM pages WHERE url LIKE '%/ar/visas'") is None


def test_an_edit_after_the_repair_is_still_an_edit(world):
    pages, rival = _world_with_an_arabic_page(world)
    next_day(world, rival)
    pages["rival.example/ar/visas"] = article("عنوان جديد تماما للصفحة", "نص المقال عن التأشيرات والرخص التجارية في دبي")
    next_day(world, rival)
    assert ("title", "https://rival.example/ar/visas") in [(e["kind"], e["url"]) for e in edits(world) if not e["hidden"]]


def test_the_script_counts_first_then_reads_them_again(world):
    _world_with_an_arabic_page(world)
    assert reread_lost_pages.not_converted(world.engine) == []                   # a test database is always utf8mb4
    dry = reread_lost_pages.run(world.engine, apply=False, log=None)
    assert dry == {"rival.example": {"done": 0, "failed": 0, "left": 1, "cannot": 0}}
    assert charset.lost(scalar(world.engine, "SELECT title FROM pages WHERE url LIKE '%/ar/visas'"))  # a dry run changes nothing
    done = reread_lost_pages.run(world.engine, apply=True, log=None)
    assert done == {"rival.example": {"done": 1, "failed": 0, "left": 0, "cannot": 0}}
    assert scalar(world.engine, "SELECT title FROM pages WHERE url LIKE '%/ar/visas'") == ARABIC
    assert edits(world) == [] and reread_lost_pages.run(world.engine, apply=False, log=None) == {}


def test_a_page_that_is_gone_keeps_its_question_marks_and_is_counted_apart(world):
    _world_with_an_arabic_page(world)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE pages SET last_status = 'gone' WHERE url LIKE '%/ar/visas'"))
    assert reread_lost_pages.run(world.engine, apply=True, log=None) == {"rival.example": {"done": 0, "failed": 0, "left": 0, "cannot": 1}}
