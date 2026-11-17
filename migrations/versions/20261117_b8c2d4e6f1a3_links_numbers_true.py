"""links and competitors: numbers that say what they claim (SEO expert review 2026-11-17)

- competitor_referrers.followed and competitor_referrer_links.rel: a file's Nofollow / Sponsored / UGC columns are kept, so
  Link gaps can show followed links first. A file's lost links are no longer imported at all.
- backlinks.to_target: whether the last check found the link pointing at the logged target page, so a link moved to another
  page of my site gets a badge and an alert.
- pages.last_changed_at was set on a page's first reading, so "Updated, 12 months" read 100% for any site watched less than a
  year. It now means an edit was seen: pages with no recorded edit lose the first-read date.

Revision ID: b8c2d4e6f1a3
Revises: c5e7a9b1d3f2
"""
import sqlalchemy as sa
from alembic import op

revision = "b8c2d4e6f1a3"
down_revision = "c5e7a9b1d3f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("competitor_referrers", sa.Column("followed", sa.Boolean(), nullable=True))
    op.add_column("competitor_referrer_links", sa.Column("rel", sa.String(40), nullable=True))
    op.add_column("backlinks", sa.Column("to_target", sa.Boolean(), nullable=True))
    op.execute(
        "UPDATE pages p SET p.last_changed_at = NULL WHERE p.last_changed_at IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM change_events e WHERE e.page_id = p.id AND e.kind NOT IN ('new_page', 'page_gone'))"
    )


def downgrade() -> None:
    op.drop_column("backlinks", "to_target")
    op.drop_column("competitor_referrer_links", "rel")
    op.drop_column("competitor_referrers", "followed")
