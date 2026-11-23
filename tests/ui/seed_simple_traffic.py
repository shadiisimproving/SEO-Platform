"""The made-up extras flow_simple_traffic.cjs reads on site-one.example, on the UI harness's demo world (after
app_server.py has built it):

- Google connected: Search Console and Google Analytics, GA4 read through the real collector from the fake Google;
- GA4's "(not set)" landing page, and social visits written many ways (m.facebook.com, facebook.com, meta, Linkedin,
  linkedin.com, lnkd.in), which Content groups by network;
- Clarity live: a token and its last 10 days;
- a Clarity dashboard download for 9 Aug – 6 Nov 2026 with a speed score of 73, read through the real import.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_simple_traffic.py
"""
import json
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.collectors import common, ga4  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.imports import clarity_reports  # noqa: E402
from tests.ui import fake_google  # noqa: E402

HOST = "site-one.example"
engine = make_engine(test=True)
assert engine.url.database.endswith("_test")
fake_google.install()

with engine.begin() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": HOST}).scalar()
    if not conn.execute(text("SELECT id FROM google_connections LIMIT 1")).first():
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('Team robot', 'robot', 'x', 'abcd')"))
    cid = conn.execute(text("SELECT id FROM google_connections LIMIT 1")).scalar()
    through = conn.execute(text("SELECT MAX(day) FROM gsc_daily WHERE site_id = :s"), {"s": site}).scalar()
    conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through, last_ok_at, last_attempt_at) VALUES (:s, 'gsc', :i, :p, :d, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)) "
                      "ON DUPLICATE KEY UPDATE connection_id = :i, property = :p, data_through = :d, last_error = NULL"), {"s": site, "i": cid, "p": f"sc-domain:{HOST}", "d": through})
    conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property) VALUES (:s, 'ga4', :i, '111222333') "
                      "ON DUPLICATE KEY UPDATE connection_id = :i, property = '111222333', not_used = 0, last_error = NULL"), {"s": site, "i": cid})
    for table in ("ga4_source_daily", "ga4_page_daily", "ga4_referral_daily", "ga4_campaign_daily", "ga4_ads_daily"):
        conn.execute(text(f"DELETE FROM {table} WHERE site_id = :s"), {"s": site})
    conn.execute(text("DELETE FROM coverage WHERE site_id = :s AND source IN ('ga4', :l)"), {"s": site, "l": ga4.LAYOUT})

ga4.HISTORY_DAYS = 120
while not ga4.collect(engine, site, budget_seconds=60):
    pass
print("GA4 read", flush=True)

SOCIAL = [("m.facebook.com", "referral", 6), ("facebook.com", "social", 4), ("meta", "paid", 3), ("Linkedin", "social", 2), ("linkedin.com", "referral", 3), ("lnkd.in", "referral", 1)]
with engine.begin() as conn:
    days = [d for (d,) in conn.execute(text("SELECT DISTINCT day FROM ga4_source_daily WHERE site_id = :s"), {"s": site})]
    for day in days:
        conn.execute(text("INSERT IGNORE INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users) VALUES (:s, :d, :h, '(not set)', 2, 2)"),
                     {"s": site, "d": day, "h": common.digest("(not set)")})
        for source, medium, sessions in SOCIAL:
            conn.execute(text("INSERT IGNORE INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users) VALUES (:s, :d, :h, 'Organic Social', :src, :m, :n, :n)"),
                         {"s": site, "d": day, "h": common.digest("extra", source, medium), "src": source, "m": medium, "n": sessions})
    today = common.google_today(engine)
    conn.execute(text("INSERT INTO site_sources (site_id, source, secret, last4, last_ok_at, last_attempt_at) VALUES (:s, 'clarity', 'not-a-real-token', 'oken', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)) "
                      "ON DUPLICATE KEY UPDATE secret = 'not-a-real-token', last_ok_at = UTC_TIMESTAMP(3), last_error = NULL"), {"s": site})
    for n in range(10):
        conn.execute(text("INSERT IGNORE INTO clarity_daily (site_id, day, sessions, scroll_depth, rage_clicks, dead_clicks, referrers) VALUES (:s, :d, :n, 55.5, 1, 3, :r)"),
                     {"s": site, "d": today - timedelta(days=n), "n": 30 + n, "r": json.dumps([{"source": "google.com", "sessions": 12}])})
print("extras on", len(days), "days", flush=True)

CSV = f'''﻿"Project name","Site One"
"Date range","08/09/2026 12:00 AM - 11/06/2026 11:59 PM"


"Metric","Sessions"
"","Total sessions","2400"
"","Bot sessions","900"

"Metric","Pages per session"
"","Average","1.4"

"Metric","Scroll depth"
"","Average","41.5"

"Metric","Active time spent"
"","Active time","120"
"","Total time","200"

"Metric","Top pages","No. of sessions"
"","https://{HOST}/","600"
"","https://{HOST}/subscription/","300"

"Metric","Referrer","No. of sessions"
"","www.google.com","400"

"Metric","Performance overview"
"","Score","73"
"","LCP (Largest Contentful Paint)","2.1s"
"","INP (Interaction to Next Paint)","180ms"
"","CLS (Cumulative Layout Shift)","0.05s"
'''
answer = clarity_reports.import_files(engine, [("Clarity_Site_One_Dashboard.csv", CSV.encode("utf-8"))], site_id=site)
print("Clarity download:", json.dumps(answer, default=str)[:300])
