"""One tick of one lane: safe to kill, safe to overlap, honest about what happened."""
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from sqlalchemy import create_engine, text

from seo.worker import queue
from seo.worker.runner import EXIT_CODES, Retry, RunAgain, run_lock, tick, wait_for_db
from tests.kill_worker import write_then_hang

ROOT = Path(__file__).resolve().parent.parent


def status_of(engine, job_id):
    with engine.connect() as conn:
        return conn.execute(text("SELECT status FROM jobs WHERE id=:i"), {"i": job_id}).scalar()


def test_killed_worker_leaves_no_duplicates(engine, tmp_path):
    """The Phase 0 exit test: kill -9 mid-job, recover, exactly one row."""
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS kill_test_rows (k VARCHAR(50) PRIMARY KEY)"))
        conn.execute(text("TRUNCATE TABLE kill_test_rows"))
    job_id = queue.enqueue(engine, "killtest", "write_then_hang", {"k": "only-once"})

    worker = subprocess.Popen([sys.executable, "-m", "tests.kill_worker", str(tmp_path)], cwd=ROOT)
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            with engine.connect() as conn:
                if conn.execute(text("SELECT COUNT(*) FROM kill_test_rows")).scalar() == 1:
                    break
            time.sleep(0.1)
        else:
            raise AssertionError("the worker never wrote its row")
    finally:
        os.kill(worker.pid, signal.SIGKILL)
        worker.wait()

    assert status_of(engine, job_id) == "running"  # nobody has told the DB it died
    time.sleep(2.2)  # let the 2 s lease run out

    result = tick(engine, "killtest", handlers={"write_then_hang": write_then_hang}, lock_dir=tmp_path)

    assert result.status == "ok"
    assert result.recovered == 1
    assert result.processed == 1
    assert status_of(engine, job_id) == "done"
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM kill_test_rows")).scalar() == 1
        attempts = conn.execute(text("SELECT attempts FROM jobs WHERE id=:i"), {"i": job_id}).scalar()
    assert attempts == 0  # dying is not a failed attempt
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE kill_test_rows"))


def test_second_tick_on_a_held_lane_exits_as_busy(engine, tmp_path):
    with run_lock(tmp_path / "crawl.lock") as held:
        assert held
        result = tick(engine, "crawl", handlers={}, lock_dir=tmp_path)
    assert result.status == "busy"


def test_other_lanes_are_not_blocked_by_a_busy_lane(engine, tmp_path):
    with run_lock(tmp_path / "crawl.lock"):
        assert tick(engine, "refresh", handlers={}, lock_dir=tmp_path).status == "ok"


def test_lock_is_released_after_a_tick(engine, tmp_path):
    tick(engine, "crawl", handlers={}, lock_dir=tmp_path)
    assert tick(engine, "crawl", handlers={}, lock_dir=tmp_path).status == "ok"


def test_runs_jobs_and_marks_them_done(engine, tmp_path):
    seen = []
    job_id = queue.enqueue(engine, "crawl", "note", {"n": 1})
    result = tick(engine, "crawl", handlers={"note": lambda job, e: seen.append(job.payload["n"])}, lock_dir=tmp_path)
    assert seen == [1]
    assert result.processed == 1
    assert status_of(engine, job_id) == "done"


def test_heartbeat_keeps_a_job_longer_than_its_lease_alive(engine, tmp_path):
    job_id = queue.enqueue(engine, "crawl", "slow")
    recovered = []

    def slow(job, e):
        # Another tick's recovery pass, while this job runs past its 1 s lease.
        time.sleep(1.5)
        recovered.append(queue.recover_expired(e))

    result = tick(engine, "crawl", handlers={"slow": slow}, lock_dir=tmp_path, lease_seconds=1, heartbeat_seconds=0.2)
    assert recovered == [{"requeued": 0, "dead": 0}]
    assert result.processed == 1
    assert status_of(engine, job_id) == "done"


