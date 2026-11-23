"""Chosen access: a person reaches only the websites and sections the admin picked (seo/accounts/access.py).

Made-up sites only (the product is for other accounts too): one.example and two.example are both "mine"; the person
gets one.example only.
"""
import re

import pytest
from sqlalchemy import text

from seo.accounts import access, service
from seo.accounts.endpoints import ENDPOINTS, EXPORT_SECTIONS, OWNERS, OWNER_OVERRIDES
from seo.competitors import gaps, notes
from seo.core.errors import Refused
from seo.tasks import service as tasks
from seo.web import create_app

PASSWORD = "correct horse battery"


@pytest.fixture
def app(engine):
    return create_app(engine=engine, secret_key="test-secret-key")


@pytest.fixture
def world(engine):
    """Two own sites, an admin, and data on each site and for every site."""
    with engine.begin() as conn:
        one = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('one.example', 'https://one.example/', 'own')")).lastrowid
        two = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('two.example', 'https://two.example/', 'own')")).lastrowid
    service.create_user(engine, "boss@example.com", "Boss", "admin", password=PASSWORD, must_change=False)
    w = type("World", (), {})()
    w.one, w.two = one, two
    w.task_one = tasks.create(engine, {"title": "Fix one", "site_id": one})["id"]
    w.task_two = tasks.create(engine, {"title": "Fix two", "site_id": two})["id"]
    w.task_all = tasks.create(engine, {"title": "For every site"})["id"]
    w.note_two = notes.create(engine, "site", "About two", site_id=two)["id"]
    w.note_all = notes.create(engine, "all", "About everything")["id"]
    w.link_one = gaps.log_backlink(engine, one, "https://blog.example/post")["id"]
    w.link_two = gaps.log_backlink(engine, two, "https://news.example/item")["id"]
    return w


def _person(engine, sections, sites, spend=False, email="helper@example.com"):
    user, _ = service.create_user(engine, email, "Helper", "member", password=PASSWORD, must_change=False,
                                  access={"sites": sites, "sections": sections, "spend": spend})
    return user


def _signed_in(app, email):
    client = app.test_client()
    reply = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert reply.status_code == 200, reply.get_json()
    return client, {"X-CSRF-Token": reply.get_json()["csrf"]}


def _refused(reply):
    assert reply.status_code == 403, (reply.status_code, reply.get_json())
    assert reply.get_json()["no_access"] is True
    assert "signed_out" not in reply.get_json() and "out of date" not in reply.get_json()["error"]


# ---- the table covers every route ----

def test_every_api_route_is_placed_in_the_access_table(app):
    """A route missing from the table is refused to people with chosen access, so a new one has to be placed first."""
    missing = sorted({r.endpoint for r in app.url_map.iter_rules() if r.rule.startswith("/api/")} - set(ENDPOINTS))
    assert not missing, f"add these to seo/accounts/endpoints.py: {missing}"
    stale = sorted(set(ENDPOINTS) - {r.endpoint for r in app.url_map.iter_rules()})
    assert not stale, f"no such routes any more: {stale}"


def test_every_route_with_an_id_in_its_path_knows_whose_item_it_is(app):
    """Changing a task by its number alone must still check the task's site."""
    known = set(OWNERS) | {"site_id", "view_id", "fmt", "source", "tool", "domain", "action", "user_id", "connection_id", "mediator_id", "event_id"}
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/"):
            continue
        sections, kind, flags = ENDPOINTS[rule.endpoint]
        for arg in rule.arguments:
            ok = arg in known or arg in OWNER_OVERRIDES.get(rule.endpoint, {})
            # ids of things every site shares only appear on routes that need every site, or admins
            if arg in ("mediator_id", "event_id", "user_id", "connection_id", "source", "tool"):
                ok = kind in ("global", "gspend", "admin") or rule.endpoint in ("competitors_api.connection_status",)
            assert ok, (rule.rule, arg)


