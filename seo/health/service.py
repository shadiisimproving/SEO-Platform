"""The monthly health test of my own websites, and the alert when a site gets worse.

Runs by itself once per calendar month through enqueue_due(), which cron starts on hosting, and from a
button. Alerts stay in the app until someone marks them as seen. Only a site whose kind is `own` is tested.

A test always reads the whole site, in chunks, the same way as the links checker (see seo/links/service.py). What it has found
is saved with the crawl, so it scores every page, and it raises no alert until it has really finished.
"""
from __future__ import annotations

import json
import socket
import ssl
import time
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urlsplit

from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

from seo.core import budget
from seo.core.errors import Conflict, NotFound, NotOwnSite, Refused, UnknownSite
from seo.crawl.extract import extract
from seo.health import audit
from seo.links import saved_state, service as links_service
from seo.crawl import sitemap
from seo.links.checker import CrawlState, ScanResult, extract_links, run_scan
from seo.links.urls import host_key
from seo.worker import queue
from seo.worker.runner import Retry, handler

LANE = "crawl"
JOB_KIND = "health.audit"
KIND = "health"  # in crawl_states
DROP_ALERT = 5  # points lost since the last comparable test
LOW_SCORE = 70
SIMILAR_SIZE = 0.5  # a test that read far fewer or more pages isn't comparable
LOOK_BACK = 24  # finished tests searched for one of a similar size
STOP_POLL_SECONDS = 1.0
CERTIFICATE_HAS_EXPIRED = 10  # OpenSSL's code for it
_THIS_MONTH = "DATE_FORMAT(a.created_at, '%Y-%m') = DATE_FORMAT(UTC_DATE(), '%Y-%m')"


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def days_left_on_certificate(host: str) -> int | None:
    """Days until the site's certificate expires, below 0 once it has, or None if it can't be trusted or read.

    A connection that fails raises OSError, because that says nothing about the certificate.
    """
    context = ssl.create_default_context()
    try:
        with socket.create_connection((host, 443), timeout=10) as raw, context.wrap_socket(raw, server_hostname=host) as tls:
            expires = datetime.fromtimestamp(ssl.cert_time_to_seconds(tls.getpeercert()["notAfter"]), tz=timezone.utc)
    except ssl.SSLCertVerificationError as exc:  # an expired certificate is refused here, before it can be read
        return -1 if exc.verify_code == CERTIFICATE_HAS_EXPIRED else None
    except (ssl.SSLError, KeyError, TypeError, ValueError):
        return None
    return (expires - datetime.now(timezone.utc)).days


certificate_check: Callable[[str], int | None] = days_left_on_certificate


def _certificate_problem(start_url: str, host: str) -> str | None:
    parts = urlsplit(start_url)
    if parts.scheme != "https":
        return None
    try:
        days = certificate_check(parts.hostname or host)
    except OSError:
        return None
    if days is None:
        return "ssl_error"
    if days < 0:
        return "ssl_expired"
    return "ssl_expiring" if days <= audit.SSL_WARN_DAYS else None


def _require_own(conn, site_id) -> dict:
    if type(site_id) is not int:
        raise Refused("site_id must be a number. A test is started from a site, never from an address.")
    row = conn.execute(text("SELECT * FROM sites WHERE id = :i"), {"i": site_id}).mappings().first()
    if row is None:
        raise UnknownSite("That website doesn't exist.")
    if row["kind"] != links_service.OWN:
        raise NotOwnSite("The health test only runs on your own websites.")
    return dict(row)


def _site_dict(conn, row) -> dict:
    last = conn.execute(
        text("SELECT id, score, created_at, finished_at FROM health_audits WHERE site_id = :s AND status = 'complete' ORDER BY id DESC LIMIT 1"), {"s": row["id"]}
    ).mappings().first()
    next_at = None
    if row["health_monthly"]:  # a finished test uses up its calendar month. Until then the site is due at the next daily health-due
        next_at = conn.execute(
            text(f"SELECT IF(EXISTS (SELECT 1 FROM health_audits a WHERE a.site_id = :s AND a.status = 'complete' AND {_THIS_MONTH}), LAST_DAY(UTC_DATE()) + INTERVAL 1 DAY, UTC_DATE())"),
            {"s": row["id"]},
        ).scalar()
    open_alerts = conn.execute(text("SELECT COUNT(*) FROM alerts WHERE site_id = :s AND acknowledged_at IS NULL"), {"s": row["id"]}).scalar()
    return {
        "id": row["id"], "host": row["host"], "monthly": bool(row["health_monthly"]), "max_pages": None,  # a test always reads the whole site
        "last_score": last["score"] if last else None, "last_tested_at": _iso(last["finished_at"]) if last else None,
        "next_test_at": next_at.strftime("%Y-%m-%dT00:00:00Z") if next_at else None, "open_alerts": open_alerts,
    }


