"""AI search: do AI assistants send me leads, and do AI answers cite me?

Every block says where its numbers come from, for which days, and how fresh they are, so a snapshot never passes for live
data and a failing source fails only its own card. Four sources feed it:
- GA4: visits and leads from AI assistants, the pages they land on (the period picked on the screen).
- Clarity download: Copilot's citations, share of authority and questions (the file's own period, uploaded by hand).
- Clarity live: the referrers Clarity's API gave for the last 24 hours, read once a UTC day. Only a second opinion beside
  GA4, on the days both have, and never added to it.
- SerpApi (or whichever tool checked the keywords): Google AI Overviews, from the AI Overview watch.

A visit counts as AI when its source is on the AI list, whatever channel GA4 filed it under (ChatGPT's own links carry
utm_source=chatgpt.com with no medium, so GA4 files them as Unassigned), or when GA4 or a channel rule names an AI channel.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import bindparam, text

from seo.collectors.ga4 import NOT_SET
from seo.metrics import service as base
from seo.serp.tools import NOT_CAPTURED, PRESENT

LEAD_RATE_MIN_VISITS = 30  # a lead rate on fewer AI visits is noise: the screen shows "—" and how many there are so far
CTA_MIN_VISITS = 10  # a page with this many AI visits and no lead gets a "add a call to action" next action
FAQ_SHARE_BELOW = 20.0  # % share of authority under which a Copilot question is worth an FAQ
CLICK_MIN_CITATIONS = 5  # a page Copilot cites this often but that gets no Copilot or Bing visit needs a reason to click
NEXT_ACTIONS = 3
WEEKS = 8
# Amber when older than this (the plan's freshness rules).
GA4_BEHIND_DAYS = 2
CLARITY_LIVE_OLD_HOURS, CLARITY_LIVE_LOST_HOURS = 48, 72  # Clarity's API only gives the last 3 days
DOWNLOAD_OLD_DAYS = 14
SERP_OLD_DAYS = 30
COPILOT_DOMAINS = {"copilot.microsoft.com", "copilot.cloud.microsoft", "bing.com"}  # where a click on a Copilot citation comes from
# A site that hasn't set a source up is a choice, not a problem: on All sites, one working site makes the source "ok".
_WORST = ("failing", "old", "retrying", "reading", "waiting", "ok", "not_connected", "not_set_up", "not_used", "no_sites")
_STOP = set(
    "the and for with what how why are can you your does from that this when where which who will into about than then a an of to in on is it "
    "le la les des une un du de et en au aux pour par sur est que qui quoi comment combien quel quelle quels quelles avec dans mon ma mes son sa ses".split()
)


def is_ai_channel(name: str | None) -> bool:
    """GA4's own AI grouping, or a channel rule naming one: "AI Assistant", "AI assistants", "AI", "Generative AI"..."""
    low = (name or "").strip().lower()
    return low == "ai" or low.startswith("ai ") or "generative ai" in low or "ai assistant" in low


def ai_source(row, domains: set[str], namer) -> str | None:
    """The assistant a GA4 row is from, or None when it isn't AI. Any channel: Referral, Organic Social, Unassigned..."""
    source = (row["source"] or "").strip().lower()
    if base._is_ai(source, domains):
        return source
    if is_ai_channel(row["channel"]) or is_ai_channel(namer(row["channel"], row["source"], row["medium"])):
        return source if source not in NOT_SET and source != "(direct)" else "(not set)"
    return None


def _domain(value: str) -> str:
    low = (value or "").strip().lower()
    if "://" in low:
        low = low.split("://", 1)[1]
    low = low.split("/", 1)[0].split("?", 1)[0]
    return low[4:] if low.startswith("www.") else low


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, date):
        return value.isoformat()
    return None


def _rate(leads: float, visits: int) -> dict:
    """A lead rate only from LEAD_RATE_MIN_VISITS visits, always with its counts."""
    return {"value": base._ratio(leads, visits) if visits >= LEAD_RATE_MIN_VISITS else None, "visits": visits, "leads": round(leads, 2), "needs": LEAD_RATE_MIN_VISITS}


