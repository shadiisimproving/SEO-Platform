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

from seo.accounts import access
from seo.competitors import change_facts, gaps, profile, quality
from seo.competitors import pairs as pairs_mod
from seo.crawl.store import SMALL_EDIT_WORDS
from seo.competitors.keywords import _iso, require_own
from seo.links.service import OWN
from seo.metrics import weight
from seo.serp import store

KEYWORD_ROWS = 200
MOVE_ROWS = 2000  # "as much data as possible" (2026-11-10): the screen pages through them, so far more than fit at once
LINK_ROWS = 500
MOVE_DAYS = 30
MOVE_PERIODS = (7, 30, 90, 365)


def _sites(conn, site_id: int | None) -> list[dict]:
    if site_id is not None:
        site = require_own(conn, site_id)
        return [{"id": site["id"], "host": site["host"]}]
    visible = set(access.own_site_ids(conn))  # "all sites" is all of *their* sites: totals and "best of mine" count only those
    return [dict(r) for r in conn.execute(text("SELECT id, host FROM sites WHERE kind = :k ORDER BY id"), {"k": OWN}).mappings() if r["id"] in visible]


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


def _mine(conn, sites: list[dict]) -> list[dict]:
    """My own sites' page edits, counted exactly as a rival's, so the two compare. reading_since is the first page ever read:
    the count can't reach further back than that, however long the period."""
    if not sites:
        return []
    ids = [int(s["id"]) for s in sites]
    crawls = profile.crawl_states(conn, ids)
    edits = profile.edits_last_30_days(conn, OWN)
    marks = ",".join(str(i) for i in ids)
    since = dict(conn.execute(text(f"SELECT s.id, MIN(p.first_seen_at) FROM sites s JOIN domains d ON d.host = s.host JOIN pages p ON p.domain_id = d.id WHERE s.id IN ({marks}) GROUP BY s.id")).all())
    # The edits themselves, newest first, for the Competitors table's "See your edits" (2026-11-12): the same 30 days and rule as the count.
    recent: dict[int, list[dict]] = {}
    rows = conn.execute(text(
        "SELECT s.id AS site_id, e.id, e.kind, e.detected_at, e.before_value, e.after_value, e.changed_words, p.url FROM sites s "
        "JOIN domains d ON d.host = s.host JOIN change_events e ON e.domain_id = d.id JOIN pages p ON p.id = e.page_id "
        f"WHERE s.id IN ({marks}) AND e.hidden = 0 AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL 30 DAY ORDER BY e.detected_at DESC, e.id DESC"
    )).mappings().all()
    for r in rows:
        held = recent.setdefault(r["site_id"], [])
        if len(held) < MINE_EDITS:
            held.append({"id": r["id"], "kind": r["kind"], "at": _iso(r["detected_at"]), "url": r["url"], "before": r["before_value"], "after": r["after_value"], "changed_words": r["changed_words"]})
    return [{**site, "display": store.to_display_host(site["host"]), "edits_30d": int(edits.get(site["id"], 0)), "reading_since": _iso(since.get(site["id"])), "crawl": crawls[site["id"]],
             "recent_edits": recent.get(site["id"], [])} for site in sites]


MINE_EDITS = 200  # the newest of my own edits sent with the count; the count itself stays exact


