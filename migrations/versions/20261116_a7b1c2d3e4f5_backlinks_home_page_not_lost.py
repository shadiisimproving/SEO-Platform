"""backlinks: links saved with only the website's address go back to Live and are checked again

The monthly check read the home page of movida-dubai.com, tourdubai.fr... and marked their links Lost, though they are live on an article.
The check now looks for the article itself and never counts a home page miss as a loss, so these are read again at the next run.
Only links the check itself marked Lost come back: one typed as Lost by hand has no missing reading behind it.

Revision ID: a7b1c2d3e4f5
Revises: f3c1d2e4a5b6
"""
from alembic import op

revision = "a7b1c2d3e4f5"
down_revision = "f3c1d2e4a5b6"
branch_labels = None
depends_on = None

HOME = "source_url REGEXP '^https?://[^/?#]+/?$'"


def upgrade() -> None:
    op.execute(
        f"UPDATE backlinks SET status = 'live', lost_at = NULL, miss_count = 0, checked_at = NULL, check_outcome = NULL, check_reason = NULL "
        f"WHERE status = 'lost' AND {HOME} AND id IN (SELECT backlink_id FROM backlink_checks WHERE outcome IN ('missing', 'page_gone'))"
    )
    op.execute(f"UPDATE backlinks SET miss_count = 0, checked_at = NULL WHERE status = 'live' AND miss_count > 0 AND {HOME}")


def downgrade() -> None:
    pass  # what the old check said was wrong, so there's nothing worth putting back
