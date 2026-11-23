"""link_domains.redirect_to: where a home page led when the app's check found it redirects to another site

Link gaps keep the file's spam score as the judge (owner, 2026-11-10) but now show the app's own flag on the row, and
"Redirects to cvgorilla.com" says more than "Redirects to another site". Domains checked before this keep NULL.

Revision ID: f7a9b1c3d5e7
Revises: e4f6a8b0c2d5
"""
import sqlalchemy as sa
from alembic import op

revision = "f7a9b1c3d5e7"
down_revision = "e4f6a8b0c2d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("link_domains", sa.Column("redirect_to", sa.String(190), nullable=True))


def downgrade() -> None:
    op.drop_column("link_domains", "redirect_to")
