"""The bell: searches the site never showed up for before, once they reach 10 impressions, in one notification per site
per day, with their pages and places; not before 28 days of history, not for old days when Search Console is first
connected. Read is each person's own once people sign in."""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors.common import digest
from seo.notifications import new_queries, service
from seo.web import create_app
from seo.worker import runner

END = date(2026, 11, 1)  # last final day
FRESH = END + timedelta(days=1)
START = END - timedelta(days=60)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from) VALUES (:s, 'gsc', :d, :f)"), {"s": site_id, "d": END, "f": FRESH})
    return site_id


def add(engine, site_id, day, query, shown=10, clicks=0, position=8.0, page="https://shop-one.test/a/", query_row=True):
    with engine.begin() as conn:
        if query_row:
            conn.execute(
                text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, :c, :i, :p)"),
                {"s": site_id, "d": day, "h": digest(query), "q": query, "c": clicks, "i": shown, "p": position},
            )
        conn.execute(
            text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :pg, :c, :i, :p)"),
            {"s": site_id, "d": day, "h": digest(query, page), "q": query, "pg": page, "c": clicks, "i": shown, "p": position},
        )


def history(engine, site_id, query="old search", first=START, last=END):
    day = first
    while day <= last:
        add(engine, site_id, day, query)
        day += timedelta(days=1)


def shown(engine, site_id=None):
    return service.listing(engine, site_id)


def test_a_new_query_is_announced_once_with_its_page_and_place(engine, site):
    history(engine, site)
    add(engine, site, END, "brand new search", shown=10, clicks=1, position=4.26, page="https://shop-one.test/b/")
    add(engine, site, END, "brand new search", shown=2, page="https://shop-one.test/c/", query_row=False)  # a second page, shown less: not the one named
    with engine.begin() as conn:  # the query's own row counts both pages
        conn.execute(text("UPDATE gsc_query SET impressions = 12 WHERE query = 'brand new search'"))

    assert new_queries.check(engine, site)["added"] == 1
    answer = shown(engine)
    assert answer["unread"] == 1
    [item] = answer["items"]
    assert item["kind"] == "new_queries" and item["host"] == "shop-one.test" and item["read"] is False
    assert item["title"] == "New search: “brand new search”"
    assert item["detail"]["day"] == END.isoformat() and item["detail"]["count"] == 1 and item["detail"]["min_impressions"] == new_queries.MIN_IMPRESSIONS
    [one] = item["detail"]["queries"]
    assert one["query"] == "brand new search" and one["first_day"] == END.isoformat()
    assert one["impressions"] == 12 and one["clicks"] == 1 and one["position"] == 4.3
    assert one["page"] == "https://shop-one.test/b/"

    assert new_queries.check(engine, site)["added"] == 0  # the same day, looked at again
    assert len(shown(engine)["items"]) == 1


def test_a_search_below_the_floor_waits_until_it_has_enough_impressions(engine, site):
    history(engine, site, last=END - timedelta(days=2))
    new_queries.check(engine, site)
    add(engine, site, END - timedelta(days=1), "slow riser", shown=4)
    assert new_queries.check(engine, site)["added"] == 0  # 4 impressions: noise for now
    add(engine, site, END, "slow riser", shown=6)
    assert new_queries.check(engine, site)["added"] == 1  # 10 over its two days
    assert shown(engine)["items"][0]["detail"]["queries"][0]["impressions"] == 10


def test_a_search_gets_a_week_to_reach_the_floor(engine, site):
    history(engine, site, last=END - timedelta(days=9))
    new_queries.check(engine, site)
    add(engine, site, END - timedelta(days=8), "too slow", shown=3)
    history(engine, site, query="old search two", first=END - timedelta(days=8), last=END)
    add(engine, site, END, "too slow", shown=30)
    new_queries.check(engine, site)
    names = [q["query"] for i in shown(engine)["items"] for q in i["detail"]["queries"]]
    assert "too slow" not in names  # first seen 8 days ago: not news any more


def test_a_query_seen_before_is_not_new_even_after_a_gap(engine, site):
    history(engine, site)
    add(engine, site, START + timedelta(days=3), "came back")
    add(engine, site, END, "came back")
    assert new_queries.check(engine, site)["added"] == 0


def test_a_site_needs_28_days_of_history_first(engine, site):
    history(engine, site, first=END - timedelta(days=20))
    add(engine, site, END, "too early to say")
    assert new_queries.check(engine, site)["added"] == 0
    assert shown(engine)["items"] == []


def test_the_first_check_does_not_ring_for_old_days(engine, site):
    history(engine, site)
    add(engine, site, END - timedelta(days=5), "found five days ago")
    add(engine, site, END, "found on the last day")
    new_queries.check(engine, site)
    assert [q["query"] for q in shown(engine)["items"][0]["detail"]["queries"]] == ["found on the last day"]


