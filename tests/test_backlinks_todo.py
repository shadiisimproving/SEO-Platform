"""To do: from In consideration, to a mediator, to Done. On the real test database."""
import pytest
from sqlalchemy import text

from seo.backlinks import todo
from seo.competitors import gaps
from tests.test_competitors_backend import world  # noqa: F401 - world is a fixture

DOC = "https://docs.google.com/document/d/abc/edit"


def add_prospect(world, url="https://blog.fresh.example/post", **row):
    return world.client.post("/api/prospects", json={"site_id": world.own, "file": "links.csv", "authority_label": "Domain Authority", "rows": [{"url": url, **row}]}).get_json()["added"][0]


def move(world, *prospects, mediator="LinkAgency", link_type="Guest post"):
    return world.client.post("/api/backlinks/todo/move", json={"prospect_ids": [p["id"] for p in prospects], "mediator": mediator, "link_type": link_type})


def link(world, backlink_id):
    return next(b for b in world.client.get(f"/api/backlinks?site_id={world.own}").get_json()["backlinks"] if b["id"] == backlink_id)


def moved(world, **row):
    return move(world, add_prospect(world, **row)).get_json()["saved"][0]


def test_moving_makes_a_planned_link_and_keeps_what_the_prospect_knew(world):
    prospect = add_prospect(world, authority=40, page_authority=22, rating=5, spam_score=3, owner="Sara")
    answer = move(world, prospect)
    assert answer.status_code == 200
    row = link(world, answer.get_json()["saved"][0]["id"])
    assert (row["status"], row["mediator"], row["link_type"], row["owner"]) == ("planned", "LinkAgency", "Guest post", "Sara")
    assert (row["authority"], row["page_authority"], row["rating"], row["spam_score"], row["authority_label"]) == (40, 22, 5, 3, "Domain Authority")
    assert row["sent_at"] is None and gaps.list_prospects(world.engine, world.own) == []


def test_the_mediator_named_becomes_a_real_mediator(world):
    moved(world)
    assert [m["name"] for m in world.client.get("/api/mediators").get_json()["mediators"]] == ["LinkAgency"]


@pytest.mark.parametrize("mediator", [None, "", "   ", 7])
def test_a_mediator_is_required(world, mediator):
    prospect = add_prospect(world)
    assert move(world, prospect, mediator=mediator).status_code == 400
    assert len(gaps.list_prospects(world.engine, world.own)) == 1


def test_a_prospect_that_is_gone_is_refused_and_nothing_moves(world):
    prospect = add_prospect(world)
    answer = world.client.post("/api/backlinks/todo/move", json={"prospect_ids": [prospect["id"], 999999], "mediator": "A"})
    assert answer.status_code == 404 and len(gaps.list_prospects(world.engine, world.own)) == 1


def test_a_page_already_logged_is_skipped_and_stays_in_consideration(world):
    world.client.post("/api/backlinks/bulk", json={"rows": [{"site_id": world.own, "source_url": "https://blog.fresh.example/post", "status": "lost"}]})
    prospect = add_prospect(world)
    answer = move(world, prospect).get_json()
    assert answer["saved"] == [] and answer["skipped"][0]["why"] == "Already logged"
    assert len(gaps.list_prospects(world.engine, world.own)) == 1


def test_undo_brings_it_back_exactly(world):
    prospect = add_prospect(world, authority=40, page_authority=22, rating=5, spam_score=3, owner="Sara", stage="agreed")
    answer = move(world, prospect).get_json()
    back = world.client.post("/api/backlinks/todo/move-back", json={"ids": [answer["saved"][0]["id"]], "details": answer["details"]})
    assert back.status_code == 200
    again = gaps.list_prospects(world.engine, world.own)[0]
    for field in ("url", "domain", "authority", "page_authority", "rating", "spam_score", "owner", "stage", "source_file", "source_kind", "authority_label"):
        assert again[field] == prospect[field], field
    assert back.get_json()["prospects"] == [again]
    assert world.client.get(f"/api/backlinks?site_id={world.own}").get_json()["backlinks"] == []


def test_moving_back_with_no_details_starts_as_not_contacted(world):
    row = moved(world, stage="agreed")
    assert world.client.post("/api/backlinks/todo/move-back", json={"ids": [row["id"]]}).status_code == 200
    assert gaps.list_prospects(world.engine, world.own)[0]["stage"] == "new"


def test_article_link_type_and_mediator_can_change(world):
    row = moved(world)
    answer = world.client.patch(f"/api/backlinks/{row['id']}/todo", json={"article_url": DOC, "link_type": "Press", "mediator": "PressLink"})
    assert answer.status_code == 200
    saved = link(world, row["id"])
    assert (saved["article_url"], saved["link_type"], saved["mediator"]) == (DOC, "Press", "PressLink")
    assert {m["name"] for m in world.client.get("/api/mediators").get_json()["mediators"]} == {"LinkAgency", "PressLink"}


