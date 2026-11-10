"""competitor_referrer_links: every link a competitor's backlink file lists, with its anchor text and Page Authority

Revision ID: d4e8a2c6b1f3
Revises: bdd862347612
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "d4e8a2c6b1f3"
down_revision = "bdd862347612"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    # competitor_referrers keeps one row per domain, for the gap list. This keeps every link inside it, so the list can show
    # each one's anchor text, Page Authority, the page it's on and the competitor page it points to.
    op.create_table(
        "competitor_referrer_links",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("competitor_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.String(190), nullable=False),
        # The same page can link twice, to two pages or with two anchors: one row each. The hash keeps a later upload from adding it again.
        sa.Column("link_hash", sa.String(40), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_title", sa.String(500), nullable=True),
        sa.Column("target_url", sa.Text(), nullable=True),
        sa.Column("anchor", sa.String(500), nullable=True),
        sa.Column("authority", sa.Integer(), nullable=True),
        sa.Column("page_authority", sa.Integer(), nullable=True),
        sa.Column("spam_score", sa.Float(), nullable=True),
        sa.Column("first_seen", sa.Date(), nullable=True),
        sa.Column("last_seen", sa.Date(), nullable=True),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_label", sa.String(60), nullable=True),
        sa.Column("imported_at", STAMP, server_default=NOW3, nullable=False),
        sa.UniqueConstraint("competitor_id", "link_hash", name="uq_competitor_referrer_link"),
    )
    op.create_index("ix_competitor_referrer_links_domain", "competitor_referrer_links", ["domain", "competitor_id"])


def downgrade() -> None:
    op.drop_table("competitor_referrer_links")
