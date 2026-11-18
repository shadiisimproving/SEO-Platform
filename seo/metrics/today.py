"""Today, worked out when it's opened, because nothing is sent out: how results are going, what to do first, what moved, and what rivals changed."""
from __future__ import annotations

import json
import re
from math import comb
from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.accounts import access
from seo.collectors.common import digest
from seo.collectors.jobs import ALERT_KIND, NAMES
from seo.competitors.pairs import _page_id
from seo.core.errors import Refused
from seo.metrics import ga4_checks, search
from seo.metrics import leads as lead_rules
from seo.metrics.service import Scope

CLARITY_LIMIT_HOURS = 72
CLARITY_WARN_HOURS = 48
LANE_STALE_MINUTES = {"crawl": 30, "refresh": 30, "collectors": 30}
SEVERITY = {"crit": 0, "warn": 1, "info": 2}
ALERT_KIND_SEARCH = "search_drop"  # seo.insights.engine.ALERT_KIND, the big drops Insights raises
# Its stored sentences (seo.insights.engine). Rows saved before 2026-11-11 say them the old way ("/x/ lost 40% of its Google
# clicks", "About 12 clicks a month at stake. See Search → Insights."), so both wordings are read, and said the new way.
_SEARCH_DROP_TITLE = re.compile(r"^(.+?)(?: lost (\d+)% of its Google clicks|: −(\d+)% Google clicks)$")
_SEARCH_STAKE = re.compile(r"^(?:About (\d+) clicks a month|~(\d+) clicks/month) at stake")

MOVE_PERCENT = 20  # a page shown under Going down or Going up moved at least this much...
# ...and by at least this many clicks a week: 2% of the site's own weekly clicks, never under 5. A fixed 20 hid a page going
# 5 → 80 on a small site and showed 20 → 16 (4 clicks, noise) as a fall (daily-monitoring F10, 2026-11-17).
MOVE_FLOOR_MIN, MOVE_FLOOR_SHARE = 5, 0.02
WEEK_TO_MONTH = 30 / 7  # a week's clicks lost, said as clicks a month like every other row of the to-do list
BIG_DROP_PERCENT, BIG_DROP_MIN_CLICKS, BIG_DROPS_SHOWN = 30, 50, 3  # a page that joins the to-do list
KEYWORD_MIN_PLACES, KEYWORD_MIN_IMPRESSIONS = 3, 50
LEADS_DAYS, LEADS_MIN_BEFORE, LEADS_CHANCE = 28, 5, 0.05  # leads falling further than chance explains at that count
MOVES_SHOWN, RIVAL_ROWS = 4, 5
SEEN_DROP_DAYS = 7  # a drop marked as seen comes back with the next week's numbers, if it's still there

# What is being lost decides the order, not only how an alert was labelled.
LOSING_VISITORS, LOSING_RESULTS, LOST_FOR_GOOD_SOON, DATA_STOPPED, OTHER, INFORMATION = 1, 2, 3, 4, 5, 6
_SITE_DOWN_NOW = {"start_page_down", "start_page_noindex", "robots_down", "ssl_expired", "ssl_error"}
# A domain or certificate that ends within this many days can take the whole site offline: it is serious, and goes first.
EXPIRY_CRIT_DAYS = 14
_EXPIRY = ("ssl_expiry", "domain_expiry")


def _expiring_soon(kind: str, detail: dict | None) -> bool:
    days = (detail or {}).get("days")
    if kind == "health_site":  # the health test says so in its own words: the certificate ends within 14 days
        return "ssl_expiring" in ((detail or {}).get("site") or [])
    return kind in _EXPIRY and isinstance(days, int) and days <= EXPIRY_CRIT_DAYS


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


def _site_filter(site_id: int | None) -> tuple[str, dict]:
    if site_id:
        access.require_site(site_id)  # chosen access: one of their sites
        return "AND s.id = :s", {"s": site_id}
    values: dict = {}
    return access.site_clause("s.id", values).replace(" AND", "AND", 1), values  # "all sites" is all of *their* sites


def _rank(kind: str, severity: str, detail: dict | None) -> int:
    detail = detail or {}
    if severity == "info":
        return INFORMATION
    if kind == "uptime_down":
        return LOSING_VISITORS if detail.get("state") != "back" else OTHER
    if kind in _EXPIRY:
        return LOSING_VISITORS if severity == "crit" or _expiring_soon(kind, detail) else LOST_FOR_GOOD_SOON
    if kind == "health_site":  # a certificate ending within 14 days (ssl_expiring) can take the site offline too
        return LOSING_VISITORS if (_SITE_DOWN_NOW | {"ssl_expiring"}) & set(detail.get("site") or []) else LOST_FOR_GOOD_SOON
    if kind in ("page_drop", "backlink_lost", "search_drop"):
        return LOSING_RESULTS
    if kind == "clarity_gap":
        return LOST_FOR_GOOD_SOON
    if kind == ALERT_KIND:
        return DATA_STOPPED
    return OTHER


def _reason(item: dict) -> str:
    """Why a row is where it is in the list, as one short tag the screen words (today-view.js REASONS)."""
    kind, rank = item["kind"], item.get("rank")
    if item.get("reason"):
        return item["reason"]
    if kind == "leads_drop":
        return "losing_leads"
    if kind in _EXPIRY:
        return "offline" if (item.get("title") or "").endswith("has expired") else "may_go_offline"
    if rank == LOSING_VISITORS:
        return "offline"
    if kind == "backlink_lost":
        return "losing_link"
    if rank == LOSING_RESULTS:
        return "losing_clicks"
    if kind == "clarity_gap":
        return "data_lost"
    if kind in (ALERT_KIND, "job_dead"):
        return "data_stopped"
    if kind == "health_site":
        return "site_problem"
    if rank == INFORMATION or item["severity"] == "info":
        return "info"
    if kind in ("search_finding", "ai_overview"):
        return "chance"
    return "check"


def _link(kind: str) -> str:
    if kind == ALERT_KIND:
        return "#settings"
    if "backlink" in kind:
        return "#backlinks"
    if kind in ("search_drop", "search_finding"):
        return "#insights"
    return "#health/uptime" if kind in ("uptime_down", "ssl_expiry", "domain_expiry") else "#health/test"


