"""Google's hidden result links (https://www.google.com/goto?url=CAES…) and Bright Data's captcha replies, through every tool,
reader and the cleanup script (plan-seo-command-center-bright-data-goto-links-fix.md).

The fake replies have the shape of three real Bright Data replies of 2026-11-11 (Google, gl=fr, hl=fr, brd_json=1, format raw):
the same top-level keys, every field of an organic result, hidden rows whose display_link names the site with its path cut,
social posts whose display_link is a count of followers or likes, and a captcha answered 200 with an empty body. Every site is
made up, and nothing here contacts a search tool or Google.
"""
import json
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text

from scripts import mark_hidden_google_links as cleanup
from seo.backlinks import logos, source_index
from seo.competitors import crawl, insights, keywords, pairs, probe, suggest
from seo.links import service as links
from seo.serp import connections, rankings, refresh, store
from seo.serp.tools import (
    ABSENT, NOT_CAPTURED, PRESENT, Answer, BrightData, BrowserBackup, Found, HasData, HiddenAddresses, SearchFailed, Searlo, SerpApi, ToolStopped,
    google_redirect, result_address, shown_site,
)
from seo.worker import queue
from seo.worker.runner import RunAgain, tick

ALLOW = lambda url: True  # noqa: E731
ME = "my-site.example"
GOTO = "https://www.google.com/goto?url=CAESfakeToken"


# ---- replies shaped like today's ----------------------------------------------------------------------------

def organic(rank, link, display, title="A title", source="A site"):
    """One organic result with every field Bright Data's replies had, in their order."""
    return {
        "description": "Some words about the page.", "display_link": display, "extensions": [], "global_rank": rank + 1, "icon": "data:image/png;base64,AAAA",
        "link": link, "rank": rank, "snippet_highlighted_words": ["words"], "source": source, "title": title,
    }


def page_body(rows, keyword="creer societe"):
    """The whole parsed page: organic results among the other blocks Google showed."""
    return {
        "general": {"search_engine": "google", "query": keyword, "language": "fr", "location": "France", "mobile": False, "search_type": "text", "page_title": f"{keyword} - Recherche Google"},
        "input": {"original_url": f"https://www.google.com/search?q={keyword}&gl=fr&hl=fr&start=0&brd_json=1", "request_id": "fake-request"},
        "navigation": [{"title": "Images", "href": "https://www.google.com/search?tbm=isch"}],
        "organic": rows, "videos": [{"title": "A video", "link": "https://videos.example/v"}], "knowledge": {"name": "Something"},
        "pagination": {"current_page": 1}, "people_also_ask": [{"question": "A question?"}], "ai_overview": {"texts": [{"snippet": "An answer."}]},
    }


def today_page(me_hidden=True, posts_named=True):
    """Like the first reply: two real links, then hidden ones. Two are social posts showing counts instead of an address."""
    return [
        organic(1, "https://rival-one.example/", "https://rival-one.example"),
        organic(2, "https://www.agency.example/mainland", "https://www.agency.example › mainland-companies"),
        organic(3, GOTO + "3", "https://www.rival-two.example › creer-une-societe-a-du..."),
        organic(4, GOTO + "4", "Plus de 1,7 k abonnés", "Créer (@someone)", "Instagram" if posts_named else "Créer Société (@someone)"),
        organic(5, GOTO + "5" if me_hidden else f"https://{ME}/creer", f"https://{ME}"),
        organic(6, GOTO + "6", "https://blog-three.example › comment-creer-une-societe-..."),
        organic(7, GOTO + "7", "https://www.partners.example › details-creation+de+so..."),
        organic(8, GOTO + "8", '3 "J\'aime" · il y a 7 mois', "A post", "Facebook" if posts_named else "Somebody"),
    ]


CAPTCHA = (200, b"", {"x-brd-error": "redirect location was rejected", "x-brd-error-code": "captcha", "x-brd-status-code": "502"})


def bright(*replies, seen=None):
    """Bright Data answering each request with the next reply (the last one again once they run out): organic rows, or
    (status, body, headers)."""
    waiting = list(replies)

    def answer(request):
        if seen is not None:
            seen.append(request)
        reply = waiting.pop(0) if len(waiting) > 1 else waiting[0]
        if isinstance(reply, tuple):
            return httpx.Response(reply[0], content=reply[1], headers=reply[2])
        return httpx.Response(200, content=json.dumps(page_body(reply)).encode(), headers={"content-type": "application/json", "x-brd-status-code": "200"})

    return BrightData("FAKEKEY", "serp_api1", client=httpx.Client(transport=httpx.MockTransport(answer)))


def google(tool, depth=10):
    return tool.search("creer societe", "google", "FR", "fr", "desktop", depth)


def answered(body):
    return httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)))


# ---- the tools --------------------------------------------------------------------------------------------

