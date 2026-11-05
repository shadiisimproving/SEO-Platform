"""The links checker's rules: which sites may be scanned, running scans, and their history.

The main rule lives here and nowhere else: only a site whose `kind` is `own` can be scanned.
start_scan() checks it, and run_scan_job() checks it again when the job runs. A scan never
holds an address. The start address always comes from the stored site.

Scans start from the button, or once a week through enqueue_due(), which cron runs on hosting.

A scan always reads the whole site, which can take days. So its job works in chunks of about CHUNK_SECONDS and saves
where it got to, then goes back in the queue under the same key, and a killed process only costs the chunk it was in.
When the daily budget runs out, the scan stays running and its job waits for the next day.
"""
from __future__ import annotations

import csv
import io
import json
import time
from typing import Callable

from sqlalchemy import Engine, bindparam, text
from sqlalchemy.exc import OperationalError

from seo.core import budget
from seo.core.errors import Conflict, NotFound, NotOwnSite, Refused, UnknownSite
from seo.crawl.fetch import PoliteFetcher
from seo.crawl.guard import is_public_url
from seo.links import saved_state
from seo.links.checker import CrawlState, ScanResult, run_scan
from seo.links.urls import host_key, normalize_url
from seo.worker import queue
from seo.worker.runner import Retry, RunAgain, handler

OWN, COMPETITOR = "own", "competitor"
LANE = "crawl"
JOB_KIND = "links.scan"
KIND = "links"  # in crawl_states
WEEK_DAYS = 7
SECONDS_PER_PAGE = 3  # the plan's polite gap between requests to one domain
CHUNK_SECONDS = 40  # a job's share of the lane before it saves and goes back in the queue
DATABASE_RETRY_SECONDS = 60
MAX_JOB_ATTEMPTS = 5  # failures in a row with no chunk finished in between. Only the database going away gets this far.
STOP_POLL_SECONDS = 1.0
MOST_PAGE_CHARACTERS_IN_A_ROW = 4_000_000  # a row has to fit in the database's largest packet: 16 MB, at up to 4 bytes a character
LONGEST_ADDRESS_STORED = 16_000  # characters that are sure to fit in a TEXT column
GROUPS = {"broken": "Broken", "unverified": "Could not verify", "redirect": "Redirect chains", "slow": "Slow"}
NOT_OWN_TEXT = "Refused: this is not one of your own websites."
ABANDONED_TEXT = "The worker stopped before this scan finished. Run it again."

fetcher_factory: Callable[[], PoliteFetcher] = PoliteFetcher


def chunk_clock() -> Callable[[], bool]:
    ends = time.monotonic() + CHUNK_SECONDS
    return lambda: time.monotonic() >= ends


time_up_factory: Callable[[], Callable[[], bool]] = chunk_clock


class UnknownScan(NotFound):
    pass


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


# ---- sites ---------------------------------------------------------------------------

def add_site(engine: Engine, address: str, kind: str, is_allowed: Callable[[str], bool] = is_public_url) -> dict:
    if kind not in (OWN, COMPETITOR):
        raise Refused("Say whether this is your own website or a competitor.")
    raw = (address or "").strip()
    if not raw:
        raise Refused("Enter the website's address.")
    if "://" not in raw:
        raw = f"https://{raw}"
    start_url = normalize_url(raw)
    host = host_key(start_url)
    if not start_url or "." not in host or " " in raw:
        raise Refused("That doesn't look like a website address.")
    if not is_allowed(start_url):
        raise Refused("That address isn't a public website.")
    with engine.begin() as conn:
        existing = conn.execute(text("SELECT kind FROM sites WHERE host = :h"), {"h": host}).scalar()
        if existing:
            raise Conflict(f"{host} is already added as {'your own website' if existing == OWN else 'a competitor'}.")
        site_id = conn.execute(
            text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, :k)"), {"h": host, "u": start_url, "k": kind}
        ).lastrowid
    return {"id": site_id, "host": host, "start_url": start_url, "kind": kind}


