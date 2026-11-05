"""The link crawl, against a fixture site held in memory. No real website is ever contacted."""
import json

import httpx
import pytest

from seo.crawl.fetch import PoliteFetcher
from seo.links.checker import ROBOTS_TRIES, CrawlState, extract_links, run_scan
from seo.links.urls import host_key, normalize_url, page_key


class Fixture:
    """Websites in memory. Every request is recorded, so a test can prove what was never asked for."""

    def __init__(self, pages):
        self.pages = pages
        self.requests = []

    def __call__(self, request):
        url = str(request.url)
        self.requests.append(url)
        if request.url.path == "/robots.txt":
            found = self.pages.get(f"{request.url.host}/robots.txt")
            return httpx.Response(200, text=found) if found else httpx.Response(404)
        page = self.pages.get(f"{request.url.host}{request.url.raw_path.decode()}")
        if page is None:
            return httpx.Response(404, text="not found")
        if callable(page):
            return page(request)
        if isinstance(page, int):
            return httpx.Response(page, text="no")
        if isinstance(page, tuple):
            return httpx.Response(page[0], headers={"location": page[1]})
        return httpx.Response(200, html=page)

    def asked_for(self, text):
        return [u for u in self.requests if text in u]


def links(*hrefs):
    return "<html><body>" + "".join(f'<a href="{h}">x</a>' for h in hrefs) + "</body></html>"


def scan(pages, start="https://shop.co.ae/", host="shop.co.ae", **options):
    fixture = Fixture(pages)
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    options.setdefault("max_pages", 50)
    options.setdefault("check_external", True)
    result = run_scan(start, host, fetcher, **options)
    fetcher.close()
    return result, fixture


def issue(result, target_part, category=None):
    found = [i for i in result.issues if target_part in i.target_url and (category is None or i.category == category)]
    assert len(found) == 1, [(i.category, i.target_url) for i in result.issues]
    return found[0]


def categories(result):
    return sorted((i.category, i.target_url) for i in result.issues)


# ---- the main rule: only my own host is ever crawled -------------------------------

def test_bug1_another_site_on_the_same_co_ae_ending_is_not_crawled():
    pages = {
        "shop.co.ae/": links("/about", "https://other.co.ae/x"),
        "shop.co.ae/about": links(),
        "other.co.ae/x": links("https://other.co.ae/secret"),
    }
    result, fixture = scan(pages)
    assert result.pages_read == 2
    assert fixture.asked_for("other.co.ae/x")  # one status check
    assert not fixture.asked_for("other.co.ae/secret")  # never read for more links


def test_co_uk_is_the_same():
    pages = {"shop.co.uk/": links("https://rival.co.uk/a"), "rival.co.uk/a": links("https://rival.co.uk/b")}
    result, fixture = scan(pages, start="https://shop.co.uk/", host="shop.co.uk")
    assert not fixture.asked_for("rival.co.uk/b")


def test_www_and_no_www_are_the_same_site_and_the_same_page():
    pages = {
        "shop.example/": links("https://www.shop.example/a", "https://shop.example/a"),
        "www.shop.example/a": links("/b"),
        "shop.example/a": links("/b"),
        "www.shop.example/b": links(),
    }
    result, fixture = scan(pages, start="https://shop.example/", host="shop.example")
    assert result.pages_read == 3  # home, a, b: a was not read twice
    assert len([u for u in fixture.requests if u.endswith("/a")]) == 1


def test_another_subdomain_is_not_crawled_unless_added_as_its_own_site():
    pages = {
        "shop.example/": links("https://blog.shop.example/post"),
        "blog.shop.example/post": links("https://blog.shop.example/deep"),
    }
    result, fixture = scan(pages, start="https://shop.example/", host="shop.example")
    assert fixture.asked_for("blog.shop.example/post")
    assert not fixture.asked_for("blog.shop.example/deep")
    assert result.pages_read == 1

    # Added as its own site, it is crawled, and the main site is not.
    pages = {"blog.shop.example/": links("/deep", "https://shop.example/"), "blog.shop.example/deep": links(), "shop.example/": links("/never")}
    result, fixture = scan(pages, start="https://blog.shop.example/", host="blog.shop.example")
    assert result.pages_read == 2
    assert not fixture.asked_for("shop.example/never")


def test_no_offsite_page_is_ever_read_for_links():
    pages = {
        "shop.co.ae/": links("https://far.example/1"),
        "far.example/1": links("https://far.example/2", "https://shop.co.ae/hidden"),
        "far.example/2": links(),
        "shop.co.ae/hidden": links(),
    }
    result, fixture = scan(pages)
    assert fixture.asked_for("far.example/1")
    assert not fixture.asked_for("far.example/2")
    assert not fixture.asked_for("shop.co.ae/hidden")  # only a link on an off-site page pointed there


def test_turning_external_checks_off_sends_nothing_off_site():
    pages = {"shop.co.ae/": links("https://far.example/1", "/a"), "shop.co.ae/a": links()}
    result, fixture = scan(pages, check_external=False)
    assert not fixture.asked_for("far.example")
    assert result.external_not_checked == 1
    assert result.pages_read == 2


