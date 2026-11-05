"""The people and agencies who place links. Links keep the name as typed, so a rename here carries over to them."""
from __future__ import annotations

import re

from sqlalchemy import Engine, text

from seo.core.errors import Conflict, NotFound, Refused

LIMITS = {"name": 180, "contact": 250, "platform": 180, "price_text": 60, "notes": 5000}
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def name_key(name: str) -> str:
    """One person, however it's spelled: case and spacing don't make two of them."""
    return " ".join(name.casefold().split())[:190]


def _text(body: dict, field: str, required: bool = False) -> str | None:
    value = body.get(field)
    if value is None or value == "":
        if required:
            raise Refused("A mediator needs a name.")
        return None
    if not isinstance(value, str):
        raise Refused(f"{field} must be text.")
    clean = _CONTROL.sub("", value).strip()
    if not clean:
        if required:
            raise Refused("A mediator needs a name.")
        return None
    if len(clean) > LIMITS[field]:
        raise Refused(f"{field} is too long. The limit is {LIMITS[field]:,} characters.")
    return clean


def _answer(row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "contact": row["contact"], "platform": row["platform"], "price_text": row["price_text"], "notes": row["notes"],
        "links": int(row["links"] or 0), "live": int(row["live"] or 0), "lost": int(row["lost"] or 0), "planned": int(row["planned"] or 0),
    }


_LIST = (
    "SELECT m.*, COUNT(b.id) AS links, SUM(b.status = 'live') AS live, SUM(b.status = 'lost') AS lost, SUM(b.status = 'planned') AS planned "
    "FROM mediators m LEFT JOIN backlinks b ON b.mediator = m.name AND b.status IN ('live', 'lost', 'planned') {where} GROUP BY m.id ORDER BY m.name"
)


def list_all(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        return [_answer(row) for row in conn.execute(text(_LIST.format(where=""))).mappings()]


def _one(conn, mediator_id: int) -> dict:
    row = conn.execute(text(_LIST.format(where="WHERE m.id = :i")), {"i": mediator_id}).mappings().first()
    if row is None:
        raise NotFound("That mediator doesn't exist.")
    return _answer(row)


def create(engine: Engine, body: dict) -> dict:
    name = _text(body, "name", required=True)
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM mediators WHERE name_key = :k"), {"k": name_key(name)}).first():
            raise Conflict("There is already a mediator with that name.")
        new_id = conn.execute(
            text("INSERT INTO mediators (name, name_key, contact, platform, price_text, notes) VALUES (:n, :k, :c, :p, :t, :o)"),
            {"n": name, "k": name_key(name), "c": _text(body, "contact"), "p": _text(body, "platform"), "t": _text(body, "price_text"), "o": _text(body, "notes")},
        ).lastrowid
        return _one(conn, new_id)


def update(engine: Engine, mediator_id: int, body: dict) -> dict:
    extra = sorted(set(body) - set(LIMITS))
    if extra:
        raise Refused(f"Only {', '.join(sorted(LIMITS))} are accepted. This request also sent: {', '.join(extra)}.")
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM mediators WHERE id = :i FOR UPDATE"), {"i": mediator_id}).mappings().first()
        if row is None:
            raise NotFound("That mediator doesn't exist.")
        values = {field: _text(body, field, required=field == "name") if field in body else row[field] for field in LIMITS}
        key = name_key(values["name"])
        if key != row["name_key"] and conn.execute(text("SELECT 1 FROM mediators WHERE name_key = :k AND id <> :i"), {"k": key, "i": mediator_id}).first():
            raise Conflict("There is already a mediator with that name.")
        conn.execute(
            text("UPDATE mediators SET name = :name, name_key = :key, contact = :contact, platform = :platform, price_text = :price_text, notes = :notes WHERE id = :id"),
            {**values, "key": key, "id": mediator_id},
        )
        if values["name"] != row["name"]:
            conn.execute(text("UPDATE backlinks SET mediator = :new WHERE mediator = :old"), {"new": values["name"], "old": row["name"]})
        return _one(conn, mediator_id)


def ensure_from_rows(conn, rows: list[dict]) -> None:
    """A name typed on a link or in a spreadsheet makes the mediator: that's Create new, with nothing extra to press.

    What's already known about someone stays. A link only fills in what's still blank.
    """
    for row in rows:
        name = row.get("mediator")
        if not name:
            continue
        name = name.strip()[:LIMITS["name"]]
        conn.execute(
            text(
                "INSERT INTO mediators (name, name_key, contact, platform) VALUES (:n, :k, :c, :p) "
                "ON DUPLICATE KEY UPDATE contact = COALESCE(contact, VALUES(contact)), platform = COALESCE(platform, VALUES(platform))"
            ),
            {"n": name, "k": name_key(name), "c": row.get("contact"), "p": row.get("platform")},
        )
