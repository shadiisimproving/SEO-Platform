"""A. What changed, and why: the change breakdown, odd days, pages losing or gaining, pages that dropped out of Google."""
from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import bindparam, text

from seo.insights import rules
from seo.insights.data import NEVER, Ctx, daily, rnd, split, totals
from seo.insights.finding import Finding, Result


# ---- A1. Change breakdown ------------------------------------------------------------------------


def breakdown(ctx: Ctx) -> Result:
    """Splits the change in clicks into what caused it, query by query, so the parts add up to the site's change exactly:

    - demand: more or fewer impressions, at the old click rate
    - ranking: the click rate a query should get at its new position against its old one (this site's curve)
    - appeal: what's left of the click rate's change, at the same position: titles, snippets, rich results
    - new and lost: queries seen only now, or only before
    - hidden: the rest of the site's total, which Google keeps out of the query tables (rare queries)
    """
    out = Result()
    if not ctx.has_before:
        out.needs["change"] = "history"
        return out
    out.ran.add("change")
    now, before = totals(ctx, ctx.start, ctx.end), totals(ctx, ctx.before_start, ctx.before_end)
    if not now["impressions"] and not before["impressions"]:
        return out
    parts = {"demand": 0.0, "ranking": 0.0, "appeal": 0.0, "new": 0.0, "lost": 0.0}
    movers: dict[str, list] = {name: [] for name in parts}
    for r in split(ctx, "query", ctx.start, ctx.end, ctx.before_start, ctx.before_end):
        c1, i1, c0, i0 = r["clicks"], r["impressions"], r["clicks_before"], r["impressions_before"]
        if not i0 and not i1:
            continue
        if not i0:
            effect = {"new": float(c1)}
        elif not i1:
            effect = {"lost": float(-c0)}
        else:
            rate0, rate1 = c0 / i0, c1 / i1
            demand = (i1 - i0) * rate0
            ranking = i1 * (ctx.curve.rate(r["position"]) - ctx.curve.rate(r["position_before"])) if r["position"] is not None and r["position_before"] is not None else 0.0
            effect = {"demand": demand, "ranking": ranking, "appeal": (c1 - c0) - demand - ranking}
        for name, value in effect.items():
            parts[name] += value
            if value:
                movers[name].append({"query": r["name"], "effect": round(value, 1), "clicks": c1, "clicks_before": c0, "impressions": i1, "impressions_before": i0, "position": rnd(r["position"]), "position_before": rnd(r["position_before"])})
    change = now["clicks"] - before["clicks"]
    parts["hidden"] = change - sum(parts.values())
    direction = 1 if change >= 0 else -1
    top = {name: sorted((m for m in found if m["effect"] * direction > 0), key=lambda m: -abs(m["effect"]))[: rules.CHANGE_MOVERS] for name, found in movers.items()}
    percent = round(change / before["clicks"] * 100) if before["clicks"] else None
    steady = abs(change) < rules.STEADY_CLICKS or (percent is not None and abs(percent) < rules.STEADY_PERCENT)
    big = change < 0 and abs(change) >= rules.BIG_CHANGE_CLICKS and percent is not None and percent <= -rules.BIG_CHANGE_PERCENT
    # The cause named first: the biggest part pulling the same way as the change.
    main = max((n for n in parts if parts[n] * direction > 0), key=lambda n: abs(parts[n]), default=None)
    out.findings.append(Finding(
        "change", "changed", "site", at_stake=-change * rules.MONTH, severity="info" if steady else "big" if big else "normal",
        evidence={
            "now": now, "before": before, "change": change, "percent": percent, "steady": steady, "main": main,
            "parts": {name: round(value) for name, value in parts.items()}, "movers": top,
            "from": ctx.start.isoformat(), "to": ctx.end.isoformat(), "before_from": ctx.before_start.isoformat(), "before_to": ctx.before_end.isoformat(),
            "days": ctx.days_in(ctx.start, ctx.end), "curve": "own" if ctx.curve.own else "generic",
        },
    ).settle())
    return out


# ---- A2. Odd days --------------------------------------------------------------------------------


def _usual(values: list[int]) -> tuple[float, float]:
    """The median, and a spread that never goes below what chance alone gives at that size (√n for counts)."""
    middle = statistics.median(values)
    spread = statistics.median(abs(v - middle) for v in values) * 1.4826
    return middle, max(spread, middle ** 0.5, 1.0)