def sites(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM sites WHERE kind = 'own' ORDER BY host")).mappings().all()
        return [_site_dict(conn, r) for r in rows]


def update_settings(engine: Engine, site_id: int, monthly=None) -> dict:
    with engine.begin() as conn:
        _require_own(conn, site_id)
        if monthly is not None:
            if type(monthly) is not bool:
                raise Refused("monthly must be true or false.")
            conn.execute(text("UPDATE sites SET health_monthly = :m WHERE id = :i"), {"m": monthly, "i": site_id})
        return _site_dict(conn, _require_own(conn, site_id))


def _job_key(site_id: int) -> str:
    return f"health:{site_id}"


def start(engine: Engine, site_id: int, trigger: str = "button") -> int:
    _close_abandoned(engine)
    with engine.begin() as conn:
        _require_own(conn, site_id)
        if conn.execute(text("SELECT 1 FROM health_audits WHERE site_id = :s AND status IN ('queued', 'running') LIMIT 1"), {"s": site_id}).first():
            raise Conflict("A health test of this website is already running.")
        audit_id = conn.execute(text("INSERT INTO health_audits (site_id, trigger_kind) VALUES (:s, :t)"), {"s": site_id, "t": trigger}).lastrowid
    job = queue.enqueue(engine, LANE, JOB_KIND, payload={"audit_id": audit_id}, dedupe_key=_job_key(site_id), max_attempts=links_service.MAX_JOB_ATTEMPTS)
    if job is None:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM health_audits WHERE id = :i"), {"i": audit_id})
        raise Conflict("A health test of this website is already running.")
    return audit_id


def enqueue_due(engine: Engine) -> list[int]:
    """Queue a test for each of my sites with none this calendar month. Safe to call as often as cron likes.

    Only a complete test that read a page uses up the month. One that failed, was stopped, or read nothing (the start page
    was down) is tried again, but not within the same day, so it doesn't restart every hour (F67, as F106 for links).
    """
    _close_abandoned(engine)
    with engine.connect() as conn:
        due = [
            row[0]
            for row in conn.execute(text(
                "SELECT s.id FROM sites s WHERE s.kind = 'own' AND s.health_monthly = 1 AND NOT EXISTS ("
                " SELECT 1 FROM health_audits a WHERE a.site_id = s.id AND (a.status IN ('queued', 'running') "
                f" OR (a.status = 'complete' AND a.pages_read > 0 AND {_THIS_MONTH})"
                " OR (a.trigger_kind = 'monthly' AND a.created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY))) ORDER BY s.id"
            ))
        ]
    queued = []
    for site_id in due:
        try:
            start(engine, site_id, "monthly")
            queued.append(site_id)
        except Conflict:
            continue
    return queued


_ENDED = "status = :st, stop_reason = :r, error = :e, paused_until = NULL, finished_at = UTC_TIMESTAMP(3)"


def _finish(engine: Engine, audit_id: int, status: str, reason: str | None = None, error: str | None = None) -> None:
    """Its saved state goes with it."""
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE health_audits SET {_ENDED} WHERE id = :i AND status IN ('queued', 'running')"), {"st": status, "r": reason, "e": error, "i": audit_id})
        saved_state.forget(conn, KIND, audit_id)


def _alert_failed(engine: Engine, site_id: int, audit_id: int, title: str, error: str) -> None:
    # Cron tries a failed test again every day. Once someone has seen this month's alert, repeating it says nothing new.
    with engine.connect() as conn:
        seen = conn.execute(
            text(f"SELECT 1 FROM alerts a WHERE a.site_id = :s AND a.kind = 'health_failed' AND a.acknowledged_at IS NOT NULL AND {_THIS_MONTH} LIMIT 1"), {"s": site_id}
        ).first()
    if not seen:
        _alert(engine, site_id, audit_id, "health_failed", audit.WARN, title, {"error": error})


def _test_failed(engine: Engine, site_id: int, audit_id: int, title: str, error: str) -> None:
    error = error[:500]
    _finish(engine, audit_id, "failed", error=error)
    _alert_failed(engine, site_id, audit_id, title, error)


def _close_abandoned(engine: Engine) -> None:
    """A test whose job is gone can never finish: its worker kept dying, or crashed with the database away.
    Left as it is, it would block every later test of that site.

    created_at only allows for start() writing the test a moment before its job. However long a test has been at it, what decides
    is its job, which keeps its key for all that time: running in a chunk, or queued between chunks or until tomorrow.
    """
    with engine.connect() as conn:
        abandoned = conn.execute(text(
            "SELECT a.id, a.site_id, s.host FROM health_audits a JOIN sites s ON s.id = a.site_id WHERE a.status IN ('queued', 'running') "
            "AND a.created_at < UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE "
            f"AND {queue.cannot_finish_sql("CONCAT('health:', a.site_id)")}"
        )).all()
    for audit_id, site_id, host in abandoned:
        queue.let_go(engine, _job_key(site_id), "The worker stopped before this test finished.")
        _test_failed(engine, site_id, audit_id, f"{host}: the health test couldn't finish", "The worker stopped before this test finished.")
    _end_stops_left_waiting(engine)


def _end_stops_left_waiting(engine: Engine) -> None:
    """Stop on a test whose job is waiting, between chunks or for tomorrow, ends it now: no worker is holding it to notice.

    With nothing saved yet, the worker ends it when the job's turn comes, which is soon. Called from every read as well, because a
    stop can slip in just as a worker that has already looked puts the job back to wait.
    """
    with engine.connect() as conn:
        waiting = conn.execute(text(
            "SELECT a.*, s.host, s.start_url FROM health_audits a JOIN sites s ON s.id = a.site_id WHERE a.status = 'running' AND a.stop_requested = 1 "
            "AND EXISTS (SELECT 1 FROM crawl_states c WHERE c.kind = :k AND c.run_id = a.id)"
        ), {"k": KIND}).mappings().all()
    for row in waiting:
        if queue.cancel_queued(engine, _job_key(row["site_id"])):  # from here no worker can claim it
            _stop_from_saved(engine, row)


def _stop_from_saved(engine: Engine, row) -> None:
    """Ends a test with what its last save holds, or with nothing if it has none yet. A test must always be able to end."""
    try:
        saved = saved_state.load(engine, KIND, row["id"])
        if saved:
            scan = CrawlState.from_json(saved["crawl"]).so_far()
            scan.stopped = True
            _end_with_results(engine, row["id"], row, audit.Findings.from_json(saved["findings"]), scan)
            return
    except OperationalError:  # the database is away for now, so nothing can end yet
        raise
    except Exception:  # noqa: BLE001 - results that can't be read or written must not leave the test unable to end, and every read of it failing
        pass
    _finish(engine, row["id"], "stopped", "user")


LINKS_IN_CODE = "links_in"  # a health_issues row that holds the internal links report, not a check: page_count stays 0


def _end_with_results(engine: Engine, audit_id: int, row, found: audit.Findings, scan: ScanResult, used: int | None = None, listed: sitemap.SitemapResult | None = None) -> str:
    """The score, the issues, the test's end and the end of its saved state, in one go, so a kill can't leave half of them. Returns the status it ended with.

    A crawl that looked at nothing at all has nothing to score, and 100 would be a lie.
    """
    host, start_url = row["host"], row["start_url"]
    audit.add_link_results(found, scan, lambda url: host_key(url) == host)
    issues = audit.finish(found)
    site_codes = list(dict.fromkeys(found.site_codes))
    scored = bool(found.pages_seen or site_codes)
    if scored and not scan.stopped:  # a test that stops says what it found by then: it doesn't start asking the website while someone waits
        problem = _certificate_problem(start_url, host)
        if problem:
            site_codes.append(problem)
    status, reason, error = ("stopped", "user", None) if scan.stopped else ("complete", None, None) if scored else ("failed", None, f"No page could be read: {_why_nothing_was_read(scan)}"[:500])
    counts = {"pages_seen": found.pages_seen, "issues": {code: len(urls) for code, urls in issues.items()}, "site": site_codes}
    with engine.begin() as conn:
        ended = conn.execute(text(f"UPDATE health_audits SET {_ENDED} WHERE id = :i AND status IN ('queued', 'running')"), {"st": status, "r": reason, "e": error, "i": audit_id}).rowcount
        if not ended:
            return status
        conn.execute(
            text(
                "UPDATE health_audits SET score = :sc, pages_read = :p, skipped_robots = :r, pages_not_read = :n, stopped_at_limit = :l, requests_used = COALESCE(:u, requests_used), counts = :c WHERE id = :i"
            ),
            {
                "sc": audit.score(issues, site_codes, found.pages_seen) if scored else None, "p": scan.pages_read, "r": scan.skipped_robots, "n": scan.pages_not_read,
                "l": scan.stopped_at_limit, "u": used, "c": json.dumps(counts), "i": audit_id,
            },
        )
        conn.execute(text("DELETE FROM health_issues WHERE audit_id = :i"), {"i": audit_id})
        for code, urls in issues.items():
            conn.execute(
                text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, :c, :n, :p)"),
                {"a": audit_id, "c": code, "n": len(urls), "p": json.dumps(urls[:audit.MAX_PAGES_LISTED], ensure_ascii=False)},
            )
        if found.linked_from and status == "complete":
            report = audit.internal_links(found, [e.url for e in listed.entries] if listed else [], start_url, cut=bool(listed and (listed.cut or listed.capped)))
            report["sitemap_read"] = listed is not None
            conn.execute(
                text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, :c, 0, :p)"),
                {"a": audit_id, "c": LINKS_IN_CODE, "p": json.dumps(report, ensure_ascii=False)},
            )
        saved_state.forget(conn, KIND, audit_id)
    return status


