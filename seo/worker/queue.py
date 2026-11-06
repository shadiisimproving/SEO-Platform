"""Job queue on MariaDB. Claiming is safe with any number of workers.

A claim is SELECT ... FOR UPDATE SKIP LOCKED, then UPDATE, then read back: no
RETURNING and no self-subquery, the pattern proven on MariaDB 11.4 in the booking
spike (0 jobs ran twice across overlapping ticks).

A lost lease is not a failure. Shared hosting can kill a process through no fault of
the job, so `attempts` only counts real errors, and `lease_losses` separately stops
a job that keeps killing its process from looping forever.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Engine, func, insert, literal_column, select, text, update
from sqlalchemy.exc import IntegrityError

from seo.core.models import Job

MAX_LEASE_LOSSES = 5
LEASE_GRACE_MINUTES = 5  # a worker renews its lease every minute, so this long past the end means it's gone
ERROR_LIMIT = 2000
NOW = func.utc_timestamp(3)
MAX_TEMPORARY_ATTEMPTS = 100  # about a day at 15 minutes apart


def _in(seconds: int):
    return literal_column(f"UTC_TIMESTAMP(3) + INTERVAL {int(seconds)} SECOND")


@dataclass(frozen=True)
class ClaimedJob:
    id: int
    lane: str
    kind: str
    payload: dict | None
    attempts: int


def enqueue(
    engine: Engine,
    lane: str,
    kind: str,
    payload: dict | None = None,
    dedupe_key: str | None = None,
    run_after_seconds: int = 0,
    max_attempts: int = 3,
) -> int | None:
    """Returns the job id, or None if a job with this key is already active."""
    values = dict(
        lane=lane,
        kind=kind,
        payload=payload,
        dedupe_key=dedupe_key,
        active_key=dedupe_key,
        max_attempts=max_attempts,
        run_after=_in(run_after_seconds),
    )
    try:
        with engine.begin() as conn:
            return conn.execute(insert(Job).values(**values)).inserted_primary_key[0]
    except IntegrityError:
        if dedupe_key is None:
            raise
        return None


def cancel_queued(engine: Engine, dedupe_key: str) -> bool:
    """Drop a job that hasn't started, so its key is free at once. One already running is left alone."""
    with engine.begin() as conn:
        result = conn.execute(
            update(Job).where(Job.active_key == dedupe_key, Job.status == "queued").values(status="done", active_key=None, finished_at=NOW)
        )
    return result.rowcount == 1


