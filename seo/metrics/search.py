"""Search → Overview: Search Console's numbers, the way the Search Console screen shows them.

- Ranges are Search Console's own (24 hours, 7 and 28 days, 3, 6, 12 and 16 months, custom). They end on the newest day
  Google has, fresh days included, and are worked out here because the browser can't know that day.
- The cards and the chart come from Google live, cached for 10 minutes: that's how the app has no lag against Search
  Console. Refresh skips the cache. If Google can't be reached, saved data is shown and the screen says so.
- Tables, opportunities and the side panel read the saved days. Totals only ever come from Google's daily totals, never
  from adding up queries, because Google hides rare queries.
- Position is weighted by impressions. Page splits of a query count each page apart (Google's "by page"), so they're
  shares, never numbers that should add up to the query.
"""
from __future__ import annotations

import json
import re
import statistics
import time
import unicodedata
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Engine, bindparam, text

from seo.collectors import common, gsc
from seo.collectors.http import SourceError
from seo.core.errors import NotFound, Refused
from seo.metrics import countries
from seo.metrics.service import Scope, _sources_state, parse_day
from seo.serp import store
from seo.sources import credentials

RANGES = {"24h": ("hours", 24), "7d": ("days", 7), "28d": ("days", 28), "3m": ("months", 3), "6m": ("months", 6), "12m": ("months", 12), "16m": ("months", 16)}
DEFAULT_RANGE = "28d"
COMPARES = ("prev", "yoy", "none")
YOY_RULE = "calendar"  # same dates a year earlier. To be confirmed on a real Search Console screen (plan, Step 0).
LIVE_SECONDS = 600
WEEKLY_AFTER_DAYS = 92
STEADY_PERCENT, STEADY_CLICKS = 10, 20
SMALL_CLICKS, SMALL_IMPRESSIONS = 3, 50  # New and Lost leave out rows below both
ALMOST_BAND, ALMOST_MIN_IMPRESSIONS = (11, 20), 20
CTR_BANDS = ((1, 1), (2, 2), (3, 3), (4, 5), (6, 10), (11, 20))
CTR_DAYS, CTR_MIN_IMPRESSIONS, CTR_MIN_QUERIES, CTR_SHARE = 90, 100, 10, 0.5
COMPETE_MIN_IMPRESSIONS, COMPETE_SHARE, COMPETE_TOP = 50, 0.2, 20
TABLE_ROWS = 500
VERIFY_DAYS, VERIFY_TOP = 28, 25
SHOWS = ("all", "gaining", "losing", "new", "lost", "top3", "4-10", "11-20", "21+")
DIMS = {
    "query": ("gsc_query", "query_hash", "query"),
    "page": ("gsc_page", "page_hash", "page"),
    "country": ("gsc_country", "country", "country"),
    "device": ("gsc_device", "device", "device"),
}

_live_cache: dict = {}


# ---- Ranges --------------------------------------------------------------------------------------


def _months_back(end: date, months: int) -> date:
    """Search Console's "Last 3 months" ending 7 Nov starts 8 Aug: calendar months back, then the next day."""
    year, month = divmod(end.year * 12 + end.month - 1 - months, 12)
    return date(year, month + 1, min(end.day, monthrange(year, month + 1)[1])) + timedelta(days=1)


def _year_before(day: date) -> date:
    return day.replace(year=day.year - 1) if not (day.month == 2 and day.day == 29) else date(day.year - 1, 2, 28)


def _newest(scope: Scope) -> tuple[date, date | None]:
    """The newest day Google has for these sites, fresh or final, and the first day that isn't final yet."""
    row = scope.fetch("SELECT MAX(COALESCE(fresh_through, data_through)) newest, MIN(fresh_from) fresh FROM site_sources WHERE site_id IN :sites AND source = 'gsc' AND NOT not_used")
    newest = row[0]["newest"] if row else None
    # Daily totals come in one call for every day, so they can be a step ahead of the day-by-day tables' data_through.
    found = scope.fetch("SELECT MAX(day) d FROM gsc_daily WHERE site_id IN :sites")
    stored = found[0]["d"] if found and found[0]["d"] else None
    newest = max(day for day in (newest, stored) if day) if (newest or stored) else common.google_today(scope.engine) - timedelta(days=3)
    return newest, (row[0]["fresh"] if row else None)


def final_day(newest: date, fresh_from: date | None) -> date:
    """The last final day: the day before the first one Google calls not final, never past the newest day it has."""
    return min(newest, fresh_from - timedelta(days=1)) if fresh_from else newest


def _history_from(scope: Scope) -> date:
    """The first day stored for every site asked about (the latest of their first days). Before it, a period can't be
    compared fairly: it would be part empty. Search Console keeps 16 months, so that's the floor."""
    row = scope.fetch("SELECT MAX(f) d FROM (SELECT MIN(day) f FROM gsc_daily WHERE site_id IN :sites GROUP BY site_id) firsts")
    found = row[0]["d"] if row else None
    return found or common.google_today(scope.engine) - timedelta(days=gsc.HISTORY_DAYS - 1)


