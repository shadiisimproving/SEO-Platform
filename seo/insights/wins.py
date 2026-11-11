"""C. Quick wins: queries a small push would pay for, worked out with this site's own click-rate curve."""
from __future__ import annotations

from datetime import timedelta

from seo.insights import rules
from seo.insights.data import Ctx, band_of, market, rnd, split
from seo.insights.finding import Finding, Result
from seo.metrics import search


def _pages_by_query(ctx: Ctx) -> dict[str, list[dict]]:
    by_query: dict[str, list[dict]] = {}
    for r in split(ctx, "pair", ctx.start, ctx.end):
        if r["impressions"]:
            by_query.setdefault(r["query"], []).append(r)
    return by_query


def _candidates(ctx: Ctx) -> tuple[list[dict], dict[str, list[dict]]]:
    """Queries still shown this week, with a position, and the pages that rank for each: what every quick win reads."""
    if "wins" not in ctx.memo:
        recent = {r["k"] for r in ctx.fetch(
            "SELECT DISTINCT query_hash k FROM gsc_query WHERE site_id = :s AND day > :since AND day <= :e AND impressions > 0", since=ctx.end - timedelta(days=rules.WINS_RECENT_DAYS), e=ctx.end,
        )}
        rows = [r for r in split(ctx, "query", ctx.start, ctx.end) if r["impressions"] and r["position"] is not None and r["key"] in recent]
        # In the site's target countries, a query's place is the one its buyers see: "almost on page 1" worldwide can be
        # page 1 in France. The world's numbers are kept beside it.
        local = market(ctx, ctx.start, ctx.end)
        if local:
            for r in rows:
                found = local.get(r["key"])
                if found and found["impressions"] and found["position"] is not None:
                    r["world"] = {"clicks": r["clicks"], "impressions": r["impressions"], "position": r["position"]}
                    r.update(clicks=found["clicks"], impressions=found["impressions"], position=found["position"])
        ctx.memo["wins"] = (rows, _pages_by_query(ctx))
    return ctx.memo["wins"]


def _best(pages: list[dict]) -> str | None:
    return max(pages, key=lambda p: p["impressions"])["page"] if pages else None


def _query_fields(ctx: Ctx, r: dict, pages: list[dict]) -> dict:
    best = max(pages, key=lambda p: p["impressions"])["page"] if pages else None
    return {
        "clicks": r["clicks"], "impressions": r["impressions"], "position": rnd(r["position"]),
        "click_rate": round(r["clicks"] / r["impressions"] * 100, 2) if r["impressions"] else None,
        "page": best, "tracked": search._match(r["name"]) in ctx.tracked, "brand": search.is_brand(r["name"], ctx.brand) if ctx.brand else None,
        **({"countries": ctx.countries, "world_position": rnd(r["world"]["position"]), "world_impressions": r["world"]["impressions"]} if r.get("world") else {}),
    }


def _keep(findings: list[Finding]) -> list[Finding]:
    return sorted(findings, key=lambda f: -f.at_stake)[: rules.WINS_KEPT]


def wins(ctx: Ctx) -> Result:
    out = Result()
    out.ran.update({"almost", "top3", "no_click", "compete"})
    rows, pages = _candidates(ctx)
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


# ---- C6. A page close to page 1 on many queries --------------------------------------------------


def page_near(ctx: Ctx) -> Result:
    """One page with 10 or more queries just past page 1: making that one page better lifts them all."""
    out = Result()
    out.ran.add("page_near")
    rows, _ = _candidates(ctx)
    live = {r["name"] for r in rows}
    target = ctx.curve.rate(rules.ALMOST_TARGET)
    by_page: dict[str, list[dict]] = {}
    for r in split(ctx, "pair", ctx.start, ctx.end):
        if r["position"] is None or r["impressions"] < rules.NEAR_MIN_IMPRESSIONS or r["query"] not in live:
            continue
        if rules.NEAR_BAND[0] <= round(r["position"]) <= rules.NEAR_BAND[1]:
            by_page.setdefault(r["page"], []).append(r)
    found = []
    for page, queries in by_page.items():
        if len(queries) < rules.NEAR_MIN_QUERIES:
            continue
        gain = sum(max(0.0, q["impressions"] * target - q["clicks"]) for q in queries)
        top = sorted(queries, key=lambda q: -q["impressions"])[:10]
        found.append(Finding(
            "page_near", "wins", page, page=page, at_stake=gain * rules.MONTH,
            evidence={
                "path": _path(page), "queries_count": len(queries), "impressions": sum(q["impressions"] for q in queries), "clicks": sum(q["clicks"] for q in queries),
                "target": rules.ALMOST_TARGET, "queries": [{"query": q["query"], "impressions": q["impressions"], "clicks": q["clicks"], "position": rnd(q["position"])} for q in top],
            },
        ).settle())
    out.findings += _keep(found)[: rules.NEAR_KEPT]
    return out


