"""notes: who made a note and who last changed it, as the name shown in the app (like resources.created_by)

Revision ID: a6dcb1508d7d
Revises: b9c9d9e9f9a9
"""
import sqlalchemy as sa
from alembic import op

revision = "a6dcb1508d7d"
down_revision = "b9c9d9e9f9a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Both empty on existing notes: nobody knows who wrote them, and the screen then says nothing rather than guess.
    op.add_column("notes", sa.Column("created_by", sa.String(length=120), nullable=True))
    op.add_column("notes", sa.Column("updated_by", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("notes", "updated_by")
    op.drop_column("notes", "created_by")