def claim(engine: Engine, lane: str, owner: str, lease_seconds: int = 180, limit: int = 1) -> list[ClaimedJob]:
    with engine.begin() as conn:
        ids = (
            conn.execute(
                select(Job.id)
                .where(Job.lane == lane, Job.status == "queued", Job.run_after <= NOW)
                .order_by(Job.run_after, Job.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .all()
        )
        if not ids:
            return []
        conn.execute(
            update(Job)
            .where(Job.id.in_(ids))
            .values(status="running", lease_owner=owner, lease_expires_at=_in(lease_seconds))
        )
        rows = conn.execute(
            select(Job.id, Job.lane, Job.kind, Job.payload, Job.attempts)
            .where(Job.id.in_(ids))
            .order_by(Job.run_after, Job.id)
        ).all()
    return [ClaimedJob(*row) for row in rows]


def _owned(job_id: int, owner: str):
    return (Job.id == job_id, Job.status == "running", Job.lease_owner == owner)


def renew(engine: Engine, job_id: int, owner: str, lease_seconds: int = 180) -> bool:
    with engine.begin() as conn:
        result = conn.execute(
            update(Job).where(*_owned(job_id, owner)).values(lease_expires_at=_in(lease_seconds))
        )
    return result.rowcount == 1


def complete(engine: Engine, job_id: int, owner: str) -> bool:
    with engine.begin() as conn:
        result = conn.execute(
            update(Job)
            .where(*_owned(job_id, owner))
            .values(status="done", active_key=None, lease_owner=None, lease_expires_at=None, finished_at=NOW)
        )
    return result.rowcount == 1


def run_again(engine: Engine, job_id: int, owner: str, delay_seconds: int = 0) -> bool:
    """The same job goes back in the queue to carry on, keeping its key, so its work still counts as under way.

    It isn't a failure, and it's progress: over days, hosting may kill a long job's process any number of times, and only
    attempts or lost leases in a row, with nothing done in between, say that something is really wrong.
    """
    with engine.begin() as conn:
        result = conn.execute(
            update(Job)
            .where(*_owned(job_id, owner))
            .values(status="queued", attempts=0, lease_losses=0, lease_owner=None, lease_expires_at=None, last_error=None, run_after=_in(delay_seconds))
        )
    return result.rowcount == 1


def fail(engine: Engine, job_id: int, owner: str, error: str, backoff_seconds: int | None = None, patient: bool = False) -> str | None:
    """Returns the new status, or None if this worker no longer holds the job."""
    error = error[:ERROR_LIMIT]
    with engine.begin() as conn:
        row = conn.execute(
            select(Job.attempts, Job.max_attempts).where(*_owned(job_id, owner)).with_for_update()
        ).first()
        if row is None:
            return None
        attempts = row.attempts + 1
        # Patient: the job isn't at fault, such as Google being down, so an outage of an hour doesn't use it up.
        most = MAX_TEMPORARY_ATTEMPTS if patient else row.max_attempts
        if attempts >= most:
            conn.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="dead",
                    attempts=attempts,
                    last_error=error,
                    active_key=None,
                    lease_owner=None,
                    lease_expires_at=None,
                    finished_at=NOW,
                )
            )
            return "dead"
        wait = backoff_seconds if backoff_seconds is not None else 60 * attempts
        conn.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(
                status="queued",
                attempts=attempts,
                last_error=error,
                lease_owner=None,
                lease_expires_at=None,
                run_after=_in(wait),
            )
        )
        return "queued"


def cannot_finish_sql(key_sql: str) -> str:
    """SQL condition for work whose job can't finish: the job is over or dead, or its worker is long gone.

    The second case matters when cron has stopped too, because then nothing else would ever notice.
    A job still waiting in the queue can run, so it doesn't count, however long it has been at it or waits for: a long
    scan's job goes back in the queue between chunks, and until the next day when the daily budget runs out.
    """
    return (
        f"NOT EXISTS (SELECT 1 FROM jobs j WHERE j.active_key = {key_sql} "
        f"AND (j.status <> 'running' OR j.lease_expires_at >= UTC_TIMESTAMP(3) - INTERVAL {LEASE_GRACE_MINUTES} MINUTE))"
    )


def let_go(engine: Engine, dedupe_key: str, error: str) -> None:
    """Give up on a job whose worker is long gone, so its key is free for new work."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE jobs SET status = 'dead', active_key = NULL, lease_owner = NULL, lease_expires_at = NULL, last_error = :e, finished_at = UTC_TIMESTAMP(3) "
                f"WHERE active_key = :k AND status = 'running' AND lease_expires_at < UTC_TIMESTAMP(3) - INTERVAL {LEASE_GRACE_MINUTES} MINUTE"
            ),
            {"e": error, "k": dedupe_key},
        )


def recover_expired(engine: Engine) -> dict[str, int]:
    """Take back jobs whose worker died or stopped renewing its lease."""
    requeued = dead = 0
    with engine.begin() as conn:
        rows = conn.execute(
            select(Job.id, Job.lease_losses)
            .where(Job.status == "running", Job.lease_expires_at < NOW)
            .with_for_update(skip_locked=True)
        ).all()
        for row in rows:
            losses = row.lease_losses + 1
            if losses >= MAX_LEASE_LOSSES:
                conn.execute(
                    update(Job)
                    .where(Job.id == row.id)
                    .values(
                        status="dead",
                        lease_losses=losses,
                        last_error=f"Lost its lease {losses} times; its process keeps dying.",
                        active_key=None,
                        lease_owner=None,
                        lease_expires_at=None,
                        finished_at=NOW,
                    )
                )
                dead += 1
            else:
                conn.execute(
                    update(Job)
                    .where(Job.id == row.id)
                    .values(status="queued", lease_losses=losses, lease_owner=None, lease_expires_at=None)
                )
                requeued += 1
    return {"requeued": requeued, "dead": dead}
