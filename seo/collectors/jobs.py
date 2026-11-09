"""Queues and runs collectors. Cron starts them on hosting; on the Mac they run by hand or from Refresh data.

A key that stopped working is a person's to fix, so it says so once and stays quiet. A limit reached means today's data is
partial and tomorrow carries on. A passing outage tries again later.
"""
from __future__ import annotations

import json

from sqlalchemy import Engine, text

from seo.collectors import common, ga4, gsc, others
from seo.collectors.http import SourceError
from seo.core.errors import NotFound
from seo.sources import credentials, service
from seo.worker import queue
from seo.worker.runner import Retry, RunAgain, handler

LANE = "collectors"
COLLECTORS = {
    "gsc": gsc.collect, "ga4": ga4.collect, "bing": others.collect_bing, "yandex": others.collect_yandex,
    "clarity": others.collect_clarity, "pagespeed": others.collect_pagespeed,
}
# Hours before a source is read again. Clarity's limit is counted per UTC day and is checked apart. Search Console goes every
# hourly cron run (50 minutes, so a run that started a little late isn't skipped): only its spine and not-final days are read.
EVERY_HOURS = {"gsc": 50 / 60, "ga4": 20, "bing": 20, "yandex": 20, "clarity": 20, "pagespeed": 24 * 7}
# A source that failed is tried again after this, not after its usual wait. A fixed key (an API switched on, access given)
# then shows its numbers within the hour, while a broken one costs at most one call an hour.
RETRY_FAILED_HOURS = 1
ALERT_KIND = "source_failing"
NAMES = {"gsc": "Search Console", "ga4": "Google Analytics", "bing": "Bing Webmaster", "yandex": "Yandex Webmaster", "clarity": "Clarity", "pagespeed": "PageSpeed Insights"}


def ready_to_run(row) -> bool:
    """Has what it needs. A site that doesn't use a source, or hasn't set it up, isn't a problem to report."""
    if row["not_used"]:
        return False
    if row["source"] in ("gsc", "ga4"):
        return bool(row["connection_id"] and row["property"])
    if row["source"] == "clarity":
        return bool(row["secret"])
    if row["source"] in ("bing", "yandex"):
        return bool(row["has_key"])
    return True


def _rows(engine: Engine, site_id: int | None = None):
    clause, values = ("AND s.id = :s", {"s": site_id}) if site_id is not None else ("", {})
    with engine.begin() as conn:
        # PageSpeed works with no key and no setup, so every site gets a row for it.
        conn.execute(text(f"INSERT IGNORE INTO site_sources (site_id, source) SELECT s.id, 'pagespeed' FROM sites s WHERE s.kind = 'own' {clause}"), values)
        return conn.execute(
            text(
                f"SELECT ss.*, TIMESTAMPDIFF(MINUTE, ss.last_attempt_at, UTC_TIMESTAMP(3)) AS minutes_since, DATE(ss.last_attempt_at) = UTC_DATE() AS tried_today, "
                f"(ss.source IN ('bing', 'yandex') AND EXISTS (SELECT 1 FROM connections c WHERE c.tool = IF(ss.source = 'bing', 'Bing Webmaster', 'Yandex Webmaster'))) AS has_key "
                f"FROM site_sources ss JOIN sites s ON s.id = ss.site_id WHERE s.kind = 'own' {clause}"
            ),
            values,
        ).mappings().all()


def enqueue_one(engine: Engine, site_id: int, source: str) -> int | None:
    return queue.enqueue(engine, LANE, "collect", {"site_id": site_id, "source": source}, dedupe_key=f"collect|{site_id}|{source}")


def enqueue_due(engine: Engine) -> list[tuple[int, str]]:
    queued = []
    for row in _rows(engine):
        if not ready_to_run(row):
            continue
        hours = min(EVERY_HOURS[row["source"]], RETRY_FAILED_HOURS) if row["last_error"] else EVERY_HOURS[row["source"]]
        fresh = row["minutes_since"] is not None and row["minutes_since"] < hours * 60
        if fresh or (row["source"] == "clarity" and row["tried_today"]):
            continue
        if enqueue_one(engine, row["site_id"], row["source"]):
            queued.append((row["site_id"], row["source"]))
    return queued


def collect_now(engine: Engine, site_id: int) -> list[str]:
    """The Refresh data button. Clarity still goes once per UTC day, because a second pass would use up the day's requests."""
    return [entry["source"] for entry in collect_now_jobs(engine, site_id) if entry["new"]]


def collect_now_jobs(engine: Engine, site_id: int) -> list[dict]:
    """Same, with each read's job, so the screen can wait for the reads to finish instead of guessing.

    A read already queued or running is followed too (new = False): pressing Refresh while one runs isn't "nothing to read".
    Sources it leaves out say why, so the screen never says "updated" about something it didn't read.
    """
    entries = []
    for row in _rows(engine, site_id):
        if not ready_to_run(row):
            continue
        if row["source"] == "clarity" and row["tried_today"]:
            entries.append({"source": "clarity", "job_id": None, "new": False, "skipped": "clarity_daily"})
            continue
        job_id = enqueue_one(engine, row["site_id"], row["source"])
        new = job_id is not None
        if not new:
            job_id = _active_job(engine, f"collect|{row['site_id']}|{row['source']}")
        entries.append({"source": row["source"], "job_id": job_id, "new": new})
    return entries


