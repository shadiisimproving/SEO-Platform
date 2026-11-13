"""users: the websites and sections a person with chosen access may reach (NULL is full access)

Revision ID: e1a5c3c3e5a1
Revises: e1a2b3c4d5e6
"""
import sqlalchemy as sa
from alembic import op

revision = "e1a5c3c3e5a1"
down_revision = "e1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("access", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "access")
