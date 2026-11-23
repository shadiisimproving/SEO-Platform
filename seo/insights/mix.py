"""Rank and clicks: saved rank checks joined with Search Console, for what neither can say alone.

Search Console gives real demand and clicks, but a 28-day average position across every searcher. A rank check gives today's
place and who is above it, but one desktop search from one place. So:

- Positions are compared only in the country the check really ran from. No country numbers, no comparison.
- A check is only compared with an earlier one of the same tool, location and depth.
- Beyond the depth checked is unknown, not a drop, unless Search Console's average sat well inside that depth.
- A drop seen in one check alone is marked to check, and stays out of the totals.

It reads what is saved and spends no search credits. Each keyword is said once, as its strongest signal.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import bindparam, text

from seo.insights import rules
from seo.insights.data import Ctx, rnd, split
from seo.insights.finding import Finding, Result
from seo.metrics import countries
from seo.serp import store

GROUP = "mix"
# Strongest first, for a keyword with several signals worth the same.
KINDS = ("rank_drop", "rival_passed", "rank_no_click", "page_switch", "striking", "rival_gap", "rank_rise", "no_demand")
_ORDER = {kind: at for at, kind in enumerate(KINDS)}
JUST_HAPPENED = frozenset({"rank_drop", "rival_passed"})
TOP_SHOWN = 10  # results kept on a finding, for its panel


@dataclass
class Keyword:
    text: str
    keyword_id: int
    main: dict
    ai: dict
    code3: str | None
    local: dict | None  # Search Console in the country the check ran from
    world: dict | None
    pages: dict = field(default_factory=dict)  # page → clicks, last 28 days
    results: list = field(default_factory=list)  # (position, url, host), best first
    before: list | None = None  # the same, from the previous like-for-like check; None when there isn't one
    disputed: bool = False  # another tool's check of the same 48 hours puts me far from this one (rankings' "Tools disagree")
    before_at: object = None  # when that previous check ran

    @property
    def p(self) -> int | None:
        return self.main["p"]

    @property
    def depth(self) -> int:
        return self.main["depth"]

    @property
    def age(self) -> float:
        return self.main["age_days"]

    @property
    def demand(self) -> dict | None:
        return self.local or self.world


def _key(words: str, shared=frozenset()) -> tuple:
    """The same matching as Keywords (store.match_key): every spelling of a keyword tracked once, its exact query when two are."""
    return store.match_key(words, shared)


def _add(table: dict, key, clicks: int, shown: int, weighted: float | None) -> None:
    """Spellings that clean to the same words are one search, so their numbers add up."""
    slot = table.setdefault(key, {"clicks": 0, "impressions": 0, "weighted": 0.0})
    slot["clicks"] += clicks
    slot["impressions"] += shown
    slot["weighted"] += weighted or 0.0


def _settle(table: dict) -> dict:
    return {key: {"clicks": s["clicks"], "impressions": s["impressions"], "position": s["weighted"] / s["impressions"] if s["impressions"] else None} for key, s in table.items()}


def _search_console(ctx: Ctx, shared=frozenset()) -> tuple[dict, dict, dict]:
    world: dict = {}
    for r in split(ctx, "query", ctx.start, ctx.end):
        _add(world, _key(r["name"], shared), r["clicks"], r["impressions"], r["position"] * r["impressions"] if r["position"] is not None else None)
    local: dict = {}
    for r in ctx.fetch(
        "SELECT country, MAX(query) q, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_query_country "
        "WHERE site_id = :s AND day BETWEEN :a AND :b AND day NOT IN :skip GROUP BY country, query_hash",
        a=ctx.start, b=ctx.end,
    ):
        _add(local, (r["country"], _key(r["q"], shared)), int(r["c"] or 0), int(r["i"] or 0), float(r["w"]) if r["w"] is not None else None)
    pages: dict = {}
    for r in split(ctx, "pair", ctx.start, ctx.end):
        slot = pages.setdefault(_key(r["query"], shared), {})
        slot[r["page"]] = slot.get(r["page"], 0) + r["clicks"]
    return _settle(world), _settle(local), pages


def _previous(ctx: Ctx, main_ids: list[int]) -> dict[int, int]:
    """Each check → the one just before it with the same target, tool, location and depth."""
    if not main_ids:
        return {}
    statement = text(
        "SELECT c.id, c.target_id, c.tool, c.real_location, c.depth FROM serp_checks c "
        "WHERE c.status = 'ok' AND c.target_id IN (SELECT target_id FROM serp_checks WHERE id IN :ids) ORDER BY c.id"
    ).bindparams(bindparam("ids", expanding=True))
    with ctx.engine.connect() as conn:
        rows = conn.execute(statement, {"ids": main_ids}).mappings().all()
    last: dict = {}
    found: dict[int, int] = {}
    wanted = set(main_ids)
    for r in rows:
        kind = (r["target_id"], r["tool"], r["real_location"], r["depth"])
        if r["id"] in wanted and kind in last:
            found[r["id"]] = last[kind]
        last[kind] = r["id"]
    return found


def _results(ctx: Ctx, check_ids: list[int]) -> dict[int, list]:
    if not check_ids:
        return {}
    statement = text("SELECT check_id, position, url, host FROM serp_results WHERE check_id IN :ids ORDER BY check_id, position").bindparams(bindparam("ids", expanding=True))
    found: dict[int, list] = {}
    with ctx.engine.connect() as conn:
        for r in conn.execute(statement, {"ids": check_ids}).mappings().all():
            found.setdefault(r["check_id"], []).append((r["position"], r["url"], r["host"]))
    return found


def _checked_at(ctx: Ctx, check_ids: list[int]) -> dict[int, object]:
    if not check_ids:
        return {}
    statement = text("SELECT id, checked_at FROM serp_checks WHERE id IN :ids").bindparams(bindparam("ids", expanding=True))
    with ctx.engine.connect() as conn:
        return {r["id"]: r["checked_at"] for r in conn.execute(statement, {"ids": check_ids}).mappings().all()}


def _rivals(ctx: Ctx) -> list[str]:
    return [r["host"] for r in ctx.fetch("SELECT c.host FROM site_competitors sc JOIN sites c ON c.id = sc.competitor_id WHERE sc.site_id = :s AND sc.tracking = 'on'")]


def _load(ctx: Ctx) -> list[Keyword]:
    from seo.serp import rankings  # imported here: rankings reads the competitors code, which reads this package's neighbours

    every = rankings.rows_of_site(ctx.engine, ctx.site_id)
    shared = store.shared_keys(r["keyword"] for r in every)  # spellings tracked side by side each keep their own numbers
    rows = [r for r in every if (r["engines"]["google"]["main"] or {}).get("status") == "ok"]
    if not rows:
        return []
    world, local, pages = _search_console(ctx, shared)
    main_ids = [r["engines"]["google"]["main"]["check_id"] for r in rows]
    previous = _previous(ctx, main_ids)
    results = _results(ctx, main_ids + list(previous.values()))
    previous_at = _checked_at(ctx, list(previous.values()))
    found = []
    for r in rows:
        main, key = r["engines"]["google"]["main"], _key(r["keyword"], shared)
        code3 = countries.alpha3(main["location"]) or countries.alpha3(r["country"])
        numbers = local.get((code3, key)) if code3 else None
        before_id = previous.get(main["check_id"])
        found.append(Keyword(
            r["keyword"], r["keyword_id"], main, r["ai"], code3, numbers if numbers and numbers["position"] is not None else None, world.get(key), pages.get(key, {}),
            results.get(main["check_id"], []), results.get(before_id, []) if before_id else None,
            bool(r["engines"]["google"].get("disagree")), previous_at.get(before_id),
        ))
    return found


def _on(rows: list, host: str) -> int | None:
    return next((position for position, _, row_host in rows if store.on_host(row_host, host)), None)


def _rival_rows(k: Keyword, rivals: list[str]) -> list[dict]:
    """Followed rivals above me on this check, best first, with where they were on the previous one."""
    out = []
    for rival in rivals:
        now = _on(k.results, rival)
        if now is None or (k.p is not None and now >= k.p):
            continue
        out.append({"host": rival, "position": now, "before": _on(k.before, rival) if k.before is not None else None})
    return sorted(out, key=lambda r: r["position"])


def _evidence(ctx: Ctx, k: Keyword, rivals: list[str], **extra) -> dict:
    shown = k.demand or {}
    results = [{"position": position, "url": url, "host": host, "mine": store.on_host(host, ctx.host), "rival": any(store.on_host(host, rival) for rival in rivals)} for position, url, host in k.results]
    kept = [row for row in results if row["position"] <= TOP_SHOWN or row["mine"]]
    return {
        "keyword_id": k.keyword_id, "impressions": shown.get("impressions"), "clicks": shown.get("clicks"), "position": rnd(shown.get("position")),
        "scraped": k.p, "depth": k.depth, "tool": k.main["tool"], "location": k.main["location"], "checked": k.main["checked_at"], "age_days": round(k.age, 1),
        "same_country": k.local is not None, "ai": k.ai.get("state"), "rivals": _rival_rows(k, rivals)[:5], "results": kept, **extra,
    }


# ---- who passed me (seo/competitors/rival_changes.py reads their pages) -------------------------------
# Only for this step, a competitor followed for its pages only counts too: its pages are read, its keyword numbers aren't
# shown. The findings above still use competitors that are On, so which findings appear doesn't change.
PASSED_KINDS = frozenset({"rival_passed", "rank_drop"})


def _page_rivals(ctx: Ctx) -> list[str]:
    from seo.competitors.tracking import PAGES_SQL  # imported here: the competitors code reads this package's neighbours

    return [r["host"] for r in ctx.fetch(f"SELECT c.host FROM site_competitors sc JOIN sites c ON c.id = sc.competitor_id WHERE sc.site_id = :s AND {PAGES_SQL}")]


def _above(ctx: Ctx, k: Keyword, followed: list[str]) -> list[dict]:
    """Every result above my page on this check, with where it was on the previous one and whether its site is followed."""
    mine = k.p if k.p is not None else k.depth + 1
    out = []
    for position, url, host in k.results:
        if position >= mine or store.on_host(host, ctx.host):
            continue
        before = next((p for p, u, _ in (k.before or []) if u == url), None)
        out.append({"position": position, "url": url, "host": host, "before": before, "followed": any(store.on_host(host, rival) for rival in followed)})
    return out[:TOP_SHOWN]


def _add_passed(ctx: Ctx, k: Keyword, f: Finding, followed: list[str]) -> None:
    if f.kind not in PASSED_KINDS:
        return
    f.evidence["above"] = _above(ctx, k, followed)
    f.evidence["before_checked"] = k.before_at.strftime("%Y-%m-%dT%H:%M:%SZ") if k.before_at is not None else None
    f.evidence["my_url"] = next((u for _, u, h in k.results if store.on_host(h, ctx.host)), None) or k.main["url"] or None


def _finding(ctx: Ctx, k: Keyword, kind: str, rivals: list[str], at_stake: float = 0.0, severity: str = "normal", page: str | None = None, **extra) -> Finding:
    return Finding(
        kind, GROUP, f"{k.text}|{k.code3 or ''}", at_stake=at_stake, severity=severity, query=k.text, page=page or k.main["url"] or None, evidence=_evidence(ctx, k, rivals, **extra),
    ).settle()


def _moved(ctx: Ctx, k: Keyword, rivals: list[str]) -> Finding | None:
    """Today's place against Search Console's average: the average takes weeks to show what a check sees at once.
    A drop another tool of the same days doesn't see is no drop: the tools disagree, so nothing is said."""
    if k.local is None or k.age > rules.MIX_FRESH_DAYS or k.local["impressions"] < rules.MIX_MIN_IMPRESSIONS:
        return None
    average, shown = k.local["position"], k.local["impressions"]
    was = _on(k.before, ctx.host) if k.before is not None else None
    if average <= rules.MIX_WORST and ((k.p is not None and k.p - average >= rules.MIX_GAP) or (k.p is None and average <= k.depth - rules.MIX_DEPTH_MARGIN)):
        if k.disputed:
            return None
        if k.before is not None and (was is None or (k.p is not None and k.p - was < rules.MIX_CONFIRM_PLACES)):
            return None  # the earlier check saw it just as low: the two sources simply differ here, nothing moved
        confirmed = k.before is not None
        now_place = k.p if k.p is not None else k.depth + 1
        stake = shown * rules.MONTH * max(0.0, ctx.curve.rate(average) - ctx.curve.rate(now_place))
        return _finding(ctx, k, "rank_drop", rivals, stake, "normal" if confirmed else "info", confirmed=confirmed, was=was)
    if k.p is not None and average - k.p >= rules.MIX_GAP:
        if k.before is not None and was is not None and was - k.p < rules.MIX_CONFIRM_PLACES:
            return None
        return _finding(ctx, k, "rank_rise", rivals, 0.0, "info", confirmed=k.before is not None, was=was)
    return None


