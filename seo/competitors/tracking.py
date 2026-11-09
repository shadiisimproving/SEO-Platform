"""How closely a site follows each competitor: on, pages or off.

- on: everything.
- pages: no keyword numbers anywhere. Its pages are still read, its links still count, notes stay.
- off: paused. Nothing about it is shown in numbers and its pages aren't read. It stays in the list.

No setting spends a search on a competitor: positions only ever come from checks of my own keywords. A competitor
that is not on is also left out of Moz, the one place its domain could use free rows.

The setting belongs to a site and a competitor, so one rival can be on for one site and off for another. Its pages are
read while any site has it on or pages, because a page read belongs to the competitor, not to a site.
"""
from __future__ import annotations

from sqlalchemy import Engine, text

from seo.competitors.keywords import require_own
from seo.core.errors import NotFound, Refused

ON, PAGES, OFF = "on", "pages", "off"
CHOICES = (ON, PAGES, OFF)
READS_PAGES = (ON, PAGES)

# SQL pieces, for queries that join site_competitors as `sc`.
KEYWORDS_SQL = "sc.tracking = 'on'"
PAGES_SQL = "sc.tracking <> 'off'"

_KEYWORD_COUNTS = ("shared", "they_ahead", "i_ahead", "theirs_only")
_KEYWORD_COMPARE = ("shared", "they_ahead", "i_ahead", "level", "theirs_only", "mine_only", "my_average", "their_average", "ai_cited_me", "ai_cited_them", "ai_overviews")
_KEYWORD_EVENTS = ("rank_new", "rank_lost", "rank_up", "rank_down", "ai_cited", "ai_dropped")


def of_site(conn, site_id: int) -> dict[int, str]:
    rows = conn.execute(text("SELECT competitor_id, tracking FROM site_competitors WHERE site_id = :s"), {"s": site_id}).all()
    return {competitor_id: tracking for competitor_id, tracking in rows}


def set_tracking(engine: Engine, site_id, competitor_id, tracking) -> dict:
    if tracking not in CHOICES:
        raise Refused("Tracking is on, pages or off.")
    if type(competitor_id) is not int:
        raise Refused("competitor_id must be a number.")
    with engine.begin() as conn:
        require_own(conn, site_id)
        before = conn.execute(
            text("SELECT tracking FROM site_competitors WHERE site_id = :s AND competitor_id = :c FOR UPDATE"), {"s": site_id, "c": competitor_id}
        ).scalar()
        if before is None:
            raise NotFound("That competitor isn't on this website.")
        conn.execute(text("UPDATE site_competitors SET tracking = :t WHERE site_id = :s AND competitor_id = :c"), {"t": tracking, "s": site_id, "c": competitor_id})
    if tracking in READS_PAGES and before not in READS_PAGES:
        _read_if_never_read(engine, competitor_id)
    if tracking == ON and before != ON:
        from seo.competitors import pairs  # pairs imports from here: imported late

        pairs.refresh_auto_pairs(engine, site_id)
    return {"competitor_id": competitor_id, "tracking": tracking}


def _read_if_never_read(engine: Engine, competitor_id: int) -> None:
    """Turned back on: pages that were never read get read now. Otherwise the next daily read catches up."""
    from seo.competitors.suggest import queue_crawl

    with engine.connect() as conn:
        read = conn.execute(text("SELECT 1 FROM competitor_crawls WHERE competitor_id = :c AND finished_at IS NOT NULL"), {"c": competitor_id}).first()
    if read is None:
        queue_crawl(engine, competitor_id)


def reads_pages(conn, competitor_id: int) -> bool:
    """Any site still wants its pages read."""
    return conn.execute(text(f"SELECT 1 FROM site_competitors sc WHERE sc.competitor_id = :c AND {PAGES_SQL} LIMIT 1"), {"c": competitor_id}).first() is not None


def hosts_not_on(conn) -> set[str]:
    """Competitor hosts no site has on, for Moz to leave alone."""
    rows = conn.execute(text(
        "SELECT s.host FROM sites s JOIN site_competitors sc ON sc.competitor_id = s.id WHERE s.kind = 'competitor' "
        "GROUP BY s.host HAVING SUM(sc.tracking = 'on') = 0"
    )).all()
    return {row[0] for row in rows}


def apply_to_overview(engine: Engine, site_id: int, rows: list[dict]) -> list[dict]:
    """The list: keyword counts are blank, not zero, when they aren't followed. Paused rows go last."""
    with engine.connect() as conn:
        settings = of_site(conn, site_id)
    for row in rows:
        row["tracking"] = settings.get(row["id"], ON)
        if row["tracking"] != ON:
            row.update({key: None for key in _KEYWORD_COUNTS})
    order = {ON: 0, PAGES: 1, OFF: 2}
    return sorted(rows, key=lambda r: order[r["tracking"]])  # stable: keeps the overview's own order within each group


def apply_to_profile(engine: Engine, site_id: int, data: dict) -> dict:
    with engine.connect() as conn:
        tracking = of_site(conn, site_id).get(data["id"], ON)
    data["tracking"] = tracking
    if tracking == ON:
        return data
    data["keywords"], data["past_keywords"] = [], []
    data["compare"] = {**data["compare"], **{key: None for key in _KEYWORD_COMPARE}}
    data["timeline"] = [event for event in data["timeline"] if event.get("kind") not in _KEYWORD_EVENTS]
    return data
