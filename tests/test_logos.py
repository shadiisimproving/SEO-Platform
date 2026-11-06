"""A site's icon is fetched once by our own server and kept, so a list of backlinks never goes to anyone else."""
import base64

import httpx
import pytest
from sqlalchemy import text

from seo.backlinks import logos
from seo.competitors import gaps, suggest
from seo.crawl.fetch import PoliteFetcher
from seo.links import service as links
from seo.web import create_app
from seo.worker.runner import tick

ALLOW = lambda url: True  # noqa: E731
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
ICO = b"\x00\x00\x01\x00\x01\x00" + b"\x00" * 40
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>'


def home(*links_in_head):
    return "<html><head><title>A site</title>" + "".join(links_in_head) + "</head><body><p>Hello</p></body></html>"


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    sites = {}
    requests = []

    def internet(request):
        requests.append(str(request.url))
        key = f"{request.url.host.removeprefix('www.')}{request.url.path}"
        found = sites.get(key)
        if key.endswith("/robots.txt") and found is None:
            return httpx.Response(404)
        if found is None:
            return httpx.Response(404, text="nope")
        if isinstance(found, int):
            return httpx.Response(found, text="no")
        if isinstance(found, bytes):
            return httpx.Response(200, content=found, headers={"content-type": "application/octet-stream"})
        return httpx.Response(200, html=found)

    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=ALLOW, transport=httpx.MockTransport(internet)))

    class World:
        pass

    w = World()
    w.engine, w.sites, w.requests = engine, sites, requests
    w.client = create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client()
    w.run = lambda: tick(engine, "crawl", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    return w


def fetched(world, domain):
    logos.queue_for(world.engine, [domain])
    world.run()
    with world.engine.connect() as conn:
        return conn.execute(text("SELECT status, content_type, image, source_url FROM site_logos WHERE domain = :d"), {"d": domain}).mappings().first()


def test_the_icon_a_page_names_is_kept(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/brand/icon.png">')
    world.sites["a.example/brand/icon.png"] = PNG
    row = fetched(world, "a.example")
    assert row["status"] == "found" and row["content_type"] == "image/png" and bytes(row["image"]) == PNG
    assert row["source_url"] == "https://a.example/brand/icon.png"


def test_the_clearest_icon_is_chosen(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/small.png" sizes="16x16">', '<link rel="icon" href="/big.png" sizes="192x192">', '<link rel="apple-touch-icon" href="/touch.png" sizes="180x180">')
    world.sites["a.example/big.png"] = PNG
    assert fetched(world, "a.example")["source_url"].endswith("/big.png")


def test_a_broken_icon_falls_back_to_the_next(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/missing.png" sizes="192x192">', '<link rel="shortcut icon" href="/other.ico">')
    world.sites["a.example/other.ico"] = ICO
    row = fetched(world, "a.example")
    assert row["status"] == "found" and row["content_type"] == "image/x-icon"


def test_a_site_naming_no_icon_uses_the_usual_address(world):
    world.sites["a.example/"] = home()
    world.sites["a.example/favicon.ico"] = ICO
    assert fetched(world, "a.example")["status"] == "found"


def test_an_icon_written_inside_the_page_is_read(world):
    world.sites["a.example/"] = home(f'<link rel="icon" href="data:image/png;base64,{base64.b64encode(PNG).decode()}">')
    row = fetched(world, "a.example")
    assert row["status"] == "found" and bytes(row["image"]) == PNG


def test_a_page_answering_instead_of_an_image_isnt_kept(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/soft-404">')
    world.sites["a.example/soft-404"] = "<html><body>Sorry, not found</body></html>"
    row = fetched(world, "a.example")
    assert row["status"] == "none" and row["image"] is None


def test_a_huge_file_isnt_kept(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/huge.png">')
    world.sites["a.example/huge.png"] = PNG + b"\x00" * (logos.MAX_BYTES + 1)
    assert fetched(world, "a.example")["status"] == "none"


def test_a_site_with_nothing_is_fine(world):
    assert fetched(world, "gone.example")["status"] == "none"


def test_an_icon_is_only_fetched_once(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/i.png">')
    world.sites["a.example/i.png"] = PNG
    fetched(world, "a.example")
    world.requests.clear()
    logos.queue_for(world.engine, ["a.example"])
    world.run()
    assert world.requests == []


def test_a_site_with_no_icon_isnt_asked_again_for_a_month(world):
    fetched(world, "gone.example")
    world.requests.clear()
    logos.queue_for(world.engine, ["gone.example"])
    world.run()
    assert world.requests == []
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_logos SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 40 DAY"))
    world.sites["gone.example/"] = home('<link rel="icon" href="/i.png">')
    world.sites["gone.example/i.png"] = PNG
    assert fetched(world, "gone.example")["status"] == "found"


def test_robots_rules_still_apply(world):
    world.sites["a.example/robots.txt"] = "User-agent: *\nDisallow: /\n"
    world.sites["a.example/"] = home('<link rel="icon" href="/i.png">')
    world.sites["a.example/favicon.ico"] = ICO
    assert fetched(world, "a.example")["status"] == "none"
    assert not any(url.endswith(("/i.png", "/favicon.ico")) for url in world.requests)


def test_requests_count_in_the_daily_budget(world):
    from seo.core import budget

    world.sites["a.example/"] = home('<link rel="icon" href="/i.png">')
    world.sites["a.example/i.png"] = PNG
    fetched(world, "a.example")
    assert budget.used_today(world.engine) >= 2


def test_nothing_is_fetched_with_no_budget_left(world, monkeypatch):
    monkeypatch.setattr(logos.budget, "has_room", lambda engine, limit=0: False)
    logos.queue_for(world.engine, ["a.example"])
    world.run()
    assert world.requests == []


def test_many_sites_carry_on_in_a_new_job(world, monkeypatch):
    monkeypatch.setattr(logos, "CHUNK_SECONDS", 0.0)  # each job stops after its first site
    for name in ("a", "b", "c"):
        world.sites[f"{name}.example/favicon.ico"] = ICO
        world.sites[f"{name}.example/"] = home()
    logos.queue_for(world.engine, ["a.example", "b.example", "c.example"])
    world.run()
    assert sorted(logos.known(world.engine)) == ["a.example", "b.example", "c.example"]


def test_a_blank_or_odd_domain_is_ignored(world):
    logos.queue_for(world.engine, ["", "  ", "not a domain", "http://x", None])
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM site_logos")).scalar() == 0


# ---- what the screens get ------------------------------------------------------------------------

def test_the_screen_asks_which_logos_exist(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/i.png">')
    world.sites["a.example/i.png"] = PNG
    fetched(world, "a.example")
    fetched(world, "gone.example")
    assert world.client.get("/api/logos").get_json() == {"domains": ["a.example"]}


def test_an_icon_is_served_as_an_image(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/i.png">')
    world.sites["a.example/i.png"] = PNG
    fetched(world, "a.example")
    reply = world.client.get("/api/logos/a.example")
    assert reply.status_code == 200 and reply.data == PNG and reply.mimetype == "image/png"
    assert reply.headers["X-Content-Type-Options"] == "nosniff"


def test_an_svg_can_never_run_its_script(world):
    world.sites["a.example/"] = home('<link rel="icon" href="/i.svg">')
    world.sites["a.example/i.svg"] = SVG
    assert fetched(world, "a.example")["content_type"] == "image/svg+xml"
    reply = world.client.get("/api/logos/a.example")
    assert "sandbox" in reply.headers["Content-Security-Policy"] and "default-src 'none'" in reply.headers["Content-Security-Policy"]


def test_a_domain_with_no_logo_answers_not_found(world):
    assert world.client.get("/api/logos/nothing.example").status_code == 404


# ---- when an icon is asked for ---------------------------------------------------------------------

def pending(world):
    with world.engine.connect() as conn:
        return sorted(row[0] for row in conn.execute(text("SELECT domain FROM site_logos WHERE status = 'pending'")))


def test_adding_a_backlink_asks_for_its_icon(world):
    own = links.add_site(world.engine, "https://me.example/", "own", is_allowed=ALLOW)["id"]
    gaps.log_backlink(world.engine, own, "https://blog.some-site.example/post", "live")
    assert pending(world) == ["some-site.example"]  # the site's, not the page's or the subdomain's


def test_adding_a_competitor_asks_for_its_icon(world):
    own = links.add_site(world.engine, "https://me.example/", "own", is_allowed=ALLOW)["id"]
    suggest.add_competitor(world.engine, own, "https://rival.example/", "manual", ALLOW)
    assert pending(world) == ["rival.example"]


def test_adding_a_prospect_asks_for_its_icon(world):
    own = links.add_site(world.engine, "https://me.example/", "own", is_allowed=ALLOW)["id"]
    rival = suggest.add_competitor(world.engine, own, "rival.example", "manual", ALLOW)["id"]
    gaps.import_referrers(world.engine, own, rival, b"Source url,Toxic score\nhttps://good-site.example/a,1\n", "x.csv")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'good'"))
        conn.execute(text("DELETE FROM site_logos"))
    gaps.add_to_prospects(world.engine, own, ["good-site.example"])
    assert pending(world) == ["good-site.example"]


def test_a_domain_that_passes_the_spam_check_gets_its_icon_but_spam_does_not(world):
    own = links.add_site(world.engine, "https://me.example/", "own", is_allowed=ALLOW)["id"]
    rival = suggest.add_competitor(world.engine, own, "rival.example", "manual", ALLOW)["id"]
    world.sites["fine.example/"] = "<html><head><title>Fine</title><link rel='icon' href='/i.png'></head><body><main><p>" + "A real site about coffee. " * 20 + "</p></main></body></html>"
    world.sites["fine.example/i.png"] = PNG
    world.sites["gamble.example/"] = "<html><head><title>Online casino</title><link rel='icon' href='/i.png'></head><body><p>Play</p></body></html>"
    world.sites["gamble.example/i.png"] = PNG
    gaps.import_referrers(world.engine, own, rival, b"Source url,Toxic score\nhttps://fine.example/a,1\nhttps://gamble.example/b,1\n", "x.csv")
    world.run()
    world.run()
    assert logos.known(world.engine) == ["fine.example"]


def test_an_accented_domain_gets_its_icon_under_either_spelling(world):
    ascii_name = "café-du-matin.example".encode("idna").decode()
    # httpx hands the fake internet the host as people read it, whatever went over the wire.
    world.sites["café-du-matin.example/"] = home('<link rel="icon" href="/i.png">')
    world.sites["café-du-matin.example/i.png"] = PNG
    logos.queue_for(world.engine, ["café-du-matin.example"])
    world.run()
    assert logos.known(world.engine) == [ascii_name]
    # The screens write a domain as people read it, so the list and the image answer to both spellings.
    assert set(world.client.get("/api/logos").get_json()["domains"]) == {ascii_name, "café-du-matin.example"}
    assert world.client.get("/api/logos/café-du-matin.example").data == PNG
    assert world.client.get(f"/api/logos/{ascii_name}").data == PNG


def test_adding_a_site_asks_for_its_icon(engine):
    app = create_app(engine=engine, url_allowed=lambda _: True, auth=False)
    assert app.test_client().post("/api/sites", json={"address": "https://www.icon.example/", "kind": "own"}).status_code == 201
    with engine.connect() as conn:
        assert conn.execute(text("SELECT status FROM site_logos WHERE domain = 'icon.example'")).scalar() == "pending"
        assert conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = 'logos.fetch'")).scalar() == 1