def _active_job(engine: Engine, key: str) -> int | None:
    with engine.connect() as conn:
        return conn.execute(text("SELECT id FROM jobs WHERE active_key = :k"), {"k": key}).scalar()


def job_states(engine: Engine, ids: list[int]) -> list[dict]:
    """Where each read is. "waiting" is a read that hit a passing problem and tries again later: the screen stops waiting for it.

    Only collector jobs, so this can't be used to look at other work.
    """
    if not ids:
        return []
    marks = ", ".join(f":i{n}" for n in range(len(ids)))
    values = {f"i{n}": int(i) for n, i in enumerate(ids)}
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT id, kind, status, attempts, payload FROM jobs WHERE lane = :lane AND id IN ({marks})"), {**values, "lane": LANE}
        ).mappings().all()
    answer = []
    for row in rows:
        payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"] or "{}")
        status = row["status"]
        if status == "queued" and row["attempts"]:
            status = "waiting"
        entry = {"id": row["id"], "source": payload.get("source"), "site_id": payload.get("site_id"), "status": status}
        if status in ("done", "dead", "waiting") and payload.get("site_id") and payload.get("source"):
            src = common.source_row(engine, payload["site_id"], payload["source"])
            entry["error"] = src["last_error"] if src else None
        answer.append(entry)
    return answer


def _alert(engine: Engine, site_id: int, source: str, message: str) -> None:
    title = f"{NAMES[source]} stopped working"
    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM alerts WHERE site_id = :s AND kind = :k AND title = :t AND acknowledged_at IS NULL"), {"s": site_id, "k": ALERT_KIND, "t": title}
        ).first()
        if not exists:
            conn.execute(
                text("INSERT INTO alerts (site_id, kind, severity, title, detail) VALUES (:s, :k, 'crit', :t, :d)"),
                {"s": site_id, "k": ALERT_KIND, "t": title, "d": json.dumps({"error": message, "source": source}, ensure_ascii=False)},
            )


def _clear_alert(engine: Engine, site_id: int, source: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM alerts WHERE site_id = :s AND kind = :k AND title = :t AND acknowledged_at IS NULL"),
            {"s": site_id, "k": ALERT_KIND, "t": f"{NAMES[source]} stopped working"},
        )


@handler("collect")
def run(job: queue.ClaimedJob, engine: Engine) -> None:
    site_id, source = job.payload["site_id"], job.payload["source"]
    row = common.source_row(engine, site_id, source)
    if row is None or row["not_used"]:
        return  # switched off or removed since it was queued
    common.started(engine, site_id, source)
    try:
        finished = COLLECTORS[source](engine, site_id)
    except credentials.CredentialsFailed as exc:
        common.failed(engine, site_id, source, str(exc))
        _alert(engine, site_id, source, str(exc))
        with engine.begin() as conn:
            conn.execute(text("UPDATE google_connections SET last_error = :e WHERE id = :i"), {"e": str(exc)[:500], "i": row["connection_id"]})
        return
    except ConnectionError as exc:
        common.failed(engine, site_id, source, str(exc))
        raise Retry(str(exc), 900, patient=True) from exc
    except NotFound as exc:
        common.failed(engine, site_id, source, str(exc))
        return
    except SourceError as exc:
        common.failed(engine, site_id, source, str(exc))
        if exc.kind == "auth":
            _alert(engine, site_id, source, str(exc))
            return
        if exc.kind == "quota":
            return  # stop for today: what was saved stays, the next run carries on from what's missing
        raise Retry(str(exc), 900, patient=True) from exc
    _clear_alert(engine, site_id, source)
    if finished:
        # A finished read with nothing new to save (every day already read) still proves the key works: an old error goes.
        common.succeeded(engine, site_id, source)
    if not finished:
        raise RunAgain(0)
    if source == "gsc":
        from seo.metrics import search  # "Matches Search Console", after every finished pull

        search.verify_quietly(engine, site_id)
        from seo.notifications import new_queries  # the bell, for a search the site never showed up for before

        new_queries.enqueue(engine, site_id)
        from seo.insights import engine as insights  # Search insights, only when a new final day arrived

        insights.enqueue_if_new(engine, site_id)


@handler("collect-authority")
def run_authority(job: queue.ClaimedJob, engine: Engine) -> None:
    try:
        others.collect_authority(engine, job.payload["month"])
    except SourceError as exc:
        service.note_app_key(engine, "openpagerank", str(exc))
        if exc.kind == "temporary":
            raise Retry(str(exc), 3600, patient=True) from exc


def enqueue_authority(engine: Engine) -> int | None:
    if not service.app_key(engine, "openpagerank"):
        return None
    month = common.today(engine).strftime("%Y-%m")
    with engine.connect() as conn:
        # Any domain still missing this month, so a first run that stopped part-way gets finished.
        missing = conn.execute(
            text("SELECT 1 FROM (SELECT host AS d FROM sites UNION SELECT domain AS d FROM backlinks) known WHERE d NOT IN (SELECT domain FROM authority_monthly WHERE month = :m) LIMIT 1"),
            {"m": month},
        ).first()
        if not missing:
            return None
    return queue.enqueue(engine, LANE, "collect-authority", {"month": month}, dedupe_key=f"authority|{month}")
