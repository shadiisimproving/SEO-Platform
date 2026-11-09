"""backlinks: the keyword a link is for, and an anchor type set by hand

Revision ID: f6f6a6b6c6d6
Revises: e5f5a5b5c5d5
"""
import sqlalchemy as sa
from alembic import op

revision = "f6f6a6b6c6d6"
down_revision = "e5f5a5b5c5d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("backlinks", sa.Column("keyword", sa.String(255), nullable=True))
    # brand, url, exact, partial, generic or other. Empty means the app works it out from the anchor text.
    op.add_column("backlinks", sa.Column("anchor_kind", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column("backlinks", "anchor_kind")
    op.drop_column("backlinks", "keyword")
