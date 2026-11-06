"""The fetcher's manners, tested against a real local HTTP server."""
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from seo.crawl.fetch import LONGEST_CRAWL_DELAY, USER_AGENT, PoliteFetcher


class Site:
    """A throwaway website whose behaviour each test sets."""

    def __init__(self):
        self.robots = "User-agent: *\nDisallow: /private\n"
        self.robots_status = 200
        self.robots_location = ""
        self.hits = []
        self.redirect_target = ""
        site = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send(self, code, body=b"", headers=None):
                self.send_response(code)
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                site.hits.append((time.monotonic(), self.path, dict(self.headers)))
                html = {"Content-Type": "text/html; charset=utf-8"}
                if self.path == "/real-robots":
                    self.send(200, site.robots.encode(), {"Content-Type": "text/plain"})
                elif self.path == "/robots.txt":
                    extra = {"Location": site.robots_location} if site.robots_location else {}
                    self.send(site.robots_status, site.robots.encode(), {"Content-Type": "text/plain", **extra})
                elif self.path == "/etag":
                    if self.headers.get("If-None-Match") == '"v1"':
                        self.send(304)
                    else:
                        self.send(200, b"<html>hello</html>", {**html, "ETag": '"v1"'})
                elif self.path == "/modified":
                    stamp = "Wed, 21 Oct 2026 07:28:00 GMT"
                    if self.headers.get("If-Modified-Since") == stamp:
                        self.send(304)
                    else:
                        self.send(200, b"<html>hello</html>", {**html, "Last-Modified": stamp})
                elif self.path == "/rate":
                    self.send(429, b"slow down", {"Retry-After": "120"})
                elif self.path == "/challenge":
                    self.send(403, b"<title>Just a moment...</title>", {**html, "cf-mitigated": "challenge"})
                elif self.path == "/challenge-200":
                    self.send(200, b"<title>Just a moment...</title><div id='cf-browser-verification'>", html)
                elif self.path == "/forbidden":
                    self.send(403, b"no", html)
                elif self.path == "/gone":
                    self.send(404, b"nope", html)
                elif self.path == "/big":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    try:
                        for _ in range(40):
                            self.wfile.write(b"x" * 100_000)
                    except OSError:
                        pass
                elif self.path == "/pdf":
                    self.send(200, b"%PDF-1.7", {"Content-Type": "application/pdf"})
                elif self.path == "/redirect-out":
                    self.send(302, b"", {"Location": site.redirect_target})
                elif self.path == "/loop":
                    self.send(302, b"", {"Location": "/loop"})
                elif self.path == "/moved":
                    self.send(301, b"", {"Location": "/etag"})
                else:
                    self.send(200, b"<html>page</html>", html)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def pages_hit(self):
        return [path for _, path, _ in self.hits if path != "/robots.txt"]


@pytest.fixture
def site():
    server = Site()
    yield server
    server.server.shutdown()


def only_this_site(site):
    """The real guard refuses 127.0.0.1, so tests allow just this one server."""
    return lambda url: url.startswith(site.base)


@pytest.fixture
def fetcher(site):
    return PoliteFetcher(delay=0.01, is_allowed=only_this_site(site))


def test_user_agent_is_a_declared_bot_and_does_not_name_us_or_pretend(site, fetcher):
    fetcher.get(site.base + "/page")
    sent = {headers.get("User-Agent") for _, _, headers in site.hits}
    assert sent == {USER_AGENT}
    assert "bot" in USER_AGENT.lower()
    for word in ("Mozilla", "Chrome", "Safari", "Always", "Improving", "Dubai"):
        assert word not in USER_AGENT


def test_ok_page_returns_body_and_validators(site, fetcher):
    result = fetcher.get(site.base + "/etag")
    assert result.status == "ok"
    assert result.http_status == 200
    assert result.body == b"<html>hello</html>"
    assert result.etag == '"v1"'


def test_robots_disallow_means_no_request_at_all(site, fetcher):
    result = fetcher.get(site.base + "/private/page")
    assert result.status == "robots"
    assert site.pages_hit() == []


