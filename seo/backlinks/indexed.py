"""Is my page indexed: Search Console's URL Inspection, asked about each of my pages that a live backlink points to.

A link to a page Google hasn't indexed can't help that page rank until it is indexed. Google only inspects pages of a
property the key can read, so this works on my own pages, never on the pages that link to me. It needs the site's
Search Console connection (Sources). Without one nothing is asked and the screen says how to turn it on.

Written from Google's documentation and tested on a fake: no real key has called it yet. Google allows 2,000 inspections a
day per property. This asks for at most MAX_PER_DAY, an indexed page once a month, a page that isn't indexed once a week.
"""
from __future__ import annotations

import hashlib
import time
from datetime import datetime
from urllib.parse import urljoin, urlsplit

from sqlalchemy import Engine, text

from seo.collectors import common, http
from seo.collectors.http import SourceError
from seo.core.errors import NotFound
from seo.sources import credentials
from seo.worker import queue
from seo.worker.runner import Retry, RunAgain, handler

JOB_KIND = "backlinks.inspect"
LANE = "collectors"  # Google's API, like the other Search Console calls, not the polite fetcher
API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
MAX_PER_DAY = 200
INDEXED_EVERY_DAYS = 30
NOT_INDEXED_EVERY_DAYS = 7
ASKED_AGAIN_HOURS = 20  # Check now on a link asks again about its page, unless Google was asked today
CHUNK_SECONDS = 40.0
GONE = (404, 410)  # Reclaim covers those: Google drops a page that's gone


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def target_page(row, start_url: str) -> str | None:
    """The address Google would index: where the last check saw my page end up, else the address the link points to."""
    if row.get("target_http") in GONE:
        return None
    for address in (row.get("target_final_url"), row.get("seen_href"), row.get("target_url")):
        if address:
            full = urljoin(start_url, address.strip())
            return full if urlsplit(full).scheme in ("http", "https") else None
    return None


def in_property(url: str, prop: str) -> bool:
    """URL Inspection refuses a page outside the property: a domain property covers every subdomain, a prefix property only its prefix."""
    if prop.startswith("sc-domain:"):
        domain, host = prop[len("sc-domain:"):].lower(), (urlsplit(url).hostname or "").lower()
        return host == domain or host.endswith("." + domain)
    return url.startswith(prop)


def _source(engine: Engine, site_id: int):
    src = common.source_row(engine, site_id, "gsc")
    if src is None or src["not_used"] or not src["connection_id"] or not src["property"]:
        return None
    return src


def is_on(engine: Engine, site_id: int) -> bool:
    return _source(engine, site_id) is not None


def _pages(conn, site_id: int, start_url: str) -> list[str]:
    rows = conn.execute(text(
        "SELECT target_url, target_final_url, seen_href, target_http FROM backlinks WHERE site_id = :s AND status = 'live' ORDER BY id"
    ), {"s": site_id}).mappings().all()
    seen: dict[str, None] = {}
    for row in rows:
        page = target_page(dict(row), start_url)
        if page:
            seen.setdefault(page)
    return list(seen)


def due_pages(engine: Engine, site_id: int, start_url: str, first: str | None = None) -> list[str]:
    """Pages never asked about, then the ones whose answer is old. `first` goes ahead of them when it wasn't asked about today."""
    with engine.connect() as conn:
        pages = _pages(conn, site_id, start_url)
        known = {r["url_hash"]: r for r in conn.execute(text(
            "SELECT url_hash, verdict, error, inspected_at, inspected_at > UTC_TIMESTAMP(3) - INTERVAL :soon HOUR AS today, "
            "inspected_at > UTC_TIMESTAMP(3) - INTERVAL CASE WHEN verdict = 'PASS' THEN :ok ELSE :not_ok END DAY AS fresh "
            "FROM gsc_inspections WHERE site_id = :s"
        ), {"s": site_id, "soon": ASKED_AGAIN_HOURS, "ok": INDEXED_EVERY_DAYS, "not_ok": NOT_INDEXED_EVERY_DAYS}).mappings()}
    due = [p for p in pages if url_hash(p) not in known or not known[url_hash(p)]["fresh"]]
    due.sort(key=lambda p: (url_hash(p) in known, known.get(url_hash(p), {}).get("inspected_at") or datetime.min))
    if first and first in pages and not (known.get(url_hash(first)) or {}).get("today"):
        due = [first] + [p for p in due if p != first]
    return due


def _asked_today(engine: Engine, site_id: int, start_url: str = "") -> int:
    """This check's own inspections in the last day. The Health screen's check of every page (seo/health/indexing.py) has
    its own allowance, so it never eats this one's 200."""
    with engine.connect() as conn:
        mine = {url_hash(page) for page in _pages(conn, site_id, start_url)}
        today = [r[0] for r in conn.execute(text(
            "SELECT url_hash FROM gsc_inspections WHERE site_id = :s AND inspected_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY"
        ), {"s": site_id})]
    return sum(1 for h in today if h in mine)