def _attention(engine: Engine, site_id: int | None) -> list[dict]:
    clause, values = _site_filter(site_id)
    items = []
    with engine.connect() as conn:
        for row in conn.execute(text(f"SELECT a.*, s.host FROM alerts a JOIN sites s ON s.id = a.site_id WHERE a.acknowledged_at IS NULL {clause}"), values).mappings().all():
            detail = row["detail"]
            if isinstance(detail, str):
                detail = json.loads(detail or "{}")
            kind = row["kind"]
            item = {
                "id": f"alert-{row['id']}", "alert_ids": [row["id"]], "severity": "crit" if _expiring_soon(kind, detail) else row["severity"], "kind": kind, "host": row["host"], "title": row["title"], "rank": _rank(kind, row["severity"], detail), "site_codes": (detail or {}).get("site"),
                "detail": (detail or {}).get("error") or (detail or {}).get("detail") or "", "link": _link(kind), "created_at": _iso(row["created_at"]),
            }
            if kind in _EXPIRY and isinstance((detail or {}).get("days"), int):
                item["expires_in"] = detail["days"]  # the sooner one goes first
            if kind == "health_site" and _expiring_soon(kind, detail) and not (_SITE_DOWN_NOW & set((detail or {}).get("site") or [])):
                item["reason"] = "may_go_offline"
            stake = _SEARCH_STAKE.match(item["detail"]) if kind == ALERT_KIND_SEARCH else None
            if stake:
                n = int(stake.group(1) or stake.group(2))
                item["stake"] = n
                item["detail"] = f"~{n} clicks/month at stake"
                item["words"] = {"detail": ["~{n} clicks/month at stake", {"n": n}]}
            drop = _SEARCH_DROP_TITLE.match(item["title"] or "") if kind == ALERT_KIND_SEARCH else None
            if drop:
                path, percent = drop.group(1), int(drop.group(2) or drop.group(3))
                item["title"] = f"{path}: −{percent}% Google clicks"
                item.setdefault("words", {})["title"] = ["{path}: −{percent}% Google clicks", {"path": path, "percent": percent}]
            if kind == ALERT_KIND_SEARCH and (detail or {}).get("finding_key"):
                found = conn.execute(text("SELECT kind, evidence FROM search_findings WHERE site_id = :s AND finding_key = :k ORDER BY id DESC LIMIT 1"), {"s": row["site_id"], "k": detail["finding_key"]}).mappings().first()
                if found:
                    evidence = json.loads(found["evidence"]) if isinstance(found["evidence"], str) else found["evidence"]
                    _with_cause(item, _evidence_cause(found["kind"], evidence))
            items.append(item)
        # Clarity only gives the last 3 days, so a gap becomes permanent. Say how long is left, counted from the last good pull.
        for row in conn.execute(
            text(
                f"SELECT ss.site_id, s.host, TIMESTAMPDIFF(HOUR, ss.last_ok_at, UTC_TIMESTAMP(3)) AS hours FROM site_sources ss JOIN sites s ON s.id = ss.site_id "
                f"WHERE ss.source = 'clarity' AND ss.not_used = 0 AND ss.secret IS NOT NULL AND ss.last_ok_at IS NOT NULL {clause}"
            ), values).mappings().all():
            if row["hours"] >= CLARITY_WARN_HOURS:
                left = CLARITY_LIMIT_HOURS - row["hours"]
                items.append({
                    "id": f"clarity-{row['site_id']}", "severity": "crit" if left <= 12 else "warn", "kind": "clarity_gap", "host": row["host"],
                    "title": f"Clarity data lost in {left} h" if left > 0 else "Clarity data is being lost",
                    "detail": "Clarity keeps only 3 days of data.", "link": "#settings", "created_at": None, "rank": LOST_FOR_GOOD_SOON,
                    "words": {"title": ["Clarity data lost in {n} h", {"n": left}] if left > 0 else ["Clarity data is being lost", {}], "detail": ["Clarity keeps only 3 days of data.", {}]},
                })
        for row in conn.execute(text("SELECT kind, last_error, id FROM jobs WHERE status = 'dead' AND finished_at > UTC_TIMESTAMP(3) - INTERVAL 7 DAY ORDER BY id DESC LIMIT 5")).mappings().all():
            if not site_id and access.current().full:  # app-wide job errors may name any site: for full access only
                items.append({"id": f"job-{row['id']}", "severity": "warn", "kind": "job_dead", "host": None, "title": f"A background job stopped: {row['kind']}", "detail": (row["last_error"] or "")[:200], "link": "#today", "created_at": None, "rank": OTHER})
    return _one_row_per_certificate(_one_row_per_failing_source(items))


def _one_row_per_certificate(items: list[dict]) -> list[dict]:
    """The uptime check and the health test can both report one certificate. The uptime row has the date, so it stays and speaks for both."""
    dated = {item["host"]: item for item in items if item["kind"] == "ssl_expiry"}
    kept = []
    for item in items:
        codes = set(item.pop("site_codes", None) or [])
        if item["kind"] == "health_site" and codes and codes <= {"ssl_expiring", "ssl_expired"} and item["host"] in dated:
            dated[item["host"]]["alert_ids"].extend(item["alert_ids"])
        else:
            kept.append(item)
    return kept


def _one_row_per_failing_source(items: list[dict]) -> list[dict]:
    """One expired Google connection can stop every site. That's one thing to fix, so it's one row, and marking it as seen covers them all."""
    merged, first = [], {}
    for item in items:
        if item["kind"] != ALERT_KIND:
            merged.append(item)
        elif item["title"] not in first:
            first[item["title"]] = item
            merged.append(item)
        else:
            first[item["title"]]["alert_ids"].append(item["alert_ids"][0])
    for title, item in first.items():
        count = len(item["alert_ids"])
        if count > 1:
            item.update(title=f"{title} on {count} sites", host=None)
    return merged


RIVAL_KINDS_LEFT_OUT = ("new_page",)  # a page paired with mine was there before; hidden events are the noise rules' (seo.crawl.noise)


def _changes(engine: Engine, site_id: int | None, paired: set[str]) -> tuple[list[dict], int]:
    """What competitors changed in the last 7 days on pages paired with mine, newest first, and how many other changes
    they made. Only competitors of this site, when one site is picked. The pairing is applied in SQL before the cap: the
    newest 500 of all changes were mostly other pages, so a paired page's edit was cut before it was looked at (W0)."""
    # Paused competitors are left out. With all my sites, a rival counts while any site still reads its pages.
    join = "JOIN site_competitors c ON c.competitor_id = s.id AND c.site_id = :s AND c.tracking <> 'off' " if site_id else ""
    values: dict = {"s": site_id} if site_id else {}
    with engine.connect() as conn:
        # With all sites: rivals of *their* sites only.
        join = join or f"JOIN (SELECT DISTINCT competitor_id FROM site_competitors WHERE tracking <> 'off'{access.site_clause('site_id', values, conn)}) c ON c.competitor_id = s.id "
        source = (
            "FROM change_events e JOIN pages p ON p.id = e.page_id "
            f"JOIN domains d ON d.id = e.domain_id JOIN sites s ON s.host = d.host AND s.kind = 'competitor' {join}"
            f"WHERE e.detected_at > UTC_TIMESTAMP(3) - INTERVAL 7 DAY AND e.hidden = 0 AND e.kind NOT IN ({', '.join(repr(k) for k in RIVAL_KINDS_LEFT_OUT)}) "
        )
        touched = conn.execute(text(f"SELECT p.id, p.url, COUNT(DISTINCT e.id) AS n {source}GROUP BY p.id, p.url"), values).mappings().all()
        ids = [int(r["id"]) for r in touched if _page_id(r["url"]) in paired]
        other = sum(int(r["n"]) for r in touched if _page_id(r["url"]) not in paired)
        rows = []
        if ids:
            rows = conn.execute(
                text(
                    f"SELECT DISTINCT e.id, e.kind, e.detected_at, e.summaries, p.url, s.host {source}"
                    f"AND e.page_id IN ({','.join(str(i) for i in ids)}) ORDER BY e.detected_at DESC LIMIT 500"
                ),
                values,
            ).mappings().all()
    changes = [{"id": row["id"], "kind": row["kind"], "host": row["host"], "url": row["url"], "when": _iso(row["detected_at"]), "summaries": json.loads(row["summaries"]) if isinstance(row["summaries"], str) else row["summaries"]} for row in rows]
    return changes, other


