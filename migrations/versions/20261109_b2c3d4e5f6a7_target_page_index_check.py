"""backlinks: is my target page indexed, as Search Console's URL Inspection answers

Revision ID: b2c3d4e5f6a7
Revises: b1b2c3d4e5f6
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b2c3d4e5f6a7"
down_revision = "b1b2c3d4e5f6"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)


def upgrade() -> None:
    op.create_table(
        "gsc_inspections",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url_hash", sa.String(64), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("verdict", sa.String(12), nullable=True),
        sa.Column("coverage", sa.String(200), nullable=True),
        sa.Column("indexing", sa.String(40), nullable=True),
        sa.Column("robots", sa.String(40), nullable=True),
        sa.Column("fetch_state", sa.String(40), nullable=True),
        sa.Column("google_canonical", sa.Text(), nullable=True),
        sa.Column("user_canonical", sa.Text(), nullable=True),
        sa.Column("last_crawl", STAMP, nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("inspected_at", STAMP, nullable=True),
        sa.UniqueConstraint("site_id", "url_hash", name="uq_gsc_inspections_url"),
    )


def downgrade() -> None:
    op.drop_table("gsc_inspections")
