"""notes on a keyword, a date, a linking domain, a group of pages or a task

Revision ID: a9a9b9c9d9e9
Revises: a6a6b6c6d6e6
"""
import sqlalchemy as sa
from alembic import op

revision = "a9a9b9c9d9e9"
down_revision = "a6a6b6c6d6e6"
branch_labels = None
depends_on = None

OLD_SCOPES = "scope IN ('all', 'competitor', 'page', 'site', 'screen')"
NEW_SCOPES = "scope IN ('all', 'competitor', 'page', 'site', 'screen', 'keyword', 'date', 'domain', 'section', 'task')"


def upgrade() -> None:
    op.add_column("notes", sa.Column("keyword", sa.String(length=400), nullable=True))
    op.add_column("notes", sa.Column("keyword_hash", sa.String(length=64), nullable=True))
    op.add_column("notes", sa.Column("day", sa.Date(), nullable=True))
    op.add_column("notes", sa.Column("domain", sa.String(length=190), nullable=True))
    op.add_column("notes", sa.Column("task_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_notes_task", "notes", "tasks", ["task_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_notes_keyword", "notes", ["keyword_hash", "site_id"], unique=False)
    op.create_index("ix_notes_day", "notes", ["day", "site_id"], unique=False)
    op.create_index("ix_notes_domain", "notes", ["domain", "site_id"], unique=False)
    op.drop_constraint("ck_notes_scope", "notes", type_="check")
    op.create_check_constraint("ck_notes_scope", "notes", NEW_SCOPES)


def downgrade() -> None:
    op.execute("DELETE FROM notes WHERE scope IN ('keyword', 'date', 'domain', 'section', 'task')")
    op.drop_constraint("ck_notes_scope", "notes", type_="check")
    op.create_check_constraint("ck_notes_scope", "notes", OLD_SCOPES)
    op.drop_index("ix_notes_domain", table_name="notes")
    op.drop_index("ix_notes_day", table_name="notes")
    op.drop_index("ix_notes_keyword", table_name="notes")
    op.drop_constraint("fk_notes_task", "notes", type_="foreignkey")
    op.drop_column("notes", "task_id")
    op.drop_column("notes", "domain")
    op.drop_column("notes", "day")
    op.drop_column("notes", "keyword_hash")
    op.drop_column("notes", "keyword")