def resolve(scope: Scope, range_key: str | None, compare: str | None, start=None, end=None) -> dict:
    """One definition of a period for every Search Console number in the app (Overview, Today, Insights' links).

    Every preset ends on the last FINAL day, so its total and its sentence never count the low, still-moving fresh days
    (code review F9), and Today's number for a period is the one Overview opens with. The fresh days after it are only
    drawn, as not final (`fresh_to`). A custom period that runs into them is cut back to the last final day, unless it is
    all fresh days. A comparison whose earlier period isn't stored in full is left out, with the reason (F8).
    """
    range_key = range_key or DEFAULT_RANGE
    compare = compare or "prev"
    if compare not in COMPARES:
        raise Refused("That comparison isn't one Search Console offers.")
    newest, fresh_from = _newest(scope)
    final = final_day(newest, fresh_from)
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
            hourly, last, first = True, newest, newest - timedelta(days=1)
        elif unit == "days":
            first = final - timedelta(days=size - 1)
        else:
            first = _months_back(final, size)
    else:
        raise Refused("That range isn't one Search Console offers.")
    length = (last - first).days + 1
    if compare == "prev":
        compare_to = first - timedelta(days=1)
        compare_from = compare_to - timedelta(days=length - 1)
    elif compare == "yoy":
        compare_from, compare_to = _year_before(first), _year_before(last)
    else:
        compare_from = compare_to = None
    unavailable = None
    if compare_from and not hourly and compare_from < _history_from(scope):
        compare_from = compare_to = None
        unavailable = "history"
    return {
        "range": range_key, "compare": compare, "from": first.isoformat(), "to": last.isoformat(), "hourly": hourly,
        "compare_from": compare_from.isoformat() if compare_from else None, "compare_to": compare_to.isoformat() if compare_to else None,
        "compare_unavailable": unavailable, "fresh_from": fresh_from.isoformat() if fresh_from else None, "newest": newest.isoformat(),
        "final_through": final.isoformat(), "fresh_to": newest.isoformat() if not hourly and last < newest and last == final else None,
    }


def scope_for(engine: Engine, args) -> tuple[Scope, dict]:
    """The sites asked about and the resolved range, as both the scope and what the screen is told."""
    today = common.google_today(engine).isoformat()
    scope = Scope(engine, args.get("site_id"), today, today)
    window = resolve(scope, args.get("range"), args.get("compare"), args.get("from"), args.get("to"))
    scope.start, scope.end = date.fromisoformat(window["from"]), date.fromisoformat(window["to"])
    scope.compare_start = date.fromisoformat(window["compare_from"]) if window["compare_from"] else None
    scope.compare_end = date.fromisoformat(window["compare_to"]) if window["compare_to"] else None
    return scope, window


# ---- Talking to Google live ----------------------------------------------------------------------


def _usable_sites(scope: Scope) -> list[dict]:
    rows = scope.fetch("SELECT site_id, connection_id, property FROM site_sources WHERE site_id IN :sites AND source = 'gsc' AND NOT not_used AND connection_id IS NOT NULL AND property IS NOT NULL")
    return [dict(row) for row in rows]


def live(engine: Engine, source: dict, start: date, end: date, dims: list[str], limit: int = 1000, data_state: str = "all", filters: list | None = None, fresh: bool = False) -> dict:
    """One Search Console request, kept 10 minutes. fresh skips the cache (the Refresh button)."""
    key = (source["site_id"], source["property"], start, end, tuple(dims), limit, data_state, json.dumps(filters, sort_keys=True))
    hit = _live_cache.get(key)
    if hit and not fresh and time.monotonic() - hit[0] < LIVE_SECONDS:
        return hit[1]
    token = credentials.access_token(engine, source["connection_id"])
    extra = {"dimensionFilterGroups": [{"filters": filters}]} if filters else None
    answer = gsc._query(token, source["property"], start, end, dims, limit, data_state, extra)
    if len(_live_cache) > 2000:
        _live_cache.clear()
    _live_cache[key] = (time.monotonic(), answer)
    return answer


def _point(key: str, clicks: int, shown: int, weighted: float | None) -> dict:
    return {
        "day": key, "clicks": clicks, "impressions": shown, "click_rate": round(clicks / shown * 100, 1) if shown else None,
        "position": round(weighted / shown, 1) if shown and weighted is not None else None,
    }


def _merge(rows_by_site: list[list[dict]]) -> dict[str, list]:
    """Rows of several sites added up by key, position weighted by impressions."""
    merged: dict[str, list] = {}
    for rows in rows_by_site:
        for row in rows:
            slot = merged.setdefault(row["keys"][0], [0, 0, 0.0, False])
            shown = int(row.get("impressions", 0))
            slot[0] += int(row.get("clicks", 0))
            slot[1] += shown
            if row.get("position") is not None:
                slot[2] += float(row["position"]) * shown
                slot[3] = True
    return merged


def _live_series(engine: Engine, sources: list[dict], start: date, end: date, hourly: bool, fresh: bool) -> list[dict]:
    if hourly:
        answers = [live(engine, s, start - timedelta(days=1), end, ["hour"], 1000, "hourly_all", fresh=fresh) for s in sources]
    else:
        answers = [live(engine, s, start, end, ["date"], 25000, fresh=fresh) for s in sources]
    merged = _merge([answer.get("rows", []) for answer in answers])
    looks_right = (lambda key: len(key) > 10 and key[4] == "-" and "T" in key) if hourly else (lambda key: len(key) == 10 and key[4] == "-")
    return [_point(key, v[0], v[1], v[2] if v[3] else None) for key, v in sorted(merged.items()) if looks_right(key)]


def _saved_series(scope: Scope, start: date, end: date) -> list[dict]:
    rows = scope.fetch(
        "SELECT day, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day ORDER BY day",
        start, end,
    )
    return [_point(row["day"].isoformat(), int(row["c"] or 0), int(row["i"] or 0), float(row["w"]) if row["w"] is not None else None) for row in rows]


def _totals(points: list[dict]) -> dict | None:
    if not points:
        return None
    clicks = sum(p["clicks"] for p in points)
    shown = sum(p["impressions"] for p in points)
    weighted = sum(p["position"] * p["impressions"] for p in points if p["position"] is not None)
    return {k: v for k, v in _point("", clicks, shown, weighted if shown else None).items() if k != "day"}


def _group(points: list[dict], start: date, end: date, size: int) -> list[dict]:
    """Weeks counted from the range's first day, so the comparison lines up week for week."""
    if size == 1:
        return points
    out = []
    by_day = {p["day"]: p for p in points}
    current = start
    while current <= end:
        chunk = [by_day[d.isoformat()] for d in (current + timedelta(days=n) for n in range(size)) if d <= end and d.isoformat() in by_day]
        if chunk:
            totals = _totals(chunk)
            out.append({"day": current.isoformat(), **totals, "days": len(chunk)})
        current += timedelta(days=size)
    return out


