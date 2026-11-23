"""The page facts the app already keeps (title, main heading, headings, meta description), read into the findings about a
search: "the query is not in the title or H1" is the exact on-page edit, and it's only said when it's true.

The same test as Page vs page (competitors.pairs._keyword_use): the whole phrase, any case and accents. A page the reader
never read says nothing, never "missing".
"""
from __future__ import annotations

import json

from sqlalchemy import Engine

from seo.competitors import pages
from seo.insights.finding import Finding
from seo.serp import store

QUERY_KINDS = frozenset({"almost", "top3", "low_ctr", "no_click", "query_down", "ctr_drop", "unstable", "slide", "no_page", "compete", "striking", "rank_no_click", "rival_gap"})


def _list(value) -> list:
    return value if isinstance(value, list) else json.loads(value or "[]")


def _spellings(url: str) -> list[str]:
    """The address as Search Console gives it, with and without its last slash, and the reader's own spelling."""
    out = [url, url.rstrip("/") if url.endswith("/") else url + "/"]
    canonical = store.canonical_url(url)
    if canonical:
        out += [canonical, canonical.rstrip("/") if canonical.endswith("/") else canonical + "/"]
    return list(dict.fromkeys(out))


def _facts(engine: Engine, urls: set[str]) -> dict[str, dict]:
    wanted = {url: _spellings(url) for url in urls if url}
    with engine.connect() as conn:
        found = pages.load_many(conn, [s for spellings in wanted.values() for s in spellings])
    out = {}
    for url, spellings in wanted.items():
        page = next((found.get(s) for s in spellings if found.get(s) and found[s].get("content_hash")), None)
        if page:
            out[url] = {"title": page["title"] or "", "h1": _list(page["h1"]), "headings": _list(page["headings"]), "meta": page["meta_description"] or "",
                        "checked": page["last_checked_at"].date().isoformat() if page.get("last_checked_at") else None}
    return out


def use(facts: dict, query: str) -> dict:
    return {
        "title": pages.contains_phrase(facts["title"], query),
        "h1": any(pages.contains_phrase(h, query) for h in facts["h1"]),
        "headings": sum(1 for h in facts["headings"] if pages.contains_phrase(h[1] if isinstance(h, (list, tuple)) else str(h), query)),
        "meta": pages.contains_phrase(facts["meta"], query),
        "checked": facts["checked"],
    }


def add(engine: Engine, findings: list[Finding]) -> None:
    """On each finding about a search and its page: whether the search is in that page's title, H1, headings and meta."""
    picked = [f for f in findings if f.kind in QUERY_KINDS and f.query and (f.page or f.evidence.get("page"))]
    if not picked:
        return
    facts = _facts(engine, {f.page or f.evidence.get("page") for f in picked})
    for f in picked:
        page = facts.get(f.page or f.evidence.get("page"))
        if page:
            f.evidence["on_page"] = use(page, f.query)
