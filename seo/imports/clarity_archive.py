"""The old Clarity archive, in two steps, so nothing private reaches the server.

`read_archive` runs on the Mac, on the old project's `data/clarity.db`. That file also holds visitor session ids,
recording links and encrypted Clarity tokens, so it never leaves the Mac: this picks out daily counts only, and
`scripts/clarity_archive_export.py` writes them to a small JSON file. Pages, devices and countries stay behind too,
because `clarity_daily` has no place for them.

`import_archive` runs in the app when that file is uploaded in Settings. It only ever adds days. A day already there
stays, because the app's own pull is better than an old copy, so uploading twice changes nothing. It never touches
`site_sources`: an upload isn't a pull, so Clarity doesn't start to look connected.

The file's days are the visits' own days (UTC), not read days. The old project dated a recordings-export session by its
start (`started.date()`) and an API pull by the middle of its 24-hour window (`harvest.logical_date`). The app's own pull
is stored under the day it ran, and covers the day before (SEO review 2026-11-17, W10), so a file day is stored one day
on, as the read that would have covered it. Every reader of `clarity_daily` then reads both the same way, and a day the
app's pull already covers is the one that stays.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.collectors import common
from seo.core.errors import Refused

FORMAT = "seo-command-center/clarity-archive"
VERSION = 1
MAX_BYTES = 5 * 1024 * 1024
_MAX_SITES = 200
_MAX_DAYS = 5000
_MAX_REFERRERS = 1000
NOTE_RECORDINGS = "Old Clarity data, from its recordings export: sessions and referrers only."
NOTE_EDGE = "Old Clarity data: only part of this day, at the edge of the export."
NOTE_INCOMPLETE = "Old Clarity data: Clarity's answer for this day was incomplete."


def _host(url: str) -> str:
    value = url.strip().lower()
    host = urlsplit(value if "//" in value else f"//{value}").hostname or ""
    return host.removeprefix("www.")


def _note(status: str, sources: str) -> str | None:
    if status == "clipped":
        return NOTE_EDGE
    if status == "complete":
        return None
    return NOTE_RECORDINGS if "csv" in sources else NOTE_INCOMPLETE


def _whole(value) -> int | None:
    return None if value is None else int(round(value))


def read_archive(path: str | Path) -> dict:
    """Daily counts per site from the old database, opened read-only."""
    path = Path(path).resolve()
    try:
        db = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    except sqlite3.OperationalError as exc:
        raise Refused(f"Can't open {path}.") from exc
    try:
        sites = db.execute("SELECT id, url FROM site ORDER BY id").fetchall()
        coverage = {(row[0], row[1]): (row[2], row[3] or "") for row in db.execute("SELECT site_id, logical_date, status, sources FROM day_coverage")}
        totals = defaultdict(dict)
        for site, day, metric, measure, value in db.execute("SELECT site_id, logical_date, metric, measure, value FROM daily_fact WHERE slice_key = 'totals'"):
            totals[(site, day)][(metric, measure)] = value
        referrers = defaultdict(lambda: defaultdict(float))
        rows = db.execute(
            "SELECT site_id, logical_date, dim_json, value FROM daily_fact "
            "WHERE (slice_key = 'source_medium' AND metric = 'traffic' AND measure = 'sessions') OR (slice_key = 'referrer_host' AND metric = 'session_rollup' AND measure = 'sessions')"
        )
        for site, day, dim, value in rows:
            dims = json.loads(dim or "{}")
            name = dims.get("Source") or dims.get("Referrer")
            if name:  # a blank source is dropped, as the live collector does
                referrers[(site, day)][name] += value or 0
    except sqlite3.DatabaseError as exc:
        raise Refused(f"{path} isn't a Clarity archive: {exc}") from exc
    finally:
        db.close()

    out = []
    for site_id, url in sites:
        days = []
        for (site, day), facts in sorted(totals.items()):
            if site != site_id:
                continue
            status, sources = coverage.get((site, day), ("partial", ""))
            days.append(
                {
                    "day": day,
                    # Same fields as collect_clarity: events first, because sessions_with_metric is every session looked at.
                    "sessions": _whole(facts.get(("traffic", "sessions"), facts.get(("session_rollup", "sessions")))),
                    "scroll_depth": facts.get(("scroll_depth", "scroll_depth_pct")),
                    "rage_clicks": _whole(facts.get(("rage_clicks", "metric_events"))),
                    "dead_clicks": _whole(facts.get(("dead_clicks", "metric_events"))),
                    "referrers": [{"source": name, "sessions": _whole(count)} for name, count in sorted(referrers[(site, day)].items(), key=lambda pair: (-pair[1], pair[0]))],
                    "status": "ok" if status == "complete" else "partial",
                    "note": _note(status, sources),
                }
            )
        out.append({"host": _host(url), "days": days})
    return {"format": FORMAT, "version": VERSION, "sites": out}


def stored_day(visit_day: date) -> date:
    """The day a file's visit day is stored under: the day of the app's read that covers it (see the top of this file)."""
    return visit_day + timedelta(days=1)


# ---- loading the file --------------------------------------------------------------------------------
def _count(value) -> bool:
    return value is None or (isinstance(value, int) and not isinstance(value, bool) and value >= 0)


def _check_day(row, latest: date) -> dict:
    if not isinstance(row, dict):
        raise Refused("This file has a day that can't be read.")
    word = row.get("day")
    try:
        day = date.fromisoformat(word) if isinstance(word, str) else None
    except ValueError:
        day = None
    if day is None:
        raise Refused(f"This file has a day that isn't a date: {str(word)[:40]}")
    if day > latest:
        raise Refused(f"This file has a day in the future: {word}")
    scroll = row.get("scroll_depth")
    fine = (
        all(_count(row.get(name)) for name in ("sessions", "rage_clicks", "dead_clicks"))
        and (scroll is None or (isinstance(scroll, (int, float)) and not isinstance(scroll, bool) and 0 <= scroll <= 100))
        and row.get("status") in ("ok", "partial")
        and (row.get("note") is None or (isinstance(row["note"], str) and len(row["note"]) <= 300))
    )
    referrers = row.get("referrers", [])
    fine = fine and isinstance(referrers, list) and len(referrers) <= _MAX_REFERRERS
    fine = fine and all(isinstance(r, dict) and isinstance(r.get("source"), str) and 0 < len(r["source"]) <= 300 and _count(r.get("sessions")) for r in referrers)
    if not fine:
        raise Refused(f"This file has numbers that can't be right on {word}.")
    return {"day": day, "sessions": row.get("sessions"), "scroll_depth": scroll, "rage_clicks": row.get("rage_clicks"), "dead_clicks": row.get("dead_clicks"), "referrers": referrers, "status": row["status"], "note": row.get("note")}


def check_file(data) -> list[tuple[str, list[dict]]]:
    """Every day is checked before anything is written, so one bad row can't leave half a file behind."""
    if not isinstance(data, dict) or data.get("format") != FORMAT or data.get("version") != VERSION:
        raise Refused("This isn't a Clarity archive file. Make it with scripts/clarity_archive_export.py.")
    sites = data.get("sites")
    if not isinstance(sites, list) or len(sites) > _MAX_SITES:
        raise Refused("This Clarity archive file can't be read.")
    latest = date.today() + timedelta(days=1)  # the Mac and the server can be a timezone apart
    checked = []
    for site in sites:
        if not isinstance(site, dict) or not isinstance(site.get("host"), str) or not isinstance(site.get("days"), list) or len(site["days"]) > _MAX_DAYS:
            raise Refused("This Clarity archive file can't be read.")
        host = _host(site["host"])
        if not host or len(host) > 190:
            raise Refused("This Clarity archive file has a site with no usable address.")
        checked.append((host, [_check_day(row, latest) for row in site["days"]]))
    return checked


