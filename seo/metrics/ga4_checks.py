"""Checks on Google Analytics' own numbers, before a screen compares two periods (SEO review 2026-11-17, W1, W2, W6, W11).

- tracking_changes: the days a site's key events (or leads) per visit jumped or stopped, such as GA4 counting about one key
  event per visit from 2 Mar to 18 Jun 2026, or none from 19 Jan to 1 Mar. A change across one of those days compares two
  different ways of counting, so screens leave it blank and say why.
- little_before: the earlier period has data on fewer than half its days (a tag that only started recently). A change
  against it would read "+24,100%", so screens say "too little data before" instead.
- unusual_days: days far above the site's usual level (a bot burst: 1,164 Direct visits a day against about 10). Screens
  mark them and give the change without them too.
- other_hosts: a property that records another website's visits. Those rows are kept out of the tables; this says so.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from statistics import median

from sqlalchemy import Engine, bindparam, text

from seo.metrics import leads as lead_rules

WEEK_MIN_VISITS = 20  # a week with fewer visits says nothing about the rate
JUMP = 3.0  # key events per visit three times higher or lower, for two weeks running ...
COUNTS_VISITS = 0.5  # ... to or from about one per visit: a tag counting page views, not enquiries. A smaller jump is a
# change in who visits (ads switched off), not in how GA4 counts.
OFF_WEEKS = 2  # weeks in a row with visits and no key event at all, where some were expected
OFF_EXPECTED = 5  # ... at the earlier rate, at least this many a week were expected
LITTLE_SHARE = 0.5  # the earlier period needs data on at least half as many days as the period
UNUSUAL_TIMES, UNUSUAL_MIN_EXTRA, UNUSUAL_AROUND = 5, 50, 45  # 5× the median of the 91 days around it, and 50 visits more
OTHER_HOST_SHARE, OTHER_HOST_DAYS = 0.10, 28


def _daily(engine: Engine, site_id: int, column: str) -> dict[date, tuple[int, float]]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT day, SUM(sessions) s, SUM({column}) k FROM ga4_source_daily WHERE site_id = :s GROUP BY day"), {"s": site_id}).all()
    return {row[0]: (int(row[1] or 0), float(row[2] or 0)) for row in rows}


def _rate(days: dict, a: date, b: date) -> tuple[int, float]:
    s = k = 0
    d = a
    while d <= b:
        if d in days:
            s += days[d][0]
            k += days[d][1]
        d += timedelta(days=1)
    return s, k


def _split_day(days: dict, around: date, kind: str) -> date:
    """The exact day within a week of `around` where the rate changed."""
    if kind == "stopped":  # the day after the last key event before it
        d = around
        while d > around - timedelta(days=14):
            if days.get(d, (0, 0))[1] > 0:
                return d + timedelta(days=1)
            d -= timedelta(days=1)
        return around
    if kind == "started":
        d = around - timedelta(days=7)
        while d < around + timedelta(days=14):
            if days.get(d, (0, 0))[1] > 0:
                return d
            d += timedelta(days=1)
        return around
    best, best_gap = around, -1.0
    for n in range(-7, 8):
        d = around + timedelta(days=n)
        s1, k1 = _rate(days, d - timedelta(days=7), d - timedelta(days=1))
        s2, k2 = _rate(days, d, d + timedelta(days=6))
        if not s1 or not s2:
            continue
        gap = abs(math.log((k2 + 0.5) / s2) - math.log((k1 + 0.5) / s1))
        if gap > best_gap:
            best, best_gap = d, gap
    return best


def tracking_changes(engine: Engine, site_id: int, lead_kind: str) -> list[dict]:
    """[{day, kind: stopped | started | rose | fell, before, after}] in day order. before/after: key events per visit."""
    days = _daily(engine, site_id, lead_rules.count_sql(lead_kind))
    if not days:
        return []
    # A burst of bot visits dilutes the rate for a few weeks: its days are left out here.
    burst = unusual_days(engine, [site_id], min(days), max(days))["days"]
    every_day, days = days, {d: v for d, v in days.items() if d.isoformat() not in burst}
    last, first = max(days), min(days)
    weeks = []
    end = last
    while end - timedelta(days=6) >= first:
        s, k = _rate(days, end - timedelta(days=6), end)
        weeks.append((end - timedelta(days=6), s, k))
        end -= timedelta(days=7)
    weeks.reverse()
    weeks = [w for w in weeks if w[1] >= WEEK_MIN_VISITS]
    changes: list[dict] = []
    level: float | None = None  # key events per visit of the current stretch; 0.0 = off
    stretch: list[float] = []
    n = 0
    while n < len(weeks):
        start, s, k = weeks[n]
        rate = k / s
        if level is None:
            level, stretch = rate, [rate]
            n += 1
            continue
        nxt = weeks[n + 1] if n + 1 < len(weeks) else None
        nxt_rate = nxt[2] / nxt[1] if nxt else None

        def differs(r: float, ref: float, visits: int) -> str | None:
            if ref > 0 and r == 0 and ref * visits >= OFF_EXPECTED:
                return "stopped"
            if ref == 0 and r > 0 and r * visits >= OFF_EXPECTED:
                return "started"
            if ref > 0 and r > 0 and r * visits >= OFF_EXPECTED and (r / ref >= JUMP or ref / r >= JUMP) and max(r, ref) >= COUNTS_VISITS:
                return "rose" if r > ref else "fell"
            return None

        what = differs(rate, level, s)
        if what and nxt is not None and differs(nxt_rate, level, nxt[1]) == what:
            day = _split_day(every_day, start, what)
            if changes and (day - date.fromisoformat(changes[-1]["day"])).days <= 7:  # started straight at one per visit: one change
                changes[-1]["after"] = round(rate, 3)
            else:
                changes.append({"day": day.isoformat(), "kind": what, "before": round(level, 3), "after": round(rate, 3)})
            level, stretch = rate, [rate]
        else:
            stretch.append(rate)
            level = median(stretch[-6:])
        n += 1
    return changes


def crossing(changes: list[dict], start: date, end: date) -> list[dict]:
    """The changes a comparison from `start` to `end` runs across: the two sides don't count the same way."""
    return [c for c in changes if start < date.fromisoformat(c["day"]) <= end]