def _hours_window(points: list[dict]) -> tuple[list[dict], list[dict]]:
    """The last 24 hours Google has, and the 24 before them, by the hours' own times: Google leaves out hours with no
    impressions, so 24 rows can cover two days on a small site (code review F13)."""
    if not points:
        return [], []
    stamped = []
    for point in points:
        try:
            stamped.append((datetime.fromisoformat(point["day"]), point))
        except ValueError:
            continue
    if not stamped:
        return [], []
    last = stamped[-1][0]
    day_ago, two_days_ago = last - timedelta(hours=24), last - timedelta(hours=48)
    return [p for at, p in stamped if day_ago < at <= last], [p for at, p in stamped if two_days_ago < at <= day_ago]


# ---- Brand words, tracked keywords ---------------------------------------------------------------


def _fold(value: str) -> str:
    """Case and accents don't matter for brand words: "créer société" matches "Creer Societe"."""
    clean = store.clean_keyword(value).casefold()
    return "".join(ch for ch in unicodedata.normalize("NFKD", clean) if not unicodedata.combining(ch))


def brand_words(scope: Scope) -> list[str]:
    rows = scope.fetch("SELECT pattern FROM site_rules WHERE kind = 'brand' AND (site_id IS NULL OR site_id IN :sites)")
    return sorted({_fold(row["pattern"]) for row in rows if _fold(row["pattern"])})


def is_brand(query: str, words: list[str]) -> bool:
    folded = _fold(query)
    return any(word in folded for word in words)


def _match(query: str) -> str:
    """The same matching as Keywords' own Search Console column (rankings._own_tools): cleaned text, any case, any market."""
    return store.clean_keyword(query).casefold()


def tracked(scope: Scope) -> set[str]:
    rows = scope.fetch("SELECT DISTINCT k.keyword FROM keywords k JOIN site_keywords sk ON sk.keyword_id = k.id WHERE sk.site_id IN :sites")
    return {_match(row["keyword"]) for row in rows}


# ---- Rows by query, page, country or device ------------------------------------------------------


def _rows(scope: Scope, dim: str, start: date, end: date, compare_start: date | None, compare_end: date | None) -> list[dict]:
    table, key, name = DIMS[dim]
    ca, cb = (compare_start, compare_end) if compare_start else (date(1900, 1, 1), date(1900, 1, 1))
    found = scope.fetch(
        f"SELECT {key} k, MAX({name}) name, "
        "SUM(IF(day BETWEEN :a AND :b, clicks, 0)) c, SUM(IF(day BETWEEN :a AND :b, impressions, 0)) i, SUM(IF(day BETWEEN :a AND :b, position * impressions, 0)) w, "
        "SUM(IF(day BETWEEN :ca AND :cb, clicks, 0)) pc, SUM(IF(day BETWEEN :ca AND :cb, impressions, 0)) pi, SUM(IF(day BETWEEN :ca AND :cb, position * impressions, 0)) pw "
        f"FROM {table} WHERE site_id IN :sites AND (day BETWEEN :a AND :b OR day BETWEEN :ca AND :cb) GROUP BY {key}",
        start, end, ca=ca, cb=cb,
    )
    rows = []
    for row in found:
        shown, before_shown = int(row["i"] or 0), int(row["pi"] or 0)
        item = {
            "key": row["k"], "name": row["name"],
            "clicks": int(row["c"] or 0), "impressions": shown,
            "click_rate": round(int(row["c"] or 0) / shown * 100, 1) if shown else None,
            "position": round(float(row["w"]) / shown, 1) if shown else None,
        }
        if compare_start:
            item.update(
                clicks_before=int(row["pc"] or 0), impressions_before=before_shown,
                position_before=round(float(row["pw"]) / before_shown, 1) if before_shown else None,
            )
        if dim == "country":
            item["code"] = countries.alpha2(row["k"])
        rows.append(item)
    return rows


def _band(position: float | None) -> str | None:
    if position is None:
        return None
    place = round(position)
    return "top3" if place <= 3 else "4-10" if place <= 10 else "11-20" if place <= 20 else "21+"


def _small(row: dict, before: bool) -> bool:
    clicks, shown = (row.get("clicks_before", 0), row.get("impressions_before", 0)) if before else (row["clicks"], row["impressions"])
    return clicks < SMALL_CLICKS and shown < SMALL_IMPRESSIONS


def _kind(row: dict) -> str | None:
    """new: nothing before. lost: nothing now. Small ones are left out of both, and counted."""
    if "clicks_before" not in row:
        return None
    if not row["impressions_before"] and row["impressions"]:
        return "new"
    if row["impressions_before"] and not row["impressions"]:
        return "lost"
    return None


def _shows(row: dict, show: str) -> bool:
    if show == "all":
        return bool(row["impressions"])
    if show in ("gaining", "losing"):
        change = row["clicks"] - row.get("clicks_before", 0)
        return "clicks_before" in row and (change > 0 if show == "gaining" else change < 0)
    if show in ("new", "lost"):
        return _kind(row) == show and not _small(row, before=(show == "lost"))
    return bool(row["impressions"]) and _band(row["position"]) == show


TEXT_MODES = ("contains", "not", "exact", "regex")


def filter_from(args) -> dict:
    """The table's filters as the address carries them: text, how it matches, and number floors and ceilings."""
    def number(key):
        raw = (args.get(key) or "").strip().replace(",", ".")
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError as exc:
            raise Refused("Filters take numbers.") from exc
    mode = args.get("q_mode") or "contains"
    if mode not in TEXT_MODES:
        raise Refused("That isn't a way to match text.")
    text_ = (args.get("q") or "").strip()
    if len(text_) > 200:
        raise Refused("That filter is too long.")
    return {"q": text_, "q_mode": mode, "min_clicks": number("min_clicks"), "min_impressions": number("min_impressions"),
            "pos_from": number("pos_from"), "pos_to": number("pos_to")}


