"""The Site map: a website's pages as a mind map, by address folders and by the links between pages."""
import json

import pytest
from sqlalchemy import text

from seo.crawl import store
from seo.crawl.extract import extract
from seo.crawl.fetch import FetchResult
from seo.pages import sitemap_tree
from seo.web import create_app


@pytest.fixture
def client(engine):
    return create_app(engine=engine, auth=False).test_client()


def _page(conn, domain, url, title="", links=None, read=True):
    page = conn.execute(
        text("INSERT INTO pages (domain_id, url, url_hash, title, word_count, last_status, content_hash) VALUES (:d, :u, SHA2(:u, 256), :t, 120, 'ok', :c)"),
        {"d": domain, "u": url, "t": title, "c": "x" if read else None},
    ).lastrowid
    if links is not None:
        conn.execute(text("INSERT INTO page_links (page_id, domain_id, links) VALUES (:p, :d, :l)"), {"p": page, "d": domain, "l": json.dumps(links)})
    return page


@pytest.fixture
def site(engine) -> int:
    with engine.begin() as conn:
        own = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop.example', 'https://shop.example/', 'own')")).lastrowid
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop.example')")).lastrowid
        _page(conn, domain, "https://shop.example/", "Home | Shop", ["shop.example/services/", "shop.example/blog/", "shop.example/missing"])
        _page(conn, domain, "https://shop.example/services/", "Services | Shop", ["shop.example/", "shop.example/services/visa"])
        _page(conn, domain, "https://shop.example/services/visa", "Visa | Shop", ["shop.example/"])
        _page(conn, domain, "https://shop.example/blog/", "Blog | Shop", ["shop.example/blog/2026/post-a"])
        _page(conn, domain, "https://shop.example/blog/2026/post-a", "Post A | Shop", [])
        _page(conn, domain, "https://shop.example/blog/2026/post-b", "Post B | Shop")  # links not read yet, and nothing links to it
        _page(conn, domain, "https://shop.example/old", "Old")
        conn.execute(text("UPDATE pages SET last_status = 'gone' WHERE url = 'https://shop.example/old'"))
        conn.execute(text("INSERT INTO notes (scope, site_id, page_url, page_hash, body) VALUES ('page', :s, 'https://shop.example/services/visa', SHA2('https://shop.example/services/visa', 256), 'Rewrite')"), {"s": own})
        conn.execute(text("INSERT INTO notes (scope, site_id, page_url, page_hash, body) VALUES ('section', :s, 'https://shop.example/blog/2026/', SHA2('https://shop.example/blog/2026/', 256), 'Old posts')"), {"s": own})
    return own


def _tree(data):
    by_id = {box["id"]: box for box in data["boxes"]}
    return {box["path"] or box["label"]: (by_id[box["parent"]]["path"] or by_id[box["parent"]]["label"]) if box["parent"] is not None else None for box in data["boxes"]}


def test_folders_follow_the_address(client, site):
    reply = client.get(f"/api/site-map?site_id={site}")
    assert reply.status_code == 200, reply.json
    data = reply.json
    assert data["pages"] == 6  # the gone page is left out
    assert _tree(data) == {
        "/": None, "/blog/": "/", "/services/": "/", "/blog/2026/": "/blog/", "/services/visa": "/services/",
        "/blog/2026/post-a": "/blog/2026/", "/blog/2026/post-b": "/blog/2026/",
    }
    boxes = {box["path"]: box for box in data["boxes"]}
    assert boxes["/"]["kind"] == "home" and boxes["/"]["pages"] == 5
    assert boxes["/blog/2026/"]["kind"] == "folder" and boxes["/blog/2026/"]["notes"] == 1 and boxes["/blog/2026/"]["pages"] == 2
    assert boxes["/services/visa"]["notes"] == 1
    assert boxes["/services/visa"]["label"] == "Visa"  # the site's name, on most titles, is taken off
    assert [box["path"] for box in data["boxes"] if box["parent"] == boxes["/"]["id"]] == ["/blog/", "/services/"]  # the biggest branch first


def test_links_put_each_page_under_its_shortest_way_in(client, site):
    data = client.get(f"/api/site-map?site_id={site}&view=links").json
    tree = _tree(data)
    assert tree["/services/"] == "/" and tree["/blog/"] == "/"
    assert tree["/services/visa"] == "/services/" and tree["/blog/2026/post-a"] == "/blog/"
    assert tree["/blog/2026/post-b"] == "Not reached from the home page"
    assert data["links"] == {"read": 5, "of": 6}
    home_kids = [box["path"] for box in data["boxes"] if box["parent"] == 0 and box["kind"] == "page"]
    assert home_kids == ["/services/", "/blog/"]  # in the order the home page links to them


