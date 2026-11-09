"""Notes on all competitors, on one competitor, on any page, on one screen of the app, or on a whole website.
Deleting keeps the text, so it can be undone.

A note can also hold images and files. They sit on disk under a random name, never the one they came with.
Only bytes that really are an image are ever shown in the browser: everything else can only be downloaded.
"""
from __future__ import annotations

import os
import re
import secrets
from pathlib import Path

from sqlalchemy import Engine, text

from seo import config
from seo.competitors import pages
from seo.competitors.keywords import _iso, require_own
from seo.core.errors import NotFound, Refused
from seo.serp.store import canonical_url

MAX_BYTES = 4_000_000  # far past any note; the column holds 16 MB
SCOPES = ("all", "competitor", "page", "site", "screen")
# The screens a note can be about: the app's menu. A name outside it would never be shown anywhere.
SCREENS = (
    "today", "channels", "conversions", "content", "overview", "keywords", "competitors", "ai", "ads",
    "tasks", "backlinks", "resources", "health", "settings",
)
WRONG_SCOPE = "A note goes on all competitors, one competitor, a page, a screen or a website."
MAX_FILE_BYTES = 25 * 1024 * 1024
UPLOAD_OVERHEAD = 1024 * 1024  # the form around the file
TOO_LARGE = "This file is too large. The limit is 25 MB."