def _when(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def inspect(token: str, prop: str, url: str) -> dict:
    reply = http.request(
        "POST", API, "Search Console URL Inspection",
        headers={"Authorization": f"Bearer {token}"},
        json={"inspectionUrl": url, "siteUrl": prop, "languageCode": "en-US"},
    )
    found = ((reply.json() or {}).get("inspectionResult") or {}).get("indexStatusResult") or {}
    return {
        "verdict": (found.get("verdict") or "")[:12] or None, "coverage": (found.get("coverageState") or "")[:200] or None,
        "indexing": (found.get("indexingState") or "")[:40] or None, "robots": (found.get("robotsTxtState") or "")[:40] or None,
        "fetch_state": (found.get("pageFetchState") or "")[:40] or None, "google_canonical": found.get("googleCanonical"),
        "user_canonical": found.get("userCanonical"), "last_crawl": _when(found.get("lastCrawlTime")), "error": None,
    }


def _save(engine: Engine, site_id: int, url: str, found: dict) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage, indexing, robots, fetch_state, google_canonical, user_canonical, last_crawl, error, inspected_at) "
            "VALUES (:s, :h, :u, :verdict, :coverage, :indexing, :robots, :fetch_state, :google_canonical, :user_canonical, :last_crawl, :error, UTC_TIMESTAMP(3)) "
            "ON DUPLICATE KEY UPDATE verdict = :verdict, coverage = :coverage, indexing = :indexing, robots = :robots, fetch_state = :fetch_state, "
            "google_canonical = :google_canonical, user_canonical = :user_canonical, last_crawl = :last_crawl, error = :error, inspected_at = UTC_TIMESTAMP(3)"
        ), {"s": site_id, "h": url_hash(url), "u": url, **found})


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    site_id = (job.payload or {}).get("site_id")
    src = _source(engine, site_id)
    if src is None:
        return  # Search Console was switched off since this was queued
    started = time.monotonic()
    left = MAX_PER_DAY - _asked_today(engine, site_id, src["start_url"])
    pages = due_pages(engine, site_id, src["start_url"], (job.payload or {}).get("first"))[:max(left, 0)]
    if not pages:
        return
    try:
        token = credentials.access_token(engine, src["connection_id"])
    except credentials.CredentialsFailed:
        return  # the Sources screen shows what's wrong with the key; the daily Search Console run reports it
    except ConnectionError as exc:
        raise Retry(str(exc), 900, patient=True) from exc
    for url in pages:
        if time.monotonic() - started >= CHUNK_SECONDS:
            raise RunAgain(3)
        if not in_property(url, src["property"]):
            _save(engine, site_id, url, {**_EMPTY, "error": "Not in the site's Search Console property, so not inspected."})
            continue
        try:
            found = inspect(token, src["property"], url)
        except SourceError as exc:
            if exc.kind == "quota":
                return  # Google's limit for today: the next run carries on with what's still due
            if exc.kind == "temporary":
                raise Retry(str(exc), 900, patient=True) from exc
            _save(engine, site_id, url, {**_EMPTY, "error": str(exc)[:500]})
            return  # the key can't inspect this property; asking about the next page would be refused the same way
        except (ValueError, KeyError, TypeError, AttributeError):  # one answer that can't be read must not stop the rest
            _save(engine, site_id, url, {**_EMPTY, "error": "Google's answer for this page couldn't be read."})
            continue
        _save(engine, site_id, url, found)


_EMPTY = {"verdict": None, "coverage": None, "indexing": None, "robots": None, "fetch_state": None, "google_canonical": None, "user_canonical": None, "last_crawl": None}


def enqueue(engine: Engine, site_id: int, first: str | None = None) -> bool:
    if not is_on(engine, site_id):
        return False
    key = f"inspect:{site_id}" + (f":{url_hash(first)[:16]}" if first else "")
    return queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": site_id, "first": first}, dedupe_key=key, max_attempts=3) is not None


def enqueue_for_backlink(engine: Engine, backlink_id: int) -> bool:
    """Check now on a link also asks Google about its page, when Search Console is connected for that site."""
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT b.site_id, b.target_url, b.target_final_url, b.seen_href, b.target_http, s.start_url FROM backlinks b JOIN sites s ON s.id = b.site_id WHERE b.id = :i"
        ), {"i": backlink_id}).mappings().first()
    if row is None:
        raise NotFound("That backlink doesn't exist.")
    page = target_page(dict(row), row["start_url"])
    return bool(page) and enqueue(engine, row["site_id"], page)


def enqueue_due(engine: Engine) -> list[int]:
    with engine.connect() as conn:
        sites = conn.execute(text("SELECT id, start_url FROM sites WHERE kind = 'own' ORDER BY id")).mappings().all()
    return [s["id"] for s in sites if is_on(engine, s["id"]) and due_pages(engine, s["id"], s["start_url"]) and enqueue(engine, s["id"])]


# ---- what the screen shows ------------------------------------------------------------------------------

def _same_page(a: str | None, b: str | None) -> bool:
    clean = lambda u: (u or "").split("#")[0].rstrip("/").lower()  # noqa: E731
    return clean(a) == clean(b)


def as_shown(row) -> dict:
    """indexed, not_indexed, unknown (Google has never seen the page), or error. Google's own words go with it."""
    if row["error"]:
        state = "error"
    elif row["verdict"] == "PASS":
        state = "indexed"
    elif (row["coverage"] or "").lower().startswith("url is unknown"):
        state = "unknown"
    else:
        state = "not_indexed"
    other = row["google_canonical"] if row["google_canonical"] and not _same_page(row["google_canonical"], row["url"]) else None
    return {
        "state": state, "coverage": row["coverage"], "error": row["error"], "url": row["url"], "google_canonical": other,
        "crawled": row["last_crawl"].strftime("%Y-%m-%d") if row["last_crawl"] else None,
        "checked": row["inspected_at"].strftime("%Y-%m-%d") if row["inspected_at"] else None,
    }


def for_site(conn, site_id: int) -> dict[str, dict]:
    """Every answer kept for a site, by the page's address hash."""
    rows = conn.execute(text("SELECT * FROM gsc_inspections WHERE site_id = :s"), {"s": site_id}).mappings().all()
    return {r["url_hash"]: as_shown(r) for r in rows}
