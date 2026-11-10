"""B. Slow decline: what a 28-day comparison hides because it happens a little every week."""
from __future__ import annotations

from datetime import date, timedelta

from seo.insights import rules
from seo.insights.data import Ctx, rnd
from seo.insights.finding import Finding, Result
from seo.insights.movement import _path


def _fit(values: list[float]) -> tuple[float, float]:
    """Least-squares slope per week, and r²: how well a straight line explains the weeks."""
    n = len(values)
    mean_x, mean_y = (n - 1) / 2, sum(values) / n
    sxx = sum((x - mean_x) ** 2 for x in range(n))
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in enumerate(values))
    syy = sum((y - mean_y) ** 2 for y in values)
    slope = sxy / sxx if sxx else 0.0
    return slope, (sxy * sxy / (sxx * syy) if sxx and syy else 0.0)


def decay(ctx: Ctx) -> Result:
    """A page whose weekly clicks slide down over 16 weeks and now sit well under its own best. Weeks count back from the
    last final day, so every week is whole. A week with a partial day is compared on the days it has, scaled to 7."""
    out = Result()
    weeks = rules.DECAY_WEEKS
    first = ctx.end - timedelta(days=7 * weeks - 1)
    if ctx.first_day > first:
        out.needs["decay"] = "history"
        return out
    out.ran.add("decay")
    rows = ctx.fetch(
        "SELECT page_hash k, MAX(page) page, FLOOR(DATEDIFF(:e, day) / 7) back, SUM(clicks) c FROM gsc_page "
        "WHERE site_id = :s AND day BETWEEN :f AND :e AND day NOT IN :skip GROUP BY page_hash, back",
        e=ctx.end, f=first,
    )
    skipped = {}
    for day in ctx.skip:
        if first <= day <= ctx.end:
            back = (ctx.end - day).days // 7
            skipped[back] = skipped.get(back, 0) + 1
    by_page: dict[str, dict] = {}
    for r in rows:
        slot = by_page.setdefault(r["k"], {"page": r["page"], "weeks": [0.0] * weeks})
        back = int(r["back"])
        days = 7 - skipped.get(back, 0)
        slot["weeks"][weeks - 1 - back] = float(r["c"] or 0) * 7 / days if days else 0.0
    for page in by_page.values():
        series = page["weeks"]
        if sum(series) < rules.DECAY_MIN_CLICKS:
            continue
        rolling = [sum(series[i - 3: i + 1]) / 4 for i in range(3, weeks)]
        peak = max(rolling[:-1])  # the best 4 weeks before the last 4
        last = rolling[-1]
        mean = sum(series) / weeks
        slope, fit = _fit(series)
        if peak < rules.DECAY_MIN_PEAK or last > peak * rules.DECAY_BELOW_PEAK or slope * (weeks - 1) / mean > rules.DECAY_SLOPE or fit < rules.DECAY_FIT:
            continue
        # A slide happens a little at a time: each third of the weeks lower than the one before. A cliff (one bad week, then
        # flat) is a page losing clicks, said under What changed, not a decline.
        thirds = [sum(series[:5]) / 5, sum(series[5:11]) / 6, sum(series[11:]) / 5]
        if not (thirds[1] <= thirds[0] * rules.DECAY_STEP and thirds[2] <= thirds[1] * rules.DECAY_STEP):
            continue
        peak_at = rolling.index(peak) + 3
        out.findings.append(Finding(
            "decay", "decline", page["page"], page=page["page"], at_stake=(peak - last) * 30 / 7,
            evidence={
                "path": _path(page["page"]), "weeks": [round(v) for v in series], "peak": round(peak, 1), "last": round(last, 1),
                "below_peak": round((1 - last / peak) * 100), "thirds": [round(v, 1) for v in thirds], "slope": round(slope, 2), "fit": round(fit, 2),
                # the first day of the best 4 weeks: series index x is the week `weeks - 1 - x` weeks back
                "peak_from": (ctx.end - timedelta(days=7 * (weeks + 2 - peak_at) + 6)).isoformat(),
            },
        ).settle())
    return out


# ---- B2. Slow position slide ---------------------------------------------------------------------


