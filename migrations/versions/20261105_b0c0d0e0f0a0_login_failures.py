"""login failures per address

Revision ID: b0c0d0e0f0a0
Revises: a9b9c9d9e9f9
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b0c0d0e0f0a0"
down_revision = "a9b9c9d9e9f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_failures",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=45), nullable=False),
        sa.Column("failures", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_failed_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.Column("locked_until", mysql.DATETIME(fsp=3), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "source"),
    )


def downgrade() -> None:
    op.drop_table("login_failures")
