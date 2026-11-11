"""The numbers behind Overview, Channels, Conversions, Content, AI search and Google Ads.

Everything is worked out when asked, from what collectors stored, so a rule changed today applies to past days too.
A missing day is a gap, never a zero: series only hold days a source really reported. Leads are GA4 key events: counts only.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Engine, bindparam, text

from seo.core.errors import Refused

DEFAULT_AI_DOMAINS = ("chatgpt.com", "chat.openai.com", "openai.com", "perplexity.ai", "gemini.google.com", "bard.google.com", "copilot.microsoft.com", "claude.ai", "deepseek.com", "chat.deepseek.com", "you.com", "poe.com", "mistral.ai", "chat.mistral.ai", "grok.com", "x.ai", "meta.ai")
SOCIAL_CHANNELS = {"organic social", "paid social"}
TOP_SERIES = 5
BUCKETS = (("1-3", 1, 3), ("4-10", 4, 10), ("11-20", 11, 20), ("21-50", 21, 50), ("51+", 51, 10**9))


def parse_day(value, label: str = "date") -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise Refused(f"That {label} isn't a date.") from exc


class Scope:
    """Which sites and days a question is about. The comparison period is optional."""

    def __init__(self, engine: Engine, site, start, end, compare_start=None, compare_end=None):
        self.engine = engine
        self.start, self.end = parse_day(start, "start date"), parse_day(end, "end date")
        if self.start > self.end:
            raise Refused("The start date is after the end date.")
        if (self.end - self.start).days > 800:
            raise Refused("That period is too long.")
        self.compare_start = parse_day(compare_start, "comparison date") if compare_start else None
        self.compare_end = parse_day(compare_end, "comparison date") if compare_end else None
        with engine.connect() as conn:
            if site in (None, "", "all"):
                self.site_ids = [row[0] for row in conn.execute(text("SELECT id FROM sites WHERE kind = 'own'")).all()]
            else:
                try:
                    wanted = int(site)
                except (TypeError, ValueError) as exc:
                    raise Refused("That site isn't one of yours.") from exc
                if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": wanted}).first():
                    raise Refused("That site isn't one of yours.")
                self.site_ids = [wanted]

    def fetch(self, sql: str, start: date | None = None, end: date | None = None, **values):
        """`sql` uses :sites, :a and :b."""
        if not self.site_ids:
            return []
        statement = text(sql).bindparams(bindparam("sites", expanding=True))
        with self.engine.connect() as conn:
            return conn.execute(statement, {"sites": self.site_ids, "a": start or self.start, "b": end or self.end, **values}).mappings().all()

    @property
    def has_compare(self) -> bool:
        return bool(self.compare_start and self.compare_end)


def _ratio(top, bottom) -> float | None:
    return round(top / bottom, 4) if bottom else None


def _pct_change(now, before) -> float | None:
    return round((now - before) / before * 100, 1) if before else None


def _path(url_or_path: str) -> str:
    """One way of writing a page: no domain, no query, one trailing slash. So /a and https://x.com/a/?b=1 match."""
    value = url_or_path or ""
    path = urlsplit(value).path if "://" in value else value.split("?", 1)[0].split("#", 1)[0]
    return path.rstrip("/") + "/" if path.rstrip("/") else "/"


def _sources_state(scope: Scope, source: str) -> dict:
    """Tells a screen why it might be empty: not set up, chosen not to use it, or waiting for its first data."""
    if not scope.site_ids:
        return {"state": "no_sites", "through": None, "error": None}
    rows = scope.fetch(f"SELECT site_id, not_used, connection_id, property, data_through, last_error, last_attempt_at FROM site_sources WHERE site_id IN :sites AND source = '{source}'")
    usable = [row for row in rows if not row["not_used"] and row["connection_id"] and row["property"]]
    through = max((row["data_through"] for row in usable if row["data_through"]), default=None)
    error = next((row["last_error"] for row in usable if row["last_error"]), None)
    if rows and all(row["not_used"] for row in rows) and len(rows) == len(scope.site_ids):
        state = "not_used"
    elif not usable:
        state = "not_connected"
    elif through is None:
        state = "failing" if error else "waiting"
    else:
        state = "ok"
    return {"state": state, "through": through.isoformat() if through else None, "error": error}


