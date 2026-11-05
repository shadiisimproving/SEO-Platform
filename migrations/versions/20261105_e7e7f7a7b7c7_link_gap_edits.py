"""Facts about a linking domain typed by hand, from tools with no connection here

Revision ID: e7e7f7a7b7c7
Revises: d6d6e6f6a6b6
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "e7e7f7a7b7c7"
down_revision = "d6d6e6f6a6b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "link_domain_edits",
        sa.Column("domain", sa.String(190), primary_key=True),
        sa.Column("authority", sa.Integer(), nullable=True),
        sa.Column("authority_label", sa.String(120), nullable=True),
        sa.Column("sample_url", sa.Text(), nullable=True),
        sa.Column("edited_by", sa.String(100), nullable=True),
        sa.Column("edited_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
    )
    op.add_column("competitor_referrers", sa.Column("removed_by_hand", sa.Boolean(), server_default=sa.text("0"), nullable=False))


def downgrade() -> None:
    op.drop_column("competitor_referrers", "removed_by_hand")
    op.drop_table("link_domain_edits")
