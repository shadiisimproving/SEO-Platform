"""keyword check: keywords typed to see which competitors rank for them, checked only when asked

Revision ID: b9c9d9e9f9a9
Revises: a8b8c8d8e8f8
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b9c9d9e9f9a9"
down_revision = "a8b8c8d8e8f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Kept apart from site_keywords: these never join Refresh, the Keywords screen or competitor suggestions.
    op.create_table(
        "probe_keywords",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("keyword_id", sa.BigInteger(), sa.ForeignKey("keywords.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.UniqueConstraint("site_id", "keyword_id", name="uq_probe_keyword"),
    )
    op.create_table(
        "probe_runs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("engine", sa.String(12), nullable=False),
        sa.Column("only_ids", sa.JSON(), nullable=True),  # one keyword's own button; empty means the whole list
        sa.Column("status", sa.String(10), server_default="queued", nullable=False),  # queued, running, complete, waiting
        sa.Column("total", sa.Integer(), server_default="0", nullable=False),
        sa.Column("checked", sa.Integer(), server_default="0", nullable=False),
        sa.Column("failed", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tool", sa.String(40), nullable=True),
        sa.Column("stop_reason", sa.String(300), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.Column("finished_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.Index("ix_probe_runs_site", "site_id", "id"),
    )


def downgrade() -> None:
    op.drop_table("probe_runs")
    op.drop_table("probe_keywords")