# Whether a site uses Google or Clarity is one choice, kept in site_sources, where Settings and the collectors read it.
# Google is two sources: a site with Search Console but no GA4 still uses it.
_SOURCE_STEPS = {"google": ("gsc", "ga4"), "clarity": ("clarity",)}


def _steps_turned_off(conn, site_ids: list[int]) -> dict[int, set[str]]:
    if not site_ids:
        return {}
    query = text("SELECT site_id, source FROM site_sources WHERE not_used = 1 AND site_id IN :ids").bindparams(bindparam("ids", expanding=True))
    off: dict[int, set[str]] = {site_id: set() for site_id in site_ids}
    for site_id, source in conn.execute(query, {"ids": site_ids}):
        off[site_id].add(source)
    return {site_id: {step for step, sources in _SOURCE_STEPS.items() if set(sources) <= found} for site_id, found in off.items()}


def _site_dict(row, steps_off: set[str]) -> dict:
    stored = (json.loads(row["setup_not_used"]) if isinstance(row["setup_not_used"], str) else row["setup_not_used"]) or []
    return {
        "id": row["id"],
        "host": row["host"],
        "start_url": row["start_url"],
        "weekly": bool(row["links_weekly"]),
        "max_pages": None,  # a scan always reads the whole site
        "check_external": bool(row["links_check_external"]),
        "setup_not_used": sorted({step for step in stored if step not in _SOURCE_STEPS} | steps_off),
        "last_checked_at": _iso(row["last_checked"]),
        "next_check_at": _iso(row["next_check"]) if row["links_weekly"] else None,
    }


_SITE_SELECT = """
    SELECT s.*, last.at AS last_checked, last.at + INTERVAL 7 DAY AS next_check
    FROM sites s
    LEFT JOIN (SELECT site_id, MAX(created_at) AS at FROM link_scans WHERE status = 'complete' GROUP BY site_id) last
      ON last.site_id = s.id
"""


def own_sites(engine: Engine) -> list[dict]:
    """The only list the screen ever gets. Competitors are not in it."""
    with engine.connect() as conn:
        rows = conn.execute(text(f"{_SITE_SELECT} WHERE s.kind = 'own' ORDER BY s.host")).mappings().all()
        off = _steps_turned_off(conn, [r["id"] for r in rows])
    return [_site_dict(r, off[r["id"]]) for r in rows]


def _require_own(conn, site_id: int):
    row = conn.execute(text("SELECT id, kind, links_check_external FROM sites WHERE id = :i"), {"i": site_id}).mappings().first()
    if row is None:
        raise UnknownSite("That website doesn't exist.")
    if row["kind"] != OWN:
        raise NotOwnSite("The links checker only runs on your own websites.")
    return row


SETUP_STEPS = ("google", "keywords", "competitors", "clarity", "checks")


def update_settings(engine: Engine, site_id: int, weekly=None, check_external=None, setup_not_used=None) -> dict:
    updates = {}
    if setup_not_used is not None:
        if not isinstance(setup_not_used, list) or any(step not in SETUP_STEPS for step in setup_not_used):
            raise Refused("setup_not_used must be a list of setup steps.")
        updates["setup_not_used"] = json.dumps(sorted({step for step in setup_not_used if step not in _SOURCE_STEPS}))
    if weekly is not None:
        if type(weekly) is not bool:
            raise Refused("weekly must be true or false.")
        updates["links_weekly"] = weekly
    if check_external is not None:
        if type(check_external) is not bool:
            raise Refused("check_external must be true or false.")
        updates["links_check_external"] = check_external
    with engine.begin() as conn:
        _require_own(conn, site_id)
        if updates:
            clause = ", ".join(f"{name} = :{name}" for name in updates)
            conn.execute(text(f"UPDATE sites SET {clause} WHERE id = :i"), {**updates, "i": site_id})
        if setup_not_used is not None:
            before = _steps_turned_off(conn, [site_id])[site_id]
            for step, sources in _SOURCE_STEPS.items():
                wanted = step in setup_not_used
                if wanted == (step in before):  # unchanged, so a half-used Google stays as Settings left it
                    continue
                for source in sources:
                    conn.execute(text("INSERT IGNORE INTO site_sources (site_id, source) VALUES (:s, :c)"), {"s": site_id, "c": source})
                    conn.execute(text("UPDATE site_sources SET not_used = :n WHERE site_id = :s AND source = :c"), {"n": wanted, "s": site_id, "c": source})
        row = conn.execute(text(f"{_SITE_SELECT} WHERE s.id = :i"), {"i": site_id}).mappings().first()
        off = _steps_turned_off(conn, [site_id])[site_id]
    return _site_dict(row, off)


