"""Made-up Search Console days for Insights → What changed (the 2026-11-17 rework), then one insights run. Test databases only.

  DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_what_changed.py

shop-one.test gets: a page that fell 6.5 → 7.9 (Ranking) with my own edit a few days before and Google's answer, a page whose
fall started on a known day with a search another page took, a page clicked less at the same place with an AI Overview on
its tracked search, a page Google doesn't index, a search out of the top 3, fewer clicks at the same position, three alike
searches on one page, a drop small enough to be chance, and a gain. Most often started by tests/ui/what_changed_server.py.
"""
from __future__ import annotations

import hashlib
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.insights import engine as insights  # noqa: E402
from tests.test_insights import BEFORE, END, NOW, World  # noqa: E402
from tests.ui.seed_insights import _site  # noqa: E402

HOST = "shop-one.test"
HOME = f"https://{HOST}/"
FELL = NOW[0] + timedelta(days=9)


def _total(w: World, first, last, query, page, clicks: int, shown: int, position: float) -> None:
    days = (last - first).days + 1
    for n in range(days):
        w.add(first + timedelta(days=n), query, page, clicks * (n + 1) // days - clicks * n // days, shown, position)


def _sha(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def seed(engine) -> dict:
    assert engine.url.database.endswith("_test"), "test databases only"
    from seo.serp import store
    from seo.serp.tools import Answer, Found

    site_id = _site(engine)
    w = World(engine, site_id)
    drugs = HOME + "banned-drugs/"
    _total(w, *BEFORE, "banned drugs dubai", drugs, 40, 34, 6.5)
    _total(w, *NOW, "banned drugs dubai", drugs, 32, 34, 7.9)
    _total(w, *BEFORE, "medicines not allowed in uae", drugs, 18, 16, 6.5)
    _total(w, *NOW, "medicines not allowed in uae", drugs, 14, 16, 7.9)
    boots = HOME + "boots/"
    w.spread(BEFORE[0], FELL - timedelta(days=1), "winter boots", boots, 5, 70, 3)
    w.spread(FELL, NOW[1], "winter boots", boots, 1, 70, 8)
    w.spread(*BEFORE, "rain boots", boots, 2, 30, 4)
    w.spread(*NOW, "rain boots", HOME + "rain-boots/", 2, 30, 4)  # another page took it
    hats = HOME + "hats/"
    w.spread(*BEFORE, "hats sale", hats, 8, 100, 2)
    w.spread(*NOW, "hats sale", hats, 3, 100, 2.2)
    visa = HOME + "visa/"
    w.spread(*BEFORE, "visa dubai", visa, 4, 60, 4)
    w.spread(*NOW, "visa dubai", visa, 2, 60, 5)
    w.spread(*BEFORE, "visa price", HOME + "pricing/", 10, 100, 2.6)
    w.spread(*NOW, "visa price", HOME + "pricing/", 7, 100, 4.4)
    w.spread(*BEFORE, "what is a free zone", HOME + "free-zone/", 3, 100, 2)
    w.spread(*NOW, "what is a free zone", HOME + "free-zone/", 1, 110, 2.3)
    for q in ("company setup dubai", "dubai company setup", "company setups dubai 2026"):
        w.spread(*BEFORE, q, HOME + "setup/", 2, 60, 3)
        w.spread(*NOW, q, HOME + "setup/", 1, 60, 8)
    _total(w, *BEFORE, "scarves", HOME + "scarves/", 30, 20, 5)
    _total(w, *NOW, "scarves", HOME + "scarves/", 18, 20, 5)  # could be chance
    w.spread(*BEFORE, "gloves", HOME + "gloves/", 1, 40, 6)
    w.spread(*NOW, "gloves", HOME + "gloves/", 3, 60, 4)  # a gain
    w.spread(BEFORE[0] - timedelta(days=60), NOW[1], "red shoes", HOME + "red", 3, 120, 6)  # steady
    for page, query in (("pricing/", "dubai prices"), ("free-zone/", "free zones uae"), ("setup/", "start a business uae")):
        w.spread(BEFORE[0], NOW[1], query, HOME + page, 12, 200, 2)  # each search's page holds steady overall: the search is said alone
    w.save()
    with engine.begin() as conn:
        domain = conn.execute(text("INSERT INTO domains (host) VALUES (:h) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"), {"h": HOST}).lastrowid
        pid = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, last_checked_at) VALUES (:d, :u, :h, UTC_TIMESTAMP())"), {"d": domain, "u": drugs, "h": _sha(drugs)}).lastrowid
        edited = datetime.combine(NOW[0] - timedelta(days=4), datetime.min.time()) + timedelta(hours=11)
        for kind, before, after, words in (("title", "Banned drugs in Dubai: the full list", "Banned medicines in the UAE (2026)", None), ("headings", '["What is banned", "Penalties"]', '["The list", "Penalties", "Travel tips"]', None), ("content", "1450 words", "1120 words", 330)):
            conn.execute(
                text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at, changed_words) VALUES (:p, :d, :k, :b, :a, :t, :w)"),
                {"p": pid, "d": domain, "k": kind, "b": before, "a": after, "t": edited, "w": words},
            )
        for url, verdict, coverage, canonical in ((drugs, "PASS", "Submitted and indexed", None), (visa, "NEUTRAL", "Crawled - currently not indexed", HOME + "visa-guide/"), (boots, "PASS", "Submitted and indexed", None)):
            conn.execute(
                text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage, google_canonical, last_crawl, inspected_at) VALUES (:s, :h, :u, :v, :c, :g, :l, UTC_TIMESTAMP())"),
                {"s": site_id, "h": _sha(url), "u": url, "v": verdict, "c": coverage, "g": canonical, "l": datetime.combine(END - timedelta(days=6), datetime.min.time())},
            )
        conn.execute(text("UPDATE site_sources SET property = 'sc-domain:shop-one.test' WHERE site_id = :s AND source = 'gsc'"), {"s": site_id})
        kid = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES ('hats sale', :h, '', '')"), {"h": store.keyword_hash("hats sale")}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": kid})
    at = (datetime.now(UTC) - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")
    store.save_check(engine, kid, "google", Answer("SerpApi", "", 30, [Found(2, hats)], ai_state="present", ai_citations=[]), "refresh", at=at)
    return insights.run(engine, site_id)


if __name__ == "__main__":
    found = seed(make_engine(test=True))
    print({k: found[k] for k in ("site_id", "data_through", "added") if k in found})
