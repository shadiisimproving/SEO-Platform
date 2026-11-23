"""Rows that say why they matter (2026-11-20): a competitor's change carries my competing page and its Google clicks.

Made-up sites only. Every expected number is worked out by hand in the test.
"""
from datetime import date, timedelta

from sqlalchemy import text

from seo.competitors import collective, pairs, pages as page_reader
from seo.crawl import store as crawl_store
from seo.metrics import weight
from tests.test_competitors_backend import add_rival, world  # noqa: F401  (world is a fixture)


def _clicks(world, page, per_day, days, end=None):
    end = end or date.today() - timedelta(days=1)
    with world.engine.begin() as conn:
        for n in range(days):
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions) VALUES (:s, :d, MD5(:p), :p, :c, 100)"),
                         {"s": world.own, "d": end - timedelta(days=n), "p": page, "c": per_day})


def _change(world, host, path, kind, minutes, words=None):
    with world.engine.begin() as conn:
        domain = crawl_store.get_or_create_domain(world.engine, host)
        url = f"https://{host}{path}"
        conn.execute(text("INSERT IGNORE INTO pages (domain_id, url, url_hash) VALUES (:d, :u, :h)"), {"d": domain, "u": url, "h": page_reader.url_hash(url)})
        page = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar()
        conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, changed_words, detected_at) VALUES (:p, :d, :k, 'a', 'b', :w, UTC_TIMESTAMP(3) - INTERVAL :m MINUTE)"),
                     {"p": page, "d": domain, "k": kind, "w": words, "m": minutes})


def test_page_clicks_are_the_last_28_days_and_the_28_before(world):
    _clicks(world, "https://me.example/offer", 3, 56)          # 28 × 3 = 84 now, 84 before
    _clicks(world, "https://www.me.example/offer/", 1, 28)     # the same page spelled another way: +28 now
    _clicks(world, "https://me.example/offer#prices", 9, 28)   # a jump link is not the page
    with world.engine.connect() as conn:
        seen = weight.page_clicks(conn, [world.own], collective._path_key)[world.own]
    assert seen["me.example/offer"] == {"clicks": 112, "before": 84}


def test_before_is_unknown_when_the_table_starts_later(world):
    _clicks(world, "https://me.example/offer", 2, 30)
    with world.engine.connect() as conn:
        seen = weight.page_clicks(conn, [world.own], collective._path_key)[world.own]
    assert seen["me.example/offer"] == {"clicks": 56, "before": None}


def test_a_change_names_my_competing_page_and_its_clicks(world):
    rival = add_rival(world, "rival.example")
    _clicks(world, "https://me.example/offer", 2, 56)
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, shared_keywords) VALUES (:s, :c, 'https://me.example/offer', MD5('a'), 'https://rival.example/plans', 4)"), {"s": world.own, "c": rival})
    _change(world, "rival.example", "/plans", "title", 10)
    _change(world, "rival.example", "/plans", "meta", 20)
    _change(world, "rival.example", "/plans", "content", 30, words=6)
    _change(world, "rival.example", "/plans", "content", 40, words=300)
    _change(world, "rival.example", "/blog/news", "title", 50)
    moves = collective.moves(world.engine, world.own)["moves"]
    by = {(m["url"].split("rival.example")[1], m["kind"], m.get("changed_words")): m for m in moves}
    title = by[("/plans", "title", None)]
    assert title["my_page"]["url"] == "https://me.example/offer" and title["my_page"]["clicks"] == 56 and title["my_page"]["clicks_before"] == 56
    assert title["minor"] is False
    assert by[("/plans", "meta", None)]["minor"] is True          # the description under the result
    assert by[("/plans", "content", 6)]["minor"] is True          # a few words
    assert by[("/plans", "content", 300)]["minor"] is False
    other = by[("/blog/news", "title", None)]
    assert other["my_page"] is None and other["minor"] is False   # no page of mine beside it