def test_a_competitor_and_wrong_asks(client, site, engine):
    with engine.begin() as conn:
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.example', 'https://www.rival.example/', 'competitor')")).lastrowid
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('rival.example')")).lastrowid
        _page(conn, domain, "https://www.rival.example/", "Rival")
        _page(conn, domain, "https://www.rival.example/prix/dubai", "Prix")
    data = client.get(f"/api/site-map?competitor_id={rival}").json
    assert data["site"]["kind"] == "competitor"
    folder = next(box for box in data["boxes"] if box["kind"] == "folder")
    assert folder["url"] == "https://www.rival.example/prix/"  # the site's own spelling, so the folder's notes match its pages
    assert client.get("/api/site-map?site_id=abc").status_code == 400
    assert client.get(f"/api/site-map?site_id={site}&view=stars").status_code == 400
    assert client.get("/api/site-map?site_id=999999").status_code == 404
    empty = client.get(f"/api/site-map?site_id={rival}&view=links").json
    assert empty["links"] == {"read": 0, "of": 2} and len(empty["boxes"]) == 3  # nothing read: both pages, one under "not reached"


def test_page_card_lists_links_both_ways(client, site):
    reply = client.get(f"/api/site-map/page?site_id={site}&url=https://shop.example/services/")
    assert reply.status_code == 200, reply.json
    card = reply.json
    assert card["title"] == "Services | Shop" and card["word_count"] == 120
    assert [link["path"] for link in card["links_out"]] == ["/", "/services/visa"]
    assert [link["path"] for link in card["links_in"]] == ["/"]
    unread = client.get(f"/api/site-map/page?site_id={site}&url=https://shop.example/blog/2026/post-b").json
    assert unread["links_out"] is None and unread["links_in"] == []
    assert client.get(f"/api/site-map/page?site_id={site}&url=https://shop.example/nowhere").status_code == 404


HTML = b"""<html><head><title>T</title></head><body><nav><a href="/services/">S</a><a href="https://www.shop.example/blog/#top">B</a></nav>
<main><p>Hello</p><a href="/services/">again</a><a href="visa?utm_source=x">V</a><a href="/file.pdf">pdf</a><a href="https://other.example/">out</a><a href="/a/">self</a><a href="mailto:x@y.z">m</a></main></body></html>"""


def test_the_reader_saves_a_pages_links(engine):
    fields = extract(HTML, "https://shop.example/a/")
    assert fields.links == ["shop.example/services/", "shop.example/blog/", "shop.example/a/visa"]  # once each, in order, no files, no other sites, not itself
    assert "links" not in fields.as_dict()
    domain = store.get_or_create_domain(engine, "shop.example")
    url = "https://shop.example/a/"
    ok = FetchResult(url=url, status="ok", http_status=200, etag='"1"')
    assert store.validators(engine, url) == (None, None)
    store.save_fetch(engine, domain, url, ok, fields)
    assert store.validators(engine, url) == ('"1"', None)
    with engine.begin() as conn:
        assert json.loads(conn.execute(text("SELECT links FROM page_links")).scalar()) == fields.links
        conn.execute(text("DELETE FROM page_links"))
    assert store.validators(engine, url) == (None, None)  # links never saved: the page is fetched in full once
    fields.links = ["shop.example/services/"]
    store.save_fetch(engine, domain, url, ok, fields)
    with engine.connect() as conn:
        assert json.loads(conn.execute(text("SELECT links FROM page_links")).scalar()) == ["shop.example/services/"]


def test_site_name_is_only_dropped_when_most_titles_carry_it():
    pages = [{"title": t, "h1": None} for t in ("Visa - Shop", "Tax - Shop", "Blog - Shop", "Dubai - a guide")]
    name = sitemap_tree._namer(pages)
    assert [name(p) for p in pages] == ["Visa", "Tax", "Blog", "Dubai - a guide"]
    assert name({"title": "", "h1": '["Only a heading"]'}) == "Only a heading"


