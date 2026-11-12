"""The exportable views. Each one is a screen (or one tab of it) and a function that builds its Report.

A view's builder gets the engine and the request's own arguments, exactly as the screen's data route does, and calls
the same service functions that route calls. So the file holds the rows and numbers the screen shows, for the same
site, days and filters, and a site that isn't one of mine is refused by the same code.

To add a screen: write `@view("id", "Title")` over a function `(engine, args) -> Report` in a views_*.py file.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Callable

from sqlalchemy import Engine, text

from seo.accounts import access
from seo.core.errors import NotFound, Refused
from seo.exports.model import MAX_ROWS, Report, Table, Typed

FORMATS = ("pdf", "xlsx", "csv")


@dataclass
class View:
    id: str
    title: str
    build: Callable[[Engine, dict], Report]


VIEWS: dict[str, View] = {}


def view(view_id: str, title: str):
    def register(build):
        VIEWS[view_id] = View(view_id, title, build)
        return build
    return register


def _load() -> None:
    from seo.exports import views_search, views_traffic, views_links, views_competitors, views_work  # noqa: F401 - each registers its views


def site_host(engine: Engine, site_id) -> str | None:
    """The host of one of my own sites, or None for all of them. The service called next refuses anything else."""
    if site_id in (None, "", "all"):
        return None
    try:
        wanted = int(site_id)
    except (TypeError, ValueError) as exc:
        raise Refused("That site isn't one of yours.") from exc
    access.require_site(wanted)  # chosen access: one of their sites
    with engine.connect() as conn:
        row = conn.execute(text("SELECT host FROM sites WHERE id = :i AND kind = 'own'"), {"i": wanted}).first()
    if row is None:
        raise Refused("That site isn't one of yours.")
    return row[0]


def site_logo(engine: Engine, host: str | None) -> tuple[bytes, str] | None:
    """The site's own icon, when the app has fetched one a PDF can hold (not an SVG)."""
    if not host:
        return None
    from seo.backlinks import logos

    try:
        found = logos.image_of(engine, host)
    except Exception:  # noqa: BLE001 - a report without its icon is still the report
        return None
    return found if found and found[1] in ("image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon") else None


def build(engine: Engine, view_id: str, args, lang: str = "en") -> Report:
    _load()
    found = VIEWS.get(view_id)
    if found is None:
        raise NotFound("There is no export by that name.")
    report = found.build(engine, args)
    as_seen(report, args)
    if report.recount:
        report.recount(report)
    report.view = view_id
    report.lang = "fr" if lang == "fr" else "en"
    report.made_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if report.logo is None:
        report.logo = site_logo(engine, report.site)
    for table in report.tables:
        if table.count > MAX_ROWS:
            table.total = max(table.total or 0, table.count)
            table.rows = table.rows[:MAX_ROWS]
        if table.total and table.total > table.count:
            report.capped = True
    return report


MAX_SEEN_IDS = 20_000
MAX_SEEN_WORDS = 12


def as_seen(report: Report, args) -> None:
    """Keep the rows the screen was showing, in its order, and say its filters in the header.

    A screen that filters or sorts in the browser sends `seen`: {table id: [row keys]}. The rows still come from the
    service, for the site asked about, so a key that isn't among them simply matches nothing: this can only ever
    narrow and reorder what the person may already see. `seen_words` are that screen's filters in words.
    """
    seen = args.get("seen") if hasattr(args, "get") else None
    if isinstance(seen, dict):
        for table in report.tables:
            keys = seen.get(table.id)
            if not table.key or not isinstance(keys, list):
                continue
            if len(keys) > MAX_SEEN_IDS:
                raise Refused("That list is too long to export as it is on screen. Narrow the filter.")
            place = {}
            for at, key in enumerate(keys):
                if isinstance(key, (str, int)) and not isinstance(key, bool):
                    place.setdefault(str(key), at)
            kept = [row for row in table.rows if table.row_key(row) in place]
            kept.sort(key=lambda row: place[table.row_key(row)])
            if table.rows and not kept:
                table.empty = "Nothing matches these filters."  # there are rows, just none the screen shows
            table.rows, table.total = kept, None
    words = args.get("seen_words") if hasattr(args, "get") else None
    if isinstance(words, list):
        for pair in words[:MAX_SEEN_WORDS]:
            if isinstance(pair, list) and len(pair) == 2 and all(isinstance(x, str) for x in pair) and pair[0].strip() and pair[1].strip():
                report.filters.append((pair[0].strip()[:60], Typed(pair[1].strip()[:160])))  # the label is the app's word; the value is as the screen showed it
    sort, table_id = args.get("sort"), args.get("table")
    target = report.table(table_id) if isinstance(table_id, str) and table_id else report.table(None)
    if isinstance(sort, str) and target is not None and not (isinstance(seen, dict) and target.id in seen):
        sort_rows(target, sort, args.get("dir"))


def sort_rows(table: Table, column_id, direction) -> None:
    """The order picked on screen by pressing a column heading. Empty values go last, as there."""
    column = next((c for c in table.columns if c.key == column_id), None)
    if column is None:
        return

    def value(row):
        found = column.value(row)
        return len(found) if isinstance(found, list) else found

    filled = [r for r in table.rows if value(r) not in (None, "")]
    empty = [r for r in table.rows if value(r) in (None, "")]
    numbers = all(isinstance(value(r), (int, float)) for r in filled)
    filled.sort(key=(lambda r: value(r)) if numbers else (lambda r: str(value(r)).casefold()), reverse=direction != "asc")
    table.rows = filled + empty


def formats() -> list[str]:
    """The formats this server can make. The PDF library needs Pillow, a compiled package: on a host where it can't be
    installed, Excel and CSV still work and the menu doesn't offer PDF."""
    from importlib.util import find_spec

    def has(*names: str) -> bool:
        try:
            return all(find_spec(name) is not None for name in names)
        except (ImportError, ValueError):
            return False

    return [fmt for fmt, needs in (("pdf", ("reportlab", "PIL")), ("xlsx", ("openpyxl",)), ("csv", ())) if has(*needs)]


def listing() -> list[dict]:
    _load()
    return [{"id": v.id, "title": v.title} for v in VIEWS.values()]


def days(start, end) -> tuple[date, date] | None:
    from seo.exports import fmt

    a, b = fmt.as_day(start), fmt.as_day(end)
    return (a, b) if a and b else None
