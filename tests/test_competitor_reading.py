"""How well a competitor's site can be read (sitemap, cut list, days left, JavaScript-only), and Firecrawl as the asked-for backup.
Made-up sites only, and no real Firecrawl call."""
import json

import httpx
import pytest
from sqlalchemy import text

from seo.competitors import crawl, firecrawl, profile
from seo.core.errors import Refused
from seo.sources import service as sources
from tests.test_competitors_backend import add_rival, page_html, rows, scalar, seed, sitemap_xml, world  # noqa: F401  (world is a fixture)

SHELL = '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>'


def full(title, words=120):
    return page_html(title, " ".join(["real words about company setup"] * (words // 5)))


@pytest.fixture
def key(tmp_path, monkeypatch):
    from seo.core import crypto
    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)


class FakeFirecrawl:
    """Answers like Firecrawl's v2 API. rendered holds each page's HTML after JavaScript ran."""

    def __init__(self):
        self.rendered, self.mapped, self.calls, self.status = {}, [], [], 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(path)
        if self.status != 200:
            return httpx.Response(self.status, json={"success": False, "error": "nope"})
        if path == "/v2/team/credit-usage":
            return httpx.Response(200, json={"success": True, "data": {"remainingCredits": 900, "planCredits": 1000, "billingPeriodEnd": "2026-11-20T08:47:38.727Z"}})
        body = json.loads(request.content)
        if path == "/v2/map":
            return httpx.Response(200, json={"success": True, "links": [{"url": url} for url in self.mapped]})
        if path == "/v2/scrape":
            html = self.rendered.get(body["url"])
            if html is None:
                return httpx.Response(200, json={"success": True, "data": {"rawHtml": "", "metadata": {"statusCode": 404, "url": body["url"]}}})
            return httpx.Response(200, json={"success": True, "data": {"rawHtml": html, "metadata": {"statusCode": 200, "url": body["url"]}}})
        return httpx.Response(404, json={"success": False})


@pytest.fixture
def fc(monkeypatch, key, world):
    fake = FakeFirecrawl()
    monkeypatch.setattr(firecrawl, "transport", httpx.MockTransport(fake))
    sources.save_app_key(world.engine, "firecrawl", "fc-test-1234")
    return fake


def state(world, rival):
    with world.engine.connect() as conn:
        return profile._crawl_state(conn, rival)


def js_site(world, paths=("/a", "/b")):
    world.pages["rival.example/"] = SHELL
    for path in paths:
        world.pages[f"rival.example{path}"] = SHELL
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(paths)


# ---- how the site lists its pages ----------------------------------------------------------------

def test_a_site_with_a_sitemap_says_so_and_isnt_cut(world):
    world.pages["rival.example/"] = full("Home")
    world.pages["rival.example/a"] = full("A")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/a"])
    rival = add_rival(world)
    world.drain("crawl")
    s = state(world, rival)
    assert s["list_source"] == "sitemap" and s["list_capped"] is False and s["days_left"] is None and s["js_only"] == 0


def test_no_sitemap_is_flagged_as_links_only(world):
    world.pages["rival.example/"] = '<html><body><a href="/one">o</a></body></html>'
    world.pages["rival.example/one"] = full("One")
    rival = add_rival(world)
    world.drain("crawl")
    assert state(world, rival)["list_source"] == "links"


def test_a_feed_without_a_sitemap_is_flagged_as_feed(world):
    world.pages["rival.example/"] = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>x</body></html>'
    world.pages["rival.example/feed.xml"] = '<?xml version="1.0"?><rss><channel><item><link>https://rival.example/post</link></item></channel></rss>'
    world.pages["rival.example/post"] = full("Post")
    rival = add_rival(world)
    world.drain("crawl")
    assert state(world, rival)["list_source"] == "feed"


def test_a_sitemap_longer_than_the_app_takes_is_flagged(world, monkeypatch):
    monkeypatch.setattr(crawl, "MAX_DISCOVERED", 2)
    paths = [f"/p{i}" for i in range(5)]
    world.pages["rival.example/"] = full("Home")
    for path in paths:
        world.pages[f"rival.example{path}"] = full(path)
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(paths)
    rival = add_rival(world)
    world.drain("crawl")
    assert state(world, rival)["list_capped"] is True


def test_a_first_read_says_how_many_days_it_still_needs(world, monkeypatch):
    monkeypatch.setattr(crawl, "PAGES_PER_DAY", 2)
    from seo.competitors import reading
    monkeypatch.setattr(reading, "PAGES_PER_DAY", 2)
    paths = [f"/p{i}" for i in range(5)]
    world.pages["rival.example/"] = full("Home")
    for path in paths:
        world.pages[f"rival.example{path}"] = full(path)
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(paths)
    rival = add_rival(world)
    world.drain("crawl")
    s = state(world, rival)
    assert s["pages_known"] == 6 and s["pages_tried"] == 2 and s["days_left"] == 2 and s["per_day"] == 2


def test_javascript_only_pages_are_counted(world):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    s = state(world, rival)
    assert s["js_only"] == 3 and s["firecrawl"]["connected"] is False and s["firecrawl"]["pages"] == 0


# ---- Firecrawl: never by itself --------------------------------------------------------------------

def test_without_a_key_it_offers_nothing_and_refuses_to_start(world, key):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    offer = firecrawl.offer(world.engine, rival)
    assert offer["connected"] is False and offer["credits"] is None and offer["read"] == {"pages": 3, "credits": 3}
    with pytest.raises(Refused, match="Settings"):
        firecrawl.start(world.engine, rival, "read")


def test_nothing_is_spent_until_someone_starts_it(world, fc):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    world.drain("collectors")
    offer = firecrawl.offer(world.engine, rival)
    assert fc.calls == ["/v2/team/credit-usage"]  # the free balance check, and nothing else
    assert offer["credits"]["left"] == 900 and offer["read"]["credits"] == 3


def test_a_firecrawl_read_saves_the_real_text_and_reports_no_fake_edit(world, fc):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    for path in ("/", "/a", "/b"):
        fc.rendered[f"https://rival.example{path}"] = full(f"Rendered {path}")
    firecrawl.start(world.engine, rival, "read")
    world.drain("collectors")
    saved = rows(world.engine, "SELECT url, read_with, js_only, word_count FROM pages ORDER BY url")
    assert all(r["read_with"] == "firecrawl" and not r["js_only"] and r["word_count"] > 50 for r in saved)
    assert scalar(world.engine, "SELECT COUNT(*) FROM change_events") == 0
    s = state(world, rival)
    assert s["firecrawl"]["status"] == "ok" and s["firecrawl"]["done"] == 3 and "3 credits" in s["firecrawl"]["message"] and s["js_only"] == 0


def test_the_daily_reader_leaves_a_firecrawl_page_alone(world, fc):
    js_site(world, ("/a",))
    rival = add_rival(world)
    world.drain("crawl")
    fc.rendered["https://rival.example/a"] = full("Rendered")
    fc.rendered["https://rival.example/"] = full("Home")
    firecrawl.start(world.engine, rival, "read")
    world.drain("collectors")
    with world.engine.begin() as conn:  # a day later, and every page due again
        conn.execute(text("UPDATE pages SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 20 DAY"))
        conn.execute(text("UPDATE competitor_crawls SET finished_at = UTC_TIMESTAMP(3) - INTERVAL 1 DAY"))
    world.requests.clear()
    crawl.enqueue_due(world.engine)
    world.drain("crawl")
    assert "https://rival.example/a" not in world.requests
    assert scalar(world.engine, "SELECT word_count FROM pages WHERE url = 'https://rival.example/a'") > 50
    assert scalar(world.engine, "SELECT COUNT(*) FROM change_events") == 0


def test_a_second_firecrawl_read_finds_a_real_edit(world, fc):
    js_site(world, ())
    rival = add_rival(world)
    world.drain("crawl")
    fc.rendered["https://rival.example/"] = full("Home", 120)
    firecrawl.start(world.engine, rival, "read")
    world.drain("collectors")
    offer = firecrawl.offer(world.engine, rival)
    assert offer["read"] is None and offer["reread"] == {"pages": 1, "credits": 1}
    with pytest.raises(Refused, match="no page"):
        firecrawl.start(world.engine, rival, "read")
    fc.rendered["https://rival.example/"] = full("Home", 400)
    firecrawl.start(world.engine, rival, "reread")
    world.drain("collectors")
    assert [e["kind"] for e in rows(world.engine, "SELECT kind FROM change_events")] == ["content"]


def test_one_click_never_reads_more_than_the_cap(world, fc, monkeypatch):
    monkeypatch.setattr(firecrawl, "MOST_PER_RUN", 2)
    js_site(world, ("/a", "/b", "/c", "/d"))
    rival = add_rival(world)
    world.drain("crawl")
    assert firecrawl.start(world.engine, rival, "read", 100)["pages"] == 2
    world.drain("collectors")
    assert fc.calls.count("/v2/scrape") == 2


def test_pages_that_rank_for_my_keywords_are_read_first(world, fc):
    js_site(world, ("/a", "/b", "/c"))
    rival = add_rival(world)
    world.drain("crawl")
    seed(world.engine, world.own, "k1", ["rival.example/c"])
    for path in ("/", "/a", "/b", "/c"):
        fc.rendered[f"https://rival.example{path}"] = full(path)
    firecrawl.start(world.engine, rival, "read", 1)
    world.drain("collectors")
    assert rows(world.engine, "SELECT url FROM pages WHERE read_with = 'firecrawl'") == [{"url": "https://rival.example/c"}]


def test_a_refused_key_stops_and_says_so(world, fc):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    fc.status = 401
    firecrawl.start(world.engine, rival, "read")
    world.drain("collectors")
    s = state(world, rival)["firecrawl"]
    assert s["status"] == "failed" and "refused the key" in s["message"]


def test_it_wont_start_twice_at_once(world, fc):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    firecrawl.start(world.engine, rival, "read")
    with pytest.raises(Refused, match="already"):
        firecrawl.start(world.engine, rival, "read")


def test_a_map_adds_pages_the_daily_reader_then_reads(world, fc):
    world.pages["rival.example/"] = '<html><body><a href="/one">o</a></body></html>'
    world.pages["rival.example/one"] = full("One")
    world.pages["rival.example/deep/page"] = full("Deep")
    rival = add_rival(world)
    world.drain("crawl")
    assert firecrawl.offer(world.engine, rival)["map"] == {"credits": 1}
    fc.mapped = ["https://rival.example/one", "https://rival.example/deep/page", "https://elsewhere.example/x"]
    known = state(world, rival)["pages_known"]
    firecrawl.start(world.engine, rival, "map")
    world.drain("collectors")
    assert "1 the app didn't know" in state(world, rival)["firecrawl"]["message"]
    # The count the box shows grows as soon as the list run ends, not only after the next read.
    assert state(world, rival)["pages_known"] == known + 1
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE competitor_crawls SET finished_at = NULL"))
    world.drain("crawl")
    assert "https://rival.example/deep/page" in world.requests
    assert not scalar(world.engine, "SELECT COUNT(*) FROM pages WHERE url LIKE '%elsewhere%'")
    assert scalar(world.engine, "SELECT COUNT(*) FROM change_events WHERE kind = 'new_page'") == 0


def test_a_blocked_site_can_be_read_with_firecrawl_when_asked(world, fc):
    world.pages["rival.example/robots.txt"] = "User-agent: *\nDisallow: /\n"
    rival = add_rival(world)
    world.drain("crawl")
    assert state(world, rival)["status"] == "blocked"
    offer = firecrawl.offer(world.engine, rival)
    assert offer["blocked"] is True and offer["read"]["pages"] >= 1 and offer["map"] is None
    fc.rendered["https://rival.example/"] = full("Home")
    firecrawl.start(world.engine, rival, "read")
    world.drain("collectors")
    assert scalar(world.engine, "SELECT read_with FROM pages WHERE url = 'https://rival.example/'") == "firecrawl"


def test_the_routes_check_the_site_and_tracking(world, fc):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    got = world.client.get(f"/api/competitors/{rival}/firecrawl?site_id={world.own}")
    assert got.status_code == 200 and got.get_json()["read"]["pages"] == 3
    started = world.client.post(f"/api/competitors/{rival}/firecrawl", json={"site_id": world.own, "action": "read", "pages": 2})
    assert started.status_code == 202 and started.get_json()["pages"] == 2
    profile_json = world.client.get(f"/api/competitors/{rival}/profile?site_id={world.own}").get_json()
    assert profile_json["crawl"]["firecrawl"]["status"] == "queued"
