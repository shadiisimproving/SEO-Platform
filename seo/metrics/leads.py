"""What a lead is: the key events the owner ticked "Counts as a lead" in Settings (SEO review 2026-11-17, W1).

GA4 counts every key event of every kind, so its total isn't a count of enquiries: for 3½ months one site's key events were
about one per visit. The collector stores each key event by name (ga4_key_event_daily). A site's ticks are site_rules of
kind key_event, one per event name, matched exactly (GA4 names are case sensitive). Each GA4 row's `leads` is the visits
of that row that had a ticked key event, never more than its visits; it is worked out again here whenever the ticks change,
so a change applies to past days too.

Until a site has a tick, its screens count "Key events" (every key event, as GA4 does) and say so, with a prompt to pick
lead events. A rate is then visits with a key event, at most one per visit, so it never passes 100%.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.collectors import common
from seo.core.errors import Refused

RULE = "key_event"
TABLES = {"source": ("ga4_source_daily", "row_hash"), "page": ("ga4_page_daily", "page_hash"), "referral": ("ga4_referral_daily", "row_hash"), "campaign": ("ga4_campaign_daily", "row_hash")}
LIST_DAYS = 365  # Settings lists the key events seen in this many days
LEADS, KEY_EVENTS, MIXED = "leads", "key_events", "mixed"  # mixed: some sites of the screen picked lead events, some didn't


def ticked(engine: Engine, site_id: int) -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT pattern FROM site_rules WHERE kind = :k AND site_id = :s ORDER BY id"), {"k": RULE, "s": site_id}).all()
    return [row[0] for row in rows]


def ticked_hashes(engine: Engine, site_id: int) -> set[str]:
    return {common.digest(name) for name in ticked(engine, site_id)}


def lead_sites(engine: Engine, site_ids: list[int]) -> list[int]:
    if not site_ids:
        return []
    statement = text("SELECT DISTINCT site_id FROM site_rules WHERE kind = :k AND site_id IN :s").bindparams(bindparam("s", expanding=True))
    with engine.connect() as conn:
        return sorted(row[0] for row in conn.execute(statement, {"k": RULE, "s": list(site_ids)}))


def kind(engine: Engine, site_ids: list[int]) -> str:
    """"leads" when every one of these sites has picked its lead events, "key_events" when none has, "mixed" otherwise.
    Each site counts by its own rule everywhere (Today and the other screens alike): its leads once picked, else its key
    events, so "All sites" adds up the same total on every screen (code review 2026-11-18, #4)."""
    picked = lead_sites(engine, site_ids)
    if not picked:
        return KEY_EVENTS
    return LEADS if set(picked) >= set(with_ga4(engine, site_ids)) else MIXED


def with_ga4(engine: Engine, site_ids: list[int]) -> list[int]:
    """The sites with Google Analytics rows: a site with none counts nothing either way, so it doesn't make a mix."""
    if not site_ids:
        return []
    statement = text("SELECT DISTINCT site_id FROM ga4_source_daily WHERE site_id IN :s").bindparams(bindparam("s", expanding=True))
    with engine.connect() as conn:
        return [row[0] for row in conn.execute(statement, {"s": list(site_ids)})]


def _per_site(picked: list[int], lead_column: str, other: str) -> str:
    marks = ",".join(str(int(i)) for i in picked)
    return f"IF(site_id IN ({marks}), {lead_column}, {other})"


def count_sql(lead_kind: str, picked: list[int] | None = None) -> str:
    """The column a screen adds up as its leads (or key events). Mixed: per site, by `picked` (the sites with ticks)."""
    if lead_kind == MIXED and picked:
        return _per_site(picked, "leads", "key_events")
    return "leads" if lead_kind == LEADS else "key_events"


def converted_sql(lead_kind: str, picked: list[int] | None = None) -> str:
    """Visits that became a lead (or had a key event): never more than the row's visits, so a rate stays at or under 100%."""
    if lead_kind == MIXED and picked:
        return _per_site(picked, "leads", "LEAST(key_events, sessions)")
    return "leads" if lead_kind == LEADS else "LEAST(key_events, sessions)"


def recompute(engine: Engine, site_id: int, day: date | None = None) -> None:
    """Every stored row's leads (or one day's), from the site's ticks. A visit counts once however many ticked events it
    had: with two or more ticks, the day's "any ticked event" sessions GA4 gave for this set (collectors/ga4.py); on a day
    not read for this set yet, the biggest ticked event's sessions, which is never more than the truth (code review
    2026-11-18, #1). Never more than the row's visits."""
    from seo.collectors import ga4  # noqa: PLC0415 - the collector imports this module too

    names = ticked(engine, site_id)
    hashes = sorted({common.digest(name) for name in names})
    one_day = "AND t.day = :day" if day is not None else ""
    with engine.begin() as conn:
        for report, (table, key) in TABLES.items():
            if not hashes:
                conn.execute(text(f"UPDATE {table} t SET leads = 0 WHERE site_id = :s AND leads <> 0 {one_day}"), {"s": site_id, "day": day})
                continue
            statement = text(
                f"UPDATE {table} t LEFT JOIN (SELECT day, row_hash, MAX(sessions) x FROM ga4_key_event_daily "
                "WHERE site_id = :s AND report = :r AND event_hash IN :h GROUP BY day, row_hash) e "
                f"ON e.day = t.day AND e.row_hash = t.{key} "
                "LEFT JOIN (SELECT day, row_hash, sessions x FROM ga4_key_event_daily WHERE site_id = :s AND report = :u AND event_hash = :m) a "
                f"ON a.day = t.day AND a.row_hash = t.{key} "
                "LEFT JOIN coverage c ON c.site_id = t.site_id AND c.source = :lc AND c.day = t.day AND c.note = :m "
                f"SET t.leads = LEAST(t.sessions, IF(c.day IS NOT NULL, COALESCE(a.x, 0), COALESCE(e.x, 0))) WHERE t.site_id = :s {one_day}"
            ).bindparams(bindparam("h", expanding=True))
            conn.execute(statement, {"s": site_id, "r": report, "h": hashes, "u": ga4.UNION + report, "m": ga4.set_hash(names), "lc": ga4.LEADS_LAYOUT, "day": day})


def events(engine: Engine, site_id: int, today: date | None = None) -> dict:
    """Settings: the site's key events seen in the last LIST_DAYS, biggest first, each with whether it counts as a lead."""
    picked = ticked(engine, site_id)
    with engine.connect() as conn:
        end = today or conn.execute(text("SELECT UTC_DATE()")).scalar()
        rows = conn.execute(text(
            "SELECT event_hash, MAX(event_name) name, SUM(key_events) k, SUM(sessions) x, MAX(day) last_day FROM ga4_key_event_daily "
            "WHERE site_id = :s AND report = 'source' AND day >= :a GROUP BY event_hash ORDER BY k DESC"
        ), {"s": site_id, "a": end - timedelta(days=LIST_DAYS)}).mappings().all()
    seen = {row["name"] for row in rows}
    listed = [{"name": row["name"], "key_events": round(float(row["k"] or 0)), "sessions": int(row["x"] or 0), "last_day": row["last_day"].isoformat(), "lead": row["name"] in picked} for row in rows]
    # A tick for an event GA4 no longer sends stays listed, so it can be unticked.
    listed += [{"name": name, "key_events": 0, "sessions": 0, "last_day": None, "lead": True} for name in picked if name not in seen]
    return {"site_id": site_id, "events": listed, "kind": LEADS if picked else KEY_EVENTS}


def set_events(engine: Engine, site_id: int, names) -> dict:
    """Replaces the site's lead events with these names, then works every row's leads out again."""
    if not isinstance(names, list) or any(not isinstance(n, str) or not n.strip() or len(n) > 120 for n in names):
        raise Refused("Pick key events from the list.")
    clean = list(dict.fromkeys(n.strip() for n in names))
    with engine.begin() as conn:
        if not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": site_id}).first():
            raise Refused("That site isn't one of yours.")
        conn.execute(text("DELETE FROM site_rules WHERE kind = :k AND site_id = :s"), {"k": RULE, "s": site_id})
        for name in clean:
            conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, :k, :p)"), {"s": site_id, "k": RULE, "p": name})
    recompute(engine, site_id)
    return events(engine, site_id)