def _rival_passed(ctx: Ctx, k: Keyword, rivals: list[str]) -> Finding | None:
    """A followed rival now above me that was below me on the previous like-for-like check.

    Not a one-place swap (3 and 4 trading places is noise between two checks): the rival climbed or I fell by at least
    MIX_PASS_PLACES. Not on a search nobody makes (MIX_MIN_IMPRESSIONS). When the rival didn't climb and only I fell, the
    row says so ("you_fell"), so the screen says "You fell below" rather than "passed you" (SEO review 2026-11-17).
    """
    if k.before is None or k.age > rules.MIX_FRESH_DAYS:
        return None
    was = _on(k.before, ctx.host)
    if was is None:
        return None
    shown = (k.demand or {}).get("impressions") or 0
    if shown < rules.MIX_MIN_IMPRESSIONS:
        return None
    now_place = k.p if k.p is not None else k.depth + 1
    fell = now_place - was
    passed = []
    for r in _rival_rows(k, rivals):
        if r["before"] is not None and r["before"] <= was:
            continue  # it was already above me
        climbed = (k.depth + 1 if r["before"] is None else r["before"]) - r["position"]
        if max(climbed, fell) < rules.MIX_PASS_PLACES:
            continue
        passed.append({**r, "you_fell": climbed <= 0})
    if not passed:
        return None
    stake = shown * rules.MONTH * max(0.0, ctx.curve.rate(was) - ctx.curve.rate(now_place))
    return _finding(ctx, k, "rival_passed", rivals, stake, was=was, passed=passed[:3])


