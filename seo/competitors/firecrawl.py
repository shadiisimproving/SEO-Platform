"""Firecrawl: a paid backup for competitor pages the app's own reader can't see. Never used by itself: a person asks each time.

Two things it does, each only after the screen has shown what it costs and how many credits are left:
- map lists a site's pages (1 credit a call). It's for a site with no sitemap, where the app only finds its home page's links.
  The pages it finds are added, and the daily reader reads them as usual, so they cost nothing more.
- read reads pages (1 credit each) for a site whose pages only show their text with JavaScript, or that blocks the app's reader.
  A page read this way is marked, and the daily reader leaves it alone: it would only see the empty shell again and report a fake
  edit. Reading it again with Firecrawl is how its edits are found.

Written from Firecrawl's v2 documentation and one real credit-usage call (2026-11-09).
"""
from __future__ import annotations

import time

import httpx
from sqlalchemy import Engine, text

from seo.competitors import pages
from seo.competitors.crawl import MAX_DISCOVERED
from seo.core.errors import NotFound, Refused
from seo.crawl import store as crawl_store
from seo.crawl.extract import extract
from seo.crawl.fetch import FetchResult
from seo.links import service as links_service
from seo.serp.store import canonical_url, host_and_domain, on_host, to_ascii_host
from seo.sources import service as sources
from seo.worker import queue
from seo.worker.runner import handler

API = "https://api.firecrawl.dev/v2"
SOURCE = "firecrawl"  # its key in Settings, with the other app keys
TOOL = "Firecrawl"
JOB_KIND = "competitors.firecrawl"
LANE = "collectors"
MOST_PER_RUN = 50  # pages one click can read, so a slip can't empty the month's credits
CHUNK_SECONDS = 40.0
TIMEOUT = 90.0
MAP_CREDITS = 1

# Tests and the local harness replace this to run with no network.
transport: httpx.BaseTransport | None = None


class FirecrawlError(Exception):
    """kind: auth (the key), quota (no credits, or slow down), temporary (try again), page (this page only)."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def _call(method: str, path: str, key: str, **kwargs) -> dict:
    try:
        with httpx.Client(transport=transport, timeout=TIMEOUT, headers={"Authorization": f"Bearer {key}"}) as client:
            reply = client.request(method, f"{API}{path}", **kwargs)
    except httpx.HTTPError as exc:
        raise FirecrawlError("temporary", f"Couldn't reach Firecrawl: {type(exc).__name__}.") from exc
    if reply.status_code in (401, 403):
        raise FirecrawlError("auth", "Firecrawl refused the key. Paste it again in Settings.")
    if reply.status_code == 402:
        raise FirecrawlError("quota", "Firecrawl has no credits left this month.")
    if reply.status_code == 429:
        raise FirecrawlError("quota", "Firecrawl asked to slow down. Try again in a few minutes.")
    if reply.status_code >= 500:
        raise FirecrawlError("temporary", f"Firecrawl answered with an error ({reply.status_code}). Try again later.")
    try:
        body = reply.json()
    except ValueError as exc:
        raise FirecrawlError("temporary", "Firecrawl's answer couldn't be read.") from exc
    if reply.status_code >= 400 or not isinstance(body, dict) or body.get("success") is False:
        detail = body.get("error") if isinstance(body, dict) else None
        raise FirecrawlError("page", f"Firecrawl couldn't do it: {str(detail or reply.status_code)[:200]}")
    return body


def credits(key: str) -> dict:
    """{left, of, resets}. This call costs nothing."""
    data = _call("GET", "/team/credit-usage", key).get("data") or {}
    return {"left": data.get("remainingCredits"), "of": data.get("planCredits"), "resets": data.get("billingPeriodEnd")}


def map_site(key: str, start_url: str) -> list[str]:
    body = _call("POST", "/map", key, json={"url": start_url, "limit": MAX_DISCOVERED, "sitemap": "include", "includeSubdomains": False, "ignoreQueryParameters": True})
    found = []
    for link in body.get("links") or []:
        address = link.get("url") if isinstance(link, dict) else link
        if isinstance(address, str):
            found.append(address)
    return found


def scrape(key: str, url: str) -> tuple[int, str, bytes]:
    """(status the site gave, the address it ended on, its HTML after JavaScript ran)."""
    body = _call("POST", "/scrape", key, json={"url": url, "formats": ["rawHtml"], "onlyMainContent": False})
    data = body.get("data") or {}
    meta = data.get("metadata") or {}
    html = data.get("rawHtml") or data.get("html") or ""
    return int(meta.get("statusCode") or 0), str(meta.get("url") or meta.get("sourceURL") or url), html.encode("utf-8")


# ---- what a competitor needs ------------------------------------------------------------------------

def _competitor(conn, competitor_id: int) -> dict:
    row = conn.execute(text("SELECT id, host, start_url, kind FROM sites WHERE id = :i"), {"i": competitor_id}).mappings().first()
    if row is None or row["kind"] != links_service.COMPETITOR:
        raise NotFound("That competitor doesn't exist.")
    return dict(row)


def _domain_id(conn, host: str) -> int | None:
    return conn.execute(text("SELECT id FROM domains WHERE host = :h"), {"h": host}).scalar()


def counts(conn, host: str) -> dict:
    """Pages the app couldn't read itself, and pages Firecrawl has read."""
    domain_id = _domain_id(conn, host)
    if domain_id is None:
        return {"js_only": 0, "firecrawl": 0}
    row = conn.execute(
        text("SELECT SUM(js_only = 1 AND read_with IS NULL) AS js, SUM(read_with = 'firecrawl') AS fc FROM pages WHERE domain_id = :d"), {"d": domain_id}
    ).mappings().first()
    return {"js_only": int(row["js"] or 0), "firecrawl": int(row["fc"] or 0)}


