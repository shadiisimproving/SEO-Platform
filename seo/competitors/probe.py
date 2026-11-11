"""Keyword check: keywords someone types, searched only when they ask, to see which of their competitors rank for each.

Kept apart from the site's own keyword list. These keywords never join Refresh, the Keywords screen or competitor
suggestions, so nothing here ever spends a search by itself, until the person presses Add to my keywords on one: then it
is one of their tracked keywords like any other, and stays listed here too. A check starts from a button, after the screen has shown how
many searches it takes and how many free checks each tool has left, and the person confirmed.

Free checks only, in the same tool order as Refresh, and on one engine so the positions compare. When the free checks run
out it stops, keeps what it found and says so. A competitor set to Pages only or Off isn't shown, as everywhere else.
"""
from __future__ import annotations

import json
import time

from sqlalchemy import Engine, text

from seo.competitors import tracking
from seo.competitors.keywords import _check_market, _iso, choose_engine, parse_keywords, require_own
from seo.core.errors import Conflict, NotFound, Refused
from seo.serp import connections, store
from seo.serp.tools import SearchFailed, TimedOut, ToolStopped, counts_for_keyword, most_cost
from seo.worker import queue
from seo.worker.runner import handler

LANE = "refresh"
JOB_KIND = "keywords.probe"
TRIGGER = "keyword_check"
MAX_KEYWORDS = 500
DEPTH = 10
CHUNK_SECONDS = 40.0
STALE_RUN_SECONDS = 60
NO_TOOL = "No search tool connected. Add one in Settings, then check again."
FAILS_BEFORE_DROP = 3  # in a row, timeouts included: as Refresh does (F124)
NO_KEYWORDS = "Type at least one keyword, one on each line."
STOPPED = "Stopped early. Progress is saved; press Check to carry on."
KEPT = "Progress is saved. Press Check again when a tool has free checks."


# ---- the list ---------------------------------------------------------------------------------------

def add(engine: Engine, site_id: int, data, country: str = "", language: str = "") -> dict:
    if data is None or (isinstance(data, str) and not data.strip()):
        raise Refused(NO_KEYWORDS)
    if not isinstance(data, str):
        raise Refused("Send the keywords as text.")
    country, language = _check_market(country, language)
    keywords = parse_keywords(data)
    if not keywords:
        raise Refused(NO_KEYWORDS)
    with engine.begin() as conn:
        require_own(conn, site_id)
        have = conn.execute(text("SELECT COUNT(*) FROM probe_keywords WHERE site_id = :s"), {"s": site_id}).scalar()
        if have + len(keywords) > MAX_KEYWORDS:
            raise Refused(f"Keyword check holds at most {MAX_KEYWORDS} keywords. Remove some first.")
        added = 0
        for keyword in keywords:
            conn.execute(
                text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, :l)"),
                {"k": keyword[:400], "h": store.keyword_hash(keyword), "c": country, "l": language},
            )
            keyword_id = conn.execute(
                text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = :c AND language = :l"),
                {"h": store.keyword_hash(keyword), "c": country, "l": language},
            ).scalar_one()
            added += conn.execute(text("INSERT IGNORE INTO probe_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": keyword_id}).rowcount
    return {"added": added, "already": len(keywords) - added}


def remove(engine: Engine, site_id: int, keyword_id: int) -> dict:
    """Answers with what Undo needs to put the keyword back where it was. Its checks are kept: they belong to the keyword."""
    with engine.begin() as conn:
        require_own(conn, site_id)
        row = conn.execute(text("SELECT id, created_at FROM probe_keywords WHERE site_id = :s AND keyword_id = :k"), {"s": site_id, "k": keyword_id}).mappings().first()
        if row is None or not conn.execute(text("DELETE FROM probe_keywords WHERE id = :i"), {"i": row["id"]}).rowcount:
            raise NotFound("That keyword isn't in the list.")
    return {"ok": True, "undo": {"place": row["id"], "added_at": _iso(row["created_at"])}}


