"""Made-up French, Arabic and emoji text for the demo world, to see it on the screens (2026-11-17): three keywords with
their Search Console searches on site-one.example, a rival page with an Arabic title, and a rival page that now redirects
("Moved to another address"). Test databases only.

  DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_all_scripts.py
"""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.collectors.common import digest  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.serp import store  # noqa: E402

TEXTS = (("Créer société à Dubaï", 120, 9), ("تأسيس شركة في دبي", 80, 4), ("🏆 test", 30, 1))


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "test databases only"
    with engine.begin() as conn:
        site = conn.execute(text("SELECT id FROM sites WHERE host = 'site-one.example'")).scalar()
        last = conn.execute(text("SELECT MAX(day) FROM gsc_query WHERE site_id = :s"), {"s": site}).scalar()
        for words, impressions, clicks in TEXTS:
            conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, 'FR', 'fr')"), {"k": words, "h": store.keyword_hash(words)})
            kid = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = 'FR'"), {"h": store.keyword_hash(words)}).scalar()
            conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
            for back in range(28):
                conn.execute(
                    text("INSERT IGNORE INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, :c, :i, 5.5)"),
                    {"s": site, "d": last - timedelta(days=back), "h": digest(words), "q": words, "c": clicks if back % 3 == 0 else 0, "i": impressions // 4},
                )
        rival = conn.execute(text("SELECT id FROM domains WHERE host = 'rival-one.example'")).scalar()
        page = conn.execute(text("SELECT id, url FROM pages WHERE domain_id = :d AND url LIKE '%/%/%' ORDER BY id LIMIT 1 OFFSET 1"), {"d": rival}).first()
        conn.execute(text("UPDATE pages SET title = :t, meta_description = :m WHERE id = :p"), {"t": "تأسيس شركة في دبي | 🏆 دليل كامل", "m": "Créer société à Dubaï : tout savoir", "p": page.id})
        conn.execute(
            text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value) VALUES (:p, :d, 'title', 'Guide', :a)"),
            {"p": page.id, "d": rival, "a": "تأسيس شركة في دبي | 🏆 دليل كامل"},
        )
        moved = conn.execute(text("SELECT id, url FROM pages WHERE domain_id = :d AND id <> :p ORDER BY id DESC LIMIT 1"), {"d": rival, "p": page.id}).first()
        target = moved.url.rstrip("/") + "-2026/"
        conn.execute(text("UPDATE pages SET final_url = :f, last_status = 'moved' WHERE id = :p"), {"f": target, "p": moved.id})
        conn.execute(
            text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value) VALUES (:p, :d, 'redirect', :b, :a)"),
            {"p": moved.id, "d": rival, "b": moved.url, "a": target},
        )
    print(f"seeded: 3 keywords on site {site}, Arabic title on {page.url}, {moved.url} moved to {target}")


if __name__ == "__main__":
    main()
