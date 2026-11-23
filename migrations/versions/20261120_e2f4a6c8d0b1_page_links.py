"""page_links: the site's own pages each page links to, for the site map's "By links" view

One row per page that has been read since this table exists. `links` is a JSON list of page keys (host without www, path,
query) in the page's own order. A page with no row yet hasn't had its links read: the reader fetches it in full once
(no "not modified" shortcut) and the map says how many pages are still to read.

Revision ID: e2f4a6c8d0b1
Revises: d9e1f3a5c7b2
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "e2f4a6c8d0b1"
down_revision = "d9e1f3a5c7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "page_links",
        sa.Column("page_id", sa.BigInteger, sa.ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True, autoincrement=False),
        sa.Column("domain_id", sa.Integer, sa.ForeignKey("domains.id", ondelete="CASCADE"), nullable=False),
        sa.Column("links", mysql.MEDIUMTEXT, nullable=False),
        sa.Column("read_at", mysql.DATETIME(fsp=3), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(3)")),
        sa.Index("ix_page_links_domain", "domain_id"),
    )


def downgrade() -> None:
    op.drop_table("page_links")
