"""The Pages screen: one row per page of my sites, and one page's whole story."""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

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
    assert set(rows) == {"/visa/", "/tax/"}
    visa, tax = rows["/visa/"], rows["/tax/"]
    assert (visa["clicks"], visa["tasks_open"], visa["notes"], visa["backlinks"]) == (40, 1, 1, 1)
    assert (tax["backlinks"], tax["indexed"], tax["tasks_open"]) == (0, False, 0)  # a lost link doesn't count
    assert data["pages"][0]["path"] == "/visa/"  # most clicks first
    assert data["summary"] == {"pages": 2, "with_clicks": 2, "not_indexed": 1, "open_tasks": 1}


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


def test_list_gives_each_read_page_its_title_and_picture(client, site, engine):
    with engine.begin() as conn:
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop.example')")).lastrowid
        conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, title, content_hash, extras) VALUES (:d, 'https://shop.example/visa/', 'v', 'Visa guide', 'h', :e)"),
                     {"d": domain, "e": '{"image": "https://shop.example/img/visa.jpg"}'})
        conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, title, content_hash, extras) VALUES (:d, 'https://shop.example/tax', 't', 'Tax', 'h', :e)"),
                     {"d": domain, "e": '{"image": "javascript:alert(1)"}'})
    rows = {row["path"]: row for row in client.get(f"/api/site-pages?{period(site)}").json["pages"]}
    assert (rows["/visa/"]["title"], rows["/visa/"]["image"]) == ("Visa guide", "https://shop.example/img/visa.jpg")
    assert (rows["/tax/"]["title"], rows["/tax/"]["image"]) == ("Tax", "")


def test_a_page_read_before_pictures_were_kept_is_asked_for_whole_once(engine):
    from seo.competitors import pages as page_reader
    from seo.crawl.fetch import FetchResult

    html = b'<html><head><title>Visa</title><meta property="og:image" content="/img/visa.jpg"></head><body><main><p>Visa guide text</p></main></body></html>'

    class Fetcher:
        requests = 0
        asked: list = []

        def get(self, url, etag=None, last_modified=None, **_options):
            self.requests += 1
            self.asked.append(etag)
            if etag:
                return FetchResult(url=url, status="not_modified", http_status=304)
            return FetchResult(url=url, status="ok", http_status=200, body=html, etag='"v1"', final_url=url)

    url, fetcher = "https://shop.example/visa/", Fetcher()
    page_reader.read_page(engine, url, "shop.example", fetcher)
    with engine.begin() as conn:  # as stored by the reader before it kept pictures
        conn.execute(text("UPDATE pages SET extras = '{\"images\": 0}' WHERE url = :u"), {"u": url})
    page_reader.read_page(engine, url, "shop.example", fetcher)
    page_reader.read_page(engine, url, "shop.example", fetcher)
    assert fetcher.asked == [None, None, '"v1"']  # whole page once more, then back to "only if changed"
    with engine.connect() as conn:
        assert page_reader._as_dict(conn.execute(text("SELECT extras FROM pages WHERE url = :u"), {"u": url}).scalar())["image"] == "https://shop.example/img/visa.jpg"
        assert conn.execute(text("SELECT COUNT(*) FROM change_events")).scalar() == 0  # no fake edit from it