# ---- SEO Overview --------------------------------------------------------------------------------


def _gsc_totals(scope: Scope, start: date, end: date) -> dict | None:
    row = scope.fetch(
        "SELECT SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w, COUNT(*) n FROM gsc_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b", start, end
    )
    if not row or not row[0]["n"]:
        return None
    r = row[0]
    clicks, shown = int(r["c"] or 0), int(r["i"] or 0)
    return {"clicks": clicks, "impressions": shown, "click_rate": _ratio(clicks, shown), "position": round(float(r["w"]) / shown, 1) if shown and r["w"] is not None else None}


def overview(scope: Scope) -> dict:
    status = _sources_state(scope, "gsc")
    now = _gsc_totals(scope, scope.start, scope.end)
    before = _gsc_totals(scope, scope.compare_start, scope.compare_end) if scope.has_compare else None
    year_ago = scope.end - timedelta(days=365)
    series = scope.fetch(
        "SELECT day, SUM(clicks) clicks, SUM(impressions) impressions, SUM(position * impressions) w FROM gsc_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day ORDER BY day",
        year_ago, scope.end,
    )

    def query_rows(start, end):
        return scope.fetch(
            "SELECT MAX(query) query, query_hash, SUM(clicks) clicks, SUM(impressions) impressions, SUM(position * impressions) w FROM gsc_query WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY query_hash",
            start, end,
        )

    current = query_rows(scope.start, scope.end)
    past = {row["query_hash"]: row for row in query_rows(scope.compare_start, scope.compare_end)} if scope.has_compare else {}
    buckets = {name: 0 for name, _, _ in BUCKETS}
    moves = []
    for row in current:
        shown = int(row["impressions"] or 0)
        position = float(row["w"]) / shown if shown and row["w"] is not None else None
        if position is not None:
            for name, low, high in BUCKETS:
                if round(position) <= high and round(position) >= low:
                    buckets[name] += 1
                    break
        if scope.has_compare:
            held = past.get(row["query_hash"])
            was = int(held["clicks"] or 0) if held else 0
            moves.append({"query": row["query"], "clicks": int(row["clicks"] or 0), "before": was, "change": int(row["clicks"] or 0) - was, "position": round(position, 1) if position is not None else None})
    if scope.has_compare:
        seen = {row["query_hash"] for row in current}
        moves.extend({"query": held["query"], "clicks": 0, "before": int(held["clicks"] or 0), "change": -int(held["clicks"] or 0), "position": None} for key, held in past.items() if key not in seen and held["clicks"])
    return {
        **status,
        "totals": now,
        "before": before,
        "changes": {key: _pct_change(now[key], before[key]) for key in ("clicks", "impressions")} if now and before else {},
        "queries": len(current),
        "series": [{"day": row["day"].isoformat(), "clicks": int(row["clicks"] or 0), "impressions": int(row["impressions"] or 0), "position": round(float(row["w"]) / int(row["impressions"]), 1) if row["impressions"] and row["w"] is not None else None} for row in series],
        "distribution": [{"bucket": name, "queries": buckets[name]} for name, _, _ in BUCKETS],
        "gaining": sorted((m for m in moves if m["change"] > 0), key=lambda m: -m["change"])[:10],
        "losing": sorted((m for m in moves if m["change"] < 0), key=lambda m: m["change"])[:10],
        "lag_note": "Search Console lags 2 to 3 days and counts days in Pacific time.",
    }


# ---- Rules ---------------------------------------------------------------------------------------


def rules(engine: Engine, kind: str, site_ids: list[int]) -> list[dict]:
    statement = text("SELECT id, site_id, pattern, value FROM site_rules WHERE kind = :k AND (site_id IS NULL OR site_id IN :sites) ORDER BY id").bindparams(bindparam("sites", expanding=True))
    with engine.connect() as conn:
        return [dict(row) for row in conn.execute(statement, {"k": kind, "sites": site_ids or [0]}).mappings().all()]


def _compile(pattern: str):
    return re.compile(re.escape(pattern).replace(r"\*", ".*"), re.I)


