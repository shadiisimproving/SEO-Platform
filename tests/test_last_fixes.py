"""The last fixes before the deploy (2026-11-18): each with a known answer worked out by hand.

Made-up sites only (the product is for other accounts too).
"""
from seo.competitors import ai_watch
from seo.serp.tools import ABSENT, NOT_CAPTURED
from tests.test_competitors_backend import FakeTool, seed, track, world  # noqa: F401 - fixtures


class AiTool(FakeTool):
    gives_ai = True


# ---- 1: the AI Overview watch only says "Connect SerpApi" when no tool that sees AI Overviews is connected ------------


def test_watch_with_no_ai_tool_connected_asks_to_connect_one(world):
    world.tools["google"] = [FakeTool("Bright Data")]  # connected, but it can't see AI Overviews
    track(world.engine, world.own, "never checked")
    s = ai_watch.watch(world.engine, world.own)["summary"]
    assert s["ai_tools"] == [] and s["not_captured"] == 1


def test_watch_with_serpapi_connected_lists_the_keywords_it_has_not_checked(world):
    world.tools["google"] = [FakeTool("Bright Data"), AiTool("SerpApi")]
    seed(world.engine, world.own, "seen", ["me.example/a"], ai=ABSENT)  # SerpApi looked: no overview
    seed(world.engine, world.own, "bright only", ["me.example/a"], tool="Bright Data", ai=NOT_CAPTURED)
    never = track(world.engine, world.own, "never checked")
    answer = ai_watch.watch(world.engine, world.own)
    s = answer["summary"]
    ids = {r["keyword"]: r["keyword_id"] for r in answer["keywords"]}
    assert s["ai_tools"] == ["SerpApi"]
    assert s["not_captured"] == 2
    assert sorted(s["not_checked_ids"]) == sorted([ids["bright only"], never])


# ---- 2: a Today drop row names the rival change behind it -------------------------------------------------------------

from datetime import date, timedelta  # noqa: E402

from sqlalchemy import text  # noqa: E402

from seo.collectors import common  # noqa: E402
from seo.metrics import search, today  # noqa: E402
from seo.crawl import store as crawl_store  # noqa: E402
from seo.serp import store  # noqa: E402
from seo.serp.tools import Answer, Found  # noqa: E402

END = date(2026, 10, 20)  # this week: 14 Oct – 20 Oct; the week before: 7 Oct – 13 Oct


def _mine(engine):
    search._live_cache.clear()
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('T', 'robot', 'x', 'y')"))
        conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, 'gsc', 1, 'sc-domain:mine.example', :d)"), {"s": site_id, "d": END})
    return site_id


def _page_week(engine, site_id, name, was, now):
    page = f"https://mine.example/{name}/"
    with engine.begin() as conn:
        for day, clicks in ((END - timedelta(days=10), was), (END, now)):
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, 100, 5)"),
                         {"s": site_id, "d": day, "h": common.digest(page), "p": page, "c": clicks})
        for back in range(14):
            common.save_coverage(conn, site_id, "gsc", END - timedelta(days=back), 1)


def _rival(engine, site_id, host="rival.example"):
    with engine.begin() as conn:
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'competitor')"), {"h": host, "u": f"https://{host}/"}).lastrowid
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, tracking) VALUES (:s, :c, 'on')"), {"s": site_id, "c": rival})
    return rival


def _event(engine, url, when, hidden=False, kind="content"):
    domain = crawl_store.get_or_create_domain(engine, url.split("/")[2])
    with engine.begin() as conn:
        page = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar()
        if page is None:
            page = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash) VALUES (:d, :u, SHA2(:u, 256))"), {"d": domain, "u": url}).lastrowid
        return conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, detected_at, hidden, hidden_reason) VALUES (:p, :d, :k, :w, :h, :r)"),
                            {"p": page, "d": domain, "k": kind, "w": when, "h": int(hidden), "r": "template" if hidden else None}).lastrowid


def _pair(engine, site_id, rival, mine, theirs):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, shared_keywords) VALUES (:s, :c, :m, SHA2(:m, 256), :t, 4)"),
                            {"s": site_id, "c": rival, "m": mine, "t": theirs}).lastrowid