# ---- scans -------------------------------------------------------------------------------

def _close_abandoned(engine: Engine) -> None:
    """A scan whose job can't finish would spin for ever and block every later scan of that site, so it ends here, and says why.

    created_at only allows for start_scan() writing the scan a moment before its job. However long a scan has been at it, what
    decides is its job, which keeps its key for all that time: running in a chunk, or queued between chunks or until tomorrow.
    """
    with engine.connect() as conn:
        abandoned = conn.execute(text(
            "SELECT l.id, l.site_id FROM link_scans l WHERE l.status IN ('queued', 'running') "
            "AND l.created_at < UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE "
            f"AND {queue.cannot_finish_sql("CONCAT('links:', l.site_id)")}"
        )).all()
    for scan_id, site_id in abandoned:
        queue.let_go(engine, _job_key(site_id), ABANDONED_TEXT)
        _finish_from_saved(engine, scan_id, "failed", error=ABANDONED_TEXT)
    _end_stops_left_waiting(engine)


def _job_key(site_id: int) -> str:
    return f"links:{site_id}"


def start_scan(engine: Engine, site_id: int, check_external: bool | None = None, trigger: str = "button") -> int:
    _close_abandoned(engine)
    if type(site_id) is not int:
        raise Refused("site_id must be a number. A scan is started from a site, never from an address.")
    if check_external is not None and type(check_external) is not bool:
        raise Refused("check_external must be true or false.")
    with engine.begin() as conn:
        site = _require_own(conn, site_id)
        if conn.execute(text("SELECT 1 FROM link_scans WHERE site_id = :s AND status IN ('queued', 'running') LIMIT 1"), {"s": site_id}).first():
            raise Conflict("A scan of this website is already running.")
        scan_id = conn.execute(
            text("INSERT INTO link_scans (site_id, trigger_kind, check_external) VALUES (:s, :t, :c)"),
            {"s": site_id, "t": trigger, "c": check_external if check_external is not None else bool(site["links_check_external"])},
        ).lastrowid
    job = queue.enqueue(engine, LANE, JOB_KIND, payload={"scan_id": scan_id}, dedupe_key=_job_key(site_id), max_attempts=MAX_JOB_ATTEMPTS)
    if job is None:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM link_scans WHERE id = :i"), {"i": scan_id})
        raise Conflict("A scan of this website is already running.")
    return scan_id


_ENDED = "status = :st, stop_reason = :r, error = :e, paused_until = NULL, finished_at = UTC_TIMESTAMP(3)"


def _finish(engine: Engine, scan_id: int, status: str, stop_reason: str | None = None, error: str | None = None) -> bool:
    """False if the scan had already ended. Its saved state goes with it."""
    with engine.begin() as conn:
        ended = conn.execute(
            text(f"UPDATE link_scans SET {_ENDED} WHERE id = :i AND status IN ('queued', 'running')"),
            {"st": status, "r": stop_reason, "e": error, "i": scan_id},
        ).rowcount
        saved_state.forget(conn, KIND, scan_id)
    return bool(ended)


