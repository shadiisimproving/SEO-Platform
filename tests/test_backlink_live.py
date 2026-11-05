"""Monthly live checks of backlinks, mediators and Today's numbers, on the real test database with websites in memory."""
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.backlinks import live, mediators, service
from seo.core import budget
from seo.crawl.fetch import PoliteFetcher
from seo.links import service as links
from seo.web import create_app
from seo.worker.runner import tick

ALLOW = lambda url: True  # noqa: E731
HAS_LINK = '<p>Read <a href="https://shop.example/page/" rel="noopener">our page</a></p>'


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    pages = {"blog.example/post": HAS_LINK, "shop.example/page/": "<p>mine</p>", "shop.example/page": (301, "/page/")}
    requests = []

    def website(request):
        requests.append(str(request.url))
        key = f"{request.url.host}{request.url.raw_path.decode()}"
        if request.url.path == "/robots.txt":
            found = pages.get(key)
            return httpx.Response(200, text=found) if found else httpx.Response(404)
        found = pages.get(key)
        if found is None:
            return httpx.Response(404, text="nope")
        if isinstance(found, Exception):
            raise found
        if isinstance(found, int):
            return httpx.Response(found, text="no")
        if isinstance(found, tuple):
            return httpx.Response(found[0], headers={"location": found[1]})
        return httpx.Response(200, html=found)

    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=ALLOW, transport=httpx.MockTransport(website)))
    monkeypatch.setattr(service.logos, "queue_for", lambda engine, domains: None)

    class World:
        pass

    w = World()
    w.engine, w.pages, w.requests = engine, pages, requests
    w.client = create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client()
    w.own = links.add_site(engine, "https://shop.example/", "own", is_allowed=ALLOW)["id"]
    w.rival = links.add_site(engine, "https://rival.example/", "competitor", is_allowed=ALLOW)["id"]
    w.tick = lambda: tick(engine, "crawl", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)

    def add(**fields):
        return service.save_many(engine, [{"site_id": w.own, "source_url": "https://blog.example/post", "target_url": "/page/", **fields}])["saved"][0]["id"]

    w.add = add

    def link(backlink_id):
        return next(b for b in w.client.get(f"/api/backlinks?site_id={w.own}").get_json()["backlinks"] if b["id"] == backlink_id)

    w.link = link

    def press(backlink_id):
        assert w.client.post(f"/api/backlinks/{backlink_id}/check").status_code == 202
        w.tick()

    w.press = press

    def monthly():
        with engine.begin() as conn:
            conn.execute(text("UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY WHERE checked_at IS NOT NULL"))
        assert live.enqueue_due(engine) == [w.own]
        w.tick()

    w.monthly = monthly

    def alerts(kind):
        with engine.connect() as conn:
            return conn.execute(text("SELECT * FROM alerts WHERE kind = :k"), {"k": kind}).mappings().all()

    w.alerts = alerts
    return w


# ---- reading the page -------------------------------------------------------------------------------

def test_find_link_prefers_the_logged_target_and_reads_rel_and_anchor():
    page = b'<a href="https://shop.example/other">elsewhere</a><a href="https://www.shop.example/page?x=1" rel="NoFollow sponsored">  the   page </a>'
    seen = live.find_link(page, "https://blog.example/", "shop.example", "/page/")
    assert seen.found and seen.to_target and seen.is_nofollow is True and seen.anchor == "the page" and seen.rel == "nofollow sponsored"


def test_find_link_with_only_another_page_of_the_site_still_counts():
    seen = live.find_link(b'<a href="https://shop.example/other">x</a>', "https://blog.example/", "shop.example", "/page/")
    assert seen.found and seen.to_target is False


def test_find_link_handles_relative_base_and_picture_links():
    page = b'<base href="https://shop.example/"><a href="page"><img alt="Shop logo"></a>'
    seen = live.find_link(page, "https://blog.example/", "shop.example", "/page")
    assert seen.found and seen.anchor == "Shop logo" and seen.is_nofollow is False


def test_find_link_does_not_match_a_lookalike_domain():
    page = b'<a href="https://shop.example.evil.test/page">x</a><a href="https://notshop.example/page">y</a>'
    assert live.find_link(page, "https://blog.example/", "shop.example", "/page").found is False


