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
        conn.execute(text("UPDATE login_failures SET locked_until = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND"))
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


# ---- usernames: sign-in takes a username or an email ------------------------------------------------
def test_a_username_can_sign_in(app, engine):
    service.create_user(engine, "alex", "Alex", "admin", password=PASSWORD, must_change=False)
    client, _ = _signed_in(app, "alex")
    assert client.get("/api/auth/me").get_json()["user"]["email"] == "alex"


def test_a_username_ignores_capitals_and_spaces(app, engine):
    service.create_user(engine, "  Alex ", "Alex", "admin", password=PASSWORD, must_change=False)
    assert app.test_client().post("/api/auth/login", json={"email": " ALEX ", "password": PASSWORD}).status_code == 200


def test_an_email_still_works(app, engine):
    _admin(engine)
    _signed_in(app)


@pytest.mark.parametrize("bad", ["", "ab", "has space", "x@y", "<b>me</b>", "a/b", "-dash", "a" * 61, None, 5])
def test_a_username_that_cant_work_is_refused(engine, bad):
    with pytest.raises(Refused):
        service.create_user(engine, bad, "Someone", "member")


@pytest.mark.parametrize("good", ["alex", "alex.k", "alex_k", "alex-1", "abc"])
def test_ordinary_usernames_are_accepted(engine, good):
    assert service.create_user(engine, good, "Someone", "member")[0]["email"] == good


def test_two_people_cant_share_a_username(engine):
    service.create_user(engine, "alex", "One", "member")
    with pytest.raises(Refused):
        service.create_user(engine, "ALEX", "Two", "member")


def test_a_username_gets_the_same_password_rules(engine):
    with pytest.raises(Refused):
        service.create_user(engine, "alex", "Alex", "admin", password="123456789")


def test_a_wrong_password_locks_a_username_as_it_locks_an_email(app, engine):
    service.create_user(engine, "alex", "Alex", "admin", password=PASSWORD, must_change=False)
    client = app.test_client()
    for _ in range(service.MAX_FAILURES):
        assert client.post("/api/auth/login", json={"email": "alex", "password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alex", "password": PASSWORD}).status_code == 401


def test_an_admin_can_add_a_person_by_username(app, engine):
    _admin(engine)
    client, headers = _signed_in(app)
    made = client.post("/api/team", json={"email": "nour", "name": "Nour", "role": "member"}, headers=headers)
    assert made.status_code == 201 and made.get_json()["user"]["email"] == "nour"


def test_the_login_page_doesnt_insist_on_an_email():
    from pathlib import Path

    page = (Path(__file__).resolve().parent.parent / "design" / "mockups" / "login.html").read_text(encoding="utf-8")
    assert 'id="email" type="text"' in page and "Username or email" in page


def _login(app, password, ip, **extra):
    return app.test_client().post("/api/auth/login", json={"email": "boss@example.com", "password": password}, environ_overrides={"REMOTE_ADDR": ip}, **extra)


def test_failures_from_one_address_dont_lock_out_another(app, engine):
    _admin(engine)
    for _ in range(service.MAX_FAILURES):
        _login(app, "nope", "203.0.113.9")
    assert _login(app, PASSWORD, "203.0.113.9").status_code == 401
    assert _login(app, PASSWORD, "198.51.100.1").status_code == 200


def test_failures_from_many_addresses_still_lock_the_account(app, engine):
    _admin(engine)
    for number in range(service.MAX_ACCOUNT_FAILURES):
        _login(app, "nope", f"203.0.113.{number % 250}")
    assert _login(app, PASSWORD, "198.51.100.1").status_code == 401


def test_a_forwarded_header_cant_dodge_the_lock(app, engine):
    _admin(engine)
    for number in range(service.MAX_FAILURES):
        _login(app, "nope", "203.0.113.9", headers={"X-Forwarded-For": f"10.0.0.{number}"})
    assert _login(app, PASSWORD, "203.0.113.9", headers={"X-Forwarded-For": "10.0.0.99"}).status_code == 401


def test_failures_long_ago_dont_add_up(app, engine):
    _admin(engine)
    for _ in range(service.MAX_FAILURES - 1):
        _login(app, "nope", "203.0.113.9")
    with engine.begin() as conn:
        conn.execute(text("UPDATE login_failures SET last_failed_at = last_failed_at - INTERVAL 1 DAY"))
    _login(app, "nope", "203.0.113.9")
    assert _login(app, PASSWORD, "203.0.113.9").status_code == 200


def test_a_password_reset_clears_the_locks(app, engine):
    user_id = _admin(engine)["id"]
    for _ in range(service.MAX_FAILURES):
        _login(app, "nope", "203.0.113.9")
    temporary = service.reset_password(engine, user_id)
    assert _login(app, temporary, "203.0.113.9").status_code == 200


def test_signing_out_ends_the_session_on_the_server(app, engine):
    _admin(engine)
    client, csrf = _signed_in(app)
    cookie = client.get_cookie(app.config["SESSION_COOKIE_NAME"]).value
    assert client.post("/api/auth/logout", headers=csrf).status_code == 200
    copied = app.test_client()
    copied.set_cookie(app.config["SESSION_COOKIE_NAME"], cookie)
    assert copied.get("/api/auth/me").status_code == 401


def test_a_request_past_the_size_limit_is_refused_with_a_reason(app, engine):
    _admin(engine)
    client, csrf = _signed_in(app)
    reply = client.post("/api/backlinks/bulk", data=b"x" * (app.config["MAX_CONTENT_LENGTH"] + 1), content_type="application/json", headers=csrf)
    assert reply.status_code == 413 and "too large" in reply.get_json()["error"]
