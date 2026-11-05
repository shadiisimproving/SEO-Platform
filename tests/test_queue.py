"""The job queue: nothing runs twice, nothing is lost when a process dies."""
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import text

from seo.worker import queue


def job_row(engine, job_id):
    with engine.connect() as conn:
        return conn.execute(text("SELECT * FROM jobs WHERE id=:i"), {"i": job_id}).mappings().one()


def expire_lease(engine, job_id):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id=:i"),
            {"i": job_id},
        )


def test_four_workers_never_claim_the_same_job(engine):
    for n in range(100):
        queue.enqueue(engine, "crawl", "noop", {"n": n})

    def worker(name):
        got = []
        while True:
            jobs = queue.claim(engine, "crawl", owner=name, limit=3)
            if not jobs:
                return got
            got += [j.id for j in jobs]

    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(worker, ["a", "b", "c", "d"]))

    claimed = [job_id for result in results for job_id in result]
    assert len(claimed) == 100
    assert len(set(claimed)) == 100


def test_claim_returns_kind_and_payload(engine):
    queue.enqueue(engine, "crawl", "fetch_page", {"url": "https://example.com/é"})
    job = queue.claim(engine, "crawl", owner="a")[0]
    assert job.kind == "fetch_page"
    assert job.payload == {"url": "https://example.com/é"}


def test_lanes_do_not_see_each_others_jobs(engine):
    queue.enqueue(engine, "crawl", "noop")
    assert queue.claim(engine, "refresh", owner="a") == []
    assert len(queue.claim(engine, "crawl", owner="a")) == 1


def test_job_scheduled_for_later_is_not_claimed(engine):
    queue.enqueue(engine, "crawl", "noop", run_after_seconds=3600)
    assert queue.claim(engine, "crawl", owner="a") == []


def test_dedupe_key_blocks_a_second_active_job(engine):
    first = queue.enqueue(engine, "collectors", "gsc", dedupe_key="gsc:site1")
    second = queue.enqueue(engine, "collectors", "gsc", dedupe_key="gsc:site1")
    assert first is not None
    assert second is None


def test_dedupe_key_blocks_while_running(engine):
    queue.enqueue(engine, "collectors", "gsc", dedupe_key="gsc:site1")
    queue.claim(engine, "collectors", owner="a")
    assert queue.enqueue(engine, "collectors", "gsc", dedupe_key="gsc:site1") is None


def test_dedupe_key_is_free_again_after_the_job_finishes(engine):
    queue.enqueue(engine, "collectors", "gsc", dedupe_key="gsc:site1")
    job = queue.claim(engine, "collectors", owner="a")[0]
    assert queue.complete(engine, job.id, owner="a")
    assert queue.enqueue(engine, "collectors", "gsc", dedupe_key="gsc:site1") is not None


def test_renew_extends_the_lease_only_for_the_owner(engine):
    job_id = queue.enqueue(engine, "crawl", "noop")
    queue.claim(engine, "crawl", owner="a", lease_seconds=60)
    before = job_row(engine, job_id)["lease_expires_at"]
    assert queue.renew(engine, job_id, owner="b", lease_seconds=600) is False
    assert job_row(engine, job_id)["lease_expires_at"] == before
    assert queue.renew(engine, job_id, owner="a", lease_seconds=600) is True
    assert job_row(engine, job_id)["lease_expires_at"] > before


def test_complete_only_by_the_owner(engine):
    job_id = queue.enqueue(engine, "crawl", "noop")
    queue.claim(engine, "crawl", owner="a")
    assert queue.complete(engine, job_id, owner="b") is False
    assert job_row(engine, job_id)["status"] == "running"
    assert queue.complete(engine, job_id, owner="a") is True
    assert job_row(engine, job_id)["status"] == "done"


def test_expired_lease_requeues_without_counting_as_a_failed_attempt(engine):
    # Hosting killing a process mid-job must not use up the job's attempts.
    job_id = queue.enqueue(engine, "crawl", "noop")
    queue.claim(engine, "crawl", owner="a")
    expire_lease(engine, job_id)
    result = queue.recover_expired(engine)
    row = job_row(engine, job_id)
    assert result == {"requeued": 1, "dead": 0}
    assert row["status"] == "queued"
    assert row["attempts"] == 0
    assert row["lease_losses"] == 1
    assert row["lease_owner"] is None


def test_unexpired_lease_is_left_alone(engine):
    queue.enqueue(engine, "crawl", "noop")
    queue.claim(engine, "crawl", owner="a", lease_seconds=600)
    assert queue.recover_expired(engine) == {"requeued": 0, "dead": 0}


def test_late_worker_cannot_finish_a_job_that_was_taken_back(engine):
    job_id = queue.enqueue(engine, "crawl", "noop")
    queue.claim(engine, "crawl", owner="a")
    expire_lease(engine, job_id)
    queue.recover_expired(engine)
    queue.claim(engine, "crawl", owner="b")
    assert queue.complete(engine, job_id, owner="a") is False
    assert job_row(engine, job_id)["lease_owner"] == "b"


def test_five_lost_leases_make_a_job_dead(engine):
    # A job that keeps killing its process must not loop forever.
    job_id = queue.enqueue(engine, "crawl", "noop", dedupe_key="k")
    for _ in range(5):
        queue.claim(engine, "crawl", owner="a")
        expire_lease(engine, job_id)
        result = queue.recover_expired(engine)
    row = job_row(engine, job_id)
    assert result == {"requeued": 0, "dead": 1}
    assert row["status"] == "dead"
    assert "lease" in row["last_error"]
    # A dead job must not block a new one forever.
    assert queue.enqueue(engine, "crawl", "noop", dedupe_key="k") is not None


