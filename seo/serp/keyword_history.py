"""A keyword's history on one time line: our position, our rivals' positions, and what we did to the page.

What we did is three things, each with its date: edits the daily reading saw on the keyword's page, backlinks placed
pointing at that page, and boosts (traffic sent to the page, which only a person can tell the app).

A rival's line comes from the very checks our own line comes from, so the two always share tool, location and depth
(the rule at the top of seo/serp/rankings.py). No search is ever run for a rival here.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime
from urllib.parse import urlsplit

from sqlalchemy import Engine, bindparam, text

from seo.competitors.insights import EDIT_SKIP
from seo.competitors.keywords import _iso, require_own
from seo.core.errors import NotFound, Refused
from seo.serp import rankings, store
from seo.serp.tools import google_redirect

OTHERS = 5  # sites that aren't followed rivals, offered behind "More sites": the ones seen in the most checks
VALUE_CHARS = 200  # a title or a note, cut for the screen
NOTE_CHARS = 300

_MONTHS = {
    name: number
    for number, names in enumerate(
        (
            ("jan", "january", "janvier", "janv"), ("feb", "february", "fevrier", "février", "fev", "fév", "févr", "fevr"), ("mar", "march", "mars"),
            ("apr", "april", "avril", "avr"), ("may", "mai"), ("jun", "june", "juin"), ("jul", "july", "juillet", "juil"),
            ("aug", "august", "aout", "août"), ("sep", "sept", "september", "septembre"), ("oct", "october", "octobre"),
            ("nov", "november", "novembre"), ("dec", "december", "decembre", "décembre", "déc"),
        ),
        start=1,
    )
    for name in names
}
_YMD = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})")
_DMY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b")
_D_MONTH_Y = re.compile(r"^(\d{1,2})(?:st|nd|rd|th|er)?\s+([^\W\d]+)\.?,?\s+(\d{4})")
_MONTH_D_Y = re.compile(r"^([^\W\d]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})")


def _date(year: int, month: int, day: int) -> date | None:
    try:
        found = date(year, month, day)
    except ValueError:
        return None
    return found if 2000 <= found.year <= 2100 else None


def parse_day(typed) -> date | None:
    """The day a person typed in a backlink's Placed box. 2026-11-03, 03/11/2026 (day first), 3 Nov 2026, Nov 3, 2026,
    3 novembre 2026. Anything else ("soon", "Q4", empty) is no date."""
    words = str(typed or "").strip().lower()
    if not words:
        return None
    if hit := _YMD.match(words):
        return _date(int(hit[1]), int(hit[2]), int(hit[3]))
    if hit := _DMY.match(words):
        year = int(hit[3])
        return _date(year + 2000 if year < 100 else year, int(hit[2]), int(hit[1]))
    if (hit := _D_MONTH_Y.match(words)) and hit[2] in _MONTHS:
        return _date(int(hit[3]), _MONTHS[hit[2]], int(hit[1]))
    if (hit := _MONTH_D_Y.match(words)) and hit[1] in _MONTHS:
        return _date(int(hit[3]), _MONTHS[hit[1]], int(hit[2]))
    return None


def page_key(url) -> str:
    """One spelling for one page, to match a backlink's target or a stored page with the keyword's page:
    http or https, www or not, a closing slash or not, tracking tags or not. "" when it isn't an address."""
    try:
        parts = urlsplit(rankings.page_address(str(url or "").strip()))
        host = (parts.hostname or "").lower().rstrip(".")
    except ValueError:
        return ""
    if not host:
        return ""
    host = host[4:] if host.startswith("www.") else host
    return f"{host}{parts.path.rstrip('/')}{'?' + parts.query if parts.query else ''}"


def _cut(value, limit: int = VALUE_CHARS) -> str | None:
    if value is None:
        return None
    words = " ".join(str(value).split())
    return words if len(words) <= limit else words[: limit - 1].rstrip() + "…"


# ---- rivals -----------------------------------------------------------------------------------------

