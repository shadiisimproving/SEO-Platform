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
    # "hidden" is only what's left after the named searches, so it can't be acted on and is never the cause named.
    main = max((n for n in parts if n != "hidden" and parts[n] * direction > 0), key=lambda n: abs(parts[n]), default=None)
    pages, explains = _page_moves(ctx, change)
    out.findings.append(Finding(
        "change", "changed", "site", at_stake=-change * rules.MONTH, severity="info" if steady else "big" if big else "normal",
        evidence={
            "now": now, "before": before, "change": change, "percent": percent, "steady": steady, "main": main,
            "parts": {name: round(value) for name, value in parts.items()}, "movers": top, "pages": pages, "explains": explains,
            "from": ctx.start.isoformat(), "to": ctx.end.isoformat(), "before_from": ctx.before_start.isoformat(), "before_to": ctx.before_end.isoformat(),
            # Totals count every day (as Today and Overview); a day Google's row limit cut short is only left out of the
            # per-search split, with its twin, and what that leaves lands in "hidden".
            "days": (ctx.end - ctx.start).days + 1, "split_left_out": [d.isoformat() for d in ctx.skip if ctx.before_start <= d <= ctx.end],
            "curve": "own" if ctx.curve.own else "generic",
        },
    ).settle())
    return out


def _page_moves(ctx: Ctx, change: int) -> tuple[list[dict], list[dict]]:
    """The pages that moved most, and the ones that explain the change. Page tables hold the clicks of the rare searches
    Google leaves out of its query tables, so they can name a cause where the queries can't."""
    moved = [
        {"page": r["page"], "path": _path(r["page"]), "clicks": r["clicks"], "clicks_before": r["clicks_before"], "change": r["clicks"] - r["clicks_before"]}
        for r in split(ctx, "page", ctx.start, ctx.end, ctx.before_start, ctx.before_end) if r["clicks"] != r["clicks_before"]
    ]
    moved.sort(key=lambda m: (-abs(m["change"]), m["path"]))
    same_way = [m for m in moved if m["change"] * change > 0]
    if not same_way:
        return moved[: rules.CHANGE_PAGES], []
    one = abs(same_way[0]["change"]) >= abs(change) * rules.PAGE_EXPLAINS
    return moved[: rules.CHANGE_PAGES], same_way[:1] if one else same_way[:3]


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


# URL Inspection says the page isn't on Google. "Excluded" (NEUTRAL) counts: crawled or discovered but not indexed, a
# noindex, a 404. Two exclusions are on purpose and no problem: an alternate page with its canonical, and a redirect.
NOT_ON_GOOGLE = (
    "verdict IS NOT NULL AND verdict NOT IN ('PASS', 'PARTIAL') AND error IS NULL "
    "AND COALESCE(coverage, '') NOT LIKE 'Alternate page with proper canonical%' AND COALESCE(coverage, '') NOT LIKE 'Page with redirect%'"
)


def _known_problems(ctx: Ctx) -> dict[str, list]:
    """What the last health test, Links Checker and URL Inspection said about each page, by path: noindex, an error, a
    redirect, not on Google."""
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
    # URL Inspection: Google says the page isn't indexed (expert review 2026-11-17: a dropped page raised nothing here).
    for row in ctx.fetch(f"SELECT url FROM gsc_inspections WHERE site_id = :s AND {NOT_ON_GOOGLE}"):
        add(row["url"], "not_indexed")
    return found


# ---- A4. Queries losing places -------------------------------------------------------------------


def _best_pages(ctx: Ctx) -> dict[str, str]:
    """The page that ranks for each query now: the one with the most impressions over the period."""
    best: dict[str, tuple[int, str]] = {}
    for r in split(ctx, "pair", ctx.start, ctx.end):
        if r["impressions"] and r["impressions"] > best.get(r["query"], (0, ""))[0]:
            best[r["query"]] = (r["impressions"], r["page"])
    return {query: page for query, (_, page) in best.items()}


