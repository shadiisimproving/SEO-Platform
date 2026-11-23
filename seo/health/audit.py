"""What a health test looks at, and the score. Plain rules that read the same in any language.

Only structure is judged: nothing here depends on a word list or on text length rules made for one language.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from urllib.parse import unquote, urljoin, urlsplit

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
    "broken_pages": ("Error pages", 28, CRIT),
    "broken_links": ("Broken links", 18, CRIT),
    "server_errors": ("Server errors", 16, CRIT),
    "noindex": ("Hidden from search engines", 8, WARN),
    "canonical_elsewhere": ("Canonical points elsewhere", 6, WARN),
    "no_title": ("No title", 8, WARN),
    "duplicate_title": ("Duplicate titles", 5, WARN),
    "no_h1": ("No main heading (H1)", 5, WARN),
    "many_h1": ("Several main headings", 2, INFO),
    "no_meta": ("No meta description", 3, INFO),
    "duplicate_meta": ("Duplicate meta descriptions", 2, INFO),
    "images_no_alt": ("Images missing alt text", 2, INFO),
    "almost_no_text": ("Almost no text", 5, WARN),
    "redirect_chains": ("More than 2 redirects", 3, INFO),
    "slow_pages": ("Slower than 5 seconds", 6, WARN),
    # Listed so a page hidden by a wrong Disallow line shows somewhere, but never scored: blocking /admin is often meant.
    "robots_blocked": ("Blocked by robots.txt", 0, INFO),
}
# Problems with the whole site: a fixed cost, and an alert on their own.
SITE_CHECKS: dict[str, tuple[str, int]] = {
    "start_page_down": ("Start page didn't load", 60),
    "start_page_noindex": ("Start page hidden from search engines", 40),
    "robots_down": ("robots.txt gives a server error, so search engines stay away", 60),
    "ssl_expired": ("Certificate expired", 40),
    "ssl_expiring": ("Certificate expires within 14 days", 15),
    "ssl_error": ("Certificate couldn't be verified", 20),
}
SSL_WARN_DAYS = 14

# The sitemap checks (seo/health/sitemaps.py): code -> (what it means, cost, severity). A problem with the sitemap file itself
# costs a fixed amount; one with its listed pages costs like a page check, by the share of listed pages it touches. All of
# them together never cost more than SITEMAP_MAX_COST, so a bad sitemap can't swamp the score of a site that is fine.
SITEMAP_FILE_CHECKS: dict[str, tuple[str, int, str]] = {
    "sitemap_missing": ("No sitemap found", 8, CRIT),
    "sitemap_unreachable": ("Sitemap can't be reached", 8, CRIT),
    "sitemap_invalid": ("Sitemap isn't valid XML", 8, CRIT),
    "sitemap_too_big": ("Sitemap over 50,000 pages or 50 MB", 5, CRIT),
    "sitemap_not_in_robots": ("Sitemap not named in robots.txt", 0, INFO),
}
SITEMAP_PAGE_CHECKS: dict[str, tuple[str, int, str]] = {
    "listed_broken": ("Listed pages that give an error", 8, CRIT),
    "listed_redirect": ("Listed pages that redirect", 3, WARN),
    "listed_noindex": ("Listed pages hidden from search engines", 4, WARN),
    "listed_blocked": ("Listed pages blocked by robots.txt", 3, WARN),
    "listed_canonical": ("Listed pages whose canonical points elsewhere", 3, WARN),
    "sitemap_missing_pages": ("Important pages missing from the sitemap", 4, WARN),
    "lastmod_future": ("Dates in the future", 0, INFO),
    "lastmod_same": ("Every page has the same date", 0, INFO),
}
SITEMAP_CHECKS = {**SITEMAP_FILE_CHECKS, **SITEMAP_PAGE_CHECKS}
SITEMAP_MAX_COST = 15


@dataclass
class Findings:
    pages_seen: int = 0
    by_code: dict[str, list[str]] = field(default_factory=dict)
    site_codes: list[str] = field(default_factory=list)
    titles: dict[str, list[str]] = field(default_factory=dict)
    metas: dict[str, list[str]] = field(default_factory=dict)
    looked_at: set[str] = field(default_factory=set)
    # Internal links: how many of the site's own pages link to each page, counted once per linking page. page key -> count
    links_in: dict[str, int] = field(default_factory=dict)
    link_names: dict[str, str] = field(default_factory=dict)  # page key -> its address, as first seen
    linked_from: set[str] = field(default_factory=set)  # pages whose links are already counted
    # What each address of my site answered in this test, for the sitemap checks: page key -> [kind, detail]. Kinds: ok
    # (indexable), noindex, canonical (detail: where to), redirect (detail: where to), broken (detail: the HTTP code), unknown.
    statuses: dict[str, list] = field(default_factory=dict)  # keyed by address_key

    def add(self, code: str, url: str) -> None:
        self.by_code.setdefault(code, []).append(url)

    def to_json(self) -> dict:
        """Saved with the crawl's own state and at the same moment, so a chunk repeated after a kill can't count a page twice."""
        return {"pages_seen": self.pages_seen, "by_code": self.by_code, "site_codes": self.site_codes, "titles": self.titles, "metas": self.metas, "looked_at": sorted(self.looked_at),
                "links_in": self.links_in, "link_names": self.link_names, "linked_from": sorted(self.linked_from), "statuses": self.statuses}

    @classmethod
    def from_json(cls, data: dict) -> Findings:
        return cls(data["pages_seen"], data["by_code"], data["site_codes"], data["titles"], data["metas"], set(data["looked_at"]),
                   dict(data.get("links_in") or {}), dict(data.get("link_names") or {}), set(data.get("linked_from") or []),  # saved before links were counted: none
                   dict(data.get("statuses") or {}))

    def first_look(self, url: str) -> bool:
        """Each page counts once, however many links or redirects lead to it."""
        key = page_key(url)
        if key in self.looked_at:
            return False
        self.looked_at.add(key)
        self.pages_seen += 1
        return True


def count_links_in(found: Findings, page: str, links: list[str], on_site) -> None:
    """One page read: each other page of the site it links to gets one more page linking to it. A page counts once."""
    source = page_key(page)
    if source in found.linked_from:
        return
    found.linked_from.add(source)
    found.link_names.setdefault(source, page)
    targets: dict[str, str] = {}
    for link in links:
        normal = normalize_url(link)
        if not normal or not on_site(normal):
            continue
        key = page_key(normal)
        if key != source:
            targets.setdefault(key, normal)
    for key, normal in targets.items():
        found.links_in[key] = found.links_in.get(key, 0) + 1
        found.link_names.setdefault(key, normal)


FEW_LINKS_IN = 2  # an important page with this many pages or fewer linking to it


def internal_links(found: Findings, sitemap_urls: list[str], start_url: str, cut: bool = False) -> dict:
    """What the Health screen's internal links report needs, from one test: links in per page, and the orphans.

    An orphan is a page the sitemap lists that no page the test read links to. Only pages that answered are counted: a
    broken page with links in is the broken-links check's business.
    """
    start = page_key(start_url)
    read = {key for key in found.linked_from}
    pages = {found.link_names.get(key, key): found.links_in.get(key, 0) for key in read if key != start}
    orphans, listed = [], 0
    for url in dict.fromkeys(sitemap_urls):
        normal = normalize_url(url)
        if not normal:
            continue
        listed += 1
        key = page_key(normal)
        if key != start and not found.links_in.get(key):
            orphans.append(found.link_names.get(key, normal))
    return {"pages": pages, "orphans": orphans, "sitemap_pages": listed, "sitemap_cut": bool(cut)}


def _points_elsewhere(canonical: str, page: str) -> bool:
    try:
        target = urljoin(page, canonical)
    except ValueError:
        return False
    return bool(normalize_url(target)) and page_key(target) != page_key(page)


def robots_words(*values: str | None) -> set[str]:
    """noindex, nofollow and none from robots and googlebot meta tags and X-Robots-Tag headers, as Google reads them:
    "googlebot: noindex" counts, "bingbot: noindex" and "max-snippet: 50" don't, and none means noindex and nofollow."""
    words: set[str] = set()
    for value in values:
        for part in (value or "").lower().split(","):
            part = part.strip()
            if ":" in part:
                left, _, rest = part.partition(":")
                if left.strip() != "googlebot":  # another crawler's rule, or a directive with a value
                    continue
                part = rest.strip()
            words.update(part.split())
    if "none" in words:
        words.update(("noindex", "nofollow"))
    return words