def _rival_gap(ctx: Ctx, k: Keyword, rivals: list[str]) -> Finding | None:
    numbers = k.demand
    if k.disputed:  # where I stand isn't settled: two tools of the same days put me far apart
        return None
    if k.age > rules.MIX_USABLE_DAYS or not numbers or numbers["impressions"] < rules.MIX_MIN_IMPRESSIONS or (k.p is not None and k.p <= rules.MIX_RIVAL_ME_PAST):
        return None
    if not any(r["position"] <= rules.MIX_RIVAL_TOP for r in _rival_rows(k, rivals)):
        return None
    stake = numbers["impressions"] * rules.MONTH * ctx.curve.rate(rules.MIX_RIVAL_TARGET) - numbers["clicks"] * rules.MONTH
    return _finding(ctx, k, "rival_gap", rivals, stake, target=rules.MIX_RIVAL_TARGET)


def _striking(ctx: Ctx, k: Keyword, rivals: list[str]) -> Finding | None:
    low, high = rules.MIX_STRIKING
    if k.local is None or k.p is None or k.age > rules.MIX_USABLE_DAYS or k.local["impressions"] < rules.MIX_STRIKING_MIN:
        return None
    average = k.local["position"]
    if not (low <= average <= high and low <= k.p <= high and abs(average - k.p) <= rules.MIX_STRIKING_GAP):
        return None
    stake = k.local["impressions"] * rules.MONTH * ctx.curve.rate(rules.MIX_STRIKING_TARGET) - k.local["clicks"] * rules.MONTH
    return _finding(ctx, k, "striking", rivals, stake, target=rules.MIX_STRIKING_TARGET)


