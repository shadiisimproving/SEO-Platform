"""Bought links (plan-seo-command-center-mickaz-features-and-ai-brand.md, step 3): the links I paid for, grouped by the
keyword each one was bought for, with what I was billed, what it really cost, and the keyword's position before and after.

- A bought link is one I logged: live, lost or planned ("pending"). Links a tool found and nobody logged ("found") were
  never bought and stay out.
- Prices: `billed` is what I was billed, `cost` (from price_text) what it really cost, both as typed and as numbers.
- Position before → after: always Search Console (our own checks started too late to have a "before"), the keyword's
  impression-weighted position over the 28 days before the day placed against the 28 days from it, the same windows the
  Backlinks screen uses for a page (metrics/backlink_traffic.before_after). The days after must all be final, else
  "waiting" with the day it's ready; fewer than MIN_IMPRESSIONS impressions in a window is "few", never a number.
- A keyword's card compares the 28 days before its first link with the last 28 final days.
Correlation, not proof: the screen says so."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import Engine, text

from seo.backlinks import protect
from seo.competitors.keywords import require_own
from seo.metrics import countries
from seo.metrics.keyword_timeline import _hashes
from seo.serp import store

DAYS = 28
MIN_IMPRESSIONS = 10
BOUGHT = ("live", "lost", "planned")
_SYMBOLS = (("€", "EUR"), ("eur", "EUR"), ("aed", "AED"), ("dhs", "AED"), ("£", "GBP"), ("gbp", "GBP"), ("$", "USD"), ("usd", "USD"))


def currency_in(price_text: str | None) -> str | None:
    low = (price_text or "").lower()
    return next((code for mark, code in _SYMBOLS if mark in low), None)


def _day(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _last_final(conn, site_id: int) -> date | None:
    final = conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": site_id}).scalar()
    last = conn.execute(text("SELECT MAX(day) FROM gsc_query WHERE site_id = :s"), {"s": site_id}).scalar()
    found = [d for d in (final, last) if d]
    return min(found) if found else None


def _position(conn, site_id: int, keyword: str, code3: str | None, start: date, end: date) -> dict:
    """The keyword's impression-weighted position from start to end: its own country when that has rows by `start`."""
    params = {"s": site_id, "a": start, "b": end, "h": tuple(_hashes(keyword))}
    if code3:
        first = conn.execute(text("SELECT MIN(day) FROM gsc_query_country WHERE site_id = :s AND country = :c"), {"s": site_id, "c": code3}).scalar()
        if first and first <= start:
            row = conn.execute(
                text("SELECT SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p, SUM(impressions) AS n FROM gsc_query_country WHERE site_id = :s AND country = :c AND day BETWEEN :a AND :b AND query_hash IN :h"),
                {**params, "c": code3},
            ).mappings().first()
            return {"p": round(float(row["p"]), 1) if row["p"] is not None else None, "impressions": int(row["n"] or 0), "scope": code3}
    row = conn.execute(
        text("SELECT SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p, SUM(impressions) AS n FROM gsc_query WHERE site_id = :s AND day BETWEEN :a AND :b AND query_hash IN :h"),
        params,
    ).mappings().first()
    return {"p": round(float(row["p"]), 1) if row["p"] is not None else None, "impressions": int(row["n"] or 0), "scope": "all"}


def _compare(conn, site_id: int, keyword: str, code3: str | None, pivot: date, last_final: date | None, after_end: date | None = None) -> dict:
    """Before = the DAYS days before `pivot`; after = the DAYS days from it (or the DAYS days ending on after_end)."""
    if last_final is None:
        return {"state": "no_data"}
    before = (pivot - timedelta(days=DAYS), pivot - timedelta(days=1))
    after = (after_end - timedelta(days=DAYS - 1), after_end) if after_end else (pivot, pivot + timedelta(days=DAYS - 1))
    if after[1] > last_final:
        return {"state": "waiting", "ready_on": str(after[1] + timedelta(days=3))}
    was, now = _position(conn, site_id, keyword, code3, *before), _position(conn, site_id, keyword, code3, *after)
    if was["impressions"] < MIN_IMPRESSIONS or now["impressions"] < MIN_IMPRESSIONS or was["p"] is None or now["p"] is None:
        return {"state": "few", "before": was["p"], "after": now["p"]}
    return {"state": "ok", "before": was["p"], "after": now["p"], "change": round(was["p"] - now["p"], 1), "windows": {"before": [str(d) for d in before], "after": [str(d) for d in after]}}