def lead_check(engine: Engine, site_ids: list[int], lead_kind: str, start: date, end: date, compare_start: date | None = None) -> dict:
    """For a screen: whether its leads change can be shown, and why not. {changes, blank}: changes the period (and the one
    before) runs across, per site host; blank when the change must be left out."""
    first = min(start, compare_start) if compare_start else start
    found = []
    hosts = _hosts(engine, site_ids)
    for site_id in site_ids:
        own = lead_kind if lead_kind != lead_rules.MIXED else lead_rules.kind(engine, [site_id])  # each site by its own rule
        for change in crossing(tracking_changes(engine, site_id, own), first, end):
            found.append({**change, "site_id": site_id, "host": hosts.get(site_id, "")})
    found.sort(key=lambda c: c["day"])
    return {"changes": found, "blank": bool(found) and compare_start is not None}


def _hosts(engine: Engine, site_ids: list[int]) -> dict[int, str]:
    if not site_ids:
        return {}
    statement = text("SELECT id, host FROM sites WHERE id IN :s").bindparams(bindparam("s", expanding=True))
    with engine.connect() as conn:
        return {row[0]: row[1] for row in conn.execute(statement, {"s": list(site_ids)})}


def little_before(engine: Engine, site_id: int, compare_start: date, compare_end: date, start: date | None = None, end: date | None = None) -> bool:
    """The earlier period has GA4 data on fewer than half as many days as the period itself (or, without the period, as
    its own days): a tag that only started recently."""
    with engine.connect() as conn:
        def days(a, b):
            return conn.execute(text("SELECT COUNT(DISTINCT day) FROM ga4_source_daily WHERE site_id = :s AND sessions > 0 AND day BETWEEN :a AND :b"), {"s": site_id, "a": a, "b": b}).scalar() or 0
        before = days(compare_start, compare_end)
        now = days(start, end) if start and end else (compare_end - compare_start).days + 1
    return before < now * LITTLE_SHARE


def unusual_days(engine: Engine, site_ids: list[int], start: date, end: date) -> dict:
    """Days in start..end far above the usual level of their site. {days: {iso: extra visits}, runs: [{host, from, to,
    visits, usual}]}: `usual` is the usual visits a day, `visits` the run's visits."""
    hosts = _hosts(engine, site_ids)
    marked: dict[str, int] = {}
    runs: list[dict] = []
    for site_id in site_ids:
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT day, SUM(sessions) s FROM ga4_source_daily WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY day"),
                {"s": site_id, "a": start - timedelta(days=UNUSUAL_AROUND), "b": end + timedelta(days=UNUSUAL_AROUND)},
            ).all()
        series = {row[0]: int(row[1] or 0) for row in rows}
        ordered = sorted(series)
        current = None
        for day in ordered:
            if not start <= day <= end:
                continue
            around = [series[d] for d in ordered if abs((d - day).days) <= UNUSUAL_AROUND]
            usual = median(around) if around else 0
            visits = series[day]
            if visits >= UNUSUAL_TIMES * max(usual, 1) and visits - usual >= UNUSUAL_MIN_EXTRA:
                marked[day.isoformat()] = marked.get(day.isoformat(), 0) + int(visits - usual)
                if current and (day - date.fromisoformat(current["to"])).days <= 2:
                    current.update(to=day.isoformat(), visits=current["visits"] + visits, days=current["days"] + 1)
                    current["list"].append(day.isoformat())
                else:
                    current = {"site_id": site_id, "host": hosts.get(site_id, ""), "from": day.isoformat(), "to": day.isoformat(), "visits": visits, "days": 1, "usual": round(usual), "list": [day.isoformat()]}
                    runs.append(current)
    return {"days": marked, "runs": runs}


