"""Save crawl results. A new version and events are written only when a page changed."""
from __future__ import annotations

import difflib
import gzip
import hashlib
import json
import re

from sqlalchemy import Engine, func, insert, select, text, update

from seo.core.models import ChangeEvent, Domain, Page, PageVersion
from seo.crawl import noise
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


def _last_version(conn, page_id: int) -> tuple[str | None, bool]:
    """The last saved text, and whether it was saved one block a line (older versions are one line)."""
    row = conn.execute(text("SELECT text_gz, fields FROM page_versions WHERE page_id = :p ORDER BY id DESC LIMIT 1"), {"p": page_id}).first()
    if not row or not row[0]:
        return None, False
    saved = row[1] if isinstance(row[1], dict) else (json.loads(row[1]) if row[1] else {})
    return gzip.decompress(row[0]).decode("utf-8", "replace"), bool(saved and saved.get("text_format") == noise.TEXT_FORMAT)


def _old_format(conn, page_id: int) -> bool:
    saved = conn.execute(
        text("SELECT JSON_VALUE(fields, '$.text_format') FROM page_versions WHERE page_id = :p ORDER BY id DESC LIMIT 1"), {"p": page_id}
    ).first()
    return saved is not None and str(saved[0] or "") != str(noise.TEXT_FORMAT)


def _last_text(conn, page_id: int) -> str | None:
    return _last_version(conn, page_id)[0]


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def _text_value(value) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def get_or_create_domain(engine: Engine, host: str) -> int:
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO domains (host) VALUES (:h)"), {"h": host.lower()})
        return conn.execute(select(Domain.id).where(Domain.host == host.lower())).scalar_one()


def validators(engine: Engine, url: str) -> tuple[str | None, str | None]:
    with engine.connect() as conn:
        row = conn.execute(select(Page.etag, Page.last_modified).where(Page.url_hash == _url_hash(url))).first()
    return (row.etag, row.last_modified) if row else (None, None)


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
        "blocks": noise.page_keys(fields.text, fields.headings, fields.h1),
        "final_url": None,
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


def _changes(conn, current, values: dict, fields: PageFields, url: str, domain_id: int) -> tuple[list[dict], bool]:
    """The events a new read makes against the stored page, and whether its text must be saved as the new starting point.

    Never an event whose before and after say the same (a "?" saved by a latin1 table included), nor a text or heading
    change that is only the site's template (seo.crawl.noise), the order of blocks, or numbers. A list of posts
    (category, tag, /page/2) changes whenever anything is published, so its text and headings changes are kept hidden.
    """
    if not current.content_hash:
        return [], False
    skip = noise.skip_set(conn, domain_id)
    listing = noise.is_listing(url)
    events = []
    for name, kind in WATCHED.items():
        before, after = getattr(current, name), values[name]
        if noise.same_value(before, after):
            continue
        if kind == "headings" and noise.steady_headings(_json_list(before), skip) == noise.steady_headings(after, skip):
            continue
        event = dict(kind=kind, before_value=_text_value(before), after_value=_text_value(after))
        if kind == "headings" and listing:
            event["hidden"], event["hidden_reason"] = True, noise.LISTING
        events.append(event)
    if current.content_hash == fields.content_hash:
        # A text saved before blocks were kept is saved again, once, block by block, so its next edit can be compared.
        return events, _old_format(conn, current.id)
    rebase = False
    if current.content_hash != fields.content_hash:
        before_text, blocks_kept = _last_version(conn, current.id)
        if before_text is not None and not blocks_kept:
            # Saved before blocks were kept: the template can't be told apart, so this read is the new starting point.
            return [e for e in events if e["kind"] != "headings"], True
        touched = None
        if before_text is not None:
            if noise.steady_blocks(before_text, skip) == noise.steady_blocks(fields.text, skip):
                touched = 0  # only the template, the order of blocks, or numbers moved
            else:
                touched = changed_words(noise.steady_text(before_text, skip), noise.steady_text(fields.text, skip))
        if touched != 0:  # 0: only dates, times, counters or the template moved, which nobody edited
            event = dict(kind="content", before_value=f"{current.word_count} words", after_value=f"{fields.word_count} words", changed_words=touched)
            if listing:
                event["hidden"], event["hidden_reason"] = True, noise.LISTING
            events.append(event)
    return events, rebase