def test_every_export_view_has_a_section(app):
    from seo.exports import registry

    registry._load()
    assert set(registry.VIEWS) - set(EXPORT_SECTIONS) == {"connections"}


# ---- what the admin can save ----

def test_access_is_checked_when_saved(engine, world):
    with pytest.raises(Refused):
        _person(engine, {"tasks": "edit"}, [])
    with pytest.raises(Refused):
        _person(engine, {}, [world.one])
    with pytest.raises(Refused):
        _person(engine, {"settings": "edit"}, [world.one])
    with pytest.raises(Refused):
        _person(engine, {"tasks": "own"}, [world.one])
    with pytest.raises(Refused):
        _person(engine, {"tasks": "edit"}, [9999])


def test_narrowing_access_signs_the_person_out_and_widening_does_not(app, engine, world):
    user = _person(engine, {"tasks": "edit", "notes": "view"}, [world.one, world.two])
    client, _ = _signed_in(app, "helper@example.com")
    service.update_user(engine, user["id"], {"access": {"sites": [world.one, world.two], "sections": {"tasks": "edit", "notes": "edit"}}})
    assert client.get("/api/tasks").status_code == 200
    service.update_user(engine, user["id"], {"access": {"sites": [world.one], "sections": {"tasks": "edit"}}})
    assert client.get("/api/tasks").status_code == 401


def test_making_someone_admin_clears_their_chosen_access(engine, world):
    user = _person(engine, {"tasks": "edit"}, [world.one])
    assert service.update_user(engine, user["id"], {"role": "admin"})["access"] is None


