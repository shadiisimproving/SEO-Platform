"""The database rules every later phase relies on, checked on the real MariaDB."""
from sqlalchemy import text

from seo.core.db import make_engine


def test_session_time_zone_is_utc():
    engine = make_engine(test=True)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT @@session.time_zone")).scalar() == "+00:00"


def test_now_matches_utc_timestamp():
    # The server's own zone is SYSTEM, so a session that forgot to force UTC
    # would show a difference of hours here.
    engine = make_engine(test=True)
    with engine.connect() as conn:
        gap = conn.execute(text("SELECT ABS(TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP()))")).scalar()
    assert gap <= 2


def test_pool_stays_well_under_the_hosting_limit():
    # o2switch allows 35 connections per DB user, shared by every process.
    engine = make_engine(test=True)
    assert engine.pool.size() <= 3
    assert engine.pool._max_overflow <= 2


def test_connects_through_127_0_0_1():
    engine = make_engine(test=True)
    assert engine.url.host == "127.0.0.1"


def test_uses_read_committed():
    # The job claim needs READ COMMITTED: under REPEATABLE READ, SKIP LOCKED
    # sees a stale snapshot.
    engine = make_engine(test=True)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT @@session.tx_isolation")).scalar() == "READ-COMMITTED"


def test_test_engine_cannot_point_at_the_main_database():
    assert make_engine(test=True).url.database.endswith("_test")