def files_dir() -> Path:
    """On hosting this folder has to survive a deploy, like the database."""
    folder = Path(os.environ.get("SEO_NOTE_FILES") or config.VAR / "note-files")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _image_type(head: bytes) -> str | None:
    """From the bytes, never the name or what the browser claimed. SVG is left out on purpose: it can carry scripts."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def _clean_name(name) -> str:
    base = re.split(r"[\\/]", str(name or ""))[-1]
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip()
    if len(base) > 200:
        stem, dot, ending = base.rpartition(".")
        base = f"{stem[:190]}.{ending[:9]}" if dot and len(ending) < 10 else base[:200]
    return base or "file"


def _file_dict(row) -> dict:
    return {"id": row["id"], "name": row["name"], "size": row["size_bytes"], "is_image": bool(row["image_type"])}


def _files_of(conn, note_ids: list[int]) -> dict[int, list[dict]]:
    found: dict[int, list[dict]] = {}
    if note_ids:
        marks = ", ".join(str(int(n)) for n in note_ids)
        rows = conn.execute(text(f"SELECT * FROM note_files WHERE deleted_at IS NULL AND note_id IN ({marks}) ORDER BY id")).mappings().all()
        for row in rows:
            found.setdefault(row["note_id"], []).append(_file_dict(row))
    return found


def _check_body(body) -> str:
    if not isinstance(body, str):
        raise Refused("A note needs some text.")
    if len(body.encode("utf-8")) > MAX_BYTES:
        raise Refused("This note is too long to save. Your text is still here: split it into two notes.")
    return body


def _dict(row, files=()) -> dict:
    return {
        "id": row["id"], "scope": row["scope"], "site_id": row["site_id"], "competitor_id": row["competitor_id"], "competitor": row.get("competitor"),
        "page_url": row["page_url"], "screen": row["screen"], "body": row["body"], "created_at": _iso(row["created_at"]), "updated_at": _iso(row["updated_at"]),
        "deleted_at": _iso(row["deleted_at"]), "files": list(files),
    }


_SELECT = "SELECT n.*, s.host AS competitor FROM notes n LEFT JOIN sites s ON s.id = n.competitor_id"


def _one(conn, note_id: int) -> dict:
    row = conn.execute(text(f"{_SELECT} WHERE n.id = :i"), {"i": note_id}).mappings().first()
    if row is None:
        raise NotFound("That note doesn't exist.")
    return _dict(row, _files_of(conn, [note_id]).get(note_id, []))


def _clean_page(page_url) -> str:
    if not isinstance(page_url, str) or not page_url.strip():
        return ""
    return canonical_url(page_url if "://" in page_url else f"https://{page_url.strip()}")


def create(engine: Engine, scope, body, site_id=None, competitor_id=None, page_url=None, screen=None) -> dict:
    body = _check_body(body)
    if scope not in SCOPES:
        raise Refused(WRONG_SCOPE)
    if scope == "screen" and screen not in SCREENS:
        raise Refused("Say which screen this note is about.")
    if scope != "screen":
        screen = None
    if scope in ("site", "screen"):
        competitor_id = None
    if scope == "competitor" and competitor_id is None:
        raise Refused("Say which competitor this note is about.")
    if competitor_id is not None and type(competitor_id) is not int:
        raise Refused("competitor_id must be a number.")
    clean_url, hashed = None, None
    if scope == "page":
        clean_url = _clean_page(page_url)
        if not clean_url:
            raise Refused("Enter the page's address.")
        hashed = pages.url_hash(clean_url)
    with engine.begin() as conn:
        if site_id is not None:
            require_own(conn, site_id)
        if competitor_id is not None and scope != "all":
            if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'competitor'"), {"i": competitor_id}).first():
                raise NotFound("That competitor doesn't exist.")
            if site_id is not None and not conn.execute(text("SELECT 1 FROM site_competitors WHERE site_id = :s AND competitor_id = :c"), {"s": site_id, "c": competitor_id}).first():
                raise NotFound("That competitor isn't on this website.")
        note_id = conn.execute(
            text("INSERT INTO notes (scope, site_id, competitor_id, page_url, page_hash, screen, body) VALUES (:sc, :s, :c, :u, :h, :sn, :b)"),
            {"sc": scope, "s": site_id, "c": competitor_id if scope != "all" else None, "u": clean_url, "h": hashed, "sn": screen, "b": body},
        ).lastrowid
        return _one(conn, note_id)


def update(engine: Engine, note_id: int, body) -> dict:
    body = _check_body(body)
    with engine.begin() as conn:
        _one(conn, note_id)
        conn.execute(text("UPDATE notes SET body = :b, updated_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"b": body, "i": note_id})
        return _one(conn, note_id)


def delete(engine: Engine, note_id: int) -> None:
    with engine.begin() as conn:
        _one(conn, note_id)
        conn.execute(text("UPDATE notes SET deleted_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": note_id})


def restore(engine: Engine, note_id: int) -> dict:
    with engine.begin() as conn:
        _one(conn, note_id)
        conn.execute(text("UPDATE notes SET deleted_at = NULL WHERE id = :i"), {"i": note_id})
        return _one(conn, note_id)


def list_notes(engine: Engine, scope: str | None = None, competitor_id: int | None = None, page_url: str | None = None, site_id: int | None = None, screen: str | None = None) -> list[dict]:
    has_file = "EXISTS (SELECT 1 FROM note_files f WHERE f.note_id = n.id AND f.deleted_at IS NULL)"
    where, params = ["n.deleted_at IS NULL", f"(n.body <> '' OR {has_file})"], {}
    if scope:
        if scope not in SCOPES:
            raise Refused(WRONG_SCOPE)
        where.append("n.scope = :sc")
        params["sc"] = scope
    if screen:
        where.append("n.screen = :sn")
        params["sn"] = screen
    if competitor_id is not None:
        where.append("n.competitor_id = :c")
        params["c"] = competitor_id
    if page_url:
        where.append("n.page_hash = :h")
        params["h"] = pages.url_hash(_clean_page(page_url) or page_url)
    if site_id is not None:  # a note saved with no site belongs to all of them
        where.append("(n.site_id = :s OR n.site_id IS NULL)")
        params["s"] = site_id
    with engine.connect() as conn:
        rows = conn.execute(text(f"{_SELECT} WHERE {' AND '.join(where)} ORDER BY n.updated_at DESC LIMIT 500"), params).mappings().all()
        files = _files_of(conn, [r["id"] for r in rows])
    return [_dict(r, files.get(r["id"], [])) for r in rows]


def add_file(engine: Engine, note_id: int, name, stream) -> dict:
    """Keep one file on a note, and answer with the note. The file is only recorded once all of it is on disk."""
    with engine.connect() as conn:
        _one(conn, note_id)
    stored = secrets.token_hex(16)
    path = files_dir() / stored
    size, head = 0, b""
    try:
        with open(path, "xb") as out:
            while chunk := stream.read(1024 * 1024):
                if not head:
                    head = chunk[:16]
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise Refused(TOO_LARGE)
                out.write(chunk)
        if not size:
            raise Refused("That file is empty.")
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO note_files (note_id, name, image_type, size_bytes, stored_name) VALUES (:n, :m, :t, :z, :s)"),
                {"n": note_id, "m": _clean_name(name), "t": _image_type(head), "z": size, "s": stored},
            )
            conn.execute(text("UPDATE notes SET updated_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": note_id})
            return _one(conn, note_id)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _file_row(conn, file_id: int):
    row = conn.execute(text("SELECT * FROM note_files WHERE id = :i"), {"i": file_id}).mappings().first()
    if row is None:
        raise NotFound("That file doesn't exist.")
    return row


def get_file(engine: Engine, file_id: int) -> dict:
    """Where a file is, and how it may be sent. A deleted file can't be fetched, though it can still be brought back."""
    with engine.connect() as conn:
        row = _file_row(conn, file_id)
    path = files_dir() / row["stored_name"]
    if row["deleted_at"] is not None or not path.is_file():
        raise NotFound("That file doesn't exist.")
    return {"path": path, "name": row["name"], "image_type": row["image_type"]}


def delete_file(engine: Engine, file_id: int) -> None:
    with engine.begin() as conn:
        _file_row(conn, file_id)
        conn.execute(text("UPDATE note_files SET deleted_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": file_id})


def restore_file(engine: Engine, file_id: int) -> dict:
    with engine.begin() as conn:
        row = _file_row(conn, file_id)
        conn.execute(text("UPDATE note_files SET deleted_at = NULL WHERE id = :i"), {"i": file_id})
        return _one(conn, row["note_id"])
