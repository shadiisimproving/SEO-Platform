"""Does a backlink count for Google, what Search Console lists, links to reclaim, disavow and the budget. Made-up sites only."""
import io
import zipfile

import httpx
import pytest
from sqlalchemy import text

from seo.backlinks import live, protect, reclaim, service
from seo.crawl.fetch import PoliteFetcher
from seo.imports import gsc_links
from seo.links import service as links
from seo.web import create_app
from seo.worker.runner import tick

ALLOW = lambda url: True  # noqa: E731
LINK = '<a href="https://shop-one.test/page/">our page</a>'


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    # A page is its HTML, or (status, html, headers), or a status alone.
    pages = {"blog.example/post": LINK, "shop-one.test/page/": '<html lang="fr"><p>mine</p></html>'}

    def website(request):
        key = f"{request.url.host}{request.url.raw_path.decode()}"
        found = pages.get(key)
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=found) if found else httpx.Response(404)
        if found is None:
            return httpx.Response(404, text="nope")
        if isinstance(found, int):
            return httpx.Response(found, text="no")
        if isinstance(found, tuple):
            return httpx.Response(found[0], html=found[1], headers=found[2])
        return httpx.Response(200, html=found)

    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=ALLOW, transport=httpx.MockTransport(website)))
    monkeypatch.setattr(service.logos, "queue_for", lambda engine, domains: None)

    class World:
        pass

    w = World()
    w.engine, w.pages = engine, pages
    w.client = create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client()
    w.own = links.add_site(engine, "https://shop-one.test/", "own", is_allowed=ALLOW)["id"]
    w.tick = lambda: tick(engine, "crawl", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)

    def add(source="https://blog.example/post", **fields):
        return service.save_many(engine, [{"site_id": w.own, "source_url": source, "target_url": "/page/", **fields}])["saved"][0]["id"]

    def link(backlink_id):
        return next(b for b in w.client.get(f"/api/backlinks?site_id={w.own}").get_json()["backlinks"] if b["id"] == backlink_id)

    def press(backlink_id):
        assert w.client.post(f"/api/backlinks/{backlink_id}/check").status_code == 202
        w.tick()
        return link(backlink_id)["check"]

    def upload(body, name="links.csv"):
        data = body.encode() if isinstance(body, str) else body
        return w.client.post("/api/backlinks/gsc-import", data={"site_id": str(w.own), "file": (io.BytesIO(data), name)}, content_type="multipart/form-data")

    w.add, w.link, w.press, w.upload = add, link, press, upload
    return w


# ---- does it count -----------------------------------------------------------------------------------

def test_a_plain_followed_link_on_an_indexable_page_counts(world):
    check = world.press(world.add())
    assert check["verdict"] == "counts" and check["reasons"] == [] and check["target_http"] == 200 and check["target_lang"] == "fr"


@pytest.mark.parametrize("page,verdict,reason", [
    (f'<head><meta name="robots" content="noindex, follow"></head>{LINK}', "none", "noindex"),
    (f'<head><meta name="googlebot" content="none"></head>{LINK}', "none", "page_nofollow"),
    (f'<head><meta name="bingbot" content="noindex"></head>{LINK}', "counts", None),
    ((200, LINK, {"X-Robots-Tag": "noindex"}), "none", "noindex"),
    ((200, LINK, {"X-Robots-Tag": "max-snippet: 20"}), "counts", None),
    ('<a href="https://shop-one.test/page/" rel="sponsored">x</a>', "weak", "sponsored"),
    ('<a href="https://shop-one.test/page/" rel="ugc nofollow">x</a>', "weak", "ugc"),
    (f'<head><link rel="canonical" href="https://blog.example/other"></head>{LINK}', "weak", "canonical_elsewhere"),
    (f'<head><link rel="canonical" href="/post"></head>{LINK}', "counts", None),
    (LINK + "".join(f'<a href="https://site{i}.example/">{i}</a>' for i in range(101)), "weak", "many_outbound"),
])
def test_the_verdict_and_its_reason(world, page, verdict, reason):
    world.pages["blog.example/post"] = page
    check = world.press(world.add())
    assert check["verdict"] == verdict
    assert (reason in check["reasons"]) if reason else check["reasons"] == []


