"""notifications: the bell at the top of every screen, starting with new Search Console queries

Revision ID: e5f5a5b5c5d5
Revises: c3d4e5f6a7b8
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "e5f5a5b5c5d5"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("subject_key", sa.String(32), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
        sa.Column("read_at", STAMP, nullable=True),
        sa.UniqueConstraint("site_id", "kind", "subject_key", name="uq_notifications_subject"),
    )
    op.create_index("ix_notifications_recent", "notifications", ["read_at", "created_at"])
    op.create_table(
        "notification_marks",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.String(30), primary_key=True),
        sa.Column("through", sa.Date(), nullable=False),
    )
    # "Has this query ever been seen before?" is a look-up by query, which the day-first keys can't answer quickly.
    op.create_index("ix_gsc_query_hash", "gsc_query", ["site_id", "query_hash", "day"])


def downgrade() -> None:
    op.drop_index("ix_gsc_query_hash", table_name="gsc_query")
    op.drop_table("notification_marks")
    op.drop_index("ix_notifications_recent", table_name="notifications")
    op.drop_table("notifications")
