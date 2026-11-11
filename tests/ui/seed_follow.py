"""Adds what flow_competitor_follow.cjs needs to a running demo world: a keyword my site tracks where the made-up
JavaScript-only rival ranks (so its weekly Firecrawl check has a page to check), and one small text edit on a demo
rival's timeline. Made-up sites only.

  DB_NAME_TEST=test_reading_test .venv/bin/python tests/ui/seed_follow.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.serp import store  # noqa: E402
from seo.serp.tools import NOT_CAPTURED, Answer, Found  # noqa: E402


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "refusing a non-test database"
    with engine.begin() as conn:
        own = conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id LIMIT 1")).scalar_one()
        conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES ('rival app pricing', :h, 'FR', 'fr')"), {"h": store.keyword_hash("rival app pricing")})
        keyword_id = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = 'FR' AND language = 'fr'"), {"h": store.keyword_hash("rival app pricing")}).scalar_one()
        conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": own, "k": keyword_id})
    store.save_check(engine, keyword_id, "google", Answer("SerpApi", "FR", 10, [Found(2, "https://spa-rival.example/pricing", "Rival app pricing")], NOT_CAPTURED, [], 1), "refresh")
    with engine.begin() as conn:
        page = conn.execute(
            text("SELECT p.id, p.domain_id, p.word_count FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host = 'rival-one.example' AND p.content_hash IS NOT NULL ORDER BY p.id LIMIT 1")
        ).mappings().first()
        conn.execute(
            text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, changed_words) VALUES (:p, :d, 'content', :b, :a, 2)"),
            {"p": page["id"], "d": page["domain_id"], "b": f"{page['word_count']} words", "a": f"{page['word_count']} words"},
        )
    print("seeded", flush=True)


if __name__ == "__main__":
    main()
