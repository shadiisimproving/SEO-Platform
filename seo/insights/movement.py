"""A. What changed, and why: the change breakdown, odd days, pages losing or gaining, pages that dropped out of Google."""
from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import bindparam, text

from seo.collectors.common import digest
from seo.insights import rules, words
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
        effect = effect_of(ctx.curve, c0, i0, c1, i1, r["position_before"], r["position"])
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
            "days": ctx.days_in(ctx.start, ctx.end), "curve": "own" if ctx.curve.own else "generic",
        },
    ).settle())
    return out


def effect_of(curve, c0: int, i0: int, c1: int, i1: int, p0: float | None, p1: float | None) -> dict:
    """One search's change in clicks, split so the parts add up to it exactly:

    - demand: more or fewer impressions, at its old click rate
    - ranking: its own old click rate moved as the site's curve moves between the old and the new position, so a search
      clicked more than the curve keeps that edge (a page at 6.5 → 7.9 loses about a quarter of its clicks to ranking)
    - appeal: what's left, at the same position: titles, snippets, an AI Overview
    - new and lost: seen only now, or only before
    """
    if not i0 and not i1:
        return {}
    if not i0:
        return {"new": float(c1)}
    if not i1:
        return {"lost": float(-c0)}
    rate0 = c0 / i0
    demand = (i1 - i0) * rate0
    ranking = 0.0
    if p0 is not None and p1 is not None:
        r0, r1 = curve.rate(p0), curve.rate(p1)
        ranking = i1 * rate0 * (r1 / r0 - 1) if rate0 and r0 else i1 * (r1 - r0)
    return {"demand": demand, "ranking": ranking, "appeal": (c1 - c0) - demand - ranking}


def chance(c0: int, c1: int) -> bool:
    """A change of clicks this small can be noise: counts of clicks vary by about √n on their own."""
    return abs(c1 - c0) < rules.CHANCE_SIGMAS * (c0 + c1) ** 0.5


def _well_measured_fall(p0: float | None, p1: float | None, i0: int, i1: int) -> bool:
    """A position that fell at least a place over many impressions is no accident, however few the clicks."""
    return p0 is not None and p1 is not None and p1 - p0 >= rules.CHANCE_PLACES and min(i0, i1) >= rules.CHANCE_IMPRESSIONS


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
    """The old guess, kept for a page whose searches Google hides entirely: its position, its impressions, or the rest."""
    p0, p1, i0, i1 = r["position_before"], r["position"], r["impressions_before"], r["impressions"]
    if p0 is not None and p1 is not None and abs(p1 - p0) >= rules.PLACES_LOST:
        return "ranking"
    if i0 and (i1 / i0 <= rules.FEWER_SEARCHES or i1 / i0 >= 1 / rules.FEWER_SEARCHES):
        return "demand"
    return "appeal"


# The split's three parts, by the codes the screen already knows: ranking, appeal (click rate), demand (searches).
SPLIT_PARTS = (("ranking", "ranking"), ("click_rate", "appeal"), ("searches", "demand"))


def page_split(ctx: Ctx, rows: list[dict], change: int) -> dict:
    """A page's change in clicks, split over its own searches (gsc_query_page) like the site's change: clicks lost to
    ranking, to the click rate at the same place, and to fewer searches (new and lost searches count there). "other" is
    what Google keeps out of the query tables."""
    parts = {"ranking": 0.0, "click_rate": 0.0, "searches": 0.0}
    for q in rows:
        effect = effect_of(ctx.curve, q["clicks_before"], q["impressions_before"], q["clicks"], q["impressions"], q["position_before"], q["position"])
        parts["ranking"] += effect.get("ranking", 0.0)
        parts["click_rate"] += effect.get("appeal", 0.0)
        parts["searches"] += effect.get("demand", 0.0) + effect.get("new", 0.0) + effect.get("lost", 0.0)
    parts["other"] = change - sum(parts.values())
    return {name: round(value, 1) for name, value in parts.items()}


def _cause(split: dict, change: int) -> str | None:
    """The biggest part pulling the same way as the change; "other" can't be acted on, so it's never the one named."""
    direction = 1 if change >= 0 else -1
    found = [(abs(split[part]), code) for part, code in SPLIT_PARTS if split[part] * direction > 0]
    return max(found)[1] if found else None