def _now(scope) -> datetime:
    with scope.engine.connect() as conn:
        return conn.execute(text("SELECT UTC_TIMESTAMP()")).scalar()


# ---- GA4: visits, leads, weeks, pages ---------------------------------------------------------------------


def _ga4_site_rows(scope, start: date, end: date):
    return scope.fetch(
        "SELECT site_id, day, channel, source, medium, SUM(sessions) sessions, SUM(key_events) leads FROM ga4_source_daily "
        "WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, day, channel, source, medium",
        start, end,
    )


def _landing_rows(scope, start: date, end: date, wanted):
    """AI landing pages: the referral table, plus tagged visits it leaves out (utm_source=chatgpt.com has no medium, so it's
    not a referral). A tagged referral with no campaign is in both tables, so it's taken from the referral side only."""
    found: dict[tuple[int, str], dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    for row in scope.fetch(
        "SELECT site_id, day, MAX(domain) domain, MAX(path) path, SUM(sessions) sessions, SUM(key_events) leads FROM ga4_referral_daily "
        "WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, day, row_hash", start, end,
    ):
        if wanted(row["domain"]):
            item = found[(row["site_id"], base._path(row["path"]))]
            item["sessions"] += int(row["sessions"] or 0)
            item["leads"] += float(row["leads"] or 0)
    for row in scope.fetch(
        "SELECT site_id, MAX(source) source, MAX(medium) medium, MAX(campaign) campaign, MAX(path) path, SUM(sessions) sessions, SUM(key_events) leads "
        "FROM ga4_campaign_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, row_hash", start, end,
    ):
        if not wanted(row["source"]):
            continue
        if (row["medium"] or "").lower() == "referral" and (row["campaign"] or "") in NOT_SET:
            continue
        item = found[(row["site_id"], base._path(row["path"]))]
        item["sessions"] += int(row["sessions"] or 0)
        item["leads"] += float(row["leads"] or 0)
    return found


def _weeks(end: date, start: date) -> list[tuple[date, date]]:
    """Weeks ending on the period's last day: at least WEEKS of them, more when the period is longer."""
    count = min(26, max(WEEKS, math.ceil(((end - start).days + 1) / 7)))
    return [(end - timedelta(days=7 * (count - n) - 1), end - timedelta(days=7 * (count - n - 1))) for n in range(count)]


# ---- Clarity download: Copilot citations --------------------------------------------------------------------


def _words(value: str) -> set[str]:
    plain = unicodedata.normalize("NFKD", (value or "").lower())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return {w for w in re.findall(r"[a-z0-9]+", plain) if len(w) >= 3 and w not in _STOP}


def match_page(question: str, candidates: list[dict]) -> dict | None:
    """The page Google already shows for this question: the same query first, else the query sharing most of its words.
    candidates: [{query, page, clicks, impressions}] from Search Console, best page per query."""
    want = question.strip().lower()
    exact = [c for c in candidates if c["query"].strip().lower() == want]
    if exact:
        best = max(exact, key=lambda c: (c["clicks"], c["impressions"]))
        return {"page": best["page"], "query": best["query"], "match": "exact"}
    asked = _words(question)
    if not asked:
        return None
    scored = []
    for c in candidates:
        got = _words(c["query"])
        common = asked & got
        need = 1 if len(asked) <= 2 else 2
        if len(common) < need:
            continue
        score = len(common) / len(asked | got)
        if score >= 0.4:
            scored.append((score, c["clicks"], c["impressions"], c))
    if not scored:
        return None
    best = max(scored, key=lambda s: s[:3])[3]
    return {"page": best["page"], "query": best["query"], "match": "close"}


def _gsc_candidates(scope, site_id: int, start: date, end: date) -> list[dict]:
    with scope.engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT MAX(query) query, MAX(page) page, SUM(clicks) clicks, SUM(impressions) impressions FROM gsc_query_page "
                "WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY pair_hash"
            ),
            {"s": site_id, "a": start, "b": end},
        ).mappings().all()
    best: dict[str, dict] = {}
    for row in rows:
        key = (row["query"] or "").strip().lower()
        item = {"query": row["query"] or "", "page": row["page"] or "", "clicks": int(row["clicks"] or 0), "impressions": int(row["impressions"] or 0)}
        held = best.get(key)
        if held is None or (item["clicks"], item["impressions"]) > (held["clicks"], held["impressions"]):
            best[key] = item
    return list(best.values())


