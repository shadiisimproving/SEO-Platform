"""How well the app can read a competitor's site, for the hints on its profile. Counting only.

- How the site lists its pages: a sitemap, only a feed, or only the start page's links (no sitemap at all).
- Whether the sitemap listed more than the app takes, and how many days the first read still needs.
- How many pages only showed their text with JavaScript, which the app's reader can't run.
- What Firecrawl, if connected, has read or is reading, and whether its weekly check for edits is on.
- How the site is followed: every page daily, WordPress's list of edits, its sitemap's dates, or in tiers.
"""
from __future__ import annotations

import math

from sqlalchemy import text

from seo.competitors import firecrawl
from seo.competitors.crawl import CUT_TEXT, CUT_WAIT_TEXT, EVERY_FEW_DAYS, MAX_DISCOVERED, PAGES_PER_DAY, TIERS, TOP_RANK


STOPPED_READ = "Last read stopped early. Pages so far are saved; it resumes at the next daily read."
STOPPED_FIRECRAWL = "Firecrawl stopped early. Pages read so far are saved. Try again."


def facts(conn, competitor_id: int, row) -> dict:
    return facts_many(conn, {competitor_id: row})[competitor_id]


def live_jobs(conn, ids) -> set[str]:
    """The queue keys still held for these sites' reads, so a read whose job died is shown as stopped (F61)."""
    if not ids:
        return set()
    keys = conn.execute(
        text("SELECT active_key FROM jobs WHERE active_key IS NOT NULL AND kind IN (:read, :fc)"), {"read": "competitors.crawl", "fc": firecrawl.JOB_KIND}
    ).scalars().all()
    return set(keys)


def _held(keys: set[str], prefix: str) -> bool:
    return prefix in keys or any(k.startswith(f"{prefix}:") for k in keys)


def facts_many(conn, rows: dict[int, dict]) -> dict[int, dict]:
    """The same facts for many sites in a fixed number of queries, whatever their number (F85)."""
    if not rows:
        return {}
    marks = ",".join(str(int(i)) for i in rows)
    hosts = dict(conn.execute(text(f"SELECT id, host FROM sites WHERE id IN ({marks})")).all())
    found: dict[str, dict] = {}
    if hosts:
        names = {f"h{n}": host for n, host in enumerate(set(hosts.values()))}
        for r in conn.execute(
            text(
                "SELECT d.host, SUM(p.js_only = 1 AND p.read_with IS NULL) AS js, SUM(p.read_with = 'firecrawl') AS fc, SUM(p.last_checked_at IS NOT NULL) AS tried "
                f"FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN ({','.join(':' + k for k in names)}) GROUP BY d.host"
            ),
            names,
        ).mappings():
            found[r["host"]] = r
    connected = bool(conn.execute(text("SELECT 1 FROM connections WHERE tool = :t"), {"t": firecrawl.TOOL}).first())
    keys = live_jobs(conn, rows)
    out = {}
    for competitor_id, row in rows.items():
        page = found.get(hosts.get(competitor_id) or "") or {}
        tried = int(page.get("tried") or 0)
        known = row["pages_known"] or 0
        days_left = None
        if not row["baseline_done"] and known > tried and row["status"] not in ("blocked",):
            days_left = math.ceil((known - tried) / PAGES_PER_DAY)
        fc_status, fc_message, fc_finished = row["fc_status"], row["fc_message"], row["fc_finished_at"]
        if fc_status in ("queued", "running") and not _held(keys, f"firecrawl:{competitor_id}"):
            fc_status, fc_message = "failed", STOPPED_FIRECRAWL  # its job is gone: the box stops waiting, and Try again works
            fc_finished = fc_finished or row["started_at"] or row["finished_at"]
        out[competitor_id] = {
            "list_source": row["list_source"], "list_capped": bool(row["list_capped"]),
            "sitemap_cut": "waiting" if row["message"] == CUT_WAIT_TEXT else "cut" if row["message"] == CUT_TEXT else None, "list_most": MAX_DISCOVERED, "per_day": PAGES_PER_DAY,
            "pages_tried": tried, "days_left": days_left, "js_only": int(page.get("js") or 0),
            "read_stopped": row["status"] == "running" and not _held(keys, f"competitor:{competitor_id}"),
            "follow": {
                "mode": row.get("follow_mode"), "top_rank": TOP_RANK, "every_few_days": EVERY_FEW_DAYS,
                # In tiers, the pages left over come round about this often with what's left of each day's reads.
                "rest_every_days": max(1, math.ceil(known / PAGES_PER_DAY)) if row.get("follow_mode") == TIERS and known else None,
                "dates_missed": int(row.get("dates_missed") or 0),
            },
            "firecrawl": {
                "connected": connected, "pages": int(page.get("fc") or 0), "status": fc_status, "action": row["fc_action"], "message": fc_message,
                "done": row["fc_done"] or 0, "asked": row["fc_asked"] or 0, "weekly": bool(row.get("fc_weekly")), "finished_at": fc_finished.isoformat() + "Z" if fc_finished else None,
            },
        }
    return out
