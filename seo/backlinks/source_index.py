"""Is the linking page on Google: a site: search for each live backlink's page, on the free search credits of the rankings tools.

A link on a page Google hasn't indexed passes nothing. Google won't say through its API whether someone else's page is
indexed, so the page is looked up the way a person would: `site:blog.example/post`, and the exact page in the results.

Free signals go first and cost no search: Search Console listing the link means Google has the page, and a noindex or a
robots.txt block seen by the link check means it can't be indexed. Only the rest are searched.

site: results are incomplete, and an indexed page sometimes doesn't show. So one miss is only "not found yet", and the page
is searched again a few days later; two misses in a row make it "not indexed". Only free credits are used, never paid ones,
and at most MAX_PER_DAY searches a day, so rankings keep most of the month's allowance.

The address searched is where the link check ended up (a logged ?p=123 that redirects to /my-post/ is searched as /my-post/),
query string and all, with an ASCII host (F2, F108). A miss only counts toward "not indexed" when Google showed no other page
under that address: a home page, a section, or a ?t=123 thread answered with ten other threads, is "not found" (F2).
"""
from __future__ import annotations

import json
import logging
import time
from urllib.parse import quote, unquote, urlsplit

from sqlalchemy import Engine, text

from seo.serp import connections
from seo.serp.store import to_ascii_host
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
log = logging.getLogger(__name__)

_DUE = (
    "SELECT id, source_url, final_url, seo_reasons, check_outcome, gsc_seen, src_index, src_index_misses FROM backlinks WHERE status = 'live' "
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


FOUND, OTHER_PAGES, NOTHING, HIDDEN = "found", "other_pages", "nothing", "hidden"
FAILS_BEFORE_DROP = 3  # failed searches in a row, as Refresh counts them: Google showing a tool a captcha is one


def _parts(url: str):
    try:
        parts = urlsplit(url if "://" in url else "https://" + url)
        host = to_ascii_host((parts.hostname or "").removeprefix("www.")).removeprefix("www.")
    except ValueError:
        return "", "", ""
    return host, unquote(parts.path).rstrip("/"), parts.query


def page_key(url: str) -> str:
    """The same page whatever the scheme, www, trailing slash, accented or xn-- host, or #part: what a result is matched on."""
    host, path, query = _parts(url)
    return host + path + (f"?{query}" if query else "")


def query_for(url: str) -> str:
    """The exact address, query string included (F2)."""
    host, path, query = _parts(url)
    return f"site:{host}{quote(path, safe='/%:@!$&()*+,;=-._~')}" + (f"?{query}" if query else "")


def address_of(row) -> str:
    """Where the link check last ended up, or the address as logged."""
    return row.get("final_url") or row["source_url"]


def outcome(wanted_url: str, results) -> str:
    """FOUND: the page came back. OTHER_PAGES: Google showed other pages under the same address, so the search wasn't for
    one page and a miss proves nothing. NOTHING: no page under that address came back. HIDDEN: Google gave results without
    their address, and none of the others is the page: it may be one of those, so this answer says nothing at all."""
    wanted = page_key(wanted_url)
    keys = [page_key(found.url) for found in results if found.url]
    if wanted in keys:
        return FOUND
    if any(not found.url for found in results):
        return HIDDEN
    host, path, _ = _parts(wanted_url)
    under = host + path
    if any(key == under or key.startswith(under + "/") or key.startswith(under + "?") for key in keys):
        return OTHER_PAGES
    return NOTHING


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


def search(engine: Engine, url: str, stopped: set[str] | None = None, fails: dict[str, int] | None = None) -> tuple[str, str] | None:
    """(the tool used, FOUND / OTHER_PAGES / NOTHING). None when no tool could answer on free credits.

    `stopped` holds the tools that sit out the rest of the run, so none is paid for once per page: one that stopped (a bot
    check, Google hiding where its results lead, no free searches), one whose answer hid the addresses (it can't tell one
    page from another while Google does that), and one that failed FAILS_BEFORE_DROP searches in a row (a captcha each
    time). A failed or hidden answer is never a miss: the next tool is asked, or the page waits for the next run."""
    stopped = set() if stopped is None else stopped
    fails = {} if fails is None else fails
    for tool in _free_tools(engine):
        if tool.name in stopped:
            continue
        try:
            # Written down first and given back only for what wasn't charged, as rankings do.
            answer = connections.spend_on_search(engine, tool, query_for(url), "google", "US", "en", "desktop", 10, note=NOTE)
        except TimedOut:
            return None  # it may have charged: that stays, and this page waits for the next run
        except ToolStopped:
            stopped.add(tool.name)
            continue
        except SearchFailed:
            fails[tool.name] = fails.get(tool.name, 0) + 1
            if fails[tool.name] >= FAILS_BEFORE_DROP:
                stopped.add(tool.name)
            continue
        fails[tool.name] = 0
        found = outcome(url, answer.results)
        if found == HIDDEN:
            stopped.add(tool.name)
            continue
        return tool.name, found
    return None


def _save(engine: Engine, row, tool: str, found) -> None:
    result = (FOUND if found else NOTHING) if isinstance(found, bool) else found
    if result == FOUND:
        misses = 0
    elif result == OTHER_PAGES:  # not a search for one page: it neither proves nor counts against it
        misses = int(row["src_index_misses"] or 0)
    else:
        misses = int(row["src_index_misses"] or 0) + 1
    state = INDEXED if result == FOUND else NOT_INDEXED if result == NOTHING and misses >= 2 else NOT_FOUND
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
                "SELECT id, source_url, final_url, seo_reasons, check_outcome, gsc_seen, src_index, src_index_misses FROM backlinks WHERE id = :i AND status = 'live' "
                "AND COALESCE(gsc_seen, '') <> 'page' AND (src_index_at IS NULL OR src_index_at < UTC_TIMESTAMP(3) - INTERVAL :h HOUR)"
            ), {"i": first, "h": ASKED_AGAIN_HOURS}).mappings().first()
            if asked is not None and not _cannot_be_indexed(asked):
                rows = [asked] + [r for r in rows if r["id"] != first]
    return rows


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    started = time.monotonic()
    payload = dict(job.payload or {})
    stopped = set(payload.get("stopped") or [])  # tools that sit out this job, kept in it across its 40-second parts
    fails: dict[str, int] = {}
    rows = _due(engine, payload.get("first"))[:max(0, MAX_PER_DAY - _searched_today(engine))]
    for row in rows:
        if time.monotonic() - started >= CHUNK_SECONDS:
            if stopped:
                with engine.begin() as conn:
                    conn.execute(text("UPDATE jobs SET payload = :p WHERE id = :i"), {"p": json.dumps({**payload, "stopped": sorted(stopped)}), "i": job.id})
            raise RunAgain(3)
        try:
            answer = search(engine, address_of(row), stopped, fails)
        except Exception:  # noqa: BLE001 - one odd address must not stop every later page (the F59 family)
            log.exception("site: check failed for backlink %s", row["id"])
            _save(engine, row, "", OTHER_PAGES)  # its date moves, so the next page goes first tomorrow
            continue
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