def _ranking_urls(conn, host: str) -> list[str]:
    ascii_host = to_ascii_host(host)
    rows = conn.execute(text("SELECT DISTINCT r.url FROM serp_results r WHERE r.host = :h OR r.host LIKE :sub LIMIT 500"), {"h": ascii_host, "sub": f"%.{ascii_host}"})
    return [url for url in (canonical_url(row[0]) for row in rows) if url]


def pages_to_read(conn, competitor: dict, blocked: bool) -> tuple[list[str], list[str]]:
    """(pages Firecrawl hasn't read yet, pages it has, oldest copy first). Reading the second kind again is how their edits
    are found, since the daily reader leaves them alone. Pages that rank for my keywords go first, as in the daily reader.
    A site that blocks the app has no list of its own, so it gets its home page, its ranking pages and whatever it listed
    before it blocked. Otherwise only pages that needed JavaScript."""
    host = competitor["host"]
    domain_id = _domain_id(conn, host)
    unread, again = [], []
    if domain_id is not None:
        where = "read_with IS NULL" if blocked else "js_only = 1 AND read_with IS NULL"
        unread = [row[0] for row in conn.execute(text(f"SELECT url FROM pages WHERE domain_id = :d AND {where} ORDER BY id"), {"d": domain_id})]
        again = [row[0] for row in conn.execute(text("SELECT url FROM pages WHERE domain_id = :d AND read_with = 'firecrawl' ORDER BY last_checked_at, id"), {"d": domain_id})]
    ranking = [url for url in _ranking_urls(conn, host) if on_host(host_and_domain(url)[0], host)]
    done = set(again)
    if blocked:
        start = canonical_url(competitor["start_url"]) or competitor["start_url"]
        first = [url for url in dict.fromkeys([start, *ranking, *unread]) if url not in done]
    else:
        need = set(unread)
        first = list(dict.fromkeys([*(url for url in ranking if url in need), *unread]))
    ranking_set = set(ranking)
    again = [url for url in again if url in ranking_set] + [url for url in again if url not in ranking_set]
    return first, again


def _has_job(conn, competitor_id: int) -> bool:
    return bool(conn.execute(
        text("SELECT 1 FROM jobs WHERE kind = :k AND (active_key = :one OR active_key LIKE :parts) LIMIT 1"),
        {"k": JOB_KIND, "one": f"firecrawl:{competitor_id}", "parts": f"firecrawl:{competitor_id}:%"},
    ).first())


