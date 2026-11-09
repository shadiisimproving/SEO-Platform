"""Is the linking page on Google: a site: search for each live backlink's page, on the free search credits of the rankings tools.

A link on a page Google hasn't indexed passes nothing. Google won't say through its API whether someone else's page is
indexed, so the page is looked up the way a person would: `site:blog.example/post`, and the exact page in the results.

Free signals go first and cost no search: Search Console listing the link means Google has the page, and a noindex or a
robots.txt block seen by the link check means it can't be indexed. Only the rest are searched.

site: results are incomplete, and an indexed page sometimes doesn't show. So one miss is only "not found yet", and the page
is searched again a few days later; two misses in a row make it "not indexed". Only free credits are used, never paid ones,
and at most MAX_PER_DAY searches a day, so rankings keep most of the month's allowance.
"""
from __future__ import annotations

import json
import time
from urllib.parse import unquote, urlsplit

from sqlalchemy import Engine, text

from seo.serp import connections
from seo.serp.tools import SearchFailed, TimedOut, ToolStopped, most_cost
from seo.worker import queue
from seo.worker.runner import RunAgain, handler

JOB_KIND = "backlinks.source_index"
LANE = "refresh"  # the lane that runs the rankings searches, so two searches never run at once
MAX_PER_DAY = 40
CHUNK_SECONDS = 40.0
INDEXED, NOT_FOUND, NOT_INDEXED, NOT_INDEXABLE = "indexed", "not_found", "not_indexed", "not_indexable"
NOTE = "site: check of a linking page"
ASKED_AGAIN_HOURS = 20

_DUE = (
    "SELECT id, source_url, seo_reasons, check_outcome, gsc_seen, src_index, src_index_misses FROM backlinks WHERE status = 'live' "
    "AND COALESCE(gsc_seen, '') <> 'page' AND ("
    " src_index_at IS NULL"
    " OR (src_index = 'indexed' AND src_index_at < UTC_TIMESTAMP(3) - INTERVAL 60 DAY)"
    " OR (src_index = 'not_found' AND src_index_at < UTC_TIMESTAMP(3) - INTERVAL 3 DAY)"
    " OR (src_index = 'not_indexed' AND src_index_at < UTC_TIMESTAMP(3) - INTERVAL 30 DAY)"
    ") ORDER BY src_index_at IS NOT NULL, src_index_at, id"
)


def _reasons(row) -> list:
    value = row["seo_reasons"]
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def _cannot_be_indexed(row) -> bool:
    return row["check_outcome"] == "found" and any(r in ("noindex", "robots_blocked") for r in _reasons(row))


def shown(row) -> dict | None:
    """What the screen says about the linking page, free signals first. None: not known yet."""
    if row["status"] != "live":
        return None
    if _cannot_be_indexed(row):
        return {"state": NOT_INDEXABLE, "via": "check", "at": None}
    if row["gsc_seen"] == "page":
        return {"state": INDEXED, "via": "Search Console", "at": row.get("gsc_crawled")}
    if row.get("src_index"):
        at = row.get("src_index_at")
        return {"state": row["src_index"], "via": row.get("src_index_via"), "at": at.strftime("%Y-%m-%d") if at else None}
    return None


def page_key(url: str) -> str:
    """The same page whatever the scheme, www, trailing slash or #part: what a search result is matched on."""
    parts = urlsplit(url if "://" in url else "https://" + url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    path = unquote(parts.path).rstrip("/")
    return host + path + (f"?{parts.query}" if parts.query else "")


def query_for(url: str) -> str:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    path = parts.path.rstrip("/")
    return f"site:{host}{path}"


def _free_tools(engine: Engine) -> list:
    """Google tools that can search on free credits now. A tool that only has paid searches is never used here."""
    usable = []
    for tool in connections.tools_for(engine, "google"):
        free = getattr(tool, "free_monthly", None) is not None or getattr(tool, "free_once", None) is not None or most_cost(tool) == 0
        if free and connections.can_afford_a_search(engine, tool, 10):
            usable.append(tool)
    return usable


def can_search(engine: Engine) -> bool:
    return bool(_free_tools(engine))


def search(engine: Engine, url: str) -> tuple[str, bool] | None:
    """(the tool used, whether the exact page came back). None when no tool could answer on free credits."""
    wanted = page_key(url)
    for tool in _free_tools(engine):
        estimate = most_cost(tool, 10)
        connections.count_use(engine, tool.name, estimate, search_engine="google", note=NOTE)  # written down first, as rankings do
        try:
            answer = tool.search(query_for(url), "google", "US", "en", "desktop", 10)
        except TimedOut:
            return None  # it may have charged: the estimate stays, and this page waits for the next run
        except (ToolStopped, SearchFailed):
            connections.count_use(engine, tool.name, -estimate, search_engine="google", note="not charged")
            continue
        connections.count_use(engine, tool.name, answer.charged - estimate, search_engine="google", note="what the tool really charged")
        return tool.name, any(page_key(found.url) == wanted for found in answer.results)
    return None


def _save(engine: Engine, row, tool: str, found: bool) -> None:
    misses = 0 if found else int(row["src_index_misses"] or 0) + 1
    state = INDEXED if found else NOT_INDEXED if misses >= 2 else NOT_FOUND
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE backlinks SET src_index = :s, src_index_via = :v, src_index_at = UTC_TIMESTAMP(3), src_index_misses = :m WHERE id = :i"
        ), {"s": state, "v": tool[:40], "m": misses, "i": row["id"]})


def _searched_today(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text("SELECT COUNT(*) FROM backlinks WHERE src_index_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY")).scalar() or 0)


def _due(engine: Engine, first: int | None) -> list:
    with engine.connect() as conn:
        rows = [r for r in conn.execute(text(_DUE)).mappings().all() if not _cannot_be_indexed(r)]
        if first:
            asked = conn.execute(text(
                "SELECT id, source_url, seo_reasons, check_outcome, gsc_seen, src_index, src_index_misses FROM backlinks WHERE id = :i AND status = 'live' "
                "AND COALESCE(gsc_seen, '') <> 'page' AND (src_index_at IS NULL OR src_index_at < UTC_TIMESTAMP(3) - INTERVAL :h HOUR)"
            ), {"i": first, "h": ASKED_AGAIN_HOURS}).mappings().first()
            if asked is not None and not _cannot_be_indexed(asked):
                rows = [asked] + [r for r in rows if r["id"] != first]
    return rows


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    started = time.monotonic()
    rows = _due(engine, (job.payload or {}).get("first"))[:max(0, MAX_PER_DAY - _searched_today(engine))]
    for row in rows:
        if time.monotonic() - started >= CHUNK_SECONDS:
            raise RunAgain(3)
        answer = search(engine, row["source_url"])
        if answer is None:
            return  # no free searches left on any tool: the next daily run carries on
        _save(engine, row, *answer)


def enqueue(engine: Engine, first: int | None = None) -> bool:
    if not can_search(engine):
        return False
    key = "source-index" + (f":{first}" if first else "")
    return queue.enqueue(engine, LANE, JOB_KIND, payload={"first": first}, dedupe_key=key, max_attempts=2) is not None


def enqueue_due(engine: Engine) -> bool:
    return bool(_due(engine, None)) and enqueue(engine)