def odd_days(ctx: Ctx) -> Result:
    out = Result()
    first = ctx.end - timedelta(days=rules.ODD_LOOK_DAYS - 1 + 7 * rules.ODD_WEEKS)
    days = daily(ctx, first, ctx.end)
    out.ran.add("odd_day")
    low_days = set()
    found = []
    for back in range(rules.ODD_LOOK_DAYS):
        day = ctx.end - timedelta(days=back)
        if day not in days:
            continue
        history = [days[day - timedelta(days=7 * k)]["clicks"] for k in range(1, rules.ODD_WEEKS + 1) if day - timedelta(days=7 * k) in days]
        if len(history) < rules.ODD_MIN_WEEKS:
            continue
        usual, spread = _usual(history)
        if usual < rules.ODD_MIN_USUAL:
            continue
        clicks = days[day]["clicks"]
        z = (clicks - usual) / spread
        shown_history = [days[day - timedelta(days=7 * k)]["impressions"] for k in range(1, rules.ODD_WEEKS + 1) if day - timedelta(days=7 * k) in days]
        evidence = {"day": day.isoformat(), "weekday": day.weekday(), "clicks": clicks, "usual": round(usual, 1), "z": round(z, 1), "impressions": days[day]["impressions"], "usual_impressions": round(statistics.median(shown_history))}
        if clicks <= usual * rules.ODD_LOW_SHARE and z <= -rules.ODD_Z:
            low_days.add(day)
            found.append(Finding("odd_day", "changed", day.isoformat(), at_stake=usual - clicks, evidence={**evidence, "low": True}))
        elif clicks >= usual * rules.ODD_HIGH_SHARE and z >= rules.ODD_Z:
            found.append(Finding("odd_day", "changed", day.isoformat(), severity="info", evidence={**evidence, "low": False}))
    for finding in found:  # two low days in a row is no accident: that one raises an alert
        day = date.fromisoformat(finding.subject)
        if finding.evidence["low"] and (day - timedelta(days=1) in low_days or day + timedelta(days=1) in low_days):
            finding.severity = "big"
            finding.evidence["in_a_row"] = True
        out.findings.append(finding.settle() if finding.severity != "info" else finding)
    return out


# ---- A3. Pages losing or gaining -----------------------------------------------------------------


def _path(url: str | None) -> str:
    return urlsplit(url or "").path or "/"


def _why(r: dict) -> str:
    """The likely reason a page moved: its position, its impressions, or its click rate at the same place."""
    p0, p1, i0, i1 = r["position_before"], r["position"], r["impressions_before"], r["impressions"]
    if p0 is not None and p1 is not None and abs(p1 - p0) >= rules.PLACES_LOST:
        return "ranking"
    if i0 and (i1 / i0 <= rules.FEWER_SEARCHES or i1 / i0 >= 1 / rules.FEWER_SEARCHES):
        return "demand"
    return "appeal"


def pages(ctx: Ctx, gone: set[str] | None = None) -> Result:
    out = Result()
    if not ctx.has_before:
        out.needs.update(page_down="history", page_up="history")
        return out
    out.ran.update({"page_down", "page_up"})
    gone = gone or set()
    moved = []
    for r in split(ctx, "page", ctx.start, ctx.end, ctx.before_start, ctx.before_end):
        c1, c0 = r["clicks"], r["clicks_before"]
        change = c1 - c0
        if max(c0, c1) < rules.PAGE_MIN_CLICKS or abs(change) < rules.PAGE_MIN_CHANGE or r["page"] in gone:
            continue
        percent = round(change / c0 * 100) if c0 else None
        if percent is not None and abs(percent) < rules.PAGE_MIN_PERCENT:
            continue
        moved.append(r)
    if not moved:
        return out
    queries = _queries_behind(ctx, [r["page"] for r in moved])
    for r in moved:
        change = r["clicks"] - r["clicks_before"]
        percent = round(change / r["clicks_before"] * 100) if r["clicks_before"] else None
        down = change < 0
        behind = sorted((q for q in queries.get(r["page"], []) if (q["clicks"] - q["clicks_before"]) * change > 0), key=lambda q: -abs(q["clicks"] - q["clicks_before"]))[: rules.PAGE_QUERIES]
        big = down and percent is not None and percent <= -rules.PAGE_BIG_PERCENT and -change >= rules.PAGE_BIG_CLICKS
        evidence = {
            "path": _path(r["page"]), "clicks": r["clicks"], "clicks_before": r["clicks_before"], "percent": percent,
            "impressions": r["impressions"], "impressions_before": r["impressions_before"], "position": rnd(r["position"]), "position_before": rnd(r["position_before"]),
            "why": _why(r), "queries": behind,
        }
        if down:
            out.findings.append(Finding("page_down", "changed", r["page"], page=r["page"], at_stake=-change * rules.MONTH, severity="big" if big else "normal", evidence=evidence).settle())
        else:
            out.findings.append(Finding("page_up", "changed", r["page"], page=r["page"], severity="info", evidence={**evidence, "gained": round(change * rules.MONTH)}))
    return out