def _save_counters(conn, scan_id: int, result: ScanResult, external_left: int = 0, requests_used: int | None = None) -> None:
    conn.execute(
        text(
            "UPDATE link_scans SET pages_read = :p, links_checked = :l, skipped_robots = :r, too_large = :t, "
            "pages_not_read = :n, external_not_checked = :x, stopped_at_limit = :s, external_left = :e, requests_used = COALESCE(:u, requests_used) WHERE id = :i"
        ),
        {
            "p": result.pages_read, "l": result.links_checked, "r": result.skipped_robots, "t": result.too_large,
            "n": result.pages_not_read, "x": result.external_not_checked, "s": result.stopped_at_limit,
            "e": external_left, "u": requests_used, "i": scan_id,
        },
    )


def _finish_with_results(engine: Engine, scan_id: int, result: ScanResult, status: str, stop_reason: str | None = None, error: str | None = None, used: int | None = None) -> bool:
    """The results, the scan's end and the end of its saved state, in one go, so a kill can't leave half of them. Only the first to get here does it."""
    with engine.begin() as conn:
        ended = conn.execute(
            text(f"UPDATE link_scans SET {_ENDED} WHERE id = :i AND status IN ('queued', 'running')"),
            {"st": status, "r": stop_reason, "e": error, "i": scan_id},
        ).rowcount
        if not ended:
            return False
        _save_counters(conn, scan_id, result, 0, used)
        conn.execute(text("DELETE FROM link_issues WHERE scan_id = :i"), {"i": scan_id})
        for issue in result.issues:
            target, final = issue.target_url[:LONGEST_ADDRESS_STORED], issue.final_url[:LONGEST_ADDRESS_STORED] if issue.final_url else None
            for pages in _page_rows(issue.pages):
                conn.execute(
                    text(
                        "INSERT INTO link_issues (scan_id, category, target_url, status_code, reason, hops, seconds, final_url, pages) "
                        "VALUES (:s, :c, :t, :st, :r, :h, :sec, :f, :p)"
                    ),
                    {
                        "s": scan_id, "c": issue.category, "t": target, "st": issue.status_code, "r": issue.reason[:1000],
                        "h": issue.hops, "sec": issue.seconds, "f": final, "p": _json(pages),
                    },
                )
        saved_state.forget(conn, KIND, scan_id)
    return True


def _page_rows(pages: list[str]):
    """A broken link in the footer of a big site lists every page, more than fits in one row. get_scan() puts them back together."""
    row: list[str] = []
    characters = 0
    for page in pages:
        if row and characters + len(page) > MOST_PAGE_CHARACTERS_IN_A_ROW:
            yield row
            row, characters = [], 0
        row.append(page)
        characters += len(page)
    yield row


def _finish_from_saved(engine: Engine, scan_id: int, status: str, stop_reason: str | None = None, error: str | None = None) -> bool:
    """Ends a scan with what its last save holds, or with nothing if it has none yet. A scan must always be able to end."""
    try:
        saved = saved_state.load(engine, KIND, scan_id)
        if saved:
            return _finish_with_results(engine, scan_id, CrawlState.from_json(saved).so_far(), status, stop_reason, error)
    except OperationalError:  # the database is away for now, so nothing can end yet
        raise
    except Exception:  # noqa: BLE001 - results that can't be read or written must not leave the scan unable to end, and every read of it failing
        pass
    return _finish(engine, scan_id, status, stop_reason, error)


def _end_stops_left_waiting(engine: Engine) -> None:
    """Stop on a scan whose job is waiting, between chunks or for tomorrow, ends it now: no worker is holding it to notice.

    With nothing saved yet, the worker ends it when the job's turn comes, which is soon. Called from every read as well, because a
    stop can slip in just as a worker that has already looked puts the job back to wait.
    """
    with engine.connect() as conn:
        waiting = conn.execute(text(
            "SELECT l.id, l.site_id FROM link_scans l WHERE l.status = 'running' AND l.stop_requested = 1 "
            "AND EXISTS (SELECT 1 FROM crawl_states c WHERE c.kind = :k AND c.run_id = l.id)"
        ), {"k": KIND}).all()
    for scan_id, site_id in waiting:
        if queue.cancel_queued(engine, _job_key(site_id)):  # from here no worker can claim it
            _finish_from_saved(engine, scan_id, "stopped", stop_reason="user")


