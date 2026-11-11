"""DuckDuckGo positions, checked by themselves (owner, 2026-11-11).

DuckDuckGo has no tool for site owners, so its positions used to come only from the Refresh button. The owner asked for
them automatically, every day and on Refresh data, on free searches only, and never through SerpApi: its 250 free
searches a month are Google's and AI Overviews'.

Which tool:
1. DuckDuckGo direct: no key, no credits. DuckDuckGo shows the hosting server a bot check (live, 2026-11-11: on the first
   search, twice), so after one it rests for REST_HOURS. It gets one try a day, and the app never tries to get past a check.
2. Bright Data, on its free credits only (Refresh never pays without a person's own limit): it reads DuckDuckGo's page as
   HTML (tools.BrightData._duckduckgo). Its free 5,000 a month also serve Google, so these checks take at most
   MONTH_CAP a month, spread evenly over the month's days, oldest DuckDuckGo positions first. When Bright Data refuses
   DuckDuckGo (live, 2026-11-11: the owner's zone has "No parser found" for it), it rests for REST_HOURS too.

When: every day for each of my sites, from collect-due (hourly cron), and on Refresh data. Keywords with a DuckDuckGo
position newer than FRESH_HOURS are left alone, so pressing Refresh data twice doesn't search twice.

Both are ordinary Refresh runs in Choose-tools mode, started by "Automatic": the Keywords tray follows them, Stop works,
and a person's own Refresh leaves out the keywords one of these is checking. The Refresh button still works as before.
"""
from __future__ import annotations

import calendar
import math
from datetime import datetime, timezone

from sqlalchemy import Engine, text

from seo.core.errors import Conflict, Refused
from seo.serp import connections, refresh

ENGINE_NAME = "duckduckgo"
DDG, BRIGHT = connections.DDG, connections.BRIGHT
BY = "Automatic"
DEPTH = 10  # the Refresh dialog's default and the first check's depth: checks are only compared at the same depth
REST_HOURS = 24  # after a bot check, DuckDuckGo direct waits this long before its next try
FRESH_HOURS = 20  # a DuckDuckGo position newer than this isn't checked again
MONTH_CAP = 2000  # Bright Data credits a month for these checks, out of its free 5,000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tools(engine: Engine) -> dict:
    """The DuckDuckGo tools that can run now, by name. Only what's needed from them is kept; their clients are closed."""
    tools = connections.tools_for(engine, ENGINE_NAME, include_manual=True)
    try:
        return {tool.name: {"left": connections.free_left(engine, tool)} for tool in tools}
    finally:
        for tool in tools:
            closer = getattr(tool, "close", None)
            if closer:
                closer()


# Why a tool was dropped from a run, in words that mean trying again within the day won't help.
STOPS = {
    DDG: ("bot check", "slow down"),
    # Live 2026-11-11: the owner's zone answered "No parser found" to every DuckDuckGo address, so the hourly pass must
    # not knock on it again each hour. Failing 3 in a row, or running out, rests it too.
    BRIGHT: ("can't read DuckDuckGo", "bot check", "searches in a row", "refused the key", "no free"),
}


def _resting(engine: Engine, tool: str) -> bool:
    """This tool was dropped from a Refresh run in the last REST_HOURS for one of its STOPS reasons."""
    with engine.connect() as conn:
        reasons = [row[0] for row in conn.execute(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(dropped, :path)) FROM rank_runs "
                "WHERE created_at >= UTC_TIMESTAMP(3) - INTERVAL :h HOUR AND JSON_EXTRACT(dropped, :path) IS NOT NULL"
            ),
            {"h": REST_HOURS, "path": f'$."{tool}"'},
        ).all()]
    return any(word in (reason or "") for reason in reasons for word in STOPS[tool])


def _due(engine: Engine, site_id: int) -> list[int]:
    """This site's keywords whose DuckDuckGo position is missing or older than FRESH_HOURS, oldest first."""
    with engine.connect() as conn:
        return [row[0] for row in conn.execute(
            text(
                "SELECT keyword_id FROM (SELECT sk.keyword_id, MAX(c.checked_at) AS last FROM site_keywords sk "
                "JOIN sites s ON s.id = sk.site_id AND s.kind = 'own' "
                "LEFT JOIN serp_targets t ON t.keyword_id = sk.keyword_id AND t.engine = :e AND t.device = 'desktop' "
                "LEFT JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' "
                "WHERE sk.site_id = :s GROUP BY sk.keyword_id) seen "
                "WHERE last IS NULL OR last < UTC_TIMESTAMP(3) - INTERVAL :h HOUR ORDER BY last IS NOT NULL, last, keyword_id"
            ),
            {"e": ENGINE_NAME, "s": site_id, "h": FRESH_HOURS},
        ).all()]


