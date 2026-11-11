"""Today, worked out when it's opened, because nothing is sent out: how results are going, what to do first, what moved, and what rivals changed."""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.collectors.common import digest
from seo.collectors.jobs import ALERT_KIND, NAMES
from seo.competitors.pairs import _page_id
from seo.core.errors import Refused
from seo.metrics import search
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

MOVE_PERCENT, MOVE_MIN_CLICKS = 20, 20  # a page shown under Going down or Going up
BIG_DROP_PERCENT, BIG_DROP_MIN_CLICKS, BIG_DROPS_SHOWN = 30, 50, 3  # a page that joins the to-do list
KEYWORD_MIN_PLACES, KEYWORD_MIN_IMPRESSIONS = 3, 50
MOVES_SHOWN, RIVAL_ROWS = 4, 5
SEEN_DROP_DAYS = 7  # a drop marked as seen comes back with the next week's numbers, if it's still there

# What is being lost decides the order, not only how an alert was labelled.
LOSING_VISITORS, LOSING_RESULTS, LOST_FOR_GOOD_SOON, DATA_STOPPED, OTHER, INFORMATION = 1, 2, 3, 4, 5, 6
_SITE_DOWN_NOW = {"start_page_down", "start_page_noindex", "robots_down", "ssl_expired", "ssl_error"}


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


def _site_filter(site_id: int | None) -> tuple[str, dict]:
    return ("AND s.id = :s", {"s": site_id}) if site_id else ("", {})


def _rank(kind: str, severity: str, detail: dict | None) -> int:
    detail = detail or {}
    if severity == "info":
        return INFORMATION
    if kind == "uptime_down":
        return LOSING_VISITORS if detail.get("state") != "back" else OTHER
    if kind in ("ssl_expiry", "domain_expiry"):
        return LOSING_VISITORS if severity == "crit" else LOST_FOR_GOOD_SOON
    if kind == "health_site":
        return LOSING_VISITORS if _SITE_DOWN_NOW & set(detail.get("site") or []) else LOST_FOR_GOOD_SOON
    if kind in ("page_drop", "backlink_lost", "search_drop"):
        return LOSING_RESULTS
    if kind == "clarity_gap":
        return LOST_FOR_GOOD_SOON
    if kind == ALERT_KIND:
        return DATA_STOPPED
    return OTHER


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
                "id": f"alert-{row['id']}", "alert_ids": [row["id"]], "severity": row["severity"], "kind": kind, "host": row["host"], "title": row["title"], "rank": _rank(kind, row["severity"], detail), "site_codes": (detail or {}).get("site"),
                "detail": (detail or {}).get("error") or (detail or {}).get("detail") or "", "link": _link(kind), "created_at": _iso(row["created_at"]),
            }
            stake = _SEARCH_STAKE.match(item["detail"]) if kind == ALERT_KIND_SEARCH else None
            if stake:
                n = int(stake.group(1) or stake.group(2))
                item["detail"] = f"~{n} clicks/month at stake"
                item["words"] = {"detail": ["~{n} clicks/month at stake", {"n": n}]}
            drop = _SEARCH_DROP_TITLE.match(item["title"] or "") if kind == ALERT_KIND_SEARCH else None
            if drop:
                path, percent = drop.group(1), int(drop.group(2) or drop.group(3))
                item["title"] = f"{path}: −{percent}% Google clicks"
                item.setdefault("words", {})["title"] = ["{path}: −{percent}% Google clicks", {"path": path, "percent": percent}]
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
            if not site_id:
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