def keep_the_gap(engine: Engine, site_id: int, state: CrawlState) -> None:
    """A new chunk has a new fetcher, which knows nothing of the last request: the crawl waits out what's left of the gap."""
    last = saved_state.site_last_asked(engine, site_id)
    if last is not None:
        state.last_request_at = max(state.last_request_at, last)


def carry_on_later(engine: Engine, table: str, run_id: int, result: ScanResult) -> None:
    """Everything is saved: the job goes back in the queue. Out of budget, the scan stays running and says until when."""
    if not result.budget_out:
        raise RunAgain(result.wait_seconds)
    wait = budget.seconds_until_new_day(engine)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE {table} SET paused_until = UTC_TIMESTAMP(3) + INTERVAL :w SECOND WHERE id = :i"), {"w": wait, "i": run_id})
    raise RunAgain(wait)


def _save_chunk(engine: Engine, scan_id: int, site_id: int, state: CrawlState, result: ScanResult, external_left: int, used: int) -> None:
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM link_scans WHERE id = :i AND status = 'running' FOR UPDATE"), {"i": scan_id}).first():  # or it's over, with nothing to carry on
            _save_counters(conn, scan_id, result, external_left, used)
            saved_state.save(conn, KIND, scan_id, site_id, state.to_json())


@handler(JOB_KIND)
def run_scan_job(job, engine: Engine) -> None:
    """One chunk of a scan. Run twice or killed half way, it carries on from the last save."""
    scan_id = (job.payload or {}).get("scan_id")
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT l.status, l.site_id, l.max_pages, l.check_external, l.stop_requested, l.requests_used, s.kind, s.host, s.start_url "
                "FROM link_scans l JOIN sites s ON s.id = l.site_id WHERE l.id = :i"
            ),
            {"i": scan_id},
        ).mappings().first()
    if row is None or row["status"] not in ("queued", "running"):  # deleted or stopped while it waited
        with engine.begin() as conn:
            saved_state.forget(conn, KIND, scan_id)
        return
    if row["kind"] != OWN:  # checked again here, on every chunk, whatever the API saw when the scan was queued
        _finish(engine, scan_id, "failed", error=NOT_OWN_TEXT)
        return
    if row["stop_requested"]:
        _finish_from_saved(engine, scan_id, "stopped", stop_reason="user")
        return

    used = row["requests_used"]
    last_poll = last_save = 0.0
    stop_seen = False

    def should_stop() -> bool:
        nonlocal last_poll, stop_seen
        if not stop_seen and time.monotonic() - last_poll >= STOP_POLL_SECONDS:
            last_poll = time.monotonic()
            with engine.connect() as conn:
                stop_seen = bool(conn.execute(text("SELECT stop_requested FROM link_scans WHERE id = :i"), {"i": scan_id}).scalar())
        return stop_seen

    def charge(requests: int) -> None:
        nonlocal used
        used += requests
        budget.charge(engine, requests)

    def on_progress(result: ScanResult, external_left: int) -> None:
        nonlocal last_save
        if time.monotonic() - last_save >= 1.0:
            last_save = time.monotonic()
            with engine.begin() as conn:
                _save_counters(conn, scan_id, result, external_left, used)

    fetcher = None
    try:
        saved = saved_state.load(engine, KIND, scan_id)
        state = CrawlState.from_json(saved) if saved else CrawlState()
        with engine.begin() as conn:
            conn.execute(text("UPDATE link_scans SET status = 'running', started_at = COALESCE(started_at, UTC_TIMESTAMP(3)), paused_until = NULL WHERE id = :i"), {"i": scan_id})
        keep_the_gap(engine, row["site_id"], state)
        check_external = bool(row["check_external"])
        fetcher = fetcher_factory()
        result = run_scan(
            row["start_url"], row["host"], fetcher,
            max_pages=row["max_pages"], check_external=check_external,
            should_stop=should_stop, budget_allows=lambda: budget.has_room(engine), charge=charge, on_progress=on_progress,
            state=state, time_up=time_up_factory(),
        )
        if result.paused:
            _save_chunk(engine, scan_id, row["site_id"], state, result, len(state.external) if check_external and not state.queue else 0, used)
        elif result.stopped:
            _finish_with_results(engine, scan_id, result, "stopped", stop_reason="user", used=used)
        else:
            _finish_with_results(engine, scan_id, result, "complete", used=used)
    except OperationalError as exc:  # the database, not the scan: what's saved is safe, so this chunk is simply tried again
        raise Retry(f"The database failed: {exc.orig}", DATABASE_RETRY_SECONDS) from exc
    except Exception as exc:  # noqa: BLE001 - a scan that crashes must say so, not stay running
        _finish_from_saved(engine, scan_id, "failed", error=f"{type(exc).__name__}: {exc}"[:500])
        return
    finally:
        if fetcher is not None:
            fetcher.close()
    if result.paused:
        carry_on_later(engine, "link_scans", scan_id, result)


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _scan_dict(row, counts: dict | None = None) -> dict:
    return {
        "id": row["id"],
        "site_id": row["site_id"],
        "status": row["status"],
        "trigger": row["trigger_kind"],
        "max_pages": row["max_pages"],
        "check_external": bool(row["check_external"]),
        "stop_reason": row["stop_reason"],
        "stop_requested": bool(row["stop_requested"]),
        "pages_read": row["pages_read"],
        "links_checked": row["links_checked"],
        "skipped_robots": row["skipped_robots"],
        "too_large": row["too_large"],
        "pages_not_read": row["pages_not_read"],
        "external_not_checked": row["external_not_checked"],
        "external_left": row["external_left"],
        "stopped_at_limit": bool(row["stopped_at_limit"]),
        "requests_used": row["requests_used"],
        "paused_until": _iso(row["paused_until"]),
        "error": row["error"],
        "created_at": _iso(row["created_at"]),
        "started_at": _iso(row["started_at"]),
        "finished_at": _iso(row["finished_at"]),
        "counts": counts if counts is not None else {},
    }


