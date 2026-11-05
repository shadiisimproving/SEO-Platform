"""traffic and extras

Revision ID: a3b3c3d3e3f3
Revises: a2b2c2d2e2f2
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "a3b3c3d3e3f3"
down_revision = "a2b2c2d2e2f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("moz_metrics", sa.Column("popularity", sa.String(40), nullable=True))
    op.add_column("moz_metrics", sa.Column("popularity_at", mysql.DATETIME(fsp=3), nullable=True))


def downgrade() -> None:
    op.drop_column("moz_metrics", "popularity_at")
    op.drop_column("moz_metrics", "popularity")
