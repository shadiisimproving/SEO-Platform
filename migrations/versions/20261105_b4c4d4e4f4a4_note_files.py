"""images and files attached to notes

Revision ID: b4c4d4e4f4a4
Revises: a3b3c3d3e3f3
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b4c4d4e4f4a4"
down_revision = "a3b3c3d3e3f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "note_files",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("note_id", sa.BigInteger(), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("image_type", sa.String(length=20), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("stored_name", sa.String(length=64), nullable=False),
        sa.Column("deleted_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.UniqueConstraint("stored_name", name="uq_note_files_stored"),
        sa.Index("ix_note_files_note", "note_id"),
    )


def downgrade() -> None:
    op.drop_table("note_files")
