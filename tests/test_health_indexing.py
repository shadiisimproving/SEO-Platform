"""Build next 9 and 10: is every page on Google (URL Inspection within the quota), and the internal links report.

Made-up sites only; URL Inspection is a fake and nothing reaches Google.
"""
from sqlalchemy import text

from seo.backlinks import indexed
from seo.health import audit, indexing
from tests.test_backlink_seo import google, world  # noqa: F401 - fixtures


def own_pages(world, *paths, status="ok", first_seen=None):
    with world.engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO domains (host) VALUES ('shop-one.test')"))
        domain = conn.execute(text("SELECT id FROM domains WHERE host = 'shop-one.test'")).scalar()
        for n, path in enumerate(paths):
            url = f"https://shop-one.test{path}"
            conn.execute(
                text("INSERT INTO pages (domain_id, url, url_hash, last_status, first_seen_at) VALUES (:d, :u, :h, :s, :f)"),
                {"d": domain, "u": url, "h": indexed.url_hash(url), "s": status, "f": first_seen or f"2026-10-{10 + n:02d} 00:00:00"},
            )


def test_every_page_the_app_read_is_inspected_not_only_backlink_targets(world, google):
    world.connect()
    own_pages(world, "/", "/about", "/services")
    world.index["/services"] = {"verdict": "NEUTRAL", "coverageState": "Crawled - currently not indexed"}
    assert indexing.enqueue_due(world.engine) == [world.own]
    world.collect()
    asked = sorted(body["inspectionUrl"] for body in world.asked)
    assert asked == ["https://shop-one.test/", "https://shop-one.test/about", "https://shop-one.test/services"]
    shown = world.client.get(f"/api/health/sites/{world.own}/indexing").get_json()
    assert shown["pages"] == 3 and shown["indexed"] == 2 and shown["not_indexed_count"] == 1 and shown["unchecked"] == 0
    assert shown["not_indexed"][0]["url"] == "https://shop-one.test/services" and shown["not_indexed"][0]["coverage"] == "Crawled - currently not indexed"
    # Asked again only when the answer is old: nothing is due now.
    assert indexing.due_pages(world.engine, world.own) == []


def test_backlink_target_pages_stay_with_the_backlinks_check_and_its_200_are_untouched(world, google, monkeypatch):
    world.connect()
    own_pages(world, "/page/", "/a", "/b", "/c")
    world.add()  # a live link to /page/
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET status = 'live'"))
    assert "https://shop-one.test/page/" not in indexing.due_pages(world.engine, world.own)
    monkeypatch.setattr(indexing, "PER_DAY", 2)
    indexing.enqueue(world.engine, world.own)
    world.collect()
    assert len(world.asked) == 2  # spread over days: two today, the third tomorrow
    assert indexed._asked_today(world.engine, world.own, "https://shop-one.test/") == 0  # the backlinks check's allowance is its own
    assert indexing.summary(world.engine, world.own)["unchecked"] == 2  # /c and the backlink's /page/, which its own check asks about


def test_newest_pages_go_first_when_search_console_has_no_numbers(world, google):
    world.connect()
    own_pages(world, "/old", first_seen="2025-01-01 00:00:00")
    own_pages(world, "/new", first_seen="2026-11-01 00:00:00")
    assert indexing.due_pages(world.engine, world.own) == ["https://shop-one.test/new", "https://shop-one.test/old"]


def test_pages_with_most_clicks_go_first(world, google, monkeypatch):
    world.connect()
    own_pages(world, "/quiet", "/popular", first_seen="2026-11-01 00:00:00")
    monkeypatch.setattr(indexing, "importance", lambda engine, site_id: {"/popular": (50, 900), "/quiet": (0, 3)})
    assert indexing.due_pages(world.engine, world.own)[0] == "https://shop-one.test/popular"


def test_no_search_console_means_nothing_is_asked_and_the_screen_says_so(world, google):
    own_pages(world, "/")
    assert indexing.enqueue_due(world.engine) == []
    shown = world.client.get(f"/api/health/sites/{world.own}/indexing").get_json()
    assert shown["on"] is False and world.asked == []
    from seo.links import service as links
    rival = links.add_site(world.engine, "https://rival.example/", "competitor", is_allowed=lambda url: True)["id"]
    assert world.client.get(f"/api/health/sites/{rival}/indexing").status_code == 403