def test_start_url_must_be_on_the_site():
    with pytest.raises(ValueError):
        scan({}, start="https://other.co.ae/", host="shop.co.ae")


# ---- bug 2: redirects ----------------------------------------------------------------

def test_bug2_page_redirecting_off_site_is_reported_and_not_read():
    pages = {
        "shop.co.ae/": links("/moved"),
        "shop.co.ae/moved": (301, "https://far.example/landing"),
        "far.example/landing": links("https://far.example/deeper"),
    }
    result, fixture = scan(pages)
    assert not fixture.asked_for("far.example")  # not even the landing page
    found = issue(result, "/moved")
    assert found.category == "redirect"
    assert "far.example/landing" in found.reason
    assert found.final_url == "https://far.example/landing"
    assert found.pages == ["https://shop.co.ae/"]


def test_bug2_start_page_redirecting_off_site_stops_there():
    result, fixture = scan({"shop.co.ae/": (302, "https://far.example/")})
    assert not fixture.asked_for("far.example")
    assert result.pages_read == 1
    assert issue(result, "shop.co.ae").category == "redirect"


def test_bug2_links_resolve_against_the_page_we_landed_on():
    pages = {
        "shop.co.ae/": links("/old"),
        "shop.co.ae/old": (301, "/new/dir/"),
        "shop.co.ae/new/dir/": links("child"),
        "shop.co.ae/new/dir/child": links(),
    }
    result, fixture = scan(pages)
    assert fixture.asked_for("/new/dir/child")
    assert not [u for u in fixture.requests if u.endswith("shop.co.ae/child")]
    assert result.issues == []


def test_page_reached_by_redirect_is_not_fetched_a_second_time():
    pages = {
        "shop.co.ae/": links("/old", "/z", "/new"),
        "shop.co.ae/old": (301, "/new"),
        "shop.co.ae/new": links(),
        "shop.co.ae/z": links(),
    }
    result, fixture = scan(pages)
    assert len([u for u in fixture.requests if u.endswith("/new")]) == 1


# ---- redirect chains and slow answers --------------------------------------------------

def test_two_hops_is_fine_three_is_a_chain_with_its_count():
    pages = {
        "shop.co.ae/": links("/two", "/three"),
        "shop.co.ae/two": (301, "/two-b"), "shop.co.ae/two-b": (301, "/end"),
        "shop.co.ae/three": (301, "/three-b"), "shop.co.ae/three-b": (301, "/three-c"), "shop.co.ae/three-c": (301, "/end"),
        "shop.co.ae/end": links(),
    }
    result, _ = scan(pages)
    assert categories(result) == [("redirect", "https://shop.co.ae/three")]
    found = issue(result, "/three")
    assert found.hops == 3
    assert "3" in found.reason
    assert found.final_url == "https://shop.co.ae/end"


def test_external_chain_is_counted_too():
    pages = {
        "shop.co.ae/": links("https://far.example/a"),
        "far.example/a": (301, "/b"), "far.example/b": (301, "/c"), "far.example/c": (301, "/d"), "far.example/d": links(),
    }
    result, _ = scan(pages)
    assert issue(result, "far.example/a").hops == 3


def test_more_than_five_redirects_is_reported():
    pages = {"shop.co.ae/": links("/r0"), **{f"shop.co.ae/r{i}": (301, f"/r{i + 1}") for i in range(9)}}
    result, _ = scan(pages)
    assert "redirect" in issue(result, "/r0").category


def test_slow_answer_is_reported_with_its_time():
    import time as time_module

    def slow(request):
        time_module.sleep(0.25)
        return httpx.Response(200, html=links())

    result, _ = scan({"shop.co.ae/": links("/slow"), "shop.co.ae/slow": slow}, slow_seconds=0.2)
    found = issue(result, "/slow", "slow")
    assert found.seconds >= 0.2
    assert "s" in found.reason


def test_polite_waiting_does_not_count_as_slow():
    fixture = Fixture({"shop.co.ae/": links("/a"), "shop.co.ae/a": links()})
    fetcher = PoliteFetcher(delay=0.3, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, max_pages=5, check_external=False, slow_seconds=0.2)
    assert result.issues == []


# ---- bug 3: broken means broken -----------------------------------------------------------

@pytest.mark.parametrize("code", [404, 410])
def test_bug3_404_and_410_are_broken(code):
    result, _ = scan({"shop.co.ae/": links("https://far.example/x"), "far.example/x": code})
    found = issue(result, "far.example/x")
    assert found.category == "broken"
    assert found.status_code == code


@pytest.mark.parametrize("code", [401, 403, 429, 999, 500, 503, 400])
def test_bug3_other_answers_could_not_be_verified(code):
    result, _ = scan({"shop.co.ae/": links("https://far.example/x"), "far.example/x": code})
    found = issue(result, "far.example/x")
    assert found.category == "unverified"
    assert found.status_code == code
    assert found.reason