def _fit_xy(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Slope, intercept and r² of a straight line through (x, y) points."""
    n = len(points)
    mean_x = sum(x for x, _ in points) / n
    mean_y = sum(y for _, y in points) / n
    sxx = sum((x - mean_x) ** 2 for x, _ in points)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in points)
    syy = sum((y - mean_y) ** 2 for _, y in points)
    slope = sxy / sxx if sxx else 0.0
    return slope, mean_y - slope * mean_x, (sxy * sxy / (sxx * syy) if sxx and syy else 0.0)


def slide(ctx: Ctx, already: set[str] | None = None) -> Result:
    """A query losing places a little every week for 8 weeks, before it shows as a drop. Weekly positions are weighted by
    impressions; a straight line must fit them well, so one bad week isn't a slide. A query already said under What changed
    (lost 3 places) isn't said twice."""
    out = Result()
    weeks = rules.SLIDE_WEEKS
    first = ctx.end - timedelta(days=7 * weeks - 1)
    if ctx.first_day > first:
        out.needs["slide"] = "history"
        return out
    out.ran.add("slide")
    already = already or set()
    rows = ctx.fetch(
        "SELECT q.query_hash k, MAX(q.query) query, FLOOR(DATEDIFF(:e, q.day) / 7) back, SUM(q.impressions) i, SUM(q.position * q.impressions) w, SUM(q.clicks) c "
        "FROM gsc_query q WHERE q.site_id = :s AND q.day BETWEEN :f AND :e AND q.day NOT IN :skip AND q.impressions > 0 AND q.position IS NOT NULL "
        "AND q.query_hash IN (SELECT query_hash FROM gsc_query WHERE site_id = :s AND day BETWEEN :f AND :e GROUP BY query_hash HAVING SUM(impressions) >= :m) "
        "GROUP BY q.query_hash, back",
        e=ctx.end, f=first, m=rules.SLIDE_MIN_IMPRESSIONS,
    )
    by_query: dict[str, dict] = {}
    for r in rows:
        slot = by_query.setdefault(r["k"], {"query": r["query"], "weeks": {}, "impressions": 0, "clicks": 0})
        shown = int(r["i"] or 0)
        if shown:
            slot["weeks"][weeks - 1 - int(r["back"])] = (float(r["w"]) / shown, shown)
            slot["impressions"] += shown
            slot["clicks"] += int(r["c"] or 0)
    found = []
    for slot in by_query.values():
        if slot["query"] in already or len(slot["weeks"]) < rules.SLIDE_MIN_WEEKS:
            continue
        points = sorted((x, p) for x, (p, _) in slot["weeks"].items())
        slope, intercept, fit = _fit_xy(points)
        start, end = intercept, intercept + slope * (weeks - 1)
        if slope < rules.SLIDE_SLOPE or end - start < rules.SLIDE_TOTAL or fit < rules.SLIDE_FIT or end > rules.SLIDE_TOP:
            continue
        weekly = slot["impressions"] / len(slot["weeks"])
        lost = weekly * max(0.0, ctx.curve.rate(max(1.0, start)) - ctx.curve.rate(end))
        found.append(Finding(
            "slide", "decline", slot["query"], query=slot["query"], at_stake=lost * 30 / 7,
            evidence={
                "weeks": [rnd(slot["weeks"][x][0]) if x in slot["weeks"] else None for x in range(weeks)],
                "position_before": rnd(max(1.0, start)), "position": rnd(end), "slope": round(slope, 2), "fit": round(fit, 2),
                "impressions": slot["impressions"], "clicks": slot["clicks"],
            },
        ).settle())
    out.findings += sorted(found, key=lambda f: -f.at_stake)[: rules.SLIDE_KEPT]
    return out


# ---- B3. Seasonal or real? -----------------------------------------------------------------------


def _clicks(ctx: Ctx, table: str, where: str, a, b, **values) -> int:
    rows = ctx.fetch(f"SELECT COALESCE(SUM(clicks), 0) c FROM {table} WHERE site_id = :s AND day BETWEEN :a AND :b {where}", a=a, b=b, **values)
    return int(rows[0]["c"] or 0) if rows else 0


def _subject(f: Finding) -> tuple[str, str, dict] | None:
    """Where a finding's clicks live, to read the same weeks a year earlier."""
    from seo.collectors.common import digest

    if f.kind == "change":
        return "gsc_daily", "", {}
    if f.kind in ("page_down", "decay") and f.page:
        return "gsc_page", "AND page_hash = :h", {"h": digest(f.page)}
    if f.kind == "query_down" and f.query:
        return "gsc_query", "AND query_hash = :h", {"h": digest(f.query)}
    if f.kind == "segment":
        dim, value = f.evidence["dim"], f.evidence["segment"]
        return ("gsc_device", "AND device = :v", {"v": value}) if dim == "device" else ("gsc_country", "AND country = :v", {"v": value})
    return None


SEASONAL_KINDS = ("change", "page_down", "decay", "query_down", "segment")


def seasonal(ctx: Ctx, findings: list[Finding]) -> Result:
    """A drop that also happened over the same weeks last year is labelled seasonal and counts half, so it doesn't raise a
    false alarm. 52 weeks back, so weekdays line up. Only drops are checked; a rise needs no excuse."""
    out = Result()
    year = timedelta(days=rules.SEASON_DAYS)
    earliest = (ctx.before_start or ctx.start) - year
    if ctx.first_day > earliest:
        out.needs["seasonal"] = "history"
        return out
    for f in findings:
        if f.kind not in SEASONAL_KINDS or (f.kind == "segment" and not f.evidence.get("down")):
            continue
        if f.kind == "change" and (f.evidence.get("change") or 0) >= 0:
            continue
        where = _subject(f)
        if where is None:
            continue
        table, sql, values = where
        if f.kind == "decay":
            peak_from = date.fromisoformat(f.evidence["peak_from"])
            then = (peak_from - year, peak_from + timedelta(days=27) - year)
            now = (ctx.end - timedelta(days=27) - year, ctx.end - year)
            percent_now = -f.evidence["below_peak"]
        else:
            then = (ctx.before_start - year, ctx.before_end - year)
            now = (ctx.start - year, ctx.end - year)
            percent_now = f.evidence.get("percent")
            if percent_now is None and f.kind == "query_down":
                c0, c1 = f.evidence["clicks_before"], f.evidence["clicks"]
                percent_now = round((c1 - c0) / c0 * 100) if c0 else None
        if percent_now is None or percent_now >= 0:
            continue
        before_clicks, now_clicks = _clicks(ctx, table, sql, *then, **values), _clicks(ctx, table, sql, *now, **values)
        if before_clicks < rules.STEADY_CLICKS / 2:
            continue  # too little last year to say anything
        last_year = round((now_clicks - before_clicks) / before_clicks * 100)
        f.evidence["last_year"] = {"clicks": now_clicks, "clicks_before": before_clicks, "percent": last_year}
        if last_year <= percent_now * rules.SEASON_SHARE:
            f.evidence["seasonal"] = True
            f.at_stake *= rules.SEASON_STAKE
            if f.severity == "big":
                f.severity = "normal"
            f.settle()
    out.ran.add("seasonal")
    return out