def _lines(conn, site_id: int, host: str, keyword_id: int, engine_name: str) -> list[dict]:
    """One line per tool, location and depth, as the side panel draws them, each with the other sites its checks saw."""
    target = conn.execute(
        text(f"SELECT id FROM serp_targets WHERE keyword_id = :k AND engine = :e AND device = '{rankings.DEVICE}'"), {"k": keyword_id, "e": engine_name}
    ).scalar()
    if not target:
        return []
    checks = conn.execute(
        text("SELECT id, tool, real_location, depth, status, checked_at FROM serp_checks WHERE target_id = :t AND status <> 'failed' ORDER BY id DESC LIMIT 200"),
        {"t": target},
    ).mappings().all()
    if not checks:
        return []
    checks = list(reversed(checks))
    tracked = [r[0] for r in conn.execute(
        text("SELECT s.host FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s AND sc.tracking = 'on' ORDER BY s.host"), {"s": site_id}
    ).all()]
    mine: dict[int, int] = {}
    theirs: dict[int, dict[str, int]] = defaultdict(dict)  # check → site → its best place there
    followed: set[str] = set()
    results = conn.execute(
        text("SELECT check_id, position, url, host, domain FROM serp_results WHERE check_id IN :ids ORDER BY check_id, position").bindparams(bindparam("ids", expanding=True)),
        {"ids": [check["id"] for check in checks]},
    ).mappings()
    for result in results:
        if store.on_host(result["host"], host):
            mine.setdefault(result["check_id"], result["position"])
            continue
        if google_redirect(result["url"]):
            continue  # saved from Google's hidden link: whose result it was isn't known
        rival = next((r for r in tracked if store.on_host(result["host"], r)), None)
        name = rival or result["domain"] or result["host"]
        if not name:
            continue
        if rival:
            followed.add(rival)
        theirs[result["check_id"]].setdefault(name, result["position"])

    lines: dict[tuple, dict] = {}
    for check in checks:
        key = (check["tool"], check["real_location"], check["depth"])
        line = lines.setdefault(key, {"tool": key[0], "location": key[1], "depth": key[2], "points": [], "_checks": []})
        suspect = check["status"] == "suspect"
        line["points"].append({"at": _iso(check["checked_at"]), "p": mine.get(check["id"]), "suspect": suspect})
        if not suspect:  # a suspect page of results says nothing sure about anyone on it
            line["_checks"].append(check)
    for line in lines.values():
        clean = line.pop("_checks")
        seen: dict[str, list[int]] = defaultdict(list)
        for check in clean:
            for name, position in theirs.get(check["id"], {}).items():
                seen[name].append(position)

        def points(name: str) -> list[dict]:
            return [{"at": _iso(check["checked_at"]), "p": theirs.get(check["id"], {}).get(name)} for check in clean]

        def entry(name: str, is_followed: bool) -> dict:
            return {"host": store.to_display_host(name), "tracked": is_followed, "seen": len(seen[name]), "points": points(name)}

        rivals = [entry(name, True) for name in tracked if name in seen]
        # Then whoever else is there most often, the better placed first among equals.
        others = sorted((name for name in seen if name not in followed), key=lambda n: (-len(seen[n]), sum(seen[n]) / len(seen[n]), n))
        line["rivals"] = rivals + [entry(name, False) for name in others[:OTHERS]]
    return list(lines.values())


# ---- what we did to the page ------------------------------------------------------------------------

def _edits(conn, host: str, page: str) -> list[dict]:
    """The days the daily reading saw the page change, and what changed. A page appearing or going isn't an edit."""
    wanted = page_key(page)
    if not wanted:
        return []
    bare = host[4:] if host.startswith("www.") else host
    path = urlsplit(page).path.rstrip("/")
    pages = conn.execute(
        text("SELECT p.id, p.url FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w) AND p.url LIKE :like"),
        {"h": bare, "w": f"www.{bare}", "like": "%" + path.replace("%", r"\%").replace("_", r"\_") + "%"},
    ).all()
    ids = [page_id for page_id, url in pages if page_key(url) == wanted]
    if not ids:
        return []
    rows = conn.execute(
        text(
            "SELECT kind, before_value, after_value, changed_words, detected_at FROM change_events "
            "WHERE page_id IN :ids AND kind NOT IN :skip ORDER BY detected_at, id"
        ).bindparams(bindparam("ids", expanding=True), bindparam("skip", expanding=True)),
        {"ids": ids, "skip": list(EDIT_SKIP)},
    ).mappings().all()
    days: dict[str, dict] = {}
    for row in rows:
        day = row["detected_at"].date().isoformat()
        entry = days.setdefault(day, {"at": day, "changes": []})
        if any(change["kind"] == row["kind"] for change in entry["changes"]):
            continue  # read twice in a day: the first reading's change stands
        entry["changes"].append({"kind": row["kind"], "before": _cut(row["before_value"]), "after": _cut(row["after_value"]), "words": row["changed_words"]})
    return list(days.values())


def _backlinks(conn, site_id: int, page: str) -> tuple[list[dict], int]:
    """Backlinks pointing at the page, each on the day it was placed (as typed, else the day it went to the mediator).
    Returns them, and how many placed links have no date the chart could use."""
    wanted = page_key(page)
    if not wanted:
        return [], 0
    rows = conn.execute(
        text("SELECT id, source_url, domain, status, target_url, target_final_url, placed, sent_at, anchor, keyword FROM backlinks WHERE site_id = :s ORDER BY id"),
        {"s": site_id},
    ).mappings().all()
    found, undated = [], 0
    for row in rows:
        if wanted not in (page_key(row["target_url"]), page_key(row["target_final_url"])):
            continue
        day = parse_day(row["placed"]) or (row["sent_at"].date() if row["sent_at"] else None)
        if day is None:
            # A link a tool found, or one only planned, was never "placed without a date": only bought links count as missing one.
            undated += row["status"] in ("live", "lost")
            continue
        found.append({
            "id": row["id"], "at": day.isoformat(), "domain": row["domain"], "source_url": row["source_url"], "status": row["status"],
            "anchor": _cut(row["anchor"]), "keyword": _cut(row["keyword"]),
        })
    found.sort(key=lambda link: (link["at"], link["id"]))
    return found, undated