def _rival_changes(engine: Engine, site_id: int | None) -> tuple[list[dict], int]:
    """Edits on a rival page that ranks beside one of ours come first, naming our page. Everything else is only counted."""
    values: dict = {}
    clause, values = ("AND p.site_id = :s", {"s": site_id}) if site_id else (access.site_clause("p.site_id", values), values)
    with engine.connect() as conn:
        pairs = conn.execute(
            text(f"SELECT p.id, p.site_id, p.my_url, p.their_url, p.shared_keywords, me.host my_host FROM page_pairs p JOIN sites me ON me.id = p.site_id WHERE p.hidden = 0 {clause} ORDER BY p.shared_keywords DESC, p.id"),
            values,
        ).mappings().all()
    beside: dict[str, dict] = {}
    for pair in pairs:
        beside.setdefault(_page_id(pair["their_url"]), pair)  # the pair sharing the most keywords speaks for that page
    changes, other = _changes(engine, site_id, set(beside))
    rows, shown_pages = [], set()
    for change in changes:
        page = _page_id(change["url"])
        pair = beside.get(page)
        if pair is None:
            other += 1
        elif page not in shown_pages:
            shown_pages.add(page)
            rows.append({**change, "pair_id": pair["id"], "site_id": pair["site_id"], "my_url": pair["my_url"], "my_host": pair["my_host"]})
    return rows[:RIVAL_ROWS], other + max(0, len(rows) - RIVAL_ROWS)


def _path(url: str) -> str:
    return urlsplit(url).path or "/"


# Search Console's fresh days aren't final and come in low, so Today compares final days only: before fresh_from.
_FINAL = "day < COALESCE((SELECT fresh_from FROM site_sources WHERE site_id = :s AND source = 'gsc'), '9999-12-31')"


def _gsc_final_day(conn, table: str, site_id: int):
    return conn.execute(text(f"SELECT MAX(day) FROM {table} WHERE site_id = :s AND {_FINAL}"), {"s": site_id}).scalar()


def _own_sites(conn, site_id: int | None):
    clause, values = _site_filter(site_id)
    return conn.execute(text(f"SELECT s.id, s.host FROM sites s WHERE s.kind = 'own' {clause} ORDER BY s.host"), values).mappings().all()


def move_floor(site_clicks_a_week: int) -> int:
    """How many clicks a week a page must move by to be named under Going up or Going down, for a site of this size."""
    return max(MOVE_FLOOR_MIN, round(site_clicks_a_week * MOVE_FLOOR_SHARE))


def likely_cause(r: dict, down: bool = True) -> dict | None:
    """One likely reason a page lost clicks, by the same rules Insights uses for a page (seo.insights.movement._why):
    it ranks lower, fewer people search, or fewer click at the same place. Only said when the numbers show it."""
    from seo.insights import rules

    p0, p1, i0, i1 = r.get("position_before"), r.get("position"), r.get("impressions_before"), r.get("impressions")
    c0, c1 = r.get("clicks_before"), r.get("clicks")
    if not down:
        return None
    facts = {"position_before": p0, "position": p1, "impressions_before": i0, "impressions": i1}
    if p0 is not None and p1 is not None and p1 - p0 >= rules.PLACES_LOST:
        return {"why": "ranking", **facts}
    if i0 and i1 is not None and i1 / i0 <= rules.FEWER_SEARCHES:
        return {"why": "demand", **facts}
    if i0 and i1 and c0 is not None and c1 is not None and c1 / i1 < c0 / i0:
        return {"why": "appeal", **facts}
    return None


_CAUSE_WORDS = {
    "ranking": "Likely cause: lost places, avg pos {a} → {b}",
    "demand": "Likely cause: fewer searches, {a} → {b} impressions",
    "appeal": "Likely cause: lower click rate at the same place",
}


def cause_words(cause: dict | None) -> list | None:
    if not cause:
        return None
    if cause["why"] == "ranking":
        return [_CAUSE_WORDS["ranking"], {"a": round(cause["position_before"], 1), "b": round(cause["position"], 1)}]
    if cause["why"] == "demand":
        return [_CAUSE_WORDS["demand"], {"a": int(cause["impressions_before"]), "b": int(cause["impressions"])}]
    return [_CAUSE_WORDS["appeal"], {}]


def _week_bounds(end: date) -> dict:
    return {"from": (end - timedelta(days=6)).isoformat(), "to": end.isoformat(), "before_from": (end - timedelta(days=13)).isoformat(), "before_to": (end - timedelta(days=7)).isoformat()}


def _page_moves(engine: Engine, site_id: int | None, windows: list | None = None) -> list[dict]:
    """A page losing or gaining a lot of clicks, last 7 days against the 7 before. Search Console only, so it says so.

    Each site uses its own last day of data, or a site whose data stopped would look like it fell. A week with missing days isn't compared at all.
    How much a page must move depends on the site's size (move_floor), so a page going 5 → 80 on a small site is named,
    and a page with nothing the week before is "new", never a made-up percentage.
    """
    moves = []
    with engine.connect() as conn:
        for site in _own_sites(conn, site_id):
            end = _gsc_final_day(conn, "gsc_page", site["id"])
            if end is None:
                continue
            now_from, before_from, before_to = end - timedelta(days=6), end - timedelta(days=13), end - timedelta(days=7)
            bounds = {"nf": now_from, "bt": before_to, "bf": before_from, "e": end, "s": site["id"]}
            days = conn.execute(text("SELECT COUNT(DISTINCT IF(day >= :nf, day, NULL)) now_d, COUNT(DISTINCT IF(day <= :bt, day, NULL)) was_d, SUM(IF(day >= :nf, clicks, 0)) now_c, SUM(IF(day <= :bt, clicks, 0)) was_c FROM gsc_page WHERE site_id = :s AND day BETWEEN :bf AND :e"), bounds).mappings().first()
            if days["now_d"] < days["was_d"]:
                continue
            # Only full weeks: the page table is read a day at a time, newest first, so after a new connection the week
            # before is missing or partly stored. Compared, that makes every page "New" or a made-up gain. The period rule's
            # own check (period._first_day: stored rows or days read, so a quiet day counts) must reach the week before.
            first = conn.execute(text(
                "SELECT LEAST(COALESCE((SELECT MIN(day) FROM gsc_page WHERE site_id = :s), '9999-12-31'), "
                "COALESCE((SELECT MIN(day) FROM coverage WHERE site_id = :s AND source = 'gsc'), '9999-12-31'))"
            ), {"s": site["id"]}).scalar()
            if first is None or str(first) > before_from.isoformat():
                continue
            if windows is not None:
                windows.append(_week_bounds(end))
            floor = move_floor(max(int(days["now_c"] or 0), int(days["was_c"] or 0)))
            rows = conn.execute(
                text(
                    "SELECT MAX(page) page, page_hash, SUM(IF(day >= :nf, clicks, 0)) now_c, SUM(IF(day <= :bt, clicks, 0)) was_c, "
                    "SUM(IF(day >= :nf, impressions, 0)) now_i, SUM(IF(day <= :bt, impressions, 0)) was_i, "
                    "SUM(IF(day >= :nf, position * impressions, 0)) now_w, SUM(IF(day <= :bt, position * impressions, 0)) was_w FROM gsc_page "
                    "WHERE site_id = :s AND day BETWEEN :bf AND :e GROUP BY page_hash "
                    "HAVING ABS(SUM(IF(day >= :nf, clicks, 0)) - SUM(IF(day <= :bt, clicks, 0))) >= :floor"
                ),
                {**bounds, "floor": floor},
            ).mappings().all()
            for row in rows:
                was, now = int(row["was_c"]), int(row["now_c"])
                change = round((now - was) / was * 100) if was else None
                if change is not None and abs(change) < MOVE_PERCENT:
                    continue
                shown_now, shown_was = int(row["now_i"] or 0), int(row["was_i"] or 0)
                facts = {
                    "clicks": now, "clicks_before": was, "impressions": shown_now, "impressions_before": shown_was,
                    "position": float(row["now_w"]) / shown_now if shown_now else None, "position_before": float(row["was_w"]) / shown_was if shown_was else None,
                }
                moves.append({
                    "type": "page", "page": row["page"], "url": row["page"], "path": _path(row["page"]), "host": site["host"], "site_id": site["id"], "change": change, "new": not was,
                    "clicks": now, "was": was, "key": digest("drop", str(site["id"]), row["page_hash"]), "cause": likely_cause(facts, down=now < was), **_week_bounds(end),
                })
    return moves


