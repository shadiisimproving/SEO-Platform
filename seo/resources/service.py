"""Links and documents per site. No files are stored: a resource points at where the document lives."""
from __future__ import annotations

from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.core.errors import NotFound, Refused


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


def _clean(body: dict) -> dict:
    title = body.get("title")
    title = title.strip() if isinstance(title, str) else ""
    if not title:
        raise Refused("A resource needs a title.")
    if len(title) > 255:
        raise Refused("That title is too long.")
    url = body.get("url")
    url = url.strip() if isinstance(url, str) else ""
    if url:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise Refused("A link starts with https://.")
    for name in ("kind", "notes"):
        if body.get(name) is not None and not isinstance(body[name], str):
            raise Refused("That isn't text.")
    return {"t": title, "u": url or None, "k": (body.get("kind") or "").strip()[:40] or None, "n": (body.get("notes") or "").strip() or None, "s": body.get("site_id")}


def _row(row) -> dict:
    return {"id": row["id"], "site_id": row["site_id"], "host": row["host"], "title": row["title"], "url": row["url"], "kind": row["kind"], "notes": row["notes"], "created_by": row["created_by"], "created_at": _iso(row["created_at"])}


_SELECT = "SELECT r.*, s.host FROM resources r LEFT JOIN sites s ON s.id = r.site_id"


def list_resources(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        return [_row(row) for row in conn.execute(text(f"{_SELECT} WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC, r.id DESC")).mappings().all()]


def get(engine: Engine, resource_id: int) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text(f"{_SELECT} WHERE r.id = :i"), {"i": resource_id}).mappings().first()
    if row is None:
        raise NotFound("That resource doesn't exist.")
    return _row(row)


def _check_site(conn, site_id) -> None:
    if site_id is not None and not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": site_id}).first():
        raise Refused("That site isn't one of yours.")


def create(engine: Engine, body: dict, author: str | None = None) -> dict:
    values = _clean(body)
    with engine.begin() as conn:
        _check_site(conn, values["s"])
        new_id = conn.execute(text("INSERT INTO resources (site_id, title, url, kind, notes, created_by) VALUES (:s, :t, :u, :k, :n, :a)"), {**values, "a": author}).lastrowid
    return get(engine, new_id)


def update(engine: Engine, resource_id: int, body: dict) -> dict:
    values = _clean(body)
    with engine.begin() as conn:
        _check_site(conn, values["s"])
        done = conn.execute(text("UPDATE resources SET site_id = :s, title = :t, url = :u, kind = :k, notes = :n WHERE id = :i AND deleted_at IS NULL"), {**values, "i": resource_id}).rowcount
        if not done and not conn.execute(text("SELECT 1 FROM resources WHERE id = :i AND deleted_at IS NULL"), {"i": resource_id}).first():
            raise NotFound("That resource doesn't exist.")
    return get(engine, resource_id)


def delete(engine: Engine, resource_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(text("UPDATE resources SET deleted_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": resource_id})


def restore(engine: Engine, resource_id: int) -> dict:
    with engine.begin() as conn:
        conn.execute(text("UPDATE resources SET deleted_at = NULL WHERE id = :i"), {"i": resource_id})
    return get(engine, resource_id)