def _counts(conn, scan_id: int) -> dict:
    found = dict(conn.execute(text("SELECT category, COUNT(DISTINCT BINARY target_url) FROM link_issues WHERE scan_id = :i GROUP BY category"), {"i": scan_id}).all())
    return {group: int(found.get(group, 0)) for group in GROUPS}


def list_scans(engine: Engine, site_id: int, limit: int = 50) -> list[dict]:
    _close_abandoned(engine)
    with engine.connect() as conn:
        _require_own(conn, site_id)
        rows = conn.execute(
            text("SELECT * FROM link_scans WHERE site_id = :s ORDER BY id DESC LIMIT :n"), {"s": site_id, "n": limit}
        ).mappings().all()
        return [_scan_dict(r, _counts(conn, r["id"])) for r in rows]


def _scan_row(conn, scan_id: int):
    row = conn.execute(text("SELECT * FROM link_scans WHERE id = :i"), {"i": scan_id}).mappings().first()
    if row is None:
        raise UnknownScan("That scan doesn't exist.")
    return row


def get_scan(engine: Engine, scan_id: int) -> dict:
    _close_abandoned(engine)
    with engine.connect() as conn:
        row = _scan_row(conn, scan_id)
        host = conn.execute(text("SELECT host FROM sites WHERE id = :i"), {"i": row["site_id"]}).scalar()
        counts = _counts(conn, scan_id)
        rows = conn.execute(text("SELECT * FROM link_issues WHERE scan_id = :i ORDER BY id"), {"i": scan_id}).mappings().all()
    issues: list[dict] = []
    for i in rows:
        pages = i["pages"] if isinstance(i["pages"], list) else json.loads(i["pages"])
        if issues and (issues[-1]["category"], issues[-1]["target_url"]) == (i["category"], i["target_url"]):  # one issue, in several rows
            issues[-1]["pages"].extend(pages)
            continue
        issues.append({
            "id": i["id"], "category": i["category"], "target_url": i["target_url"], "status_code": i["status_code"],
            "reason": i["reason"], "hops": i["hops"], "seconds": i["seconds"], "final_url": i["final_url"], "pages": pages,
        })
    return {"scan": {**_scan_dict(row, counts), "host": host}, "counts": counts, "issues": issues}


