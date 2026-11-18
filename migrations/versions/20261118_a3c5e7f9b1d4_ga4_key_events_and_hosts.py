"""Google Analytics: key events by name, leads the owner picks, and the site each visit was on (SEO review 2026-11-17, W1-W3)

- ga4_key_event_daily: each key event by its name, for the same rows as the source, page, referral and campaign tables
  (report + row_hash point at the row), with the sessions it happened in. Settings lists the names; the ones ticked
  "Counts as a lead" (site_rules kind key_event) are a site's leads.
- leads on those four tables: the visits of the row that had a ticked key event, worked out again whenever the ticks
  change (seo/metrics/leads.py). 0 while nothing is ticked: the screens then say "Key events".
- ga4_host_daily: every host a property recorded visits on, per day. Rows on another site's host are kept out of the
  other tables, and Settings and Today warn about them.
- Coverage source ga4_v2 marks a day read with all of this. The collector reads every older day again, newest first,
  and carries on where it stopped.

Revision ID: a3c5e7f9b1d4
Revises: e4f6a8b0c2d5
"""
import sqlalchemy as sa
from alembic import op

# Hashes and the report name are plain ASCII: compared with the other GA4 tables whatever their text format (latin1 or
# utf8mb4), with no "illegal mix of collations".
KEY = sa.String(32, collation="ascii_bin")

revision = "a3c5e7f9b1d4"
down_revision = "e4f6a8b0c2d5"
branch_labels = None
depends_on = None

TABLES = ("ga4_source_daily", "ga4_page_daily", "ga4_referral_daily", "ga4_campaign_daily")


def upgrade() -> None:
    op.create_table(
        "ga4_key_event_daily",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("report", sa.String(10, collation="ascii_bin"), primary_key=True),
        sa.Column("row_hash", KEY, primary_key=True),
        sa.Column("event_hash", KEY, primary_key=True),
        sa.Column("event_name", sa.String(120), nullable=False),
        sa.Column("key_events", sa.Float(), server_default="0", nullable=False),
        sa.Column("sessions", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index("ix_ga4_key_event_name", "ga4_key_event_daily", ["site_id", "event_hash", "day"])
    op.create_table(
        "ga4_host_daily",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("host_hash", KEY, primary_key=True),
        sa.Column("host", sa.String(190), nullable=False),
        sa.Column("own", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("sessions", sa.Integer(), server_default="0", nullable=False),
    )
    for table in TABLES:
        op.add_column(table, sa.Column("leads", sa.Float(), server_default="0", nullable=False))


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "leads")
    op.drop_table("ga4_host_daily")
    op.drop_index("ix_ga4_key_event_name", table_name="ga4_key_event_daily")
    op.drop_table("ga4_key_event_daily")