def _queries_behind(ctx: Ctx, wanted: list[str]) -> dict[str, list]:
    by_page: dict[str, list] = {}
    if not wanted:
        return by_page
    sql = text(
        "SELECT MAX(query) query, MAX(page) page, SUM(IF(day BETWEEN :a AND :b, clicks, 0)) c, SUM(IF(day BETWEEN :ca AND :cb, clicks, 0)) pc, "
        "SUM(IF(day BETWEEN :a AND :b, impressions, 0)) i, SUM(IF(day BETWEEN :a AND :b, position * impressions, 0)) w, "
        "SUM(IF(day BETWEEN :ca AND :cb, impressions, 0)) pi, SUM(IF(day BETWEEN :ca AND :cb, position * impressions, 0)) pw "
        f"FROM gsc_query_page WHERE site_id = :s AND day BETWEEN :ca AND :b AND day NOT IN :skip AND page IN :pages GROUP BY pair_hash"
    ).bindparams(bindparam("skip", expanding=True), bindparam("pages", expanding=True))
    with ctx.engine.connect() as conn:
        rows = conn.execute(sql, {"s": ctx.site_id, "a": ctx.start, "b": ctx.end, "ca": ctx.before_start, "cb": ctx.before_end, "skip": ctx.skip or [NEVER], "pages": wanted}).mappings().all()
    for row in rows:
        shown, before = int(row["i"] or 0), int(row["pi"] or 0)
        by_page.setdefault(row["page"], []).append({
            "query": row["query"], "clicks": int(row["c"] or 0), "clicks_before": int(row["pc"] or 0),
            "position": rnd(float(row["w"]) / shown) if shown and row["w"] is not None else None,
            "position_before": rnd(float(row["pw"]) / before) if before and row["pw"] is not None else None,
        })
    return by_page


# ---- A5. Dropped out of Google -------------------------------------------------------------------


def dropped_out(ctx: Ctx) -> Result:
    out = Result()
    recent_from = ctx.end - timedelta(days=rules.GONE_DAYS - 1)
    before_to = recent_from - timedelta(days=1)
    before_from = before_to - timedelta(days=rules.GONE_BEFORE_DAYS - 1)
    if ctx.first_day > before_from:
        out.needs["dropped_out"] = "history"
        return out
    site_days = sum(1 for d in daily(ctx, recent_from, ctx.end).values() if d["impressions"])
    if site_days < rules.GONE_SITE_DAYS:
        return out  # the whole site is quiet: that's a data or site problem, not one page
    out.ran.add("dropped_out")
    rows = split(ctx, "page", recent_from, ctx.end, before_from, before_to)
    gone = [r for r in rows if not r["impressions"] and (r["impressions_before"] >= rules.GONE_MIN_IMPRESSIONS or r["clicks_before"] >= rules.GONE_MIN_CLICKS)]
    if not gone:
        return out
    causes = _known_problems(ctx)
    for r in gone:
        monthly = r["clicks_before"] * 30 / rules.GONE_BEFORE_DAYS
        last = ctx.fetch("SELECT MAX(day) d FROM gsc_page WHERE site_id = :s AND page_hash = :h AND impressions > 0", h=r["key"])
        out.findings.append(Finding(
            "dropped_out", "changed", r["page"], page=r["page"], at_stake=monthly, severity="big" if monthly >= rules.GONE_BIG_CLICKS else "normal",
            evidence={
                "path": _path(r["page"]), "clicks_before": r["clicks_before"], "impressions_before": r["impressions_before"], "position_before": rnd(r["position_before"]),
                "last_seen": last[0]["d"].isoformat() if last and last[0]["d"] else None, "days": rules.GONE_DAYS, "causes": causes.get(_path(r["page"]), []),
            },
        ).settle())
    return out


def _known_problems(ctx: Ctx) -> dict[str, list]:
    """What the last health test and Links Checker said about each page, by path: noindex, an error, a redirect."""
    found: dict[str, list] = {}

    def add(url, code):
        if isinstance(url, dict):
            url = url.get("url") or url.get("page")
        if isinstance(url, str):
            found.setdefault(_path(url), [])
            if code not in found[_path(url)]:
                found[_path(url)].append(code)

    for row in ctx.fetch(
        "SELECT i.code, i.pages FROM health_issues i JOIN (SELECT MAX(id) id FROM health_audits WHERE site_id = :s AND status = 'complete') last ON last.id = i.audit_id "
        "WHERE i.code IN ('broken_pages', 'server_errors', 'noindex', 'canonical_elsewhere', 'almost_no_text')"
    ):
        pages = row["pages"] if isinstance(row["pages"], list) else json.loads(row["pages"] or "[]")
        for url in pages:
            add(url, row["code"])
    for row in ctx.fetch(
        "SELECT i.category, i.target_url, i.status_code FROM link_issues i JOIN (SELECT MAX(id) id FROM link_scans WHERE site_id = :s AND status = 'complete') last ON last.id = i.scan_id "
        "WHERE i.category IN ('broken', 'redirect')"
    ):
        add(row["target_url"], f"link_{row['category']}")
    return found
