"""The Wayback Machine and domain dates: asked for when a competitor is added, monthly after that, and the profile's insights. Made-up sites only."""
from datetime import date

import pytest
from sqlalchemy import text

from seo.competitors import gaps, history, insights, tracking
from seo.core.errors import NotFound
from seo.uptime import service as uptime
from tests.test_competitors_backend import REFERRERS, add_rival, scalar, second_site, seed, world  # noqa: F401  (world is a fixture)

SURT = "example,rival)"
ARCHIVE = [
    (f"{SURT}/", "20190305120000", "text/html", "200"),
    (f"{SURT}/blog/a", "20210110093000", "text/html", "200"),
    (f"{SURT}/blog/a?page=2", "20200110093000", "text/html", "200"),  # the same page, seen earlier with a query
    (f"{SURT}/blog/b", "20230615093000", "text/html", "200"),
    (f"{SURT}/old", "20200101000000", "text/html", "301"),  # a redirect isn't a page
    (f"{SURT}/style.css", "20190305120001", "text/css", "200"),  # nor is a stylesheet
]


@pytest.fixture
def archive(monkeypatch):
    calls = []

    def lookup(host):
        calls.append(host)
        return list(ARCHIVE)

    monkeypatch.setattr(history, "cdx_lookup", lookup)
    monkeypatch.setattr(uptime, "rdap_dates_lookup", lambda domain: (date(2018, 11, 2), date(2027, 11, 2)))
    return calls


def history_row(world, host="rival.example"):
    with world.engine.connect() as conn:
        return history.state(conn, host)


def drain(world):
    return world.drain("collectors")


def test_adding_a_competitor_asks_the_archive_straight_away_for_it_and_my_site(world, archive):
    add_rival(world)
    assert sorted(r[0] for r in world.engine.connect().execute(text("SELECT host FROM site_history")).all()) == ["me.example", "rival.example"]
    assert scalar(world.engine, "SELECT COUNT(*) FROM jobs WHERE kind = 'competitors.history' AND status = 'queued'") == 2
    drain(world)
    assert sorted(archive) == ["me.example", "rival.example"]
    row = history_row(world)
    assert row["status"] == "ok" and row["first_capture"] == date(2019, 3, 5)
    assert row["archived_pages"] == 3 and row["pages_by_year"] == {"2019": 1, "2020": 1, "2023": 1} and row["capped"] is False
    assert (row["registered_on"], row["expires_on"]) == (date(2018, 11, 2), date(2027, 11, 2))


def test_a_fresh_look_is_not_asked_for_again_until_a_month_has_passed(world, archive):
    add_rival(world)
    drain(world)
    archive.clear()
    two = second_site(world)
    add_rival(world, site_id=two)  # the same competitor on another of my sites: only that site of mine is new
    assert history.enqueue_due(world.engine) == []  # already on its way, so nothing twice
    drain(world)
    assert archive == ["me-two.example"]
    assert history.enqueue_due(world.engine) == []
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_history SET fetched_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY WHERE host = 'rival.example'"))
    assert history.enqueue_due(world.engine) == ["rival.example"]


def test_a_busy_archive_is_tried_again_soon_then_marked_failed_and_tried_the_next_day(world, monkeypatch):
    def busy(host):
        raise history.HistoryFailed("http_503")

    monkeypatch.setattr(history, "cdx_lookup", busy)
    monkeypatch.setattr(uptime, "rdap_dates_lookup", lambda domain: (date(2018, 11, 2), None))
    add_rival(world)
    drain(world)
    row = history_row(world)
    assert row["status"] == "queued" and "503" in row["message"] and row["fetched_at"] is None
    assert row["registered_on"] == date(2018, 11, 2)  # the registry answered, so its date is kept
    for _ in range(history.TRIES):
        with world.engine.begin() as conn:
            conn.execute(text("UPDATE jobs SET run_after = UTC_TIMESTAMP(3) WHERE kind = 'competitors.history' AND status = 'queued'"))
        drain(world)
    row = history_row(world)
    assert row["status"] == "failed" and row["fetched_at"] is not None
    assert "rival.example" not in history.enqueue_due(world.engine)  # not again today
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_history SET fetched_at = UTC_TIMESTAMP(3) - INTERVAL 21 HOUR"))
    assert "rival.example" in history.enqueue_due(world.engine)