def test_bug3_a_failed_request_could_not_be_verified_and_says_why():
    def down(request):
        raise httpx.ConnectError("name not known")

    result, _ = scan({"shop.co.ae/": links("https://far.example/x"), "far.example/x": down})
    found = issue(result, "far.example/x")
    assert found.category == "unverified"
    assert found.status_code is None
    assert found.reason


def test_address_the_guard_refuses_is_not_requested():
    fixture = Fixture({"shop.co.ae/": links("https://private.test/x")})
    allowed = lambda url: "private.test" not in url  # noqa: E731
    fetcher = PoliteFetcher(delay=0, is_allowed=allowed, transport=httpx.MockTransport(fixture))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, max_pages=5, check_external=True)
    assert not fixture.asked_for("private.test")
    assert issue(result, "private.test").category == "unverified"


# ---- bugs 4 and 5: one check per target, one report per target -------------------------------

def test_bug4_a_broken_footer_link_is_requested_once_and_lists_every_page():
    footer = "https://far.example/gone"
    pages = {
        "shop.co.ae/": links("/a", "/b", footer),
        "shop.co.ae/a": links(footer),
        "shop.co.ae/b": links(footer),
    }
    result, fixture = scan(pages)
    assert len(fixture.asked_for("far.example/gone")) == 1
    found = issue(result, "far.example/gone")
    assert found.pages == ["https://shop.co.ae/", "https://shop.co.ae/a", "https://shop.co.ae/b"]


def test_bug5_a_broken_internal_page_is_reported_once_with_its_pages():
    pages = {"shop.co.ae/": links("/a", "/missing"), "shop.co.ae/a": links("/missing")}
    result, fixture = scan(pages)
    assert len(fixture.asked_for("/missing")) == 1
    assert categories(result) == [("broken", "https://shop.co.ae/missing")]
    assert issue(result, "/missing").pages == ["https://shop.co.ae/", "https://shop.co.ae/a"]


def test_broken_start_page_is_reported():
    result, _ = scan({})
    found = issue(result, "shop.co.ae")
    assert found.category == "broken"
    assert found.pages == []


# ---- bug 7: address variants --------------------------------------------------------------------

def test_bug7_tracking_variants_are_one_page():
    pages = {
        "shop.co.ae/": links("/a?utm_source=x", "/a?utm_source=y&utm_medium=z", "/a#top", "/a?gclid=1", "/a"),
        "shop.co.ae/a": links(),
    }
    result, fixture = scan(pages)
    assert result.pages_read == 2
    assert len(fixture.asked_for("/a")) == 1
    assert fixture.asked_for("shop.co.ae/a")[0].endswith("/a")


def test_real_query_strings_stay_separate():
    pages = {"shop.co.ae/": links("/list?page=2", "/list?page=3"), "shop.co.ae/list?page=2": links(), "shop.co.ae/list?page=3": links()}
    assert scan(pages)[0].pages_read == 3


@pytest.mark.parametrize("given, expected", [
    ("https://Shop.Example/a?utm_source=x#top", "https://shop.example/a"),
    ("https://shop.example", "https://shop.example/"),
    ("https://shop.example:443/a", "https://shop.example/a"),
    ("http://shop.example:80/a", "http://shop.example/a"),
    ("http://shop.example:8080/a", "http://shop.example:8080/a"),
    ("https://shop.example/a?b=2&a=1&fbclid=z", "https://shop.example/a?a=1&b=2"),
    ("https://shop.example/a?q=", "https://shop.example/a?q="),
    ("mailto:a@b.example", ""),
    ("not a link", ""),
])
def test_normalize_url(given, expected):
    assert normalize_url(given) == expected


def test_page_key_ignores_www_and_scheme():
    assert page_key("https://www.shop.example/a") == page_key("http://shop.example/a")
    assert page_key("https://shop.example/a") != page_key("https://shop.example/b")
    assert host_key("https://WWW.Shop.Example:443/") == "shop.example"
    assert host_key("https://blog.shop.example/") == "blog.shop.example"


# ---- bug 8: a partial scan never looks complete ----------------------------------------------------

def test_bug8_pages_skipped_by_robots_are_counted():
    pages = {
        "shop.co.ae/robots.txt": "User-agent: *\nDisallow: /private\n",
        "shop.co.ae/": links("/private/a", "/private/b", "/open"),
        "shop.co.ae/open": links("/private/a"),
    }
    result, fixture = scan(pages)
    assert result.skipped_robots == 2
    assert not fixture.asked_for("/private")
    assert result.issues == []


def test_bug8_stopping_at_the_limit_is_stated():
    pages = {"shop.co.ae/": links("/a", "/b", "/c"), "shop.co.ae/a": links(), "shop.co.ae/b": links(), "shop.co.ae/c": links()}
    result, fixture = scan(pages, max_pages=2)
    assert result.pages_read == 2
    assert result.stopped_at_limit is True
    assert result.pages_not_read == 2
    assert not fixture.asked_for("/c")


def test_reaching_exactly_the_last_page_is_not_a_limit_stop():
    pages = {"shop.co.ae/": links("/a"), "shop.co.ae/a": links()}
    result, _ = scan(pages, max_pages=2)
    assert result.stopped_at_limit is False


