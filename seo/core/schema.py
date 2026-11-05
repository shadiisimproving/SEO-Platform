"""Migrations, and the check that code and database match."""
from __future__ import annotations

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine

from seo import config


class SchemaMismatch(Exception):
    pass


def _alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(config.ROOT / "migrations"))
    return cfg


def upgrade_to_head(engine: Engine) -> None:
    cfg = _alembic_config()
    cfg.attributes["engine"] = engine
    command.upgrade(cfg, "head")


def assert_schema_current(engine: Engine) -> None:
    """Stops a tick from writing to a database an old or new migration left behind."""
    head = ScriptDirectory.from_config(_alembic_config()).get_current_head()
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
    if current != head:
        raise SchemaMismatch(
            f"Database is at {current}, code expects {head}. Run: .venv/bin/alembic upgrade head"
        )
