"""clarity reports: the dashboard CSVs downloaded from Clarity, one snapshot per site, kind and period

Revision ID: c1d1e1f1a1b1
Revises: b0c0d0e0f0a0
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "c1d1e1f1a1b1"
down_revision = "b0c0d0e0f0a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clarity_reports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("project_name", sa.String(length=200), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("uploaded_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "kind", "period_start", "period_end", name="uq_clarity_report_period"),
    )


def downgrade() -> None:
    op.drop_table("clarity_reports")