def _json_list(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return []
    return value


def would_record(engine: Engine, domain_id: int, url: str, fields: PageFields) -> bool:
    """Whether this read would record a visible edit: then the page is read a second time before anything is saved."""
    with engine.connect() as conn:
        current = conn.execute(select(Page.__table__).where(Page.url_hash == _url_hash(url))).first()
        if current is None or not current.content_hash:
            return False
        events, _rebase = _changes(conn, current, _page_values(fields, FetchResult(url=url, status="ok")), fields, url, domain_id)
    return any(not e.get("hidden") for e in events)


def _agrees(first: dict, second: dict, earlier: PageFields, fields: PageFields, skip: set[str]) -> bool:
    if first["kind"] != second["kind"]:
        return False
    if first["kind"] == "content":
        return noise.steady_blocks(earlier.text, skip) == noise.steady_blocks(fields.text, skip)
    return noise.same_value(first.get("after_value"), second.get("after_value"))


def save_moved(engine: Engine, domain_id: int, url: str, final_url: str, result: FetchResult) -> str:
    """The address redirects to another page of the site. That page's text is never saved under this address: one
    "redirect" event says where it went, once, and only for a page that was read before (SEO review W6)."""
    url_hash = _url_hash(url)
    values = {"last_status": "moved", "http_status": result.http_status, "final_url": final_url, "last_checked_at": NOW}
    with engine.begin() as conn:
        current = conn.execute(select(Page.__table__).where(Page.url_hash == url_hash).with_for_update()).first()
        if not current:
            conn.execute(insert(Page).values(domain_id=domain_id, url=url, url_hash=url_hash, **values))
            return "moved"
        conn.execute(update(Page).where(Page.id == current.id).values(**values))
        if current.content_hash and (current.final_url or "") != final_url:
            conn.execute(insert(ChangeEvent).values(page_id=current.id, domain_id=domain_id, kind="redirect", before_value=url, after_value=final_url))
    return "moved"


def save_fetch(
    engine: Engine, domain_id: int, url: str, result: FetchResult, fields: PageFields | None, earlier: PageFields | None = None, unsettled: bool = False
) -> str:
    """Returns baseline, changed, unchanged, or the fetch status when no page was read.

    `earlier`: a first read of the same page a few seconds before this one. An event is then recorded only when both
    reads show it, so text that changes on every request is never an edit. `unsettled`: the two reads' text differed, so
    the page has blocks that change on every request and weren't all known yet; its text and headings aren't compared
    this time (the blocks just learned count from the next read)."""
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
            return "baseline"

        events, rebase = _changes(conn, current, values, fields, url, domain_id)
        if earlier is not None and events:
            first, _ = _changes(conn, current, _page_values(earlier, result), earlier, url, domain_id)
            skip = noise.skip_set(conn, domain_id)
            events = [e for e in events if any(_agrees(f, e, earlier, fields, skip) for f in first)]
        if unsettled:
            events, rebase = [e for e in events if e["kind"] not in ("content", "headings")], False

        first_real_read = current.content_hash is None
        if any(not e.get("hidden") for e in events):
            # Only an edit the app saw. The first reading is no edit: counting it made "Updated, 12 months" read 100% (SEO review #11).
            values["last_changed_at"] = NOW
        if events or first_real_read or rebase:
            _add_version(conn, current.id, fields)
        conn.execute(update(Page).where(Page.id == current.id).values(**values))
        for event in events:
            conn.execute(insert(ChangeEvent).values(page_id=current.id, domain_id=domain_id, **event))
        if first_real_read:
            return "baseline"
        return "changed" if any(not e.get("hidden") for e in events) else "unchanged"
