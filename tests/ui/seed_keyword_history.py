"""Demo data for the keyword panel's history chart, on top of app_server.py's demo world. Made-up .example sites only.

  DB_NAME_TEST=test_kwhistory_ui_test .venv/bin/python tests/ui/seed_keyword_history.py

"how to brew coffee" on site-one.example gets eleven checks over nine weeks with three rivals moving, and its page
(/guide/brew) gets edits, backlinks (dates typed several ways, one with none) and boosts. Running it twice changes nothing.
"""
from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.serp import keyword_history, store  # noqa: E402
from seo.serp.tools import Answer, Found  # noqa: E402

KEYWORD, SITE, PAGE = "how to brew coffee", "site-one.example", "https://site-one.example/guide/brew"
US, R1, R2, CM = PAGE, "https://rival-one.example/guide/brew", "https://rival-two.example/brew", "https://cafe-monde.example/preparer"
YT, WIKI, BEANS, AMAZON = "https://youtube.com/brew", "https://wikipedia.org/wiki/Brewed_coffee", "https://beans-daily.example/brew", "https://amazon.fr/brew"
OLD = {62: [R1, YT, WIKI, BEANS, US], 56: [R1, YT, WIKI, BEANS, US], 49: [R1, YT, WIKI, US, BEANS]}  # the demo's own three checks, re-dated
NEW = {
    42: [R1, R2, YT, WIKI, US, BEANS, AMAZON, CM], 35: [R1, YT, R2, US, WIKI, BEANS, CM], 28: [R1, YT, US, WIKI, R2, CM, BEANS],
    21: [R1, YT, US, CM, WIKI, R2, BEANS], 14: [YT, R1, US, CM, WIKI, BEANS, R2], 9: [R1, US, YT, CM, WIKI, BEANS, AMAZON, R2],
    4: [R1, US, CM, YT, WIKI, BEANS], 0: [US, R1, CM, YT, WIKI, BEANS],
}


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "refusing a non-test database"
    now = datetime.now(UTC).replace(tzinfo=None)
    ago = lambda days: now - timedelta(days=days)  # noqa: E731
    day = lambda days: ago(days).date()  # noqa: E731
    with engine.begin() as conn:
        site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": SITE}).scalar_one()
        kid = conn.execute(text("SELECT k.id FROM keywords k JOIN site_keywords sk ON sk.keyword_id = k.id WHERE sk.site_id = :s AND k.keyword = :k"), {"s": site, "k": KEYWORD}).scalar_one()
        checks = [r[0] for r in conn.execute(text("SELECT c.id FROM serp_checks c JOIN serp_targets t ON t.id = c.target_id WHERE t.keyword_id = :k AND t.engine = 'google' ORDER BY c.id"), {"k": kid})]
        if len(checks) != 3:
            print("already seeded")
            return
        for check_id, (days, order) in zip(checks, OLD.items()):
            conn.execute(text("UPDATE serp_checks SET checked_at = :t WHERE id = :i"), {"t": ago(days), "i": check_id})
            conn.execute(text("UPDATE serp_results SET position = position + 100 WHERE check_id = :i"), {"i": check_id})
            for place, url in enumerate(order, start=1):
                conn.execute(text("UPDATE serp_results SET position = :p WHERE check_id = :i AND url = :u"), {"p": place, "i": check_id, "u": url})
        page_id, domain = conn.execute(text("SELECT id, domain_id FROM pages WHERE url = :u"), {"u": PAGE}).one()
        for days, kind, before, after, words in (
            (80, "title", "Brewing coffee", "How to brew coffee at home", None),
            (44, "title", "How to brew coffee at home", "How to brew coffee: 5 methods, step by step", None), (44, "content", "900 words", "1140 words", 240),
            (26, "meta", "Our guide to brewing.", "Pour-over, French press, espresso: brew better coffee in five steps.", None),
            (12, "h1", "Brew coffee", "How to brew coffee", None), (12, "content", "1140 words", "1180 words", 60),
        ):
            conn.execute(
                text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, changed_words, detected_at) VALUES (:p, :d, :k, :b, :a, :w, :t)"),
                {"p": page_id, "d": domain, "k": kind, "b": before, "a": after, "w": words, "t": ago(days)},
            )
        for source, placed, status, anchor in (
            ("https://coffee-blog.example/best-guides", day(38).isoformat(), "live", "how to brew coffee"),
            ("https://brew-mag.example/links", day(20).strftime("%d/%m/%Y"), "live", "brewing guide"),
            ("https://old-forum.example/thread/12", day(19).strftime("%-d %b %Y"), "lost", "this guide"),
            ("https://no-date.example/resources", "soon", "live", "coffee guide"),
        ):
            conn.execute(
                text("INSERT INTO backlinks (site_id, source_url, domain, status, target_url, placed, anchor) VALUES (:s, :u, :d, :st, :t, :p, :a)"),
                {"s": site, "u": source, "d": source.split("/")[2], "st": status, "t": "https://www.site-one.example/guide/brew/?utm_source=partner", "p": placed, "a": anchor},
            )
        conn.execute(text("INSERT INTO notes (scope, site_id, day, body) VALUES ('date', :s, :d, 'Google core update started')"), {"s": site, "d": day(31)})
    for days, order in NEW.items():
        answer = Answer("SerpApi", "FR", 10, [Found(place, url) for place, url in enumerate(order, start=1)])
        store.save_check(engine, kid, "google", answer, "refresh", at=ago(days).strftime("%Y-%m-%d %H:%M:%S"))
    keyword_history.add_boost(engine, {"site_id": site, "page": PAGE, "start": day(16).isoformat(), "end": day(10).isoformat(), "note": "Google Ads push"}, "Demo admin")
    keyword_history.add_boost(engine, {"site_id": site, "page": PAGE, "start": day(3).isoformat(), "note": "Newsletter"}, "Demo admin")
    print("seeded", KEYWORD, "keyword", kid, "site", site)


if __name__ == "__main__":
    main()