def _card_facts(conn, hosts: list[str]) -> dict[str, dict]:
    """For the Competitors cards (2026-11-16, the owner's benchmark screenshot): what each site says about itself on its home
    page (its title and meta description), and its last 30 days split into pages added and pages edited. Two queries for
    any number of sites. A page coming or going isn't an edit (insights.EDIT_SKIP), so removed pages are counted apart."""
    names = {f"h{n}": host.lower() for n, host in enumerate(dict.fromkeys(hosts))}
    out = {host: {"about": None, "added_30d": 0, "edited_30d": 0, "removed_30d": 0, "moved_30d": 0} for host in names.values()}
    if not names:
        return out
    marks = ",".join(":" + k for k in names)
    # Pages, not change rows: a rewrite saves a title, a meta and a text change and is still one page edited (SEO review #11).
    # A move to another address is counted apart, never as an edit (N3). "Added" isn't counted from the events: it's the
    # profile's rule, by the pages' own dates (insights.added_counts, N1).
    what = "CASE e.kind WHEN 'new_page' THEN 'new_events' WHEN 'page_gone' THEN 'removed_30d' WHEN 'redirect' THEN 'moved_30d' ELSE 'edited_30d' END"
    rows = conn.execute(text(
        f"SELECT d.host, {what} AS what, COUNT(DISTINCT e.page_id) AS n FROM change_events e JOIN domains d ON d.id = e.domain_id "
        f"WHERE d.host IN ({marks}) AND e.hidden = 0 AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL 30 DAY GROUP BY d.host, {what}"
    ), names).mappings()
    for r in rows:
        held = out.get(str(r["host"]).lower())
        if held is None or r["what"] == "new_events":
            continue
        held[r["what"]] += int(r["n"])
    from seo.competitors import insights  # here: insights imports this module's neighbours

    for host, n in insights.added_counts(conn, list(names.values())).items():
        out[host]["added_30d"] = n
    # The home page is the shortest address read on that host that has a title: / beats /fr/ beats /fr/about.
    pages = conn.execute(text(
        "SELECT d.host, p.url, p.title, p.meta_description FROM pages p JOIN domains d ON d.id = p.domain_id "
        f"WHERE d.host IN ({marks}) AND p.title IS NOT NULL AND p.title <> '' ORDER BY d.host, LENGTH(p.url), p.id"
    ), names).mappings()
    for r in pages:
        held = out.get(str(r["host"]).lower())
        if held is not None and held["about"] is None:
            held["about"] = {"url": r["url"], "title": r["title"], "description": r["meta_description"] or None}
    return out


def rivals(engine: Engine, site_id: int | None = None) -> dict:
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        tracked = _tracked_by(conn, sites)
        found = _rivals(conn, sites)
        crawls = profile.crawl_states(conn, [r["id"] for r in found])
        edits = profile.edits_last_30_days(conn)
        my_sites = _mine(conn, sites)
        cards = _card_facts(conn, [r["host"] for r in found] + [s["host"] for s in my_sites])
    for site in my_sites:
        site.update(cards.get(site["host"].lower(), {}))
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
        out.append({**rival, "compared": compared, **counts, "edits_30d": int(edits.get(rival["id"], 0)), "crawl": crawls[rival["id"]], **cards.get(rival["host"].lower(), {})})
    out.sort(key=lambda r: (-((r["they_ahead"] or 0) + (r["not_found"] or 0)), -(r["ranks_on"] or 0), -len(r["sites"]), r["host"]))
    return {"sites": sites, "coverage": _coverage(checks, tracked), "rivals": out, "mine": my_sites}


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


def totals(engine: Engine, site_id: int | None = None) -> dict:
    """All rivals together, each keyword once (competitors-exports W4): a sum over rivals counted a keyword two rivals share twice.

    shared: I rank and at least one rival ranks. i_ahead: I rank above every rival there. they_ahead: a rival above me, or a
    rival ranks where I don't, the same rule and the same rows as keywords() below."""
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        tracked = _tracked_by(conn, sites)
        found = _rivals(conn, sites)
    hosts = {s["id"]: s["host"] for s in sites}
    shared = i_ahead = they_ahead = 0
    for check in store.one_per_keyword(store.latest_checks_many(engine, list(hosts))):
        mine_all = tracked.get(check.keyword_id, set())
        beside = []  # (their row, my best among the sites that rival is linked to)
        for rival in found:
            mine_here = mine_all & _site_ids(rival)
            theirs = check.best_on(rival["host"]) if mine_here else None
            if theirs is not None:
                beside.append((theirs, _best_of_mine(check, mine_here, hosts)[0]))
        if not beside:
            continue
        if any(mine is None or theirs.position < mine.position for theirs, mine in beside):
            they_ahead += 1
        if any(mine is not None for _, mine in beside):
            shared += 1
            if all(mine is not None and mine.position < theirs.position for theirs, mine in beside):
                i_ahead += 1
    return {"shared": shared, "i_ahead": i_ahead, "they_ahead": they_ahead}


