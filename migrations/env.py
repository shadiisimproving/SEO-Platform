"""Alembic runs against the app's own engine, so it gets the same UTC and pool rules."""
from alembic import context

from seo.core.db import make_engine
from seo.core.models import Base

target_metadata = Base.metadata

engine = context.config.attributes.get("engine") or make_engine()
with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()
    connection.commit()
