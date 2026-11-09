"""search insights: findings worked out in code after each new day of Search Console data

Revision ID: b7b7c7d7e7f7
Revises: a9a9b9c9d9e9
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b7b7c7d7e7f7"
down_revision = "a9a9b9c9d9e9"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "search_findings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("grp", sa.String(length=12), nullable=False),
        sa.Column("finding_key", sa.String(length=32), nullable=False),
        sa.Column("query", sa.String(length=500), nullable=True),
        sa.Column("page", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(length=8), server_default="normal", nullable=False),
        sa.Column("at_stake", sa.Float(), server_default="0", nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=10), server_default="open", nullable=False),
        sa.Column("dismissed_stake", sa.Float(), nullable=True),
        sa.Column("data_through", sa.Date(), nullable=True),
        sa.Column("ai", sa.JSON(), nullable=True),
        sa.Column("first_seen", STAMP, server_default=NOW3, nullable=False),
        sa.Column("last_seen", STAMP, server_default=NOW3, nullable=False),
        sa.Column("gone_at", STAMP, nullable=True),
        sa.CheckConstraint("status IN ('open', 'gone', 'dismissed', 'done')", name="ck_search_findings_status"),
        sa.CheckConstraint("severity IN ('big', 'normal', 'info')", name="ck_search_findings_severity"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("finding_key", name="uq_search_findings_key"),
    )
    op.create_index("ix_search_findings_site", "search_findings", ["site_id", "status", "at_stake"], unique=False)
    op.create_table(
        "search_finding_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("data_through", sa.Date(), nullable=True),
        sa.Column("ran_at", STAMP, server_default=NOW3, nullable=False),
        sa.Column("seconds", sa.Float(), nullable=True),
        sa.Column("counts", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_search_finding_runs_site", "search_finding_runs", ["site_id", "ran_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_search_finding_runs_site", table_name="search_finding_runs")
    op.drop_table("search_finding_runs")
    op.drop_index("ix_search_findings_site", table_name="search_findings")
    op.drop_table("search_findings")
