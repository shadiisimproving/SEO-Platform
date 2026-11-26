"""One period rule for every Search Console number in the app: Today, Overview, Insights, Pages, Content and exports.

- A preset ends on the last FINAL day Google has (fresh days are drawn after it, never counted). A custom period that runs
  into fresh days is cut back to the last final day.
- "vs period before" is the same number of days just before. "vs last year" is the same days 364 days earlier (52 weeks),
  so a Monday is compared with a Monday, in the browser and on the server alike. "Custom" starts on a day the person picks
  ("cfrom") and runs as many days as the period, so every number and chart line still compares like with like.
- A comparison is only made when its earlier period is stored in full. That is checked per table: the daily totals come
  in one call for 16 months, while the page and search tables are read a day at a time, newest first, so for hours after
  a new connection they start later. A table with no earlier data gives no gains, no "New", no "Why", never made-up ones.
- Every day of the period counts in the site's total. Nothing is left out on one screen and kept on another.
- Long periods are drawn in weeks counted back from the last day, so the newest week is always whole. A first week with
  fewer than 7 days is counted in the totals but not drawn: a short bucket would look like a cliff.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from seo.collectors import common, gsc
from seo.core.errors import Refused
from seo.metrics.service import Scope, parse_day

RANGES = {"24h": ("hours", 24), "7d": ("days", 7), "28d": ("days", 28), "3m": ("months", 3), "6m": ("months", 6), "12m": ("months", 12), "16m": ("months", 16)}
DEFAULT_RANGE = "28d"
COMPARES = ("prev", "yoy", "custom", "none")
YOY_DAYS = 364  # 52 weeks: the same weekdays a year earlier (design/mockups/mockup.js rangeGet uses the same)
WEEKLY_AFTER_DAYS = 92
ROW_TABLES = {"query": "gsc_query", "page": "gsc_page", "country": "gsc_country", "device": "gsc_device"}


def months_back(end: date, months: int) -> date:
    """Search Console's "Last 3 months" ending 7 Nov starts 8 Aug: calendar months back, then the next day."""
    year, month = divmod(end.year * 12 + end.month - 1 - months, 12)
    return date(year, month + 1, min(end.day, monthrange(year, month + 1)[1])) + timedelta(days=1)


def year_before(day: date) -> date:
    return day - timedelta(days=YOY_DAYS)


def newest(scope: Scope) -> tuple[date, date | None]:
    """The newest day Google has for these sites, fresh or final, and the first day that isn't final yet."""
    row = scope.fetch("SELECT MAX(COALESCE(fresh_through, data_through)) newest, MIN(fresh_from) fresh FROM site_sources WHERE site_id IN :sites AND source = 'gsc' AND NOT not_used")
    found = row[0]["newest"] if row else None
    # Daily totals come in one call for every day, so they can be a step ahead of the day-by-day tables' data_through.
    # The page table counts too: before the first totals call it can be the only thing stored.
    stored = [r["d"] for table in ("gsc_daily", "gsc_page") for r in scope.fetch(f"SELECT MAX(day) d FROM {table} WHERE site_id IN :sites") if r["d"]]
    stored = max(stored) if stored else None
    last = max(day for day in (found, stored) if day) if (found or stored) else common.google_today(scope.engine) - timedelta(days=3)
    return last, (row[0]["fresh"] if row else None)


def final_day(last: date, fresh_from: date | None) -> date:
    """The last final day: the day before the first one Google calls not final, never past the newest day it has."""
    return min(last, fresh_from - timedelta(days=1)) if fresh_from else last


# The coverage line that says a day-by-day table's day was read. Countries and devices have their own: the general read
# had marked 16 months as read before their tables existed, so its line would date their history 16 months back while
# they held 13 days (expert review 2026-11-17, 3.1).
COVERAGE = {"gsc_query": "gsc", "gsc_page": "gsc", "gsc_country": gsc.DIMS_SOURCE, "gsc_device": gsc.DIMS_SOURCE}


def _first_day(scope: Scope, table: str) -> date | None:
    """The first day stored for every site asked about that has any (the latest of their first days): before it, a
    period would be part empty for one of them. None: nothing stored.

    A day-by-day table also counts the days its own read covered (its coverage line), so a quiet day with no rows at all
    doesn't move its start. Never a covered day before the site's first daily total: Google had nothing then, so a read
    of those days says nothing about the table (site 2: read from 2025-07-19, data from 2026-07-15)."""
    if table == "gsc_daily":
        sql = "SELECT MAX(f) d FROM (SELECT MIN(day) f FROM gsc_daily WHERE site_id IN :sites GROUP BY site_id) firsts"
        row = scope.fetch(sql)
        return row[0]["d"] if row else None
    daily = {r["site_id"]: r["f"] for r in scope.fetch("SELECT site_id, MIN(day) f FROM gsc_daily WHERE site_id IN :sites GROUP BY site_id")}
    firsts: dict[int, date] = {}
    sources = (
        (f"SELECT site_id, MIN(day) f FROM {table} WHERE site_id IN :sites GROUP BY site_id", {}),
        ("SELECT site_id, MIN(day) f FROM coverage WHERE site_id IN :sites AND source = :c GROUP BY site_id", {"c": COVERAGE[table]}),
    )
    for sql, values in sources:
        for r in scope.fetch(sql, **values):
            if r["f"] is not None:
                firsts[r["site_id"]] = min(firsts.get(r["site_id"], r["f"]), r["f"])
    found = [max(day, daily[site]) if daily.get(site) else day for site, day in firsts.items()]
    return max(found) if found else None


