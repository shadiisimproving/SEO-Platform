"""competitor tracking: on, pages (keyword numbers hidden, pages still read) or off (paused), per site and competitor

Revision ID: a6a6b6c6d6e6
Revises: f4f4a4b4c4d4
"""
import sqlalchemy as sa
from alembic import op

revision = "a6a6b6c6d6e6"
down_revision = "f4f4a4b4c4d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("site_competitors", sa.Column("tracking", sa.String(length=8), server_default="on", nullable=False))
    op.create_check_constraint("ck_site_competitors_tracking", "site_competitors", "tracking IN ('on', 'pages', 'off')")


def downgrade() -> None:
    op.drop_constraint("ck_site_competitors_tracking", "site_competitors", type_="check")
    op.drop_column("site_competitors", "tracking")
