"""Tests run on a real MariaDB test database, built from the real migrations."""
import pytest
from sqlalchemy import text

from seo.core.db import make_engine


@pytest.fixture(scope="session")
def schema():
    """Drop everything and migrate, once per run. Refuses any non-test database."""
    from seo.core.schema import upgrade_to_head

    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "refusing to reset a non-test database"
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for (table,) in conn.execute(text("SHOW TABLES")).all():
            conn.execute(text(f"DROP TABLE `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    upgrade_to_head(engine)
    engine.dispose()


@pytest.fixture
def engine(schema):
    # A connection an earlier test left unreferenced still holds its open transaction (and a metadata lock) until Python's
    # garbage collector closes it; under a long run that came too late and TRUNCATE below waited for ever (2026-11-23,
    # test_competitor_final after test_collectors). Collecting first closes such connections, and the lock wait is capped
    # so a leak fails loudly instead of hanging the suite.
    import gc
    gc.collect()
    engine = make_engine(test=True)
    with engine.begin() as conn:
        conn.execute(text("SET SESSION lock_wait_timeout = 60"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for (table,) in conn.execute(text("SHOW TABLES")).all():
            if table != "alembic_version":
                conn.execute(text(f"TRUNCATE TABLE `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def no_real_archive(monkeypatch):
    """Adding a competitor queues a Wayback Machine and registry look-up. No test may reach the real ones."""
    from seo.competitors import history
    from seo.uptime import service as uptime

    def offline(*_args):
        raise history.HistoryFailed("tests run offline")

    def no_registry(domain):
        raise uptime.NoRdap(domain)

    monkeypatch.setattr(history, "cdx_lookup", offline)
    monkeypatch.setattr(uptime, "rdap_dates_lookup", no_registry)
