"""The numbers behind Overview, Channels, Conversions, Content, AI search and Google Ads.

Everything is worked out when asked, from what collectors stored, so a rule changed today applies to past days too.
A missing day is a gap, never a zero: series only hold days a source really reported. Leads are the visits with a key event
the owner ticked as a lead (seo/metrics/leads.py); until a site has ticked one, screens count GA4's key events and say so.
SQL here writes {leads} for the column a screen adds up and {conv} for the visits that converted; Scope.fetch fills them in.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Engine, bindparam, text

from seo.accounts import access
from seo.core.errors import Refused
from seo.metrics import ga4_checks
from seo.metrics import leads as lead_rules

# GA4 also writes some without their ending, from a UTM tag: "perplexity", "copilot.com", "gemini" (SEO review 2026-11-17, W9).
DEFAULT_AI_DOMAINS = ("chatgpt.com", "chat.openai.com", "openai.com", "perplexity.ai", "perplexity", "gemini.google.com", "gemini", "bard.google.com", "copilot.microsoft.com", "copilot.com", "copilot", "claude.ai", "deepseek.com", "chat.deepseek.com", "you.com", "poe.com", "mistral.ai", "chat.mistral.ai", "grok.com", "x.ai", "meta.ai")
SOCIAL_CHANNELS = {"organic social", "paid social"}
# Content's Social networks, one row per network (owner, 2026-11-12): GA4 writes one network many ways (m.facebook.com,
# l.facebook.com, facebook.com, "meta"; Linkedin and linkedin.com). A source is matched by its words, then by its domain.
SOCIAL_NETWORKS = (
    ("Facebook", "facebook.com", ("facebook", "fb", "fb.com", "fb.me", "meta", "meta.com")),
    ("Instagram", "instagram.com", ("instagram", "ig")),
    ("LinkedIn", "linkedin.com", ("linkedin", "lnkd.in")),
    ("TikTok", "tiktok.com", ("tiktok",)),
    ("X (Twitter)", "x.com", ("twitter", "t.co", "x", "x.com")),
    ("YouTube", "youtube.com", ("youtube", "youtu.be")),
    ("Pinterest", "pinterest.com", ("pinterest", "pin.it")),
    ("Reddit", "reddit.com", ("reddit",)),
    ("Snapchat", "snapchat.com", ("snapchat",)),
    ("WhatsApp", "whatsapp.com", ("whatsapp", "wa.me")),
    ("Threads", "threads.net", ("threads", "threads.com")),
    ("Telegram", "telegram.org", ("telegram", "t.me")),
    ("Quora", "quora.com", ("quora",)),
    ("Tumblr", "tumblr.com", ("tumblr",)),
)
UNKNOWN_PAGES = {"(not set)", "(other)"}  # GA4's words for a page it couldn't name: not a page of the site
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
                self.site_ids = access.own_site_ids(conn)  # "all sites" is all of *their* sites
            else:
                try:
                    wanted = int(site)
                except (TypeError, ValueError) as exc:
                    raise Refused("That site isn't one of yours.") from exc
                if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": wanted}).first():
                    raise Refused("That site isn't one of yours.")
                access.require_site(wanted)
                self.site_ids = [wanted]

    def fetch(self, sql: str, start: date | None = None, end: date | None = None, **values):
        """`sql` uses :sites, :a and :b, and {leads} / {conv} for the lead columns (seo/metrics/leads.py)."""
        if not self.site_ids:
            return []
        if "{leads}" in sql or "{conv}" in sql:
            sql = sql.replace("{leads}", lead_rules.count_sql(self.lead_kind)).replace("{conv}", lead_rules.converted_sql(self.lead_kind))
        statement = text(sql).bindparams(bindparam("sites", expanding=True))
        with self.engine.connect() as conn:
            return conn.execute(statement, {"sites": self.site_ids, "a": start or self.start, "b": end or self.end, **values}).mappings().all()

    @property
    def lead_kind(self) -> str:
        """"leads" once a site of the scope has picked its lead events, else "key_events"."""
        if "_lead_kind" not in self.__dict__:
            self.__dict__["_lead_kind"] = lead_rules.kind(self.engine, self.site_ids)
        return self.__dict__["_lead_kind"]

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


def spelled_path(url_or_path: str) -> str:
    """A page's address as Google or the site wrote it: no domain, query or fragment, but its trailing slash kept or left
    out as given. Shown and linked; _path() stays the key pages are matched on (expert review 2026-11-17, #19)."""
    value = url_or_path or ""
    path = urlsplit(value).path if "://" in value else value.split("?", 1)[0].split("#", 1)[0]
    return path or "/"


class Spelling:
    """The spelling to show for each page key: Search Console's (rank 0) beats the page reader's (1) beats Google
    Analytics' (2); between two of the same rank, the one with more clicks and impressions."""

    def __init__(self) -> None:
        self.best: dict = {}

    def offer(self, key, url_or_path: str, rank: int, weight: float = 0) -> None:
        if not url_or_path:
            return
        held = self.best.get(key)
        if held is None or (rank, -weight) < held[0]:
            self.best[key] = ((rank, -weight), spelled_path(url_or_path))

    def get(self, key, fallback: str) -> str:
        held = self.best.get(key)
        return held[1] if held else fallback


def _unknown_page(path: str) -> bool:
    """GA4's "(not set)" written as a page ("(not set)/" once it has its slash): shown last, never as a link."""
    return str(path or "").strip("/").strip().lower() in UNKNOWN_PAGES


def _social_network(source: str) -> tuple[str, str | None]:
    """The network a GA4 social source belongs to, and its domain for the logo: m.facebook.com and "meta" are Facebook.
    A source matching none keeps its own name, with itself as the domain when it is one."""
    raw = str(source or "").strip().lower()
    host = raw.split("/", 1)[0].removeprefix("www.")
    labels = host.split(".")
    for name, domain, words in SOCIAL_NETWORKS:
        if raw in words or host in words or host == domain or host.endswith(f".{domain}"):
            return name, domain
        # lm.facebook.com, facebook.de, linkedin.android: the network's word as a label of the host
        if any(word.isalpha() and len(word) > 3 and word in labels for word in words):
            return name, domain
    return (source or "(not set)"), (host if "." in host else None)


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
        "lag_note": "Lags 2–3 days",
    }


# ---- Rules ---------------------------------------------------------------------------------------


def rules(engine: Engine, kind: str, site_ids: list[int]) -> list[dict]:
    statement = text("SELECT id, site_id, pattern, value FROM site_rules WHERE kind = :k AND (site_id IS NULL OR site_id IN :sites) ORDER BY id").bindparams(bindparam("sites", expanding=True))
    with engine.connect() as conn:
        return [dict(row) for row in conn.execute(statement, {"k": kind, "sites": site_ids or [0]}).mappings().all()]


