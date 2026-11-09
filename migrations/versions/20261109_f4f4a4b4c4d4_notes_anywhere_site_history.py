"""notes on any screen or the whole website, a site's history (Wayback and domain dates), sitemap dates, search features

Revision ID: f4f4a4b4c4d4
Revises: d2d2e2f2a2b2
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "f4f4a4b4c4d4"
down_revision = "d2d2e2f2a2b2"
branch_labels = None
depends_on = None

OLD_SCOPES = "scope IN ('all', 'competitor', 'page')"
NEW_SCOPES = "scope IN ('all', 'competitor', 'page', 'site', 'screen')"


def upgrade() -> None:
    op.add_column("notes", sa.Column("screen", sa.String(length=40), nullable=True))
    op.create_index("ix_notes_screen", "notes", ["screen", "site_id"], unique=False)
    op.drop_constraint("ck_notes_scope", "notes", type_="check")
    op.create_check_constraint("ck_notes_scope", "notes", NEW_SCOPES)

    op.add_column("pages", sa.Column("sitemap_lastmod", sa.Date(), nullable=True))
    op.add_column("pages", sa.Column("first_archived", sa.Date(), nullable=True))

    op.add_column("serp_checks", sa.Column("features_state", sa.String(length=14), server_default="not_captured", nullable=False))
    op.create_table(
        "serp_features",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("check_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("host", sa.String(length=190), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("text", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(["check_id"], ["serp_checks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_serp_features_check", "serp_features", ["check_id", "kind"], unique=False)

    op.create_table(
        "site_history",
        sa.Column("host", sa.String(length=190), nullable=False),
        sa.Column("status", sa.String(length=12), server_default="queued", nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.Column("first_capture", sa.Date(), nullable=True),
        sa.Column("archived_pages", sa.Integer(), nullable=True),
        sa.Column("capped", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("pages_by_year", sa.JSON(), nullable=True),
        sa.Column("registered_on", sa.Date(), nullable=True),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("domain_problem", sa.String(length=40), nullable=True),
        sa.Column("fetched_at", mysql.DATETIME(fsp=3), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
        sa.PrimaryKeyConstraint("host"),
    )


def downgrade() -> None:
    op.drop_table("site_history")
    op.drop_table("serp_features")
    op.drop_column("serp_checks", "features_state")
    op.drop_column("pages", "first_archived")
    op.drop_column("pages", "sitemap_lastmod")
    op.execute("DELETE FROM notes WHERE scope IN ('site', 'screen')")
    op.drop_constraint("ck_notes_scope", "notes", type_="check")
    op.create_check_constraint("ck_notes_scope", "notes", OLD_SCOPES)
    op.drop_index("ix_notes_screen", table_name="notes")
    op.drop_column("notes", "screen")
