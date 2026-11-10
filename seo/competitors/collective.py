"""All my competitors together, across my sites or narrowed to one. Read-only, and it never spends a search credit.

The counting rules are the point of this file:
- A rival is only compared on keywords of the sites it's linked to, against the best of those sites.
- A keyword counts once, however many of my sites track it and however many engines checked it.
- Positions are only compared inside one check, so tool, location and depth always match. No averages: they would mix them.
- Not in the results checked is not "doesn't rank", and no checks at all is None, not 0.
"""
from __future__ import annotations

import json
from sqlalchemy import Engine, text

from seo.competitors import gaps, profile, quality
from seo.competitors.keywords import _iso, require_own
from seo.links.service import OWN
from seo.serp import store

KEYWORD_ROWS = 200
MOVE_ROWS = 100
LINK_ROWS = 500
MOVE_DAYS = 30


def _sites(conn, site_id: int | None) -> list[dict]:
    if site_id is not None:
        site = require_own(conn, site_id)
        return [{"id": site["id"], "host": site["host"]}]
    return [dict(r) for r in conn.execute(text("SELECT id, host FROM sites WHERE kind = :k ORDER BY id"), {"k": OWN}).mappings()]


def _rivals(conn, sites: list[dict]) -> list[dict]:
    """Each rival once, with the sites in scope it's linked to. Hosts aren't merged: blog.x.com and x.com stay two rows."""
    hosts = {s["id"]: s["host"] for s in sites}
    if not hosts:
        return []
    marks = ",".join(str(int(i)) for i in hosts)
    rivals: dict[int, dict] = {}
    rows = conn.execute(text(f"SELECT s.id, s.host, sc.site_id FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id IN ({marks}) AND sc.tracking = 'on' ORDER BY s.host, sc.site_id")).mappings()
    for row in rows:
        rival = rivals.setdefault(row["id"], {"id": row["id"], "host": row["host"], "display": store.to_display_host(row["host"]), "sites": []})
        rival["sites"].append({"id": row["site_id"], "host": hosts[row["site_id"]]})
    return list(rivals.values())


def _tracked_by(conn, sites: list[dict]) -> dict[int, set[int]]:
    """Which sites in scope track each keyword."""
    if not sites:
        return {}
    marks = ",".join(str(int(s["id"])) for s in sites)
    tracked: dict[int, set[int]] = {}
    for keyword_id, site_id in conn.execute(text(f"SELECT keyword_id, site_id FROM site_keywords WHERE site_id IN ({marks})")):
        tracked.setdefault(keyword_id, set()).add(site_id)
    return tracked


def _coverage(checks: list[store.Check], tracked: dict[int, set[int]]) -> dict:
    """What the numbers rest on, said once at the top of the page."""
    dates = sorted(c.checked_at for c in checks)
    return {
        "keywords": len(tracked), "checked": len({c.keyword_id for c in checks}), "tools": sorted({c.tool for c in checks}),
        "newest": _iso(dates[-1]) if dates else None, "oldest": _iso(dates[0]) if dates else None,
    }


def _best_of_mine(check: store.Check, site_ids: set[int], hosts: dict[int, str]) -> tuple[store.Row | None, int | None]:
    """My best place in this check among these sites. A tie goes to the older site, so the answer doesn't change between calls."""
    best, best_site = None, None
    for site_id in sorted(site_ids):
        row = check.best_on(hosts[site_id])
        if row is not None and (best is None or row.position < best.position):
            best, best_site = row, site_id
    return best, best_site


def _my_move(earlier: list[store.Check], check: store.Check, site_ids: set[int], hosts: dict[int, str]) -> dict | None:
    """When my best place on this keyword last changed. Only checks of the same tool, location and depth are compared,
    so a change of tool can't look like a move. None means there's nothing to compare with yet."""
    def place(one: store.Check) -> int | None:
        row, _ = _best_of_mine(one, site_ids, hosts)
        return row.position if row else None

    same_kind = [past for past in earlier if past.same_kind_as(check) and past.id != check.id]
    if not same_kind:
        return None
    current, since = place(check), check
    for past in reversed(same_kind):  # newest first
        was = place(past)
        if was != current:
            return {"changed": True, "was": was, "at": _iso(since.checked_at)}
        since = past
    return {"changed": False, "was": current, "at": _iso(since.checked_at)}


def _site_ids(rival: dict) -> set[int]:
    return {s["id"] for s in rival["sites"]}


