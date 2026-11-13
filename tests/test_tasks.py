"""Tasks, through the real database and API: the board, its findings, and carrying work between months."""
import json

import pytest
from sqlalchemy import text

from seo.web import create_app


@pytest.fixture
def client(engine):
    return create_app(engine=engine, auth=False).test_client()


@pytest.fixture
def own_site(engine) -> int:
    with engine.begin() as conn:
        return conn.execute(
            text("INSERT INTO sites (host, start_url, kind) VALUES ('shop.example', 'https://shop.example/', 'own')")
        ).lastrowid


def make(client, **fields):
    reply = client.post("/api/tasks", json={"title": "Rewrite the visa page", **fields})
    assert reply.status_code == 201, reply.json
    return reply.json


def finding(key="health|12|broken_pages", **extra):
    return {"type": "health", "label": "Error pages", "host": "shop.example", "facts": ["1 page"], "link": "#health", "key": key, **extra}


def test_create_move_and_reload(client, own_site):
    task = make(client, site_id=own_site, priority="high", due="2026-11-20", owner_label="Sara", kind="Technical")
    assert (task["status"], task["priority"], task["due"], task["site_host"], task["owner_label"]) == ("todo", "high", "2026-11-20", "shop.example", "Sara")
    moved = client.patch(f"/api/tasks/{task['id']}", json={"status": "doing"}).json
    assert moved["status"] == "doing"
    assert moved["title"] == "Rewrite the visa page"  # only what was sent changes
    assert moved["priority"] == "high"
    assert [t["id"] for t in client.get("/api/tasks").json["tasks"]] == [task["id"]]
    assert client.get("/api/tasks").json["tasks"][0]["status"] == "doing"


def test_finishing_stamps_the_day_and_reopening_clears_it(client):
    task = make(client)
    assert task["completed_on"] == ""
    done = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"}).json
    assert done["completed_on"] != ""
    same = client.patch(f"/api/tasks/{task['id']}", json={"note": "checked"}).json
    assert same["completed_on"] == done["completed_on"]
    assert client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"}).json["completed_on"] == ""


def test_a_task_created_done_is_finished(client):
    assert make(client, status="done")["completed_on"] != ""


@pytest.mark.parametrize("body, words", [
    ({"title": "   "}, "needs a title"),
    ({"title": "x" * 301}, "too long"),
    ({"title": ["not", "text"]}, "needs a title"),
    ({"title": "ok", "status": "maybe"}, "status"),
    ({"title": "ok", "priority": "urgent"}, "priority"),
    ({"title": "ok", "due": "next week"}, "YYYY-MM-DD"),
    ({"title": "ok", "due": 20261120}, "YYYY-MM-DD"),
    ({"title": "ok", "impact": 6}, "1 to 5"),
    ({"title": "ok", "impact": True}, "1 to 5"),
    ({"title": "ok", "hours_spent": -1}, "hours"),
    ({"title": "ok", "hours_estimate": "lots"}, "hours"),
    ({"title": "ok", "site_id": "site-one"}, "number"),
    ({"title": "ok", "kind": 5}, "text"),
    ({"title": "ok", "surprise": 1}, "can't carry"),
    ({"title": "ok", "source": "health"}, "object"),
    ({"title": "ok", "source": {"type": "guess"}}, "kind of finding"),
    ({"title": "ok", "source": {"type": "health", "link": "javascript:alert(1)"}}, "inside the app"),
    ({"title": "ok", "source": {"type": "health", "facts": "one"}}, "list of text"),
    ({"title": "ok", "source": {"type": "health", "extra": 1}}, "can't carry"),
])
def test_bad_input_is_refused_with_a_sentence(client, body, words):
    reply = client.post("/api/tasks", json=body)
    assert reply.status_code == 400
    assert words in reply.json["error"]
    assert client.get("/api/tasks").json["tasks"] == []


def test_not_json_is_refused(client):
    assert client.post("/api/tasks", data="title=x").status_code == 400


def test_a_title_cant_be_emptied_later(client):
    task = make(client)
    assert client.patch(f"/api/tasks/{task['id']}", json={"title": " "}).status_code == 400
    assert client.get("/api/tasks").json["tasks"][0]["title"] == "Rewrite the visa page"


def test_a_competitor_or_missing_site_is_refused(client, engine):
    with engine.begin() as conn:
        rival = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('rival.example', 'https://rival.example/', 'competitor')")).lastrowid
    assert client.post("/api/tasks", json={"title": "ok", "site_id": rival}).status_code == 400
    assert client.post("/api/tasks", json={"title": "ok", "site_id": rival + 99}).status_code == 404