def _compile(pattern: str):
    return re.compile(re.escape(pattern).replace(r"\*", ".*"), re.I)


AI_CHANNEL = "AI assistants"  # the one channel AI visits are shown in on Channels and Conversions


def _channel_namer(engine: Engine, site_ids: list[int], ai: bool = False):
    """A rule's pattern is source/medium with * as a wildcard: chatgpt.com/* or */newsletter. The first match wins, and the rest stay GA4's grouping.

    ai=True (Channels, Conversions and their panels): a visit AI search counts (the AI list, or GA4's own AI grouping) is
    in AI_CHANNEL rather than hidden in Referral or Unassigned (expert review 2026-11-17, #22). A rule still wins."""
    compiled = [(_compile(rule["pattern"]), rule["value"]) for rule in rules(engine, "channel", site_ids) if rule["value"]]
    domains = _ai_domains(engine, site_ids) if ai else None
    if ai:
        from seo.metrics.ai_search import is_ai_channel  # noqa: PLC0415 - ai_search imports this module
    else:
        is_ai_channel = None

    def name(channel: str, source: str, medium: str) -> str:
        pair = f"{source}/{medium}"
        for pattern, value in compiled:
            if pattern.fullmatch(pair):
                return value
        if domains is not None and (_is_ai((source or "").strip().lower(), domains) or is_ai_channel(channel)):
            return AI_CHANNEL
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
        "SELECT day, channel, source, medium, SUM(sessions) sessions, SUM(users) users, SUM({leads}) leads, SUM({conv}) conv FROM ga4_source_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day, channel, source, medium",
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


def _copy(scope: Scope, site_ids: list[int] | None = None) -> Scope:
    """The same question for other sites or days, leaving the scope it was copied from as it was."""
    other = Scope.__new__(Scope)
    other.__dict__.update(scope.__dict__)
    if site_ids is not None:
        other.site_ids = list(site_ids)
        other.__dict__.pop("_lead_kind", None)
    return other


def _days() -> dict:
    return defaultdict(lambda: {"sessions": 0, "leads": 0.0, "conv": 0.0})


def _add(item: dict, row) -> None:
    item["sessions"] += int(row["sessions"] or 0)
    item["leads"] += float(row["leads"] or 0)
    item["conv"] = item.get("conv", 0.0) + float(row.get("conv") or 0)


def _add_day(days: dict, row) -> None:
    _add(days[row["day"].isoformat()], row)


def _conv_rate(item: dict) -> float | None:
    """Visits that became a lead (or had a key event) out of all visits: never over 100%."""
    return _ratio(min(item.get("conv", item["leads"]), item["sessions"]), item["sessions"])


def _day_rows(days: dict) -> list[dict]:
    """Only the days the source reported: a missing day is a gap for the graph, never a zero."""
    return [{"day": day, "sessions": item["sessions"], "leads": round(item["leads"], 2)} for day, item in sorted(days.items())]


def lead_words(scope: Scope, start: date, end: date, compare_start: date | None = None) -> dict:
    """What a GA4 screen says about its leads: whether they are leads or key events (lead_kind), the days GA4 changed how
    it counts them inside the period or across the comparison (lead_check; its change is then blank), and the sites still
    being read again with key events by name."""
    from seo.collectors import ga4 as collector

    check = ga4_checks.lead_check(scope.engine, scope.site_ids, scope.lead_kind, start, end, compare_start)
    rereading = sum(collector.days_to_reread(scope.engine, site_id) for site_id in scope.site_ids)
    return {"lead_kind": scope.lead_kind, "lead_check": check, "reread_days": rereading}


def visits_words(scope: Scope) -> dict:
    """What a GA4 screen says about its visits change: too little data in the period before (no change), and the unusual
    days of both periods with the change without them (SEO review 2026-11-17, W6 and W11)."""
    little = bool(scope.has_compare and scope.site_ids and all(ga4_checks.little_before(scope.engine, s, scope.compare_start, scope.compare_end, scope.start, scope.end) for s in scope.site_ids))
    unusual = ga4_checks.unusual_change(scope.engine, scope.site_ids, scope.start, scope.end, scope.compare_start if scope.has_compare else None, scope.compare_end if scope.has_compare else None)
    return {"little_before": little, "unusual": unusual}


# ---- Channels ------------------------------------------------------------------------------------


def channels(scope: Scope) -> dict:
    status = _sources_state(scope, "ga4")
    period = _trim_to_data(scope)
    namer = _channel_namer(scope.engine, scope.site_ids, ai=True)
    totals: dict[str, dict] = _days()
    per_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    referrers: dict[str, dict] = _days()
    daily, daily_before = _days(), _days()  # every channel together, for the number cards' graphs (simpler screens)
    for row in _ga4_rows(scope, scope.start, scope.end):
        name = namer(row["channel"], row["source"], row["medium"])
        _add(totals[name], row)
        per_day[row["day"].isoformat()][name] += int(row["sessions"] or 0)
        _add_day(daily, row)
        if row["medium"] == "referral":
            _add(referrers[row["source"]], row)
    past: dict[str, dict] = _days()
    if scope.has_compare:
        for row in _ga4_rows(scope, scope.compare_start, scope.compare_end):
            name = namer(row["channel"], row["source"], row["medium"])
            _add(past[name], row)
            _add_day(daily_before, row)
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
    leads_said = lead_words(scope, scope.start, scope.end, scope.compare_start if scope.has_compare else None)
    visits_said = visits_words(scope)
    before = {"sessions": sum(item["sessions"] for item in past.values()), "leads": round(sum(item["leads"] for item in past.values()), 2), "converted": round(sum(item["conv"] for item in past.values()), 2)} if scope.has_compare and past else None
    if before and leads_said["lead_check"]["blank"]:
        before.update(leads=None, converted=None)  # GA4 counted them another way then: no change (W1)
    if before and visits_said["little_before"]:
        before = None  # too little data before to compare with (W6)
    return {
        **status, **leads_said, **visits_said,
        "total": {"sessions": all_sessions, "leads": round(sum(item["leads"] for item in totals.values()), 2), "converted": round(sum(item["conv"] for item in totals.values()), 2)},
        "before": before,
        "channels": [
            {
                "channel": name, "sessions": totals[name]["sessions"], "leads": round(totals[name]["leads"], 2), "rate": _conv_rate(totals[name]),
                "share": _ratio(totals[name]["sessions"], all_sessions), "change": _pct_change(totals[name]["sessions"], past[name]["sessions"]) if scope.has_compare and name in past and before else None,
            }
            for name in order
        ],
        "series": series,
        "series_names": top + (["Other"] if len(order) > TOP_SERIES else []),
        "referrers": [{"domain": name, "sessions": item["sessions"], "leads": round(item["leads"], 2)} for name, item in sorted(referrers.items(), key=lambda pair: -pair[1]["sessions"])[:20]],
        "rules": rules(scope.engine, "channel", scope.site_ids),
        "hid_rows": _hidden(scope), "period": period,
        "days": _day_rows(daily), "days_before": _day_rows(daily_before) if scope.has_compare else None,
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
        "SELECT site_id, MAX(path) path, page_hash, SUM(sessions) sessions, SUM({leads}) leads, SUM({conv}) conv FROM ga4_page_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, page_hash"
    )


