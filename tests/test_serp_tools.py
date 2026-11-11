"""Search tools on hand-written answers, root domains, and accented hosts. Nothing here contacts a real search tool."""
import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from seo.backlinks.cleaner import root_domain
from seo.competitors.keywords import parse_keywords
from seo.competitors.pages import contains_phrase
from seo.competitors.suggest import looks_like_platform
from seo.serp import store
from seo.serp.rankings import Seen, engine_view
from seo.serp.tools import (
    ABSENT, NOT_CAPTURED, PRESENT, BrightData, BrowserBackup, DuckDuckGoDirect, HasData, SearchFailed, Searlo, SearXNG, SerpApi, TimedOut, ToolStopped,
    ddg_region, looks_like_captcha, most_cost, pages_for, parse_ddg, same_place,
)

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")

DDG_PAGE = b"""<html><body>
<div class="result results_links results_links_deep result--ad"><div class="links_main links_deep result__body"><h2 class="result__title">
  <a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=ads.example&uddg=https%3A%2F%2Fads.example%2Fbuy">An advert</a></h2></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.example%2Fa%3Fx%3D1&rut=abc">First result</a></h2></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title">
  <a class="result__a" href="https://two.example/direct">Second result</a></h2></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title">
  <a class="result__a" href="https://duckduckgo.com/about">Its own page</a></h2></div></div>
</body></html>"""


def ddg(status=200, body=DDG_PAGE, seen=None):
    def answer(request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, content=body)

    return DuckDuckGoDirect(client=httpx.Client(transport=httpx.MockTransport(answer)), sleep=lambda seconds: None)


def serpapi(*answers, seen=None):
    queue = list(answers)

    def answer(request):
        if seen is not None:
            seen.append(request)
        status, body = queue.pop(0)
        return httpx.Response(status, content=body if isinstance(body, bytes) else json.dumps(body).encode())

    return SerpApi("SECRETKEY", client=httpx.Client(transport=httpx.MockTransport(answer)))


def search(tool, keyword="coffee", country="FR", language="fr", depth=10):
    return tool.search(keyword, "google", country, language, "desktop", depth)


ORGANIC = {"organic_results": [{"position": 1, "link": "https://one.example/", "title": "One"}, {"position": 2, "link": "https://two.example/", "title": "Two"}, {"position": 3, "title": "no link"}]}


# ---- DuckDuckGo ----------------------------------------------------------------------------

def test_parse_ddg_reads_redirects_and_skips_adverts_and_its_own_links():
    found = parse_ddg(DDG_PAGE)
    assert [(f.position, f.url, f.title) for f in found] == [(1, "https://one.example/a?x=1", "First result"), (2, "https://two.example/direct", "Second result")]


@pytest.mark.parametrize("body", [b"", b"   ", b"<html></html>"])
def test_parse_ddg_on_an_empty_page_finds_nothing(body):
    assert parse_ddg(body) == []


def test_202_bot_check_stops_the_tool():
    with pytest.raises(ToolStopped) as stopped:
        search(ddg(202, b"<html>anomaly-modal</html>"))
    assert stopped.value.bot_check  # so the app rests the tool instead of hitting the check again on the next Refresh


def test_a_challenge_page_answered_as_200_stops_the_tool():
    with pytest.raises(ToolStopped) as stopped:
        search(ddg(200, b'<html><form id="challenge-form" action="//duckduckgo.com/anomaly.js"></form></html>'))
    assert stopped.value.bot_check


def test_slow_down_stops_the_tool_without_calling_it_a_bot_check():
    with pytest.raises(ToolStopped) as stopped:
        search(ddg(429, b"no"))
    assert not stopped.value.bot_check


def test_the_word_anomaly_on_a_page_of_results_is_not_a_bot_check():
    page = DDG_PAGE.replace(b"First result", b"Anomaly detection")
    assert len(search(ddg(200, page), "anomaly detection").results) == 2


@pytest.mark.parametrize("status", [403, 429])
def test_refusals_stop_the_tool(status):
    with pytest.raises(ToolStopped):
        search(ddg(status, b"no"))


def test_a_server_error_fails_only_this_search():
    with pytest.raises(SearchFailed):
        search(ddg(500, b"oops"))


def test_a_page_it_cannot_read_is_a_failure_not_nobody_ranks():
    with pytest.raises(SearchFailed):
        search(ddg(200, b"<html><body>something new</body></html>"))
    assert search(ddg(200, b'<html><div class="no-results">No results.</div></html>')).results == []