def history(scope: Scope) -> dict[str, date | None]:
    """Where stored data starts, per table: "daily" (the totals) and each day-by-day table."""
    found = {"daily": _first_day(scope, "gsc_daily")}
    found.update({dim: _first_day(scope, table) for dim, table in ROW_TABLES.items()})
    return found


def _iso(day: date | None) -> str | None:
    return day.isoformat() if day else None


def resolve(scope: Scope, range_key: str | None, compare: str | None, start=None, end=None, compare_start=None) -> dict:
    """The period and what it is compared with, for every Search Console number in the app.

    "compare_unavailable" says why there is no comparison: "history" (the app's stored totals start after the earlier
    period would; "history_from" says the day) or "google" (it is further back than the 16 months Google keeps).
    "rows_compare" says, per day-by-day table, whether its own stored days reach back to the earlier period ("rows_from").
    """
    range_key = range_key or DEFAULT_RANGE
    compare = compare or "prev"
    if compare not in COMPARES:
        raise Refused("That comparison isn't one Search Console offers.")
    picked_start = parse_day(compare_start, "comparison start date") if compare == "custom" else None
    last_known, fresh_from = newest(scope)
    final = final_day(last_known, fresh_from)
    hourly = False
    if range_key == "custom":
        first, last = parse_day(start, "start date"), parse_day(end, "end date")
        if first > last:
            raise Refused("The start date is after the end date.")
        if (last - first).days > 16 * 31:
            raise Refused("Search Console keeps 16 months.")
        if first <= final < last:
            last = final
    elif range_key == "tm":
        first, last = final.replace(day=1), final
    elif range_key == "lm":
        last = final.replace(day=1) - timedelta(days=1)
        first = last.replace(day=1)
    elif range_key in RANGES:
        unit, size = RANGES[range_key]
        last = final
        if unit == "hours":
            hourly, last, first = True, last_known, last_known - timedelta(days=1)
        elif unit == "days":
            first = final - timedelta(days=size - 1)
        else:
            first = months_back(final, size)
    else:
        raise Refused("That range isn't one Search Console offers.")
    length = (last - first).days + 1
    if compare == "prev":
        compare_to = first - timedelta(days=1)
        compare_from = compare_to - timedelta(days=length - 1)
    elif compare == "yoy":
        compare_from, compare_to = year_before(first), year_before(last)
    elif compare == "custom":
        compare_from, compare_to = picked_start, picked_start + timedelta(days=length - 1)
        if compare_to >= first:
            raise Refused("The comparison has to end before the period starts.")
    else:
        compare_from = compare_to = None
    stored = history(scope)
    unavailable = None
    if compare_from and not hourly:
        google_from = common.google_today(scope.engine) - timedelta(days=gsc.HISTORY_DAYS - 1)
        if compare_from < google_from:
            unavailable = "google"
        elif stored["daily"] is not None and compare_from < stored["daily"]:  # nothing stored: Google answers live
            unavailable = "history"
        if unavailable:
            compare_from = compare_to = None
    rows_compare = {dim: bool(compare_from) and (hourly or (stored[dim] is not None and stored[dim] <= compare_from)) for dim in ROW_TABLES}
    return {
        "range": range_key, "compare": compare, "cfrom": picked_start.isoformat() if picked_start else None, "from": first.isoformat(), "to": last.isoformat(), "hourly": hourly, "days": length,
        "compare_from": compare_from.isoformat() if compare_from else None, "compare_to": compare_to.isoformat() if compare_to else None,
        "compare_unavailable": unavailable, "history_from": _iso(stored["daily"]),
        "rows_from": {dim: _iso(stored[dim]) for dim in ROW_TABLES}, "rows_compare": rows_compare,
        "fresh_from": fresh_from.isoformat() if fresh_from else None, "newest": last_known.isoformat(),
        "final_through": final.isoformat(), "fresh_to": last_known.isoformat() if not hourly and last < last_known and last == final else None,
    }


