"""social transcripts: Instagram and TikTok videos turned into text, in named batches, for the Social section's Video transcripts tab

Revision ID: e7f3a9c1d5b2
Revises: b8c9d0e1f2a3
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "e7f3a9c1d5b2"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW3 = sa.text("CURRENT_TIMESTAMP(3)")


def upgrade() -> None:
    op.create_table(
        "social_transcript_batches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("origin", sa.String(10), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
        sa.CheckConstraint("origin IN ('paste', 'file', 'account')", name="ck_social_transcript_batches_origin"),
        sa.Index("ix_social_transcript_batches_site", "site_id", "created_at"),
    )
    op.create_table(
        "social_transcripts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("social_transcript_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("url_hash", sa.String(32), nullable=False),
        sa.Column("platform", sa.String(10), nullable=False),
        sa.Column("status", sa.String(10), server_default="queued", nullable=False),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("author", sa.String(150), nullable=True),
        sa.Column("duration", sa.Integer(), nullable=True),
        sa.Column("lang", sa.String(10), nullable=True),
        sa.Column("method", sa.String(10), nullable=True),
        sa.Column("transcript", mysql.MEDIUMTEXT(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW3, nullable=False),
        sa.Column("done_at", STAMP, nullable=True),
        sa.CheckConstraint("platform IN ('tiktok', 'instagram')", name="ck_social_transcripts_platform"),
        sa.CheckConstraint("status IN ('queued', 'working', 'done', 'failed')", name="ck_social_transcripts_status"),
        sa.CheckConstraint("method IS NULL OR method IN ('captions', 'groq')", name="ck_social_transcripts_method"),
        sa.UniqueConstraint("batch_id", "url_hash", name="uq_social_transcripts_url"),
        sa.Index("ix_social_transcripts_site", "site_id", "status"),
    )


def downgrade() -> None:
    op.drop_table("social_transcripts")
    op.drop_table("social_transcript_batches")