def test_failing_job_is_recorded_and_does_not_stop_the_tick(engine, tmp_path):
    bad = queue.enqueue(engine, "crawl", "boom")
    good = queue.enqueue(engine, "crawl", "ok")

    def boom(job, e):
        raise ValueError("no such page")

    result = tick(engine, "crawl", handlers={"boom": boom, "ok": lambda j, e: None}, lock_dir=tmp_path)
    assert result.status == "ok"
    assert result.failed == 1
    assert result.processed == 1
    assert status_of(engine, good) == "done"
    with engine.connect() as conn:
        row = conn.execute(text("SELECT status, attempts, last_error FROM jobs WHERE id=:i"), {"i": bad}).one()
    assert row.status == "queued"
    assert row.attempts == 1
    assert "no such page" in row.last_error


def test_retry_uses_the_backoff_the_handler_asked_for(engine, tmp_path):
    job_id = queue.enqueue(engine, "crawl", "later")

    def later(job, e):
        raise Retry("rate limited", backoff_seconds=3600)

    tick(engine, "crawl", handlers={"later": later}, lock_dir=tmp_path)
    with engine.connect() as conn:
        wait = conn.execute(
            text("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), run_after) FROM jobs WHERE id=:i"), {"i": job_id}
        ).scalar()
    assert 3500 < wait <= 3600


def test_unknown_job_kind_fails_cleanly(engine, tmp_path):
    job_id = queue.enqueue(engine, "crawl", "nobody_handles_this")
    result = tick(engine, "crawl", handlers={}, lock_dir=tmp_path)
    assert result.failed == 1
    with engine.connect() as conn:
        assert "nobody_handles_this" in conn.execute(
            text("SELECT last_error FROM jobs WHERE id=:i"), {"i": job_id}
        ).scalar()


def test_tick_stops_claiming_when_its_time_budget_runs_out(engine, tmp_path):
    for _ in range(5):
        queue.enqueue(engine, "crawl", "slowish")
    result = tick(
        engine, "crawl", handlers={"slowish": lambda j, e: time.sleep(0.4)}, lock_dir=tmp_path, budget_seconds=0.5
    )
    assert 1 <= result.processed <= 2
    with engine.connect() as conn:
        left = conn.execute(text("SELECT COUNT(*) FROM jobs WHERE status='queued'")).scalar()
    assert left == 5 - result.processed


def test_tick_records_when_the_lane_last_ran(engine, tmp_path):
    queue.enqueue(engine, "crawl", "ok")
    tick(engine, "crawl", handlers={"ok": lambda j, e: None}, lock_dir=tmp_path)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM lane_runs WHERE lane='crawl'")).mappings().one()
        gap = conn.execute(
            text("SELECT TIMESTAMPDIFF(SECOND, last_ok_at, UTC_TIMESTAMP(3)) FROM lane_runs WHERE lane='crawl'")
        ).scalar()
    assert row["last_processed"] == 1
    assert row["last_error"] is None
    assert gap <= 5


def test_refuses_to_run_on_a_mismatched_schema(engine, tmp_path):
    queue.enqueue(engine, "crawl", "ok")
    ran = []
    with engine.connect() as conn:
        head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    with engine.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num='0000old'"))
    try:
        result = tick(engine, "crawl", handlers={"ok": lambda j, e: ran.append(1)}, lock_dir=tmp_path)
    finally:
        with engine.begin() as conn:
            conn.execute(text("UPDATE alembic_version SET version_num=:h"), {"h": head})
    assert result.status == "schema_mismatch"
    assert ran == []


def test_wait_for_db_gives_up_after_the_set_time():
    dead = create_engine("mariadb+pymysql://x:y@127.0.0.1:1/z", connect_args={"connect_timeout": 1})
    started = time.monotonic()
    assert wait_for_db(dead, timeout_seconds=0.5, interval_seconds=0.1) is False
    assert time.monotonic() - started < 5


def test_wait_for_db_returns_as_soon_as_it_is_up(engine):
    assert wait_for_db(engine, timeout_seconds=5) is True


def test_tick_reports_a_database_that_never_came_up(tmp_path):
    dead = create_engine("mariadb+pymysql://x:y@127.0.0.1:1/z", connect_args={"connect_timeout": 1})
    result = tick(dead, "crawl", handlers={}, lock_dir=tmp_path, db_wait_seconds=0.3)
    assert result.status == "db_unavailable"
    assert EXIT_CODES["db_unavailable"] == 75


