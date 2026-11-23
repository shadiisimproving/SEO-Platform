"""The sitemap checks of the health test (2026-11-18), on a fake site with known answers. Never the real internet."""
import json
import math
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import pytest
from sqlalchemy import text

from seo.crawl import sitemap, store
from seo.health import audit, indexing, service as health, sitemaps
from seo.links import service as links
from tests.test_health_service import HOME, good, urlset, world  # noqa: F401 - world is the shared fixture

ROOT = HOME.rstrip("/")


def index(*paths) -> str:
    rows = "".join(f"<sitemap><loc>{ROOT}{p}</loc></sitemap>" for p in paths)
    return f'<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</sitemapindex>'


def known_site(world, monkeypatch):
    """An index sitemap with 2 child sitemaps, 8 pages listed: 1 answers 404, 1 redirects, 1 is noindex, 1 is blocked by
    robots.txt. /popular has 40 Search Console clicks, can be indexed, and is in no sitemap."""
    world.site.robots = f"User-agent: *\nDisallow: /private\nSitemap: {HOME}sitemap_index.xml\n"
    world.site.pages = {
        "/": good("Home", links_=("/a", "/b", "/c", "/moved", "/hidden")),
        "/a": good("Page A"), "/b": good("Page B"), "/c": good("Page C"),
        "/moved": (301, "/b"),
        "/hidden": good("Hidden", head='<meta name="robots" content="noindex">'),
        "/popular": good("Popular"),
        "/private/p": good("Private"),
        "/sitemap_index.xml": index("/sitemap-pages.xml", "/sitemap-more.xml"),
        "/sitemap-pages.xml": urlset("/", "/a", "/b", "/moved", "/hidden"),
        "/sitemap-more.xml": urlset("/c", "/gone", "/private/p"),
    }
    monkeypatch.setattr(indexing, "clicked_pages", lambda engine, site_id: [(f"{HOME}popular", 40), (f"{HOME}a", 3)])


def card(data) -> dict:
    return {p["code"]: p for p in data["sitemap"]["problems"]}


def paths(problem) -> list[str]:
    return [urlsplit(r["url"]).path for r in problem["rows"]]


def test_the_known_site_finds_each_sitemap_problem_once(world, monkeypatch):
    known_site(world, monkeypatch)
    data = world.run_test()
    assert data["audit"]["status"] == "complete"
    report, found = data["sitemap"], card(data)
    assert report["found"] and report["from_robots"] and report["listed"] == 8 and report["unchecked"] == 0 and report["complete"]
    assert [f["url"] for f in report["files"]] == [f"{HOME}sitemap_index.xml", f"{HOME}sitemap-pages.xml", f"{HOME}sitemap-more.xml"]
    assert set(found) == {"listed_broken", "listed_redirect", "listed_noindex", "listed_blocked", "sitemap_missing_pages"}
    assert paths(found["listed_broken"]) == ["/gone"] and found["listed_broken"]["rows"][0]["code"] == 404
    assert paths(found["listed_redirect"]) == ["/moved"] and found["listed_redirect"]["rows"][0]["to"] == f"{HOME}b"
    assert paths(found["listed_noindex"]) == ["/hidden"]
    assert paths(found["listed_blocked"]) == ["/private/p"]
    assert paths(found["sitemap_missing_pages"]) == ["/popular"] and found["sitemap_missing_pages"]["rows"][0]["clicks"] == 40
    # Errors first, then warnings, in the order the checks are listed
    assert [p["code"] for p in data["sitemap"]["problems"]] == ["listed_broken", "listed_redirect", "listed_noindex", "listed_blocked", "sitemap_missing_pages"]
    assert found["listed_broken"]["severity"] == "crit" and found["listed_redirect"]["severity"] == "warn"


def test_the_known_site_asks_only_what_the_crawl_did_not_see(world, monkeypatch):
    known_site(world, monkeypatch)
    world.run_test()
    asked = [urlsplit(u).path for u in world.site.requests]
    assert asked.count("/gone") == 1 and asked.count("/popular") == 1  # in no link: asked once each
    assert all(asked.count(p) == 1 for p in ("/", "/a", "/c", "/hidden", "/moved"))  # the crawl's answers are reused
    assert "/private/p" not in asked  # robots.txt says no to Googlebot: never asked


