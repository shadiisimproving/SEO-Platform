"""page boosts: traffic sent to one page, recorded by a person, marked on the keyword panel's history chart

Revision ID: c4d8e2f6a1b3
Revises: e7f3a9c1d5b2
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "c4d8e2f6a1b3"
down_revision = "e7f3a9c1d5b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "page_boosts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_url", sa.Text(), nullable=False),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("ended_on", sa.Date(), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.Index("ix_page_boosts_site", "site_id", "started_on"),
    )


def downgrade() -> None:
    op.drop_table("page_boosts")