def test_a_paused_competitor_is_left_alone(world, archive):
    rival = add_rival(world)
    drain(world)
    tracking.set_tracking(world.engine, world.own, rival, "off")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_history SET fetched_at = UTC_TIMESTAMP(3) - INTERVAL 40 DAY"))
    assert history.enqueue_due(world.engine) == ["me.example"]


def test_a_domain_with_no_registry_still_gets_its_archive(world, monkeypatch, archive):
    def no_registry(domain):
        raise uptime.NoRdap(domain)

    monkeypatch.setattr(uptime, "rdap_dates_lookup", no_registry)
    add_rival(world)
    drain(world)
    row = history_row(world)
    assert row["status"] == "ok" and row["domain_problem"] == "no_rdap" and row["registered_on"] is None


def test_an_address_from_the_archive_and_from_a_page_read_are_the_same_page():
    assert history.page_key("example,rival)/Blog/A?x=1") == history.page_key("https://www.rival.example/blog/a/") == "rival.example/blog/a"
    assert history.page_key("example,rival)/") == history.page_key("https://rival.example") == "rival.example/"


def test_read_pages_get_their_archive_date(world, archive):
    rival = add_rival(world)
    with world.engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO domains (host) VALUES ('rival.example')"))
        domain_id = conn.execute(text("SELECT id FROM domains WHERE host = 'rival.example'")).scalar()
        conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, content_hash, title) VALUES (:d, 'https://rival.example/blog/a', 'h1', 'c', 'Post A')"), {"d": domain_id})
    drain(world)
    assert scalar(world.engine, "SELECT first_archived FROM pages WHERE url_hash = 'h1'") == date(2020, 1, 10)
    found = insights.insights(world.engine, world.own, rival)
    assert found["rhythm"]["by_year"] == [{"year": 2019, "pages": 1}, {"year": 2020, "pages": 1}, {"year": 2023, "pages": 1}]
    assert found["facts"]["first_capture"] == "2019-03-05" and found["facts"]["registered_on"] == "2018-11-02"
    assert found["facts"]["my_registered_on"] == "2018-11-02" and found["facts"]["history"]["status"] == "ok"
    assert found["facts"]["pages"] == 1 and found["facts"]["my_pages"] == 0


# ---- insights -----------------------------------------------------------------------------------

def test_insights_before_anything_is_read_say_unknown_not_zero(world):
    rival = add_rival(world)
    found = insights.insights(world.engine, world.own, rival)
    assert found["facts"]["pages"] is None and found["facts"]["history"]["status"] == "queued"
    assert found["links"]["linking_domains"] is None and found["build"] == [] and found["sections"] == []
    assert found["rhythm"]["my_new_30d"] is None and found["rhythm"]["updated_12m"] == {"theirs": None, "mine": None}


