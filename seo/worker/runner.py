"""One tick of one lane: lock, wait for the database, recover, run jobs, record.

Cron on hosting starts a tick every minute or so; on the Mac a tick is run by hand.
Every tick is short and resumable. A tick that dies leaves its job to be taken back
when the lease runs out, so a killed process loses nothing.
"""
from __future__ import annotations

import os
import socket
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from seo import config
from seo.core.schema import SchemaMismatch, assert_schema_current
from seo.worker import queue

Handler = Callable[[queue.ClaimedJob, Engine], None]

# Cron logs read these. 75 is EX_TEMPFAIL: try again later.
EXIT_CODES = {"ok": 0, "busy": 0, "db_unavailable": 75, "schema_mismatch": 78}

_registry: dict[str, Handler] = {}


def handler(kind: str):
    """Register a job handler. Handlers must be safe to run twice."""

    def register(fn: Handler) -> Handler:
        _registry[kind] = fn
        return fn

    return register


class Retry(Exception):
    """A handler asks to try again later, for example after a 429."""

    def __init__(self, message: str, backoff_seconds: int, patient: bool = False):
        super().__init__(message)
        self.backoff_seconds = backoff_seconds
        self.patient = patient  # another service is down, not this job: it gets far more tries


class RunAgain(Exception):
    """A handler has done its share for now, and has saved where it got to. The same job carries on after this many seconds.

    Not a failure. Other jobs waiting in the lane go first, because the queue serves the longest wait first.
    """

    def __init__(self, delay_seconds: int = 0):
        super().__init__(f"run again in {delay_seconds} s")
        self.delay_seconds = delay_seconds


@dataclass
class TickResult:
    lane: str
    status: str
    processed: int = 0
    failed: int = 0
    recovered: int = 0
    message: str = ""


@contextmanager
def run_lock(path):
    """Non-blocking exclusive lock; yields True if held. Dies with the process.

    Pattern copied from the CRM's jobs.py. The app has no link to the CRM.
    """
    import fcntl

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def wait_for_db(engine: Engine, timeout_seconds: float = 600, interval_seconds: float = 5) -> bool:
    """True once the database answers, so a brief outage doesn't fail a whole tick."""
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except OperationalError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(interval_seconds)


def _new_owner() -> str:
    return f"{socket.gethostname()[:30]}-{os.getpid()}-{uuid.uuid4().hex[:8]}"


def _record_lane(engine: Engine, lane: str, *, started: bool = False, processed: int = 0, error: str | None = None):
    with engine.begin() as conn:
        if started:
            conn.execute(
                text(
                    "INSERT INTO lane_runs (lane, last_started_at) VALUES (:l, UTC_TIMESTAMP(3)) "
                    "ON DUPLICATE KEY UPDATE last_started_at = UTC_TIMESTAMP(3)"
                ),
                {"l": lane},
            )
        else:
            conn.execute(
                text(
                    "UPDATE lane_runs SET last_finished_at = UTC_TIMESTAMP(3), "
                    "last_ok_at = UTC_TIMESTAMP(3), last_processed = :p, last_error = :e WHERE lane = :l"
                ),
                {"l": lane, "p": processed, "e": error},
            )


def _run_one(engine, job, owner, handlers, lease_seconds, heartbeat_seconds) -> bool:
    """False if the job failed. True if it finished, or got through its share and goes back in the queue."""
    stop = threading.Event()

    def beat():
        while not stop.wait(heartbeat_seconds):
            try:
                if not queue.renew(engine, job.id, owner, lease_seconds):
                    return  # the lease was taken back; the final complete() will return False
            except SQLAlchemyError:
                continue  # a passing database problem: the next beat tries again, or the job would lose its lease while still working

    heart = threading.Thread(target=beat, daemon=True)
    heart.start()
    try:
        fn = handlers.get(job.kind)
        if fn is None:
            raise LookupError(f"No handler for job kind {job.kind!r}")
        fn(job, engine)
    except RunAgain as exc:
        stop.set()
        heart.join()
        queue.run_again(engine, job.id, owner, exc.delay_seconds)
        return True
    except Retry as exc:
        stop.set()
        heart.join()
        queue.fail(engine, job.id, owner, str(exc), backoff_seconds=exc.backoff_seconds, patient=exc.patient)
        return False
    except Exception as exc:  # noqa: BLE001 - one bad job must not stop the lane
        stop.set()
        heart.join()
        queue.fail(engine, job.id, owner, f"{type(exc).__name__}: {exc}")
        return False
    stop.set()
    heart.join()
    queue.complete(engine, job.id, owner)
    return True


# Quick checks that must never wait behind a long scan (F14): a crawl tick takes one of these first, whenever one is due.
# The lane also has its own ticks (uptime-due runs it), so on hosting it doesn't depend on the crawl lane at all.
SERVED_FIRST = {"crawl": ("uptime",)}


def _claim_next(engine: Engine, lane: str, owner: str, lease_seconds: int):
    for first in SERVED_FIRST.get(lane, ()):
        jobs = queue.claim(engine, first, owner, lease_seconds=lease_seconds)
        if jobs:
            return jobs
    return queue.claim(engine, lane, owner, lease_seconds=lease_seconds)


def tick(
    engine: Engine,
    lane: str,
    handlers: dict[str, Handler] | None = None,
    lock_dir: str | Path | None = None,
    budget_seconds: float = 50,
    lease_seconds: int = 180,
    heartbeat_seconds: float = 60,
    db_wait_seconds: float = 600,
) -> TickResult:
    handlers = _registry if handlers is None else handlers
    lock_dir = Path(lock_dir) if lock_dir else Path(os.environ.get("SEO_LOCK_DIR", config.VAR / "locks"))

    with run_lock(lock_dir / f"{lane}.lock") as held:
        if not held:
            return TickResult(lane, "busy", message="another tick holds this lane")

        if not wait_for_db(engine, timeout_seconds=db_wait_seconds, interval_seconds=min(5, db_wait_seconds)):
            return TickResult(lane, "db_unavailable", message=f"no database after {db_wait_seconds} s")

        try:
            assert_schema_current(engine)
        except SchemaMismatch as exc:
            return TickResult(lane, "schema_mismatch", message=str(exc))

        _record_lane(engine, lane, started=True)
        recovered = queue.recover_expired(engine)
        result = TickResult(lane, "ok", recovered=recovered["requeued"] + recovered["dead"])
        owner = _new_owner()
        deadline = time.monotonic() + budget_seconds
        while time.monotonic() < deadline:
            jobs = _claim_next(engine, lane, owner, lease_seconds)
            if not jobs:
                break
            if _run_one(engine, jobs[0], owner, handlers, lease_seconds, heartbeat_seconds):
                result.processed += 1
            else:
                result.failed += 1
        _record_lane(engine, lane, processed=result.processed)
        return result
