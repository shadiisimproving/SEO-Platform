"""change summaries

Revision ID: f8f8a8b8c8d8
Revises: e7e7f7a7b7c7
"""
import sqlalchemy as sa
from alembic import op

revision = "f8f8a8b8c8d8"
down_revision = "e7e7f7a7b7c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("change_events", sa.Column("summaries", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("change_events", "summaries")
