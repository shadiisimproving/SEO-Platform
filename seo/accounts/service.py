"""Accounts. The admin creates each person, who changes the temporary password at first login. There is no sign-up.

Times come from the database, in UTC, like everywhere else in the app.
"""
from __future__ import annotations

import json
import re
import secrets

from sqlalchemy import Engine, text
from werkzeug.security import check_password_hash, generate_password_hash

from seo.accounts import access as access_rules
from seo.core.errors import NotFound, Refused

MAX_FAILURES = 5  # from one address
MAX_ACCOUNT_FAILURES = 50  # from everywhere, for guesses spread over many addresses
FAILURE_WINDOW_MINUTES = 60  # older wrong passwords don't add up
LOCK_MINUTES = 15
MIN_PASSWORD = 10
ROLES = ("admin", "member")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{2,59}$")
# Checked when the email is unknown, so an unknown address takes as long to refuse as a known one.
_DUMMY_HASH = generate_password_hash(secrets.token_urlsafe(16))
WRONG = f"Wrong username or password, or too many tries: wait {LOCK_MINUTES} minutes."  # login.js has its French
_PUBLIC = "id, email, name, role, access, must_change_password, disabled, last_login_at, created_at, locked_until > UTC_TIMESTAMP(3) AS locked"


def _email(value) -> str:
    """What someone signs in with: a username or an email. Both live in the `email` column, which is unique."""
    email = value.strip().lower() if isinstance(value, str) else ""
    if not (_EMAIL.match(email) or _USERNAME.match(email)) or len(email) > 190:
        raise Refused("Enter a username of at least 3 letters or numbers, or an email address.")
    return email


def _name(value) -> str:
    name = value.strip() if isinstance(value, str) else ""
    if not name:
        raise Refused("Enter a name.")
    if len(name) > 120:
        raise Refused("Name too long.")
    return name


def _role(value) -> str:
    if value not in ROLES:
        raise Refused("A role is admin or member.")
    return value


def _check_new_password(password) -> str:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        raise Refused(f"Use at least {MIN_PASSWORD} characters.")
    if len(password) > 200:
        raise Refused("Password too long.")
    return password


def temporary_password() -> str:
    return secrets.token_urlsafe(12)


def _public(row) -> dict:
    return {
        "id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"],
        # Admins always have everything, whatever was saved before they became admin.
        "access": None if row["role"] == "admin" else access_rules.parse(row["access"]),
        "must_change_password": bool(row["must_change_password"]), "disabled": bool(row["disabled"]), "locked": bool(row["locked"]),
        "last_login_at": row["last_login_at"].isoformat() + "Z" if row["last_login_at"] else None,
        "created_at": row["created_at"].isoformat() + "Z" if row["created_at"] else None,
    }


def count_users(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text("SELECT COUNT(*) FROM users")).scalar())


def create_user(engine: Engine, email, name, role="member", password: str | None = None, must_change: bool = True, access=None) -> tuple[dict, str]:
    """The account, and its temporary password, shown once. `access` None is full access; a dict chooses sites and sections."""
    email, name, role = _email(email), _name(name), _role(role)
    plain = _check_new_password(password) if password else temporary_password()
    with engine.begin() as conn:
        chosen = None if role == "admin" else access_rules.clean(access, conn)
        if conn.execute(text("SELECT 1 FROM users WHERE email = :e"), {"e": email}).first():
            raise Refused("There is already an account with that username or email.")
        _name_free(conn, name)
        result = conn.execute(
            text("INSERT INTO users (email, name, password_hash, role, access, must_change_password) VALUES (:e, :n, :p, :r, :a, :m)"),
            {"e": email, "n": name, "p": generate_password_hash(plain), "r": role, "a": json.dumps(chosen) if chosen else None, "m": must_change},
        )
        user_id = result.lastrowid
    return get(engine, user_id), plain


def get(engine: Engine, user_id: int) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(text(f"SELECT {_PUBLIC} FROM users WHERE id = :i"), {"i": user_id}).mappings().first()
    return _public(row) if row else None


