"""The worker refuses to run against a database the code doesn't match."""
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from seo.core.models import Base
from seo.core.schema import SchemaMismatch, assert_schema_current


def test_current_schema_passes(engine):
    assert_schema_current(engine)


def test_old_schema_is_refused(engine):
    with engine.connect() as conn:
        head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    with engine.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num='0000old'"))
    try:
        with pytest.raises(SchemaMismatch) as err:
            assert_schema_current(engine)
        assert "alembic upgrade head" in str(err.value)
    finally:
        with engine.begin() as conn:
            conn.execute(text("UPDATE alembic_version SET version_num=:h"), {"h": head})


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