def _query_tag(q: dict, page: str, best: dict[str, str]) -> tuple[str | None, str | None]:
    """What happened to one search of the page: new, gone, another page took it, lost places, or fewer clicks at the same place."""
    if not q["impressions_before"]:
        return "new", None
    if not q["impressions"]:
        other = best.get(q["query"])
        return ("other_page", other) if other and other != page else ("gone", None)
    p0, p1 = q["position_before"], q["position"]
    if p0 is not None and p1 is not None and p1 - p0 >= 1:
        return "places", None
    if q["clicks_before"] and p0 is not None and p1 is not None and abs(p1 - p0) < rules.CTR_DROP_PLACES:
        rate0, rate1 = q["clicks_before"] / q["impressions_before"], q["clicks"] / q["impressions"]
        if rate1 <= rate0 * (1 - rules.CTR_DROP_SHARE):
            return "click_rate", None
    return None, None


def _google_answers(ctx: Ctx) -> dict[str, dict]:
    """Google's indexing answer for each of the site's pages (URL Inspection, kept by seo/backlinks/indexed.py)."""
    if "google" not in ctx.memo:
        from seo.backlinks import indexed

        with ctx.engine.connect() as conn:
            ctx.memo["google"] = indexed.for_site(conn, ctx.site_id)
    return ctx.memo["google"]


def _google_for(ctx: Ctx, page: str) -> dict | None:
    from seo.backlinks import indexed

    return _google_answers(ctx).get(indexed.url_hash(page))


def _median_spread(values: list[float], floor: float) -> tuple[float, float]:
    middle = statistics.median(values)
    return middle, max(statistics.median(abs(v - middle) for v in values) * 1.4826, floor)


def since(ctx: Ctx, days: dict[date, dict], by: str) -> str | None:
    """The first day of a fall: the first day the 7-day average (centred) goes past the before period's usual by one spread
    and mostly stays there, then on to the first day in the next three that was itself past it. By clicks, or by position
    when the page fell by ranking (position is far less noisy than a page's few clicks a day)."""
    if not ctx.has_before:
        return None
    skip = set(ctx.skip)
    all_days = [ctx.before_start + timedelta(days=n) for n in range((ctx.end - ctx.before_start).days + 1)]
    all_days = [d for d in all_days if d not in skip]

    def value(d):
        row = days.get(d)
        if by == "position":
            return row["position"] if row and row["impressions"] and row["position"] is not None else None
        return row["clicks"] if row else 0

    raw = {d: value(d) for d in all_days}
    avg = {}
    for i, d in enumerate(all_days):
        window = [raw[x] for x in all_days[max(0, i - 3): i + 4] if raw[x] is not None]
        if len(window) >= 4:
            avg[d] = sum(window) / len(window)
    before = [v for d, v in avg.items() if d <= ctx.before_end and d >= ctx.before_start + timedelta(days=3)]
    if len(before) < 7:
        return None
    if by == "position":
        middle, spread = _median_spread(before, 0.3)
        past = lambda v: v > middle + spread  # noqa: E731 - a bigger number is a worse place
    else:
        middle, spread = _median_spread(before, (statistics.median(before) / 7) ** 0.5)
        past = lambda v: v < middle - spread  # noqa: E731
    first = ctx.start - timedelta(days=rules.SINCE_LOOK_BACK)
    scan = [d for d in all_days if d >= first and d in avg]
    for i, d in enumerate(scan):
        if not past(avg[d]):
            continue
        rest = scan[i:]
        if sum(1 for x in rest if past(avg[x])) < len(rest) * rules.SINCE_HOLD:
            continue
        for ahead in range(4):  # the centred average crosses up to 3 days early: the first day itself past the usual
            day = d + timedelta(days=ahead)
            if raw.get(day) is not None and past(raw[day]):
                return day.isoformat()
        return d.isoformat()
    return None