def test_a_page_drop_names_the_real_rival_change_two_days_before_it(engine):
    site = _mine(engine)
    rival = _rival(engine, site)
    _page_week(engine, site, "subscription", 100, 40)  # −60%: a to-do row, its drop week starts 14 Oct
    _page_week(engine, site, "quiet", 100, 40)  # paired too, but its rival changed nothing real in the window
    pair = _pair(engine, site, rival, "https://mine.example/subscription/", "https://rival.example/abonnement/")
    _pair(engine, site, rival, "https://mine.example/quiet/", "https://rival.example/calme/")
    real = _event(engine, "https://rival.example/abonnement/", "2026-10-12 09:00:00")  # 12 Oct: 2 days before 14 Oct
    _event(engine, "https://rival.example/abonnement/", "2026-10-13 09:00:00", hidden=True)  # noise, nearer: never named
    _event(engine, "https://rival.example/abonnement/", "2026-09-25 09:00:00")  # 19 days before: outside the 14
    _event(engine, "https://rival.example/calme/", "2026-10-13 09:00:00", hidden=True)  # only noise on the quiet page
    _event(engine, "https://rival.example/calme/", "2026-09-01 09:00:00")  # and an old real one
    todo = today.today(engine, site)["todo"]
    rows = {row["page"]: row for row in todo if row["kind"] == "page_drop"}
    sub = rows["https://mine.example/subscription/"]
    assert sub["rival"] == {"event_id": real, "host": "rival.example", "url": "https://rival.example/abonnement/", "path": "/abonnement/", "day": "2026-10-12",
                            "days_before": 2, "pair_id": pair, "competitor_id": rival, "site_id": site}
    assert sub["words"]["rival"] == ["Rival changed {path} {n} days before", {"path": "/abonnement/", "n": 2}]
    assert "rival" not in rows["https://mine.example/quiet/"] and "rival" not in rows["https://mine.example/quiet/"]["words"]


def test_a_rival_change_during_the_drop_week_says_during(engine):
    site = _mine(engine)
    rival = _rival(engine, site)
    _page_week(engine, site, "subscription", 100, 40)
    _pair(engine, site, rival, "https://mine.example/subscription/", "https://rival.example/abonnement/")
    _event(engine, "https://rival.example/abonnement/", "2026-10-16 09:00:00")  # inside 14 – 20 Oct
    _event(engine, "https://rival.example/abonnement/", "2026-10-25 09:00:00")  # after the drop's last day: not behind it
    row = next(r for r in today.today(engine, site)["todo"] if r["kind"] == "page_drop")
    assert row["rival"]["day"] == "2026-10-16" and row["rival"]["days_before"] == 0
    assert row["words"]["rival"] == ["Rival changed {path} during the drop", {"path": "/abonnement/"}]


def test_a_keyword_drop_names_the_rival_just_above_it(engine):
    site = _mine(engine)
    rival = _rival(engine, site)
    other = _rival(engine, site, "other.example")
    # "coffee subscription": avg pos 3 the week before, 8 this week (Search Console), so it is under Going down.
    with engine.begin() as conn:
        for day, pos in ((END - timedelta(days=10), 3.0), (END, 8.0)):
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'coffee subscription', 5, 100, :p)"),
                         {"s": site, "d": day, "h": common.digest("coffee subscription"), "p": pos})
        conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES ('coffee subscription', :h, 'FR', 'fr')"), {"h": store.keyword_hash("coffee subscription")})
        kw = conn.execute(text("SELECT id FROM keywords WHERE keyword = 'coffee subscription'")).scalar()
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kw})
    found = [Found(1, "https://other.example/top/", "t"), Found(2, "https://rival.example/abonnement/", "t"), Found(3, "https://mine.example/subscription/", "t")]
    store.save_check(engine, kw, "google", Answer("SerpApi", "FR", 10, found, "not_captured", [], 1), "refresh")
    _event(engine, "https://other.example/top/", "2026-10-13 09:00:00")  # above too, but not just above me
    real = _event(engine, "https://rival.example/abonnement/", "2026-10-11 09:00:00")  # 3 days before 14 Oct
    down = today.today(engine, site)["going_down"]
    move = next(m for m in down if m["type"] == "keyword")
    assert move["rival"]["event_id"] == real and move["rival"]["days_before"] == 3 and move["rival"]["competitor_id"] == rival and move["rival"]["pair_id"] is None
    assert move["words"]["rival"] == ["Rival changed {path} {n} days before", {"path": "/abonnement/", "n": 3}]
    assert other  # a second rival exists and is not named
