"""How long each request took (2026-11-16, the owner: "the app is very slow"). The access log has no durations, so the slow
answers couldn't be named. Each request now gets one line in var/logs/timings.log, tab separated:

    when (UTC)  method  path?query  status  total ms  database ms  queries  bytes

and a Server-Timing header, so the browser's network tab shows the same split. The file starts again (one old copy kept)
past 5 MB. Nothing about the person is written, only addresses the app itself serves. Off in tests and with TIMINGS=0."""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from flask import Flask, g, has_request_context, request
from sqlalchemy import event

from seo import config

LOG = config.VAR / "logs" / "timings.log"
KEEP_UP_TO = 5 * 1024 * 1024
PATH_UP_TO = 200


def on() -> bool:
    return os.environ.get("TIMINGS", "1") != "0" and "PYTEST_CURRENT_TEST" not in os.environ


def _query_starts(conn, cursor, statement, parameters, context, executemany):
    if has_request_context():
        g._query_t0 = time.perf_counter()


def _query_ends(conn, cursor, statement, parameters, context, executemany):
    if has_request_context() and "_query_t0" in g:
        g._db_s = g.get("_db_s", 0.0) + time.perf_counter() - g._query_t0
        g._queries = g.get("_queries", 0) + 1


def install(app: Flask) -> None:
    engine = app.config["ENGINE"]
    # Once per engine: tests build many apps on one engine, and each listener would count every query again.
    if not event.contains(engine, "before_cursor_execute", _query_starts):
        event.listen(engine, "before_cursor_execute", _query_starts)
        event.listen(engine, "after_cursor_execute", _query_ends)

    @app.before_request
    def clock_starts():
        g._t0 = time.perf_counter()

    @app.after_request
    def clock_stops(response):
        if "_t0" not in g:
            return response
        total = (time.perf_counter() - g._t0) * 1000
        db = g.get("_db_s", 0.0) * 1000
        response.headers["Server-Timing"] = f"app;dur={total:.0f}, db;dur={db:.0f};desc=\"{g.get('_queries', 0)} queries\""
        if on():
            size = response.calculate_content_length() if not response.is_streamed else None
            write(f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}\t{request.method}\t{request.full_path.rstrip('?')[:PATH_UP_TO]}\t"
                  f"{response.status_code}\t{total:.0f}\t{db:.0f}\t{g.get('_queries', 0)}\t{size if size is not None else '-'}\n")
        return response


def write(line: str) -> None:
    """One short append per request: Passenger may run several app processes, and a line this small lands whole."""
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > KEEP_UP_TO:
            os.replace(LOG, LOG.with_suffix(".log.1"))
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass  # a full disk or a race on the rename never breaks an answer
