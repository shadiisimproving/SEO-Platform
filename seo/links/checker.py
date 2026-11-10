"""Check the links on one of my own websites: broken links, long redirect chains, slow answers.

The idea comes from Saas Project/app/services/link_crawler.py. The logic is rewritten here, not
imported, and these old problems are fixed:
1. Scope is the exact host, ignoring www, so another site on .co.ae is never crawled.
2. Every redirect is checked before it is followed, and links resolve against the page we landed on.
3. Only 404 and 410 are broken. Everything else is "could not verify", with the reason.
4. Each target is requested once, then listed with every page that contains it.
5. A broken page is reported once, whether found by a link or by crawling it.
6. Reasons, hop counts and timings travel with each issue.
7. Addresses are normalised before queueing, so ?utm= variants are one page.
8. Pages skipped by robots.txt or by the limit are counted, so a partial scan says so.

It can stop at any moment and carry on later, in another process, from its CrawlState. That's how it reads a whole
website, however big, in the short chunks a job gets on shared hosting.

It only reads normal <a> links. Images and links added by JavaScript are not checked.
"""
from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Callable
from urllib.parse import urljoin

import httpx
from lxml import html as lxml_html

from seo.crawl.extract import _decode
from seo.crawl.fetch import FetchResult, PoliteFetcher
from seo.links.urls import host_key, normalize_url, page_key

SLOW_SECONDS = 5.0
LONG_CHAIN_HOPS = 2
ROBOTS_RETRY_SECONDS = 300
ROBOTS_TRIES = 288  # a day of asking, every 5 minutes, before believing that robots.txt really has gone
LONGEST_WAIT_SECONDS = 3600  # a site's Retry-After is only obeyed this far: it can say anything
# Guards against endless addresses (F66), not a page limit: a scan still reads the whole site. A calendar, faceted filters
# or ?replytocom= make every variant a new page, so one path keeps at most this many query-string variants...
QUERY_VARIANTS_PER_PATH = 50
# ...and a scan ends, complete with a note, past this many pages. Far above any site this app reads.
SAFETY_PAGES = 100_000
START_TRIES = 3  # a passing failure on the start page is tried again in a later chunk before it's believed (F67)
START_RETRY_SECONDS = 120
_PASSING = ("network_error", "server_error", "rate_limited")

BROKEN, UNVERIFIED, REDIRECT, SLOW = "broken", "unverified", "redirect", "slow"
SKIPPED_SCHEMES = ("#", "javascript:", "mailto:", "tel:", "data:", "sms:", "ftp:", "file:", "about:")


@dataclass
class Issue:
    category: str
    target_url: str
    status_code: int | None
    reason: str
    hops: int | None = None
    seconds: float | None = None
    final_url: str | None = None
    pages: list[str] = field(default_factory=list)  # every page containing this link; empty for the start page


@dataclass
class ScanResult:
    pages_read: int = 0
    links_checked: int = 0
    skipped_robots: int = 0
    too_large: int = 0
    pages_not_read: int = 0
    external_not_checked: int = 0
    stopped_at_limit: bool = False
    stopped: bool = False
    budget_out: bool = False
    paused: bool = False  # time or budget ran out, or the site asked to wait. Nothing is lost: run_scan carries on from `state`.
    wait_seconds: int = 0  # how long to wait before carrying on, when the site is the reason
    issues: list[Issue] = field(default_factory=list)
    state: CrawlState | None = field(default=None, repr=False, compare=False)


_COUNTERS = ("pages_read", "links_checked", "skipped_robots", "too_large")


