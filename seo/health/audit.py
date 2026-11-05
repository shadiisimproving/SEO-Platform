"""What a health test looks at, and the score. Plain rules that read the same in any language.

Only structure is judged: nothing here depends on a word list or on text length rules made for one language.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from urllib.parse import urljoin

from seo.crawl.extract import PageFields
from seo.crawl.fetch import FetchResult
from seo.links.checker import BROKEN, LONG_CHAIN_HOPS, REDIRECT, SLOW, ScanResult
from seo.links.urls import normalize_url, page_key

CRIT, WARN, INFO = "crit", "warn", "info"
MAX_PAGES_LISTED = 200
# "Almost no text" takes both of these. Characters alone would be a rule made for alphabets: Japanese says in 100 characters
# what French says in 300. Words count each Chinese or Japanese character, which gives those scripts their due, and the
# character count covers scripts written without spaces, where a whole paragraph can look like one word.
THIN_CHARACTERS = 200
THIN_WORDS = 50

# code: (what it means, how much it can cost out of 100 when every page has it, severity)
CHECKS: dict[str, tuple[str, int, str]] = {
    "broken_pages": ("Pages that answer with an error", 28, CRIT),
    "broken_links": ("Links to pages that don't exist", 18, CRIT),
    "server_errors": ("Pages the server failed to answer", 16, CRIT),
    "noindex": ("Pages hidden from search engines", 8, WARN),
    "canonical_elsewhere": ("Pages that point search engines to another page", 6, WARN),
    "no_title": ("Pages with no title", 8, WARN),
    "duplicate_title": ("Pages sharing the same title", 5, WARN),
    "no_h1": ("Pages with no main heading (H1)", 5, WARN),
    "many_h1": ("Pages with more than one main heading", 2, INFO),
    "no_meta": ("Pages with no meta description", 3, INFO),
    "duplicate_meta": ("Pages sharing the same meta description", 2, INFO),
    "images_no_alt": ("Pages with images missing alt text", 2, INFO),
    "almost_no_text": ("Pages with almost no readable text", 5, WARN),
    "redirect_chains": ("Links that go through more than 2 redirects", 3, INFO),
    "slow_pages": ("Pages slower than 5 seconds", 6, WARN),
}
# Problems with the whole site: a fixed cost, and an alert on their own.
SITE_CHECKS: dict[str, tuple[str, int]] = {
    "start_page_down": ("The start page didn't load", 60),
    "start_page_noindex": ("The start page is hidden from search engines", 40),
    "robots_down": ("The site's robots.txt answers with a server error, so search engines stay away", 60),
    "ssl_expired": ("The security certificate has expired", 40),
    "ssl_expiring": ("The security certificate expires within 14 days", 15),
    "ssl_error": ("The security certificate couldn't be verified", 20),
}
SSL_WARN_DAYS = 14


@dataclass
class Findings:
    pages_seen: int = 0
    by_code: dict[str, list[str]] = field(default_factory=dict)
    site_codes: list[str] = field(default_factory=list)
    titles: dict[str, list[str]] = field(default_factory=dict)
    metas: dict[str, list[str]] = field(default_factory=dict)
    looked_at: set[str] = field(default_factory=set)

    def add(self, code: str, url: str) -> None:
        self.by_code.setdefault(code, []).append(url)

    def to_json(self) -> dict:
        """Saved with the crawl's own state and at the same moment, so a chunk repeated after a kill can't count a page twice."""
        return {"pages_seen": self.pages_seen, "by_code": self.by_code, "site_codes": self.site_codes, "titles": self.titles, "metas": self.metas, "looked_at": sorted(self.looked_at)}

    @classmethod
    def from_json(cls, data: dict) -> Findings:
        return cls(data["pages_seen"], data["by_code"], data["site_codes"], data["titles"], data["metas"], set(data["looked_at"]))

    def first_look(self, url: str) -> bool:
        """Each page counts once, however many links or redirects lead to it."""
        key = page_key(url)
        if key in self.looked_at:
            return False
        self.looked_at.add(key)
        self.pages_seen += 1
        return True


def _points_elsewhere(canonical: str, page: str) -> bool:
    try:
        target = urljoin(page, canonical)
    except ValueError:
        return False
    return bool(normalize_url(target)) and page_key(target) != page_key(page)


def look_at_page(found: Findings, url: str, result: FetchResult, fields: PageFields | None, start_url: str) -> None:
    """Judges one answer. A page the crawl skipped or couldn't judge lowers nothing: robots.txt said no, it blocked us, it isn't a web page."""
    is_start = page_key(url) == page_key(start_url)
    status = result.status
    if status == "robots":
        if is_start and result.error:  # robots.txt itself is failing, which keeps every polite crawler out, search engines included
            found.site_codes.append("robots_down")
        return
    if status in ("network_error", "refused", "too_many_redirects"):  # "refused" is also what an address that no longer resolves gets
        if is_start:
            found.site_codes.append("start_page_down")
        return
    page = result.final_url or url  # a page reached by a redirect is judged at the address it really has
    broken = status == "gone" or (status == "http_error" and (result.http_status or 0) >= 400)
    if broken or status == "server_error":
        if is_start:
            found.site_codes.append("start_page_down")
        if found.first_look(page):
            found.add("broken_pages" if broken else "server_errors", page)
        return
    if fields is None or not found.first_look(page):
        return
    robots = (fields.robots_meta or "").lower()
    if "noindex" in robots or "none" in robots.replace(",", " ").split():
        found.add("noindex", page)
        if is_start:
            found.site_codes.append("start_page_noindex")
    if fields.canonical and _points_elsewhere(fields.canonical, page):
        found.add("canonical_elsewhere", page)
    if not fields.title:
        found.add("no_title", page)
    else:
        found.titles.setdefault(fields.title.casefold(), []).append(page)
    if not fields.meta_description:
        found.add("no_meta", page)
    else:
        found.metas.setdefault(fields.meta_description.casefold(), []).append(page)
    if not fields.h1:
        found.add("no_h1", page)
    elif len(fields.h1) > 1:
        found.add("many_h1", page)
    if fields.extras.get("images_no_alt"):
        found.add("images_no_alt", page)
    if fields.extras.get("characters", len(fields.text)) < THIN_CHARACTERS and fields.word_count < THIN_WORDS:
        found.add("almost_no_text", page)


def add_link_results(found: Findings, scan: ScanResult, on_site) -> None:
    for issue in scan.issues:
        if not on_site(issue.target_url):  # only my own site is judged here
            continue
        if issue.category == BROKEN:
            for page in issue.pages:  # the pages containing the link: finish() keeps each page once, so this counts pages, not links
                found.add("broken_links", page)
        elif issue.category == REDIRECT and (issue.hops or 0) > LONG_CHAIN_HOPS:  # one redirect to another website isn't a chain
            found.add("redirect_chains", issue.target_url)
        elif issue.category == SLOW:
            found.add("slow_pages", issue.target_url)


def finish(found: Findings) -> dict[str, list[str]]:
    """Every code with the distinct pages it affects."""
    for pages_with_title in found.titles.values():
        if len(pages_with_title) > 1:
            for url in pages_with_title:
                found.add("duplicate_title", url)
    for pages_with_meta in found.metas.values():
        if len(pages_with_meta) > 1:
            for url in pages_with_meta:
                found.add("duplicate_meta", url)
    return {code: list(dict.fromkeys(urls)) for code, urls in found.by_code.items()}


def score(issues: dict[str, list[str]], site_codes: list[str], pages_seen: int) -> int:
    """100 means nothing found. A few bad pages cost more than their share, because they're the ones people notice."""
    total = 100.0
    pages = max(1, pages_seen)
    found_something = bool(site_codes)
    for code, urls in issues.items():
        if code in CHECKS and urls:
            found_something = True
            share = min(1.0, len(urls) / pages)
            total -= CHECKS[code][1] * math.sqrt(share)
    for code in dict.fromkeys(site_codes):
        total -= SITE_CHECKS[code][1]
    return max(0, min(99 if found_something else 100, round(total)))