def look_at_page(found: Findings, url: str, result: FetchResult, fields: PageFields | None, start_url: str) -> None:
    """Judges one answer. A page the crawl skipped or couldn't judge lowers nothing: robots.txt said no, it blocked us, it isn't a web page."""
    is_start = page_key(url) == page_key(start_url)
    status = result.status
    if status == "robots":
        if is_start and result.error:  # robots.txt itself is failing, which keeps every polite crawler out, search engines included
            found.site_codes.append("robots_down")
        elif not result.error and not result.held_back:  # robots.txt says no to this page: listed, lowers nothing
            found.add("robots_blocked", url)
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
    if "noindex" in robots_words(fields.robots_meta, fields.extras.get("googlebot"), result.x_robots_tag):
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


def page_state(result: FetchResult, fields: PageFields | None, page: str) -> list:
    """What one answer says about a page, for the sitemap checks. `page` is where the answer came from (after any redirect)."""
    status = result.status
    if status == "gone" or (status == "http_error" and (result.http_status or 0) >= 400 and result.http_status not in (401, 403)):
        return ["broken", result.http_status or 404]
    if status == "server_error":
        return ["broken", result.http_status or 500]
    if status == "ok" and fields is not None:
        if "noindex" in robots_words(fields.robots_meta, fields.extras.get("googlebot"), result.x_robots_tag):
            return ["noindex", None]
        if fields.canonical and _points_elsewhere(fields.canonical, page):
            return ["canonical", urljoin(page, fields.canonical)]
        return ["ok", None]
    return ["unknown", None]  # blocked, not a web page, too large, could not connect: nothing to say about it


