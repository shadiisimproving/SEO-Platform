"""Notes on all competitors, on one competitor, on any page or group of pages, on a keyword, a day, a linking website or a task,
on one screen of the app, or on a whole website.
Deleting keeps the text, so it can be undone.

A note can also hold images and files. They sit on disk under a random name, never the one they came with.
Only bytes that really are an image are ever shown in the browser: everything else can only be downloaded.
"""
from __future__ import annotations

import os
import re
import secrets
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import Engine, text

from seo import config
from seo.accounts import access
from seo.competitors import pages, pairs
from seo.competitors.keywords import _iso, require_own
from seo.core.errors import Conflict, NotFound, Refused
from seo.serp.store import canonical_url, clean_keyword, keyword_hash, to_ascii_host

MAX_BYTES = 4_000_000  # far past any note; the column holds 16 MB
SCOPES = ("all", "competitor", "page", "site", "screen", "keyword", "date", "domain", "section", "task")
# The screens a note can be about: the app's menu. A name outside it would never be shown anywhere.
SCREENS = (
    "today", "channels", "conversions", "content", "overview", "pages", "keywords", "competitors", "ai", "ads",
    "tasks", "backlinks", "resources", "health", "settings",
)
WRONG_SCOPE = "That isn't something a note can go on."
MAX_FILE_BYTES = 25 * 1024 * 1024
UPLOAD_OVERHEAD = 1024 * 1024  # the form around the file
TOO_LARGE = "This file is over 25 MB."


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
        raise Refused("Note too long. Your text is still here: split it in two.")
    return body


def _dict(row, files=()) -> dict:
    return {
        "id": row["id"], "scope": row["scope"], "site_id": row["site_id"], "competitor_id": row["competitor_id"], "competitor": row.get("competitor"),
        "page_url": row["page_url"], "screen": row["screen"], "keyword": row.get("keyword"), "day": row["day"].isoformat() if row.get("day") else None,
        "domain": row.get("domain"), "task_id": row.get("task_id"), "task": row.get("task"), "body": row["body"], "created_at": _iso(row["created_at"]), "updated_at": _iso(row["updated_at"]),
        "created_by": row.get("created_by"), "updated_by": row.get("updated_by"), "deleted_at": _iso(row["deleted_at"]), "files": list(files),
    }


_SELECT = "SELECT n.*, s.host AS competitor, t.title AS task FROM notes n LEFT JOIN sites s ON s.id = n.competitor_id LEFT JOIN tasks t ON t.id = n.task_id"


DELETED = "Someone deleted this note."
CHANGED_MEANWHILE = "Someone else changed this note while you were writing."


def _one(conn, note_id: int, live: bool = False, lock: bool = False) -> dict:
    """`live`: a deleted note answers 404 too, so words typed into it are never saved into a row nobody sees (F121)."""
    row = conn.execute(text(f"{_SELECT} WHERE n.id = :i{' FOR UPDATE' if lock else ''}"), {"i": note_id}).mappings().first()
    if row is None:
        raise NotFound("That note doesn't exist.")
    if live and row["deleted_at"] is not None:
        raise NotFound(DELETED)
    return _dict(row, _files_of(conn, [note_id]).get(note_id, []))


def _who(by) -> str | None:
    return str(by).strip()[:120] or None if by else None


def _clean_page(page_url) -> str:
    if not isinstance(page_url, str) or not page_url.strip():
        return ""
    return canonical_url(page_url if "://" in page_url else f"https://{page_url.strip()}")


_HOST = re.compile(r"^(?=.{1,190}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$")


def clean_domain(value) -> str:
    """A linking website as one spelling: no scheme, path, port or www, and accents in their ASCII form."""
    text_ = str(value or "").strip().lower()
    text_ = re.sub(r"^[a-z][a-z0-9+.-]*://", "", text_)
    text_ = re.split(r"[/?#]", text_, maxsplit=1)[0].rsplit("@", 1)[-1].split(":", 1)[0].strip(".")
    if text_.startswith("www."):
        text_ = text_[4:]
    try:
        text_ = to_ascii_host(text_)
    except Exception:  # an address that can't be written in ASCII isn't a website
        return ""
    return text_ if _HOST.match(text_) else ""


def clean_section(value) -> str:
    """A group of pages: the address its pages start with, always ending in "/", and never a whole website."""
    url = _clean_page(value)
    if not url:
        return ""
    url = url.split("?", 1)[0].split("#", 1)[0]
    return url if url.endswith("/") else f"{url}/"


def _clean_day(value) -> date:
    try:
        day = date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        day = None
    if day is None:
        raise Refused("Pick a day.")
    if day.year < 2000 or day > date.today() + timedelta(days=366):
        raise Refused("Choose a day between 2000 and next year.")
    return day