def test_only_what_is_sent_changes_and_an_article_can_be_cleared(world):
    row = moved(world)
    world.client.patch(f"/api/backlinks/{row['id']}/todo", json={"article_url": DOC})
    world.client.patch(f"/api/backlinks/{row['id']}/todo", json={"link_type": "Press"})
    assert link(world, row["id"])["article_url"] == DOC
    assert world.client.patch(f"/api/backlinks/{row['id']}/todo", json={"article_url": ""}).status_code == 200
    assert link(world, row["id"])["article_url"] is None


@pytest.mark.parametrize("body", [{"article_url": "not a link"}, {"article_url": "ftp://files.example/a"}, {"article_url": 7}, {"mediator": ""}, {"link_type": 5}, {"status": "live"}, {}])
def test_bad_changes_are_refused(world, body):
    row = moved(world)
    assert world.client.patch(f"/api/backlinks/{row['id']}/todo", json=body).status_code == 400


def test_sent_can_be_set_and_undone(world):
    row = moved(world)
    answer = world.client.post("/api/backlinks/todo/sent", json={"ids": [row["id"]], "sent": True})
    assert answer.status_code == 200 and answer.get_json()["saved"][0]["sent_at"]
    assert link(world, row["id"])["sent_at"]
    world.client.post("/api/backlinks/todo/sent", json={"ids": [row["id"]], "sent": False})
    assert link(world, row["id"])["sent_at"] is None
    assert world.client.post("/api/backlinks/todo/sent", json={"ids": [row["id"]], "sent": "yes"}).status_code == 400


def test_a_link_that_is_not_in_to_do_cannot_change_here(world):
    live = world.client.post("/api/backlinks/bulk", json={"rows": [{"site_id": world.own, "source_url": "https://live.example/a"}]}).get_json()["saved"][0]
    assert world.client.patch(f"/api/backlinks/{live['id']}/todo", json={"article_url": DOC}).status_code == 400
    assert world.client.post("/api/backlinks/todo/sent", json={"ids": [live["id"]], "sent": True}).status_code == 400
    assert world.client.post(f"/api/backlinks/{live['id']}/placed", json={"live_url": "https://live.example/b"}).status_code == 400
    assert world.client.post("/api/backlinks/todo/move-back", json={"ids": [live["id"]]}).status_code == 400
    assert link(world, live["id"])["status"] == "live"


def test_placing_uses_the_real_address_and_goes_live(world):
    row = moved(world, authority=40, rating=5)
    world.client.patch(f"/api/backlinks/{row['id']}/todo", json={"article_url": DOC})
    world.client.post("/api/backlinks/todo/sent", json={"ids": [row["id"]], "sent": True})
    answer = world.client.post(f"/api/backlinks/{row['id']}/placed", json={"live_url": "https://blog.fresh.example/our-guest-post/"})
    assert answer.status_code == 200
    saved = link(world, row["id"])
    assert (saved["status"], saved["source_url"]) == ("live", "https://blog.fresh.example/our-guest-post/")
    assert saved["placed"] and saved["mediator"] == "LinkAgency" and saved["article_url"] == DOC
    assert (saved["authority"], saved["rating"]) == (40, 5)


def test_a_placed_link_is_due_for_its_first_check_and_a_planned_one_never_is(world):
    from seo.backlinks import live as checks
    row = moved(world)
    assert checks.enqueue_due(world.engine) == []
    world.client.post(f"/api/backlinks/{row['id']}/placed", json={"live_url": "https://blog.fresh.example/our-guest-post/"})
    assert checks.enqueue_due(world.engine) == [world.own]


@pytest.mark.parametrize("address", [None, "", "not a link", "ftp://files.example/a", "https://two words.example/"])
def test_placing_needs_a_real_address(world, address):
    row = moved(world)
    assert world.client.post(f"/api/backlinks/{row['id']}/placed", json={"live_url": address}).status_code == 400
    assert link(world, row["id"])["status"] == "planned"


def test_placing_on_a_page_already_logged_is_refused(world):
    world.client.post("/api/backlinks/bulk", json={"rows": [{"site_id": world.own, "source_url": "https://taken.example/page"}]})
    row = moved(world)
    assert world.client.post(f"/api/backlinks/{row['id']}/placed", json={"live_url": "https://taken.example/page"}).status_code == 400
    assert link(world, row["id"])["status"] == "planned"


def test_a_link_that_does_not_exist_says_so(world):
    assert world.client.patch("/api/backlinks/999999/todo", json={"link_type": "Press"}).status_code == 404
    assert world.client.post("/api/backlinks/999999/placed", json={"live_url": "https://a.example/b"}).status_code == 404