def _channel_namer(engine: Engine, site_ids: list[int]):
    """A rule's pattern is source/medium with * as a wildcard: chatgpt.com/* or */newsletter. The first match wins, and the rest stay GA4's grouping."""
    compiled = [(_compile(rule["pattern"]), rule["value"]) for rule in rules(engine, "channel", site_ids) if rule["value"]]

    def name(channel: str, source: str, medium: str) -> str:
        pair = f"{source}/{medium}"
        for pattern, value in compiled:
            if pattern.fullmatch(pair):
                return value
        return channel
    return name


def _ai_domains(engine: Engine, site_ids: list[int]) -> set[str]:
    added = {rule["pattern"].lower() for rule in rules(engine, "ai_domain", site_ids)}
    removed = {rule["pattern"].lower() for rule in rules(engine, "ai_domain_off", site_ids)}
    return (set(DEFAULT_AI_DOMAINS) | added) - removed


def _is_ai(source: str, domains: set[str]) -> bool:
    low = (source or "").lower()
    return any(low == d or low.endswith("." + d) for d in domains)


def _ga4_rows(scope: Scope, start, end):
    return scope.fetch(
        "SELECT day, channel, source, medium, SUM(sessions) sessions, SUM(users) users, SUM(key_events) leads FROM ga4_source_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day, channel, source, medium",
        start, end,
    )


def _trim_to_data(scope: Scope) -> dict:
    """A period that runs past GA4's last day (GA4 is read through yesterday) is cut back to that day, and the period it's
    compared with is cut to the same number of days, so "Last 7 days" never compares 6 days of data with 7 (code review F112)."""
    found = scope.fetch("SELECT MAX(day) d FROM ga4_source_daily WHERE site_id IN :sites")
    last = found[0]["d"] if found else None
    trimmed = bool(last and scope.start <= last < scope.end)
    if trimmed:
        scope.end = last
        if scope.has_compare:
            scope.compare_end = min(scope.compare_end, scope.compare_start + (scope.end - scope.start))
    return {
        "from": scope.start.isoformat(), "to": scope.end.isoformat(), "trimmed": trimmed,
        "compare_from": scope.compare_start.isoformat() if scope.has_compare else None, "compare_to": scope.compare_end.isoformat() if scope.has_compare else None,
    }


def _hidden(scope: Scope, source: str = "ga4") -> bool:
    row = scope.fetch(f"SELECT MAX(hid_rows) h FROM coverage WHERE site_id IN :sites AND source = '{source}' AND day BETWEEN :a AND :b")
    return bool(row and row[0]["h"])


# ---- Channels ------------------------------------------------------------------------------------


def channels(scope: Scope) -> dict:
    status = _sources_state(scope, "ga4")
    period = _trim_to_data(scope)
    namer = _channel_namer(scope.engine, scope.site_ids)
    totals: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    per_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    referrers: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    for row in _ga4_rows(scope, scope.start, scope.end):
        name = namer(row["channel"], row["source"], row["medium"])
        totals[name]["sessions"] += int(row["sessions"] or 0)
        totals[name]["leads"] += float(row["leads"] or 0)
        per_day[row["day"].isoformat()][name] += int(row["sessions"] or 0)
        if row["medium"] == "referral":
            referrers[row["source"]]["sessions"] += int(row["sessions"] or 0)
            referrers[row["source"]]["leads"] += float(row["leads"] or 0)
    past: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    if scope.has_compare:
        for row in _ga4_rows(scope, scope.compare_start, scope.compare_end):
            name = namer(row["channel"], row["source"], row["medium"])
            past[name]["sessions"] += int(row["sessions"] or 0)
            past[name]["leads"] += float(row["leads"] or 0)
    all_sessions = sum(item["sessions"] for item in totals.values())
    order = sorted(totals, key=lambda name: -totals[name]["sessions"])
    top = order[:TOP_SERIES]
    series = []
    for day in sorted(per_day):
        values = {name: per_day[day].get(name, 0) for name in top}
        other = sum(count for name, count in per_day[day].items() if name not in top)
        if other:
            values["Other"] = other
        series.append({"day": day, "values": values})
    return {
        **status,
        "total": {"sessions": all_sessions, "leads": round(sum(item["leads"] for item in totals.values()), 2)},
        "before": {"sessions": sum(item["sessions"] for item in past.values()), "leads": round(sum(item["leads"] for item in past.values()), 2)} if scope.has_compare and past else None,
        "channels": [
            {
                "channel": name, "sessions": totals[name]["sessions"], "leads": round(totals[name]["leads"], 2), "rate": _ratio(totals[name]["leads"], totals[name]["sessions"]),
                "share": _ratio(totals[name]["sessions"], all_sessions), "change": _pct_change(totals[name]["sessions"], past[name]["sessions"]) if scope.has_compare and name in past else None,
            }
            for name in order
        ],
        "series": series,
        "series_names": top + (["Other"] if len(order) > TOP_SERIES else []),
        "referrers": [{"domain": name, "sessions": item["sessions"], "leads": round(item["leads"], 2)} for name, item in sorted(referrers.items(), key=lambda pair: -pair[1]["sessions"])[:20]],
        "rules": rules(scope.engine, "channel", scope.site_ids),
        "hid_rows": _hidden(scope), "period": period,
    }


