"""A page drop on Today can be marked as seen

Revision ID: d6d6e6f6a6b6
Revises: c5c5d5e5f5a5
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "d6d6e6f6a6b6"
down_revision = "c5c5d5e5f5a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "today_seen",
        sa.Column("item_key", sa.String(64), primary_key=True),
        sa.Column("hidden_until", sa.Date(), nullable=False),
        sa.Column("seen_at", DATETIME(fsp=3), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(3)")),
    )


def downgrade() -> None:
    op.drop_table("today_seen")