def test_find_link_survives_rubbish():
    assert live.find_link(b"", "https://blog.example/", "shop.example", None).found is False
    assert live.find_link(b'<a href="http://[bad">x</a>', "https://blog.example/", "shop.example", None).found is False


@pytest.mark.parametrize("given,want", [
    ("/page/", "/page"), ("/page", "/page"), ("page", "/page"), ("https://www.shop.example/page/?utm_source=x#top", "/page"), ("/", "/"), ("https://shop.example", "/"),
    ("/caf%C3%A9/", "/café"), ("", ""), (None, ""),
])
def test_clean_path(given, want):
    assert live.clean_path(given) == want


# ---- what happens to the link --------------------------------------------------------------------------

def test_a_link_still_there_is_recorded(world):
    backlink = world.add()
    world.press(backlink)
    check = world.link(backlink)["check"]
    assert check["outcome"] == "found" and check["is_nofollow"] is False and check["anchor"] == "our page" and check["checked_at"]
    assert check["target_final_url"] == "https://shop.example/page/"
    assert world.link(backlink)["status"] == "live"


def test_a_removed_link_is_flagged_lost_by_check_now_and_nothing_is_deleted(world):
    backlink = world.add()
    world.pages["blog.example/post"] = "<p>no link any more</p>"
    world.press(backlink)
    row = world.link(backlink)
    assert row["status"] == "lost" and row["check"]["outcome"] == "missing" and row["check"]["lost_at"]
    alert = world.alerts("backlink_lost")
    assert len(alert) == 1 and alert[0]["title"] == "shop.example: a backlink was lost"
    assert world.client.get(f"/api/backlinks/{backlink}/checks").get_json()["checks"][0]["outcome"] == "missing"


def test_the_monthly_check_needs_two_misses_before_flagging(world):
    backlink = world.add()
    world.pages["blog.example/post"] = "<p>gone</p>"
    assert live.enqueue_due(world.engine) == [world.own]
    world.tick()
    row = world.link(backlink)
    assert row["status"] == "live" and row["check"]["misses"] == 1 and world.alerts("backlink_lost") == []
    assert live.enqueue_due(world.engine) == []  # not again the same day
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 21 HOUR"))
    assert live.enqueue_due(world.engine) == [world.own]
    world.tick()
    assert world.link(backlink)["status"] == "lost" and len(world.alerts("backlink_lost")) == 1


def test_a_miss_that_clears_starts_again(world):
    backlink = world.add()
    world.pages["blog.example/post"] = "<p>gone</p>"
    live.enqueue_due(world.engine)
    world.tick()
    world.pages["blog.example/post"] = HAS_LINK
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 21 HOUR"))
    live.enqueue_due(world.engine)
    world.tick()
    assert world.link(backlink)["check"]["misses"] == 0 and world.link(backlink)["status"] == "live"


def test_a_page_that_is_gone_counts_as_a_miss(world):
    backlink = world.add()
    world.pages["blog.example/post"] = 404
    world.press(backlink)
    assert world.link(backlink)["status"] == "lost" and world.link(backlink)["check"]["outcome"] == "page_gone"


@pytest.mark.parametrize("answer,reason", [(403, "turned_away"), (500, "server"), (503, "server"), (429, "rate_limited"), (httpx.ConnectError("x"), "network")])
def test_a_page_that_could_not_be_read_never_loses_a_link(world, answer, reason):
    backlink = world.add()
    world.press(backlink)
    world.pages["blog.example/post"] = answer
    world.press(backlink)
    row = world.link(backlink)
    assert row["status"] == "live" and row["check"]["outcome"] == "unknown" and row["check"]["reason"] == reason
    assert world.alerts("backlink_lost") == []
    assert row["check"]["anchor"] == "our page"  # what was known stays


def test_robots_is_respected_and_says_so(world):
    backlink = world.add()
    world.pages["blog.example/robots.txt"] = "User-agent: *\nDisallow: /\n"
    world.press(backlink)
    row = world.link(backlink)
    assert row["status"] == "live" and row["check"]["reason"] == "robots"
    assert "https://blog.example/post" not in world.requests


def test_a_lost_link_that_reappears_comes_back(world):
    backlink = world.add()
    world.pages["blog.example/post"] = "<p>gone</p>"
    world.press(backlink)
    world.pages["blog.example/post"] = HAS_LINK
    world.monthly()
    row = world.link(backlink)
    assert row["status"] == "live" and row["check"]["lost_at"] is None