def _why_nothing_was_read(scan: ScanResult) -> str:
    if scan.skipped_robots:
        return "Blocked by robots.txt"
    if scan.issues:
        reason = scan.issues[0].reason
        return reason[0].lower() + reason[1:]
    return "the start page isn't a readable web page"


def _save_chunk(engine: Engine, audit_id: int, site_id: int, state: CrawlState, found: audit.Findings, scan: ScanResult, used: int) -> None:
    """The crawl and what it found, at the same moment, so a chunk repeated after a kill can't count a page twice."""
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM health_audits WHERE id = :i AND status = 'running' FOR UPDATE"), {"i": audit_id}).first():  # or it's over, with nothing to carry on
            conn.execute(
                text("UPDATE health_audits SET pages_read = :p, skipped_robots = :r, pages_not_read = :n, requests_used = :u WHERE id = :i"),
                {"p": scan.pages_read, "r": scan.skipped_robots, "n": scan.pages_not_read, "u": used, "i": audit_id},
            )
            saved_state.save(conn, KIND, audit_id, site_id, {"crawl": state.to_json(), "findings": found.to_json()})


@handler(JOB_KIND)
def run_audit(job, engine: Engine) -> None:
    """One chunk of a test. Run twice or killed half way, it carries on from the last save."""
    audit_id = (job.payload or {}).get("audit_id")
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT a.*, s.kind, s.host, s.start_url FROM health_audits a JOIN sites s ON s.id = a.site_id WHERE a.id = :i"), {"i": audit_id}
        ).mappings().first()
    if row is None or row["status"] not in ("queued", "running"):
        with engine.begin() as conn:
            saved_state.forget(conn, KIND, audit_id)
        return
    if row["kind"] != links_service.OWN:  # checked again here, on every chunk, whatever was true when it was queued
        _finish(engine, audit_id, "failed", error="Refused: this is not one of your own websites.")
        return
    if row["stop_requested"]:
        _stop_from_saved(engine, row)
        return

    host, start_url = row["host"], row["start_url"]
    used = row["requests_used"]
    last_poll = last_save = 0.0
    stop_seen = False

    def should_stop() -> bool:
        nonlocal last_poll, stop_seen
        if not stop_seen and time.monotonic() - last_poll >= STOP_POLL_SECONDS:
            last_poll = time.monotonic()
            with engine.connect() as conn:
                stop_seen = bool(conn.execute(text("SELECT stop_requested FROM health_audits WHERE id = :i"), {"i": audit_id}).scalar())
        return stop_seen

    def charge(requests: int) -> None:
        nonlocal used
        used += requests
        budget.charge(engine, requests)

    def on_progress(result, external_left) -> None:
        nonlocal last_save
        if time.monotonic() - last_save >= 1.0:
            last_save = time.monotonic()
            with engine.begin() as conn:
                conn.execute(
                    text("UPDATE health_audits SET pages_read = :p, skipped_robots = :r, pages_not_read = :n, requests_used = :u WHERE id = :i"),
                    {"p": result.pages_read, "r": result.skipped_robots, "n": result.pages_not_read, "u": used, "i": audit_id},
                )

    def on_page(url, result) -> None:
        fields = None
        if result.status == "ok" and result.body is not None:
            page = result.final_url or url
            try:
                fields = extract(result.body, page, charset=result.charset)
                if host_key(page) == host:  # the internal links report: who links to whom on my own site
                    audit.count_links_in(found, page, extract_links(result.body, page, result.charset), lambda u: host_key(u) == host)
            except (ValueError, RecursionError):  # one page the reader can't take must not end the whole test (F97)
                fields = None
        audit.look_at_page(found, url, result, fields, start_url)

    fetcher = None
    try:
        saved = saved_state.load(engine, KIND, audit_id)
        state = CrawlState.from_json(saved["crawl"]) if saved else CrawlState()
        found = audit.Findings.from_json(saved["findings"]) if saved else audit.Findings()
        with engine.begin() as conn:
            conn.execute(text("UPDATE health_audits SET status = 'running', started_at = COALESCE(started_at, UTC_TIMESTAMP(3)), paused_until = NULL WHERE id = :i"), {"i": audit_id})
        links_service.keep_the_gap(engine, row["site_id"], state)
        fetcher = links_service.fetcher_factory()
        # Links to other websites are the links checker's job: this test stays on my own site.
        scan = run_scan(
            start_url, host, fetcher, max_pages=row["max_pages"], check_external=False, should_stop=should_stop,
            budget_allows=lambda: budget.has_room(engine), charge=charge, on_progress=on_progress, on_page=on_page,
            state=state, time_up=links_service.time_up_factory(),
        )
        if scan.paused:
            _save_chunk(engine, audit_id, row["site_id"], state, found, scan, used)
        else:
            listed = None
            if found.linked_from and not scan.stopped:  # the sitemap, for the orphan pages: in it, but linked from nowhere
                try:
                    before = fetcher.requests
                    listed = sitemap.discover(fetcher, start_url, max_pages=200_000)
                    charge(fetcher.requests - before)
                except Exception:  # noqa: BLE001 - no orphan list is better than no test result
                    listed = None
            status = _end_with_results(engine, audit_id, row, found, scan, used, listed)
    except OperationalError as exc:  # the database, not the test: what's saved is safe, so this chunk is simply tried again
        raise Retry(f"The database failed: {exc.orig}", links_service.DATABASE_RETRY_SECONDS) from exc
    except Exception as exc:  # noqa: BLE001 - a test that crashes must say so, not stay running
        _test_failed(engine, row["site_id"], audit_id, f"{host}: the health test couldn't finish", f"{type(exc).__name__}: {exc}")
        return
    finally:
        if fetcher is not None:
            fetcher.close()

    if scan.paused:
        links_service.carry_on_later(engine, "health_audits", audit_id, scan)
    elif status == "failed":
        _alert_failed(engine, row["site_id"], audit_id, f"{host}: the health test couldn't read any page", f"No page could be read: {_why_nothing_was_read(scan)}"[:500])
    elif status == "complete":
        raise_alerts(engine, row["site_id"], audit_id)


