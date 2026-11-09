"""What every detector reads: the site's final days, the period and the one before it, and the click-rate curve.

Final days only (before fresh_from): fresh days come in low and would look like drops. A day Search Console gave only part
of (coverage "partial") is left out, and so is the same weekday in the other period, so both sides still compare alike.
"""
from __future__ import annotations

import bisect
import statistics
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.insights import rules
from seo.metrics import search

NEVER = date(1900, 1, 1)  # stands in for an empty list of days left out, which SQL can't take

# A generic curve, used where the site has too few queries of its own. Position → share of impressions clicked.
DEFAULT_CURVE = ((1, 0.28), (2, 0.16), (3, 0.11), (4, 0.08), (5, 0.06), (6, 0.045), (7, 0.035), (8, 0.03), (9, 0.025), (10, 0.02), (15, 0.01), (20, 0.007), (30, 0.003), (50, 0.001))
_X = [p for p, _ in DEFAULT_CURVE]


def default_rate(position: float) -> float:
    position = max(1.0, float(position))
    if position >= _X[-1]:
        return DEFAULT_CURVE[-1][1]
    i = bisect.bisect_right(_X, position) - 1
    (x0, y0), (x1, y1) = DEFAULT_CURVE[i], DEFAULT_CURVE[i + 1]
    return y0 + (y1 - y0) * (position - x0) / (x1 - x0)


def band_of(position: float | None) -> tuple[int, int] | None:
    if position is None:
        return None
    place = round(position)
    return next((band for band in rules.CURVE_BANDS if band[0] <= place <= band[1]), None)


@dataclass
class Curve:
    """The generic curve, bent to this site's own: per band, its median rate ÷ the generic one. Brand queries stay out,
    because they are clicked far more than anything else at the same place."""

    ratios: dict = field(default_factory=dict)
    medians: dict = field(default_factory=dict)
    own: bool = False

    def rate(self, position: float) -> float:
        band = band_of(position)
        ratio = self.ratios.get(band)
        if ratio is None and self.ratios:
            ratio = statistics.median(self.ratios.values())
        return default_rate(position) * (ratio or 1.0)


@dataclass
class Ctx:
    engine: Engine
    site_id: int
    host: str
    end: date  # last final day
    start: date
    before_start: date | None
    before_end: date | None
    skip: list[date]
    first_day: date
    brand: list[str] = field(default_factory=list)
    tracked: set = field(default_factory=set)
    curve: Curve = field(default_factory=Curve)

    @property
    def has_before(self) -> bool:
        return self.before_start is not None

    def fetch(self, sql: str, **values):
        statement = text(sql)
        if ":skip" in sql:
            statement = statement.bindparams(bindparam("skip", expanding=True))
            values = {"skip": self.skip or [NEVER], **values}
        with self.engine.connect() as conn:
            return conn.execute(statement, {"s": self.site_id, **values}).mappings().all()

    def days_in(self, start: date, end: date) -> int:
        return (end - start).days + 1 - sum(1 for d in self.skip if start <= d <= end)


def load(engine: Engine, site_id: int) -> Ctx | None:
    with engine.connect() as conn:
        site = conn.execute(text("SELECT host FROM sites WHERE id = :s AND kind = 'own'"), {"s": site_id}).first()
        if site is None:
            return None
        row = conn.execute(
            text(
                "SELECT MIN(day) first_day, MAX(day) last_day FROM gsc_daily WHERE site_id = :s "
                "AND day < COALESCE((SELECT fresh_from FROM site_sources WHERE site_id = :s AND source = 'gsc'), '9999-12-31')"
            ),
            {"s": site_id},
        ).mappings().first()
        if not row or row["last_day"] is None:
            return None
        partial = {r[0] for r in conn.execute(text("SELECT day FROM coverage WHERE site_id = :s AND source = 'gsc' AND status = 'partial'"), {"s": site_id}).all()}
    end, first_day = row["last_day"], row["first_day"]
    start = end - timedelta(days=rules.PERIOD_DAYS - 1)
    before_end = start - timedelta(days=1)
    before_start = before_end - timedelta(days=rules.PERIOD_DAYS - 1)
    has_before = first_day <= before_start
    skip = set(partial)
    if has_before:  # a partial day takes its twin in the other period with it
        for day in list(partial):
            if start <= day <= end:
                skip.add(day - timedelta(days=rules.PERIOD_DAYS))
            elif before_start <= day <= before_end:
                skip.add(day + timedelta(days=rules.PERIOD_DAYS))
    ctx = Ctx(engine, site_id, site[0], end, max(start, first_day), before_start if has_before else None, before_end if has_before else None, sorted(skip), first_day)
    scope = search.Scope(engine, site_id, ctx.start.isoformat(), end.isoformat())
    ctx.brand = search.brand_words(scope)
    ctx.tracked = search.tracked(scope)
    ctx.curve = _curve(ctx)
    return ctx


