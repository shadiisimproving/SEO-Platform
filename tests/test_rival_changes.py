"""Who passed me and what they changed: the rival pages above mine on a page-1 search are read again and compared with an
earlier copy (stored, then the Wayback Machine, then none). Made-up sites only, on a fake internet."""
import json
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.competitors import history, pages, rival_changes
from seo.crawl import diff
from seo.crawl.extract import extract
from seo.crawl.fetch import PoliteFetcher
from seo.links import service as links_service
from tests.ui import fake_google

ME = "shop-one.test"
MY_URL = f"https://{ME}/guide/"
RIVAL = "rival-guide.test"
OLD_DAY = fake_google.RIVAL_CHANGED_ON - timedelta(days=5)


class Internet:
    """The rival's site and mine, as they are on `day`, plus the fake Wayback Machine. Every request is noted."""

    def __init__(self):
        self.day = date.today()
        self.asked: list[str] = []

    def site(self, request: httpx.Request) -> httpx.Response:
        self.asked.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if request.url.host == ME:
            return httpx.Response(200, html="<html><head><title>My guide 2025</title></head><body><main><h1>My guide</h1><h2>Costs</h2><p>" + "word " * 400 + "</p></main></body></html>")
        if request.url.host.endswith(RIVAL) or request.url.host.endswith("other-rival.test") or request.url.host.endswith("paused.test"):
            return httpx.Response(200, html=fake_google.rival_html(self.day))
        return httpx.Response(404)

    def archive(self, request: httpx.Request) -> httpx.Response:
        self.asked.append(str(request.url))
        return fake_google._answer(request)


@pytest.fixture
def net(monkeypatch):
    world = Internet()
    monkeypatch.setattr(links_service, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(world.site)))
    monkeypatch.setattr(history, "transport", httpx.MockTransport(world.archive))
    monkeypatch.setattr(history, "is_allowed", lambda url: url.startswith("https://web.archive.org/"))
    monkeypatch.setattr(history, "capture_lookup", history.read_capture)
    return world


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'own')"), {"h": ME, "u": f"https://{ME}/"}).lastrowid


def competitor(engine, site_id, host=RIVAL, tracking="on"):
    with engine.begin() as conn:
        rid = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'competitor')"), {"h": host, "u": f"https://{host}/"}).lastrowid
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source, tracking) VALUES (:s, :r, 'manual', :t)"), {"s": site_id, "r": rid, "t": tracking})
    return rid


def stamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def finding(engine, site_id, above, kind="rival_passed", was=3, now=5, before_checked=None, key="f1", stake=10.0):
    checked = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=2)
    evidence = {
        "keyword_id": None, "scraped": now, "was": was, "depth": 10, "checked": stamp(checked), "my_url": MY_URL,
        "before_checked": stamp(before_checked) if before_checked else stamp(datetime.combine(OLD_DAY + timedelta(days=1), datetime.min.time())),
        "above": [{"position": p, "url": u, "host": u.split("/")[2], "before": b} for p, u, b in above],
    }
    with engine.begin() as conn:
        return conn.execute(
            text("INSERT INTO search_findings (site_id, kind, grp, finding_key, query, page, severity, at_stake, evidence, data_through) VALUES (:s, :k, 'mix', :key, 'company setup', :p, 'normal', :a, :e, '2026-11-01')"),
            {"s": site_id, "k": kind, "key": key, "p": MY_URL, "a": stake, "e": json.dumps(evidence)},
        ).lastrowid


def rows_of(engine, finding_id):
    with engine.connect() as conn:
        return [dict(r) | {"diff": json.loads(r["diff"]) if isinstance(r["diff"], str) else r["diff"]} for r in conn.execute(text("SELECT * FROM rival_page_changes WHERE finding_id = :f ORDER BY id"), {"f": finding_id}).mappings().all()]


def cdx_asks(net):
    return [u for u in net.asked if "/cdx/search/cdx" in u]


# ---- the structured diff ------------------------------------------------------------------------


def _both():
    old = extract(fake_google.rival_html(OLD_DAY).encode(), fake_google.RIVAL_URL)
    new = extract(fake_google.rival_html(fake_google.RIVAL_CHANGED_ON).encode(), fake_google.RIVAL_URL)
    return old, new