def _alert(engine: Engine, site_id: int, audit_id: int | None, kind: str, severity: str, title: str, detail: dict) -> None:
    with engine.begin() as conn:
        # One open alert per kind per site: a new one replaces the old, so the list doesn't pile up. Nobody saw the old one, so it isn't kept as if they had.
        conn.execute(text("DELETE FROM alerts WHERE site_id = :s AND kind = :k AND acknowledged_at IS NULL"), {"s": site_id, "k": kind})
        conn.execute(
            text("INSERT INTO alerts (site_id, kind, severity, title, detail, audit_id) VALUES (:s, :k, :v, :t, :d, :a)"),
            {"s": site_id, "k": kind, "v": severity, "t": title[:300], "d": json.dumps(detail, ensure_ascii=False), "a": audit_id},
        )


def _counts(value) -> dict:
    if isinstance(value, dict):
        return value
    return json.loads(value) if value else {}


def what_got_worse(before: dict, after: dict) -> list[dict]:
    was, now = before.get("issues", {}), after.get("issues", {})
    worse = [
        {"code": code, "before": was.get(code, 0), "after": n}
        for code, n in now.items()
        if n > was.get(code, 0)
    ]
    return sorted(worse, key=lambda w: -(audit.CHECKS.get(w["code"], ("", 0, ""))[1] * (w["after"] - w["before"])))


