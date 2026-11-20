"""GA4. Written from Google's documentation and tested on a fake: it has not yet run on a real connection.

Counts only, so no personal data enters this app. Each day holds five reports, and four more that split their key events
by event name (only key events: isKeyEvent is true), so the owner can pick which key events are leads (seo/metrics/leads.py).
A UTM row is never also counted by domain: the referral report leaves out any session that carries a campaign. GA4 writes
"(referral)", "(organic)" or "(direct)" as the campaign of a visit without one, so those count as no campaign.

Each report also asks for the host the visit was on. A property can record another website's visits (a second data stream,
or the same tag on two sites): those rows are kept out of every table and only counted, per host, in ga4_host_daily, for
the warning in Settings and on Today (SEO review 2026-11-17, W2).

Days read before this layout (coverage source "ga4" only) are read again, newest first, under coverage source LAYOUT:
the same resumable loop as the first read, so a stopped run carries on where it was. That re-read takes at most
BACKLOG_DAYS_PER_RUN days a run and then waits BACKLOG_PAUSE_SECONDS: GA4's hourly quota is shared with the owner's own
Looker Studio and Explorations, so it is never read back to back until Google refuses (code review 2026-11-18, #11).

Leads: GA4 counts each event's sessions apart, so a visit with two ticked events (form_submit and generate_lead on one
enquiry) is in both. With two or more ticked events one more report per table asks GA4 for the sessions with any of
them (eventName in the ticked list, no eventName dimension), so each visit counts once. Those rows are stored under
report "L-<table>" with the hash of the ticked set; a tick change reads them again (coverage LEADS_LAYOUT, note = the
set's hash) and, until then, a day counts its biggest ticked event, a lower bound (code review 2026-11-18, #1).
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import Engine, text

from seo.collectors import common, http
from seo.sources import credentials

HISTORY_DAYS = 425  # about 14 months: GA4's default retention
PAGE = 100000
REREAD_DAYS = 4
NOT_SET = {"", "(not set)", "(none)"}
# GA4's campaign for a visit that carried no UTM campaign (expert review 2026-11-17, W3: "(referral)" dropped every referral).
NO_CAMPAIGN = NOT_SET | {"(referral)", "(organic)", "(direct)"}
LAYOUT = "ga4_v2"  # coverage source for a day read with hosts and key events by name
LEADS_LAYOUT = "ga4_leads"  # coverage source for a day whose "any ticked event" sessions were read; note = the set's hash
UNION = "L-"  # report prefix in ga4_key_event_daily for those sessions
KEY_EVENTS_ONLY = {"filter": {"fieldName": "isKeyEvent", "stringFilter": {"value": "true"}}}
BACKLOG_DAYS_PER_RUN = 30  # old days read again in one run (13 reports a day: about 390 calls), as Search Console's backfill
BACKLOG_PAUSE_SECONDS = 3600  # then the job waits this long before the next batch
LATER = "later"  # collect(): this run's share of the backlog is done; the job carries on after BACKLOG_PAUSE_SECONDS


def set_hash(names) -> str:
    """One hash for a set of ticked event names, whatever their order."""
    return common.digest("ticked", *sorted(names))


def _union_filter(names: list[str]) -> dict:
    return {"dimensionFilter": {"andGroup": {"expressions": [
        KEY_EVENTS_ONLY, {"filter": {"fieldName": "eventName", "inListFilter": {"values": sorted(names), "caseSensitive": True}}},
    ]}}}


def own_host(host: str | None, site_host: str | None) -> bool:
    """The site's host, www. or any subdomain of it. GA4's "(not set)" can't be told apart, so it stays the site's."""
    value = (host or "").strip().lower().rstrip(".")
    if value in NOT_SET or not site_host:
        return True
    base = site_host.strip().lower().removeprefix("www.")
    value = value.removeprefix("www.")
    return value == base or value.endswith("." + base)


class _Report:
    def __init__(self, rows: list[list[str]], hid_rows: bool, currency: str | None):
        self.rows, self.hid_rows, self.currency = rows, hid_rows, currency


def _report(token: str, prop: str, day: date, dimensions: list[str], metrics: list[str], extra: dict | None = None) -> _Report:
    rows: list[list[str]] = []
    hid = False
    currency = None
    offset = 0
    while True:
        reply = http.request(
            "POST", f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", "Google Analytics",
            headers={"Authorization": f"Bearer {token}"},
            json={"dateRanges": [{"startDate": day.isoformat(), "endDate": day.isoformat()}], "dimensions": [{"name": d} for d in dimensions], "metrics": [{"name": m} for m in metrics], "limit": PAGE, "offset": offset, **(extra or {})},
        ).json()
        meta = reply.get("metadata") or {}
        hid = hid or bool(meta.get("subjectToThresholding")) or bool(meta.get("dataLossFromOtherRow"))
        currency = meta.get("currencyCode") or currency
        batch = reply.get("rows") or []
        rows.extend([v["value"] for v in row.get("dimensionValues", [])] + [v["value"] for v in row.get("metricValues", [])] for row in batch)
        offset += len(batch)
        if not batch or offset >= int(reply.get("rowCount") or 0):
            return _Report(rows, hid, currency)


def _int(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _money(value) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _replace(conn, table: str, site_id: int, day: date, statement: str, rows: list[dict]) -> None:
    conn.execute(text(f"DELETE FROM {table} WHERE site_id = :s AND day = :d"), {"s": site_id, "d": day})
    if rows:
        conn.execute(text(statement), rows)


def _merge(rows: list[dict], key: str, *adding: str) -> list[dict]:
    """GA4 can return two rows that hash the same once blanks are cleaned. They're one row, so add them."""
    merged: dict[str, dict] = {}
    for row in rows:
        if row[key] in merged:
            for name in adding:
                merged[row[key]][name] += row[name]
        else:
            merged[row[key]] = row
    return list(merged.values())