def test_robots_is_read_once_per_domain(site, fetcher):
    fetcher.get(site.base + "/a")
    fetcher.get(site.base + "/b")
    assert [p for _, p, _ in site.hits].count("/robots.txt") == 1


def test_missing_robots_means_allowed(site, fetcher):
    # RFC 9309: a 4xx robots.txt means no restrictions.
    site.robots_status = 404
    assert fetcher.get(site.base + "/page").status == "ok"


def test_robots_server_error_means_do_not_crawl(site, fetcher):
    # RFC 9309: if robots can't be read because the server failed, assume disallow.
    site.robots_status = 503
    result = fetcher.get(site.base + "/page")
    assert result.status == "robots"
    assert site.pages_hit() == []


def test_two_requests_to_one_domain_are_spaced_by_the_delay(site):
    fetcher = PoliteFetcher(delay=0.3, is_allowed=only_this_site(site))
    fetcher.get(site.base + "/a")
    fetcher.get(site.base + "/b")
    times = [t for t, _, _ in site.hits]
    gaps = [later - earlier for earlier, later in zip(times, times[1:])]
    assert all(gap >= 0.28 for gap in gaps)


def test_crawl_delay_above_our_delay_is_honoured(site):
    site.robots = "User-agent: *\nCrawl-delay: 1\n"
    fetcher = PoliteFetcher(delay=0.01, is_allowed=only_this_site(site))
    fetcher.get(site.base + "/a")
    fetcher.get(site.base + "/b")
    pages = [t for t, path, _ in site.hits if path != "/robots.txt"]
    assert pages[1] - pages[0] >= 0.95


def test_etag_is_sent_and_304_returns_not_modified(site, fetcher):
    result = fetcher.get(site.base + "/etag", etag='"v1"')
    assert result.status == "not_modified"
    assert result.body is None


def test_last_modified_is_sent_and_304_returns_not_modified(site, fetcher):
    result = fetcher.get(site.base + "/modified", last_modified="Wed, 21 Oct 2026 07:28:00 GMT")
    assert result.status == "not_modified"


def test_429_backs_off_that_domain_without_more_requests(site, fetcher):
    assert fetcher.get(site.base + "/rate").status == "rate_limited"
    hits_before = len(site.pages_hit())
    result = fetcher.get(site.base + "/page")
    assert result.status == "rate_limited"
    assert len(site.pages_hit()) == hits_before


def test_retry_after_sets_how_long_the_back_off_lasts(site, fetcher):
    result = fetcher.get(site.base + "/rate")
    assert 100 <= result.retry_after <= 120


def test_bot_challenge_is_reported_as_blocked(site, fetcher):
    assert fetcher.get(site.base + "/challenge").status == "blocked"


def test_challenge_page_with_status_200_is_still_blocked(site, fetcher):
    assert fetcher.get(site.base + "/challenge-200").status == "blocked"


def test_plain_403_is_reported_as_blocked(site, fetcher):
    assert fetcher.get(site.base + "/forbidden").status == "blocked"


def test_404_is_reported_as_gone(site, fetcher):
    result = fetcher.get(site.base + "/gone")
    assert result.status == "gone"
    assert result.http_status == 404


def test_body_over_the_limit_stops_at_the_limit(site):
    fetcher = PoliteFetcher(delay=0.01, max_bytes=500_000, is_allowed=only_this_site(site))
    result = fetcher.get(site.base + "/big")
    assert result.status == "too_large"
    assert result.body is None
    assert result.bytes <= 700_000


def test_non_html_is_skipped_without_keeping_it(site, fetcher):
    result = fetcher.get(site.base + "/pdf")
    assert result.status == "not_html"
    assert result.body is None


def test_any_type_mode_keeps_non_html_for_sitemaps(site, fetcher):
    result = fetcher.get(site.base + "/pdf", any_type=True)
    assert result.status == "ok"


def test_redirect_to_a_private_address_is_refused(site, fetcher):
    site.redirect_target = "http://169.254.169.254/latest/meta-data/"
    result = fetcher.get(site.base + "/redirect-out")
    assert result.status == "refused"