def test_a_missing_task_is_404(client):
    assert client.patch("/api/tasks/999", json={"status": "done"}).status_code == 404
    assert client.delete("/api/tasks/999").status_code == 404
    assert client.post("/api/tasks/999/restore").status_code == 404
    assert client.post("/api/tasks/999/comments", json={"text": "hi"}).status_code == 404


def test_one_open_task_per_finding(client):
    first = make(client, source=finding())
    second = client.post("/api/tasks", json={"title": "Same thing, double click", "source": finding()})
    assert second.status_code == 409
    assert "already has an open task" in second.json["error"]
    assert len(client.get("/api/tasks").json["tasks"]) == 1
    assert first["source"]["facts"] == ["1 page"]
    make(client, title="A different finding", source=finding(key="health|12|server_errors"))


def test_a_long_address_can_be_a_finding(client):
    key = "link|" + "https://shop.example/" + "a" * 3000
    make(client, source=finding(key=key))
    assert client.post("/api/tasks", json={"title": "again", "source": finding(key=key)}).status_code == 409


def test_a_finished_task_frees_its_finding_and_reopening_can_clash(client):
    first = make(client, source=finding())
    client.patch(f"/api/tasks/{first['id']}", json={"status": "done"})
    second = make(client, title="It came back", source=finding())
    reopen = client.patch(f"/api/tasks/{first['id']}", json={"status": "doing"})
    assert reopen.status_code == 409
    assert client.patch(f"/api/tasks/{second['id']}", json={"status": "done"}).status_code == 200
    assert client.patch(f"/api/tasks/{first['id']}", json={"status": "doing"}).status_code == 200


def test_moving_between_open_columns_keeps_holding_the_finding(client):
    first = make(client, source=finding())
    client.patch(f"/api/tasks/{first['id']}", json={"status": "doing"})
    assert client.post("/api/tasks", json={"title": "again", "source": finding()}).status_code == 409


def test_delete_can_be_undone_unless_the_finding_moved_on(client):
    first = make(client, source=finding())
    assert client.delete(f"/api/tasks/{first['id']}").status_code == 200
    assert client.get("/api/tasks").json["tasks"] == []
    assert client.patch(f"/api/tasks/{first['id']}", json={"status": "doing"}).status_code == 404
    assert client.post(f"/api/tasks/{first['id']}/restore").json["id"] == first["id"]
    assert client.post("/api/tasks", json={"title": "again", "source": finding()}).status_code == 409  # it holds the finding again

    client.delete(f"/api/tasks/{first['id']}")
    make(client, title="A new one", source=finding())
    assert client.post(f"/api/tasks/{first['id']}/restore").status_code == 409


def test_comments_keep_the_name_as_written(client):
    task = make(client)
    client.post(f"/api/tasks/{task['id']}/comments", json={"text": "  Title sent to the writer ", "name": "Sara"})
    after = client.post(f"/api/tasks/{task['id']}/comments", json={"text": "Accents é ü 日本"}).json
    assert [c["text"] for c in after["comments"]] == ["Title sent to the writer", "Accents é ü 日本"]
    assert after["comments"][0]["name"] == "Sara"
    assert after["comments"][0]["at"].endswith("Z")
    assert client.get("/api/tasks").json["tasks"][0]["comments"] == after["comments"]


@pytest.mark.parametrize("body", [{"text": "  "}, {}, {"text": 5}, {"text": "x" * 2001}, {"text": "ok", "name": 7}])
def test_bad_comments_are_refused(client, body):
    task = make(client)
    assert client.post(f"/api/tasks/{task['id']}/comments", json=body).status_code == 400


def test_removing_a_site_keeps_its_tasks_and_their_host(client, engine, own_site):
    task = make(client, site_id=own_site, source=finding())
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM sites WHERE id = :i"), {"i": own_site})
    kept = client.get("/api/tasks").json["tasks"][0]
    assert kept["id"] == task["id"]
    assert kept["site_id"] is None
    assert kept["site_host"] == "shop.example"  # it doesn't start reading as "all sites"


def test_clearing_a_site_means_all_sites(client, own_site):
    task = make(client, site_id=own_site)
    cleared = client.patch(f"/api/tasks/{task['id']}", json={"site_id": None}).json
    assert (cleared["site_id"], cleared["site_host"]) == (None, "")


def test_clearing_text_and_numbers(client):
    task = make(client, note="x", impact=3, hours_spent=1.5, due="2026-11-20")
    assert task["impact"] == 3
    cleared = client.patch(f"/api/tasks/{task['id']}", json={"note": "", "impact": None, "hours_spent": "", "due": ""}).json
    assert (cleared["note"], cleared["impact"], cleared["hours_spent"], cleared["due"]) == ("", None, None, "")


