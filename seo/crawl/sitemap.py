"""Find a site's pages from its sitemaps. Reports problems and never raises.

`parse_sitemap` is adapted from Saas Project/sitemap_fetcher/fetcher.py, with external
entities switched off because the XML comes from sites we don't control.
"""
from __future__ import annotations

import gzip
import io
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlsplit

from lxml import etree

COMMON_PATHS = ("/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml")
MAX_SITEMAPS = 50  # sitemap files read in one go (each is a polite request). Past this the list says it was cut (F98)
MAX_UNZIPPED_BYTES = 50_000_000  # Google's own limit for one sitemap
MAX_SITEMAP_BYTES = 20_000_000  # one file as sent. A page is held to 2 MB; a sitemap of 50,000 addresses is bigger (F98)


def parse_lastmod(value: str | None) -> datetime | None:
    """A sitemap date, once, in UTC: "2026-11-03", "2026-11-03T10:00:00+01:00", or the "Tue, 03 Feb 2015" some sites send.
    None when it can't be read, so it's never compared as text (F128)."""
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        found = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            found = parsedate_to_datetime(raw)
        except (TypeError, ValueError, IndexError):
            return None
    if found is None:
        return None
    return found.replace(tzinfo=timezone.utc) if found.tzinfo is None else found.astimezone(timezone.utc)


@dataclass
class Entry:
    url: str
    lastmod: str | None = None

    @property
    def lastmod_at(self) -> datetime | None:
        return parse_lastmod(self.lastmod)


@dataclass
class SitemapResult:
    entries: list[Entry] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)  # sitemap files that couldn't be read: unreadable XML, too large, an error answer
    capped: bool = False  # stopped at max_pages
    cut: bool = False  # the list is not the whole sitemap: a file was too large or failed, or there were more files than MAX_SITEMAPS
    too_many_files: bool = False  # cut (also) because there were more sitemap files than max_sitemaps: the same every day
    problems: dict[str, str] = field(default_factory=dict)  # sitemap file -> why it wasn't read
    # What the health test's sitemap checks need (seo/health/sitemaps.py): where the list came from, and each file read.
    from_robots: bool = False  # robots.txt named the sitemaps; otherwise the common addresses were tried
    files: dict[str, dict] = field(default_factory=dict)  # file -> {"kind": index|urlset|error|unknown, "urls": <loc> rows in it, "guess": a common address, "html": a web page, not XML}


def parse_sitemap(xml: bytes) -> dict:
    result: dict = {"type": None, "entries": []}
    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, recover=False)
    try:
        root = etree.fromstring(xml, parser=parser)
    except (etree.XMLSyntaxError, ValueError):
        result["type"] = "error"
        return result

    tag = etree.QName(root.tag).localname
    if tag == "sitemapindex":
        result["type"] = "index"
        children = root.findall("{*}sitemap")
    elif tag == "urlset":
        result["type"] = "urlset"
        children = root.findall("{*}url")
    else:
        result["type"] = "unknown"
        return result
    for child in children:
        loc = child.findtext("{*}loc")
        if loc and loc.strip():
            result["entries"].append({"loc": loc.strip(), "lastmod": child.findtext("{*}lastmod")})
    return result


def _bare_host(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _unzip(body: bytes) -> bytes | None:
    if not body.startswith(b"\x1f\x8b"):
        return body
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as handle:
            data = handle.read(MAX_UNZIPPED_BYTES + 1)
    except OSError:
        return None
    return None if len(data) > MAX_UNZIPPED_BYTES else data


def _looks_like_html(body: bytes | None) -> bool:
    """A common address that answers with a web page (often the home page, or a "not found" page sent with 200) has no sitemap."""
    head = (body or b"")[:1024].lstrip().lower()
    return head.startswith((b"<!doctype html", b"<html")) or (b"<html" in head and b"<urlset" not in head and b"<sitemapindex" not in head)


def discover(fetcher, base_url: str, max_pages: int = 5000, max_sitemaps: int = MAX_SITEMAPS, max_bytes: int = MAX_SITEMAP_BYTES) -> SitemapResult:
    """max_bytes: one file as sent. The health test reads up to Google's own 50 MB, so a file over it can be said to be."""
    result = SitemapResult()
    own_host = _bare_host(base_url)
    listed = list(fetcher.sitemaps_from_robots(base_url))
    result.from_robots = bool(listed)
    candidates = listed or [urljoin(base_url, path) for path in COMMON_PATHS]
    seen_urls: set[str] = set()
    visited: set[str] = set()

    for top in candidates:
        queue = deque([top])
        while queue and not result.capped:
            url = queue.popleft()
            if url in visited:
                continue
            if len(visited) >= max_sitemaps:
                result.cut = True  # said, not dropped without a word
                result.too_many_files = True
                continue
            visited.add(url)
            response = fetcher.get(url, any_type=True, max_bytes=max_bytes)
            guess = url == top and not listed
            if response.status != "ok" or response.body is None:
                if not guess:  # a common path that isn't there is only a guess that missed
                    _problem(result, url, response.status)
                    result.files[url] = {"kind": response.status, "urls": 0, "guess": False, "html": False}
                continue
            body = _unzip(response.body)
            parsed = parse_sitemap(body) if body is not None else {"type": "error", "entries": []}
            result.files[url] = {"kind": parsed["type"] if body is not None else "too_large", "urls": len(parsed["entries"]), "guess": guess,
                                 "html": body is not None and parsed["type"] in ("error", "unknown") and _looks_like_html(body)}
            if parsed["type"] in ("error", "unknown"):
                result.errors.append(url)
                result.problems[url] = "unreadable" if body is not None else "too_large"
                result.cut = True
                continue
            if url == top:
                result.sources.append(top)
            if parsed["type"] == "index":
                queue.extend(e["loc"] for e in parsed["entries"] if _bare_host(e["loc"]) == own_host)
            else:
                _take(parsed, result, seen_urls, own_host, max_pages)
        if result.capped or (result.entries and not listed):
            break  # enough pages, or a common path worked and the others needn't be probed
    return result


def _problem(result: SitemapResult, url: str, status: str) -> None:
    result.errors.append(url)
    result.problems[url] = status
    result.cut = True


def _take(parsed: dict, result: SitemapResult, seen: set[str], own_host: str, max_pages: int) -> None:
    for entry in parsed["entries"]:
        url = entry["loc"]
        if url in seen or _bare_host(url) != own_host:
            continue
        if len(result.entries) >= max_pages:
            result.capped = True
            return
        seen.add(url)
        result.entries.append(Entry(url=url, lastmod=entry.get("lastmod")))
