"""Made-up AI search data for the UI harness (tests/ui/app_server.py), on its made-up sites. Used by flow_ai_search.cjs.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_ai_search.py normal|ones|ga4fail|oldclarity|noserp|serpback

normal: AI visits for 70 days (chatgpt.com as Referral and as Unassigned, perplexity, gemini, claude, copilot) with engaged
sessions for the last 50 days (older days as if read before they were kept), landing pages, a /blog/ folder for page types,
two Clarity AI downloads, six Clarity live reads and Search Console queries for the questions. ones: the newest download cites
every page once. ga4fail: Google Analytics stopped working 2 h ago. oldclarity: the download ended 24 days ago and Clarity live
was read 55 h ago. noserp / serpback: hide site-one's keywords from the AI Overview watch, then give them back.
"""
import json
import sys
from datetime import date, timedelta

from sqlalchemy import text

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent))
from seo.collectors import common  # noqa: E402
from seo.core.db import make_engine  # noqa: E402

engine = make_engine(test=True)
assert engine.url.database.endswith("_test")
mode = sys.argv[1] if len(sys.argv) > 1 else "normal"

with engine.connect() as conn:
    today = conn.execute(text("SELECT UTC_DATE()")).scalar()
    me = conn.execute(text("SELECT id FROM sites WHERE host = 'site-one.example'")).scalar()
    two = conn.execute(text("SELECT id FROM sites WHERE host = 'site-two.example'")).scalar()
end = today - timedelta(days=1)


ENGAGED = {"google": 0.62, "chatgpt.com": 0.8, "perplexity.ai": 0.5, "gemini.google.com": 1.0, "copilot.microsoft.com": 0.4, "claude.ai": 0.75}


def ga4(conn, site, day, channel, source, medium, sessions, leads=0):
    """Engaged sessions: a share per source, and NULL on days older than 50, as if read before engaged sessions were kept."""
    engaged = None if (end - day).days > 50 else int(sessions * ENGAGED.get(source, 0.6) + 0.5)
    conn.execute(
        text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events, engaged_sessions) VALUES (:s, :d, :h, :c, :o, :m, :x, :x, :k, :e) "
             "ON DUPLICATE KEY UPDATE sessions = :x, key_events = :k, engaged_sessions = :e"),
        {"s": site, "d": day, "h": common.digest(channel, source, medium), "c": channel, "o": source, "m": medium, "x": sessions, "k": leads, "e": engaged},
    )


def referral(conn, site, day, domain, path, sessions, leads=0):
    conn.execute(text("INSERT INTO ga4_referral_daily (site_id, day, row_hash, domain, path, sessions, key_events) VALUES (:s, :d, :h, :o, :p, :x, :k) ON DUPLICATE KEY UPDATE sessions = :x, key_events = :k"),
                 {"s": site, "d": day, "h": common.digest(domain, path), "o": domain, "p": path, "x": sessions, "k": leads})


def download(conn, site, start, stop, data, uploaded):
    conn.execute(text("DELETE FROM clarity_reports WHERE site_id = :s AND kind = 'ai' AND period_start = :a AND period_end = :b"), {"s": site, "a": start, "b": stop})
    conn.execute(text("INSERT INTO clarity_reports (site_id, kind, period_start, period_end, data, uploaded_at) VALUES (:s, 'ai', :a, :b, :d, :u)"),
                 {"s": site, "a": start, "b": stop, "d": json.dumps(data), "u": uploaded})


