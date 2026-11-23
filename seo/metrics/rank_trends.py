"""Keywords by ranking: the best placed, the ones going up and the ones going down, similar keywords under one row.

Two rankings, never mixed in one list (owner, 2026-11-20: "both, with a switch"):
- checks: the app's own rank checks of the site's keywords, on Google. A move is the latest check against the one
  before by the same tool, from the same place, to the same depth (rankings.engine_view), so a change of tool never
  reads as a move.
- gsc: Search Console's average position, weighted by impressions, the last 7 final days against the first 7 of the
  28-day trend line Keywords draws (the same line, the same rule). Every query that showed the site, tracked or not.
  It is an average over every country.

Up and Down are the one rule of seo/serp/moves.py (owner, 2026-11-23): a move of 1 place or more, plus "new" (it
entered: an Up) and "lost" (it ranked before and isn't found now: a Down). Lost and new lead their lists, as the biggest
moves there are, the way Keywords sorts its Change column.

Similar keywords are grouped the way Search Console's own card does: the row carries its lead keyword's numbers, and
the others are named under it, each with its own position. Nothing is averaged across a group.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import timedelta

from sqlalchemy import Engine, text

from seo.metrics import search, today
from seo.serp import moves, rankings

ENGINE_NAME = "google"
ROWS = 10  # groups sent per list; the card shows the first few
SIMILAR_SHOWN = 8
SIMILAR_SHARE = 0.5  # the share of meaningful words two keywords must have in common
SIMILAR_INSIDE = 0.66  # or: at least two shared words, making up this much of the shorter keyword
GSC_MIN_IMPRESSIONS = moves.MIN_IMPRESSIONS  # in each 7 days: under that, an average position is one or two searches
GSC_MIN_PLACES = moves.MIN_PLACES
SPAN_DAYS = rankings.SPARK_DAYS  # the trend line's days: its first 7 against its last 7

_WORD = re.compile(r"\w+", re.UNICODE)
# Words that say nothing about the subject, in the languages the sites are written in (English and French).
_STOP = frozenset(
    "a an the of in on at to for from by with and or is are was be do does how what when where which who why my your our i me you it its "
    "le la les l un une des du de d au aux en et ou à a pour par sur dans avec est sont que qui quoi comment quel quelle quels quelles "
    "mon ma mes ton ta tes son sa ses notre nos votre vos je tu il elle on nous vous ce cet cette ces se s y".split()
)


def _stem(word: str) -> str:
    """Plural and singular are the same word here: companies / company, services / service, bureaux / bureau."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith(("s", "x")) and not word.endswith("ss"):
        return word[:-1]
    return word


def words_of(keyword: str) -> frozenset[str]:
    """The meaningful words of a keyword: no accents, no case, no small words, no plural."""
    plain = "".join(c for c in unicodedata.normalize("NFKD", keyword or "") if not unicodedata.combining(c)).casefold()
    found = _WORD.findall(plain)
    kept = [_stem(word) for word in found if word not in _STOP]
    return frozenset(kept or found)


def _alike(one: frozenset[str], other: frozenset[str]) -> bool:
    if not one or not other:
        return False
    shared = len(one & other)
    if shared / len(one | other) >= SIMILAR_SHARE:
        return True
    # One sits almost whole inside a longer one: "coffee beans delivery" and "buy coffee beans in paris".
    return shared >= 2 and shared / min(len(one), len(other)) >= SIMILAR_INSIDE


def grouped(rows: list[dict]) -> list[dict]:
    """Rows in their final order; each one joins the first earlier row of the same site it is similar to."""
    leads: list[tuple[frozenset[str], dict]] = []
    for row in rows:
        words = words_of(row["keyword"])
        lead = next((item for seen, item in leads if item["site_id"] == row["site_id"] and _alike(seen, words)), None)
        if lead is None:
            leads.append((words, {**row, "similar": [], "similar_count": 0}))
            continue
        lead["similar_count"] += 1
        if len(lead["similar"]) < SIMILAR_SHOWN:
            lead["similar"].append({k: row.get(k) for k in ("keyword", "keyword_id", "now", "was", "places", "move")})
    return [item for _, item in leads]


def _lists(rows: list[dict]) -> dict:
    """Top is the best placed. Up and down: new / lost first (the biggest moves there are, the most searched first), then
    the biggest moves, the better placed first when two moved the same."""
    ranked = sorted((r for r in rows if r["now"] is not None), key=lambda r: (r["now"], -(r.get("impressions") or 0), r["keyword"].casefold()))
    shown = lambda r: -(r.get("impressions") or r.get("was_impressions") or 0)  # noqa: E731
    up = sorted((r for r in rows if moves.direction(r.get("move")) > 0), key=lambda r: (r["move"] != "new", -r["places"], r["now"], shown(r)))
    down = sorted((r for r in rows if moves.direction(r.get("move")) < 0), key=lambda r: (r["move"] != "lost", r["places"], r["was"] or 0, shown(r)))
    answer = {"counts": {"top": len(ranked), "up": len(up), "down": len(down)}}
    for name, found in (("top", ranked), ("up", up), ("down", down)):
        answer[name] = grouped(found)[:ROWS]
    return answer