def test_external_links_are_still_checked_after_the_limit():
    pages = {"shop.co.ae/": links("/a", "https://far.example/x"), "shop.co.ae/a": links(), "far.example/x": 404}
    result, _ = scan(pages, max_pages=1)
    assert issue(result, "far.example/x").category == "broken"
    assert result.stopped_at_limit is True


# ---- what it reads ------------------------------------------------------------------------------------

def test_only_normal_a_links_are_read():
    body = b"""<html><head><link href="/css"><script src="/js"></script></head><body>
      <img src="/image.png"><a href="/ok">x</a><a href="#top">x</a><a href="mailto:a@b.example">x</a>
      <a href="tel:1">x</a><a href="javascript:void(0)">x</a><a href="data:text/plain,x">x</a><a>no href</a>
      <script>var later = '<a href="/from-js">x</a>';</script></body></html>"""
    assert extract_links(body, "https://shop.co.ae/") == ["https://shop.co.ae/ok"]


def test_base_href_is_respected():
    body = b'<html><head><base href="https://shop.co.ae/dir/"></head><body><a href="x">y</a></body></html>'
    assert extract_links(body, "https://shop.co.ae/") == ["https://shop.co.ae/dir/x"]


def test_not_html_is_checked_but_not_read():
    def pdf(request):
        return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")

    result, _ = scan({"shop.co.ae/": links("/file.pdf"), "shop.co.ae/file.pdf": pdf})
    assert result.issues == []


def test_page_too_large_to_read_is_counted():
    def huge(request):
        return httpx.Response(200, html="x" * 3_000_000)

    result, _ = scan({"shop.co.ae/": links("/huge"), "shop.co.ae/huge": huge})
    assert result.too_large == 1


# ---- stopping and the daily budget --------------------------------------------------------------------

def test_stop_ends_the_scan_and_says_so():
    pages = {"shop.co.ae/": links("/a", "/b"), "shop.co.ae/a": links(), "shop.co.ae/b": links()}
    calls = iter([False, True])
    result, fixture = scan(pages, should_stop=lambda: next(calls, True))
    assert result.stopped is True
    assert result.pages_read == 1
    assert not fixture.asked_for("/a")


def test_budget_running_out_ends_the_scan_and_says_so():
    pages = {"shop.co.ae/": links("/a"), "shop.co.ae/a": links()}
    charged = []
    left = iter([True, False, False])
    result, _ = scan(pages, budget_allows=lambda: next(left, False), charge=charged.append)
    assert result.budget_out is True
    assert result.pages_read == 1
    assert sum(charged) >= 1


def test_every_request_is_charged_including_robots():
    pages = {"shop.co.ae/": links("/a", "https://far.example/x"), "shop.co.ae/a": links(), "far.example/x": links()}
    charged = []
    _, fixture = scan(pages, charge=charged.append)
    assert sum(charged) == len(fixture.requests)


# ---- addresses in any language, and unusable ones ------------------------------------------------

def test_a_link_with_raw_accents_or_arabic_survives_a_page_that_does_not_declare_its_encoding():
    body = '<html><body><a href="/café">x</a><a href="/قهوة">y</a></body></html>'.encode("utf-8")
    assert extract_links(body, "https://shop.co.ae/") == ["https://shop.co.ae/café", "https://shop.co.ae/قهوة"]


def test_a_link_is_read_in_the_encoding_the_server_gave():
    body = '<html><body><a href="/قهوة">y</a></body></html>'.encode("windows-1256")
    assert extract_links(body, "https://shop.co.ae/", "windows-1256") == ["https://shop.co.ae/قهوة"]


def test_a_non_latin_address_and_its_percent_spelling_are_one_page():
    assert page_key("https://shop.example/قهوة") == page_key("https://shop.example/%D9%82%D9%87%D9%88%D8%A9") == page_key("https://shop.example/%d9%82%d9%87%d9%88%d8%a9")
    assert page_key("https://shop.example/a") != page_key("https://shop.example/b")


# ---- no limit, and carrying on later ---------------------------------------------------------------

GONE = "https://far.example/gone"


def many_pages(count, every_page_links=()):
    """Page n links to the two pages after it, so the crawl has to find its way to all of them."""
    pages = {}
    for n in range(count):
        here = "shop.co.ae/" if n == 0 else f"shop.co.ae/p{n}"
        pages[here] = links(*(f"/p{m}" for m in (n * 2 + 1, n * 2 + 2) if m < count), *every_page_links)
    return pages


def flat_site(count):
    """The home page links to every other page, so no page depends on another having been read."""
    return {"shop.co.ae/": links(*(f"/p{n}" for n in range(1, count))), **{f"shop.co.ae/p{n}": links() for n in range(1, count)}}