def test_turning_nofollow_and_a_new_anchor_are_changes_with_an_alert(world):
    backlink = world.add()
    world.press(backlink)
    assert world.alerts("backlink_changed") == []
    world.pages["blog.example/post"] = '<a href="https://shop.example/page/" rel="nofollow">another name</a>'
    world.press(backlink)
    row = world.link(backlink)
    assert row["check"]["is_nofollow"] is True and row["check"]["anchor"] == "another name" and row["status"] == "live"
    changes = world.client.get(f"/api/backlinks/{backlink}/checks").get_json()["checks"][0]["changes"]
    assert {c["what"] for c in changes} == {"nofollow", "anchor"}
    assert len(world.alerts("backlink_changed")) == 1


def test_the_first_reading_is_not_a_change_even_if_the_typed_anchor_differs(world):
    backlink = world.add(anchor="what we asked for")
    world.press(backlink)
    assert world.alerts("backlink_changed") == []
    assert world.link(backlink)["anchor"] == "what we asked for" and world.link(backlink)["check"]["anchor"] == "our page"


def test_a_redirect_to_the_final_page_is_recorded(world):
    backlink = world.add()
    world.pages["blog.example/post"] = (301, "/moved")
    world.pages["blog.example/moved"] = HAS_LINK
    world.press(backlink)
    assert world.link(backlink)["check"]["final_url"] == "https://blog.example/moved" and world.link(backlink)["status"] == "live"


def test_a_target_that_redirects_is_followed_to_its_final_page(world):
    world.pages["blog.example/post"] = '<a href="https://shop.example/page">x</a>'
    backlink = world.add()
    world.press(backlink)
    assert world.link(backlink)["check"]["target_final_url"] == "https://shop.example/page/"
    assert live.traffic_targets(world.engine, world.own)[0]["paths"] == ["/page"]


def test_lost_alerts_add_up_until_seen(world):
    first = world.add()
    second = world.add(source_url="https://blog.example/two")
    world.pages["blog.example/post"] = "<p>x</p>"
    world.pages["blog.example/two"] = "<p>x</p>"
    world.press(first)
    world.press(second)
    alert = world.alerts("backlink_lost")
    assert len(alert) == 1 and alert[0]["title"] == "shop.example: 2 backlinks were lost"


def test_planned_links_are_not_on_the_monthly_list_and_check_now_never_changes_them(world):
    planned = world.add(status="planned")
    assert live.enqueue_due(world.engine) == []
    world.press(planned)
    assert world.link(planned)["status"] == "planned" and world.link(planned)["check"]["outcome"] == "found"
    world.pages["blog.example/post"] = "<p>x</p>"
    world.press(planned)
    assert world.link(planned)["status"] == "planned"


def test_a_found_link_must_be_logged_before_a_check(world):
    found = world.add(status="found")
    assert world.client.post(f"/api/backlinks/{found}/check").status_code == 400


def test_monthly_does_not_recheck_what_is_fresh(world):
    world.add()
    live.enqueue_due(world.engine)
    world.tick()
    assert live.enqueue_due(world.engine) == []


def test_a_link_read_a_week_ago_is_not_due_and_one_read_a_month_ago_is(world):
    world.add()
    live.enqueue_due(world.engine)
    world.tick()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 29 DAY"))
    assert live.enqueue_due(world.engine) == []
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY"))
    assert live.enqueue_due(world.engine) == [world.own]


def test_the_scheduled_check_is_recorded_as_monthly_and_the_button_as_by_hand(world):
    link = world.add()
    live.enqueue_due(world.engine)
    world.tick()
    assert live.history(world.engine, link)[0]["trigger"] == "monthly"
    world.press(link)
    assert live.history(world.engine, link)[0]["trigger"] == "button"


def test_monthly_retries_soon_after_a_network_failure_but_not_after_a_block(world):
    backlink = world.add()
    world.pages["blog.example/post"] = 500
    live.enqueue_due(world.engine)
    world.tick()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 21 HOUR"))
    assert live.enqueue_due(world.engine) == [world.own]
    world.pages["blog.example/post"] = 403
    world.tick()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 21 HOUR"))
    assert live.enqueue_due(world.engine) == []
    assert world.link(backlink)["check"]["reason"] == "turned_away"