def test_a_page_that_failed_to_load_is_not_inspected(world, google):
    world.connect()
    own_pages(world, "/gone", status="gone")
    assert indexing.due_pages(world.engine, world.own) == []


# ---- the internal links report ----------------------------------------------------------------------------

def test_links_in_are_counted_once_per_linking_page():
    found = audit.Findings()
    on = lambda u: "shop.example" in u  # noqa: E731
    audit.count_links_in(found, "https://shop.example/", ["https://shop.example/a", "https://shop.example/a#top", "https://shop.example/b", "https://other.example/x"], on)
    audit.count_links_in(found, "https://shop.example/a", ["https://shop.example/b", "https://shop.example/a"], on)
    audit.count_links_in(found, "https://shop.example/a", ["https://shop.example/b"], on)  # the same page read twice counts once
    report = audit.internal_links(found, ["https://shop.example/", "https://shop.example/a", "https://shop.example/b", "https://shop.example/lonely"], "https://shop.example/")
    assert report["pages"] == {"https://shop.example/a": 1}
    assert report["orphans"] == ["https://shop.example/lonely"] and report["sitemap_pages"] == 4


def test_findings_with_links_in_survive_a_save_between_chunks():
    found = audit.Findings()
    audit.count_links_in(found, "https://shop.example/", ["https://shop.example/a"], lambda u: True)
    again = audit.Findings.from_json(found.to_json())
    assert again.links_in == found.links_in and again.linked_from == found.linked_from
    old = found.to_json()
    for key in ("links_in", "link_names", "linked_from"):
        old.pop(key)
    assert audit.Findings.from_json(old).links_in == {}  # a test saved before the report still carries on


def test_a_page_with_clicks_is_asked_again_every_week_and_a_quiet_one_every_month(world, google, monkeypatch):
    """Expert review 2026-11-17: a money page that fell out of Google surfaced 30 days late. Indexed pages with Search
    Console clicks are now asked again after 7 days; pages without clicks keep 30."""
    world.connect()
    own_pages(world, "/money", "/quiet")
    monkeypatch.setattr(indexing, "importance", lambda engine, site_id: {"/money": (40, 900), "/quiet": (0, 0)})
    indexing.enqueue(world.engine, world.own)
    world.collect()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE gsc_inspections SET inspected_at = UTC_TIMESTAMP(3) - INTERVAL 8 DAY"))
    assert indexing.due_pages(world.engine, world.own) == ["https://shop-one.test/money"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE gsc_inspections SET inspected_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY"))
    assert sorted(indexing.due_pages(world.engine, world.own)) == ["https://shop-one.test/money", "https://shop-one.test/quiet"]


def test_google_dropping_an_indexed_page_rings_the_bell_once(world, google):
    world.connect()
    own_pages(world, "/abonnement", "/contact")
    indexing.enqueue(world.engine, world.own)
    world.collect()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE gsc_inspections SET inspected_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY"))
    world.index["/abonnement"] = {"verdict": "NEUTRAL", "coverageState": "Crawled - currently not indexed"}
    indexing.enqueue(world.engine, world.own)
    world.collect()
    bell = world.client.get("/api/notifications").get_json()
    dropped = [n for n in bell["items"] if n["kind"] == "page_dropped"]
    assert len(dropped) == 1 and bell["unread"] == 1
    assert dropped[0]["detail"]["url"] == "https://shop-one.test/abonnement" and dropped[0]["detail"]["coverage"] == "Crawled - currently not indexed"
    # Asked again and still out: no second ring. A page never indexed (first answer NEUTRAL) never rings.
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE gsc_inspections SET inspected_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY"))
    indexing.enqueue(world.engine, world.own)
    world.collect()
    assert len([n for n in world.client.get("/api/notifications").get_json()["items"] if n["kind"] == "page_dropped"]) == 1