def test_duckduckgo_says_where_it_searched_and_gives_no_ai_answer():
    seen = []
    answer = search(ddg(seen=seen), country="SA", language="ar")
    assert answer.real_location == "xa-ar" and answer.charged == 0
    assert answer.ai_state == NOT_CAPTURED and answer.ai_citations == []
    assert seen[0].url.params["kl"] == "xa-ar"
    assert ddg_region("ZZ") == "wt-wt"


def test_duckduckgo_keeps_its_gap_between_searches():
    waits = []
    tool = DuckDuckGoDirect(client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=DDG_PAGE))), sleep=waits.append)
    search(tool), search(tool)
    assert len(waits) == 1 and 0 < waits[0] <= tool.gap_seconds


# ---- SerpApi ---------------------------------------------------------------------------------

def test_serpapi_reads_results_and_asks_for_the_market():
    seen = []
    answer = search(serpapi((200, ORGANIC), seen=seen))
    assert [(f.position, f.url) for f in answer.results] == [(1, "https://one.example/"), (2, "https://two.example/")]
    assert answer.real_location == "FR" and answer.charged == 1 and answer.ai_state == ABSENT
    params = seen[0].url.params
    assert (params["engine"], params["q"], params["gl"], params["hl"], params["api_key"]) == ("google", "coffee", "fr", "fr", "SECRETKEY")


def test_serpapi_reads_an_ai_overview_in_the_first_answer():
    body = {**ORGANIC, "ai_overview": {"text_blocks": [{}], "references": [{"link": "https://one.example/cited"}, {"title": "no link"}]}}
    answer = search(serpapi((200, body)))
    assert answer.ai_state == PRESENT and answer.ai_citations == ["https://one.example/cited"] and answer.charged == 1


def test_serpapi_follows_the_page_token_and_counts_two_credits():
    seen = []
    first = {**ORGANIC, "ai_overview": {"page_token": "TOKEN"}}
    second = {"ai_overview": {"references": [{"link": "https://two.example/cited"}]}}
    answer = search(serpapi((200, first), (200, second), seen=seen))
    assert seen[1].url.params["engine"] == "google_ai_overview" and seen[1].url.params["page_token"] == "TOKEN"
    assert answer.ai_state == PRESENT and answer.ai_citations == ["https://two.example/cited"] and answer.charged == 2


@pytest.mark.parametrize("follow_up", [(500, {"error": "expired"}), (429, {"error": "Your account has run out of searches."}), (200, {})])
def test_a_failed_follow_up_keeps_the_results_and_says_not_captured(follow_up):
    answer = search(serpapi((200, {**ORGANIC, "ai_overview": {"page_token": "T"}}), follow_up))
    assert len(answer.results) == 2 and answer.ai_state == NOT_CAPTURED and answer.ai_citations == []


@pytest.mark.parametrize("status, body", [
    (429, {"error": "Your account has run out of searches."}),
    (200, {"error": "Your account has run out of searches."}),
    (429, b"not json"),
    (401, {"error": "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key"}),
    (200, {"error": "Invalid API key."}),
    (403, b"<html>nope</html>"),
])
def test_out_of_credits_and_bad_keys_stop_the_tool(status, body):
    with pytest.raises(ToolStopped) as stopped:
        search(serpapi((status, body)))
    assert "SECRETKEY" not in str(stopped.value)


@pytest.mark.parametrize("status, body", [(500, b"oops"), (200, b"[1, 2]"), (200, {"error": "Something else"}), (503, {})])
def test_other_problems_fail_only_this_search(status, body):
    with pytest.raises(SearchFailed):
        search(serpapi((status, body)))


def test_serpapi_with_no_results_is_an_answer():
    answer = search(serpapi((200, {"error": "Google hasn't returned any results for this query."})))
    assert answer.results == [] and answer.ai_state == ABSENT


def test_serpapi_network_failure_fails_only_this_search():
    def broken(request):
        raise httpx.ConnectError("no route")

    with pytest.raises(SearchFailed) as failed:
        search(SerpApi("SECRETKEY", client=httpx.Client(transport=httpx.MockTransport(broken))))
    assert "SECRETKEY" not in str(failed.value)


def test_serpapi_account_test():
    assert serpapi((200, {"total_searches_left": 12})).test() == 12
    with pytest.raises(ToolStopped):
        serpapi((401, b"no")).test()