def _keyword_moves(engine: Engine, site_id: int | None) -> list[dict]:
    """Search Console's own average position, weighted by impressions. Scraped checks stay out: they can't be compared across tools."""
    moves = []
    with engine.connect() as conn:
        for site in _own_sites(conn, site_id):
            end = _gsc_final_day(conn, "gsc_query", site["id"])
            if end is None:
                continue
            rows = conn.execute(
                text(
                    "SELECT MAX(query) query, SUM(IF(day >= :nf, impressions, 0)) now_i, SUM(IF(day >= :nf, position * impressions, 0)) now_p, "
                    "SUM(IF(day <= :bt, impressions, 0)) was_i, SUM(IF(day <= :bt, position * impressions, 0)) was_p FROM gsc_query "
                    "WHERE site_id = :s AND day BETWEEN :bf AND :e GROUP BY query_hash "
                    f"HAVING SUM(IF(day >= :nf, impressions, 0)) >= {KEYWORD_MIN_IMPRESSIONS} AND SUM(IF(day <= :bt, impressions, 0)) >= {KEYWORD_MIN_IMPRESSIONS}"
                ),
                {"nf": end - timedelta(days=6), "bt": end - timedelta(days=7), "bf": end - timedelta(days=13), "e": end, "s": site["id"]},
            ).mappings().all()
            tracked = {
                search._match(r[1]): r[0] for r in conn.execute(
                    text("SELECT k.id, k.keyword FROM keywords k JOIN site_keywords sk ON sk.keyword_id = k.id WHERE sk.site_id = :s"), {"s": site["id"]}
                ).all()
            }
            for row in rows:
                was, now = float(row["was_p"]) / float(row["was_i"]), float(row["now_p"]) / float(row["now_i"])
                if abs(was - now) >= KEYWORD_MIN_PLACES:
                    moves.append({
                        "type": "keyword", "query": row["query"], "host": site["host"], "site_id": site["id"], "was": round(was), "now": round(now), "places": round(was - now, 1),
                        # Search Console's average position over each week, said as "avg pos 4.4 → 8.6", never as a rank "#4 → #9".
                        "was_pos": round(was, 1), "now_pos": round(now, 1), **_week_bounds(end),
                        "keyword_id": tracked.get(search._match(row["query"])),  # set when it's one of the site's keywords: the link opens it there
                    })
    return moves


def _mix(pages: list[dict], keywords: list[dict]) -> list[dict]:
    """Biggest first of each kind, taking turns, so one kind can't push the other out."""
    pages = sorted(pages, key=lambda move: -abs(move["was"] - move["clicks"]))
    keywords = sorted(keywords, key=lambda move: -abs(move["places"]))
    mixed = []
    while (pages or keywords) and len(mixed) < MOVES_SHOWN:
        if pages:
            mixed.append(pages.pop(0))
        if keywords and len(mixed) < MOVES_SHOWN:
            mixed.append(keywords.pop(0))
    return mixed


