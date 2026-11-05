"""Login: who gets in, what they can reach, and that a stolen or old session stops working."""
import pytest
from sqlalchemy import text

from seo.accounts import service
from seo.core.errors import Refused
from seo.web import create_app

PASSWORD = "correct horse battery"


@pytest.fixture
def app(engine):
    return create_app(engine=engine, secret_key="test-secret-key")


def _admin(engine, email="boss@example.com", must_change=False):
    user, _ = service.create_user(engine, email, "Boss", "admin", password=PASSWORD, must_change=must_change)
    return user


def _signed_in(app, email="boss@example.com", password=PASSWORD):
    client = app.test_client()
    reply = client.post("/api/auth/login", json={"email": email, "password": password})
    assert reply.status_code == 200, reply.get_json()
    return client, {"X-CSRF-Token": reply.get_json()["csrf"]}


def test_every_api_is_closed_without_a_session(app, engine):
    _admin(engine)
    client = app.test_client()
    for path in ("/api/links/sites", "/api/tasks", "/api/team", "/api/alerts"):
        reply = client.get(path)
        assert reply.status_code == 401 and reply.get_json()["signed_out"] is True


def test_every_registered_route_is_guarded(app, engine):
    """A new blueprint is protected without anyone remembering to. Only the login call itself is open."""
    _admin(engine)
    client = app.test_client()
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/") or rule.rule == "/api/auth/login" or "static" in rule.endpoint:
            continue
        method = next(iter(rule.methods - {"HEAD", "OPTIONS"}))
        path = rule.rule.replace("<int:", "<").replace("<path:", "<")
        import re
        path = re.sub(r"<[^>]+>", "1", path)
        assert client.open(path, method=method).status_code == 401, rule.rule


def test_right_password_gets_in_and_email_case_does_not_matter(app, engine):
    _admin(engine)
    client, _ = _signed_in(app, "BOSS@Example.com")
    assert client.get("/api/links/sites").status_code == 200


