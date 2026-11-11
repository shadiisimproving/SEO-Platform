"""competitors: how each site is followed (every page, sitemap, WordPress, tiers), whether its dates proved honest,
the weekly Firecrawl re-read the owner switched on, and how many words a text edit changed

Revision ID: c7e7a7b7c7d7
Revises: d4e8a2c6b1f3
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "c7e7a7b7c7d7"
down_revision = "d4e8a2c6b1f3"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)


def upgrade() -> None:
    op.add_column("competitor_crawls", sa.Column("follow_mode", sa.String(12), nullable=True))  # all, sitemap, wordpress, tiers
    op.add_column("competitor_crawls", sa.Column("dates_agreed", sa.Integer(), server_default="0", nullable=False))
    op.add_column("competitor_crawls", sa.Column("dates_missed", sa.Integer(), server_default="0", nullable=False))
    op.add_column("competitor_crawls", sa.Column("wp_api", sa.String(4), nullable=True))  # yes / no, asked again weekly
    op.add_column("competitor_crawls", sa.Column("wp_checked_at", STAMP, nullable=True))
    op.add_column("competitor_crawls", sa.Column("fc_weekly", sa.Boolean(), server_default=sa.text("0"), nullable=False))
    op.add_column("change_events", sa.Column("changed_words", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("change_events", "changed_words")
    for name in ("fc_weekly", "wp_checked_at", "wp_api", "dates_missed", "dates_agreed", "follow_mode"):
        op.drop_column("competitor_crawls", name)
