"""backlinks: does each link count for Google, what Search Console lists, links to reclaim, disavow, a monthly budget

Revision ID: b1b2c3d4e5f6
Revises: c8c8d8e8f8a8
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "b1b2c3d4e5f6"
down_revision = "c8c8d8e8f8a8"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW = sa.text("CURRENT_TIMESTAMP(3)")
BACKLINK_COLUMNS = (
    ("seo_verdict", sa.String(8)), ("seo_reasons", sa.JSON()), ("page_lang", sa.String(16)), ("target_lang", sa.String(16)), ("outbound_links", sa.Integer()),
    ("target_http", sa.Integer()), ("found_by", sa.String(40)), ("gsc_seen", sa.String(6)), ("gsc_seen_at", STAMP), ("gsc_crawled", sa.String(20)),
)
CHECK_COLUMNS = (("verdict", sa.String(8)), ("reasons", sa.JSON()), ("outbound_links", sa.Integer()))


def upgrade() -> None:
    for name, kind in BACKLINK_COLUMNS:
        op.add_column("backlinks", sa.Column(name, kind, nullable=True))
    op.add_column("backlinks", sa.Column("disavow", sa.Boolean(), server_default=sa.text("0"), nullable=False))
    for name, kind in CHECK_COLUMNS:
        op.add_column("backlink_checks", sa.Column(name, kind, nullable=True))
    op.create_table(
        "gsc_link_imports",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("imported_at", STAMP, server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gsc_link_imports_site", "gsc_link_imports", ["site_id", "kind", "imported_at"])
    op.create_table(
        "gsc_linking_sites",
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("domain", sa.String(190), nullable=False),
        sa.Column("linking_pages", sa.Integer(), nullable=True),
        sa.Column("target_pages", sa.Integer(), nullable=True),
        sa.Column("imported_at", STAMP, server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id", "domain"),
    )
    op.create_table(
        "gsc_linked_pages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("target_url", sa.Text(), nullable=False),
        sa.Column("target_hash", sa.String(64), nullable=False),
        sa.Column("incoming_links", sa.Integer(), nullable=True),
        sa.Column("linking_sites", sa.Integer(), nullable=True),
        sa.Column("imported_at", STAMP, server_default=NOW, nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("final_url", sa.Text(), nullable=True),
        sa.Column("checked_at", STAMP, nullable=True),
        sa.Column("dismissed", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "target_hash", name="uq_gsc_linked_pages_target"),
    )
    op.create_table(
        "backlink_budgets",
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False),
        sa.Column("updated_at", STAMP, server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id"),
    )


def downgrade() -> None:
    op.drop_table("backlink_budgets")
    op.drop_table("gsc_linked_pages")
    op.drop_table("gsc_linking_sites")
    op.drop_index("ix_gsc_link_imports_site", table_name="gsc_link_imports")
    op.drop_table("gsc_link_imports")
    for name, _ in CHECK_COLUMNS:
        op.drop_column("backlink_checks", name)
    op.drop_column("backlinks", "disavow")
    for name, _ in BACKLINK_COLUMNS:
        op.drop_column("backlinks", name)
