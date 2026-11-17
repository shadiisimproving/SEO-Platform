"""The Pages screen: one row per page of my sites, and one page's whole story."""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.competitors.pages import url_hash
from seo.web import create_app


@pytest.fixture
def client(engine):
    return create_app(engine=engine, auth=False).test_client()


@pytest.fixture
def site(engine) -> int:
    today = date.today().isoformat()
    with engine.begin() as conn:
        own = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop.example', 'https://shop.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'a', 'https://shop.example/visa/', 40, 900, 4.5)"), {"s": own, "d": today})
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'b', 'https://shop.example/tax', 2, 100, 12)"), {"s": own, "d": today})
        conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, target_url, status) VALUES (:s, 'https://news.example/a', 'news.example', 'https://shop.example/visa', 'live')"), {"s": own})
        conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, target_url, status) VALUES (:s, 'https://old.example/a', 'old.example', 'https://shop.example/tax/', 'lost')"), {"s": own})
        conn.execute(text("INSERT INTO tasks (title, site_id, site_host, status, priority, pages) VALUES ('Rewrite visa', :s, 'shop.example', 'todo', 'medium', '[\"/visa/\"]')"), {"s": own})
        conn.execute(text("INSERT INTO tasks (title, site_id, site_host, status, priority, pages) VALUES ('Done one', :s, 'shop.example', 'done', 'medium', '[\"/visa/\"]')"), {"s": own})
        conn.execute(text("INSERT INTO tasks (title, status, priority, pages) VALUES ('Other site', 'todo', 'medium', '[\"https://elsewhere.example/visa/\"]')"))
        conn.execute(text("INSERT INTO notes (scope, site_id, page_url, body) VALUES ('page', :s, 'https://shop.example/visa/', 'Check the title')"), {"s": own})
        conn.execute(text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage) VALUES (:s, 'x', 'https://shop.example/tax/', 'NEUTRAL', 'Crawled - currently not indexed')"), {"s": own})
        audit = conn.execute(text("INSERT INTO health_audits (site_id, status) VALUES (:s, 'complete')"), {"s": own}).lastrowid
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, 'missing_meta', 1, '[\"https://shop.example/visa/\"]')"), {"a": audit})
        conn.execute(text("INSERT INTO cwv_runs (site_id, url, strategy, performance) VALUES (:s, 'https://shop.example/visa/', 'mobile', 41)"), {"s": own})
    return own


def period(site_id):
    today = date.today().isoformat()
    return f"site_id={site_id}&from={(date.today() - timedelta(days=30)).isoformat()}&to={today}"


def test_list_joins_every_source(client, site):
    reply = client.get(f"/api/site-pages?{period(site)}")
    assert reply.status_code == 200, reply.json
    data = reply.json
    rows = {row["path"]: row for row in data["pages"]}
    assert set(rows) == {"/visa/", "/tax"}  # each as Search Console has it: no slash invented, none taken away
    visa, tax = rows["/visa/"], rows["/tax"]
    assert tax["url"] == "https://shop.example/tax"
    assert (visa["clicks"], visa["tasks_open"], visa["notes"], visa["backlinks"]) == (40, 1, 1, 1)
    assert (tax["backlinks"], tax["indexed"], tax["tasks_open"]) == (0, False, 0)  # a lost link doesn't count
    assert data["pages"][0]["path"] == "/visa/"  # most clicks first
    assert data["summary"] == {"pages": 2, "with_clicks": 2, "not_indexed": 1, "open_tasks": 1, "losing": 0}
    assert data["compared"] is False and visa["change"] is None  # no period before asked: nothing compared


def test_profile_gathers_the_page(client, site):
    reply = client.get(f"/api/site-pages/profile?site_id={site}&url=/visa")
    assert reply.status_code == 200, reply.json
    data = reply.json
    assert (data["path"], data["url"]) == ("/visa/", "https://shop.example/visa/")
    assert data["google_28d"]["clicks"] == 40
    assert [b["domain"] for b in data["backlinks"]] == ["news.example"]
    assert data["technical"]["health"] == ["missing_meta"]
    assert data["technical"]["speed"]["mobile"]["score"] == 41
    assert data["read"] is None  # never read: the screen says so
    # The same page written as a full address.
    assert client.get(f"/api/site-pages/profile?site_id={site}&url=https://www.shop.example/visa/").json["path"] == "/visa/"


