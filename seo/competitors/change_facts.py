"""Everything known about the page behind a competitor's change, so a row in "Who is moving" can show it all.

One query for all the pages on screen (never one per row), and one for how often each page has changed since it was found.
The facts are the page as last read, which is what the owner can open and check today.
"""
from __future__ import annotations

import json
from datetime import date, datetime

from sqlalchemy import text

_JSON = ("h1", "headings", "schema_types", "extras")
_EXTRAS = ("images", "images_no_alt", "tables", "lists", "videos", "forms", "hreflang", "published", "modified", "characters", "questions")
MOST_HEADINGS = 80
MOST_QUESTIONS = 30


def _iso(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, date):
        return value.isoformat()
    return value


def _loaded(value):
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", "replace")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _headings(value) -> list[list[str]]:
    out = []
    for item in value or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            out.append([str(item[0]), str(item[1])])
        elif isinstance(item, str):
            out.append(["", item])
    return out[:MOST_HEADINGS]


def page_facts(conn, page_ids) -> dict[int, dict]:
    ids = sorted({int(i) for i in page_ids if i is not None})
    if not ids:
        return {}
    marks = ",".join(str(i) for i in ids)
    rows = conn.execute(text(
        "SELECT id, title, meta_description, canonical, robots_meta, lang, h1, headings, word_count, schema_types, internal_links, external_links, "
        "http_status, last_status, read_with, js_only, extras, sitemap_lastmod, first_archived, first_seen_at, last_checked_at, last_changed_at "
        f"FROM pages WHERE id IN ({marks})"
    )).mappings().all()
    edits = {r[0]: int(r[1]) for r in conn.execute(text(f"SELECT page_id, COUNT(*) FROM change_events WHERE page_id IN ({marks}) AND kind <> 'new_page' GROUP BY page_id"))}
    out: dict[int, dict] = {}
    for row in rows:
        page = dict(row)
        for name in _JSON:
            page[name] = _loaded(page[name])
        extras = page.pop("extras") if isinstance(page.get("extras"), dict) else {}
        page.pop("extras", None)
        h1 = page["h1"] if isinstance(page["h1"], list) else ([page["h1"]] if isinstance(page["h1"], str) and page["h1"] else [])
        headings = _headings(page["headings"])
        out[row["id"]] = {
            "title": page["title"], "description": page["meta_description"], "canonical": page["canonical"], "robots": page["robots_meta"], "lang": page["lang"],
            "h1": [str(x) for x in h1 if x], "headings": headings, "headings_total": len(page["headings"] or []) if isinstance(page["headings"], list) else len(headings),
            "words": page["word_count"], "schema": [str(x) for x in (page["schema_types"] or []) if x] if isinstance(page["schema_types"], list) else [],
            "internal_links": page["internal_links"], "external_links": page["external_links"],
            "status": page["http_status"], "state": page["last_status"], "read_with": page["read_with"], "js_only": bool(page["js_only"]),
            "sitemap_date": _iso(page["sitemap_lastmod"]), "first_archived": _iso(page["first_archived"]),
            "first_seen": _iso(page["first_seen_at"]), "last_read": _iso(page["last_checked_at"]), "last_changed": _iso(page["last_changed_at"]),
            "edits": edits.get(row["id"], 0),
            **{name: extras.get(name) for name in _EXTRAS if name != "questions" and extras.get(name) not in (None, "", [])},
            "questions": [str(q) for q in (extras.get("questions") or []) if q][:MOST_QUESTIONS],
        }
    return out


def attach(conn, events: list[dict]) -> list[dict]:
    """Adds `page` to each page change that has a page_id. Ranking moves are left as they are."""
    facts = page_facts(conn, [e.get("page_id") for e in events])
    for event in events:
        page_id = event.pop("page_id", None)
        if page_id in facts:
            event["page"] = facts[page_id]
    return events
