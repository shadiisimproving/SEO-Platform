"""competitor edits and new pages that nobody made are kept but hidden (SEO review 2026-11-17, W1-W3, W6)

- change_events.hidden / hidden_reason: an event the noise rules say is not a real edit or a real new page (a template
  block, a text saved as "?", a redirect read as a rewrite, an old page found late) is kept, not shown.
  scripts/reclassify_competitor_events.py sets them on stored events; the reader sets them on new ones.
- pages.final_url: where an address redirects to, so the target's text is never saved as the old page's.
- pages.blocks: short hashes of a page's text blocks, so a site's template is learned from its own pages.
- site_boilerplate: blocks a site repeats on many pages or changes on every request.

Revision ID: d1e3f5a7b9c2
Revises: b2c4d6e8f0a1
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "d1e3f5a7b9c2"
down_revision = "b2c4d6e8f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("change_events", sa.Column("hidden", sa.Boolean(), server_default=sa.text("0"), nullable=False))
    op.add_column("change_events", sa.Column("hidden_reason", sa.String(30), nullable=True))
    op.add_column("pages", sa.Column("final_url", sa.Text(), nullable=True))
    op.add_column("pages", sa.Column("blocks", sa.JSON(), nullable=True))
    op.create_table(
        "site_boilerplate",
        sa.Column("domain_id", sa.Integer(), sa.ForeignKey("domains.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("block_hash", sa.String(16), primary_key=True),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("pages", sa.Integer(), nullable=True),
        sa.Column("sample", sa.String(300), nullable=True),
        sa.Column("learned_at", DATETIME(fsp=3), server_default=sa.text("CURRENT_TIMESTAMP(3)"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("site_boilerplate")
    op.drop_column("pages", "blocks")
    op.drop_column("pages", "final_url")
    op.drop_column("change_events", "hidden_reason")
    op.drop_column("change_events", "hidden")