def test_a_hidden_link_counts_for_the_site_google_shows_and_keeps_its_place():
    found = google(bright(today_page()))
    assert [(r.position, r.url, r.host) for r in found.results] == [
        (1, "https://rival-one.example/", ""), (2, "https://www.agency.example/mainland", ""), (3, "", "www.rival-two.example"), (4, "", "instagram.com"),
        (5, "", ME), (6, "", "blog-three.example"), (7, "", "www.partners.example"), (8, "", "facebook.com"),
    ]
    assert found.charged == 1 and found.ai_state == NOT_CAPTURED
    assert [store.site_of(r) for r in found.results][2:4] == [("rival-two.example", "rival-two.example"), ("instagram.com", "instagram.com")]
    assert not any(store.site_of(r)[0].startswith("google.") for r in found.results)


def test_a_post_whose_site_google_doesnt_show_is_unknown_and_the_whole_answer_is_refused():
    with pytest.raises(HiddenAddresses) as caught:
        google(bright(today_page(posts_named=False)))
    assert isinstance(caught.value, ToolStopped)  # every caller moves to the next tool, as at a bot check
    assert "2 of the 8 results in Bright Data's answer" in str(caught.value) and caught.value.charged == 1


@pytest.mark.parametrize("shown", [
    "Plus de 1,7 k abonnés", '3 "J\'aime" · il y a 7 mois', "Plus de 30 réponses · il y a 3 ans", "47.1K+ followers", "1.7K followers", "17M+ views",
    "https://www.google.com › maps", "https://www.google.fr", "https://www.rival-two.exa…", "https://www.rival-two.exa...", "Rival Two › blog", "", None,
])
def test_words_under_a_title_are_no_site(shown):
    assert shown_site({"display_link": shown, "source": "Somebody (@someone)"}) == ""


@pytest.mark.parametrize("source, site", [
    ("Instagram", "instagram.com"), ("Facebook · A page", "facebook.com"), ("Quora", "quora.com"), ("YouTube · A channel", "youtube.com"),
    ("Instagram France", ""), ("Créer Société (@someone)", ""), ("", ""),
])
def test_only_a_known_platform_named_as_the_source_gives_a_site(source, site):
    assert shown_site({"display_link": "Plus de 1,7 k abonnés", "source": source}) == site


TOOLS = {  # the tool, how its answer wraps the results, and where it puts the address shown under a title
    "Bright Data": (lambda c: BrightData("K", "z", client=c), page_body, "display_link"),
    "HasData": (lambda c: HasData("K", client=c), lambda items: {"organicResults": items}, "displayedLink"),
    "Searlo": (lambda c: Searlo("K", client=c), lambda items: {"organic": items}, "domain"),
    "SerpApi": (lambda c: SerpApi("K", client=c), lambda items: {"organic_results": items}, "displayed_link"),
}


@pytest.mark.parametrize("name", list(TOOLS))
def test_every_google_tool_reads_the_shown_site_the_same_way(name):
    make, wrap, field = TOOLS[name]
    hidden = {"position": 2, "link": GOTO, "title": "Theirs", field: "rival-two.example" if field == "domain" else "https://www.rival-two.example › some-path-cut-sh..."}
    if name == "Searlo":
        hidden.update(redirectUrl=GOTO, resolved=False, displayedLink="https://rival-two.example › x")
    found = google(make(answered(wrap([{"position": 1, "link": f"https://{ME}/page", "title": "Mine"}, hidden]))))
    assert [(r.position, r.url) for r in found.results] == [(1, f"https://{ME}/page"), (2, "")]
    assert store.site_of(found.results[1]) == ("rival-two.example", "rival-two.example")


@pytest.mark.parametrize("name", list(TOOLS))
def test_every_google_tool_refuses_a_result_with_no_site(name):
    make, wrap, field = TOOLS[name]
    post = {"position": 1, "link": GOTO, "title": "A post", field: "Plus de 1,7 k abonnés", "source": "Somebody (@someone)"}
    with pytest.raises(HiddenAddresses) as caught:
        google(make(answered(wrap([post]))))
    assert name in str(caught.value) and caught.value.charged == (10 if name == "HasData" else 1)


def test_a_deeper_check_stops_at_the_first_page_with_an_unknown_result():
    seen = []
    with pytest.raises(HiddenAddresses) as caught:
        google(bright(today_page(posts_named=False), seen=seen), depth=20)
    assert len(seen) == 1 and caught.value.charged == 1  # page 2 is never asked for


def test_a_url_redirect_that_names_the_page_is_read_as_that_page():
    assert result_address("https://www.google.com/url?q=https://shop.example/a&sa=U") == ("https://shop.example/a", False)
    found = google(bright([organic(1, "https://www.google.fr/url?q=https://shop.example/a&sa=U", "https://shop.example › a")]))
    assert [(r.url, r.host) for r in found.results] == [("https://shop.example/a", "")]


