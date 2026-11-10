"""F. Did it work? For each done task that names pages or keywords, and each dated note on the chart: the 28 days before
against 28 days after, skipping the 7 days just after the change while Google takes it in.

A task done less than 35 days ago is shown as waiting, with the day its result is ready. Numbers are per day averages ×
28, so a partial day left out on one side doesn't tilt the result.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import bindparam, text

from seo.collectors.common import digest
from seo.insights import rules
from seo.insights.data import NEVER, Ctx
from seo.insights.finding import Finding, Result
from seo.metrics.service import _path

SAME_PERCENT, SAME_PLACES = 10, 1.0


def _windows(done: date) -> tuple[tuple[date, date], tuple[date, date]]:
    before = (done - timedelta(days=rules.RESULT_DAYS), done - timedelta(days=1))
    after_from = done + timedelta(days=rules.RESULT_GAP_DAYS)
    return before, (after_from, after_from + timedelta(days=rules.RESULT_DAYS - 1))


def _sum(ctx: Ctx, table: str, column: str | None, hashes: list[str], a: date, b: date) -> dict:
    where = f"AND {column} IN :h" if column else ""
    statement = text(
        f"SELECT COUNT(DISTINCT day) d, COALESCE(SUM(clicks), 0) c, COALESCE(SUM(impressions), 0) i, SUM(position * impressions) w FROM {table} "
        f"WHERE site_id = :s AND day BETWEEN :a AND :b AND day NOT IN :skip {where}"
    ).bindparams(bindparam("skip", expanding=True), *([bindparam("h", expanding=True)] if column else []))
    values = {"s": ctx.site_id, "a": a, "b": b, "skip": ctx.skip or [NEVER]}
    if column:
        values["h"] = hashes
    with ctx.engine.connect() as conn:
        r = conn.execute(statement, values).mappings().first()
    days = max(1, (b - a).days + 1 - sum(1 for d in ctx.skip if a <= d <= b))
    clicks, shown = int(r["c"] or 0), int(r["i"] or 0)
    scale = rules.RESULT_DAYS / days
    return {
        "clicks": round(clicks * scale), "impressions": round(shown * scale), "position": round(float(r["w"]) / shown, 1) if shown and r["w"] is not None else None,
        "click_rate": round(clicks / shown * 100, 2) if shown else None,
    }


def _verdict(before: dict, after: dict) -> str:
    c0, c1 = before["clicks"], after["clicks"]
    p0, p1 = before["position"], after["position"]
    percent = (c1 - c0) / c0 * 100 if c0 else (100 if c1 else 0)
    places = (p0 - p1) if p0 is not None and p1 is not None else 0  # positive: moved up
    if abs(percent) < SAME_PERCENT and abs(places) < SAME_PLACES:
        return "same"
    if percent >= SAME_PERCENT or (abs(percent) < SAME_PERCENT and places >= SAME_PLACES):
        return "better"
    return "worse"


def _page_hashes(ctx: Ctx, pages: list[str]) -> list[str]:
    """Search Console's addresses for what the task names: a full address as is, a path matched to the site's own pages."""
    wanted = {_path(p) for p in pages if p}
    if not wanted:
        return []
    known = ctx.memo.get("all_pages")
    if known is None:
        known = ctx.memo["all_pages"] = {r["page"] for r in ctx.fetch("SELECT DISTINCT page FROM gsc_page WHERE site_id = :s AND day > :a", a=ctx.end - timedelta(days=rules.RESULT_LOOK_BACK + 60))}
    return sorted({digest(page) for page in known if _path(page) in wanted} | {digest(p) for p in pages if p and "://" in p})


def results(ctx: Ctx) -> Result:
    out = Result()
    out.ran.add("task_result")
    oldest = ctx.end - timedelta(days=rules.RESULT_LOOK_BACK)
    tasks = ctx.fetch(
        "SELECT id, title, pages, keywords, completed_at FROM tasks WHERE site_id = :s AND status = 'done' AND deleted_at IS NULL AND completed_at IS NOT NULL AND completed_at >= :o",
        o=oldest,
    )
    for task in tasks:
        pages = task["pages"] if isinstance(task["pages"], list) else json.loads(task["pages"] or "[]")
        keywords = task["keywords"] if isinstance(task["keywords"], list) else json.loads(task["keywords"] or "[]")
        if not pages and not keywords:
            continue
        done = task["completed_at"].date()
        (b0, b1), (a0, a1) = _windows(done)
        evidence = {"task_id": task["id"], "title": task["title"], "done": done.isoformat(), "pages": pages[:5], "keywords": keywords[:5]}
        if a1 > ctx.end:
            out.findings.append(Finding("task_result", "impact", f"task:{task['id']}", page=pages[0] if pages else None, query=keywords[0] if keywords else None, severity="info",
                                        evidence={**evidence, "ready": False, "ready_on": (a1 + timedelta(days=1)).isoformat()}))
            continue
        if pages:
            hashes = _page_hashes(ctx, pages)
            table, column = "gsc_page", "page_hash"
        else:
            hashes = sorted({digest(k.strip()) for k in keywords if k and k.strip()} | {digest(k.strip().lower()) for k in keywords if k and k.strip()})
            table, column = "gsc_query", "query_hash"
        if not hashes:
            continue
        before, after = _sum(ctx, table, column, hashes, b0, b1), _sum(ctx, table, column, hashes, a0, a1)
        out.findings.append(Finding(
            "task_result", "impact", f"task:{task['id']}", page=pages[0] if pages else None, query=None if pages else keywords[0], severity="info",
            evidence={**evidence, "ready": True, "on": "pages" if pages else "keywords", "before": before, "after": after, "verdict": _verdict(before, after),
                      "from": b0.isoformat(), "to": a1.isoformat(), "after_from": a0.isoformat()},
        ))
    # Notes on the chart: the whole site, the same windows.
    for note in ctx.fetch("SELECT id, day, text FROM search_notes WHERE site_id = :s AND day >= :o", o=oldest):
        (b0, b1), (a0, a1) = _windows(note["day"])
        evidence = {"note_id": note["id"], "title": note["text"], "done": note["day"].isoformat()}
        if a1 > ctx.end:
            out.findings.append(Finding("note_result", "impact", f"note:{note['id']}", severity="info", evidence={**evidence, "ready": False, "ready_on": (a1 + timedelta(days=1)).isoformat()}))
            continue
        before, after = _sum(ctx, "gsc_daily", None, [], b0, b1), _sum(ctx, "gsc_daily", None, [], a0, a1)
        out.findings.append(Finding("note_result", "impact", f"note:{note['id']}", severity="info",
                                    evidence={**evidence, "ready": True, "on": "site", "before": before, "after": after, "verdict": _verdict(before, after), "from": b0.isoformat(), "to": a1.isoformat(), "after_from": a0.isoformat()}))
    out.ran.add("note_result")
    return out
