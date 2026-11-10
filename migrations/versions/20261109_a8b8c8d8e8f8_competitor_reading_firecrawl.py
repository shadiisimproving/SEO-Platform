"""competitor reading: how a site lists its pages, whether that list was cut, and Firecrawl as an asked-for backup

Revision ID: a8b8c8d8e8f8
Revises: f6f6a6b6c6d6
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "a8b8c8d8e8f8"
down_revision = "f6f6a6b6c6d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # sitemap, feed (an RSS or Atom feed only) or links (the start page's own links only). Empty until the next read.
    op.add_column("competitor_crawls", sa.Column("list_source", sa.String(10), nullable=True))
    op.add_column("competitor_crawls", sa.Column("list_capped", sa.Boolean(), server_default=sa.text("0"), nullable=False))
    # The last Firecrawl run someone asked for on this competitor: queued, running, ok or failed.
    op.add_column("competitor_crawls", sa.Column("fc_status", sa.String(10), nullable=True))
    op.add_column("competitor_crawls", sa.Column("fc_action", sa.String(6), nullable=True))
    op.add_column("competitor_crawls", sa.Column("fc_message", sa.String(500), nullable=True))
    op.add_column("competitor_crawls", sa.Column("fc_done", sa.Integer(), server_default="0", nullable=False))
    op.add_column("competitor_crawls", sa.Column("fc_asked", sa.Integer(), server_default="0", nullable=False))
    op.add_column("competitor_crawls", sa.Column("fc_finished_at", mysql.DATETIME(fsp=3), nullable=True))
    # firecrawl when the saved copy came from Firecrawl: the daily reader then leaves the page alone,
    # so an empty JavaScript shell never replaces it and shows as a fake edit.
    op.add_column("pages", sa.Column("read_with", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column("pages", "read_with")
    for name in ("fc_finished_at", "fc_asked", "fc_done", "fc_message", "fc_action", "fc_status", "list_capped", "list_source"):
        op.drop_column("competitor_crawls", name)