def _page_days(ctx: Ctx, wanted: list[str]) -> dict[str, dict[date, dict]]:
    """Each page's days, both periods: clicks, impressions, position."""
    found: dict[str, dict] = {}
    if not wanted or not ctx.has_before:
        return found
    hashes = {digest(page): page for page in wanted}
    statement = text(
        "SELECT page_hash h, day, clicks, impressions, position FROM gsc_page WHERE site_id = :s AND day BETWEEN :a AND :b AND page_hash IN :hashes"
    ).bindparams(bindparam("hashes", expanding=True))
    with ctx.engine.connect() as conn:
        for r in conn.execute(statement, {"s": ctx.site_id, "a": ctx.before_start, "b": ctx.end, "hashes": list(hashes)}).mappings():
            found.setdefault(hashes[r["h"]], {})[r["day"]] = {"clicks": int(r["clicks"] or 0), "impressions": int(r["impressions"] or 0), "position": float(r["position"]) if r["position"] is not None else None}
    return found


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
    best = _best_pages(ctx)
    days = _page_days(ctx, [r["page"] for r in moved if r["clicks"] < r["clicks_before"]])
    for r in moved:
        change = r["clicks"] - r["clicks_before"]
        percent = round(change / r["clicks_before"] * 100) if r["clicks_before"] else None
        down = change < 0
        mine = queries.get(r["page"], [])
        split_ = page_split(ctx, mine, change)
        why = _cause(split_, change) if mine else None
        why = why or _why(r)
        google = _google_for(ctx, r["page"])
        if down and google and google["state"] == "not_indexed":
            why = "not_indexed"  # Google says it isn't in its index: that beats every other cause
        behind = []
        for q in sorted((q for q in mine if (q["clicks"] - q["clicks_before"]) * change > 0), key=lambda q: -abs(q["clicks"] - q["clicks_before"]))[: rules.PAGE_QUERIES]:
            tag, other = _query_tag(q, r["page"], best)
            behind.append({**q, "tag": tag, **({"other_page": other} if other else {})})
        big = down and percent is not None and percent <= -rules.PAGE_BIG_PERCENT and -change >= rules.PAGE_BIG_CLICKS
        evidence = {
            "path": _path(r["page"]), "clicks": r["clicks"], "clicks_before": r["clicks_before"], "percent": percent,
            "impressions": r["impressions"], "impressions_before": r["impressions_before"], "position": rnd(r["position"]), "position_before": rnd(r["position_before"]),
            "why": why, "split": split_, "queries": behind,
        }
        if google:
            evidence["google"] = google
        if down:
            evidence["since"] = since(ctx, days.get(r["page"], {}), "position" if why == "ranking" else "clicks")
            uncertain = chance(r["clicks_before"], r["clicks"]) and not _well_measured_fall(r["position_before"], r["position"], r["impressions_before"], r["impressions"])
            if uncertain:
                evidence["uncertain"] = True
            severity = "info" if uncertain else "big" if big else "normal"
            out.findings.append(Finding("page_down", "changed", r["page"], page=r["page"], at_stake=-change * rules.MONTH, severity=severity, evidence=evidence).settle())
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
            "query": row["query"], "clicks": int(row["c"] or 0), "clicks_before": int(row["pc"] or 0), "impressions": shown, "impressions_before": before,
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


# ---- A4. Queries losing places -------------------------------------------------------------------


def _best_pages(ctx: Ctx) -> dict[str, str]:
    """The page that ranks for each query now: the one with the most impressions over the period."""
    if "best_pages" not in ctx.memo:
        best: dict[str, tuple[int, str]] = {}
        for r in split(ctx, "pair", ctx.start, ctx.end):
            if r["impressions"] and r["impressions"] > best.get(r["query"], (0, ""))[0]:
                best[r["query"]] = (r["impressions"], r["page"])
        ctx.memo["best_pages"] = {query: page for query, (_, page) in best.items()}
    return ctx.memo["best_pages"]


