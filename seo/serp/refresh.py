"""The Refresh button: preview, confirm, run in the background, stop.

Only a person pressing Confirm starts this. No command, schedule or job in the app calls start().
Free tools first, in the editable order. A tool that runs out or fails hands over to the next free one. Paid use only
happens when the tool's own switch is on, this run asked for it, and the run's limit has room. A timeout is never tried
again, because it may already have been charged. Credits are written down before the search, so a crash can't hide a spend.
"""
from __future__ import annotations

import json
import time
from decimal import Decimal

from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from seo.core.errors import Conflict, NotFound, Refused
from seo.serp import connections, store
from seo.serp.tools import SearchFailed, TimedOut, ToolStopped, counts_for_keyword, most_cost, pages_for
from seo.worker import queue
from seo.worker.runner import RunAgain, handler

LANE = "refresh"
JOB_KIND = "refresh.run"
CHUNK_SECONDS = 40.0
DEPTHS = (10, 20, 30, 50)
MAX_KEYWORDS = 20_000
FAILS_BEFORE_DROP = 3
STALE_SECONDS = 60  # a run with no job after this long lost its job, and must not hold its keywords forever
ACTIVE = ("queued", "running")
ENGINE_NAMES = {"google": "Google", "duckduckgo": "DuckDuckGo", "bing": "Bing", "yandex": "Yandex"}
INTERRUPTED = "The app stopped during this search. It isn't tried again, because it may already have been charged."


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


# ---- what was asked ---------------------------------------------------------------------------------

def _clean_request(engine: Engine, body: dict) -> dict:
    ids = body.get("keyword_ids")
    if not isinstance(ids, list) or not ids or any(type(i) is not int for i in ids):
        raise Refused("Choose at least one keyword.")
    ids = list(dict.fromkeys(ids))
    if len(ids) > MAX_KEYWORDS:
        raise Refused(f"That's {len(ids)} keywords. The limit for one Refresh is {MAX_KEYWORDS}.")
    engines = body.get("engines")
    if not isinstance(engines, list) or not engines or any(name not in connections.ENGINE_ORDER for name in engines):
        raise Refused("Choose at least one engine.")
    depth = body.get("depth", 10)
    if depth not in DEPTHS:
        raise Refused("The depth is 10, 20, 30 or 50.")
    mode = body.get("mode", "auto")
    if mode not in ("auto", "pick"):
        raise Refused("Tools are automatic or chosen.")
    picked = body.get("picked") or []
    if mode == "pick" and (not isinstance(picked, list) or not picked or any(not isinstance(name, str) for name in picked)):
        raise Refused("Pick at least one tool.")
    allow_paid = body.get("allow_paid", False) is True
    cap = None
    if allow_paid:
        try:
            cap = Decimal(str(body.get("paid_cap")))
        except ArithmeticError as exc:
            raise Refused("Enter a limit for this run, in dollars.") from exc
        if not cap.is_finite() or cap <= 0 or cap > 1000:
            raise Refused("Enter a limit for this run, in dollars.")
    site_id = body.get("site_id")
    if site_id is not None and type(site_id) is not int:
        raise Refused("site_id must be a number.")
    marks = ",".join(str(i) for i in ids[:MAX_KEYWORDS])
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT DISTINCT k.id, k.keyword FROM keywords k JOIN site_keywords sk ON sk.keyword_id = k.id JOIN sites s ON s.id = sk.site_id "
                f"WHERE k.id IN ({marks}) AND s.kind = 'own' ORDER BY k.id"
            )
        ).mappings().all()
    if not rows:
        raise Refused("Those keywords aren't tracked by any of your sites.")
    return {
        "keywords": {row["id"]: row["keyword"] for row in rows}, "engines": [name for name in connections.ENGINE_ORDER if name in engines],
        "depth": depth, "mode": mode, "picked": picked if mode == "pick" else [], "allow_paid": allow_paid, "paid_cap": cap,
        "include_recent": body.get("include_recent", False) is True, "site_id": site_id,
    }


def _sweep(engine: Engine) -> None:
    """A run whose job is gone can't finish. Its keywords must not stay locked, and what it did is kept."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT r.id FROM rank_runs r WHERE r.status IN ('queued', 'running') AND r.created_at < UTC_TIMESTAMP(3) - INTERVAL {STALE_SECONDS} SECOND "
                "AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.active_key = CONCAT('refresh:', r.id))"
            )
        ).all()
    for (run_id,) in rows:
        _finish(engine, run_id, "stopped", "This run lost its background job. Everything checked so far is saved.")


def _running_now(conn, keyword_ids: list[int], engines: list[str]) -> dict[tuple[int, str], str]:
    """Who's already refreshing what."""
    marks, names = ",".join(str(i) for i in keyword_ids), ",".join(f"'{name}'" for name in engines)
    rows = conn.execute(
        text(
            f"SELECT i.keyword_id, i.engine, r.by_name FROM rank_run_items i JOIN rank_runs r ON r.id = i.run_id "
            f"WHERE i.active_key IS NOT NULL AND i.keyword_id IN ({marks}) AND i.engine IN ({names})"
        )
    ).mappings().all()
    return {(row["keyword_id"], row["engine"]): row["by_name"] or "" for row in rows}


def _just_checked(conn, keyword_ids: list[int], engines: list[str], depth: int, hours: int) -> dict[tuple[int, str], float]:
    """A check at least this deep, this recently. A shallower one doesn't count: Check deeper must still work."""
    if hours <= 0:
        return {}
    marks, names = ",".join(str(i) for i in keyword_ids), ",".join(f"'{name}'" for name in engines)
    # Only a check that can fill the keyword's row counts. One from another country, or one marked suspect, answers nothing.
    rows = conn.execute(
        text(
            f"SELECT t.keyword_id, t.engine, k.country, k.language, c.real_location, TIMESTAMPDIFF(MINUTE, MAX(c.checked_at), UTC_TIMESTAMP(3)) AS minutes "
            f"FROM serp_targets t JOIN keywords k ON k.id = t.keyword_id JOIN serp_checks c ON c.target_id = t.id "
            f"WHERE t.device = 'desktop' AND t.keyword_id IN ({marks}) AND t.engine IN ({names}) AND c.status = 'ok' AND c.depth >= :d "
            "AND c.checked_at >= UTC_TIMESTAMP(3) - INTERVAL :h HOUR GROUP BY t.keyword_id, t.engine, k.country, k.language, c.real_location"
        ),
        {"d": depth, "h": hours},
    ).mappings().all()
    newest: dict[tuple[int, str], int] = {}
    for row in rows:
        if counts_for_keyword(row["engine"], row["country"], row["real_location"], row["language"]):
            key = (row["keyword_id"], row["engine"])
            newest[key] = min(newest.get(key, row["minutes"]), row["minutes"])
    return {key: round(minutes / 60, 1) for key, minutes in newest.items()}


def _split(engine: Engine, ask: dict) -> dict:
    ids = list(ask["keywords"])
    hours = int(connections.get_setting(engine, "just_checked_hours"))
    with engine.connect() as conn:
        running = _running_now(conn, ids, ask["engines"])
        recent = {} if ask["include_recent"] else _just_checked(conn, ids, ask["engines"], ask["depth"], hours)
    todo = [(k, name) for k in ids for name in ask["engines"] if (k, name) not in running and (k, name) not in recent]
    return {"todo": todo, "running": running, "recent": recent, "hours": hours}


def _line(engine: Engine, name: str, ask: dict) -> list:
    tools = connections.tools_for(engine, name, include_manual=ask["mode"] == "pick")
    return [tool for tool in tools if tool.name in ask["picked"]] if ask["mode"] == "pick" else tools


# ---- preview ----------------------------------------------------------------------------------------

def preview(engine: Engine, body: dict) -> dict:
    """How many checks each tool will take, and what's left afterwards. It spends nothing and changes nothing."""
    _sweep(engine)
    ask = _clean_request(engine, body)
    parts = _split(engine, ask)
    pools: dict[str, dict] = {}

    def pool(tool) -> dict:
        if tool.name not in pools:
            left, hour = connections.free_left(engine, tool), connections.hour_left(engine, tool)
            pools[tool.name] = {
                "name": tool.name, "cost": most_cost(tool, ask["depth"]), "left": left, "hour_left": hour, "of": getattr(tool, "free_once", None) or getattr(tool, "free_monthly", None),
                "refills": "one-time" if getattr(tool, "free_once", None) is not None else "monthly" if getattr(tool, "free_monthly", None) is not None else "no credits",
                "paid_per": getattr(tool, "paid_per", None), "paid_on": connections.paid_on(engine, tool.name), "checks": 0, "credits": 0, "paid_credits": 0,
            }
        return pools[tool.name]

    def fits_free(p) -> bool:
        cost = max(p["cost"], 1 if p["left"] is not None else 0)
        return (p["left"] is None or p["left"] - p["credits"] >= cost) and (p["hour_left"] is None or p["hour_left"] - p["credits"] >= cost)

    cost_total = Decimal(0)

    def fits_paid(p) -> bool:
        return bool(ask["allow_paid"] and p["paid_on"] and p["paid_per"] and cost_total + Decimal(str(p["paid_per"])) * p["cost"] <= ask["paid_cap"])

    lines = {name: _line(engine, name, ask) for name in ask["engines"]}
    for tools in lines.values():
        for tool in tools:
            pool(tool)
    planned, unassigned = 0, 0
    for keyword_id, name in parts["todo"]:
        chosen = [pools[tool.name] for tool in lines[name]]
        if ask["mode"] == "auto":
            target = next((p for p in chosen if fits_free(p)), None) or next((p for p in chosen if fits_paid(p)), None)
            chosen = [target] if target else []
        if not chosen:
            unassigned += 1
            continue
        for p in chosen:
            if fits_free(p):
                p["credits"] += p["cost"]
            elif fits_paid(p):
                p["paid_credits"] += p["cost"]
                cost_total += Decimal(str(p["paid_per"])) * p["cost"]
            else:
                unassigned += 1
                continue
            p["checks"] += 1
            planned += 1
    names = ask["keywords"]
    return {
        "keywords": len(names), "engines": ask["engines"], "depth": ask["depth"], "pages": pages_for(ask["depth"]), "mode": ask["mode"], "checks": planned,
        "tools": [{**p, "left_after": None if p["left"] is None else max(0, p["left"] - p["credits"])} for p in pools.values()],
        "unassigned": unassigned, "runs_out_after": planned if unassigned else None, "cost": float(cost_total),
        "credits": sum(p["credits"] + p["paid_credits"] for p in pools.values()),
        "running": [{"keyword": names[k], "engine": name, "by": by} for (k, name), by in parts["running"].items()],
        "recent": [{"keyword": names[k], "engine": name, "hours": hours} for (k, name), hours in parts["recent"].items()],
        "just_checked_hours": parts["hours"],
        "no_tools_for": [name for name, tools in lines.items() if not tools],
    }


# ---- confirm ----------------------------------------------------------------------------------------

def start(engine: Engine, body: dict, by: str | None = None) -> dict:
    """Confirm. The same token twice is one run, and keywords someone else is refreshing are left out and named."""
    token = body.get("token")
    if token is not None and (not isinstance(token, str) or not 8 <= len(token) <= 64):
        raise Refused("That request can't be read. Reload the page and try again.")
    if token:
        found = _by_token(engine, token)
        if found:
            return {**found, "repeat": True}
    _sweep(engine)
    ask = _clean_request(engine, body)
    parts = _split(engine, ask)
    lines = {name: _line(engine, name, ask) for name in ask["engines"]}
    if not any(lines.values()):
        raise Refused("No search tool can run these engines. Connect one in Settings.")
    if connections.BROWSER in ask["picked"] and not connections.get_setting(engine, "mac_country"):
        raise Refused("Set the country this Mac is in first, in Settings.")  # without it, its results couldn't be kept apart honestly
    names = ask["keywords"]
    excluded = [{"keyword": names[k], "engine": name, "by": who} for (k, name), who in parts["running"].items()]
    if not parts["todo"]:
        if excluded:
            raise Conflict("These keywords are already being refreshed.")
        raise Refused("These keywords were all checked just now. Tick Check them again to go ahead.")
    tools_each = ask["picked"] if ask["mode"] == "pick" else [None]
    try:
        with engine.begin() as conn:
            run_id = conn.execute(
                text(
                    "INSERT INTO rank_runs (site_id, by_name, idem_key, engines, depth, mode, allow_paid, paid_cap) "
                    "VALUES (:s, :b, :k, :e, :d, :m, :p, :c)"
                ),
                {"s": ask["site_id"], "b": (by or "")[:120] or None, "k": token, "e": json.dumps(ask["engines"]), "d": ask["depth"], "m": ask["mode"], "p": ask["allow_paid"], "c": ask["paid_cap"]},
            ).lastrowid
            total = 0
            for keyword_id, name in parts["todo"]:
                can_use = [tool for tool in tools_each if tool is None or any(t.name == tool for t in lines[name])]
                if not can_use:  # none of the chosen tools covers this engine, so nothing is owed here
                    continue
                key = f"{keyword_id}|{name}|desktop"
                taken = conn.execute(
                    text("INSERT IGNORE INTO rank_run_items (run_id, keyword_id, engine, tool, active_key) VALUES (:r, :k, :e, :t, :a)"),
                    {"r": run_id, "k": keyword_id, "e": name, "t": can_use[0], "a": key},
                ).rowcount
                if not taken:  # someone got there between the check above and now
                    who = conn.execute(text("SELECT r.by_name FROM rank_run_items i JOIN rank_runs r ON r.id = i.run_id WHERE i.active_key = :a"), {"a": key}).scalar()
                    excluded.append({"keyword": names[keyword_id], "engine": name, "by": who or ""})
                    continue
                total += 1
                for extra in can_use[1:]:  # a second chosen tool sits beside the first: same keyword, same run
                    conn.execute(text("INSERT INTO rank_run_items (run_id, keyword_id, engine, tool) VALUES (:r, :k, :e, :t)"), {"r": run_id, "k": keyword_id, "e": name, "t": extra})
                    total += 1
            if not total:
                conn.rollback()
                raise Conflict("These keywords are already being refreshed.")
            conn.execute(text("UPDATE rank_runs SET total = :t, excluded = :x WHERE id = :i"), {"t": total, "x": json.dumps(excluded) if excluded else None, "i": run_id})
    except IntegrityError:
        found = _by_token(engine, token) if token else None
        if found:
            return {**found, "repeat": True}
        raise
    queue.enqueue(engine, LANE, JOB_KIND, payload={"run_id": run_id}, dedupe_key=f"refresh:{run_id}", max_attempts=3)
    return run_dict(engine, run_id)


def _by_token(engine: Engine, token: str) -> dict | None:
    with engine.connect() as conn:
        run_id = conn.execute(text("SELECT id FROM rank_runs WHERE idem_key = :k"), {"k": token}).scalar()
    return run_dict(engine, run_id) if run_id else None


def cancel(engine: Engine, run_id: int) -> dict:
    """What's already saved stays. The search in progress finishes, because it can't be taken back."""
    with engine.begin() as conn:
        found = conn.execute(text("UPDATE rank_runs SET cancel_requested = 1 WHERE id = :i AND status IN ('queued', 'running')"), {"i": run_id}).rowcount
    if not found:
        run_dict(engine, run_id)  # raises if it never existed
    return run_dict(engine, run_id)


# ---- the job ----------------------------------------------------------------------------------------

def _finish(engine: Engine, run_id: int, status: str, reason: str | None = None) -> None:
    with engine.begin() as conn:
        pending_as = "cancelled" if status == "cancelled" else "stopped"
        conn.execute(text("UPDATE rank_run_items SET status = :st, active_key = NULL WHERE run_id = :r AND status = 'pending'"), {"st": pending_as, "r": run_id})
        conn.execute(text("UPDATE rank_run_items SET status = 'failed', error = :e, active_key = NULL WHERE run_id = :r AND status = 'running'"), {"e": INTERRUPTED, "r": run_id})
        not_run = conn.execute(text("SELECT COUNT(*) FROM rank_run_items WHERE run_id = :r AND status IN ('stopped', 'cancelled')"), {"r": run_id}).scalar()
        conn.execute(
            text("UPDATE rank_runs SET status = :st, stop_reason = COALESCE(:why, stop_reason), not_run = :n, finished_at = UTC_TIMESTAMP(3) WHERE id = :i AND status IN ('queued', 'running')"),
            {"st": status, "why": reason[:800] if reason else None, "n": not_run, "i": run_id},
        )


def _settle_item(engine: Engine, item_id: int, status: str, used: str | None = None, check_id: int | None = None, error: str | None = None, run_id: int | None = None, field: str | None = None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE rank_run_items SET status = :s, used_tool = COALESCE(:u, used_tool), check_id = :c, error = :e, active_key = NULL WHERE id = :i"),
            {"s": status, "u": used, "c": check_id, "e": error[:500] if error else None, "i": item_id},
        )
        if field:
            conn.execute(text(f"UPDATE rank_runs SET {field} = {field} + 1 WHERE id = :r"), {"r": run_id})


def assess(engine: Engine, keyword_id: int, name: str, answer) -> str:
    """Bad data happens: Google has fed scrapers wrong pages since October 2026. A result that doesn't look right is kept, marked, and left out of trends.

    Nothing is called suspect for moving: only a page with no results, or one sharing nothing with the last like-for-like page.
    """
    if not answer.results:
        return "suspect"
    with engine.connect() as conn:
        previous = conn.execute(
            text(
                "SELECT c.id FROM serp_checks c JOIN serp_targets t ON t.id = c.target_id WHERE t.keyword_id = :k AND t.engine = :e AND t.device = 'desktop' "
                "AND c.tool = :tool AND c.real_location = :loc AND c.depth = :d AND c.status = 'ok' ORDER BY c.id DESC LIMIT 1"
            ),
            {"k": keyword_id, "e": name, "tool": answer.tool, "loc": answer.real_location, "d": answer.depth},
        ).scalar()
        if previous is None:
            return "ok"
        before = {row[0] for row in conn.execute(text("SELECT domain FROM serp_results WHERE check_id = :c"), {"c": previous}).all()}
    now = {store.host_and_domain(found.url)[1] for found in answer.results}
    if len(before) >= 5 and len(now) >= 5 and not before & now:
        return "suspect"
    if len(before) >= 8 and len(now) <= 2:
        return "suspect"
    return "ok"


class _Picker:
    """Which tool next, for this run. Free tools first, in the order. What a tool can no longer do stays out for the whole run."""

    def __init__(self, engine: Engine, run):
        self.engine, self.run = engine, run
        self.lines: dict[str, list] = {}
        self.dropped: dict[str, str] = dict(_json(run["dropped"]) or {})
        self.spent = Decimal(str(run["spent"] or 0))
        self.last: dict[str, str] = {}

    def line(self, name: str) -> list:
        if name not in self.lines:
            self.lines[name] = connections.tools_for(self.engine, name, include_manual=self.run["mode"] == "pick")
        return self.lines[name]

    def drop(self, tool_name: str, why: str) -> None:
        self.dropped[tool_name] = why
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE rank_runs SET dropped = :d WHERE id = :i"), {"d": json.dumps(self.dropped), "i": self.run["id"]})

    def _paid_fits(self, tool) -> Decimal | None:
        per = getattr(tool, "paid_per", None)
        if not (self.run["allow_paid"] and per and connections.paid_on(self.engine, tool.name)):
            return None
        cost = Decimal(str(per)) * most_cost(tool, self.run["depth"])
        return cost if self.spent + cost <= Decimal(str(self.run["paid_cap"] or 0)) else None

    def named(self, name: str, wanted: str, exclude=()):
        """Choose tools mode: that tool or nothing."""
        tool = next((t for t in self.line(name) if t.name == wanted), None)
        if tool is None or wanted in self.dropped or wanted in exclude:
            return None, False
        if connections.can_afford_a_search(self.engine, tool, self.run["depth"]):
            return tool, False
        if self._paid_fits(tool) is not None:
            return tool, True
        self.drop(wanted, f"{wanted} has no free checks left.")
        return None, False

    def next(self, name: str, exclude=()):
        usable = [t for t in self.line(name) if t.name not in self.dropped and t.name not in exclude]
        for tool in usable:
            if connections.can_afford_a_search(self.engine, tool, self.run["depth"]):
                return tool, False
            self.drop(tool.name, f"{tool.name} has no free checks left.")
        for tool in [t for t in self.line(name) if t.name not in exclude and self.dropped.get(t.name, "").endswith("no free checks left.")]:
            if self._paid_fits(tool) is not None:  # only once every free tool is out
                return tool, True
        return None, False


def _json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _one_search(engine: Engine, picker: _Picker, run, item, tool, paid: bool):
    """Returns the answer, or raises. The most it can cost is written down first."""
    depth, name = run["depth"], item["engine"]
    estimate = most_cost(tool, depth)
    per = Decimal(str(getattr(tool, "paid_per", 0) or 0))
    money = per * estimate if paid else None
    connections.count_use(engine, tool.name, estimate, paid=paid, cost=money, run_id=run["id"], keyword_id=item["keyword_id"], search_engine=name)
    with engine.begin() as conn:
        conn.execute(text("UPDATE rank_run_items SET status = 'running', used_tool = :t WHERE id = :i"), {"t": tool.name, "i": item["id"]})
    try:
        answer = tool.search(item["keyword"], name, item["country"], item["language"], "desktop", depth)
    except TimedOut:
        raise  # it may have been charged: the estimate stays
    except (ToolStopped, SearchFailed):
        connections.count_use(engine, tool.name, -estimate, paid=paid, cost=-money if money else None, run_id=run["id"], keyword_id=item["keyword_id"], search_engine=name, note="not charged")
        raise
    difference = answer.charged - estimate
    connections.count_use(engine, tool.name, difference, paid=paid, cost=per * difference if paid else None, run_id=run["id"], keyword_id=item["keyword_id"], search_engine=name, note="what the tool really charged")
    if paid:
        final = per * answer.charged
        picker.spent += final
        with engine.begin() as conn:
            conn.execute(text("UPDATE rank_runs SET spent = spent + :c WHERE id = :i"), {"c": final, "i": run["id"]})
    return answer


def _save_answer(engine: Engine, item, name: str, answer) -> int:
    return store.save_check(engine, item["keyword_id"], name, answer, "refresh", status=assess(engine, item["keyword_id"], name, answer))


def _work_item(engine: Engine, picker: _Picker, run, item, noted: set, fails: dict) -> str | None:
    """One item, down to done. Returns the engine if it found no tool left for it."""
    name, wanted = item["engine"], item["tool"]
    tried: set[str] = set()
    last_error = None
    while True:
        tool, paid = picker.named(name, wanted, tried) if wanted else picker.next(name, tried)
        if tool is None:
            if tried:
                _settle_item(engine, item["id"], "failed", error=last_error, run_id=run["id"], field="failed")
                return None
            if wanted:
                _settle_item(engine, item["id"], "stopped", error=picker.dropped.get(wanted) or f"{wanted} can't run now.")
                return None
            return name
        previous = picker.last.get(name)
        if previous and previous != tool.name and previous in picker.dropped:
            with engine.begin() as conn:
                conn.execute(text("UPDATE rank_runs SET message = :m WHERE id = :i"), {"m": f"moved|{previous}|{tool.name}", "i": run["id"]})
        picker.last[name] = tool.name
        try:
            answer = _one_search(engine, picker, run, item, tool, paid)
        except ToolStopped as exc:
            connections.note_error(engine, tool.name, str(exc))
            picker.drop(tool.name, str(exc))
            continue
        except TimedOut as exc:  # never again, by this tool or another: press Recheck to spend on it knowingly
            store.save_failed_check(engine, item["keyword_id"], name, tool.name, str(exc))
            _settle_item(engine, item["id"], "timeout", tool.name, error=f"{exc} It wasn't tried again, because it may already have been charged.", run_id=run["id"], field="failed")
            return None
        except SearchFailed as exc:
            store.save_failed_check(engine, item["keyword_id"], name, tool.name, str(exc))
            last_error = str(exc)
            tried.add(tool.name)
            fails[tool.name] = fails.get(tool.name, 0) + 1
            if fails[tool.name] >= FAILS_BEFORE_DROP:
                picker.drop(tool.name, f"{tool.name} failed {FAILS_BEFORE_DROP} searches in a row.")
            continue
        except Exception as exc:  # noqa: BLE001 - a tool answering oddly stops being used, and its saved results stay
            error = f"{type(exc).__name__}: {exc}"
            store.save_failed_check(engine, item["keyword_id"], name, tool.name, error)
            picker.drop(tool.name, f"{tool.name} answered in a way the app can't read.")
            last_error = error
            tried.add(tool.name)
            continue
        check_id = _save_answer(engine, item, name, answer)
        fails[tool.name] = 0
        _settle_item(engine, item["id"], "ok", answer.tool, check_id, run_id=run["id"], field="done")
        if answer.tool not in noted:
            connections.note_ok(engine, answer.tool)
            noted.add(answer.tool)
        return None


def _refresh_pairs(engine: Engine, run_id: int) -> None:
    from seo.competitors import pairs  # imported here: pairs reads what this saves

    with engine.connect() as conn:
        sites = [row[0] for row in conn.execute(
            text("SELECT DISTINCT sk.site_id FROM rank_run_items i JOIN site_keywords sk ON sk.keyword_id = i.keyword_id JOIN sites s ON s.id = sk.site_id WHERE i.run_id = :r AND i.status = 'ok' AND s.kind = 'own'"),
            {"r": run_id},
        ).all()]
    for site_id in sites:
        pairs.refresh_auto_pairs(engine, site_id)