# ---- root domains: the generic rule, in both copies ---------------------------------------------

DOMAINS = [
    ("rival.example", "rival.example"), ("www.rival.example", "rival.example"), ("deep.sub.rival.example", "rival.example"), ("co.example", "co.example"),
    ("shop.com.ng", "shop.com.ng"), ("a.b.shop.com.ng", "shop.com.ng"), ("com.ng", ""), ("shop.co.ke", "shop.co.ke"), ("blog.shop.co.ke", "shop.co.ke"), ("co.ke", ""),
    ("x.com.sa", "x.com.sa"), ("www.y.x.com.sa", "x.com.sa"), ("com.sa", ""), ("school.edu.pk", "school.edu.pk"), ("a.gov.ng", "a.gov.ng"), ("x.ac.ke", "x.ac.ke"),
    ("example.de", "example.de"), ("sub.example.de", "example.de"), ("xn--mnchen-kaffee-wob.example", "xn--mnchen-kaffee-wob.example"), ("blog.xn--mnchen-kaffee-wob.example", "xn--mnchen-kaffee-wob.example"),
]


@pytest.mark.parametrize("value, expected", DOMAINS)
def test_root_domain_generic_rule(value, expected):
    assert root_domain(value) == expected


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_browser_copy_gives_the_same_root_domains(tmp_path):
    path = tmp_path / "values.json"
    path.write_text(json.dumps([v for v, _ in DOMAINS]), encoding="utf-8")
    out = subprocess.run([NODE, str(ROOT / "tests" / "js" / "clean_csv.cjs"), "domains", str(path)], capture_output=True, text=True, check=True, timeout=30)
    assert json.loads(out.stdout) == [e for _, e in DOMAINS]


@pytest.mark.parametrize("domain, kind", [
    ("wikipedia.org", "platform"), ("amazon.co.uk", "platform"), ("economie.gouv.fr", "public"), ("service.gov.uk", "public"), ("nasa.gov", "public"), ("mit.edu", "public"),
    ("x.ac.uk", "public"), ("go.com", None), ("gov.example", None), ("rival.example", None),
])
def test_platform_and_public_labels(domain, kind):
    assert looks_like_platform(domain) == kind


# ---- accented hosts -------------------------------------------------------------------------------

ACCENTED, ASCII = "münchen-kaffee.example", "xn--mnchen-kaffee-wob.example"


def test_accented_host_has_one_stored_spelling():
    assert store.to_ascii_host(ACCENTED) == ASCII and store.to_ascii_host(ASCII) == ASCII
    assert store.to_display_host(ASCII) == ACCENTED and store.to_display_host("plain.example") == "plain.example"
    assert store.host_and_domain(f"https://www.{ACCENTED}/x") == (ASCII, ASCII)


@pytest.mark.parametrize("host, site, expected", [
    (ASCII, ACCENTED, True), (ACCENTED, ASCII, True), (f"blog.{ASCII}", ACCENTED, True), (f"blog.{ACCENTED}", ASCII, True), ("other.example", ACCENTED, False),
    ("notrival.example", "rival.example", False), ("x.example", "", False),
])
def test_on_host_works_both_ways(host, site, expected):
    assert store.on_host(host, site) is expected


def test_canonical_url_is_one_spelling_for_one_page():
    assert store.canonical_url(f"https://{ACCENTED}/café?utm_source=x#top") == store.canonical_url(f"https://{ASCII}/caf%c3%a9") == f"https://{ASCII}/caf%C3%A9"
    assert store.canonical_url("not a url") == ""


# ---- keyword lists -------------------------------------------------------------------------------