def moves(engine: Engine, site_id: int | None = None, days: int = MOVE_DAYS) -> dict:
    """What rivals did lately, newest first: their pages, then ranking moves, each counted once whichever sites watch them."""
    days = days if days in MOVE_PERIODS else MOVE_DAYS
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
            recent = {**names, "days": days}
            where = (
                "FROM change_events e JOIN pages p ON p.id = e.page_id JOIN domains d ON d.id = e.domain_id "
                f"WHERE d.host IN ({','.join(':' + k for k in names)}) AND e.hidden = 0 AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL :days DAY"
            )
            page_changes = conn.execute(text(f"SELECT COUNT(*) {where}"), recent).scalar_one()
            changes = conn.execute(text(f"SELECT e.id, e.page_id, e.kind, e.before_value, e.after_value, e.changed_words, e.detected_at, e.summaries, p.url, d.host {where} ORDER BY e.detected_at DESC, e.id DESC LIMIT :n"), {**recent, "n": MOVE_ROWS}).mappings().all()
            events += [{"rival": by_host[r["host"].lower()], "id": r["id"], "page_id": r["page_id"], "kind": r["kind"], "at": _iso(r["detected_at"]), "url": r["url"], "before": r["before_value"], "after": r["after_value"], "changed_words": r["changed_words"], "summaries": json.loads(r["summaries"]) if isinstance(r["summaries"], str) else r["summaries"]} for r in changes if r["host"].lower() in by_host]
            change_facts.attach(conn, events)
        cutoff = conn.execute(text("SELECT UTC_TIMESTAMP(3) - INTERVAL :days DAY"), {"days": days}).scalar_one()
    history = store.history_many(engine, [s["id"] for s in sites])
    start = _iso(cutoff)
    ranking_moves = 0
    for rival in found:
        linked = _site_ids(rival)
        theirs = [check for check in history if tracked.get(check.keyword_id, set()) & linked]
        recent = [{"rival": rival, **event} for event in profile._ranking_timeline(theirs, rival["host"], [s["host"] for s in rival["sites"]]) if event["at"] >= start]
        ranking_moves += len(recent)
        events += recent
    events.sort(key=lambda e: e["at"], reverse=True)
    events = events[:MOVE_ROWS]
    _attach_my_pages(engine, sites, events)
    return {
        "sites": sites, "days": days, "periods": list(MOVE_PERIODS), "total": page_changes + ranking_moves, "moves": events,
        "blocked": sorted(r["host"] for r in found if crawls[r["id"]]["status"] == "blocked"),
        "not_started": sorted(r["host"] for r in found if crawls[r["id"]]["status"] != "blocked" and not crawls[r["id"]].get("baseline_done")),
    }


MINOR_KINDS = ("meta", "schema")  # the description under the result and structured data: rarely what moves a ranking


def is_minor(event: dict) -> bool:
    """A change a reader can skip at first: a tag few people see, or a text edit of a few words."""
    if event["kind"] in MINOR_KINDS:
        return True
    words = event.get("changed_words")
    return event["kind"] == "content" and words is not None and words < SMALL_EDIT_WORDS


