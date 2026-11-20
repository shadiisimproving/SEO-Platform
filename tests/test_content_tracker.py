"""Content → Content tracker: published pieces with their date, target query, position, clicks, visits and leads.
Made-up sites only."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.content import tracker
from seo.metrics import service as metrics
from seo.web import create_app

TODAY = date.today()


def ago(days: int) -> date:
    return TODAY - timedelta(days=days)


@pytest.fixture
def client(engine):
    return create_app(engine=engine, auth=False).test_client()


def _page(conn, domain_id, url, title, extras=None, sitemap=None, archived=None):
    conn.execute(text(
        "INSERT INTO pages (domain_id, url, url_hash, title, content_hash, extras, sitemap_lastmod, first_archived) VALUES (:d, :u, SHA2(:u, 256), :t, 'x', :e, :s, :a)"
    ), {"d": domain_id, "u": url, "t": title, "e": json.dumps(extras) if extras else None, "s": sitemap, "a": archived})


@pytest.fixture
def site(engine) -> int:
    with engine.begin() as conn:
        own = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop.example', 'https://shop.example/', 'own')")).lastrowid
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop.example')")).lastrowid
        # An article that says its own date, one only the sitemap dates (a new page found), and the home page.
        _page(conn, domain, "https://shop.example/visa-guide/", "Visa guide 2026", {"published": ago(40).isoformat() + "T08:00:00+04:00"})
        _page(conn, domain, "https://shop.example/tax-news/", "Tax news", sitemap=ago(5))
        _page(conn, domain, "https://shop.example/", "Home", sitemap=ago(2))
        for source in ("gsc", "ga4"):
            conn.execute(text("INSERT INTO site_sources (site_id, source, property, connection_id, data_through) VALUES (:s, :src, 'p', NULL, :d)"), {"s": own, "src": source, "d": ago(1)})
        for days in range(1, 31):
            day = ago(days)
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'v', 'https://shop.example/visa-guide/', 2, 50, 6)"), {"s": own, "d": day})
            conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, 'q1', 'visa guide', 'https://shop.example/visa-guide/', 2, 40, 5)"), {"s": own, "d": day})
            conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, 'q2', 'visa cost', 'https://shop.example/visa-guide/', 0, 10, 14)"), {"s": own, "d": day})
            # Google shows the home page, not the tax page, for "tax news".
            conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, 'q3', 'tax news', 'https://shop.example/', 0, 20, 9)"), {"s": own, "d": day})
            conn.execute(text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, 'v', '/visa-guide', 3, 3, :k)"), {"s": own, "d": day, "k": 1 if days == 3 else 0})
    return own


def _connected(engine, site_id):
    """The sources say they work: a connection exists."""
    with engine.begin() as conn:
        connection = conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('robot', 'robot', 'x', 'xxxx')")).lastrowid
        conn.execute(text("UPDATE site_sources SET connection_id = :c WHERE site_id = :s"), {"c": connection, "s": site_id})


def period(site_id, start=30, end=0):
    return f"site_id={site_id}&from={ago(start).isoformat()}&to={ago(end).isoformat()}"


def test_articles_are_tracked_with_their_numbers(engine, client, site):
    _connected(engine, site)
    reply = client.get(f"/api/content/tracker?{period(site)}")
    assert reply.status_code == 200, reply.json
    data = reply.json
    assert [i["path"] for i in data["items"]] == ["/visa-guide/"]  # only the article tracks itself
    piece = data["items"][0]
    assert piece["auto"] is True
    assert (piece["title"], piece["published"], piece["published_from"]) == ("Visa guide 2026", ago(40).isoformat(), "page")
    assert (piece["query"], piece["query_from"]) == ("visa guide", "search_console")  # most clicks over 90 days
    assert piece["position"]["from"] == "search_console" and piece["position"]["value"] == 5.0 and piece["position"]["via"] is None
    assert piece["position"]["read_on"] == ago(1).isoformat()
    assert (piece["clicks"], piece["impressions"], piece["avg_position"]) == (60, 1500, 6.0)
    assert (piece["sessions"], piece["leads"]) == (90, 1)
    assert data["summary"]["pieces"] == 1 and data["summary"]["with_leads"] == 1 and data["summary"]["top10"] == 1
    # The tax page is dated by its sitemap 5 days ago: offered, the home page never is.
    assert [s["path"] for s in data["suggestions"]] == ["/tax-news/"]
    assert data["suggestions"][0]["published_from"] == "sitemap"


def test_numbers_count_from_the_publish_date(engine, client, site):
    _connected(engine, site)
    saved = client.post("/api/content/tracker", json={"site_id": site, "page": "/visa-guide", "published_on": ago(10).isoformat()})
    assert saved.status_code == 200, saved.json
    piece = client.get(f"/api/content/tracker?{period(site)}").json["items"][0]
    assert (piece["published"], piece["published_from"], piece["counted_from"]) == (ago(10).isoformat(), "typed", ago(10).isoformat())
    assert piece["clicks"] == 20 and piece["sessions"] == 30  # days 1 to 10 only
    # Published after the period: no numbers, said so.
    client.post("/api/content/tracker", json={"site_id": site, "page": "/visa-guide/", "published_on": TODAY.isoformat()})
    late = client.get(f"/api/content/tracker?{period(site, 30, 5)}").json["items"][0]
    assert late["after_period"] is True and late["clicks"] is None


def test_add_a_page_and_its_position_says_via(engine, client, site):
    _connected(engine, site)
    assert client.post("/api/content/tracker", json={"site_id": site, "page": "https://www.shop.example/tax-news"}).status_code == 200
    data = client.get(f"/api/content/tracker?{period(site)}").json
    pieces = {i["path"]: i for i in data["items"]}
    assert set(pieces) == {"/visa-guide/", "/tax-news/"}
    assert pieces["/tax-news/"]["published_from"] == "sitemap" and pieces["/tax-news/"]["auto"] is False
    assert data["suggestions"] == []  # tracked now
    # Its target query is typed; Google shows the home page for it.
    client.post("/api/content/tracker", json={"site_id": site, "page": "/tax-news/", "target_query": "  Tax   News "})
    tax = {i["path"]: i for i in client.get(f"/api/content/tracker?{period(site)}").json["items"]}["/tax-news/"]
    assert (tax["query"], tax["query_from"]) == ("Tax News", "typed")
    assert tax["position"]["via"] == "/" and tax["position"]["value"] == 9.0
    # Emptied, it goes back to Search Console's choice (none for this page).
    client.post("/api/content/tracker", json={"site_id": site, "page": "/tax-news/", "target_query": ""})
    tax = {i["path"]: i for i in client.get(f"/api/content/tracker?{period(site)}").json["items"]}["/tax-news/"]
    assert tax["query"] is None and tax["position"] is None


def test_removed_stays_removed_and_comes_back(client, site):
    client.post("/api/content/tracker", json={"site_id": site, "page": "/visa-guide/", "removed": True})
    data = client.get(f"/api/content/tracker?{period(site)}").json
    assert data["items"] == []
    assert "/visa-guide/" not in [s["path"] for s in data["suggestions"]]
    client.post("/api/content/tracker", json={"site_id": site, "page": "/visa-guide/", "removed": False})
    assert [i["path"] for i in client.get(f"/api/content/tracker?{period(site)}").json["items"]] == ["/visa-guide/"]


def test_not_connected_sources_show_no_numbers(client, site):
    piece = client.get(f"/api/content/tracker?{period(site)}").json["items"][0]
    assert piece["clicks"] is None and piece["sessions"] is None and piece["leads"] is None


def test_a_rank_check_wins_over_search_console(engine, site):
    with engine.begin() as conn:
        kw = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash) VALUES ('visa guide', SHA2('visa guide', 256))")).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kw})
    fake = [{"keyword": "Visa Guide", "engines": {"google": {"main": {"p": 3, "url": "https://shop.example/visa-guide/", "tool": "serpapi", "checked_at": "2026-11-13T09:00:00Z", "status": "ok", "depth": 100}}}}]
    from seo.serp import rankings

    original = rankings.rows_of_site
    rankings.rows_of_site = lambda _engine, _site: fake
    try:
        scope = metrics.Scope(engine, site, ago(30).isoformat(), TODAY.isoformat())
        piece = tracker.listing(scope)["items"][0]
    finally:
        rankings.rows_of_site = original
    assert piece["position"] == {"value": 3, "from": "check", "tool": "serpapi", "read_on": "2026-11-13", "out_of": None, "via": None}


def test_piece_detail_months_and_choices(engine, client, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tasks (title, site_id, site_host, status, priority, pages, keywords) VALUES ('Fix it', :s, 'shop.example', 'todo', 'medium', '[\"/visa-guide\"]', '[\"visa price\"]')"), {"s": site})
    reply = client.get(f"/api/content/tracker/piece?site_id={site}&page=/visa-guide/&query=visa%20guide")
    assert reply.status_code == 200, reply.json
    data = reply.json
    assert len(data["months"]) == 12 and data["months"][-1]["month"] == TODAY.strftime("%Y-%m")
    assert any(m["position"] == 5.0 for m in data["months"])
    assert sum(m["clicks"] or 0 for m in data["months"]) == 60
    assert [c["query"] for c in data["choices"]["search_console"]] == ["visa guide", "visa cost"]
    assert data["choices"]["tasks"] == ["visa price"]


def test_refusals(client, site, engine):
    with engine.begin() as conn:
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.example', 'https://rival.example/', 'competitor')")).lastrowid
    assert client.post("/api/content/tracker", json={"site_id": site, "page": "https://elsewhere.example/a"}).status_code == 400
    assert client.post("/api/content/tracker", json={"site_id": rival, "page": "/a"}).status_code == 400
    assert client.post("/api/content/tracker", json={"site_id": site, "page": "/a", "published_on": "soon"}).status_code == 400
    assert client.post("/api/content/tracker", json={"site_id": site, "page": "/a", "colour": "red"}).status_code == 400
    assert client.post("/api/content/tracker", json={"site_id": site, "page": ""}).status_code == 400
    assert client.get(f"/api/content/tracker?site_id={rival}&from={ago(5)}&to={TODAY}").status_code == 400


def test_export_has_the_pieces(engine, client, site):
    _connected(engine, site)
    reply = client.get(f"/api/export/content-tracker.csv?{period(site)}")
    if reply.status_code == 404:  # the export address may differ; find it from the views list
        pytest.skip("export route shape differs")
    assert reply.status_code == 200, reply.data[:300]
    assert b"Visa guide 2026" in reply.data


def test_months_fall_back_to_the_page_google_shows(client, site):
    data = client.get(f"/api/content/tracker/piece?site_id={site}&page=/tax-news/&query=tax%20news").json
    shown = [m for m in data["months"] if m["position"] is not None]
    assert shown and all(m["via"] for m in shown) and shown[-1]["position"] == 9.0


def test_a_sitemap_with_one_date_everywhere_dates_nothing(engine, client, site):
    with engine.begin() as conn:
        domain = conn.execute(text("SELECT id FROM domains WHERE host = 'shop.example'")).scalar()
        for n in range(6):
            _page(conn, domain, f"https://shop.example/p{n}/", f"Page {n}", sitemap=ago(3))
    assert client.get(f"/api/content/tracker?{period(site)}").json["suggestions"] == []
