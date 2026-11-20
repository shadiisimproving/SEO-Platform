"""The keyword panel's Position over time (seo/metrics/keyword_timeline.py): Search Console's line, and what was done as
markers on the same dates. Made-up sites only (seo-command-center-no-own-data-in-repo)."""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import text

from seo.collectors.common import digest
from seo.links import service as links
from seo.metrics import keyword_timeline as kt
from seo.serp import store
from seo.web import create_app

ME = "me.example"
ALLOW = lambda url: True  # noqa: E731
START, END = date(2026, 8, 20), date(2026, 11, 17)


@pytest.fixture
def site(engine):
    return links.add_site(engine, f"https://{ME}/", "own", is_allowed=ALLOW)["id"]


def track(engine, site, keyword, country="FR"):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, 'fr')"), {"k": keyword, "h": store.keyword_hash(keyword), "c": country})
        kid = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h"), {"h": store.keyword_hash(keyword)}).scalar_one()
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
    return kid


def gsc(engine, site, query, day, position, impressions, country=None, page=None):
    with engine.begin() as conn:
        if page:  # a query's page only: the line itself comes from the rows without a page
            conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :pg, 0, :i, :p)"),
                         {"s": site, "d": day, "h": digest(query, page), "q": query, "pg": page, "i": impressions, "p": position})
            return
        if country:
            conn.execute(text("INSERT INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :c, :h, :q, 0, :i, :p)"),
                         {"s": site, "d": day, "c": country, "h": digest(query), "q": query, "i": impressions, "p": position})
        else:
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 0, :i, :p)"),
                         {"s": site, "d": day, "h": digest(query), "q": query, "i": impressions, "p": position})


def link(engine, site, domain, placed, keyword=None, target=None, status="live"):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, placed, keyword, target_url, status, anchor) VALUES (:s, :u, :d, :p, :k, :t, :st, 'a')"),
                     {"s": site, "u": f"https://{domain}/post", "d": domain, "p": placed, "k": keyword, "t": target, "st": status})


def test_line_is_impression_weighted_per_day_and_stops_at_the_last_final_day(engine, site):
    kid = track(engine, site, "sofa repair")
    gsc(engine, site, "sofa repair", date(2026, 9, 1), 10, 30)
    gsc(engine, site, "sofa repair", date(2026, 9, 1), 20, 10, country="fra")  # France alone, which starts too late here
    gsc(engine, site, "sofa repair", date(2026, 9, 2), 20, 10)
    gsc(engine, site, "sofa repair", date(2026, 11, 17), 4, 5)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through) VALUES (:s, 'gsc', '2026-11-16')"), {"s": site})
    answer = kt.timeline(engine, site, kid, START, END)
    assert answer["series"] == [{"day": "2026-09-01", "p": 10.0, "impressions": 30}, {"day": "2026-09-02", "p": 20.0, "impressions": 10}]  # 17 Nov isn't final yet
    assert answer["scope"] == "all" and answer["through"] == "2026-11-16" and not answer["weekly"]


def test_country_line_only_when_it_reaches_the_start_and_long_periods_are_weekly(engine, site):
    kid = track(engine, site, "sofa repair")
    gsc(engine, site, "sofa repair", date(2026, 9, 1), 30, 10)
    gsc(engine, site, "sofa repair", date(2026, 9, 1), 3, 10, country="fra")  # France starts after the range does
    assert kt.timeline(engine, site, kid, START, END)["scope"] == "all"
    gsc(engine, site, "sofa repair", START, 5, 10, country="fra")
    assert kt.timeline(engine, site, kid, START, END)["scope"] == "fra"
    long = kt.timeline(engine, site, kid, date(2026, 1, 1), END)
    assert long["weekly"] and long["scope"] == "all"


def test_bought_links_match_the_keyword_or_its_main_page_never_found_ones(engine, site):
    kid = track(engine, site, "sofa repair")
    gsc(engine, site, "sofa repair", date(2026, 9, 1), 8, 100, page=f"https://{ME}/sofa/")
    gsc(engine, site, "sofa repair", date(2026, 9, 1), 30, 5, page=f"https://{ME}/")  # a page it barely touched
    link(engine, site, "a.example", "2026-09-10", keyword="Sofa repair")
    link(engine, site, "b.example", "2026-09-10", target=f"http://www.{ME}/sofa")  # same page, written another way
    link(engine, site, "c.example", "2026-09-12", target=f"https://{ME}/")  # home page: another keyword's link
    link(engine, site, "d.example", "2026-09-12", keyword="sofa repair", status="found")  # seen, never bought
    link(engine, site, "e.example", "early October", keyword="sofa repair")  # no date: listed, not placed on a guess
    link(engine, site, "f.example", "2026-07-01", keyword="sofa repair")  # before the range
    answer = kt.timeline(engine, site, kid, START, END)
    assert answer["pages"] == [f"{ME}/sofa"]
    [mark] = answer["markers"]
    assert (mark["kind"], mark["day"], mark["count"]) == ("link", "2026-09-10", 2)
    assert {item["text"] for item in mark["items"]} == {"a.example", "b.example"}
    assert [u["text"] for u in answer["undated"]] == ["e.example"]


