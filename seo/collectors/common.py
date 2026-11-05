"""What every collector shares: which days to read, saving what a day gave, and the record of the last try."""
from __future__ import annotations

import hashlib
from datetime import date, timedelta

from sqlalchemy import Connection, Engine, text


def digest(*parts) -> str:
    return hashlib.md5("\x1f".join(str(part) for part in parts).encode("utf-8")).hexdigest()


def today(engine: Engine) -> date:
    with engine.connect() as conn:
        return conn.execute(text("SELECT UTC_DATE()")).scalar()


def source_row(engine: Engine, site_id: int, source: str):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT ss.*, s.host, s.start_url FROM site_sources ss JOIN sites s ON s.id = ss.site_id WHERE ss.site_id = :s AND ss.source = :c"),
            {"s": site_id, "c": source},
        ).mappings().first()


def started(engine: Engine, site_id: int, source: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_attempt_at = UTC_TIMESTAMP(3) WHERE site_id = :s AND source = :c"), {"s": site_id, "c": source})


def succeeded(engine: Engine, site_id: int, source: str, through: date | None = None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE site_sources SET last_ok_at = UTC_TIMESTAMP(3), last_error = NULL, data_through = GREATEST(COALESCE(data_through, :d), COALESCE(:d, data_through)) WHERE site_id = :s AND source = :c"),
            {"s": site_id, "c": source, "d": through},
        )


def failed(engine: Engine, site_id: int, source: str, message: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_error = :e WHERE site_id = :s AND source = :c"), {"s": site_id, "c": source, "e": message[:500]})


def save_coverage(conn: Connection, site_id: int, source: str, day: date, rows: int, status: str = "ok", hid_rows: bool = False, note: str | None = None) -> None:
    conn.execute(
        text(
            "INSERT INTO coverage (site_id, source, day, status, hid_rows, `rows`, note, saved_at) VALUES (:s, :c, :d, :t, :h, :r, :n, UTC_TIMESTAMP(3)) "
            "ON DUPLICATE KEY UPDATE status = :t, hid_rows = :h, `rows` = :r, note = :n, saved_at = UTC_TIMESTAMP(3)"
        ),
        {"s": site_id, "c": source, "d": day, "t": status, "h": hid_rows, "r": rows, "n": note},
    )


def pending_days(engine: Engine, site_id: int, source: str, newest: date, oldest: date, reread_days: int) -> list[date]:
    """Newest first. The last few days again if not read in the last 20 hours, because sources revise them, then every day never read.

    It asks the database what's missing, so a killed job carries on where it was, and running it twice does nothing extra.
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT day, saved_at > UTC_TIMESTAMP(3) - INTERVAL 20 HOUR AS fresh FROM coverage WHERE site_id = :s AND source = :c AND day BETWEEN :a AND :b"),
            {"s": site_id, "c": source, "a": oldest, "b": newest},
        ).all()
    seen = {row[0]: bool(row[1]) for row in rows}
    days = []
    current = newest
    while current >= oldest:
        recent = (newest - current).days < reread_days
        if current not in seen or (recent and not seen[current]):
            days.append(current)
        current -= timedelta(days=1)
    return days
