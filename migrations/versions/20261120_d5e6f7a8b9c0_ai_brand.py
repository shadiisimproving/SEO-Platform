"""ai_brand: what AI assistants say about the owner's company (AI search → What AI says). Adds three tables only.

Revision ID: d5e6f7a8b9c0
Revises: b8c2d3e4f5a6
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "d5e6f7a8b9c0"
down_revision = "b8c2d3e4f5a6"
branch_labels = None
depends_on = None

NOW = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "brand_questions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("source", sa.String(10), server_default="owner", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=NOW, nullable=False),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_brand_questions_site", "brand_questions", ["site_id"])
    op.create_table(
        "brand_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(10), server_default="queued", nullable=False),
        sa.Column("questions", sa.JSON(), nullable=False),
        sa.Column("engines", sa.JSON(), nullable=False),
        sa.Column("language", sa.String(10), server_default="", nullable=False),
        sa.Column("country", sa.String(2), server_default="", nullable=False),
        sa.Column("estimate", sa.JSON(), nullable=True),
        sa.Column("cost", sa.Numeric(10, 5), server_default="0", nullable=False),
        sa.Column("started_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=NOW, nullable=False),
        sa.Column("finished_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_brand_runs_site", "brand_runs", ["site_id", "created_at"])
    op.create_table(
        "brand_answers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("brand_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("brand_questions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("question", sa.String(500), nullable=False),
        sa.Column("engine", sa.String(20), nullable=False),
        sa.Column("status", sa.String(10), server_default="pending", nullable=False),
        sa.Column("answer_text", mysql.MEDIUMTEXT(), nullable=True),
        sa.Column("signed_out", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=True),
        sa.Column("brand_named", sa.Boolean(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("tone", sa.String(10), nullable=True),
        sa.Column("pros", sa.JSON(), nullable=True),
        sa.Column("cons", sa.JSON(), nullable=True),
        sa.Column("competitors", sa.JSON(), nullable=True),
        sa.Column("read_by", sa.String(120), nullable=True),
        sa.Column("read_error", sa.String(300), nullable=True),
        sa.Column("cost", sa.Numeric(10, 5), server_default="0", nullable=False),
        sa.Column("currency", sa.String(3), server_default="USD", nullable=False),
        sa.Column("job_id", sa.String(120), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("answered_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=NOW, nullable=False),
        sa.UniqueConstraint("run_id", "question_id", "engine", name="uq_brand_answer"),
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_brand_answers_run", "brand_answers", ["run_id", "engine", "status"])


def downgrade() -> None:
    op.drop_table("brand_answers")
    op.drop_table("brand_runs")
    op.drop_table("brand_questions")
