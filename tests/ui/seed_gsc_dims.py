"""The two states flow_gsc_dims.cjs checks, on an empty UI harness (app_server.py --empty), with Search Console read
through the real collector from the fake Google (tests/ui/fake_google.py splits each day across countries and devices):

  before  site-one.example (site 1) read in full, then put back in the live state of 17 Nov 2026: the general read covers
          16 months, the country and device tables only their last 13 days.
  after   the backfill run batch by batch, as the hourly runs would, until countries and devices reach back 16 months.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_gsc_dims.py before|after
"""
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.collectors import common, gsc  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.insights import engine as insights  # noqa: E402
from tests.ui import fake_google  # noqa: E402

HOST = "site-one.example"
DIMS_DAYS = 13
stage = sys.argv[1] if len(sys.argv) > 1 else "before"
engine = make_engine(test=True)
assert engine.url.database.endswith("_test")
fake_google.install()


def pending():
    """The days countries and devices still lack, from Google's first day for the site (the backfill never reads before it)."""
    today = common.google_today(engine)
    with engine.connect() as conn:
        first = conn.execute(text("SELECT MIN(day) FROM gsc_daily WHERE site_id = :s"), {"s": site}).scalar()
    return common.pending_days(engine, site, gsc.DIMS_SOURCE, today, max(today - timedelta(days=gsc.HISTORY_DAYS), first or today), 0)


with engine.begin() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": HOST}).scalar()

if stage == "before":
    with engine.begin() as conn:
        if site is None:
            site = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'own')"), {"h": HOST, "u": f"https://{HOST}/"}).lastrowid
        if not conn.execute(text("SELECT id FROM google_connections LIMIT 1")).first():
            conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('Team robot', 'robot', 'x', 'abcd')"))
        cid = conn.execute(text("SELECT id FROM google_connections LIMIT 1")).scalar()
        conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property) VALUES (:s, 'gsc', :i, :p) "
                          "ON DUPLICATE KEY UPDATE connection_id = :i, property = :p, not_used = 0, last_error = NULL"), {"s": site, "i": cid, "p": f"sc-domain:{HOST}"})
    runs = 0
    while not gsc.collect(engine, site, budget_seconds=120) or pending():
        runs += 1
        assert runs < 40, "the fake Google read never finished"
    today = common.google_today(engine)
    cut = today - timedelta(days=DIMS_DAYS - 1)
    with engine.begin() as conn:
        for dim in ("country", "device"):
            conn.execute(text(f"DELETE FROM gsc_{dim} WHERE site_id = :s AND day < :c"), {"s": site, "c": cut})
        conn.execute(text("DELETE FROM coverage WHERE site_id = :s AND source = :src AND day < :c"), {"s": site, "src": gsc.DIMS_SOURCE, "c": cut})
    print(f"site {site} read; countries and devices kept from {cut} only; {len(pending())} days to backfill")
else:
    runs = 0
    while pending():
        gsc.collect(engine, site, budget_seconds=120)
        runs += 1
        assert runs < 40, "the backfill never finished"
    print(f"backfill done in {runs} runs")
# Insights runs after a read in the app; here it is run once by hand, so What changed says what it could compare.
print("insights needs:", insights.run(engine, site).get("needs"))
