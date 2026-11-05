"""Run by test_runner as a separate process, which the test then kills with -9."""
import sys
import time

from sqlalchemy import text

from seo.core.db import make_engine
from seo.worker.runner import tick


def write_then_hang(job, engine):
    with engine.begin() as conn:
        inserted = conn.execute(
            text("INSERT IGNORE INTO kill_test_rows (k) VALUES (:k)"), {"k": job.payload["k"]}
        ).rowcount
    if inserted:
        # First run: the write is done, now hang so the test can kill this process.
        time.sleep(600)


if __name__ == "__main__":
    engine = make_engine(test=True)
    result = tick(
        engine,
        "killtest",
        handlers={"write_then_hang": write_then_hang},
        lock_dir=sys.argv[1],
        lease_seconds=2,
        heartbeat_seconds=600,
        budget_seconds=600,
    )
    print(result)