def queries_down(ctx: Ctx) -> Result:
    """A query that dropped at least 3 places with real impressions, while it still shows: the clicks its old place would
    bring now, at today's impressions, are what's at stake."""
    out = Result()
    if not ctx.has_before:
        out.needs["query_down"] = "history"
        return out
    out.ran.add("query_down")
    pages = None
    found = []
    for r in split(ctx, "query", ctx.start, ctx.end, ctx.before_start, ctx.before_end):
        p1, p0, i1, i0 = r["position"], r["position_before"], r["impressions"], r["impressions_before"]
        if p1 is None or p0 is None or not i1 or min(i0, i1) < rules.QUERY_MIN_IMPRESSIONS or p0 > rules.QUERY_WORST_BEFORE:  # both sides: 2 impressions say nothing (F110)
            continue
        if p1 - p0 < rules.QUERY_PLACES_LOST:
            continue
        if pages is None:
            pages = _best_pages(ctx)
        lost = i1 * max(0.0, ctx.curve.rate(p0) - ctx.curve.rate(p1))
        found.append(Finding(
            "query_down", "changed", r["name"], query=r["name"], page=pages.get(r["name"]), at_stake=lost * rules.MONTH,
            evidence={
                "clicks": r["clicks"], "clicks_before": r["clicks_before"], "impressions": i1, "impressions_before": i0,
                "position": rnd(p1), "position_before": rnd(p0), "places": rnd(p1 - p0), "page": pages.get(r["name"]),
                "tracked": _tracked(ctx, r["name"]),
            },
        ).settle())
    out.findings += sorted(found, key=lambda f: -f.at_stake)[: rules.QUERY_KEPT]
    return out


def _tracked(ctx: Ctx, query: str) -> bool:
    from seo.metrics import search

    return search._match(query) in ctx.tracked


# ---- A6. One country or device carries the change ------------------------------------------------


SEGMENTS = {"device": ("gsc_device", "device"), "country": ("gsc_country", "country")}


def segments(ctx: Ctx) -> Result:
    out = Result()
    if not ctx.has_before:
        out.needs["segment"] = "history"
        return out
    out.ran.add("segment")
    for dim, (table, column) in SEGMENTS.items():
        rows = ctx.fetch(
            f"SELECT {column} k, SUM(IF(day BETWEEN :a AND :b, clicks, 0)) c, SUM(IF(day BETWEEN :ca AND :cb, clicks, 0)) pc, "
            f"SUM(IF(day BETWEEN :a AND :b, impressions, 0)) i, SUM(IF(day BETWEEN :ca AND :cb, impressions, 0)) pi "
            f"FROM {table} WHERE site_id = :s AND day BETWEEN :ca AND :b AND day NOT IN :skip GROUP BY {column}",
            a=ctx.start, b=ctx.end, ca=ctx.before_start, cb=ctx.before_end,
        )
        now = sum(int(r["c"] or 0) for r in rows)
        before = sum(int(r["pc"] or 0) for r in rows)
        change = now - before
        if abs(change) < rules.STEADY_CLICKS:
            continue
        for r in rows:
            c1, c0 = int(r["c"] or 0), int(r["pc"] or 0)
            mine = c1 - c0
            others_before = before - c0
            others_change = change - mine
            if mine * change <= 0 or abs(mine) < rules.SEGMENT_MIN_CLICKS or abs(mine) < abs(change) * rules.SEGMENT_SHARE:
                continue
            if others_before and abs(others_change) > others_before * rules.SEGMENT_OTHERS_STEADY:
                continue
            down = mine < 0
            finding = Finding(
                "segment", "changed", f"{dim}:{r['k']}", at_stake=-mine * rules.MONTH if down else 0.0, severity="normal" if down else "info",
                evidence={
                    "dim": dim, "segment": r["k"], "clicks": c1, "clicks_before": c0, "impressions": int(r["i"] or 0), "impressions_before": int(r["pi"] or 0),
                    "percent": round(mine / c0 * 100) if c0 else None, "site_change": change, "others_change": others_change, "down": down,
                },
            )
            out.findings.append(finding.settle() if down else finding)
            break  # one country or one device carries it; the next one can't
    return out


# ---- A7. Unstable ranking ------------------------------------------------------------------------


def _quartiles(values: list[float]) -> tuple[float, float, float]:
    ordered = sorted(values)
    q = statistics.quantiles(ordered, n=4, method="inclusive")
    return q[0], q[1], q[2]