def _hosts(scope: Scope) -> dict[int, str]:
    return {row["id"]: row["host"] for row in scope.fetch("SELECT id, host FROM sites WHERE id IN :sites")}


def conversions(scope: Scope) -> dict:
    status = _sources_state(scope, "ga4")
    namer = _channel_namer(scope.engine, scope.site_ids, ai=True)
    by_channel: dict[str, dict] = _days()
    daily = _days()
    for row in _ga4_rows(scope, scope.start, scope.end):
        _add(by_channel[namer(row["channel"], row["source"], row["medium"])], row)
        _add_day(daily, row)
    pages = _page_rows(scope)
    hosts = _hosts(scope)
    categorise = _categorise(scope.engine, scope.site_ids)
    types: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0, "conv": 0.0, "pages": 0})
    for row in pages:
        item = types[categorise(row["path"])]
        _add(item, row)
        item["pages"] += 1
    sessions = sum(item["sessions"] for item in by_channel.values())
    leads = sum(item["leads"] for item in by_channel.values())
    converted = sum(item["conv"] for item in by_channel.values())
    has_leads_set_up = bool(scope.fetch("SELECT 1 x FROM ga4_source_daily WHERE site_id IN :sites AND {leads} > 0 LIMIT 1"))
    return {
        **status,
        "sessions": sessions,
        "leads": round(leads, 2),
        "converted": round(converted, 2),
        "rate": _ratio(min(converted, sessions), sessions),
        "key_events_set_up": has_leads_set_up,
        # Visits that didn't become a lead: visits less the visits with one, never below 0 (W8).
        "funnel": [{"channel": name, "sessions": item["sessions"], "leads": round(item["leads"], 2), "rate": _conv_rate(item), "lost": max(0, item["sessions"] - round(item["conv"]))} for name, item in sorted(by_channel.items(), key=lambda pair: -pair[1]["sessions"])],
        "page_types": [{"type": name, "pages": item["pages"], "sessions": item["sessions"], "leads": round(item["leads"], 2), "rate": _conv_rate(item)} for name, item in sorted(types.items(), key=lambda pair: -pair[1]["sessions"])],
        "pages": [{"host": hosts.get(row["site_id"], ""), "path": row["path"], "sessions": int(row["sessions"] or 0), "leads": round(float(row["leads"] or 0), 2), "rate": _conv_rate({"sessions": int(row["sessions"] or 0), "leads": float(row["leads"] or 0), "conv": float(row["conv"] or 0)}), "unknown": _unknown_page(row["path"])} for row in sorted(pages, key=lambda r: (_unknown_page(r["path"]), -float(r["leads"] or 0))) if float(row["leads"] or 0) > 0][:25],
        "hid_rows": _hidden(scope),
        **_conversions_before(scope, daily, sessions, converted),
    }


def _conversions_before(scope: Scope, daily: dict, sessions: int, converted: float) -> dict:
    """The period before, for Conversions' number cards (simpler screens): its totals, the changes, and both periods day by
    day. The comparison is cut to as many days as the period really has, as Channels does (F112), on a copy of the scope,
    so the totals above stay exactly what they were. No comparison, or no data in it: before is None, never zeros."""
    window = _copy(scope)
    period = _trim_to_data(window)
    before, daily_before = None, None
    if window.has_compare:
        daily_before = _days()
        for row in _ga4_rows(window, window.compare_start, window.compare_end):
            _add_day(daily_before, row)
        if daily_before:
            was_sessions = sum(item["sessions"] for item in daily_before.values())
            was_leads = round(sum(item["leads"] for item in daily_before.values()), 2)
            was_conv = sum(item["conv"] for item in daily_before.values())
            before = {"sessions": was_sessions, "leads": was_leads, "rate": _ratio(min(was_conv, was_sessions), was_sessions)}
    now_leads = round(sum(item["leads"] for item in daily.values()), 2)
    now_rate = _ratio(min(converted, sessions), sessions)
    leads_said = lead_words(window, window.start, window.end, window.compare_start if window.has_compare else None)
    visits_said = visits_words(window)
    if before and visits_said["little_before"]:
        before = None  # too little data before to compare with (W6)
    if before and leads_said["lead_check"]["blank"]:
        before.update(leads=None, rate=None)  # GA4 counted them another way then: no change (W1)
    changes = {}
    if before:
        # Counts change in %, the lead rate in points, as the number cards show them.
        changes = {
            "sessions": _pct_change(sessions, before["sessions"]), "leads": _pct_change(now_leads, before["leads"]) if before["leads"] is not None else None,
            "rate_points": round((now_rate - before["rate"]) * 100, 2) if now_rate is not None and before["rate"] is not None else None,
        }
    return {**leads_said, **visits_said, "period": period, "before": before, "changes": changes, "days": _day_rows(daily), "days_before": _day_rows(daily_before) if daily_before is not None else None}


# ---- Content -------------------------------------------------------------------------------------


