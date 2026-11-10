"""Made-up Search Console days for trying the bell: 60 days of one old query, then new ones on the last two days (two over
the floor of 10 impressions, one under), and the check run through the real code. Test databases only.

  DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_new_queries.py [site_id]
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.collectors.common import digest  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.notifications import new_queries  # noqa: E402

NEW = (  # day back from the last day, query, impressions, clicks, position, page
    (0, "how much does a trade licence cost", 23, 2, 5.4, "/prices/"),
    (0, "open a company in 48 hours", 4, 0, 14.8, "/guide/"),
    (1, "free zone vs mainland", 12, 1, 8.1, "/compare/"),  # over the bell's floor of 10 impressions; "open a company…" stays under
)


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "test databases only"
    with engine.begin() as conn:
        site_id = int(sys.argv[1]) if len(sys.argv) > 1 else conn.execute(text("SELECT MIN(id) FROM sites WHERE kind = 'own'")).scalar()
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": site_id}).scalar()
        last = conn.execute(text("SELECT MAX(day) FROM gsc_query WHERE site_id = :s"), {"s": site_id}).scalar() or date.today() - timedelta(days=3)
        day = last - timedelta(days=60)
        while day <= last:
            conn.execute(
                text("INSERT IGNORE INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'an old search', 2, 40, 6)"),
                {"s": site_id, "d": day, "h": digest("an old search")},
            )
            day += timedelta(days=1)
        for back, query, shown, clicks, position, page in NEW:
            values = {"s": site_id, "d": last - timedelta(days=back), "q": query, "c": clicks, "i": shown, "p": position}
            conn.execute(text("INSERT IGNORE INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, :c, :i, :p)"), {**values, "h": digest(query)})
            conn.execute(
                text("INSERT IGNORE INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :pg, :c, :i, :p)"),
                {**values, "h": digest(query, page), "pg": f"https://{host}{page}"},
            )
        conn.execute(
            text("INSERT INTO notification_marks (site_id, kind, through) VALUES (:s, :k, :t) ON DUPLICATE KEY UPDATE through = VALUES(through)"),
            {"s": site_id, "k": new_queries.KIND, "t": last - timedelta(days=2)},
        )
    print(new_queries.check(engine, site_id))


if __name__ == "__main__":
    main()