def _seen_drops(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return {row[0] for row in conn.execute(text("SELECT item_key FROM today_seen WHERE hidden_until > UTC_DATE()")).all()}


def mark_drop_seen(engine: Engine, key, seen: bool = True) -> None:
    if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{16,64}", key):
        raise Refused("That isn't an item on Today.")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM today_seen WHERE item_key = :k OR hidden_until <= UTC_DATE()"), {"k": key})
        if seen:
            conn.execute(text("INSERT INTO today_seen (item_key, hidden_until) VALUES (:k, UTC_DATE() + INTERVAL :d DAY)"), {"k": key, "d": SEEN_DROP_DAYS})


def _is_big_drop(move: dict) -> bool:
    return move["change"] is not None and move["change"] <= -BIG_DROP_PERCENT and move["was"] >= BIG_DROP_MIN_CLICKS


def _with_cause(row: dict, cause: dict | None) -> dict:
    words = cause_words(cause)
    if words:
        row["cause"] = cause
        row.setdefault("words", {})["cause"] = words
    return row


def _drop_row(move: dict) -> dict:
    return _with_cause({
        "id": f"drop-{move['key']}", "seen_key": move["key"], "kind": "page_drop", "severity": "crit" if move["change"] <= -50 else "warn", "rank": LOSING_RESULTS, "host": move["host"],
        "title": f"{move['path']}: −{abs(move['change'])}% Google clicks", "detail": f"Week on week: {move['was']} → {move['clicks']}", "page": move["page"], "link": "#overview", "created_at": None,
        "words": {"title": ["{path}: −{percent}% Google clicks", {"path": move["path"], "percent": abs(move["change"])}], "detail": ["Week on week: {was} → {now}", {"was": move["was"], "now": move["clicks"]}]},
        "open": {"page": move["page"], "range": "7d"}, "stake": round((move["was"] - move["clicks"]) * WEEK_TO_MONTH),
    }, move.get("cause"))


_FINDING_TITLES = {
    "page_down": "{path}: −{percent}% Google clicks",
    "dropped_out": "{path} dropped out of Google",
    "decay": "{path} is slowly losing clicks",
    "almost": "“{query}” is almost on page 1",
    "top3": "“{query}” is close to the top 3",
    "low_ctr": "“{query}” is clicked less than usual",
    "no_click": "“{query}” is seen but never clicked",
    "compete": "Two of your pages compete for “{query}”",
    "odd_day": "Google clicks fell on {day}",
    "query_down": "“{query}” lost places on Google",
    "segment": "{segment} carries most of the drop in clicks",
    "unstable": "Google keeps moving “{query}” up and down",
    "brand_split": "Non-brand clicks fell {percent}%, hidden by brand searches",
    "slide": "“{query}” is slowly losing places",
    "page_near": "{path} is close to page 1 on many searches",
    "no_page": "“{query}” has no page of its own",
    "topic": "Searches with “{word}” have no strong page",
    "lead_page": "{path} brings leads and is losing clicks",
    "shown_broken": "Google shows {path}, but it's broken",
}


def _finding_row(f: dict) -> dict:
    evidence = f["evidence"]
    segment = evidence.get("segment") or ""
    values = {
        "path": evidence.get("path") or _path(f["page"] or "/"), "percent": abs(evidence.get("percent") or 0), "query": f["query"] or "", "day": evidence.get("day") or "",
        "word": evidence.get("label") or evidence.get("word") or "", "segment": segment.capitalize() if evidence.get("dim") == "device" else segment.upper(),
    }
    return _with_cause({
        "id": f"finding-{f['key']}", "seen_key": f["key"], "kind": "search_finding", "finding": f["kind"], "finding_id": f["id"], "severity": "warn", "stake": round(f["at_stake"]),
        "rank": LOSING_RESULTS if f["group"] in ("changed", "decline") else OTHER, "host": f["host"],
        "title": _FINDING_TITLES.get(f["kind"], "{path}").format(**values), "detail": f"~{round(f['at_stake'])} clicks/month at stake",
        "page": f["page"], "query": f["query"], "keyword_id": evidence.get("keyword_id"), "link": f"#insights/{f['id']}", "created_at": None,
        # The same sentence as parts, so the screen can say it in the reader's language (English key, values apart).
        "words": {"title": [_FINDING_TITLES.get(f["kind"], "{path}"), values], "detail": ["~{n} clicks/month at stake", {"n": round(f["at_stake"])}],
                  **({"segment_dim": evidence.get("dim")} if evidence.get("segment") else {})},
    }, _evidence_cause(f["kind"], evidence))


def _evidence_cause(kind: str | None, evidence: dict | None) -> dict | None:
    """A page drop Insights found already holds its numbers: the same likely cause is said from them."""
    if kind != "page_down" or not evidence:
        return None
    return likely_cause(evidence)


_AIO_TITLES = {
    "aio_uncited": ("“{keyword}”: Google's AI Overview no longer cites you", "warn", LOSING_RESULTS),
    "aio_appeared": ("“{keyword}”: an AI Overview now shows, without you", "warn", OTHER),
    "aio_cited": ("“{keyword}”: Google's AI Overview now cites you", "info", INFORMATION),
    "aio_cited_new": ("“{keyword}”: a new AI Overview cites you", "info", INFORMATION),
    "aio_gone": ("“{keyword}”: the AI Overview has gone", "info", INFORMATION),
}


def _ai_overview_rows(engine: Engine, site_id: int | None) -> list[dict]:
    """What changed in Google's AI Overview on a tracked keyword between its last two checks that could read it, this week."""
    from seo.insights import aio

    with engine.connect() as conn:
        now = conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar()
    rows = []
    for change in aio.changes(engine, site_id, now, days=SEEN_DROP_DAYS):
        template, severity, rank = _AIO_TITLES[change["kind"]]
        key = digest("aio", str(change["site_id"]), change["keyword"], change["kind"], change["at"].isoformat())
        rows.append({
            "id": f"aio-{key}", "seen_key": key, "kind": "ai_overview", "change": change["kind"], "severity": severity, "rank": rank, "host": change["host"],
            "title": template.format(keyword=change["keyword"]), "detail": "Last two AI Overview checks",
            "query": change["keyword"], "keyword_id": change.get("keyword_id"), "link": "#competitors/ai", "created_at": _iso(change["at"]),
            "words": {"title": [template, {"keyword": change["keyword"]}], "detail": ["Last two AI Overview checks", {}]},
        })
    return rows


def _order(item: dict) -> tuple:
    """What is being lost first, then how serious, then how much: within one kind of loss, more clicks at stake a month go
    first, so a 463-click drop is never under a 58-click one (daily-monitoring F6). Leads lost have their own place at the
    top of what is being lost, whatever their severity: a lead is worth more than any number of clicks, and clicks and
    leads can't be weighed on one scale (code review 2026-11-17)."""
    expires = item.get("expires_in", 10**6 if item.get("reason") == "may_go_offline" else -1)
    leads_first = 0 if item["kind"] == "leads_drop" else 1
    return (item["rank"], leads_first, SEVERITY.get(item["severity"], 3), -(item.get("stake") or 0), expires)


def _below_chance(now: int, was: int) -> bool:
    """Leads come one at a time, so a fall means something only when chance can't explain it: with equal periods, each of
    the now + was leads is as likely in either one, and fewer than 5% of splits are this uneven (28 → 14 is; 4 → 1 isn't)."""
    n = now + was
    if was < LEADS_MIN_BEFORE or now >= was:
        return False
    return sum(comb(n, k) for k in range(now + 1)) / 2**n < LEADS_CHANCE


def _leads_drops(engine: Engine, site_id: int | None) -> list[dict]:
    """A site whose GA4 leads fell more than chance explains, the last 28 days against the 28 before, each ending on GA4's own last day."""
    rows = []
    with engine.connect() as conn:
        for site in _own_sites(conn, site_id):
            kind = lead_rules.kind(engine, [site["id"]])
            col = lead_rules.count_sql(kind)
            ga4 = conn.execute(text(f"SELECT MIN(day) a, MAX(day) b, SUM({col} > 0) leads_rows FROM ga4_source_daily WHERE site_id = :s"), {"s": site["id"]}).mappings().first()
            if not ga4["b"] or not ga4["leads_rows"]:
                continue
            end = ga4["b"]
            start, before_start = end - timedelta(days=LEADS_DAYS - 1), end - timedelta(days=2 * LEADS_DAYS - 1)
            if ga4["a"] > before_start:
                continue  # no full period before to compare with
            if any(c["kind"] in ("rose", "fell") for c in ga4_checks.crossing(ga4_checks.tracking_changes(engine, site["id"], kind), before_start, end)):
                continue  # GA4 counted them another way in one of the periods: not a fall in leads (W1). Key events that
                # stopped altogether still raise it: a broken form and a broken tag both need the owner.
            found = conn.execute(
                text(f"SELECT SUM(IF(day >= :a, {col}, 0)) now_l, SUM(IF(day < :a, {col}, 0)) was_l FROM ga4_source_daily WHERE site_id = :s AND day BETWEEN :ba AND :b"),
                {"s": site["id"], "a": start, "ba": before_start, "b": end},
            ).mappings().first()
            now, was = round(float(found["now_l"] or 0)), round(float(found["was_l"] or 0))
            if not _below_chance(now, was):
                continue
            percent = round((was - now) / was * 100)
            word = "Leads" if kind == lead_rules.LEADS else "Key events"
            # One key per site, as a page drop has one per page: GA4's newest day moves daily, so a key holding it brought
            # a drop marked as seen back the next day. Seen, it stays hidden for SEEN_DROP_DAYS, then comes back if still there.
            key = digest("leads", str(site["id"]))
            values = {"percent": percent, "was": was, "now": now}
            rows.append({
                "id": f"leads-{key}", "seen_key": key, "kind": "leads_drop", "severity": "crit" if percent >= 50 else "warn", "rank": LOSING_RESULTS, "host": site["host"],
                "title": f"{word} fell {percent}%: {was} → {now}", "detail": "Last 28 days vs the 28 before", "link": "#conversions", "created_at": None,
                "leads": now, "leads_was": was, "from": start.isoformat(), "to": end.isoformat(), "lead_kind": kind,
                "words": {"title": [word + " fell {percent}%: {was} → {now}", values], "detail": ["Last 28 days vs the 28 before", {}]},
            })
    return rows


def _todo(engine: Engine, site_id: int | None, moves: list[dict]) -> tuple[list[dict], set[str]]:
    """One list, ranked by what is being lost. Returns which pages it names, so they aren't repeated under Going down."""
    seen = _seen_drops(engine)
    drops = sorted((move for move in moves if _is_big_drop(move) and move["key"] not in seen), key=lambda move: move["clicks"] - move["was"])[:BIG_DROPS_SHOWN]
    rows = _attention(engine, site_id) + _leads_drops(engine, site_id) + [_drop_row(move) for move in drops]
    named = {move["page"] for move in drops}
    from seo.insights import service as insights  # the biggest Search insights, one per query or page

    rows += [_finding_row(f) for f in insights.today_rows(engine, site_id) if f["key"] not in seen and not (f["page"] and f["page"] in named and f["kind"] == "page_down")]
    rows += [row for row in _ai_overview_rows(engine, site_id) if row["seen_key"] not in seen]
    rows = [row for row in rows if not (row["kind"] == "leads_drop" and row["seen_key"] in seen)]
    rows.sort(key=_order)
    for item in rows:
        item["reason"] = _reason(item)
    return rows, {move["key"] for move in drops}


def _source_health(engine: Engine, site_id: int | None) -> list[dict]:
    clause, values = _site_filter(site_id)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT ss.source, s.host, ss.not_used, ss.connection_id, ss.property, ss.secret IS NOT NULL AS has_secret, ss.last_ok_at, ss.last_error, ss.data_through, "
                f"TIMESTAMPDIFF(MINUTE, ss.last_ok_at, UTC_TIMESTAMP(3)) AS minutes FROM site_sources ss JOIN sites s ON s.id = ss.site_id WHERE s.kind = 'own' {clause} ORDER BY s.host, ss.source"
            ), values).mappings().all()
    health = []
    for row in rows:
        if row["not_used"]:
            continue
        if row["source"] in ("gsc", "ga4") and not (row["connection_id"] and row["property"]):
            continue
        if row["source"] == "clarity" and not row["has_secret"]:
            continue
        if row["last_ok_at"] is None and not row["last_error"] and row["source"] == "pagespeed":
            continue
        health.append({
            "source": row["source"], "name": NAMES.get(row["source"], row["source"]), "host": row["host"], "ok": row["last_error"] is None and row["last_ok_at"] is not None,
            "waiting": row["last_error"] is None and row["last_ok_at"] is None, "minutes": row["minutes"], "error": row["last_error"], "through": row["data_through"].isoformat() if row["data_through"] else None,
        })
    return health