def queries_down(ctx: Ctx) -> Result:
    """Searches losing clicks, while they still show:

    - query_down: it dropped at least 3 places, or it fell out of the top 3; the clicks its old place would bring now, at
      today's impressions, are what's at stake.
    - ctr_drop: fewer clicks at the same position (the click rate fell 30% or more, the place moved under 1): the main sign
      of a new AI Overview or a richer page of results. What's at stake is today's impressions at the old click rate.

    A drop of clicks small enough to be chance is said, marked uncertain, and kept out of the totals. Near-identical searches
    (the same words, in any order, plural or not) that the same page ranks for become one row: "query + N alike"."""
    out = Result()
    if not ctx.has_before:
        out.needs.update(query_down="history", ctr_drop="history")
        return out
    out.ran.update({"query_down", "ctr_drop"})
    pages = _best_pages(ctx)
    found: dict[str, list] = {"query_down": [], "ctr_drop": []}
    for r in split(ctx, "query", ctx.start, ctx.end, ctx.before_start, ctx.before_end):
        p1, p0, i1, i0, c1, c0 = r["position"], r["position_before"], r["impressions"], r["impressions_before"], r["clicks"], r["clicks_before"]
        if p1 is None or p0 is None or not i1 or min(i0, i1) < rules.QUERY_MIN_IMPRESSIONS or p0 > rules.QUERY_WORST_BEFORE:  # both sides: 2 impressions say nothing (F110)
            continue
        evidence = {
            "clicks": c1, "clicks_before": c0, "impressions": i1, "impressions_before": i0,
            "position": rnd(p1), "position_before": rnd(p0), "places": rnd(p1 - p0), "page": pages.get(r["name"]), "tracked": _tracked(ctx, r["name"]),
        }
        lost = i1 * max(0.0, ctx.curve.rate(p0) - ctx.curve.rate(p1))
        top3 = p0 <= rules.TOP3_LOST and round(p1) > rules.TOP3_LOST and lost * rules.MONTH >= rules.INFO_BELOW
        if p1 - p0 >= rules.QUERY_PLACES_LOST or top3:
            found["query_down"].append(Finding("query_down", "changed", r["name"], query=r["name"], page=pages.get(r["name"]), at_stake=lost * rules.MONTH, evidence={**evidence, **({"top3_lost": True} if top3 else {})}))
            continue
        if c0 < rules.CTR_DROP_MIN_CLICKS or abs(p1 - p0) >= rules.CTR_DROP_PLACES:
            continue
        rate0, rate1 = c0 / i0, c1 / i1
        if rate1 > rate0 * (1 - rules.CTR_DROP_SHARE):
            continue
        found["ctr_drop"].append(Finding(
            "ctr_drop", "changed", r["name"], query=r["name"], page=pages.get(r["name"]), at_stake=i1 * (rate0 - rate1) * rules.MONTH,
            evidence={**evidence, "click_rate": round(rate1 * 100, 2), "click_rate_before": round(rate0 * 100, 2)},
        ))
    for kind, kept in (("query_down", rules.QUERY_KEPT), ("ctr_drop", rules.CTR_DROP_KEPT)):
        grouped = [_judge(f) for f in _group_alike(found[kind])]
        out.findings += sorted(grouped, key=lambda f: -f.at_stake)[:kept]
    return out


def _judge(f: Finding) -> Finding:
    """Chance or not, then the usual floor. A chance drop is only information: it stays out of the totals and of To do first."""
    e = f.evidence
    if chance(e["clicks_before"], e["clicks"]) and not _well_measured_fall(e["position_before"], e["position"], e["impressions_before"], e["impressions"]):
        e["uncertain"] = True
        f.severity = "info"
    return f.settle()


def _group_alike(found: list[Finding]) -> list[Finding]:
    """Searches with the same meaningful words (seo/insights/words.tokens: case, accents, order, plurals, years left out)
    ranked by the same page: one finding, led by the biggest, with their figures summed and each listed under "alike".
    The same words on different pages is another thing, said by "Two pages compete" (wins.compete)."""
    groups: dict[tuple, list[Finding]] = {}
    alone = []
    for f in found:
        key = frozenset(words.tokens(f.query or ""))
        if not key or not f.page:
            alone.append(f)
            continue
        groups.setdefault((f.page, key), []).append(f)
    for members in groups.values():
        if len(members) == 1:
            alone.append(members[0])
            continue
        members.sort(key=lambda f: (-f.at_stake, len(f.query or ""), f.query or ""))  # ties: the shortest wording leads
        lead = members[0]
        e = lead.evidence
        own = {k: e[k] for k in ("clicks", "clicks_before", "impressions", "impressions_before", "position", "position_before")}
        e["alike"] = [{"query": m.query, **{k: m.evidence[k] for k in own}} for m in members]
        for name in ("clicks", "clicks_before", "impressions", "impressions_before"):
            e[name] = sum(m.evidence[name] for m in members)
        for name, shown in (("position", "impressions"), ("position_before", "impressions_before")):
            total = sum(m.evidence[shown] for m in members)
            e[name] = rnd(sum(m.evidence[name] * m.evidence[shown] for m in members) / total) if total else e[name]
        e["places"] = rnd(e["position"] - e["position_before"])
        if "click_rate" in e:
            e["click_rate"] = round(e["clicks"] / e["impressions"] * 100, 2) if e["impressions"] else None
            e["click_rate_before"] = round(e["clicks_before"] / e["impressions_before"] * 100, 2) if e["impressions_before"] else None
        e["top3_lost"] = any(m.evidence.get("top3_lost") for m in members) or None
        if not e["top3_lost"]:
            e.pop("top3_lost")
        lead.at_stake = sum(m.at_stake for m in members)
        alone.append(lead)
    return alone


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