def test_real_google_pages_are_not_taken_for_redirects():
    for link in ("https://support.google.com/a", "https://www.google.com/maps/x", "https://about.google/"):
        assert result_address(link) == (link, False) and not google_redirect(link)
    assert google_redirect(GOTO) and google_redirect("https://google.co.uk/url?q=x") and result_address(GOTO) == ("", True)


def test_two_hidden_rows_never_merge():
    rows = [organic(1, GOTO + "A", "https://rival-two.example › a"), organic(2, GOTO + "B", "https://rival-two.example › b"), organic(3, "https://rival-one.example/", "https://rival-one.example")]
    found = google(bright(rows))
    assert [(r.position, r.url, r.host) for r in found.results] == [(1, "", "rival-two.example"), (2, "", "rival-two.example"), (3, "https://rival-one.example/", "")]


def test_serpapi_ai_overview_with_a_hidden_source_is_not_captured():
    body = {"organic_results": [{"position": 1, "link": "https://one.example/", "title": "One"}], "ai_overview": {"references": [{"link": "https://cited.example/"}, {"link": GOTO}]}}
    found = google(SerpApi("K", client=answered(body)))
    assert found.ai_state == NOT_CAPTURED and found.ai_citations == []
    body["ai_overview"]["references"][1]["link"] = "https://www.google.com/url?q=https://other.example/b"
    found = google(SerpApi("K", client=answered(body)))
    assert found.ai_state == PRESENT and found.ai_citations == ["https://cited.example/", "https://other.example/b"]
    assert google(SerpApi("K", client=answered({"organic_results": body["organic_results"]}))).ai_state == ABSENT


BROWSER_PAGE = (
    b'<html><body><div id="search"><div><a href="https://one.example/"><h3>One</h3></a></div>'
    b'<div><a href="/goto?url=CAESx"><h3>Two</h3><cite>https://www.two.example<span> &#8250; blog</span></cite></a></div>'
    b'<div><a href="https://three.example/"><h3>Three</h3></a></div></div></body></html>'
)


def test_the_browser_keeps_a_relative_goto_link_in_its_place():
    def browser(page):
        return BrowserBackup("FR", open_page=lambda address: ("https://www.google.com/search", page), sleep=lambda seconds: None)

    found = google(browser(BROWSER_PAGE))
    assert [(r.position, r.url, r.host) for r in found.results] == [(1, "https://one.example/", ""), (2, "", "www.two.example"), (3, "https://three.example/", "")]
    with pytest.raises(HiddenAddresses):  # with no address shown under it: refused, never dropped with the rows below renumbered
        google(browser(BROWSER_PAGE.replace(b"<cite>https://www.two.example<span> &#8250; blog</span></cite>", b"")))


def test_a_captcha_reply_is_a_failed_search_that_says_so():
    with pytest.raises(SearchFailed) as caught:
        google(bright(CAPTCHA))
    assert not isinstance(caught.value, ToolStopped) and caught.value.charged == 0
    assert str(caught.value).startswith("Google showed Bright Data a captcha, so this search failed.")


def test_a_reply_that_isnt_json_says_what_came_back():
    page = b"<html><head><title>Un moment</title></head><body>Verifying   your\n request</body></html>"
    with pytest.raises(SearchFailed) as caught:
        google(bright((200, page, {"content-type": "text/html; charset=utf-8", "x-brd-error": "some_code", "x-brd-status-code": "502"})))
    message = str(caught.value)
    assert "text/html" in message and "some_code" in message and "x-brd-status-code: 502" in message and "Verifying your request" in message
    assert "FAKEKEY" not in message
    with pytest.raises(SearchFailed) as caught:  # the other tools say the same
        google(HasData("FAKEKEY", client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=page, headers={"content-type": "text/html"})))))
    assert "HasData answered 200 without data (text/html; " in str(caught.value) and "Un moment" in str(caught.value)


# ---- saving and Refresh, on the test database ----------------------------------------------------------------