def _path(url: str | None) -> str:
    from seo.insights.movement import _path as path

    return path(url)


# ---- C7. No page of its own ----------------------------------------------------------------------


def _titles(ctx: Ctx, urls: list[str]) -> dict[str, str]:
    """The site's own page titles, where a page reader saved them (competitor pages and the site's own share that table)."""
    from sqlalchemy import bindparam, text

    from seo.competitors.pages import url_hash

    if not urls:
        return {}
    hashes = {url_hash(u): u for u in urls}
    statement = text("SELECT url_hash, title FROM pages WHERE url_hash IN :h AND title IS NOT NULL").bindparams(bindparam("h", expanding=True))
    with ctx.engine.connect() as conn:
        return {hashes[r[0]]: r[1] for r in conn.execute(statement, {"h": list(hashes)}).all()}


def no_page(ctx: Ctx) -> Result:
    """A search with real impressions that only the home page, or a page about something else, ranks for. A page made for it
    is an idea worth writing. Brand searches are left out: the home page is the right answer to those."""
    from seo.insights import words

    out = Result()
    out.ran.add("no_page")
    rows, pages = _candidates(ctx)
    host_words = set(words.tokens(ctx.host.replace(".", " ").replace("-", " ")))
    candidates = []
    for r in rows:
        if r["impressions"] < rules.NO_PAGE_MIN_IMPRESSIONS or (ctx.brand and search.is_brand(r["name"], ctx.brand)):
            continue
        meaning = [w for w in words.tokens(r["name"]) if not words.share([w], host_words)]
        if not meaning:
            continue
        best = _best(pages.get(r["name"], []))
        if best:
            candidates.append((r, best, meaning))
    titles = _titles(ctx, sorted({best for _, best, _ in candidates}))
    target = ctx.curve.rate(rules.NO_PAGE_TARGET)
    found = []
    for r, best, meaning in candidates:
        home = words.is_home(best)
        if home and r["position"] <= rules.NO_PAGE_HOME_TOP:
            continue  # the home page doing well on a search about the site's own trade is doing its job
        if not home and words.share(meaning, words.page_words(best, titles.get(best))):
            continue
        found.append(Finding(
            "no_page", "wins", r["name"], query=r["name"], page=best, at_stake=max(0.0, r["impressions"] * target - r["clicks"]) * rules.MONTH,
            evidence={
                "clicks": r["clicks"], "impressions": r["impressions"], "position": rnd(r["position"]), "page": best, "home": home,
                "title": titles.get(best), "target": rules.NO_PAGE_TARGET, "target_rate": round(target * 100, 2), "words": meaning, "tracked": search._match(r["name"]) in ctx.tracked,
            },
        ).settle())
    out.findings += _keep(found)[: rules.NO_PAGE_KEPT]
    return out


# ---- C8. Question searches -----------------------------------------------------------------------


def questions(ctx: Ctx) -> Result:
    """Searches asked as questions, grouped by the page that ranks: the questions an FAQ on that page should answer."""
    from seo.insights import words

    out = Result()
    out.ran.add("questions")
    rows, pages = _candidates(ctx)
    by_page: dict[str, list[dict]] = {}
    for r in rows:
        if r["impressions"] < rules.QUESTION_MIN_IMPRESSIONS or not words.is_question(r["name"]):
            continue
        best = _best(pages.get(r["name"], []))
        if best:
            by_page.setdefault(best, []).append(r)
    found = []
    for page, asked in by_page.items():
        if len(asked) < rules.QUESTION_MIN_QUERIES:
            continue
        asked.sort(key=lambda q: -q["impressions"])
        found.append(Finding(
            "questions", "wins", page, page=page, severity="info",
            evidence={
                "path": _path(page), "queries_count": len(asked), "impressions": sum(q["impressions"] for q in asked), "clicks": sum(q["clicks"] for q in asked),
                "queries": [{"query": q["name"], "impressions": q["impressions"], "clicks": q["clicks"], "position": rnd(q["position"])} for q in asked[:15]],
            },
        ))
    out.findings += sorted(found, key=lambda f: -f.evidence["impressions"])[: rules.QUESTION_KEPT]
    return out


# ---- C9. Topics ----------------------------------------------------------------------------------


