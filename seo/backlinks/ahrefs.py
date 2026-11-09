"""Each linking website's organic traffic, from Ahrefs. Only while an Ahrefs API key is connected; nothing shows without one.

Written from Ahrefs' API v3 reference (site-explorer/metrics, field org_traffic) and tested on a fake: no real key has called it.
Ahrefs bills API units: a request costs at least 50, so each website costs about 50 units a month. Only the websites of live
links are read, once a month, and at most MAX_PER_MONTH of them. The key's Test runs on ahrefs.com, which Ahrefs never bills.
"""
from __future__ import annotations

import time

from sqlalchemy import Engine, text

from seo.collectors import common, http
from seo.collectors.http import SourceError
from seo.sources import service as sources
from seo.worker import queue
from seo.worker.runner import Retry, RunAgain, handler

JOB_KIND = "backlinks.ahrefs"
LANE = "collectors"
API = "https://api.ahrefs.com/v3/site-explorer/metrics"
MAX_PER_MONTH = 200  # about 10,000 API units
CHUNK_SECONDS = 40.0


def connected(engine: Engine) -> bool:
    return sources.app_key_status(engine, "ahrefs")["connected"]


def _month(engine: Engine) -> str:
    return common.today(engine).strftime("%Y-%m")


def traffic(key: str, domain: str, day: str) -> int | None:
    reply = http.request("GET", API, "Ahrefs", headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
                         params={"target": domain, "date": day, "mode": "subdomains", "protocol": "both"})
    value = ((reply.json() or {}).get("metrics") or {}).get("org_traffic")
    return int(value) if isinstance(value, (int, float)) else None


def _missing(engine: Engine, month: str) -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT DISTINCT b.domain FROM backlinks b WHERE b.status = 'live' AND b.domain IS NOT NULL AND b.domain <> '' "
            "AND b.domain NOT IN (SELECT domain FROM ahrefs_monthly WHERE month = :m) ORDER BY b.domain"
        ), {"m": month}).all()
        used = int(conn.execute(text("SELECT COUNT(*) FROM ahrefs_monthly WHERE month = :m AND fetched_at IS NOT NULL"), {"m": month}).scalar() or 0)
    return [r[0] for r in rows][:max(0, MAX_PER_MONTH - used)]


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    key = sources.app_key(engine, "ahrefs")
    if not key:
        return  # the key was removed since this was queued
    month, started = _month(engine), time.monotonic()
    day = common.today(engine).isoformat()
    for domain in _missing(engine, month):
        if time.monotonic() - started >= CHUNK_SECONDS:
            raise RunAgain(3)
        try:
            value, error = traffic(key, domain, day), None
        except SourceError as exc:
            sources.note_app_key(engine, "ahrefs", str(exc))
            if exc.kind == "temporary":
                raise Retry(str(exc), 900, patient=True) from exc
            return  # a refused key or no units left: nothing more this month until it's fixed
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO ahrefs_monthly (domain, month, org_traffic, error, fetched_at) VALUES (:d, :m, :t, :e, UTC_TIMESTAMP(3)) "
                "ON DUPLICATE KEY UPDATE org_traffic = :t, error = :e, fetched_at = UTC_TIMESTAMP(3)"
            ), {"d": domain, "m": month, "t": value, "e": error})
        sources.note_app_key(engine, "ahrefs", None)


def enqueue(engine: Engine) -> bool:
    if not connected(engine) or not _missing(engine, _month(engine)):
        return False
    return queue.enqueue(engine, LANE, JOB_KIND, payload={}, dedupe_key=f"ahrefs:{_month(engine)}", max_attempts=3) is not None


def for_domains(conn, domains: set[str]) -> dict[str, int | None]:
    """The newest traffic Ahrefs gave for each website."""
    if not domains:
        return {}
    rows = conn.execute(text(
        "SELECT a.domain, a.org_traffic FROM ahrefs_monthly a JOIN (SELECT domain, MAX(month) AS m FROM ahrefs_monthly WHERE fetched_at IS NOT NULL GROUP BY domain) n "
        "ON n.domain = a.domain AND n.m = a.month"
    )).all()
    return {domain: value for domain, value in rows if domain in domains}
