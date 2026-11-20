"""Login on every page and API, CSRF tokens on every change, and the Team API.

The session is a signed cookie holding the account id and a session version kept in the database, so changing a
password or disabling someone ends their sessions at once. Everything is refused by default: a new blueprint is
protected without having to remember to be.
"""
from __future__ import annotations

import hmac
import secrets
from datetime import timedelta

from flask import Blueprint, current_app, g, jsonify, redirect, request, session

from seo.accounts import service
from seo.core.errors import Forbidden, Refused

auth_api = Blueprint("auth_api", __name__, url_prefix="/api")
SAFE = {"GET", "HEAD", "OPTIONS"}
# The login page needs these before anyone has signed in. Nothing else is public.
PUBLIC_FILES = ("login.html", "login.js", "mockup.css", "look-clear.css", "purify.min.js")
PUBLIC_APIS = {"/api/auth/login"}


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


def _start_session(user: dict, version: int) -> None:
    session.clear()  # a new session id's worth of state: nothing from before login carries over
    session.permanent = True
    session["uid"] = user["id"]
    session["sv"] = version
    session["csrf"] = secrets.token_urlsafe(24)


def install(app, secret_key: str, https: bool = False) -> None:
    app.secret_key = secret_key
    app.config.update(
        SESSION_COOKIE_NAME="seo_cc_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=https,
        PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    )
    app.register_blueprint(auth_api)

    @app.before_request
    def guard():
        path = request.path
        if path in PUBLIC_APIS or path == "/login" or path.lstrip("/") in PUBLIC_FILES or path.startswith("/fonts/"):
            return None
        if path.startswith("/api/social/bot/"):
            return None  # the Social helpers sign in with their site's token, checked in seo.web.social_api
        user = service.session_user(_engine(), session.get("uid"), session.get("sv"))
        if user is None:
            session.clear()
            if path.startswith("/api/"):
                return jsonify(error="Please sign in.", signed_out=True), 401
            return redirect("login")
        g.user = user
        if path.startswith("/api/") and request.method not in SAFE:
            sent = request.headers.get("X-CSRF-Token", "")
            if not hmac.compare_digest(sent, session.get("csrf", "")):
                return jsonify(error="Page out of date. Reload and try again."), 403
        if user["must_change_password"] and not path.startswith("/api/auth/"):
            if path.startswith("/api/"):
                return jsonify(error="Change your temporary password first.", must_change=True), 403
            return redirect("login?change=1")
        if path.startswith("/api/"):
            from seo.accounts.access import NoAccess, check
            try:
                check(_engine(), request)
            except NoAccess as refusal:
                return jsonify(error=str(refusal), no_access=True), 403
        return None

    @app.after_request
    def harden(response):
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        return response


def require_admin() -> None:
    user = getattr(g, "user", None)
    # With login switched off for a test harness there is no account to check.
    if current_app.config.get("AUTH_ON") and (user is None or user["role"] != "admin"):
        raise Forbidden("Only an admin can do that.")


def current_name() -> str | None:
    user = getattr(g, "user", None)
    return user["name"] if user else None


@auth_api.post("/auth/login")
def login():
    body = _body()  # JSON only: a form on another site can't send this
    # The address the connection really came from. A forwarded header could be anything the sender likes.
    found = service.login(_engine(), body.get("email"), body.get("password"), request.remote_addr or "")
    if found is None:
        return jsonify(error=service.WRONG), 401
    user, version = found
    _start_session(user, version)
    return jsonify(user=user, csrf=session["csrf"])


@auth_api.post("/auth/logout")
def logout():
    user = getattr(g, "user", None)
    if user:
        service.end_sessions(_engine(), user["id"])
    session.clear()
    return jsonify(ok=True)


@auth_api.get("/auth/me")
def me():
    return jsonify(user=g.user, csrf=session.get("csrf"), team=service.team_names(_engine()))


@auth_api.post("/auth/password")
def change_password():
    body = _body()
    version = service.change_password(_engine(), g.user["id"], body.get("current"), body.get("new"))
    user = service.get(_engine(), g.user["id"])
    _start_session(user, version)
    return jsonify(user=user, csrf=session["csrf"])


@auth_api.get("/team")
def team():
    if g.get("user") and g.user["role"] != "admin":
        return jsonify(names=service.team_names(_engine()))
    return jsonify(users=service.list_users(_engine()), names=service.team_names(_engine()))


@auth_api.post("/team")
def create_user():
    require_admin()
    body = _body()
    user, password = service.create_user(_engine(), body.get("email"), body.get("name"), body.get("role", "member"), access=body.get("access"))
    return jsonify(user=user, temporary_password=password), 201


@auth_api.patch("/team/<int:user_id>")
def update_user(user_id: int):
    require_admin()
    return jsonify(service.update_user(_engine(), user_id, _body()))


@auth_api.post("/team/<int:user_id>/reset")
def reset_password(user_id: int):
    require_admin()
    return jsonify(temporary_password=service.reset_password(_engine(), user_id))