def content(scope: Scope, limit: int = 500) -> dict:
    ga4_state, gsc_state = _sources_state(scope, "ga4"), _sources_state(scope, "gsc")
    pages: dict[tuple[int, str], dict] = {}
    hosts = _hosts(scope)

    def page(site_id: int, path: str) -> dict:
        key = _path(path)
        return pages.setdefault((site_id, key), {"host": hosts.get(site_id, ""), "path": key, "sessions": None, "leads": None, "clicks": None, "impressions": None, "w": 0.0, "ai": None})

    spelling = Spelling()
    for row in _page_rows(scope):
        item = page(row["site_id"], row["path"])
        item["sessions"] = (item["sessions"] or 0) + int(row["sessions"] or 0)
        item["leads"] = (item["leads"] or 0) + float(row["leads"] or 0)
        spelling.offer((row["site_id"], _path(row["path"])), row["path"], 2, int(row["sessions"] or 0))
    from seo.metrics import period

    gsc, gsc_window = period.search_scope(scope)  # Search Console's numbers on the shared period, as Today and Overview
    for row in gsc.fetch("SELECT site_id, MAX(page) page, page_hash, SUM(clicks) clicks, SUM(impressions) impressions, SUM(position * impressions) w FROM gsc_page WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, page_hash"):
        item = page(row["site_id"], row["page"])
        spelling.offer((row["site_id"], _path(row["page"])), row["page"], 0, int(row["clicks"] or 0) * 1_000_000 + int(row["impressions"] or 0))
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
            "host": item["host"], "path": spelling.get(key, item["path"]), "key": item["path"], "category": categorise(item["path"]), "sessions": item["sessions"], "leads": round(item["leads"], 2) if item["leads"] is not None else None,
            "clicks": item["clicks"], "impressions": item["impressions"], "position": round(item["w"] / item["impressions"], 1) if item["impressions"] else None, "ai": item["ai"],
            "unknown": _unknown_page(item["path"]),
        }
        for key, item in pages.items()
    ]
    # GA4's "(not set)" isn't a page of the site: it goes last, marked, so it is never read as a real page (owner, 2026-11-12).
    rows.sort(key=lambda r: (r["unknown"], -((r["sessions"] or 0) + (r["clicks"] or 0))))
    # One row per network, whichever way GA4 wrote it, with the domain its logo comes from and the sources it groups.
    social: dict[str, dict] = {}
    for row in _ga4_rows(scope, scope.start, scope.end):
        if str(row["channel"]).lower() in SOCIAL_CHANNELS:
            name, domain = _social_network(row["source"])
            item = social.setdefault(name, {"source": name, "domain": domain, "sessions": 0, "sources": set()})
            item["sessions"] += int(row["sessions"] or 0)
            item["sources"].add(str(row["source"] or ""))
    return {
        "ga4": ga4_state, "gsc": gsc_state, "state": "ok" if rows else (ga4_state["state"] if ga4_state["state"] != "ok" else gsc_state["state"]),
        "pages": rows[:limit], "total_pages": len(rows),
        "social": [{**item, "sources": sorted(item["sources"])} for item in sorted(social.values(), key=lambda item: (-item["sessions"], item["source"]))],
        "hid_rows": _hidden(scope), "gsc_window": gsc_window, "lead_kind": scope.lead_kind,
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
        raise Refused("Type the channel name.")
    named = value.strip()[:120] if isinstance(value, str) and value.strip() else None
    with engine.begin() as conn:
        access.require_site_or_every(site_id, conn)  # a rule for every site needs every site
        if site_id is not None:
            if isinstance(site_id, bool) or not (isinstance(site_id, int) or (isinstance(site_id, str) and site_id.isascii() and site_id.isdigit())):
                raise Refused("That site isn't one of yours.")
            site_id = int(site_id)
            if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": site_id}).first():
                raise Refused("That site isn't one of yours.")
        if kind == "key_event" and site_id is None:
            raise Refused("Pick the site whose key event this is.")
        new_id = conn.execute(
            text("INSERT INTO site_rules (site_id, kind, pattern, value) VALUES (:s, :k, :p, :v)"), {"s": site_id, "k": kind, "p": clean, "v": named}
        ).lastrowid
    if kind == "key_event":
        lead_rules.recompute(engine, site_id)
    return {"id": new_id, "site_id": site_id, "kind": kind, "pattern": clean, "value": named}


def delete_rule(engine: Engine, rule_id: int) -> None:
    with engine.begin() as conn:
        held = conn.execute(text("SELECT kind, site_id FROM site_rules WHERE id = :i"), {"i": rule_id}).first()
        conn.execute(text("DELETE FROM site_rules WHERE id = :i"), {"i": rule_id})
    if held and held[0] == "key_event" and held[1]:
        lead_rules.recompute(engine, held[1])


# ---- Page speed and Clarity, shown beside the traffic they explain ----------------------------------


# Google's "good" limits for Core Web Vitals, at the 75th percentile of real visitors (web.dev/articles/vitals).
CWV_GOOD = {"lcp_ms": 2500, "inp_ms": 200, "cls": 0.1}


def cwv_verdict(lcp_ms, inp_ms, cls, field: bool) -> bool | None:
    """Core Web Vitals passed or failed, as PageSpeed Insights says it: only from real visitors, on the metrics Google has.
    A lab test never passes or fails: None."""
    if not field:
        return None
    known = [(value, CWV_GOOD[name]) for name, value in (("lcp_ms", lcp_ms), ("inp_ms", inp_ms), ("cls", cls)) if value is not None]
    if not known:
        return None
    return all(value <= limit for value, limit in known)


def speed_run(row) -> dict:
    """One PageSpeed run as every screen shows it. The score is always the lab test's. `field` says whose real visitors the
    timings are: "page", "site" (Google had too few on the page and gave the whole site's), or None (lab test timings)."""
    field = ("site" if row.get("field_origin") else "page") if row.get("field_data") else None
    return {
        "performance": row["performance"], "lcp_ms": row["lcp_ms"], "inp_ms": row["inp_ms"], "cls": row["cls"],
        "field_data": bool(row.get("field_data")), "field": field, "passed": cwv_verdict(row["lcp_ms"], row["inp_ms"], row["cls"], bool(field)),
        "ran_at": row["ran_at"].isoformat() + "Z" if row.get("ran_at") else None,
    }


def page_speed(scope: Scope) -> list[dict]:
    """Newest run per site and device. Real visitors' numbers when Google has them, and it says whose."""
    rows = scope.fetch(
        "SELECT r.site_id, s.host, r.url, r.strategy, r.performance, r.lcp_ms, r.inp_ms, r.cls, r.field_data, r.field_origin, r.ran_at FROM cwv_runs r JOIN sites s ON s.id = r.site_id "
        "JOIN (SELECT site_id, strategy, MAX(id) id FROM cwv_runs WHERE site_id IN :sites GROUP BY site_id, strategy) latest ON latest.id = r.id ORDER BY s.host, r.strategy"
    )
    return [{"host": row["host"], "url": row["url"], "strategy": row["strategy"], **speed_run(row)} for row in rows]


def clarity(scope: Scope) -> dict:
    """Clarity's read on day D covers the 24 hours before it, so the period's days are read one day on, as AI search
    reads them (SEO review 2026-11-17, W10), and "through" is the last day covered."""
    rows = scope.fetch("SELECT SUM(sessions) s, SUM(rage_clicks) r, SUM(dead_clicks) d, SUM(scroll_depth * sessions) w, SUM(IF(scroll_depth IS NULL, 0, sessions)) n, COUNT(*) c, SUM(rage_clicks IS NULL) o, MAX(day) - INTERVAL 1 DAY last_day FROM clarity_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b", scope.start + timedelta(days=1), scope.end + timedelta(days=1))
    row = rows[0] if rows else None
    if not row or not row["c"]:
        return {"has_data": False}
    # Days from the old recordings export have sessions only. Their clicks are unknown, which is not the same as none.
    known = lambda value: None if value is None else int(value)  # noqa: E731
    return {"has_data": True, "sessions": int(row["s"] or 0), "rage_clicks": known(row["r"]), "dead_clicks": known(row["d"]), "scroll_depth": round(float(row["w"]) / float(row["n"]), 1) if row["n"] else None, "days": int(row["c"]), "sessions_only_days": int(row["o"] or 0), "through": row["last_day"].isoformat()}


# ---- One row's side panel (simpler screens, change 6) -------------------------------------------------------------
# A channel, a referring site, a page or an assistant, opened from its table row. Each is worked out from the same stored
# rows, rules and period as the table it opens from, so the panel's totals are the row's. A list keeps PANEL_ROWS rows and
# says how many there are in all (…_total). A day the source reported is in the days, at 0 when the row had nothing that
# day; a day it didn't report is left out, so a graph shows a gap there and never a made-up zero.

PANEL_ROWS = 100
_NO_DAY = date(1900, 1, 1)  # stands for "no period before", so one query can read both periods
_BOTH = "(day BETWEEN :a AND :b OR day BETWEEN :ca AND :cb)"


def _named(value, what: str, longest: int = 190) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > longest:
        raise Refused(f"Say which {what}.")
    return value.strip()


def _fetch_lists(scope: Scope, sql: str, start, end, lists: dict, **values):
    """Scope.fetch with lists besides :sites, each written :name in the SQL. An empty list matches nothing."""
    if not scope.site_ids or any(not items for items in lists.values()):
        return []
    sql = sql.replace("{leads}", lead_rules.count_sql(scope.lead_kind)).replace("{conv}", lead_rules.converted_sql(scope.lead_kind))
    statement = text(sql).bindparams(bindparam("sites", expanding=True), *(bindparam(name, expanding=True) for name in lists))
    with scope.engine.connect() as conn:
        return conn.execute(statement, {"sites": scope.site_ids, "a": start, "b": end, **lists, **values}).mappings().all()


def _listed(now: dict, past: dict | None, label: str) -> list[dict]:
    """A panel list, biggest first. Each row has its own change when the period before had it, else none."""
    rows = []
    for key, item in now.items():
        was = past.get(key) if past is not None else None
        rows.append({
            label: key, "sessions": item["sessions"], "leads": round(item["leads"], 2), "rate": _conv_rate(item),
            "before": was["sessions"] if was else None, "change": _pct_change(item["sessions"], was["sessions"]) if was else None,
        })
    rows.sort(key=lambda r: (-r["sessions"], -r["leads"], str(r[label])))
    return rows


def _summed(days: dict) -> tuple[int, float]:
    return sum(item["sessions"] for item in days.values()), round(sum(item["leads"] for item in days.values()), 2)


def channel_detail(scope: Scope, name) -> dict:
    """One row of Channels: the channel's days, and the sources and mediums inside it. The same rules and trimmed period
    as channels(), so its visits, share and change are the row's."""
    name = _named(name, "channel")
    status = _sources_state(scope, "ga4")
    period = _trim_to_data(scope)
    namer = _channel_namer(scope.engine, scope.site_ids, ai=True)

    def gather(start, end) -> dict:
        days, sources, mediums = {}, _days(), _days()
        everything, found = 0, False
        for row in _ga4_rows(scope, start, end):
            sessions, leads = int(row["sessions"] or 0), float(row["leads"] or 0)
            everything += sessions
            day = days.setdefault(row["day"].isoformat(), {"sessions": 0, "leads": 0.0})  # GA4 reported this day
            if namer(row["channel"], row["source"], row["medium"]) != name:
                continue
            found = True
            for item in (day, sources[row["source"]], mediums[row["medium"]]):
                item["sessions"] += sessions
                item["leads"] += leads
        return {"days": days, "sources": sources, "mediums": mediums, "everything": everything, "found": found}

    now = gather(scope.start, scope.end)
    past = gather(scope.compare_start, scope.compare_end) if scope.has_compare else None
    sessions, leads = _summed(now["days"])
    before = None
    if past and past["found"]:  # as the row: no change when the channel had no visits in the period before
        was_sessions, was_leads = _summed(past["days"])
        before = {"sessions": was_sessions, "leads": was_leads, "rate": _conv_rate({"sessions": was_sessions, "leads": was_leads})}
    sources = _listed(now["sources"], past["sources"] if past else None, "source")
    mediums = _listed(now["mediums"], past["mediums"] if past else None, "medium")
    return {
        **status, "kind": "channel", "name": name, "lead_kind": scope.lead_kind, "found": now["found"] or bool(past and past["found"]), "period": period,
        "totals": {"sessions": sessions, "leads": leads, "rate": _conv_rate({"sessions": sessions, "leads": leads}), "share": _ratio(sessions, now["everything"])} if now["days"] else None,
        "before": before, "change": _pct_change(sessions, before["sessions"]) if before else None,
        "days": _day_rows(now["days"]), "days_before": _day_rows(past["days"]) if past else None,
        "sources": sources[:PANEL_ROWS], "sources_total": len(sources),
        "mediums": mediums[:PANEL_ROWS], "mediums_total": len(mediums),
        "logos": known_logos(scope.engine, [row["source"] for row in sources]),
        "hid_rows": _hidden(scope),
    }


def referrer_detail(scope: Scope, domain) -> dict:
    """One row of Channels' referring sites: its days, and the pages it sent visits to. Visits and leads are the row's
    (GA4's source/medium report, medium referral). The pages come from GA4's referral report, which leaves out visits that
    carried a UTM campaign, so they can add up to fewer."""
    domain = _named(domain, "site")
    status = _sources_state(scope, "ga4")
    period = _trim_to_data(scope)

    def gather(start, end) -> tuple[dict, bool]:
        days, found = {}, False
        for row in _ga4_rows(scope, start, end):
            day = days.setdefault(row["day"].isoformat(), {"sessions": 0, "leads": 0.0})
            if row["medium"] == "referral" and row["source"] == domain:
                found = True
                day["sessions"] += int(row["sessions"] or 0)
                day["leads"] += float(row["leads"] or 0)
        return days, found

    days, found = gather(scope.start, scope.end)
    past, found_before = gather(scope.compare_start, scope.compare_end) if scope.has_compare else (None, False)
    sessions, leads = _summed(days)
    before = None
    if found_before:
        was_sessions, was_leads = _summed(past)
        before = {"sessions": was_sessions, "leads": was_leads, "rate": _conv_rate({"sessions": was_sessions, "leads": was_leads})}
    hosts = _hosts(scope)
    landing: dict[tuple[int, str], dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    for row in scope.fetch(
        "SELECT site_id, MAX(path) path, SUM(sessions) sessions, SUM({leads}) leads FROM ga4_referral_daily "
        "WHERE site_id IN :sites AND domain = :d AND day BETWEEN :a AND :b GROUP BY site_id, row_hash", d=domain.lower(),
    ):
        item = landing[(row["site_id"], _path(row["path"]))]
        item["sessions"] += int(row["sessions"] or 0)
        item["leads"] += float(row["leads"] or 0)
    pages = sorted(
        ({"host": hosts.get(site_id, ""), "path": path, "sessions": item["sessions"], "leads": round(item["leads"], 2)} for (site_id, path), item in landing.items()),
        key=lambda p: (-p["sessions"], p["host"], p["path"]),
    )
    return {
        **status, "kind": "referrer", "domain": domain, "lead_kind": scope.lead_kind, "found": found or found_before, "period": period,
        "totals": {"sessions": sessions, "leads": leads, "rate": _conv_rate({"sessions": sessions, "leads": leads})} if days else None,
        "before": before, "change": _pct_change(sessions, before["sessions"]) if before else None,
        "days": _day_rows(days), "days_before": _day_rows(past) if past is not None else None,
        "pages": pages[:PANEL_ROWS], "pages_total": len(pages),
        "logos": known_logos(scope.engine, [domain]),
        "hid_rows": _hidden(scope),
    }


def _page_window(scope: Scope, table: str) -> dict:
    """This period as content() reads it, and the period before cut to as many days as this source really has. Search
    Console lags 2 to 3 days: compared with a full period before, every page would look as if it fell (F112)."""
    found = scope.fetch(f"SELECT MAX(day) d FROM {table} WHERE site_id IN :sites")
    last = found[0]["d"] if found else None
    trimmed = bool(last and scope.start <= last < scope.end)
    to = last if trimmed else scope.end
    window = {"a": scope.start, "b": scope.end, "to": to, "trimmed": trimmed, "ca": _NO_DAY, "cb": _NO_DAY, "compare": scope.has_compare}
    if scope.has_compare:
        window["ca"] = scope.compare_start
        window["cb"] = min(scope.compare_end, scope.compare_start + (to - scope.start)) if trimmed else scope.compare_end
    return window


def _gsc_window(scope: Scope) -> dict:
    """Search Console's side of a page, in the same shape: the shared period (seo/metrics/period.py), so a page's clicks
    are the ones Today, Overview and the Pages list give. No earlier page data stored: no comparison, never a made-up gain."""
    from seo.metrics import period

    gsc, window = period.search_scope(scope)
    compared = period.rows_compared(gsc, "page")
    return {"a": gsc.start, "b": gsc.end, "to": gsc.end, "trimmed": gsc.end < scope.end, "compare": compared,
            "ca": gsc.compare_start if compared else _NO_DAY, "cb": gsc.compare_end if compared else _NO_DAY, "window": window}


def search_args(args) -> dict:
    """The shared range a screen sent beside its dates (UI.range.days adds it), for the Search Console side of the answer."""
    return {key: args.get(key) for key in ("range", "compare", "from", "to") if args.get(key)} if args and args.get("range") else {}


def _window_words(window: dict) -> dict:
    return {
        "from": window["a"].isoformat(), "to": window["to"].isoformat(), "trimmed": window["trimmed"],
        "compare_from": window["ca"].isoformat() if window["compare"] else None, "compare_to": window["cb"].isoformat() if window["compare"] else None,
    }


def page_detail(scope: Scope, path, host=None) -> dict:
    """One page of Content or Conversions: visits and leads (GA4), Google clicks and position (Search Console), AI visits,
    its days, the searches that bring it and the assistants that send it visits. The same rows and matching as content()
    (/a and https://site/a/?x=1 are one page), so its totals are the row's; a source with nothing for the page is blank.
    host says which site the page is on; with one site picked it can be left out."""
    raw = _named(path, "page", 2000)
    if host is not None and not isinstance(host, str):
        raise Refused("That site isn't one of yours.")
    wanted_host = (host or "").strip().lower() or ((urlsplit(raw).hostname or "") if "://" in raw else "")
    hosts = _hosts(scope)
    if wanted_host:
        bare = wanted_host[4:] if wanted_host.startswith("www.") else wanted_host
        ids = [site_id for site_id, name in hosts.items() if name.lower() in (wanted_host, bare)]
        if not ids:
            raise Refused("That site isn't one of yours.")
    elif len(scope.site_ids) == 1:
        ids = list(scope.site_ids)
    else:
        raise Refused("Say which site the page is on.")
    site_id = ids[0]
    one = _copy(scope, [site_id])
    wanted = _path(raw)
    ga4w, gscw = _page_window(one, "ga4_page_daily"), _gsc_window(one)

    def both(window: dict) -> dict:
        return {"ca": window["ca"], "cb": window["cb"]}

    def now_of(window: dict):
        return lambda day: window["a"] <= day <= window["b"]

    def before_of(window: dict):
        return lambda day: window["compare"] and window["ca"] <= day <= window["cb"]

    # GA4 writes a page as /a or /a/: every spelling of this one, found the way content() finds them.
    hashes = [r["h"] for r in one.fetch(f"SELECT page_hash h, MAX(path) path FROM ga4_page_daily WHERE site_id IN :sites AND {_BOTH} GROUP BY page_hash", ga4w["a"], ga4w["b"], **both(ga4w)) if _path(r["path"]) == wanted]
    ga4_days = {r["day"]: r for r in _fetch_lists(one, f"SELECT day, SUM(sessions) s, SUM({{leads}}) k, SUM({{conv}}) v FROM ga4_page_daily WHERE site_id IN :sites AND page_hash IN :hashes AND {_BOTH} GROUP BY day", ga4w["a"], ga4w["b"], {"hashes": hashes}, **both(ga4w))}
    ga4_seen = {r["day"] for r in one.fetch(f"SELECT DISTINCT day FROM ga4_page_daily WHERE site_id IN :sites AND {_BOTH}", ga4w["a"], ga4w["b"], **both(ga4w))}
    # Search Console: every address Google showed for it (http or https, with a query string or not).
    shown_as = [(r["h"], r["page"]) for r in one.fetch(f"SELECT page_hash h, MAX(page) page FROM gsc_page WHERE site_id IN :sites AND {_BOTH} GROUP BY page_hash", gscw["a"], gscw["b"], **both(gscw)) if _path(r["page"]) == wanted]
    gsc_days = {r["day"]: r for r in _fetch_lists(one, f"SELECT day, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_page WHERE site_id IN :sites AND page_hash IN :hashes AND {_BOTH} GROUP BY day", gscw["a"], gscw["b"], {"hashes": [h for h, _ in shown_as]}, **both(gscw))}
    gsc_seen = {r["day"] for r in one.fetch(f"SELECT DISTINCT day FROM gsc_page WHERE site_id IN :sites AND {_BOTH}", gscw["a"], gscw["b"], **both(gscw))}

    # The searches that bring it, for both periods, joined across its addresses.
    searches: dict[str, dict] = {}
    for r in _fetch_lists(
        one,
        "SELECT MAX(query) query, MAX(page) page, SUM(IF(day BETWEEN :a AND :b, clicks, 0)) c, SUM(IF(day BETWEEN :a AND :b, impressions, 0)) i, "
        "SUM(IF(day BETWEEN :a AND :b, position * impressions, 0)) w, SUM(IF(day BETWEEN :ca AND :cb, clicks, 0)) pc "
        f"FROM gsc_query_page WHERE site_id IN :sites AND page IN :pages AND {_BOTH} GROUP BY pair_hash",
        gscw["a"], gscw["b"], {"pages": sorted({page for _, page in shown_as})}, **both(gscw),
    ):
        if _path(r["page"]) != wanted:  # the address list compares without case: this keeps it exact, as content() does
            continue
        item = searches.setdefault(r["query"], {"clicks": 0, "impressions": 0, "w": 0.0, "before": 0})
        item["clicks"] += int(r["c"] or 0)
        item["impressions"] += int(r["i"] or 0)
        item["w"] += float(r["w"] or 0)
        item["before"] += int(r["pc"] or 0)
    queries = sorted(
        (
            {
                "query": query, "clicks": q["clicks"], "impressions": q["impressions"], "click_rate": _ratio(q["clicks"], q["impressions"]),
                "position": round(q["w"] / q["impressions"], 1) if q["impressions"] else None,
                "clicks_before": q["before"] if gscw["compare"] else None, "change": q["clicks"] - q["before"] if gscw["compare"] else None,
            }
            for query, q in searches.items() if q["impressions"]
        ),
        key=lambda q: (-q["clicks"], -q["impressions"], q["query"]),
    )

    # AI visits: the same AI list as the Content row, which is the list of every site the screen shows.
    domains = _ai_domains(scope.engine, scope.site_ids)
    assistants: dict[str, dict] = {}
    for r in one.fetch(
        "SELECT MAX(domain) domain, MAX(path) path, SUM(IF(day BETWEEN :a AND :b, sessions, 0)) s, SUM(IF(day BETWEEN :a AND :b, {leads}, 0)) k, "
        f"SUM(day BETWEEN :a AND :b) n, SUM(IF(day BETWEEN :ca AND :cb, sessions, 0)) ps, SUM(day BETWEEN :ca AND :cb) pn FROM ga4_referral_daily WHERE site_id IN :sites AND {_BOTH} GROUP BY row_hash",
        ga4w["a"], ga4w["b"], **both(ga4w),
    ):
        if not _is_ai(r["domain"], domains) or _path(r["path"]) != wanted:
            continue
        item = assistants.setdefault(r["domain"], {"sessions": 0, "leads": 0.0, "before": 0, "now": False, "then": False})
        if r["n"]:
            item.update(now=True, sessions=item["sessions"] + int(r["s"] or 0), leads=item["leads"] + float(r["k"] or 0))
        if r["pn"]:
            item.update(then=True, before=item["before"] + int(r["ps"] or 0))
    ai_list = sorted(
        (
            {"source": source, "sessions": a["sessions"], "leads": round(a["leads"], 2), "before": a["before"] if a["then"] else None, "change": _pct_change(a["sessions"], a["before"]) if a["then"] else None}
            for source, a in assistants.items() if a["now"]
        ),
        key=lambda a: (-a["sessions"], a["source"]),
    )
    ai_now = sum(a["sessions"] for a in assistants.values()) if any(a["now"] for a in assistants.values()) else None
    ai_then = sum(a["before"] for a in assistants.values()) if any(a["then"] for a in assistants.values()) else None

    def totals(test_ga4, test_gsc, ai_visits) -> dict:
        ga = [r for day, r in ga4_days.items() if test_ga4(day)]
        gs = [r for day, r in gsc_days.items() if test_gsc(day)]
        sessions = sum(int(r["s"] or 0) for r in ga) if ga else None
        leads = round(sum(float(r["k"] or 0) for r in ga), 2) if ga else None
        clicks = sum(int(r["c"] or 0) for r in gs) if gs else None
        shown = sum(int(r["i"] or 0) for r in gs) if gs else None
        weighted = sum(float(r["w"] or 0) for r in gs)
        return {
            "sessions": sessions, "leads": leads, "rate": _conv_rate({"sessions": sessions, "leads": leads}) if ga else None,
            "clicks": clicks, "impressions": shown, "click_rate": _ratio(clicks, shown) if gs else None,
            "position": round(weighted / shown, 1) if shown else None, "ai": ai_visits,
        }

    def day_rows(test_ga4, test_gsc) -> list[dict]:
        has_ga4, has_gsc = any(test_ga4(day) for day in ga4_days), any(test_gsc(day) for day in gsc_days)
        out = []
        for day in sorted({d for d in ga4_seen if test_ga4(d)} | {d for d in gsc_seen if test_gsc(d)}):
            g, s = ga4_days.get(day), gsc_days.get(day)
            ga = has_ga4 and day in ga4_seen and test_ga4(day)
            gs = has_gsc and day in gsc_seen and test_gsc(day)
            shown = int(s["i"] or 0) if s else 0
            out.append({
                "day": day.isoformat(),
                "sessions": (int(g["s"] or 0) if g else 0) if ga else None,
                "leads": (round(float(g["k"] or 0), 2) if g else 0) if ga else None,
                "clicks": (int(s["c"] or 0) if s else 0) if gs else None,
                "impressions": shown if gs else None,
                "position": round(float(s["w"] or 0) / shown, 1) if gs and shown else None,
            })
        return out

    name = hosts[site_id]
    return {
        "kind": "page", "host": name, "path": wanted, "lead_kind": one.lead_kind, "url": f"https://{name}{wanted}", "category": _categorise(scope.engine, scope.site_ids)(wanted),
        "found": bool(hashes or shown_as or assistants),
        "addresses": sorted({page for _, page in shown_as})[:20],  # as Search Console writes it, for Overview's exact filter
        "ga4": _sources_state(one, "ga4"), "gsc": _sources_state(one, "gsc"),
        "period": _window_words(ga4w), "periods": {"ga4": _window_words(ga4w), "gsc": _window_words(gscw)},
        "totals": totals(now_of(ga4w), now_of(gscw), ai_now),
        "before": totals(before_of(ga4w), before_of(gscw), ai_then) if scope.has_compare else None,
        "days": day_rows(now_of(ga4w), now_of(gscw)),
        "days_before": day_rows(before_of(ga4w), before_of(gscw)) if scope.has_compare else None,
        "queries": queries[:PANEL_ROWS], "queries_total": len(queries),
        "ai_sources": ai_list[:PANEL_ROWS], "ai_sources_total": len(ai_list),
        "logos": known_logos(scope.engine, [a["source"] for a in ai_list]),
        "hid_rows": _hidden(one),
    }


def assistant_detail(scope: Scope, source) -> dict:
    """One row of AI search's assistants: its weeks, its days and the pages it lands on, by the screen's own rules
    (seo/metrics/ai_search.py: the AI list, any channel, AI channel names), so its visits and leads are the row's."""
    from seo.metrics import ai_search as ai

    wanted = _named(source, "assistant").lower()
    status = _sources_state(scope, "ga4")
    period = _trim_to_data(scope)
    domains = _ai_domains(scope.engine, scope.site_ids)
    namer = _channel_namer(scope.engine, scope.site_ids)
    weeks = ai._weeks(scope.end, scope.start)
    days, reported = _days(), set()
    week_visits: dict[int, int] = defaultdict(int)
    week_leads: dict[int, float] = defaultdict(float)
    every_ai, found = 0, False
    for row in ai._ga4_site_rows(scope, min(scope.start, weeks[0][0]), scope.end):
        day = row["day"]
        reported.add(day)
        slot = days[day.isoformat()] if day >= scope.start else None  # GA4 reported this day: it counts, at 0 if need be
        who = ai.ai_source(row, domains, namer)
        if not who:
            continue
        sessions, leads = int(row["sessions"] or 0), float(row["leads"] or 0)
        if slot is not None:
            every_ai += sessions
        if who != wanted:
            continue
        for n, (a, b) in enumerate(weeks):
            if a <= day <= b:
                week_visits[n] += sessions
                week_leads[n] += leads
        if slot is not None:
            found = True
            slot["sessions"] += sessions
            slot["leads"] += leads
    before, days_before = None, None
    if scope.has_compare:
        days_before = _days()
        for row in ai._ga4_site_rows(scope, scope.compare_start, scope.compare_end):
            slot = days_before[row["day"].isoformat()]
            if ai.ai_source(row, domains, namer) == wanted:
                slot["sessions"] += int(row["sessions"] or 0)
                slot["leads"] += float(row["leads"] or 0)
        if days_before:
            was_sessions, was_leads = _summed(days_before)
            before = {"sessions": was_sessions, "leads": was_leads, "rate": ai._rate(was_leads, was_sessions)["value"]}
    pages = None  # "(not set)": GA4 didn't say which assistant, so not where it landed either
    if wanted != "(not set)":
        target, hosts = ai._domain(wanted), _hosts(scope)
        landing = ai._landing_rows(scope, scope.start, scope.end, lambda d: ai._domain(d) == target)
        pages = sorted(
            ({"host": hosts.get(site_id, ""), "path": path, "sessions": item["sessions"], "leads": round(item["leads"], 2)} for (site_id, path), item in landing.items() if item["sessions"]),
            key=lambda p: (-p["sessions"], p["host"], p["path"]),
        )
    sessions, leads = _summed(days)
    return {
        **status, "kind": "assistant", "source": wanted, "lead_kind": scope.lead_kind, "found": found, "period": period,
        "totals": {"sessions": sessions, "leads": leads, "rate": ai._rate(leads, sessions)["value"], "rate_needs": ai.LEAD_RATE_MIN_VISITS, "share": _ratio(sessions, every_ai)} if days else None,
        "before": before, "change": _pct_change(sessions, before["sessions"]) if before else None,
        "days": _day_rows(days), "days_before": _day_rows(days_before) if days_before is not None else None,
        "weekly": [
            {"start": a.isoformat(), "end": b.isoformat(), "sessions": week_visits[n] if any(a <= d <= b for d in reported) else None, "leads": round(week_leads[n], 2)}
            for n, (a, b) in enumerate(weeks)
        ],
        "pages": pages[:PANEL_ROWS] if pages is not None else None, "pages_total": len(pages) if pages is not None else None,
        "logos": known_logos(scope.engine, [wanted]),
        "hid_rows": _hidden(scope),
    }


# ---- Folded into one answer, so a simpler screen opens with one request (change 7) ----------------------------------


def known_logos(engine: Engine, names) -> list[str]:
    """Which of these names, or the sites they belong to, have an icon, written as a screen looks them up: UI.siteLogo tries
    blog.site.example, then site.example. A screen adds them to LOGOS_KNOWN instead of asking /api/logos again."""
    from seo.serp.store import to_ascii_host

    spellings: dict[str, set[str]] = defaultdict(set)
    for name in names:
        if not isinstance(name, str) or "." not in name:
            continue
        parts = name.strip().lower().split(".")
        for i in range(len(parts) - 1):  # never a bare "com"
            written = ".".join(parts[i:])
            spellings[to_ascii_host(written)[:190]].add(written)
    if not spellings:
        return []
    statement = text("SELECT domain FROM site_logos WHERE status = 'found' AND domain IN :d").bindparams(bindparam("d", expanding=True))
    with engine.connect() as conn:
        found = {row[0].lower() for row in conn.execute(statement, {"d": sorted(spellings)})}
    return sorted({spelling for domain in found for spelling in spellings.get(domain, set()) | {domain}})


def setup_facts(engine: Engine, site_id: int | None = None) -> list[dict]:
    """What Today's setup line needs for each of my sites, in one answer instead of three calls per site: whether it has
    keywords, competitors and a health test yet, and the steps it said it doesn't use (the same list as links/sites).
    Whether Google and Clarity are connected comes from the connections, which the app has already."""
    from seo.links import service as links

    sites = [s for s in links.own_sites(engine) if site_id is None or s["id"] == site_id]
    if not sites:
        return []
    ids = [s["id"] for s in sites]

    def counts(conn, sql: str) -> dict[int, int]:
        return {row[0]: int(row[1]) for row in conn.execute(text(sql).bindparams(bindparam("ids", expanding=True)), {"ids": ids}).all()}

    with engine.connect() as conn:
        keywords = counts(conn, "SELECT site_id, COUNT(*) FROM site_keywords WHERE site_id IN :ids GROUP BY site_id")
        competitors = counts(conn, "SELECT sc.site_id, COUNT(*) FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id IN :ids GROUP BY sc.site_id")
        checks = counts(conn, "SELECT site_id, COUNT(*) FROM health_audits WHERE site_id IN :ids GROUP BY site_id")
    return [
        {"site_id": s["id"], "host": s["host"], "keywords": keywords.get(s["id"], 0) > 0, "competitors": competitors.get(s["id"], 0) > 0, "checks": checks.get(s["id"], 0) > 0, "not_used": s["setup_not_used"]}
        for s in sites
    ]