@pytest.mark.parametrize("data, expected", [
    ("best coffee, beans\nmoulin à café", ["best coffee, beans", "moulin à café"]),
    ("coffee\nbest, beans\n", ["coffee", "best, beans"]),
    ("a,b", ["a,b"]),
    ("Keyword\nfoo\nbar", ["foo", "bar"]),
    ("Keyword\tVolume\nfoo\t10\nbar\t20", ["foo", "bar"]),
    ("foo\t10\nbar\t20", ["foo", "bar"]),
    ("﻿CAFÉ\ncafé\n  café  \n", ["CAFÉ"]),
    ("", []),
    ("   \n  ", []),
    ("كيف أعمل، القهوة\nقهوة مختصة", ["كيف أعمل، القهوة", "قهوة مختصة"]),
    ("コーヒー　定期便\nｺｰﾋｰ", ["コーヒー 定期便", "コーヒー"]),
    ("x" * 301 + "\nkeep", ["keep"]),
    (b"Keyword,Volume\n\"a, b\",10\nc,20\n", ["a, b", "c"]),
    (b"\xef\xbb\xbfVolume,Keyword\n10,a\n20,b\n", ["a", "b"]),
    ("Mot-clé;Volume\ncafé;100\nthé;50\n".encode("cp1252"), ["café", "thé"]),
    ("Keyword\tVolume\nقهوة مختصة\t10\nコーヒー\t20\n".encode("utf-16"), ["قهوة مختصة", "コーヒー"]),
    ("كلمة مفتاحية;الحجم\nقهوة;10\n".encode("utf-8"), ["قهوة"]),
    ("キーワード,数\nコーヒー,1\n".encode("utf-8"), ["コーヒー"]),
    (b"cafe;100\nthe;50\n", ["cafe", "the"]),
    (b'"best, beans"\nfoo\n', ["best, beans", "foo"]),
    (b"one keyword, with a comma\nanother\n", ["one keyword, with a comma", "another"]),
])
def test_parse_keywords(data, expected):
    assert parse_keywords(data) == expected


# ---- is a keyword used on a page? ---------------------------------------------------------------------

@pytest.mark.parametrize("text, phrase, expected", [
    ("Le café en grains est bon", "CAFE EN GRAINS", True),
    ("Le cafe en grains", "café en grains", True),
    ("Ma sœur", "soeur", True),
    ("A card game", "car", False),
    ("A car game", "car", True),
    ("قَهْوَة مختصة طازجة", "قهوة مختصة", True),
    ("قهوة مختصة", "شاي", False),
    ("当店のコーヒー定期便はお得です", "コーヒー 定期便", True),
    ("当店のコーヒーはお得です", "定期便", False),
    ("ガードを買う", "カード", False),
    ("anything", "???", False),
    ("", "word", False),
])
def test_keyword_use(text, phrase, expected):
    assert contains_phrase(text, phrase) is expected


# ---- the tools added for Refresh. Hand-written answers shaped like each vendor's documentation -------------

def _mock(status=200, body=None, seen=None, raises=None):
    def answer(request):
        if seen is not None:
            seen.append(request)
        if raises:
            raise raises
        return httpx.Response(status, content=json.dumps(body if body is not None else {}).encode())

    return httpx.Client(transport=httpx.MockTransport(answer))


ROWS = [{"link": f"https://site{i}.example/", "title": f"T{i}"} for i in range(10)]


def test_bright_data_sends_the_zone_and_a_json_search_page_and_reads_the_results():
    seen = []
    tool = BrightData("KEY", "serp_api1", client=_mock(body={"organic": ROWS[:3]}, seen=seen))
    found = tool.search("café seville", "google", "FR", "fr", "desktop", 10)
    sent = json.loads(seen[0].content)
    assert seen[0].headers["authorization"] == "Bearer KEY" and str(seen[0].url) == "https://api.brightdata.com/request"
    assert sent["zone"] == "serp_api1" and sent["format"] == "raw"
    query = parse_qs(urlsplit(sent["url"]).query)
    assert query["q"] == ["café seville"] and query["gl"] == ["fr"] and query["hl"] == ["fr"] and query["brd_json"] == ["1"]
    assert [row.position for row in found.results] == [1, 2, 3] and found.real_location == "FR" and found.ai_state == NOT_CAPTURED and found.charged == 1


def test_bright_data_builds_each_engines_own_address():
    assert "bing.com/search" in BrightData.page_address("x", "bing", "FR", "fr", "desktop", 1) and "first=11" in BrightData.page_address("x", "bing", "FR", "fr", "desktop", 1)
    assert "kl=fr-fr" in BrightData.page_address("x", "duckduckgo", "FR", "fr", "desktop", 0)
    assert "yandex.com/search/" in BrightData.page_address("x", "yandex", "", "", "desktop", 0) and "text=x" in BrightData.page_address("x", "yandex", "", "", "desktop", 0)
    assert "brd_mobile=1" in BrightData.page_address("x", "google", "", "", "mobile", 0)


