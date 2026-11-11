"""Made-up Search Console days for shop-one.test that set off the Search insights, then one insights run. Test databases only.

  DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_insights.py [--catalogue]

Without --catalogue: what flow_insights.cjs needs (a site whose clicks fell, a page and a query losing, quick wins, no brand
words). With --catalogue: every kind flow_insights_catalogue.cjs and flow_insights_ai.cjs look for (brand words, GA4 leads,
a health issue, a data gap, a done task, a dated note). Re-running it starts shop-one.test again from nothing.
Most often started for you by tests/ui/insights_server.py.
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.collectors.common import digest  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.insights import engine as insights, rules  # noqa: E402
from tests.test_insights import BEFORE, END, FRESH, NOW, World  # noqa: E402

HOST = "shop-one.test"
HOME = f"https://{HOST}/"


def _site(engine) -> int:
    with engine.begin() as conn:
        old = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": HOST}).scalar()
        if old:
            conn.execute(text("DELETE FROM sites WHERE id = :s"), {"s": old})
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'own')"), {"h": HOST, "u": HOME}).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from) VALUES (:s, 'gsc', :d, :f)"), {"s": site_id, "d": END, "f": FRESH})
    return site_id


def _basics(w: World) -> None:
    """Clicks fell: one page and its query lost places, a slow slide, quick wins on page 2, a page near page 1."""
    w.spread(*BEFORE, "blue shoes", HOME + "blue/", 4, 100, 4)
    w.spread(*NOW, "blue shoes", HOME + "blue/", 2, 100, 9)
    w.spread(BEFORE[0] - timedelta(days=60), NOW[1], "red shoes", HOME + "red", 3, 120, 6)  # steady, for the curve
    first = END - timedelta(days=7 * rules.SLIDE_WEEKS - 1)
    day = first
    while day <= END:
        w.add(day, "sliding hats", HOME + "hats", 1, 10, 3 + ((day - first).days // 7) * 0.6)
        day += timedelta(days=1)
    w.spread(*NOW, "garden furniture", HOME, 0, 8, 20)
    w.spread(*NOW, "watering can", HOME + "kitchen/", 0, 8, 25)
    for n in range(10):
        w.spread(*NOW, f"garden tool {n}", HOME + "garden", 0, 2, 15)
    w.spread(BEFORE[0], NOW[1], "boot polish", HOME + "polish", 2, 40, 14)  # almost on page 1
    w.spread(BEFORE[0], NOW[1], "shoe laces", HOME + "laces", 6, 200, 6)  # close to the top 3


def _catalogue(engine, site_id: int, w: World) -> None:
    day, n = NOW[0], 0
    while day <= NOW[1]:
        w.add(day, "jumpy search", HOME + "jumpy", 0, 10, 2 if n % 2 else 12)
        day += timedelta(days=1)
        n += 1
    w.spread(*BEFORE, "shopone shoes", HOME + "brand", 2, 20, 1)
    w.spread(*NOW, "shopone shoes", HOME + "brand", 8, 30, 1)
    for q in ("how to clean shoes", "comment laver des chaussures", "why do shoes smell"):
        w.spread(*NOW, q, HOME + "care", 0, 2, 8)
    for n, extra in enumerate(("cheap", "best", "price", "online", "kids", "red")):
        w.spread(*NOW, f"umbrella {extra}", HOME + f"rain-{n}", 0, 3, 25)
        w.spread(BEFORE[0], NOW[1], f"sandals {extra}", HOME + "sandals", 3, 3, 3)
    for n in range(10):
        w.spread(*NOW, f"filler{n} thing{n}", HOME + f"f{n}", 0, 1, 30)
    w.spread(BEFORE[0], NOW[1], "rain boots", HOME + "boots", 2, 10, 8)
    w.spread(*BEFORE, "quote form", HOME + "quote/", 20, 200, 3)
    w.spread(*NOW, "quote form", HOME + "quote/", 4, 200, 3)
    w.spread(BEFORE[0], NOW[1], "free guide", HOME + "guide/", 5, 100, 3)
    w.spread(BEFORE[0], NOW[1], "shoes", "https://shop-one.test/shoes/", 2, 20, 5)
    w.spread(BEFORE[0], NOW[1], "shoes cheap", "https://www.shop-one.test/shoes", 1, 20, 7)
    w.spread(BEFORE[0], NOW[1], "broken hats", HOME + "broken/", 2, 20, 5)
    done = END - timedelta(days=40)
    w.spread(done - timedelta(days=28), done - timedelta(days=1), "ski jackets", HOME + "ski/", 2, 100, 8)
    w.spread(done, END, "ski jackets", HOME + "ski/", 5, 100, 4)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, 'brand', 'shopone')"), {"s": site_id})
        for path, sessions, leads in (("/quote/", 10, 1), ("/blue/", 10, 1), ("/guide/", 5, 0)):
            for back in range(60):
                conn.execute(
                    text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, :h, :p, :x, :x, :k)"),
                    {"s": site_id, "d": END - timedelta(days=back), "h": digest(path)[:32], "p": path, "x": sessions, "k": leads},
                )
        audit = conn.execute(text("INSERT INTO health_audits (site_id, status) VALUES (:s, 'complete')"), {"s": site_id}).lastrowid
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, 'noindex', 1, :p)"), {"a": audit, "p": json.dumps([HOME + "broken/"])})
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status) VALUES (:s, 'gsc', :d, 'partial')"), {"s": site_id, "d": END - timedelta(days=3)})
        for title, when, pages in (("Rewrote the ski page title", done, ["/ski/"]), ("Rewrote the blue page title", END - timedelta(days=10), ["/blue/"])):
            conn.execute(
                text("INSERT INTO tasks (title, status, site_id, pages, keywords, completed_at) VALUES (:t, 'done', :s, :p, '[]', :c)"),
                {"t": title, "s": site_id, "p": json.dumps(pages), "c": datetime.combine(when, datetime.min.time())},
            )
        conn.execute(text("INSERT INTO search_notes (site_id, day, text) VALUES (:s, :d, 'Moved to a faster host')"), {"s": site_id, "d": END - timedelta(days=45)})


def _mix(engine, site_id: int, w: World) -> None:
    """Rank and clicks: tracked keywords, rank checks and Search Console numbers in France, one for each signal."""
    from seo.serp import store
    from seo.serp.tools import Answer, Found

    w.spread(*NOW, "green socks", HOME + "socks", 1, 60, 5)
    w.spread(*NOW, "linen shirts", HOME + "shirts", 12, 90, 3)
    w.save()
    rival, other = "rival-one.test", "rival-two.test"
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) SELECT site_id, day, 'fra', query_hash, query, clicks, impressions, position FROM gsc_query WHERE site_id = :s"), {"s": site_id})
        for host in (rival, other):
            found = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'competitor')"), {"h": host, "u": f"https://{host}/"}).lastrowid
            conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source, tracking) VALUES (:s, :r, 'manual', 'on')"), {"s": site_id, "r": found})

    def keyword(words: str) -> int:
        with engine.begin() as conn:
            kid = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, 'fr', 'fr')"), {"k": words, "h": store.keyword_hash(words)}).lastrowid
            conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": kid})
        return kid

    def check(kid: int, results: list, ago: int = 1, depth: int = 30, ai: str = "not_captured", cited: tuple = ()) -> None:
        at = (datetime.now(UTC) - timedelta(days=ago)).strftime("%Y-%m-%d %H:%M:%S")
        store.save_check(engine, kid, "google", Answer("SerpApi", "FR", depth, [Found(p, u) for p, u in results], ai_state=ai, ai_citations=list(cited)), "refresh", at=at)

    a, b = f"https://{rival}/guide", f"https://{other}/page"
    kid = keyword("blue shoes")
    check(kid, [(1, b), (9, HOME + "blue/")], ago=12)
    check(kid, [(1, b), (2, a), (18, HOME + "blue/")])
    check(keyword("green socks"), [(16, HOME + "socks")])  # a drop seen once: to check
    kid = keyword("shoe laces")
    check(kid, [(5, HOME + "laces"), (8, a)], ago=12)
    check(kid, [(3, a), (6, HOME + "laces")])
    check(keyword("boot polish"), [(13, HOME + "polish")])
    check(keyword("red shoes"), [(6, HOME + "red")], ai="present")
    check(keyword("linen shirts"), [(3, HOME + "other-shirts")])  # people click another page
    check(keyword("garden furniture"), [(1, a), (2, b)], depth=10)
    check(keyword("forgotten phrase"), [(1, b)], depth=10)
    keyword("never checked yet")


def seed(engine, catalogue: bool = False, mix: bool = False) -> dict:
    assert engine.url.database.endswith("_test"), "test databases only"
    site_id = _site(engine)
    w = World(engine, site_id)
    _basics(w)
    if catalogue:
        _catalogue(engine, site_id, w)
    w.save()
    if mix:
        _mix(engine, site_id, w)
    return insights.run(engine, site_id)


def main() -> None:
    found = seed(make_engine(test=True), "--catalogue" in sys.argv[1:], "--mix" in sys.argv[1:])
    print({k: found[k] for k in ("site_id", "data_through", "added") if k in found})


if __name__ == "__main__":
    main()