def test_labels_drop_the_site_name_a_language_home_repeats_and_titles_saved_as_question_marks():
    from seo.pages.sitemap_tree import _namer

    def page(key, title):
        return {"key": key, "title": title, "h1": None}

    pages = [
        page("shop.example/", "Shop - Shoes and bags"),
        page("shop.example/fr/", "Shop - Chaussures et sacs"),
        page("shop.example/ru/", "Shop - ?????? ? ?????"),
        page("shop.example/boots/", "Winter boots: how to choose?"),
        page("shop.example/bags/", "Leather bags"),
        page("shop.example/care/", "Shoe care"),
        page("shop.example/sizes/", "Size guide"),
        page("shop.example/returns/", "Returns"),
        page("shop.example/contact/", "Contact us"),
    ]
    name = _namer(pages)
    assert name(pages[0]) == "Shop - Shoes and bags"  # the home page keeps its whole title
    assert name(pages[1]) == "Chaussures et sacs"
    assert name(pages[2]) == ""  # the box then shows its address
    assert name(pages[3]) == "Winter boots: how to choose?"


def test_loose_pages_under_the_home_page_are_gathered_into_one_group():
    from seo.pages.sitemap_tree import _Boxes, _gather_loose

    def page(n):
        return {"url": f"https://shop.example/p{n}/", "url_hash": f"h{n}", "title": f"Page {n}", "h1": None, "word_count": 10, "content_hash": "x", "key": f"shop.example/p{n}/"}

    boxes = _Boxes({}, lambda p: p["title"])
    home = boxes.page(None, page(0), "home")
    hub = boxes.page(home, page(1))
    boxes.page(hub, page(2))
    loose = [boxes.page(home, page(n)) for n in range(3, 14)]
    _gather_loose(boxes, home, "Pages with no folder")
    items = boxes.counted()
    group = next(item for item in items if item["kind"] == "group")
    assert group["parent"] == home and group["pages"] == 11
    assert all(items[i]["parent"] == group["id"] for i in loose)
    assert items[hub]["parent"] == home and items[home]["pages"] == 13

    few = _Boxes({}, lambda p: p["title"])
    top = few.page(None, page(0), "home")
    for n in range(1, 20):
        few.page(top, page(n))
    _gather_loose(few, top, "Pages with no folder")  # nothing but loose pages: a group alone would only hide them
    assert not [item for item in few.items if item["kind"] == "group"]


def test_internal_links_groups_pages_by_how_many_pages_link_to_them():
    from seo.pages.sitemap_tree import _Boxes, _by_inlinks

    def page(n, path):
        return {"id": n, "url": f"https://shop.example{path}", "url_hash": f"h{n}", "title": f"Page {n}", "h1": None, "word_count": 10, "content_hash": "x", "key": f"shop.example{path}"}

    pages = [page(0, "/"), page(1, "/a/"), page(2, "/b/"), page(3, "/c/")]
    # Home links to a (twice, counted once) and to itself; a links to b and home; b links to a. Nothing links to c.
    links = {0: ["shop.example/a/", "shop.example/a/", "shop.example/"], 1: ["shop.example/b/", "shop.example/"], 2: ["shop.example/a/"]}
    boxes = _Boxes({}, lambda p: p["title"])
    _by_inlinks({"start_url": "https://shop.example/", "host": "shop.example"}, pages, links, boxes)
    items = boxes.counted()
    groups = {item["label"]: item for item in items if item["kind"] == "group"}
    assert list(groups) == ["No page links to it", "1 page links to it", "2 to 4 pages link to it"]  # weakest first, empty groups left out
    under = {item["path"]: (items[item["parent"]]["label"], item["inlinks"]) for item in items if item["kind"] == "page"}
    assert under == {"/c/": ("No page links to it", 0), "/b/": ("1 page links to it", 1), "/a/": ("2 to 4 pages link to it", 2)}
    assert items[0]["kind"] == "home" and items[0]["inlinks"] == 1


def test_read_again_queues_the_page_reader_once_and_says_where_it_is(client, engine, site):
    assert client.get(f"/api/site-map/reading?site_id={site}").get_json()["busy"] is False
    answer = client.post(f"/api/site-map/read?site_id={site}")
    assert answer.status_code == 202 and answer.get_json()["busy"] is True and answer.get_json()["status"] == "queued"
    client.post(f"/api/site-map/read?site_id={site}")  # pressed twice: still one job
    with engine.connect() as conn:
        jobs = conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = 'competitors.crawl' AND status = 'queued'")).scalar()
    assert jobs == 1
    assert client.get(f"/api/site-map/reading?site_id={site}").get_json()["busy"] is True
    assert client.post("/api/site-map/read?site_id=999999").status_code == 404