def create(engine: Engine, scope, body, site_id=None, competitor_id=None, page_url=None, screen=None, keyword=None, day=None, domain=None, task_id=None, by=None) -> dict:
    body = _check_body(body)
    if scope not in SCOPES:
        raise Refused(WRONG_SCOPE)
    if scope == "screen" and screen not in SCREENS:
        raise Refused("Say which screen this note is about.")
    if scope != "screen":
        screen = None
    if scope not in ("all", "competitor", "page"):
        competitor_id = None
    fields = {"keyword": None, "keyword_hash": None, "day": None, "domain": None, "task_id": None}
    if scope == "keyword":
        word = clean_keyword(keyword) if isinstance(keyword, str) else ""
        if not word:
            raise Refused("Enter the keyword.")
        if len(word) > 400:
            raise Refused("This keyword is over 400 characters.")
        fields.update(keyword=word, keyword_hash=keyword_hash(word))
    if scope == "date":
        fields["day"] = _clean_day(day)
    if scope == "domain":
        fields["domain"] = clean_domain(domain)
        if not fields["domain"]:
            raise Refused("Enter the linking website, such as example.com.")
    if scope == "task":
        if type(task_id) is not int:
            raise Refused("Say which task this note is about.")
        fields["task_id"] = task_id
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
    if scope == "section":
        clean_url = clean_section(page_url)
        if not clean_url:
            raise Refused("Enter the folder address, such as example.com/blog/.")
        if clean_url.split("://", 1)[-1].count("/") < 2:
            raise Refused("That's the whole site: add a folder like /blog/, or write on the website.")
        hashed = pages.url_hash(clean_url)
    with engine.begin() as conn:
        if site_id is not None:
            require_own(conn, site_id)
        if competitor_id is not None and scope != "all":
            if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'competitor'"), {"i": competitor_id}).first():
                raise NotFound("That competitor doesn't exist.")
            if site_id is not None and not conn.execute(text("SELECT 1 FROM site_competitors WHERE site_id = :s AND competitor_id = :c"), {"s": site_id, "c": competitor_id}).first():
                raise NotFound("Competitor not found.")
        if scope == "task":
            task = conn.execute(text("SELECT site_id FROM tasks WHERE id = :i AND deleted_at IS NULL"), {"i": task_id}).first()
            if task is None:
                raise NotFound("That task doesn't exist.")
            site_id = task[0]  # a task's notes belong to the task's site
        access.require_site_or_every(site_id, conn)  # chosen access: a note for one of their sites; for every site only with every site
        note_id = conn.execute(
            text(
                "INSERT INTO notes (scope, site_id, competitor_id, page_url, page_hash, screen, keyword, keyword_hash, day, domain, task_id, body, created_by, updated_by)"
                " VALUES (:sc, :s, :c, :u, :h, :sn, :keyword, :keyword_hash, :day, :domain, :task_id, :b, :by, :by)"
            ),
            {"sc": scope, "s": site_id, "c": competitor_id if scope != "all" else None, "u": clean_url, "h": hashed, "sn": screen, "b": body, "by": _who(by), **fields},
        ).lastrowid
        return _one(conn, note_id)


class Changed(Conflict):
    """Answered with the note as it is now, so the screen can offer Keep mine or Use theirs."""

    def __init__(self, note: dict):
        super().__init__(CHANGED_MEANWHILE)
        self.note = note