def test_the_diff_says_what_a_rewrite_changed_field_by_field():
    old, new = _both()
    got = diff.compare(old.as_dict(), old.text, new.as_dict(), new.text)
    assert got["changed"] is True
    assert got["title"] == {"before": "Company setup guide 2025", "after": "Company setup guide 2026"}
    assert got["meta"]["after"] == "Everything about company setup in 2026."
    assert got["h1"] == {"before": "Company setup guide 2025", "after": "Company setup guide 2026"}
    assert got["headings"]["added"] == ["Visa options", "What does it cost?"] and got["headings"]["removed"] == []
    assert got["words"]["after"] > got["words"]["before"]
    assert got["years"] == {"before": [2025], "after": [2026]}
    assert got["questions"]["added"] == ["What does it cost?"] and got["questions"]["after"] == 2
    assert got["schema"] == {"added": ["FAQPage"], "removed": []}
    assert got["internal_links"] == {"before": 1, "after": 2} and got["external_links"] == {"before": 0, "after": 1}
    assert got["modified"] == {"before": "2025-10-01", "after": "2026-11-01"} and "published" not in got
    assert any("residence visa" in line for line in got["sections"]["added"])


def test_headings_removed_and_nothing_changed():
    old, new = _both()
    back = diff.compare(new.as_dict(), new.text, old.as_dict(), old.text)
    assert back["headings"]["removed"] == ["Visa options", "What does it cost?"] and back["schema"]["removed"] == ["FAQPage"]
    assert diff.compare(old.as_dict(), old.text, old.as_dict(), old.text) == {"changed": False}
    assert diff.compare(None, "", old.as_dict(), old.text) == {"changed": False}


def test_years_leave_prices_and_numbers_out():
    assert diff.years_in("From 4,000 a year in 2026", "1,2025 €, 3.2026 and 12020", "since 1999") == [1999, 2026]
    assert diff.years_in(f"Guide {date.today().year + 5}") == []


def test_card_rows_put_the_strongest_first_with_my_value_beside():
    old, new = _both()
    changes = diff.compare(old.as_dict(), old.text, new.as_dict(), new.text)
    mine = diff.facts({"title": "My guide 2025", "headings": [["h2", "Costs"]], "word_count": 400, "schema_types": ["Article"], "extras": {"questions": []}})
    shown, more = diff.rows(changes, mine)
    assert [r["field"] for r in shown] == ["title", "years", "words", "headings", "questions", "sections"] and more == 6
    assert shown[0]["mine"] == "My guide 2025" and shown[1]["mine"] == [2025] and shown[2]["mine"] == 400 and shown[3]["mine"] == 1 and shown[4]["mine"] == 0
    now, _ = diff.now_rows(diff.facts(new.as_dict(), new.text), mine)
    assert now[0] == {"field": "title", "before": None, "after": "Company setup guide 2026", "mine": "My guide 2025"}


# ---- which earlier copy: stored, then Wayback, then none ----------------------------------------


def test_the_stored_copy_from_before_my_drop_comes_first(engine, site, net):
    rid = competitor(engine, site)
    net.day = OLD_DAY
    fetcher = links_service.fetcher_factory()
    pages.read_page(engine, fake_google.RIVAL_URL, RIVAL, fetcher)
    with engine.begin() as conn:  # that read was on OLD_DAY
        conn.execute(text("UPDATE page_versions SET taken_at = :t"), {"t": datetime.combine(OLD_DAY, datetime.min.time())})
        conn.execute(text("UPDATE pages SET last_checked_at = :t"), {"t": datetime.combine(OLD_DAY, datetime.min.time())})
    net.day = date.today()
    fid = finding(engine, site, [(2, fake_google.RIVAL_URL, 6)], was=3, now=5)
    net.asked.clear()
    assert rival_changes.run_site(engine, site)["done"] == 1
    row = rows_of(engine, fid)[0]
    assert row["before_source"] == "stored" and row["before_at"].date() == OLD_DAY and row["read_count"] == 2  # theirs and mine
    assert row["diff"]["changes"]["title"]["after"] == "Company setup guide 2026" and not cdx_asks(net)
    panel = rival_changes.for_finding(engine, fid)
    card = panel["cards"][0]
    assert panel["status"] == "ready" and card["competitor_id"] == rid and card["passed"] is True and card["position"] == {"before": 6, "now": 2}
    assert card["changed"] is True and card["rows"][0]["field"] == "title" and card["rows"][0]["mine"] == "My guide 2025"


