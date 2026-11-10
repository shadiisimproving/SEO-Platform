"""Database access. Every session is in UTC and the pool is deliberately small.

The server's own time zone is SYSTEM on this Mac and Europe/Paris on o2switch, so
a session that did not force UTC would store times hours off.

The pool, sized for shared hosting. o2switch allows 35 connections per DB user across all processes, and every process
has its own pool: Passenger's web processes (single-threaded, up to about 6) and the cron ticks (crawl, refresh,
collectors every minute, uptime-due and the *-due commands now and then: about 5 at once). One request or job needs one
connection, a job's heartbeat thread a second, so 3 at most per process: 11 x 3 = 33, under 35. A request that waits
gives up after 10 s, not 30, so a fault shows quickly instead of hanging the screen.

On the Mac (and on the test databases) the local server runs the web and the workers as threads of one process, and the
local MariaDB allows 151, so the pool there is larger. DB_POOL_SIZE and DB_MAX_OVERFLOW in .env override both.

The fault of 2026-11-10 (backlinks calls hanging 30 s then 500) wasn't the size: a request held one connection and asked
for a second inside it (seo/backlinks/service.py list_for_site), so a few at once each held one and waited for another.
tests/test_db_pool.py checks the screens' routes for that pattern.
"""
from __future__ import annotations

import sys

from sqlalchemy import URL, Engine, create_engine

from seo import config

HOSTING_POOL = (2, 1)  # kept open, extra when busy
LOCAL_POOL = (5, 5)
POOL_TIMEOUT_SECONDS = 10


def pool_sizes(test: bool = False, platform: str | None = None) -> tuple[int, int]:
    local = test or (platform or sys.platform) == "darwin"
    size, overflow = LOCAL_POOL if local else HOSTING_POOL
    return int(config.get("DB_POOL_SIZE", str(size))), int(config.get("DB_MAX_OVERFLOW", str(overflow)))


def make_engine(test: bool = False) -> Engine:
    url = URL.create(
        "mariadb+pymysql",
        username=config.get("DB_USER"),
        password=config.get("DB_PASSWORD"),
        host=config.get("DB_HOST", "127.0.0.1"),
        port=int(config.get("DB_PORT", "3306")),
        database=config.get("DB_NAME_TEST" if test else "DB_NAME"),
        query={"charset": "utf8mb4"},
    )
    size, overflow = pool_sizes(test)
    return create_engine(
        url,
        pool_size=size,
        max_overflow=overflow,
        pool_timeout=POOL_TIMEOUT_SECONDS,
        pool_pre_ping=True,
        pool_recycle=280,
        isolation_level="READ COMMITTED",
        connect_args={"init_command": "SET time_zone='+00:00'", "connect_timeout": 10},
    )
