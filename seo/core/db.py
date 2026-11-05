"""Database access. Every session is in UTC and the pool is deliberately small.

The server's own time zone is SYSTEM on this Mac and Europe/Paris on o2switch, so
a session that did not force UTC would store times hours off. o2switch allows 35
connections per DB user across all processes, hence the small pool.
"""
from __future__ import annotations

from sqlalchemy import URL, Engine, create_engine

from seo import config


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
    return create_engine(
        url,
        pool_size=3,
        max_overflow=2,
        pool_pre_ping=True,
        pool_recycle=280,
        isolation_level="READ COMMITTED",
        connect_args={"init_command": "SET time_zone='+00:00'", "connect_timeout": 10},
    )