def _named(report: _Report, dimensions: list[str], metrics: list[str]) -> list[dict]:
    names = dimensions + metrics
    return [dict(zip(names, row)) for row in report.rows]


def _is_referral(row: dict) -> bool:
    return row["sessionMedium"] == "referral" and row["sessionManualCampaignName"] in NO_CAMPAIGN


# Each table's report: its dimensions, the key its rows are told apart by, and which rows it keeps.
_REPORTS = {
    "source": (["sessionDefaultChannelGroup", "sessionSource", "sessionMedium"], lambda r: common.digest(r["sessionDefaultChannelGroup"], r["sessionSource"], r["sessionMedium"]), lambda r: True),
    "page": (["landingPage"], lambda r: common.digest(r["landingPage"]), lambda r: True),
    "referral": (["sessionSource", "sessionMedium", "landingPage", "sessionManualCampaignName"], lambda r: common.digest(r["sessionSource"].lower(), r["landingPage"]), _is_referral),
    # Rows with a UTM campaign are counted by UTM only, so they can't be counted twice. A row tagged with a UTM source but
    # no campaign is kept too, or its visits would be in neither table. GA4 also fills the manual source of plain visits
    # ("(organic)", "(referral)" campaigns): the table is landing page by source, medium and campaign.
    "campaign": (["sessionManualSource", "sessionManualMedium", "sessionManualCampaignName", "landingPage"], lambda r: common.digest(r["sessionManualSource"], r["sessionManualMedium"], r["sessionManualCampaignName"], r["landingPage"]), lambda r: r["sessionManualCampaignName"] not in NOT_SET or r["sessionManualSource"] not in NOT_SET),
}


