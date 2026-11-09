"""B. Slow decline: what a 28-day comparison hides because it happens a little every week."""
from __future__ import annotations

from datetime import timedelta

from seo.insights import rules
from seo.insights.data import Ctx
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