def _text_test(text_: str, mode: str):
    """Contains and Doesn't contain ignore case and accents, as brand words do. Exactly ignores case only, so "créer société"
    isn't also "creer societe", as in Search Console. A pattern is matched anywhere, any case."""
    if not text_:
        return None
    if mode == "regex":
        try:
            pattern = re.compile(text_, re.IGNORECASE)
        except re.error as exc:
            raise Refused("That pattern isn't valid.") from exc
        return lambda value: bool(pattern.search(value or ""))
    if mode == "exact":
        want = _match(text_)
        return lambda value: _match(value or "") == want
    want = _fold(text_)
    if mode == "not":
        return lambda value: want not in _fold(value or "")
    return lambda value: want in _fold(value or "")


def _filtered(rows: list[dict], filters: dict | None) -> list[dict]:
    if not filters:
        return rows
    test = _text_test(filters.get("q") or "", filters.get("q_mode") or "contains")
    low_c, low_i, p_from, p_to = (filters.get(k) for k in ("min_clicks", "min_impressions", "pos_from", "pos_to"))
    kept = []
    for r in rows:
        if test and not test(r["name"]):
            continue
        if low_c is not None and r["clicks"] < low_c:
            continue
        if low_i is not None and r["impressions"] < low_i:
            continue
        if (p_from is not None or p_to is not None) and r["position"] is None:
            continue
        if p_from is not None and r["position"] < p_from:
            continue
        if p_to is not None and r["position"] > p_to:
            continue
        kept.append(r)
    return kept


def breakdown(scope: Scope, dim: str, show: str = "all", brand: str = "all", filters: dict | None = None, limit: int | None = None, fresh_to: date | None = None) -> dict:
    """fresh_to: also count the days after the period that aren't final yet, up to that day. Only for one exact query or
    page (the bell opening a search first seen on those days): a table of everything never counts them, so its totals and
    the sentence above it stay final days only. The answer says so in fresh_included."""
    limit = TABLE_ROWS if limit is None else limit  # the screen's table; an export asks for more (seo/exports)
    if dim not in DIMS:
        raise Refused("That isn't a way to split Search Console.")
    if show not in SHOWS:
        raise Refused("That isn't a choice of rows.")
    if show in ("gaining", "losing", "new", "lost") and not scope.has_compare:
        raise Refused("Pick a comparison to see that.")
    exact = bool(filters and filters.get("q") and filters.get("q_mode") == "exact" and dim in ("query", "page"))
    fresh_included = None
    end = scope.end
    if fresh_to and exact and fresh_to > scope.end:
        end = fresh_to
        fresh_included = {"from": (scope.end + timedelta(days=1)).isoformat(), "to": fresh_to.isoformat()}
    rows = _rows(scope, dim, scope.start, end, scope.compare_start, scope.compare_end)
    words = brand_words(scope) if dim == "query" else []
    if dim == "query" and brand in ("brand", "non_brand") and words:
        rows = [r for r in rows if is_brand(r["name"], words) == (brand == "brand")]
    if dim in ("query", "page"):
        rows = _filtered(rows, filters)
    counts = {name: sum(1 for r in rows if _shows(r, name)) for name in SHOWS if scope.has_compare or name not in ("gaining", "losing", "new", "lost")}
    hidden = sum(1 for r in rows if show in ("new", "lost") and _kind(r) == show and _small(r, before=(show == "lost")))
    picked = [r for r in rows if _shows(r, show)]
    if show == "gaining":
        picked.sort(key=lambda r: -(r["clicks"] - r["clicks_before"]))
    elif show == "losing":
        picked.sort(key=lambda r: r["clicks"] - r["clicks_before"])
    elif show == "lost":
        picked.sort(key=lambda r: (-r["clicks_before"], -r["impressions_before"]))
    else:
        picked.sort(key=lambda r: (-r["clicks"], -r["impressions"]))
    marks = tracked(scope) if dim == "query" else set()
    for r in picked[:limit]:
        if dim == "query":
            r["tracked"] = _match(r["name"]) in marks
            r["brand"] = is_brand(r["name"], words) if words else None
    return {"dim": dim, "show": show, "brand": brand, "has_brand": bool(words), "counts": counts, "small_hidden": hidden, "total": len(picked), "rows": picked[:limit], "fresh_included": fresh_included}


# ---- Opportunities -------------------------------------------------------------------------------


def _ctr_curve(scope: Scope, words: list[str]) -> dict:
    """This site's own median click rate per position band, from non-brand queries with enough impressions."""
    start = scope.end - timedelta(days=CTR_DAYS - 1)
    rows = [r for r in _rows(scope, "query", start, scope.end, None, None) if r["impressions"] >= CTR_MIN_IMPRESSIONS and not is_brand(r["name"], words)]
    curve = {}
    for low, high in CTR_BANDS:
        rates = [r["clicks"] / r["impressions"] for r in rows if r["position"] is not None and low <= round(r["position"]) <= high]
        if len(rates) >= CTR_MIN_QUERIES:
            curve[(low, high)] = statistics.median(rates)
    return curve