def _copilot(scope, today: date, hosts: dict[int, str]) -> dict:
    rows = scope.fetch(
        "SELECT site_id, period_start, period_end, data, uploaded_at FROM clarity_reports WHERE site_id IN :sites AND kind = 'ai' "
        "ORDER BY site_id, period_end DESC, uploaded_at DESC"
    )
    per_site: dict[int, list] = defaultdict(list)
    for row in rows:
        data = row["data"] if isinstance(row["data"], dict) else json.loads(row["data"] or "{}")
        per_site[row["site_id"]].append({**dict(row), "data": data})
    sites = []
    for site_id, uploads in per_site.items():
        latest, earlier = uploads[0], uploads[1] if len(uploads) > 1 else None
        data, host = latest["data"], hosts.get(site_id, "")
        start, end = latest["period_start"], latest["period_end"]
        visits = _copilot_visits(scope, site_id, start, end)
        pages: dict[str, dict] = {}
        for page in data.get("pages") or []:  # /a and https://site/a/?x=1 are one page
            path = base._path(page["url"])
            held = pages.setdefault(path, {"url": page["url"], "path": path, "citations": 0, "visits": None if visits is None else visits.get(path, 0)})
            held["citations"] += page.get("citations") or 0
        queries = None
        if "queries" in data:
            candidates = _gsc_candidates(scope, site_id, start, end) if data["queries"] else []
            queries = []
            for q in data["queries"]:
                found = match_page(q["query"], candidates)
                queries.append({
                    "query": q["query"], "citations": q.get("citations"), "share": q.get("share"),
                    "page": {"url": found["page"], "path": base._path(found["page"]), "query": found["query"], "match": found["match"]} if found else None,
                })
        sites.append({
            "site_id": site_id, "host": host, "period_start": start.isoformat(), "period_end": end.isoformat(), "uploaded_at": _iso(latest["uploaded_at"]),
            "citations": data.get("citations"), "share": data.get("share_of_authority"), "ai_referral_sessions": data.get("ai_referral_sessions"),
            "copilot_visits": None if visits is None else sum(visits.values()),
            "before": {"citations": earlier["data"].get("citations"), "share": earlier["data"].get("share_of_authority"), "period_start": earlier["period_start"].isoformat(), "period_end": earlier["period_end"].isoformat()} if earlier else None,
            "pages": sorted(pages.values(), key=lambda p: (-p["citations"], p["path"])), "queries": queries,
            "old": (today - end).days > DOWNLOAD_OLD_DAYS, "age_days": (today - end).days,
        })
    sites.sort(key=lambda s: s["host"])
    known = [s for s in sites if s["citations"] is not None]
    return {
        "sites": sites,
        "citations": sum(s["citations"] for s in known) if known else None,
        "share": sites[0]["share"] if len(sites) == 1 else None,  # shares of different sites can't be added
    }


def _copilot_visits(scope, site_id: int, start: date, end: date) -> dict[str, int] | None:
    """GA4 visits from Copilot and Bing per page, on the download's own days. None when GA4 has none of those days."""
    with scope.engine.connect() as conn:
        has_days = conn.execute(text("SELECT 1 FROM ga4_source_daily WHERE site_id = :s AND day BETWEEN :a AND :b LIMIT 1"), {"s": site_id, "a": start, "b": end}).first()
    if not has_days:
        return None
    one = base.Scope.__new__(base.Scope)  # the same fetch, for one site and the download's days
    one.engine, one.site_ids, one.start, one.end = scope.engine, [site_id], start, end
    found = _landing_rows(one, start, end, lambda d: base._is_ai(_domain(d), COPILOT_DOMAINS))
    return {path: item["sessions"] for (_, path), item in found.items()}


# ---- Clarity live: a second opinion --------------------------------------------------------------------------


def _second_opinion(scope, domains: set[str], ga4_ai_by_day: dict, ga4_days: set) -> dict | None:
    """Clarity's read on day D covers the 24 hours before it, so it sits beside GA4's day D-1. Only days both have."""
    rows = scope.fetch(
        "SELECT site_id, day, referrers FROM clarity_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b AND referrers IS NOT NULL",
        scope.start + timedelta(days=1), scope.end + timedelta(days=1),
    )
    if not rows:
        return None
    days, clarity, ga4, last = 0, 0, 0, None
    for row in rows:
        covered = row["day"] - timedelta(days=1)
        last = max(last or row["day"], row["day"])
        if (row["site_id"], covered) not in ga4_days:
            continue
        referrers = row["referrers"] if isinstance(row["referrers"], list) else json.loads(row["referrers"] or "[]")
        days += 1
        clarity += int(sum(float(r.get("sessions") or 0) for r in referrers if base._is_ai(_domain(r.get("source") or ""), domains)))
        ga4 += ga4_ai_by_day.get((row["site_id"], covered), 0)
    return {"days": days, "clarity": clarity, "ga4": ga4, "last_read": last.isoformat() if last else None}


# ---- Google AI Overviews -------------------------------------------------------------------------------------


def _ai_overviews(scope, today: date) -> dict:
    from seo.competitors import ai_watch

    tracked = captured = with_overview = cited_me = 0
    newest, tools, rivals_only, keyword_ids = None, set(), [], []
    hosts = base._hosts(scope)
    for site_id in scope.site_ids:
        try:
            watch = ai_watch.watch(scope.engine, site_id)
        except Exception:  # noqa: BLE001 - one site's watch failing must not take the page down
            continue
        s = watch["summary"]
        tracked += s["tracked"]
        captured += s["captured"]
        with_overview += s["with_overview"]
        cited_me += s["cited_me"]
        for row in watch["keywords"]:
            if row["checked_at"] and (newest is None or row["checked_at"] > newest):
                newest = row["checked_at"]
            if row["state"] != NOT_CAPTURED:
                tools.add(row["tool"])
            if row["state"] == PRESENT and row["cited_me"] is False and row["competitors_cited"]:
                rivals_only.append({"site_id": site_id, "host": hosts.get(site_id, ""), "keyword": row["keyword"], "rivals": [c["host"] for c in row["competitors_cited"]]})
    with scope.engine.connect() as conn:
        statement = text("SELECT keyword_id FROM site_keywords WHERE site_id IN :sites").bindparams(bindparam("sites", expanding=True))
        keyword_ids = sorted({row[0] for row in conn.execute(statement, {"sites": scope.site_ids or [0]})})
    age = (today - date.fromisoformat(newest[:10])).days if newest else None
    return {
        "tracked": tracked, "captured": captured, "with_overview": with_overview, "cited_me": cited_me, "checked_at": newest, "tools": sorted(tools),
        "rivals_only": rivals_only[:20], "keyword_ids": keyword_ids[:2000], "old": age is not None and age > SERP_OLD_DAYS, "age_days": age,
    }


# ---- sources and freshness ------------------------------------------------------------------------------------


def _active_jobs(scope) -> set[str]:
    keys = [f"collect|{site}|{source}" for site in scope.site_ids for source in ("ga4", "gsc", "clarity")]
    if not keys:
        return set()
    with scope.engine.connect() as conn:
        statement = text("SELECT active_key FROM jobs WHERE active_key IN :k").bindparams(bindparam("k", expanding=True))
        return {row[0] for row in conn.execute(statement, {"k": keys})}


def _worst(states: list[str]) -> str:
    return min(states, key=_WORST.index) if states else "no_sites"


def _sources(scope, now: datetime, copilot: dict, aio: dict) -> list[dict]:
    today = now.date()
    hosts = base._hosts(scope)
    active = _active_jobs(scope)
    rows = {(r["site_id"], r["source"]): r for r in scope.fetch(
        "SELECT site_id, source, not_used, connection_id, property, secret IS NOT NULL AND secret <> '' has_secret, data_through, last_error, last_attempt_at, last_ok_at "
        "FROM site_sources WHERE site_id IN :sites AND source IN ('ga4', 'clarity')"
    )}

    def ga4_site(site_id: int) -> dict:
        r = rows.get((site_id, "ga4"))
        out = {"site_id": site_id, "host": hosts.get(site_id, "")}
        if r is None or (not r["not_used"] and not (r["connection_id"] and r["property"])):
            return {**out, "state": "not_connected"}
        if r["not_used"]:
            return {**out, "state": "not_used"}
        out.update(through=_iso(r["data_through"]), last_ok_at=_iso(r["last_ok_at"]), last_attempt_at=_iso(r["last_attempt_at"]), error=r["last_error"])
        busy = f"collect|{site_id}|ga4" in active
        if r["last_error"]:
            state = "failing"
        elif busy:
            state = "retrying" if r["last_attempt_at"] is None and r["last_ok_at"] is not None else "reading"
        elif r["data_through"] is None:
            state = "waiting"
        elif (today - r["data_through"]).days > GA4_BEHIND_DAYS:
            state = "old"
        else:
            state = "ok"
        return {**out, "state": state, "behind_days": (today - r["data_through"]).days if r["data_through"] else None}

    def clarity_site(site_id: int) -> dict:
        r = rows.get((site_id, "clarity"))
        out = {"site_id": site_id, "host": hosts.get(site_id, "")}
        if r is not None and r["not_used"]:
            return {**out, "state": "not_used"}
        if r is None or not r["has_secret"]:
            return {**out, "state": "not_connected"}
        tried_today = bool(r["last_attempt_at"] and r["last_attempt_at"].date() == today)
        out.update(last_ok_at=_iso(r["last_ok_at"]), last_attempt_at=_iso(r["last_attempt_at"]), error=r["last_error"], read_today=tried_today)
        if r["last_error"]:
            return {**out, "state": "failing"}
        if f"collect|{site_id}|clarity" in active:
            return {**out, "state": "reading"}
        if r["last_ok_at"] is None:
            return {**out, "state": "waiting"}
        age = (now - r["last_ok_at"]).total_seconds() / 3600
        out.update(age_hours=round(age, 1), lost_in_hours=max(0, round(CLARITY_LIVE_LOST_HOURS - age)))
        return {**out, "state": "old" if age > CLARITY_LIVE_OLD_HOURS else "ok"}

    downloads = {s["site_id"]: s for s in copilot["sites"]}

    def download_site(site_id: int) -> dict:
        s = downloads.get(site_id)
        out = {"site_id": site_id, "host": hosts.get(site_id, "")}
        if s is None:
            return {**out, "state": "not_set_up"}
        return {**out, "state": "old" if s["old"] else "ok", "period_start": s["period_start"], "period_end": s["period_end"], "uploaded_at": s["uploaded_at"], "age_days": s["age_days"]}

    out = []
    for source, name, per_site in (("ga4", "Google Analytics", ga4_site), ("clarity_live", "Clarity live", clarity_site), ("clarity_download", "Clarity download", download_site)):
        sites = [per_site(site_id) for site_id in scope.site_ids]
        out.append({"id": source, "name": name, "state": _worst([s["state"] for s in sites]), "sites": sites})
    serp_state = "not_set_up" if not aio["tracked"] or not aio["checked_at"] else "old" if aio["old"] else "ok"
    out.append({"id": "serp", "name": " / ".join(aio["tools"]) or "SerpApi", "state": serp_state, "checked_at": aio["checked_at"], "age_days": aio["age_days"], "tracked": aio["tracked"], "sites": []})
    return out


