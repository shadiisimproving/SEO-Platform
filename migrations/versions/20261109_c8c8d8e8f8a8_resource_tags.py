"""resources get a list of tags instead of one type; each old type becomes the first tag

Revision ID: c8c8d8e8f8a8
Revises: b7b7c7d7e7f7
"""
import sqlalchemy as sa
from alembic import op

revision = "c8c8d8e8f8a8"
down_revision = "b7b7c7d7e7f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resources", sa.Column("tags", sa.JSON(), nullable=True))
    op.execute("UPDATE resources SET tags = JSON_ARRAY(kind) WHERE kind IS NOT NULL AND kind <> ''")


def downgrade() -> None:
    op.execute("UPDATE resources SET kind = LEFT(JSON_UNQUOTE(JSON_EXTRACT(tags, '$[0]')), 40) WHERE tags IS NOT NULL AND JSON_LENGTH(tags) > 0")
    op.drop_column("resources", "tags")