def test_failure_requeues_with_a_backoff_then_goes_dead_after_three(engine):
    job_id = queue.enqueue(engine, "crawl", "noop")

    queue.claim(engine, "crawl", owner="a")
    assert queue.fail(engine, job_id, owner="a", error="boom 1") == "queued"
    row = job_row(engine, job_id)
    assert row["attempts"] == 1
    assert row["last_error"] == "boom 1"
    assert queue.claim(engine, "crawl", owner="a") == []  # backoff holds it

    for n in (2, 3):
        with engine.begin() as conn:
            conn.execute(text("UPDATE jobs SET run_after = UTC_TIMESTAMP(3) WHERE id=:i"), {"i": job_id})
        queue.claim(engine, "crawl", owner="a")
        status = queue.fail(engine, job_id, owner="a", error=f"boom {n}")

    row = job_row(engine, job_id)
    assert status == "dead"
    assert row["status"] == "dead"
    assert row["last_error"] == "boom 3"


def test_fail_ignores_a_worker_that_lost_the_job(engine):
    job_id = queue.enqueue(engine, "crawl", "noop")
    queue.claim(engine, "crawl", owner="a")
    assert queue.fail(engine, job_id, owner="b", error="x") is None
    assert job_row(engine, job_id)["attempts"] == 0


def test_long_error_is_cut_not_rejected(engine):
    job_id = queue.enqueue(engine, "crawl", "noop")
    queue.claim(engine, "crawl", owner="a")
    queue.fail(engine, job_id, owner="a", error="x" * 100_000)
    assert len(job_row(engine, job_id)["last_error"]) <= 2000


def test_oldest_due_job_is_claimed_first(engine):
    first = queue.enqueue(engine, "crawl", "noop")
    queue.enqueue(engine, "crawl", "noop")
    assert queue.claim(engine, "crawl", owner="a")[0].id == first


# ---- a job that asks to carry on later --------------------------------------------------------------

def test_run_again_puts_the_same_job_back_in_the_queue(engine):
    job_id = queue.enqueue(engine, "crawl", "scan", {"scan_id": 1}, dedupe_key="links:1", max_attempts=1)
    queue.claim(engine, "crawl", owner="a")
    assert queue.run_again(engine, job_id, owner="a", delay_seconds=3600) is True
    row = job_row(engine, job_id)
    assert row["status"] == "queued"
    assert row["active_key"] == "links:1"
    assert row["attempts"] == 0
    assert row["lease_owner"] is None and row["lease_expires_at"] is None
    assert row["finished_at"] is None
    with engine.connect() as conn:
        wait = conn.execute(text("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), run_after) FROM jobs WHERE id=:i"), {"i": job_id}).scalar()
    assert 3500 < wait <= 3600
    assert queue.claim(engine, "crawl", owner="a") == []  # not yet


def test_a_job_waiting_to_run_again_keeps_its_key(engine):
    job_id = queue.enqueue(engine, "crawl", "scan", dedupe_key="links:1")
    queue.claim(engine, "crawl", owner="a")
    queue.run_again(engine, job_id, owner="a", delay_seconds=3600)
    assert queue.enqueue(engine, "crawl", "scan", dedupe_key="links:1") is None


def test_run_again_at_once_can_be_claimed_at_once(engine):
    job_id = queue.enqueue(engine, "crawl", "scan")
    queue.claim(engine, "crawl", owner="a")
    queue.run_again(engine, job_id, owner="a")
    assert [j.id for j in queue.claim(engine, "crawl", owner="b")] == [job_id]


def test_run_again_only_by_the_worker_holding_the_job(engine):
    job_id = queue.enqueue(engine, "crawl", "scan")
    queue.claim(engine, "crawl", owner="a")
    assert queue.run_again(engine, job_id, owner="b") is False
    assert job_row(engine, job_id)["status"] == "running"


def test_a_late_worker_cannot_put_back_a_job_that_was_taken_back(engine):
    job_id = queue.enqueue(engine, "crawl", "scan")
    queue.claim(engine, "crawl", owner="a")
    expire_lease(engine, job_id)
    queue.recover_expired(engine)
    queue.claim(engine, "crawl", owner="b")
    assert queue.run_again(engine, job_id, owner="a", delay_seconds=3600) is False
    assert job_row(engine, job_id)["lease_owner"] == "b"


def test_a_job_that_gets_somewhere_is_not_one_that_keeps_killing_its_process(engine):
    """Over days, hosting can kill a long job's process any number of times. Only losses in a row with no progress say something is wrong."""
    job_id = queue.enqueue(engine, "crawl", "scan", max_attempts=5)
    for _ in range(queue.MAX_LEASE_LOSSES * 3):
        queue.claim(engine, "crawl", owner="a")
        expire_lease(engine, job_id)
        assert queue.recover_expired(engine) == {"requeued": 1, "dead": 0}
        queue.claim(engine, "crawl", owner="a")
        queue.fail(engine, job_id, "a", "the database went away", backoff_seconds=0)
        queue.claim(engine, "crawl", owner="a")
        assert queue.run_again(engine, job_id, owner="a") is True
    row = job_row(engine, job_id)
    assert (row["status"], row["lease_losses"], row["attempts"]) == ("queued", 0, 0)


def test_a_job_waiting_to_run_again_can_still_finish(engine):
    job_id = queue.enqueue(engine, "crawl", "scan", dedupe_key="links:1")
    queue.claim(engine, "crawl", owner="a")
    queue.run_again(engine, job_id, owner="a", delay_seconds=86_400)

    def cannot_finish():
        with engine.connect() as conn:
            return conn.execute(text(f"SELECT {queue.cannot_finish_sql(repr('links:1'))}")).scalar()

    assert cannot_finish() == 0
    queue.cancel_queued(engine, "links:1")
    assert cannot_finish() == 1