# ---- next actions ---------------------------------------------------------------------------------------------


def next_actions(pages: list[dict], leads_set_up: bool, copilot: dict, aio: dict, limit: int = NEXT_ACTIONS) -> tuple[list[dict], int]:
    """Rules, biggest first: a CTA on a page AI visitors land on without a lead, an FAQ for a question others win,
    a rival cited in an AI Overview where I'm not, then a page Copilot cites that gets no visit. One of each kind comes
    first, so three different things to do beat three of the same; the rest fill the gaps in the same order."""
    kinds: dict[str, list[dict]] = {"cta": [], "faq": [], "compare": [], "click": []}
    if leads_set_up:  # without key events, "no lead" isn't known
        for p in sorted(pages, key=lambda p: -p["sessions"]):
            if p["sessions"] >= CTA_MIN_VISITS and not p["leads"]:
                kinds["cta"].append({"kind": "cta", "host": p["host"], "path": p["path"], "visits": p["sessions"], "key": f"ai|cta|{p['host']}|{p['path']}"})
    for site in copilot["sites"]:
        for q in sorted(site["queries"] or [], key=lambda q: (q["share"] if q["share"] is not None else 100, -(q["citations"] or 0))):
            if q["share"] is not None and q["share"] < FAQ_SHARE_BELOW:
                kinds["faq"].append({"kind": "faq", "host": site["host"], "query": q["query"], "share": q["share"], "citations": q["citations"], "page": q["page"], "key": f"ai|faq|{site['host']}|{q['query'].lower()}"})
        for p in site["pages"]:
            if p["citations"] >= CLICK_MIN_CITATIONS and p["visits"] == 0:
                kinds["click"].append({"kind": "click", "host": site["host"], "path": p["path"], "url": p["url"], "citations": p["citations"], "key": f"ai|click|{site['host']}|{p['path']}"})
    for row in aio["rivals_only"]:
        kinds["compare"].append({"kind": "compare", "host": row["host"], "site_id": row["site_id"], "keyword": row["keyword"], "rivals": row["rivals"], "key": f"ai|aio|{row['host']}|{row['keyword'].lower()}"})
    order = ("cta", "faq", "compare", "click")
    chosen = [kinds[k][0] for k in order if kinds[k]][:limit]
    for k in order:
        for item in kinds[k][1:]:
            if len(chosen) >= limit:
                break
            chosen.append(item)
    total = sum(len(v) for v in kinds.values())
    return [dict(item, rank=n + 1) for n, item in enumerate(chosen)], total


# ---- the whole reply -------------------------------------------------------------------------------------------


