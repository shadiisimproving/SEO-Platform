"""uptime mediators link checks

Revision ID: a1b1c1d1e1f1
Revises: f1a2b3c4d5e6
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "a1b1c1d1e1f1"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None

STAMP = mysql.DATETIME(fsp=3)
NOW = sa.text("CURRENT_TIMESTAMP(3)")
BACKLINK_COLUMNS = (
    ("checked_at", STAMP), ("check_outcome", sa.String(10)), ("check_reason", sa.String(20)), ("is_nofollow", sa.Boolean()), ("seen_rel", sa.String(120)),
    ("seen_anchor", sa.Text()), ("seen_href", sa.Text()), ("final_url", sa.Text()), ("target_final_url", sa.Text()), ("lost_at", STAMP),
)


def upgrade() -> None:
    op.create_table(
        "site_monitors",
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("watching", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("state", sa.String(10), nullable=True),
        sa.Column("reason", sa.String(30), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("state_since", STAMP, nullable=True),
        sa.Column("last_checked_at", STAMP, nullable=True),
        sa.Column("ssl_expires_at", STAMP, nullable=True),
        sa.Column("ssl_problem", sa.String(30), nullable=True),
        sa.Column("ssl_checked_at", STAMP, nullable=True),
        sa.Column("domain_expires_on", sa.Date(), nullable=True),
        sa.Column("domain_source", sa.String(10), nullable=True),
        sa.Column("domain_problem", sa.String(30), nullable=True),
        sa.Column("domain_checked_at", STAMP, nullable=True),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id"),
    )
    op.create_table(
        "uptime_incidents",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("started_at", STAMP, server_default=NOW, nullable=False),
        sa.Column("ended_at", STAMP, nullable=True),
        sa.Column("reason", sa.String(30), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_uptime_incidents_site", "uptime_incidents", ["site_id", "started_at"])
    op.create_table(
        "uptime_days",
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("up_checks", sa.Integer(), server_default="0", nullable=False),
        sa.Column("down_checks", sa.Integer(), server_default="0", nullable=False),
        sa.Column("unknown_checks", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id", "day"),
    )
    op.create_table(
        "mediators",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(190), nullable=False),
        sa.Column("name_key", sa.String(190), nullable=False),
        sa.Column("contact", sa.String(255), nullable=True),
        sa.Column("platform", sa.String(190), nullable=True),
        sa.Column("price_text", sa.String(80), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", STAMP, server_default=NOW, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name_key"),
    )
    op.create_table(
        "backlink_checks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("backlink_id", sa.BigInteger(), nullable=False),
        sa.Column("outcome", sa.String(10), nullable=False),
        sa.Column("reason", sa.String(20), nullable=True),
        sa.Column("trigger_kind", sa.String(8), server_default="weekly", nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("final_url", sa.Text(), nullable=True),
        sa.Column("is_nofollow", sa.Boolean(), nullable=True),
        sa.Column("rel", sa.String(120), nullable=True),
        sa.Column("anchor", sa.Text(), nullable=True),
        sa.Column("href", sa.Text(), nullable=True),
        sa.Column("changes", sa.JSON(), nullable=True),
        sa.Column("checked_at", STAMP, server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["backlink_id"], ["backlinks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_backlink_checks_link", "backlink_checks", ["backlink_id", "checked_at"])
    for name, kind in BACKLINK_COLUMNS:
        op.add_column("backlinks", sa.Column(name, kind, nullable=True))
    op.add_column("backlinks", sa.Column("miss_count", sa.Integer(), server_default="0", nullable=False))
    # Names already typed on links become mediators, so the tab isn't empty after this runs.
    bind = op.get_bind()
    seen = set()
    for name, contact, platform in bind.execute(sa.text("SELECT mediator, contact, platform FROM backlinks WHERE mediator IS NOT NULL AND mediator <> '' ORDER BY id")).all():
        key = " ".join(name.casefold().split())[:190]
        if key and key not in seen:
            seen.add(key)
            bind.execute(
                sa.text("INSERT INTO mediators (name, name_key, contact, platform) VALUES (:n, :k, :c, :p)"),
                {"n": name.strip()[:190], "k": key, "c": contact, "p": platform},
            )


def downgrade() -> None:
    op.drop_column("backlinks", "miss_count")
    for name, _ in reversed(BACKLINK_COLUMNS):
        op.drop_column("backlinks", name)
    op.drop_table("backlink_checks")
    op.drop_table("mediators")
    op.drop_table("uptime_days")
    op.drop_table("uptime_incidents")
    op.drop_table("site_monitors")