def _run_status(engine: Engine, token: str) -> str | None:
    with engine.connect() as conn:
        return conn.execute(text("SELECT status FROM rank_runs WHERE idem_key = :k"), {"k": token}).scalar()


def bright_budget(engine: Engine, free_left: int | None) -> int:
    """How many Bright Data searches these checks may still start today: the month's cap spread over the days left,
    never past Bright Data's own free credits, and less what's already waiting in a run."""
    with engine.connect() as conn:
        used = conn.execute(
            text(
                "SELECT COALESCE(SUM(l.amount), 0) AS month, COALESCE(SUM(CASE WHEN l.created_at >= UTC_DATE() THEN l.amount END), 0) AS today "
                "FROM credit_ledger l JOIN rank_runs r ON r.id = l.run_id "
                "WHERE l.tool = :t AND r.by_name = :by AND l.created_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01')"
            ),
            {"t": BRIGHT, "by": BY},
        ).mappings().first()
        waiting = conn.execute(
            text("SELECT COUNT(*) FROM rank_run_items i JOIN rank_runs r ON r.id = i.run_id WHERE i.tool = :t AND r.by_name = :by AND i.status = 'pending'"),
            {"t": BRIGHT, "by": BY},
        ).scalar()
    month, today = int(used["month"]), int(used["today"])
    now = _now()
    days_left = calendar.monthrange(now.year, now.month)[1] - now.day + 1
    todays_share = math.ceil(max(0, MONTH_CAP - (month - today)) / days_left)
    allowed = min(todays_share - today, MONTH_CAP - month) - waiting
    if free_left is not None:
        allowed = min(allowed, free_left - waiting)
    return max(0, allowed)


def _start(engine: Engine, site_id: int, keyword_ids: list[int], tool: str, token: str | None) -> dict | None:
    body = {"keyword_ids": keyword_ids, "engines": [ENGINE_NAME], "depth": DEPTH, "mode": "pick", "picked": [tool], "site_id": site_id, "include_recent": True}
    if token:
        body["token"] = token
    try:
        run = refresh.start(engine, body, BY)
    except (Refused, Conflict):  # all of them being checked already, or nothing left to check
        return None
    return None if run.get("repeat") else run


def queue_site(engine: Engine, site_id: int, daily: bool = False) -> dict | None:
    """Start a DuckDuckGo check of this site's keywords that need one. None when nothing started; it never raises for that.

    daily: the cron's pass. DuckDuckGo direct gets one try a day; Bright Data takes over once that try is over."""
    due = _due(engine, site_id)
    if not due:
        return None
    tools = _tools(engine)
    if DDG in tools and not _resting(engine, DDG):
        if not daily:
            return _start(engine, site_id, due, DDG, None)
        token = f"auto-ddg-{site_id}-{_now():%Y%m%d}"
        status = _run_status(engine, token)
        if status is None:
            return _start(engine, site_id, due, DDG, token)
        if status in refresh.ACTIVE:  # today's try is still going: Bright Data waits for what it leaves
            return None
    if BRIGHT in tools and not _resting(engine, BRIGHT):
        allowed = bright_budget(engine, tools[BRIGHT]["left"])
        if allowed:
            return _start(engine, site_id, due[:allowed], BRIGHT, None)
    return None


def enqueue_due(engine: Engine) -> list[int]:
    """Today's DuckDuckGo check for each of my sites with keywords. Safe to call as often as cron likes."""
    with engine.connect() as conn:
        sites = [row[0] for row in conn.execute(
            text("SELECT s.id FROM sites s WHERE s.kind = 'own' AND EXISTS (SELECT 1 FROM site_keywords sk WHERE sk.site_id = s.id) ORDER BY s.id")
        ).all()]
    return [site_id for site_id in sites if queue_site(engine, site_id, daily=True)]
