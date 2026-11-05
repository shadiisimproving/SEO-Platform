"""keyword refresh: tool order, paid switches, the credit ledger and runs

Revision ID: a2b2c2d2e2f2
Revises: a1b1c1d1e1f1
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "a2b2c2d2e2f2"
down_revision = "a1b1c1d1e1f1"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "tool_order",
        sa.Column("engine", sa.String(20), nullable=False),
        sa.Column("tool", sa.String(40), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("engine", "tool"),
    )
    op.create_table(
        "tool_settings",
        sa.Column("tool", sa.String(40), nullable=False),
        sa.Column("paid_on", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("updated_at", STAMP, server_default=NOW, nullable=False),
        sa.PrimaryKeyConstraint("tool"),
    )
    op.create_table(
        "serp_settings",
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("value", sa.String(190), nullable=False),
        sa.PrimaryKeyConstraint("name"),
    )
    op.create_table(
        "credit_ledger",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tool", sa.String(40), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("paid", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("cost", sa.Numeric(10, 5), nullable=True),
        sa.Column("run_id", sa.BigInteger(), nullable=True),
        sa.Column("keyword_id", sa.BigInteger(), nullable=True),
        sa.Column("engine", sa.String(20), nullable=True),
        sa.Column("note", sa.String(190), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_credit_ledger_tool_time", "credit_ledger", ["tool", "created_at"])
    op.create_index("ix_credit_ledger_run", "credit_ledger", ["run_id"])
    op.create_table(
        "rank_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=True),
        sa.Column("by_name", sa.String(120), nullable=True),
        sa.Column("idem_key", sa.String(64), nullable=True),
        sa.Column("status", sa.String(10), server_default="queued", nullable=False),
        sa.Column("engines", sa.JSON(), nullable=True),
        sa.Column("depth", sa.Integer(), server_default="10", nullable=False),
        sa.Column("mode", sa.String(6), server_default="auto", nullable=False),
        sa.Column("allow_paid", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("paid_cap", sa.Numeric(10, 2), nullable=True),
        sa.Column("spent", sa.Numeric(10, 5), server_default="0", nullable=False),
        sa.Column("total", sa.Integer(), server_default="0", nullable=False),
        sa.Column("done", sa.Integer(), server_default="0", nullable=False),
        sa.Column("failed", sa.Integer(), server_default="0", nullable=False),
        sa.Column("not_run", sa.Integer(), server_default="0", nullable=False),
        sa.Column("message", sa.String(500), nullable=True),
        sa.Column("stop_reason", sa.String(800), nullable=True),
        sa.Column("dropped", sa.JSON(), nullable=True),
        sa.Column("excluded", sa.JSON(), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", STAMP, server_default=NOW, nullable=False),
        sa.Column("started_at", STAMP, nullable=True),
        sa.Column("finished_at", STAMP, nullable=True),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idem_key"),
    )
    op.create_index("ix_rank_runs_status", "rank_runs", ["status", "id"])
    op.create_table(
        "rank_run_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.BigInteger(), nullable=False),
        sa.Column("keyword_id", sa.BigInteger(), nullable=False),
        sa.Column("engine", sa.String(20), nullable=False),
        sa.Column("tool", sa.String(40), nullable=True),
        sa.Column("status", sa.String(10), server_default="pending", nullable=False),
        sa.Column("used_tool", sa.String(40), nullable=True),
        sa.Column("check_id", sa.BigInteger(), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("active_key", sa.String(190), nullable=True),
        sa.ForeignKeyConstraint(["keyword_id"], ["keywords.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["rank_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("active_key"),
    )
    op.create_index("ix_rank_run_items_work", "rank_run_items", ["run_id", "status", "id"])


def downgrade() -> None:
    op.drop_table("rank_run_items")
    op.drop_table("rank_runs")
    op.drop_table("credit_ledger")
    op.drop_table("serp_settings")
    op.drop_table("tool_settings")
    op.drop_table("tool_order")
