"""Google AI Overviews for my keywords: does one appear, am I cited, who else is, and what changed.

A tool that can't see AI Overviews gives "not captured", never "no". Changes only compare checks with
the same tool, location and depth, and this updates when a check runs: it never spends by itself.
"""
from __future__ import annotations

from collections import Counter

from sqlalchemy import Engine, text

from seo.competitors.keywords import _iso, require_own
from seo.competitors.suggest import tracked_competitors
from seo.serp import connections, store
from seo.serp.tools import ABSENT, NOT_CAPTURED, PRESENT

ENGINE = "google"


def _cited_domains(check: store.Check) -> list[str]:
    return list(dict.fromkeys(row.domain for row in check.citations))


def ai_tools(engine: Engine) -> list[str]:
    """Names of the connected Google tools that see AI Overviews (SerpApi today), in the saved order."""
    try:
        tools = connections.tools_for(engine, "google", include_manual=True)
    except Exception:  # noqa: BLE001 - a tool that can't be built must not take the watch down; it just isn't offered
        return []
    return list(dict.fromkeys(tool.name for tool in tools if getattr(tool, "gives_ai", False)))


def watch(engine: Engine, site_id: int) -> dict:
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        competitors = [c for c in tracked_competitors(conn, site_id) if c["tracking"] == "on"]  # AI answers are keyword data
    rival_hosts = {c["host"]: c for c in competitors}
    # Each keyword's newest check from a tool that can see AI Overviews, named. A keyword no such tool checked is "not
    # checked": a newer check from Searlo or HasData says nothing about an overview, so it never hides one SerpApi saw.
    with engine.connect() as conn:
        tracked = conn.execute(text(
            "SELECT k.id, k.keyword, k.country, k.language FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s ORDER BY k.keyword"
        ), {"s": site_id}).mappings().all()
    by_keyword = {check.keyword_id: check for check in store.latest_ai_checks(engine, site_id)}
    latest = [by_keyword[k["id"]] for k in tracked if k["id"] in by_keyword]

    def rivals_in(check: store.Check) -> list[dict]:
        return [{"id": c["id"], "host": host} for host, c in rival_hosts.items() if check.cites(host)]

    rows = []
    for keyword in tracked:
        check = by_keyword.get(keyword["id"])
        if check is None:
            rows.append({
                "keyword": keyword["keyword"], "keyword_id": keyword["id"], "country": keyword["country"], "language": keyword["language"], "tool": None, "location": None,
                "checked_at": None, "state": NOT_CAPTURED, "not_checked": True, "cited_me": None, "my_cited_urls": [], "competitors_cited": [], "others_cited": [],
            })
            continue
        rows.append({
            "keyword": check.keyword, "keyword_id": check.keyword_id, "country": check.country, "language": check.language, "tool": check.tool, "location": check.real_location,
            "checked_at": _iso(check.checked_at), "state": check.ai_state, "not_checked": False,
            "cited_me": check.cites(site["host"]),
            "my_cited_urls": [row.url for row in check.citations if store.on_host(row.host, site["host"])],
            "competitors_cited": rivals_in(check),
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
            "tools": sorted({c.tool for c in latest}),  # who looked: the screen names them
            # The connected tools that can see AI Overviews: none -> the screen asks to connect one; some -> it offers to
            # check the keywords none of them has checked yet (not_checked_ids), through the usual Refresh preview and cost.
            "ai_tools": ai_tools(engine),
            "not_checked_ids": [r["keyword_id"] for r in rows if r["not_checked"]],
            "checked_at": _iso(max((c.checked_at for c in latest), default=None)),
        },
        "changes": changes[:200],
        "trend": sorted(trend.values(), key=lambda p: p["day"]),
    }
