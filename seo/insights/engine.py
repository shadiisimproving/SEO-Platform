"""Runs every detector for one site and keeps what they find between runs.

- It runs after a Search Console pull, only when a new final day arrived (about once a day per site), on the collectors lane.
- A finding seen again is updated, never repeated. One not seen any more is marked gone ("went away by itself"), but only if
  its detector really ran: a detector that couldn't (too little history, no brand words) leaves its findings alone.
- "Not useful" hides a finding until its clicks at stake reach twice what they were. A task made from a finding carries its
  key, so a done task marks the finding done.
- Big drops raise one app alert each, cleared when the drop goes away. Nothing is ever sent outside the app.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date

from sqlalchemy import Engine, bindparam, text

from seo.insights import aio, data, decline, impact, mix, movement, onpage, rules, technical, value, wins
from seo.insights.finding import Finding, Result
from seo.worker import queue
from seo.worker.runner import handler

LANE = "collectors"
ALERT_KIND = "search_drop"
log = logging.getLogger(__name__)


def detect(ctx: data.Ctx) -> Result:
    total = Result()

    def take(result: Result) -> None:
        total.findings += result.findings
        total.ran |= result.ran
        total.needs.update(result.needs)

    # A. What changed
    take(movement.breakdown(ctx))
    take(movement.brand_split(ctx))
    for f in total.findings:  # the brand and non-brand numbers go on the breakdown too, for its panel
        if f.kind == "change" and ctx.brand_numbers:
            f.evidence["brand"] = ctx.brand_numbers
    take(movement.odd_days(ctx))
    gone = movement.dropped_out(ctx)
    take(gone)
    gone_pages = {f.page for f in gone.findings}
    take(movement.pages(ctx, gone_pages))  # a page that left Google is said once, as that
    lost = movement.queries_down(ctx)
    take(lost)
    take(movement.segments(ctx))
    # B. Slow decline
    take(decline.decay(ctx))
    # A query that already lost 3 places (or is one of the alike searches of one that did) is said once, as that.
    take(decline.slide(ctx, {q for f in lost.findings for q in (f.query, *(a["query"] for a in f.evidence.get("alike", [])))}))
    # C. Quick wins. Unstable ranking is one: a chance to win if it settled at its better days (it was under What changed).
    take(movement.unstable(ctx))
    take(wins.wins(ctx))
    take(wins.page_near(ctx))
    take(wins.no_page(ctx))
    take(wins.questions(ctx))
    take(wins.topics(ctx))
    take(wins.worth_tracking(ctx))
    # Rank and clicks: saved rank checks joined with Search Console
    take(mix.signals(ctx))
    # E. Technical
    take(technical.duplicates(ctx))
    take(technical.shown_broken(ctx, gone_pages))
    take(technical.data_gaps(ctx))
    # Where Google shows an AI Overview, the click-rate curve's clicks are fewer: lowered here, before leads copy them.
    aio.lower_stakes(ctx.engine, ctx.site_id, total.findings)
    # B3 labels the drops found above, before D copies their numbers.
    take(decline.seasonal(ctx, total.findings))
    # D. Leads, from the findings so far
    take(value.leads(ctx, total.findings))
    # F. Did it work
    take(impact.results(ctx))
    # What the page itself says about the search: in its title, its H1?
    onpage.add(ctx.engine, total.findings)
    return total


def run(engine: Engine, site_id: int) -> dict:
    started = time.monotonic()
    ctx = data.load(engine, site_id)
    if ctx is None:
        _record(engine, site_id, None, started, {"no_data": True})
        return {"site_id": site_id, "no_data": True}
    result = detect(ctx)
    counts = _save(engine, ctx, result)
    _alerts(engine, ctx)
    queue_rivals(engine, site_id)
    counts["needs"] = result.needs
    _record(engine, site_id, ctx.end, started, counts)
    return {"site_id": site_id, "data_through": ctx.end.isoformat(), **counts}


def _record(engine: Engine, site_id: int, through: date | None, started: float, counts: dict, error: str | None = None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO search_finding_runs (site_id, data_through, seconds, counts, error) VALUES (:s, :d, :t, :c, :e)"),
            {"s": site_id, "d": through, "t": round(time.monotonic() - started, 2), "c": json.dumps(counts), "e": error},
        )
        conn.execute(text("DELETE FROM search_finding_runs WHERE site_id = :s AND ran_at < UTC_TIMESTAMP(3) - INTERVAL 90 DAY"), {"s": site_id})


def _task_states(conn, keys: list[str]) -> dict[str, tuple[str, object]]:
    """The newest task made from each finding: todo, doing or done, and when it last changed."""
    if not keys:
        return {}
    statement = text(
        "SELECT JSON_UNQUOTE(JSON_EXTRACT(source, '$.key')) k, status, updated_at FROM tasks WHERE deleted_at IS NULL "
        "AND JSON_UNQUOTE(JSON_EXTRACT(source, '$.type')) = 'search' AND JSON_UNQUOTE(JSON_EXTRACT(source, '$.key')) IN :keys ORDER BY id"
    ).bindparams(bindparam("keys", expanding=True))
    return {row["k"]: (row["status"], row["updated_at"]) for row in conn.execute(statement, {"keys": keys}).mappings().all()}


def _task_for_now(task: tuple | None, appeared) -> str | None:
    """A done task counts only for the appearance it was done in: a drop that went away and came back is new work (F109)."""
    if task is None:
        return None
    status, changed = task
    if status == "done" and appeared is not None and changed is not None and changed < appeared:
        return None
    return status


def _status(old: dict | None, finding: Finding, task: str | None) -> tuple[str, float | None]:
    if task == "done":
        return "done", None
    if task in ("todo", "doing"):
        return "open", None
    if old and old["status"] == "dismissed":
        comes_back = old["dismissed_stake"] is not None and finding.at_stake > 0 and finding.at_stake >= old["dismissed_stake"] * rules.DISMISS_COMES_BACK
        return ("open", None) if comes_back else ("dismissed", old["dismissed_stake"])
    if old and old["status"] == "done":
        return "open", None  # its task was deleted or reopened, and the finding is still there
    return "open", None


def _save(engine: Engine, ctx: data.Ctx, result: Result) -> dict:
    site_id = ctx.site_id
    seen = {}
    for finding in result.findings:
        seen[finding.key(site_id)] = finding  # the last one wins if a detector said the same thing twice
    with engine.begin() as conn:
        old = {row["finding_key"]: row for row in conn.execute(text("SELECT id, finding_key, kind, status, dismissed_stake, first_seen FROM search_findings WHERE site_id = :s"), {"s": site_id}).mappings().all()}
        tasks = _task_states(conn, list(seen) + list(old))
        now = conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar()
        added = updated = 0
        for key, finding in seen.items():
            before = old.get(key)
            back = before is not None and before["status"] == "gone"  # it went away and came back: a new appearance
            appeared = now if before is None or back else before["first_seen"]
            status, dismissed = _status(before, finding, _task_for_now(tasks.get(key), appeared))
            values = {
                "s": site_id, "k": finding.kind, "g": finding.grp, "key": key, "q": (finding.query or None) and finding.query[:500], "p": finding.page,
                "v": finding.severity, "a": finding.at_stake, "e": json.dumps(finding.evidence, ensure_ascii=False, default=str), "st": status, "ds": dismissed, "d": ctx.end,
            }
            if before is None:
                conn.execute(
                    text("INSERT INTO search_findings (site_id, kind, grp, finding_key, query, page, severity, at_stake, evidence, status, dismissed_stake, data_through) VALUES (:s, :k, :g, :key, :q, :p, :v, :a, :e, :st, :ds, :d)"),
                    values,
                )
                added += 1
            else:
                conn.execute(
                    text(
                        "UPDATE search_findings SET grp = :g, severity = :v, at_stake = :a, evidence = :e, status = :st, dismissed_stake = :ds, data_through = :d, "
                        "last_seen = UTC_TIMESTAMP(3), gone_at = NULL, page = :p, first_seen = IF(:back, UTC_TIMESTAMP(3), first_seen) WHERE id = :i"
                    ),
                    {**values, "i": before["id"], "back": back},
                )
                updated += 1
        vanished = [row["id"] for key, row in old.items() if key not in seen and row["kind"] in result.ran and row["status"] in ("open", "done")]
        if vanished:
            conn.execute(text("UPDATE search_findings SET status = 'gone', gone_at = UTC_TIMESTAMP(3) WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)), {"ids": vanished})
        conn.execute(text(f"DELETE FROM search_findings WHERE site_id = :s AND status = 'gone' AND gone_at < UTC_TIMESTAMP(3) - INTERVAL {rules.GONE_KEPT_DAYS} DAY"), {"s": site_id})
    return {"added": added, "updated": updated, "gone": len(vanished), "ran": sorted(result.ran)}


def queue_rivals(engine: Engine, site_id: int) -> int | None:
    """Who passed me (seo/competitors/rival_changes.py): once the findings are saved, one look is queued for the site when an open
    rival_passed or rank_drop finding is on page 1. Never breaks the run: a queue or import error is logged and the run goes on."""
    try:
        from seo.competitors import rival_changes  # imported here: the competitors code reads this package's neighbours

        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT kind, evidence FROM search_findings WHERE site_id = :s AND status = 'open' AND kind IN ('rival_passed', 'rank_drop')"), {"s": site_id}
            ).mappings().all()
        if not any(rival_changes.applies(r["kind"], rival_changes._evidence(r)) for r in rows):
            return None
        return rival_changes.enqueue_for_site(engine, site_id)
    except Exception:  # noqa: BLE001 - the insights run is saved already; the rival look waits for the next run
        log.exception("couldn't queue the rival look for site %s", site_id)
        return None


# ---- Alerts: the big drops only ------------------------------------------------------------------


def _alert_title(row) -> str:
    evidence = row["evidence"] if isinstance(row["evidence"], dict) else json.loads(row["evidence"] or "{}")
    if row["kind"] == "dropped_out":
        return f"{evidence.get('path')} dropped out of Google"
    if row["kind"] == "page_down":
        return f"{evidence.get('path')}: −{abs(evidence.get('percent') or 0)}% Google clicks"  # Today reads the old wording too
    if row["kind"] == "odd_day":
        return f"Google clicks fell on {evidence.get('day')}: {evidence.get('clicks')}, usually {round(evidence.get('usual') or 0)}"
    return "Google clicks fell sharply"


def _alerts(engine: Engine, ctx: data.Ctx) -> None:
    """One alert per big open finding. Once someone has seen it, it isn't raised again for the same finding."""
    with engine.begin() as conn:
        big = conn.execute(
            text("SELECT finding_key, kind, evidence, at_stake, first_seen FROM search_findings WHERE site_id = :s AND status = 'open' AND severity = 'big' AND kind IN ('dropped_out', 'page_down', 'odd_day')"),
            {"s": ctx.site_id},
        ).mappings().all()
        raised, raised_at = {}, {}
        for row in conn.execute(
            text("SELECT JSON_UNQUOTE(JSON_EXTRACT(detail, '$.finding_key')) k, acknowledged_at IS NOT NULL seen, created_at FROM alerts WHERE site_id = :s AND kind = :k"), {"s": ctx.site_id, "k": ALERT_KIND}
        ).mappings().all():
            raised[row["k"]] = row["seen"]
            raised_at[row["k"]] = max(raised_at.get(row["k"]) or row["created_at"], row["created_at"])
        wanted = {row["finding_key"] for row in big}
        for row in big:
            if row["finding_key"] in raised:
                if raised_at[row["finding_key"]] >= row["first_seen"]:
                    continue
                # Seen for an earlier appearance of the same drop: this one is new, so it's raised again (F109).
                conn.execute(
                    text("DELETE FROM alerts WHERE site_id = :s AND kind = :k AND JSON_UNQUOTE(JSON_EXTRACT(detail, '$.finding_key')) = :f"),
                    {"s": ctx.site_id, "k": ALERT_KIND, "f": row["finding_key"]},
                )
            detail = {"finding_key": row["finding_key"], "finding": row["kind"], "detail": f"~{round(row['at_stake'])} clicks/month at stake"}  # the row's Open goes to Insights
            conn.execute(
                text("INSERT INTO alerts (site_id, kind, severity, title, detail) VALUES (:s, :k, 'crit', :t, :d)"),
                {"s": ctx.site_id, "k": ALERT_KIND, "t": _alert_title(row)[:300], "d": json.dumps(detail, ensure_ascii=False)},
            )
        stale = [key for key, seen in raised.items() if key not in wanted and not seen]
        if stale:
            conn.execute(
                text("DELETE FROM alerts WHERE site_id = :s AND kind = :k AND acknowledged_at IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(detail, '$.finding_key')) IN :keys").bindparams(bindparam("keys", expanding=True)),
                {"s": ctx.site_id, "k": ALERT_KIND, "keys": stale},
            )


