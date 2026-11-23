"""Save crawl results. A new version and events are written only when a page changed."""
from __future__ import annotations

import difflib
import gzip
import hashlib
import json
import re

from sqlalchemy import Engine, func, insert, select, text, update

from seo.core.models import ChangeEvent, Domain, Page, PageVersion
from seo.crawl.extract import PageFields
from seo.crawl.fetch import FetchResult

NOW = func.utc_timestamp(3)
LIMITS = {"title": 1000, "meta_description": 2000, "robots_meta": 255, "lang": 20}

# Field on the page -> kind of change event. Link counts are deliberately not here:
# they include navigation, so one menu edit would flag every page.
WATCHED = {
    "title": "title",
    "meta_description": "meta",
    "h1": "h1",
    "headings": "headings",
    "canonical": "canonical",
    "robots_meta": "robots",
    "schema_types": "schema",
}


# What changes on a page without anyone editing it: dates, times, "3 hours ago", comment and view counters. A text
# change that is only these is not an edit (2026-11-10: reading more often must not mean more fake edits).
_MONTHS = (
    "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|"
    "january|february|march|april|may|june|july|august|september|october|november|december|"
    "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|janv|févr|avr|juil|déc"
)
_UNITS = "secondes?|minutes?|min|heures?|h|jours?|semaines?|mois|ans?|seconds?|hours?|days?|weeks?|months?|years?"
_COUNTERS = "commentaires?|comments?|vues|views|partages|shares|likes|j'aime|réponses|replies|avis|reviews|lectures|reads"
_VOLATILE = re.compile(
    rf"\b\d{{1,4}}[./-]\d{{1,2}}[./-]\d{{1,4}}\b"  # 10/11/2026, 2026-11-10
    rf"|\b\d{{1,2}}(?:er)?\s+(?:{_MONTHS})\.?(?:\s+\d{{4}})?\b"  # 10 novembre 2026, 1er mai
    rf"|\b(?:{_MONTHS})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?,?(?:\s+\d{{4}})?\b"  # November 10, 2026
    rf"|\b\d{{1,2}}\s*[:h]\s*\d{{2}}(?::\d{{2}})?\b"  # 14:30, 14h30
    rf"|\bil y a\s+\d+\s*(?:{_UNITS})\b|\b\d+\s*(?:{_UNITS})\s+ago\b"  # il y a 3 heures, 3 hours ago
    rf"|\b\d[\d\s.,]*\s*(?:{_COUNTERS})\b",  # 12 commentaires, 1.2k views
    re.IGNORECASE,
)
SMALL_EDIT_WORDS = 15  # a text edit touching fewer words than this is shown as a small edit
_DIFF_MOST_WORDS = 30_000  # past this, counting changed words would take too long; the edit still counts


def steady_words(value: str) -> list[str]:
    """A page's words with the parts that change by themselves taken out."""
    return _VOLATILE.sub(" ", value or "").split()


def changed_words(before: str, after: str) -> int | None:
    """About how many words an edit touched: 0 when only dates, times or counters moved."""
    was, now = steady_words(before), steady_words(after)
    if was == now:
        return 0
    if len(was) + len(now) > _DIFF_MOST_WORDS:
        return None
    matcher = difflib.SequenceMatcher(None, was, now, autojunk=False)
    return sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in matcher.get_opcodes() if tag != "equal")


def _last_text(conn, page_id: int) -> str | None:
    blob = conn.execute(text("SELECT text_gz FROM page_versions WHERE page_id = :p ORDER BY id DESC LIMIT 1"), {"p": page_id}).scalar()
    return gzip.decompress(blob).decode("utf-8", "replace") if blob else None


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def _text_value(value) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def get_or_create_domain(engine: Engine, host: str) -> int:
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO domains (host) VALUES (:h)"), {"h": host.lower()})
        return conn.execute(select(Domain.id).where(Domain.host == host.lower())).scalar_one()


def validators(engine: Engine, url: str) -> tuple[str | None, str | None]:
    """What lets the site answer "not modified". None for a page whose links were never saved: it is fetched in full once,
    so the site map's "By links" view fills in without waiting for the page to change."""
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT p.etag, p.last_modified, l.page_id AS has_links FROM pages p LEFT JOIN page_links l ON l.page_id = p.id WHERE p.url_hash = :h"),
            {"h": _url_hash(url)},
        ).first()
    return (row.etag, row.last_modified) if row and row.has_links is not None else (None, None)