def test_starting_at_a_refused_address_sends_nothing(site):
    fetcher = PoliteFetcher(delay=0.01, is_allowed=lambda url: False)
    assert fetcher.get(site.base + "/page").status == "refused"
    assert site.hits == []


def test_default_guard_refuses_loopback(site):
    assert PoliteFetcher(delay=0.01).get(site.base + "/page").status == "refused"
    assert site.hits == []


def test_followed_redirect_reports_the_final_url(site, fetcher):
    result = fetcher.get(site.base + "/moved")
    assert result.status == "ok"
    assert result.final_url == site.base + "/etag"


def test_redirect_loop_stops(site, fetcher):
    assert fetcher.get(site.base + "/loop").status == "too_many_redirects"


def test_network_failure_is_reported_not_raised():
    fetcher = PoliteFetcher(delay=0.01, is_allowed=lambda url: True, timeout=1)
    result = fetcher.get("http://127.0.0.1:1/page")
    assert result.status == "network_error"


def test_result_records_time_and_size(site, fetcher):
    result = fetcher.get(site.base + "/etag")
    assert result.seconds > 0
    assert result.bytes == len(b"<html>hello</html>")


def test_sitemaps_listed_in_robots_are_available(site, fetcher):
    site.robots = f"User-agent: *\nSitemap: {site.base}/map.xml\n"
    assert fetcher.sitemaps_from_robots(site.base) == [f"{site.base}/map.xml"]


def test_a_huge_crawl_delay_is_only_obeyed_up_to_a_point():
    """A chunk is short, and Stop has to work: one robots.txt on the other side of a link can't hold the lane for hours."""
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text="User-agent: *\nCrawl-delay: 100000\n", headers={"content-type": "text/plain"}))
    fetcher = PoliteFetcher(delay=3, is_allowed=lambda url: True, transport=transport)
    fetcher.sitemaps_from_robots("https://far.example/")
    assert fetcher.longest_gap() == LONGEST_CRAWL_DELAY
    fetcher.close()


def test_the_longest_gap_is_the_plain_delay_until_a_site_asks_for_more():
    fetcher = PoliteFetcher(delay=3, is_allowed=lambda url: True, transport=httpx.MockTransport(lambda request: httpx.Response(404)))
    assert fetcher.longest_gap() == 3
    fetcher.sitemaps_from_robots("https://far.example/")
    assert fetcher.longest_gap() == 3
    fetcher.close()


@pytest.mark.parametrize("answer", [httpx.Response(500, text="no"), None], ids=["server_error", "no_answer"])
def test_a_page_not_asked_for_because_robots_txt_failed_says_so(answer):
    def respond(request):
        if answer is None:
            raise httpx.ConnectError("no answer")
        return answer

    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(respond))
    assert fetcher.get("https://far.example/page").held_back is True
    fetcher.close()


def test_a_page_not_asked_for_because_the_site_said_wait_says_so():
    def respond(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(429, headers={"retry-after": "60"})

    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(respond))
    first = fetcher.get("https://far.example/a")
    assert first.status == "rate_limited" and first.held_back is False  # this one did answer
    second = fetcher.get("https://far.example/b")
    assert second.status == "rate_limited" and second.held_back is True
    assert second.retry_after > 50
    fetcher.close()


def test_a_page_robots_txt_keeps_us_from_is_an_answer_not_a_hold_up():
    def respond(request):
        return httpx.Response(200, text="User-agent: *\nDisallow: /private\n", headers={"content-type": "text/plain"})

    fetcher = PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(respond))
    result = fetcher.get("https://far.example/private/a")
    assert result.status == "robots" and result.held_back is False
    fetcher.close()


def test_a_robots_redirect_to_a_refused_address_is_not_followed(site, fetcher):
    other = Site()
    try:
        site.robots_status, site.robots_location = 302, other.base + "/secret"
        assert fetcher.get(site.base + "/page").status == "ok"
        assert other.hits == []
    finally:
        other.server.shutdown()


def test_a_robots_redirect_on_the_same_site_is_followed(site, fetcher):
    site.robots_status, site.robots_location = 302, "/real-robots"
    assert fetcher.get(site.base + "/private").status == "robots"