def build(scope) -> dict:
    status = base._sources_state(scope, "ga4")
    period = base._trim_to_data(scope)
    now = _now(scope)
    today = now.date()
    domains = base._ai_domains(scope.engine, scope.site_ids)
    namer = base._channel_namer(scope.engine, scope.site_ids)
    hosts = base._hosts(scope)
    weeks = _weeks(scope.end, scope.start)
    first = min(scope.start, weeks[0][0])

    per_source: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    per_day: dict[str, int] = defaultdict(int)
    ai_by_site_day: dict[tuple[int, date], int] = defaultdict(int)
    week_sessions: dict[int, int] = defaultdict(int)
    week_leads: dict[int, float] = defaultdict(float)
    ga4_days: set[tuple[int, date]] = set()
    everything, organic = 0, {"sessions": 0, "leads": 0.0}
    for row in _ga4_site_rows(scope, first, scope.end):
        day, sessions, leads = row["day"], int(row["sessions"] or 0), float(row["leads"] or 0)
        ga4_days.add((row["site_id"], day))
        assistant = ai_source(row, domains, namer)
        if assistant:
            ai_by_site_day[(row["site_id"], day)] += sessions
            for n, (a, b) in enumerate(weeks):
                if a <= day <= b:
                    week_sessions[n] += sessions
                    week_leads[n] += leads
        if day < scope.start:
            continue
        everything += sessions
        if row["channel"] == "Organic Search":
            organic["sessions"] += sessions
            organic["leads"] += leads
        if assistant:
            per_source[assistant]["sessions"] += sessions
            per_source[assistant]["leads"] += leads
            per_day[day.isoformat()] += sessions
    data_days = {d for _, d in ga4_days}
    weekly = [
        {"start": a.isoformat(), "end": b.isoformat(), "sessions": week_sessions[n] if any(a <= d <= b for d in data_days) else None, "leads": round(week_leads[n], 2)}
        for n, (a, b) in enumerate(weeks)
    ]
    before = before_leads = None
    if scope.has_compare:
        past = [row for row in _ga4_site_rows(scope, scope.compare_start, scope.compare_end) if ai_source(row, domains, namer)]
        before = sum(int(r["sessions"] or 0) for r in past)
        before_leads = round(sum(float(r["leads"] or 0) for r in past), 2)
    sessions = sum(item["sessions"] for item in per_source.values())
    leads = round(sum(item["leads"] for item in per_source.values()), 2)
    leads_set_up = bool(scope.fetch("SELECT 1 x FROM ga4_source_daily WHERE site_id IN :sites AND key_events > 0 LIMIT 1"))

    landing = _landing_rows(scope, scope.start, scope.end, lambda d: base._is_ai(_domain(d), domains))
    pages = sorted(
        ({"host": hosts.get(site_id, ""), "path": path, "sessions": item["sessions"], "leads": round(item["leads"], 2)} for (site_id, path), item in landing.items() if item["sessions"]),
        key=lambda p: (-p["sessions"], p["path"]),
    )
    try:
        from seo.backlinks import logos  # each assistant's own icon beside its name, fetched once by our server

        logos.queue_for(scope.engine, [name for name in per_source if "." in name])
    except Exception:  # noqa: BLE001 - an icon is never worth failing the page for
        pass

    copilot = _copilot(scope, today, hosts)
    aio = _ai_overviews(scope, today)
    actions, action_count = next_actions(pages, leads_set_up, copilot, aio)
    return {
        **status, "period": period, "hid_rows": base._hidden(scope), "domains": sorted(domains),
        "ai_rules": base.rules(scope.engine, "ai_domain", scope.site_ids) + base.rules(scope.engine, "ai_domain_off", scope.site_ids),
        "default_domains": sorted(base.DEFAULT_AI_DOMAINS),
        "sessions": sessions, "leads": leads, "share": base._ratio(sessions, everything), "before": before, "before_leads": before_leads,
        "change": base._pct_change(sessions, before) if before else None,
        "key_events_set_up": leads_set_up,
        "rate": _rate(leads, sessions), "organic": _rate(organic["leads"], organic["sessions"]),
        "sources": [
            {"source": name, "sessions": item["sessions"], "leads": round(item["leads"], 2), "rate": _rate(item["leads"], item["sessions"])["value"]}
            for name, item in sorted(per_source.items(), key=lambda pair: (-pair[1]["sessions"], pair[0]))
        ],
        "series": [{"day": day, "sessions": per_day[day]} for day in sorted(per_day)],
        "weekly": weekly,
        "pages": pages,
        "copilot": copilot,
        "second_opinion": _second_opinion(scope, domains, ai_by_site_day, ga4_days),
        "ai_overviews": {k: v for k, v in aio.items() if k != "rivals_only"} | {"rivals_only": aio["rivals_only"][:5]},
        "source_states": _sources(scope, now, copilot, aio),
        "next_actions": actions, "next_action_count": action_count,
        "limits": {"lead_rate_min_visits": LEAD_RATE_MIN_VISITS, "cta_min_visits": CTA_MIN_VISITS, "faq_share_below": FAQ_SHARE_BELOW, "click_min_citations": CLICK_MIN_CITATIONS},
        "today": today.isoformat(), "now": _iso(now),
        # Google's own AI report (AI Overviews and AI Mode impressions), when one was uploaded: totals only.
        "google_ai": base._google_ai(scope),
    }