class Fake:
    """A Google tool that finds my site at `position` among made-up rivals."""

    def __init__(self, name="SerpApi", position=1, free_monthly=250):
        self.name, self.position, self.free_monthly, self.calls = name, position, free_monthly, []
        self.free_once = self.paid_per = self.per_hour = None
        self.credits_per_page = self.most_per_search = 1

    def search(self, keyword, engine, country, language, device, depth):
        self.calls.append(keyword)
        rows = [Found(i + 1, f"https://rival{i}.example/x", "T") for i in range(10)]
        if self.position:
            rows[self.position - 1] = Found(self.position, f"https://{ME}/page", "Mine")
        return Answer(self.name, "FR", depth, rows, NOT_CAPTURED, [], 1)


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    w = SimpleNamespace(engine=engine, tools={})
    monkeypatch.setattr(connections, "tool_factory", lambda eng, name: list(w.tools.get(name, [])))
    monkeypatch.setattr(logos, "queue_for", lambda eng, domains: None)
    monkeypatch.setattr(crawl, "queue_own_if_never_read", lambda eng, site_id: False)
    w.site = links.add_site(engine, f"https://{ME}/", "own", is_allowed=ALLOW)["id"]
    w.drain = lambda: tick(engine, "refresh", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    return w


def track(world, *names):
    ids = []
    with world.engine.begin() as conn:
        for name in names:
            conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, 'FR', 'fr')"), {"k": name, "h": store.keyword_hash(name)})
            keyword_id = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = 'FR' AND language = 'fr'"), {"h": store.keyword_hash(name)}).scalar_one()
            conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": world.site, "k": keyword_id})
            ids.append(keyword_id)
    return ids


def run_now(world, ids):
    started = refresh.start(world.engine, {"keyword_ids": ids, "engines": ["google"], "depth": 10, "include_recent": True})
    world.drain()
    return refresh.run_dict(world.engine, started["id"])


def rows(world, sql, **params):
    with world.engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def spent(world, tool):
    return int(rows(world, "SELECT COALESCE(SUM(amount), 0) AS n FROM credit_ledger WHERE tool = :t", t=tool)[0]["n"])


def view_of(world, keyword_id):
    return next(r for r in rankings.listing(world.engine, world.site)["rows"] if r["keyword_id"] == keyword_id)["engines"]["google"]


def tiles(world):
    return rankings.listing(world.engine, world.site)["tiles"]["google"]


def save(world, keyword_id, urls, tool="SerpApi", status="ok", cited=()):
    """A check saved by the app, results in this order. A goto link is saved as the app did before the fix: under google.com."""
    found = [Found(i + 1, url, "A title") for i, url in enumerate(urls)]
    return store.save_check(world.engine, keyword_id, "google", Answer(tool, "FR", 10, found, PRESENT if cited else NOT_CAPTURED, list(cited), 1), status=status)


def add_rival(world, host="rival-one.example"):
    return suggest.add_competitor(world.engine, world.site, host, "manual", ALLOW)["id"]


def test_a_hidden_result_is_saved_under_its_site_with_no_address(world):
    keyword_id = track(world, "creer societe")[0]
    store.save_check(world.engine, keyword_id, "google", google(bright(today_page())))
    saved = rows(world, "SELECT position, url, host, domain FROM serp_results ORDER BY position")
    assert saved[4] == {"position": 5, "url": "", "host": ME, "domain": ME} and saved[2]["host"] == "rival-two.example"
    assert not any(r["host"].startswith("google.") for r in saved)
    main = view_of(world, keyword_id)["main"]
    assert (main["p"], main["url"], main["status"]) == (5, "", "ok") and tiles(world)["ranked"] == 1 and tiles(world)["not_ranked"] == 0


def test_refresh_asks_the_next_tool_when_google_hides_the_links(world):
    with world.engine.begin() as conn:  # a saved key, so the Connections page has a line to say why on
        conn.execute(text("INSERT INTO connections (tool, secret, last4) VALUES ('Bright Data', 'sealed', '1234')"))
    second = Fake("SerpApi", position=1)
    world.tools["google"] = [bright(today_page(posts_named=False)), second]
    keyword_id = track(world, "creer societe")[0]
    run = run_now(world, [keyword_id])
    assert run["status"] == "done" and run["done"] == 1 and second.calls == ["creer societe"]
    assert rows(world, "SELECT tool, status FROM serp_checks") == [{"tool": "SerpApi", "status": "ok"}]  # nothing from the refused answer
    main = view_of(world, keyword_id)["main"]
    assert (main["tool"], main["p"]) == ("SerpApi", 1) and tiles(world)["not_ranked"] == 0 and tiles(world)["top10"] == 1
    assert spent(world, "Bright Data") == 1  # the page came back and may have been billed: it stays counted
    assert "hid the address" in rows(world, "SELECT last_error FROM connections WHERE tool = 'Bright Data'")[0]["last_error"]


def test_refresh_keeps_my_position_when_my_link_is_hidden_and_compares_its_checks(world):
    # One real link and nine hidden ones, each on its own site: read by their addresses alone, the second page would hold
    # two "sites" against ten, and be called suspect.
    page = [organic(1, "https://rival-one.example/", "https://rival-one.example")]
    page += [organic(n, f"{GOTO}{n}", f"https://site{n}.example › page") for n in range(2, 10)] + [organic(10, f"{GOTO}10", f"https://{ME} › creer")]
    world.tools["google"] = [bright(page)]
    keyword_id = track(world, "creer societe")[0]
    run_now(world, [keyword_id])
    run_now(world, [keyword_id])  # the second is judged against the first: the same ten sites, so not suspect
    assert [r["status"] for r in rows(world, "SELECT status FROM serp_checks ORDER BY id")] == ["ok", "ok"]
    view = view_of(world, keyword_id)
    assert (view["main"]["tool"], view["main"]["p"], view["change"]) == ("Bright Data", 10, 0)


