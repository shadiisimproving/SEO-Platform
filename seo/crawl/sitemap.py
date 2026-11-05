"""Find a site's pages from its sitemaps. Reports problems and never raises.

`parse_sitemap` is adapted from Saas Project/sitemap_fetcher/fetcher.py, with external
entities switched off because the XML comes from sites we don't control.
"""
from __future__ import annotations

import gzip
import io
from collections import deque
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

from lxml import etree

COMMON_PATHS = ("/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml")
MAX_SITEMAPS = 50
MAX_UNZIPPED_BYTES = 50_000_000


@dataclass
class Entry:
    url: str
    lastmod: str | None = None


@dataclass
class SitemapResult:
    entries: list[Entry] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    capped: bool = False


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


def discover(fetcher, base_url: str, max_pages: int = 5000, max_sitemaps: int = MAX_SITEMAPS) -> SitemapResult:
    result = SitemapResult()
    own_host = _bare_host(base_url)
    listed = list(fetcher.sitemaps_from_robots(base_url))
    candidates = listed or [urljoin(base_url, path) for path in COMMON_PATHS]
    seen_urls: set[str] = set()
    visited: set[str] = set()

    for top in candidates:
        queue = deque([top])
        while queue and not result.capped:
            url = queue.popleft()
            if url in visited or len(visited) >= max_sitemaps:
                continue
            visited.add(url)
            response = fetcher.get(url, any_type=True)
            if response.status != "ok" or response.body is None:
                continue
            body = _unzip(response.body)
            parsed = parse_sitemap(body) if body is not None else {"type": "error", "entries": []}
            if parsed["type"] in ("error", "unknown"):
                result.errors.append(url)
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
