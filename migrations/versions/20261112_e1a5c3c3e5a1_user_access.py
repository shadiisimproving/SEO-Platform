"""users: the websites and sections a person with chosen access may reach (NULL is full access)

Revision ID: e1a5c3c3e5a1
Revises: c7e7a7b7c7d7
"""
import sqlalchemy as sa
from alembic import op

revision = "e1a5c3c3e5a1"
down_revision = "c7e7a7b7c7d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("access", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "access")