def _pages_seen(row) -> int:
    return _counts(row["counts"]).get("pages_seen", row["pages_read"]) or 0


def _similar(before, now) -> bool:
    """A test that hit the page limit and one that didn't read different things, however close their sizes."""
    if bool(before["stopped_at_limit"]) != bool(now["stopped_at_limit"]):
        return False
    size_before, size_now = _pages_seen(before), _pages_seen(now)
    return size_before > 0 and SIMILAR_SIZE <= size_now / size_before <= 1 / SIMILAR_SIZE


def _comparable_before(conn, now):
    """The last finished test of a similar size, looking back past any that aren't. Only complete tests qualify, so a partial one never compares."""
    earlier = conn.execute(
        text("SELECT * FROM health_audits WHERE site_id = :s AND status = 'complete' AND id < :i AND score IS NOT NULL ORDER BY id DESC LIMIT :n"),
        {"s": now["site_id"], "i": now["id"], "n": LOOK_BACK},
    ).mappings().all()
    return next((before for before in earlier if _similar(before, now)), None)


def _low_is_news(conn, now) -> bool:
    """The rule for a low score. It's news when the site has just gone under the line, or has sunk below the score the last alert gave.

    Staying as low stays quiet month after month, seen or not, because the alert already said so. Sinking further always says so:
    a new alert after one that was seen, or a replacement for one still open, so the number shown stays right.
    """
    last = conn.execute(
        text("SELECT score FROM health_audits WHERE site_id = :s AND status = 'complete' AND id < :i AND score IS NOT NULL ORDER BY id DESC LIMIT 1"),
        {"s": now["site_id"], "i": now["id"]},
    ).scalar()
    if last is None or last >= LOW_SCORE:
        return True
    told = conn.execute(text("SELECT detail FROM alerts WHERE site_id = :s AND kind IN ('health_drop', 'health_low') ORDER BY id DESC LIMIT 1"), {"s": now["site_id"]}).scalar()
    return told is None or now["score"] < _counts(told).get("after", LOW_SCORE)


