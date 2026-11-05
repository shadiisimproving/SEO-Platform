"""GA4. Written from Google's documentation and tested on a fake: it has not yet run on a real connection.

Counts only, so no personal data enters this app. Each day holds five reports. A UTM row is never also counted by domain:
the referral report leaves out any session that carries a campaign.
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


class _Report:
    def __init__(self, rows: list[list[str]], hid_rows: bool, currency: str | None):
        self.rows, self.hid_rows, self.currency = rows, hid_rows, currency


def _report(token: str, prop: str, day: date, dimensions: list[str], metrics: list[str]) -> _Report:
    rows: list[list[str]] = []
    hid = False
    currency = None
    offset = 0
    while True:
        reply = http.request(
            "POST", f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", "Google Analytics",
            headers={"Authorization": f"Bearer {token}"},
            json={"dateRanges": [{"startDate": day.isoformat(), "endDate": day.isoformat()}], "dimensions": [{"name": d} for d in dimensions], "metrics": [{"name": m} for m in metrics], "limit": PAGE, "offset": offset},
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


def _one_day(engine: Engine, site_id: int, token: str, prop: str, day: date) -> None:
    sources = _report(token, prop, day, ["sessionDefaultChannelGroup", "sessionSource", "sessionMedium"], ["sessions", "totalUsers", "keyEvents"])
    pages = _report(token, prop, day, ["landingPage"], ["sessions", "totalUsers", "keyEvents"])
    referrals = _report(token, prop, day, ["sessionSource", "sessionMedium", "landingPage", "sessionManualCampaignName"], ["sessions", "keyEvents"])
    campaigns = _report(token, prop, day, ["sessionManualSource", "sessionManualMedium", "sessionManualCampaignName", "landingPage"], ["sessions", "keyEvents"])
    try:
        ads = _report(token, prop, day, ["sessionGoogleAdsCampaignName"], ["advertiserAdClicks", "advertiserAdCost", "sessions", "keyEvents"])
    except http.SourceError as exc:
        if exc.kind != "auth":  # a property with no Google Ads link can refuse this one report, and that's fine
            raise
        ads = _Report([], False, None)
    site = {"s": site_id, "d": day}
    source_rows = _merge([{**site, "h": common.digest(r[0], r[1], r[2]), "a": r[0][:80], "b": r[1][:190], "m": r[2][:190], "x": _int(r[3]), "u": _int(r[4]), "k": _float(r[5])} for r in sources.rows], "h", "x", "u", "k")
    page_rows = _merge([{**site, "h": common.digest(r[0]), "p": r[0], "x": _int(r[1]), "u": _int(r[2]), "k": _float(r[3])} for r in pages.rows], "h", "x", "u", "k")
    # Rows with a UTM campaign are counted by UTM only, so they can't be counted twice.
    referral_rows = _merge([{**site, "h": common.digest(r[0].lower(), r[2]), "o": r[0].lower()[:190], "p": r[2], "x": _int(r[4]), "k": _float(r[5])} for r in referrals.rows if r[1] == "referral" and r[3] in NOT_SET], "h", "x", "k")
    campaign_rows = _merge([{**site, "h": common.digest(r[0], r[1], r[2], r[3]), "a": r[0][:190], "m": r[1][:190], "c": r[2][:190], "p": r[3], "x": _int(r[4]), "k": _float(r[5])} for r in campaigns.rows if r[2] not in NOT_SET], "h", "x", "k")
    ad_rows = _merge([{**site, "h": common.digest(r[0]), "c": r[0][:190], "n": _int(r[1]), "z": _money(r[2]), "y": ads.currency, "x": _int(r[3]), "k": _float(r[4])} for r in ads.rows if r[0] not in NOT_SET], "h", "n", "z", "x", "k")
    hid = sources.hid_rows or pages.hid_rows or referrals.hid_rows or campaigns.hid_rows
    with engine.begin() as conn:
        _replace(conn, "ga4_source_daily", site_id, day, "INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, :a, :b, :m, :x, :u, :k)", source_rows)
        _replace(conn, "ga4_page_daily", site_id, day, "INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, :h, :p, :x, :u, :k)", page_rows)
        _replace(conn, "ga4_referral_daily", site_id, day, "INSERT INTO ga4_referral_daily (site_id, day, row_hash, domain, path, sessions, key_events) VALUES (:s, :d, :h, :o, :p, :x, :k)", referral_rows)
        _replace(conn, "ga4_campaign_daily", site_id, day, "INSERT INTO ga4_campaign_daily (site_id, day, row_hash, source, medium, campaign, path, sessions, key_events) VALUES (:s, :d, :h, :a, :m, :c, :p, :x, :k)", campaign_rows)
        _replace(conn, "ga4_ads_daily", site_id, day, "INSERT INTO ga4_ads_daily (site_id, day, row_hash, campaign, clicks, cost, currency, sessions, key_events) VALUES (:s, :d, :h, :c, :n, :z, :y, :x, :k)", ad_rows)
        common.save_coverage(conn, site_id, "ga4", day, len(source_rows), "ok", hid_rows=hid)


def collect(engine: Engine, site_id: int, budget_seconds: float = 40) -> bool:
    src = common.source_row(engine, site_id, "ga4")
    token = credentials.access_token(engine, src["connection_id"])
    newest = common.today(engine) - timedelta(days=1)
    oldest = newest - timedelta(days=HISTORY_DAYS)
    deadline = time.monotonic() + budget_seconds
    for day in common.pending_days(engine, site_id, "ga4", newest, oldest, REREAD_DAYS):
        if time.monotonic() >= deadline:
            return False
        _one_day(engine, site_id, token, src["property"], day)
        common.succeeded(engine, site_id, "ga4", day)
    return True
