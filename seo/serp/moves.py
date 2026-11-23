"""Up and Down for a keyword: one rule for every screen and export that counts or lists keywords going up or down
(owner's SEO decision, 2026-11-23). Keywords' chips and filter, the By bucket board, the Keywords by ranking card on
Today, Keywords and Overview, and the Keywords export all read it from here.

Search Console (a 7-day impression-weighted average position against another 7 days):
- up / down: it moved by MIN_PLACES (1 place) or more, both windows having MIN_IMPRESSIONS or more;
- lost: it was shown (MIN_IMPRESSIONS or more) in the first window and not at all in the second (a Down);
- new: not shown at all in the first window, shown in the second (an Up);
- same: both shown, under one place apart;
- None: too few impressions to tell, or Search Console's data doesn't reach back to the first window (a site connected
  last week would otherwise make every keyword "new").

Our checks: rankings.movement on two like-for-like checks (same tool, place and depth): up, down, same, new (came into
the depth checked), lost (fell out of it), out (out both times). Whole places, so 1 place is the smallest move anyway.

Gains are up and new, drops are down and lost.
"""
from __future__ import annotations

from datetime import date, timedelta

MIN_PLACES = 1.0
MIN_IMPRESSIONS = 10  # in each 7-day window: under that an average position is one or two searches
WINDOW_DAYS = 7
GAINS, DROPS = ("up", "new"), ("down", "lost")


def direction(kind: str | None) -> int:
    """+1 for a gain, -1 for a drop, 0 otherwise."""
    return 1 if kind in GAINS else -1 if kind in DROPS else 0


def search_console(was_impressions: int, was_weighted: float, now_impressions: int, now_weighted: float, covered: bool = True) -> dict | None:
    """The move between two windows from their impressions and their sums of position × impressions.
    Returns {"kind", "was", "now", "places"}: was / now are the windows' average positions (None when not shown there),
    places is was − now (positive: moved up), 0 unless it's an up or a down."""
    was_i, now_i = int(was_impressions or 0), int(now_impressions or 0)
    was = round(float(was_weighted) / was_i, 1) if was_i else None
    now = round(float(now_weighted) / now_i, 1) if now_i else None
    shown_then, shown_now = was_i >= MIN_IMPRESSIONS, now_i >= MIN_IMPRESSIONS
    if not covered:
        return None
    if shown_then and shown_now:
        places = round(was - now, 1)
        if abs(places) >= MIN_PLACES:
            return {"kind": "up" if places > 0 else "down", "was": was, "now": now, "places": places}
        return {"kind": "same", "was": was, "now": now, "places": 0}
    if shown_then and not now_i:
        return {"kind": "lost", "was": was, "now": None, "places": 0}
    if shown_now and not was_i:
        return {"kind": "new", "was": None, "now": now, "places": 0}
    return None


def windows(last: date, span_days: int) -> tuple[tuple[date, date], tuple[date, date]]:
    """The first and the last WINDOW_DAYS of a trend line of `span_days` days ending on `last`."""
    first = last - timedelta(days=span_days - 1)
    return (first, first + timedelta(days=WINDOW_DAYS - 1)), (last - timedelta(days=WINDOW_DAYS - 1), last)


def of_daily(points: list[dict], first: tuple[date, date], last: tuple[date, date], covered: bool = True) -> dict | None:
    """The move along a daily line [{day, p, i}] (i: that day's impressions): its first window against its last."""
    sums = {"a": [0, 0.0], "b": [0, 0.0]}
    for point in points:
        day = date.fromisoformat(str(point["day"])[:10])
        shown = int(point.get("i") or 0)
        for name, (start, end) in (("a", first), ("b", last)):
            if start <= day <= end and shown:
                sums[name][0] += shown
                sums[name][1] += float(point["p"]) * shown
    return search_console(sums["a"][0], sums["a"][1], sums["b"][0], sums["b"][1], covered)


def of_checks(view: dict) -> dict | None:
    """The move of one engine view (rankings.engine_view) between its two like-for-like checks."""
    kind = view.get("move")
    if kind is None:
        return None
    main = view.get("main") or {}
    change = view.get("change")
    return {"kind": kind, "was": view.get("was"), "now": main.get("p"), "places": change or 0}
