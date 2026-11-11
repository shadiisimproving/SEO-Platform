"""Is every page of my site on Google: Search Console's URL Inspection for each page the app has read, not only the pages a
backlink points to (those stay with seo/backlinks/indexed.py, unchanged).

Google allows 2,000 inspections a day and 600 a minute per property. The backlinks check keeps its own 200 a day; this one
asks at most PER_DAY more, and paces itself well under the minute limit, so a big site is covered over a few days. The
most important pages go first (most Search Console clicks, then impressions), then the newest, then the rest; an answer
is asked again after 30 days for an indexed page and 7 days for one that isn't, as for backlinks.

Results show on the Health screen: how many pages are on Google, and the ones that aren't with the reason Google gives.
It needs the site's Search Console connection, like the backlinks check. Nothing is asked without one.
"""
from __future__ import annotations

import math
import time
from datetime import datetime
from urllib.parse import unquote, urlsplit

from sqlalchemy import Engine, text

from seo.backlinks import indexed
from seo.collectors.http import SourceError
from seo.core.errors import NotOwnSite, UnknownSite
from seo.sources import credentials
from seo.worker import queue
from seo.worker.runner import Retry, RunAgain, handler

JOB_KIND = "health.indexing"
LANE = indexed.LANE  # Google's API, as the other Search Console calls
PER_DAY = 1200  # of Google's 2,000 a day per property. With the backlinks check's 200, 1,400 at most.
PER_MINUTE = 300  # Google allows 600
CHUNK_SECONDS = 40.0
GOOD_STATUSES = ("ok", "not_modified")
SHOWN = 10


def path_of(url: str) -> str:
    """A page's address without host, scheme, query or trailing slash, so Search Console's and the crawl's spellings match."""
    try:
        path = unquote(urlsplit(url).path or "/")
    except ValueError:
        return url
    return path.rstrip("/") or "/"


def importance(engine: Engine, site_id: int) -> dict[str, tuple[int, int]]:
    """{path: (clicks, impressions)} over the last 28 days, read through the Search Console screens' own function.

    Empty when Search Console has nothing for the site, or can't be read: then pages go newest first."""
    try:
        from seo.metrics import search  # noqa: PLC0415 - the metrics package is large, and only this needs it

        scope, _ = search.scope_for(engine, {"site_id": str(site_id), "range": "28d"})
        rows = search.breakdown(scope, "page", limit=100_000)["rows"]
    except Exception:  # noqa: BLE001 - no Search Console numbers is not a reason to stop
        return {}
    found: dict[str, tuple[int, int]] = {}
    for row in rows:
        key = path_of(str(row.get("name") or row.get("key") or ""))
        clicks, shown = found.get(key, (0, 0))
        found[key] = (clicks + int(row.get("clicks") or 0), shown + int(row.get("impressions") or 0))
    return found


def site_pages(conn, site_id: int) -> list[dict]:
    """Every page of my site the app has read and that answered: from the daily read and Firecrawl, both kept in `pages`."""
    site = conn.execute(text("SELECT host, start_url FROM sites WHERE id = :s"), {"s": site_id}).mappings().first()
    if site is None:
        return []
    marks = ",".join(f"'{s}'" for s in GOOD_STATUSES)
    return [dict(r) for r in conn.execute(text(
        f"SELECT p.url, p.first_seen_at, p.sitemap_lastmod FROM pages p JOIN domains d ON d.id = p.domain_id "
        f"WHERE d.host IN (:h, CONCAT('www.', :h)) AND p.last_status IN ({marks}) ORDER BY p.id"
    ), {"h": site["host"]}).mappings().all()]


def due_pages(engine: Engine, site_id: int) -> list[str]:
    """Never asked first (most clicks, then impressions, then newest), then answers that are old, oldest first.
    Pages a live backlink points to are left to the backlinks check."""
    with engine.connect() as conn:
        start_url = conn.execute(text("SELECT start_url FROM sites WHERE id = :s"), {"s": site_id}).scalar()
        pages = site_pages(conn, site_id)
        targets = set(indexed._pages(conn, site_id, start_url or ""))
        known = {r["url_hash"]: r for r in conn.execute(text(
            "SELECT url_hash, inspected_at, inspected_at > UTC_TIMESTAMP(3) - INTERVAL CASE WHEN verdict = 'PASS' THEN :ok ELSE :not_ok END DAY AS fresh "
            "FROM gsc_inspections WHERE site_id = :s"
        ), {"s": site_id, "ok": indexed.INDEXED_EVERY_DAYS, "not_ok": indexed.NOT_INDEXED_EVERY_DAYS}).mappings()}
    weight = importance(engine, site_id) if pages else {}
    never, old = [], []
    for page in pages:
        url = page["url"]
        if url in targets:
            continue
        seen = known.get(indexed.url_hash(url))
        if seen is None:
            clicks, shown = weight.get(path_of(url), (0, 0))
            newest = page["sitemap_lastmod"] or (page["first_seen_at"].date() if page["first_seen_at"] else None)
            never.append((-clicks, -shown, -(newest.toordinal() if newest else 0), url))
        elif not seen["fresh"]:
            old.append((seen["inspected_at"] or datetime.min, url))
    never.sort()
    old.sort()
    return [row[-1] for row in never] + [url for _, url in old]