def stop_scan(engine: Engine, scan_id: int) -> None:
    _close_abandoned(engine)
    with engine.begin() as conn:
        row = _scan_row(conn, scan_id)
        if row["status"] == "queued":
            conn.execute(
                text("UPDATE link_scans SET status = 'stopped', stop_reason = 'user', stop_requested = 1, finished_at = UTC_TIMESTAMP(3) WHERE id = :i"),
                {"i": scan_id},
            )
        elif row["status"] == "running":
            conn.execute(text("UPDATE link_scans SET stop_requested = 1 WHERE id = :i"), {"i": scan_id})
        else:
            raise Conflict("That scan has already finished.")
    if row["status"] == "queued":
        queue.cancel_queued(engine, _job_key(row["site_id"]))  # so it can be started again at once
    else:
        _end_stops_left_waiting(engine)


def delete_scan(engine: Engine, scan_id: int) -> None:
    _close_abandoned(engine)
    with engine.begin() as conn:
        row = _scan_row(conn, scan_id)
        if row["status"] in ("queued", "running"):
            raise Conflict("Stop this scan before deleting it.")
        conn.execute(text("DELETE FROM link_scans WHERE id = :i"), {"i": scan_id})
        saved_state.forget(conn, KIND, scan_id)


def _safe_cell(value) -> str:
    """A link on a page is outside text. A spreadsheet must not run it as a formula."""
    text_value = "" if value is None else str(value)
    return f"'{text_value}" if text_value[:1] in ("=", "+", "-", "@", "\t", "\r") else text_value


def scan_csv(engine: Engine, scan_id: int) -> str:
    data = get_scan(engine, scan_id)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Group", "Page with the link", "Target URL", "Status code", "Reason", "Hops", "Seconds", "Final URL"])
    for issue in data["issues"]:
        for page in issue["pages"] or [""]:
            writer.writerow([_safe_cell(v) for v in (
                GROUPS.get(issue["category"], issue["category"]), page, issue["target_url"], issue["status_code"],
                issue["reason"], issue["hops"], issue["seconds"], issue["final_url"],
            )])
    return "﻿" + out.getvalue()


# ---- once a week -----------------------------------------------------------------------------

def enqueue_due(engine: Engine) -> list[int]:
    """Queue a scan for each of my sites not checked in the last 7 days. Safe to call as often as cron likes."""
    _close_abandoned(engine)
    with engine.connect() as conn:
        due = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT s.id FROM sites s WHERE s.kind = 'own' AND s.links_weekly = 1 AND NOT EXISTS ("
                    " SELECT 1 FROM link_scans l WHERE l.site_id = s.id AND (l.status IN ('queued', 'running')"
                    " OR (l.status = 'complete' AND l.created_at > UTC_TIMESTAMP(3) - INTERVAL :d DAY))) ORDER BY s.id"
                ),
                {"d": WEEK_DAYS},
            )
        ]
    queued = []
    for site_id in due:
        try:
            start_scan(engine, site_id, trigger="weekly")
            queued.append(site_id)
        except Conflict:
            continue
    return queued