def opportunities(scope: Scope, kind: str, limit: int | None = None) -> dict:
    limit = TABLE_ROWS if limit is None else limit
    marks = tracked(scope)
    words = brand_words(scope)
    if kind == "almost":
        rows = [r for r in _rows(scope, "query", scope.start, scope.end, None, None) if r["position"] is not None and ALMOST_BAND[0] <= round(r["position"]) <= ALMOST_BAND[1] and r["impressions"] >= ALMOST_MIN_IMPRESSIONS]
        rows.sort(key=lambda r: -r["impressions"])
    elif kind == "low_ctr":
        if not words:
            return {"kind": kind, "needs": "brand_words", "rows": []}
        curve = _ctr_curve(scope, words)
        rows = []
        for r in _rows(scope, "query", scope.start, scope.end, None, None):
            if r["impressions"] < CTR_MIN_IMPRESSIONS or r["position"] is None or is_brand(r["name"], words):
                continue
            band = next(((low, high) for low, high in CTR_BANDS if low <= round(r["position"]) <= high), None)
            expected = curve.get(band)
            if expected and r["clicks"] / r["impressions"] < expected * CTR_SHARE:
                rows.append({**r, "expected_rate": round(expected * 100, 1)})
        rows.sort(key=lambda r: -r["impressions"])
        if not curve:
            return {"kind": kind, "needs": "more_data", "rows": []}
    elif kind == "compete":
        rows = _competing(scope)
    elif kind == "lost":
        compare_end = scope.start - timedelta(days=1)
        compare_start = compare_end - (scope.end - scope.start)
        rows = [r for r in _rows(scope, "query", scope.start, scope.end, compare_start, compare_end) if _kind(r) == "lost" and not _small(r, before=True)]
        rows.sort(key=lambda r: -r["clicks_before"])
    else:
        raise Refused("That isn't a kind of opportunity.")
    for r in rows[:limit]:
        r["tracked"] = _match(r["name"]) in marks
    return {"kind": kind, "rows": rows[:limit], "total": len(rows)}


def _competing(scope: Scope) -> list[dict]:
    """Two or more pages each with a real share of a query that has real volume, and one of them in the top 20."""
    volume = {r["key"]: r for r in _rows(scope, "query", scope.start, scope.end, None, None) if r["impressions"] >= COMPETE_MIN_IMPRESSIONS}
    if not volume:
        return []
    pairs = scope.fetch(
        "SELECT query, page, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_query_page "
        "WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY pair_hash, query, page"
    )
    by_query: dict[str, list] = {}
    for row in pairs:
        by_query.setdefault(common.digest(row["query"]), []).append(row)
    out = []
    for key, query in volume.items():
        pages = by_query.get(key, [])
        total = sum(int(p["i"] or 0) for p in pages)
        if not total:
            continue
        shares = [
            {"page": p["page"], "share": round(int(p["i"] or 0) / total * 100), "clicks": int(p["c"] or 0), "position": round(float(p["w"]) / int(p["i"]), 1) if p["i"] else None}
            for p in pages if int(p["i"] or 0) / total >= COMPETE_SHARE
        ]
        if len(shares) >= 2 and any(s["position"] is not None and s["position"] <= COMPETE_TOP for s in shares):
            out.append({**query, "pages": sorted(shares, key=lambda s: -s["share"])})
    out.sort(key=lambda r: -r["impressions"])
    return out


# ---- One query or one page -----------------------------------------------------------------------


def detail(scope: Scope, query: str | None = None, page: str | None = None) -> dict:
    if not query and not page:
        raise Refused("Say which query or page.")
    if query:
        series = scope.fetch(
            "SELECT day, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_query WHERE site_id IN :sites AND query_hash = :h AND day BETWEEN :a AND :b GROUP BY day ORDER BY day",
            h=common.digest(query),
        )
        parts = scope.fetch(
            "SELECT page name, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_query_page "
            "WHERE site_id IN :sites AND query = :q COLLATE utf8mb4_bin AND day BETWEEN :a AND :b GROUP BY pair_hash, page",
            q=query[:500],
        )
    else:
        series = scope.fetch(
            "SELECT day, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_page WHERE site_id IN :sites AND page_hash = :h AND day BETWEEN :a AND :b GROUP BY day ORDER BY day",
            h=common.digest(page),
        )
        parts = scope.fetch(
            "SELECT MAX(query) name, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_query_page "
            "WHERE site_id IN :sites AND page = :p AND day BETWEEN :a AND :b GROUP BY pair_hash",
            p=page,
        )
    points = [_point(r["day"].isoformat(), int(r["c"] or 0), int(r["i"] or 0), float(r["w"]) if r["w"] is not None else None) for r in series]
    total = sum(int(p["i"] or 0) for p in parts)
    split = sorted(
        ({"name": p["name"], "clicks": int(p["c"] or 0), "impressions": int(p["i"] or 0), "share": round(int(p["i"] or 0) / total * 100) if total else None,
          "position": round(float(p["w"]) / int(p["i"]), 1) if p["i"] else None} for p in parts),
        key=lambda p: (-p["clicks"], -p["impressions"]),
    )[:50]
    countries_live, error = None, None
    sources = _usable_sites(scope)
    if sources:
        try:
            dimension, value = ("query", query) if query else ("page", page)
            answers = [live(scope.engine, s, scope.start, scope.end, ["country"], 250, filters=[{"dimension": dimension, "operator": "equals", "expression": value}]) for s in sources]
            merged = _merge([a.get("rows", []) for a in answers])
            countries_live = sorted(
                ({"key": k, "code": countries.alpha2(k), **{x: y for x, y in _point(k, v[0], v[1], v[2] if v[3] else None).items() if x != "day"}} for k, v in merged.items()),
                key=lambda c: -c["clicks"],
            )[:20]
        except (SourceError, ConnectionError, credentials.CredentialsFailed, NotFound) as exc:
            error = str(exc)
    marks = tracked(scope)
    return {
        "query": query, "page": page, "series": points, "totals": _totals(points),
        "split": split, "split_by": "page" if query else "query", "countries": countries_live, "countries_error": error,
        "tracked": _match(query) in marks if query else None,
    }


# ---- Notes and tasks on the chart ----------------------------------------------------------------


def _first_line(body: str, limit: int = 140) -> str:
    line = next((part.strip() for part in body.splitlines() if part.strip()), "")
    return line if len(line) <= limit else f"{line[: limit - 1]}…"


