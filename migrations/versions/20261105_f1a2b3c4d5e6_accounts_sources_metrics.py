"""accounts, data sources and metrics

Revision ID: f1a2b3c4d5e6
Revises: e9f3b5d7a2c4
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "f1a2b3c4d5e6"
down_revision = "e9f3b5d7a2c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('authority_monthly',
    sa.Column('domain', sa.String(length=190), nullable=False),
    sa.Column('month', sa.String(length=7), nullable=False),
    sa.Column('score', sa.Float(), nullable=True),
    sa.PrimaryKeyConstraint('domain', 'month')
    )
    op.create_table('google_connections',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('secret', sa.Text(), nullable=False),
    sa.Column('last4', sa.String(length=8), nullable=False),
    sa.Column('robot_email', sa.String(length=255), nullable=True),
    sa.Column('last_ok_at', mysql.DATETIME(fsp=3), nullable=True),
    sa.Column('last_error', sa.String(length=500), nullable=True),
    sa.Column('created_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.CheckConstraint("kind IN ('robot', 'oauth')", name='ck_google_connections_kind'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('moz_metrics',
    sa.Column('target', sa.String(length=190), nullable=False),
    sa.Column('important', sa.Boolean(), server_default=sa.text('1'), nullable=False),
    sa.Column('domain_authority', sa.Integer(), nullable=True),
    sa.Column('linking_domains', sa.Integer(), nullable=True),
    sa.Column('external_links', sa.Integer(), nullable=True),
    sa.Column('fetched_at', mysql.DATETIME(fsp=3), nullable=True),
    sa.Column('created_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.PrimaryKeyConstraint('target')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('email', sa.String(length=190), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.String(length=10), server_default='member', nullable=False),
    sa.Column('must_change_password', sa.Boolean(), server_default=sa.text('1'), nullable=False),
    sa.Column('disabled', sa.Boolean(), server_default=sa.text('0'), nullable=False),
    sa.Column('failed_logins', sa.Integer(), server_default='0', nullable=False),
    sa.Column('locked_until', mysql.DATETIME(fsp=3), nullable=True),
    sa.Column('session_version', sa.Integer(), server_default='1', nullable=False),
    sa.Column('last_login_at', mysql.DATETIME(fsp=3), nullable=True),
    sa.Column('created_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.CheckConstraint("role IN ('admin', 'member')", name='ck_users_role'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('bing_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('impressions', sa.Integer(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day')
    )
    op.create_table('bing_query',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('query_hash', sa.String(length=32), nullable=False),
    sa.Column('query', sa.String(length=500), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('impressions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.Column('seen_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'query_hash')
    )
    op.create_table('clarity_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('sessions', sa.Integer(), nullable=True),
    sa.Column('scroll_depth', sa.Float(), nullable=True),
    sa.Column('rage_clicks', sa.Integer(), nullable=True),
    sa.Column('dead_clicks', sa.Integer(), nullable=True),
    sa.Column('referrers', sa.JSON(), nullable=True),
    sa.Column('raw', sa.JSON(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day')
    )
    op.create_table('coverage',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('status', sa.String(length=10), server_default='ok', nullable=False),
    sa.Column('hid_rows', sa.Boolean(), server_default=sa.text('0'), nullable=False),
    sa.Column('rows', sa.Integer(), server_default='0', nullable=False),
    sa.Column('note', sa.String(length=300), nullable=True),
    sa.Column('saved_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'source', 'day')
    )
    op.create_table('cwv_runs',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('url', sa.Text(), nullable=False),
    sa.Column('strategy', sa.String(length=8), nullable=False),
    sa.Column('performance', sa.Integer(), nullable=True),
    sa.Column('lcp_ms', sa.Integer(), nullable=True),
    sa.Column('inp_ms', sa.Integer(), nullable=True),
    sa.Column('cls', sa.Float(), nullable=True),
    sa.Column('field_data', sa.Boolean(), server_default=sa.text('0'), nullable=False),
    sa.Column('ran_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_cwv_site_time', 'cwv_runs', ['site_id', 'ran_at'], unique=False)
    op.create_table('ga4_ads_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('row_hash', sa.String(length=32), nullable=False),
    sa.Column('campaign', sa.String(length=190), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('cost', sa.Numeric(precision=14, scale=2), server_default='0', nullable=False),
    sa.Column('currency', sa.String(length=8), nullable=True),
    sa.Column('sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('key_events', sa.Float(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'row_hash')
    )
    op.create_index('ix_ga4_ads_day', 'ga4_ads_daily', ['site_id', 'day'], unique=False)
    op.create_table('ga4_campaign_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('row_hash', sa.String(length=32), nullable=False),
    sa.Column('source', sa.String(length=190), nullable=False),
    sa.Column('medium', sa.String(length=190), nullable=False),
    sa.Column('campaign', sa.String(length=190), nullable=False),
    sa.Column('path', sa.Text(), nullable=False),
    sa.Column('sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('key_events', sa.Float(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'row_hash')
    )
    op.create_index('ix_ga4_campaign_day', 'ga4_campaign_daily', ['site_id', 'day'], unique=False)
    op.create_table('ga4_page_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('page_hash', sa.String(length=32), nullable=False),
    sa.Column('path', sa.Text(), nullable=False),
    sa.Column('sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('users', sa.Integer(), server_default='0', nullable=False),
    sa.Column('key_events', sa.Float(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'page_hash')
    )
    op.create_index('ix_ga4_page_day', 'ga4_page_daily', ['site_id', 'day'], unique=False)
    op.create_table('ga4_referral_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('row_hash', sa.String(length=32), nullable=False),
    sa.Column('domain', sa.String(length=190), nullable=False),
    sa.Column('path', sa.Text(), nullable=False),
    sa.Column('sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('key_events', sa.Float(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'row_hash')
    )
    op.create_index('ix_ga4_referral_match', 'ga4_referral_daily', ['site_id', 'domain', 'day'], unique=False)
    op.create_table('ga4_source_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('row_hash', sa.String(length=32), nullable=False),
    sa.Column('channel', sa.String(length=80), nullable=False),
    sa.Column('source', sa.String(length=190), nullable=False),
    sa.Column('medium', sa.String(length=190), nullable=False),
    sa.Column('sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('users', sa.Integer(), server_default='0', nullable=False),
    sa.Column('key_events', sa.Float(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'row_hash')
    )
    op.create_index('ix_ga4_source_day', 'ga4_source_daily', ['site_id', 'day'], unique=False)
    op.create_table('gsc_daily',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('impressions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day')
    )
    op.create_table('gsc_page',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('page_hash', sa.String(length=32), nullable=False),
    sa.Column('page', sa.Text(), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('impressions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'page_hash')
    )
    op.create_index('ix_gsc_page_day', 'gsc_page', ['site_id', 'day'], unique=False)
    op.create_table('gsc_query',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('query_hash', sa.String(length=32), nullable=False),
    sa.Column('query', sa.String(length=500), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('impressions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'query_hash')
    )
    op.create_index('ix_gsc_query_day', 'gsc_query', ['site_id', 'day'], unique=False)
    op.create_table('gsc_query_page',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('pair_hash', sa.String(length=32), nullable=False),
    sa.Column('query', sa.String(length=500), nullable=False),
    sa.Column('page', sa.Text(), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('impressions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'day', 'pair_hash')
    )
    op.create_index('ix_gsc_query_page_day', 'gsc_query_page', ['site_id', 'day'], unique=False)
    op.create_table('resources',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('site_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('url', sa.Text(), nullable=True),
    sa.Column('kind', sa.String(length=40), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_by', sa.String(length=120), nullable=True),
    sa.Column('created_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.Column('deleted_at', mysql.DATETIME(fsp=3), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('site_rules',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('site_id', sa.Integer(), nullable=True),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('pattern', sa.String(length=255), nullable=False),
    sa.Column('value', sa.String(length=120), nullable=True),
    sa.Column('created_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_site_rules_kind', 'site_rules', ['kind', 'site_id'], unique=False)
    op.create_table('site_sources',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('connection_id', sa.Integer(), nullable=True),
    sa.Column('property', sa.String(length=255), nullable=True),
    sa.Column('secret', sa.Text(), nullable=True),
    sa.Column('last4', sa.String(length=8), nullable=True),
    sa.Column('not_used', sa.Boolean(), server_default=sa.text('0'), nullable=False),
    sa.Column('backfilled_to', sa.Date(), nullable=True),
    sa.Column('data_through', sa.Date(), nullable=True),
    sa.Column('last_attempt_at', mysql.DATETIME(fsp=3), nullable=True),
    sa.Column('last_ok_at', mysql.DATETIME(fsp=3), nullable=True),
    sa.Column('last_error', sa.String(length=500), nullable=True),
    sa.ForeignKeyConstraint(['connection_id'], ['google_connections.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('site_id', 'source', name='uq_site_source')
    )
    op.create_table('yandex_query',
    sa.Column('site_id', sa.Integer(), nullable=False),
    sa.Column('query_hash', sa.String(length=32), nullable=False),
    sa.Column('query', sa.String(length=500), nullable=False),
    sa.Column('shows', sa.Integer(), server_default='0', nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.Column('seen_at', mysql.DATETIME(fsp=3), server_default=sa.text('CURRENT_TIMESTAMP(3)'), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'query_hash')
    )


def downgrade() -> None:
    op.drop_table('yandex_query')
    op.drop_table('site_sources')
    op.drop_index('ix_site_rules_kind', table_name='site_rules')
    op.drop_table('site_rules')
    op.drop_table('resources')
    op.drop_index('ix_gsc_query_page_day', table_name='gsc_query_page')
    op.drop_table('gsc_query_page')
    op.drop_index('ix_gsc_query_day', table_name='gsc_query')
    op.drop_table('gsc_query')
    op.drop_index('ix_gsc_page_day', table_name='gsc_page')
    op.drop_table('gsc_page')
    op.drop_table('gsc_daily')
    op.drop_index('ix_ga4_source_day', table_name='ga4_source_daily')
    op.drop_table('ga4_source_daily')
    op.drop_index('ix_ga4_referral_match', table_name='ga4_referral_daily')
    op.drop_table('ga4_referral_daily')
    op.drop_index('ix_ga4_page_day', table_name='ga4_page_daily')
    op.drop_table('ga4_page_daily')
    op.drop_index('ix_ga4_campaign_day', table_name='ga4_campaign_daily')
    op.drop_table('ga4_campaign_daily')
    op.drop_index('ix_ga4_ads_day', table_name='ga4_ads_daily')
    op.drop_table('ga4_ads_daily')
    op.drop_index('ix_cwv_site_time', table_name='cwv_runs')
    op.drop_table('cwv_runs')
    op.drop_table('coverage')
    op.drop_table('clarity_daily')
    op.drop_table('bing_query')
    op.drop_table('bing_daily')
    op.drop_table('users')
    op.drop_table('moz_metrics')
    op.drop_table('google_connections')
    op.drop_table('authority_monthly')