with engine.begin() as conn:
    if mode in ("normal", "ones"):
        conn.execute(text("DELETE FROM ga4_referral_daily WHERE site_id IN (:a, :b)"), {"a": me, "b": two})
        conn.execute(text("DELETE FROM clarity_reports WHERE kind = 'ai'"))
        conn.execute(text("DELETE FROM clarity_daily"))
        conn.execute(text("DELETE FROM gsc_query_page"))
        if not conn.execute(text("SELECT id FROM google_connections LIMIT 1")).first():
            conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('Team robot', 'robot', 'x', 'abcd')"))
        cid = conn.execute(text("SELECT id FROM google_connections LIMIT 1")).scalar()
        for site in (me, two):
            for source, prop in (("gsc", "sc-domain:site.example"), ("ga4", "111222333")):
                conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through, last_ok_at, last_attempt_at) VALUES (:s, :c, :i, :p, :d, UTC_TIMESTAMP(3) - INTERVAL 5 HOUR, UTC_TIMESTAMP(3) - INTERVAL 5 HOUR) "
                                  "ON DUPLICATE KEY UPDATE connection_id = :i, property = :p, data_through = :d, last_error = NULL, last_ok_at = UTC_TIMESTAMP(3) - INTERVAL 5 HOUR, last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL 5 HOUR"),
                             {"s": site, "c": source, "i": cid, "p": prop, "d": end})
            conn.execute(text("INSERT INTO site_sources (site_id, source, secret, last4, last_ok_at, last_attempt_at) VALUES (:s, 'clarity', 'not-a-real-token', 'oken', TIMESTAMP(UTC_DATE()) + INTERVAL 10 MINUTE, TIMESTAMP(UTC_DATE()) + INTERVAL 10 MINUTE) "
                              "ON DUPLICATE KEY UPDATE secret = 'not-a-real-token', last_ok_at = TIMESTAMP(UTC_DATE()) + INTERVAL 10 MINUTE, last_attempt_at = TIMESTAMP(UTC_DATE()) + INTERVAL 10 MINUTE, last_error = NULL"), {"s": site})
        for back in range(0, 70):
            day = end - timedelta(days=back)
            w = (back * 7 % 5)
            ga4(conn, me, day, "Organic Search", "google", "organic", 150 + w * 3, 1 if back % 3 == 0 else 0)
            ga4(conn, me, day, "Referral", "chatgpt.com", "referral", 2 + (w % 3), 1 if back in (3, 17, 40) else 0)
            ga4(conn, me, day, "Unassigned", "chatgpt.com", "(not set)", 1 + (back % 2), 0)
            ga4(conn, me, day, "Referral", "perplexity.ai", "referral", 1 if back % 2 else 0)
            if back % 4 == 0:
                ga4(conn, me, day, "Referral", "gemini.google.com", "referral", 1)
            if back % 9 == 0:
                ga4(conn, me, day, "Referral", "copilot.microsoft.com", "referral", 1)
            if back % 5 == 0:
                ga4(conn, me, day, "Referral", "claude.ai", "referral", 1)
            ga4(conn, two, day, "Organic Search", "google", "organic", 70, 0)
            ga4(conn, two, day, "Referral", "chatgpt.com", "referral", 1)
            referral(conn, me, day, "chatgpt.com", "/subscription", 1 + (w % 3), 1 if back in (3, 17) else 0)
            referral(conn, me, day, "chatgpt.com", "/guide/brew", 1, 0)
            referral(conn, me, day, "perplexity.ai", "/moulins", 1 if back % 2 else 0)
            if back % 9 == 0:
                referral(conn, me, day, "copilot.microsoft.com", "/guide/brew", 1)
            if back % 6 == 0:
                referral(conn, me, day, "chatgpt.com", "/cafe-grains", 1)
            referral(conn, two, day, "chatgpt.com", "/guide", 1)
            if back % 3 == 0:
                referral(conn, me, day, "gemini.google.com", "/blog/espresso-at-home", 1)
            if back % 7 == 0:
                referral(conn, me, day, "perplexity.ai", "/blog/grind-size", 1)
            referral(conn, me, day, "claude.ai", "/", 1 if back % 5 == 0 else 0)
            for site in (me, two):  # read already, so a Refresh re-reads only the last few days instead of replacing them all
                conn.execute(text("INSERT INTO coverage (site_id, source, day, status, `rows`, saved_at) VALUES (:s, 'ga4', :d, 'ok', 5, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE saved_at = UTC_TIMESTAMP(3)"), {"s": site, "d": day})
        for back, n in ((1, 3), (2, 4), (3, 2), (4, 5), (5, 3), (6, 4)):  # Clarity's live reads
            conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions, referrers) VALUES (:s, :d, 300, :r)"),
                         {"s": me, "d": today - timedelta(days=back - 1), "r": json.dumps([{"source": "chatgpt.com", "sessions": n}, {"source": "www.google.com", "sessions": 120}, {"source": "perplexity.ai", "sessions": 1}])})
        pages_one = [{"url": f"https://site-one.example/{p}", "citations": 1} for p in ("abonnement", "cafe-grains", "moulins", "guide/brew", "subscription", "beans", "faq", "contact", "about")]
        pages = [{"url": "https://site-one.example/guide/brew", "citations": 12}, {"url": "https://site-one.example/subscription", "citations": 6}, {"url": "https://site-one.example/moulins", "citations": 2}] + pages_one[:6]
        if mode == "ones":
            pages = pages_one
        queries = [
            {"query": "best coffee subscription in france", "citations": 4, "share": 9.5},
            {"query": "how to brew coffee at home", "citations": 6, "share": 31.0},
            {"query": "coffee grinder for espresso", "citations": 2, "share": 14.0},
            {"query": "what is specialty coffee", "citations": 1, "share": 4.0},
            {"query": "moulin a cafe manuel", "citations": 1, "share": 22.0},
        ]
        download(conn, me, today - timedelta(days=70), today - timedelta(days=42), {"citations": 22, "share_of_authority": 17.2, "pages": pages[:4], "queries": queries[:3]}, f"{today - timedelta(days=40)} 09:00:00")
        download(conn, me, today - timedelta(days=36), today - timedelta(days=4), {"citations": 26 if mode == "normal" else 9, "share_of_authority": 14.1, "ai_referral_sessions": 31, "pages": pages, "queries": queries}, f"{today - timedelta(days=3)} 10:30:00")
        for q, page, clicks in (("coffee subscription", "https://site-one.example/subscription", 12), ("best coffee subscription", "https://site-one.example/subscription", 4), ("coffee grinder", "https://site-one.example/moulins", 3), ("espresso grinder", "https://site-one.example/moulins", 2), ("moulin a cafe", "https://site-one.example/moulins", 6)):
            for back in range(0, 20):
                conn.execute(text("INSERT IGNORE INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :p, :c, 60, 7)"),
                             {"s": me, "d": today - timedelta(days=6 + back), "h": common.digest(q, page), "q": q, "p": page, "c": clicks})
        for page, clicks in (("https://site-one.example/subscription/", 9), ("https://site-one.example/blog/espresso-at-home/", 4), ("https://site-one.example/", 30)):  # Google clicks beside AI visits
            for back in range(0, 40):
                conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, 200, 6) ON DUPLICATE KEY UPDATE clicks = :c"),
                             {"s": me, "d": end - timedelta(days=back), "h": common.digest(page), "p": page, "c": clicks})
    if mode == "ga4fail":
        conn.execute(text("UPDATE site_sources SET last_error = 'Google Analytics Data API has not been used in project 4242 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=4242 then retry.', "
                          "last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL 2 HOUR, data_through = :d WHERE source = 'ga4'"), {"d": end - timedelta(days=3)})
    if mode == "oldclarity":
        conn.execute(text("UPDATE clarity_reports SET period_end = :d, period_start = :a WHERE kind = 'ai' AND period_end >= :x"), {"d": today - timedelta(days=24), "a": today - timedelta(days=52), "x": today - timedelta(days=10)})
        conn.execute(text("UPDATE site_sources SET last_ok_at = UTC_TIMESTAMP(3) - INTERVAL 55 HOUR, last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL 55 HOUR WHERE source = 'clarity'"))
    spare = conn.execute(text("SELECT id FROM sites WHERE host = 'site-three.example'")).scalar()
    if mode == "noserp":  # parked on the site with no keywords, so nothing is lost
        conn.execute(text("UPDATE site_keywords SET site_id = :x WHERE site_id = :s"), {"x": spare, "s": me})
    if mode == "serpback":
        conn.execute(text("UPDATE site_keywords SET site_id = :s WHERE site_id = :x"), {"x": spare, "s": me})
print("seeded", mode, "site", me)
