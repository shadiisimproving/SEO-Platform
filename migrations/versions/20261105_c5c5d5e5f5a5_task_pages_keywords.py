"""A task can say which pages and keywords it's about

Revision ID: c5c5d5e5f5a5
Revises: b4c4d4e4f4a4
"""
import sqlalchemy as sa
from alembic import op

revision = "c5c5d5e5f5a5"
down_revision = "b4c4d4e4f4a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("pages", sa.JSON(), nullable=True))
    op.add_column("tasks", sa.Column("keywords", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "keywords")
    op.drop_column("tasks", "pages")