def _attach_my_pages(engine: Engine, sites: list[dict], events: list[dict]) -> None:
    """Why a change matters to me (2026-11-20, "show the data so I can decide"): each row gets `my_page`, the page of mine it
    competes with and that page's Google clicks, and `minor`. A page change competes through its Page vs page pair (the pair
    sharing the most keywords speaks for the page, as on Today); a ranking move through my best page in the same check."""
    if not events or not sites:
        return
    hosts = {s["id"]: s["host"] for s in sites}
    site_of = {_host_key(host): site for site, host in hosts.items()}
    marks = ",".join(str(int(i)) for i in hosts)
    with engine.connect() as conn:
        pairs = conn.execute(text(
            f"SELECT id, site_id, my_url, their_url FROM page_pairs WHERE hidden = 0 AND site_id IN ({marks}) ORDER BY shared_keywords DESC, id"
        )).mappings().all()
        clicks = weight.page_clicks(conn, list(hosts), _path_key)
    beside: dict[str, dict] = {}
    for pair in pairs:
        beside.setdefault(_path_key(pair["their_url"]), pair)

    def mine(site: int, url: str, pair_id: int | None = None) -> dict:
        seen = clicks.get(site, {}).get(_path_key(url))
        return {"url": url, "host": hosts[site], "site_id": site, "pair_id": pair_id, "clicks": seen["clicks"] if seen else None, "clicks_before": seen["before"] if seen else None}

    for event in events:
        event["minor"] = is_minor(event)
        if event["kind"].startswith(("rank_", "ai_")):
            best = event.get("mine") or {}
            site = site_of.get(_host_key(best.get("host") or ""))
            event["my_page"] = mine(site, best["url"]) if site and best.get("url") else None
        else:
            pair = beside.get(_path_key(event["url"])) if event.get("url") else None
            event["my_page"] = mine(pair["site_id"], pair["my_url"], pair["id"]) if pair else None


def _host_key(host: str) -> str:
    return host.lower().removeprefix("www.")


def _path_key(url: str) -> str:
    """One page however it's spelled: http or https, www or not, a last slash or not. Search Console's addresses, a pair's
    and a change's all meet on this."""
    return pairs_mod._page_id(url).rstrip("/")


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
            if gap["authority"] is not None:
                entry.setdefault("scores", []).append((gap["authority"], gap["authority_label"]))
            entry.setdefault("follows", []).append(gap["followed"])
            entry["sources"].update(gap["sources"])
            entry["is_competitor"] = entry["is_competitor"] or gap["is_competitor"]
            entry["sites"].append({
                "id": site["id"], "host": site["host"], "quality": gap["quality"], "reason_words": gap["reason_words"], "flagged_by": gap["flagged_by"],
                "in_consideration": gap["in_consideration"], "lost_link": gap["lost_link"], "kept": gap["kept"], "old_link": gap["old_link"],
            })
    gaps.pick_scores(merged.values())  # one tool's score per domain, never the biggest number of any tool (SEO review #7)
    for entry in merged.values():
        entry["followed"] = gaps.merge_followed(entry.pop("follows", []))
    everything = [
        {**entry, "rivals": sorted(entry["rivals"].values(), key=lambda r: r["host"]), "rival_count": len(entry["rivals"]), "sources": sorted(entry["sources"])}
        for entry in merged.values()
    ]
    scale = gaps.order_by_scale(everything, "rival_count")
    has = lambda gap, state: any(s["quality"] == state for s in gap["sites"])  # noqa: E731
    # A domain good for a site only through links last seen 6+ months before their file (gaps.old_link) is probably gone: it
    # is counted apart, as on Link gaps, and listed only when asked for (final re-check 2026-11-18, 3.4).
    current = lambda gap: any(s["quality"] == quality.GOOD and not s["old_link"] for s in gap["sites"])  # noqa: E731
    good = [g for g in everything if current(g)]
    old = [g for g in everything if not current(g) and has(g, quality.GOOD)]
    flagged = [g for g in everything if not has(g, quality.GOOD) and has(g, quality.SPAM)]
    return {
        "sites": sites, "gaps": good[:LINK_ROWS], "old": old[:LINK_ROWS], "flagged": flagged[:LINK_ROWS],
        "funnel": {"found": len(everything), "good": len(good), "old": len(old), "flagged": len(flagged), "checking": len(everything) - len(good) - len(old) - len(flagged),
                   "shared": sum(1 for g in good if g["rival_count"] >= 2)},
        "score_scale": scale, "rivals_total": len(rival_ids), "rivals_with_data": len(with_data), "rivals": sorted(every_rival.values(), key=lambda r: r["host"]),
    }