# ---- When it runs --------------------------------------------------------------------------------


def _last_final_day(engine: Engine, site_id: int) -> date | None:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT MAX(day) FROM gsc_daily WHERE site_id = :s AND day < COALESCE((SELECT fresh_from FROM site_sources WHERE site_id = :s AND source = 'gsc'), '9999-12-31')"),
            {"s": site_id},
        ).scalar()


def enqueue_if_new(engine: Engine, site_id: int) -> int | None:
    """After a finished Search Console pull: queue a run only when a new final day arrived since the last one."""
    newest = _last_final_day(engine, site_id)
    if newest is None:
        return None
    with engine.connect() as conn:
        last = conn.execute(text("SELECT MAX(data_through) FROM search_finding_runs WHERE site_id = :s AND error IS NULL"), {"s": site_id}).scalar()
    if last is not None and last >= newest:
        return None
    return enqueue(engine, site_id)


def enqueue(engine: Engine, site_id: int) -> int | None:
    return queue.enqueue(engine, LANE, "insights", {"site_id": site_id}, dedupe_key=f"insights|{site_id}")


@handler("insights")
def run_job(job: queue.ClaimedJob, engine: Engine) -> None:
    started = time.monotonic()
    try:
        run(engine, job.payload["site_id"])
    except Exception as exc:  # one bad run shouldn't stop the lane; it's recorded and the next new day tries again
        _record(engine, job.payload["site_id"], None, started, {}, f"{type(exc).__name__}: {exc}"[:500])
        raise