def in_chunks(pages, per_chunk=3, start="https://shop.co.ae/", host="shop.co.ae", through_json=True, **options):
    """A crawl split into runs of `per_chunk` pages, each with a new fetcher, and its state through JSON in between."""
    fixture = Fixture(pages)
    state = CrawlState()
    runs = 0
    while True:
        runs += 1
        fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
        left = iter(range(per_chunk - 1))
        result = run_scan(start, host, fetcher, state=state, time_up=lambda: next(left, None) is None, **options)
        fetcher.close()
        if not result.paused:
            return result, fixture, runs
        assert runs < 10_000
        if through_json:
            state = CrawlState.from_json(json.loads(json.dumps(state.to_json())))


def requests_for_pages(fixture):
    return [u for u in fixture.requests if not u.endswith("/robots.txt")]


def test_no_limit_by_default_means_every_page_of_a_large_site():
    fixture = Fixture(many_pages(2100))
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher)
    fetcher.close()
    assert result.pages_read == 2100
    assert result.pages_not_read == 0
    assert result.stopped_at_limit is False
    assert len(requests_for_pages(fixture)) == len(set(requests_for_pages(fixture))) == 2100


def test_time_up_pauses_and_says_so():
    pages = many_pages(10)
    fixture = Fixture(pages)
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    state = CrawlState()
    left = iter([False, False, True])
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state, time_up=lambda: next(left))
    assert result.paused is True
    assert result.pages_read == 3
    assert result.pages_not_read == len(state.queue) > 0
    assert result.budget_out is False and result.stopped is False


def test_a_scan_that_finishes_is_not_paused():
    result, _ = scan({"shop.co.ae/": links()})
    assert result.paused is False


def test_without_a_state_the_result_carries_one_to_continue_from():
    fixture = Fixture(many_pages(4))
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    first = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, time_up=lambda: True)
    assert first.paused is True and first.pages_read == 1
    second = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=first.state)
    assert second.paused is False and second.pages_read == 4


@pytest.mark.parametrize("through_json", [True, False])
def test_a_crawl_in_chunks_reads_every_page_once_and_finds_the_same_as_one_run(through_json):
    pages = {
        **many_pages(40, every_page_links=(GONE, "/missing")),
        "shop.co.ae/missing": 404,
        "far.example/gone": 404,
    }
    whole, _ = scan(pages, max_pages=None)
    result, fixture, runs = in_chunks(pages, through_json=through_json)
    assert runs > 5
    assert result.pages_read == whole.pages_read == 41
    assert len(requests_for_pages(fixture)) == len(set(requests_for_pages(fixture)))  # nothing was asked for twice, robots.txt aside
    assert sorted((i.category, i.target_url, tuple(i.pages)) for i in result.issues) == sorted((i.category, i.target_url, tuple(i.pages)) for i in whole.issues)
    assert (result.links_checked, result.skipped_robots, result.too_large, result.external_not_checked) == (whole.links_checked, whole.skipped_robots, whole.too_large, whole.external_not_checked)


def test_a_broken_link_found_early_still_lists_a_page_read_in_a_later_chunk():
    pages = {**many_pages(12), "shop.co.ae/": links("/p1", "/p2", GONE), "shop.co.ae/p11": links(GONE), "far.example/gone": 404}
    result, _, runs = in_chunks(pages, per_chunk=2)
    assert runs > 3
    assert issue(result, "far.example/gone").pages == ["https://shop.co.ae/", "https://shop.co.ae/p11"]


def test_a_broken_page_read_early_still_lists_a_page_read_in_a_later_chunk():
    pages = {**many_pages(12), "shop.co.ae/": links("/missing", "/p1", "/p2"), "shop.co.ae/missing": 404, "shop.co.ae/p11": links("/missing")}
    result, _, _ = in_chunks(pages, per_chunk=2)
    assert issue(result, "/missing").pages == ["https://shop.co.ae/", "https://shop.co.ae/p11"]


def test_no_off_site_page_is_ever_read_across_chunks():
    pages = {
        **many_pages(8, every_page_links=("https://far.example/1",)),
        "far.example/1": links("https://far.example/2", "https://shop.co.ae/hidden"),
        "far.example/2": links(),
        "shop.co.ae/hidden": links(),
    }
    result, fixture, runs = in_chunks(pages, per_chunk=2)
    assert runs > 3
    assert len(fixture.asked_for("far.example/1")) == 1
    assert not fixture.asked_for("far.example/2")
    assert not fixture.asked_for("shop.co.ae/hidden")
    assert result.pages_read == 8


def test_a_redirect_off_site_is_still_not_followed_in_a_later_chunk():
    pages = {**many_pages(8), "shop.co.ae/p7": (302, "https://far.example/landing"), "far.example/landing": links("https://far.example/deeper")}
    result, fixture, _ = in_chunks(pages, per_chunk=2)
    assert not fixture.asked_for("far.example")
    assert issue(result, "/p7").category == "redirect"


def test_links_to_other_websites_carry_on_where_they_stopped():
    outside = [f"https://far.example/{n}" for n in range(9)]
    pages = {"shop.co.ae/": links("/a", *outside), "shop.co.ae/a": links(*outside), "far.example/3": 404}
    result, fixture, runs = in_chunks(pages, per_chunk=2)
    assert runs >= 5
    for address in outside:
        assert len(fixture.asked_for(address)) == 1
    assert result.external_not_checked == 0
    assert issue(result, "far.example/3").pages == ["https://shop.co.ae/", "https://shop.co.ae/a"]