def import_archive(engine: Engine, data, preview: bool = False) -> dict:
    """Adds the days a site doesn't have yet. A preview does the same work and rolls it back, so its counts are the real ones."""
    checked = check_file(data)
    result = {"preview": preview, "sites": [], "missing_sites": []}
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            for host, days in checked:
                site_id = conn.execute(text("SELECT id FROM sites WHERE host = :h AND kind = 'own'"), {"h": host}).scalar()
                if site_id is None:  # never created from a file, and a competitor is never given my data
                    result["missing_sites"].append({"host": host, "days": len(days)})
                    continue
                have = {row[0] for row in conn.execute(text("SELECT day FROM clarity_daily WHERE site_id = :s"), {"s": site_id})}
                added = 0
                for row in days:
                    read_day = stored_day(row["day"])
                    if read_day in have:
                        continue
                    have.add(read_day)
                    conn.execute(
                        text("INSERT INTO clarity_daily (site_id, day, sessions, scroll_depth, rage_clicks, dead_clicks, referrers) VALUES (:s, :d, :n, :c, :r, :x, :f)"),
                        {"s": site_id, "d": read_day, "n": row["sessions"], "c": row["scroll_depth"], "r": row["rage_clicks"], "x": row["dead_clicks"], "f": json.dumps(row["referrers"], ensure_ascii=False)},
                    )
                    common.save_coverage(conn, site_id, "clarity", read_day, 1, status=row["status"], note=row["note"])
                    added += 1
                listed = sorted(row["day"] for row in days)
                result["sites"].append(
                    {"host": host, "added": added, "kept": len(days) - added, "first_day": listed[0].isoformat() if listed else None, "last_day": listed[-1].isoformat() if listed else None}
                )
        except Exception:
            transaction.rollback()
            raise
        if preview:
            transaction.rollback()
        else:
            transaction.commit()
    return result


def read_upload(filename: str, raw: bytes) -> dict:
    if not filename.lower().endswith(".json"):
        raise Refused("Upload the .json file made by scripts/clarity_archive_export.py.")
    if len(raw) > MAX_BYTES:
        raise Refused(f"The file is too large. The limit is {MAX_BYTES // (1024 * 1024)} MB.")
    try:
        return json.loads(raw)
    except (ValueError, RecursionError) as exc:
        raise Refused("This isn't a Clarity archive file. Make it with scripts/clarity_archive_export.py.") from exc
