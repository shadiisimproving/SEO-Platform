"""What the outside world remembers about a website: the Wayback Machine's first copy of it, how many of its pages
first appeared each year, and the domain's registration and renewal dates from the registry (RDAP).

Free, with no key and no credit, so it runs for any competitor that's followed. It's asked for the moment a
competitor is added, then once a month. Never on page load: the Wayback Machine is slow (15 s or more for a
mid-size site) and often busy, so a busy answer is tried again a few times within the hour, then the next day.

The Wayback Machine times out when asked to filter, so it's asked for every address it holds, one row per address,
and the pages are picked out here: HTML that answered 200. An address with ?something is the same page.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date, datetime
from typing import Callable

import httpx
from sqlalchemy import Engine, text

from seo.backlinks.cleaner import registrable_domain
from seo.crawl.fetch import USER_AGENT
from seo.crawl.guard import is_public_url
from seo.serp.store import to_ascii_host
from seo.uptime import service as uptime
from seo.worker import queue
from seo.worker.runner import Retry, handler

JOB_KIND = "competitors.history"
LANE = "collectors"  # its own lane: page reads in the crawl lane can take every tick of a busy day
CDX_URL = "https://web.archive.org/cdx/search/cdx"
CDX_LIMIT = 5000
CDX_TIMEOUT = 90.0  # a job's lease is 180 s
CDX_MAX_BYTES = 8_000_000
REFRESH_DAYS = 30
RETRY_HOURS = 20  # the next daily run, whatever time the last try was
TRIES = 3
TRY_AGAIN_SECONDS = 15 * 60
QUEUED, RUNNING, OK, FAILED = "queued", "running", "ok", "failed"


class HistoryFailed(Exception):
    """The Wayback Machine didn't give a usable answer this time."""


def read_cdx(host: str) -> list[tuple[str, str, str, str]]:
    """(address key, first capture, type, status) for each address the archive holds on this domain, at most CDX_LIMIT."""
    params = {"url": host, "matchType": "domain", "fl": "urlkey,timestamp,mimetype,statuscode", "collapse": "urlkey", "limit": str(CDX_LIMIT)}
    url = str(httpx.URL(CDX_URL, params=params))
    if not is_allowed(url):
        raise HistoryFailed("refused")
    body = b""
    try:
        with httpx.Client(timeout=CDX_TIMEOUT, follow_redirects=False, trust_env=False, headers={"User-Agent": USER_AGENT}) as client:
            with client.stream("GET", url) as reply:
                if reply.status_code != 200:
                    raise HistoryFailed(f"http_{reply.status_code}")
                for chunk in reply.iter_bytes():
                    body += chunk
                    if len(body) > CDX_MAX_BYTES:
                        raise HistoryFailed("too_large")
    except httpx.TimeoutException as exc:
        raise HistoryFailed("timeout") from exc
    except httpx.HTTPError as exc:
        raise HistoryFailed("network") from exc
    rows = []
    for line in body.decode("utf-8", "replace").splitlines():
        parts = line.split(" ")
        if len(parts) == 4:
            rows.append((parts[0], parts[1], parts[2], parts[3]))
    return rows


# Tests and the local harness replace these to run on a fake internet.
is_allowed: Callable[[str], bool] = is_public_url
cdx_lookup: Callable[[str], list[tuple[str, str, str, str]]] = read_cdx


def _capture_date(stamp: str) -> date | None:
    try:
        return datetime.strptime(stamp[:8], "%Y%m%d").date()
    except ValueError:
        return None


def page_key(url_or_urlkey: str) -> str:
    """One spelling for an address, whether it comes from the archive (com,example)/blog/a?x) or a page we read (https://www.example.com/blog/a)."""
    value = url_or_urlkey.strip().lower()
    if ")/" in value or value.endswith(")"):
        surt_host, _, path = value.partition(")")
        host = ".".join(reversed(surt_host.split(",")))
    else:
        rest = value.split("://", 1)[-1]
        host, slash, path = rest.partition("/")
        path = slash + path
        host = host.split(":", 1)[0]
    host = host.removeprefix("www.")
    path = (path or "/").split("#", 1)[0].split("?", 1)[0].rstrip("/") or "/"
    return f"{host}{path}"


def summarise(rows: list[tuple[str, str, str, str]]) -> dict:
    """First capture of each page, by the archive's own order: the first row of an address is its first capture."""
    first: dict[str, date] = {}
    for urlkey, stamp, mimetype, status in rows:
        if mimetype != "text/html" or not status.startswith("2"):
            continue
        day = _capture_date(stamp)
        if day is None:
            continue
        key = page_key(urlkey)
        if key not in first or day < first[key]:
            first[key] = day
    years = Counter(str(day.year) for day in first.values())
    return {
        "first_capture": min(first.values()) if first else None,
        "archived_pages": len(first),
        "capped": len(rows) >= CDX_LIMIT,
        "pages_by_year": dict(sorted(years.items())),
        "first_by_page": first,
    }


# ---- when it runs ---------------------------------------------------------------------------------

def _due_sql(alias: str = "h") -> str:
    return (
        f"({alias}.host IS NULL OR {alias}.fetched_at IS NULL "
        f"OR ({alias}.status = 'failed' AND {alias}.fetched_at < UTC_TIMESTAMP(3) - INTERVAL {RETRY_HOURS} HOUR) "
        f"OR {alias}.fetched_at < UTC_TIMESTAMP(3) - INTERVAL {REFRESH_DAYS} DAY)"
    )


