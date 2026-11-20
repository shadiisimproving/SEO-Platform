"""Made-up articles, Search Console and Analytics days, and tasks with goals, for trying Content → Content tracker and the
Tasks month list on the demo world (site-one.example, a made-up coffee shop). Test databases only.

  DB_NAME_TEST=test_mzcontentui_test .venv/bin/python tests/ui/app_server.py --port 8304
  DB_NAME_TEST=test_mzcontentui_test .venv/bin/python tests/ui/seed_content_tracker.py
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.collectors.common import digest  # noqa: E402
from seo.core.db import make_engine  # noqa: E402

HOST = "site-one.example"
LAST = date.today() - timedelta(days=2)
# path, title, published (days back), main query, its position, daily impressions, daily clicks, daily visits, leads in all,
# and the page Google shows instead when it isn't this one.
ARTICLES = (
    ("/guide/french-press/", "French press: the 4-minute method", 28, "french press ratio", 6.8, 30, 2, 4, 1, None),
    ("/guide/grind-size/", "Grind size chart for every brewer", 63, "coffee grind size chart", 13.2, 45, 1, 3, 0, None),
    ("/blog/arabica-vs-robusta/", "Arabica vs robusta: what changes in the cup", 74, "arabica vs robusta", 1.4, 60, 6, 9, 2, None),
    ("/blog/coffee-storage/", "How to store coffee beans so they stay fresh", 85, "how to store coffee beans", 5.1, 25, 1, 2, 0, None),
    ("/blog/cold-brew-at-home/", "Cold brew at home in three steps", 116, "cold brew at home", 3.0, 40, 3, 5, 1, None),
    ("/blog/decaf-explained/", "Decaf explained: how the caffeine comes out", 119, "how is decaf made", 9.4, 15, 0, 1, 0, "/"),
)
NEW_PAGE = ("/blog/espresso-ratio/", "Espresso ratio: 1:2 and when to change it", 8)
GOALS = ("Strengthen site credibility", "Win 'french press' searches", "Rework the old blog posts")
TASKS = (  # title, goal, type, status, month offset (0 = this month), keywords, pages
    ("Add a customer reviews page", GOALS[0], "Content", "doing", -1, [], []),
    ("Put the roaster's story on the About page", GOALS[0], "Content", "todo", -1, [], ["/about"]),
    ("Link the grind chart from the French press guide", GOALS[1], "SEO", "todo", -1, ["french press ratio"], ["/guide/french-press/"]),
    ("Update the cold brew post for winter", GOALS[2], "Content", "done", -1, [], ["/blog/cold-brew-at-home/"]),
    ("Fix the 301 from /old-offer", "", "Technical", "blocked", 0, [], ["/old-offer"]),
    ("Answer 'french press ratio' in the first lines", GOALS[1], "Content", "todo", 0, ["french press ratio"], ["/guide/french-press/"]),
    ("Ask two roasters for a link to the storage guide", GOALS[0], "Links", "todo", 0, ["how to store coffee beans"], []),
    ("Decide which page targets 'how is decaf made'", GOALS[2], "SEO", "doing", 0, ["how is decaf made"], ["/blog/decaf-explained/", "/"]),
    ("Write the espresso ratio post", GOALS[1], "Content", "todo", 1, [], []),
)


def month_end(offset: int) -> date:
    first = date.today().replace(day=1)
    year, month = first.year, first.month + offset
    while month > 12:
        year, month = year + 1, month - 12
    while month < 1:
        year, month = year - 1, month + 12
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return nxt - timedelta(days=1)


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "test databases only"
    with engine.begin() as conn:
        site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": HOST}).scalar()
        domain = conn.execute(text("SELECT id FROM domains WHERE host = :h"), {"h": HOST}).scalar()
        connection = conn.execute(text("SELECT id FROM google_connections LIMIT 1")).scalar() or conn.execute(text(
            "INSERT INTO google_connections (label, kind, secret, last4) VALUES ('Made-up robot', 'robot', 'not-a-key', 'abcd')"
        )).lastrowid
        for source, prop in (("gsc", f"sc-domain:{HOST}"), ("ga4", "123456")):
            conn.execute(text(
                "INSERT INTO site_sources (site_id, source, connection_id, property, data_through, backfilled_to) VALUES (:s, :src, :c, :p, :d, :b) "
                "ON DUPLICATE KEY UPDATE connection_id = :c, property = :p, data_through = :d, backfilled_to = :b"
            ), {"s": site, "src": source, "c": connection, "p": prop, "d": LAST, "b": LAST - timedelta(days=500)})
        for path, title, back, query, position, shown, clicks, visits, leads, via in ARTICLES:
            url = f"https://{HOST}{path}"
            published = LAST - timedelta(days=back)
            extras = json.dumps({"published": f"{published.isoformat()}T09:00:00+00:00"})
            conn.execute(text(
                "INSERT INTO pages (domain_id, url, url_hash, title, content_hash, extras, last_checked_at) VALUES (:d, :u, SHA2(:u, 256), :t, SHA2(:u, 256), :e, UTC_TIMESTAMP()) "
                "ON DUPLICATE KEY UPDATE title = :t, extras = :e, content_hash = SHA2(:u, 256)"
            ), {"d": domain, "u": url, "t": title, "e": extras})
            lead_days = {back // 3 * (n + 1) for n in range(leads)}
            for day_back in range(0, min(back, 120)):
                day = LAST - timedelta(days=day_back)
                wobble = (day_back % 7) / 10
                shown_on = f"https://{HOST}{via}" if via else url
                conn.execute(text("INSERT IGNORE INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :p, :c, :i, :pos)"),
                             {"s": site, "d": day, "h": digest(query, shown_on), "q": query, "p": shown_on, "c": clicks if day_back % 2 else 0, "i": shown, "pos": position + wobble})
                if not via:  # a second, smaller search; the decaf post has none, Google shows the home page for its query
                    conn.execute(text("INSERT IGNORE INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :p, 0, :i, :pos)"),
                                 {"s": site, "d": day, "h": digest(f"{query} guide", url), "q": f"{query} guide", "p": url, "i": shown // 3, "pos": position + 6})
                conn.execute(text("INSERT IGNORE INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, :i, :pos)"),
                             {"s": site, "d": day, "h": digest(url), "p": url, "c": clicks if day_back % 2 else 1, "i": shown + shown // 3, "pos": position + 1.5 + wobble})
                conn.execute(text("INSERT IGNORE INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, :h, :p, :v, :v, :k)"),
                             {"s": site, "d": day, "h": digest(path), "p": path.rstrip("/"), "v": visits, "k": 1 if day_back in lead_days else 0})
            if via:  # its target query, typed by the owner: Google answers it with another page
                conn.execute(text(
                    "INSERT INTO content_items (site_id, path, path_hash, target_query) VALUES (:s, :p, SHA2(:p, 256), :q) ON DUPLICATE KEY UPDATE target_query = :q, removed_at = NULL"
                ), {"s": site, "p": path, "q": query})
        path, title, back = NEW_PAGE
        url = f"https://{HOST}{path}"
        conn.execute(text(
            "INSERT INTO pages (domain_id, url, url_hash, title, content_hash, first_archived, last_checked_at) VALUES (:d, :u, SHA2(:u, 256), :t, SHA2(:u, 256), :a, UTC_TIMESTAMP()) "
            "ON DUPLICATE KEY UPDATE title = :t, first_archived = :a"
        ), {"d": domain, "u": url, "t": title, "a": LAST - timedelta(days=back)})
        for title, goal, kind, status, offset, keywords, pages in TASKS:
            if conn.execute(text("SELECT 1 FROM tasks WHERE title = :t AND deleted_at IS NULL"), {"t": title}).first():
                continue
            conn.execute(text(
                "INSERT INTO tasks (title, goal, kind, status, priority, site_id, site_host, due_date, owner_label, keywords, pages, completed_at) "
                "VALUES (:t, :g, :k, :st, 'medium', :s, :h, :due, 'Demo admin', :kw, :pg, :done)"
            ), {"t": title, "g": goal or None, "k": kind, "st": status, "s": site, "h": HOST, "due": month_end(offset), "kw": json.dumps(keywords) if keywords else None,
                "pg": json.dumps(pages) if pages else None, "done": f"{month_end(offset)} 10:00:00" if status == "done" else None})
    print("seeded", HOST)


if __name__ == "__main__":
    main()