def rivals(engine: Engine, site_id: int | None = None) -> dict:
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        tracked = _tracked_by(conn, sites)
        found = _rivals(conn, sites)
        crawls = profile.crawl_states(conn, [r["id"] for r in found])
        edits = profile.edits_last_30_days(conn)
    hosts = {s["id"]: s["host"] for s in sites}
    checks = store.one_per_keyword(store.latest_checks_many(engine, list(hosts)))
    out = []
    for rival in found:
        linked = _site_ids(rival)
        compared = ranks_on = they_ahead = i_ahead = level = not_found = 0
        for check in checks:
            mine_here = tracked.get(check.keyword_id, set()) & linked
            if not mine_here:
                continue
            compared += 1
            theirs = check.best_on(rival["host"])
            if theirs is None:
                continue
            ranks_on += 1
            mine, _ = _best_of_mine(check, mine_here, hosts)
            if mine is None:
                not_found += 1
            elif theirs.position < mine.position:
                they_ahead += 1
            elif mine.position < theirs.position:
                i_ahead += 1
            else:
                level += 1
        counts = {"ranks_on": ranks_on, "they_ahead": they_ahead, "i_ahead": i_ahead, "level": level, "not_found": not_found} if compared else {"ranks_on": None, "they_ahead": None, "i_ahead": None, "level": None, "not_found": None}
        out.append({**rival, "compared": compared, **counts, "edits_30d": int(edits.get(rival["id"], 0)), "crawl": crawls[rival["id"]]})
    out.sort(key=lambda r: (-((r["they_ahead"] or 0) + (r["not_found"] or 0)), -(r["ranks_on"] or 0), -len(r["sites"]), r["host"]))
    return {"sites": sites, "coverage": _coverage(checks, tracked), "rivals": out}


def keywords(engine: Engine, site_id: int | None = None) -> dict:
    """Keywords where a rival beats me. Each rival is compared with the sites it's linked to, so these rows add up to the rivals table."""
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        tracked = _tracked_by(conn, sites)
        found = _rivals(conn, sites)
    hosts = {s["id"]: s["host"] for s in sites}
    checks = store.one_per_keyword(store.latest_checks_many(engine, list(hosts)))
    earlier: dict[int, list[store.Check]] = {}
    for past in store.history_many(engine, list(hosts)):
        earlier.setdefault(past.target_id, []).append(past)
    out = []
    for check in checks:
        mine_all = tracked.get(check.keyword_id, set())
        ahead = []
        for rival in found:
            mine_here = mine_all & _site_ids(rival)
            theirs = check.best_on(rival["host"]) if mine_here else None
            if theirs is None:
                continue
            mine, mine_site = _best_of_mine(check, mine_here, hosts)
            if mine is None or theirs.position < mine.position:
                ahead.append({
                    "id": rival["id"], "host": rival["host"], "display": rival["display"], "position": theirs.position, "url": theirs.url,
                    "my_position": mine.position if mine else None, "my_host": hosts[mine_site] if mine_site else None,
                })
        if not ahead:
            continue
        best, best_site = _best_of_mine(check, mine_all, hosts)
        out.append({
            "keyword_id": check.keyword_id, "keyword": check.keyword, "country": check.country, "engine": check.engine, "tool": check.tool, "location": check.real_location,
            "depth": check.depth, "checked_at": _iso(check.checked_at), "my_sites": [hosts[i] for i in sorted(mine_all)],
            "my_best": {"position": best.position, "url": best.url, "host": hosts[best_site]} if best else None,
            "my_move": _my_move(earlier.get(check.target_id, []), check, mine_all, hosts),
            "rivals_ahead": sorted(ahead, key=lambda a: (a["position"], a["host"])),
        })
    out.sort(key=lambda k: (-len(k["rivals_ahead"]), k["keyword"].casefold(), k["country"]))
    return {"sites": sites, "coverage": _coverage(checks, tracked), "total": len(out), "keywords": out[:KEYWORD_ROWS]}


