"""Google AI Overviews for my keywords: does one appear, am I cited, who else is, and what changed.

A tool that can't see AI Overviews gives "not captured", never "no". Changes only compare checks with
the same tool, location and depth, and this updates when a check runs: it never spends by itself.
"""
from __future__ import annotations

from collections import Counter

from sqlalchemy import Engine

from seo.competitors.keywords import _iso, require_own
from seo.competitors.suggest import tracked_competitors
from seo.serp import store
from seo.serp.tools import ABSENT, PRESENT

ENGINE = "google"


def _cited_domains(check: store.Check) -> list[str]:
    return list(dict.fromkeys(row.domain for row in check.citations))


def watch(engine: Engine, site_id: int, competitor_id: int | None = None) -> dict:
    """With `competitor_id` (a competitor's own page): the changes are only that competitor's, kept before the list is cut.
    The keyword rows stay whole, so the page can say how many overviews there were; it picks the ones citing them."""
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        competitors = [c for c in tracked_competitors(conn, site_id) if c["tracking"] == "on"]  # AI answers are keyword data
    rival_hosts = {c["host"]: c for c in competitors}
    # A keyword only another engine has checked is on the list too: as not captured, which is all that tool can say.
    latest = store.one_per_keyword(store.latest_checks(engine, site_id))

    def rivals_in(check: store.Check) -> list[dict]:
        return [{"id": c["id"], "host": host} for host, c in rival_hosts.items() if check.cites(host)]

    rows = []
    for check in latest:
        captured = check.ai_state != "not_captured"
        rows.append({
            "keyword": check.keyword, "keyword_id": check.keyword_id, "country": check.country, "language": check.language, "tool": check.tool, "location": check.real_location,
            "checked_at": _iso(check.checked_at), "state": check.ai_state,
            "cited_me": check.cites(site["host"]) if captured else None,
            "my_cited_urls": [row.url for row in check.citations if store.on_host(row.host, site["host"])],
            "competitors_cited": rivals_in(check) if captured else [],
            "others_cited": [d for d in _cited_domains(check) if not any(store.on_host(d, h) or store.on_host(h, d) for h in (site["host"], *rival_hosts))],
        })
    rows.sort(key=lambda r: ({PRESENT: 0, ABSENT: 1}.get(r["state"], 2), r["keyword"]))
    with_overview = [c for c in latest if c.ai_state == PRESENT]
    rival_counts: Counter = Counter()
    for check in with_overview:
        for rival in rivals_in(check):
            rival_counts[rival["host"]] += 1

    changes: list[dict] = []
    trend: dict[str, dict] = {}
    previous: dict[tuple, store.Check] = {}
    for check in store.history(engine, site_id, ENGINE):
        if check.ai_state == "not_captured":
            continue
        day = check.checked_at.strftime("%Y-%m-%d")
        point = trend.setdefault(day, {"day": day, "checked": 0, "overviews": 0, "cited_me": 0})
        point["checked"] += 1
        point["overviews"] += int(check.ai_state == PRESENT)
        point["cited_me"] += int(check.cites(site["host"]))
        key = (check.target_id, check.tool, check.real_location, check.depth)
        before = previous.get(key)
        previous[key] = check
        if before is None:
            continue
        common = {"keyword": check.keyword, "keyword_id": check.keyword_id, "at": _iso(check.checked_at), "tool": check.tool}
        if before.ai_state != check.ai_state:
            changes.append({**common, "kind": "overview_appeared" if check.ai_state == PRESENT else "overview_gone"})
        if before.cites(site["host"]) != check.cites(site["host"]):
            changes.append({**common, "kind": "me_cited" if check.cites(site["host"]) else "me_dropped"})
        for host, rival in rival_hosts.items():
            if before.cites(host) != check.cites(host):
                changes.append({**common, "kind": "rival_cited" if check.cites(host) else "rival_dropped", "competitor": host, "competitor_id": rival["id"]})
    if competitor_id is not None:
        changes = [c for c in changes if c.get("competitor_id") == competitor_id]
    changes.sort(key=lambda c: c["at"], reverse=True)
    return {
        "keywords": rows,
        "summary": {
            "tracked": len(rows),
            "captured": sum(1 for r in rows if r["state"] != "not_captured"),
            "not_captured": sum(1 for r in rows if r["state"] == "not_captured"),
            "with_overview": len(with_overview),
            "cited_me": sum(1 for c in with_overview if c.cites(site["host"])),
            "rivals": [{"host": host, "keywords": n} for host, n in rival_counts.most_common()],
        },
        "changes": changes[:200],
        "trend": sorted(trend.values(), key=lambda p: p["day"]),
    }
