"""The plan's daily crawl limit: every request any crawler sends counts against one number."""
from __future__ import annotations

from sqlalchemy import Engine, text

DAILY_CRAWL_REQUESTS = 40_000
NEW_DAY_MARGIN_SECONDS = 60


def used_today(engine: Engine) -> int:
    with engine.connect() as conn:
        value = conn.execute(text("SELECT used FROM crawl_budget WHERE day = UTC_DATE()")).scalar()
    return int(value or 0)


def has_room(engine: Engine, limit: int = DAILY_CRAWL_REQUESTS) -> bool:
    return used_today(engine) < limit


def seconds_until_new_day(engine: Engine) -> int:
    """Until shortly after the next UTC midnight, when the count starts again."""
    with engine.connect() as conn:
        left = conn.execute(text("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), UTC_DATE() + INTERVAL 1 DAY)")).scalar()
    return int(left) + NEW_DAY_MARGIN_SECONDS


def charge(engine: Engine, requests: int) -> None:
    if requests <= 0:
        return
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO crawl_budget (day, used) VALUES (UTC_DATE(), :n) ON DUPLICATE KEY UPDATE used = used + :n"),
            {"n": requests},
        )