def _crawl_row(conn, competitor_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM competitor_crawls WHERE competitor_id = :c"), {"c": competitor_id}).mappings().first()
    return dict(row) if row else {}


def offer(engine: Engine, competitor_id: int) -> dict:
    """What Firecrawl could do for this competitor, what it would cost, and what's left. Asks Firecrawl for the credits, which is free."""
    with engine.connect() as conn:
        competitor = _competitor(conn, competitor_id)
        crawl = _crawl_row(conn, competitor_id)
        blocked = crawl.get("status") == "blocked"
        first, again = pages_to_read(conn, competitor, blocked)
        found = counts(conn, competitor["host"])
    key = sources.app_key(engine, SOURCE)
    out = {
        "connected": bool(key), "blocked": blocked, "list_source": crawl.get("list_source"), "most_per_run": MOST_PER_RUN,
        "read": {"pages": len(first), "credits": min(len(first), MOST_PER_RUN)} if first else None,
        "reread": {"pages": len(again), "credits": min(len(again), MOST_PER_RUN)} if again else None,
        "map": {"credits": MAP_CREDITS} if crawl.get("list_source") in ("links", "feed") and not blocked else None,
        "firecrawl_pages": found["firecrawl"], "credits": None, "error": None,
    }
    if key:
        try:
            out["credits"] = credits(key)
            sources.note_app_key(engine, SOURCE, None)
        except FirecrawlError as exc:
            out["error"] = str(exc)
            if exc.kind == "auth":
                sources.note_app_key(engine, SOURCE, str(exc))
    return out


def start(engine: Engine, competitor_id: int, action: str, how_many=None) -> dict:
    if action not in ("map", "read", "reread"):
        raise Refused("Choose List pages, Read pages or Check for edits.")
    if not sources.app_key(engine, SOURCE):
        raise Refused("Connect Firecrawl in Settings first.")
    with engine.connect() as conn:
        competitor = _competitor(conn, competitor_id)
        crawl = _crawl_row(conn, competitor_id)
        # A run whose job is gone (its worker died, F61) is over, whatever the row still says.
        if crawl.get("fc_status") in ("queued", "running") and _has_job(conn, competitor_id):
            raise Refused("Firecrawl is already working on this site.")
        blocked = crawl.get("status") == "blocked"
        first, again = pages_to_read(conn, competitor, blocked)
        todo = first if action == "read" else again if action == "reread" else []
    if action != "map":
        try:
            wanted = int(how_many) if how_many is not None else MOST_PER_RUN
        except (TypeError, ValueError):
            raise Refused("Say how many pages to read.") from None
        if wanted < 1:
            raise Refused("Read at least one page.")
        todo = todo[: min(wanted, MOST_PER_RUN)]
        if not todo:
            raise Refused("There's no page here that needs Firecrawl.")
    with engine.begin() as conn:
        since = str(conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar())
        conn.execute(
            text(
                "INSERT INTO competitor_crawls (competitor_id, status, fc_status, fc_action, fc_asked, fc_done, fc_message) VALUES (:c, 'ok', 'queued', :a, :n, 0, NULL) "
                "ON DUPLICATE KEY UPDATE fc_status = 'queued', fc_action = :a, fc_asked = :n, fc_done = 0, fc_message = NULL"
            ),
            {"c": competitor_id, "a": action, "n": len(todo) if action != "map" else MAP_CREDITS},
        )
    queue.enqueue(
        engine, LANE, JOB_KIND, payload={"competitor_id": competitor_id, "action": action, "todo": todo, "done": 0, "good": 0, "empty": 0, "since": since},
        dedupe_key=f"firecrawl:{competitor_id}", max_attempts=1,
    )
    return {"queued": True, "action": action, "pages": len(todo)}


# ---- the job ------------------------------------------------------------------------------------------

def _set(engine: Engine, competitor_id: int, **values) -> None:
    clause = ", ".join(f"{name} = :{name}" for name in values)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE competitor_crawls SET {clause} WHERE competitor_id = :c"), {**values, "c": competitor_id})


def _finish(engine: Engine, competitor_id: int, status: str, message: str, done: int) -> None:
    _set(engine, competitor_id, fc_status=status, fc_message=message[:500], fc_done=done)
    with engine.begin() as conn:
        conn.execute(text("UPDATE competitor_crawls SET fc_finished_at = UTC_TIMESTAMP(3) WHERE competitor_id = :c"), {"c": competitor_id})


def _run_map(engine: Engine, competitor: dict, key: str) -> str:
    host = competitor["host"]
    found = [url for url in (canonical_url(address) for address in map_site(key, competitor["start_url"])) if url and on_host(host_and_domain(url)[0], host)]
    domain_id = crawl_store.get_or_create_domain(engine, host)
    added = 0
    with engine.begin() as conn:
        for url in dict.fromkeys(found):
            added += conn.execute(text("INSERT IGNORE INTO pages (domain_id, url, url_hash) VALUES (:d, :u, :h)"), {"d": domain_id, "u": url, "h": pages.url_hash(url)}).rowcount
    if added:
        from seo.competitors import suggest  # here, not at the top: suggest imports a lot, and nothing of it is needed otherwise

        suggest.queue_crawl(engine, competitor["id"])
        return f"Firecrawl listed {len(found)} pages, {added} the app didn't know. The daily reader reads them, up to 300 a day. 1 credit used."
    return f"Firecrawl listed {len(found)} pages, and the app already knew them all. 1 credit used."


def _save(engine: Engine, host: str, url: str, status: int, final_url: str, body: bytes) -> str:
    domain_id = crawl_store.get_or_create_domain(engine, host)
    if not on_host(host_and_domain(final_url)[0], host):
        return crawl_store.save_fetch(engine, domain_id, url, FetchResult(url=url, status="left_scope", http_status=status), None)
    if status in (404, 410):
        return crawl_store.save_fetch(engine, domain_id, url, FetchResult(url=url, status="gone", http_status=status), None)
    if not body or status >= 400 or status == 0:
        return "failed"
    with engine.begin() as conn:
        # The first Firecrawl copy of a page the app only saw as an empty shell is a fresh start, not an edit.
        conn.execute(text("UPDATE pages SET content_hash = NULL WHERE url_hash = :h AND read_with IS NULL"), {"h": pages.url_hash(url)})
    fields = extract(body, final_url or url, charset="utf-8")
    outcome = crawl_store.save_fetch(engine, domain_id, url, FetchResult(url=url, status="ok", http_status=status, body=body, charset="utf-8", final_url=final_url), fields)
    with engine.begin() as conn:
        conn.execute(text("UPDATE pages SET read_with = 'firecrawl' WHERE url_hash = :h"), {"h": pages.url_hash(url)})
    return "empty" if fields.js_only else outcome


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    """Any error ends the run as failed with a sentence, so the site is never left on "running" (F61)."""
    payload = dict(job.payload or {})
    try:
        _run(payload, engine)
    except Exception as exc:
        _finish(engine, payload.get("competitor_id"), "failed", f"Firecrawl's run stopped: {type(exc).__name__}. Pages read before it are saved. Try again.", payload.get("done", 0))
        raise


def _already_read(engine: Engine, url: str, since) -> bool:
    """Read with Firecrawl since this run began: a worker that died and came back skips it, so it isn't paid twice (F63)."""
    if not since:
        return False
    with engine.connect() as conn:
        return bool(conn.execute(
            text("SELECT 1 FROM pages WHERE url_hash = :h AND read_with = 'firecrawl' AND last_checked_at >= :s"), {"h": pages.url_hash(url), "s": since}
        ).first())


def _run(payload: dict, engine: Engine) -> None:
    competitor_id = payload.get("competitor_id")
    with engine.connect() as conn:
        try:
            competitor = _competitor(conn, competitor_id)
        except NotFound:
            return
    key = sources.app_key(engine, SOURCE)
    if not key:
        _finish(engine, competitor_id, "failed", "Firecrawl isn't connected any more. Connect it in Settings.", payload.get("done", 0))
        return
    _set(engine, competitor_id, fc_status="running")
    if payload.get("action") == "map":
        try:
            _finish(engine, competitor_id, "ok", _run_map(engine, competitor, key), MAP_CREDITS)
        except FirecrawlError as exc:
            _finish(engine, competitor_id, "failed", str(exc), 0)
        return

    todo, started = list(payload.get("todo") or []), time.monotonic()
    while todo:
        if payload["done"] and time.monotonic() - started >= CHUNK_SECONDS:
            payload["todo"] = todo
            queue.enqueue(engine, LANE, JOB_KIND, payload=payload, dedupe_key=f"firecrawl:{competitor_id}:{payload['done']}", max_attempts=1)
            _set(engine, competitor_id, fc_done=payload["done"])
            return
        url = todo.pop(0)
        if _already_read(engine, url, payload.get("since")):
            payload["done"] += 1  # it was read, and paid, before the worker stopped
            payload["good"] += 1
            _set(engine, competitor_id, fc_done=payload["done"])
            continue
        try:
            status, final_url, body = scrape(key, url)
        except FirecrawlError as exc:
            if exc.kind == "page":
                payload["done"] += 1
                continue
            left = f" {len(todo) + 1} pages weren't read." if todo else ""
            _finish(engine, competitor_id, "failed", f"{exc}{left}", payload["done"])
            return
        payload["done"] += 1
        outcome = _save(engine, competitor["host"], url, status, final_url, body)
        payload["good"] += outcome in ("baseline", "changed", "unchanged")
        payload["empty"] += outcome == "empty"
        _set(engine, competitor_id, fc_done=payload["done"])

    done, good, empty = payload["done"], payload["good"], payload["empty"]
    message = f"Firecrawl read {good} of {done} pages. {done} credits used."
    if empty:
        message += f" {empty} still showed no text, even with JavaScript."
    _finish(engine, competitor_id, "ok", message, done)