def test_a_deeper_check_reads_further_pages_each_one_charged():
    pages = [ROWS, [{"link": f"https://more{i}.example/", "title": "M"} for i in range(10)]]
    seen = []

    def answer(request):
        seen.append(request)
        return httpx.Response(200, content=json.dumps({"organic": pages[len(seen) - 1]}).encode())

    tool = BrightData("KEY", "z", client=httpx.Client(transport=httpx.MockTransport(answer)))
    found = tool.search("x", "google", "", "", "desktop", 20)
    assert len(seen) == 2 and found.charged == 2 and [row.position for row in found.results] == list(range(1, 21))
    assert "start=10" in json.loads(seen[1].content)["url"]


@pytest.mark.parametrize("status", [401, 403, 402, 429])
def test_vendors_saying_no_stop_the_tool(status):
    for tool in (BrightData("K", "z", client=_mock(status)), HasData("K", client=_mock(status)), Searlo("K", client=_mock(status))):
        with pytest.raises(ToolStopped):
            tool.search("x", "google", "", "", "desktop", 10)


@pytest.mark.parametrize("make", [
    lambda c: BrightData("K", "z", client=c), lambda c: HasData("K", client=c), lambda c: Searlo("K", client=c),
    lambda c: SerpApi("K", client=c), lambda c: SearXNG("https://s.example", client=c), lambda c: DuckDuckGoDirect(client=c, sleep=lambda s: None),
])
def test_every_tool_reports_a_timeout_as_a_timeout(make):
    tool = make(_mock(raises=httpx.ReadTimeout("slow")))
    engine = "bing" if tool.name == "SearXNG" else "duckduckgo" if tool.name == "DuckDuckGo direct" else "google"
    with pytest.raises(TimedOut):
        tool.search("x", engine, "FR", "fr", "desktop", 10)


@pytest.mark.parametrize("make", [lambda c: BrightData("K", "z", client=c), lambda c: HasData("K", client=c), lambda c: Searlo("K", client=c), lambda c: SearXNG("https://s.example", client=c)])
def test_a_server_error_or_garbage_is_one_failed_search(make):
    tool = make(_mock(500))
    engine = "bing" if tool.name == "SearXNG" else "google"
    with pytest.raises(SearchFailed):
        tool.search("x", engine, "", "", "desktop", 10)

    def garbage(request):
        return httpx.Response(200, content=b"<html>not json</html>")

    tool = make(httpx.Client(transport=httpx.MockTransport(garbage)))
    with pytest.raises(SearchFailed):
        tool.search("x", engine, "", "", "desktop", 10)


def test_hasdata_uses_its_own_field_names_and_each_engines_parameters():
    seen = []
    tool = HasData("KEY", client=_mock(body={"organicResults": [{"position": 1, "title": "A", "link": "https://a.example/"}]}, seen=seen))
    found = tool.search("x", "google", "FR", "fr", "desktop", 10)
    assert seen[0].url.path == "/scrape/google/serp" and seen[0].headers["x-api-key"] == "KEY"
    assert seen[0].url.params["gl"] == "fr" and seen[0].url.params["deviceType"] == "desktop" and found.charged == 10
    tool.search("x", "bing", "FR", "fr", "desktop", 10)
    assert seen[1].url.path == "/scrape/bing/serp" and seen[1].url.params["cc"] == "fr" and seen[1].url.params["setLang"] == "fr"


def test_searlo_is_one_credit_a_page_and_says_not_captured():
    seen = []
    tool = Searlo("KEY", client=_mock(body={"organic": ROWS[:2]}, seen=seen))
    found = tool.search("x", "google", "FR", "fr", "desktop", 10)
    assert seen[0].url.path == "/api/v1/search/web" and seen[0].headers["x-api-key"] == "KEY" and seen[0].url.params["limit"] == "10"
    assert found.charged == 1 and found.ai_state == NOT_CAPTURED


def test_searxng_only_asks_for_the_engine_named_and_stops_when_it_is_suspended():
    seen = []
    tool = SearXNG("https://s.example/", client=_mock(body={"results": [{"url": "https://a.example/", "title": "A"}, {"url": "https://a.example/", "title": "again"}]}, seen=seen))
    found = tool.search("x", "bing", "FR", "fr", "desktop", 10)
    assert str(seen[0].url).startswith("https://s.example/search?") and seen[0].url.params["engines"] == "bing" and seen[0].url.params["language"] == "fr-FR"
    assert len(found.results) == 1 and found.charged == 0
    with pytest.raises(SearchFailed):
        tool.search("x", "google", "", "", "desktop", 10)  # an unknown engine would fall back to its defaults, Google included
    stuck = SearXNG("https://s.example", client=_mock(body={"results": [], "unresponsive_engines": [["bing", "CAPTCHA"]]}))
    with pytest.raises(ToolStopped):
        stuck.search("x", "bing", "", "", "desktop", 10)


