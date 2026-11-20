"""keyword_volumes: searches a month per keyword, from Bing Webmaster or an uploaded file, always with its source. One new table.

Revision ID: f7a8b9c0d1e2
Revises: a3c9e1f7b2d4
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "f7a8b9c0d1e2"
down_revision = "a3c9e1f7b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "keyword_volumes",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("keyword_hash", sa.String(64), nullable=False),
        sa.Column("keyword", sa.String(400), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("source_name", sa.String(190), server_default="", nullable=False),
        sa.Column("country", sa.String(2), server_default="", nullable=False),
        sa.Column("language", sa.String(10), server_default="", nullable=False),
        sa.Column("month", sa.String(7), server_default="", nullable=False),
        sa.Column("searches", sa.Integer(), nullable=False),
        sa.Column("added_by", sa.String(120), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.UniqueConstraint("keyword_hash", "source", "source_name", "country", "language", "month", name="uq_keyword_volume"),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_keyword_volumes_source", "keyword_volumes", ["source", "source_name"])


def downgrade() -> None:
    op.drop_table("keyword_volumes")