def test_the_page_our_check_found_counts_but_only_on_my_site(engine, site):
    kid = track(engine, site, "sofa repair")
    link(engine, site, "a.example", "2026-09-10", target=f"https://{ME}/checked-page/")
    assert kt.timeline(engine, site, kid, START, END)["markers"] == []
    answer = kt.timeline(engine, site, kid, START, END, [f"https://{ME}/checked-page", "https://other.example/checked-page"])
    assert answer["pages"] == [f"{ME}/checked-page"] and answer["markers"][0]["text"] == "a.example"


def test_edits_tasks_and_google_updates(engine, site):
    kid = track(engine, site, "sofa repair")
    gsc(engine, site, "sofa repair", date(2026, 9, 1), 8, 100, page=f"https://{ME}/sofa")
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO domains (host) VALUES (:h)"), {"h": ME})
        dom = conn.execute(text("SELECT id FROM domains WHERE host = :h"), {"h": ME}).scalar_one()
        for url in (f"https://{ME}/sofa", f"https://{ME}/other"):
            conn.execute(text("INSERT INTO pages (domain_id, url, url_hash) VALUES (:d, :u, :h)"), {"d": dom, "u": url, "h": digest(url) + digest(url)})
        sofa = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": f"https://{ME}/sofa"}).scalar_one()
        other = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": f"https://{ME}/other"}).scalar_one()
        for page, kind, at in ((sofa, "title", "2026-10-02 09:00"), (sofa, "meta", "2026-10-02 10:00"), (sofa, "new_page", "2026-09-01 10:00"), (other, "title", "2026-10-03 09:00")):
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, detected_at) VALUES (:p, :d, :k, :a)"), {"p": page, "d": dom, "k": kind, "a": at})
        conn.execute(text("INSERT INTO tasks (title, status, site_id, completed_at, keywords, pages) VALUES ('Rewrite intro', 'done', :s, :c, :k, '[]')"), {"s": site, "c": datetime(2026, 10, 5, 8), "k": '["sofa repair"]'})
        conn.execute(text("INSERT INTO tasks (title, status, site_id, completed_at, keywords, pages, deleted_at) VALUES ('Gone', 'done', :s, :c, :k, '[]', :c)"), {"s": site, "c": datetime(2026, 10, 6, 8), "k": '["sofa repair"]'})
        conn.execute(text("INSERT INTO tasks (title, status, site_id, completed_at, keywords, pages) VALUES ('Other keyword', 'done', :s, :c, '[\"chairs\"]', '[]')"), {"s": site, "c": datetime(2026, 10, 7, 8)})
        conn.execute(text("INSERT INTO google_updates (id, name, kind, began, ended, url) VALUES ('u1', 'September spam update', 'spam', '2026-09-24', '2026-10-08', 'https://status.search.google.com/x'), ('u2', 'November core update', 'core', '2026-11-10', NULL, 'https://status.search.google.com/y'), ('u0', 'Old', 'core', '2026-01-01', '2026-01-10', 'https://status.search.google.com/z')"))
    answer = kt.timeline(engine, site, kid, START, END)
    marks = [(m["kind"], m["day"], m["text"], m["count"]) for m in answer["markers"]]
    assert marks == [("edit", "2026-10-02", "meta, title", 2), ("task", "2026-10-05", "Rewrite intro", 1)]  # no new_page, no other page, no deleted task
    assert [(b["text"], b["end"], b["rolling"]) for b in answer["bands"]] == [("September spam update", "2026-10-08", False), ("November core update", str(END), True)]


def test_route_needs_a_site_and_real_dates(engine, site):
    kid = track(engine, site, "sofa repair")
    client = create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client()
    assert client.get(f"/api/rankings/{kid}/timeline?from=2026-08-20&to=2026-11-17").status_code == 400
    assert client.get(f"/api/rankings/{kid}/timeline?site_id={site}&from=soon&to=2026-11-17").status_code == 400
    ok = client.get(f"/api/rankings/{kid}/timeline?site_id={site}&from=2026-08-20&to=2026-11-17&page=https://{ME}/a")
    assert ok.status_code == 200 and ok.get_json()["keyword_id"] == kid
    assert client.get(f"/api/rankings/999999/timeline?site_id={site}&from=2026-08-20&to=2026-11-17").status_code == 404