def test_cli_runs_a_tick(engine, tmp_path):
    env = dict(os.environ, SEO_LOCK_DIR=str(tmp_path))
    done = subprocess.run(
        [sys.executable, "-m", "seo.worker", "tick", "--lane", "clilane", "--test-db", "--budget", "1"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert done.returncode == 0, done.stderr
    assert "clilane" in done.stdout


def test_two_threads_ticking_one_lane_run_a_job_once(engine, tmp_path):
    runs = []
    queue.enqueue(engine, "crawl", "count")
    barrier = threading.Barrier(2)

    def go():
        barrier.wait()
        tick(engine, "crawl", handlers={"count": lambda j, e: runs.append(1)}, lock_dir=tmp_path)

    threads = [threading.Thread(target=go) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert runs == [1]


# ---- a job that works in chunks ---------------------------------------------------------------------

def test_a_handler_can_ask_to_run_again(engine, tmp_path):
    job_id = queue.enqueue(engine, "crawl", "chunk", dedupe_key="links:1", max_attempts=1)

    def chunk(job, e):
        raise RunAgain(3600)

    result = tick(engine, "crawl", handlers={"chunk": chunk}, lock_dir=tmp_path)
    assert (result.processed, result.failed) == (1, 0)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT status, attempts, active_key, lease_owner, lease_expires_at, last_error, finished_at FROM jobs WHERE id=:i"), {"i": job_id}).one()
        wait = conn.execute(text("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), run_after) FROM jobs WHERE id=:i"), {"i": job_id}).scalar()
    assert tuple(row) == ("queued", 0, "links:1", None, None, None, None)
    assert 3500 < wait <= 3600


def test_a_chunked_job_runs_to_its_end_as_one_job(engine, tmp_path):
    job_id = queue.enqueue(engine, "crawl", "chunk", max_attempts=1)
    runs = []

    def chunk(job, e):
        runs.append(job.id)
        if len(runs) < queue.MAX_LEASE_LOSSES * 3:
            raise RunAgain()

    result = tick(engine, "crawl", handlers={"chunk": chunk}, lock_dir=tmp_path, budget_seconds=20)
    assert runs == [job_id] * queue.MAX_LEASE_LOSSES * 3
    assert (result.processed, result.failed) == (len(runs), 0)
    assert status_of(engine, job_id) == "done"
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM jobs")).scalar() == 1


def test_other_jobs_in_the_lane_get_turns_between_chunks(engine, tmp_path):
    long_one = queue.enqueue(engine, "crawl", "long", max_attempts=1)
    other_long = queue.enqueue(engine, "crawl", "long", max_attempts=1)
    short_one = queue.enqueue(engine, "crawl", "short")
    order = []
    chunks = {long_one: 3, other_long: 3}

    def long_job(job, e):
        order.append(job.id)
        chunks[job.id] -= 1
        if chunks[job.id]:
            raise RunAgain()

    def short_job(job, e):
        order.append(job.id)

    tick(engine, "crawl", handlers={"long": long_job, "short": short_job}, lock_dir=tmp_path)
    assert order == [long_one, other_long, short_one, long_one, other_long, long_one, other_long]


def test_a_job_waiting_for_later_leaves_the_lane_to_the_others(engine, tmp_path):
    paused = queue.enqueue(engine, "crawl", "paused", max_attempts=1)
    other = queue.enqueue(engine, "crawl", "other")

    def pause(job, e):
        raise RunAgain(86_400)

    result = tick(engine, "crawl", handlers={"paused": pause, "other": lambda j, e: None}, lock_dir=tmp_path)
    assert result.processed == 2
    assert status_of(engine, paused) == "queued"
    assert status_of(engine, other) == "done"


def test_a_tick_ends_on_time_however_many_chunks_are_left(engine, tmp_path):
    queue.enqueue(engine, "crawl", "chunk", max_attempts=1)
    runs = []

    def chunk(job, e):
        runs.append(1)
        time.sleep(0.2)
        raise RunAgain()

    tick(engine, "crawl", handlers={"chunk": chunk}, lock_dir=tmp_path, budget_seconds=0.3)
    assert 1 <= len(runs) <= 3