def _kept(engine: Engine, site_id: int, start: date, end: date, unusual: dict) -> tuple[int, int]:
    """A site's visits in the period and the days with data they come from, leaving out its unusual days. Only the days
    marked unusual: a normal day between two bursts of one run stays in (code review 2026-11-18)."""
    skip = {day for run in unusual["runs"] if run["site_id"] == site_id for day in run.get("list") or [run["from"], run["to"]]}
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT day, SUM(sessions) FROM ga4_source_daily WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY day"), {"s": site_id, "a": start, "b": end}).all()
    kept = [int(visits or 0) for day, visits in rows if day.isoformat() not in skip]
    return sum(kept), len(kept)


def visits_without(engine: Engine, site_ids: list[int], start: date, end: date, unusual: dict) -> int:
    """Visits in the period, leaving out the unusual days of each site."""
    return sum(_kept(engine, site_id, start, end, unusual)[0] for site_id in site_ids)


def per_day_without(engine: Engine, site_ids: list[int], start: date, end: date, unusual: dict) -> float | None:
    """Visits a day without the unusual days: each site's kept visits over its kept days with data, added up across sites.
    None when no site has a kept day."""
    found = [_kept(engine, site_id, start, end, unusual) for site_id in site_ids]
    if not any(days for _, days in found):
        return None
    return sum(visits / days for visits, days in found if days)


def unusual_change(engine: Engine, site_ids: list[int], start: date, end: date, compare_start: date | None, compare_end: date | None) -> dict | None:
    """The unusual days of both periods, and the visits change without them. None when neither period has any.

    The change compares visits a day: leaving 5 burst days out of one period only must not read as a fall (a steady 100 a
    day gave -17.9%; code review 2026-11-18, #2)."""
    now = unusual_days(engine, site_ids, start, end)
    was = unusual_days(engine, site_ids, compare_start, compare_end) if compare_start else {"days": {}, "runs": []}
    if not now["runs"] and not was["runs"]:
        return None
    usual_now = visits_without(engine, site_ids, start, end, now)
    usual_was = visits_without(engine, site_ids, compare_start, compare_end, was) if compare_start else None
    per_now = per_day_without(engine, site_ids, start, end, now)
    per_was = per_day_without(engine, site_ids, compare_start, compare_end, was) if compare_start else None
    change = round((per_now - per_was) / per_was * 100, 1) if per_now is not None and per_was else None
    return {"runs": now["runs"], "runs_before": was["runs"], "days": now["days"], "days_before": was["days"], "visits": usual_now, "visits_before": usual_was,
            "per_day": round(per_now, 4) if per_now is not None else None, "per_day_before": round(per_was, 4) if per_was is not None else None, "change": change}


def other_hosts(engine: Engine, site_id: int, today: date | None = None) -> list[dict]:
    """Other websites' hosts this site's property recorded in the last OTHER_HOST_DAYS days, when they are at least
    OTHER_HOST_SHARE of its visits: [{host, sessions, share}]. Their visits are already left out of every number."""
    with engine.connect() as conn:
        end = today or conn.execute(text("SELECT MAX(day) FROM ga4_host_daily WHERE site_id = :s"), {"s": site_id}).scalar()
        if not end:
            return []
        rows = conn.execute(
            text("SELECT host_hash, MAX(host) host, MAX(own) own, SUM(sessions) s FROM ga4_host_daily WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY host_hash"),
            {"s": site_id, "a": end - timedelta(days=OTHER_HOST_DAYS - 1), "b": end},
        ).mappings().all()
    total = sum(int(r["s"] or 0) for r in rows)
    other = [r for r in rows if not r["own"]]
    other_total = sum(int(r["s"] or 0) for r in other)
    if not total or other_total < total * OTHER_HOST_SHARE:
        return []
    return [{"host": r["host"], "sessions": int(r["s"] or 0), "share": round(int(r["s"] or 0) / total, 3)} for r in sorted(other, key=lambda r: -int(r["s"] or 0))]