def _key_events(token: str, prop: str, day: date, site_host: str, report: str) -> tuple[list[dict], bool]:
    """One table's key events by name, on the site's own host: {row_hash, event, key_events, sessions}."""
    dims, key, keep = _REPORTS[report]
    got = _report(token, prop, day, dims + ["hostName", "eventName", "isKeyEvent"], ["keyEvents", "sessions"], {"dimensionFilter": KEY_EVENTS_ONLY})
    merged: dict[tuple[str, str], dict] = {}
    for r in _named(got, dims + ["hostName", "eventName", "isKeyEvent"], ["keyEvents", "sessions"]):
        if r["isKeyEvent"] != "true" or not own_host(r["hostName"], site_host) or not keep(r) or not r["eventName"]:
            continue
        slot = merged.setdefault((key(r), r["eventName"]), {"row_hash": key(r), "event": r["eventName"][:120], "key_events": 0.0, "sessions": 0})
        slot["key_events"] += _float(r["keyEvents"])
        slot["sessions"] += _int(r["sessions"])
    return list(merged.values()), got.hid_rows


def _any_ticked(token: str, prop: str, day: date, site_host: str, report: str, names: list[str]) -> tuple[dict[str, int], bool]:
    """One table's sessions with at least one of these events, on the site's own host: {row_hash: sessions}. GA4 counts
    each session once here, however many of the events it had."""
    dims, key, keep = _REPORTS[report]
    got = _report(token, prop, day, dims + ["hostName"], ["sessions"], _union_filter(names))
    found: dict[str, int] = {}
    for r in _named(got, dims + ["hostName"], ["sessions"]):
        if own_host(r["hostName"], site_host) and keep(r):
            found[key(r)] = found.get(key(r), 0) + _int(r["sessions"])
    return found, got.hid_rows


def _save_union(conn, site_id: int, day: date, names: list[str], union: dict[str, dict[str, int]]) -> None:
    conn.execute(text("DELETE FROM ga4_key_event_daily WHERE site_id = :s AND day = :d AND report LIKE 'L-%'"), {"s": site_id, "d": day})
    marker = set_hash(names)
    rows = [{"s": site_id, "d": day, "r": UNION + name, "h": h, "e": marker, "x": x} for name, found in union.items() for h, x in found.items()]
    if rows:
        conn.execute(text("INSERT INTO ga4_key_event_daily (site_id, day, report, row_hash, event_hash, event_name, key_events, sessions) VALUES (:s, :d, :r, :h, :e, '(any ticked event)', 0, :x)"), rows)
    common.save_coverage(conn, site_id, LEADS_LAYOUT, day, len(rows), note=marker)


def _union_day(engine: Engine, site_id: int, token: str, prop: str, day: date, site_host: str, names: list[str]) -> None:
    """A day already read in this layout: only its "any ticked event" sessions, after a tick change, then its leads."""
    from seo.metrics import leads as lead_rules  # noqa: PLC0415 - the metrics package reads these tables

    union = {name: _any_ticked(token, prop, day, site_host, name, names)[0] for name in _REPORTS}
    with engine.begin() as conn:
        _save_union(conn, site_id, day, names, union)
    lead_rules.recompute(engine, site_id, day)


def _site_host(engine: Engine, site_id: int) -> str:
    with engine.connect() as conn:
        return conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": site_id}).scalar() or ""