def _no_click(ctx: Ctx, k: Keyword, rivals: list[str]) -> Finding | None:
    if k.local is None or k.p is None or k.age > rules.MIX_USABLE_DAYS or k.local["impressions"] < rules.MIX_NO_CLICK_MIN:
        return None
    average, shown, clicks = k.local["position"], k.local["impressions"], k.local["clicks"]
    usual = ctx.curve.rate(average)
    if k.p > rules.MIX_NO_CLICK_TOP or average > rules.MIX_NO_CLICK_TOP or clicks / shown >= usual * rules.MIX_NO_CLICK_SHARE:
        return None
    return _finding(ctx, k, "rank_no_click", rivals, (shown * usual - clicks) * rules.MONTH, click_rate=round(clicks / shown * 100, 2), expected_rate=round(usual * 100, 2))


def _page_id(url: str) -> str:
    """One page however it's spelled: http or https, www or not, a last slash or not."""
    return (store.canonical_url(url) or url).split("://", 1)[-1].removeprefix("www.").rstrip("/")


def _page_switch(ctx: Ctx, k: Keyword, rivals: list[str]) -> Finding | None:
    if k.disputed:
        return None
    if not k.main["url"] or k.age > rules.MIX_USABLE_DAYS or not k.pages:
        return None
    total = sum(k.pages.values())
    best = max(k.pages, key=k.pages.get)
    if total < rules.MIX_PAGE_MIN_CLICKS or k.pages[best] / total < rules.MIX_PAGE_SHARE:
        return None
    if _page_id(best) == _page_id(k.main["url"]):
        return None
    return _finding(ctx, k, "page_switch", rivals, k.pages[best] * rules.MONTH, ranking_page=k.main["url"], clicked_page=best, share=round(k.pages[best] / total * 100))