def test_a_page_google_may_not_crawl_passes_nothing(world):
    world.pages["blog.example/robots.txt"] = "User-agent: Googlebot\nDisallow: /post\n"
    check = world.press(world.add())
    assert check["outcome"] == "found" and check["verdict"] == "none" and check["reasons"] == ["robots_blocked"]


def test_a_lost_link_has_no_verdict_and_the_history_keeps_it(world):
    backlink = world.add()
    assert world.press(backlink)["verdict"] == "counts"
    world.pages["blog.example/post"] = "<p>gone</p>"
    assert world.press(backlink)["verdict"] is None
    with world.engine.connect() as conn:
        assert [r[0] for r in conn.execute(text("SELECT verdict FROM backlink_checks ORDER BY id"))] == ["counts", None]


def test_a_link_to_a_gone_page_of_mine_shows_in_reclaim(world):
    world.pages["shop-one.test/page/"] = 404
    backlink = world.add()
    assert world.press(backlink)["target_http"] == 404
    pages = world.client.get(f"/api/backlinks/reclaim?site_id={world.own}").get_json()["pages"]
    assert len(pages) == 1 and pages[0]["path"] == "/page" and pages[0]["logged_links"] == 1 and pages[0]["domains"] == ["blog.example"]


def test_robots_words():
    assert live._robots_words("googlebot: noindex") == {"noindex"}
    assert live._robots_words("bingbot: noindex") == set()
    assert live._robots_words("unavailable_after: 2026-01-01, nofollow") == {"nofollow"}


# ---- Search Console's Links export --------------------------------------------------------------------

LATEST = "Linking page,Last crawled\nhttps://blog.example/post,2026-08-01\nhttps://news.example/story,\"Aug 3, 2026\"\nhttps://shop-one.test/inside,2026-08-02\nnot an address,2026-08-02\n"


def test_latest_links_fill_found_and_tag_logged_links(world):
    logged = world.add()
    answer = world.upload(LATEST).get_json()
    assert answer["kinds"] == ["latest"] and answer["added"] == 1 and answer["seen"] == 1 and answer["skipped"] == 1  # my own page; a cell that is no address is never read
    assert world.link(logged)["gsc"]["seen"] == "page" and world.link(logged)["gsc"]["crawled"] == "2026-08-01"
    found = [b for b in world.client.get(f"/api/backlinks?site_id={world.own}").get_json()["backlinks"] if b["status"] == "found"]
    assert len(found) == 1 and found[0]["source_url"] == "https://news.example/story" and found[0]["found_by"] == "Search Console" and found[0]["gsc"]["crawled"] == "2026-08-03"
    again = world.upload(LATEST).get_json()
    assert again["added"] == 0 and again["again"] == 1  # the same file twice adds nothing


def test_a_french_export_with_semicolons_and_a_bom_is_read(world):
    body = "﻿Page associée;Dernière exploration\nhttps://news.example/story;3 août 2026\n"
    answer = world.upload(body.encode("utf-8")).get_json()
    assert answer["added"] == 1
    assert gsc_links.parse_day("3 août 2026") == "2026-08-03" and gsc_links.parse_day("8/30/26") == "2026-08-30" and gsc_links.parse_day("30/08/2026") == "2026-08-30"


def test_top_linking_sites_mark_a_logged_link_as_site_seen(world):
    logged = world.add("https://www.blog.example/another")
    answer = world.upload("Site,Linking pages,Target pages\nblog.example,12,3\nnews.example,1,1\n").get_json()
    assert answer["kinds"] == ["sites"] and answer["domains"] == 2 and answer["site_seen"] == 1
    assert world.link(logged)["gsc"]["seen"] == "site"
    world.upload(LATEST.replace("https://blog.example/post", "https://www.blog.example/another"))
    assert world.link(logged)["gsc"]["seen"] == "page"  # the exact page outranks the site


def test_top_linked_pages_are_read_and_a_gone_one_shows_in_reclaim(world):
    world.pages["shop-one.test/old/"] = 410
    zipped = io.BytesIO()
    with zipfile.ZipFile(zipped, "w") as box:
        box.writestr("Top linked pages.csv", "Target page,Incoming links,Linking sites\nhttps://shop-one.test/old/,1 204,17\nhttps://shop-one.test/page/,4,2\n")
    answer = world.upload(zipped.getvalue(), "links.zip").get_json()
    assert answer["kinds"] == ["pages"] and answer["pages"] == 2
    world.tick()
    pages = world.client.get(f"/api/backlinks/reclaim?site_id={world.own}").get_json()["pages"]
    assert [(p["path"], p["http"], p["gsc_links"], p["sites"]) for p in pages] == [("/old", 410, 1204, 17)]
    assert world.client.post(f"/api/backlinks/reclaim/{pages[0]['gsc_id']}/dismiss").status_code == 200
    assert world.client.get(f"/api/backlinks/reclaim?site_id={world.own}").get_json()["pages"] == []
    assert reclaim.enqueue_due(world.engine) == []  # read this month already


