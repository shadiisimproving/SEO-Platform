"""google_updates: Google's confirmed ranking updates, read from its Search Status Dashboard

Revision ID: b8c2d3e4f5a6
Revises: e7f3a9c1d5b2
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b8c2d3e4f5a6"
down_revision = "e7f3a9c1d5b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "google_updates",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("began", sa.Date(), nullable=False),
        sa.Column("ended", sa.Date(), nullable=True),
        sa.Column("url", sa.String(300), nullable=False),
        sa.Column("read_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_google_updates_began", "google_updates", ["began"])


def downgrade() -> None:
    op.drop_table("google_updates")