def _one_day(engine: Engine, site_id: int, token: str, prop: str, day: date, site_host: str | None = None) -> None:
    from seo.metrics import leads as lead_rules  # noqa: PLC0415 - the metrics package reads these tables

    site_host = site_host if site_host is not None else _site_host(engine, site_id)
    metrics = {"source": ["sessions", "totalUsers", "keyEvents"], "page": ["sessions", "totalUsers", "keyEvents"], "referral": ["sessions", "keyEvents"], "campaign": ["sessions", "keyEvents"]}
    got = {name: _report(token, prop, day, dims + ["hostName"], metrics[name]) for name, (dims, _, _) in _REPORTS.items()}
    named = {name: _named(got[name], _REPORTS[name][0] + ["hostName"], metrics[name]) for name in _REPORTS}
    try:
        ads = _report(token, prop, day, ["sessionGoogleAdsCampaignName"], ["advertiserAdClicks", "advertiserAdCost", "sessions", "keyEvents"])
    except http.SourceError as exc:
        if exc.kind != "auth":  # a property with no Google Ads link can refuse this one report, and that's fine
            raise
        ads = _Report([], False, None)
    events, events_hid = {}, False
    for name in _REPORTS:
        events[name], hid = _key_events(token, prop, day, site_host, name)
        events_hid = events_hid or hid
    # Every host the property recorded, from the source report, and which are this site's.
    hosts: dict[str, dict] = {}
    for r in named["source"]:
        host = (r["hostName"] or "(not set)").strip().lower()[:190]
        slot = hosts.setdefault(host, {"host": host, "own": own_host(host, site_host), "sessions": 0})
        slot["sessions"] += _int(r["sessions"])
    own = {name: [r for r in rows if own_host(r["hostName"], site_host)] for name, rows in named.items()}
    names = lead_rules.ticked(engine, site_id)
    ticked = {common.digest(name) for name in names}
    lead_sessions: dict[str, dict[str, int]] = {name: {} for name in _REPORTS}
    union: dict[str, dict[str, int]] | None = None
    if len(ticked) > 1:  # each visit once, however many ticked events it had (#1)
        union = {}
        for name in _REPORTS:
            union[name], hid = _any_ticked(token, prop, day, site_host, name, names)
            events_hid = events_hid or hid
        lead_sessions = union
    else:
        for name, rows in events.items():
            for e in rows:
                if common.digest(e["event"]) in ticked:
                    lead_sessions[name][e["row_hash"]] = e["sessions"]

    site = {"s": site_id, "d": day}
    source_rows = _merge([{**site, "h": common.digest(r["sessionDefaultChannelGroup"], r["sessionSource"], r["sessionMedium"]), "a": r["sessionDefaultChannelGroup"][:80], "b": r["sessionSource"][:190], "m": r["sessionMedium"][:190], "x": _int(r["sessions"]), "u": _int(r["totalUsers"]), "k": _float(r["keyEvents"])} for r in own["source"]], "h", "x", "u", "k")
    page_rows = _merge([{**site, "h": common.digest(r["landingPage"]), "p": r["landingPage"], "x": _int(r["sessions"]), "u": _int(r["totalUsers"]), "k": _float(r["keyEvents"])} for r in own["page"]], "h", "x", "u", "k")
    referral_rows = _merge([{**site, "h": common.digest(r["sessionSource"].lower(), r["landingPage"]), "o": r["sessionSource"].lower()[:190], "p": r["landingPage"], "x": _int(r["sessions"]), "k": _float(r["keyEvents"])} for r in own["referral"] if _is_referral(r)], "h", "x", "k")
    campaign_rows = _merge([{**site, "h": common.digest(r["sessionManualSource"], r["sessionManualMedium"], r["sessionManualCampaignName"], r["landingPage"]), "a": r["sessionManualSource"][:190], "m": r["sessionManualMedium"][:190], "c": r["sessionManualCampaignName"][:190], "p": r["landingPage"], "x": _int(r["sessions"]), "k": _float(r["keyEvents"])} for r in own["campaign"] if _REPORTS["campaign"][2](r)], "h", "x", "k")
    for name, rows in (("source", source_rows), ("page", page_rows), ("referral", referral_rows), ("campaign", campaign_rows)):
        for row in rows:  # a visit with a lead: never more than the row's visits
            row["l"] = min(row["x"], lead_sessions[name].get(row["h"], 0))
    ad_rows = _merge([{**site, "h": common.digest(r[0]), "c": r[0][:190], "n": _int(r[1]), "z": _money(r[2]), "y": ads.currency, "x": _int(r[3]), "k": _float(r[4])} for r in ads.rows if r[0] not in NOT_SET], "h", "n", "z", "x", "k")
    event_rows = [{**site, "r": name, "h": e["row_hash"], "e": common.digest(e["event"]), "n": e["event"], "k": e["key_events"], "x": e["sessions"]} for name, rows in events.items() for e in rows]
    host_rows = [{**site, "h": common.digest(h["host"]), "n": h["host"], "o": h["own"], "x": h["sessions"]} for h in hosts.values()]
    hid = any(report.hid_rows for report in got.values()) or events_hid
    with engine.begin() as conn:
        _replace(conn, "ga4_source_daily", site_id, day, "INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events, leads) VALUES (:s, :d, :h, :a, :b, :m, :x, :u, :k, :l)", source_rows)
        _replace(conn, "ga4_page_daily", site_id, day, "INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events, leads) VALUES (:s, :d, :h, :p, :x, :u, :k, :l)", page_rows)
        _replace(conn, "ga4_referral_daily", site_id, day, "INSERT INTO ga4_referral_daily (site_id, day, row_hash, domain, path, sessions, key_events, leads) VALUES (:s, :d, :h, :o, :p, :x, :k, :l)", referral_rows)
        _replace(conn, "ga4_campaign_daily", site_id, day, "INSERT INTO ga4_campaign_daily (site_id, day, row_hash, source, medium, campaign, path, sessions, key_events, leads) VALUES (:s, :d, :h, :a, :m, :c, :p, :x, :k, :l)", campaign_rows)
        _replace(conn, "ga4_ads_daily", site_id, day, "INSERT INTO ga4_ads_daily (site_id, day, row_hash, campaign, clicks, cost, currency, sessions, key_events) VALUES (:s, :d, :h, :c, :n, :z, :y, :x, :k)", ad_rows)
        _replace(conn, "ga4_key_event_daily", site_id, day, "INSERT INTO ga4_key_event_daily (site_id, day, report, row_hash, event_hash, event_name, key_events, sessions) VALUES (:s, :d, :r, :h, :e, :n, :k, :x)", event_rows)
        _replace(conn, "ga4_host_daily", site_id, day, "INSERT INTO ga4_host_daily (site_id, day, host_hash, host, own, sessions) VALUES (:s, :d, :h, :n, :o, :x)", host_rows)
        if union is not None:
            _save_union(conn, site_id, day, names, union)
        common.save_coverage(conn, site_id, "ga4", day, len(source_rows), "ok", hid_rows=hid)
        common.save_coverage(conn, site_id, LAYOUT, day, len(source_rows), "ok", hid_rows=hid)


