"""Competitors fixes of 2026-11-10 (reports/audit-2026-11-10): credits counted before a search and kept on a timeout,
Keyword check's repeat guard, Undo and plain sentences, the reader's oldest-first order and sitemap dates, a Firecrawl run
whose job dies, the small reading route, and the list endpoints' query counts. Made-up sites only."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import event, text

from seo.competitors import collective, crawl, firecrawl, pages as page_reader, probe, profile, reading
from seo.core.errors import Refused
from seo.serp import connections
from seo.serp.tools import TimedOut
from tests.test_competitor_reading import FakeFirecrawl, fc, full, key, js_site, state  # noqa: F401  (fixtures)
from tests.test_competitors_backend import FakeTool, add_rival, page_html, rows, scalar, sitemap_xml, world  # noqa: F401  (world is a fixture)


def tool(world, results=None, **kw):
    t = FakeTool(results=results or {"*": ["https://rival.example/a"]}, **kw)
    world.tools["google"] = [t]
    return t


class TimingOut(FakeTool):
    def search(self, keyword, engine, country, language, device, depth):
        self.calls.append(keyword)
        raise TimedOut("No answer in time.")


# ---- credits (F64, F15, F124) --------------------------------------------------------------------------

def test_keyword_check_books_a_search_before_it_runs_and_keeps_a_timeout_counted(world):
    slow = TimingOut(name="Slow Tool", free_monthly=10)
    world.tools["google"] = [slow]
    probe.add(world.engine, world.own, "a")
    probe.start(world.engine, world.own)
    world.drain("refresh")
    assert slow.calls == ["a"]
    assert connections.free_left(world.engine, slow) == 9  # it may have been charged, so it stays counted
    assert "may already have been charged" in scalar(world.engine, "SELECT error FROM serp_checks WHERE status = 'failed'")


def test_keyword_check_counts_a_good_search_once(world):
    t = tool(world, free_monthly=10)
    probe.add(world.engine, world.own, "a\nb")
    probe.start(world.engine, world.own)
    world.drain("refresh")
    assert len(t.calls) == 2 and connections.free_left(world.engine, t) == 8


def test_a_tool_that_fails_three_times_in_a_row_is_dropped_for_the_run(world):
    slow = TimingOut(name="Slow Tool", free_monthly=50)
    world.tools["google"] = [slow]
    probe.add(world.engine, world.own, "a\nb\nc\nd\ne")
    run = probe.start(world.engine, world.own)
    world.drain("refresh")
    assert len(slow.calls) == 3
    done = probe.run_dict(world.engine, run["id"])
    assert done["status"] == "waiting" and "failed 3 searches in a row" in done["reason"]


# ---- Keyword check: repeat guard, Undo, empty box (UX review B7, bugs 13 and 14) ---------------------------

def test_a_keyword_checked_minutes_ago_is_not_checked_again(world):
    t = tool(world, free_monthly=10)
    probe.add(world.engine, world.own, "a\nb")
    first = [k["id"] for k in probe.listing(world.engine, world.own)["keywords"] if k["keyword"] == "a"]
    probe.start(world.engine, world.own, first)
    world.drain("refresh")
    assert t.calls == ["a"]
    e = probe.estimate(world.engine, world.own, first)
    assert e["searches"] == 0 and e["recent"] == 1 and e["hours"] == 12
    with pytest.raises(Refused, match="checked in the last 12 hours"):
        probe.start(world.engine, world.own, first)
    every = probe.estimate(world.engine, world.own)
    assert every["searches"] == 1 and every["recent"] == 1
    probe.start(world.engine, world.own)
    world.drain("refresh")
    assert t.calls == ["a", "b"]  # Check all left out the one just checked


def test_the_guard_follows_the_setting_refresh_uses(world):
    t = tool(world)
    connections.save_setting(world.engine, "just_checked_hours", "0")
    probe.add(world.engine, world.own, "a")
    probe.start(world.engine, world.own)
    world.drain("refresh")
    probe.start(world.engine, world.own)
    world.drain("refresh")
    assert t.calls == ["a", "a"]


def test_remove_then_undo_puts_the_keyword_back_in_its_place(world):
    probe.add(world.engine, world.own, "first")
    probe.add(world.engine, world.own, "second")
    probe.add(world.engine, world.own, "third")
    before = [k["keyword"] for k in probe.listing(world.engine, world.own)["keywords"]]
    middle = next(k["id"] for k in probe.listing(world.engine, world.own)["keywords"] if k["keyword"] == "second")
    answer = probe.remove(world.engine, world.own, middle)
    assert [k["keyword"] for k in probe.listing(world.engine, world.own)["keywords"]] == ["third", "first"]
    probe.restore(world.engine, world.own, middle, answer["undo"]["place"])
    assert [k["keyword"] for k in probe.listing(world.engine, world.own)["keywords"]] == before


def test_the_routes_say_an_empty_box_in_words_and_undo_works(world):
    got = world.client.post("/api/keyword-check/keywords", json={"site_id": world.own, "keywords": "   "})
    assert got.status_code == 400 and got.get_json()["error"] == "Type at least one keyword, one on each line."
    got = world.client.post("/api/keyword-check/keywords", json={"site_id": world.own})
    assert got.get_json()["error"] == "Type at least one keyword, one on each line."
    world.client.post("/api/keyword-check/keywords", json={"site_id": world.own, "keywords": "kw"})
    kid = probe.listing(world.engine, world.own)["keywords"][0]["id"]
    gone = world.client.delete(f"/api/keyword-check/keywords/{kid}?site_id={world.own}").get_json()
    back = world.client.post(f"/api/keyword-check/keywords/{kid}/restore", json={"site_id": world.own, "place": gone["undo"]["place"]})
    assert back.status_code == 200 and len(probe.listing(world.engine, world.own)["keywords"]) == 1


def test_a_check_whose_job_is_gone_no_longer_shows_as_running(world):
    tool(world)
    probe.add(world.engine, world.own, "a")
    probe.start(world.engine, world.own)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET status = 'dead', active_key = NULL"))
        conn.execute(text("UPDATE probe_runs SET created_at = UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE"))
    run = probe.listing(world.engine, world.own)["run"]
    assert run["status"] == "complete" and "stopped before the end" in run["reason"]


# ---- the reader's order and sitemap dates (F62, F128, F69, F97) -------------------------------------------

def test_sitemap_dates_are_read_once_whatever_their_form():
    noon = datetime(2026, 11, 3, 12, 0)
    assert crawl._sitemap_date_is_newer("2026-11-03", noon)  # the same day: the edit may have come after the read
    assert not crawl._sitemap_date_is_newer("2026-11-02", noon)
    assert crawl._sitemap_date_is_newer("2026-11-03T13:00:00+00:00", noon)
    assert not crawl._sitemap_date_is_newer("2026-11-03T13:00:00+02:00", noon)  # 11:00 UTC
    assert not crawl._sitemap_date_is_newer("Tue, 03 Feb 2015 10:00:00 GMT", noon)  # compared as a date, not as text
    assert not crawl._sitemap_date_is_newer("whenever", noon)


def test_a_sitemap_that_stamps_every_page_with_one_day_says_nothing():
    same = {f"https://r.example/{n}": "2026-11-10" for n in range(30)}
    assert crawl._dates_say_nothing(same)
    varied = {f"https://r.example/{n}": f"2026-10-{n % 28 + 1:02d}" for n in range(30)}
    assert not crawl._dates_say_nothing(varied)
    assert not crawl._dates_say_nothing({f"https://r.example/{n}": "2026-11-10" for n in range(5)})  # too few to tell


def test_with_always_fresh_dates_the_longest_unread_pages_go_first(world, monkeypatch):
    from seo.crawl import store as crawl_store
    from seo.links import service as links

    monkeypatch.setattr(crawl, "PAGES_PER_DAY", 4)
    paths = [f"/p{n}" for n in range(30)]
    world.pages["rival.example/"] = page_html("Home")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(paths, date=datetime.now(timezone.utc).strftime("%Y-%m-%d"))  # "today" on every page
    rival = add_rival(world)
    domain = crawl_store.get_or_create_domain(world.engine, "rival.example")
    with world.engine.begin() as conn:
        for n, p in enumerate(paths):  # every page read before: p0 a day ago, p29 thirty days ago
            url = f"https://rival.example{p}"
            conn.execute(
                text("INSERT INTO pages (domain_id, url, url_hash, content_hash, last_status, last_checked_at) VALUES (:d, :u, :h, 'x', 'ok', UTC_TIMESTAMP(3) - INTERVAL :n DAY)"),
                {"d": domain, "u": url, "h": page_reader.url_hash(url), "n": n + 1},
            )
    site = rows(world.engine, "SELECT id, host, start_url, kind FROM sites WHERE id = :i", i=rival)[0]
    plan = crawl._plan(world.engine, rival, site, True, links.fetcher_factory(), lambda: None)
    # Before: the first pages in the sitemap, p0 to p3, every day, and p4 onwards never again (F62).
    assert [u for u, _new in plan["todo"]] == ["https://rival.example/", "https://rival.example/p29", "https://rival.example/p28", "https://rival.example/p27"]


def test_a_page_the_reader_chokes_on_is_saved_and_the_next_one_still_read(world, monkeypatch):
    world.pages["rival.example/"] = page_html("Home")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/bad", "/good"])
    world.pages["rival.example/bad"] = page_html("Bad")
    world.pages["rival.example/good"] = page_html("Good")
    real = page_reader.extract

    def picky(body, url, charset=None):
        if url.endswith("/bad"):
            raise ValueError("an odd character")
        return real(body, url, charset=charset)

    monkeypatch.setattr(page_reader, "extract", picky)
    rival = add_rival(world)
    world.drain("crawl")
    assert scalar(world.engine, "SELECT last_status FROM pages WHERE url = 'https://rival.example/bad'") == "parse_error"
    assert scalar(world.engine, "SELECT content_hash IS NOT NULL FROM pages WHERE url = 'https://rival.example/good'") == 1
    assert profile._crawl_state(world.engine.connect(), rival)["status"] == "ok"


# ---- Firecrawl: a run whose job dies (F61), a worker killed mid-chunk (F63), the reading route (F60) --------

def test_a_firecrawl_run_with_no_job_behind_it_shows_stopped_and_can_start_again(world, fc):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    firecrawl.start(world.engine, rival, "read")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET status = 'dead', active_key = NULL WHERE kind = 'competitors.firecrawl'"))
        conn.execute(text("UPDATE competitor_crawls SET fc_status = 'running' WHERE competitor_id = :c"), {"c": rival})
    shown = state(world, rival)["firecrawl"]
    assert shown["status"] == "failed" and "stopped before the end" in shown["message"]
    assert firecrawl.start(world.engine, rival, "read")["queued"] is True


def test_any_error_in_a_firecrawl_run_ends_it_as_failed(world, fc, monkeypatch):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    monkeypatch.setattr(firecrawl, "_save", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("database hiccup")))
    firecrawl.start(world.engine, rival, "read")
    world.drain("collectors")
    assert scalar(world.engine, "SELECT fc_status FROM competitor_crawls WHERE competitor_id = :c", c=rival) == "failed"


def test_pages_read_before_a_worker_died_are_not_paid_again(world, fc):
    js_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    for url in ("https://rival.example/", "https://rival.example/a", "https://rival.example/b"):
        fc.rendered[url] = full("Real")
    firecrawl.start(world.engine, rival, "read")
    payload = rows(world.engine, "SELECT payload FROM jobs WHERE kind = 'competitors.firecrawl'")[0]["payload"]
    world.drain("collectors")
    paid = fc.calls.count("/v2/scrape")
    # The host kills the worker and the job comes back with the payload it started with.
    import json
    from seo.worker import queue
    queue.enqueue(world.engine, firecrawl.LANE, firecrawl.JOB_KIND, payload=json.loads(payload) if isinstance(payload, str) else payload, dedupe_key=f"firecrawl:{rival}:again")
    world.drain("collectors")
    assert fc.calls.count("/v2/scrape") == paid


def test_the_reading_route_answers_only_the_read(world):
    rival = add_rival(world)
    got = world.client.get(f"/api/competitors/{rival}/reading?site_id={world.own}")
    body = got.get_json()
    assert got.status_code == 200 and set(body) == {"id", "tracking", "crawl"} and body["tracking"] == "on"
    assert world.client.get(f"/api/competitors/999999/reading?site_id={world.own}").status_code == 404


# ---- query counts (F85, F77) --------------------------------------------------------------------------------

def _count(world, path):
    seen = {"n": 0}
    listen = lambda *a, **k: seen.__setitem__("n", seen["n"] + 1)  # noqa: E731
    world.client.get(path)
    event.listen(world.engine, "before_cursor_execute", listen)
    try:
        assert world.client.get(path).status_code == 200
    finally:
        event.remove(world.engine, "before_cursor_execute", listen)
    return seen["n"]


def test_the_list_endpoints_ask_the_same_number_of_queries_for_2_or_12_competitors(world):
    for n in range(2):
        add_rival(world, f"few-{n}.example")
    few = {p: _count(world, f"/api/{p}") for p in (f"competitors?site_id={world.own}", f"collective/rivals?site_id={world.own}", f"collective/moves?site_id={world.own}")}
    for n in range(10):
        add_rival(world, f"many-{n}.example")
    many = {p: _count(world, f"/api/{p}") for p in few}
    assert many == few, (few, many)


def test_page_pairs_read_their_pages_in_one_go(world):
    rival = add_rival(world)
    with world.engine.begin() as conn:
        for n in range(12):
            conn.execute(
                text("INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, source, hidden) VALUES (:s, :c, :m, :h, :t, 'manual', 0)"),
                {"s": world.own, "c": rival, "m": f"https://me.example/p{n}", "h": f"h{n}", "t": f"https://rival.example/p{n}"},
            )
    twelve = _count(world, f"/api/page-pairs?site_id={world.own}")
    with world.engine.begin() as conn:
        conn.execute(text("DELETE FROM page_pairs WHERE my_url_hash NOT IN ('h0', 'h1')"))
    assert _count(world, f"/api/page-pairs?site_id={world.own}") == twelve


def test_collective_moves_still_lists_the_newest_page_changes_across_rivals(world):
    one, two = add_rival(world, "one.example"), add_rival(world, "two.example")
    from seo.crawl import store as crawl_store
    with world.engine.begin() as conn:
        for host, minutes in (("one.example", 30), ("two.example", 10)):
            domain = crawl_store.get_or_create_domain(world.engine, host)
            url = f"https://{host}/x"
            conn.execute(text("INSERT IGNORE INTO pages (domain_id, url, url_hash) VALUES (:d, :u, :h)"), {"d": domain, "u": url, "h": page_reader.url_hash(url)})
            page = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar()
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, 'title', 'a', 'b', UTC_TIMESTAMP(3) - INTERVAL :m MINUTE)"), {"p": page, "d": domain, "m": minutes})
    out = collective.moves(world.engine, world.own)
    assert [m["rival"]["host"] for m in out["moves"]][:2] == ["two.example", "one.example"] and out["total"] == 2


def test_a_new_page_whose_first_read_failed_is_still_reported_new(world):
    world.pages["rival.example/"] = page_html("Home")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/a"])
    world.pages["rival.example/a"] = page_html("A")
    rival = add_rival(world)
    world.drain("crawl")  # the first read only sets the starting point
    from seo.competitors import suggest
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(["/a", "/fresh"])
    world.pages["rival.example/fresh"] = 503
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE competitor_crawls SET finished_at = NULL"))
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    assert scalar(world.engine, "SELECT content_hash IS NULL FROM pages WHERE url = 'https://rival.example/fresh'") == 1
    world.pages["rival.example/fresh"] = page_html("Fresh")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE competitor_crawls SET finished_at = NULL"))
        conn.execute(text("UPDATE pages SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 1 DAY"))
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    assert scalar(world.engine, "SELECT COUNT(*) FROM change_events WHERE kind = 'new_page'") == 1  # F69


def test_every_sites_prospects_come_in_one_request(world):
    from seo.competitors import gaps
    from tests.test_competitors_backend import second_site
    other = second_site(world)
    other_id = other if isinstance(other, int) else other["id"]
    gaps.add_csv_prospects(world.engine, world.own, [{"url": "https://links-one.example/a"}], "a.csv", None)
    gaps.add_csv_prospects(world.engine, other_id, [{"url": "https://links-two.example/b"}], "b.csv", None)
    rows = world.client.get("/api/prospects").get_json()["prospects"]
    assert {(r["site_id"], r["domain"]) for r in rows} == {(world.own, "links-one.example"), (other_id, "links-two.example")}
    assert [r["domain"] for r in world.client.get(f"/api/prospects?site_id={world.own}").get_json()["prospects"]] == ["links-one.example"]