def test_the_known_site_scores_with_golden_numbers(world, monkeypatch):
    known_site(world, monkeypatch)
    data = world.run_test()
    # Sitemap: 8 listed, 7 important (/popular clicked; /, /a, /b, /c, /moved, /hidden linked or the start page).
    sitemap_cost = 8 * math.sqrt(1 / 8) + 3 * math.sqrt(1 / 8) + 4 * math.sqrt(1 / 8) + 3 * math.sqrt(1 / 8) + 4 * math.sqrt(1 / 7)  # 7.876
    # The page checks: /hidden is noindex, 1 of the 5 pages the crawl saw.
    page_cost = 8 * math.sqrt(1 / 5)  # 3.578
    assert round(100 - sitemap_cost - page_cost) == 89
    assert data["audit"]["score"] == 89
    assert {c: n for c, n in data["audit"]["counts"].items() if c in audit.SITEMAP_CHECKS} == {
        "listed_broken": 1, "listed_redirect": 1, "listed_noindex": 1, "listed_blocked": 1, "sitemap_missing_pages": 1}


def test_sitemap_problems_are_kept_like_other_checks_for_pages_and_tasks(world, monkeypatch):
    known_site(world, monkeypatch)
    audit_id = world.run_test()["audit"]["id"]
    with world.engine.connect() as conn:
        rows = {r[0]: (r[1], json.loads(r[2]) if isinstance(r[2], str) else r[2]) for r in conn.execute(
            text("SELECT code, page_count, pages FROM health_issues WHERE audit_id = :a"), {"a": audit_id})}
    assert rows["listed_broken"] == (1, [f"{HOME}gone"])
    assert rows["sitemap"][0] == 0  # the report row, like links_in: never a page count


def test_a_site_with_no_sitemap_at_all(world):
    world.site.robots = "User-agent: *\n"
    del world.site.pages["/sitemap.xml"]
    data = world.run_test()
    found = card(data)
    assert list(found) == ["sitemap_missing"] and found["sitemap_missing"]["severity"] == "crit"
    assert not data["sitemap"]["found"]
    assert data["audit"]["score"] == 100 - 8  # a fixed cost, as the whole-site problems have
    asked = [urlsplit(u).path for u in world.site.requests]
    assert {"/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"} <= set(asked)


def test_a_home_page_sent_for_a_sitemap_address_is_no_sitemap_not_broken_xml(world):
    world.site.robots = "User-agent: *\n"
    world.site.pages["/sitemap.xml"] = good("Home")  # many sites answer every address with a page
    assert list(card(world.run_test())) == ["sitemap_missing"]


def test_a_sitemap_robots_txt_names_that_cannot_be_reached(world):
    del world.site.pages["/sitemap.xml"]
    found = card(world.run_test())
    assert list(found) == ["sitemap_unreachable"] and found["sitemap_unreachable"]["rows"] == [{"url": f"{HOME}sitemap.xml", "why": "gone"}]


def test_a_sitemap_that_is_not_valid_xml(world):
    world.site.pages["/sitemap.xml"] = '<?xml version="1.0"?><urlset><url><loc>broken'
    found = card(world.run_test())
    assert list(found) == ["sitemap_invalid"]


def test_a_sitemap_found_at_the_usual_address_but_not_named_in_robots_txt_is_info(world):
    world.site.robots = "User-agent: *\n"
    data = world.run_test()
    found = card(data)
    assert list(found) == ["sitemap_not_in_robots"] and found["sitemap_not_in_robots"]["severity"] == "info"
    assert data["audit"]["score"] == 100  # said, never scored


def test_x_robots_tag_noindex_and_a_canonical_elsewhere_on_listed_pages(world, monkeypatch):
    import httpx

    from seo.crawl.fetch import PoliteFetcher

    world.site.pages["/c"] = good("Page C", head=f'<link rel="canonical" href="{HOME}a">')

    def answer(request):  # the fixture's site, with a header on /d
        reply = world.site(request)
        return httpx.Response(200, html=reply.text, headers={"x-robots-tag": "noindex"}) if request.url.path == "/d" else reply

    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(answer)))
    found = card(world.run_test())
    assert paths(found["listed_noindex"]) == ["/d"]
    assert paths(found["listed_canonical"]) == ["/c"] and found["listed_canonical"]["rows"][0]["to"] == f"{HOME}a"