def test_without_a_stored_copy_the_wayback_machine_is_asked(engine, site, net):
    competitor(engine, site)
    fid = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], before_checked=datetime(2026, 1, 15))
    rival_changes.run_site(engine, site)
    row = rows_of(engine, fid)[0]
    assert row["before_source"] == "wayback" and row["before_at"] == datetime(2025, 10, 20, 12, 0) and row["wanted_before"] == date(2026, 1, 15)
    assert row["diff"]["changes"]["years"] == {"before": [2025], "after": [2026]}
    assert "text" not in row["diff"]["before_fields"]  # the archive's copy itself is never kept
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM page_versions")).scalar() == 2  # theirs now and mine: no version from the archive
    assert any("20251020120000id_/" in u for u in net.asked)


def test_with_neither_the_card_says_what_they_have_now(engine, site, net):
    competitor(engine, site)
    fid = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], before_checked=datetime(2025, 1, 15))  # before the archive's only copy
    rival_changes.run_site(engine, site)
    row = rows_of(engine, fid)[0]
    assert row["before_source"] == "none" and row["before_at"] is None and row["diff"]["note"] == "no_copy"
    card = rival_changes.for_finding(engine, fid)["cards"][0]
    assert card["before_source"] == "none" and card["changed"] is None and card["rows"][0] == {"field": "title", "before": None, "after": "Company setup guide 2026", "mine": "My guide 2025"}


def test_wayback_is_asked_once_per_page_and_day(engine, site, net):
    competitor(engine, site)
    day = datetime(2026, 1, 15)
    first = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], before_checked=day, key="a")
    second = finding(engine, site, [(1, fake_google.RIVAL_URL, None)], before_checked=day, key="b")
    rival_changes.run_site(engine, site)
    assert len(cdx_asks(net)) == 1
    with engine.begin() as conn:  # a new check: both are looked at again, and the archive isn't asked again
        conn.execute(text("UPDATE rival_page_changes SET after_at = after_at - INTERVAL 1 DAY"))
    rival_changes.run_site(engine, site)
    assert len(cdx_asks(net)) == 1
    assert all(rows_of(engine, f)[0]["before_source"] == "wayback" for f in (first, second))
    assert rows_of(engine, second)[0]["diff"]["changes"]["title"]["before"] == "Company setup guide 2025"


def test_a_wayback_failure_is_no_copy_and_not_asked_again_that_day(engine, site, net, monkeypatch):
    competitor(engine, site)
    calls = []

    def busy(url, day):
        calls.append(url)
        raise history.HistoryFailed("http_503")

    monkeypatch.setattr(history, "capture_lookup", busy)
    fid = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], before_checked=datetime(2026, 1, 15))
    rival_changes.run_site(engine, site)
    with engine.begin() as conn:
        conn.execute(text("UPDATE rival_page_changes SET after_at = after_at - INTERVAL 1 DAY"))
    rival_changes.run_site(engine, site)
    assert len(calls) == 1 and rows_of(engine, fid)[0]["diff"]["note"] == "wayback_failed"


# ---- limits ---------------------------------------------------------------------------------------


def test_a_page_read_today_is_not_read_again(engine, site, net):
    competitor(engine, site)
    first = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], key="a")
    second = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], key="b")
    rival_changes.run_site(engine, site)
    reads = [u for u in net.asked if RIVAL in u and "robots" not in u and "archive" not in u]
    assert len(reads) == 1 and rows_of(engine, first)[0]["read_count"] == 2 and rows_of(engine, second)[0]["read_count"] == 0