def _asked_today(engine: Engine, site_id: int) -> int:
    """This check's inspections in the last day: everything but the backlinks check's own pages."""
    with engine.connect() as conn:
        start_url = conn.execute(text("SELECT start_url FROM sites WHERE id = :s"), {"s": site_id}).scalar()
        targets = {indexed.url_hash(u) for u in indexed._pages(conn, site_id, start_url or "")}
        today = [r[0] for r in conn.execute(text(
            "SELECT url_hash FROM gsc_inspections WHERE site_id = :s AND inspected_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY"
        ), {"s": site_id})]
    return sum(1 for h in today if h not in targets)


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    site_id = (job.payload or {}).get("site_id")
    src = indexed._source(engine, site_id)
    if src is None:
        return  # Search Console was switched off since this was queued
    started = time.monotonic()
    pages = due_pages(engine, site_id)[:max(0, PER_DAY - _asked_today(engine, site_id))]
    if not pages:
        return
    try:
        token = credentials.access_token(engine, src["connection_id"])
    except credentials.CredentialsFailed:
        return  # the Sources screen says what's wrong with the key
    except ConnectionError as exc:
        raise Retry(str(exc), 900, patient=True) from exc
    gap = 60.0 / PER_MINUTE
    last = 0.0
    for url in pages:
        if time.monotonic() - started >= CHUNK_SECONDS:
            raise RunAgain(3)
        try:
            if not indexed.in_property(url, src["property"]):
                indexed._save(engine, site_id, url, {**indexed._EMPTY, "error": "Not in the site's Search Console property, so not inspected."})
                continue
            wait = gap - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
            last = time.monotonic()
            found = indexed.inspect(token, src["property"], url)
        except SourceError as exc:
            if exc.kind == "quota":
                return  # Google's limit for today: the next run carries on
            if exc.kind == "temporary":
                raise Retry(str(exc), 900, patient=True) from exc
            indexed._save(engine, site_id, url, {**indexed._EMPTY, "error": str(exc)[:500]})
            return  # the key can't inspect this property: the next page would be refused the same way
        except (ValueError, KeyError, TypeError, AttributeError):  # one odd answer must not stop the rest
            indexed._save(engine, site_id, url, {**indexed._EMPTY, "error": "Google's answer for this page couldn't be read."})
            continue
        indexed._save(engine, site_id, url, found)


def enqueue(engine: Engine, site_id: int) -> bool:
    if not indexed.is_on(engine, site_id):
        return False
    return queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": site_id}, dedupe_key=f"indexing:{site_id}", max_attempts=3) is not None


def enqueue_due(engine: Engine) -> list[int]:
    """Once a day (health-due): each of my sites with Search Console connected and pages due."""
    with engine.connect() as conn:
        sites = [r[0] for r in conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id"))]
    return [s for s in sites if indexed.is_on(engine, s) and due_pages(engine, s) and enqueue(engine, s)]


# ---- what the Health screen shows ----------------------------------------------------------------------

def summary(engine: Engine, site_id: int) -> dict:
    """How many of the site's pages are on Google, and the ones that aren't with Google's reason. Pages a backlink points to
    count too: their answers come from the backlinks check."""
    with engine.connect() as conn:
        site = conn.execute(text("SELECT id, kind, start_url FROM sites WHERE id = :s"), {"s": site_id}).mappings().first()
        if site is None:
            raise UnknownSite("That website doesn't exist.")
        if site["kind"] != "own":
            raise NotOwnSite("This only works on your own websites.")
        pages = [p["url"] for p in site_pages(conn, site_id)]
        targets = indexed._pages(conn, site_id, site["start_url"] or "")
        answers = indexed.for_site(conn, site_id)
    every = list(dict.fromkeys(pages + targets))
    shown = [answers[indexed.url_hash(u)] for u in every if indexed.url_hash(u) in answers]
    weight = importance(engine, site_id) if shown else {}
    not_on = [a for a in shown if a["state"] in ("not_indexed", "unknown")]
    not_on.sort(key=lambda a: (-weight.get(path_of(a["url"]), (0, 0))[0], -weight.get(path_of(a["url"]), (0, 0))[1], a["url"]))
    errors = sum(1 for a in shown if a["state"] == "error")
    unchecked = len(every) - len(shown)
    return {
        "on": indexed.is_on(engine, site_id), "pages": len(every), "checked": len(shown) - errors,
        "indexed": sum(1 for a in shown if a["state"] == "indexed"), "not_indexed_count": len(not_on), "errors": errors,
        "not_indexed": [{**a, "clicks": weight.get(path_of(a["url"]), (0, 0))[0]} for a in not_on[:200]],
        "unchecked": unchecked, "per_day": PER_DAY, "days_left": math.ceil(unchecked / PER_DAY) if unchecked else 0,
    }