def _save_links(conn, page_id: int, domain_id: int, links: list[str]) -> None:
    conn.execute(
        text(
            "INSERT INTO page_links (page_id, domain_id, links, read_at) VALUES (:p, :d, :l, UTC_TIMESTAMP(3)) "
            "ON DUPLICATE KEY UPDATE links = VALUES(links), read_at = VALUES(read_at)"
        ),
        {"p": page_id, "d": domain_id, "l": json.dumps(links, ensure_ascii=False, separators=(",", ":"))},
    )


def _page_values(fields: PageFields, result: FetchResult) -> dict:
    values = {
        "last_status": result.status,
        "http_status": result.http_status,
        "etag": (result.etag or "")[:255] or None,
        "last_modified": (result.last_modified or "")[:64] or None,
        "title": fields.title,
        "meta_description": fields.meta_description,
        "canonical": fields.canonical,
        "robots_meta": fields.robots_meta,
        "lang": fields.lang,
        "h1": fields.h1,
        "headings": fields.headings,
        "word_count": fields.word_count,
        "schema_types": fields.schema_types,
        "internal_links": fields.internal_links,
        "external_links": fields.external_links,
        "content_hash": fields.content_hash,
        "js_only": fields.js_only,
        "extras": fields.extras,
        "last_checked_at": NOW,
    }
    for name, limit in LIMITS.items():
        values[name] = (values[name] or "")[:limit]
    return values


def _add_version(conn, page_id: int, fields: PageFields) -> None:
    conn.execute(
        insert(PageVersion).values(
            page_id=page_id, fields=fields.as_dict(), text_gz=gzip.compress(fields.text.encode("utf-8"), 6)
        )
    )


def save_fetch(engine: Engine, domain_id: int, url: str, result: FetchResult, fields: PageFields | None) -> str:
    """Returns baseline, changed, unchanged, or the fetch status when no page was read."""
    url_hash = _url_hash(url)
    with engine.begin() as conn:
        current = conn.execute(select(Page.__table__).where(Page.url_hash == url_hash).with_for_update()).first()

        if result.status != "ok" or fields is None:
            values = {"last_status": result.status, "http_status": result.http_status, "last_checked_at": NOW}
            if current:
                conn.execute(update(Page).where(Page.id == current.id).values(**values))
            else:
                conn.execute(insert(Page).values(domain_id=domain_id, url=url, url_hash=url_hash, **values))
            return result.status

        values = _page_values(fields, result)
        if not current:
            page_id = conn.execute(
                insert(Page).values(domain_id=domain_id, url=url, url_hash=url_hash, **values)
            ).inserted_primary_key[0]
            _add_version(conn, page_id, fields)
            _save_links(conn, page_id, domain_id, fields.links)
            return "baseline"

        events = []
        for name, kind in WATCHED.items():
            before = getattr(current, name)
            after = values[name]
            if current.content_hash and before != after:
                events.append(dict(kind=kind, before_value=_text_value(before), after_value=_text_value(after)))
        if current.content_hash and current.content_hash != fields.content_hash:
            before_text = _last_text(conn, current.id)
            touched = changed_words(before_text, fields.text) if before_text is not None else None
            if touched != 0:  # 0: only dates, times or counters moved, which nobody edited
                events.append(
                    dict(
                        kind="content",
                        before_value=f"{current.word_count} words",
                        after_value=f"{fields.word_count} words",
                        changed_words=touched,
                    )
                )

        first_real_read = current.content_hash is None
        if events or first_real_read:
            values["last_changed_at"] = NOW
            _add_version(conn, current.id, fields)
        conn.execute(update(Page).where(Page.id == current.id).values(**values))
        _save_links(conn, current.id, current.domain_id, fields.links)
        for event in events:
            conn.execute(insert(ChangeEvent).values(page_id=current.id, domain_id=domain_id, **event))
        if first_real_read:
            return "baseline"
        return "changed" if events else "unchanged"