def test_checks_count_in_the_budget_and_wait_for_tomorrow_without_room(world):
    world.add()
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO crawl_budget (day, used) VALUES (UTC_DATE(), :n)"), {"n": budget.DAILY_CRAWL_REQUESTS})
    live.enqueue_due(world.engine)
    world.tick()
    assert world.requests == []
    with world.engine.connect() as conn:
        job = conn.execute(text("SELECT status, run_after > UTC_TIMESTAMP(3) AS later FROM jobs WHERE kind = :k"), {"k": live.JOB_KIND}).mappings().first()
    assert job["status"] == "queued" and job["later"] == 1


def test_a_competitors_job_does_nothing(world):
    from seo.worker import queue

    queue.enqueue(world.engine, "crawl", live.JOB_KIND, payload={"site_id": world.rival}, dedupe_key="sneaky")
    world.tick()
    assert world.requests == []


def test_changing_the_source_page_forgets_what_was_read(world):
    backlink = world.add()
    world.press(backlink)
    answer = world.client.put(f"/api/backlinks/{backlink}", json={"site_id": world.own, "source_url": "https://blog.example/other", "target_url": "/page/"})
    assert answer.status_code == 200
    assert world.link(backlink)["check"]["checked_at"] is None


def test_a_person_setting_lost_counts_for_this_week_and_setting_live_clears_it(world):
    backlink = world.add()
    put = lambda status: world.client.put(f"/api/backlinks/{backlink}", json={"site_id": world.own, "source_url": "https://blog.example/post", "target_url": "/page/", "status": status})  # noqa: E731
    put("lost")
    assert world.client.get(f"/api/backlinks/summary?site_id={world.own}").get_json()["lost_this_week"] == 1
    put("live")
    assert world.client.get(f"/api/backlinks/summary?site_id={world.own}").get_json()["lost_this_week"] == 0


# ---- Today's numbers ---------------------------------------------------------------------------------------

def test_summary_counts_with_exactly_the_names_today_uses(world):
    soon, far = (date.today() + timedelta(days=3)).isoformat(), (date.today() + timedelta(days=60)).isoformat()
    world.add(source_url="https://a.example/1", status="planned", due=soon)
    world.add(source_url="https://a.example/2", status="planned", due=far)
    world.add(source_url="https://a.example/3", status="planned", due="le 3 mars")
    world.add(source_url="https://a.example/4", status="live", renewal=soon)
    world.add(source_url="https://a.example/5", status="live", renewal=far)
    world.add(source_url="https://a.example/6", status="lost")  # uploaded as lost: not lost this week
    reply = world.client.get(f"/api/backlinks/summary?site_id={world.own}")
    assert reply.get_json() == {"follow_up": 1, "renewals_30d": 1, "lost_this_week": 0}


def test_a_miss_waiting_for_its_second_read_is_something_to_follow_up(world):
    world.add()
    world.pages["blog.example/post"] = "<p>x</p>"
    live.enqueue_due(world.engine)
    world.tick()
    assert world.client.get("/api/backlinks/summary").get_json()["follow_up"] == 1


def test_one_link_can_be_read_back_and_a_missing_one_says_so(world):
    backlink = world.add()
    assert world.client.get(f"/api/backlinks/{backlink}").get_json()["id"] == backlink
    assert world.client.get("/api/backlinks/99999").status_code == 404
    assert world.client.get("/api/backlinks/99999/checks").status_code == 404
    assert world.client.post("/api/backlinks/99999/check").status_code == 404


def test_summary_of_all_sites_and_refusals(world):
    world.add(status="lost")
    assert world.client.get("/api/backlinks/summary").status_code == 200
    assert world.client.get("/api/backlinks/summary?site_id=abc").status_code == 400
    assert world.client.get(f"/api/backlinks/summary?site_id={world.rival}").status_code == 400
    assert world.client.get("/api/backlinks/summary?site_id=99999").status_code == 404


# ---- For Phase 5 --------------------------------------------------------------------------------------------

def test_traffic_targets_give_phase_5_what_it_matches(world):
    world.add(utm_source="blog", utm_medium="backlink", utm_campaign="bl-1", placed="2026-10-01")
    world.add(source_url="https://a.example/planned", status="planned")
    targets = live.traffic_targets(world.engine, world.own)
    assert len(targets) == 1
    assert targets[0]["domain"] == "blog.example" and targets[0]["paths"] == ["/page"] and targets[0]["placed"] == "2026-10-01"
    assert targets[0]["utm"] == {"source": "blog", "medium": "backlink", "campaign": "bl-1"}