def test_a_captcha_counts_toward_dropping_the_tool_and_never_reads_as_not_ranked(world):
    seen, second = [], Fake("SerpApi", position=2)
    world.tools["google"] = [bright(CAPTCHA, seen=seen), second]
    ids = track(world, "one", "two", "three", "four")
    run = run_now(world, ids)
    failed = rows(world, "SELECT tool, error FROM serp_checks WHERE status = 'failed'")
    assert len(seen) == 3 and len(failed) == 3 and all(f["tool"] == "Bright Data" and f["error"].startswith("Google showed Bright Data a captcha") for f in failed)
    assert second.calls == ["one", "two", "three", "four"] and "Bright Data failed 3 searches in a row." in run["stop_reason"]
    assert tiles(world)["not_ranked"] == 0 and tiles(world)["ranked"] == 4 and spent(world, "Bright Data") == 0


def test_first_check_moves_to_the_next_tool_when_google_hides_the_links(world):
    seen, second = [], Fake("SerpApi", position=1)
    world.tools["google"] = [bright(today_page(posts_named=False), seen=seen), second]
    run = keywords.upload(world.engine, world.site, "one\ntwo\nthree", "FR", "fr")
    world.drain()
    done = keywords.run_dict(world.engine, run["id"])
    assert done["status"] == "complete" and done["checked"] == 3
    assert len(seen) == 1 and second.calls == ["one", "two", "three"]  # one refused answer, then the next tool for every keyword
    assert {r["tool"] for r in rows(world, "SELECT tool FROM serp_checks")} == {"SerpApi"}


def test_keyword_check_moves_on_when_google_hides_the_links(world):
    seen = []
    world.tools["google"] = [bright(today_page(posts_named=False), seen=seen), Fake("SerpApi", position=1)]
    probe.add(world.engine, world.site, "one\ntwo")
    probe.start(world.engine, world.site)
    world.drain()
    listed = probe.listing(world.engine, world.site)["keywords"]
    assert len(seen) == 1 and [k["me"]["position"] for k in listed] == [1, 1]


# ---- what reads the saved results ------------------------------------------------------------------------

def test_google_is_never_suggested_from_hidden_links(world):
    for n in range(5):
        keyword_id = track(world, f"k{n}")[0]
        save(world, keyword_id, ["https://rival-one.example/a", f"https://{ME}/m", "https://rival-two.example/b"])
        save(world, keyword_id, [GOTO + "1", "https://rival-one.example/a", GOTO + "2"], tool="Bright Data")  # as saved before the fix
    listed = suggest.suggestions(world.engine, world.site)
    assert "google.com" not in [s["domain"] for s in listed["suggestions"] + listed["platforms"]]
    cleanup.apply(world.engine)
    listed = suggest.suggestions(world.engine, world.site)
    assert "google.com" not in [s["domain"] for s in listed["suggestions"] + listed["platforms"]]
    assert {s["domain"]: s["keywords"] for s in listed["suggestions"]} == {"rival-one.example": 5, "rival-two.example": 5}
    assert all(e["my_position"] == 2 for s in listed["suggestions"] for e in s["evidence"])


def test_a_check_read_from_hidden_links_never_reads_as_not_ranked(world):
    keyword_id = track(world, "creer societe")[0]
    save(world, keyword_id, [f"https://{ME}/m", "https://rival-one.example/a"])
    old = save(world, keyword_id, [GOTO + "1", "https://rival-one.example/a"], tool="Bright Data")
    assert tiles(world)["not_ranked"] == 1  # what the screen said before: Bright Data goes first, and its #1 was "google.com"
    cleanup.apply(world.engine)
    assert rows(world, "SELECT status, error FROM serp_checks WHERE id = :i", i=old) == [{"status": "suspect", "error": cleanup.sentence(1)}]
    view = view_of(world, keyword_id)
    assert (view["main"]["tool"], view["main"]["p"]) == ("SerpApi", 1) and [s["tool"] for s in view["suspects"]] == ["Bright Data"]
    assert tiles(world)["not_ranked"] == 0 and tiles(world)["top10"] == 1


def test_the_keyword_panel_never_names_google_for_a_hidden_result(world):
    keyword_id = track(world, "creer societe")[0]
    save(world, keyword_id, [GOTO + "1", "https://rival-one.example/a", GOTO + "3"], tool="Bright Data")  # its only check, before the fix
    cleanup.apply(world.engine)
    shown = rankings.detail(world.engine, world.site, keyword_id, "google")
    assert shown["row"]["engines"]["google"]["main"]["status"] == "suspect"
    assert [(c["position"], c["hidden"]) for c in shown["competitors"]] == [(1, True), (2, False), (3, True)]  # the screen says "Hidden by Google"
    assert [c["p"] for c in shown["checks"]] == [None] and shown["checks"][0]["error"] == cleanup.sentence(2)