def test_while_paused_it_says_how_many_links_to_other_websites_are_left():
    outside = [f"https://far.example/{n}" for n in range(6)]
    fixture = Fixture({"shop.co.ae/": links(*outside)})
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    left = iter([False, True])
    state = CrawlState()
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state, time_up=lambda: next(left))
    assert result.paused is True
    assert result.external_not_checked == len(state.external) == 5


def test_a_chunk_always_gets_something_done_however_little_time_it_has():
    pages = many_pages(6)
    fixture = Fixture(pages)
    state = CrawlState()
    runs = 0
    while True:
        runs += 1
        fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
        result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state, time_up=lambda: True)
        fetcher.close()
        if not result.paused:
            break
        assert runs < 50
    assert runs == 6
    assert result.pages_read == 6


def test_every_request_is_charged_across_chunks():
    pages = many_pages(6)
    charged = []
    _, fixture, _ = in_chunks(pages, per_chunk=2, charge=charged.append)
    assert sum(charged) == len(fixture.requests)


def test_a_state_holds_addresses_in_any_language_through_json():
    pages = {
        "shop.co.ae/": links("/café", "/قهوة", "/a?b=2&a=1", "https://far.example/コーヒー"),
        "shop.co.ae/caf%C3%A9": links("/gone-é"),
        "shop.co.ae/%D9%82%D9%87%D9%88%D8%A9": links("/gone-é"),
        "shop.co.ae/a?a=1&b=2": links(),
    }
    whole, _ = scan(pages, max_pages=None)
    result, _, _ = in_chunks(pages, per_chunk=1)
    assert sorted((i.category, i.target_url, tuple(i.pages)) for i in result.issues) == sorted((i.category, i.target_url, tuple(i.pages)) for i in whole.issues)
    assert issue(result, "gone-é").category == "broken"


def test_what_a_report_holds_survives_json():
    pages = {
        "shop.co.ae/": links("/chain"),
        "shop.co.ae/chain": (301, "/b"), "shop.co.ae/b": (301, "/c"), "shop.co.ae/c": (301, "/end"), "shop.co.ae/end": links(),
    }
    result, _, _ = in_chunks(pages, per_chunk=1)
    found = issue(result, "/chain")
    assert (found.category, found.hops, found.final_url, found.pages) == ("redirect", 3, "https://shop.co.ae/end", ["https://shop.co.ae/"])
    assert found.status_code == 200


# ---- on big sites, only what can still matter is kept -------------------------------------------------

def crawl_state_after(pages, stop_after, check_external=True):
    fixture = Fixture(pages)
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    state = CrawlState()
    left = iter(range(stop_after - 1))
    run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state, time_up=lambda: next(left, None) is None, check_external=check_external)
    fetcher.close()
    return state


def test_a_target_checked_with_no_issue_stops_recording_pages_and_drops_what_it_held():
    pages = {"shop.co.ae/": links("/a", "/b", "/c"), "shop.co.ae/a": links("/", "/b", "/c"), "shop.co.ae/b": links("/", "/a", "/c"), "shop.co.ae/c": links()}
    state = crawl_state_after(pages, stop_after=3)
    assert page_key("https://shop.co.ae/a") not in state.contains
    assert page_key("https://shop.co.ae/a") not in state.target_url
    assert page_key("https://shop.co.ae/") not in state.contains  # already checked when the first link to it was seen
    assert list(state.contains[page_key("https://shop.co.ae/c")]) == ["https://shop.co.ae/", "https://shop.co.ae/a", "https://shop.co.ae/b"]  # not checked yet


def test_a_target_with_an_issue_keeps_recording_pages():
    pages = {"shop.co.ae/": links("/gone", "/a", "/b"), "shop.co.ae/a": links("/gone"), "shop.co.ae/b": links("/gone")}
    state = crawl_state_after(pages, stop_after=3)  # home, /gone, /a: /b is still to come
    assert list(state.contains[page_key("https://shop.co.ae/gone")]) == ["https://shop.co.ae/", "https://shop.co.ae/a"]


def test_a_page_robots_txt_keeps_us_from_holds_no_list():
    pages = {"shop.co.ae/robots.txt": "User-agent: *\nDisallow: /cart\n", "shop.co.ae/": links("/cart", "/a"), "shop.co.ae/a": links("/cart", "/b"), "shop.co.ae/b": links("/cart", "/c"), "shop.co.ae/c": links("/cart")}
    state = crawl_state_after(pages, stop_after=4)
    assert page_key("https://shop.co.ae/cart") not in state.contains
    assert page_key("https://shop.co.ae/cart") not in state.target_url


def test_a_page_reached_by_a_redirect_holds_no_list():
    pages = {"shop.co.ae/": links("/old", "/new", "/z"), "shop.co.ae/old": (301, "/new"), "shop.co.ae/new": links("/new"), "shop.co.ae/z": links("/new")}
    result, fixture = scan(pages, max_pages=None)
    assert len(fixture.asked_for("/new")) == 1
    assert result.issues == []
    state = crawl_state_after(pages, stop_after=2)
    assert page_key("https://shop.co.ae/new") not in state.contains


