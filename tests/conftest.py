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
    engine = make_engine(test=True)
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for (table,) in conn.execute(text("SHOW TABLES")).all():
            if table != "alembic_version":
                conn.execute(text(f"TRUNCATE TABLE `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    yield engine
    engine.dispose()