def update(engine: Engine, note_id: int, body, expected=None, by=None) -> dict:
    """`expected` is the note's updated_at as the person last saw it. If someone else saved since, nothing changes
    and Changed carries their copy. Without it (a page closing, an old screen), the save goes through as before."""
    body = _check_body(body)
    with engine.begin() as conn:
        now = _one(conn, note_id, live=True, lock=True)
        if expected is not None and expected != now["updated_at"] and now["body"] != body:
            raise Changed(now)
        conn.execute(text("UPDATE notes SET body = :b, updated_by = :by, updated_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"b": body, "by": _who(by), "i": note_id})
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


def list_notes(
    engine: Engine, scope: str | None = None, competitor_id: int | None = None, page_url: str | None = None, site_id: int | None = None, screen: str | None = None,
    keyword: str | None = None, day: str | None = None, domain: str | None = None, task_id: int | None = None,
) -> list[dict]:
    """A page's notes include those on every group of pages it belongs to."""
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
    if keyword:
        where.append("n.keyword_hash = :kh")
        params["kh"] = keyword_hash(keyword)
    if day:
        where.append("n.day = :day")
        params["day"] = _clean_day(day)
    if domain:
        where.append("n.domain = :domain")
        params["domain"] = clean_domain(domain) or domain
    if task_id is not None:
        where.append("n.task_id = :task")
        params["task"] = task_id
    if page_url and scope == "section":
        where.append("n.page_hash = :h")
        params["h"] = pages.url_hash(clean_section(page_url) or page_url)
    elif page_url:
        params["u"] = _clean_page(page_url) or page_url
        params["h"] = pages.url_hash(params["u"])
        # COLLATE sits on the value, not the column: the live tables are still latin1, where a column can't take utf8mb4_bin.
        where.append("(n.page_hash = :h OR (n.scope = 'section' AND n.page_url = LEFT(:u, CHAR_LENGTH(n.page_url)) COLLATE utf8mb4_bin))")
    if site_id is not None:  # a note saved with no site belongs to all of them
        where.append("(n.site_id = :s OR n.site_id IS NULL)")
        params["s"] = site_id
    with engine.connect() as conn:
        mine = access.site_clause("n.site_id", params, conn)  # their sites only: notes for every site are the owner's
        if mine:
            where.append(mine.removeprefix(" AND "))
        rows = conn.execute(text(f"{_SELECT} WHERE {' AND '.join(where)} ORDER BY n.updated_at DESC LIMIT 500"), params).mappings().all()
        files = _files_of(conn, [r["id"] for r in rows])
    return [_dict(r, files.get(r["id"], [])) for r in rows]


def add_file(engine: Engine, note_id: int, name, stream) -> dict:
    """Keep one file on a note, and answer with the note. The file is only recorded once all of it is on disk."""
    with engine.connect() as conn:
        _one(conn, note_id, live=True)
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
        note_gone = conn.execute(text("SELECT deleted_at IS NOT NULL FROM notes WHERE id = :i"), {"i": row["note_id"]}).scalar()
    path = files_dir() / row["stored_name"]
    if row["deleted_at"] is not None or note_gone or not path.is_file():  # a deleted note's files go with it (F121)
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


def options(engine: Engine, site_id: int | None = None) -> dict:
    """What a note can be about, to pick from: the pages, groups of pages, keywords, linking websites and tasks
    of one of my sites, or of all of them. Anything but a task can also be typed."""
    with engine.connect() as conn:
        if site_id is not None:
            require_own(conn, site_id)
            sites = [site_id]
        else:
            sites = access.own_site_ids(conn)  # "all sites" is all of *their* sites
        words: dict[str, str] = {}
        domains: set[str] = set()
        tasks: list[dict] = []
        if sites:
            marks = ", ".join(str(int(s)) for s in sites)
            for (word,) in conn.execute(text(f"SELECT DISTINCT k.keyword FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id IN ({marks}) ORDER BY k.keyword LIMIT 2000")):
                words.setdefault(clean_keyword(word).casefold(), clean_keyword(word))
            for table in ("backlinks", "prospects"):
                domains.update(r[0] for r in conn.execute(text(f"SELECT DISTINCT domain FROM {table} WHERE site_id IN ({marks}) LIMIT 3000")) if r[0])
            domains.update(r[0] for r in conn.execute(text(
                f"SELECT DISTINCT r.domain FROM competitor_referrers r JOIN site_competitors sc ON sc.competitor_id = r.competitor_id WHERE sc.site_id IN ({marks}) LIMIT 3000"
            )) if r[0])
            # A task for all sites belongs to each of them too. Its site goes along: a health task's title is the check
            # alone ("Error pages"), so two sites can share one, and the picker tells them apart by site.
            every = "" if access.sees_everything(conn) else " AND site_id IS NOT NULL"  # tasks for every site are the owner's
            tasks = [{"id": r[0], "title": r[1], "status": r[2], "site_host": r[3]} for r in conn.execute(text(
                f"SELECT id, title, status, site_host FROM tasks WHERE deleted_at IS NULL AND (site_id IN ({marks}) OR site_id IS NULL){every} ORDER BY status = 'done', updated_at DESC LIMIT 500"
            ))]
    found: dict[str, str] = {}
    for one in sites:
        for page in pairs.page_options(engine, one):
            found.setdefault(page["url"], page["title"])
    page_list = [{"url": url, "title": title} for url, title in sorted(found.items())][:2000]
    return {
        "pages": page_list,
        "sections": _sections(page_list),
        "keywords": sorted(words.values(), key=str.casefold),
        "domains": sorted(domains),
        "tasks": tasks,
    }


def _sections(page_list: list[dict]) -> list[dict]:
    """The folders the known pages sit in, such as /blog/ and /blog/guides/, with how many pages each holds."""
    counts: dict[str, int] = {}
    for page in page_list:
        scheme, _, rest = page["url"].partition("://")
        host, _, path = rest.partition("/")
        parts = path.split("?", 1)[0].split("/")[:-1]  # the last part is the page itself
        for depth in range(1, min(len(parts), 3) + 1):
            prefix = f"{scheme}://{host}/{'/'.join(parts[:depth])}/"
            counts[prefix] = counts.get(prefix, 0) + 1
    return [{"url": url, "pages": n} for url, n in sorted(counts.items()) if n >= 1][:500]
