"""The two states flow_review2_fixes.cjs looks at, on the UI harness's made-up sites (after tests/ui/seed_ga4.py):
site-one's Google Analytics history half read again (12 days left in the new layout), and rival-one.example's sitemap
cut. seed_ga4.py reads every day in the new layout, so without this Settings has nothing to warn about.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_review2.py
"""
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.collectors import ga4  # noqa: E402
from seo.competitors.crawl import CUT_TEXT  # noqa: E402
from seo.core.db import make_engine  # noqa: E402

REREAD_DAYS = 12

engine = make_engine(test=True)
assert engine.url.database.endswith("_test")
with engine.begin() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = 'site-one.example'")).scalar_one()
    rival = conn.execute(text("SELECT id FROM sites WHERE host = 'rival-one.example'")).scalar_one()
    newest, oldest = ga4._window(engine)
    days = [row[0] for row in conn.execute(text(
        "SELECT day FROM coverage WHERE site_id = :s AND source = 'ga4' AND `rows` > 0 AND day BETWEEN :a AND :b ORDER BY day LIMIT :n"
    ), {"s": site, "a": oldest, "b": newest, "n": REREAD_DAYS})]
    assert len(days) == REREAD_DAYS, "run tests/ui/seed_ga4.py first"
    # The oldest days of the window, so the worker's daily read of the newest days doesn't read them again during the flow.
    for day in days:
        conn.execute(text("DELETE FROM coverage WHERE site_id = :s AND source = :l AND day = :d"), {"s": site, "l": ga4.LAYOUT, "d": day})
    changed = conn.execute(text("UPDATE competitor_crawls SET status = 'ok', message = :m, baseline_done = 1 WHERE competitor_id = :c"), {"m": CUT_TEXT, "c": rival}).rowcount
    assert changed == 1, "rival-one.example has no first read yet"
print("days left to read again:", ga4.days_to_reread(engine, site), "· rival-one sitemap cut")