def test_profile_refuses_other_sites_and_empty(client, site):
    assert client.get(f"/api/site-pages/profile?site_id={site}&url=https://elsewhere.example/visa/").status_code == 400
    assert client.get(f"/api/site-pages/profile?site_id={site}&url=").status_code == 400


def test_addresses_are_spelled_as_google_and_the_site_give_them(client, engine, site):
    """A site that serves /abonnement must never be shown, linked, exported or given tasks as /abonnement/ (expert review
    2026-11-17, #19). Matching still folds the spellings together, so tasks and links find the page either way."""
    today = date.today().isoformat()
    with engine.begin() as conn:
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop.example')")).lastrowid
        for url, title in (("https://shop.example/contact", "Contact"), ("https://shop.example/tax", "Tax")):
            conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, title, content_hash, last_status) VALUES (:d, :u, :h, :t, 'h', 'ok')"), {"d": domain, "u": url, "h": url_hash(url), "t": title})
        conn.execute(text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, key_events) VALUES (:s, :d, 'g1', '/abonnement', 7, 0)"), {"s": site, "d": today})
    rows = {row["url"]: row for row in client.get(f"/api/site-pages?{period(site)}").json["pages"]}
    assert set(rows) == {"https://shop.example/visa/", "https://shop.example/tax", "https://shop.example/contact", "https://shop.example/abonnement"}
    assert rows["https://shop.example/tax"]["title"] == "Tax"  # the reader's page and Google's are one row
    content = {row["path"] for row in client.get(f"/api/metrics/content?{period(site)}").json["pages"]}
    assert content == {"/visa/", "/tax", "/abonnement"}
    # The page view keeps Google's spelling, whichever way it was asked for.
    for asked in ("/tax/", "/tax", "https://shop.example/tax/"):
        data = client.get(f"/api/site-pages/profile?site_id={site}&url={asked}").json
        assert (data["path"], data["url"]) == ("/tax", "https://shop.example/tax"), asked
    assert client.get(f"/api/site-pages/profile?site_id={site}&url=/contact/").json["url"] == "https://shop.example/contact"  # the reader's spelling


def test_change_is_clicks_against_the_28_days_before_and_only_where_page_data_covers_them(client, engine):
    """28 days ending 16 Nov (20 Oct - 16 Nov) vs the 28 before (21 Sept - 18 Oct): /a 50 -> 20 is -30, /b 5 -> 12 is +7,
    /new had no row before but the page table covers the period before, so 0 -> 9 is +9. Another site whose page table
    starts inside the period before gets no Change at all, never a made-up gain."""
    with engine.begin() as conn:
        one = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('one.example', 'https://one.example/', 'own')")).lastrowid
        two = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('two.example', 'https://two.example/', 'own')")).lastrowid
        rows = [
            (one, "2026-09-21", "a", "https://one.example/a", 30), (one, "2026-10-18", "a", "https://one.example/a", 20), (one, "2026-11-16", "a", "https://one.example/a", 20),
            (one, "2026-10-01", "b", "https://one.example/b", 5), (one, "2026-11-01", "b", "https://one.example/b", 12),
            (one, "2026-11-10", "n", "https://one.example/new", 9),
            (one, "2026-09-20", "a", "https://one.example/a", 999),  # the day before the period before: never counted
            (two, "2026-10-10", "x", "https://two.example/x", 40), (two, "2026-11-10", "x", "https://two.example/x", 60),
        ]
        for site_id, day, h, page, clicks in rows:
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, :c, 5)"), {"s": site_id, "d": day, "h": h, "p": page, "c": clicks})
    reply = client.get("/api/site-pages?from=2026-10-20&to=2026-11-16&compare_from=2026-09-21&compare_to=2026-10-18").json
    by = {r["url"]: r for r in reply["pages"]}
    assert (by["https://one.example/a"]["clicks"], by["https://one.example/a"]["clicks_before"], by["https://one.example/a"]["change"]) == (20, 50, -30)
    assert by["https://one.example/b"]["change"] == 7 and by["https://one.example/new"]["change"] == 9
    assert by["https://two.example/x"]["change"] is None and by["https://two.example/x"]["clicks_before"] is None
    assert reply["summary"]["losing"] == 1 and reply["compared"] is True
