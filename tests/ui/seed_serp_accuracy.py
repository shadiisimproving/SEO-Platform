"""A suspect rank check on the demo world, for tests/ui/flow_serp_accuracy.cjs without a copy of real data. Run after
tests/ui/app_server.py has built the demo world:

  DB_NAME_TEST=<same>_test .venv/bin/python tests/ui/seed_serp_accuracy.py
  SEOCC_REAL_DEFAULT=1 node tests/ui/flow_serp_accuracy.cjs http://127.0.0.1:<port>/ site-one.example "moulin à café" <out dir>

"moulin à café": Bright Data and Semscraper see the demo's sites; a SerpApi check of the same hour sees ten others, so the
cross-tool rule marks it suspect. Test databases only, .example sites only.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.serp import store  # noqa: E402
from seo.serp.tools import NOT_CAPTURED, Answer, Found  # noqa: E402

WORD = "moulin à café"
SITES = ["rival-two.example/grinders", "amazon.fr/moulin", "site-one.example/moulins", "cafe-monde.example/moulins", "beans-daily.example/moulin",
         "rival-one.example/moulin", "wikipedia.org/wiki/Moulin", "youtube.com/moulin", "reddit.com/r/moulin", "forum-cafe.example/moulin"]


def answer(tool: str, sites: list[str]) -> Answer:
    return Answer(tool, "FR", 10, [Found(i + 1, f"https://{s}", s) for i, s in enumerate(sites)], NOT_CAPTURED, [], 1)


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "test databases only"
    with engine.connect() as conn:
        keyword_id = conn.execute(text("SELECT id FROM keywords WHERE keyword = :k"), {"k": WORD}).scalar_one()
    store.save_check(engine, keyword_id, "google", answer("Bright Data", SITES))
    store.save_check(engine, keyword_id, "google", answer("Semscraper", SITES))
    odd = store.save_check(engine, keyword_id, "google", answer("SerpApi", [f"other{i}.example/moulin" for i in range(10)]))
    with engine.connect() as conn:
        status = conn.execute(text("SELECT status, error FROM serp_checks WHERE id = :i"), {"i": odd}).one()
    print("seeded", WORD, "SerpApi check:", tuple(status))


if __name__ == "__main__":
    main()