def test_dates_in_the_future_and_every_page_with_the_same_date(world):
    later = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    same = [f"/p{i}" for i in range(10)]
    world.site.pages["/"] = good("Home", links_=("/a", "/b", "/c", "/d", *same))
    world.site.pages.update({p: good(f"Page {p}") for p in same})
    world.site.pages["/sitemap.xml"] = urlset("/", "/a", "/b", "/c", "/d", *same, lastmod="2026-01-05")
    found = card(world.run_test())
    assert list(found) == ["lastmod_same"] and found["lastmod_same"]["date"] == "2026-01-05" and found["lastmod_same"]["count"] == 15
    world.site.pages["/sitemap.xml"] = urlset("/", "/a", "/b", lastmod="2026-01-05")[:-len("</urlset>")] + (
        f"<url><loc>{ROOT}/c</loc><lastmod>{later}</lastmod></url><url><loc>{ROOT}/d</loc></url></urlset>")
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 1 HOUR")
    found = card(world.run_test())
    assert "lastmod_same" not in found
    assert paths(found["lastmod_future"]) == ["/c"] and found["lastmod_future"]["rows"][0]["lastmod"] == later


def test_a_file_over_50000_addresses_is_an_error():
    listed = sitemap.SitemapResult(entries=[sitemap.Entry(f"{HOME}a")], sources=[f"{HOME}sitemap.xml"], from_robots=True,
                                   files={f"{HOME}sitemap.xml": {"kind": "urlset", "urls": 50_001, "guess": False, "html": False}})
    report = sitemaps.judge(listed, {sitemaps.audit.address_key(f"{HOME}a"): ["ok", None]}, [], audit.Findings(), HOME)
    assert report["counts"] == {"sitemap_too_big": 1} and report["groups"]["sitemap_too_big"]["rows"] == [{"url": f"{HOME}sitemap.xml", "urls": 50_001}]


def test_a_file_over_50_mb_is_an_error(monkeypatch):
    monkeypatch.setattr(sitemap, "MAX_UNZIPPED_BYTES", 100)

    class Big:
        requests = 0

        def sitemaps_from_robots(self, base):
            return [f"{HOME}sitemap.xml"]

        def get(self, url, any_type=False, max_bytes=None, **_):
            assert max_bytes == 100  # the health test reads up to Google's limit
            return type("R", (), {"status": "too_large", "body": None})()

    listed = sitemap.discover(Big(), HOME, max_bytes=sitemap.MAX_UNZIPPED_BYTES)
    report = sitemaps.judge(listed, {}, [], audit.Findings(), HOME)
    assert list(report["counts"]) == ["sitemap_too_big"]


def test_sitemap_problems_never_swamp_the_score():
    worst = {"counts": {code: 1000 for code in audit.SITEMAP_CHECKS}, "listed": 1000, "important": 1000}
    assert audit.sitemap_cost(worst) == audit.SITEMAP_MAX_COST == 15
    assert audit.score({}, [], 10, worst) == 85


def test_missing_pages_are_not_said_when_part_of_the_sitemap_could_not_be_read(world, monkeypatch):
    known_site(world, monkeypatch)
    world.site.pages["/sitemap-more.xml"] = 500
    data = world.run_test()
    found = card(data)
    assert "sitemap_missing_pages" not in found and data["sitemap"]["missing_not_judged"]
    assert paths(found["sitemap_unreachable"]) == ["/sitemap-more.xml"]


def test_a_fresh_answer_from_the_daily_read_is_used_and_an_old_one_is_not(world, monkeypatch):
    world.site.pages["/sitemap.xml"] = urlset("/", "/a", "/b", "/c", "/d", "/old", "/fresh")
    world.site.pages["/old"] = good("Old")
    world.site.pages["/fresh"] = good("Fresh")
    domain = store.get_or_create_domain(world.engine, "shop.example")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with world.engine.begin() as conn:
        for path, at, status in (("/fresh", now - timedelta(days=2), "gone"), ("/old", now - timedelta(days=9), "gone")):
            conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, last_status, http_status, last_checked_at) VALUES (:d, :u, :h, :s, 404, :t)"),
                         {"d": domain, "u": f"{ROOT}{path}", "h": store._url_hash(f"{ROOT}{path}"), "s": status, "t": at})
    found = card(world.run_test())
    asked = [urlsplit(u).path for u in world.site.requests]
    assert "/fresh" not in asked and asked.count("/old") == 1
    assert paths(found["listed_broken"]) == ["/fresh"]  # 2 days old: it stands; 9 days old: asked again, and it's fine now