def raise_alerts(engine: Engine, site_id: int, audit_id: int) -> list[str]:
    """Is the site getting bad? Compared with the last finished test of a similar size, never against a partial one."""
    with engine.connect() as conn:
        now = conn.execute(text("SELECT a.*, s.host FROM health_audits a JOIN sites s ON s.id = a.site_id WHERE a.id = :i"), {"i": audit_id}).mappings().first()
        before = _comparable_before(conn, now)
        low_is_news = _low_is_news(conn, now)
    host, score_now = now["host"], now["score"]
    counts_now = _counts(now["counts"])
    raised = []
    whole_site = counts_now.get("site", [])
    if whole_site:
        title = f"{host}: " + "; ".join(audit.SITE_CHECKS[code][0].lower() for code in whole_site)
        _alert(engine, site_id, audit_id, "health_site", audit.CRIT, title, {"site": whole_site, "score": score_now})
        raised.append("health_site")
    if before is not None and score_now <= before["score"] - DROP_ALERT:
        severity = audit.CRIT if score_now < LOW_SCORE else audit.WARN
        _alert(
            engine, site_id, audit_id, "health_drop", severity, f"{host}: health fell from {before['score']} to {score_now}",
            {"before": before["score"], "after": score_now, "worse": what_got_worse(_counts(before["counts"]), counts_now), "site": whole_site},
        )
        raised.append("health_drop")
    elif score_now < LOW_SCORE and low_is_news:
        _alert(
            engine, site_id, audit_id, "health_low", audit.CRIT if score_now < 50 else audit.WARN, f"{host}: health is low at {score_now}",
            {"after": score_now, "worse": what_got_worse({}, counts_now), "site": whole_site},
        )
        raised.append("health_low")
    return raised


