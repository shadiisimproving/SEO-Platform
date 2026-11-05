"""Save crawl results. A new version and events are written only when a page changed."""
from __future__ import annotations

import gzip
import hashlib
import json

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
            return "baseline"

        events = []
        for name, kind in WATCHED.items():
            before = getattr(current, name)
            after = values[name]
            if current.content_hash and before != after:
                events.append(dict(kind=kind, before_value=_text_value(before), after_value=_text_value(after)))
        if current.content_hash and current.content_hash != fields.content_hash:
            events.append(
                dict(
                    kind="content",
                    before_value=f"{current.word_count} words",
                    after_value=f"{fields.word_count} words",
                )
            )

        first_real_read = current.content_hash is None
        if events or first_real_read:
            values["last_changed_at"] = NOW
            _add_version(conn, current.id, fields)
        conn.execute(update(Page).where(Page.id == current.id).values(**values))
        for event in events:
            conn.execute(insert(ChangeEvent).values(page_id=current.id, domain_id=domain_id, **event))
        if first_real_read:
            return "baseline"
        return "changed" if events else "unchanged"