def markers(scope: Scope) -> list[dict]:
    notes = scope.fetch("SELECT id, site_id, day, text FROM search_notes WHERE site_id IN :sites AND day BETWEEN :a AND :b ORDER BY day")
    tasks = scope.fetch("SELECT id, site_id, DATE(updated_at) day, title FROM tasks WHERE status = 'done' AND site_id IN :sites AND DATE(updated_at) BETWEEN :a AND :b ORDER BY updated_at")
    # Notes written on a day from the Notes panel. A note for all my sites shows on every site's chart.
    dated = scope.fetch(
        "SELECT id, site_id, day, body FROM notes WHERE scope = 'date' AND deleted_at IS NULL AND body <> '' AND (site_id IN :sites OR site_id IS NULL) AND day BETWEEN :a AND :b ORDER BY day"
    )
    out = [{"kind": "note", "id": n["id"], "site_id": n["site_id"], "day": n["day"].isoformat(), "text": n["text"]} for n in notes]
    out += [{"kind": "task", "id": t["id"], "site_id": t["site_id"], "day": t["day"].isoformat(), "text": t["title"]} for t in tasks]
    out += [{"kind": "dated", "id": n["id"], "site_id": n["site_id"], "day": n["day"].isoformat(), "text": _first_line(n["body"])} for n in dated]
    return sorted(out, key=lambda m: m["day"])


def add_brand_word(engine: Engine, site_id, word) -> dict:
    """A brand word once per site: "Séville" and "seville" are the same word."""
    from seo.metrics import service

    scope = Scope(engine, site_id if site_id else "all", "2000-01-01", "2000-01-01")
    clean = word.strip() if isinstance(word, str) else ""
    if clean and _fold(clean) in brand_words(scope):
        raise Refused("That brand word is already there.")
    return service.add_rule(engine, "brand", clean, None, scope.site_ids[0] if site_id else None)


def add_note(engine: Engine, site_id, day, note, user_id: int | None) -> dict:
    scope = Scope(engine, site_id, day, day)
    if len(scope.site_ids) != 1:
        raise Refused("Pick one site for a note.")
    clean = (note or "").strip() if isinstance(note, str) else ""
    if not clean or len(clean) > 300:
        raise Refused("Type a short note, up to 300 characters.")
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM search_notes WHERE site_id = :s AND day = :d AND text = :t COLLATE utf8mb4_bin"), {"s": scope.site_ids[0], "d": scope.start, "t": clean}).first():
            raise Refused("That note is already on that day.")
        new_id = conn.execute(
            text("INSERT INTO search_notes (site_id, day, text, created_by) VALUES (:s, :d, :t, :u)"), {"s": scope.site_ids[0], "d": scope.start, "t": clean, "u": user_id}
        ).lastrowid
    return {"kind": "note", "id": new_id, "site_id": scope.site_ids[0], "day": scope.start.isoformat(), "text": clean}


def delete_note(engine: Engine, note_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM search_notes WHERE id = :i"), {"i": note_id})


# ---- "Matches Search Console" --------------------------------------------------------------------


def verify(engine: Engine, site_id: int) -> dict:
    """The last 28 final days, asked of Google live and compared with what's saved: daily totals, the top 25 queries and
    pages. Days that aren't final change every hour, so they'd differ for no fault of the copy."""
    source = common.source_row(engine, site_id, "gsc")
    if source is None or source["not_used"] or not (source["connection_id"] and source["property"]):
        raise Refused("Search Console isn't set up for that site.")
    scope = Scope(engine, site_id, date.today().isoformat(), date.today().isoformat())
    newest, fresh_from = _newest(scope)
    end = final_day(newest, fresh_from)
    start = end - timedelta(days=VERIFY_DAYS - 1)
    src = {"site_id": site_id, "connection_id": source["connection_id"], "property": source["property"]}
    days_live = {row["keys"][0]: row for row in live(engine, src, start, end, ["date"], 25000, fresh=True).get("rows", [])}
    days_saved = {r["day"].isoformat(): r for r in scope.fetch("SELECT day, clicks, impressions FROM gsc_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b", start, end)}
    diff: dict = {"days": [], "queries": [], "pages": []}
    for day in sorted(set(days_live) | set(days_saved)):
        want, have = days_live.get(day), days_saved.get(day)
        want_c, want_i = (int(want.get("clicks", 0)), int(want.get("impressions", 0))) if want else (0, 0)
        have_c, have_i = (int(have["clicks"]), int(have["impressions"])) if have else (0, 0)
        if (want_c, want_i) != (have_c, have_i):
            diff["days"].append({"day": day, "google": {"clicks": want_c, "impressions": want_i}, "saved": {"clicks": have_c, "impressions": have_i}})
    for dim, table, key in (("query", "gsc_query", "query_hash"), ("page", "gsc_page", "page_hash")):
        top = live(engine, src, start, end, [dim], VERIFY_TOP, fresh=True).get("rows", [])
        if not top:
            continue
        hashes = [common.digest(row["keys"][0]) for row in top]
        statement = text(f"SELECT {key} k, SUM(clicks) c, SUM(impressions) i FROM {table} WHERE site_id = :s AND day BETWEEN :a AND :b AND {key} IN :h GROUP BY {key}").bindparams(bindparam("h", expanding=True))
        with engine.connect() as conn:
            saved = {r["k"]: r for r in conn.execute(statement, {"s": site_id, "a": start, "b": end, "h": hashes}).mappings().all()}
        for row, digest in zip(top, hashes):
            have = saved.get(digest)
            want_c, want_i = int(row.get("clicks", 0)), int(row.get("impressions", 0))
            have_c, have_i = (int(have["c"] or 0), int(have["i"] or 0)) if have else (0, 0)
            if (want_c, want_i) != (have_c, have_i):
                diff["queries" if dim == "query" else "pages"].append({"name": row["keys"][0], "google": {"clicks": want_c, "impressions": want_i}, "saved": {"clicks": have_c, "impressions": have_i}})
    ok = not any(diff.values())
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO gsc_verify (site_id, period_start, period_end, ok, diff) VALUES (:s, :a, :b, :o, :d)"),
            {"s": site_id, "a": start, "b": end, "o": ok, "d": None if ok else json.dumps(diff, ensure_ascii=False)},
        )
        conn.execute(text("DELETE FROM gsc_verify WHERE site_id = :s AND checked_at < UTC_TIMESTAMP(3) - INTERVAL 30 DAY"), {"s": site_id})
    return _verdict(ok, diff, start, end, datetime.now(timezone.utc).replace(tzinfo=None))