def test_serpapi_covers_the_other_engines_and_never_claims_an_overview_there():
    seen = []
    tool = SerpApi("KEY", client=_mock(body={"organic_results": ROWS[:2]}, seen=seen))
    found = tool.search("x", "bing", "FR", "", "desktop", 10)
    assert seen[0].url.params["engine"] == "bing" and seen[0].url.params["cc"] == "fr" and found.ai_state == NOT_CAPTURED and found.real_location == "FR"
    tool.search("x", "yandex", "", "", "desktop", 10)
    assert seen[1].url.params["engine"] == "yandex" and seen[1].url.params["text"] == "x"
    answered = tool.search("x", "duckduckgo", "FR", "fr", "desktop", 20)
    assert seen[2].url.params["kl"] == "fr-fr" and answered.real_location == "fr-fr" and answered.charged == 1


def test_serpapi_reads_deeper_on_google_page_by_page():
    pages = [{"organic_results": ROWS}, {"organic_results": [{"link": f"https://more{i}.example/", "title": "M"} for i in range(10)]}]
    seen = []

    def answer(request):
        seen.append(request)
        return httpx.Response(200, content=json.dumps(pages[len(seen) - 1]).encode())

    found = SerpApi("KEY", client=httpx.Client(transport=httpx.MockTransport(answer))).search("x", "google", "FR", "fr", "desktop", 20)
    assert found.charged == 2 and seen[1].url.params["start"] == "10" and found.results[-1].position == 20 and found.ai_state == ABSENT


# ---- the browser backup, on hand-written pages. Not a test of the real engines' markup --------------------

GOOGLE_PAGE = b"""<html><body><div id="tads"><a href="https://ad.example/"><h3>Ad</h3></a></div><div id="search">
<div><a href="https://one.example/"><h3>One</h3></a></div><div><a href="https://two.example/"><h3>Two</h3></a></div><a href="https://nav.example/">no heading</a></div></body></html>"""
BING_PAGE = b"""<html><body><ol id="b_results"><li class="b_ad"><h2><a href="https://ad.example/">Ad</a></h2></li><li class="b_algo"><h2><a href="https://one.example/">One</a></h2></li></ol></body></html>"""
YANDEX_PAGE = b"""<html><body><ul><li class="serp-item"><a class="Link OrganicTitle-Link" href="https://one.example/">One</a></li></ul></body></html>"""


def browser(pages, country="AE"):
    answers = list(pages)
    slept = []
    tool = BrowserBackup(country, open_page=lambda address: answers.pop(0), sleep=slept.append)
    tool.slept = slept
    return tool


def test_the_browser_reads_each_engine_and_says_it_searched_from_the_macs_country():
    found = browser([("https://www.google.com/search", GOOGLE_PAGE)]).search("x", "google", "FR", "fr", "desktop", 10)
    assert [row.url for row in found.results] == ["https://one.example/", "https://two.example/"] and found.real_location == "AE" and found.charged == 0
    assert [row.url for row in browser([("https://bing", BING_PAGE)]).search("x", "bing", "FR", "fr", "desktop", 10).results] == ["https://one.example/"]
    assert [row.url for row in browser([("https://yandex", YANDEX_PAGE)]).search("x", "yandex", "", "", "desktop", 10).results] == ["https://one.example/"]


def test_a_captcha_that_clears_by_itself_carries_on_with_nothing_clicked():
    tool = browser([("https://www.google.com/sorry/index", b"<html>unusual</html>"), ("https://www.google.com/search", GOOGLE_PAGE)])
    found = tool.search("x", "google", "", "", "desktop", 10)
    assert len(found.results) == 2 and tool.slept == [tool.clear_wait]


def test_a_captcha_that_stays_stops_the_tool_at_once():
    tool = browser([("https://yandex.com/showcaptcha?x", b"<html></html>"), ("https://yandex.com/showcaptcha?x", b"<html></html>")])
    with pytest.raises(ToolStopped, match="captcha"):
        tool.search("x", "yandex", "", "", "desktop", 10)