@dataclass
class CrawlState:
    """What a crawl knows, so it can stop at any moment and carry on later in another process. JSON there and back.

    On a big site this is what fills memory, so a target checked with no issue keeps no list of pages: it can't appear in the
    results. It's known by being in seen_pages without being in target_url or reports. A target not yet checked, or with an
    issue, keeps its list, because a broken link lists every page containing it.
    """

    queue: deque[str] = field(default_factory=deque)
    seen_pages: set[str] = field(default_factory=set)  # page keys queued or read
    read_pages: set[str] = field(default_factory=set)
    target_url: dict[str, str] = field(default_factory=dict)  # page key -> address as first seen, until it's checked
    contains: dict[str, dict[str, None]] = field(default_factory=dict)  # page key -> the pages containing that link, in order
    external: dict[str, None] = field(default_factory=dict)  # page keys of links to other websites, not checked yet
    reports: dict[str, list[Issue]] = field(default_factory=dict)  # page key -> what its one check found, if anything
    result: ScanResult = field(default_factory=ScanResult)
    robots_tries: int = 0  # later chunks in a row that found robots.txt failing
    last_request_at: float = 0.0  # seconds since 1970. A new fetcher knows nothing of the last one's requests.
    gap_seconds: float = 0.0  # the longest gap the site asked for, which a new fetcher only learns after asking again
    variants: dict[str, int] = field(default_factory=dict)  # path key -> query-string variants queued (F66)
    start_tries: int = 0  # passing failures of the start page so far (F67)
    variants_skipped: int = 0

    def __post_init__(self):
        self.result.state = self

    def begin(self, start: str) -> None:
        key = page_key(start)
        self.queue.append(start)
        self.seen_pages.add(key)
        self.target_url[key] = start

    def settle(self, key: str, issues: list[Issue]) -> None:
        """A target has had its one check."""
        if issues:
            self.reports[key] = issues
        else:
            self.contains.pop(key, None)
            self.target_url.pop(key, None)

    def note_link(self, key: str, url: str, page: str) -> None:
        if key in self.seen_pages and key not in self.target_url and key not in self.reports:
            return  # checked, and nothing wrong with it
        self.target_url.setdefault(key, url)
        self.contains.setdefault(key, {})[page] = None

    def so_far(self) -> ScanResult:
        """The results as they stand: at the end of a crawl, or whenever it stops."""
        out = self.result
        out.pages_not_read = len(self.queue)
        out.external_not_checked = len(self.external)
        out.issues = []
        for key, issues in self.reports.items():
            for issue in issues:
                issue.pages = list(self.contains.get(key, {}))
                out.issues.append(issue)
        return out

    def to_json(self) -> dict:
        def without_pages(issue: Issue) -> dict:  # they're in `contains`
            return {name: value for name, value in asdict(issue).items() if name != "pages"}

        return {
            "queue": list(self.queue),
            "seen_pages": sorted(self.seen_pages),  # in order, because a sorted list of addresses compresses far better
            "read_pages": sorted(self.read_pages),
            "target_url": self.target_url,
            "contains": {key: list(pages) for key, pages in self.contains.items()},
            "external": list(self.external),
            "reports": {key: [without_pages(issue) for issue in issues] for key, issues in self.reports.items()},
            "counters": {name: getattr(self.result, name) for name in _COUNTERS},
            "robots_tries": self.robots_tries,
            "last_request_at": self.last_request_at,
            "gap_seconds": self.gap_seconds,
            "variants": self.variants,
            "start_tries": self.start_tries,
            "variants_skipped": self.variants_skipped,
        }

    @classmethod
    def from_json(cls, data: dict) -> CrawlState:
        return cls(
            queue=deque(data["queue"]),
            seen_pages=set(data["seen_pages"]),
            read_pages=set(data["read_pages"]),
            target_url=dict(data["target_url"]),
            contains={key: dict.fromkeys(pages) for key, pages in data["contains"].items()},
            external=dict.fromkeys(data["external"]),
            reports={key: [Issue(**issue) for issue in issues] for key, issues in data["reports"].items()},
            result=ScanResult(**data["counters"]),
            robots_tries=data["robots_tries"],
            last_request_at=data["last_request_at"],
            gap_seconds=data["gap_seconds"],
            variants=dict(data.get("variants") or {}),  # states saved before F66 have none
            start_tries=int(data.get("start_tries") or 0),
            variants_skipped=int(data.get("variants_skipped") or 0),
        )

    def room_for(self, key: str) -> bool:
        """A new address to queue. One path with endless query strings (a calendar, filters) stops at QUERY_VARIANTS_PER_PATH."""
        if "?" not in key:
            return True
        path = key.split("?", 1)[0]
        if self.variants.get(path, 0) >= QUERY_VARIANTS_PER_PATH:
            self.variants_skipped += 1
            return False
        self.variants[path] = self.variants.get(path, 0) + 1
        return True


