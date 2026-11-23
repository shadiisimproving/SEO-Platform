"""Made-up rank checks for Insights "Who passed you" and "Explain with AI" (2026-11-17, parts 2 and 3), on top of
seed_what_changed.py's days. Test databases only.

shop-one.test's /guide/ was 3rd for "company setup guide" ten days ago and is 5th now. Above it now: rival-guide.test
(followed, On: 5 → 2, its guide rewritten for 2026, the Wayback Machine has its 2025 copy), other-rival.test (followed for
its pages only: 6 → 3, no earlier copy anywhere) and biz-portal.test (not followed). The insights run finds rival_passed and
queues the look; the app server's crawl worker reads the pages on tests/ui/who_passed_server.py's fake internet.
"""
from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.collectors.common import digest  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from tests.test_insights import END, NOW  # noqa: E402
from tests.ui import fake_google, seed_what_changed  # noqa: E402

HOST = "shop-one.test"
MY_URL = f"https://{HOST}/guide/"
OTHER_URL = "https://other-rival.test/guide/"
STRANGER_URL = "https://biz-portal.test/company-setup/"
KEYWORD = "company setup guide"


def _rivals(engine, site_id: int, w) -> None:
    from seo.serp import store
    from seo.serp.tools import Answer, Found

    w.spread(*NOW, KEYWORD, MY_URL, 6, 220, 4.0)
    with engine.begin() as conn:
        for back in range(28):  # the same search in France, where the checks are made
            conn.execute(
                text("INSERT INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) VALUES (:s, :d, 'fra', :h, :q, 6, 220, 4.0)"),
                {"s": site_id, "d": END - timedelta(days=back), "h": digest(KEYWORD), "q": KEYWORD},
            )
        for host, tracking in (("rival-guide.test", "on"), ("other-rival.test", "pages")):
            rid = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'competitor')"), {"h": host, "u": f"https://{host}/"}).lastrowid
            conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source, tracking) VALUES (:s, :r, 'manual', :t)"), {"s": site_id, "r": rid, "t": tracking})
        kid = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, 'fr', 'fr')"), {"k": KEYWORD, "h": store.keyword_hash(KEYWORD)}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": kid})
    for ago, results in ((10, [(3, MY_URL), (5, fake_google.RIVAL_URL), (6, OTHER_URL)]), (1, [(1, STRANGER_URL), (2, fake_google.RIVAL_URL), (3, OTHER_URL), (5, MY_URL)])):
        at = (datetime.now(UTC) - timedelta(days=ago)).strftime("%Y-%m-%d %H:%M:%S")
        store.save_check(engine, kid, "google", Answer("SerpApi", "FR", 10, [Found(p, u) for p, u in results]), "refresh", at=at)


def seed(engine) -> dict:
    return seed_what_changed.seed(engine, extra=_rivals)


if __name__ == "__main__":
    found = seed(make_engine(test=True))
    print({k: found[k] for k in ("site_id", "data_through", "added") if k in found})