def test_a_link_to_another_website_checked_with_no_issue_drops_what_it_held():
    pages = {"shop.co.ae/": links("https://far.example/ok", "https://far.example/gone"), "far.example/ok": links(), "far.example/gone": 404}
    state = crawl_state_after(pages, stop_after=2)  # the home page and far.example/ok
    assert "far.example/ok" not in state.contains
    assert "far.example/ok" not in state.target_url
    assert list(state.contains["far.example/gone"]) == ["https://shop.co.ae/"]


def test_links_to_other_websites_that_will_never_be_checked_hold_no_list():
    pages = {"shop.co.ae/": links("https://far.example/1", "/a"), "shop.co.ae/a": links("https://far.example/1", "/b"), "shop.co.ae/b": links()}
    state = crawl_state_after(pages, stop_after=2, check_external=False)
    assert state.contains.get("far.example/1") is None
    assert list(state.external) == ["far.example/1"]


def test_dropping_lists_changes_nothing_in_the_results():
    footer = ("/about", "/gone", "https://far.example/ok", "https://far.example/gone")
    pages = {**many_pages(30, every_page_links=footer), "shop.co.ae/about": links(*footer), "far.example/ok": links(), "far.example/gone": 404}
    result, _ = scan(pages, max_pages=None)
    every_page = sorted(["https://shop.co.ae/", "https://shop.co.ae/about", *(f"https://shop.co.ae/p{n}" for n in range(1, 30))])
    assert sorted(issue(result, "shop.co.ae/gone").pages) == every_page
    assert sorted(issue(result, "far.example/gone").pages) == every_page
    assert [i.target_url for i in result.issues if "ok" in i.target_url or "about" in i.target_url] == []


# ---- what the crawl reports as it goes ---------------------------------------------------------------

def test_progress_says_pages_read_and_pages_found_but_not_read_yet():
    seen = []
    scan(many_pages(7), max_pages=None, on_progress=lambda result, external_left: seen.append((result.pages_read, result.pages_not_read)))
    assert seen == [(1, 2), (2, 3), (3, 4), (4, 3), (5, 2), (6, 1), (7, 0)]


def test_progress_only_counts_links_to_other_websites_once_their_turn_comes():
    seen = []
    pages = {"shop.co.ae/": links("/a", "https://far.example/1", "https://far.example/2"), "shop.co.ae/a": links()}
    scan(pages, max_pages=None, on_progress=lambda result, external_left: seen.append((result.pages_read, external_left)))
    assert seen == [(1, 0), (2, 0), (2, 1), (2, 0)]


def test_a_page_skipped_by_robots_counts_in_the_progress_too():
    seen = []
    pages = {"shop.co.ae/robots.txt": "User-agent: *\nDisallow: /private\n", "shop.co.ae/": links("/private/a", "/private/b")}
    scan(pages, max_pages=None, on_progress=lambda result, external_left: seen.append((result.pages_read, result.skipped_robots, result.pages_not_read)))
    assert seen[-1] == (1, 2, 0)


# ---- the daily budget and stopping, with a state ------------------------------------------------------

def test_budget_running_out_pauses_and_nothing_is_lost():
    pages = {**many_pages(6, every_page_links=(GONE,)), "far.example/gone": 404}
    fixture = Fixture(pages)
    state = CrawlState()
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    left = iter([True, True, False])
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state, budget_allows=lambda: next(left))
    assert (result.budget_out, result.paused, result.stopped, result.pages_read) == (True, True, False, 2)
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=CrawlState.from_json(state.to_json()))
    assert (result.budget_out, result.paused, result.pages_read) == (False, False, 6)
    assert len(issue(result, "far.example/gone").pages) == 6


def test_stopping_gives_what_was_found_so_far():
    pages = {**many_pages(6, every_page_links=(GONE,)), "far.example/gone": 404}
    fixture = Fixture(pages)
    state = CrawlState()
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(fixture))
    calls = iter([False, False, True])
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state, should_stop=lambda: next(calls))
    assert (result.stopped, result.paused, result.pages_read) == (True, False, 2)
    assert result.pages_not_read == 3
    assert result.external_not_checked == 1


def test_a_saved_state_can_be_finished_without_reading_anything():
    pages = {"shop.co.ae/": links("/gone", "/a", GONE), "shop.co.ae/a": links("/gone", "/b"), "shop.co.ae/b": links()}
    state = crawl_state_after(pages, stop_after=2)
    result = CrawlState.from_json(json.loads(json.dumps(state.to_json()))).so_far()
    assert result.pages_read == 2
    assert result.pages_not_read == 1  # /a
    assert result.external_not_checked == 1
    assert issue(result, "shop.co.ae/gone").pages == ["https://shop.co.ae/"]


# ---- a later chunk must not waste what's left --------------------------------------------------------------