def _skip_empty_days(engine: Engine, site_id: int, before: date) -> None:
    """Days the old layout read and found empty (before the property existed) stay empty: no need to read them again."""
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT IGNORE INTO coverage (site_id, source, day, status, hid_rows, `rows`, note, saved_at) "
            "SELECT site_id, :l, day, status, hid_rows, `rows`, note, saved_at FROM coverage WHERE site_id = :s AND source = 'ga4' AND `rows` = 0 AND day < :b"
        ), {"s": site_id, "l": LAYOUT, "b": before})


def _window(engine: Engine) -> tuple[date, date]:
    newest = common.today(engine) - timedelta(days=1)
    return newest, newest - timedelta(days=HISTORY_DAYS)


def _union_pending(engine: Engine, site_id: int, names: list[str], newest: date, oldest: date) -> list[date]:
    """Days read in this layout whose "any ticked event" sessions are missing or for another set of ticks, newest first."""
    if len(names) < 2:
        return []
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT c.day FROM coverage c LEFT JOIN coverage u ON u.site_id = c.site_id AND u.source = :u AND u.day = c.day "
            "WHERE c.site_id = :s AND c.source = :l AND c.`rows` > 0 AND c.day BETWEEN :a AND :b AND (u.day IS NULL OR u.note IS NULL OR u.note <> :m) ORDER BY c.day DESC"
        ), {"s": site_id, "u": LEADS_LAYOUT, "l": LAYOUT, "a": oldest, "b": newest, "m": set_hash(names)}).all()
    return [row[0] for row in rows]


