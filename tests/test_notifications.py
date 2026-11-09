"""The bell: a search the site never showed up for before is announced once, on its first day, with its page and place;
not before 28 days of history, not for old days when Search Console is first connected, and at most 50 a day one by one."""
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
    add(engine, site, END, "brand new search", shown=7, clicks=1, position=4.26, page="https://shop-one.test/b/")
    add(engine, site, END, "brand new search", shown=2, page="https://shop-one.test/c/", query_row=False)  # a second page, shown less: not the one named
    with engine.begin() as conn:  # the query's own row counts both pages
        conn.execute(text("UPDATE gsc_query SET impressions = 9 WHERE query = 'brand new search'"))

    assert new_queries.check(engine, site)["added"] == 1
    answer = shown(engine)
    assert answer["unread"] == 1
    [item] = answer["items"]
    assert item["kind"] == "new_query" and item["host"] == "shop-one.test" and item["read"] is False
    assert item["title"] == "New search: “brand new search”"
    assert item["detail"]["query"] == "brand new search" and item["detail"]["day"] == END.isoformat()
    assert item["detail"]["impressions"] == 9 and item["detail"]["clicks"] == 1 and item["detail"]["position"] == 4.3
    assert item["detail"]["page"] == "https://shop-one.test/b/"

    assert new_queries.check(engine, site)["added"] == 0  # the same day, looked at again
    assert len(shown(engine)["items"]) == 1


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
    add(engine, site, END - timedelta(days=10), "found ten days ago")
    add(engine, site, END, "found on the last day")
    new_queries.check(engine, site)
    assert [i["detail"]["query"] for i in shown(engine)["items"]] == ["found on the last day"]


def test_each_new_final_day_is_looked_at_once(engine, site):
    history(engine, site, last=END - timedelta(days=2))
    new_queries.check(engine, site)  # mark at END - 2
    with engine.begin() as conn:
        assert conn.execute(text("SELECT through FROM notification_marks WHERE site_id = :s"), {"s": site}).scalar() == END - timedelta(days=2)
    add(engine, site, END - timedelta(days=1), "day one")
    add(engine, site, END, "day two")
    assert new_queries.check(engine, site)["days"] == [(END - timedelta(days=1)).isoformat(), END.isoformat()]
    assert {i["detail"]["query"] for i in shown(engine)["items"]} == {"day one", "day two"}
    assert new_queries.check(engine, site)["days"] == []


def test_a_not_final_day_rings_at_once_and_not_again_when_it_turns_final(engine, site):
    history(engine, site)
    new_queries.check(engine, site)
    add(engine, site, FRESH, "seen today")
    assert new_queries.check(engine, site)["added"] == 1
    assert new_queries.check(engine, site)["days"] == [FRESH.isoformat()]  # still looked at each pull until it's final
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET data_through = :d, fresh_from = :f WHERE site_id = :s"), {"s": site, "d": FRESH, "f": FRESH + timedelta(days=1)})
    assert new_queries.check(engine, site)["added"] == 0
    assert len(shown(engine)["items"]) == 1


def test_more_than_50_in_a_day_share_one_notification(engine, site):
    history(engine, site)
    for n in range(57):
        add(engine, site, END, f"long tail {n:02d}", shown=100 - n)
    assert new_queries.check(engine, site)["added"] == 51
    items = shown(engine)["items"]
    one_by_one = [i for i in items if i["kind"] == "new_query"]
    [more] = [i for i in items if i["kind"] == "new_query_more"]
    assert len(one_by_one) == 50 and "long tail 00" in {i["detail"]["query"] for i in one_by_one}  # the most shown get their own
    assert items[0]["detail"]["query"] == "long tail 00" and items[-1] is more  # the bell reads top down: most shown first
    assert more["title"] == "7 more new searches" and more["detail"]["count"] == 7
    assert [q["query"] for q in more["detail"]["queries"]] == [f"long tail {n}" for n in range(50, 57)]
    assert shown(engine)["unread"] == 51
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