def test_insights_show_their_best_pages_and_who_links_to_them(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a", "me.example/a"])
    seed(world.engine, world.own, "k2", ["rival.example/a"])
    seed(world.engine, world.own, "k3", ["me.example/c", "rival.example/b"])
    gaps.import_referrers(world.engine, world.own, rival, REFERRERS, "links.csv")
    found = insights.insights(world.engine, world.own, rival)
    best = found["best_pages"]
    assert [(b["url"], b["keywords"], b["best_position"]) for b in best] == [("https://rival.example/a", 2, 1), ("https://rival.example/b", 1, 2)]
    assert best[0]["my_url"] == "https://me.example/a"
    links = found["links"]
    domains = [d["domain"] for d in links["top"]]
    assert "me.example" not in domains and "rival.example" not in domains  # my own and theirs aren't links to them
    assert links["linking_domains"] == len(domains) and links["my_linking_domains"] is None


def test_insights_hide_keyword_numbers_when_only_pages_are_followed(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a", "me.example/a"])
    tracking.set_tracking(world.engine, world.own, rival, "pages")
    found = insights.insights(world.engine, world.own, rival)
    assert found["best_pages"] == [] and found["keywords"]["cannibal"] == {}


def test_insights_of_a_competitor_on_another_site_are_refused(world):
    two = second_site(world)
    rival = add_rival(world)
    with pytest.raises(NotFound):
        insights.insights(world.engine, two, rival)


def test_the_insights_route_answers(world):
    rival = add_rival(world)
    reply = world.client.get(f"/api/competitors/{rival}/insights?site_id={world.own}")
    assert reply.status_code == 200, reply.get_data(as_text=True)
    assert set(reply.get_json()) == {"facts", "best_pages", "sections", "questions", "rhythm", "links", "build", "keywords"}


# ---- asking the archive (2026-11-10: pages whose first copy was a redirect were lost) -----------------------------

# The archive's index, one row per copy, in its own order: by address, then by time.
COPIES = [
    (f"{SURT}/", "20180809121618", "text/html", "302"),  # years of redirects before the site's first real page
    (f"{SURT}/", "20240810151126", "text/html", "301"),
    (f"{SURT}/", "20240810151126", "text/html", "200"),
    (f"{SURT}/", "20250221042717", "text/html", "200"),
    (f"{SURT}/guide", "20220101000000", "warc/revisit", "-"),
    (f"{SURT}/guide", "20230301000000", "text/html", "200"),
    (f"{SURT}/logo.png", "20190101000000", "image/png", "200"),
    (f"{SURT}/moved", "20210101000000", "text/html", "301"),  # never a page
]


def fake_archive(filtering_works=True, seen=None):
    import httpx

    def answer(request):
        query = request.url.params
        if seen is not None:
            seen.append(query)
        filters = query.get_list("filter")
        if filters and not filtering_works:
            raise httpx.ReadTimeout("too slow to filter", request=request)
        rows = [r for r in COPIES if all(r[3 if f.startswith("statuscode") else 2] == f.split(":", 1)[1] for f in filters)]
        if query.get("collapse") == "urlkey":
            rows = [r for n, r in enumerate(rows) if n == 0 or rows[n - 1][0] != r[0]]
        rows = rows[: int(query.get("limit"))]
        return httpx.Response(200, text="".join(" ".join(r) + "\n" for r in rows))

    return httpx.MockTransport(answer)


@pytest.fixture
def real_lookup(monkeypatch):
    monkeypatch.setattr(history, "is_allowed", lambda url: True)
    return monkeypatch


def test_a_page_whose_first_copy_was_a_redirect_still_counts_from_its_first_good_copy(real_lookup):
    seen = []
    real_lookup.setattr(history, "transport", fake_archive(seen=seen))
    found = history.summarise(history.read_cdx("rival.example"))
    assert found["archived_pages"] == 2
    assert found["first_by_page"] == {"rival.example/": date(2024, 8, 10), "rival.example/guide": date(2023, 3, 1)}
    assert found["first_capture"] == date(2023, 3, 1)
    assert found["pages_by_year"] == {"2023": 1, "2024": 1}
    assert len(seen) == 1 and seen[0].get_list("filter") == ["statuscode:200", "mimetype:text/html"]


def test_an_archive_too_slow_to_filter_is_asked_for_every_copy_with_the_same_result(real_lookup):
    seen = []
    real_lookup.setattr(history, "transport", fake_archive(filtering_works=False, seen=seen))
    found = history.summarise(history.read_cdx("rival.example"))
    assert found["archived_pages"] == 2 and found["first_capture"] == date(2023, 3, 1)
    assert not found["capped"]
    assert len(seen) == 2 and not seen[1].get_list("filter") and seen[1].get("collapse") is None


def test_only_the_limit_of_the_question_that_answered_marks_a_count_as_cut_off(real_lookup):
    real_lookup.setattr(history, "transport", fake_archive())
    real_lookup.setattr(history, "CDX_LIMIT", 2)
    assert history.summarise(history.read_cdx("rival.example"))["capped"]
    real_lookup.setattr(history, "transport", fake_archive(filtering_works=False))
    assert not history.summarise(history.read_cdx("rival.example"))["capped"]  # 8 copies, far under the every-copy limit


def test_an_offline_page_sent_as_200_is_a_failed_look_not_an_empty_archive(real_lookup):
    import httpx

    real_lookup.setattr(history, "transport", httpx.MockTransport(lambda request: httpx.Response(200, text="<html><title>Temporarily Offline</title></html>")))
    with pytest.raises(history.HistoryFailed):
        history.read_cdx("rival.example")


def test_an_archive_that_is_down_is_not_asked_a_second_time(real_lookup):
    import httpx

    seen = []
    real_lookup.setattr(history, "transport", httpx.MockTransport(lambda request: seen.append(1) or httpx.Response(503, text="<html>offline</html>")))
    with pytest.raises(history.HistoryFailed, match="http_503"):
        history.read_cdx("rival.example")
    assert len(seen) == 1
