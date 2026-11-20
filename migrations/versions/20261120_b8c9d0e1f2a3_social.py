"""social: the Social section's posts and comments for LinkedIn and X, their sources, the daily runs and the Writing guide

Revision ID: b8c9d0e1f2a3
Revises: a7b1c2d3e4f5
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b8c9d0e1f2a3"
down_revision = "a7b1c2d3e4f5"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "social_settings",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("guide", mysql.MEDIUMTEXT(), nullable=True),
        sa.Column("niche", sa.Text(), nullable=True),
        sa.Column("guide_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("rules", sa.JSON(), nullable=True),
        sa.Column("proposals", sa.JSON(), nullable=True),
        sa.Column("token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("token_last4", sa.String(4), nullable=True),
        sa.Column("mail_host", sa.String(200), nullable=True),
        sa.Column("mail_user", sa.String(200), nullable=True),
        sa.Column("mail_secret", sa.Text(), nullable=True),
        sa.Column("updated_at", STAMP, server_default=NOW3, nullable=False),
    )
    op.create_table(
        "social_sources",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("address", sa.String(500), nullable=False),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_ok_at", STAMP, nullable=True),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
        sa.CheckConstraint("kind IN ('rss', 'mail')", name="ck_social_sources_kind"),
        sa.UniqueConstraint("site_id", "kind", "address", name="uq_social_sources_address"),
    )
    op.create_table(
        "social_topics",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("origin", sa.String(10), nullable=False),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("social_sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("link", sa.String(1000), nullable=True),
        sa.Column("link_hash", sa.String(32), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("lang", sa.String(5), nullable=True),
        sa.Column("published_at", STAMP, nullable=True),
        sa.Column("found_at", STAMP, server_default=NOW3, nullable=False),
        sa.UniqueConstraint("site_id", "link_hash", name="uq_social_topics_link"),
    )
    op.create_index("ix_social_topics_recent", "social_topics", ["site_id", "found_at"])
    op.create_table(
        "social_runs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("stages", sa.JSON(), nullable=True),
        sa.Column("trends", sa.JSON(), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
        sa.UniqueConstraint("site_id", "run_date", name="uq_social_runs_day"),
    )
    op.create_table(
        "social_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("platform", sa.String(10), nullable=False),
        sa.Column("key_hash", sa.String(32), nullable=False),
        sa.Column("topic_id", sa.BigInteger(), sa.ForeignKey("social_topics.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_url", sa.String(1000), nullable=True),
        sa.Column("source_author", sa.String(200), nullable=True),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("source_at", STAMP, nullable=True),
        sa.Column("lang", sa.String(5), server_default="ar", nullable=False),
        sa.Column("angle", sa.Text(), nullable=True),
        sa.Column("draft", sa.Text(), nullable=True),
        sa.Column("final", sa.Text(), nullable=True),
        sa.Column("status", sa.String(10), server_default="new", nullable=False),
        sa.Column("skip_reason", sa.String(300), nullable=True),
        sa.Column("guide_version", sa.Integer(), nullable=True),
        sa.Column("link_checked", sa.Boolean(), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
        sa.Column("updated_at", STAMP, server_default=NOW3, nullable=False),
        sa.Column("posted_at", STAMP, nullable=True),
        sa.CheckConstraint("kind IN ('post', 'comment')", name="ck_social_items_kind"),
        sa.CheckConstraint("platform IN ('x', 'linkedin')", name="ck_social_items_platform"),
        sa.CheckConstraint("status IN ('new', 'rewrite', 'approved', 'posted', 'skipped')", name="ck_social_items_status"),
        sa.UniqueConstraint("site_id", "kind", "platform", "key_hash", name="uq_social_items_key"),
    )
    op.create_index("ix_social_items_day", "social_items", ["site_id", "run_date", "status"])


def downgrade() -> None:
    op.drop_table("social_items")
    op.drop_table("social_runs")
    op.drop_index("ix_social_topics_recent", table_name="social_topics")
    op.drop_table("social_topics")
    op.drop_table("social_sources")
    op.drop_table("social_settings")