def moves(engine: Engine, site_id: int | None = None) -> dict:
    """What rivals did lately, newest first: their pages, then ranking moves, each counted once whichever sites watch them."""
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        tracked = _tracked_by(conn, sites)
        found = _rivals(conn, sites)
        crawls = profile.crawl_states(conn, [r["id"] for r in found])
        events: list[dict] = []
        page_changes = 0
        by_host = {rival["host"].lower(): rival for rival in found}
        if by_host:
            # Every rival at once (F85): only the newest MOVE_ROWS can be shown, so those are all that is read.
            names = {f"h{n}": host for n, host in enumerate(by_host)}
            recent = {**names, "days": MOVE_DAYS}
            where = (
                "FROM change_events e JOIN pages p ON p.id = e.page_id JOIN domains d ON d.id = e.domain_id "
                f"WHERE d.host IN ({','.join(':' + k for k in names)}) AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL :days DAY"
            )
            page_changes = conn.execute(text(f"SELECT COUNT(*) {where}"), recent).scalar_one()
            changes = conn.execute(text(f"SELECT e.id, e.kind, e.before_value, e.after_value, e.detected_at, e.summaries, p.url, d.host {where} ORDER BY e.detected_at DESC, e.id DESC LIMIT :n"), {**recent, "n": MOVE_ROWS}).mappings().all()
            events += [{"rival": by_host[r["host"].lower()], "id": r["id"], "kind": r["kind"], "at": _iso(r["detected_at"]), "url": r["url"], "before": r["before_value"], "after": r["after_value"], "summaries": json.loads(r["summaries"]) if isinstance(r["summaries"], str) else r["summaries"]} for r in changes if r["host"].lower() in by_host]
        cutoff = conn.execute(text("SELECT UTC_TIMESTAMP(3) - INTERVAL :days DAY"), {"days": MOVE_DAYS}).scalar_one()
    history = store.history_many(engine, [s["id"] for s in sites])
    start = _iso(cutoff)
    ranking_moves = 0
    for rival in found:
        linked = _site_ids(rival)
        theirs = [check for check in history if tracked.get(check.keyword_id, set()) & linked]
        recent = [{"rival": rival, **event} for event in profile._ranking_timeline(theirs, rival["host"]) if event["at"] >= start]
        ranking_moves += len(recent)
        events += recent
    events.sort(key=lambda e: e["at"], reverse=True)
    return {
        "sites": sites, "days": MOVE_DAYS, "total": page_changes + ranking_moves, "moves": events[:MOVE_ROWS],
        "blocked": sorted(r["host"] for r in found if crawls[r["id"]]["status"] == "blocked"),
        "not_started": sorted(r["host"] for r in found if crawls[r["id"]]["status"] != "blocked" and not crawls[r["id"]].get("baseline_done")),
    }


def links(engine: Engine, site_id: int | None = None) -> dict:
    """Domains linking to my rivals and not to me. Quality is per site: good for one can be flagged for another, so each keeps its own state."""
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
    merged: dict[str, dict] = {}
    with_data, rival_ids = set(), set()
    every_rival: dict[int, dict] = {}
    for site in sites:
        report = gaps._all_gaps(engine, site["id"])
        for competitor in report["competitors"]:
            rival_ids.add(competitor["id"])
            every_rival[competitor["id"]] = {"id": competitor["id"], "host": competitor["host"]}
            if competitor["has_data"]:
                with_data.add(competitor["id"])
        for gap in report["everything"]:
            entry = merged.setdefault(gap["domain"], {
                "domain": gap["domain"], "display": gap["display"], "title": gap["title"], "sample_url": gap["sample_url"], "rivals": {}, "sites": [],
                "authority": None, "authority_label": None, "top_percent": gap["top_percent"], "cc_rank": gap["cc_rank"], "sources": set(), "is_competitor": False,
                "auto_authority": gap["auto_authority"], "auto_authority_label": gap["auto_authority_label"], "authority_by_hand": gap["authority_by_hand"], "edit": gap["edit"],
            })
            for competitor in gap["competitors"]:
                entry["rivals"][competitor["id"]] = {"id": competitor["id"], "host": competitor["host"]}
            if gap["authority"] is not None and (entry["authority"] is None or gap["authority"] > entry["authority"]):
                entry["authority"], entry["authority_label"] = gap["authority"], gap["authority_label"]
            entry["sources"].update(gap["sources"])
            entry["is_competitor"] = entry["is_competitor"] or gap["is_competitor"]
            entry["sites"].append({
                "id": site["id"], "host": site["host"], "quality": gap["quality"], "reason_words": gap["reason_words"],
                "in_consideration": gap["in_consideration"], "lost_link": gap["lost_link"], "kept": gap["kept"],
            })
    everything = [
        {**entry, "rivals": sorted(entry["rivals"].values(), key=lambda r: r["host"]), "rival_count": len(entry["rivals"]), "sources": sorted(entry["sources"])}
        for entry in merged.values()
    ]
    everything.sort(key=lambda g: (-g["rival_count"], -(g["authority"] if g["authority"] is not None else -1), g["cc_rank"] or 10**12, g["domain"]))
    has = lambda gap, state: any(s["quality"] == state for s in gap["sites"])  # noqa: E731
    good = [g for g in everything if has(g, quality.GOOD)]
    flagged = [g for g in everything if not has(g, quality.GOOD) and has(g, quality.SPAM)]
    return {
        "sites": sites, "gaps": good[:LINK_ROWS], "flagged": flagged[:LINK_ROWS],
        "funnel": {"found": len(everything), "good": len(good), "flagged": len(flagged), "checking": len(everything) - len(good) - len(flagged), "shared": sum(1 for g in good if g["rival_count"] >= 2)},
        "rivals_total": len(rival_ids), "rivals_with_data": len(with_data), "rivals": sorted(every_rival.values(), key=lambda r: r["host"]),
    }