def queue_for(engine: Engine, host: str, force: bool = False) -> bool:
    """Asks for a look now, unless one is fresh or on its way. Returns whether a job was queued."""
    host = to_ascii_host(host)
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO site_history (host, status) VALUES (:h, 'queued')"), {"h": host})
        if not force and conn.execute(text(f"SELECT 1 FROM site_history h WHERE h.host = :h AND {_due_sql()}"), {"h": host}).first() is None:
            return False
        conn.execute(text("UPDATE site_history SET status = 'queued' WHERE host = :h AND status <> 'running'"), {"h": host})
    return queue.enqueue(engine, LANE, JOB_KIND, payload={"host": host}, dedupe_key=f"history:{host}", max_attempts=TRIES) is not None


def enqueue_due(engine: Engine) -> list[str]:
    """Each followed competitor, and each of my sites that has competitors (its domain dates sit beside theirs). Safe to call as often as cron likes."""
    with engine.connect() as conn:
        hosts = [
            row[0]
            for row in conn.execute(text(
                "SELECT s.host FROM sites s LEFT JOIN site_history h ON h.host = s.host WHERE "
                "(EXISTS (SELECT 1 FROM site_competitors sc WHERE sc.competitor_id = s.id AND sc.tracking <> 'off') "
                " OR (s.kind = 'own' AND EXISTS (SELECT 1 FROM site_competitors sc WHERE sc.site_id = s.id))) "
                f"AND {_due_sql()} ORDER BY s.id"
            ))
        ]
    return [host for host in hosts if queue_for(engine, host)]


# ---- the job --------------------------------------------------------------------------------------

def _write_page_dates(engine: Engine, host: str, first_by_page: dict[str, date]) -> int:
    """pages.first_archived for the pages we've read, matched by address."""
    if not first_by_page:
        return 0
    with engine.connect() as conn:
        pages = conn.execute(
            text("SELECT p.id, p.url, p.first_archived FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w)"),
            {"h": host, "w": f"www.{host}"},
        ).all()
    changes = []
    for page_id, url, before in pages:
        day = first_by_page.get(page_key(url))
        if day is not None and day != before:
            changes.append({"i": page_id, "d": day})
    for start in range(0, len(changes), 500):
        with engine.begin() as conn:
            conn.execute(text("UPDATE pages SET first_archived = :d WHERE id = :i"), changes[start:start + 500])
    return len(changes)


def _domain_dates(host: str) -> dict:
    """Registry dates. A failure here leaves the dates already known in place."""
    try:
        registered, expires = uptime.rdap_dates_lookup(registrable_domain(host))  # the registry knows blogspot.com, not someone.blogspot.com
    except uptime.NoRdap:
        return {"domain_problem": "no_rdap"}
    except Exception:  # noqa: BLE001 - RdapFailed, or anything unexpected from a registry: the Wayback part still counts
        return {"domain_problem": "rdap_failed"}
    return {"registered_on": registered, "expires_on": expires, "domain_problem": None}


@handler(JOB_KIND)
def run_history(job, engine: Engine) -> None:
    host = (job.payload or {}).get("host")
    if not isinstance(host, str) or not host:
        return
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO site_history (host) VALUES (:h)"), {"h": host})
        conn.execute(text("UPDATE site_history SET status = 'running' WHERE host = :h"), {"h": host})
    dates = _domain_dates(host)
    date_sql = ", ".join(f"{name} = :{name}" for name in dates)
    try:
        found = summarise(cdx_lookup(host))
    except Exception as exc:  # noqa: BLE001 - HistoryFailed, or a bad answer: say so, and try again later
        reason = str(exc) if isinstance(exc, HistoryFailed) else type(exc).__name__
        last_try = job.attempts + 1 >= TRIES  # attempts counts the tries before this one
        with engine.begin() as conn:
            conn.execute(
                text(f"UPDATE site_history SET status = :s, message = :m, fetched_at = IF(:last, UTC_TIMESTAMP(3), fetched_at){', ' + date_sql if date_sql else ''} WHERE host = :h"),
                {"s": FAILED if last_try else QUEUED, "m": f"The Wayback Machine didn't answer ({reason}).", "last": last_try, "h": host, **dates},
            )
        if not last_try:
            raise Retry(f"Wayback Machine: {reason}", TRY_AGAIN_SECONDS) from exc
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE site_history SET status = 'ok', message = NULL, first_capture = :f, archived_pages = :n, capped = :c, pages_by_year = :y, "
                f"fetched_at = UTC_TIMESTAMP(3){', ' + date_sql if date_sql else ''} WHERE host = :h"
            ),
            {"f": found["first_capture"], "n": found["archived_pages"], "c": found["capped"], "y": json.dumps(found["pages_by_year"]), "h": host, **dates},
        )
    _write_page_dates(engine, host, found["first_by_page"])


def state(conn, host: str) -> dict | None:
    row = conn.execute(text("SELECT * FROM site_history WHERE host = :h"), {"h": to_ascii_host(host)}).mappings().first()
    if row is None:
        return None
    years = row["pages_by_year"]
    if isinstance(years, str):
        years = json.loads(years)
    return {
        "status": row["status"], "message": row["message"], "first_capture": row["first_capture"], "archived_pages": row["archived_pages"], "capped": bool(row["capped"]),
        "pages_by_year": years or {}, "registered_on": row["registered_on"], "expires_on": row["expires_on"], "domain_problem": row["domain_problem"], "fetched_at": row["fetched_at"],
    }