class TurnsDown:
    """A site whose robots.txt fails from one moment on, until it's told to answer again."""

    def __init__(self, pages):
        self.fixture = Fixture(pages)
        self.failing = None

    def __call__(self, request):
        if self.failing and request.url.path == "/robots.txt":
            self.fixture.requests.append(str(request.url))
            if isinstance(self.failing, Exception):
                raise self.failing
            return httpx.Response(self.failing, text="no")
        return self.fixture(request)

    def chunk(self, state, per_chunk=2):
        fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(self))
        left = iter(range(per_chunk - 1))
        result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state, time_up=lambda: next(left, None) is None)
        fetcher.close()
        return result


@pytest.mark.parametrize("failure", [503, httpx.ConnectError("no answer")], ids=["server_error", "network_error"])
def test_robots_txt_failing_in_a_later_chunk_loses_no_page(failure):
    site = TurnsDown(many_pages(10))
    state = CrawlState()
    first = site.chunk(state)
    assert first.paused and first.pages_read == 2
    site.failing = failure
    before = (state.result.pages_read, state.result.skipped_robots, state.result.links_checked, len(state.queue), len(state.reports))
    waiting = site.chunk(state)
    assert waiting.paused is True
    assert waiting.wait_seconds > 0
    assert (state.result.pages_read, state.result.skipped_robots, state.result.links_checked, len(state.queue), len(state.reports)) == before
    site.failing = None
    while True:
        result = site.chunk(state)
        if not result.paused:
            break
    assert (result.pages_read, result.skipped_robots) == (10, 0)
    assert result.issues == []


@pytest.mark.parametrize("failure,skipped", [(503, 8), (httpx.ConnectError("no answer"), 0)], ids=["server_error", "network_error"])
def test_robots_txt_failing_in_a_later_chunk_is_not_waited_for_for_ever(failure, skipped):
    site = TurnsDown(flat_site(10))
    state = CrawlState()
    site.chunk(state)
    site.failing = failure
    waits = 0
    while True:
        result = site.chunk(state)
        waits += bool(result.wait_seconds)
        if not result.paused:
            break
        assert waits < 1000
    assert waits == ROBOTS_TRIES
    assert result.skipped_robots == skipped  # it says so, as for any page robots.txt keeps it from
    assert result.pages_read == 10 - skipped
    assert len(result.issues) == 8 - skipped  # or it says it couldn't verify them


def test_a_failing_robots_txt_gets_a_fresh_count_after_it_recovers():
    site = TurnsDown(many_pages(20))
    state = CrawlState()
    site.chunk(state)
    site.failing = 503
    site.chunk(state)
    assert state.robots_tries == 1
    site.failing = None
    site.chunk(state)
    assert state.robots_tries == 0


def test_having_given_up_on_a_robots_txt_it_does_not_wait_again():
    """A site can answer on one of www and non-www and fail on the other. A day's wait once is enough."""
    state = CrawlState(robots_tries=ROBOTS_TRIES)
    state.begin("https://shop.co.ae/")
    state.seen_pages.add("shop.co.ae/next")
    state.queue.append("https://www.shop.co.ae/next")

    def answer(request):
        if request.url.host.startswith("www.") and request.url.path == "/robots.txt":
            return httpx.Response(503, text="no")
        return httpx.Response(200, html=links())

    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(answer))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state)
    assert result.paused is False
    assert result.skipped_robots == 1
    assert state.robots_tries == ROBOTS_TRIES


def test_a_start_page_kept_away_by_a_failing_robots_txt_is_still_reported_at_once():
    pages = {"shop.co.ae/": links("/a")}
    fixture = Fixture(pages)

    def answer(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(500, text="no")
        return fixture(request)

    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(answer))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher)
    assert result.paused is False
    assert result.skipped_robots == 1


def test_a_site_asking_to_slow_down_keeps_the_pages_it_was_not_asked_about():
    asked = []

    def answer(request):
        asked.append(request.url.path)
        if request.url.path == "/p2":
            return httpx.Response(429, headers={"retry-after": "120"}, text="slow down")
        return Fixture(flat_site(12))(request)

    state = CrawlState()
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(answer))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state)
    fetcher.close()
    assert result.paused is True
    assert 110 <= result.wait_seconds <= 121
    assert result.pages_read == 3  # home, /p1, and /p2, which did answer
    assert issue(result, "/p2").category == "unverified"
    assert "/p3" not in asked  # held back, without a request
    assert result.pages_not_read == 9
    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(answer))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher, state=state)
    assert result.paused is False
    assert result.pages_read == 12
    assert [i.target_url for i in result.issues] == ["https://shop.co.ae/p2"]


def test_a_very_long_retry_after_is_only_waited_for_so_long():
    def answer(request):
        if request.url.path == "/a":
            return httpx.Response(429, headers={"retry-after": "99999999"}, text="slow down")
        return Fixture({"shop.co.ae/": links("/a", "/b"), "shop.co.ae/b": links()})(request)

    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(answer))
    result = run_scan("https://shop.co.ae/", "shop.co.ae", fetcher)
    assert result.paused is True
    assert result.wait_seconds <= 3600
