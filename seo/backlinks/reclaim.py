"""Links to reclaim: other sites link to a page of mine that's gone, so the link is wasted until that page redirects somewhere useful.

Two places know about such links. A logged link's monthly check reads my target page (`backlinks.target_http`), and Search
Console's Top linked pages lists my pages that have links. Those are read here, once a month, through the polite fetcher.
"""
from __future__ import annotations

import time

from sqlalchemy import Engine, text

from seo.backlinks import live
from seo.competitors.keywords import require_own
from seo.core import budget
from seo.core.errors import NotFound
from seo.links import service as links_service
from seo.worker import queue
from seo.worker.runner import RunAgain, handler

JOB_KIND = "backlinks.reclaim"
CHECK_EVERY_DAYS = 30
GONE = (404, 410)

_DUE = (
    "SELECT id, target_url FROM gsc_linked_pages WHERE site_id = :s AND dismissed = 0 "
    "AND (checked_at IS NULL OR checked_at < UTC_TIMESTAMP(3) - INTERVAL :every DAY) ORDER BY checked_at IS NOT NULL, checked_at, id"
)


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    site_id = (job.payload or {}).get("site_id")
    if not budget.has_room(engine):
        raise RunAgain(budget.seconds_until_new_day(engine))
    started = time.monotonic()
    fetcher = links_service.fetcher_factory()
    done: set[int] = set()
    try:
        while time.monotonic() - started < live.CHUNK_SECONDS and budget.has_room(engine):
            with engine.connect() as conn:
                row = next((r for r in conn.execute(text(_DUE), {"s": site_id, "every": CHECK_EVERY_DAYS}).mappings() if r["id"] not in done), None)
            if row is None:
                return
            done.add(row["id"])
            sent = fetcher.requests
            found = live.read_target(fetcher, row["target_url"])
            budget.charge(engine, fetcher.requests - sent)
            with engine.begin() as conn:
                conn.execute(
                    text("UPDATE gsc_linked_pages SET http_status = :h, final_url = :f, checked_at = UTC_TIMESTAMP(3) WHERE id = :i"),
                    {"h": found["http"], "f": found["final"], "i": row["id"]},
                )
    finally:
        fetcher.close()
    raise RunAgain(budget.seconds_until_new_day(engine) if not budget.has_room(engine) else 3)


def enqueue(engine: Engine, site_id: int) -> bool:
    return queue.enqueue(engine, live.LANE, JOB_KIND, payload={"site_id": site_id}, dedupe_key=f"reclaim:{site_id}", max_attempts=3) is not None


def enqueue_due(engine: Engine) -> list[int]:
    with engine.connect() as conn:
        sites = [r[0] for r in conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id"))]
        due = [s for s in sites if conn.execute(text(f"SELECT 1 FROM ({_DUE}) d LIMIT 1"), {"s": s, "every": CHECK_EVERY_DAYS}).first()]
    return [s for s in due if enqueue(engine, s)]


def list_for_site(engine: Engine, site_id: int) -> list[dict]:
    """My pages that answer 404 or 410 and still have links pointing at them, the most linked first."""
    with engine.connect() as conn:
        require_own(conn, site_id)
        logged = conn.execute(text(
            "SELECT COALESCE(target_final_url, target_url) AS page, COUNT(*) AS links, COUNT(DISTINCT domain) AS sites, MAX(target_http) AS http, "
            "GROUP_CONCAT(DISTINCT domain ORDER BY domain SEPARATOR ' ') AS domains FROM backlinks "
            "WHERE site_id = :s AND status IN ('live', 'found') AND target_http IN (404, 410) GROUP BY page"
        ), {"s": site_id}).mappings().all()
        listed = conn.execute(text(
            "SELECT id, target_url, incoming_links, linking_sites, http_status, checked_at FROM gsc_linked_pages WHERE site_id = :s AND dismissed = 0 AND http_status IN (404, 410)"
        ), {"s": site_id}).mappings().all()
    pages: dict[str, dict] = {}
    for row in logged:
        key = live.clean_path(row["page"])
        pages[key] = {"page": row["page"], "path": key, "http": row["http"], "logged_links": int(row["links"]), "sites": int(row["sites"]), "domains": (row["domains"] or "").split()[:10], "gsc_id": None, "gsc_links": None}
    for row in listed:
        key = live.clean_path(row["target_url"])
        item = pages.setdefault(key, {"page": row["target_url"], "path": key, "http": row["http_status"], "logged_links": 0, "sites": 0, "domains": [], "gsc_id": None, "gsc_links": None})
        item["gsc_id"], item["gsc_links"] = row["id"], row["incoming_links"]
        item["sites"] = max(item["sites"], int(row["linking_sites"] or 0))
    return sorted(pages.values(), key=lambda p: (-(p["sites"] or 0), -(p["gsc_links"] or 0), p["path"]))


def dismiss(engine: Engine, page_id: int) -> None:
    with engine.begin() as conn:
        if not conn.execute(text("UPDATE gsc_linked_pages SET dismissed = 1 WHERE id = :i"), {"i": page_id}).rowcount:
            raise NotFound("That page isn't in the list.")
