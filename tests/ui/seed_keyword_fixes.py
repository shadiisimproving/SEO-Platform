"""Run after tests/ui/app_server.py has built the demo world: DB_NAME_TEST=<same>_test .venv/bin/python tests/ui/seed_keyword_fixes.py
Extra checks for tests/ui/flow_keyword_fixes.cjs on the demo world (made-up .example sites only).
one #2 -> out (coffee subscription), one out -> #7 (specialty coffee online), a 120-day-old Bright Data check with Bright Data
as main tool (best coffee beans), Search Console's most shown page differing from the ranking page (how to brew coffee)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from sqlalchemy import text
from seo.core.db import make_engine
from seo.serp import connections, store
from seo.serp.tools import Answer, Found
from seo.collectors.common import digest

engine = make_engine(test=True)
with engine.connect() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = 'site-one.example'")).scalar_one()
    kid = lambda k: conn.execute(text("SELECT k.id FROM keywords k JOIN site_keywords s ON s.keyword_id = k.id AND s.site_id = :s WHERE k.keyword = :k"), {"s": site, "k": k}).scalar_one()
    ids = {k: kid(k) for k in ("coffee subscription", "specialty coffee online", "best coffee beans", "how to brew coffee")}

def rows(mine_at, mine="https://site-one.example/x", depth=10):
    out = [Found(i + 1, f"https://filler{i}.example/p", "T") for i in range(depth)]
    if mine_at:
        out[mine_at - 1] = Found(mine_at, mine, "Mine")
    return out

def save(k, tool, pos, mine="https://site-one.example/x", at=None):
    return store.save_check(engine, ids[k], "google", Answer(tool, "FR", 10, rows(pos, mine), "not_captured", [], 1), "refresh", at=at)

connections.save_setting(engine, "main_tool", "Bright Data")
save("coffee subscription", "SerpApi", 2, "https://site-one.example/subscription", at="2026-11-01 08:00:00")
save("coffee subscription", "SerpApi", None)
save("specialty coffee online", "SerpApi", None, at="2026-11-01 08:00:00")
save("specialty coffee online", "SerpApi", 7, "https://site-one.example/shop")
old = save("best coffee beans", "Bright Data", 4, "https://site-one.example/cafe-grains")
with engine.begin() as conn:
    conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 120 DAY WHERE id = :i"), {"i": old})
save("best coffee beans", "SerpApi", 5, "https://site-one.example/cafe-grains")
save("how to brew coffee", "SerpApi", 2, "https://site-one.example/guide/brew")
with engine.begin() as conn:
    for back in range(3, 10):
        conn.execute(text("INSERT IGNORE INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, UTC_DATE() - INTERVAL :b DAY, :h, 'how to brew coffee', 'https://site-one.example/blog/brewing', 4, 120, 3.0)"),
                     {"s": site, "b": back, "h": digest("how to brew coffee", "https://site-one.example/blog/brewing")})
        conn.execute(text("INSERT IGNORE INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, UTC_DATE() - INTERVAL :b DAY, :h, 'how to brew coffee', 4, 120, 3.0)"),
                     {"s": site, "b": back, "h": digest("how to brew coffee")})
print("seeded", ids)