def test_at_most_max_fetches_pages_are_asked_and_the_rest_are_counted(world, monkeypatch):
    monkeypatch.setattr(sitemaps, "MAX_FETCHES", 1)
    world.site.pages["/sitemap.xml"] = urlset("/", "/a", "/b", "/c", "/d", "/x", "/y")
    world.site.pages["/x"] = good("X")
    world.site.pages["/y"] = good("Y")
    data = world.run_test()
    assert data["sitemap"]["unchecked"] == 1
    asked = [urlsplit(u).path for u in world.site.requests]
    assert asked.count("/x") + asked.count("/y") == 1


def test_a_sitemap_step_out_of_time_carries_on_in_the_next_chunk(world, monkeypatch):
    known_site(world, monkeypatch)
    told = {"n": 0}

    def clock():
        # Out of time just as the sitemap step is about to ask its first page (/gone), twice in a row.
        def up():
            asked = [urlsplit(u).path for u in world.site.requests]
            if "/sitemap-more.xml" in asked and "/gone" not in asked and told["n"] < 2:
                told["n"] += 1
                return True
            return False
        return up

    monkeypatch.setattr(links, "time_up_factory", clock)
    saves = []
    real_save = health._save_chunk
    monkeypatch.setattr(health, "_save_chunk", lambda *args, **kw: (saves.append(args[-1] if len(args) > 7 else kw.get("sitemap_progress")), real_save(*args, **kw))[1])
    audit_id = world.start()
    for _ in range(6):
        world.tick()
        status = world.detail(audit_id)["audit"]["status"]
        if status not in ("queued", "running"):
            break
        world.sql("UPDATE jobs SET run_after = UTC_TIMESTAMP(3) WHERE status = 'queued'")
    data = world.detail(audit_id)
    assert data["audit"]["status"] == "complete"
    assert data["audit"]["score"] == 89  # the same answer as in one go
    assert any(saves), "the sitemap step itself paused and saved what it had learned"
    asked = [urlsplit(u).path for u in world.site.requests]
    assert asked.count("/gone") == 1 and asked.count("/popular") == 1  # nothing learned before the pause is asked again


# ---- the bell -------------------------------------------------------------------------------------------

def bell(world) -> list[dict]:
    return [i for i in world.client.get("/api/notifications").get_json()["items"] if i["kind"] == "sitemap_problem"]


def test_the_bell_rings_when_more_listed_pages_give_an_error(world):
    world.run_test()
    assert bell(world) == []  # nothing to compare with
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 1 HOUR")
    world.site.pages["/c"] = 404
    world.site.pages["/d"] = 410
    world.run_test()
    rung = bell(world)
    assert len(rung) == 1 and rung[0]["detail"]["state"] == "broken_up" and (rung[0]["detail"]["before"], rung[0]["detail"]["after"]) == (0, 2)
    assert rung[0]["title"] == "shop.example: 2 listed pages give an error, up from 0"
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 1 HOUR")
    world.run_test()
    assert len(bell(world)) == 1  # the same 2 again: no new news


def test_the_bell_rings_when_the_sitemap_can_no_longer_be_read(world):
    world.run_test()
    world.sql("UPDATE health_audits SET created_at = created_at - INTERVAL 1 HOUR")
    world.site.pages["/sitemap.xml"] = 500
    world.run_test()
    rung = bell(world)
    assert len(rung) == 1 and rung[0]["detail"]["state"] == "unreachable"
    assert rung[0]["title"] == "shop.example: the sitemap can't be read any more"


def test_a_healthy_site_with_its_sitemap_says_sitemap_ok(world):
    data = world.run_test()
    assert data["sitemap"]["problems"] == [] and data["sitemap"]["listed"] == 5 and data["sitemap"]["found"]
    assert data["audit"]["score"] == 100