def _changes(engine: Engine, site_id: int | None) -> list[dict]:
    """What competitors changed in the last 7 days, newest first. Only competitors of this site, when one site is picked."""
    # Paused competitors are left out. With all my sites, a rival counts while any site still reads its pages.
    join = "JOIN site_competitors c ON c.competitor_id = s.id AND c.site_id = :s AND c.tracking <> 'off' " if site_id else ""
    join = join or "JOIN (SELECT DISTINCT competitor_id FROM site_competitors WHERE tracking <> 'off') c ON c.competitor_id = s.id "
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT DISTINCT e.id, e.kind, e.detected_at, e.summaries, p.url, s.host FROM change_events e JOIN pages p ON p.id = e.page_id "
                f"JOIN domains d ON d.id = e.domain_id JOIN sites s ON s.host = d.host AND s.kind = 'competitor' {join}"
                "WHERE e.detected_at > UTC_TIMESTAMP(3) - INTERVAL 7 DAY ORDER BY e.detected_at DESC LIMIT 500"
            ),
            {"s": site_id} if site_id else {},
        ).mappings().all()
    return [{"id": row["id"], "kind": row["kind"], "host": row["host"], "url": row["url"], "when": _iso(row["detected_at"]), "summaries": json.loads(row["summaries"]) if isinstance(row["summaries"], str) else row["summaries"]} for row in rows]


def _rival_changes(engine: Engine, site_id: int | None) -> tuple[list[dict], int]:
    """Edits on a rival page that ranks beside one of ours come first, naming our page. Everything else is only counted."""
    clause, values = ("AND p.site_id = :s", {"s": site_id}) if site_id else ("", {})
    with engine.connect() as conn:
        pairs = conn.execute(
            text(f"SELECT p.id, p.site_id, p.my_url, p.their_url, p.shared_keywords, me.host my_host FROM page_pairs p JOIN sites me ON me.id = p.site_id WHERE p.hidden = 0 {clause} ORDER BY p.shared_keywords DESC, p.id"),
            values,
        ).mappings().all()
    beside: dict[str, dict] = {}
    for pair in pairs:
        beside.setdefault(_page_id(pair["their_url"]), pair)  # the pair sharing the most keywords speaks for that page
    rows, shown_pages, other = [], set(), 0
    for change in _changes(engine, site_id):
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


def _page_moves(engine: Engine, site_id: int | None) -> list[dict]:
    """A page losing or gaining a lot of clicks, last 7 days against the 7 before. Search Console only, so it says so.

    Each site uses its own last day of data, or a site whose data stopped would look like it fell. A week with missing days isn't compared at all.
    """
    moves = []
    with engine.connect() as conn:
        for site in _own_sites(conn, site_id):
            end = _gsc_final_day(conn, "gsc_page", site["id"])
            if end is None:
                continue
            now_from, before_from, before_to = end - timedelta(days=6), end - timedelta(days=13), end - timedelta(days=7)
            bounds = {"nf": now_from, "bt": before_to, "bf": before_from, "e": end, "s": site["id"]}
            days = conn.execute(text("SELECT COUNT(DISTINCT IF(day >= :nf, day, NULL)) now_d, COUNT(DISTINCT IF(day <= :bt, day, NULL)) was_d FROM gsc_page WHERE site_id = :s AND day BETWEEN :bf AND :e"), bounds).mappings().first()
            if days["now_d"] < days["was_d"]:
                continue
            rows = conn.execute(
                text(
                    "SELECT MAX(page) page, page_hash, SUM(IF(day >= :nf, clicks, 0)) now_c, SUM(IF(day <= :bt, clicks, 0)) was_c FROM gsc_page "
                    f"WHERE site_id = :s AND day BETWEEN :bf AND :e GROUP BY page_hash HAVING SUM(IF(day <= :bt, clicks, 0)) >= {MOVE_MIN_CLICKS}"
                ),
                bounds,
            ).mappings().all()
            for row in rows:
                was, now = int(row["was_c"]), int(row["now_c"])
                change = round((now - was) / was * 100)
                if abs(change) >= MOVE_PERCENT:
                    moves.append({"type": "page", "page": row["page"], "url": row["page"], "path": _path(row["page"]), "host": site["host"], "site_id": site["id"], "change": change, "clicks": now, "was": was, "key": digest("drop", str(site["id"]), row["page_hash"])})
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
    return move["change"] <= -BIG_DROP_PERCENT and move["was"] >= BIG_DROP_MIN_CLICKS