def extract_links(body: bytes, page_url: str, charset: str | None = None) -> list[str]:
    """Normal <a href> links only, as full addresses.

    The page is decoded first, the same way as for reading its text. Left to itself the parser takes UTF-8 for Latin-1 when
    the page doesn't declare it, and a link to /café or /قهوة becomes an address that doesn't exist.
    """
    try:
        source = _decode(body, charset).replace("\x00", "")
        doc = lxml_html.document_fromstring(source.encode("utf-8"), parser=lxml_html.HTMLParser(encoding="utf-8"))
    except (ValueError, TypeError, lxml_html.etree.ParserError):
        return []
    base = page_url
    tag = doc.find(".//base")
    if tag is not None and (tag.get("href") or "").strip():
        try:
            base = urljoin(page_url, tag.get("href").strip())
        except ValueError:  # <base href="http://[bad">: links are read against the page itself
            base = page_url
    found: list[str] = []
    for anchor in doc.iter("a"):
        href = (anchor.get("href") or "").strip()
        if not href or href.lower().startswith(SKIPPED_SCHEMES):
            continue
        try:
            found.append(urljoin(base, href))
        except ValueError:
            continue
    return found


def _status_reason(code: int | None, status: str, error: str | None) -> str:
    if status == "robots":
        return "robots.txt does not allow this check"
    if status == "refused":
        return "Not a public web address, so it was not requested"
    if status == "network_error":
        return f"The request failed: {error}" if error else "The request failed"
    if status == "rate_limited":
        return "The site asked us to slow down"
    if code == 999:
        return "This site refuses automated checks"
    if code in (401, 403) or status == "blocked":
        return "The site blocked the check"
    if code is not None and code >= 500:
        return "Server error"
    if code is not None:
        return f"The site answered {code}"
    return "No clear answer"


def _issues_from(result: FetchResult, target: str, slow_seconds: float) -> list[Issue]:
    """What one answer means. Most answers mean nothing is wrong."""
    code, status = result.http_status, result.status
    if status == "left_scope":
        return [Issue(REDIRECT, target, code, f"Redirects to another website: {result.final_url}", hops=result.hops, final_url=result.final_url)]
    if status == "too_many_redirects":
        return [Issue(REDIRECT, target, code, f"More than {result.hops - 1} redirects, so the check gave up", hops=result.hops, final_url=result.final_url)]
    if status == "gone":
        return [Issue(BROKEN, target, code, "Page gone" if code == 410 else "Page not found")]
    if status not in ("ok", "not_html", "too_large", "not_modified"):
        return [Issue(UNVERIFIED, target, code, _status_reason(code, status, result.error))]
    issues = []
    if result.hops > LONG_CHAIN_HOPS:
        issues.append(Issue(REDIRECT, target, code, f"{result.hops} redirects before the final page", hops=result.hops, final_url=result.final_url))
    if result.request_seconds > slow_seconds:
        issues.append(Issue(SLOW, target, code, f"Took {result.request_seconds:.1f} s to answer", seconds=round(result.request_seconds, 2)))
    return issues


