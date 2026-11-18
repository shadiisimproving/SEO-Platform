"""GA4. Written from Google's documentation and tested on a fake: it has not yet run on a real connection.

Counts only, so no personal data enters this app. Each day holds five reports, and four more that split their key events
by event name (only key events: isKeyEvent is true), so the owner can pick which key events are leads (seo/metrics/leads.py).
A UTM row is never also counted by domain: the referral report leaves out any session that carries a campaign. GA4 writes
"(referral)", "(organic)" or "(direct)" as the campaign of a visit without one, so those count as no campaign.

Each report also asks for the host the visit was on. A property can record another website's visits (a second data stream,
or the same tag on two sites): those rows are kept out of every table and only counted, per host, in ga4_host_daily, for
the warning in Settings and on Today (SEO review 2026-11-17, W2).

Days read before this layout (coverage source "ga4" only) are read again, newest first, under coverage source LAYOUT:
the same resumable loop as the first read, so a stopped run carries on where it was.
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
KEY_EVENTS_ONLY = {"filter": {"fieldName": "isKeyEvent", "stringFilter": {"value": "true"}}}


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
    ticked = lead_rules.ticked_hashes(engine, site_id)
    lead_sessions = {name: {} for name in _REPORTS}
    for name, rows in events.items():
        for e in rows:
            if common.digest(e["event"]) in ticked:
                lead_sessions[name][e["row_hash"]] = lead_sessions[name].get(e["row_hash"], 0) + e["sessions"]

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
        common.save_coverage(conn, site_id, "ga4", day, len(source_rows), "ok", hid_rows=hid)
        common.save_coverage(conn, site_id, LAYOUT, day, len(source_rows), "ok", hid_rows=hid)


def _skip_empty_days(engine: Engine, site_id: int, before: date) -> None:
    """Days the old layout read and found empty (before the property existed) stay empty: no need to read them again."""
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT IGNORE INTO coverage (site_id, source, day, status, hid_rows, `rows`, note, saved_at) "
            "SELECT site_id, :l, day, status, hid_rows, `rows`, note, saved_at FROM coverage WHERE site_id = :s AND source = 'ga4' AND `rows` = 0 AND day < :b"
        ), {"s": site_id, "l": LAYOUT, "b": before})


def days_to_reread(engine: Engine, site_id: int) -> int:
    """Days the old layout read that the new one hasn't yet: Settings and the screens say the history is being read again."""
    with engine.connect() as conn:
        return int(conn.execute(text(
            "SELECT COUNT(*) FROM coverage c WHERE c.site_id = :s AND c.source = 'ga4' AND c.`rows` > 0 "
            "AND NOT EXISTS (SELECT 1 FROM coverage n WHERE n.site_id = c.site_id AND n.source = :l AND n.day = c.day)"
        ), {"s": site_id, "l": LAYOUT}).scalar() or 0)


def collect(engine: Engine, site_id: int, budget_seconds: float = 40) -> bool:
    src = common.source_row(engine, site_id, "ga4")
    token = credentials.access_token(engine, src["connection_id"])
    newest = common.today(engine) - timedelta(days=1)
    oldest = newest - timedelta(days=HISTORY_DAYS)
    deadline = time.monotonic() + budget_seconds
    _skip_empty_days(engine, site_id, newest - timedelta(days=REREAD_DAYS))
    for day in common.pending_days(engine, site_id, LAYOUT, newest, oldest, REREAD_DAYS):
        if time.monotonic() >= deadline:
            return False
        _one_day(engine, site_id, token, src["property"], day, src["host"])
        common.succeeded(engine, site_id, "ga4", day)
    return True