def test_automatic_pairs_come_back_after_cleanup(world):
    add_rival(world)
    keyword_id = track(world, "k1")[0]
    save(world, keyword_id, ["https://rival-one.example/t1", f"https://{ME}/m1"])
    pairs.refresh_auto_pairs(world.engine, world.site)
    assert [(p["my_url"], p["their_url"]) for p in pairs.list_pairs(world.engine, world.site)] == [(f"https://{ME}/m1", "https://rival-one.example/t1")]
    save(world, keyword_id, ["https://rival-one.example/t1", GOTO + "1"], tool="Bright Data")  # my row read as google.com, before the fix
    pairs.refresh_auto_pairs(world.engine, world.site)
    assert pairs.list_pairs(world.engine, world.site) == []  # what today's runs did
    assert cleanup.apply(world.engine)["rebuilt"] == [world.site]
    assert [(p["my_url"], p["their_url"], p["shared_keywords"]) for p in pairs.list_pairs(world.engine, world.site)] == [(f"https://{ME}/m1", "https://rival-one.example/t1", 1)]


def _check_with(world, keyword_id, results, tool="Bright Data"):
    """A check saved from today's kind of answer: Found rows, some with only a site."""
    return store.save_check(world.engine, keyword_id, "google", Answer(tool, "FR", 10, results, NOT_CAPTURED, [], 1))


def test_an_automatic_pair_stays_while_google_hides_one_of_the_pages(world):
    add_rival(world)
    keyword_id = track(world, "k1")[0]
    save(world, keyword_id, ["https://rival-one.example/t1", f"https://{ME}/m1"])
    pairs.refresh_auto_pairs(world.engine, world.site)
    _check_with(world, keyword_id, [Found(1, "", "T", "rival-one.example"), Found(2, f"https://{ME}/m1", "Mine")])  # their page hidden
    pairs.refresh_auto_pairs(world.engine, world.site)
    _check_with(world, keyword_id, [Found(1, "https://rival-one.example/t1", "T"), Found(2, "", "Mine", ME)])  # mine hidden
    pairs.refresh_auto_pairs(world.engine, world.site)
    assert [p["their_url"] for p in pairs.list_pairs(world.engine, world.site)] == ["https://rival-one.example/t1"]
    save(world, keyword_id, ["https://somebody.example/x"])  # neither site there any more: it goes, as before
    pairs.refresh_auto_pairs(world.engine, world.site)
    assert pairs.list_pairs(world.engine, world.site) == []


def test_a_pair_never_says_only_theirs_when_google_hid_my_page(world):
    rival = add_rival(world)
    keyword_id = track(world, "k1")[0]
    pair = pairs.create_pair(world.engine, world.site, rival, f"https://{ME}/m1", "https://rival-one.example/t1")
    _check_with(world, keyword_id, [Found(1, "https://rival-one.example/t1", "T"), Found(3, "", "Mine", ME)])
    summary = pairs.list_pairs(world.engine, world.site)[0]["ranking"]
    assert (summary["not_known"], summary["only_theirs"], summary["keywords"]) == (1, 0, [])
    row = pairs.pair_detail(world.engine, pair["id"])["keywords"][0]
    assert (row["my_position"], row["their_position"], row["my_unknown"], row["their_unknown"]) == (None, 1, True, False)
    assert row["my_other"] == {"url": "", "position": 3}  # the screen says "a page of yours, address not given by Google"
    _check_with(world, keyword_id, [Found(1, "https://rival-one.example/t1", "T"), Found(3, f"https://{ME}/other", "Mine")])
    summary = pairs.list_pairs(world.engine, world.site)[0]["ranking"]
    assert (summary["not_known"], summary["only_theirs"]) == (0, 1)  # an address that isn't this page: only theirs, as before


def test_their_best_pages_and_moving_pages_leave_out_results_with_no_address(world):
    rival = add_rival(world)
    one, two = track(world, "k1", "k2")
    _check_with(world, one, [Found(1, "", "T", "rival-one.example"), Found(2, "", "Mine", ME)])
    _check_with(world, two, [Found(1, f"https://{ME}/m", "Mine"), Found(2, "https://rival-one.example/t1", "T")])
    _check_with(world, two, [Found(1, f"https://{ME}/m", "Mine"), Found(2, "", "T", "rival-one.example")])
    _check_with(world, two, [Found(1, f"https://{ME}/m", "Mine"), Found(2, "https://rival-one.example/t1", "T")])
    with world.engine.connect() as conn:
        best = insights._best_pages(conn, world.site, rival, ME, "rival-one.example", store.latest_checks(world.engine, world.site), [])
    assert [(b["url"], b["keywords"], b["my_url"]) for b in best] == [("https://rival-one.example/t1", 1, f"https://{ME}/m")]
    assert insights._cannibal(store.history(world.engine, world.site), "rival-one.example") == {}


