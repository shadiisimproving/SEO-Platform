"""tasks: who created the task, set by the app from the signed-in account and never changed (owner_label is who it's assigned to)

Revision ID: f3c1d2e4a5b6
Revises: e1a5c3c3e5a1
"""
import sqlalchemy as sa
from alembic import op

revision = "f3c1d2e4a5b6"
down_revision = "e1a5c3c3e5a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("created_by", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "created_by")
