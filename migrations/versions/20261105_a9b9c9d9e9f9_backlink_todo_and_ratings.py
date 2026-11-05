"""page authority and a rating on prospects and backlinks; article link and sent date on backlinks

Revision ID: a9b9c9d9e9f9
Revises: f8f8a8b8c8d8
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "a9b9c9d9e9f9"
down_revision = "f8f8a8b8c8d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("prospects", "backlinks"):
        op.add_column(table, sa.Column("page_authority", sa.Integer(), nullable=True))
        op.add_column(table, sa.Column("rating", sa.Integer(), nullable=True))
    op.add_column("backlinks", sa.Column("article_url", sa.Text(), nullable=True))
    op.add_column("backlinks", sa.Column("sent_at", mysql.DATETIME(fsp=3), nullable=True))


def downgrade() -> None:
    op.drop_column("backlinks", "sent_at")
    op.drop_column("backlinks", "article_url")
    for table in ("prospects", "backlinks"):
        op.drop_column(table, "rating")
        op.drop_column(table, "page_authority")
