"""How much one of my pages weighs: its Google clicks, so a screen can put the rows that matter first.

One rule for every screen that says "why this row matters" (a rival's edit, a lost link, a keyword): the last 28 final
days of Search Console's page table, and the 28 before when the table covers them.
"""
from datetime import timedelta
from typing import Callable

from sqlalchemy import text

DAYS = 28
# Search Console's fresh days aren't final and come in low: only days before fresh_from count (as Today does).
_FINAL = "day < COALESCE((SELECT fresh_from FROM site_sources WHERE site_id = :s AND source = 'gsc'), '9999-12-31')"


def page_clicks(conn, site_ids, key: Callable[[str], str], days: int = DAYS) -> dict[int, dict[str, dict]]:
    """{site: {key(page address): {"clicks": last `days` days, "before": the `days` before, or None when not covered}}}.

    `key` says which spellings are one page (the caller's own rule, so its rows meet these). Jump links (#section) are
    left out, as on Pages: Google lists them as their own address with nearly no click."""
    out: dict[int, dict[str, dict]] = {}
    for site in site_ids:
        pages = out.setdefault(site, {})
        end = conn.execute(text(f"SELECT MAX(day) FROM gsc_page WHERE site_id = :s AND {_FINAL}"), {"s": site}).scalar()
        if end is None:
            continue
        now_from, before_from = end - timedelta(days=days - 1), end - timedelta(days=2 * days - 1)
        first = conn.execute(text("SELECT MIN(day) FROM gsc_page WHERE site_id = :s"), {"s": site}).scalar()
        covered = first is not None and first <= before_from
        for row in conn.execute(text(
            "SELECT MAX(page) page, SUM(CASE WHEN day >= :n THEN clicks ELSE 0 END) clicks, SUM(CASE WHEN day < :n THEN clicks ELSE 0 END) earlier "
            "FROM gsc_page WHERE site_id = :s AND day BETWEEN :b AND :e GROUP BY page_hash"
        ), {"s": site, "n": now_from, "b": before_from, "e": end}).mappings():
            if "#" in row["page"]:
                continue
            slot = pages.setdefault(key(row["page"]), {"clicks": 0, "before": 0 if covered else None})
            slot["clicks"] += int(row["clicks"] or 0)
            if covered:
                slot["before"] += int(row["earlier"] or 0)
    return out
