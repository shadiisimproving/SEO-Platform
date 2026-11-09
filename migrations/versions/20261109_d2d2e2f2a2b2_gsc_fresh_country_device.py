"""search console like the real one: fresh days, countries, devices, the match check and notes on the chart

Revision ID: d2d2e2f2a2b2
Revises: c1d1e1f1a1b1
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "d2d2e2f2a2b2"
down_revision = "c1d1e1f1a1b1"
branch_labels = None
depends_on = None


def _split(name: str, key: str, length: int) -> None:
    op.create_table(
        name,
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column(key, sa.String(length=length), nullable=False),
        sa.Column("clicks", sa.Integer(), server_default="0", nullable=False),
        sa.Column("impressions", sa.Integer(), server_default="0", nullable=False),
        sa.Column("position", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id", "day", key),
    )
    op.create_index(f"ix_{name}_day", name, ["site_id", "day"], unique=False)


def upgrade() -> None:
    # data_through stays the last final day. fresh_from is Google's first day that isn't final yet, fresh_through its newest.
    op.add_column("site_sources", sa.Column("fresh_from", sa.Date(), nullable=True))
    op.add_column("site_sources", sa.Column("fresh_through", sa.Date(), nullable=True))
    _split("gsc_country", "country", 3)
    _split("gsc_device", "device", 10)
    op.create_table(
        "gsc_verify",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("diff", sa.JSON(), nullable=True),
        sa.Column("checked_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gsc_verify_site", "gsc_verify", ["site_id", "checked_at"], unique=False)
    op.create_table(
        "search_notes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_search_notes_day", "search_notes", ["site_id", "day"], unique=False)


def downgrade() -> None:
    op.drop_table("search_notes")
    op.drop_table("gsc_verify")
    op.drop_table("gsc_device")
    op.drop_table("gsc_country")
    op.drop_column("site_sources", "fresh_through")
    op.drop_column("site_sources", "fresh_from")