def restore(engine: Engine, site_id: int, keyword_id: int, place=None) -> dict:
    """Undo of a remove: the keyword comes back in its old place when that's free, else at the top."""
    with engine.begin() as conn:
        require_own(conn, site_id)
        if not conn.execute(text("SELECT 1 FROM keywords WHERE id = :k"), {"k": keyword_id}).first():
            raise NotFound("That keyword doesn't exist.")
        if conn.execute(text("SELECT 1 FROM probe_keywords WHERE site_id = :s AND keyword_id = :k"), {"s": site_id, "k": keyword_id}).first():
            return {"ok": True}
        have = conn.execute(text("SELECT COUNT(*) FROM probe_keywords WHERE site_id = :s"), {"s": site_id}).scalar()
        if have >= MAX_KEYWORDS:
            raise Refused(f"Keyword check holds at most {MAX_KEYWORDS} keywords. Remove some first.")
        free = type(place) is int and place > 0 and not conn.execute(text("SELECT 1 FROM probe_keywords WHERE id = :i"), {"i": place}).first()
        if free:
            conn.execute(text("INSERT INTO probe_keywords (id, site_id, keyword_id) VALUES (:i, :s, :k)"), {"i": place, "s": site_id, "k": keyword_id})
        else:
            conn.execute(text("INSERT INTO probe_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": keyword_id})
    return {"ok": True}


def track(engine: Engine, site_id: int, keyword_id: int) -> dict:
    """Adds a keyword from here to the site's own tracked keywords, on the person's click. It stays here too.
    No search runs: its check so far counts at once, and Refresh checks it from now on like any other keyword."""
    from seo.competitors import pairs  # imported here: pairs reads what the keyword list holds

    with engine.begin() as conn:
        require_own(conn, site_id)
        if not conn.execute(text("SELECT 1 FROM probe_keywords WHERE site_id = :s AND keyword_id = :k"), {"s": site_id, "k": keyword_id}).first():
            raise NotFound("That keyword isn't in the list.")
        added = conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": keyword_id}).rowcount
    if added:
        pairs.refresh_auto_pairs(engine, site_id)  # a checked keyword may pair one of my pages with a competitor's now
    return {"tracked": True, "added": bool(added)}


def _ids(conn, site_id: int, only=None) -> list[int]:
    ids = [row[0] for row in conn.execute(text("SELECT keyword_id FROM probe_keywords WHERE site_id = :s ORDER BY id"), {"s": site_id})]
    if only:
        wanted = {int(i) for i in only}
        ids = [i for i in ids if i in wanted]
    return ids


# ---- what a check would cost --------------------------------------------------------------------------