def test_a_keyword_about_captchas_is_not_a_captcha():
    assert not looks_like_captcha("https://www.bing.com/search?q=captcha", b"<html><li class='b_algo'>how a captcha works, unusual traffic</li></html>")


def test_without_playwright_the_browser_says_how_to_get_it(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def no_playwright(name, *args, **kwargs):
        if name.startswith("playwright"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_playwright)
    with pytest.raises(ToolStopped, match="pip install playwright"):
        BrowserBackup("AE", sleep=lambda s: None).search("x", "google", "", "", "desktop", 10)


def test_pages_and_costs():
    assert [pages_for(d) for d in (10, 20, 30, 50)] == [1, 2, 3, 5]
    assert most_cost(HasData, 20) == 20 and most_cost(Searlo, 30) == 3 and most_cost(SerpApi, 10) == 2 and most_cost(SerpApi, 20) == 3 and most_cost(DuckDuckGoDirect, 10) == 0 and most_cost(BrowserBackup, 50) == 0


def test_same_place_knows_each_way_a_tool_reports_where_it_searched():
    assert same_place("FR", "FR") and same_place("FR", "fr-fr") and not same_place("FR", "AE") and not same_place("FR", "wt-wt") and same_place("", "AE")
    assert same_place("AE", "xa-ar", "ar") and not same_place("FR", "")


# ---- SerpApi deeper checks ------------------------------------------------------------------------
def _organic(count, start=0):
    return {"organic_results": [{"position": start + i + 1, "link": f"https://r{start + i}.example/", "title": "R"} for i in range(count)]}


def test_serpapi_keeps_reading_after_a_first_page_of_nine():
    found = search(serpapi((200, _organic(9)), (200, _organic(11, 9))), depth=20)
    assert found.charged == 2 and [row.position for row in found.results] == list(range(1, 21))


def test_serpapi_spends_nothing_more_when_the_first_page_is_empty():
    assert search(serpapi((200, _organic(0))), depth=20).charged == 1


def test_serpapi_stops_at_the_first_empty_page():
    found = search(serpapi((200, _organic(10)), (200, _organic(0))), depth=30)
    assert found.charged == 2 and len(found.results) == 10


# ---- Yandex has no country to report ---------------------------------------------------------------
def _seen(engine, location):
    return Seen(1, 1, engine, "brightdata", location, 10, "ok", "not_captured", datetime(2026, 11, 5), rows=[(4, "https://mine.example/", "mine.example")])


def test_a_yandex_check_with_no_location_fills_the_keyword_row():
    view = engine_view([_seen("yandex", "")], "mine.example", "FR", "fr", ["brightdata"], 5, datetime(2026, 11, 5))
    assert view["main"] is not None and view["away"] == []


def test_a_yandex_check_from_another_country_is_still_away():
    view = engine_view([_seen("yandex", "AE")], "mine.example", "FR", "fr", ["brightdata"], 5, datetime(2026, 11, 5))
    assert view["main"] is None and len(view["away"]) == 1


def test_a_google_check_with_no_location_is_still_away():
    view = engine_view([_seen("google", "")], "mine.example", "FR", "fr", ["brightdata"], 5, datetime(2026, 11, 5))
    assert view["main"] is None and len(view["away"]) == 1


def test_a_failure_on_a_later_page_says_what_the_pages_before_it_used():
    """F57: HasData at depth 30, pages 1 and 2 answer, page 3 answers 500. The 20 credits used stay counted."""
    from seo.serp.tools import HasData

    def answer(request):
        start = int(request.url.params.get("start", "0"))
        if start >= 20:
            return httpx.Response(500, json={})
        return httpx.Response(200, json={"organicResults": [{"link": f"https://r{start + i}.example/", "title": "T"} for i in range(10)]})

    tool = HasData("KEY", client=httpx.Client(transport=httpx.MockTransport(answer)))
    with pytest.raises(SearchFailed) as caught:
        tool.search("k", "google", "FR", "fr", "desktop", 30)
    assert caught.value.charged == 20


def test_a_failure_on_the_first_page_used_nothing():
    from seo.serp.tools import BrightData

    tool = BrightData("KEY", "zone", client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    with pytest.raises(SearchFailed) as caught:
        tool.search("k", "google", "FR", "fr", "desktop", 30)
    assert caught.value.charged == 0
