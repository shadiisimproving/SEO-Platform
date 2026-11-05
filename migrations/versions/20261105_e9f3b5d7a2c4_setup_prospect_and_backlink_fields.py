"""setup, prospect and backlink fields

Revision ID: e9f3b5d7a2c4
Revises: d8e2a4c6f1b3
"""
import sqlalchemy as sa
from alembic import op

revision = "e9f3b5d7a2c4"
down_revision = "d8e2a4c6f1b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sites", sa.Column("setup_not_used", sa.JSON(), nullable=True))
    op.add_column("prospects", sa.Column("owner", sa.String(120), nullable=True))
    op.add_column("prospects", sa.Column("stage", sa.String(20), server_default="new", nullable=False))
    op.add_column("backlinks", sa.Column("authority", sa.Integer(), nullable=True))
    op.add_column("backlinks", sa.Column("authority_label", sa.String(120), nullable=True))
    op.add_column("backlinks", sa.Column("spam_score", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("backlinks", "spam_score")
    op.drop_column("backlinks", "authority_label")
    op.drop_column("backlinks", "authority")
    op.drop_column("prospects", "stage")
    op.drop_column("prospects", "owner")
    op.drop_column("sites", "setup_not_used")
