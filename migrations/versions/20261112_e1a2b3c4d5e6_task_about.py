"""tasks: what a task is about besides pages and keywords (rankings, backlinks, linking websites, technical issues,
competitors, notes), and which kind comes first

Revision ID: e1a2b3c4d5e6
Revises: c7e7a7b7c7d7
"""
import sqlalchemy as sa
from alembic import op

revision = "e1a2b3c4d5e6"
down_revision = "c7e7a7b7c7d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("about", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "about")
