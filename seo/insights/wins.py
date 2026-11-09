"""C. Quick wins: queries a small push would pay for, worked out with this site's own click-rate curve."""
from __future__ import annotations

from datetime import timedelta

from seo.insights import rules
from seo.insights.data import Ctx, band_of, rnd, split
from seo.insights.finding import Finding, Result
from seo.metrics import search


def _pages_by_query(ctx: Ctx) -> dict[str, list[dict]]:
    by_query: dict[str, list[dict]] = {}
    for r in split(ctx, "pair", ctx.start, ctx.end):
        if r["impressions"]:
            by_query.setdefault(r["query"], []).append(r)
    return by_query


def _query_fields(ctx: Ctx, r: dict, pages: list[dict]) -> dict:
    best = max(pages, key=lambda p: p["impressions"])["page"] if pages else None
    return {
        "clicks": r["clicks"], "impressions": r["impressions"], "position": rnd(r["position"]),
        "click_rate": round(r["clicks"] / r["impressions"] * 100, 2) if r["impressions"] else None,
        "page": best, "tracked": search._match(r["name"]) in ctx.tracked, "brand": search.is_brand(r["name"], ctx.brand) if ctx.brand else None,
    }


def _keep(findings: list[Finding]) -> list[Finding]:
    return sorted(findings, key=lambda f: -f.at_stake)[: rules.WINS_KEPT]


def wins(ctx: Ctx) -> Result:
    out = Result()
    out.ran.update({"almost", "top3", "no_click", "compete"})
    recent = {r["k"] for r in ctx.fetch(
        "SELECT DISTINCT query_hash k FROM gsc_query WHERE site_id = :s AND day > :since AND day <= :e AND impressions > 0", since=ctx.end - timedelta(days=rules.WINS_RECENT_DAYS), e=ctx.end,
    )}
    rows = [r for r in split(ctx, "query", ctx.start, ctx.end) if r["impressions"] and r["position"] is not None and r["key"] in recent]
    pages = _pages_by_query(ctx)
    curve = ctx.curve
    found: dict[str, list[Finding]] = {"almost": [], "top3": [], "no_click": [], "low_ctr": [], "compete": []}
    no_click = set()
    for r in rows:
        place, shown = round(r["position"]), r["impressions"]
        rate = r["clicks"] / shown
        fields = _query_fields(ctx, r, pages.get(r["name"], []))
        if shown >= rules.NO_CLICK_MIN_IMPRESSIONS and not r["clicks"] and place <= rules.NO_CLICK_TOP:
            no_click.add(r["key"])
            found["no_click"].append(Finding("no_click", "wins", r["name"], query=r["name"], page=fields["page"], at_stake=shown * curve.rate(r["position"]) * rules.MONTH, evidence={**fields, "expected_rate": round(curve.rate(r["position"]) * 100, 2)}))
        if rules.ALMOST_BAND[0] <= place <= rules.ALMOST_BAND[1] and shown >= rules.ALMOST_MIN_IMPRESSIONS:
            target = curve.rate(rules.ALMOST_TARGET)
            found["almost"].append(Finding("almost", "wins", r["name"], query=r["name"], page=fields["page"], at_stake=shown * (target - rate) * rules.MONTH, evidence={**fields, "target": rules.ALMOST_TARGET, "target_rate": round(target * 100, 2)}))
        elif rules.TOP3_BAND[0] <= place <= rules.TOP3_BAND[1] and shown >= rules.TOP3_MIN_IMPRESSIONS:
            target = curve.rate(rules.TOP3_TARGET)
            found["top3"].append(Finding("top3", "wins", r["name"], query=r["name"], page=fields["page"], at_stake=shown * (target - rate) * rules.MONTH, evidence={**fields, "target": rules.TOP3_TARGET, "target_rate": round(target * 100, 2)}))
    # Low click rate needs brand words: brand queries are clicked far more, so without them every other query looks weak.
    if not ctx.brand:
        out.needs["low_ctr"] = "brand_words"
    elif not curve.medians:
        out.needs["low_ctr"] = "more_data"
    else:
        out.ran.add("low_ctr")
        for r in rows:
            band = band_of(r["position"])
            expected = curve.medians.get(band)
            if not expected or r["impressions"] < rules.LOW_CTR_MIN_IMPRESSIONS or r["key"] in no_click or search.is_brand(r["name"], ctx.brand):
                continue
            rate = r["clicks"] / r["impressions"]
            if rate < expected * rules.LOW_CTR_SHARE:
                fields = _query_fields(ctx, r, pages.get(r["name"], []))
                found["low_ctr"].append(Finding("low_ctr", "wins", r["name"], query=r["name"], page=fields["page"], at_stake=r["impressions"] * (expected - rate) * rules.MONTH, evidence={**fields, "expected_rate": round(expected * 100, 2)}))
    found["compete"] = _compete(ctx, rows, pages)
    for kind, items in found.items():
        out.findings += [f.settle() for f in _keep(items)]
    return out


def _compete(ctx: Ctx, rows: list[dict], pages: dict[str, list[dict]]) -> list[Finding]:
    """Two or more of the site's pages each take a fair share of one query, and one of them is in the top 20. If the best of
    them got all the impressions at its position, the query would bring this many more clicks."""
    out = []
    for r in rows:
        if r["impressions"] < rules.COMPETE_MIN_IMPRESSIONS:
            continue
        mine = pages.get(r["name"], [])
        total = sum(p["impressions"] for p in mine)
        if not total:
            continue
        shares = [p for p in mine if p["impressions"] / total >= rules.COMPETE_SHARE]
        ranked = [p for p in shares if p["position"] is not None]
        if len(shares) < 2 or not any(p["position"] <= rules.COMPETE_TOP for p in ranked):
            continue
        best = min(ranked, key=lambda p: p["position"])
        gain = r["impressions"] * ctx.curve.rate(best["position"]) - r["clicks"]
        out.append(Finding(
            "compete", "wins", r["name"], query=r["name"], page=best["page"], at_stake=gain * rules.MONTH,
            evidence={
                "clicks": r["clicks"], "impressions": r["impressions"], "position": rnd(r["position"]), "tracked": search._match(r["name"]) in ctx.tracked,
                "pages": [{"page": p["page"], "share": round(p["impressions"] / total * 100), "clicks": p["clicks"], "position": rnd(p["position"])} for p in sorted(shares, key=lambda p: -p["impressions"])],
            },
        ))
    return _keep(out)
