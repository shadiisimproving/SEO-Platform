"""content tracker and task goals: the Content screen's "Content tracker" tab keeps what a person set on a published piece
(its target query, publish date, title, or that it isn't tracked), and a task gains a goal and a Blocked status.

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "a8b9c0d1e2f3"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None

NOW = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "content_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("path", sa.String(1000), nullable=False),
        sa.Column("path_hash", sa.String(64), nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("published_on", sa.Date(), nullable=True),
        sa.Column("target_query", sa.String(400), nullable=True),
        sa.Column("added_by", sa.String(100), nullable=True),
        sa.Column("removed_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=NOW, nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=3), server_default=NOW, nullable=False),
        sa.UniqueConstraint("site_id", "path_hash", name="uq_content_item_page"),
        mysql_charset="utf8mb4",
    )
    op.add_column("tasks", sa.Column("goal", sa.String(200), nullable=True))
    op.drop_constraint("ck_tasks_status", "tasks", type_="check")
    op.create_check_constraint("ck_tasks_status", "tasks", "status IN ('todo', 'doing', 'blocked', 'done')")


def downgrade() -> None:
    op.execute("UPDATE tasks SET status = 'todo' WHERE status = 'blocked'")
    op.drop_constraint("ck_tasks_status", "tasks", type_="check")
    op.create_check_constraint("ck_tasks_status", "tasks", "status IN ('todo', 'doing', 'done')")
    op.drop_column("tasks", "goal")
    op.drop_table("content_items")