def _audit_dict(row) -> dict:
    counts = _counts(row["counts"])
    return {
        "id": row["id"], "site_id": row["site_id"], "status": row["status"], "trigger": row["trigger_kind"], "max_pages": row["max_pages"], "score": row["score"],
        "stop_reason": row["stop_reason"], "stop_requested": bool(row["stop_requested"]), "pages_read": row["pages_read"], "pages_seen": _pages_seen(row),
        "skipped_robots": row["skipped_robots"], "pages_not_read": row["pages_not_read"], "stopped_at_limit": bool(row["stopped_at_limit"]), "requests_used": row["requests_used"], "paused_until": _iso(row["paused_until"]),
        "counts": counts.get("issues", {}), "site_problems": counts.get("site", []), "error": row["error"], "created_at": _iso(row["created_at"]), "finished_at": _iso(row["finished_at"]),
    }


def history(engine: Engine, site_id: int, limit: int = 24) -> list[dict]:
    _close_abandoned(engine)
    with engine.connect() as conn:
        _require_own(conn, site_id)
        rows = conn.execute(text("SELECT * FROM health_audits WHERE site_id = :s ORDER BY id DESC LIMIT :n"), {"s": site_id, "n": limit}).mappings().all()
    return [_audit_dict(r) for r in rows]


def detail(engine: Engine, audit_id: int) -> dict:
    _close_abandoned(engine)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT a.*, s.host FROM health_audits a JOIN sites s ON s.id = a.site_id WHERE a.id = :i"), {"i": audit_id}).mappings().first()
        if row is None:
            raise NotFound("That test doesn't exist.")
        issues = conn.execute(text("SELECT code, page_count, pages FROM health_issues WHERE audit_id = :i"), {"i": audit_id}).mappings().all()
        links_row = next((i for i in issues if i["code"] == LINKS_IN_CODE), None)
        before = _comparable_before(conn, row) if row["status"] == "complete" else None  # the same comparison the alerts made
    previous = _counts(before["counts"]).get("issues", {}) if before else {}
    found = {i["code"]: i for i in issues}
    checks = []
    for code, (meaning, weight, severity) in audit.CHECKS.items():
        item = found.get(code)
        pages = (item["pages"] if isinstance(item["pages"], list) else json.loads(item["pages"] or "[]")) if item else []
        checks.append({
            "code": code, "meaning": meaning, "severity": severity, "weight": weight, "count": item["page_count"] if item else 0, "pages": pages,
            "previous": previous.get(code, 0) if before else None,
        })
    checks.sort(key=lambda c: (c["count"] == 0, -c["weight"]))
    return {
        "audit": {**_audit_dict(row), "host": row["host"]},
        "previous_score": before["score"] if before else None,
        "previous_audit": _audit_dict(before) if before else None,  # the screen must name the same test the alerts compared with
        "checks": checks,
        "site_problems": [{"code": code, "meaning": audit.SITE_CHECKS[code][0]} for code in _counts(row["counts"]).get("site", [])],
        "internal_links": internal_links_report(engine, row["site_id"], links_row),
    }


