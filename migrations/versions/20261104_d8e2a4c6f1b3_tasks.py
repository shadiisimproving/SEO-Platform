"""tasks

Revision ID: d8e2a4c6f1b3
Revises: c5d1f0a7e3b2
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "d8e2a4c6f1b3"
down_revision = "c5d1f0a7e3b2"
branch_labels = None
depends_on = None

NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(10), server_default="todo", nullable=False),
        sa.Column("priority", sa.String(10), server_default="medium", nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("site_host", sa.String(190), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("kind", sa.String(40), nullable=True),
        sa.Column("hypothesis", sa.String(300), nullable=True),
        sa.Column("impact", sa.Integer(), nullable=True),
        sa.Column("hours_estimate", sa.Float(), nullable=True),
        sa.Column("hours_spent", sa.Float(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("owner_label", sa.String(100), nullable=True),
        sa.Column("comments", sa.JSON(), nullable=True),
        sa.Column("source", sa.JSON(), nullable=True),
        sa.Column("open_source_key", sa.String(64), nullable=True),
        sa.Column("completed_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=NOW3, nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=3), server_default=NOW3, nullable=False),
        sa.Column("deleted_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.CheckConstraint("status IN ('todo', 'doing', 'done')", name="ck_tasks_status"),
        sa.CheckConstraint("priority IN ('low', 'medium', 'high')", name="ck_tasks_priority"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("open_source_key"),
    )
    op.create_index("ix_tasks_board", "tasks", ["deleted_at", "status", "due_date"])


def downgrade() -> None:
    op.drop_table("tasks")