def has_search_days(scope: Scope) -> bool:
    """Whether Search Console has a stored day for these sites: without one there is no shared period to line up with."""
    return bool(scope.fetch("SELECT 1 x FROM gsc_daily WHERE site_id IN :sites LIMIT 1"))


def shared_end(scope: Scope) -> date | None:
    """The day every screen's period ends on for these sites: Search Console's last final day. None without Search Console."""
    return final_day(*newest(scope)) if has_search_days(scope) else None


def shared_ends(engine) -> dict[str, str]:
    """Per own site id, and under "all", the shared last day, for the browser's date picker (window.BOOT.search_through):
    a screen that asks the server nothing dated (Backlinks) then prints the same dates as the others."""
    from seo.metrics.service import _copy

    today = common.google_today(engine).isoformat()
    every = Scope(engine, None, today, today)
    ends = {}
    for key, sites in [("all", every.site_ids), *((str(site), [site]) for site in every.site_ids)]:
        day = shared_end(_copy(every, sites)) if sites else None
        if day:
            ends[key] = day.isoformat()
    return ends


def one_period(scope: Scope) -> Scope:
    """Every screen counts the same days (owner, 2026-11-24). Google Analytics is a day or two ahead of Search Console's
    last final day, so "Last 28 days" was 25 Oct - 21 Nov on Today, 26 Oct - 22 Nov on Channels and 27 Oct - 23 Nov on
    Content, and one page had 155 visits on one screen and 163 on another. A preset period that came with dates
    (UI.range.days) now takes the shared period's own days, and its comparison keeps its kind and length. A custom period
    is left as picked, and so are sites with no Search Console days: there is nothing to line up with."""
    args = getattr(scope, "search_args", None) or {}
    picked = args.get("range")
    if not picked or picked == "custom" or (picked not in RANGES and picked not in ("tm", "lm")) or not has_search_days(scope):
        return scope
    window = resolve(scope, picked, "none")
    first, last = date.fromisoformat(window["from"]), date.fromisoformat(window["to"])
    if RANGES.get(picked, ("", 0))[0] == "hours":  # a day-based screen never shows hours: the last final day alone
        first = last = final_day(*newest(scope))
    if first == scope.start and last == scope.end:
        return scope
    compared = scope.has_compare
    scope.start, scope.end = first, last
    if compared:
        if args.get("compare") == "yoy":
            scope.compare_start, scope.compare_end = year_before(first), year_before(last)
        else:
            scope.compare_end = first - timedelta(days=1)
            scope.compare_start = scope.compare_end - (last - first)
    return scope


def apply(scope: Scope, window: dict) -> Scope:
    """Puts the resolved period on the scope, with which day-by-day tables may be compared (rows_compared)."""
    scope.start, scope.end = date.fromisoformat(window["from"]), date.fromisoformat(window["to"])
    scope.compare_start = date.fromisoformat(window["compare_from"]) if window["compare_from"] else None
    scope.compare_end = date.fromisoformat(window["compare_to"]) if window["compare_to"] else None
    scope.rows_compare = dict(window.get("rows_compare") or {})
    scope.rows_from = dict(window.get("rows_from") or {})
    return scope


def rows_compared(scope: Scope, dim: str) -> bool:
    """Whether this day-by-day table holds the earlier period too. A scope that never went through resolve trusts its dates."""
    found = getattr(scope, "rows_compare", None)
    return scope.has_compare and (found is None or bool(found.get(dim)))


def scope_for(engine, args) -> tuple[Scope, dict]:
    """The sites asked about and the resolved range, as both the scope and what the screen is told."""
    today = common.google_today(engine).isoformat()
    scope = Scope(engine, args.get("site_id"), today, today)
    window = resolve(scope, args.get("range"), args.get("compare"), args.get("from"), args.get("to"), args.get("cfrom"))
    return apply(scope, window), window


def for_site(engine, site_id: int, days: int = 28) -> tuple[Scope, dict]:
    """Insights' and a page's own "last 28 days vs the 28 before": the very period Today and Overview open with."""
    today = common.google_today(engine).isoformat()
    scope = Scope(engine, site_id, today, today)
    if f"{days}d" in RANGES:
        window = resolve(scope, f"{days}d", "prev")
    else:  # any other length: the same days ending on the last final day, as a custom period
        final = final_day(*newest(scope))
        window = resolve(scope, "custom", "prev", (final - timedelta(days=days - 1)).isoformat(), final.isoformat())
        window["range"] = f"{days}d"
    return apply(scope, window), window