def list_users(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT {_PUBLIC} FROM users ORDER BY disabled, name")).mappings().all()
    return [_public(row) for row in rows]


def team_names(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        return [row[0] for row in conn.execute(text("SELECT name FROM users WHERE disabled = 0 ORDER BY name")).all()]


def admin_names(engine: Engine) -> list[str]:
    """Who to ask for more access: the working admins."""
    with engine.connect() as conn:
        return [row[0] for row in conn.execute(text("SELECT name FROM users WHERE disabled = 0 AND role = 'admin' ORDER BY id")).all()]


def task_assignees(conn, site_ids, every_site: bool) -> dict:
    """For each of the asker's own sites, and "all" when they have every site: who can be given a task there, with
    "edit" or "view". Only the asker's own sites are answered, so nobody learns about a site they don't have."""
    own = [row[0] for row in conn.execute(text("SELECT id FROM sites WHERE kind = 'own'"))]
    people = conn.execute(text("SELECT name, role, access FROM users WHERE disabled = 0 ORDER BY name")).mappings().all()
    keys = [*site_ids, *([None] if every_site else [])]
    answer = {}
    for site_id in keys:
        here = {}
        for person in people:
            level = access_rules.task_level(person["role"], person["access"], site_id, own)
            if level:
                here[person["name"]] = level
        answer["all" if site_id is None else str(site_id)] = here
    return answer


def _name_free(conn, name: str, user_id: int | None = None) -> None:
    """Tasks are assigned by name, so two people can't share one."""
    taken = conn.execute(
        text("SELECT 1 FROM users WHERE LOWER(name) = LOWER(:n) AND (:i IS NULL OR id <> :i)"), {"n": name, "i": user_id}
    ).first()
    if taken:
        raise Refused("Someone in the team already has that name. Add a surname or an initial.")


def login(engine: Engine, email, password, source: str = "") -> tuple[dict, int] | None:
    """The account and its session version, or None. It never says which of the two was wrong.

    `source` is the address asking. Wrong passwords lock that address out of that account, so a stranger's guesses
    can't keep the owner out. Far more of them, from anywhere, lock the account itself.
    """
    source = source[:45] if isinstance(source, str) else ""
    address = email.strip().lower() if isinstance(email, str) else ""
    plain = password if isinstance(password, str) else ""
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT id, password_hash, disabled, session_version, locked_until > UTC_TIMESTAMP(3) AS locked FROM users WHERE email = :e FOR UPDATE"),
            {"e": address},
        ).mappings().first()
        if row is None:
            check_password_hash(_DUMMY_HASH, plain)
            return None
        good = check_password_hash(row["password_hash"], plain)
        here = {"i": row["id"], "a": source}
        address_locked = conn.execute(text("SELECT locked_until > UTC_TIMESTAMP(3) FROM login_failures WHERE user_id = :i AND source = :a FOR UPDATE"), here).scalar()
        if row["disabled"] or row["locked"] or address_locked:  # even the right password can't get in, and the answer doesn't show that
            return None
        if not good:
            conn.execute(
                text(
                    "INSERT INTO login_failures (user_id, source, failures, last_failed_at) VALUES (:i, :a, 1, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE "
                    "failures = IF(last_failed_at < UTC_TIMESTAMP(3) - INTERVAL :w MINUTE, 1, failures + 1), last_failed_at = UTC_TIMESTAMP(3)"
                ),
                {**here, "w": FAILURE_WINDOW_MINUTES},
            )
            conn.execute(
                text("UPDATE login_failures SET locked_until = UTC_TIMESTAMP(3) + INTERVAL :lock MINUTE, failures = 0 WHERE user_id = :i AND source = :a AND failures >= :max"),
                {**here, "max": MAX_FAILURES, "lock": LOCK_MINUTES},
            )
            conn.execute(text("UPDATE users SET failed_logins = failed_logins + 1 WHERE id = :i"), {"i": row["id"]})
            conn.execute(
                text("UPDATE users SET locked_until = UTC_TIMESTAMP(3) + INTERVAL :lock MINUTE, failed_logins = 0 WHERE id = :i AND failed_logins >= :max"),
                {"i": row["id"], "max": MAX_ACCOUNT_FAILURES, "lock": LOCK_MINUTES},
            )
            return None
        conn.execute(text("DELETE FROM login_failures WHERE user_id = :i AND source = :a"), here)
        conn.execute(text("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": row["id"]})
        version = row["session_version"]
        user_id = row["id"]
    return get(engine, user_id), version


def session_user(engine: Engine, user_id, version) -> dict | None:
    """The account behind a session, if that session is still good."""
    if not isinstance(user_id, int):
        return None
    with engine.connect() as conn:
        row = conn.execute(text(f"SELECT {_PUBLIC}, session_version FROM users WHERE id = :i AND disabled = 0"), {"i": user_id}).mappings().first()
    if row is None or row["session_version"] != version:
        return None
    return _public(row)


def end_sessions(engine: Engine, user_id: int) -> None:
    """Signing out: the session stops working on the server too, so a copied cookie is worth nothing. It ends this person's other sessions as well."""
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET session_version = session_version + 1 WHERE id = :i"), {"i": user_id})


def change_password(engine: Engine, user_id: int, current, new) -> int:
    """Other sessions stop working. The new session version is returned, so this one carries on."""
    new = _check_new_password(new)
    with engine.begin() as conn:
        row = conn.execute(text("SELECT password_hash FROM users WHERE id = :i FOR UPDATE"), {"i": user_id}).mappings().first()
        if row is None or not check_password_hash(row["password_hash"], current if isinstance(current, str) else ""):
            raise Refused("Wrong current password.")
        if check_password_hash(row["password_hash"], new):
            raise Refused("Choose a different password.")
        conn.execute(
            text("UPDATE users SET password_hash = :p, must_change_password = 0, session_version = session_version + 1 WHERE id = :i"),
            {"p": generate_password_hash(new), "i": user_id},
        )
        return int(conn.execute(text("SELECT session_version FROM users WHERE id = :i"), {"i": user_id}).scalar())


def reset_password(engine: Engine, user_id: int) -> str:
    plain = temporary_password()
    with engine.begin() as conn:
        done = conn.execute(
            text(
                "UPDATE users SET password_hash = :p, must_change_password = 1, failed_logins = 0, locked_until = NULL, "
                "session_version = session_version + 1 WHERE id = :i"
            ),
            {"p": generate_password_hash(plain), "i": user_id},
        ).rowcount
        conn.execute(text("DELETE FROM login_failures WHERE user_id = :i"), {"i": user_id})
    if not done:
        raise NotFound("That account doesn't exist.")
    return plain


def _other_active_admins(conn, user_id: int) -> int:
    return int(conn.execute(text("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != :i"), {"i": user_id}).scalar())


def update_user(engine: Engine, user_id: int, patch: dict) -> dict:
    """Name, role, disabled, or access. The last working admin can't be taken away, or nobody could ever fix anything.

    Access narrowed (a site, a section, edit or credits taken away) signs the person out everywhere, so a page left
    open can't keep showing what they no longer have. Making someone admin clears their chosen access."""
    sets, values = [], {"i": user_id}
    if "name" in patch:
        sets.append("name = :n")
        values["n"] = _name(patch["name"])
    if "role" in patch:
        sets.append("role = :r")
        values["r"] = _role(patch["role"])
    if "disabled" in patch:
        if not isinstance(patch["disabled"], bool):
            raise Refused("Disabled is yes or no.")
        sets.append("disabled = :d")
        values["d"] = patch["disabled"]
        sets.append("session_version = session_version + 1")
    if not sets and "access" not in patch:
        raise Refused("Nothing to change.")
    with engine.begin() as conn:
        row = conn.execute(text("SELECT name, role, disabled, access FROM users WHERE id = :i FOR UPDATE"), {"i": user_id}).mappings().first()
        if row is None:
            raise NotFound("That account doesn't exist.")
        if "n" in values and values["n"] != row["name"]:
            _name_free(conn, values["n"], user_id)
            # Tasks are assigned by name: they follow the person to the new one.
            conn.execute(text("UPDATE tasks SET owner_label = :new WHERE owner_label = :old"), {"new": values["n"], "old": row["name"]})
        role_after = values.get("r", row["role"])
        if role_after == "admin":
            if row["access"] is not None:
                sets.append("access = NULL")
        elif "access" in patch:
            before, after = access_rules.parse(row["access"]), access_rules.clean(patch["access"], conn)
            sets.append("access = :a")
            values["a"] = json.dumps(after) if after else None
            if access_rules.narrower(before, after) and "session_version = session_version + 1" not in sets:
                sets.append("session_version = session_version + 1")
        if not sets:
            raise Refused("Nothing to change.")
        stops_being_admin = row["role"] == "admin" and not row["disabled"] and (patch.get("role", "admin") != "admin" or patch.get("disabled") is True)
        if stops_being_admin and not _other_active_admins(conn, user_id):
            raise Refused("This is the only admin. Make someone else admin first.")
        conn.execute(text(f"UPDATE users SET {', '.join(sets)} WHERE id = :i"), values)
    return get(engine, user_id)