def _tools(engine: Engine, name: str) -> list[dict]:
    out = []
    for tool in connections.tools_for(engine, name):
        cost = max(most_cost(tool, DEPTH), 1)
        left = connections.free_left(engine, tool)
        hour = connections.hour_left(engine, tool)
        room = None if left is None and hour is None else min(x for x in (left, hour) if x is not None)
        out.append({"tool": tool.name, "free_left": left, "searches": None if room is None else room // cost})
    return out


def _just_checked(engine: Engine, conn, ids: list[int], name: str) -> tuple[set[int], int]:
    """Keywords with a good check on this engine, in their own country, within the hours Refresh uses
    (Settings, 12 by default). Checking them again would spend a search for the same answer, so they're left out."""
    hours = int(connections.get_setting(engine, "just_checked_hours") or 0)
    if hours <= 0 or not ids:
        return set(), hours
    marks = ",".join(str(int(i)) for i in ids)
    rows = conn.execute(
        text(
            "SELECT DISTINCT t.keyword_id, k.country, k.language, c.real_location FROM serp_targets t JOIN keywords k ON k.id = t.keyword_id "
            f"JOIN serp_checks c ON c.target_id = t.id WHERE t.keyword_id IN ({marks}) AND t.engine = :e AND t.device = 'desktop' AND c.status = 'ok' "
            "AND c.depth >= :d AND c.checked_at >= UTC_TIMESTAMP(3) - INTERVAL :h HOUR"
        ),
        {"e": name, "d": DEPTH, "h": hours},
    ).mappings().all()
    return {r["keyword_id"] for r in rows if counts_for_keyword(name, r["country"], r["real_location"], r["language"])}, hours


def recent_words(n: int, hours: int) -> str:
    if n == 1:
        return f"Checked in the last {hours} hours: no search spent."
    return f"All checked in the last {hours} hours: no search spent."  # the screen's own words (comp-probe.js), French there


def estimate(engine: Engine, site_id: int, only=None) -> dict:
    name = choose_engine(engine)
    with engine.connect() as conn:
        require_own(conn, site_id)
        ids = _ids(conn, site_id, only)
        recent, hours = _just_checked(engine, conn, ids, name)
    ids = [i for i in ids if i not in recent]
    tools = _tools(engine, name)
    room = None if any(t["searches"] is None for t in tools) else sum(t["searches"] for t in tools)
    return {
        "searches": len(ids), "engine": name, "tools": tools, "connected": bool(tools),
        "can_now": len(ids) if room is None else min(len(ids), room),
        "recent": len(recent), "recent_ids": sorted(recent), "hours": hours,
    }


# ---- a check -------------------------------------------------------------------------------------------

def _running(conn, site_id: int) -> bool:
    return bool(conn.execute(
        text(
            "SELECT 1 FROM probe_runs r WHERE r.site_id = :s AND r.status IN ('queued', 'running') "
            f"AND (r.created_at >= UTC_TIMESTAMP(3) - INTERVAL {STALE_RUN_SECONDS} SECOND "
            "OR EXISTS (SELECT 1 FROM jobs j WHERE j.active_key LIKE CONCAT('probe:', r.id, ':%'))) LIMIT 1"
        ),
        {"s": site_id},
    ).first())


def start(engine: Engine, site_id: int, only=None) -> dict:
    if only is not None and (not isinstance(only, list) or not all(isinstance(i, int) for i in only)):
        raise Refused("only must be a list of keyword ids.")
    name = choose_engine(engine)
    if not connections.tools_for(engine, name):
        raise Refused(NO_TOOL)
    with engine.begin() as conn:
        require_own(conn, site_id)
        conn.execute(text("SELECT id FROM sites WHERE id = :s FOR UPDATE"), {"s": site_id}).first()  # a double click makes one run
        if _running(conn, site_id):
            raise Conflict("A check is already running.")
        ids = _ids(conn, site_id, only)
        if not ids:
            raise Refused("Add a keyword first.")
        recent, hours = _just_checked(engine, conn, ids, name)
        if recent and len(recent) == len(ids):  # a repeat a few seconds later spends nothing (UX review B7)
            raise Refused(recent_words(len(recent), hours))
        run_id = conn.execute(
            text("INSERT INTO probe_runs (site_id, engine, only_ids, total) VALUES (:s, :e, :o, :t)"),
            {"s": site_id, "e": name, "o": json.dumps(only) if only else None, "t": len(ids) - len(recent)},
        ).lastrowid
    _queue(engine, run_id)
    return run_dict(engine, run_id)


def _queue(engine: Engine, run_id: int, part: int = 0, this_pass: str | None = None) -> None:
    queue.enqueue(engine, LANE, JOB_KIND, payload={"run_id": run_id, "part": part, "pass": this_pass}, dedupe_key=f"probe:{run_id}:{part}", max_attempts=2)


def _pending(conn, run, this_pass) -> list:
    """Keywords of the run with no good check on its engine since it began, and no failed one in this pass."""
    ids = _ids(conn, run["site_id"], json.loads(run["only_ids"]) if isinstance(run["only_ids"], str) else run["only_ids"])
    if not ids:
        return []
    marks = ",".join(str(int(i)) for i in ids)
    checks = "FROM serp_targets t JOIN serp_checks c ON c.target_id = t.id WHERE t.keyword_id = k.id AND t.engine = :e"
    return conn.execute(
        text(
            f"SELECT k.id, k.keyword, k.country, k.language FROM keywords k WHERE k.id IN ({marks}) "
            f"AND NOT EXISTS (SELECT 1 {checks} AND c.status = 'ok' AND c.checked_at >= :since) "
            f"AND NOT EXISTS (SELECT 1 {checks} AND c.status = 'failed' AND c.checked_at >= :pass) ORDER BY k.id"
        ),
        {"e": run["engine"], "since": run["created_at"], "pass": this_pass},
    ).mappings().all()


def _set(engine: Engine, run_id: int, **values) -> None:
    clause = ", ".join(f"{name} = :{name}" for name in values)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE probe_runs SET {clause} WHERE id = :i"), {**values, "i": run_id})


def _finish(engine: Engine, run_id: int, status: str, reason: str | None = None) -> None:
    _set(engine, run_id, status=status, stop_reason=reason[:300] if reason else None)
    with engine.begin() as conn:
        conn.execute(text("UPDATE probe_runs SET finished_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": run_id})


@handler(JOB_KIND)
def run_probe(job, engine: Engine) -> None:
    payload = job.payload or {}
    run_id, part = payload.get("run_id"), payload.get("part", 0)
    with engine.connect() as conn:
        run = conn.execute(text("SELECT * FROM probe_runs WHERE id = :i"), {"i": run_id}).mappings().first()
        this_pass = payload.get("pass") or str(conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar())
    if run is None or run["status"] in ("complete", "waiting"):
        return
    _set(engine, run_id, status="running")
    name = run["engine"]
    line = connections.not_blocked(engine, list(connections.tools_for(engine, name)))  # one engine only, so every position compares; not a tool resting after a bot check
    started, tried, stopped, fails = time.monotonic(), 0, [], {}
    checked, failed = run["checked"], run["failed"]
    with engine.connect() as conn:
        todo = list(_pending(conn, run, this_pass))
        # What was just checked before this run is left out, as start() said: those keywords have no check since the run began.
        recent, _hours = _just_checked(engine, conn, [k["id"] for k in todo], name)
        todo = [k for k in todo if k["id"] not in recent]
    while todo and line:
        if tried and time.monotonic() - started >= CHUNK_SECONDS:
            _queue(engine, run_id, part + 1, this_pass)
            return
        keyword = todo[0]
        tool = line[0]
        if not connections.can_afford_a_search(engine, tool, DEPTH):  # free checks only, and never past an allowance
            stopped.append(f"{tool.name} has no free checks left for now.")
            line.pop(0)
            continue
        try:
            # Booked before it goes out, settled after (seo.serp.connections, F64): a timeout stays counted.
            answer = connections.spend_on_search(engine, tool, keyword["keyword"], name, keyword["country"], keyword["language"], "desktop", DEPTH, keyword_id=keyword["id"], note="keyword check")
        except ToolStopped as exc:
            stopped.append(str(exc))
            connections.note_error(engine, tool.name, str(exc))
            line.pop(0)
            continue
        except Exception as exc:  # noqa: BLE001 - one keyword failing must not strand the rest
            error = str(exc) if isinstance(exc, SearchFailed) else f"{type(exc).__name__}: {exc}"
            if isinstance(exc, TimedOut):  # not tried again in this run, by this tool or another: it may have been charged
                error = f"{exc} It wasn't tried again, because it may already have been charged."
            store.save_failed_check(engine, keyword["id"], name, tool.name, error, TRIGGER)
            failed += 1
            tried += 1
            todo.pop(0)
            _set(engine, run_id, failed=failed)
            if isinstance(exc, SearchFailed):  # timeouts too: a tool that keeps failing is dropped, as Refresh does
                fails[tool.name] = fails.get(tool.name, 0) + 1
                if fails[tool.name] >= FAILS_BEFORE_DROP:
                    stopped.append(f"{tool.name} failed {FAILS_BEFORE_DROP} searches in a row.")
                    line.pop(0)
            continue
        fails[tool.name] = 0
        store.save_check(engine, keyword["id"], name, answer, TRIGGER)
        connections.note_ok(engine, answer.tool)
        checked += 1
        tried += 1
        todo.pop(0)
        _set(engine, run_id, checked=checked, failed=failed, tool=answer.tool)
    if todo:
        reasons = " ".join(dict.fromkeys(stopped))
        _finish(engine, run_id, "waiting", f"{reasons} {KEPT}".strip() if reasons else NO_TOOL)
    elif failed:
        _finish(engine, run_id, "complete", f"{failed} keyword{'' if failed == 1 else 's'} couldn't be checked. Press Check again to retry.")
    else:
        _finish(engine, run_id, "complete")


def run_dict(engine: Engine, run_id: int | None) -> dict | None:
    if not run_id:
        return None
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM probe_runs WHERE id = :i"), {"i": run_id}).mappings().first()
    if row is None:
        return None
    return {
        "id": row["id"], "status": row["status"], "engine": row["engine"], "total": row["total"], "checked": row["checked"], "failed": row["failed"],
        "tool": row["tool"], "reason": row["stop_reason"], "created_at": _iso(row["created_at"]), "finished_at": _iso(row["finished_at"]),
    }


# ---- the page -----------------------------------------------------------------------------------------

def listing(engine: Engine, site_id: int) -> dict:
    """Each keyword with its newest check on the engine in use: my position and each competitor's that ranks."""
    name = choose_engine(engine)
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        modes = tracking.of_site(conn, site_id)
        rivals = [
            dict(r) for r in conn.execute(
                text("SELECT s.id, s.host FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s ORDER BY s.host"), {"s": site_id}
            ).mappings()
        ]
        rows = conn.execute(
            text(
                "SELECT pk.keyword_id, pk.created_at AS added_at, k.keyword, k.country, k.language, "
                "EXISTS (SELECT 1 FROM site_keywords sk WHERE sk.site_id = pk.site_id AND sk.keyword_id = pk.keyword_id) AS tracked, "
                "(SELECT MAX(c.id) FROM serp_targets t JOIN serp_checks c ON c.target_id = t.id WHERE t.keyword_id = k.id AND t.engine = :e AND c.status = 'ok') AS check_id "
                "FROM probe_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE pk.site_id = :s ORDER BY pk.id DESC"
            ),
            {"s": site_id, "e": name},
        ).mappings().all()
        check_ids = [r["check_id"] for r in rows if r["check_id"]]
        checks = {}
        if check_ids:
            marks = ",".join(str(int(i)) for i in check_ids)
            found = conn.execute(
                text(f"SELECT c.id, c.tool, c.real_location, c.checked_at FROM serp_checks c WHERE c.id IN ({marks})")
            ).mappings().all()
            checks = {c["id"]: {**dict(c), "results": []} for c in found}
            for r in conn.execute(text(f"SELECT check_id, position, url, host FROM serp_results WHERE check_id IN ({marks}) ORDER BY check_id, position")).mappings():
                checks[r["check_id"]]["results"].append(dict(r))
        run_id = conn.execute(text("SELECT MAX(id) FROM probe_runs WHERE site_id = :s"), {"s": site_id}).scalar()
        market = conn.execute(  # the market this site's own keywords use most, as the form's starting choice
            text("SELECT k.country, k.language, COUNT(*) AS n FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s GROUP BY k.country, k.language ORDER BY n DESC LIMIT 1"),
            {"s": site_id},
        ).mappings().first()
        alive = _running(conn, site_id)
    run = run_dict(engine, run_id)
    if run and run["status"] in ("queued", "running") and not alive:  # its job is gone (F65): the buttons work again
        run.update(status="complete", reason=STOPPED)
    shown = [r for r in rivals if modes.get(r["id"]) == tracking.ON]  # Pages only and Off show no keyword numbers anywhere

    def best(results, host):
        return next((x for x in results if store.on_host(x["host"], host)), None)

    keywords = []
    for row in rows:
        check = checks.get(row["check_id"])
        item = {
            "id": row["keyword_id"], "keyword": row["keyword"], "country": row["country"], "language": row["language"], "added_at": _iso(row["added_at"]),
            "checked": bool(check), "tracked": bool(row["tracked"]),
        }
        if check:
            mine = best(check["results"], site["host"])
            ranks = []
            for rival in shown:
                hit = best(check["results"], rival["host"])
                if hit:
                    ranks.append({"id": rival["id"], "host": rival["host"], "display": store.to_display_host(rival["host"]), "position": hit["position"], "url": hit["url"]})
            ranks.sort(key=lambda x: (x["position"], x["host"]))
            item.update({
                "checked_at": _iso(check["checked_at"]), "tool": check["tool"], "location": check["real_location"],
                "me": {"position": mine["position"], "url": mine["url"]} if mine else None, "competitors": ranks,
            })
        keywords.append(item)
    return {
        "engine": name, "keywords": keywords, "competitors_shown": len(shown), "competitors_hidden": len(rivals) - len(shown),
        "most": MAX_KEYWORDS, "depth": DEPTH, "run": run,
        "country": market["country"] if market else "", "language": market["language"] if market else "",
    }