def test_two_pages_on_one_keyword_needs_two_addresses(world):
    one, two = track(world, "k1", "k2")
    _check_with(world, one, [Found(1, f"https://{ME}/a", "A"), Found(4, "", "B", ME)])
    _check_with(world, two, [Found(1, f"https://{ME}/a", "A"), Found(4, f"https://{ME}/b", "B")])
    listed = {r["keyword"]: r for r in rankings.listing(world.engine, world.site)["rows"]}
    assert (listed["k1"]["two_pages"], listed["k2"]["two_pages"]) == (False, True)


def test_the_keywords_export_only_says_not_found_where_a_check_could_say_it(world):
    from seo.exports import registry

    absent, flagged = track(world, "absent", "flagged")
    save(world, absent, ["https://rival-one.example/a"])
    save(world, flagged, ["https://rival-one.example/a"], status="suspect")
    note = lambda: registry.build(world.engine, "keywords", {"site_id": str(world.site)}).tables[0].note  # noqa: E731
    assert note() == "Empty position: not found in the results read, except on suspect checks, which couldn't read every result."
    save(world, absent, [f"https://{ME}/m"])
    assert note().startswith("Empty position on a suspect check") and tiles(world)["not_ranked"] == 0


# ---- is the linking page on Google ---------------------------------------------------------------------------

class SiteSearcher(Fake):
    """A Google tool answering site: searches with the pages Google has, with their real addresses."""

    def __init__(self, on_google, name="SerpApi"):
        super().__init__(name)
        self.on_google = on_google

    def search(self, keyword, engine, country, language, device, depth):
        self.calls.append(keyword)
        prefix = keyword.removeprefix("site:")
        return Answer(self.name, "US", depth, [Found(i + 1, f"https://{p}") for i, p in enumerate(p for p in self.on_google if p.startswith(prefix))], NOT_CAPTURED, [], 1)


def linking_pages(world, *addresses):
    ids = []
    with world.engine.begin() as conn:
        for address in addresses:
            ids.append(conn.execute(text(
                "INSERT INTO backlinks (site_id, source_url, target_url, domain, status, check_outcome) VALUES (:s, :u, '/page/', :d, 'live', 'found')"
            ), {"s": world.site, "u": f"https://{address}", "d": address.split("/")[0]}).lastrowid)
    return ids


def index_states(world):
    return [(r["src_index"], r["src_index_via"]) for r in rows(world, "SELECT src_index, src_index_via FROM backlinks ORDER BY id")]


def test_a_hidden_answer_never_marks_a_linking_page_not_found(world):
    seen = []
    # A site: search Bright Data answers with the pages hidden: their site is shown, and it's the site searched, so it proves nothing.
    world.tools["google"] = [bright([organic(1, GOTO + "1", "https://blog.example › post"), organic(2, GOTO + "2", "https://blog.example › other")], seen=seen)]
    linking_pages(world, "blog.example/post", "news.example/story")
    assert source_index.enqueue(world.engine)
    world.drain()
    assert len(seen) == 1 and index_states(world) == [(None, None), (None, None)]  # asked once, and nothing was written
    assert source_index.outcome("https://blog.example/post", [Found(1, "", "", "blog.example")]) == source_index.HIDDEN
    assert source_index.outcome("https://blog.example/post", [Found(1, "", "", "blog.example"), Found(2, "https://blog.example/post")]) == source_index.FOUND


def test_a_site_search_skips_a_stopped_tool_for_the_rest_of_the_run(world):
    seen, second = [], SiteSearcher(["blog.example/post"])
    world.tools["google"] = [bright(today_page(posts_named=False), seen=seen), second]
    linking_pages(world, "blog.example/post", "news.example/story")
    source_index.enqueue(world.engine)
    world.drain()
    assert len(seen) == 1 and second.calls == ["site:blog.example/post", "site:news.example/story"]
    assert index_states(world) == [("indexed", "SerpApi"), ("not_found", "SerpApi")]


def test_a_captcha_never_marks_a_linking_page_not_found(world):
    seen = []
    world.tools["google"] = [bright(CAPTCHA, seen=seen)]
    linking_pages(world, "blog.example/post", "news.example/story")
    source_index.enqueue(world.engine)
    world.drain()
    assert len(seen) == 1 and index_states(world) == [(None, None), (None, None)]  # failed, so the pages wait for the next run
    fails, stopped = {}, set()
    for _ in range(3):
        assert source_index.search(world.engine, "https://blog.example/post", stopped, fails) is None
    assert stopped == {"Bright Data"} and len(seen) == 4  # a third failure in a row, and it sits out the rest of the run