def run_scan(
    start_url: str,
    site_host: str,
    fetcher: PoliteFetcher,
    *,
    max_pages: int | None = None,  # None reads the whole site
    check_external: bool = True,
    should_stop: Callable[[], bool] = lambda: False,
    budget_allows: Callable[[], bool] = lambda: True,
    charge: Callable[[int], None] = lambda n: None,
    on_progress: Callable[[ScanResult, int], None] = lambda result, external_left: None,  # links to other websites left, once their turn has come
    slow_seconds: float = SLOW_SECONDS,
    on_page: Callable[[str, FetchResult], None] = lambda url, result: None,  # every page of the site asked about, with its answer
    state: CrawlState | None = None,  # a crawl to carry on with. It's updated as the crawl goes, and it's on the result too.
    time_up: Callable[[], bool] = lambda: False,  # asked once at least one request is done, so every run gets somewhere
) -> ScanResult:
    def on_site(url: str) -> bool:
        return host_key(url) == site_host

    start = normalize_url(start_url)
    if not start or not on_site(start):
        raise ValueError("The start address is not on this site")

    state = state if state is not None else CrawlState()
    if not state.seen_pages:
        state.begin(start)
    start_key = page_key(start)
    out = state.result
    out.stopped = out.budget_out = out.paused = out.stopped_at_limit = False
    out.wait_seconds = 0
    charged = 0
    asked = False

    def ask(url: str, **options) -> FetchResult:
        nonlocal asked
        if not asked:  # this fetcher hasn't made the last request, so it can't keep the gap after it by itself
            asked = True
            gap = max(fetcher.delay, state.gap_seconds)
            left = min(gap, state.last_request_at + gap - time.time())
            if left > 0:
                time.sleep(left)
        try:
            return fetcher.get(url, **options)
        except (httpx.InvalidURL, ValueError) as exc:  # one unusable address on a page must not end the whole scan
            return FetchResult(url=url, status="network_error", error=f"this address can't be used ({exc})"[:200])

    def settle_charge():
        nonlocal charged
        if fetcher.requests > charged:
            charge(fetcher.requests - charged)
            charged = fetcher.requests
            state.last_request_at = time.time()

    def can_continue() -> bool:
        if should_stop():
            out.stopped = True
            return False
        if not budget_allows():
            out.budget_out = out.paused = True
            return False
        if asked and time_up():
            out.paused = True
            return False
        return True

    def report_pages():
        out.pages_not_read = len(state.queue)
        on_progress(out, 0)

    def must_wait(result: FetchResult, key: str) -> bool:
        """Every page would get the same answer without being asked, in no time. That would use up the whole queue, so it waits instead."""
        if key == start_key and not state.read_pages and result.status in _PASSING and state.start_tries < START_TRIES - 1:
            # One timeout or 5xx on the start page would end the scan as "complete" with one issue (F67): ask again later.
            state.start_tries += 1
            out.wait_seconds = START_RETRY_SECONDS
            return True
        if not result.held_back:
            if state.robots_tries < ROBOTS_TRIES:  # once given up, stay given up: www and non-www can each have their own robots.txt
                state.robots_tries = 0
            return False
        if key == start_key:  # read before anything else, so this is how a site that can't be read gets reported
            return False
        if result.status == "rate_limited":
            out.wait_seconds = min(LONGEST_WAIT_SECONDS, math.ceil(result.retry_after or 1))
            return True
        if state.robots_tries >= ROBOTS_TRIES:
            return False
        state.robots_tries += 1
        out.wait_seconds = ROBOTS_RETRY_SECONDS
        return True

    while state.queue:
        if not can_continue():
            break
        if out.pages_read >= (max_pages if max_pages is not None else SAFETY_PAGES):
            out.stopped_at_limit = True
            break
        url = state.queue.popleft()
        key = page_key(url)
        if key in state.read_pages or not on_site(url):  # checked before every fetch, whatever put it in the queue
            continue
        result = ask(url, stay_on=on_site)
        settle_charge()
        state.gap_seconds = fetcher.longest_gap()  # of this site: a link to another website's Crawl-delay is no reason to wait here
        if must_wait(result, key):
            state.queue.appendleft(url)
            out.paused = True
            break
        if result.status == "robots":
            out.skipped_robots += 1
            state.settle(key, [])  # nothing more will ever be known about it
            on_page(url, result)
            report_pages()
            continue
        out.pages_read += 1
        out.links_checked += 1
        state.settle(key, _issues_from(result, state.target_url.get(key, url), slow_seconds))
        on_page(url, result)
        if result.status == "too_large":
            out.too_large += 1
        if result.status == "ok" and result.body is not None:
            page = normalize_url(result.final_url or url)  # links resolve against where we landed
            landed = page_key(page)
            state.seen_pages.add(landed)
            state.read_pages.add(landed)  # reached by a redirect: a queued link to it needs no second fetch
            if landed != key and landed not in state.reports:
                state.settle(landed, [])
            for link in extract_links(result.body, result.final_url or url, result.charset):
                normal = normalize_url(link)
                if not normal:
                    continue
                link_key = page_key(normal)
                if on_site(normal):
                    if link_key not in state.seen_pages and not state.room_for(link_key):
                        continue  # one more variant of an endless address: neither read nor listed
                    state.note_link(link_key, normal, page)
                    if link_key not in state.seen_pages:
                        state.seen_pages.add(link_key)
                        state.queue.append(normal)
                else:
                    state.external[link_key] = None
                    if check_external:  # otherwise nothing will ever ask which pages contain it
                        state.note_link(link_key, normal, page)
        report_pages()

    if check_external and not out.stopped and not out.paused:
        for link_key in list(state.external):
            if not can_continue():
                break
            target = state.target_url[link_key]
            result = ask(target)  # one status check: its body is never read for links
            settle_charge()
            out.links_checked += 1
            del state.external[link_key]
            state.settle(link_key, _issues_from(result, target, slow_seconds))
            on_progress(out, len(state.external))

    settle_charge()
    return state.so_far()
