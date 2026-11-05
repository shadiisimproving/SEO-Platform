"""Keywords and search checks, competitors, page pairs, link gaps, notes, health audits and alerts.

Revision ID: c5d1f0a7e3b2
Revises: 7a1c9e2f4b10
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import DATETIME, LONGBLOB, MEDIUMTEXT

revision = "c5d1f0a7e3b2"
down_revision = "7a1c9e2f4b10"
branch_labels = None
depends_on = None

NOW3 = sa.text("CURRENT_TIMESTAMP(3)")
Stamp = DATETIME(fsp=3)


def _stamp(name="created_at"):
    return sa.Column(name, Stamp, nullable=False, server_default=NOW3)


def upgrade() -> None:
    op.add_column("sites", sa.Column("health_monthly", sa.Boolean(), nullable=False, server_default=sa.text("1")))
    op.add_column("pages", sa.Column("extras", sa.JSON(), nullable=True))

    # ---- keywords and what search engines showed for them ---------------------------------
    op.create_table(
        "keywords",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("keyword", sa.String(400), nullable=False),
        sa.Column("keyword_hash", sa.String(64), nullable=False),  # of the cleaned text, so case and spacing don't split it
        sa.Column("country", sa.String(2), nullable=False, server_default=""),  # empty means any country
        sa.Column("language", sa.String(10), nullable=False, server_default=""),
        _stamp(),
        sa.UniqueConstraint("keyword_hash", "country", "language", name="uq_keywords_market"),
    )
    op.create_table(
        "keyword_uploads",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("engine", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False, server_default="upload"),  # upload (first check) or refresh
        sa.Column("status", sa.String(12), nullable=False, server_default="queued"),  # queued, running, complete, waiting
        sa.Column("stop_reason", sa.String(300), nullable=True),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("new_keywords", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tool", sa.String(40), nullable=True),
        _stamp(),
        sa.Column("finished_at", Stamp, nullable=True),
    )
    op.create_table(
        "site_keywords",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("keyword_id", sa.BigInteger(), sa.ForeignKey("keywords.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("upload_id", sa.BigInteger(), nullable=True),
        _stamp(),
    )
    op.create_table(
        "serp_targets",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("keyword_id", sa.BigInteger(), sa.ForeignKey("keywords.id", ondelete="CASCADE"), nullable=False),
        sa.Column("engine", sa.String(20), nullable=False),
        sa.Column("device", sa.String(10), nullable=False, server_default="desktop"),
        sa.UniqueConstraint("keyword_id", "engine", "device", name="uq_serp_target"),
    )
    op.create_table(
        "serp_checks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("target_id", sa.BigInteger(), sa.ForeignKey("serp_targets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tool", sa.String(40), nullable=False),
        sa.Column("real_location", sa.String(12), nullable=False, server_default=""),  # what the tool really searched from
        sa.Column("depth", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("status", sa.String(10), nullable=False, server_default="ok"),  # ok, suspect, failed
        sa.Column("ai_state", sa.String(14), nullable=False, server_default="not_captured"),  # present, absent, not_captured
        sa.Column("trigger_kind", sa.String(14), nullable=False, server_default="refresh"),  # first_upload, refresh
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("checked_at", Stamp, nullable=False, server_default=NOW3),
        sa.Index("ix_serp_checks_target_time", "target_id", "checked_at"),
    )
    op.create_table(
        "serp_results",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("check_id", sa.BigInteger(), sa.ForeignKey("serp_checks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("host", sa.String(190), nullable=False),
        sa.Column("domain", sa.String(190), nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Index("ix_serp_results_check", "check_id", "position"),
        sa.Index("ix_serp_results_domain", "domain", "check_id"),
    )
    op.create_table(
        "ai_citations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("check_id", sa.BigInteger(), sa.ForeignKey("serp_checks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("host", sa.String(190), nullable=False),
        sa.Column("domain", sa.String(190), nullable=False),
        sa.Index("ix_ai_citations_check", "check_id"),
        sa.Index("ix_ai_citations_domain", "domain", "check_id"),
    )

    # ---- search tools: keys are encrypted, and free use is counted per month --------------------
    op.create_table(
        "connections",
        sa.Column("tool", sa.String(40), primary_key=True),
        sa.Column("secret", sa.Text(), nullable=False),
        sa.Column("last4", sa.String(8), nullable=False),
        sa.Column("last_ok_at", Stamp, nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        _stamp(),
    )
    op.create_table(
        "tool_usage",
        sa.Column("tool", sa.String(40), primary_key=True),
        sa.Column("period", sa.String(7), primary_key=True),  # YYYY-MM in UTC
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
    )

    # ---- competitors ------------------------------------------------------------------------
    op.create_table(
        "site_competitors",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("competitor_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("source", sa.String(12), nullable=False, server_default="suggested"),  # suggested or manual
        _stamp(),
    )
    op.create_table(
        "competitor_dismissals",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("domain", sa.String(190), primary_key=True),
        _stamp(),
    )
    op.create_table(
        "competitor_crawls",
        sa.Column("competitor_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="queued"),  # queued, running, ok, blocked, failed
        sa.Column("pages_known", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages_read", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("baseline_done", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("message", sa.String(500), nullable=True),
        sa.Column("started_at", Stamp, nullable=True),
        sa.Column("finished_at", Stamp, nullable=True),
    )
    op.create_table(
        "page_pairs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("competitor_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("my_url", sa.Text(), nullable=False),
        sa.Column("my_url_hash", sa.String(64), nullable=False),
        sa.Column("their_url", sa.Text(), nullable=False),
        sa.Column("source", sa.String(8), nullable=False, server_default="auto"),  # auto, or manual, which is never overwritten
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("shared_keywords", sa.Integer(), nullable=False, server_default="0"),
        _stamp(),
        sa.Column("updated_at", Stamp, nullable=False, server_default=NOW3),
        sa.UniqueConstraint("site_id", "competitor_id", "my_url_hash", name="uq_page_pair"),
    )
    op.create_table(
        "competitor_referrers",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("competitor_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.String(190), nullable=False),
        sa.Column("sample_url", sa.Text(), nullable=True),
        sa.Column("authority", sa.Integer(), nullable=True),
        sa.Column("authority_label", sa.String(120), nullable=True),
        sa.Column("spam_score", sa.Float(), nullable=True),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_label", sa.String(60), nullable=True),
        sa.Column("in_common_crawl", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        _stamp("first_seen_at"),
        sa.Column("last_seen_at", Stamp, nullable=False, server_default=NOW3),
        sa.UniqueConstraint("competitor_id", "domain", name="uq_competitor_referrer"),
        sa.Index("ix_competitor_referrers_domain", "domain"),
    )

    # ---- is a linking domain any good? One judgement per domain, shared by every competitor ------
    op.create_table(
        "link_domains",
        sa.Column("domain", sa.String(190), primary_key=True),
        sa.Column("quality", sa.String(8), nullable=False, server_default="pending"),  # pending, good, spam
        sa.Column("reason", sa.String(30), nullable=True),
        sa.Column("page_note", sa.String(20), nullable=True),
        sa.Column("page_title", sa.String(300), nullable=True),
        sa.Column("check_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checked_at", Stamp, nullable=True),
        sa.Column("cc_rank", sa.BigInteger(), nullable=True),
        sa.Column("cc_total", sa.BigInteger(), nullable=True),
        sa.Column("cc_outlinks", sa.Integer(), nullable=True),
        sa.Column("cc_hosts", sa.Integer(), nullable=True),
        _stamp(),
        sa.Index("ix_link_domains_quality", "quality", "cc_rank"),
    )
    op.create_table(
        "link_gap_overrides",
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("domain", sa.String(190), primary_key=True),
        sa.Column("decision", sa.String(6), nullable=False),  # keep or spam. A person's decision beats every rule.
        _stamp(),
    )
    op.create_table(
        "competitor_common_crawl",
        sa.Column("competitor_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("release_name", sa.String(60), nullable=False),
        sa.Column("domains", sa.Integer(), nullable=False, server_default="0"),
        _stamp("run_at"),
    )

    # ---- website icons, kept here so a list of links is never sent to anyone else --------------
    op.create_table(
        "site_logos",
        sa.Column("domain", sa.String(190), primary_key=True),
        sa.Column("status", sa.String(8), nullable=False, server_default="pending"),  # pending, found, none
        sa.Column("image", LONGBLOB(), nullable=True),
        sa.Column("content_type", sa.String(40), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("checked_at", Stamp, nullable=True),
        _stamp(),
        sa.Index("ix_site_logos_status", "status"),
    )

    # ---- my own links: the two lists a link gap is checked against -----------------------------
    op.create_table(
        "backlinks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("domain", sa.String(190), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="live"),  # live, lost, planned, or found (never logged)
        sa.Column("target_url", sa.Text(), nullable=True),
        sa.Column("anchor", sa.Text(), nullable=True),
        sa.Column("link_type", sa.String(120), nullable=True),
        sa.Column("placed", sa.String(80), nullable=True),  # dates stay as typed: YYYY-MM-DD is preferred, not required
        sa.Column("due", sa.String(80), nullable=True),
        sa.Column("renewal", sa.String(80), nullable=True),
        sa.Column("price_text", sa.String(80), nullable=True),  # as typed, because the currency matters
        sa.Column("cost", sa.Numeric(12, 2), nullable=True),  # the number read from it, in that currency
        sa.Column("mediator", sa.String(190), nullable=True),
        sa.Column("contact", sa.String(255), nullable=True),
        sa.Column("platform", sa.String(190), nullable=True),
        sa.Column("utm_source", sa.String(190), nullable=True),
        sa.Column("utm_medium", sa.String(190), nullable=True),
        sa.Column("utm_campaign", sa.String(190), nullable=True),
        sa.Column("owner", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        _stamp(),
        sa.Index("ix_backlinks_site_domain", "site_id", "domain"),
    )
    op.create_table(
        "prospects",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("domain", sa.String(190), nullable=False),
        sa.Column("authority", sa.Integer(), nullable=True),
        sa.Column("authority_label", sa.String(120), nullable=True),
        sa.Column("spam_score", sa.Float(), nullable=True),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_kind", sa.String(12), nullable=False, server_default="csv"),  # csv or link_gap
        _stamp(),
        sa.UniqueConstraint("site_id", "domain", name="uq_prospect_domain"),
    )

    # ---- notes -------------------------------------------------------------------------------
    op.create_table(
        "notes",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("scope", sa.String(12), nullable=False),  # all, competitor, page
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=True),
        sa.Column("competitor_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=True),
        sa.Column("page_url", sa.Text(), nullable=True),
        sa.Column("page_hash", sa.String(64), nullable=True),
        sa.Column("body", MEDIUMTEXT(), nullable=False),
        sa.Column("deleted_at", Stamp, nullable=True),
        _stamp(),
        sa.Column("updated_at", Stamp, nullable=False, server_default=NOW3),
        sa.Index("ix_notes_competitor", "competitor_id", "created_at"),
        sa.Index("ix_notes_page", "page_hash"),
        sa.CheckConstraint("scope IN ('all', 'competitor', 'page')", name="ck_notes_scope"),
    )

    # ---- monthly health test, and alerts -------------------------------------------------------
    op.create_table(
        "health_audits",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="queued"),  # queued, running, complete, stopped, failed
        sa.Column("trigger_kind", sa.String(10), nullable=False, server_default="button"),  # button or monthly
        sa.Column("max_pages", sa.Integer(), nullable=True),  # no limit
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("stop_reason", sa.String(12), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("pages_read", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_robots", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages_not_read", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stopped_at_limit", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("requests_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("counts", sa.JSON(), nullable=True),
        sa.Column("paused_until", Stamp, nullable=True),  # the daily budget ran out, and it carries on then
        sa.Column("error", sa.Text(), nullable=True),
        _stamp(),
        sa.Column("started_at", Stamp, nullable=True),
        sa.Column("finished_at", Stamp, nullable=True),
        sa.Index("ix_health_audits_site_created", "site_id", "created_at"),
    )
    op.create_table(
        "crawl_states",  # a long scan's working data between chunks: gzipped JSON, in parts, gone when the scan ends
        sa.Column("kind", sa.String(10), primary_key=True),  # links or health
        sa.Column("run_id", sa.BigInteger(), primary_key=True, autoincrement=False),  # link_scans.id or health_audits.id
        sa.Column("part", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", LONGBLOB(), nullable=False),
        _stamp("saved_at"),
    )
    op.create_table(
        "health_issues",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("audit_id", sa.BigInteger(), sa.ForeignKey("health_audits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages", sa.JSON(), nullable=True),
        sa.Index("ix_health_issues_audit", "audit_id"),
    )
    op.create_table(
        "alerts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("severity", sa.String(8), nullable=False),  # crit or warn
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("audit_id", sa.BigInteger(), nullable=True),
        _stamp(),
        sa.Column("acknowledged_at", Stamp, nullable=True),
        sa.Index("ix_alerts_open", "acknowledged_at", "created_at"),
    )


def downgrade() -> None:
    for table in (
        "alerts", "health_issues", "crawl_states", "health_audits", "notes", "prospects", "backlinks", "site_logos", "competitor_common_crawl", "link_gap_overrides", "link_domains", "competitor_referrers",
        "page_pairs", "competitor_crawls", "competitor_dismissals", "site_competitors", "ai_citations", "serp_results",
        "serp_checks", "serp_targets", "site_keywords", "keyword_uploads", "keywords", "tool_usage", "connections",
    ):
        op.drop_table(table)
    op.drop_column("pages", "extras")
    op.drop_column("sites", "health_monthly")