def test_a_file_that_is_not_a_links_export_is_refused(world):
    answer = world.upload("Name,Colour\nalpha,red\n")
    assert answer.status_code == 400 and "Search Console Links export" in answer.get_json()["error"]


def test_not_listed_after_sixty_days(world):
    old, new = world.add(placed="2026-01-01"), world.add("https://other.example/x")
    world.upload("Linking page,Last crawled\nhttps://news.example/story,2026-08-01\n")
    assert world.link(old)["gsc"]["not_listed"] is True
    assert world.link(new)["gsc"]["not_listed"] is False  # logged today: too soon to say


# ---- protecting the links ------------------------------------------------------------------------------

def test_disavow_file_lists_marked_domains_only(world):
    spam, fine = world.add("https://spam.example/x"), world.add()
    assert world.client.post(f"/api/backlinks/{spam}/disavow", json={"disavow": True}).get_json()["disavow"] is True
    body = world.client.get(f"/api/backlinks/disavow.txt?site_id={world.own}")
    assert body.headers["Content-Disposition"].startswith("attachment")
    lines = body.get_data(as_text=True).splitlines()
    assert "domain:spam.example" in lines and "domain:blog.example" not in lines and lines[0].startswith("# Disavow file for shop-one.test")
    assert world.link(spam)["disavow"] is True and world.link(fine)["disavow"] is False
    assert world.client.post(f"/api/backlinks/{spam}/disavow", json={"disavow": "yes"}).status_code == 400


def test_suggested_spam():
    assert protect.suggested({"outbound_links": 150, "spam_score": None})
    assert protect.suggested({"outbound_links": 3, "spam_score": 45})
    assert not protect.suggested({"outbound_links": 3, "spam_score": 10})


def test_budget_is_saved_checked_and_cleared(world):
    put = lambda body: world.client.put("/api/backlinks/budget", json={"site_id": world.own, **body})  # noqa: E731
    assert put({"amount": "500", "currency": "EUR"}).get_json()["budget"] == {"amount": 500.0, "currency": "EUR", "total": None}
    assert world.client.get(f"/api/backlinks/budget?site_id={world.own}").get_json()["budget"]["currency"] == "EUR"
    assert put({"amount": "-1", "currency": "EUR"}).status_code == 400
    assert put({"amount": "10", "currency": "BTC"}).status_code == 400
    assert put({"amount": ""}).get_json()["budget"] is None


def test_open_pagerank_shows_when_known(world):
    backlink = world.add()
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO authority_monthly (domain, month, score) VALUES ('blog.example', '2026-10', 4.27), ('blog.example', '2026-11', NULL)"))
    assert world.link(backlink)["opr"] == 4.3


# ---- is my target page indexed: Search Console's URL Inspection -----------------------------------------

@pytest.fixture
def google(world, tmp_path, monkeypatch):
    """A fake URL Inspection. Each of my pages answers what `world.index[path]` says; nothing goes to Google."""
    import json

    from seo.collectors import http as source_http
    from seo.core import crypto
    from seo.sources import credentials, service as sources

    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)
    asked, index = [], {}

    def fake(request):
        body = json.loads(request.content)
        asked.append(body)
        answer = index.get(httpx.URL(body["inspectionUrl"]).path, {"verdict": "PASS", "coverageState": "Submitted and indexed", "lastCrawlTime": "2026-10-20T08:15:00Z"})
        if isinstance(answer, int):
            return httpx.Response(answer, json={"error": {"message": "no access"}})
        return httpx.Response(200, json={"inspectionResult": {"indexStatusResult": answer}})

    monkeypatch.setattr(source_http, "transport", httpx.MockTransport(fake))
    monkeypatch.setattr(credentials, "token_override", lambda connection_id: "fake-token")
    world.asked, world.index = asked, index
    world.collect = lambda: tick(world.engine, "collectors", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)

    def connect(prop="sc-domain:shop-one.test"):
        connection = sources.add_google(world.engine, "Team", "robot", {"client_email": "robot@x.iam.gserviceaccount.com", "private_key": "k", "private_key_id": "abcd1234"})
        sources.save_site_source(world.engine, world.own, "gsc", {"connection_id": connection["id"], "property": prop})

    world.connect = connect
    return world