def test_a_save_on_an_old_copy_changes_nothing(client):
    task = make(client, owner_label="Nadia")
    newer = client.patch(f"/api/tasks/{task['id']}", json={"description": "Nadia's plan", "expected_version": task["version"]})
    assert newer.status_code == 200
    stale = client.patch(f"/api/tasks/{task['id']}", json={"owner_label": "Sara", "expected_version": task["version"]})
    assert stale.status_code == 409
    assert "while you had it open" in stale.json["error"]
    kept = client.get("/api/tasks").json["tasks"][0]
    assert (kept["owner_label"], kept["description"]) == ("Nadia", "Nadia's plan")
    # With the newer copy it goes through, and a change sent with no version still does: moving a card overwrites nothing else.
    assert client.patch(f"/api/tasks/{task['id']}", json={"owner_label": "Sara", "expected_version": kept["version"]}).status_code == 200
    assert client.patch(f"/api/tasks/{task['id']}", json={"status": "doing"}).status_code == 200


# ---- a task notices when its finding has gone, and never closes itself -----------------------------------

def _audit(engine, site_id, *codes, ago_hours=0, status="complete", pages_not_read=0, site_problems=()):
    with engine.begin() as conn:
        audit = conn.execute(text(
            "INSERT INTO health_audits (site_id, trigger_kind, status, pages_not_read, counts, created_at) "
            "VALUES (:s, 'manual', :st, :n, :c, UTC_TIMESTAMP(3) + INTERVAL :h HOUR)"
        ), {"s": site_id, "st": status, "n": pages_not_read, "c": json.dumps({"site": list(site_problems)}), "h": -ago_hours}).lastrowid
        for code in codes:
            conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, :c, 1, '[]')"), {"a": audit, "c": code})


def _scan(engine, site_id, *targets, ago_hours=0, status="complete", check_external=1, external_not_checked=0, pages_not_read=0):
    with engine.begin() as conn:
        scan = conn.execute(text(
            "INSERT INTO link_scans (site_id, trigger_kind, status, check_external, external_not_checked, pages_not_read, created_at) "
            "VALUES (:s, 'manual', :st, :x, :e, :n, UTC_TIMESTAMP(3) + INTERVAL :h HOUR)"
        ), {"s": site_id, "st": status, "x": check_external, "e": external_not_checked, "n": pages_not_read, "h": -ago_hours}).lastrowid
        for target in targets:
            conn.execute(text("INSERT INTO link_issues (scan_id, category, target_url, reason, pages) VALUES (:a, 'broken', :t, 'Page not found', '[]')"), {"a": scan, "t": target})


def _health_task(client, site_id, code="broken_pages"):
    return make(client, site_id=site_id, source={"type": "health", "label": code, "key": f"health|{site_id}|{code}"})


def _link_task(client, site_id, target="https://shop.example/old"):
    return make(client, site_id=site_id, source={"type": "link", "label": target, "key": f"link|{site_id}|{target}"})


def _finding(client, task):
    return next(t for t in client.get("/api/tasks").json["tasks"] if t["id"] == task["id"])["finding"]


def test_a_health_task_says_when_a_newer_test_no_longer_finds_it(client, engine, own_site):
    task = _health_task(client, own_site)
    assert _finding(client, task) is None  # nothing has run since
    _audit(engine, own_site, "broken_pages", ago_hours=-1)
    assert _finding(client, task) is None  # still found
    _audit(engine, own_site, "no_title", ago_hours=-2)
    assert _finding(client, task)["state"] == "gone"
    assert next(t for t in client.get("/api/tasks").json["tasks"] if t["id"] == task["id"])["status"] == "todo"  # it never closes itself


def test_an_old_test_or_an_unfinished_one_proves_nothing(client, engine, own_site):
    _audit(engine, own_site, ago_hours=5)  # clean, but from before the task
    task = _health_task(client, own_site)
    assert _finding(client, task) is None
    _audit(engine, own_site, ago_hours=-1, status="stopped")
    assert _finding(client, task) is None
    _audit(engine, own_site, ago_hours=-2, pages_not_read=3)  # finished, but it couldn't read every page
    assert _finding(client, task) is None


def test_a_whole_site_problem_counts_as_still_there(client, engine, own_site):
    task = _health_task(client, own_site, "ssl_expiring")
    _audit(engine, own_site, ago_hours=-1, site_problems=["ssl_expiring"])
    assert _finding(client, task) is None
    _audit(engine, own_site, ago_hours=-2)
    assert _finding(client, task)["state"] == "gone"


def test_a_link_task_notices_too(client, engine, own_site):
    task = _link_task(client, own_site)
    _scan(engine, own_site, "https://shop.example/old", ago_hours=-1)
    assert _finding(client, task) is None
    _scan(engine, own_site, "https://shop.example/other", ago_hours=-2)
    assert _finding(client, task)["state"] == "gone"


