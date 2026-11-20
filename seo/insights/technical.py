"""E. Technical signals in the Search Console data.

- E1, one page shown under several addresses (?utm=, http and https, www, /x and /x/): Google splits its signals between them,
  which points to a canonical or redirect problem.
- E2, a page Google still shows this week that the last health test or Links Checker flags (an error, noindex, a redirect).
- E3, data gaps: days Search Console gave only part of, and a "Matches Search Console" check that found differences.
These have no clicks at stake of their own, so they're ranked after the findings that do, but they're never just information.
"""
from __future__ import annotations

import json
from datetime import timedelta
from urllib.parse import urlsplit

from seo.insights import rules
from seo.insights.data import Ctx, rnd, split
from seo.insights.finding import Finding, Result
from seo.insights.movement import _known_problems, _path


def _one_address(url: str) -> str:
    parts = urlsplit(url or "")
    host = (parts.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    return f"{host}{parts.path.rstrip('/') or '/'}".lower()


def duplicates(ctx: Ctx) -> Result:
    out = Result()
    out.ran.add("duplicate")
    groups: dict[str, list[dict]] = {}
    for r in split(ctx, "page", ctx.start, ctx.end):
        if r["impressions"] >= rules.DUPLICATE_MIN_IMPRESSIONS:
            groups.setdefault(_one_address(r["page"]), []).append(r)
    for address, variants in groups.items():
        if len(variants) < 2:
            continue
        variants.sort(key=lambda r: -r["impressions"])
        main = variants[0]
        out.findings.append(Finding(
            "duplicate", "technical", address, page=main["page"],
            evidence={
                "path": _path(main["page"]), "count": len(variants), "impressions": sum(v["impressions"] for v in variants), "clicks": sum(v["clicks"] for v in variants),
                "variants": [{"page": v["page"], "impressions": v["impressions"], "clicks": v["clicks"], "position": rnd(v["position"])} for v in variants[:8]],
                "kinds": _differences(main["page"], [v["page"] for v in variants[1:]]),
            },
        ))
    return out


def _differences(main: str, others: list[str]) -> list[str]:
    """What tells the addresses apart, so the fix is clear: a query string, http, www or the trailing slash."""
    found = []
    a = urlsplit(main)
    for other in others:
        b = urlsplit(other)
        if a.query != b.query or a.fragment != b.fragment:
            found.append("query")
        if a.scheme != b.scheme:
            found.append("scheme")
        if (a.hostname or "").startswith("www.") != (b.hostname or "").startswith("www."):
            found.append("www")
        if a.path != b.path and a.path.rstrip("/") == b.path.rstrip("/"):
            found.append("slash")
        if a.path != b.path and a.path.lower() == b.path.lower():
            found.append("case")
    return sorted(set(found))


# What makes a page broken for a searcher. "Almost no text" is a content matter, said elsewhere.
BROKEN = ("broken_pages", "server_errors", "noindex", "canonical_elsewhere", "link_broken", "link_redirect", "not_indexed")


def shown_broken(ctx: Ctx, gone: set[str] | None = None) -> Result:
    out = Result()
    out.ran.add("shown_broken")
    problems = _known_problems(ctx)
    if not problems:
        return out
    gone = gone or set()
    recent = ctx.end - timedelta(days=rules.BROKEN_DAYS - 1)
    shown = {r["page"]: r for r in split(ctx, "page", recent, ctx.end) if r["impressions"]}
    month = {r["page"]: r for r in split(ctx, "page", ctx.start, ctx.end)}
    for page, r in shown.items():
        causes = [c for c in problems.get(_path(page), []) if c in BROKEN]
        if not causes or page in gone:
            continue
        clicks = month.get(page, r)["clicks"]
        finding = Finding(
            "shown_broken", "technical", page, page=page, at_stake=clicks * rules.MONTH,
            evidence={"path": _path(page), "causes": causes, "impressions": r["impressions"], "clicks": clicks, "position": rnd(r["position"]), "days": rules.BROKEN_DAYS},
        ).settle()
        finding.severity = "normal"  # a broken page Google shows is worth fixing even with few clicks
        out.findings.append(finding)
    return out


def data_gaps(ctx: Ctx) -> Result:
    out = Result()
    out.ran.add("data_gaps")
    since = ctx.end - timedelta(days=rules.DATA_GAP_DAYS - 1)
    partial = [r["day"].isoformat() for r in ctx.fetch("SELECT day FROM coverage WHERE site_id = :s AND source = 'gsc' AND status = 'partial' AND day BETWEEN :a AND :e ORDER BY day", a=since, e=ctx.end)]
    check = ctx.fetch("SELECT ok, diff, checked_at FROM gsc_verify WHERE site_id = :s ORDER BY id DESC LIMIT 1")
    verify = None
    if check and not check[0]["ok"]:
        diff = check[0]["diff"] if isinstance(check[0]["diff"], dict) else json.loads(check[0]["diff"] or "{}")
        # Only days that differ: those come back right when read again. Query and page tables that differ while every day
        # matches are Google adding up a range its own way, which nothing here can change, so they aren't a finding.
        if diff.get("days"):
            verify = {"days": len(diff["days"]), "queries": len(diff.get("queries") or []), "pages": len(diff.get("pages") or []), "checked_at": check[0]["checked_at"].isoformat() + "Z"}
    if not partial and not verify:
        return out
    out.findings.append(Finding("data_gaps", "technical", "site", evidence={"partial": partial, "verify": verify, "days": rules.DATA_GAP_DAYS}))
    return out