def _curve(ctx: Ctx) -> Curve:
    if not ctx.brand:
        return Curve()  # without brand words the site's own rates would be lifted by its brand, so the generic curve it is
    rows = split(ctx, "query", ctx.end - timedelta(days=rules.CURVE_DAYS - 1), ctx.end)
    rates: dict = {}
    for r in rows:
        if r["impressions"] >= rules.CURVE_MIN_IMPRESSIONS and r["position"] is not None and not search.is_brand(r["name"], ctx.brand):
            band = band_of(r["position"])
            if band:
                rates.setdefault(band, []).append(r["clicks"] / r["impressions"])
    low, high = rules.CURVE_RATIO_LIMITS
    medians = {band: statistics.median(found) for band, found in rates.items() if len(found) >= rules.CURVE_MIN_QUERIES}
    ratios = {band: min(high, max(low, m / default_rate((band[0] + band[1]) / 2))) for band, m in medians.items() if default_rate((band[0] + band[1]) / 2)}
    return Curve(ratios=ratios, medians=medians, own=bool(ratios))


TABLES = {
    "query": ("gsc_query", "query_hash", "MAX(query) name, NULL page"),
    "page": ("gsc_page", "page_hash", "MAX(page) name, MAX(page) page"),
    "pair": ("gsc_query_page", "pair_hash", "MAX(query) name, MAX(page) page"),
}


def split(ctx: Ctx, dim: str, start: date, end: date, before_start: date | None = None, before_end: date | None = None, where: str = "", **values) -> list[dict]:
    """Rows by query, page or query+page: clicks, impressions and impression-weighted position, now and (optionally) before."""
    table, key, names = TABLES[dim]
    ca, cb = (before_start, before_end) if before_start else (NEVER, NEVER)
    found = ctx.fetch(
        f"SELECT {key} k, {names}, "
        "SUM(IF(day BETWEEN :a AND :b, clicks, 0)) c, SUM(IF(day BETWEEN :a AND :b, impressions, 0)) i, SUM(IF(day BETWEEN :a AND :b, position * impressions, 0)) w, "
        "SUM(IF(day BETWEEN :ca AND :cb, clicks, 0)) pc, SUM(IF(day BETWEEN :ca AND :cb, impressions, 0)) pi, SUM(IF(day BETWEEN :ca AND :cb, position * impressions, 0)) pw "
        f"FROM {table} WHERE site_id = :s AND (day BETWEEN :a AND :b OR day BETWEEN :ca AND :cb) AND day NOT IN :skip {where} GROUP BY {key}",
        a=start, b=end, ca=ca, cb=cb, **values,
    )
    rows = []
    for r in found:
        shown, before = int(r["i"] or 0), int(r["pi"] or 0)
        item = {
            "key": r["k"], "name": r["name"], "page": r["page"], "clicks": int(r["c"] or 0), "impressions": shown,
            "position": float(r["w"]) / shown if shown and r["w"] is not None else None,
        }
        if before_start:
            item.update(clicks_before=int(r["pc"] or 0), impressions_before=before, position_before=float(r["pw"]) / before if before and r["pw"] is not None else None)
        if dim == "pair":
            item["query"] = item["name"]
        rows.append(item)
    return rows


def daily(ctx: Ctx, start: date, end: date) -> dict[date, dict]:
    rows = ctx.fetch("SELECT day, clicks, impressions, position FROM gsc_daily WHERE site_id = :s AND day BETWEEN :a AND :b AND day NOT IN :skip", a=start, b=end)
    return {r["day"]: {"clicks": int(r["clicks"] or 0), "impressions": int(r["impressions"] or 0), "position": r["position"]} for r in rows}


def totals(ctx: Ctx, start: date, end: date) -> dict:
    days = daily(ctx, start, end).values()
    clicks, shown = sum(d["clicks"] for d in days), sum(d["impressions"] for d in days)
    weighted = sum(d["position"] * d["impressions"] for d in days if d["position"] is not None)
    return {"clicks": clicks, "impressions": shown, "position": round(weighted / shown, 1) if shown else None, "click_rate": round(clicks / shown * 100, 2) if shown else None}


def rnd(value: float | None, digits: int = 1):
    return round(value, digits) if value is not None else None