def test_the_daily_read_limit_leaves_the_rest_waiting(engine, site, net, monkeypatch):
    competitor(engine, site)
    monkeypatch.setattr(rival_changes, "READS_PER_DAY", 3)
    urls = [f"https://{RIVAL}/page-{n}/" for n in range(4)]
    fid = finding(engine, site, [(n + 1, u, None) for n, u in enumerate(urls)], now=6)
    got = rival_changes.run_site(engine, site)
    assert got["done"] == 2 and got["waiting"] == 2  # mine and two of theirs
    with engine.connect() as conn:
        assert rival_changes.reads_today(conn, site) == 3
    panel = rival_changes.for_finding(engine, fid)
    assert panel["status"] == "waiting" and [c["read"] for c in panel["cards"]] == [True, True, False, False]
    assert rival_changes.run_site(engine, site)["done"] == 0  # nothing left today


def test_thirty_reads_a_day_by_default(engine, site, net):
    competitor(engine, site)
    old = finding(engine, site, [(1, f"https://{RIVAL}/x/", None)], key="old")
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO rival_page_changes (site_id, finding_id, rival_url, rival_url_hash, host, read_at, read_count) VALUES (:s, :f, 'https://rival-guide.test/y/', 'y', 'rival-guide.test', UTC_TIMESTAMP(3), 30)"),
            {"s": site, "f": old},
        )
    finding(engine, site, [(2, fake_google.RIVAL_URL, None)], key="new")
    assert rival_changes.READS_PER_DAY == 30 and rival_changes.run_site(engine, site)["waiting"] == 2 and net.asked == []  # both findings' pages wait for tomorrow


def test_at_most_five_rival_pages_per_finding_those_that_passed_me_first(engine, site, net):
    competitor(engine, site)
    above = [(n + 1, f"https://{RIVAL}/p{n}/", 1) for n in range(5)] + [(6, f"https://{RIVAL}/passed-a/", None), (7, f"https://{RIVAL}/passed-b/", 9)]
    fid = finding(engine, site, above, was=3, now=8)
    rival_changes.run_site(engine, site)
    cards = rival_changes.for_finding(engine, fid)["cards"]
    assert len(cards) == 5 and [c["url"] for c in cards[:2]] == [f"https://{RIVAL}/passed-a/", f"https://{RIVAL}/passed-b/"]
    assert len(rows_of(engine, fid)) == 5


def test_off_rivals_are_never_read_and_pages_only_rivals_are(engine, site, net):
    competitor(engine, site, "paused.test", tracking="off")
    competitor(engine, site, "other-rival.test", tracking="pages")
    fid = finding(engine, site, [(1, "https://paused.test/guide/", None), (2, "https://other-rival.test/guide/", None)])
    rival_changes.run_site(engine, site)
    assert not any("paused.test" in u for u in net.asked) and any("other-rival.test/guide/" in u for u in net.asked)
    panel = rival_changes.for_finding(engine, fid)
    assert [c["host"] for c in panel["cards"]] == ["other-rival.test"] and panel["cards"][0]["tracking"] == "pages"
    assert panel["not_followed"][0]["host"] == "paused.test" and panel["not_followed"][0]["tracking"] == "off"


def test_a_rival_turned_off_after_the_finding_is_not_read(engine, site, net):
    rid = competitor(engine, site)
    fid = finding(engine, site, [(2, fake_google.RIVAL_URL, None)])
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_competitors SET tracking = 'off' WHERE competitor_id = :c"), {"c": rid})
    rival_changes.run_site(engine, site)
    assert net.asked == [] and rows_of(engine, fid) == []


def test_sites_above_me_not_followed_are_listed_never_read(engine, site, net):
    competitor(engine, site)
    fid = finding(engine, site, [(1, "https://stranger.test/a", None), (2, fake_google.RIVAL_URL, None)])
    rival_changes.run_site(engine, site)
    assert not any("stranger.test" in u for u in net.asked)
    panel = rival_changes.for_finding(engine, fid)
    assert panel["not_followed"] == [{"host": "stranger.test", "url": "https://stranger.test/a", "position": {"before": None, "now": 1}, "competitor_id": None, "tracking": None}]


