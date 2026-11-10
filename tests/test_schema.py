"""The worker refuses to run against a database the code doesn't match."""
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from seo.core.models import Base
from alembic.script import ScriptDirectory

from seo.core.schema import SchemaMismatch, _alembic_config, assert_schema_current, mark_breaking


def test_current_schema_passes(engine):
    assert_schema_current(engine)


@pytest.fixture
def stored(engine):
    """Sets the revision the database says it's at, and the breaking mark, then puts both back."""
    with engine.connect() as conn:
        head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()

    def put(revision, breaking=None):
        with engine.begin() as conn:
            conn.execute(text("UPDATE alembic_version SET version_num=:r"), {"r": revision})
            if breaking:
                mark_breaking(conn, breaking)

    yield put
    with engine.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num=:h"), {"h": head})
        conn.execute(text("ALTER TABLE alembic_version COMMENT = ''"))


def _older_revision():
    return ScriptDirectory.from_config(_alembic_config()).get_revision("head").down_revision


def test_old_schema_is_refused(engine, stored):
    stored(_older_revision())
    with pytest.raises(SchemaMismatch) as err:
        assert_schema_current(engine)
    assert "alembic upgrade head" in str(err.value)


def test_a_database_newer_than_the_code_runs_with_a_warning(engine, stored, caplog):
    """What going back to an older release leaves: the database has a migration this code has no file for."""
    stored("f00dnewer0001")
    assert_schema_current(engine)
    assert "newer than this code" in caplog.text and "f00dnewer0001" in caplog.text


def test_a_breaking_migration_this_code_does_not_know_is_refused(engine, stored):
    stored("f00dnewer0002", breaking="f00dnewer0001")
    with pytest.raises(SchemaMismatch) as err:
        assert_schema_current(engine)
    assert "f00dnewer0001" in str(err.value) and "restore" in str(err.value)


def test_a_breaking_migration_this_code_already_has_is_fine(engine, stored, caplog):
    """Code from after the breaking change can still go back over newer, ordinary migrations."""
    stored("f00dnewer0003", breaking=_older_revision())
    assert_schema_current(engine)
    assert "newer than this code" in caplog.text


def test_the_breaking_mark_takes_only_a_revision_id(engine):
    with engine.begin() as conn, pytest.raises(ValueError):
        mark_breaking(conn, "x'; DROP TABLE sites; --")


def test_models_describe_every_table_the_migrations_made(engine):
    actual = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert actual == set(Base.metadata.tables)


def test_models_match_the_migrations_columns_and_indexes(engine):
    """What `alembic revision --autogenerate` would see. A model out of step would turn into a bad migration."""
    with engine.connect() as conn:
        differences = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert differences == []


def test_models_match_nullable_defaults_and_keys(engine):
    seen = inspect(engine)
    for name, table in Base.metadata.tables.items():
        columns = {c["name"]: c for c in seen.get_columns(name)}
        assert set(columns) == set(table.columns.keys()), name
        for column in table.columns:
            assert columns[column.name]["nullable"] == column.nullable, f"{name}.{column.name}"
            assert (columns[column.name]["default"] is not None) == (column.server_default is not None), f"{name}.{column.name}"
        assert set(seen.get_pk_constraint(name)["constrained_columns"]) == {c.name for c in table.primary_key.columns}, name
        foreign = {(tuple(f["constrained_columns"]), f["referred_table"], (f.get("options") or {}).get("ondelete")) for f in seen.get_foreign_keys(name)}
        expected = {((f.parent.name,), f.column.table.name, f.ondelete) for f in table.foreign_keys}
        assert foreign == expected, name