def unstable(ctx: Ctx) -> Result:
    """A query whose position swings from day to day: Google is trying it at different places. If it settled at its better
    days, it would get the clicks of that place, which is what's at stake."""
    out = Result()
    out.ran.add("unstable")
    candidates = ctx.fetch(
        "SELECT query_hash k FROM gsc_query WHERE site_id = :s AND day BETWEEN :a AND :b AND day NOT IN :skip AND impressions > 0 AND position IS NOT NULL "
        "GROUP BY query_hash HAVING COUNT(*) >= :d AND SUM(impressions) >= :i",
        a=ctx.start, b=ctx.end, d=rules.UNSTABLE_MIN_DAYS, i=rules.UNSTABLE_MIN_IMPRESSIONS,
    )
    keys = [r["k"] for r in candidates]
    if not keys:
        return out
    days: dict[str, dict] = {}
    for chunk in range(0, len(keys), 500):
        statement = text(
            "SELECT query_hash k, query, clicks, impressions, position FROM gsc_query WHERE site_id = :s AND day BETWEEN :a AND :b "
            "AND day NOT IN :skip AND impressions > 0 AND position IS NOT NULL AND query_hash IN :keys"
        ).bindparams(bindparam("skip", expanding=True), bindparam("keys", expanding=True))
        with ctx.engine.connect() as conn:
            for r in conn.execute(statement, {"s": ctx.site_id, "a": ctx.start, "b": ctx.end, "skip": ctx.skip or [NEVER], "keys": keys[chunk: chunk + 500]}).mappings():
                slot = days.setdefault(r["k"], {"query": r["query"], "positions": [], "clicks": 0, "impressions": 0})
                slot["positions"].append(float(r["position"]))
                slot["clicks"] += int(r["clicks"] or 0)
                slot["impressions"] += int(r["impressions"] or 0)
    pages = None
    found = []
    for slot in days.values():
        if len(slot["positions"]) < rules.UNSTABLE_MIN_DAYS:
            continue
        better, middle, worse = _quartiles(slot["positions"])
        if middle > rules.UNSTABLE_TOP or worse - better < rules.UNSTABLE_SPREAD:
            continue
        if pages is None:
            pages = _best_pages(ctx)
        shown = slot["impressions"]
        gain = max(0.0, shown * ctx.curve.rate(better) - slot["clicks"])
        found.append(Finding(
            "unstable", "changed", slot["query"], query=slot["query"], page=pages.get(slot["query"]), at_stake=gain * rules.MONTH,
            evidence={
                "clicks": slot["clicks"], "impressions": shown, "position": rnd(middle), "better": rnd(better), "worse": rnd(worse),
                "best": rnd(min(slot["positions"])), "worst": rnd(max(slot["positions"])), "days": len(slot["positions"]), "tracked": _tracked(ctx, slot["query"]),
            },
        ).settle())
    out.findings += sorted(found, key=lambda f: -f.at_stake)[: rules.UNSTABLE_KEPT]
    return out


# ---- C11. Brand against non-brand ----------------------------------------------------------------


def brand_split(ctx: Ctx) -> Result:
    """Brand searches are people who already know the site. When they rise while the others fall, the total looks fine and
    hides an SEO loss. Said only then; the numbers of both are also kept on the change breakdown."""
    from seo.metrics import search

    out = Result()
    if not ctx.brand:
        out.needs["brand_split"] = "brand_words"
        return out
    if not ctx.has_before:
        out.needs["brand_split"] = "history"
        return out
    out.ran.add("brand_split")
    sums = {"brand": [0, 0, 0, 0], "other": [0, 0, 0, 0]}
    for r in split(ctx, "query", ctx.start, ctx.end, ctx.before_start, ctx.before_end):
        slot = sums["brand" if search.is_brand(r["name"], ctx.brand) else "other"]
        slot[0] += r["clicks"]
        slot[1] += r["clicks_before"]
        slot[2] += r["impressions"]
        slot[3] += r["impressions_before"]
    brand, other = sums["brand"], sums["other"]
    other_change, brand_change = other[0] - other[1], brand[0] - brand[1]
    percent = round(other_change / other[1] * 100) if other[1] else None
    ctx.brand_numbers = {name: {"clicks": s[0], "clicks_before": s[1], "impressions": s[2], "impressions_before": s[3]} for name, s in sums.items()}
    if other_change > -rules.BRAND_HIDES_CLICKS or percent is None or percent > -rules.BRAND_HIDES_PERCENT or brand_change <= 0:
        return out
    out.findings.append(Finding(
        "brand_split", "changed", "site", at_stake=-other_change * rules.MONTH,
        evidence={"brand": ctx.brand_numbers["brand"], "other": ctx.brand_numbers["other"], "percent": percent, "brand_change": brand_change, "other_change": other_change, "words": ctx.brand},
    ).settle())
    return out