def test_only_page_one_moves_count(engine, site, net):
    competitor(engine, site)
    fid = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], kind="rank_drop", was=14, now=18)
    other = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], kind="rival_gap", was=3, now=5, key="gap")
    assert rival_changes.run_site(engine, site)["done"] == 0 and net.asked == []
    assert rival_changes.for_finding(engine, fid)["applies"] is False and rival_changes.for_finding(engine, other)["cards"] == []
    near = finding(engine, site, [(2, fake_google.RIVAL_URL, None)], kind="rank_drop", was=9, now=15, key="near")
    rival_changes.run_site(engine, site)
    assert rival_changes.for_finding(engine, near)["status"] == "ready"


def test_one_job_per_site_and_its_handler_runs(engine, site, net):
    from seo.worker.runner import tick

    competitor(engine, site)
    fid = finding(engine, site, [(2, fake_google.RIVAL_URL, None)])
    assert rival_changes.enqueue_for_site(engine, site) is not None and rival_changes.enqueue_for_site(engine, site) is None
    assert rival_changes.for_finding(engine, fid)["status"] == "reading"
    tick(engine, rival_changes.LANE, budget_seconds=20, db_wait_seconds=1)
    assert rival_changes.for_finding(engine, fid)["status"] == "ready"


# ---- the route --------------------------------------------------------------------------------------


def test_the_route_gives_the_panel_its_cards(engine, site, net):
    from seo.web import create_app

    competitor(engine, site)
    fid = finding(engine, site, [(1, "https://stranger.test/a", None), (2, fake_google.RIVAL_URL, 7)], before_checked=datetime(2026, 1, 15))
    rival_changes.run_site(engine, site)
    client = create_app(engine=engine, auth=False).test_client()
    got = client.get(f"/api/insights/{fid}/rivals").get_json()
    assert set(got) == {"finding_id", "kind", "keyword", "applies", "me", "status", "cards", "not_followed"}
    assert got["me"] == {"url": MY_URL, "before": 3, "now": 5} and got["status"] == "ready" and got["keyword"] == "company setup"
    card = got["cards"][0]
    assert set(card) == {"host", "url", "competitor_id", "tracking", "position", "passed", "read", "before_source", "before_at", "after_at", "changed", "unreadable", "note", "rows", "more", "extra"}
    assert card["before_source"] == "wayback" and card["before_at"] == "2025-10-20T12:00:00Z" and card["after_at"].endswith("Z")
    assert 1 <= len(card["rows"]) <= 6 and all("mine" in r for r in card["rows"])
    assert client.get("/api/insights/999999/rivals").status_code == 404


# ---- what the insights run gives this step ------------------------------------------------------------


def test_mix_lists_every_site_above_me_with_pages_only_rivals_followed(engine):
    from tests.test_insights import END, FRESH  # noqa: F401 - the same made-up data days as the other insights tests
    from tests.test_insights_mix import check, keyword, mine, search_console, signals

    with engine.begin() as conn:
        sid = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from) VALUES (:s, 'gsc', :d, :f)"), {"s": sid, "d": END, "f": FRESH})
    competitor(engine, sid, "rival.test", tracking="on")
    competitor(engine, sid, "pages-only.test", tracking="pages")
    k = keyword(engine, sid, "blue shoes")
    search_console(engine, sid, "blue shoes", position=4.0)
    check(engine, k, [(3, "https://shop-one.test/page"), (5, "https://rival.test/a"), (6, "https://pages-only.test/b")], ago=10)
    check(engine, k, [(1, "https://pages-only.test/b"), (2, "https://rival.test/a"), (3, "https://stranger.test/c"), (4, "https://shop-one.test/page")], ago=1)
    f = signals(engine, sid)[0]["rival_passed"]
    assert f.evidence["passed"] == [{"host": "rival.test", "position": 2, "before": 5}]  # which rivals passed me is unchanged: On only
    assert [(r["host"], r["before"], r["followed"]) for r in f.evidence["above"]] == [("pages-only.test", 6, True), ("rival.test", 5, True), ("stranger.test", None, False)]
    assert f.evidence["before_checked"].endswith("Z") and f.evidence["my_url"] == "https://shop-one.test/page"
    assert mine  # the helper module is the one these tests share