def test_without_search_console_nothing_is_asked(google):
    backlink = google.add()
    google.press(backlink)
    google.collect()
    assert google.asked == [] and google.link(backlink)["target_index"] is None
    answer = google.client.get(f"/api/backlinks?site_id={google.own}").get_json()
    assert answer["site"]["index_check"] is False


def test_check_now_asks_google_whether_my_page_is_indexed(google):
    google.connect()
    google.pages["blog.example/other"] = '<a href="https://shop-one.test/new/">x</a>'
    google.pages["blog.example/third"] = '<a href="https://shop-one.test/dup/">x</a>'
    google.pages["shop-one.test/new/"] = "<p>new</p>"
    google.pages["shop-one.test/dup/"] = "<p>dup</p>"
    google.index["/new/"] = {"verdict": "NEUTRAL", "coverageState": "Crawled - currently not indexed", "lastCrawlTime": "2026-10-01T00:00:00Z"}
    google.index["/dup/"] = {"verdict": "NEUTRAL", "coverageState": "Duplicate, Google chose different canonical than user", "googleCanonical": "https://shop-one.test/page/"}
    ok, new, dup = google.add(), google.add("https://blog.example/other", target_url="/new/"), google.add("https://blog.example/third", target_url="/dup/")
    google.press(ok)
    google.collect()
    assert google.asked[0] == {"inspectionUrl": "https://shop-one.test/page/", "siteUrl": "sc-domain:shop-one.test", "languageCode": "en-US"}
    shown = {b: google.link(b)["target_index"] for b in (ok, new, dup)}
    assert shown[ok]["state"] == "indexed" and shown[ok]["crawled"] == "2026-10-20"
    assert shown[new]["state"] == "not_indexed" and shown[new]["coverage"] == "Crawled - currently not indexed"
    assert shown[dup]["google_canonical"] == "https://shop-one.test/page/" and shown[ok]["google_canonical"] is None
    assert len(google.asked) == 3  # every live link's page, once
    assert google.client.get(f"/api/backlinks?site_id={google.own}").get_json()["site"]["index_check"] is True
    from seo.backlinks import indexed
    assert indexed.enqueue_due(google.engine) == []  # all asked about recently


def test_a_page_google_never_saw_and_one_outside_the_property(google):
    google.connect("https://www.shop-one.test/")  # a prefix property: shop-one.test without www isn't in it
    google.index["/page/"] = {"verdict": "NEUTRAL", "coverageState": "URL is unknown to Google"}
    backlink = google.add()
    google.press(backlink)
    google.collect()
    assert google.asked == [] and "Not in the site's Search Console property" in google.link(backlink)["target_index"]["error"]
    google.connect()
    from seo.backlinks import indexed
    with google.engine.begin() as conn:
        conn.execute(text("UPDATE gsc_inspections SET inspected_at = UTC_TIMESTAMP(3) - INTERVAL 8 DAY"))
    assert indexed.enqueue_due(google.engine) == [google.own]  # not indexed: asked again after a week
    google.collect()
    assert google.link(backlink)["target_index"]["state"] == "unknown"


def test_a_key_that_cannot_inspect_stops_and_says_so(google):
    google.connect()
    google.index["/page/"] = 403
    backlink = google.add()
    google.add("https://other.example/x", target_url="/new/")  # a second page, never asked about once Google refused
    google.press(backlink)
    google.collect()
    assert len(google.asked) == 1 and "refused access" in google.link(backlink)["target_index"]["error"]


def test_my_sites_language_for_the_add_form(world):
    assert service.site_facts(world.engine, world.own)["lang"] is None
    world.press(world.add())  # my target page says lang="fr"
    assert service.site_facts(world.engine, world.own)["lang"] == "fr"


# ---- is the linking page on Google: a site: search on free credits -----------------------------------------

