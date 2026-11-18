"""Google Analytics on the UI harness's made-up sites, read through the real collector from the fake Google
(tests/ui/fake_google.py): key events by name, and site-two's property also recording other-site.example. Used by
flow_ga4_numbers.cjs.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_ga4.py
"""
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.collectors import ga4  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from tests.ui import fake_google  # noqa: E402

engine = make_engine(test=True)
assert engine.url.database.endswith("_test")
fake_google.install()
with engine.begin() as conn:
    if not conn.execute(text("SELECT id FROM google_connections LIMIT 1")).first():
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('Team robot', 'robot', 'x', 'abcd')"))
    cid = conn.execute(text("SELECT id FROM google_connections LIMIT 1")).scalar()
    sites = {host: conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": host}).scalar() for host in ("site-one.example", "site-two.example")}
    for (host, site), prop in zip(sites.items(), ("111222333", "444555666")):
        conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property) VALUES (:s, 'ga4', :i, :p) ON DUPLICATE KEY UPDATE connection_id = :i, property = :p, not_used = 0, last_error = NULL"), {"s": site, "i": cid, "p": prop})
        # the made-up rows the harness wrote by hand make way for what the collector reads
        for table in ("ga4_source_daily", "ga4_page_daily", "ga4_referral_daily", "ga4_campaign_daily", "ga4_ads_daily"):
            conn.execute(text(f"DELETE FROM {table} WHERE site_id = :s"), {"s": site})
        conn.execute(text("DELETE FROM coverage WHERE site_id = :s AND source IN ('ga4', :l)"), {"s": site, "l": ga4.LAYOUT})
ga4.HISTORY_DAYS = 120  # four months is plenty for the screens
for host, site in sites.items():
    while not ga4.collect(engine, site, budget_seconds=60):
        pass
    print(host, "read", flush=True)
