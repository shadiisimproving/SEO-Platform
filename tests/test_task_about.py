"""What a task is about, beyond pages and keywords, and the lists the task panel picks from."""
import pytest
from sqlalchemy import text

from seo.web import create_app


@pytest.fixture
def client(engine):
    return create_app(engine=engine, auth=False).test_client()


@pytest.fixture
def world(engine) -> dict:
    with engine.begin() as conn:
        own = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop.example', 'https://shop.example/', 'own')")).lastrowid
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('blog.example', 'https://blog.example/', 'own')")).lastrowid
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.example', 'https://rival.example/', 'competitor')")).lastrowid
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id) VALUES (:s, :c)"), {"s": own, "c": rival})
        link = conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, target_url) VALUES (:s, 'https://news.example/a', 'news.example', 'https://shop.example/visa/')"), {"s": own}).lastrowid
        foreign = conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain) VALUES (:s, 'https://x.example/', 'x.example')"), {"s": other}).lastrowid
        note = conn.execute(text("INSERT INTO notes (scope, site_id, body) VALUES ('site', :s, 'Ask Sara about the visa page\nmore')"), {"s": own}).lastrowid
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions) VALUES (:s, CURDATE(), 'h1', 'https://shop.example/visa/', 12, 300)"), {"s": own})
        audit = conn.execute(text("INSERT INTO health_audits (site_id, status) VALUES (:s, 'complete')"), {"s": own}).lastrowid
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, 'broken_pages', 3, '[]')"), {"a": audit})
        conn.execute(text("INSERT INTO prospects (site_id, url, domain, spam_score) VALUES (:s, 'https://guide.example/', 'guide.example', 2)"), {"s": own})
    return {"own": own, "other": other, "rival": rival, "link": link, "foreign": foreign, "note": note}


def about(*items, main="backlink"):
    return {"main": main, "items": [{"kind": k, "ref": r, "label": label} for k, r, label in items]}


def test_about_saved_and_read_back(client, world):
    body = about(("backlink", world["link"], "news.example"), ("technical", "health:broken_pages", "Error pages"),
                 ("competitor", world["rival"], "rival.example"), ("note", world["note"], "Ask Sara"), ("domain", "guide.example", "guide.example"),
                 ("ranking", "4:google", "visa spain · Google"))
    reply = client.post("/api/tasks", json={"title": "Fix it", "site_id": world["own"], "pages": ["/visa/"], "about": body})
    assert reply.status_code == 201, reply.json
    task = reply.json
    assert task["about"]["main"] == "backlink"
    assert [(i["kind"], i["ref"]) for i in task["about"]["items"]] == [
        ("backlink", str(world["link"])), ("technical", "health:broken_pages"), ("competitor", str(world["rival"])),
        ("note", str(world["note"])), ("domain", "guide.example"), ("ranking", "4:google")]
    listed = client.get("/api/tasks").json["tasks"][0]
    assert listed["about"] == task["about"]
    # Only "main" changes: the rest stays.
    changed = client.patch(f"/api/tasks/{task['id']}", json={"about": {**task["about"], "main": "page"}}).json
    assert changed["about"]["main"] == "page" and len(changed["about"]["items"]) == 6


def test_tasks_without_about_read_as_empty(client, world):
    task = client.post("/api/tasks", json={"title": "Old style"}).json
    assert task["about"] == {"main": "", "items": []}
    general = client.post("/api/tasks", json={"title": "General", "about": {"main": "general", "items": []}}).json
    assert general["about"]["main"] == "general"


@pytest.mark.parametrize("bad", [
    {"main": "anything"},
    {"main": "page", "items": [{"kind": "page", "ref": "/x/", "label": ""}]},  # pages have their own list
    {"main": "", "items": [{"kind": "technical", "ref": "made-up:1", "label": ""}]},
    {"main": "", "items": [{"kind": "backlink", "ref": "abc", "label": ""}]},
    {"main": "", "items": "nope"},
    {"main": "", "items": [], "more": 1},
])
def test_bad_about_refused(client, world, bad):
    reply = client.post("/api/tasks", json={"title": "x", "site_id": world["own"], "about": bad})
    assert reply.status_code == 400, reply.json


def test_another_sites_backlink_is_refused(client, world):
    reply = client.post("/api/tasks", json={"title": "x", "site_id": world["own"], "about": about(("backlink", world["foreign"], "x"))})
    assert reply.status_code == 400
    assert "doesn't belong" in reply.json["error"]
    # Moving the task to another site checks again.
    task = client.post("/api/tasks", json={"title": "y", "site_id": world["other"], "about": about(("backlink", world["foreign"], "x"))}).json
    assert task["about"]["items"][0]["ref"] == str(world["foreign"])


def test_options_list_what_the_site_has(client, world):
    reply = client.get(f"/api/tasks/options?site_id={world['own']}")
    assert reply.status_code == 200, reply.json
    data = reply.json
    page = next(p for p in data["pages"] if p["url"].endswith("/visa/"))
    assert page["clicks"] == 12
    assert [b["id"] for b in data["backlinks"]] == [world["link"]]  # never another site's link
    assert {"ref": "health:broken_pages", "part": "health", "code": "broken_pages", "count": 3} in data["technical"]
    assert [c["host"] for c in data["competitors"]] == ["rival.example"]
    assert data["notes"][0] == {"id": world["note"], "scope": "site", "text": "Ask Sara about the visa page"}
    assert {"domain": "guide.example", "where": "consideration", "spam": False} in data["domains"]


def test_options_refuse_a_competitor_or_bad_site(client, world):
    assert client.get(f"/api/tasks/options?site_id={world['rival']}").status_code == 400
    assert client.get("/api/tasks/options?site_id=x").status_code == 400