def _verdict(ok: bool, diff: dict | None, start: date, end: date, checked_at: datetime) -> dict:
    diff = diff or {"days": [], "queries": [], "pages": []}
    # A day's totals that differ come back right when the day is read again. Tables that differ while every day matches
    # are Google adding up a range differently from its days, which a new pull can't change.
    return {
        "ok": ok, "from": start.isoformat(), "to": end.isoformat(), "checked_at": checked_at.isoformat() + "Z",
        "days": diff["days"], "queries": diff["queries"], "pages": diff["pages"], "fixable": bool(diff["days"]),
    }


def verify_quietly(engine: Engine, site_id: int) -> None:
    """After each pull. A check that can't run says nothing: the pull itself already reports a broken key."""
    try:
        verify(engine, site_id)
    except (SourceError, ConnectionError, credentials.CredentialsFailed, NotFound, Refused):
        pass


def last_verdict(scope: Scope) -> dict | None:
    if len(scope.site_ids) != 1:
        rows = scope.fetch("SELECT v.ok FROM gsc_verify v JOIN (SELECT site_id, MAX(id) id FROM gsc_verify WHERE site_id IN :sites GROUP BY site_id) last ON last.id = v.id")
        return {"ok": all(r["ok"] for r in rows), "sites": len(rows)} if rows else None
    rows = scope.fetch("SELECT ok, diff, period_start, period_end, checked_at FROM gsc_verify WHERE site_id IN :sites ORDER BY id DESC LIMIT 1")
    if not rows:
        return None
    row = rows[0]
    diff = row["diff"] if isinstance(row["diff"], dict) else (json.loads(row["diff"]) if row["diff"] else None)
    return _verdict(bool(row["ok"]), diff, row["period_start"], row["period_end"], row["checked_at"])


def fix(engine: Engine, site_id: int) -> dict:
    """Reads the days that differed again, at once."""
    from seo.collectors import jobs

    verdict = last_verdict(Scope(engine, site_id, date.today().isoformat(), date.today().isoformat()))
    if not verdict or not verdict.get("fixable"):
        raise Refused("There's nothing a new pull can fix.")
    days = [d["day"] for d in verdict["days"]]
    statement = text("DELETE FROM coverage WHERE site_id = :s AND source = 'gsc' AND day IN :d").bindparams(bindparam("d", expanding=True))
    with engine.begin() as conn:
        conn.execute(statement, {"s": site_id, "d": days})
    jobs.enqueue_one(engine, site_id, "gsc")
    return {"days": days, "started": True}


# ---- The screen ----------------------------------------------------------------------------------


def _answer(totals: dict | None, before: dict | None, scope: Scope, drivers_too: bool = True) -> dict | None:
    """What the sentence on top says, as parts the screen puts into words in the reader's language."""
    if not totals:
        return None
    if not before:
        top_q = _rows(scope, "query", scope.start, scope.end, None, None)
        top_p = _rows(scope, "page", scope.start, scope.end, None, None)
        best = lambda rows: max(rows, key=lambda r: r["clicks"])["name"] if rows and max(r["clicks"] for r in rows) else None  # noqa: E731
        return {"kind": "summary", "clicks": totals["clicks"], "top_query": best(top_q), "top_page": best(top_p)}
    change = totals["clicks"] - before["clicks"]
    percent = round(change / before["clicks"] * 100) if before["clicks"] else None
    if abs(change) < STEADY_CLICKS or (percent is not None and abs(percent) < STEADY_PERCENT):
        return {"kind": "steady", "clicks": totals["clicks"], "before": before["clicks"]}
    drivers = []
    for dim in ("page", "query") if drivers_too else ():
        rows = _rows(scope, dim, scope.start, scope.end, scope.compare_start, scope.compare_end)
        moves = sorted(rows, key=lambda r: (r["clicks"] - r["clicks_before"]) * (1 if change > 0 else -1), reverse=True)
        drivers += [{"dim": dim, "name": r["name"], "change": r["clicks"] - r["clicks_before"]} for r in moves[:2] if (r["clicks"] - r["clicks_before"]) * change > 0]
    drivers.sort(key=lambda d: -abs(d["change"]))
    return {"kind": "up" if change > 0 else "down", "clicks": totals["clicks"], "before": before["clicks"], "percent": percent, "drivers": drivers[:2]}


def _counts(scope: Scope, start: date | None, end: date | None) -> int | None:
    if not start:
        return None
    row = scope.fetch("SELECT COUNT(DISTINCT query_hash) n FROM gsc_query WHERE site_id IN :sites AND day BETWEEN :a AND :b AND impressions > 0", start, end)
    return int(row[0]["n"] or 0) if row else 0