def bought(engine: Engine, site_id: int) -> dict:
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        links = conn.execute(
            text(
                "SELECT id, source_url, domain, status, target_url, anchor, keyword, placed, price_text, cost, billed_text, billed, mediator "
                "FROM backlinks WHERE site_id = :s AND status IN :st ORDER BY placed DESC, id DESC"
            ),
            {"s": site_id, "st": BOUGHT},
        ).mappings().all()
        tracked = {
            store.clean_keyword(r["keyword"]).casefold(): r
            for r in conn.execute(text("SELECT k.id, k.keyword, k.country FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s"), {"s": site_id}).mappings()
        }
        last_final = _last_final(conn, site_id)
        groups: dict[str, dict] = {}
        for link in links:
            words = store.clean_keyword(link["keyword"] or "")
            key = words.casefold()
            known = tracked.get(key)
            code3 = countries.alpha3(known["country"]) if known and known["country"] else None
            group = groups.setdefault(key, {"keyword": words or None, "keyword_id": known["id"] if known else None, "links": [], "code3": code3})
            placed = _day(link["placed"])
            group["links"].append({
                "id": link["id"], "source_url": link["source_url"], "domain": link["domain"], "status": link["status"], "target_url": link["target_url"],
                "anchor": link["anchor"], "placed": link["placed"], "placed_day": str(placed) if placed else None, "mediator": link["mediator"],
                "price_text": link["price_text"], "cost": float(link["cost"]) if link["cost"] is not None else None,
                "billed_text": link["billed_text"], "billed": float(link["billed"]) if link["billed"] is not None else None,
                "currency": currency_in(link["price_text"]) or currency_in(link["billed_text"]),
                "effect": _compare(conn, site_id, words, code3, placed, last_final) if words and placed else {"state": "no_keyword" if not words else "no_date"},
            })
        cards = []
        for key, group in groups.items():
            dated = [d for d in (_day(x["placed"]) for x in group["links"]) if d]
            first = min(dated) if dated else None
            billed = sum(x["billed"] or 0 for x in group["links"])
            cost = sum(x["cost"] or 0 for x in group["links"])
            effect = _compare(conn, site_id, group["keyword"], group["code3"], first, last_final, after_end=last_final) if group["keyword"] and first and last_final and last_final >= first else {"state": "no_date" if group["keyword"] else "no_keyword"}
            cards.append({
                "keyword": group["keyword"], "keyword_id": group["keyword_id"], "links": group["links"], "count": len(group["links"]),
                "billed": round(billed, 2), "cost": round(cost, 2), "first_placed": str(first) if first else None, "effect": effect,
            })
    cards.sort(key=lambda c: (-(c["billed"] or c["cost"]), -c["count"], c["keyword"] or "~"))
    budget = protect.get_budget(engine, site_id)
    seen = defaultdict(int)
    for card in cards:
        for x in card["links"]:
            if x["currency"]:
                seen[x["currency"]] += 1
    currency = (budget or {}).get("currency") or (max(seen, key=seen.get) if seen else None)
    return {
        "site_id": site_id, "host": site["host"], "last_final": str(last_final) if last_final else None, "days": DAYS,
        "totals": {"links": sum(c["count"] for c in cards), "billed": round(sum(c["billed"] for c in cards), 2), "cost": round(sum(c["cost"] for c in cards), 2)},
        "budget": budget, "currency": currency, "currencies": sorted(seen), "cards": cards,
    }