class Searcher:
    """A Google search tool that answers from `world.on_google`: the pages Google has."""

    def __init__(self, on_google, name="SerpApi", free_monthly=250, paid_per=None, stop=False):
        self.name, self.free_monthly, self.free_once, self.paid_per, self.stop = name, free_monthly, None, paid_per, stop
        self.most_per_search, self.credits_per_page, self.per_hour, self.manual_only = 1, 1, None, False
        self.on_google, self.calls = on_google, []

    def search(self, keyword, engine, country, language, device, depth):
        from seo.serp.tools import Answer, Found, ToolStopped
        self.calls.append(keyword)
        if self.stop:
            raise ToolStopped("no free searches left")
        prefix = keyword.removeprefix("site:")
        rows = [Found(i + 1, f"https://{p}/") for i, p in enumerate(p for p in self.on_google if p.startswith(prefix))]
        return Answer(self.name, "US", depth, rows, "not_captured", [], 1)


@pytest.fixture
def search(world, monkeypatch, tmp_path):
    from seo.serp import connections
    world.on_google, world.tools = ["blog.example/post"], []
    world.tools.append(Searcher(world.on_google))
    monkeypatch.setattr(connections, "tool_factory", lambda engine, name: list(world.tools) if name == "google" else [])
    world.searching = lambda: tick(world.engine, "refresh", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    return world


def test_a_linking_page_on_google_is_found_by_a_site_search(search):
    backlink = search.add()
    search.press(backlink)
    search.searching()
    shown = search.link(backlink)["source_index"]
    assert shown["state"] == "indexed" and shown["via"] == "SerpApi" and search.tools[0].calls == ["site:blog.example/post"]
    from seo.serp import connections
    assert connections.used_this_month(search.engine, "SerpApi") == 1  # counted on its free allowance, like a rankings search


def test_one_miss_is_not_yet_proof_two_are(search):
    search.pages["other.example/x"] = LINK
    backlink = search.add("https://other.example/x")
    search.press(backlink)
    search.searching()
    assert search.link(backlink)["source_index"]["state"] == "not_found"
    assert search.link(backlink)["check"]["verdict"] == "counts"  # one miss changes nothing yet
    with search.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET src_index_at = UTC_TIMESTAMP(3) - INTERVAL 4 DAY"))
    from seo.backlinks import source_index
    assert source_index.enqueue_due(search.engine)
    search.searching()
    link = search.link(backlink)
    assert link["source_index"]["state"] == "not_indexed"
    assert link["check"]["verdict"] == "none" and "source_not_indexed" in link["check"]["reasons"]


def test_free_signals_cost_no_search(search):
    search.pages["blog.example/post"] = f'<head><meta name="robots" content="noindex"></head>{LINK}'
    noindex = search.add()
    search.press(noindex)
    search.searching()
    assert search.link(noindex)["source_index"]["state"] == "not_indexable" and search.tools[0].calls == []
    listed = search.add("https://news.example/story")
    search.upload("Linking page,Last crawled\nhttps://news.example/story,2026-08-01\n")
    assert search.link(listed)["source_index"] == {"state": "indexed", "via": "Search Console", "at": "2026-08-01"}


def test_only_free_searches_are_used(search):
    search.tools[:] = [Searcher(search.on_google, "Paid only", free_monthly=None, paid_per=0.01), Searcher(search.on_google, "Out", stop=True)]
    backlink = search.add()
    search.press(backlink)
    search.searching()
    assert search.tools[0].calls == [] and search.link(backlink)["source_index"] is None  # the stopped one was tried, the paid one never
    from seo.serp import connections
    assert connections.used_this_month(search.engine, "Out") == 0  # given back: it didn't answer


# ---- Ahrefs: each linking website's traffic, only with its key ---------------------------------------------

@pytest.fixture
def ahrefs_api(world, tmp_path, monkeypatch):
    from seo.collectors import http as source_http
    from seo.core import crypto
    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)
    world.ahrefs_calls, world.ahrefs_status = [], 200

    def fake(request):
        world.ahrefs_calls.append(request)
        if world.ahrefs_status != 200:
            return httpx.Response(world.ahrefs_status, json={"error": "Insufficient API units"})
        if "domain-rating" in request.url.path:
            return httpx.Response(200, json={"domain_rating": {"domain_rating": 91.0, "ahrefs_rank": 3}})
        return httpx.Response(200, json={"metrics": {"org_traffic": {"blog.example": 51578}.get(request.url.params["target"], 0), "org_keywords": 10}})

    monkeypatch.setattr(source_http, "transport", httpx.MockTransport(fake))
    world.collect = lambda: tick(world.engine, "collectors", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    return world


def test_site_traffic_is_hidden_without_an_ahrefs_key(ahrefs_api):
    backlink = ahrefs_api.add()
    from seo.backlinks import ahrefs
    assert ahrefs.enqueue(ahrefs_api.engine) is False
    assert ahrefs_api.link(backlink)["site_traffic"] is None
    assert ahrefs_api.client.get(f"/api/backlinks?site_id={ahrefs_api.own}").get_json()["site"]["ahrefs"] is False


def test_site_traffic_comes_from_ahrefs_once_a_month(ahrefs_api):
    backlink = ahrefs_api.add()
    assert ahrefs_api.client.put("/api/app-keys/ahrefs", json={"key": "ahrefs-test-key"}).status_code == 200  # saving the key queues the read
    test = ahrefs_api.client.post("/api/app-keys/ahrefs/test").get_json()
    assert test["ok"] is True and ahrefs_api.ahrefs_calls[-1].url.params["target"] == "ahrefs.com"  # the free target: no units
    ahrefs_api.collect()
    metrics = [c for c in ahrefs_api.ahrefs_calls if c.url.path.endswith("/metrics")]
    assert len(metrics) == 1 and metrics[0].headers["Authorization"] == "Bearer ahrefs-test-key" and metrics[0].url.params["target"] == "blog.example"
    assert ahrefs_api.link(backlink)["site_traffic"] == 51578
    from seo.backlinks import ahrefs
    assert ahrefs.enqueue(ahrefs_api.engine) is False  # read this month already


def test_ahrefs_refusing_stops_and_is_shown_on_the_key(ahrefs_api):
    ahrefs_api.add()
    ahrefs_api.add("https://news.example/story")
    ahrefs_api.client.put("/api/app-keys/ahrefs", json={"key": "k"})
    ahrefs_api.ahrefs_status = 403
    ahrefs_api.collect()
    assert len(ahrefs_api.ahrefs_calls) == 1  # one refusal, then it stops for the month
    from seo.sources import service as sources
    assert "Ahrefs refused" in sources.app_key_status(ahrefs_api.engine, "ahrefs")["last_error"]


# ---- anchor types --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("anchor,expected", [
    ("www.shop-one.test", "url"), ("https://shop-one.test/page", "url"), ("shop-one.test", "url"),
    ("Shop One", "brand"), ("Shop-One coffee", "brand"), ("Café Corner", "brand"),
    ("coffee beans", "exact"), ("Coffée Beans!", "exact"), ("best coffee beans online", "partial"), ("beans for coffee lovers", "partial"),
    ("click here", "generic"), ("En savoir plus", "generic"), ("a lovely morning", "other"), ("", None),
])
def test_anchor_types(world, anchor, expected):
    from seo.backlinks import anchors
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, 'brand', 'café corner')"), {"s": world.own})
        kid = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES ('coffee beans', 'h-coffee-beans', 'FR', 'fr')")).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": world.own, "k": kid})
        brand, keywords = anchors.words_for_site(conn, world.own, "shop-one.test")
    assert anchors.kind(anchor, brand, keywords) == expected


