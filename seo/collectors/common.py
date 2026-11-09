"""What every collector shares: which days to read, saving what a day gave, and the record of the last try."""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, Engine, text


def digest(*parts) -> str:
    return hashlib.md5("\x1f".join(str(part) for part in parts).encode("utf-8")).hexdigest()


GOOGLE_TIME = ZoneInfo("America/Los_Angeles")  # Search Console counts its days in Pacific time


def today(engine: Engine) -> date:
    with engine.connect() as conn:
        return conn.execute(text("SELECT UTC_DATE()")).scalar()


def google_today(engine: Engine, now: datetime | None = None) -> date:
    """Today as Search Console counts it. Between midnight UTC and about 8 a.m. UTC that is still yesterday."""
    if now is None:
        with engine.connect() as conn:
            now = conn.execute(text("SELECT UTC_TIMESTAMP()")).scalar()
    return now.replace(tzinfo=timezone.utc).astimezone(GOOGLE_TIME).date()


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


def pending_days(
    engine: Engine, site_id: int, source: str, newest: date, oldest: date, reread_days: int,
    reread_hours: float = 20, hot_from: date | None = None, hot_minutes: float = 50,
) -> list[date]:
    """Newest first. The last few days again if not read in the last reread_hours, because sources revise them, then every day never read.

    hot_from: days from it on are still changing at the source (Search Console's fresh days), so they're read again once they're
    older than hot_minutes. It asks the database what's missing, so a killed job carries on where it was, and running it twice
    does nothing extra.
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT day, saved_at > UTC_TIMESTAMP(3) - INTERVAL :h SECOND AS fresh, saved_at > UTC_TIMESTAMP(3) - INTERVAL :m SECOND AS hot "
                "FROM coverage WHERE site_id = :s AND source = :c AND day BETWEEN :a AND :b"
            ),
            {"s": site_id, "c": source, "a": oldest, "b": newest, "h": int(reread_hours * 3600), "m": int(hot_minutes * 60)},
        ).all()
    seen = {row[0]: (bool(row[1]), bool(row[2])) for row in rows}
    days = []
    current = newest
    while current >= oldest:
        recent = (newest - current).days < reread_days
        hot = hot_from is not None and current >= hot_from
        if current not in seen or (recent and not seen[current][0]) or (hot and not seen[current][1]):
            days.append(current)
        current -= timedelta(days=1)
    return days