def _lanes(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT lane, TIMESTAMPDIFF(MINUTE, last_finished_at, UTC_TIMESTAMP(3)) AS minutes, last_error FROM lane_runs")).mappings().all()
    return [{"lane": row["lane"], "minutes": row["minutes"], "stale": row["minutes"] is None or row["minutes"] > LANE_STALE_MINUTES.get(row["lane"], 60), "error": row["last_error"]} for row in rows]


def _percent(now, was) -> int | None:
    return round((now - was) / was * 100) if was else None


def _search_args(args: dict | None) -> dict:
    """The period as the shared date range sends it (range, compare, from, to). Today has no hours: 24 hours is 7 days here."""
    args = dict(args or {})
    picked = {"range": args.get("range") or search.DEFAULT_RANGE, "compare": args.get("compare") or "prev", "from": args.get("from"), "to": args.get("to")}
    if picked["range"] == "24h":
        picked["range"] = "7d"
    return picked


def _clicks(engine: Engine, site, args: dict) -> dict:
    """Search Console clicks for the period, worked out by search.resolve: the very definition Overview uses, so the number
    on Today is the one its link opens. Saved days only (Overview may read Google live; both are final days)."""
    scope, window = search.scope_for(engine, {"site_id": site, **args})
    first, last = scope.start, scope.end
    length = (last - first).days + 1
    found = {r["day"]: int(r["c"] or 0) for r in scope.fetch("SELECT day, SUM(clicks) c FROM gsc_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day", first, last)}
    before = {}
    if scope.has_compare:
        before = {r["day"]: int(r["c"] or 0) for r in scope.fetch("SELECT day, SUM(clicks) c FROM gsc_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day", scope.compare_start, scope.compare_end)}
    value = sum(found.values()) if found else None
    was = sum(before.values()) if before and value is not None else None
    points = [
        {"day": (first + timedelta(days=n)).isoformat(), "now": found.get(first + timedelta(days=n)), "was": before.get(scope.compare_start + timedelta(days=n)) if scope.has_compare else None}
        for n in range(length)
    ]
    return {"value": value, "was": was, "change": _percent(value, was) if was is not None else None, "points": points, "window": window, "length": length,
            "through": max(found).isoformat() if found else None}


def _ga4_windows(last_day: date, length: int, compare: str) -> tuple[date, date, date | None, date | None]:
    first = last_day - timedelta(days=length - 1)
    if compare == "none":
        return first, last_day, None, None
    if compare == "yoy":
        return first, last_day, search._year_before(first), search._year_before(last_day)
    return first, last_day, first - timedelta(days=length), first - timedelta(days=1)


def _site_strip(engine: Engine, site_id: int | None, args: dict, length: int) -> list[dict]:
    """Per site, the period against the one before. Blank means no data, never zero.

    Google clicks use the shared period (search.resolve). Visits and leads use a period of the same length ending on GA4's
    own last day: GA4 ends a day or two after Search Console, and counting back from today would make every site look like
    it fell. A site without a full earlier period has nothing fair to compare with, so it shows no change.
    """
    strip = []
    compare = args.get("compare") or "prev"
    with engine.connect() as conn:
        sites = _own_sites(conn, site_id)
    for site in sites:
        kind = lead_rules.kind(engine, [site["id"]])
        col = lead_rules.count_sql(kind)
        row = {"id": site["id"], "host": site["host"], "visits": None, "visits_was": None, "visits_change": None, "visits_note": None, "unusual": None, "leads": None, "leads_was": None, "leads_change": None, "leads_state": "no_ga4", "lead_kind": kind, "lead_changes": [], "other_hosts": [], "clicks": None, "clicks_was": None, "clicks_change": None, "through": None, "visits_through": None, "trend": [], "_daily": {"visits": {}, "leads": {}}}
        with engine.connect() as conn:
            row["alerts"] = int(conn.execute(text("SELECT COUNT(*) FROM alerts WHERE site_id = :s AND acknowledged_at IS NULL"), {"s": site["id"]}).scalar() or 0)
            ga4 = conn.execute(text(f"SELECT MIN(day) first_day, MAX(day) last_day, SUM({col} > 0) leads_rows FROM ga4_source_daily WHERE site_id = :s"), {"s": site["id"]}).mappings().first()
            if ga4["last_day"]:
                a, b, ca, cb = _ga4_windows(ga4["last_day"], length, compare)
                values = {"s": site["id"], "a": a, "b": b, "ca": ca or date(1900, 1, 1), "cb": cb or date(1900, 1, 1)}
                found = conn.execute(
                    text(f"SELECT SUM(IF(day BETWEEN :a AND :b, sessions, 0)) now_v, SUM(IF(day BETWEEN :ca AND :cb, sessions, 0)) was_v, SUM(IF(day BETWEEN :a AND :b, {col}, 0)) now_l, SUM(IF(day BETWEEN :ca AND :cb, {col}, 0)) was_l FROM ga4_source_daily WHERE site_id = :s AND (day BETWEEN :a AND :b OR day BETWEEN :ca AND :cb)"),
                    values,
                ).mappings().first()
                compared = ca is not None and ga4["first_day"] <= ca
                if ca is not None and (compared or int(found["was_v"] or 0)) and ga4_checks.little_before(engine, site["id"], ca, cb, a, b):
                    compared, row["visits_note"] = False, "little_before"  # GA4 recorded almost nothing then (W6)
                row["lead_changes"] = ga4_checks.crossing(ga4_checks.tracking_changes(engine, site["id"], kind), ca or a, b)
                row["unusual"] = ga4_checks.unusual_change(engine, [site["id"]], a, b, ca if compared else None, cb if compared else None)
                row["other_hosts"] = ga4_checks.other_hosts(engine, site["id"])
                row.update(visits=int(found["now_v"] or 0), visits_through=ga4["last_day"].isoformat(), _ga4={"from": a.isoformat(), "to": b.isoformat(), "compare_from": ca.isoformat() if ca else None, "compare_to": cb.isoformat() if cb else None})
                for found_day in conn.execute(text(f"SELECT day, SUM(sessions) v, SUM({col}) l FROM ga4_source_daily WHERE site_id = :s AND (day BETWEEN :a AND :b OR day BETWEEN :ca AND :cb) GROUP BY day"), values).mappings().all():
                    day = found_day["day"]
                    slot = ("now", (day - a).days) if a <= day <= b else ("was", (day - ca).days)
                    row["_daily"]["visits"][slot] = int(found_day["v"] or 0)
                    if ga4["leads_rows"]:
                        row["_daily"]["leads"][slot] = round(float(found_day["l"] or 0))
                row["trend"] = [row["_daily"]["visits"][("now", n)] for n in range(length) if ("now", n) in row["_daily"]["visits"]]
                row["leads_state"] = "ok" if ga4["leads_rows"] else "not_set_up"
                if compared:
                    row.update(visits_was=int(found["was_v"] or 0), visits_change=_percent(int(found["now_v"] or 0), int(found["was_v"] or 0)))
                if ga4["leads_rows"]:
                    row["leads"] = round(float(found["now_l"] or 0))
                    if compared and not row["lead_changes"]:  # a change across a change in how GA4 counts is left out (W1)
                        row.update(leads_was=round(float(found["was_l"] or 0)), leads_change=row["leads"] - round(float(found["was_l"] or 0)))
        clicks = _clicks(engine, site["id"], args)
        if clicks["value"] is not None:
            row.update(clicks=clicks["value"], clicks_was=clicks["was"], clicks_change=clicks["change"], through=clicks["through"])
        strip.append(row)
    return strip


def _total(strip: list[dict], field: str, absolute: bool = False) -> dict:
    """The sum says how many sites it covers. The change only uses sites that have both periods, so like is compared with like."""
    known = [row for row in strip if row[field] is not None]
    compared = [row for row in known if row[f"{field}_was"] is not None]
    now, was = sum(row[field] for row in compared), sum(row[f"{field}_was"] for row in compared)
    change = None
    if compared:
        change = now - was if absolute else _percent(now, was)
    return {"value": sum(row[field] for row in known) if known else None, "change": change, "sites": len(known), "of": len(strip)}


def _points(strip: list[dict], field: str, length: int) -> list[dict]:
    """One point per day of the period for the graph, and the same day of the period before. A day nobody has data for stays
    empty, never zero. Each site counts from its own GA4 period, so a site that runs late isn't drawn as a fall at the end."""
    known = [row for row in strip if row[field] is not None]
    ends = [row["visits_through"] for row in known]
    if not known or not any(ends):
        return []
    end = date.fromisoformat(max(day for day in ends if day))
    compared = [row for row in known if row[f"{field}_was"] is not None]

    def total(rows, slot):
        found = [row["_daily"][field][slot] for row in rows if slot in row["_daily"][field]]
        return sum(found) if found else None

    return [{"day": (end - timedelta(days=length - 1 - n)).isoformat(), "now": total(known, ("now", n)), "was": total(compared, ("was", n))} for n in range(length)]


def _unusual_total(strip: list[dict]) -> dict | None:
    """Every site's unusual days, and the visits change of the sites compared, without them (W11)."""
    rows = [row for row in strip if row.get("unusual")]
    if not rows:
        return None
    runs = [run for row in rows for run in row["unusual"]["runs"]]
    runs_before = [run for row in rows for run in row["unusual"]["runs_before"]]
    compared = [row for row in strip if row["visits_was"] is not None]


    def per_day(row, side: str) -> float:
        """Visits a day of one side: without the unusual days when the site has some there, else over its days with data."""
        found = row.get("unusual")
        key = "per_day" if side == "now" else "per_day_before"
        if found and found.get(key) is not None:
            return found[key]
        days = sum(1 for slot in row["_daily"]["visits"] if slot[0] == side)
        return (row["visits"] if side == "now" else row["visits_was"]) / days if days else 0.0

    # Visits a day, as each site's own change: days left out of one period only can't read as a fall (code review 2026-11-18, #2).
    now = sum(per_day(row, "now") for row in compared)
    was = sum(per_day(row, "was") for row in compared)
    days = sorted({day for row in rows for day in row["unusual"]["days"]})
    days_before = sorted({day for row in rows for day in row["unusual"]["days_before"]})
    return {"runs": runs, "runs_before": runs_before, "days": days, "days_before": days_before, "change": _percent(now, was) if compared and was else None}


def _results(strip: list[dict], clicks: dict, sources_state: dict) -> dict:
    """The three numbers. Google clicks for the whole choice of sites come from one period (as Overview), the GA4 ones add
    up each site's own. Each says the state of its source, in Channels' words: not connected, waiting, stopped, ok."""
    length = clicks["length"]
    days = [day for row in strip for day in (row["through"], row["visits_through"]) if day]
    states = {row["leads_state"] for row in strip}
    known = [row for row in strip if row["clicks"] is not None]
    ga4_window = next((row.get("_ga4") for row in strip if row.get("_ga4")), None)
    window = {**{k: clicks["window"][k] for k in ("range", "compare", "from", "to", "compare_from", "compare_to", "compare_unavailable", "history_from", "final_through")}, "ga4": ga4_window}
    kinds = {row["lead_kind"] for row in strip}  # each site by its own rule, as the other screens (code review 2026-11-18, #4)
    lead_kind = lead_rules.KEY_EVENTS if lead_rules.LEADS not in kinds else lead_rules.LEADS if kinds == {lead_rules.LEADS} else lead_rules.MIXED
    lead_changes = sorted(({**c, "host": row["host"]} for row in strip for c in row["lead_changes"]), key=lambda c: c["day"])
    visits = {**_total(strip, "visits"), "points": _points(strip, "visits", length), "source": sources_state["ga4"], "unusual": _unusual_total(strip)}
    if visits["change"] is None and any(row["visits_note"] == "little_before" for row in strip if row["visits"] is not None):
        visits["note"] = "little_before"
    return {
        "leads": {**_total(strip, "leads", absolute=True), "points": _points(strip, "leads", length), "state": "ok" if "ok" in states else "not_set_up" if "not_set_up" in states else "no_ga4", "source": sources_state["ga4"],
                  "kind": lead_kind, "changes": lead_changes, "blank": bool(lead_changes),
                  "key_event_hosts": sorted(row["host"] for row in strip if row["lead_kind"] != lead_rules.LEADS) if lead_kind == lead_rules.MIXED else []},
        "visits": visits,
        "other_hosts": [{"site_id": row["id"], "host": row["host"], "hosts": row["other_hosts"]} for row in strip if row["other_hosts"]],
        "clicks": {"value": clicks["value"], "change": clicks["change"], "sites": len(known), "of": len(strip), "points": clicks["points"], "source": sources_state["gsc"]},
        "through": min(days) if days else None, "days": length, "window": window,
    }


def _states(engine: Engine, site_id: int | None) -> dict:
    """Search Console's and GA4's state for the sites shown, as Overview and Channels tell it (metrics.service._sources_state)."""
    from seo.metrics.service import _sources_state

    scope = Scope(engine, site_id or "all", "2000-01-01", "2000-01-01")
    return {source: _sources_state(scope, source)["state"] for source in ("gsc", "ga4")}


def today(engine: Engine, site_id: int | None = None, args: dict | None = None) -> dict:
    """args: the shared date range (range, compare, from, to), as the screens send it. None: the last 28 days, as before."""
    picked = _search_args(args)
    clicks = _clicks(engine, site_id or "all", picked)
    sources, strip = _source_health(engine, site_id), _site_strip(engine, site_id, picked, clicks["length"])
    windows: list[dict] = []
    pages, keywords = _page_moves(engine, site_id, windows), _keyword_moves(engine, site_id)
    todo, named = _todo(engine, site_id, pages)
    pages = [move for move in pages if move["key"] not in named]
    _say_this_week(todo, keywords)
    rivals, other_edits = _rival_changes(engine, site_id)
    results = _results(strip, clicks, _states(engine, site_id))
    for row in strip:
        del row["_daily"]
        row.pop("_ga4", None)
    return {
        "results": results, "google_stopped": any(s["source"] in ("gsc", "ga4") and not s["ok"] and not s["waiting"] for s in sources), "todo": todo,
        "going_down": _mix([m for m in pages if m["clicks"] < m["was"]], [m for m in keywords if m["places"] < 0]), "going_up": _mix([m for m in pages if m["clicks"] > m["was"]], [m for m in keywords if m["places"] > 0]),
        # The two weeks Going down and Going up compare, when every site's last day is the same (else each row has its own).
        "moves_window": windows[0] if windows and all(w == windows[0] for w in windows) else None,
        "todo_drops": sum(1 for row in todo if row.get("reason") in ("losing_clicks", "losing_leads")),
        "rival_changes": rivals, "other_edits": other_edits, "sources": sources, "lanes": _lanes(engine), "sites": strip,
    }


def _say_this_week(todo: list[dict], keywords: list[dict]) -> None:
    """A 28-day finding about a search that moved this week says so in its own row ("This week: avg pos 8.0 → 12.0"), so
    "close to the top 3" never sits beside the same search under Going down without a word (daily-monitoring F8)."""
    moved = {(m["host"], search._match(m["query"])): m for m in keywords}
    for row in todo:
        if row.get("kind") != "search_finding" or not row.get("query"):
            continue
        move = moved.get((row.get("host"), search._match(row["query"])))
        if move:
            row["this_week"] = {"was": move["was_pos"], "now": move["now_pos"]}
            row.setdefault("words", {})["week"] = ["This week: avg pos {was} → {now}", {"was": move["was_pos"], "now": move["now_pos"]}]


def attention(engine: Engine, site_id: int | None = None) -> list[dict]:
    """Only the to-do list, for the side menu's Today badge on other screens: no numbers, moves or rivals are worked out."""
    return _rows_they_may_see(_todo(engine, site_id, _page_moves(engine, site_id))[0])


# Which section a to-do row belongs to, from where it leads. Settings rows (a source to reconnect) are for admins.
_ROW_SECTION = {"settings": None, "backlinks": "backlinks", "insights": "insights", "health": "health", "overview": "overview", "competitors": "competitors"}


def _rows_they_may_see(rows: list[dict]) -> list[dict]:
    """A person with chosen access sees on Today only what belongs to the sections they were given."""
    who = access.current()
    if who.full:
        return rows
    kept = []
    for row in rows:
        place = str(row.get("link") or "").lstrip("#").split("/")[0].split("?")[0]
        section = _ROW_SECTION.get(place, place or None)
        if row.get("kind") == "ai_overview":
            section = "competitors" if who.can("competitors") else "ai"
        if section and who.can(section):
            kept.append(row)
    return kept


def for_person(answer: dict) -> dict:
    """Today's answer cut down to the sections a person with chosen access has. Full access: unchanged."""
    who = access.current()
    if who.full:
        return answer
    answer["todo"] = _rows_they_may_see(answer.get("todo") or [])
    if not (who.can("overview") or who.can("keywords")):
        answer["going_down"], answer["going_up"] = [], []
    if not who.can("competitors"):
        answer["rival_changes"], answer["other_edits"] = [], 0
    # Counts over what they may see only, so they never tell of drops in sections they weren't given.
    answer["todo_drops"] = sum(1 for row in answer["todo"] if row.get("reason") in ("losing_clicks", "losing_leads"))
    if not (answer.get("going_down") or answer.get("going_up")):
        answer["moves_window"] = None

    if not who.can("backlinks"):
        answer.pop("backlinks", None)
    return answer