def _drop_row(move: dict) -> dict:
    return {
        "id": f"drop-{move['key']}", "seen_key": move["key"], "kind": "page_drop", "severity": "crit" if move["change"] <= -50 else "warn", "rank": LOSING_RESULTS, "host": move["host"],
        "title": f"{move['path']}: −{abs(move['change'])}% Google clicks", "detail": f"Week on week: {move['was']} → {move['clicks']}", "page": move["page"], "link": "#overview", "created_at": None,
        "words": {"title": ["{path}: −{percent}% Google clicks", {"path": move["path"], "percent": abs(move["change"])}], "detail": ["Week on week: {was} → {now}", {"was": move["was"], "now": move["clicks"]}]},
        "open": {"page": move["page"], "range": "7d"},
    }


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
    return {
        "id": f"finding-{f['key']}", "seen_key": f["key"], "kind": "search_finding", "finding": f["kind"], "finding_id": f["id"], "severity": "warn",
        "rank": LOSING_RESULTS if f["group"] in ("changed", "decline") else OTHER, "host": f["host"],
        "title": _FINDING_TITLES.get(f["kind"], "{path}").format(**values), "detail": f"~{round(f['at_stake'])} clicks/month at stake",
        "page": f["page"], "query": f["query"], "link": f"#insights/{f['id']}", "created_at": None,
        # The same sentence as parts, so the screen can say it in the reader's language (English key, values apart).
        "words": {"title": [_FINDING_TITLES.get(f["kind"], "{path}"), values], "detail": ["~{n} clicks/month at stake", {"n": round(f["at_stake"])}],
                  **({"segment_dim": evidence.get("dim")} if evidence.get("segment") else {})},
    }


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
            "query": change["keyword"], "link": "#competitors/ai", "created_at": _iso(change["at"]),
            "words": {"title": [template, {"keyword": change["keyword"]}], "detail": ["Last two AI Overview checks", {}]},
        })
    return rows


def _todo(engine: Engine, site_id: int | None, moves: list[dict]) -> tuple[list[dict], set[str]]:
    """One list, ranked by what is being lost. Returns which pages it names, so they aren't repeated under Going down."""
    seen = _seen_drops(engine)
    drops = sorted((move for move in moves if _is_big_drop(move) and move["key"] not in seen), key=lambda move: move["clicks"] - move["was"])[:BIG_DROPS_SHOWN]
    rows = _attention(engine, site_id) + [_drop_row(move) for move in drops]
    named = {move["page"] for move in drops}
    from seo.insights import service as insights  # the biggest Search insights, one per query or page

    rows += [_finding_row(f) for f in insights.today_rows(engine, site_id) if f["key"] not in seen and not (f["page"] and f["page"] in named and f["kind"] == "page_down")]
    rows += [row for row in _ai_overview_rows(engine, site_id) if row["seen_key"] not in seen]
    # Sorted is stable, and page drops were added in order of clicks lost.
    rows.sort(key=lambda item: (item["rank"], SEVERITY.get(item["severity"], 3)) if item["kind"] != "page_drop" else (item["rank"], -1))
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
        row = {"id": site["id"], "host": site["host"], "visits": None, "visits_was": None, "visits_change": None, "leads": None, "leads_was": None, "leads_change": None, "leads_state": "no_ga4", "clicks": None, "clicks_was": None, "clicks_change": None, "through": None, "visits_through": None, "trend": [], "_daily": {"visits": {}, "leads": {}}}
        with engine.connect() as conn:
            row["alerts"] = int(conn.execute(text("SELECT COUNT(*) FROM alerts WHERE site_id = :s AND acknowledged_at IS NULL"), {"s": site["id"]}).scalar() or 0)
            ga4 = conn.execute(text("SELECT MIN(day) first_day, MAX(day) last_day, SUM(key_events > 0) leads_rows FROM ga4_source_daily WHERE site_id = :s"), {"s": site["id"]}).mappings().first()
            if ga4["last_day"]:
                a, b, ca, cb = _ga4_windows(ga4["last_day"], length, compare)
                values = {"s": site["id"], "a": a, "b": b, "ca": ca or date(1900, 1, 1), "cb": cb or date(1900, 1, 1)}
                found = conn.execute(
                    text("SELECT SUM(IF(day BETWEEN :a AND :b, sessions, 0)) now_v, SUM(IF(day BETWEEN :ca AND :cb, sessions, 0)) was_v, SUM(IF(day BETWEEN :a AND :b, key_events, 0)) now_l, SUM(IF(day BETWEEN :ca AND :cb, key_events, 0)) was_l FROM ga4_source_daily WHERE site_id = :s AND (day BETWEEN :a AND :b OR day BETWEEN :ca AND :cb)"),
                    values,
                ).mappings().first()
                compared = ca is not None and ga4["first_day"] <= ca
                row.update(visits=int(found["now_v"] or 0), visits_through=ga4["last_day"].isoformat(), _ga4={"from": a.isoformat(), "to": b.isoformat(), "compare_from": ca.isoformat() if ca else None, "compare_to": cb.isoformat() if cb else None})
                for found_day in conn.execute(text("SELECT day, SUM(sessions) v, SUM(key_events) l FROM ga4_source_daily WHERE site_id = :s AND (day BETWEEN :a AND :b OR day BETWEEN :ca AND :cb) GROUP BY day"), values).mappings().all():
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
                    if compared:
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