def test_the_list_gives_each_link_its_anchor_type(world):
    backlink = world.add(anchor="click here")
    assert world.link(backlink)["anchor_type"] == "generic"


# ---- F2, F108, F105: the right address, never "not indexed" from other pages, platforms -----------------

class GoogleLike(Searcher):
    """site: searches the way Google answers them: every page whose address starts with what was asked, query string ignored."""

    def search(self, keyword, engine, country, language, device, depth):
        from seo.serp.tools import Answer, Found
        self.calls.append(keyword)
        prefix = keyword.removeprefix("site:").split("?")[0]
        rows = [Found(i + 1, f"https://{p}") for i, p in enumerate(p for p in self.on_google if p.removeprefix("www.").startswith(prefix))][:10]
        return Answer(self.name, "US", depth, rows, "not_captured", [], 1)


def miss_twice(search, backlink):
    from seo.backlinks import source_index
    search.press(backlink)
    search.searching()
    with search.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET src_index_at = UTC_TIMESTAMP(3) - INTERVAL 4 DAY"))
    source_index.enqueue_due(search.engine)
    search.searching()
    return search.link(backlink)


def test_a_page_with_a_query_string_is_searched_with_it_and_other_threads_never_make_it_not_indexed(search):
    search.tools[:] = [GoogleLike([f"forum.example/viewtopic.php?t={n}" for n in (999, 998, 997)])]
    search.pages["forum.example/viewtopic.php?t=123"] = LINK
    backlink = search.add("https://forum.example/viewtopic.php?t=123")
    link = miss_twice(search, backlink)
    assert search.tools[0].calls[0] == "site:forum.example/viewtopic.php?t=123"
    assert link["source_index"]["state"] == "not_found" and link["check"]["verdict"] == "counts"