def days_to_reread(engine: Engine, site_id: int) -> int:
    """Days of the history window still to be read again: in this layout (hosts and key events by name), and, with two or
    more ticked events, for each visit's leads once. Settings and the screens say the history is being read again. Only
    days collect() reads count, so it reaches 0 (code review 2026-11-18, #5)."""
    from seo.metrics import leads as lead_rules  # noqa: PLC0415

    newest, oldest = _window(engine)
    with engine.connect() as conn:
        layout = int(conn.execute(text(
            "SELECT COUNT(*) FROM coverage c WHERE c.site_id = :s AND c.source = 'ga4' AND c.`rows` > 0 AND c.day BETWEEN :a AND :b "
            "AND NOT EXISTS (SELECT 1 FROM coverage n WHERE n.site_id = c.site_id AND n.source = :l AND n.day = c.day)"
        ), {"s": site_id, "l": LAYOUT, "a": oldest, "b": newest}).scalar() or 0)
    return layout + len(_union_pending(engine, site_id, lead_rules.ticked(engine, site_id), newest, oldest))


def _backlog(engine: Engine, site_id: int, newest: date, oldest: date) -> set[date]:
    """Days the old layout read with data: read again in this one, a batch a run."""
    with engine.connect() as conn:
        return {row[0] for row in conn.execute(text(
            "SELECT day FROM coverage WHERE site_id = :s AND source = 'ga4' AND `rows` > 0 AND day BETWEEN :a AND :b"
        ), {"s": site_id, "a": oldest, "b": newest})}


def collect(engine: Engine, site_id: int, budget_seconds: float = 40):
    """True when nothing is left to read. False: new days are left, and the job goes back in the queue at once. LATER: only
    history read again is left; this run did its share and the job carries on after BACKLOG_PAUSE_SECONDS. A quota refusal
    during that re-read is a planned stop, not a failure: the source isn't shown as failing for it (#11)."""
    from seo.metrics import leads as lead_rules  # noqa: PLC0415

    src = common.source_row(engine, site_id, "ga4")
    token = credentials.access_token(engine, src["connection_id"])
    newest, oldest = _window(engine)
    deadline = time.monotonic() + budget_seconds
    _skip_empty_days(engine, site_id, newest - timedelta(days=REREAD_DAYS))
    backlog = _backlog(engine, site_id, newest, oldest)
    recent_from = newest - timedelta(days=REREAD_DAYS - 1)
    pending = common.pending_days(engine, site_id, LAYOUT, newest, oldest, REREAD_DAYS)
    fresh = [day for day in pending if day >= recent_from or day not in backlog]
    old = [day for day in pending if day < recent_from and day in backlog]
    for day in fresh:
        if time.monotonic() >= deadline:
            return False
        _one_day(engine, site_id, token, src["property"], day, src["host"])
        common.succeeded(engine, site_id, "ga4", day)
    names = lead_rules.ticked(engine, site_id)
    share = BACKLOG_DAYS_PER_RUN
    try:
        for day in old:
            if share <= 0 or time.monotonic() >= deadline:
                return LATER
            _one_day(engine, site_id, token, src["property"], day, src["host"])
            share -= 1
        for day in _union_pending(engine, site_id, names, newest, oldest):
            if share <= 0 or time.monotonic() >= deadline:
                return LATER
            _union_day(engine, site_id, token, src["property"], day, src["host"], names)
            share -= 1
    except http.SourceError as exc:
        if exc.kind == "quota":
            return LATER  # Google's hourly share is used: what was saved stays, the next batch carries on
        raise
    return True
