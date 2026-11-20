"""Bought links and Boost URL: the price billed beside the real cost, an overall link budget, and traffic boosts

Revision ID: c4d5e6f7a8b9
Revises: b8c2d3e4f5a6
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "c4d5e6f7a8b9"
down_revision = "b8c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("backlinks", sa.Column("billed_text", sa.String(80), nullable=True))
    op.add_column("backlinks", sa.Column("billed", sa.Numeric(12, 2), nullable=True))
    op.add_column("backlink_budgets", sa.Column("total", sa.Numeric(14, 2), nullable=True))
    op.create_table(
        "traffic_boosts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("keywords", sa.JSON(), nullable=False),
        sa.Column("started", sa.Date(), nullable=False),
        sa.Column("ended", sa.Date(), nullable=True),
        sa.Column("source", sa.String(120), nullable=True),
        sa.Column("billed_text", sa.String(60), nullable=True),
        sa.Column("billed", sa.Numeric(12, 2), nullable=True),
        sa.Column("cost_text", sa.String(60), nullable=True),
        sa.Column("cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_traffic_boosts_site_started", "traffic_boosts", ["site_id", "started"])


def downgrade() -> None:
    op.drop_table("traffic_boosts")
    op.drop_column("backlink_budgets", "total")
    op.drop_column("backlinks", "billed")
    op.drop_column("backlinks", "billed_text")
