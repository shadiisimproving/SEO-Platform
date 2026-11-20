"""Database tables. Times are UTC and come from the database, never from Python."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, BigInteger, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.mysql import DATETIME, LONGBLOB, MEDIUMTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NOW3 = text("CURRENT_TIMESTAMP(3)")
Stamp = DATETIME(fsp=3)


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_claim", "lane", "status", "run_after", "id"),
        Index("ix_jobs_lease", "status", "lease_expires_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lane: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(190), nullable=True)
    # Same as dedupe_key while the job is active, NULL afterwards. MariaDB has no
    # partial unique index, and a unique index allows many NULLs, so this gives
    # "only one active job per key" without blocking future runs.
    active_key: Mapped[str | None] = mapped_column(String(190), nullable=True, unique=True)
    status: Mapped[str] = mapped_column(String(10), server_default="queued")
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    max_attempts: Mapped[int] = mapped_column(Integer, server_default="3")
    lease_losses: Mapped[int] = mapped_column(Integer, server_default="0")
    run_after: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class LaneRun(Base):
    """When each lane last ran. Today reads this to spot a dead scheduler."""

    __tablename__ = "lane_runs"

    lane: Mapped[str] = mapped_column(String(20), primary_key=True)
    last_started_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_ok_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_processed: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Site(Base):
    """Websites added in the app. `kind` is the only thing that says a site is mine.

    The `domains` table is not an allow-list: competitors go through the same crawler and it has no such flag.
    """

    __tablename__ = "sites"
    __table_args__ = (CheckConstraint("kind IN ('own', 'competitor')", name="ck_sites_kind"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host: Mapped[str] = mapped_column(String(190), unique=True)  # lowercase, without www
    start_url: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(12))
    links_weekly: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    links_check_external: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    health_monthly: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    setup_not_used: Mapped[list | None] = mapped_column(JSON, nullable=True)  # steps of the setup checklist this site doesn't use
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class LinkScan(Base):
    __tablename__ = "link_scans"
    __table_args__ = (Index("ix_link_scans_site_created", "site_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), server_default="queued")  # queued, running, complete, stopped, failed
    trigger_kind: Mapped[str] = mapped_column(String(10), server_default="button")  # button or weekly
    max_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)  # no limit
    check_external: Mapped[bool] = mapped_column(Boolean)
    stop_requested: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    stop_reason: Mapped[str | None] = mapped_column(String(12), nullable=True)  # user
    pages_read: Mapped[int] = mapped_column(Integer, server_default="0")
    links_checked: Mapped[int] = mapped_column(Integer, server_default="0")
    skipped_robots: Mapped[int] = mapped_column(Integer, server_default="0")
    too_large: Mapped[int] = mapped_column(Integer, server_default="0")
    pages_not_read: Mapped[int] = mapped_column(Integer, server_default="0")
    external_not_checked: Mapped[int] = mapped_column(Integer, server_default="0")
    stopped_at_limit: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    external_left: Mapped[int] = mapped_column(Integer, server_default="0")
    requests_used: Mapped[int] = mapped_column(Integer, server_default="0")
    paused_until: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)  # the daily budget ran out, and it carries on then
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    started_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class LinkIssue(Base):
    """One problem with one target. `pages` lists every page containing the link."""

    __tablename__ = "link_issues"
    __table_args__ = (Index("ix_link_issues_scan_category", "scan_id", "category"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    scan_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("link_scans.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(12))  # broken, unverified, redirect, slow
    target_url: Mapped[str] = mapped_column(Text)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str] = mapped_column(String(1000))
    hops: Mapped[int | None] = mapped_column(Integer, nullable=True)
    seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    pages: Mapped[list] = mapped_column(JSON)


class CrawlBudget(Base):
    """Requests sent per UTC day. Every crawler counts here against one daily limit."""

    __tablename__ = "crawl_budget"

    day: Mapped[datetime] = mapped_column(Date, primary_key=True)
    used: Mapped[int] = mapped_column(Integer, server_default="0")


class Domain(Base):
    __tablename__ = "domains"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    host: Mapped[str] = mapped_column(String(190), unique=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class Page(Base):
    """Latest known state of one URL. Updated in place, so this table stays flat."""

    __tablename__ = "pages"
    __table_args__ = (Index("ix_pages_domain_checked", "domain_id", "last_checked_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    url_hash: Mapped[str] = mapped_column(String(64), unique=True)
    last_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    etag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    meta_description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    canonical: Mapped[str | None] = mapped_column(Text, nullable=True)
    robots_meta: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lang: Mapped[str | None] = mapped_column(String(20), nullable=True)
    h1: Mapped[list | None] = mapped_column(JSON, nullable=True)
    headings: Mapped[list | None] = mapped_column(JSON, nullable=True)
    word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    schema_types: Mapped[list | None] = mapped_column(JSON, nullable=True)
    internal_links: Mapped[int | None] = mapped_column(Integer, nullable=True)
    external_links: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    js_only: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    read_with: Mapped[str | None] = mapped_column(String(10), nullable=True)  # firecrawl: the daily reader leaves this page alone
    extras: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sitemap_lastmod: Mapped[date | None] = mapped_column(Date, nullable=True)  # the date the site's own sitemap gives
    first_archived: Mapped[date | None] = mapped_column(Date, nullable=True)  # the Wayback Machine's first copy of this page
    first_seen_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    last_checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_changed_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class PageVersion(Base):
    """A snapshot, written only when a page changed, so a real text diff can be shown."""

    __tablename__ = "page_versions"
    __table_args__ = (Index("ix_versions_page_taken", "page_id", "taken_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"))
    taken_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    fields: Mapped[dict] = mapped_column(JSON)
    text_gz: Mapped[bytes] = mapped_column(LONGBLOB)


class ChangeEvent(Base):
    __tablename__ = "change_events"
    __table_args__ = (Index("ix_changes_domain_detected", "domain_id", "detected_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"))
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))
    before_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    summaries: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # optional AI summaries per language, kept so a request is never used twice
    changed_words: Mapped[int | None] = mapped_column(Integer, nullable=True)  # a text edit: about how many words changed, so a small one says so


class Keyword(Base):
    __tablename__ = "keywords"
    __table_args__ = (UniqueConstraint("keyword_hash", "country", "language", name="uq_keywords_market"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    keyword: Mapped[str] = mapped_column(String(400))
    keyword_hash: Mapped[str] = mapped_column(String(64))  # of the cleaned text, so case and spacing don't split it
    country: Mapped[str] = mapped_column(String(2), server_default="")  # empty means any country
    language: Mapped[str] = mapped_column(String(10), server_default="")
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class KeywordUpload(Base):
    __tablename__ = "keyword_uploads"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    engine: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(8), server_default="upload")  # upload (first check) or refresh
    status: Mapped[str] = mapped_column(String(12), server_default="queued")  # queued, running, complete, waiting
    stop_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    total: Mapped[int] = mapped_column(Integer, server_default="0")
    new_keywords: Mapped[int] = mapped_column(Integer, server_default="0")
    checked: Mapped[int] = mapped_column(Integer, server_default="0")
    failed: Mapped[int] = mapped_column(Integer, server_default="0")
    tool: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class SiteKeyword(Base):
    __tablename__ = "site_keywords"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    keyword_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("keywords.id", ondelete="CASCADE"), primary_key=True)
    upload_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class ProbeKeyword(Base):
    """A keyword typed in Keyword check, to see which competitors rank for it. Never part of the site's own list."""

    __tablename__ = "probe_keywords"
    __table_args__ = (UniqueConstraint("site_id", "keyword_id", name="uq_probe_keyword"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    keyword_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("keywords.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class ProbeRun(Base):
    __tablename__ = "probe_runs"
    __table_args__ = (Index("ix_probe_runs_site", "site_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    engine: Mapped[str] = mapped_column(String(12))
    only_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(10), server_default="queued")  # queued, running, complete, waiting
    total: Mapped[int] = mapped_column(Integer, server_default="0")
    checked: Mapped[int] = mapped_column(Integer, server_default="0")
    failed: Mapped[int] = mapped_column(Integer, server_default="0")
    tool: Mapped[str | None] = mapped_column(String(40), nullable=True)
    stop_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class SerpTarget(Base):
    __tablename__ = "serp_targets"
    __table_args__ = (UniqueConstraint("keyword_id", "engine", "device", name="uq_serp_target"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    keyword_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("keywords.id", ondelete="CASCADE"))
    engine: Mapped[str] = mapped_column(String(20))
    device: Mapped[str] = mapped_column(String(10), server_default="desktop")


class SerpCheck(Base):
    __tablename__ = "serp_checks"
    __table_args__ = (Index("ix_serp_checks_target_time", "target_id", "checked_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    target_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("serp_targets.id", ondelete="CASCADE"))
    tool: Mapped[str] = mapped_column(String(40))
    real_location: Mapped[str] = mapped_column(String(12), server_default="")  # what the tool really searched from
    depth: Mapped[int] = mapped_column(Integer, server_default="10")
    status: Mapped[str] = mapped_column(String(10), server_default="ok")  # ok, suspect, failed
    ai_state: Mapped[str] = mapped_column(String(14), server_default="not_captured")  # present, absent, not_captured
    features_state: Mapped[str] = mapped_column(String(14), server_default="not_captured")  # featured snippet, questions, rich results
    trigger_kind: Mapped[str] = mapped_column(String(14), server_default="refresh")  # first_upload, refresh
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class SerpResult(Base):
    __tablename__ = "serp_results"
    __table_args__ = (
        Index("ix_serp_results_check", "check_id", "position"),
        Index("ix_serp_results_domain", "domain", "check_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    check_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("serp_checks.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    url: Mapped[str] = mapped_column(Text)
    host: Mapped[str] = mapped_column(String(190))
    domain: Mapped[str] = mapped_column(String(190))
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)


class SerpFeature(Base):
    """What a results page showed besides the ten links: who holds the featured snippet, its questions, rich results."""

    __tablename__ = "serp_features"
    __table_args__ = (Index("ix_serp_features_check", "check_id", "kind"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    check_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("serp_checks.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))  # snippet, question, rating, faq, sitelinks
    host: Mapped[str | None] = mapped_column(String(190), nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str | None] = mapped_column(String(500), nullable=True)


class AiCitation(Base):
    __tablename__ = "ai_citations"
    __table_args__ = (
        Index("ix_ai_citations_check", "check_id"),
        Index("ix_ai_citations_domain", "domain", "check_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    check_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("serp_checks.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    host: Mapped[str] = mapped_column(String(190))
    domain: Mapped[str] = mapped_column(String(190))


class Connection(Base):
    """A search tool's key, encrypted."""

    __tablename__ = "connections"

    tool: Mapped[str] = mapped_column(String(40), primary_key=True)
    secret: Mapped[str] = mapped_column(Text)
    last4: Mapped[str] = mapped_column(String(8))
    last_ok_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class ToolUsage(Base):
    __tablename__ = "tool_usage"

    tool: Mapped[str] = mapped_column(String(40), primary_key=True)
    period: Mapped[str] = mapped_column(String(7), primary_key=True)  # YYYY-MM in UTC
    used: Mapped[int] = mapped_column(Integer, server_default="0")


class SiteCompetitor(Base):
    __tablename__ = "site_competitors"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    competitor_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    source: Mapped[str] = mapped_column(String(12), server_default="suggested")  # suggested or manual
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    # on; pages: keyword numbers hidden, pages still read; off: paused. No setting ever spends a search on a competitor.
    tracking: Mapped[str] = mapped_column(String(8), server_default="on")


class CompetitorDismissal(Base):
    __tablename__ = "competitor_dismissals"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class CompetitorCrawl(Base):
    __tablename__ = "competitor_crawls"

    competitor_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(12), server_default="queued")  # queued, running, ok, blocked, failed
    pages_known: Mapped[int] = mapped_column(Integer, server_default="0")
    pages_read: Mapped[int] = mapped_column(Integer, server_default="0")
    baseline_done: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    list_source: Mapped[str | None] = mapped_column(String(10), nullable=True)  # sitemap, feed or links
    list_capped: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    fc_status: Mapped[str | None] = mapped_column(String(10), nullable=True)  # the last Firecrawl run someone asked for
    fc_action: Mapped[str | None] = mapped_column(String(6), nullable=True)  # map or read
    fc_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fc_done: Mapped[int] = mapped_column(Integer, server_default="0")
    fc_asked: Mapped[int] = mapped_column(Integer, server_default="0")
    fc_finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    follow_mode: Mapped[str | None] = mapped_column(String(12), nullable=True)  # all, sitemap, wordpress or tiers: how today's read chose its pages
    dates_agreed: Mapped[int] = mapped_column(Integer, server_default="0")  # edits the site's own dates announced
    dates_missed: Mapped[int] = mapped_column(Integer, server_default="0")  # edits they didn't: enough of these and its dates aren't trusted
    wp_api: Mapped[str | None] = mapped_column(String(4), nullable=True)  # yes or no: WordPress lists its edits, asked again weekly
    wp_checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    fc_weekly: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))  # the owner said yes to a weekly Firecrawl check of ranking pages


class PagePair(Base):
    __tablename__ = "page_pairs"
    __table_args__ = (UniqueConstraint("site_id", "competitor_id", "my_url_hash", name="uq_page_pair"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    competitor_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    my_url: Mapped[str] = mapped_column(Text)
    my_url_hash: Mapped[str] = mapped_column(String(64))
    their_url: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(8), server_default="auto")  # auto, or manual, which is never overwritten
    hidden: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    shared_keywords: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    updated_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class CompetitorReferrer(Base):
    __tablename__ = "competitor_referrers"
    __table_args__ = (
        UniqueConstraint("competitor_id", "domain", name="uq_competitor_referrer"),
        Index("ix_competitor_referrers_domain", "domain"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    competitor_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    domain: Mapped[str] = mapped_column(String(190))
    sample_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    authority_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    spam_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    in_common_crawl: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    # Someone said this competitor has no such link. Kept rather than deleted, so a later upload can't bring it back.
    removed_by_hand: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    first_seen_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    last_seen_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class CompetitorReferrerLink(Base):
    """Every link inside a CompetitorReferrer, as the competitor's backlink file lists it: anchor text, Page Authority, both pages."""

    __tablename__ = "competitor_referrer_links"
    __table_args__ = (
        UniqueConstraint("competitor_id", "link_hash", name="uq_competitor_referrer_link"),
        Index("ix_competitor_referrer_links_domain", "domain", "competitor_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    competitor_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    domain: Mapped[str] = mapped_column(String(190))
    link_hash: Mapped[str] = mapped_column(String(40))  # source page + target page + anchor
    source_url: Mapped[str] = mapped_column(Text)
    source_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    target_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    anchor: Mapped[str | None] = mapped_column(String(500), nullable=True)
    authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spam_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    first_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class LinkDomain(Base):
    """Is a linking domain any good? One judgement per domain, shared by every competitor."""

    __tablename__ = "link_domains"
    __table_args__ = (Index("ix_link_domains_quality", "quality", "cc_rank"),)

    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    quality: Mapped[str] = mapped_column(String(8), server_default="pending")
    reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    page_note: Mapped[str | None] = mapped_column(String(20), nullable=True)
    page_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    check_attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    cc_rank: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cc_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cc_outlinks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cc_hosts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class SiteLogo(Base):
    """A website's icon, kept here so a list of links is never sent to anyone else."""

    __tablename__ = "site_logos"
    __table_args__ = (Index("ix_site_logos_status", "status"),)

    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    status: Mapped[str] = mapped_column(String(8), server_default="pending")
    image: Mapped[bytes | None] = mapped_column(LONGBLOB, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class LinkGapOverride(Base):
    """A person's decision about a domain. It beats every rule."""

    __tablename__ = "link_gap_overrides"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    decision: Mapped[str] = mapped_column(String(6))
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class LinkDomainEdit(Base):
    """What someone read in a tool with no connection here. It beats files and Common Crawl, which never change it."""

    __tablename__ = "link_domain_edits"

    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    authority_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sample_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    edited_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    edited_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class CompetitorCommonCrawl(Base):
    __tablename__ = "competitor_common_crawl"

    competitor_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    release_name: Mapped[str] = mapped_column(String(60))
    domains: Mapped[int] = mapped_column(Integer, server_default="0")
    run_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class Backlink(Base):
    __tablename__ = "backlinks"
    __table_args__ = (Index("ix_backlinks_site_domain", "site_id", "domain"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    source_url: Mapped[str] = mapped_column(Text)
    domain: Mapped[str] = mapped_column(String(190))
    status: Mapped[str] = mapped_column(String(10), server_default="live")  # live, lost, planned, or found (never logged)
    target_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    anchor: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    placed: Mapped[str | None] = mapped_column(String(80), nullable=True)  # dates stay as typed: YYYY-MM-DD is preferred, not required
    due: Mapped[str | None] = mapped_column(String(80), nullable=True)
    renewal: Mapped[str | None] = mapped_column(String(80), nullable=True)
    price_text: Mapped[str | None] = mapped_column(String(80), nullable=True)  # as typed, because the currency matters
    cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)  # the number read from it, in that currency
    billed_text: Mapped[str | None] = mapped_column(String(80), nullable=True)  # what we were billed, as typed (Bought links); 60 + the formula guard
    billed: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)  # the number read from it; cost stays the real cost
    mediator: Mapped[str | None] = mapped_column(String(190), nullable=True)
    page_authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1 to 5, carried over from In consideration
    article_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # the Google Doc a mediator gets for a guest post
    sent_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)  # on a planned link: when it went to the mediator
    contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(190), nullable=True)
    utm_source: Mapped[str | None] = mapped_column(String(190), nullable=True)
    utm_medium: Mapped[str | None] = mapped_column(String(190), nullable=True)
    utm_campaign: Mapped[str | None] = mapped_column(String(190), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Kept from the prospect this link came from, so placing a link doesn't lose what was known about the site.
    authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    authority_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    spam_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    # The latest live check. The history is in backlink_checks.
    checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    check_outcome: Mapped[str | None] = mapped_column(String(10), nullable=True)
    check_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_nofollow: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    seen_rel: Mapped[str | None] = mapped_column(String(120), nullable=True)
    seen_anchor: Mapped[str | None] = mapped_column(Text, nullable=True)
    seen_href: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_final_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    lost_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    miss_count: Mapped[int] = mapped_column(Integer, server_default="0")
    # Does it count for Google, from the same reading: counts, weak or none, with the reasons (noindex, nofollow, sponsored...).
    seo_verdict: Mapped[str | None] = mapped_column(String(8), nullable=True)
    seo_reasons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    page_lang: Mapped[str | None] = mapped_column(String(16), nullable=True)  # the linking page's language, and my target page's
    target_lang: Mapped[str | None] = mapped_column(String(16), nullable=True)
    outbound_links: Mapped[int | None] = mapped_column(Integer, nullable=True)  # links to other websites on the linking page: a link farm has hundreds
    target_http: Mapped[int | None] = mapped_column(Integer, nullable=True)  # what my target page answered: a 404 there is a link to reclaim
    found_by: Mapped[str | None] = mapped_column(String(40), nullable=True)  # who saw a link nobody logged, such as Search Console
    # What Search Console's Links export says: "page" when it lists this linking page, "site" when only its domain.
    gsc_seen: Mapped[str | None] = mapped_column(String(6), nullable=True)
    gsc_seen_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    gsc_crawled: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Google's own "last crawled" date, as the file wrote it
    disavow: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))  # marked spam by a person, for the disavow file
    # Is the linking page on Google, from a site: search on free search credits: indexed, not_found (one miss), not_indexed (two)
    src_index: Mapped[str | None] = mapped_column(String(14), nullable=True)
    src_index_via: Mapped[str | None] = mapped_column(String(40), nullable=True)
    src_index_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    src_index_misses: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    keyword: Mapped[str | None] = mapped_column(String(255), nullable=True)  # the keyword this link is meant to help, as the owner wrote it
    # Set by hand: brand, url, exact, partial, generic or other. Empty means it's worked out from the anchor text.
    anchor_kind: Mapped[str | None] = mapped_column(String(10), nullable=True)


class Prospect(Base):
    __tablename__ = "prospects"
    __table_args__ = (UniqueConstraint("site_id", "domain", name="uq_prospect_domain"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    domain: Mapped[str] = mapped_column(String(190))
    authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    authority_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    spam_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_kind: Mapped[str] = mapped_column(String(12), server_default="csv")  # csv or link_gap
    page_authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1 to 5, set by hand
    owner: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stage: Mapped[str] = mapped_column(String(20), server_default="new")  # new, contacted, agreed or refused
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_competitor", "competitor_id", "created_at"),
        Index("ix_notes_page", "page_hash"),
        Index("ix_notes_screen", "screen", "site_id"),
        Index("ix_notes_keyword", "keyword_hash", "site_id"),
        Index("ix_notes_day", "day", "site_id"),
        Index("ix_notes_domain", "domain", "site_id"),
        CheckConstraint("scope IN ('all', 'competitor', 'page', 'site', 'screen', 'keyword', 'date', 'domain', 'section', 'task')", name="ck_notes_scope"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(12))  # all (competitors), competitor, page, site (no site_id: all my sites), screen, keyword, date, domain, section, task
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), nullable=True)
    competitor_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), nullable=True)
    page_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    screen: Mapped[str | None] = mapped_column(String(40), nullable=True)  # the screen a "screen" note is about, such as backlinks
    keyword: Mapped[str | None] = mapped_column(String(400), nullable=True)  # a "keyword" note's search words, as typed
    keyword_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # the same keyword whatever its case and spacing
    day: Mapped[date | None] = mapped_column(Date, nullable=True)  # a "date" note's day: it shows on the charts
    domain: Mapped[str | None] = mapped_column(String(190), nullable=True)  # a "domain" note's linking website, such as a link seller
    task_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tasks.id", ondelete="CASCADE", name="fk_notes_task"), nullable=True)
    # A "section" note keeps its group's address in page_url, ending in "/": it shows on every page under it.
    body: Mapped[str] = mapped_column(MEDIUMTEXT)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)  # the signed-in person's name; empty on older notes and without login
    updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    updated_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)



class NoteFile(Base):
    """An image or any other file on a note. The file itself sits on disk: see seo/competitors/notes.py."""

    __tablename__ = "note_files"
    __table_args__ = (
        UniqueConstraint("stored_name", name="uq_note_files_stored"),
        Index("ix_note_files_note", "note_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    note_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notes.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    image_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # set only when the bytes really are an image
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    stored_name: Mapped[str] = mapped_column(String(64))
    deleted_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class HealthAudit(Base):
    """One monthly or button health test of one of my own sites."""

    __tablename__ = "health_audits"
    __table_args__ = (Index("ix_health_audits_site_created", "site_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), server_default="queued")  # queued, running, complete, stopped, failed
    trigger_kind: Mapped[str] = mapped_column(String(10), server_default="button")  # button or monthly
    max_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)  # no limit
    stop_requested: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    stop_reason: Mapped[str | None] = mapped_column(String(12), nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pages_read: Mapped[int] = mapped_column(Integer, server_default="0")
    skipped_robots: Mapped[int] = mapped_column(Integer, server_default="0")
    pages_not_read: Mapped[int] = mapped_column(Integer, server_default="0")
    stopped_at_limit: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    requests_used: Mapped[int] = mapped_column(Integer, server_default="0")
    counts: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    paused_until: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)  # the daily budget ran out, and it carries on then
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    started_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class CrawlStatePart(Base):
    """A long scan's working data between chunks, gzipped JSON. Gone when the scan ends. See seo/links/saved_state.py."""

    __tablename__ = "crawl_states"

    kind: Mapped[str] = mapped_column(String(10), primary_key=True)  # links or health
    run_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)  # link_scans.id or health_audits.id
    part: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    state: Mapped[bytes] = mapped_column(LONGBLOB)
    saved_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class HealthIssue(Base):
    __tablename__ = "health_issues"
    __table_args__ = (Index("ix_health_issues_audit", "audit_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    audit_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("health_audits.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(30))
    page_count: Mapped[int] = mapped_column(Integer, server_default="0")
    pages: Mapped[list | None] = mapped_column(JSON, nullable=True)


class TodaySeen(Base):
    """A page drop on Today isn't an alert, so marking it as seen is kept here. It comes back with the next week's numbers."""

    __tablename__ = "today_seen"

    item_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    hidden_until: Mapped[date] = mapped_column(Date)
    seen_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class Alert(Base):
    """Stays in the app until someone marks it as seen."""

    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_open", "acknowledged_at", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30))
    severity: Mapped[str] = mapped_column(String(8))  # crit or warn
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    audit_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    acknowledged_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class Notification(Base):
    """The bell at the top of every screen: news worth knowing that isn't a problem, such as a new search on Google.
    One per subject, ever, so the same query is never announced twice."""

    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("site_id", "kind", "subject_key", name="uq_notifications_subject"),
        Index("ix_notifications_recent", "read_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30))
    subject_key: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    read_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class NotificationMark(Base):
    """The last Search Console day a check looked at, per site, so each day is looked at once."""

    __tablename__ = "notification_marks"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), primary_key=True)
    through: Mapped[date] = mapped_column(Date)


class Task(Base):
    """Work the whole team shares. A task made from a finding keeps that finding in `source`."""

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("status IN ('todo', 'doing', 'done')", name="ck_tasks_status"),
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="ck_tasks_priority"),
        Index("ix_tasks_board", "deleted_at", "status", "due_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(10), server_default="todo")
    priority: Mapped[str] = mapped_column(String(10), server_default="medium")
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    # Kept when the site is removed, so its tasks don't start reading as "all sites".
    site_host: Mapped[str | None] = mapped_column(String(190), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    kind: Mapped[str | None] = mapped_column(String(40), nullable=True)
    hypothesis: Mapped[str | None] = mapped_column(String(300), nullable=True)
    impact: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hours_estimate: Mapped[float | None] = mapped_column(Float, nullable=True)
    hours_spent: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Who the task is assigned to: an account's name, picked from the team in the panel.
    owner_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)  # the signed-in account, set once
    comments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # What the task is about, as lists of text, so it can show when that page or keyword is opened.
    pages: Mapped[list | None] = mapped_column(JSON, nullable=True)
    keywords: Mapped[list | None] = mapped_column(JSON, nullable=True)
    about: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {main, items: [{kind, ref, label}]}: rankings, backlinks, technical issues and more
    source: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # A hash of the finding while this task is open, NULL afterwards: one open task per finding, as with Job.active_key.
    open_source_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    completed_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    updated_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    deleted_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


# ---- Accounts ------------------------------------------------------------------------------------


class User(Base):
    """An account the admin created. There is no sign-up page."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('admin', 'member')", name="ck_users_role"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(190), unique=True)  # lowercase
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(10), server_default="member")
    must_change_password: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    disabled: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    failed_logins: Mapped[int] = mapped_column(Integer, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    # Raised on a password change, a reset or a disable: every session signed before it stops working.
    session_version: Mapped[int] = mapped_column(Integer, server_default="1")
    # NULL: full access. Otherwise the websites and sections the admin chose (seo/accounts/access.py).
    access: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class LoginFailure(Base):
    """Wrong passwords per account and address, so a stranger's guesses can't keep the owner out from their own address."""

    __tablename__ = "login_failures"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    source: Mapped[str] = mapped_column(String(45), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, server_default="0")
    last_failed_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    locked_until: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


# ---- Where a site's data comes from --------------------------------------------------------------


class GoogleConnection(Base):
    """A robot key or OAuth keys, encrypted. Any number of them; each site picks one."""

    __tablename__ = "google_connections"
    __table_args__ = (CheckConstraint("kind IN ('robot', 'oauth')", name="ck_google_connections_kind"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(8))
    secret: Mapped[str] = mapped_column(Text)
    last4: Mapped[str] = mapped_column(String(8))
    robot_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_ok_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class SiteSource(Base):
    """One site's use of one data source. not_used is a choice, not a problem: no alert is raised."""

    __tablename__ = "site_sources"
    __table_args__ = (UniqueConstraint("site_id", "source", name="uq_site_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(20))  # gsc, ga4, clarity, bing, yandex, pagespeed
    connection_id: Mapped[int | None] = mapped_column(ForeignKey("google_connections.id", ondelete="SET NULL"), nullable=True)
    property: Mapped[str | None] = mapped_column(String(255), nullable=True)  # sc-domain:x.com, a GA4 number, a Yandex host id
    secret: Mapped[str | None] = mapped_column(Text, nullable=True)  # a per-site token, such as Clarity's
    last4: Mapped[str | None] = mapped_column(String(8), nullable=True)
    not_used: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    backfilled_to: Mapped[date | None] = mapped_column(Date, nullable=True)  # the oldest day already asked for
    data_through: Mapped[date | None] = mapped_column(Date, nullable=True)  # the last final day
    fresh_from: Mapped[date | None] = mapped_column(Date, nullable=True)  # Search Console: first day that isn't final yet
    fresh_through: Mapped[date | None] = mapped_column(Date, nullable=True)  # Search Console: newest day with fresh data
    last_attempt_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_ok_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Coverage(Base):
    """What a source really gave for one day: partial and hidden rows are said out loud, and a missing row is a gap."""

    __tablename__ = "coverage"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    source: Mapped[str] = mapped_column(String(20), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    status: Mapped[str] = mapped_column(String(10), server_default="ok")  # ok, partial
    hid_rows: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))  # GA4 withheld or grouped rows
    rows: Mapped[int] = mapped_column(Integer, server_default="0")
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    saved_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


# ---- Search Console ------------------------------------------------------------------------------
# Keys use a hash of the text: collations treat "é" and "e" as equal, which would add two queries together.


class GscDaily(Base):
    __tablename__ = "gsc_daily"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)


class GscPage(Base):
    __tablename__ = "gsc_page"
    __table_args__ = (Index("ix_gsc_page_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    page_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    page: Mapped[str] = mapped_column(Text)
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)


class GscQuery(Base):
    __tablename__ = "gsc_query"
    __table_args__ = (Index("ix_gsc_query_day", "site_id", "day"), Index("ix_gsc_query_hash", "site_id", "query_hash", "day"))

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    query_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    query: Mapped[str] = mapped_column(String(500))
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)


class GscQueryPage(Base):
    __tablename__ = "gsc_query_page"
    __table_args__ = (Index("ix_gsc_query_page_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    pair_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    query: Mapped[str] = mapped_column(String(500))
    page: Mapped[str] = mapped_column(Text)
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)


class GscCountry(Base):
    __tablename__ = "gsc_country"
    __table_args__ = (Index("ix_gsc_country_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    country: Mapped[str] = mapped_column(String(3), primary_key=True)  # Google's ISO 3166-1 alpha-3, lower case
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)


class GscDevice(Base):
    __tablename__ = "gsc_device"
    __table_args__ = (Index("ix_gsc_device_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    device: Mapped[str] = mapped_column(String(10), primary_key=True)  # DESKTOP, MOBILE, TABLET
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)


class GscVerify(Base):
    """The "Matches Search Console" check: what Google answered live compared with what is saved."""

    __tablename__ = "gsc_verify"
    __table_args__ = (Index("ix_gsc_verify_site", "site_id", "checked_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    ok: Mapped[bool] = mapped_column(Boolean)
    diff: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class SearchNote(Base):
    """A dated note shown as a marker on the Overview chart, such as "changed the titles"."""

    __tablename__ = "search_notes"
    __table_args__ = (Index("ix_search_notes_day", "site_id", "day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    text: Mapped[str] = mapped_column(String(300))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


# ---- GA4 -----------------------------------------------------------------------------------------


class Ga4SourceDaily(Base):
    """Source and medium are kept, so changing a channel rule applies to past days too."""

    __tablename__ = "ga4_source_daily"
    __table_args__ = (Index("ix_ga4_source_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    row_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    channel: Mapped[str] = mapped_column(String(80))  # GA4's own default grouping
    source: Mapped[str] = mapped_column(String(190))
    medium: Mapped[str] = mapped_column(String(190))
    sessions: Mapped[int] = mapped_column(Integer, server_default="0")
    users: Mapped[int] = mapped_column(Integer, server_default="0")
    key_events: Mapped[float] = mapped_column(Float, server_default="0")
    # GA4's engagedSessions. NULL: the day was read before this was asked for, and is read again for it (ga4.py).
    engaged_sessions: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Ga4PageDaily(Base):
    __tablename__ = "ga4_page_daily"
    __table_args__ = (Index("ix_ga4_page_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    page_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    path: Mapped[str] = mapped_column(Text)
    sessions: Mapped[int] = mapped_column(Integer, server_default="0")
    users: Mapped[int] = mapped_column(Integer, server_default="0")
    key_events: Mapped[float] = mapped_column(Float, server_default="0")


class Ga4ReferralDaily(Base):
    """Referring domain and landing page, without rows carrying a UTM campaign: those are counted by UTM only."""

    __tablename__ = "ga4_referral_daily"
    __table_args__ = (Index("ix_ga4_referral_match", "site_id", "domain", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    row_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    domain: Mapped[str] = mapped_column(String(190))
    path: Mapped[str] = mapped_column(Text)
    sessions: Mapped[int] = mapped_column(Integer, server_default="0")
    key_events: Mapped[float] = mapped_column(Float, server_default="0")


class Ga4CampaignDaily(Base):
    __tablename__ = "ga4_campaign_daily"
    __table_args__ = (Index("ix_ga4_campaign_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    row_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    source: Mapped[str] = mapped_column(String(190))
    medium: Mapped[str] = mapped_column(String(190))
    campaign: Mapped[str] = mapped_column(String(190))
    path: Mapped[str] = mapped_column(Text)
    sessions: Mapped[int] = mapped_column(Integer, server_default="0")
    key_events: Mapped[float] = mapped_column(Float, server_default="0")


class Ga4AdsDaily(Base):
    __tablename__ = "ga4_ads_daily"
    __table_args__ = (Index("ix_ga4_ads_day", "site_id", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    row_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    campaign: Mapped[str] = mapped_column(String(190))
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), server_default="0")
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    sessions: Mapped[int] = mapped_column(Integer, server_default="0")
    key_events: Mapped[float] = mapped_column(Float, server_default="0")


# ---- Other sources -------------------------------------------------------------------------------


class ClarityDaily(Base):
    __tablename__ = "clarity_daily"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    sessions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scroll_depth: Mapped[float | None] = mapped_column(Float, nullable=True)
    rage_clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dead_clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    referrers: Mapped[list | None] = mapped_column(JSON, nullable=True)
    raw: Mapped[list | None] = mapped_column(JSON, nullable=True)


class ClarityReport(Base):
    """A dashboard CSV downloaded from Clarity: totals for a whole period, so it never goes into clarity_daily.
    One row per site, kind and period. Uploading the same period again replaces it."""

    __tablename__ = "clarity_reports"
    __table_args__ = (UniqueConstraint("site_id", "kind", "period_start", "period_end", name="uq_clarity_report_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))  # "dashboard" or "ai"
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    project_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    data: Mapped[dict] = mapped_column(JSON)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class BingDaily(Base):
    __tablename__ = "bing_daily"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")


class BingQuery(Base):
    """Bing updates its answer weekly, so each row is what Bing said when last read."""

    __tablename__ = "bing_query"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    query_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    query: Mapped[str] = mapped_column(String(500))
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)
    seen_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class YandexQuery(Base):
    __tablename__ = "yandex_query"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    query_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    query: Mapped[str] = mapped_column(String(500))
    shows: Mapped[int] = mapped_column(Integer, server_default="0")
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)
    seen_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class CwvRun(Base):
    __tablename__ = "cwv_runs"
    __table_args__ = (Index("ix_cwv_site_time", "site_id", "ran_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    strategy: Mapped[str] = mapped_column(String(8))  # mobile, desktop
    performance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lcp_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inp_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cls: Mapped[float | None] = mapped_column(Float, nullable=True)
    field_data: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))  # real visitors' numbers, not a lab run
    ran_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class AuthorityMonthly(Base):
    __tablename__ = "authority_monthly"

    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    month: Mapped[str] = mapped_column(String(7), primary_key=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)


class SiteRule(Base):
    """Editable per site: channel rules, AI domains, key events, page categories. site_id 0 isn't used: a NULL site means every site."""

    __tablename__ = "site_rules"
    __table_args__ = (Index("ix_site_rules_kind", "kind", "site_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), nullable=True)
    kind: Mapped[str] = mapped_column(String(16))  # channel, ai_domain, ai_domain_off, key_event, category
    pattern: Mapped[str] = mapped_column(String(255))
    value: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str | None] = mapped_column(String(40), nullable=True)  # replaced by tags on 2026-11-09; kept, no longer written
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)  # such as ["Brief", "Report"]
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    deleted_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class MozMetric(Base):
    __tablename__ = "moz_metrics"

    target: Mapped[str] = mapped_column(String(190), primary_key=True)  # a domain, as Moz is asked for on items marked important
    important: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    domain_authority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linking_domains: Mapped[int | None] = mapped_column(Integer, nullable=True)
    external_links: Mapped[int | None] = mapped_column(Integer, nullable=True)
    popularity: Mapped[str | None] = mapped_column(String(40), nullable=True)  # Cloudflare Radar's bucket, such as "top 200 thousand"
    popularity_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    fetched_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


# ---- Uptime, certificate and domain expiry ---------------------------------------------------------


class SiteMonitor(Base):
    """What was last seen about one of my sites. A check that's too old reads as unknown, never as up."""

    __tablename__ = "site_monitors"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    watching: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    state: Mapped[str | None] = mapped_column(String(10), nullable=True)  # up, down, unknown
    reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    state_since: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    ssl_expires_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    ssl_problem: Mapped[str | None] = mapped_column(String(30), nullable=True)
    ssl_checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    domain_expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    domain_source: Mapped[str | None] = mapped_column(String(10), nullable=True)  # rdap, manual
    domain_problem: Mapped[str | None] = mapped_column(String(30), nullable=True)
    domain_checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class UptimeIncident(Base):
    __tablename__ = "uptime_incidents"
    __table_args__ = (Index("ix_uptime_incidents_site", "site_id", "started_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    ended_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)


class UptimeDay(Base):
    """How many checks ran on a day. A day with no row wasn't watched, which is different from a day that was fine."""

    __tablename__ = "uptime_days"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    up_checks: Mapped[int] = mapped_column(Integer, server_default="0")
    down_checks: Mapped[int] = mapped_column(Integer, server_default="0")
    unknown_checks: Mapped[int] = mapped_column(Integer, server_default="0")


# ---- Mediators and live checks of backlinks --------------------------------------------------------


class Mediator(Base):
    """Links keep the name as typed, so a spreadsheet upload stays as it was. name_key is what makes two spellings one person."""

    __tablename__ = "mediators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(190))
    name_key: Mapped[str] = mapped_column(String(190), unique=True)
    contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(190), nullable=True)
    price_text: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class BacklinkCheck(Base):
    """One reading of the page a link sits on. History is kept, even when the link turns out to be gone."""

    __tablename__ = "backlink_checks"
    __table_args__ = (Index("ix_backlink_checks_link", "backlink_id", "checked_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    backlink_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("backlinks.id", ondelete="CASCADE"))
    outcome: Mapped[str] = mapped_column(String(10))  # found, missing, page_gone, unknown
    reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    trigger_kind: Mapped[str] = mapped_column(String(8), server_default="weekly")  # monthly, button. Every insert sets it; rows from before the change to monthly say weekly
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    final_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_nofollow: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    rel: Mapped[str | None] = mapped_column(String(120), nullable=True)
    anchor: Mapped[str | None] = mapped_column(Text, nullable=True)
    href: Mapped[str | None] = mapped_column(Text, nullable=True)
    changes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    verdict: Mapped[str | None] = mapped_column(String(8), nullable=True)
    reasons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    outbound_links: Mapped[int | None] = mapped_column(Integer, nullable=True)


class GscLinkImport(Base):
    """One Search Console Links file uploaded for a site. The latest one dates "Google hasn't listed it yet"."""

    __tablename__ = "gsc_link_imports"
    __table_args__ = (Index("ix_gsc_link_imports_site", "site_id", "kind", "imported_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(12))  # latest, sites, pages
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rows: Mapped[int] = mapped_column(Integer, server_default="0")
    imported_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class GscLinkingSite(Base):
    """Search Console's Top linking sites: each upload replaces the site's list."""

    __tablename__ = "gsc_linking_sites"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    linking_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class GscLinkedPage(Base):
    """Search Console's Top linked pages: my pages other sites link to. Each is read monthly, so one that's gone shows in Reclaim."""

    __tablename__ = "gsc_linked_pages"
    __table_args__ = (UniqueConstraint("site_id", "target_hash", name="uq_gsc_linked_pages_target"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    target_url: Mapped[str] = mapped_column(Text)
    target_hash: Mapped[str] = mapped_column(String(64))
    incoming_links: Mapped[int | None] = mapped_column(Integer, nullable=True)
    linking_sites: Mapped[int | None] = mapped_column(Integer, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    final_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    checked_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    dismissed: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))


class BacklinkBudget(Base):
    """What a site may spend on links each month, in one currency, so spent and budget compare."""

    __tablename__ = "backlink_budgets"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8))
    total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)  # the overall budget, beside the monthly amount
    updated_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class AhrefsMonthly(Base):
    """A linking website's organic traffic, as Ahrefs estimates it. Read once a month, only while an Ahrefs key is connected."""

    __tablename__ = "ahrefs_monthly"

    domain: Mapped[str] = mapped_column(String(190), primary_key=True)
    month: Mapped[str] = mapped_column(String(7), primary_key=True)
    org_traffic: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    fetched_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class GscInspection(Base):
    """What Search Console's URL Inspection said about one of my pages that a backlink points to: indexed or not, and why."""

    __tablename__ = "gsc_inspections"
    __table_args__ = (UniqueConstraint("site_id", "url_hash", name="uq_gsc_inspections_url"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    url_hash: Mapped[str] = mapped_column(String(64))
    url: Mapped[str] = mapped_column(Text)
    verdict: Mapped[str | None] = mapped_column(String(12), nullable=True)  # Google's PASS, PARTIAL, FAIL or NEUTRAL
    coverage: Mapped[str | None] = mapped_column(String(200), nullable=True)  # Google's words, such as "Crawled - currently not indexed"
    indexing: Mapped[str | None] = mapped_column(String(40), nullable=True)
    robots: Mapped[str | None] = mapped_column(String(40), nullable=True)
    fetch_state: Mapped[str | None] = mapped_column(String(40), nullable=True)
    google_canonical: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_canonical: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_crawl: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    inspected_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


# ---- Keyword Refresh --------------------------------------------------------------------------------


class ToolOrder(Base):
    """The order Refresh goes down, per search engine. A tool with no row keeps its default place."""

    __tablename__ = "tool_order"

    engine: Mapped[str] = mapped_column(String(20), primary_key=True)
    tool: Mapped[str] = mapped_column(String(40), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class ToolSetting(Base):
    """Paid use is off until someone switches it on, tool by tool."""

    __tablename__ = "tool_settings"

    tool: Mapped[str] = mapped_column(String(40), primary_key=True)
    paid_on: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class SerpSetting(Base):
    """Small editable numbers and words: the gap at which tools disagree, how long a check counts as just done, the Mac's country."""

    __tablename__ = "serp_settings"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(190))


class CreditLedger(Base):
    """Every credit a search tool was charged, or may have been. A refund is a negative row, so nothing is ever rewritten."""

    __tablename__ = "credit_ledger"
    __table_args__ = (Index("ix_credit_ledger_tool_time", "tool", "created_at"), Index("ix_credit_ledger_run", "run_id"))

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tool: Mapped[str] = mapped_column(String(40))
    amount: Mapped[int] = mapped_column(Integer)
    paid: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    cost: Mapped[Decimal | None] = mapped_column(Numeric(10, 5), nullable=True)
    run_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    keyword_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    engine: Mapped[str | None] = mapped_column(String(20), nullable=True)
    note: Mapped[str | None] = mapped_column(String(190), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class RankRun(Base):
    """One press of Confirm in the Refresh dialog."""

    __tablename__ = "rank_runs"
    __table_args__ = (Index("ix_rank_runs_status", "status", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # The dialog sends one token however often Confirm is pressed, so a double click makes one run.
    idem_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    status: Mapped[str] = mapped_column(String(10), server_default="queued")  # queued, running, done, stopped, cancelled
    engines: Mapped[list | None] = mapped_column(JSON, nullable=True)
    depth: Mapped[int] = mapped_column(Integer, server_default="10")
    mode: Mapped[str] = mapped_column(String(6), server_default="auto")  # auto, pick
    allow_paid: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    paid_cap: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    spent: Mapped[Decimal] = mapped_column(Numeric(10, 5), server_default="0")
    total: Mapped[int] = mapped_column(Integer, server_default="0")
    done: Mapped[int] = mapped_column(Integer, server_default="0")
    failed: Mapped[int] = mapped_column(Integer, server_default="0")
    not_run: Mapped[int] = mapped_column(Integer, server_default="0")
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    stop_reason: Mapped[str | None] = mapped_column(String(800), nullable=True)
    dropped: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # tool name -> why it stopped being used in this run
    excluded: Mapped[list | None] = mapped_column(JSON, nullable=True)  # keywords a colleague is already refreshing, with who
    cancel_requested: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    started_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class RankRunItem(Base):
    """One keyword on one engine, and in Choose tools mode one tool, within a run."""

    __tablename__ = "rank_run_items"
    __table_args__ = (Index("ix_rank_run_items_work", "run_id", "status", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("rank_runs.id", ondelete="CASCADE"))
    keyword_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("keywords.id", ondelete="CASCADE"))
    engine: Mapped[str] = mapped_column(String(20))
    tool: Mapped[str | None] = mapped_column(String(40), nullable=True)  # chosen by hand; empty means the first free tool in the order
    status: Mapped[str] = mapped_column(String(10), server_default="pending")  # pending, running, ok, failed, timeout, stopped, cancelled
    used_tool: Mapped[str | None] = mapped_column(String(40), nullable=True)
    check_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Same trick as Job.active_key: set while waiting or running, NULL afterwards, so one keyword and engine runs once however many people press.
    active_key: Mapped[str | None] = mapped_column(String(190), nullable=True, unique=True)


class SiteHistory(Base):
    """What the outside world remembers about a host: the Wayback Machine and the domain registry. Read monthly, never on page load."""

    __tablename__ = "site_history"

    host: Mapped[str] = mapped_column(String(190), primary_key=True)
    status: Mapped[str] = mapped_column(String(12), server_default="queued")  # queued, running, ok, failed
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    first_capture: Mapped[date | None] = mapped_column(Date, nullable=True)
    archived_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    capped: Mapped[bool] = mapped_column(Boolean, server_default=text("0"))
    pages_by_year: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {"2022": 10}: pages first archived that year
    registered_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    domain_problem: Mapped[str | None] = mapped_column(String(40), nullable=True)  # no_rdap, rdap_failed
    fetched_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


# ---- Search insights -----------------------------------------------------------------------------


class SearchFinding(Base):
    """Something the code found in Search Console data, kept between runs. See seo/insights/.

    finding_key is a digest of the site, the kind and what it's about, so the same finding is updated, never repeated.
    A task made from it carries the key in its source. AI text, when asked for, is kept in `ai` per language and provider.
    """

    __tablename__ = "search_findings"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'gone', 'dismissed', 'done')", name="ck_search_findings_status"),
        CheckConstraint("severity IN ('big', 'normal', 'info')", name="ck_search_findings_severity"),
        UniqueConstraint("finding_key", name="uq_search_findings_key"),
        Index("ix_search_findings_site", "site_id", "status", "at_stake"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30))
    grp: Mapped[str] = mapped_column(String(12))  # changed, decline, wins, leads, technical, impact
    finding_key: Mapped[str] = mapped_column(String(32))
    query: Mapped[str | None] = mapped_column(String(500), nullable=True)
    page: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(8), server_default="normal")
    at_stake: Mapped[float] = mapped_column(Float, server_default="0")  # clicks a month
    evidence: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(10), server_default="open")
    dismissed_stake: Mapped[float | None] = mapped_column(Float, nullable=True)  # "Not useful" comes back at twice this
    data_through: Mapped[date | None] = mapped_column(Date, nullable=True)
    ai: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    first_seen: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    last_seen: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    gone_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)


class SearchFindingRun(Base):
    __tablename__ = "search_finding_runs"
    __table_args__ = (Index("ix_search_finding_runs_site", "site_id", "ran_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    data_through: Mapped[date | None] = mapped_column(Date, nullable=True)
    ran_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    counts: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)


class GscQueryCountry(Base):
    """Search Console's query report again, filtered to one of the site's target countries (see SiteSearchCountry)."""

    __tablename__ = "gsc_query_country"
    __table_args__ = (Index("ix_gsc_query_country_hash", "site_id", "country", "query_hash", "day"),)

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    country: Mapped[str] = mapped_column(String(3), primary_key=True)  # Google's alpha-3, lower case
    query_hash: Mapped[str] = mapped_column(String(32), primary_key=True)
    query: Mapped[str] = mapped_column(String(500))
    clicks: Mapped[int] = mapped_column(Integer, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, server_default="0")
    position: Mapped[float | None] = mapped_column(Float, nullable=True)


class SiteSearchCountry(Base):
    """The countries a site targets on Google. None set: its top one or two by clicks."""

    __tablename__ = "site_search_countries"

    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    country: Mapped[str] = mapped_column(String(3), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class NotificationRead(Base):
    """One person's "read" on a bell notification, so one person's Mark all read doesn't clear it for the others."""

    __tablename__ = "notification_reads"

    notification_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notifications.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class GscAiReport(Base):
    """An export of Search Console's generative AI performance report (AI Overviews and AI Mode), uploaded by hand: Google's
    API doesn't give it. Totals for one period; uploading the same site, search type and period again replaces it."""

    __tablename__ = "gsc_ai_reports"
    __table_args__ = (UniqueConstraint("site_id", "search_type", "period_start", "period_end", name="uq_gsc_ai_report_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    search_type: Mapped[str] = mapped_column(String(20), server_default="web")
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    file_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    data: Mapped[dict] = mapped_column(JSON)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class GoogleUpdate(Base):
    """Google's confirmed ranking updates, from its Search Status Dashboard. Not per site: one list for everyone."""
    __tablename__ = "google_updates"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # Google's own id for the incident
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))  # core, spam, reviews, helpful, link or other
    began: Mapped[date] = mapped_column(Date, index=True)
    ended: Mapped[date | None] = mapped_column(Date, nullable=True)  # empty while it's still rolling out
    url: Mapped[str] = mapped_column(String(300))
    read_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class TrafficBoost(Base):
    """Boost URL: traffic sent to one of my pages on purpose, from start to end (open while it runs), with what it cost.
    Shown as a band on the keyword charts (metrics/keyword_timeline.py) and with its visits and positions before and after."""

    __tablename__ = "traffic_boosts"
    __table_args__ = (Index("ix_traffic_boosts_site_started", "site_id", "started"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    keywords: Mapped[list] = mapped_column(JSON)
    started: Mapped[date] = mapped_column(Date)
    ended: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    billed_text: Mapped[str | None] = mapped_column(String(60), nullable=True)
    billed: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cost_text: Mapped[str | None] = mapped_column(String(60), nullable=True)
    cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)


class BrandQuestion(Base):
    """A question asked of AI assistants about the owner's company (AI search → What AI says). The owner's own, or a
    suggestion the owner kept and may edit."""

    __tablename__ = "brand_questions"
    __table_args__ = (Index("ix_brand_questions_site", "site_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))  # before `text`, which hides sqlalchemy's text() below it
    source: Mapped[str] = mapped_column(String(10), server_default="owner")  # owner or suggested
    text: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    # A head-to-head question ("<brand> or <competitor>?") names the followed competitor it is about; NULL for the others.
    rival_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL", name="fk_brand_questions_rival"), nullable=True)


class BrandRun(Base):
    """One press of Ask the AIs: its questions and AIs as they were, the price shown first, and what it really cost."""

    __tablename__ = "brand_runs"
    __table_args__ = (Index("ix_brand_runs_site", "site_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), server_default="queued")  # queued, running, complete, partial, failed
    questions: Mapped[list] = mapped_column(JSON)
    engines: Mapped[list] = mapped_column(JSON)
    language: Mapped[str] = mapped_column(String(10), server_default="")
    country: Mapped[str] = mapped_column(String(2), server_default="")
    estimate: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    cost: Mapped[Decimal] = mapped_column(Numeric(10, 5), server_default="0")
    started_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    finished_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # "On your site?": each point the AIs made, checked against the site's own stored page texts (seo/ai_brand/onsite.py).
    onsite: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class BrandAnswer(Base):
    """One AI's answer to one question in a run, read signed out, with every source it cited and what AI read in it.
    `job_id` is the provider's snapshot or task id: once it's set the question was sent and is never sent again."""

    __tablename__ = "brand_answers"
    __table_args__ = (
        UniqueConstraint("run_id", "question_id", "engine", name="uq_brand_answer"),
        Index("ix_brand_answers_run", "run_id", "engine", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("brand_runs.id", ondelete="CASCADE"))
    question_id: Mapped[int | None] = mapped_column(ForeignKey("brand_questions.id", ondelete="SET NULL"), nullable=True)
    question: Mapped[str] = mapped_column(String(500))
    engine: Mapped[str] = mapped_column(String(20))  # chatgpt, perplexity, gemini, ai_mode, ai_overview
    status: Mapped[str] = mapped_column(String(10), server_default="pending")  # pending, sending, waiting, done, failed
    answer_text: Mapped[str | None] = mapped_column(MEDIUMTEXT, nullable=True)
    signed_out: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
    brand_named: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    pros: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    competitors: Mapped[list | None] = mapped_column(JSON, nullable=True)
    read_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    read_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    cost: Mapped[Decimal] = mapped_column(Numeric(10, 5), server_default="0")
    currency: Mapped[str] = mapped_column(String(3), server_default="USD")
    job_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(Stamp, nullable=True)
    created_at: Mapped[datetime] = mapped_column(Stamp, server_default=NOW3)
    # Head-to-head: the competitor the question was about, and who this answer recommends with what it says of each side.
    rival_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL", name="fk_brand_answers_rival"), nullable=True)
    versus: Mapped[dict | None] = mapped_column(JSON, nullable=True)