# ---- Conversions ---------------------------------------------------------------------------------


def _categorise(engine: Engine, site_ids: list[int]):
    compiled = [(_compile(rule["pattern"]), rule["value"]) for rule in rules(engine, "category", site_ids) if rule["value"]]

    def name(path: str) -> str:
        for pattern, value in compiled:
            if pattern.fullmatch(path):
                return value
        parts = [part for part in path.split("/") if part]
        return "Home page" if not parts else "/" + parts[0] + "/" if len(parts) > 1 else "Other pages"
    return name


def _page_rows(scope: Scope):
    """One row per page of each site: /contact/ on two sites is two pages."""
    return scope.fetch(
        "SELECT site_id, MAX(path) path, page_hash, SUM(sessions) sessions, SUM(key_events) leads FROM ga4_page_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, page_hash"
    )


def _hosts(scope: Scope) -> dict[int, str]:
    return {row["id"]: row["host"] for row in scope.fetch("SELECT id, host FROM sites WHERE id IN :sites")}


def conversions(scope: Scope) -> dict:
    status = _sources_state(scope, "ga4")
    namer = _channel_namer(scope.engine, scope.site_ids)
    by_channel: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    for row in _ga4_rows(scope, scope.start, scope.end):
        item = by_channel[namer(row["channel"], row["source"], row["medium"])]
        item["sessions"] += int(row["sessions"] or 0)
        item["leads"] += float(row["leads"] or 0)
    pages = _page_rows(scope)
    hosts = _hosts(scope)
    categorise = _categorise(scope.engine, scope.site_ids)
    types: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0, "pages": 0})
    for row in pages:
        item = types[categorise(row["path"])]
        item["sessions"] += int(row["sessions"] or 0)
        item["leads"] += float(row["leads"] or 0)
        item["pages"] += 1
    sessions = sum(item["sessions"] for item in by_channel.values())
    leads = sum(item["leads"] for item in by_channel.values())
    has_leads_set_up = bool(scope.fetch("SELECT 1 x FROM ga4_source_daily WHERE site_id IN :sites AND key_events > 0 LIMIT 1"))
    return {
        **status,
        "sessions": sessions,
        "leads": round(leads, 2),
        "rate": _ratio(leads, sessions),
        "key_events_set_up": has_leads_set_up,
        "funnel": [{"channel": name, "sessions": item["sessions"], "leads": round(item["leads"], 2), "rate": _ratio(item["leads"], item["sessions"]), "lost": item["sessions"] - round(item["leads"])} for name, item in sorted(by_channel.items(), key=lambda pair: -pair[1]["sessions"])],
        "page_types": [{"type": name, "pages": item["pages"], "sessions": item["sessions"], "leads": round(item["leads"], 2), "rate": _ratio(item["leads"], item["sessions"])} for name, item in sorted(types.items(), key=lambda pair: -pair[1]["sessions"])],
        "pages": [{"host": hosts.get(row["site_id"], ""), "path": row["path"], "sessions": int(row["sessions"] or 0), "leads": round(float(row["leads"] or 0), 2), "rate": _ratio(float(row["leads"] or 0), int(row["sessions"] or 0))} for row in sorted(pages, key=lambda r: -float(r["leads"] or 0)) if float(row["leads"] or 0) > 0][:25],
        "hid_rows": _hidden(scope),
    }