def test_one_notification_a_day_and_a_later_pull_adds_to_it_unread_again(engine, site):
    history(engine, site, last=END - timedelta(days=2))
    new_queries.check(engine, site)  # mark at END - 3
    add(engine, site, END - timedelta(days=1), "day one", shown=20)
    add(engine, site, END, "day two", shown=11)
    assert new_queries.check(engine, site)["added"] == 2
    [item] = shown(engine)["items"]
    assert item["title"] == "2 new searches" and [q["query"] for q in item["detail"]["queries"]] == ["day one", "day two"]
    service.mark(engine, item["id"])
    add(engine, site, END, "later the same day", shown=40)
    assert new_queries.check(engine, site)["added"] == 1
    [item] = shown(engine)["items"]
    assert item["read"] is False and item["detail"]["count"] == 3 and item["detail"]["queries"][0]["query"] == "later the same day"
    assert new_queries.check(engine, site)["added"] == 0


def test_a_not_final_day_rings_at_once_and_not_again_when_it_turns_final(engine, site):
    history(engine, site)
    new_queries.check(engine, site)
    add(engine, site, FRESH, "seen today")
    assert new_queries.check(engine, site)["added"] == 1
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET data_through = :d, fresh_from = :f WHERE site_id = :s"), {"s": site, "d": FRESH, "f": FRESH + timedelta(days=1)})
    assert new_queries.check(engine, site)["added"] == 0
    assert len(shown(engine)["items"]) == 1


def test_many_new_searches_in_a_day_are_one_notification(engine, site):
    history(engine, site)
    for n in range(57):
        add(engine, site, END, f"long tail {n:02d}", shown=100 - n)
    assert new_queries.check(engine, site)["added"] == 57
    [item] = shown(engine)["items"]
    assert item["title"] == "57 new searches" and item["detail"]["count"] == 57
    assert [q["query"] for q in item["detail"]["queries"]][:3] == ["long tail 00", "long tail 01", "long tail 02"]  # most shown first
    assert shown(engine)["unread"] == 1
    assert new_queries.check(engine, site)["added"] == 0


def test_competitors_never_ring(engine, site):
    with engine.begin() as conn:
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.test', 'https://rival.test/', 'competitor')")).lastrowid
    history(engine, rival)
    add(engine, rival, END, "rival search")
    assert new_queries.check(engine, rival)["added"] == 0


def test_the_bell_api_lists_marks_read_and_filters_by_site(engine, site):
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-two.test', 'https://shop-two.test/', 'own')")).lastrowid
    for site_id, query in ((site, "first site search"), (other, "second site search")):
        history(engine, site_id)
        add(engine, site_id, END, query)
        new_queries.check(engine, site_id)
    client = create_app(engine=engine, auth=False).test_client()

    answer = client.get("/api/notifications").get_json()
    assert answer["unread"] == 2 and len(answer["items"]) == 2
    mine = client.get(f"/api/notifications?site_id={site}").get_json()
    assert [i["host"] for i in mine["items"]] == ["shop-one.test"]
    assert client.get("/api/notifications?site_id=x").status_code == 400

    first = mine["items"][0]["id"]
    assert client.post(f"/api/notifications/{first}/read", json={}).status_code == 200
    assert client.get("/api/notifications").get_json()["unread"] == 1
    assert client.post(f"/api/notifications/{first}/read", json={"read": False}).status_code == 200
    assert client.get("/api/notifications").get_json()["unread"] == 2
    assert client.post(f"/api/notifications/{first}/read", json={"read": "yes"}).status_code == 400
    assert client.post("/api/notifications/999999/read", json={}).status_code == 404

    assert client.post("/api/notifications/read-all", json={"site_id": other}).get_json()["marked"] == 1
    assert client.get("/api/notifications").get_json()["unread"] == 1
    assert client.post("/api/notifications/read-all", json={}).get_json()["marked"] == 1
    assert client.get("/api/notifications").get_json()["unread"] == 0


def test_a_finished_search_console_pull_queues_the_check(engine, site):
    assert "new-queries" in runner._registry
    new_queries.enqueue(engine, site)
    new_queries.enqueue(engine, site)
    with engine.connect() as conn:
        jobs = conn.execute(text("SELECT kind, lane FROM jobs WHERE dedupe_key = :k"), {"k": f"new-queries|{site}"}).all()
    assert [tuple(j) for j in jobs] == [("new-queries", "collectors")]


def test_read_is_each_persons_own(engine, site):
    with engine.begin() as conn:
        ann = conn.execute(text("INSERT INTO users (email, name, password_hash, role) VALUES ('ann@site-one.example', 'Ann', 'x', 'admin')")).lastrowid
        bob = conn.execute(text("INSERT INTO users (email, name, password_hash, role) VALUES ('bob@site-one.example', 'Bob', 'x', 'member')")).lastrowid
    history(engine, site)
    add(engine, site, END, "for both of them", shown=12)
    new_queries.check(engine, site)
    assert service.listing(engine, None, ann)["unread"] == 1 and service.listing(engine, None, bob)["unread"] == 1
    assert service.mark_all(engine, None, ann) == 1
    assert service.listing(engine, None, ann)["unread"] == 0
    assert service.listing(engine, None, bob)["unread"] == 1  # Ann's Mark all read leaves Bob's alone
    [item] = service.listing(engine, None, bob)["items"]
    service.mark(engine, item["id"], True, bob)
    assert service.listing(engine, None, bob)["items"][0]["read"] is True
    service.mark(engine, item["id"], False, ann)
    assert service.listing(engine, None, ann)["unread"] == 1 and service.listing(engine, None, bob)["unread"] == 0