def _weighted_quartiles(points: list[tuple[float, int]]) -> tuple[float, float, float]:
    """The positions a quarter, half and three quarters of its impressions were seen at: a day with 40 views counts 8 times
    a day with 5."""
    ordered = sorted(points)
    total = sum(w for _, w in ordered)
    out, seen, wanted = [], 0, [total * q for q in (0.25, 0.5, 0.75)]
    for position, weight in ordered:
        seen += weight
        while wanted and seen >= wanted[0]:
            out.append(position)
            wanted.pop(0)
    while len(out) < 3:
        out.append(ordered[-1][0])
    return out[0], out[1], out[2]


def unstable(ctx: Ctx) -> Result:
    """A query whose position swings from day to day: Google is trying it at different places. If it settled at its better
    days, it would get the clicks of that place, which is what's at stake. It's a chance to win, so it goes with the quick
    wins. Only with real views: 300 over the 28 days, 5 or more a day on 14 days or more, each day weighted by its views.
    When its clicks are far below what its usual place brings, the clicks are the problem, not the place: it's said as
    "seen, rarely clicked" (no_click) instead, with no swing."""
    out = Result()
    out.ran.add("unstable")
    candidates = ctx.fetch(
        "SELECT query_hash k FROM gsc_query WHERE site_id = :s AND day BETWEEN :a AND :b AND day NOT IN :skip AND impressions > 0 AND position IS NOT NULL "
        "GROUP BY query_hash HAVING SUM(impressions >= :di) >= :d AND SUM(impressions) >= :i",
        a=ctx.start, b=ctx.end, d=rules.UNSTABLE_MIN_DAYS, di=rules.UNSTABLE_DAY_IMPRESSIONS, i=rules.UNSTABLE_MIN_IMPRESSIONS,
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
                slot = days.setdefault(r["k"], {"query": r["query"], "points": [], "clicks": 0, "impressions": 0})
                slot["points"].append((float(r["position"]), int(r["impressions"] or 0)))
                slot["clicks"] += int(r["clicks"] or 0)
                slot["impressions"] += int(r["impressions"] or 0)
    pages = None
    found = []
    for slot in days.values():
        if sum(1 for _, w in slot["points"] if w >= rules.UNSTABLE_DAY_IMPRESSIONS) < rules.UNSTABLE_MIN_DAYS:
            continue
        better, middle, worse = _weighted_quartiles(slot["points"])
        if middle > rules.UNSTABLE_TOP or worse - better < rules.UNSTABLE_SPREAD:
            continue
        if pages is None:
            pages = _best_pages(ctx)
        shown, clicks = slot["impressions"], slot["clicks"]
        usual = shown * ctx.curve.rate(middle)
        base = {"clicks": clicks, "impressions": shown, "position": rnd(middle), "page": pages.get(slot["query"]), "tracked": _tracked(ctx, slot["query"])}
        if clicks < usual * rules.UNSTABLE_NO_CLICK_SHARE:
            found.append(Finding(
                "no_click", "wins", slot["query"], query=slot["query"], page=pages.get(slot["query"]), at_stake=(usual - clicks) * rules.MONTH,
                evidence={**base, "click_rate": round(clicks / shown * 100, 2), "expected_rate": round(ctx.curve.rate(middle) * 100, 2), "from": "unstable"},
            ).settle())
            continue
        gain = max(0.0, shown * ctx.curve.rate(better) - clicks)
        positions = [p for p, _ in slot["points"]]
        found.append(Finding(
            "unstable", "wins", slot["query"], query=slot["query"], page=pages.get(slot["query"]), at_stake=gain * rules.MONTH,
            evidence={**base, "better": rnd(better), "worse": rnd(worse), "best": rnd(min(positions)), "worst": rnd(max(positions)), "days": len(positions)},
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