def search_scope(scope: Scope) -> tuple[Scope, dict]:
    """The Search Console side of a screen that also shows Google Analytics (Pages, Content, a page, their exports): the
    scope's sites with the shared period. The screen sends its range too (range, compare: scope.search_args, set by the
    route); without one, the dates it sent are ended on the last final day, and the period before is cut to as many days."""
    from seo.metrics.service import _copy

    other = _copy(scope)
    args = getattr(scope, "search_args", None) or {}
    picked = args.get("range")
    if picked:
        window = resolve(other, picked, args.get("compare"), args.get("from"), args.get("to"), args.get("cfrom"))
        return apply(other, window), window
    last_known, fresh_from = newest(other)
    final = final_day(last_known, fresh_from)
    end = min(scope.end, final) if scope.start <= final else scope.end
    compare_end = None
    if scope.has_compare:
        compare_end = min(scope.compare_end, scope.compare_start + (end - scope.start))
    window = {
        "range": "custom", "compare": "prev" if scope.has_compare else "none", "from": scope.start.isoformat(), "to": end.isoformat(),
        "compare_from": scope.compare_start.isoformat() if scope.has_compare else None, "compare_to": compare_end.isoformat() if compare_end else None,
        "final_through": final.isoformat(), "fresh_from": fresh_from.isoformat() if fresh_from else None, "compare_unavailable": None,
    }
    stored = history(other)
    if scope.has_compare and stored["daily"] is not None and scope.compare_start < stored["daily"]:
        window.update(compare_from=None, compare_to=None, compare_unavailable="history")
    window["history_from"] = _iso(stored["daily"])
    window["rows_from"] = {dim: _iso(stored[dim]) for dim in ROW_TABLES}
    window["rows_compare"] = {dim: bool(window["compare_from"]) and stored[dim] is not None and stored[dim] <= scope.compare_start for dim in ROW_TABLES}
    return apply(other, window), window


def _buckets(points: list[dict], start: date, end: date, size: int, totals) -> tuple[list[dict], dict | None]:
    """Whole buckets of `size` days counted back from the last day, oldest first, each with how many of its days hold data
    ("days", 0 for none), and the short first bucket (fewer than `size` days in the period), if any."""
    by_day = {p["day"]: p for p in points}
    out, short = [], None
    bucket_end = end
    while bucket_end >= start:
        first = max(start, bucket_end - timedelta(days=size - 1))
        length = (bucket_end - first).days + 1
        if length < size:
            short = {"from": first.isoformat(), "to": bucket_end.isoformat(), "days": length}
        else:
            chunk = [by_day[d.isoformat()] for d in (first + timedelta(days=n) for n in range(length)) if d.isoformat() in by_day]
            out.append({"day": first.isoformat(), **(totals(chunk) if chunk else {}), "days": len(chunk)})
        bucket_end = first - timedelta(days=1)
    out.reverse()
    return out, short


def _leading_short(buckets: list[dict], size: int) -> int:
    """How many first buckets hold only some of their days: before the stored data starts, they'd draw as a false rise."""
    n = 0
    while n < len(buckets) and buckets[n]["days"] < size:
        n += 1
    return n


def _drawn(buckets: list[dict], short: dict | None, size: int, skip: int) -> tuple[list[dict], dict | None]:
    """The buckets after the first `skip`, with no empty ones; the ones left out join `left_out` (counted, not drawn)."""
    left_out = short
    for dropped in buckets[:skip]:
        if not dropped["days"] and not left_out:
            continue  # nothing stored there: nothing to say was left out
        start_left = left_out["from"] if left_out else dropped["day"]
        last = date.fromisoformat(dropped["day"]) + timedelta(days=size - 1)
        left_out = {"from": start_left, "to": last.isoformat(), "days": (last - date.fromisoformat(start_left)).days + 1}
    return [b for b in buckets[skip:] if b["days"]], left_out


def weeks(points: list[dict], start: date, end: date, size: int, totals) -> tuple[list[dict], dict | None]:
    """Points in buckets of `size` days counted back from the last day, so the newest bucket is always whole. A first bucket
    with fewer days isn't drawn (it would look like a fall); it is returned as `left_out`, still counted in the totals.
    First weeks before the stored data starts hold only some of their days: they wait too."""
    if size == 1:
        return points, None
    buckets, short = _buckets(points, start, end, size, totals)
    return _drawn(buckets, short, size, _leading_short(buckets, size))


def weeks_pair(points: list[dict], before: list[dict], start: date, end: date, before_start: date, before_end: date, size: int, totals) -> tuple[list[dict], dict | None, list[dict]]:
    """Both chart lines in weeks, leaving out the same first weeks on each side: when only one side is short of stored
    data, the two lines would otherwise be drawn a week apart. Returns the period's weeks, what it leaves out, and the
    earlier period's weeks."""
    if size == 1:
        return points, None, before
    now_b, now_short = _buckets(points, start, end, size, totals)
    was_b, was_short = _buckets(before, before_start, before_end, size, totals)
    skip = max(_leading_short(now_b, size), _leading_short(was_b, size))
    series, left_out = _drawn(now_b, now_short, size, skip)
    compare, _ = _drawn(was_b, was_short, size, skip)
    return series, left_out, compare