def test_a_stopped_tool_stays_out_of_the_jobs_later_parts(world, monkeypatch):
    seen, second = [], SiteSearcher(["blog.example/post", "news.example/story"])
    world.tools["google"] = [bright(today_page(posts_named=False), seen=seen), second]
    linking_pages(world, "blog.example/post", "news.example/story")
    job_id = queue.enqueue(world.engine, source_index.LANE, source_index.JOB_KIND, payload={"first": None}, dedupe_key="source-index")
    clock = iter([0.0, 0.0, 100.0])  # started, the first page in time, the second page out of time
    monkeypatch.setattr(source_index, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    with pytest.raises(RunAgain):
        source_index.run(SimpleNamespace(id=job_id, payload={"first": None}), world.engine)
    payload = rows(world, "SELECT payload FROM jobs WHERE id = :i", i=job_id)[0]["payload"]
    assert json.loads(payload) == {"first": None, "stopped": ["Bright Data"]}
    monkeypatch.setattr(source_index, "time", SimpleNamespace(monotonic=lambda: 0.0))
    source_index.run(SimpleNamespace(id=job_id, payload=json.loads(payload)), world.engine)
    assert len(seen) == 1 and second.calls == ["site:blog.example/post", "site:news.example/story"]
    assert index_states(world) == [("indexed", "SerpApi"), ("indexed", "SerpApi")]


# ---- the cleanup script --------------------------------------------------------------------------------------

def test_cleanup_marks_only_checks_with_google_redirects(world, capsys):
    one, two, three, four = track(world, "goto", "support", "plain", "cited")
    hidden = save(world, one, [GOTO + "1", "https://rival-one.example/a", GOTO + "2"], tool="Bright Data")
    google_page = save(world, two, ["https://support.google.com/a", f"https://{ME}/m"])
    plain = save(world, three, ["https://rival-one.example/a", f"https://{ME}/m"])
    cited = save(world, four, [f"https://{ME}/m"], cited=["https://cited.example/", GOTO + "9"])
    states = lambda: {r["id"]: (r["status"], r["ai_state"], r["error"]) for r in rows(world, "SELECT id, status, ai_state, error FROM serp_checks")}  # noqa: E731
    before = states()

    found = cleanup.survey(world.engine)  # the dry run reads, and changes nothing
    assert found["to_mark"] == {hidden: 2} and found["citations"] == [cited] and states() == before
    assert found["groups"] == [{"day": found["groups"][0]["day"], "tool": "Bright Data", "status": "ok", "checks": 1, "rows": 2}]
    assert cleanup.main(["--test-db"]) == 0 and states() == before
    said = capsys.readouterr().out
    assert 'Would mark suspect: 1 check that said "ok".' in said and "Nothing was changed." in said

    done = cleanup.apply(world.engine)
    assert (done["marked"], done["cited"]) == (1, 1)
    after = states()
    assert after[hidden] == ("suspect", "not_captured", "Google hid the address of 2 results in this check, so it can't say who isn't there.")
    assert after[google_page] == before[google_page] and after[plain] == before[plain]
    assert after[cited] == ("ok", "not_captured", None)
    again = cleanup.apply(world.engine)  # a second run changes nothing more
    assert (again["marked"], again["cited"], again["cleared"]) == (0, 0, 0) and states() == after


def test_cleanup_resets_only_site_searches_that_could_be_wrong(world):
    ids = linking_pages(world, "a.example/1", "b.example/2", "c.example/3", "d.example/4")
    answers = [("not_indexed", "Bright Data", "2026-11-05 10:00:00"), ("not_found", "SerpApi", "2026-11-01 10:00:00"),
               ("indexed", "Bright Data", "2026-11-05 10:00:00"), ("not_found", "Bright Data", "2026-10-20 10:00:00")]
    with world.engine.begin() as conn:
        for backlink_id, (state, via, at) in zip(ids, answers):
            conn.execute(text("UPDATE backlinks SET src_index = :s, src_index_via = :v, src_index_at = :a, src_index_misses = 2 WHERE id = :i"), {"s": state, "v": via, "a": at, "i": backlink_id})
    narrow = cleanup.survey(world.engine, only_tool="Bright Data")
    assert narrow["index"] == [ids[0]]
    done = cleanup.apply(world.engine)
    assert done["cleared"] == 2 and done["rebuilt"] == []  # no check changed, so no pair to rebuild
    assert index_states(world) == [(None, None), (None, None), ("indexed", "Bright Data"), ("not_found", "Bright Data")]
    assert [r["src_index_misses"] for r in rows(world, "SELECT src_index_misses FROM backlinks ORDER BY id")] == [0, 0, 2, 2]