# ---- Content -------------------------------------------------------------------------------------


def content(scope: Scope, limit: int = 500) -> dict:
    ga4_state, gsc_state = _sources_state(scope, "ga4"), _sources_state(scope, "gsc")
    pages: dict[tuple[int, str], dict] = {}
    hosts = _hosts(scope)

    def page(site_id: int, path: str) -> dict:
        key = _path(path)
        return pages.setdefault((site_id, key), {"host": hosts.get(site_id, ""), "path": key, "sessions": None, "leads": None, "clicks": None, "impressions": None, "w": 0.0, "ai": None})

    for row in _page_rows(scope):
        item = page(row["site_id"], row["path"])
        item["sessions"] = (item["sessions"] or 0) + int(row["sessions"] or 0)
        item["leads"] = (item["leads"] or 0) + float(row["leads"] or 0)
    for row in scope.fetch("SELECT site_id, MAX(page) page, page_hash, SUM(clicks) clicks, SUM(impressions) impressions, SUM(position * impressions) w FROM gsc_page WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, page_hash"):
        item = page(row["site_id"], row["page"])
        item["clicks"] = (item["clicks"] or 0) + int(row["clicks"] or 0)
        item["impressions"] = (item["impressions"] or 0) + int(row["impressions"] or 0)
        item["w"] += float(row["w"] or 0)
    ai = _ai_domains(scope.engine, scope.site_ids)
    for row in scope.fetch("SELECT site_id, MAX(domain) domain, MAX(path) path, SUM(sessions) sessions FROM ga4_referral_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, row_hash"):
        if _is_ai(row["domain"], ai):
            item = page(row["site_id"], row["path"])
            item["ai"] = (item["ai"] or 0) + int(row["sessions"] or 0)
    categorise = _categorise(scope.engine, scope.site_ids)
    rows = [
        {
            "host": item["host"], "path": item["path"], "category": categorise(item["path"]), "sessions": item["sessions"], "leads": round(item["leads"], 2) if item["leads"] is not None else None,
            "clicks": item["clicks"], "impressions": item["impressions"], "position": round(item["w"] / item["impressions"], 1) if item["impressions"] else None, "ai": item["ai"],
        }
        for item in pages.values()
    ]
    rows.sort(key=lambda r: -((r["sessions"] or 0) + (r["clicks"] or 0)))
    social: dict[str, int] = defaultdict(int)
    for row in _ga4_rows(scope, scope.start, scope.end):
        if str(row["channel"]).lower() in SOCIAL_CHANNELS:
            social[row["source"]] += int(row["sessions"] or 0)
    return {
        "ga4": ga4_state, "gsc": gsc_state, "state": "ok" if rows else (ga4_state["state"] if ga4_state["state"] != "ok" else gsc_state["state"]),
        "pages": rows[:limit], "total_pages": len(rows),
        "social": [{"source": name, "sessions": count} for name, count in sorted(social.items(), key=lambda pair: -pair[1])],
        "hid_rows": _hidden(scope),
    }


# ---- AI search -----------------------------------------------------------------------------------


def ai_search(scope: Scope) -> dict:
    """The AI search screen. Built in seo/metrics/ai_search.py: every block there says its source, period and freshness."""
    from seo.metrics import ai_search as screen

    return screen.build(scope)


def _google_ai(scope: Scope) -> dict:
    from seo.imports import gsc_ai_report

    sites = gsc_ai_report.latest(scope.engine, scope.site_ids, full=False)["sites"]
    return {"sites": sites, "impressions": sum(s["impressions"] or 0 for s in sites) if sites else None}


# ---- Google Ads ----------------------------------------------------------------------------------