def test_wrong_password_and_unknown_email_read_the_same(app, engine):
    _admin(engine)
    client = app.test_client()
    wrong = client.post("/api/auth/login", json={"email": "boss@example.com", "password": "nope"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.get_json() == unknown.get_json()


def test_repeated_failures_lock_the_account_even_for_the_right_password(app, engine):
    _admin(engine)
    client = app.test_client()
    for _ in range(service.MAX_FAILURES):
        client.post("/api/auth/login", json={"email": "boss@example.com", "password": "nope"})
    assert client.post("/api/auth/login", json={"email": "boss@example.com", "password": PASSWORD}).status_code == 401
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET locked_until = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND"))
    assert client.post("/api/auth/login", json={"email": "boss@example.com", "password": PASSWORD}).status_code == 200


def test_a_change_needs_the_csrf_token(app, engine):
    _admin(engine)
    client, csrf = _signed_in(app)
    assert client.post("/api/tasks", json={"title": "x"}).status_code == 403
    assert client.post("/api/tasks", json={"title": "x"}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post("/api/tasks", json={"title": "x"}, headers=csrf).status_code == 201


def test_a_temporary_password_only_opens_the_change_password_call(app, engine):
    user, temp = service.create_user(engine, "new@example.com", "New")
    client, csrf = _signed_in(app, "new@example.com", temp)
    reply = client.get("/api/links/sites")
    assert reply.status_code == 403 and reply.get_json()["must_change"] is True
    assert client.get("/").status_code in (302, 404)
    assert client.post("/api/auth/password", json={"current": "wrong", "new": PASSWORD}, headers=csrf).status_code == 400
    assert client.post("/api/auth/password", json={"current": temp, "new": "short"}, headers=csrf).status_code == 400
    assert client.post("/api/auth/password", json={"current": temp, "new": temp}, headers=csrf).status_code == 400
    assert client.post("/api/auth/password", json={"current": temp, "new": PASSWORD}, headers=csrf).status_code == 200
    assert client.get("/api/links/sites").status_code == 200


def test_changing_a_password_ends_other_sessions_but_not_this_one(app, engine):
    _admin(engine)
    other, _ = _signed_in(app)
    client, csrf = _signed_in(app)
    assert client.post("/api/auth/password", json={"current": PASSWORD, "new": "another good password"}, headers=csrf).status_code == 200
    assert client.get("/api/links/sites").status_code == 200
    assert other.get("/api/links/sites").status_code == 401


def test_disabling_someone_ends_their_session_at_once(app, engine):
    _admin(engine)
    member, _ = service.create_user(engine, "m@example.com", "Member", password=PASSWORD, must_change=False)
    theirs, _ = _signed_in(app, "m@example.com")
    client, csrf = _signed_in(app)
    assert client.patch(f"/api/team/{member['id']}", json={"disabled": True}, headers=csrf).status_code == 200
    assert theirs.get("/api/links/sites").status_code == 401
    assert app.test_client().post("/api/auth/login", json={"email": "m@example.com", "password": PASSWORD}).status_code == 401


def test_only_an_admin_manages_the_team_and_a_member_sees_names_only(app, engine):
    _admin(engine)
    service.create_user(engine, "m@example.com", "Member", password=PASSWORD, must_change=False)
    client, csrf = _signed_in(app, "m@example.com")
    assert client.post("/api/team", json={"email": "x@example.com", "name": "X"}, headers=csrf).status_code == 403
    assert client.post("/api/team/1/reset", headers=csrf).status_code == 403
    listed = client.get("/api/team").get_json()
    assert "users" not in listed and sorted(listed["names"]) == ["Boss", "Member"]


def test_admin_creates_someone_and_the_temporary_password_shows_once(app, engine):
    _admin(engine)
    client, csrf = _signed_in(app)
    reply = client.post("/api/team", json={"email": "New@Example.com", "name": " New ", "role": "member"}, headers=csrf)
    assert reply.status_code == 201
    body = reply.get_json()
    assert body["user"]["email"] == "new@example.com" and body["user"]["must_change_password"] is True
    assert "temporary_password" not in str(client.get("/api/team").get_json())
    assert "password_hash" not in str(client.get("/api/team").get_json())
    assert client.post("/api/team", json={"email": "new@example.com", "name": "Twice"}, headers=csrf).status_code == 400


def test_reset_gives_a_new_temporary_password_and_ends_their_session(app, engine):
    _admin(engine)
    member, _ = service.create_user(engine, "m@example.com", "Member", password=PASSWORD, must_change=False)
    theirs, _ = _signed_in(app, "m@example.com")
    client, csrf = _signed_in(app)
    temp = client.post(f"/api/team/{member['id']}/reset", headers=csrf).get_json()["temporary_password"]
    assert theirs.get("/api/links/sites").status_code == 401
    again, _ = _signed_in(app, "m@example.com", temp)
    assert again.get("/api/links/sites").get_json()["must_change"] is True


def test_the_last_admin_cannot_be_taken_away(engine):
    boss = _admin(engine)
    with pytest.raises(Refused):
        service.update_user(engine, boss["id"], {"role": "member"})
    with pytest.raises(Refused):
        service.update_user(engine, boss["id"], {"disabled": True})
    second, _ = service.create_user(engine, "two@example.com", "Two", "admin")
    assert service.update_user(engine, boss["id"], {"role": "member"})["role"] == "member"
    with pytest.raises(Refused):
        service.update_user(engine, second["id"], {"disabled": True})


def test_a_tampered_cookie_is_refused(app, engine):
    _admin(engine)
    client = app.test_client()
    client.set_cookie("seo_cc_session", "eyJ1aWQiOjF9.bad.signature")
    assert client.get("/api/links/sites").status_code == 401


def test_cookie_flags_are_safe(app, engine):
    _admin(engine)
    reply = app.test_client().post("/api/auth/login", json={"email": "boss@example.com", "password": PASSWORD})
    cookie = reply.headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie
