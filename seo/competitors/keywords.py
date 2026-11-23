"""A keyword list, and its first check.

Uploading a list runs one check per keyword that has never been checked, to find who really ranks.
That is the one automatic spend in the app, and it uses free tools, plus one always-paid tool (Semscraper) only when the
owner switched its paid use on in Settings (owner, 2026-11-23: Semscraper is the main rank tool; €0.30 per 1,000). When they
run out it stops and says so, and what is left carries on when a tool has free checks again. After that, a
search runs only when someone asks for it.
"""
from __future__ import annotations

import re
import time

from sqlalchemy import Engine, text

from seo.backlinks.cleaner import decode_csv, parse_table
from seo.core.errors import Conflict, NotFound, Refused
from seo.links.service import OWN
from seo.serp import connections, store
from seo.serp.tools import SearchFailed, TimedOut, ToolStopped
from seo.worker import queue
from seo.worker.runner import handler

LANE = "refresh"
JOB_KIND = "keywords.check"
MAX_KEYWORDS = 20_000
MAX_LENGTH = 300
CHUNK_SECONDS = 40.0  # a job gives the lane back about this often, and a new job carries on
DEPTH = 10
FAILS_BEFORE_DROP = 3  # as Refresh: a tool that fails this many searches in a row, timeouts included, is left for this run
FIRST_CHECK_TRIES = 5  # a keyword that keeps failing stops holding its list back after this many tries
STALE_RUN_SECONDS = 60  # a run with no job after this long lost its job, and must not block the button forever
HEADER_NAMES = {
    "keyword", "keywords", "query", "queries", "top queries", "search query", "search queries", "search term", "search terms", "term", "terms",
    "mot-clé", "mot clé", "mots-clés", "mots clés", "mot-cle", "mot cle", "mots-cles", "mots cles", "requête", "requete", "requêtes", "requetes",
    "palabra clave", "palabras clave", "schlüsselwort", "suchbegriff", "parola chiave", "palavra-chave", "palavra chave",
    "كلمة مفتاحية", "الكلمة المفتاحية", "الكلمات المفتاحية", "キーワード", "关键词", "關鍵字", "키워드", "ключевое слово",
}
COUNTRY = re.compile(r"^[A-Za-z]{2}$")
LANGUAGE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,6})?$")  # the column holds 10 characters
_EXCEL_SEP_LINE = re.compile(r"^sep=.$", re.IGNORECASE)


def require_own(conn, site_id) -> dict:
    if type(site_id) is not int:
        raise Refused("site_id must be a number.")
    row = conn.execute(text("SELECT id, host, kind FROM sites WHERE id = :i"), {"i": site_id}).mappings().first()
    if row is None:
        raise NotFound("That website doesn't exist.")
    if row["kind"] != OWN:
        raise Refused("This works from your own websites, not a competitor.")
    return dict(row)


def _is_header(cell: str) -> bool:
    return store.clean_keyword(cell).casefold() in HEADER_NAMES


def _list_lines(source: str) -> list[str]:
    """A plain list: every line is one keyword, commas included, because "coffee, tea" is one search."""
    lines = [line.strip() for line in source.splitlines()]
    lines = [line for line in lines if line]
    if lines and _EXCEL_SEP_LINE.match(lines[0]):
        lines = lines[1:]
    if lines and _is_header(lines[0]):
        lines = lines[1:]
    cells = []
    for line in lines:
        if len(line) >= 2 and line[0] == line[-1] == '"':
            line = line[1:-1].replace('""', '"')
        cells.append(line.rstrip(",;"))  # a spreadsheet saved as text can leave empty columns behind
    return cells


def parse_keywords(data: bytes | str) -> list[str]:
    """One keyword per line, or a table with a keyword column. Any language, any file encoding.

    A comma can be part of a keyword, so a line is only split when the whole text is clearly a table: a header
    the app knows, or a file whose rows all have the same columns. Text pasted from a spreadsheet has tabs.
    """
    pasted = isinstance(data, str)
    source = (data if pasted else decode_csv(data)).lstrip("\ufeff")
    if not source.strip():
        return []
    rows, delimiter = parse_table(source)
    if not rows:
        return []
    width = len(rows[0])
    even = all(len(row) == width for row in rows)
    at = next((i for i, cell in enumerate(rows[0]) if _is_header(cell)), None)
    if width > 1 and at is not None and (even or not pasted):
        cells = [row[at] for row in rows[1:] if at < len(row)]
    elif width > 1 and even and len(rows) > 1 and (delimiter == "\t" or not pasted):
        cells = [row[0] for row in rows]  # columns, but none named: the first one, every row
    else:
        cells = _list_lines(source)
    seen: set[str] = set()
    keywords: list[str] = []
    for cell in cells:
        keyword = store.clean_keyword(cell)
        if not keyword or len(keyword) > MAX_LENGTH:
            continue
        key = keyword.casefold()
        if key not in seen:
            seen.add(key)
            keywords.append(keyword)
    return keywords


def _check_market(country, language) -> tuple[str, str]:
    if not isinstance(country or "", str) or not isinstance(language or "", str):
        raise Refused("The country and language must be codes, such as FR and fr.")
    country = (country or "").strip().upper()
    language = (language or "").strip().lower()
    if country and not COUNTRY.match(country):
        raise Refused("The country must be a two-letter code, such as FR.")
    if language and not LANGUAGE.match(language):
        raise Refused("The language must be a code, such as fr.")
    return country, language


def choose_engine(engine: Engine, wanted: str | None = None) -> str:
    """Google if a tool can search it, otherwise the next engine that has one."""
    if wanted:
        return wanted
    for name in connections.ENGINE_ORDER:
        if connections.tools_for(engine, name):
            return name
    return connections.ENGINE_ORDER[0]


def upload(engine: Engine, site_id: int, data, country: str = "", language: str = "", file_name: str | None = None, search_engine: str | None = None) -> dict:
    from seo.competitors import pairs  # imported here: pairs reads what this module saves

    if not isinstance(data, (str, bytes)):
        raise Refused("Send the keywords as text or as a file.")
    country, language = _check_market(country, language)
    keywords = parse_keywords(data)
    if not keywords:
        raise Refused("No keywords found. Use one per line, or a column named keyword.")
    if len(keywords) > MAX_KEYWORDS:
        raise Refused(f"That's {len(keywords)} keywords. The limit for one list is {MAX_KEYWORDS}.")
    with engine.begin() as conn:
        require_own(conn, site_id)
        name = choose_engine(engine, search_engine)
        run_id = conn.execute(
            text("INSERT INTO keyword_uploads (site_id, file_name, engine, kind, total) VALUES (:s, :f, :e, 'upload', :t)"),
            {"s": site_id, "f": (file_name or "")[:255] or None, "e": name, "t": len(keywords)},
        ).lastrowid
        for keyword in keywords:
            conn.execute(
                text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, :l)"),
                {"k": keyword[:400], "h": store.keyword_hash(keyword), "c": country, "l": language},
            )
            keyword_id = conn.execute(
                text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = :c AND language = :l"),
                {"h": store.keyword_hash(keyword), "c": country, "l": language},
            ).scalar_one()
            conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id, upload_id) VALUES (:s, :k, :u)"), {"s": site_id, "k": keyword_id, "u": run_id})
        new = _pending_count(conn, site_id, name, None)
        conn.execute(text("UPDATE keyword_uploads SET new_keywords = :n WHERE id = :i"), {"n": new, "i": run_id})
        if not new:
            conn.execute(text("UPDATE keyword_uploads SET status = 'complete', finished_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": run_id})
    if new:
        _start(engine, run_id)
    else:
        pairs.refresh_auto_pairs(engine, site_id)  # no search needed, but this site now has more keywords to pair on
    return run_dict(engine, run_id)


def refresh(engine: Engine, site_id: int, search_engine: str | None = None) -> dict:
    """Check every keyword of a site again. Only ever starts from a button."""
    with engine.begin() as conn:
        require_own(conn, site_id)
        conn.execute(text("SELECT id FROM sites WHERE id = :s FOR UPDATE"), {"s": site_id}).first()  # a double click makes one run, not two
        name = choose_engine(engine, search_engine)
        total = conn.execute(text("SELECT COUNT(*) FROM site_keywords WHERE site_id = :s"), {"s": site_id}).scalar()
        if not total:
            raise Refused("Upload your keyword list first.")
        running = conn.execute(
            text(
                "SELECT 1 FROM keyword_uploads u WHERE u.site_id = :s AND u.status IN ('queued', 'running') "
                f"AND (u.created_at >= UTC_TIMESTAMP(3) - INTERVAL {STALE_RUN_SECONDS} SECOND OR {_HAS_JOB}) LIMIT 1"
            ),
            {"s": site_id},
        ).first()
        if running:
            raise Conflict("A check is already running.")
        run_id = conn.execute(
            text("INSERT INTO keyword_uploads (site_id, engine, kind, total, new_keywords) VALUES (:s, :e, 'refresh', :t, :t)"),
            {"s": site_id, "e": name, "t": total},
        ).lastrowid
    _start(engine, run_id)
    return run_dict(engine, run_id)


_HAS_JOB = "EXISTS (SELECT 1 FROM jobs j WHERE j.active_key LIKE CONCAT('keywords:', u.id, ':%'))"


def _queue(engine: Engine, run_id: int, part: int = 0, this_pass: str | None = None) -> None:
    payload = {"run_id": run_id, "part": part, "pass": this_pass}
    queue.enqueue(engine, LANE, JOB_KIND, payload=payload, dedupe_key=f"keywords:{run_id}:{part}", max_attempts=2)


def _tool_line(engine: Engine, run) -> list[tuple[str, object]]:
    """(search engine, tool), in the order to try them.

    A first check only needs to know who ranks, so when one engine's free tools run out it moves on to the next
    engine's. A refresh stays on its engine, because checks from another couldn't be compared with the earlier ones.
    """
    names = [run["engine"]]
    if run["kind"] != "refresh":
        names += [name for name in connections.ENGINE_ORDER if name != run["engine"]]
    return [
        (name, tool) for name in names for tool in connections.not_blocked(engine, connections.tools_for(engine, name))  # not one resting after a bot check
        if not connections.always_paid(tool) or connections.paid_ready(engine, tool)  # a paid one only with its switch on
    ]


def _start(engine: Engine, run_id: int) -> None:
    with engine.connect() as conn:
        run = conn.execute(text("SELECT engine, kind FROM keyword_uploads WHERE id = :i"), {"i": run_id}).mappings().first()
    if _tool_line(engine, run):
        _queue(engine, run_id)
    else:
        _finish(engine, run_id, "waiting", NO_TOOL)


_CHECKS = "FROM serp_targets t JOIN serp_checks c ON c.target_id = t.id WHERE t.keyword_id = k.id"


def _pending_sql(refresh: bool) -> str:
    """The keywords a run still owes a search.

    First check: only a search that worked ends it, on any engine, because one search shows every site on the page.
    So a keyword another of my sites checked needs no second search, and one that failed gets tried again.
    Refresh: a search that worked on this run's engine since the run began.
    Either way a keyword that failed in this pass (:this_pass) waits for a later pass, so a pass always ends.
    """
    if refresh:
        worked = f"{_CHECKS} AND c.status = 'ok' AND t.engine = :e AND c.checked_at >= :since"
        worth_trying = ""
    else:
        worked = f"{_CHECKS} AND c.status = 'ok'"
        worth_trying = f"AND (SELECT COUNT(*) {_CHECKS} AND c.status = 'failed') < {FIRST_CHECK_TRIES}"
    failed_now = f"{_CHECKS} AND c.status = 'failed' AND t.engine = :e AND c.checked_at >= :this_pass"
    return (
        "FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s "
        f"AND NOT EXISTS (SELECT 1 {worked}) AND NOT EXISTS (SELECT 1 {failed_now}) {worth_trying}"
    )


def _pending_count(conn, site_id: int, name: str, since, this_pass=None) -> int:
    """Without a pass, this counts what no search has answered yet, failed ones included."""
    params = {"s": site_id, "e": name, "since": since, "this_pass": this_pass}
    return conn.execute(text(f"SELECT COUNT(*) {_pending_sql(since is not None)}"), params).scalar()


def _pending(conn, site_id: int, name: str, since, this_pass, limit: int = 200) -> list:
    return conn.execute(
        text(f"SELECT k.id, k.keyword, k.country, k.language {_pending_sql(since is not None)} ORDER BY k.id LIMIT :n"),
        {"s": site_id, "e": name, "since": since, "this_pass": this_pass, "n": limit},
    ).mappings().all()


def _set_run(engine: Engine, run_id: int, /, **values) -> None:  # `/` because a run has a column called engine
    clause = ", ".join(f"{name} = :{name}" for name in values)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE keyword_uploads SET {clause} WHERE id = :i"), {**values, "i": run_id})


def _finish(engine: Engine, run_id: int, status: str, reason: str | None = None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE keyword_uploads SET status = :st, stop_reason = :r, finished_at = UTC_TIMESTAMP(3) WHERE id = :i"),
            {"st": status, "r": reason[:300] if reason else None, "i": run_id},
        )
        site_id = conn.execute(text("SELECT site_id FROM keyword_uploads WHERE id = :i"), {"i": run_id}).scalar()
    from seo.insights import engine as insights_engine  # imported here: insights reads what this module saves

    if site_id:
        insights_engine.enqueue(engine, site_id)  # Rank and clicks reads these checks


NO_TOOL = "No search tool connected: add a key in Settings."
KEPT = "Progress is saved; the rest resumes when a tool has free checks."
KEPT_REFRESH = "Everything checked so far is saved. Press it again when a tool has free checks."


@handler(JOB_KIND)
def run_check(job, engine: Engine) -> None:
    from seo.competitors import pairs  # imported here: pairs reads what this module saves

    payload = job.payload or {}
    run_id, part = payload.get("run_id"), payload.get("part", 0)
    with engine.connect() as conn:
        run = conn.execute(text("SELECT * FROM keyword_uploads WHERE id = :i"), {"i": run_id}).mappings().first()
        this_pass = payload.get("pass") or str(conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar())
    if run is None or run["status"] == "complete":
        return
    site_id, is_refresh = run["site_id"], run["kind"] == "refresh"
    since = run["created_at"] if is_refresh else None
    trigger = "refresh" if is_refresh else "first_upload"
    _set_run(engine, run_id, status="running", stop_reason=None)

    line = _tool_line(engine, run)
    started = time.monotonic()
    stopped_because: list[str] = []
    hour_limited = False
    checked, failed, tried = run["checked"], run["failed"], 0
    noted_ok = False
    fails: dict[str, int] = {}  # failed searches in a row, timeouts included, per tool (F124)

    def out_of_time() -> bool:  # always one keyword per job at least, so a slow tool still moves forward
        return tried > 0 and time.monotonic() - started >= CHUNK_SECONDS

    while line and not out_of_time():
        with engine.connect() as conn:
            batch = _pending(conn, site_id, line[0][0], since, this_pass, limit=25)
        if not batch:
            break
        for keyword in batch:
            if not line or out_of_time():
                break
            answer = None
            while line and answer is None:
                name, tool = line[0]
                paid = connections.paid_ready(engine, tool)  # always paid, switch on: _tool_line only keeps it then
                if not paid and not connections.can_afford_a_search(engine, tool):
                    if connections.out_only_for_this_hour(engine, tool):
                        hour_limited = True
                        stopped_because.append(f"{tool.name} has used all its checks for this hour.")
                    else:
                        stopped_because.append(f"{tool.name} has no free checks left this month.")
                    line.pop(0)
                    continue
                try:
                    # Booked before it goes out and settled after, so a timeout stays counted (F15). No count_use after it.
                    answer = connections.spend_on_search(engine, tool, keyword["keyword"], name, keyword["country"], keyword["language"], "desktop", DEPTH, paid=paid, keyword_id=keyword["id"], note=trigger)
                except ToolStopped as exc:  # never moves to paid credits: the list holds free tools, and a paid one only when switched on
                    stopped_because.append(str(exc))
                    connections.note_error(engine, tool.name, str(exc))
                    line.pop(0)
                except Exception as exc:  # noqa: BLE001 - one keyword failing, or a tool answering oddly, must not strand the list
                    error = str(exc) if isinstance(exc, SearchFailed) else f"{type(exc).__name__}: {exc}"
                    if isinstance(exc, TimedOut):  # never by another tool in this pass: it may already have been charged
                        error = f"{exc} It wasn't tried again, because it may already have been charged."
                    store.save_failed_check(engine, keyword["id"], name, tool.name, error, trigger)
                    failed += 1
                    tried += 1
                    _set_run(engine, run_id, failed=failed)
                    if isinstance(exc, SearchFailed):
                        fails[tool.name] = fails.get(tool.name, 0) + 1
                        if fails[tool.name] >= FAILS_BEFORE_DROP:
                            stopped_because.append(f"{tool.name} failed {FAILS_BEFORE_DROP} searches in a row.")
                            line.pop(0)
                    break
            if answer is not None:
                fails[answer.tool] = 0
                store.save_check(engine, keyword["id"], name, answer, trigger)
                checked += 1
                tried += 1
                _set_run(engine, run_id, checked=checked, failed=failed, tool=answer.tool, engine=name)
                if not noted_ok:
                    connections.note_ok(engine, answer.tool)
                    noted_ok = True

    name = line[0][0] if line else run["engine"]
    with engine.connect() as conn:
        to_try_now = _pending_count(conn, site_id, name, since, this_pass)
        unanswered = _pending_count(conn, site_id, name, since)
    if line and to_try_now:  # out of time, not out of work
        _queue(engine, run_id, part + 1, this_pass)
        return
    if not line and unanswered:
        reasons = list(dict.fromkeys(stopped_because))
        _finish(engine, run_id, "waiting", " ".join([*reasons, KEPT_REFRESH if is_refresh else KEPT]) if reasons else NO_TOOL)
        if hour_limited and not is_refresh:  # a list only: a refresh spends on a click, never by itself
            queue.enqueue(engine, LANE, JOB_KIND, payload={"run_id": run_id, "part": part + 1, "pass": None}, dedupe_key=f"keywords:{run_id}:hour:{int(time.time())}", run_after_seconds=3600, max_attempts=2)
    elif unanswered and not is_refresh:
        _finish(engine, run_id, "waiting", f"{unanswered} keyword{'' if unanswered == 1 else 's'} couldn't be checked this time. The app tries again on its next run.")
    else:
        _finish(engine, run_id, "complete")
    pairs.refresh_auto_pairs(engine, site_id)


def resume_waiting(engine: Engine) -> list[int]:
    """Carry on with lists that were waiting for a tool, or lost their job. Runs daily on hosting, and when a key is saved."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                # Lists only. A schedule calls this, and no schedule may ever start or restart a refresh: only a click spends on those.
                "SELECT u.id, u.engine, u.kind FROM keyword_uploads u WHERE u.kind <> 'refresh' AND (u.status = 'waiting' OR (u.status IN ('queued', 'running') "
                f"AND u.created_at < UTC_TIMESTAMP(3) - INTERVAL {STALE_RUN_SECONDS} SECOND AND NOT {_HAS_JOB})) ORDER BY u.id"
            )
        ).mappings().all()
    resumed = []
    for row in rows:
        # A first check goes to the best engine that can search now, so a key saved today is used today.
        run = {"engine": row["engine"] if row["kind"] == "refresh" else choose_engine(engine), "kind": row["kind"]}
        if any(connections.can_afford_a_search(engine, tool) or connections.paid_ready(engine, tool) for _, tool in _tool_line(engine, run)):
            _set_run(engine, row["id"], status="queued", engine=run["engine"], stop_reason=None, finished_at=None, failed=0)
            _queue(engine, row["id"], int(time.time()))
            resumed.append(row["id"])
    return resumed


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def run_dict(engine: Engine, run_id: int) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM keyword_uploads WHERE id = :i"), {"i": run_id}).mappings().first()
    if row is None:
        raise NotFound("That check doesn't exist.")
    return {
        "id": row["id"], "site_id": row["site_id"], "file_name": row["file_name"], "engine": row["engine"], "kind": row["kind"],
        "status": row["status"], "stop_reason": row["stop_reason"], "total": row["total"], "new_keywords": row["new_keywords"],
        "checked": row["checked"], "failed": row["failed"], "tool": row["tool"], "created_at": _iso(row["created_at"]), "finished_at": _iso(row["finished_at"]),
    }


def latest_run(engine: Engine, site_id: int) -> dict | None:
    with engine.connect() as conn:
        run_id = conn.execute(text("SELECT MAX(id) FROM keyword_uploads WHERE site_id = :s"), {"s": site_id}).scalar()
    return run_dict(engine, run_id) if run_id else None