def stop(engine: Engine, audit_id: int) -> None:
    _close_abandoned(engine)
    with engine.begin() as conn:
        row = conn.execute(text("SELECT status, site_id FROM health_audits WHERE id = :i"), {"i": audit_id}).mappings().first()
        if row is None:
            raise NotFound("That test doesn't exist.")
        if row["status"] == "queued":
            conn.execute(text("UPDATE health_audits SET status = 'stopped', stop_reason = 'user', stop_requested = 1, finished_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": audit_id})
        elif row["status"] == "running":
            conn.execute(text("UPDATE health_audits SET stop_requested = 1 WHERE id = :i"), {"i": audit_id})
        else:
            raise Conflict("That test has already finished.")
    if row["status"] == "queued":
        queue.cancel_queued(engine, _job_key(row["site_id"]))  # so it can be started again at once
    else:
        _end_stops_left_waiting(engine)


def alerts(engine: Engine, include_seen: bool = False) -> list[dict]:
    clause = "" if include_seen else "WHERE a.acknowledged_at IS NULL"
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT a.*, s.host FROM alerts a JOIN sites s ON s.id = a.site_id {clause} ORDER BY a.severity = 'crit' DESC, a.id DESC LIMIT 100")).mappings().all()
    return [
        {
            "id": r["id"], "site_id": r["site_id"], "host": r["host"], "kind": r["kind"], "severity": r["severity"], "title": r["title"],
            "detail": _counts(r["detail"]), "audit_id": r["audit_id"], "created_at": _iso(r["created_at"]), "seen": r["acknowledged_at"] is not None,
        }
        for r in rows
    ]


def acknowledge(engine: Engine, alert_id: int, seen: bool = True) -> None:
    if type(seen) is not bool:
        raise Refused("seen must be true or false.")
    with engine.begin() as conn:
        row = conn.execute(text("SELECT site_id, kind FROM alerts WHERE id = :i"), {"i": alert_id}).mappings().first()
        if row is None:
            raise NotFound("That alert doesn't exist.")
        if seen:
            conn.execute(text("UPDATE alerts SET acknowledged_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": alert_id})
            return
        other = conn.execute(
            text("SELECT 1 FROM alerts WHERE site_id = :s AND kind = :k AND acknowledged_at IS NULL AND id <> :i LIMIT 1"), {"s": row["site_id"], "k": row["kind"], "i": alert_id}
        ).first()
        if other:  # one open alert per kind per site
            raise Conflict("A newer alert of this kind is already open for this website.")
        conn.execute(text("UPDATE alerts SET acknowledged_at = NULL WHERE id = :i"), {"i": alert_id})


# ---- the internal links report (on the Health screen, from the last test) ---------------------------------

LINKS_SHOWN = 10


def internal_links_report(engine: Engine, site_id: int, links_row) -> dict | None:
    """Links in per page, orphan pages, and important pages with few links in. None for a test from before the report."""
    if links_row is None:
        return None
    data = links_row["pages"] if isinstance(links_row["pages"], dict) else json.loads(links_row["pages"] or "{}")
    pages = data.get("pages") or {}
    from seo.health import indexing  # noqa: PLC0415 - indexing reads Search Console through metrics, which reads this module

    weight = indexing.importance(engine, site_id)
    rows = []
    for url, count in pages.items():
        clicks, shown = weight.get(indexing.path_of(url), (0, 0))
        rows.append({"url": url, "links_in": count, "clicks": clicks, "impressions": shown})
    important = sorted((r for r in rows if r["links_in"] <= audit.FEW_LINKS_IN and (r["clicks"] or r["impressions"])), key=lambda r: (-r["clicks"], -r["impressions"], r["links_in"]))
    rows.sort(key=lambda r: (r["links_in"], -r["clicks"], -r["impressions"], r["url"]))
    orphans = data.get("orphans") or []
    return {
        "pages_read": len(rows), "orphans": orphans[:audit.MAX_PAGES_LISTED], "orphan_count": len(orphans),
        "few_links": important[:LINKS_SHOWN], "few_links_count": len(important), "few_links_line": audit.FEW_LINKS_IN,
        "pages": rows[:audit.MAX_PAGES_LISTED * 5], "sitemap_pages": data.get("sitemap_pages", 0), "sitemap_read": bool(data.get("sitemap_read")),
        "sitemap_cut": bool(data.get("sitemap_cut")), "has_search_data": bool(weight),
    }
