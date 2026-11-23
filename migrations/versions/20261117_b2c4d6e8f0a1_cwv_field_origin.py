"""cwv_runs: say when PageSpeed's real-visitor numbers are the whole site's, not the page's

When Google has too few visitors on a page, PageSpeed Insights answers with the site's (origin_fallback). Those were stored
as the page's own. Runs saved before this can't be told apart, so they keep 0; the next weekly run says it right.

Revision ID: b2c4d6e8f0a1
Revises: b8c2d4e6f1a3
"""
import sqlalchemy as sa
from alembic import op

revision = "b2c4d6e8f0a1"
down_revision = "b8c2d4e6f1a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cwv_runs", sa.Column("field_origin", sa.Boolean(), server_default=sa.text("0"), nullable=False))


def downgrade() -> None:
    op.drop_column("cwv_runs", "field_origin")
