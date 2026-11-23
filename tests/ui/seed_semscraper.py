"""More made-up keywords for trying Check AI Overviews with Semscraper by hand: site-one gets keywords with no check yet until
156 of them have no AI Overview check, the number the owner's own site has. Test databases only, .example sites only.

  DB_NAME_TEST=test_mzsemui_test .venv/bin/python tests/ui/app_server.py --port 8330 --semscraper &
  DB_NAME_TEST=test_mzsemui_test .venv/bin/python tests/ui/seed_keywords_track_c.py
  DB_NAME_TEST=test_mzsemui_test .venv/bin/python tests/ui/seed_semscraper.py 156
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.serp import rankings, store  # noqa: E402

ME = "site-one.example"


def main(wanted: int) -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "test databases only"
    with engine.connect() as conn:
        site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": ME}).scalar()
    assert site, "build the demo world first (tests/ui/app_server.py)"
    rows = [r for r in rankings.listing(engine)["rows"] if r["site"] == ME]
    missing = wanted - sum(1 for r in rows if (r.get("ai") or {}).get("state") == "not-captured")
    with engine.begin() as conn:
        for n in range(1, max(0, missing) + 1):
            word = f"espresso tip {n}"
            conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, 'FR', 'en')"), {"k": word, "h": store.keyword_hash(word)})
            kid = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = 'FR' AND language = 'en'"), {"h": store.keyword_hash(word)}).scalar()
            conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
    print("added", max(0, missing), "keywords to", ME)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 156)