def _no_demand(ctx: Ctx, k: Keyword, rivals: list[str]) -> Finding | None:
    if k.world and k.world["impressions"]:
        return None
    return _finding(ctx, k, "no_demand", rivals, 0.0, "info")


CHECKS = (_moved, _rival_passed, _no_click, _page_switch, _striking, _rival_gap, _no_demand)


def signals(ctx: Ctx) -> Result:
    out = Result()
    out.ran.update(KINDS)
    keywords = _load(ctx)
    if not keywords:
        out.needs[GROUP] = "checks"
        return out
    rivals = _rivals(ctx)
    followed = _page_rivals(ctx)
    picked = []
    for k in keywords:
        found = [f for check in CHECKS if (f := check(ctx, k, rivals))]
        if not found:
            continue
        # What just happened comes before where a keyword has long stood, whatever each is worth.
        found.sort(key=lambda f: (f.severity == "info", f.kind not in JUST_HAPPENED, -f.at_stake, _ORDER[f.kind]))
        found[0].evidence["also"] = [f.kind for f in found[1:]]
        _add_passed(ctx, k, found[0], followed)
        picked.append(found[0])
    picked.sort(key=lambda f: -f.at_stake)
    out.findings += picked[: rules.MIX_KEPT]
    return out


def coverage(engine, sites: list[int]) -> dict:
    """How much of the tab rests on real checks: said on top, so a thin list reads as thin data and not as good news."""
    statement = text(
        "SELECT sk.site_id, k.keyword, MAX(c.checked_at) last, UTC_TIMESTAMP(3) now FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id "
        "LEFT JOIN serp_targets t ON t.keyword_id = k.id AND t.engine = 'google' AND t.device = 'desktop' LEFT JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' "
        "WHERE sk.site_id IN :sites GROUP BY sk.site_id, k.id, k.keyword"
    ).bindparams(bindparam("sites", expanding=True))
    searched = text(
        "SELECT q.site_id, q.query FROM gsc_query q JOIN (SELECT site_id, MAX(day) last FROM gsc_query WHERE site_id IN :sites GROUP BY site_id) m ON m.site_id = q.site_id "
        f"WHERE q.day > m.last - INTERVAL {rules.PERIOD_DAYS} DAY AND q.impressions > 0 GROUP BY q.site_id, q.query_hash, q.query"
    ).bindparams(bindparam("sites", expanding=True))
    with engine.connect() as conn:
        rows = conn.execute(statement, {"sites": sites}).mappings().all()
        known = {(r["site_id"], _key(r["query"])) for r in conn.execute(searched, {"sites": sites}).mappings().all()}
    ages = [(r["now"] - r["last"]).total_seconds() / 86400 for r in rows if r["last"] is not None]
    return {
        "tracked": len(rows), "with_search": sum(1 for r in rows if (r["site_id"], _key(r["keyword"])) in known), "checked": len(ages),
        "recent": sum(1 for age in ages if age <= rules.MIX_FRESH_DAYS), "oldest_days": round(max(ages)) if ages else None, "fresh_days": rules.MIX_FRESH_DAYS,
    }