@handler(JOB_KIND)
def run_refresh(job, engine: Engine) -> None:
    run_id = (job.payload or {}).get("run_id")
    with engine.begin() as conn:
        # A process killed in the middle: that search may have gone out, so it's written off, not repeated.
        lost = conn.execute(text("UPDATE rank_run_items SET status = 'failed', error = :e, active_key = NULL WHERE run_id = :r AND status = 'running'"), {"e": INTERRUPTED, "r": run_id}).rowcount
        if lost:
            conn.execute(text("UPDATE rank_runs SET failed = failed + :n WHERE id = :r"), {"n": lost, "r": run_id})
        conn.execute(text("UPDATE rank_runs SET status = 'running', started_at = COALESCE(started_at, UTC_TIMESTAMP(3)) WHERE id = :r AND status = 'queued'"), {"r": run_id})
        run = conn.execute(text("SELECT * FROM rank_runs WHERE id = :r"), {"r": run_id}).mappings().first()
    if run is None or run["status"] != "running":
        return
    picker = _Picker(engine, run)
    started = time.monotonic()
    noted: set[str] = set()
    fails: dict[str, int] = {}
    out_of_tools: set[str] = set()
    worked = 0
    try:
        while True:
            with engine.connect() as conn:
                batch = conn.execute(
                    text(
                        "SELECT i.id, i.keyword_id, i.engine, i.tool, k.keyword, k.country, k.language FROM rank_run_items i JOIN keywords k ON k.id = i.keyword_id "
                        "WHERE i.run_id = :r AND i.status = 'pending' ORDER BY i.id LIMIT 25"
                    ),
                    {"r": run_id},
                ).mappings().all()
            if not batch:
                break
            for item in batch:
                with engine.connect() as conn:
                    cancelled = conn.execute(text("SELECT cancel_requested FROM rank_runs WHERE id = :r"), {"r": run_id}).scalar()
                if cancelled:
                    _finish(engine, run_id, "cancelled")
                    _refresh_pairs(engine, run_id)
                    return
                if worked and time.monotonic() - started >= CHUNK_SECONDS:  # gives the lane back; always one search at least
                    raise RunAgain(0)
                worked += 1
                stuck = _work_item(engine, picker, run, item, noted, fails)
                if stuck:
                    out_of_tools.add(stuck)
                    with engine.begin() as conn:
                        conn.execute(
                            text("UPDATE rank_run_items SET status = 'stopped', error = :e, active_key = NULL WHERE run_id = :r AND engine = :n AND status = 'pending' AND tool IS NULL"),
                            {"e": f"No free tools left for {ENGINE_NAMES.get(stuck, stuck)}.", "r": run_id, "n": stuck},
                        )
                    break  # the batch in hand is out of date now
    finally:
        for tools in picker.lines.values():
            for tool in tools:
                closer = getattr(tool, "close", None)
                if closer:
                    closer()
    reasons = []
    if out_of_tools:
        reasons.append("No free tools left for " + ", ".join(ENGINE_NAMES.get(name, name) for name in sorted(out_of_tools)) + ".")
    reasons += list(dict.fromkeys(picker.dropped.values()))
    with engine.connect() as conn:
        not_done = conn.execute(text("SELECT COUNT(*) FROM rank_run_items WHERE run_id = :r AND status = 'stopped'"), {"r": run_id}).scalar()
    _finish(engine, run_id, "stopped" if not_done else "done", " ".join(reasons) if reasons else None)
    _refresh_pairs(engine, run_id)


# ---- progress ---------------------------------------------------------------------------------------

def run_dict(engine: Engine, run_id: int) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM rank_runs WHERE id = :i"), {"i": run_id}).mappings().first()
    if row is None:
        raise NotFound("That Refresh doesn't exist.")
    message = row["message"] or ""
    moved = message.split("|")[1:3] if message.startswith("moved|") else None
    return {
        "id": row["id"], "status": row["status"], "total": row["total"], "done": row["done"], "failed": row["failed"], "not_run": row["not_run"],
        "moved": {"from": moved[0], "to": moved[1]} if moved else None, "stop_reason": row["stop_reason"], "depth": row["depth"], "mode": row["mode"],
        "engines": _json(row["engines"]) or [], "by": row["by_name"], "excluded": _json(row["excluded"]) or [], "spent": float(row["spent"] or 0),
        "cancel_requested": bool(row["cancel_requested"]), "created_at": _iso(row["created_at"]), "finished_at": _iso(row["finished_at"]),
    }


def active_runs(engine: Engine) -> list[dict]:
    _sweep(engine)
    with engine.connect() as conn:
        ids = [row[0] for row in conn.execute(text("SELECT id FROM rank_runs WHERE status IN ('queued', 'running') ORDER BY id")).all()]
    return [run_dict(engine, run_id) for run_id in ids]