def ads(scope: Scope) -> dict:
    status = _sources_state(scope, "ga4")
    rows = scope.fetch(
        "SELECT MAX(campaign) campaign, currency, SUM(clicks) clicks, SUM(cost) cost, SUM(sessions) sessions, SUM(key_events) leads FROM ga4_ads_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY row_hash, currency ORDER BY cost DESC"
    )
    # Different currencies are never added together.
    costs: dict[str, float] = defaultdict(float)
    for row in rows:
        costs[row["currency"] or ""] += float(row["cost"] or 0)
    series = scope.fetch("SELECT day, SUM(clicks) clicks, SUM(sessions) sessions FROM ga4_ads_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day ORDER BY day")
    clicks, leads = sum(int(r["clicks"] or 0) for r in rows), sum(float(r["leads"] or 0) for r in rows)
    return {
        **status, "linked": bool(rows) or bool(scope.fetch("SELECT 1 x FROM ga4_ads_daily WHERE site_id IN :sites LIMIT 1")),
        "clicks": clicks, "leads": round(leads, 2), "costs": [{"currency": name or None, "cost": round(value, 2)} for name, value in sorted(costs.items())],
        "campaigns": [{"campaign": r["campaign"], "currency": r["currency"], "clicks": int(r["clicks"] or 0), "cost": round(float(r["cost"] or 0), 2), "sessions": int(r["sessions"] or 0), "leads": round(float(r["leads"] or 0), 2)} for r in rows],
        "series": [{"day": r["day"].isoformat(), "clicks": int(r["clicks"] or 0), "sessions": int(r["sessions"] or 0)} for r in series],
    }


# ---- Rules, edited ---------------------------------------------------------------------------------

RULE_KINDS = {"channel", "ai_domain", "ai_domain_off", "category", "key_event", "brand"}  # brand: words that make a query a brand search


def add_rule(engine: Engine, kind, pattern, value=None, site_id=None) -> dict:
    if kind not in RULE_KINDS:
        raise Refused("That isn't a kind of rule.")
    clean = pattern.strip() if isinstance(pattern, str) else ""
    if not clean or len(clean) > 255:
        raise Refused("Type what the rule should match.")
    if kind in ("channel", "category") and not (isinstance(value, str) and value.strip()):
        raise Refused("Type the name it should get.")
    named = value.strip()[:120] if isinstance(value, str) and value.strip() else None
    with engine.begin() as conn:
        new_id = conn.execute(
            text("INSERT INTO site_rules (site_id, kind, pattern, value) VALUES (:s, :k, :p, :v)"), {"s": site_id, "k": kind, "p": clean, "v": named}
        ).lastrowid
    return {"id": new_id, "site_id": site_id, "kind": kind, "pattern": clean, "value": named}


def delete_rule(engine: Engine, rule_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM site_rules WHERE id = :i"), {"i": rule_id})


# ---- Page speed and Clarity, shown beside the traffic they explain ----------------------------------


def page_speed(scope: Scope) -> list[dict]:
    """Newest run per site and device. Real visitors' numbers when Google has them, and it says which."""
    rows = scope.fetch(
        "SELECT r.site_id, s.host, r.url, r.strategy, r.performance, r.lcp_ms, r.inp_ms, r.cls, r.field_data, r.ran_at FROM cwv_runs r JOIN sites s ON s.id = r.site_id "
        "JOIN (SELECT site_id, strategy, MAX(id) id FROM cwv_runs WHERE site_id IN :sites GROUP BY site_id, strategy) latest ON latest.id = r.id ORDER BY s.host, r.strategy"
    )
    return [{**{key: row[key] for key in ("host", "url", "strategy", "performance", "lcp_ms", "inp_ms", "cls")}, "field_data": bool(row["field_data"]), "ran_at": row["ran_at"].isoformat() + "Z"} for row in rows]


def clarity(scope: Scope) -> dict:
    rows = scope.fetch("SELECT SUM(sessions) s, SUM(rage_clicks) r, SUM(dead_clicks) d, SUM(scroll_depth * sessions) w, SUM(IF(scroll_depth IS NULL, 0, sessions)) n, COUNT(*) c, SUM(rage_clicks IS NULL) o, MAX(day) last_day FROM clarity_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b")
    row = rows[0] if rows else None
    if not row or not row["c"]:
        return {"has_data": False}
    # Days from the old recordings export have sessions only. Their clicks are unknown, which is not the same as none.
    known = lambda value: None if value is None else int(value)  # noqa: E731
    return {"has_data": True, "sessions": int(row["s"] or 0), "rage_clicks": known(row["r"]), "dead_clicks": known(row["d"]), "scroll_depth": round(float(row["w"]) / float(row["n"]), 1) if row["n"] else None, "days": int(row["c"]), "sessions_only_days": int(row["o"] or 0), "through": row["last_day"].isoformat()}