def _results(strip: list[dict], clicks: dict, sources_state: dict) -> dict:
    """The three numbers. Google clicks for the whole choice of sites come from one period (as Overview), the GA4 ones add
    up each site's own. Each says the state of its source, in Channels' words: not connected, waiting, stopped, ok."""
    length = clicks["length"]
    days = [day for row in strip for day in (row["through"], row["visits_through"]) if day]
    states = {row["leads_state"] for row in strip}
    known = [row for row in strip if row["clicks"] is not None]
    ga4_window = next((row.get("_ga4") for row in strip if row.get("_ga4")), None)
    window = {**{k: clicks["window"][k] for k in ("range", "compare", "from", "to", "compare_from", "compare_to", "compare_unavailable", "final_through")}, "ga4": ga4_window}
    return {
        "leads": {**_total(strip, "leads", absolute=True), "points": _points(strip, "leads", length), "state": "ok" if "ok" in states else "not_set_up" if "not_set_up" in states else "no_ga4", "source": sources_state["ga4"]},
        "visits": {**_total(strip, "visits"), "points": _points(strip, "visits", length), "source": sources_state["ga4"]},
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
    pages, keywords = _page_moves(engine, site_id), _keyword_moves(engine, site_id)
    todo, named = _todo(engine, site_id, pages)
    pages = [move for move in pages if move["key"] not in named]
    rivals, other_edits = _rival_changes(engine, site_id)
    results = _results(strip, clicks, _states(engine, site_id))
    for row in strip:
        del row["_daily"]
        row.pop("_ga4", None)
    return {
        "results": results, "google_stopped": any(s["source"] in ("gsc", "ga4") and not s["ok"] and not s["waiting"] for s in sources), "todo": todo,
        "going_down": _mix([m for m in pages if m["change"] < 0], [m for m in keywords if m["places"] < 0]), "going_up": _mix([m for m in pages if m["change"] > 0], [m for m in keywords if m["places"] > 0]),
        "rival_changes": rivals, "other_edits": other_edits, "sources": sources, "lanes": _lanes(engine), "sites": strip,
    }


def attention(engine: Engine, site_id: int | None = None) -> list[dict]:
    """Only the to-do list, for the side menu's Today badge on other screens: no numbers, moves or rivals are worked out."""
    return _todo(engine, site_id, _page_moves(engine, site_id))[0]