def test_only_an_admin_sets_access(app, engine, world):
    _person(engine, {"tasks": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.post("/api/team", json={"email": "x@example.com", "name": "X"}, headers=headers))


# ---- sections and levels ----

def test_a_section_they_were_not_given_is_refused(app, engine, world):
    _person(engine, {"tasks": "edit"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    _refused(client.get(f"/api/backlinks?site_id={world.one}"))
    _refused(client.get("/api/notes"))
    assert client.get("/api/tasks").status_code == 200


def test_view_only_can_look_but_not_change(app, engine, world):
    _person(engine, {"backlinks": "view"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    assert client.get(f"/api/backlinks/{world.link_one}").status_code == 200
    _refused(client.delete(f"/api/backlinks/{world.link_one}", headers=headers))
    _refused(client.post("/api/backlinks", json={"site_id": world.one, "source_url": "https://x.example/"}, headers=headers))


def test_settings_and_keys_are_for_admins_only(app, engine, world):
    _person(engine, {key: "edit" for key in access.SECTION_KEYS}, [world.one, world.two], spend=True)
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.get("/api/sources"))
    _refused(client.put("/api/connections/SerpApi", json={"key": "x"}, headers=headers))
    _refused(client.post("/api/sites", json={"address": "https://three.example/"}, headers=headers))


# ---- sites ----

def test_items_of_another_site_are_refused_by_their_own_number(app, engine, world):
    _person(engine, {"tasks": "edit", "backlinks": "edit", "notes": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.patch(f"/api/tasks/{world.task_two}", json={"title": "mine now"}, headers=headers))
    _refused(client.delete(f"/api/tasks/{world.task_two}", headers=headers))
    _refused(client.get(f"/api/backlinks/{world.link_two}"))
    _refused(client.delete(f"/api/notes/{world.note_two}", headers=headers))
    _refused(client.post("/api/backlinks/todo/sent", json={"ids": [world.link_one, world.link_two], "sent": True}, headers=headers))
    assert client.patch(f"/api/tasks/{world.task_one}", json={"title": "Fixed one"}, headers=headers).status_code == 200


def test_moving_an_item_to_another_site_is_refused(app, engine, world):
    _person(engine, {"tasks": "edit", "backlinks": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.patch(f"/api/tasks/{world.task_one}", json={"site_id": world.two}, headers=headers))
    _refused(client.patch(f"/api/tasks/{world.task_one}", json={"site_id": None}, headers=headers))  # to "every site"
    _refused(client.put(f"/api/backlinks/{world.link_one}", json={"site_id": world.two}, headers=headers))


def test_all_sites_means_their_sites_and_items_for_every_site_stay_hidden(app, engine, world):
    _person(engine, {"tasks": "edit", "notes": "view"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    titles = {t["title"] for t in client.get("/api/tasks").get_json()["tasks"]}
    assert titles == {"Fix one"}
    assert client.get("/api/notes").get_json()["notes"] == []
    assert client.get(f"/api/notes?site_id={world.one}").get_json()["notes"] == []  # a note for every site isn't shown on one site either
    _refused(client.delete(f"/api/tasks/{world.task_all}", headers=headers))  # a task for every site isn't theirs to change
    _refused(client.post("/api/tasks", json={"title": "for everyone"}, headers=headers))  # saving for every site
    assert client.post("/api/tasks", json={"title": "mine", "site_id": world.one}, headers=headers).status_code == 201


def test_site_lists_and_boot_show_only_their_sites(engine, world):
    app = create_app(engine=engine, secret_key="test-secret-key", screens_dir="design/mockups")
    _person(engine, {"health": "view", "tasks": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    assert [s["host"] for s in client.get("/api/links/sites").get_json()["sites"]] == ["one.example"]
    assert [s["host"] for s in client.get("/api/health/sites").get_json()["sites"]] == ["one.example"]
    boot = client.get("/boot.js").get_data(as_text=True)
    assert "one.example" in boot and "two.example" not in boot
    assert '"access": {"sites": [' in boot


def test_another_site_named_in_the_query_is_refused(app, engine, world):
    _person(engine, {"keywords": "view", "overview": "view", "channels": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    _refused(client.get(f"/api/rankings?site_id={world.two}"))
    _refused(client.get(f"/api/metrics/channels?site_id={world.two}&start=2026-01-01&end=2026-01-31"))
    assert client.get(f"/api/rankings?site_id={world.one}").status_code == 200


def test_an_export_follows_its_view_and_needs_one_of_their_sites(app, engine, world):
    _person(engine, {"tasks": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    _refused(client.get("/api/export/notes.csv"))
    _refused(client.get("/api/export/tasks.csv"))  # every site, and they don't have every site
    _refused(client.get(f"/api/export/tasks.csv?site_id={world.two}"))
    reply = client.get(f"/api/export/tasks.csv?site_id={world.one}")
    assert reply.status_code == 200
    body = reply.get_data(as_text=True)
    assert "Fix one" in body and "Fix two" not in body and "For every site" not in body


def test_with_every_site_a_person_sees_what_the_owner_sees_in_their_sections(app, engine, world):
    _person(engine, {"tasks": "edit"}, [world.one, world.two])
    client, headers = _signed_in(app, "helper@example.com")
    assert {t["title"] for t in client.get("/api/tasks").get_json()["tasks"]} == {"Fix one", "Fix two", "For every site"}
    assert client.post("/api/tasks", json={"title": "for everyone"}, headers=headers).status_code == 201


# ---- credits and shared changes ----

def test_paid_searches_need_the_credits_tick(app, engine, world):
    _person(engine, {"keywords": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.post("/api/refresh/runs", json={"site_id": world.one, "keyword_ids": [], "allow_paid": True}, headers=headers))
    free = client.post("/api/refresh/runs", json={"site_id": world.one, "keyword_ids": [], "allow_paid": False}, headers=headers)
    assert free.status_code != 403  # the route itself may refuse an empty list, but not for access


def test_changes_every_site_shares_need_every_site(app, engine, world):
    _person(engine, {"competitors": "edit", "backlinks": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.post("/api/link-gaps/edit", json={"domain": "x.example"}, headers=headers))
    _refused(client.post("/api/mediators", json={"name": "Agency"}, headers=headers))
    assert client.get("/api/mediators").status_code == 200


# ---- nothing changes for everyone else ----

def test_full_members_and_admins_are_untouched(app, engine, world):
    service.create_user(engine, "member@example.com", "Member", "member", password=PASSWORD, must_change=False)
    for email in ("member@example.com", "boss@example.com"):
        client, _ = _signed_in(app, email)
        assert {t["title"] for t in client.get("/api/tasks").get_json()["tasks"]} == {"Fix one", "Fix two", "For every site"}
        assert client.get(f"/api/backlinks/{world.link_two}").status_code == 200
        assert len(client.get("/api/links/sites").get_json()["sites"]) == 2


def test_login_switched_off_has_no_limits(engine, world):
    app = create_app(engine=engine, auth=False)
    assert len(app.test_client().get("/api/links/sites").get_json()["sites"]) == 2


def test_parse_never_turns_rubbish_into_full_access():
    assert access.parse(None) is None
    assert access.parse("not json") == {"sites": [], "sections": {}, "spend": False}
    assert access.parse('{"sites": [1], "sections": {"tasks": "edit", "x": "edit", "notes": "all"}}') == {"sites": [1], "sections": {"tasks": "edit"}, "spend": False}


def test_section_keys_match_the_menu():
    menu = open("design/mockups/mockup.js", encoding="utf-8").read()
    nav = menu[menu.index("const NAV = ["): menu.index("];", menu.index("const NAV = ["))]
    assert re.findall(r'id: "([a-z]+)"', nav) == list(access.SECTION_KEYS)


# ---- holes an independent review found (2026-11-12) ----

@pytest.mark.parametrize("odd", ["+2", " 2", "2.0", "0_2", "２"])
def test_a_site_written_oddly_is_refused_in_the_query(app, engine, world, odd):
    _person(engine, {"insights": "view", "overview": "view", "today": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    odd = odd.replace("2", str(world.two))
    for path in ("insights", "today/attention", "notifications"):
        _refused(client.get(f"/api/{path}", query_string={"site_id": odd}))


@pytest.mark.parametrize("odd", [2.0, True, "+2", [2]])
def test_a_site_written_oddly_is_refused_in_the_body(app, engine, world, odd):
    _person(engine, {"insights": "edit", "resources": "edit", "channels": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    odd = float(world.two) if odd == 2.0 else True if odd is True else str(odd).replace("2", str(world.two)) if isinstance(odd, str) else [world.two]
    _refused(client.post("/api/insights/run", json={"site_id": odd}, headers=headers))
    _refused(client.post(f"/api/rules?site_id={world.one}", json={"kind": "channel", "pattern": "*/x", "value": "Spam", "site_id": odd}, headers=headers))
    _refused(client.post("/api/resources", json={"title": "x", "url": "https://x.example/", "site_id": odd}, headers=headers))


def test_two_different_sites_in_one_request_are_refused(app, engine, world):
    _person(engine, {"tasks": "edit"}, [world.one, world.two])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.post(f"/api/tasks?site_id={world.one}", json={"title": "x", "site_id": world.two}, headers=headers))


def test_naming_their_site_in_the_query_cannot_save_something_for_every_site(app, engine, world):
    """The route reads the body; a site in the query must not stand in for it."""
    _person(engine, {"tasks": "edit", "resources": "edit", "channels": "edit", "overview": "edit", "notes": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.post(f"/api/tasks?site_id={world.one}", json={"title": "x"}, headers=headers))
    _refused(client.post(f"/api/rules?site_id={world.one}", json={"kind": "channel", "pattern": "*/x", "value": "Spam"}, headers=headers))
    _refused(client.post(f"/api/search/brand?site_id={world.one}", json={"word": "acme"}, headers=headers))
    _refused(client.post(f"/api/resources?site_id={world.one}", json={"title": "x", "url": "https://x.example/"}, headers=headers))
    _refused(client.post(f"/api/notes?site_id={world.one}", json={"scope": "keyword", "keyword": "x", "body": "y"}, headers=headers))
    with engine.connect() as conn:
        for table in ("tasks", "site_rules", "resources"):
            assert conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE site_id IS NULL AND id > 1")).scalar() == 0 or table == "tasks"
        assert conn.execute(text("SELECT COUNT(*) FROM tasks WHERE title = 'x'")).scalar() == 0


def test_their_own_items_still_save_on_their_site(app, engine, world):
    _person(engine, {"tasks": "edit", "resources": "edit", "channels": "edit", "notes": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    assert client.post("/api/rules", json={"kind": "channel", "pattern": "*/x", "value": "Spam", "site_id": world.one}, headers=headers).status_code == 201
    assert client.post("/api/resources", json={"title": "x", "url": "https://x.example/", "site_id": world.one}, headers=headers).status_code in (200, 201)
    assert client.post("/api/notes", json={"scope": "keyword", "keyword": "x", "body": "y", "site_id": world.one}, headers=headers).status_code == 201


def test_every_site_tasks_and_day_notes_stay_out_of_note_pickers(app, engine, world):
    _person(engine, {"notes": "edit"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    titles = [t["title"] for t in client.get(f"/api/notes/options?site_id={world.one}").get_json()["tasks"]]
    assert "For every site" not in titles and "Fix one" in titles


def test_settings_style_key_details_are_hidden(app, engine, world):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO connections (tool, secret, last4, last_error) VALUES ('SerpApi', 'x', 'ab12', 'bad key')"))
    _person(engine, {"keywords": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    body = client.get("/api/connections/SerpApi").get_data(as_text=True) + client.get("/api/tools").get_data(as_text=True)
    assert "ab12" not in body and "bad key" not in body


def test_marking_an_alert_or_today_row_seen_is_a_change(app, engine, world):
    _person(engine, {"today": "view", "health": "view"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    _refused(client.post("/api/today/seen", json={"key": "x"}, headers=headers))


def test_the_undo_of_stop_following_a_keyword_another_site_tracks_works(app, engine, world):
    with engine.begin() as conn:
        kw = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES ('café', 'h1', 'fr', 'fr')")).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:t, :k)"), {"t": world.two, "k": kw})
    _person(engine, {"keywords": "edit"}, [world.one])
    client, headers = _signed_in(app, "helper@example.com")
    reply = client.post(f"/api/rankings/{kw}/restore?site_id={world.one}", headers=headers)
    assert reply.status_code != 403 or not reply.get_json().get("no_access"), reply.get_json()
    _refused(client.post(f"/api/rankings/{kw}/restore?site_id={world.two}", headers=headers))


def test_page_pictures_answer_only_for_the_persons_sites(app, engine, world):
    with engine.begin() as conn:
        for host in ("one.example", "two.example"):
            domain = conn.execute(text("INSERT INTO domains (host) VALUES (:h)"), {"h": host}).lastrowid
            conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, title, content_hash, extras) VALUES (:d, :u, :x, :t, 'h', :e)"),
                         {"d": domain, "u": f"https://{host}/caf%C3%A9", "x": host, "t": f"Page of {host}", "e": f'{{"image": "https://{host}/i.jpg"}}'})
    _person(engine, {"content": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    reply = client.get("/api/site-pages/pictures")
    assert reply.status_code == 200, reply.get_json()
    assert reply.get_json()["sites"] == {"one.example": {"/café/": ["Page of one.example", "https://one.example/i.jpg"]}}


# ---- the team on tasks (2026-11-23) ----

def test_a_task_is_never_given_to_someone_who_cannot_see_it(app, engine, world):
    """A site they don't have, a task for every site without every site, or no Tasks section: refused with who and why."""
    _person(engine, {"tasks": "edit"}, [world.one])
    service.create_user(engine, "reader@example.com", "Reader", "member", password=PASSWORD, must_change=False,
                        access={"sites": [world.one], "sections": {"overview": "view"}, "spend": False})
    boss, headers = _signed_in(app, "boss@example.com")
    reply = boss.patch(f"/api/tasks/{world.task_two}", json={"owner_label": "Helper"}, headers=headers)
    assert reply.status_code == 400 and "Helper can't see tasks on two.example" in reply.get_json()["error"]
    reply = boss.patch(f"/api/tasks/{world.task_all}", json={"owner_label": "Helper"}, headers=headers)
    assert reply.status_code == 400 and "doesn't have every website" in reply.get_json()["error"]
    reply = boss.patch(f"/api/tasks/{world.task_one}", json={"owner_label": "Reader"}, headers=headers)
    assert reply.status_code == 400 and "Reader can't see tasks" in reply.get_json()["error"]
    reply = boss.post("/api/tasks", json={"title": "New", "site_id": world.two, "owner_label": "Helper"}, headers=headers)
    assert reply.status_code == 400
    # their own site is fine, and the name is written as the team list writes it
    reply = boss.patch(f"/api/tasks/{world.task_one}", json={"owner_label": "helper"}, headers=headers)
    assert reply.status_code == 200 and reply.get_json()["owner_label"] == "Helper"
    # moving the task to a site they lack, with them still on it, is refused too
    reply = boss.patch(f"/api/tasks/{world.task_one}", json={"site_id": world.two}, headers=headers)
    assert reply.status_code == 400 and "Helper can't see tasks on two.example" in reply.get_json()["error"]
    # someone not in the team at all
    reply = boss.patch(f"/api/tasks/{world.task_one}", json={"owner_label": "Ghost"}, headers=headers)
    assert reply.status_code == 400 and "Nobody in the team is called Ghost" in reply.get_json()["error"]


def test_a_name_from_before_accounts_is_kept_when_other_things_change(engine, world):
    with engine.begin() as conn:
        conn.execute(text("UPDATE tasks SET owner_label = 'Old helper' WHERE id = :i"), {"i": world.task_one})
    saved = tasks.update(engine, world.task_one, {"status": "doing"})
    assert saved["owner_label"] == "Old helper"


def test_renaming_someone_moves_their_tasks_and_names_stay_unique(engine, world):
    user = _person(engine, {"tasks": "edit"}, [world.one])
    tasks.update(engine, world.task_one, {"owner_label": "Helper"})
    service.update_user(engine, user["id"], {"name": "Helper Two"})
    owners = [t["owner_label"] for t in tasks.list_tasks(engine)]
    assert "Helper Two" in owners and "Helper" not in owners
    with pytest.raises(Refused, match="already has that name"):
        service.update_user(engine, user["id"], {"name": "boss"})
    with pytest.raises(Refused, match="already has that name"):
        service.create_user(engine, "other@example.com", "HELPER TWO", "member", password=PASSWORD, must_change=False)


def test_boot_says_who_tasks_can_go_to_on_their_sites_and_who_the_admins_are(engine, world):
    app = create_app(engine=engine, secret_key="test-secret-key", screens_dir="design/mockups")
    _person(engine, {"tasks": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    boot = client.get("/boot.js").get_data(as_text=True)
    assert '"admins": ["Boss"]' in boot
    assert f'"assignees": {{"{world.one}": {{"Boss": "edit", "Helper": "view"}}}}' in boot  # their site only, no "all", no site two


def test_lists_shared_by_every_site_do_not_name_the_owners_other_sites(app, engine, world):
    from seo.backlinks import logos
    for host in ("one.example", "two.example", "blog.example"):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO site_logos (domain, status, image, content_type) VALUES (:h, 'found', 'x', 'image/png') "
                              "ON DUPLICATE KEY UPDATE status = 'found', image = 'x', content_type = 'image/png'"), {"h": host})
    assert "two.example" in logos.known(engine)
    _person(engine, {"insights": "view"}, [world.one])
    client, _ = _signed_in(app, "helper@example.com")
    domains = client.get("/api/logos").get_json()["domains"]
    assert "one.example" in domains and "blog.example" in domains and "two.example" not in domains
    ai = client.get("/api/insights/ai").get_json()
    assert [s["host"] for s in ai["sites"]] == ["one.example"] and "spent" not in ai
