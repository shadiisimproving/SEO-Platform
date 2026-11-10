"""Work: Tasks, Notes, Resources, and the connections' status from Settings."""
from __future__ import annotations

import re

from seo.exports import registry
from seo.exports.build import C
from seo.exports.model import Report, Table, Tile, Typed
from seo.exports.registry import view
from seo.exports.safe import without_secrets

TASK_STATUS = {"todo": "To do", "doing": "Doing", "done": "Done", "blocked": "Blocked", "backlog": "Backlog", "review": "In review"}
PRIORITY = {"high": "High", "medium": "Medium", "low": "Low", "urgent": "Urgent"}
SCOPES = {"all": "Everything", "competitor": "Competitor", "page": "Page", "site": "Site", "keyword": "Keyword", "day": "Day", "date": "Day", "section": "Section", "domain": "Domain", "task": "Task", "screen": "Screen"}


def _words(table: dict, value) -> str:
    return table.get(value, str(value or "").replace("_", " ").capitalize())


def _plain(html) -> str:
    """A note's text without its markup, for a cell."""
    text = re.sub(r"<(br|/p|/div|/li|/h[1-6])[^>]*>", "\n", str(html or ""), flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        text = text.replace(entity, char)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


@view("tasks", "Tasks")
def tasks(engine, args) -> Report:
    from seo.tasks import service

    rows = service.list_tasks(engine)
    host = registry.site_host(engine, args.get("site_id"))
    if host:
        rows = [r for r in rows if not r.get("site_host") or r.get("site_host") == host]  # as the board shows them: a task for no site in particular shows on every site
    report = Report("tasks", "Tasks", site=host)

    def count(report: Report) -> None:
        shown = report.tables[0].rows
        report.tiles = [
            Tile("Tasks", len(shown), "int"), Tile("Done", sum(1 for r in shown if r.get("status") == "done"), "int"),
            Tile("Still open", sum(1 for r in shown if r.get("status") != "done"), "int"), Tile("Hours spent", sum(float(r.get("hours_spent") or 0) for r in shown), "float"),
        ]

    report.recount = count
    report.tables.append(Table("tasks", "Tasks", [
        C("title", "Task", "text", width=4.4), C("status", "Status", "text", width=1.3, get=lambda r: _words(TASK_STATUS, r.get("status")), translate=True),
        C("priority", "Priority", "text", width=1.2, get=lambda r: _words(PRIORITY, r.get("priority")) if r.get("priority") else "", translate=True),
        C("owner_label", "Owner", "text", width=1.6), C("site_host", "Site", "text", width=2.2), C("due", "Due", "date"), C("completed_on", "Done on", "date"),
        C("hours_estimate", "Hours planned", "float"), C("hours_spent", "Hours spent", "float"),
        C("pages", "Pages", "text", width=3, get=lambda r: ", ".join(str(p.get("url") or p.get("path") or p) if isinstance(p, dict) else str(p) for p in r.get("pages") or [])),
        C("keywords", "Keywords", "text", width=2.4, get=lambda r: ", ".join(str(k.get("keyword") or k) if isinstance(k, dict) else str(k) for k in r.get("keywords") or [])),
        C("description", "Description", "text", width=4, get=lambda r: _plain(r.get("description"))),
    ], rows, empty="No tasks yet.", key="id"))
    return report


NOTE_KINDS = {"page": "Pages", "keyword": "Keywords", "competitor": "Competitors", "domain": "Linking websites", "task": "Tasks", "date": "Days", "day": "Days", "screen": "Screens", "site": "Websites"}


def _note_kind(row: dict) -> str:
    """As the Notes screen groups them (comp-notes.js kindOf): a section of a page is a page, a general note is about competitors."""
    scope = row.get("scope")
    return "page" if scope == "section" else "competitor" if scope == "all" else "date" if scope == "day" else str(scope or "")


def _note_subject(row: dict) -> str:
    task = row.get("task")
    if isinstance(task, dict):
        task = task.get("title")
    return row.get("page_url") or row.get("competitor") or row.get("keyword") or row.get("domain") or row.get("day") or task or ""


@view("notes", "Notes")
def notes(engine, args) -> Report:
    from seo.competitors import notes as service

    def number(key):
        raw = args.get(key)
        return int(raw) if isinstance(raw, str) and re.fullmatch(r"[0-9]{1,18}", raw) else None

    rows = service.list_notes(engine, args.get("scope") or None, number("competitor_id"), args.get("page_url") or None, number("site_id"), args.get("screen") or None,
                              args.get("keyword") or None, args.get("day") or None, args.get("domain") or None, number("task_id"))
    rows = [r for r in rows if not r.get("deleted_at") and (_plain(r.get("body")) or r.get("files"))]
    # The Notes screen's own two filters: what the notes are about, and the search box (text, subject and file names).
    kind, needle = str(args.get("kind") or ""), str(args.get("q") or "").strip().lower()
    if kind:
        rows = [r for r in rows if _note_kind(r) == kind]
    if needle:
        rows = [r for r in rows if needle in f"{_plain(r.get('body'))} {_note_subject(r)} {' '.join(str(f.get('name') or '') for f in r.get('files') or [])}".lower()]
    rows.sort(key=lambda r: (str(r.get("updated_at") or ""), r.get("id") or 0), reverse=True)
    report = Report("notes", "Notes", site=registry.site_host(engine, args.get("site_id")))
    if kind:
        report.filters.append(("Notes about", NOTE_KINDS.get(kind, kind)))
    if needle:
        report.filters.append(("Search", Typed(str(args.get("q")).strip())))
    report.tiles = [Tile("Notes", len(rows), "int"), Tile("With files", sum(1 for r in rows if r.get("files")), "int")]
    report.tables.append(Table("notes", "Notes", [
        C("updated_at", "Changed", "date"), C("scope", "Attached to", "text", width=1.4, get=lambda r: _words(SCOPES, r.get("scope")), translate=True),
        C("subject", "Which one", "text", width=3.2, get=_note_subject),
        C("body", "Note", "text", width=6.5, get=lambda r: _plain(r.get("body"))),
        C("files", "Files", "int", get=lambda r: len(r.get("files") or []) or None),
    ], rows, empty="No notes yet.", key="id"))
    return report


@view("resources", "Resources")
def resources(engine, args) -> Report:
    from seo.resources import service

    rows = service.list_resources(engine)
    host = registry.site_host(engine, args.get("site_id"))
    if host:
        rows = [r for r in rows if r.get("host") in (host, None)]
    report = Report("resources", "Resources", site=host)
    report.tiles = [Tile("Resources", len(rows), "int")]
    report.tables.append(Table("resources", "Resources", [
        C("title", "Name", "text", width=3.4), C("url", "Address", "url"), C("tags", "Tags", "text", width=2), C("host", "Site", "text", width=2),
        C("notes", "Notes", "text", width=4), C("created_by", "Added by", "text", width=1.6), C("created_at", "Added", "date"),
    ], rows, empty="No resources yet.", key="id"))
    return report


@view("connections", "Connections")
def connections(engine, args) -> Report:
    """Which tools are connected, and nothing else. No key, no last characters of one, no error text from a tool."""
    from seo.sources import service

    data = service.overview(engine)
    rows = [{"tool": k.get("tool"), "connected": bool(k.get("connected")), "last_ok_at": k.get("last_ok_at"), "problem": bool(k.get("last_error")) if k.get("connected") else None} for k in data.get("keys") or []]
    report = Report("connections", "Connections")
    report.tiles = [Tile("Tools connected", sum(1 for r in rows if r["connected"]), "int"), Tile("Not connected", sum(1 for r in rows if not r["connected"]), "int")]
    report.tables.append(Table("tools", "Tools", [
        C("tool", "Tool", "text"), C("connected", "Connected", "bool"), C("last_ok_at", "Last worked", "datetime"), C("problem", "Has a problem", "bool"),
    ], [without_secrets(r) for r in rows]))
    from seo.serp import connections as search_tools

    found = [search_tools.status(engine, name) for name in search_tools.TOOLS]
    searching = [{"tool": f.get("tool"), "connected": bool(f.get("connected")), "problem": bool(f.get("last_error")) if f.get("connected") else None} for f in found]
    report.tiles[0].value += sum(1 for r in searching if r["connected"])
    report.tiles[1].value += sum(1 for r in searching if not r["connected"])
    report.tables.append(Table("search_tools", "Search tools", [C("tool", "Tool", "text", translate="known"), C("connected", "Connected", "bool"), C("problem", "Has a problem", "bool")], searching))
    google = [{"name": g.get("label") or g.get("name"), "kind": g.get("kind"), "connected": True} for g in data.get("google") or []]
    report.tables.append(Table("google", "Google accounts", [C("name", "Name", "text"), C("kind", "Kind", "text", translate=True), C("connected", "Connected", "bool")], google, empty="No Google account connected."))
    return report