def test_visits_stay_unknown_until_a_provider_fills_them(world, monkeypatch):
    backlink = world.add()
    assert "visits" not in world.link(backlink)
    monkeypatch.setattr(service, "traffic_provider", lambda engine, site_id: {backlink: {"visits": 12, "leads": 1, "label": "domain", "shared": None}})
    row = world.link(backlink)
    assert row["visits"] == 12 and row["leads"] == 1 and row["traffic_label"] == "domain"


# ---- Mediators ---------------------------------------------------------------------------------------------

def post_mediator(world, **body):
    return world.client.post("/api/mediators", json=body)


def test_a_mediator_can_be_added_and_edited(world):
    reply = post_mediator(world, name=" Sara Link ", contact="sara@agency.example", platform="Fiverr", price_text="150 €", notes="Slow to answer")
    assert reply.status_code == 201
    made = reply.get_json()
    assert made["name"] == "Sara Link" and made["links"] == 0
    edited = world.client.patch(f"/api/mediators/{made['id']}", json={"platform": "Upwork", "contact": ""}).get_json()
    assert edited["platform"] == "Upwork" and edited["contact"] is None and edited["price_text"] == "150 €"


def test_two_spellings_are_one_mediator(world):
    post_mediator(world, name="Sara Link")
    assert post_mediator(world, name="  sara   LINK ").status_code == 409


def test_a_name_is_required_and_limits_hold(world):
    assert post_mediator(world, contact="x").status_code == 400
    assert post_mediator(world, name="   ").status_code == 400
    assert post_mediator(world, name="x" * 181).status_code == 400
    assert post_mediator(world, name=5).status_code == 400
    made = post_mediator(world, name="Fine").get_json()
    assert world.client.patch(f"/api/mediators/{made['id']}", json={"name": ""}).status_code == 400
    assert world.client.patch(f"/api/mediators/{made['id']}", json={"nope": 1}).status_code == 400
    assert world.client.patch("/api/mediators/99999", json={"name": "x"}).status_code == 404


def test_typing_a_new_name_on_a_link_creates_the_mediator(world):
    world.add(mediator="LinkAgency", contact="hi@agency.example", platform="Fiverr")
    listed = world.client.get("/api/mediators").get_json()["mediators"]
    assert [(m["name"], m["contact"], m["platform"], m["links"], m["live"]) for m in listed] == [("LinkAgency", "hi@agency.example", "Fiverr", 1, 1)]


def test_a_link_only_fills_in_what_is_blank(world):
    made = post_mediator(world, name="LinkAgency", contact="real@agency.example").get_json()
    world.add(mediator="linkagency", contact="other@x.example", platform="Fiverr")
    found = world.client.get("/api/mediators").get_json()["mediators"][0]
    assert found["id"] == made["id"] and found["contact"] == "real@agency.example" and found["platform"] == "Fiverr"


def test_renaming_a_mediator_carries_over_to_its_links(world):
    backlink = world.add(mediator="Old name")
    found = world.client.get("/api/mediators").get_json()["mediators"][0]
    world.client.patch(f"/api/mediators/{found['id']}", json={"name": "New name"})
    assert world.link(backlink)["mediator"] == "New name"
    assert world.client.get("/api/mediators").get_json()["mediators"][0]["links"] == 1


def test_a_rename_onto_someone_else_is_refused(world):
    post_mediator(world, name="One")
    two = post_mediator(world, name="Two").get_json()
    assert world.client.patch(f"/api/mediators/{two['id']}", json={"name": "ONE"}).status_code == 409
    assert world.client.patch(f"/api/mediators/{two['id']}", json={"name": "TWO"}).status_code == 200


def test_counts_leave_out_links_nobody_logged(world):
    world.add(mediator="Agency", status="planned")
    world.add(source_url="https://a.example/1", mediator="Agency", status="lost")
    world.add(source_url="https://a.example/2", mediator="Agency", status="found")
    found = world.client.get("/api/mediators").get_json()["mediators"][0]
    assert (found["links"], found["live"], found["lost"], found["planned"]) == (2, 0, 1, 1)


def test_name_key_ignores_case_and_spacing():
    assert mediators.name_key("  Sara   LINK ") == mediators.name_key("sara link")
