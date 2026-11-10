"""search: queries per target country, each site's target countries, the bell's read state per person, Google's AI report uploads

Revision ID: bdd862347612
Revises: a6dcb1508d7d
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "bdd862347612"
down_revision = "a6dcb1508d7d"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    # Search Console's query report a second time, filtered to one country (Google's alpha-3, lower case, as gsc_country).
    op.create_table(
        "gsc_query_country",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("country", sa.String(3), primary_key=True),
        sa.Column("query_hash", sa.String(32), primary_key=True),
        sa.Column("query", sa.String(500), nullable=False),
        sa.Column("clicks", sa.Integer(), server_default="0", nullable=False),
        sa.Column("impressions", sa.Integer(), server_default="0", nullable=False),
        sa.Column("position", sa.Float(), nullable=True),
    )
    op.create_index("ix_gsc_query_country_hash", "gsc_query_country", ["site_id", "country", "query_hash", "day"])
    # No row for a site: its countries are picked by itself (the top one or two by clicks).
    op.create_table(
        "site_search_countries",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("country", sa.String(3), primary_key=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
    )
    # notifications.read_at stays for the app without sign-in; with accounts each person has their own.
    op.create_table(
        "notification_reads",
        sa.Column("notification_id", sa.BigInteger(), sa.ForeignKey("notifications.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("read_at", STAMP, server_default=NOW3, nullable=False),
    )
    op.create_table(
        "gsc_ai_reports",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("search_type", sa.String(20), server_default="web", nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("file_name", sa.String(200), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("uploaded_at", STAMP, server_default=NOW3, nullable=False),
        sa.UniqueConstraint("site_id", "search_type", "period_start", "period_end", name="uq_gsc_ai_report_period"),
    )


def downgrade() -> None:
    op.drop_table("gsc_ai_reports")
    op.drop_table("notification_reads")
    op.drop_table("site_search_countries")
    op.drop_index("ix_gsc_query_country_hash", table_name="gsc_query_country")
    op.drop_table("gsc_query_country")
