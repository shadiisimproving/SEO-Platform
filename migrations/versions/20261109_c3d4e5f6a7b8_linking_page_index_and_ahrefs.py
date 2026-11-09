"""backlinks: is the linking page on Google (a site: search), and each linking website's traffic from Ahrefs

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)


def upgrade() -> None:
    op.add_column("backlinks", sa.Column("src_index", sa.String(14), nullable=True))
    op.add_column("backlinks", sa.Column("src_index_via", sa.String(40), nullable=True))
    op.add_column("backlinks", sa.Column("src_index_at", STAMP, nullable=True))
    op.add_column("backlinks", sa.Column("src_index_misses", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.create_table(
        "ahrefs_monthly",
        sa.Column("domain", sa.String(190), primary_key=True),
        sa.Column("month", sa.String(7), primary_key=True),
        sa.Column("org_traffic", sa.BigInteger(), nullable=True),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("fetched_at", STAMP, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("ahrefs_monthly")
    for name in ("src_index_misses", "src_index_at", "src_index_via", "src_index"):
        op.drop_column("backlinks", name)