def test_a_check_that_skipped_other_websites_says_nothing_about_them(client, engine, own_site):
    outside = _link_task(client, own_site, "https://partner.example/page")
    inside = _link_task(client, own_site, "https://shop.example/old")
    _scan(engine, own_site, ago_hours=-1, check_external=0, external_not_checked=4)
    assert _finding(client, outside) is None
    assert _finding(client, inside)["state"] == "gone"  # its own pages were all read


def test_a_finished_task_says_when_its_problem_is_back(client, engine, own_site):
    task = _health_task(client, own_site)
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    assert _finding(client, task) is None
    _audit(engine, own_site, ago_hours=-1)
    assert _finding(client, task) is None  # finished, and it stayed fixed
    _audit(engine, own_site, "broken_pages", ago_hours=-2)
    assert _finding(client, task)["state"] == "back"


def test_a_task_with_no_checkable_finding_has_no_opinion(client, engine, own_site):
    keyword = make(client, source={"type": "keyword", "label": "x", "key": "keyword|visa|google"})
    plain = make(client, title="Written by hand")
    odd = make(client, title="Odd", source={"type": "health", "key": "health|sample-site|broken_pages"})
    _audit(engine, own_site, ago_hours=-1)
    assert _finding(client, keyword) is None and _finding(client, plain) is None and _finding(client, odd) is None



def test_a_task_keeps_the_pages_and_keywords_it_is_about(client):
    task = make(client, pages=[" /visa/ ", "/visa/", "/VISA/", ""], keywords=["Visa Séville", "visa séville", "titre de séjour"])
    assert task["pages"] == ["/visa/"]
    assert task["keywords"] == ["Visa Séville", "titre de séjour"]
    assert client.get("/api/tasks").json["tasks"][0]["keywords"] == ["Visa Séville", "titre de séjour"]
    changed = client.patch(f"/api/tasks/{task['id']}", json={"pages": ["/tax/"]}).json
    assert changed["pages"] == ["/tax/"] and changed["keywords"] == ["Visa Séville", "titre de séjour"]
    emptied = client.patch(f"/api/tasks/{task['id']}", json={"pages": [], "keywords": None}).json
    assert emptied["pages"] == [] and emptied["keywords"] == []


def test_a_task_with_no_pages_or_keywords_says_so_with_empty_lists(client):
    task = make(client)
    assert task["pages"] == [] and task["keywords"] == []


@pytest.mark.parametrize("body", [
    {"pages": "/visa/"}, {"keywords": [5]}, {"keywords": {"a": 1}},
    {"pages": ["/" + "x" * 500]}, {"keywords": ["x" * 191]},
    {"keywords": [f"word {n}" for n in range(51)]},
])
def test_bad_pages_and_keywords_are_refused(client, body):
    assert client.post("/api/tasks", json={"title": "x", **body}).status_code == 400


def test_a_comment_carries_the_signed_in_account_name_whatever_was_sent(engine):
    from seo.accounts import service as accounts

    accounts.create_user(engine, "sara@example.com", "Sara Account", "admin", password="a-long-password-1", must_change=False)
    client = create_app(engine=engine, auth=True, secret_key="test").test_client()
    token = client.post("/api/auth/login", json={"email": "sara@example.com", "password": "a-long-password-1"}).json["csrf"]
    headers = {"X-CSRF-Token": token}
    task = client.post("/api/tasks", json={"title": "x"}, headers=headers).json
    after = client.post(f"/api/tasks/{task['id']}/comments", json={"text": "Done", "name": "Somebody else"}, headers=headers).json
    assert after["comments"][0]["name"] == "Sara Account"


def test_created_by_is_the_signed_in_account_and_never_changes(engine):
    from seo.accounts import service as accounts

    accounts.create_user(engine, "sara@example.com", "Sara Account", "admin", password="a-long-password-1", must_change=False)
    client = create_app(engine=engine, auth=True, secret_key="test").test_client()
    token = client.post("/api/auth/login", json={"email": "sara@example.com", "password": "a-long-password-1"}).json["csrf"]
    headers = {"X-CSRF-Token": token}
    assert client.post("/api/tasks", json={"title": "x", "created_by": "Ben"}, headers=headers).status_code == 400
    task = client.post("/api/tasks", json={"title": "x", "owner_label": "Ben"}, headers=headers).json
    assert (task["created_by"], task["owner_label"]) == ("Sara Account", "Ben")
    assert client.patch(f"/api/tasks/{task['id']}", json={"created_by": "Ben"}, headers=headers).status_code == 400
    moved = client.patch(f"/api/tasks/{task['id']}", json={"owner_label": "Nour"}, headers=headers).json
    assert (moved["created_by"], moved["owner_label"]) == ("Sara Account", "Nour")  # reassigned, creator kept