def topics(ctx: Ctx) -> Result:
    """Queries grouped by a word they share, accents and plurals folded. A topic with real demand but no page in the top 10
    for it is flagged; topics already well served aren't findings. Words in most of the site's queries (its city, its trade)
    say nothing and are left out."""
    from seo.insights import words

    out = Result()
    rows, pages = _candidates(ctx)
    rows = [r for r in rows if not (ctx.brand and search.is_brand(r["name"], ctx.brand))]
    if len(rows) < 4 * rules.TOPIC_MIN_QUERIES:
        out.needs["topic"] = "more_data"
        return out
    out.ran.add("topic")
    host_words = set(words.tokens(ctx.host.replace(".", " ").replace("-", " ")))
    by_word: dict[str, list[dict]] = {}
    for r in rows:
        for word in words.tokens(r["name"]):
            if word not in host_words:
                by_word.setdefault(word, []).append(r)
    common = len(rows) * rules.TOPIC_COMMON
    groups = []
    for word, queries in by_word.items():
        shown = sum(q["impressions"] for q in queries)
        if len(queries) < rules.TOPIC_MIN_QUERIES or shown < rules.TOPIC_MIN_IMPRESSIONS or len(queries) > common:
            continue
        groups.append((shown, word, queries))
    groups.sort(key=lambda g: -g[0])
    taken: list[set] = []
    target = ctx.curve.rate(rules.TOPIC_TARGET)
    found = []
    for shown, word, queries in groups:
        keys = {q["key"] for q in queries}
        if any(len(keys & other) >= rules.TOPIC_OVERLAP * min(len(keys), len(other)) for other in taken):
            continue  # "societe" and "creation" over the same queries are one topic
        taken.append(keys)
        position = sum(q["position"] * q["impressions"] for q in queries) / shown
        clicks = sum(q["clicks"] for q in queries)
        by_page: dict[str, list[int]] = {}
        for q in queries:
            for p in pages.get(q["name"], []):
                slot = by_page.setdefault(p["page"], [0, 0])
                slot[0] += p["impressions"]
                slot[1] += p["clicks"]
        best = max(by_page.items(), key=lambda kv: (kv[1][1], kv[1][0]))[0] if by_page else None
        share = round(by_page[best][0] / max(1, sum(v[0] for v in by_page.values())) * 100) if best else None
        biggest = sorted(queries, key=lambda q: -q["impressions"])[:3]
        if position <= rules.TOPIC_WEAK_POSITION or any(q["position"] <= rules.TOPIC_WEAK_POSITION for q in biggest):
            continue  # a page already in the top 10 for one of its main searches is a strong page for it
        label = _as_written(word, sorted(queries, key=lambda q: -q["impressions"]))
        found.append(Finding(
            "topic", "wins", f"topic:{word}", page=best, at_stake=max(0.0, shown * target - clicks) * rules.MONTH,
            evidence={
                "word": word, "label": label, "queries_count": len(queries), "impressions": shown, "clicks": clicks, "position": rnd(position),
                "page": best, "page_share": share, "pages_count": len(by_page), "target": rules.TOPIC_TARGET,
                "queries": [{"query": q["name"], "impressions": q["impressions"], "clicks": q["clicks"], "position": rnd(q["position"])} for q in sorted(queries, key=lambda q: -q["impressions"])[:10]],
            },
        ).settle())
    out.findings += _keep(found)[: rules.TOPIC_KEPT]
    return out


def _as_written(word: str, queries: list[dict]) -> str:
    """The topic's word as people type it ("société", not "societe"): its first spelling in the biggest searches."""
    from seo.insights import words

    for q in queries:
        for raw in q["name"].split():
            if words.tokens(raw) == [word]:
                return raw.strip("?,.!:;\"'()")
    return word


# ---- C10. Worth tracking -------------------------------------------------------------------------


def worth_tracking(ctx: Ctx) -> Result:
    """The biggest non-brand searches that aren't tracked keywords yet. Tracking one checks its rankings on every engine."""
    out = Result()
    out.ran.add("track")
    rows, pages = _candidates(ctx)
    picked = [
        r for r in rows
        if r["impressions"] >= rules.TRACK_MIN_IMPRESSIONS and r["position"] <= rules.TRACK_TOP and search._match(r["name"]) not in ctx.tracked
        and not (ctx.brand and search.is_brand(r["name"], ctx.brand))
    ]
    picked.sort(key=lambda r: -r["impressions"])
    for r in picked[: rules.TRACK_KEPT]:
        out.findings.append(Finding(
            "track", "mix", r["name"], query=r["name"], page=_best(pages.get(r["name"], [])), severity="info",
            evidence={"clicks": r["clicks"], "impressions": r["impressions"], "position": rnd(r["position"]), "tracked": False},
        ))
    return out
