"""rival page changes: what a competitor now above me on a page-1 search changed on its page

One row per finding and competitor page: when the earlier copy dates from and where it came from (stored, Wayback, none), the
structured comparison, and my page's facts beside it. The Wayback copy itself is never kept.

Revision ID: c4d5e6f7a8b9
Revises: a7b1c2d3e4f5
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "c4d5e6f7a8b9"
down_revision = "a7b1c2d3e4f5"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "rival_page_changes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("finding_id", sa.BigInteger(), nullable=False),
        sa.Column("keyword_id", sa.BigInteger(), nullable=True),
        sa.Column("rival_url", sa.Text(), nullable=False),
        sa.Column("rival_url_hash", sa.String(length=64), nullable=False),
        sa.Column("host", sa.String(length=190), nullable=False),
        sa.Column("my_url", sa.Text(), nullable=True),
        sa.Column("position_before", sa.Integer(), nullable=True),
        sa.Column("position_now", sa.Integer(), nullable=True),
        sa.Column("wanted_before", sa.Date(), nullable=True),
        sa.Column("before_at", STAMP, nullable=True),
        sa.Column("before_source", sa.String(length=8), server_default="none", nullable=False),
        sa.Column("after_at", STAMP, nullable=True),
        sa.Column("read_at", STAMP, nullable=True),
        sa.Column("read_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("diff", sa.JSON(), nullable=True),
        sa.Column("mine", sa.JSON(), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
        sa.Column("updated_at", STAMP, server_default=NOW3, nullable=False),
        sa.CheckConstraint("before_source IN ('stored', 'wayback', 'none')", name="ck_rival_page_changes_source"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["finding_id"], ["search_findings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["keyword_id"], ["keywords.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("finding_id", "rival_url_hash", name="uq_rival_page_changes_finding_url"),
    )
    op.create_index("ix_rival_page_changes_site_read", "rival_page_changes", ["site_id", "read_at"], unique=False)
    op.create_index("ix_rival_page_changes_url_wanted", "rival_page_changes", ["rival_url_hash", "wanted_before"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_rival_page_changes_url_wanted", table_name="rival_page_changes")
    op.drop_index("ix_rival_page_changes_site_read", table_name="rival_page_changes")
    op.drop_table("rival_page_changes")