def overview(scope: Scope, window: dict, fresh: bool = False) -> dict:
    status = _sources_state(scope, "gsc")
    sources = _usable_sites(scope)
    origin, live_error = "saved", None
    hourly = window["hourly"]
    now_points = before_points = None
    # The days after the period that aren't final yet: drawn after it, never counted (see resolve).
    tail_to = date.fromisoformat(window["fresh_to"]) if window.get("fresh_to") else None
    drawn_to = tail_to or scope.end
    if sources:
        try:
            if hourly:
                points = _live_series(scope.engine, sources, scope.start, scope.end, True, fresh)
                now_points, before_points = _hours_window(points)
                if window["compare"] == "none":
                    before_points = None
            else:
                now_points = _live_series(scope.engine, sources, scope.start, drawn_to, False, fresh)
                before_points = _live_series(scope.engine, sources, scope.compare_start, scope.compare_end, False, fresh) if scope.has_compare else None
            origin = "live"
        except (SourceError, ConnectionError, credentials.CredentialsFailed, NotFound) as exc:
            live_error = str(exc)
    if origin == "saved":
        hourly = False  # hours are only ever read live
        now_points = _saved_series(scope, scope.start, drawn_to)
        before_points = _saved_series(scope, scope.compare_start, scope.compare_end) if scope.has_compare else None
    tail = []
    if not hourly:
        last_counted = scope.end.isoformat()
        tail = [p for p in now_points if p["day"] > last_counted]
        now_points = [p for p in now_points if p["day"] <= last_counted]
    totals, before = _totals(now_points), _totals(before_points) if before_points is not None else None
    size = 7 if not hourly and (scope.end - scope.start).days + 1 > WEEKLY_AFTER_DAYS else 1
    series = _group(now_points, scope.start, scope.end, size) if not hourly else now_points
    compare_series = None
    if before_points is not None:
        compare_series = _group(before_points, scope.compare_start, scope.compare_end, size) if not hourly else before_points
    fresh_from = window["fresh_from"]
    for point in series:  # a week is "not final" when any of its days is
        last_day = min(date.fromisoformat(point["day"][:10]) + timedelta(days=size - 1), scope.end).isoformat()
        point["fresh"] = bool(fresh_from) and last_day >= fresh_from
    if size == 1:
        series = series + [{**p, "fresh": True, "counted": False} for p in tail]
    last_ok = scope.fetch("SELECT MAX(last_ok_at) t FROM site_sources WHERE site_id IN :sites AND source = 'gsc'")
    return {
        **status, **window, "origin": origin, "live_error": live_error, "hourly": hourly,
        "granularity": "hour" if hourly else "week" if size == 7 else "day",
        "totals": totals, "before": before if scope.has_compare or (hourly and before) else None,
        "series": series, "compare_series": compare_series,
        "queries": _counts(scope, scope.start, scope.end), "queries_before": _counts(scope, scope.compare_start, scope.compare_end),
        # Hours have no query or page split, so the sentence for 24 hours names no drivers.
        "answer": _answer(totals, before, scope, drivers_too=False) if hourly else _answer(totals, before if scope.has_compare else None, scope),
        "markers": markers(scope), "verify": last_verdict(scope), "has_brand": bool(brand_words(scope)),
        "last_pull": last_ok[0]["t"].isoformat() + "Z" if last_ok and last_ok[0]["t"] else None,
        "single_site": len(scope.site_ids) == 1, "market": market(scope),
    }


def market(scope: Scope) -> dict:
    """The country and language a tracked query gets by default: the ones this site's keywords use most. Blank is any."""
    rows = scope.fetch(
        "SELECT k.country, k.language, COUNT(*) n FROM keywords k JOIN site_keywords sk ON sk.keyword_id = k.id WHERE sk.site_id IN :sites GROUP BY k.country, k.language ORDER BY n DESC LIMIT 1"
    )
    return {"country": rows[0]["country"] or "", "language": rows[0]["language"] or ""} if rows else {"country": "", "language": ""}


# ---- Target countries: which countries a site's queries are read for -----------------------------


def countries_setting(engine: Engine, site_id) -> dict:
    """The site's target countries, whether someone chose them, and its biggest countries to choose from."""
    scope = Scope(engine, site_id, "2000-01-01", "2000-01-01")
    if len(scope.site_ids) != 1:
        raise Refused("Pick one site.")
    picked = gsc.target_countries(engine, scope.site_ids[0])
    top = scope.fetch(
        "SELECT country, SUM(clicks) c, SUM(impressions) i FROM gsc_country WHERE site_id IN :sites AND country <> 'zzz' "
        "AND day > (SELECT MAX(day) FROM gsc_country WHERE site_id IN :sites) - INTERVAL 28 DAY GROUP BY country ORDER BY c DESC, i DESC LIMIT 12"
    )
    read = scope.fetch("SELECT MIN(day) a, MAX(day) b FROM coverage WHERE site_id IN :sites AND source = 'gsc_country'")
    return {
        "site_id": scope.site_ids[0], "countries": [{"key": c, "code": countries.alpha2(c)} for c in picked["countries"]], "chosen": picked["chosen"], "most": gsc.MAX_COUNTRIES,
        "top": [{"key": r["country"], "code": countries.alpha2(r["country"]), "clicks": int(r["c"] or 0), "impressions": int(r["i"] or 0)} for r in top],
        "read_from": read[0]["a"].isoformat() if read and read[0]["a"] else None, "read_to": read[0]["b"].isoformat() if read and read[0]["b"] else None,
    }


def set_countries(engine: Engine, site_id, codes) -> dict:
    """An empty list goes back to automatic. Codes may be alpha-2 ("FR") or Google's alpha-3 ("fra")."""
    from seo.collectors import jobs

    scope = Scope(engine, site_id, "2000-01-01", "2000-01-01")
    if len(scope.site_ids) != 1:
        raise Refused("Pick one site.")
    if not isinstance(codes, list) or not all(isinstance(c, str) for c in codes):
        raise Refused("Send a list of countries.")
    clean = []
    for code in codes:
        word = code.strip()
        three = word.lower() if word.lower() in countries.ALPHA2 else countries.alpha3(word)
        if not three:
            raise Refused("That isn't a country.")
        if three not in clean:
            clean.append(three)
    if len(clean) > gsc.MAX_COUNTRIES:
        raise Refused(f"Pick up to {gsc.MAX_COUNTRIES} countries.")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM site_search_countries WHERE site_id = :s"), {"s": scope.site_ids[0]})
        for n, code in enumerate(clean):
            conn.execute(text("INSERT INTO site_search_countries (site_id, country, created_at) VALUES (:s, :c, UTC_TIMESTAMP(3) + INTERVAL :n SECOND)"), {"s": scope.site_ids[0], "c": code, "n": n})
    jobs.enqueue_one(engine, scope.site_ids[0], "gsc")  # the next pull reads those countries
    return countries_setting(engine, scope.site_ids[0])
