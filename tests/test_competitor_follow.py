"""How each competitor's site is followed, so an edit shows within a day even when its sitemap's dates are bad
(plan-seo-command-center-competitor-update-detection.md, 2026-11-10). Made-up sites only, no real request."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from seo.competitors import crawl, firecrawl, profile, suggest
from seo.core.errors import Refused
from seo.crawl import store as crawl_store
from seo.serp import store
from seo.serp.tools import NOT_CAPTURED, Answer, Found
from tests.test_competitor_reading import FakeFirecrawl, SHELL, full, key  # noqa: F401  (key is a fixture)
from tests.test_competitors_backend import add_rival, page_html, rows, scalar, seed, sitemap_xml, track, world  # noqa: F401  (world is a fixture)

WP_POSTS = "rival.example/wp-json/wp/v2/posts?per_page=100&orderby=modified&order=desc&_fields=link,modified_gmt"
WP_PAGES = WP_POSTS.replace("/posts?", "/pages?")


def site(world, count, date="2026-01-01", dates=None):
    paths = [f"/p{n}" for n in range(count)]
    world.pages["rival.example/"] = page_html("Home")
    for path in paths:
        world.pages[f"rival.example{path}"] = page_html(f"Page {path}")
    if dates is None:
        world.pages["rival.example/sitemap.xml"] = sitemap_xml(paths, date=date)
    else:
        urls = "".join(f"<url><loc>https://rival.example{p}</loc><lastmod>{d}</lastmod></url>" for p, d in zip(paths, dates))
        world.pages["rival.example/sitemap.xml"] = f'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return paths


def first_read(world):
    rival = add_rival(world)
    world.drain("crawl")
    return rival


def next_day(world, rival, days=1):
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE pages SET last_checked_at = last_checked_at - INTERVAL :d DAY"), {"d": days})
        conn.execute(text("UPDATE competitor_crawls SET finished_at = finished_at - INTERVAL :d DAY"), {"d": days})
    world.requests.clear()
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")


def mode(world, rival):
    return scalar(world.engine, "SELECT follow_mode FROM competitor_crawls WHERE competitor_id = :c", c=rival)


def read(world, path):
    return f"https://rival.example{path}" in world.requests


# ---- scenario 1: a small site has every page read every day ---------------------------------------------------

def test_a_small_site_has_every_page_read_every_day_whatever_its_dates_say(world):
    paths = site(world, 5)  # every page dated 1 January: the dates say nothing changed
    rival = first_read(world)
    world.pages["rival.example/p3"] = page_html("Page /p3", "a rewritten paragraph about prices and the new offer this month")
    next_day(world, rival)
    assert mode(world, rival) == crawl.ALL
    assert all(read(world, p) for p in paths)
    assert [e["kind"] for e in rows(world.engine, "SELECT kind FROM change_events")] == ["content"]


def test_a_small_site_still_notices_a_page_it_stopped_listing_the_next_day(world):
    site(world, 3)
    rival = first_read(world)
    del world.pages["rival.example/p2"]
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/p0", "/p1"])
    next_day(world, rival)
    assert ("page_gone", "https://rival.example/p2") in {(e["kind"], e["url"]) for e in rows(world.engine, "SELECT e.kind, p.url FROM change_events e JOIN pages p ON p.id = e.page_id")}


# ---- scenario 4: a big site with useless dates is read in tiers -------------------------------------------------

@pytest.fixture
def big(monkeypatch):
    monkeypatch.setattr(crawl, "FULL_DAILY_PAGES", 3)
    monkeypatch.setattr(crawl, "PAGES_PER_DAY", 4)


def test_a_big_site_with_one_date_on_every_page_reads_its_top_ranking_page_every_day(world, big):
    paths = site(world, 30, date="2026-09-15")  # rebuilt on one day: the dates say nothing
    rival = first_read(world)
    for _day in range(8):  # the first pass, four pages a day
        next_day(world, rival)
    seed(world.engine, world.own, "company setup", ["rival.example/p17"])  # p17 ranks first for my keyword
    next_day(world, rival)
    assert mode(world, rival) == crawl.TIERS
    assert read(world, "/p17")
    next_day(world, rival)
    assert read(world, "/p17")  # and again the next day, though the sitemap never moved


def test_tiers_spend_the_whole_day_and_reach_every_page_long_before_fourteen_days(world, big, monkeypatch):
    monkeypatch.setattr(crawl, "PAGES_PER_DAY", 8)
    paths = site(world, 24, date="2026-09-15")  # 20 or more pages on one day: the dates say nothing
    rival = first_read(world)
    for _day in range(3):
        next_day(world, rival)
    assert mode(world, rival) == crawl.TIERS
    with world.engine.begin() as conn:  # everything read, then a quiet week
        conn.execute(text("UPDATE pages SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 4 DAY"))
    seen = set()
    for _day in range(4):
        next_day(world, rival)
        seen |= {p for p in paths if read(world, p)}
        assert read(world, "/")  # the start page, where new posts show first, every day
    assert seen == set(paths)  # 24 pages, 7 a day beside the start page: all read in 4 days, not after 14


# ---- scenario 3: WordPress tells the app what it edited ---------------------------------------------------------

def test_a_big_wordpress_site_has_the_pages_it_says_it_edited_read_at_once(world, big):
    paths = site(world, 10, date="2026-09-15")
    world.pages[WP_POSTS] = json.dumps([])
    world.pages[WP_PAGES] = json.dumps([])
    rival = first_read(world)
    for _day in range(3):
        next_day(world, rival)
    soon = (datetime.now(timezone.utc) + timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S")
    world.pages[WP_POSTS] = json.dumps([{"link": "https://rival.example/p6", "modified_gmt": soon}, {"link": "https://elsewhere.example/x", "modified_gmt": soon}])
    next_day(world, rival)
    assert mode(world, rival) == crawl.WORDPRESS
    assert read(world, "/p6")
    assert not any("elsewhere.example" in url for url in world.requests)


def test_a_site_without_the_wordpress_list_isnt_asked_again_for_a_week(world, big):
    site(world, 10, date="2026-09-15")
    rival = first_read(world)
    assert scalar(world.engine, "SELECT wp_api FROM competitor_crawls WHERE competitor_id = :c", c=rival) == "no"
    next_day(world, rival)
    assert not any("wp-json" in url for url in world.requests)


# ---- trust is learned --------------------------------------------------------------------------------------------

def test_dates_that_keep_quiet_about_edits_stop_being_trusted(world, big):
    days = [f"2026-0{1 + n % 9}-1{n % 10}" for n in range(10)]  # varied dates that look honest
    paths = site(world, 10, dates=days)
    rival = first_read(world)
    for _day in range(3):
        next_day(world, rival)
    assert mode(world, rival) == crawl.SITEMAP
    for n in range(4):  # edited, while the sitemap keeps its old dates
        world.pages[f"rival.example/p{n}"] = page_html(f"Page /p{n}", f"rewritten text number {n} with a whole new section on costs")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE pages SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 20 DAY WHERE url LIKE '%/p0' OR url LIKE '%/p1' OR url LIKE '%/p2' OR url LIKE '%/p3'"))
    next_day(world, rival, days=0)
    assert scalar(world.engine, "SELECT dates_missed FROM competitor_crawls WHERE competitor_id = :c", c=rival) >= crawl.TRUST_MIN_MISSES
    next_day(world, rival)
    assert mode(world, rival) == crawl.TIERS


# ---- search results trigger a read --------------------------------------------------------------------------------

def save_check(world, keyword, url, title):
    keyword_id = track(world.engine, world.own, keyword)
    store.save_check(world.engine, keyword_id, "google", Answer("SerpApi", "FR", 10, [Found(30, url, title)], NOT_CAPTURED, [], 1), "refresh")


def test_a_new_title_in_my_ranking_check_has_that_page_read_the_same_day(world, big, monkeypatch):
    monkeypatch.setattr(crawl, "TOP_RANK", 0)  # not a top page: only the changed title can bring it forward
    days = [f"2026-0{1 + n % 9}-1{n % 10}" for n in range(10)]
    site(world, 10, dates=days)
    rival = first_read(world)
    for _day in range(3):
        next_day(world, rival)
    save_check(world, "dubai licence", "https://rival.example/p8", "Licence Dubai: prices 2025")
    next_day(world, rival)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = checked_at - INTERVAL 2 DAY"))
    save_check(world, "dubai licence", "https://rival.example/p8", "Licence Dubai: new prices 2026")
    next_day(world, rival, days=0)
    assert read(world, "/p8")


# ---- no fake edits -----------------------------------------------------------------------------------------------

def test_a_page_whose_only_change_is_a_date_or_a_counter_has_no_edit(world):
    world.pages["rival.example/"] = page_html("Home")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/a"])
    world.pages["rival.example/a"] = page_html("A", "Updated 10 November 2026 at 14:30. 12 comments. Our offer costs 5000 AED a year.")
    rival = first_read(world)
    world.pages["rival.example/a"] = page_html("A", "Updated 11 November 2026 at 09:15. 14 comments. Our offer costs 5000 AED a year.")
    next_day(world, rival)
    assert scalar(world.engine, "SELECT COUNT(*) FROM change_events") == 0


def test_a_small_real_edit_counts_and_says_how_many_words_changed(world):
    world.pages["rival.example/"] = page_html("Home")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/a"])
    world.pages["rival.example/a"] = page_html("A", "Our offer costs 5000 AED a year with a free bank account.")
    rival = first_read(world)
    world.pages["rival.example/a"] = page_html("A", "Our offer costs 7000 AED a year with a free bank account.")
    next_day(world, rival)
    event = rows(world.engine, "SELECT kind, changed_words FROM change_events")
    assert event == [{"kind": "content", "changed_words": 1}]
    timeline = profile.profile(world.engine, world.own, rival)["timeline"]
    assert [e["changed_words"] for e in timeline if e["kind"] == "content"] == [1]


def test_changed_words_ignores_dates_and_counts_real_words():
    assert crawl_store.changed_words("Publié il y a 3 heures. Texte.", "Publié il y a 5 heures. Texte.") == 0
    assert crawl_store.changed_words("Mis à jour le 10 novembre 2026", "Mis à jour le 1er décembre 2026") == 0
    assert crawl_store.changed_words("Prix 5000 AED", "Prix 7000 AED") == 1
    assert crawl_store.changed_words("a b c d e f", "a b x y e f g") == 3


# ---- scenario 5: the weekly Firecrawl check, only after a yes ----------------------------------------------------

@pytest.fixture
def fc(monkeypatch, key, world):
    import httpx
    from seo.sources import service as sources

    fake = FakeFirecrawl()
    monkeypatch.setattr(firecrawl, "transport", httpx.MockTransport(fake))
    sources.save_app_key(world.engine, "firecrawl", "fc-test-1234")
    return fake


def js_rival_read_by_firecrawl(world, fc):
    world.pages["rival.example/"] = SHELL
    world.pages["rival.example/a"] = SHELL
    world.pages["rival.example/b"] = SHELL
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/a", "/b"])
    rival = first_read(world)
    for path in ("/", "/a", "/b"):
        fc.rendered[f"https://rival.example{path}"] = full(f"Rendered {path}")
    firecrawl.start(world.engine, rival, "read")
    world.drain("collectors")
    seed(world.engine, world.own, "company setup", ["rival.example/a"])
    return rival


def test_the_weekly_check_needs_a_yes_and_then_checks_only_ranking_pages_once_a_week(world, fc):
    rival = js_rival_read_by_firecrawl(world, fc)
    offer = firecrawl.offer(world.engine, rival)
    assert offer["weekly"] == {"on": False, "pages": 1, "credits_per_week": 1}
    assert firecrawl.enqueue_weekly(world.engine) == []  # no yes, no spending
    assert firecrawl.set_weekly(world.engine, rival, True) == {"on": True, "pages": 1, "credits_per_week": 1}
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE competitor_crawls SET fc_finished_at = UTC_TIMESTAMP(3) - INTERVAL 8 DAY"))
    fc.calls.clear()
    fc.rendered["https://rival.example/a"] = full("Rendered /a", 400)
    assert firecrawl.enqueue_weekly(world.engine) == [rival]
    world.drain("collectors")
    assert fc.calls.count("/v2/scrape") == 1  # the ranking page only
    assert [e["kind"] for e in rows(world.engine, "SELECT kind FROM change_events")] == ["content"]
    assert firecrawl.enqueue_weekly(world.engine) == []  # not again within the week


def test_the_weekly_check_is_refused_without_firecrawl_or_without_ranking_pages(world, fc):
    rival = js_rival_read_by_firecrawl(world, fc)
    with world.engine.begin() as conn:
        conn.execute(text("DELETE FROM serp_results"))
    with pytest.raises(Refused, match="ranks"):
        firecrawl.set_weekly(world.engine, rival, True)
    with pytest.raises(Refused):
        firecrawl.set_weekly(world.engine, rival, "yes")


def test_the_weekly_route_answers_and_the_profile_shows_how_the_site_is_followed(world, fc):
    rival = js_rival_read_by_firecrawl(world, fc)
    answer = world.client.post(f"/api/competitors/{rival}/firecrawl/weekly", json={"site_id": world.own, "on": True})
    assert answer.status_code == 200 and answer.get_json()["on"] is True
    with world.engine.connect() as conn:
        state = profile._crawl_state(conn, rival)
    assert state["firecrawl"]["weekly"] is True
    assert state["follow"]["mode"] == crawl.ALL


# ---- scenario 6: a site that blocks the reader is followed from outside ---------------------------------------

def test_a_blocked_site_gets_a_probable_edit_when_its_title_changes_in_my_ranking_checks(world):
    world.pages["rival.example/robots.txt"] = "User-agent: *\nDisallow: /\n"
    rival = first_read(world)
    assert scalar(world.engine, "SELECT status FROM competitor_crawls WHERE competitor_id = :c", c=rival) == "blocked"
    save_check(world, "dubai licence", "https://rival.example/licence", "Licence Dubai: prices 2025")
    assert crawl.guess_blocked_edits(world.engine) == 0  # one check: nothing to compare yet
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = checked_at - INTERVAL 1 DAY"))
    save_check(world, "dubai licence", "https://rival.example/licence", "Licence Dubai: new prices 2026")
    assert crawl.guess_blocked_edits(world.engine) == 1
    assert crawl.guess_blocked_edits(world.engine) == 0  # reported once
    event = rows(world.engine, "SELECT e.kind, e.before_value, e.after_value, p.url FROM change_events e JOIN pages p ON p.id = e.page_id")
    assert event == [{"kind": "search_title", "before_value": "Licence Dubai: prices 2025", "after_value": "Licence Dubai: new prices 2026", "url": "https://rival.example/licence"}]
    assert "https://rival.example/licence" not in world.requests  # never read: the site said no
    assert [e["kind"] for e in profile.profile(world.engine, world.own, rival)["timeline"] if e["kind"] == "search_title"] == ["search_title"]


def test_a_readable_site_gets_no_guess_because_its_page_is_simply_read(world):
    site(world, 3)
    first_read(world)
    save_check(world, "dubai licence", "https://rival.example/p1", "Old title")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = checked_at - INTERVAL 1 DAY"))
    save_check(world, "dubai licence", "https://rival.example/p1", "New title")
    assert crawl.guess_blocked_edits(world.engine) == 0
