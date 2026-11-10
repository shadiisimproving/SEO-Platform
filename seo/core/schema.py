"""Migrations, and the check that code and database match."""
from __future__ import annotations

import logging

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine, text

from seo import config

log = logging.getLogger(__name__)
BREAKING = "breaking:"


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


def mark_breaking(conn: Connection, revision: str) -> None:
    """Call from the upgrade() of a migration that older code can't run on: one that drops or renames something, or adds
    a required column with no default. Going back to code from before it is then refused. The mark is a comment on
    Alembic's own table, so code that doesn't know the migration can still read it, and a later mark replaces it."""
    if not revision.replace("_", "").isalnum():
        raise ValueError(f"Not a revision id: {revision!r}")
    conn.execute(text(f"ALTER TABLE alembic_version COMMENT = '{BREAKING}{revision}'"))


def _breaking_revision(conn: Connection) -> str | None:
    comment = conn.execute(text(
        "SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alembic_version'"
    )).scalar()
    return comment[len(BREAKING):] if comment and comment.startswith(BREAKING) else None


def assert_schema_current(engine: Engine) -> None:
    """Stops a tick from writing to a database this code is ahead of, or one a breaking migration changed.

    A database ahead of the code (a revision this code has no file for) is what going back to an older release leaves.
    Migrations only add things, so the older code runs on it, with a warning, unless a migration it doesn't know was
    marked breaking."""
    script = ScriptDirectory.from_config(_alembic_config())
    head = script.get_current_head()
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
        breaking = _breaking_revision(conn)
    if current == head:
        return
    known = {revision.revision for revision in script.walk_revisions()}
    if current is None or current in known:
        raise SchemaMismatch(
            f"Database is at {current}, code expects {head}. Run: .venv/bin/alembic upgrade head"
        )
    if breaking and breaking not in known:
        raise SchemaMismatch(
            f"Database is at {current}, newer than this code ({head}), and migration {breaking} changed it in a way this "
            "code can't use. Upload a newer version, or restore the database copy taken before that migration."
        )
    log.warning(
        "Database is at %s, newer than this code (%s). Running anyway, because migrations only add things. "
        "This is normal after going back to an older release; upload a fixed version when you can.", current, head,
    )


if __name__ == "__main__":  # python -m seo.core.schema: the release script asks this before going back to older code
    from seo.core.db import make_engine

    logging.basicConfig(format="%(message)s")
    try:
        assert_schema_current(make_engine())
    except SchemaMismatch as exc:
        raise SystemExit(str(exc))
    print("This code can run on the database as it is.")
