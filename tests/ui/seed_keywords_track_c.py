"""Made-up data for trying Keywords' Track C by hand (chips, the row's trend, Volume, one line per page, link markers, Check AI
Overviews), on top of the demo world that tests/ui/app_server.py builds. Test databases only, .example sites only.

  DB_NAME_TEST=test_mzkeywordsui_test .venv/bin/python tests/ui/app_server.py --port 8303 &
  DB_NAME_TEST=test_mzkeywordsui_test .venv/bin/python tests/ui/seed_keywords_track_c.py

It adds: 20 more keywords (so the table has two pages), 90 days of Search Console positions for every tracked keyword of site-one (daily, by country and by page; two pages
for "coffee subscription" and "café en grains", Google switching between them), bought and found links to those pages, and a
file of volumes for some keywords (others stay without, so the empty state shows).
"""
from __future__ import annotations

import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.collectors.common import digest  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.imports import keyword_volumes  # noqa: E402

ME = "site-one.example"
# keyword -> (start position, end position, pages: [(path, share)])
LINES = {
    "coffee subscription": (14.0, 4.0, [("/subscription", 0.7), ("/abonnement", 0.3)]),
    "café en grains": (6.0, 9.0, [("/cafe-grains", 0.6), ("/blog/grains-guide", 0.4)]),
    "abonnement café": (22.0, 11.0, [("/abonnement", 1.0)]),
    "moulin à café": (9.0, 7.0, [("/moulins", 1.0)]),
    "how to brew coffee": (5.0, 3.0, [("/guide/brew", 1.0)]),
}
VOLUMES = "Keyword,Volume,Country,Month\ncoffee subscription,2400,FR,2026-10\ncafé en grains,880,FR,2026-10\nabonnement café,1 300,FR,2026-10\nmoulin à café,1K – 10K,FR,2026-10\n"


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "test databases only"
    with engine.begin() as conn:
        site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": ME}).scalar()
        assert site, "build the demo world first (tests/ui/app_server.py)"
        last = date.today() - timedelta(days=3)
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through) VALUES (:s, 'gsc', :d) ON DUPLICATE KEY UPDATE data_through = :d"), {"s": site, "d": last})
        for keyword, (a, b, pages) in LINES.items():
            for back in range(90):
                day = last - timedelta(days=back)
                share = 1 - back / 89  # 0 at the start, 1 at the end
                p = round(b + (a - b) * (1 - share) + math.sin(back / 3) * 0.8, 1)
                shows = 40 + (back * 7) % 23
                conn.execute(text("INSERT IGNORE INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 2, :i, :p)"),
                             {"s": site, "d": day, "h": digest(keyword), "q": keyword, "i": shows, "p": max(1.0, p)})
                conn.execute(text("INSERT IGNORE INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) VALUES (:s, :d, 'fra', :h, :q, 2, :i, :p)"),
                             {"s": site, "d": day, "h": digest(keyword), "q": keyword, "i": int(shows * .8), "p": max(1.0, p - .4)})
                for n, (path, weight) in enumerate(pages):
                    # The second page takes over in the last month: Google switching pages, which the panel's lines show.
                    w = weight if n == 0 else weight * (2.2 if back < 30 else .5)
                    page = f"https://{ME}{path}"
                    conn.execute(text("INSERT IGNORE INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :pg, 1, :i, :p)"),
                                 {"s": site, "d": day, "h": digest(keyword, page), "q": keyword, "pg": page, "i": max(1, int(shows * w)), "p": max(1.0, p + n * 5 - (6 if n and back < 30 else 0))})
        # Bought links (placed on a day) and found links (seen by a tool) to the pages that rank.
        for domain, path, placed, status in (("coffee-blog.example", "/subscription", 50, "live"), ("brew-news.example", "/subscription", 20, "live"), ("beans-review.example", "/cafe-grains", 35, "live")):
            conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, target_url, placed, status, anchor) VALUES (:s, :u, :d, :t, :p, :st, 'coffee')"),
                         {"s": site, "u": f"https://{domain}/post", "d": domain, "t": f"https://{ME}{path}", "p": str(last - timedelta(days=placed)), "st": status})
        for domain, path, seen in (("forum-cafe.example", "/subscription", 12), ("directory-food.example", "/cafe-grains", 60)):
            conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, target_url, status, anchor, found_by, created_at) VALUES (:s, :u, :d, :t, 'found', 'link', 'Search Console', :c)"),
                         {"s": site, "u": f"https://{domain}/thread", "d": domain, "t": f"https://{ME}{path}", "c": datetime.combine(last - timedelta(days=seen), datetime.min.time())})
        # More keywords than one page of the table holds, so the chips can be tried with the pager.
        from seo.serp import store

        for n in range(1, 21):
            word = f"coffee gift idea {n}"
            conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, 'FR', 'en')"), {"k": word, "h": store.keyword_hash(word)})
            kid = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = 'FR'"), {"h": store.keyword_hash(word)}).scalar()
            conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
    print(keyword_volumes.upload(engine, "keyword-planner-fr.csv", VOLUMES.encode(), "Demo"))
    print("seeded", ME)


if __name__ == "__main__":
    main()
