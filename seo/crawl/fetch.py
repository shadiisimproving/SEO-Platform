"""A polite fetcher: says it is a bot, follows robots.txt, never evades a block.

A site that blocks us gets reported as blocked. There is no retry with another
identity, no proxy and no captcha solving.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Callable
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from seo.crawl.guard import is_public_url

USER_AGENT = "PageChangeBot/0.1"
_BOT_NAME = USER_AGENT.split("/")[0]

MAX_REDIRECTS = 5
DEFAULT_429_BACKOFF = 300.0
ROBOTS_MAX_BYTES = 500_000
# Only checked on short pages. A real article can mention a captcha, and plenty of
# normal Cloudflare pages load a challenge script without being a challenge.
CHALLENGE_MARKERS = (
    b"cf-browser-verification",
    b"_cf_chl_opt",
    b"<title>just a moment",
    b"<title>attention required",
    b"verifying you are human",
    b"sgcaptcha",
    b"incapsula incident",
)
CHALLENGE_CHECK_LIMIT = 60_000
LONGEST_CRAWL_DELAY = 60.0  # a robots.txt can ask for anything. Waiting hours for one link would hold up the lane, and Stop with it.


@dataclass
class FetchResult:
    url: str
    status: str
    http_status: int | None = None
    body: bytes | None = None
    charset: str | None = None
    etag: str | None = None
    last_modified: str | None = None
    final_url: str | None = None
    retry_after: float | None = None
    seconds: float = 0.0
    bytes: int = 0
    hops: int = 0  # redirects followed to get here
    request_seconds: float = 0.0  # time on the network only, without the polite waits
    error: str | None = None  # why a request failed, in plain words
    held_back: bool = False  # the page wasn't asked: robots.txt didn't answer, or the site told us to wait. This says nothing about the page.
    x_robots_tag: str | None = None  # the X-Robots-Tag header, when a page sends one: noindex there hides the page from Google as the meta tag does


@dataclass
class _Host:
    robots: RobotFileParser | None = None
    robots_state: str = "unread"  # ok, allow_all, server_error, network_error
    delay: float = 0.0
    next_at: float = 0.0
    blocked_until: float = 0.0
    sitemaps: list[str] = field(default_factory=list)


def _retry_after_seconds(value: str | None) -> float:
    if not value:
        return DEFAULT_429_BACKOFF
    try:
        return max(1.0, float(value))
    except ValueError:
        pass
    try:
        return max(1.0, parsedate_to_datetime(value).timestamp() - time.time())
    except (TypeError, ValueError):
        return DEFAULT_429_BACKOFF


def _looks_like_challenge(headers, body: bytes) -> bool:
    if headers.get("cf-mitigated", "").lower() == "challenge":
        return True
    if len(body) > CHALLENGE_CHECK_LIMIT:
        return False
    lowered = body.lower()
    return any(marker in lowered for marker in CHALLENGE_MARKERS)


class PoliteFetcher:
    def __init__(
        self,
        delay: float = 3.0,
        max_bytes: int = 2_000_000,
        timeout: float = 20.0,
        is_allowed: Callable[[str], bool] = is_public_url,
        transport: httpx.BaseTransport | None = None,
    ):
        self.delay = delay
        self.max_bytes = max_bytes
        self.is_allowed = is_allowed
        self.requests = 0  # every request sent, robots.txt included, for the daily budget
        self._hosts: dict[str, _Host] = {}
        self._client = httpx.Client(
            follow_redirects=False,
            timeout=timeout,
            trust_env=False,
            transport=transport,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"},
        )

    def close(self) -> None:
        self._client.close()

    def longest_gap(self) -> float:
        """The longest wait between requests that any host here asks for, its robots.txt's Crawl-delay included."""
        return max([self.delay, *(host.delay for host in self._hosts.values())])

    # -- per-host state ------------------------------------------------------

    def _host(self, url: str) -> _Host:
        parts = urlsplit(url)
        key = f"{parts.scheme}://{parts.netloc}"
        host = self._hosts.get(key)
        if host is None:
            host = self._hosts[key] = _Host(delay=self.delay)
            self._read_robots(key, host)
        return host

    def _wait(self, host: _Host) -> None:
        pause = host.next_at - time.monotonic()
        if pause > 0:
            time.sleep(pause)

    def _spaced(self, host: _Host) -> None:
        host.next_at = time.monotonic() + host.delay

    def _read_robots(self, base: str, host: _Host) -> None:
        """RFC 9309: a 4xx robots.txt means no rules; a server failure means stay out."""
        address = f"{base}/robots.txt"
        try:
            for _ in range(MAX_REDIRECTS + 1):
                self.requests += 1
                response = self._client.get(address, follow_redirects=False)
                if not response.is_redirect:
                    break
                address = urljoin(address, response.headers["location"])
                if not self.is_allowed(address):  # every hop is checked, as in get(). Rules it can't read are no rules.
                    host.robots_state = "allow_all"
                    return
            else:
                host.robots_state = "allow_all"
                return
        except httpx.HTTPError:
            host.robots_state = "network_error"
            return
        finally:
            self._spaced(host)
        if response.status_code >= 500:
            host.robots_state = "server_error"
        elif response.status_code >= 400:
            host.robots_state = "allow_all"
        else:
            parser = RobotFileParser()
            parser.parse(response.text[:ROBOTS_MAX_BYTES].splitlines())
            host.robots = parser
            host.robots_state = "ok"
            host.sitemaps = list(parser.site_maps() or [])
            crawl_delay = parser.crawl_delay(_BOT_NAME)
            if crawl_delay:
                host.delay = max(host.delay, min(float(crawl_delay), LONGEST_CRAWL_DELAY))
                self._spaced(host)

    def agent_may_fetch(self, url: str, agent: str) -> bool | None:
        """What this host's robots.txt, already read, says to another crawler, such as Googlebot. None when it couldn't be read. Sends nothing."""
        parts = urlsplit(url)
        host = self._hosts.get(f"{parts.scheme}://{parts.netloc}")
        if host is None or host.robots_state in ("unread", "network_error", "server_error"):
            return None
        return True if host.robots is None else host.robots.can_fetch(agent, url)

    def sitemaps_from_robots(self, base_url: str) -> list[str]:
        if not self.is_allowed(base_url):
            return []
        return list(self._host(base_url).sitemaps)

    # -- fetching ------------------------------------------------------------

    def get(
        self,
        url: str,
        etag: str | None = None,
        last_modified: str | None = None,
        any_type: bool = False,
        stay_on: Callable[[str], bool] | None = None,
    ) -> FetchResult:
        """Follow redirects one at a time, checking each address before asking for it.

        With `stay_on`, a redirect to an address it refuses is not followed: the result is
        `left_scope`, with that address in `final_url`.
        """
        started = time.monotonic()
        current = url
        network = 0.0
        for hop in range(MAX_REDIRECTS + 1):
            result = self._one(current, url, etag, last_modified, any_type)
            network += result.request_seconds
            result.request_seconds = network
            if result.status != "redirect":
                result.seconds = time.monotonic() - started
                result.hops = hop
                return result
            current = urljoin(current, result.final_url or "")
            if stay_on is not None and not stay_on(current):
                return FetchResult(
                    url=url, status="left_scope", http_status=result.http_status, final_url=current, hops=hop + 1,
                    seconds=time.monotonic() - started, request_seconds=network,
                )
            etag = last_modified = None  # validators belong to the original address
        return FetchResult(
            url=url, status="too_many_redirects", final_url=current, hops=MAX_REDIRECTS + 1,
            seconds=time.monotonic() - started, request_seconds=network,
        )

    def _one(self, current, original, etag, last_modified, any_type) -> FetchResult:
        if not self.is_allowed(current):
            return FetchResult(url=original, status="refused", final_url=current)

        host = self._host(current)
        if host.robots_state == "network_error":
            return FetchResult(url=original, status="network_error", error="could not reach the site", held_back=True)
        if host.robots_state == "server_error":
            return FetchResult(url=original, status="robots", error="robots.txt answered with a server error", held_back=True)
        if host.robots is not None and not host.robots.can_fetch(_BOT_NAME, current):
            return FetchResult(url=original, status="robots")

        remaining = host.blocked_until - time.monotonic()
        if remaining > 0:
            return FetchResult(url=original, status="rate_limited", retry_after=remaining, held_back=True)

        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        self._wait(host)
        self.requests += 1
        sent = time.monotonic()
        try:
            with self._client.stream("GET", current, headers=headers) as response:
                result = self._read(response, host, current, original, any_type)
                result.request_seconds = time.monotonic() - sent
                return result
        except httpx.TimeoutException:
            return FetchResult(url=original, status="network_error", error="timed out", request_seconds=time.monotonic() - sent)
        except httpx.HTTPError as exc:
            return FetchResult(url=original, status="network_error", error=str(exc)[:200] or type(exc).__name__, request_seconds=time.monotonic() - sent)
        finally:
            self._spaced(host)

    def _read(self, response, host, current, original, any_type) -> FetchResult:
        code = response.status_code
        result = FetchResult(url=original, status="ok", http_status=code, final_url=current)

        if 300 <= code < 400 and code != 304:
            location = response.headers.get("location")
            if location:
                result.status = "redirect"
                result.final_url = location
            else:
                result.status = "http_error"
            return result
        if code == 304:
            result.status = "not_modified"
            return result
        if code == 429:
            wait = _retry_after_seconds(response.headers.get("retry-after"))
            host.blocked_until = time.monotonic() + wait
            result.status = "rate_limited"
            result.retry_after = wait
            return result
        if code in (404, 410):
            result.status = "gone"
            return result
        if code >= 400 and code not in (401, 403, 503):
            result.status = "server_error" if code >= 500 else "http_error"
            return result

        content_type = response.headers.get("content-type", "").lower()
        is_html = "html" in content_type or not content_type
        if code < 400 and not is_html and not any_type:
            result.status = "not_html"
            return result

        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_bytes():
            size += len(chunk)
            if size > self.max_bytes:
                result.status = "too_large"
                result.bytes = size
                return result
            chunks.append(chunk)
        body = b"".join(chunks)
        result.bytes = size

        if code in (401, 403):
            result.status = "blocked"
            return result
        if _looks_like_challenge(response.headers, body):
            result.status = "blocked"
            return result
        if code == 503:
            result.status = "server_error"
            return result

        result.body = body
        result.charset = response.charset_encoding
        result.etag = response.headers.get("etag")
        result.last_modified = response.headers.get("last-modified")
        tags = response.headers.get_list("x-robots-tag")
        result.x_robots_tag = ", ".join(tags)[:500] if tags else None
        return result