def test_a_home_page_answered_with_other_pages_of_the_site_is_not_called_not_indexed(search):
    search.tools[:] = [GoogleLike(["blog.example/a", "blog.example/b"])]
    search.pages["blog.example/"] = LINK
    backlink = search.add("https://blog.example/")
    link = miss_twice(search, backlink)
    assert link["source_index"]["state"] == "not_found" and link["check"]["verdict"] == "counts"


def test_a_page_with_a_query_string_that_comes_back_is_indexed(search):
    search.tools[:] = [GoogleLike(["www.forum.example/viewtopic.php?t=999", "www.forum.example/viewtopic.php?t=123"])]
    search.pages["forum.example/viewtopic.php?t=123"] = LINK
    backlink = search.add("https://forum.example/viewtopic.php?t=123")
    search.press(backlink)
    search.searching()
    assert search.link(backlink)["source_index"]["state"] == "indexed"


def test_a_logged_address_that_redirects_is_searched_where_it_ends_up(search):
    search.tools[:] = [GoogleLike(["blog.example/my-post"])]
    search.pages["blog.example/?p=123"] = (301, "", {"location": "https://blog.example/my-post"})
    search.pages["blog.example/my-post"] = LINK
    backlink = search.add("https://blog.example/?p=123")
    search.press(backlink)
    search.searching()
    assert search.tools[0].calls == ["site:blog.example/my-post"]
    assert search.link(backlink)["source_index"]["state"] == "indexed"


def test_an_accented_host_matches_its_xn_spelling():
    from seo.backlinks import source_index
    assert source_index.page_key("https://café.example/a/") == source_index.page_key("https://xn--caf-dma.example/a")
    assert source_index.query_for("https://www.café.example/a") == "site:xn--caf-dma.example/a"


def test_one_link_on_a_shared_platform_is_filed_under_its_own_blog(world):
    spam = world.add("https://spammy-site.blogspot.com/p")
    good = world.add("https://good-blog.blogspot.com/post")
    rows = {b["id"]: b for b in world.client.get(f"/api/backlinks?site_id={world.own}").get_json()["backlinks"]}
    assert rows[spam]["domain"] == "spammy-site.blogspot.com" and rows[good]["domain"] == "good-blog.blogspot.com"
    protect.mark_disavow(world.engine, spam, True)
    body, count = protect.disavow_file(world.engine, world.own)
    assert "domain:spammy-site.blogspot.com" in body and "domain:blogspot.com\n" not in body and count == 1


def test_a_link_saved_under_the_platform_before_the_fix_disavows_only_its_blog(world):
    spam = world.add("https://spammy-site.blogspot.com/p")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET domain = 'blogspot.com', disavow = 1 WHERE id = :i"), {"i": spam})
    body, _ = protect.disavow_file(world.engine, world.own)
    assert "domain:spammy-site.blogspot.com" in body and "domain:blogspot.com\n" not in body


def test_one_website_ahrefs_refuses_does_not_stop_the_others(ahrefs_api, monkeypatch):
    """F138: a 400 about one target ended the month's run for every website after it."""
    from seo.collectors import http as source_http
    first = ahrefs_api.add("https://bad-target.example/x")
    second = ahrefs_api.add()

    def fake(request):
        ahrefs_api.ahrefs_calls.append(request)
        if request.url.params.get("target") == "bad-target.example":
            return httpx.Response(400, json={"error": "invalid target"})
        return httpx.Response(200, json={"metrics": {"org_traffic": 51578}})

    ahrefs_api.client.put("/api/app-keys/ahrefs", json={"key": "k"})
    monkeypatch.setattr(source_http, "transport", httpx.MockTransport(fake))
    ahrefs_api.collect()
    assert ahrefs_api.link(second)["site_traffic"] == 51578 and ahrefs_api.link(first)["site_traffic"] is None
