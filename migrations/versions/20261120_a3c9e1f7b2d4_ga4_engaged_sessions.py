"""ga4_engaged_sessions: GA4's engaged sessions per source, for "engaged visits %" per AI assistant (AI search → Assistants).

NULL means "read before this column existed", not zero: the GA4 read fills those days again (sources report only).

Revision ID: a3c9e1f7b2d4
Revises: d5e6f7a8b9c0
"""
import sqlalchemy as sa
from alembic import op

revision = "a3c9e1f7b2d4"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ga4_source_daily", sa.Column("engaged_sessions", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("ga4_source_daily", "engaged_sessions")