def _boost_dict(row) -> dict:
    return {
        "id": row["id"], "page": row["page_url"], "start": row["started_on"].isoformat(), "end": row["ended_on"].isoformat() if row["ended_on"] else None,
        "note": row["note"], "created_by": row["created_by"],
    }


def boosts(conn, site_id: int, page: str | None = None) -> list[dict]:
    """A site's boosts, oldest first; with a page, only those sent to that page."""
    rows = conn.execute(
        text("SELECT id, page_url, started_on, ended_on, note, created_by FROM page_boosts WHERE site_id = :s ORDER BY started_on, id"), {"s": site_id}
    ).mappings().all()
    wanted = page_key(page) if page else None
    return [_boost_dict(row) for row in rows if wanted is None or page_key(row["page_url"]) == wanted]


def _notes(conn, site_id: int) -> list[dict]:
    """The site's dated notes, the same ones Overview's chart marks."""
    rows = conn.execute(
        text("SELECT id, day, body FROM notes WHERE scope = 'date' AND deleted_at IS NULL AND body <> '' AND day IS NOT NULL AND (site_id = :s OR site_id IS NULL) ORDER BY day, id"),
        {"s": site_id},
    ).mappings().all()
    return [{"id": row["id"], "at": row["day"].isoformat(), "body": _cut(row["body"])} for row in rows]


def history(engine: Engine, site_id: int, keyword_id: int, engine_name: str) -> dict:
    """Everything the keyword panel's history chart draws beside our own line."""
    if engine_name not in rankings.ENGINES:
        raise NotFound("That search engine doesn't exist.")
    built = rankings._rows(engine, site_id, keyword_id)
    if not built["rows"]:
        raise NotFound("That keyword isn't tracked by this site.")
    page = built["rows"][0]["page"]
    with engine.connect() as conn:
        host = require_own(conn, site_id)["host"]
        lines = _lines(conn, site_id, host, keyword_id, engine_name)
        links, undated = _backlinks(conn, site_id, page) if page else ([], 0)
        return {
            "page": page, "lines": lines,
            "edits": _edits(conn, host, page) if page else [],
            "backlinks": links, "backlinks_undated": undated,
            "boosts": boosts(conn, site_id, page) if page else [],
            "notes": _notes(conn, site_id),
        }


# ---- boosts: traffic sent to one page -------------------------------------------------------------------

def _day_of(value, name: str, required: bool) -> date | None:
    if value in (None, ""):
        if required:
            raise Refused(f"Give the {name} date.")
        return None
    try:
        found = datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        raise Refused(f"The {name} date isn't a date.") from None
    if not 2000 <= found.year <= 2100:
        raise Refused(f"The {name} date isn't a date.")
    return found


def add_boost(engine: Engine, body: dict, who: str | None) -> dict:
    """Record that traffic was sent to one of the site's pages, from a day, to a day if it ended."""
    site_id = body.get("site_id")
    page = str(body.get("page") or "").strip()
    start, end = _day_of(body.get("start"), "start", True), _day_of(body.get("end"), "end", False)
    if end and end < start:
        raise Refused("The end date is before the start date.")
    note = " ".join(str(body.get("note") or "").split())
    if len(note) > NOTE_CHARS:
        raise Refused(f"Keep the note under {NOTE_CHARS} characters.")
    with engine.begin() as conn:
        host = require_own(conn, site_id)["host"]
        try:
            parts = urlsplit(page)
            page_host = (parts.hostname or "").lower()
        except ValueError:
            parts, page_host = None, ""
        if parts is None or parts.scheme not in ("http", "https") or not page_host or len(page) > 2000:
            raise Refused("Give the page's full address, starting with https://.")
        if not store.on_host(page_host, host[4:] if host.startswith("www.") else host):
            raise Refused("That page isn't on this website.")
        boost_id = conn.execute(
            text("INSERT INTO page_boosts (site_id, page_url, started_on, ended_on, note, created_by) VALUES (:s, :p, :a, :b, :n, :w)"),
            {"s": site_id, "p": rankings.page_address(page), "a": start, "b": end, "n": note or None, "w": (who or None) and who[:120]},
        ).lastrowid
        row = conn.execute(text("SELECT id, page_url, started_on, ended_on, note, created_by FROM page_boosts WHERE id = :i"), {"i": boost_id}).mappings().one()
        return _boost_dict(row)


def delete_boost(engine: Engine, boost_id: int) -> None:
    with engine.begin() as conn:
        if not conn.execute(text("DELETE FROM page_boosts WHERE id = :i"), {"i": boost_id}).rowcount:
            raise NotFound("That boost doesn't exist.")