def address_key(url: str) -> str:
    """One address exactly, for the sitemap checks: scheme and www count (http:// moving to https:// is a redirect), and
    /café and /caf%C3%A9 are the same one. "" if unusable."""
    normal = normalize_url(url)
    if not normal:
        return ""
    parts = urlsplit(normal)
    return f"{parts.scheme}://{parts.netloc}{unquote(parts.path)}{'?' + parts.query if parts.query else ''}"


def note_status(found: Findings, url: str, result: FetchResult, fields: PageFields | None) -> None:
    """Keeps what an address answered, so the sitemap checks need not ask again. Kept by the exact address (scheme and www
    included, unlike page_key), because a sitemap that lists http:// pages which move to https:// lists redirects. A redirect
    is kept on the address asked for, with where it went; the page it landed on keeps its own answer."""
    if result.status == "robots":
        return  # our crawler was told no: that says nothing about what Google sees
    asked = address_key(url)
    landed = result.final_url or url
    if not asked:
        return
    if result.status == "left_scope" or (result.hops and address_key(landed) != asked):
        found.statuses[asked] = ["redirect", landed]
        if result.status != "left_scope" and address_key(landed):
            found.statuses.setdefault(address_key(landed), page_state(result, fields, landed))
        return
    found.statuses[asked] = page_state(result, fields, landed)


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


def sitemap_cost(sitemap: dict | None) -> float:
    """What the sitemap checks cost: {"counts": {code: n}, "listed": pages listed, "important": important pages looked at}."""
    if not sitemap:
        return 0.0
    counts, cost = sitemap.get("counts") or {}, 0.0
    for code, n in counts.items():
        if not n or code not in SITEMAP_CHECKS or not SITEMAP_CHECKS[code][1]:
            continue
        if code in SITEMAP_FILE_CHECKS:
            cost += SITEMAP_FILE_CHECKS[code][1]
        else:
            out_of = sitemap.get("important") if code == "sitemap_missing_pages" else sitemap.get("listed")
            cost += SITEMAP_PAGE_CHECKS[code][1] * math.sqrt(min(1.0, n / max(1, out_of or 0)))
    return min(float(SITEMAP_MAX_COST), cost)


def score(issues: dict[str, list[str]], site_codes: list[str], pages_seen: int, sitemap: dict | None = None) -> int:
    """100 means nothing found. A few bad pages cost more than their share, because they're the ones people notice."""
    total = 100.0
    cost = sitemap_cost(sitemap)
    total -= cost
    pages = max(1, pages_seen)
    found_something = bool(site_codes) or cost > 0
    for code, urls in issues.items():
        if code in CHECKS and CHECKS[code][1] and urls:  # a check that weighs nothing is only listed
            found_something = True
            share = min(1.0, len(urls) / pages)
            total -= CHECKS[code][1] * math.sqrt(share)
    for code in dict.fromkeys(site_codes):
        total -= SITE_CHECKS[code][1]
    return max(0, min(99 if found_something else 100, round(total)))
