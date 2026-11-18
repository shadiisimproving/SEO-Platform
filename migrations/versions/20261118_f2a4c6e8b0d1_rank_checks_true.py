"""rank checks: what SerpApi searched with, and old DuckDuckGo checks' depth as read (SEO review 2026-11-17, rankings 3.1, 3.7)

- serp_checks.asked: the parameters the tool says it searched with (SerpApi's search_parameters), never the key.
- serp_checks.query_shown: the query the results page showed (SerpApi's search_information.query_displayed). A check whose
  page showed another query is saved as suspect (store.save_check).
- DuckDuckGo has no page 2 here, so a DuckDuckGo check saved as Top 20 or Top 30 that holds 10 results or fewer read one page:
  it answers Top 10. 66 such checks were saved before tools.depth_read (2026-11-17); their depth becomes 10, so the panel
  stops saying "not in the top 20/30" and they compare with the newer Top 10 checks. Their results are not touched.

Revision ID: f2a4c6e8b0d1
Revises: e4f6a8b0c2d5
"""
import sqlalchemy as sa
from alembic import op

revision = "f2a4c6e8b0d1"
down_revision = "e4f6a8b0c2d5"
branch_labels = None
depends_on = None

READ_DEPTH = (
    "UPDATE serp_checks c JOIN serp_targets t ON t.id = c.target_id SET c.depth = 10 "
    "WHERE t.engine = 'duckduckgo' AND c.depth > 10 AND c.status IN ('ok', 'suspect') "
    "AND (SELECT COUNT(*) FROM serp_results r WHERE r.check_id = c.id) <= 10"
)


def upgrade() -> None:
    op.add_column("serp_checks", sa.Column("asked", sa.JSON(), nullable=True))
    op.add_column("serp_checks", sa.Column("query_shown", sa.String(300), nullable=True))
    op.execute(READ_DEPTH)


def downgrade() -> None:
    op.drop_column("serp_checks", "query_shown")
    op.drop_column("serp_checks", "asked")
