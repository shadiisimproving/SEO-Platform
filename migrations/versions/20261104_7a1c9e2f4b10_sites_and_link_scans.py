"""Sites, with an explicit own or competitor kind, and link checker scans.

Revision ID: 7a1c9e2f4b10
Revises: 3176cd87030e
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "7a1c9e2f4b10"
down_revision = "3176cd87030e"
branch_labels = None
depends_on = None

NOW3 = sa.text("CURRENT_TIMESTAMP(3)")
Stamp = DATETIME(fsp=3)


def upgrade() -> None:
    op.create_table(
        "sites",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("host", sa.String(190), nullable=False, unique=True),
        sa.Column("start_url", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("links_weekly", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("links_check_external", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", Stamp, nullable=False, server_default=NOW3),
        sa.CheckConstraint("kind IN ('own', 'competitor')", name="ck_sites_kind"),
    )
    op.create_table(
        "link_scans",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="queued"),
        sa.Column("trigger_kind", sa.String(10), nullable=False, server_default="button"),
        sa.Column("max_pages", sa.Integer(), nullable=True),  # no limit
        sa.Column("check_external", sa.Boolean(), nullable=False),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("stop_reason", sa.String(12), nullable=True),
        sa.Column("pages_read", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("links_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_robots", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("too_large", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages_not_read", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("external_not_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stopped_at_limit", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("external_left", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("requests_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paused_until", Stamp, nullable=True),  # the daily budget ran out, and it carries on then
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", Stamp, nullable=False, server_default=NOW3),
        sa.Column("started_at", Stamp, nullable=True),
        sa.Column("finished_at", Stamp, nullable=True),
    )
    op.create_index("ix_link_scans_site_created", "link_scans", ["site_id", "created_at"])
    op.create_table(
        "link_issues",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("scan_id", sa.BigInteger(), sa.ForeignKey("link_scans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(12), nullable=False),
        sa.Column("target_url", sa.Text(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("hops", sa.Integer(), nullable=True),
        sa.Column("seconds", sa.Float(), nullable=True),
        sa.Column("final_url", sa.Text(), nullable=True),
        sa.Column("pages", sa.JSON(), nullable=False),
    )
    op.create_index("ix_link_issues_scan_category", "link_issues", ["scan_id", "category"])
    op.create_table(
        "crawl_budget",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("crawl_budget")
    op.drop_table("link_issues")
    op.drop_table("link_scans")
    op.drop_table("sites")