def _checks(engine: Engine, site_id: int | None) -> dict:
    built = rankings._rows(engine, site_id)
    rows, tools, last, checked = [], set(), None, 0
    for row in built["rows"]:
        view = row["engines"][ENGINE_NAME]
        main = view["main"]
        if not main or main["status"] != "ok":
            continue
        checked += 1
        tools.add(main["tool"])
        last = max(last, main["checked_at"]) if last else main["checked_at"]
        moved = moves.of_checks(view)
        kind = moved["kind"] if moved else None
        if main["p"] is None and kind != "lost":  # not found now, and not just lost: nothing to list
            continue
        change = view["change"]
        rows.append({
            "keyword": row["keyword"], "keyword_id": row["keyword_id"], "site_id": row["site_id"], "host": row["site"],
            "now": main["p"], "was": view.get("was") if kind in ("lost", "new", "up", "down", "same") else None, "places": change or 0,
            "move": kind, "tool": main["tool"],
        })
    state = "ok" if rows else "not_ranked" if checked else "not_checked" if built["rows"] else "no_keywords"
    return {"state": state, "tracked": len(built["rows"]), "tools": sorted(tools), "last_check": last, **_lists(rows)}


def _gsc(engine: Engine, site_id: int | None) -> dict:
    rows, ends = [], []
    with engine.connect() as conn:
        for site in today._own_sites(conn, site_id):
            end = today._gsc_final_day(conn, "gsc_query", site["id"])
            if end is None:
                continue
            ends.append(end)
            began = conn.execute(text("SELECT MIN(day) FROM gsc_query WHERE site_id = :s"), {"s": site["id"]}).scalar()
            early, late = moves.windows(end, SPAN_DAYS)
            covered = bool(began) and began <= early[0]
            found = conn.execute(
                text(
                    "SELECT MAX(query) query, SUM(IF(day >= :nf, impressions, 0)) now_i, SUM(IF(day >= :nf, position * impressions, 0)) now_p, "
                    "SUM(IF(day <= :bt, impressions, 0)) was_i, SUM(IF(day <= :bt, position * impressions, 0)) was_p FROM gsc_query "
                    "WHERE site_id = :s AND (day BETWEEN :bf AND :bt OR day BETWEEN :nf AND :e) AND position IS NOT NULL GROUP BY query_hash "
                    f"HAVING SUM(IF(day >= :nf, impressions, 0)) >= {GSC_MIN_IMPRESSIONS} OR SUM(IF(day <= :bt, impressions, 0)) >= {GSC_MIN_IMPRESSIONS}"
                ),
                {"nf": late[0], "bt": early[1], "bf": early[0], "e": end, "s": site["id"]},
            ).mappings().all()
            tracked = {
                search._match(r[1]): r[0] for r in conn.execute(
                    text("SELECT k.id, k.keyword FROM keywords k JOIN site_keywords sk ON sk.keyword_id = k.id WHERE sk.site_id = :s"), {"s": site["id"]}
                ).all()
            }
            for row in found:
                now_i, was_i = int(row["now_i"] or 0), int(row["was_i"] or 0)
                moved = moves.search_console(was_i, row["was_p"] or 0, now_i, row["now_p"] or 0, covered)
                kind = moved["kind"] if moved else None
                if now_i < GSC_MIN_IMPRESSIONS and kind != "lost":  # too few now to say where it stands
                    continue
                now = round(float(row["now_p"]) / now_i, 1) if now_i >= GSC_MIN_IMPRESSIONS else None
                was = moved["was"] if moved and moved["was"] is not None else (round(float(row["was_p"]) / was_i, 1) if was_i >= GSC_MIN_IMPRESSIONS else None)
                rows.append({
                    "keyword": row["query"], "keyword_id": tracked.get(search._match(row["query"])), "site_id": site["id"], "host": site["host"],
                    "now": now, "was": was, "places": moved["places"] if moved else 0, "move": kind,
                    "impressions": now_i if now is not None else 0, "was_impressions": was_i,
                })
    answer = {"state": "ok" if rows else "no_rows" if ends else "not_connected", **_lists(rows)}
    if ends:  # each site compares its own last final days; the card names the latest
        end = max(ends)
        answer["through"], answer["from"] = str(end), str(end - timedelta(days=moves.WINDOW_DAYS - 1))
        early, _ = moves.windows(end, SPAN_DAYS)
        answer["before_from"], answer["before_through"] = str(early[0]), str(early[1])
    return answer


def rank_trends(engine: Engine, site_id: int | None = None) -> dict:
    return {"site_id": site_id, "checks": _checks(engine, site_id), "gsc": _gsc(engine, site_id)}
