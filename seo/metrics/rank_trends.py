"""Keywords by ranking: the best placed, the ones going up and the ones going down, similar keywords under one row.

Two rankings, never mixed in one list (owner, 2026-11-20: "both, with a switch"):
- checks: the app's own rank checks of the site's keywords, on Google. A move is the latest check against the one
  before by the same tool, from the same place, to the same depth (rankings.engine_view), so a change of tool never
  reads as a move.
- gsc: Search Console's average position, weighted by impressions, the last 7 final days against the 7 before. Every
  query that showed the site, tracked or not. It is an average over every country.

Similar keywords are grouped the way Search Console's own card does: the row carries its lead keyword's numbers, and
the others are named under it, each with its own position. Nothing is averaged across a group.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import timedelta

from sqlalchemy import Engine, text

from seo.metrics import search, today
from seo.serp import rankings

ENGINE_NAME = "google"
ROWS = 10  # groups sent per list; the card shows the first few
SIMILAR_SHOWN = 8
SIMILAR_SHARE = 0.5  # the share of meaningful words two keywords must have in common
SIMILAR_INSIDE = 0.66  # or: at least two shared words, making up this much of the shorter keyword
GSC_MIN_IMPRESSIONS = 10  # in each week: under that, an average position is one or two searches
GSC_MIN_PLACES = 1.0

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
            lead["similar"].append({k: row[k] for k in ("keyword", "keyword_id", "now", "was", "places")})
    return [item for _, item in leads]


def _lists(rows: list[dict]) -> dict:
    """Top is the best placed. Up and down are the biggest moves first, the better placed first when two moved the same."""
    ranked = sorted((r for r in rows if r["now"] is not None), key=lambda r: (r["now"], -(r.get("impressions") or 0), r["keyword"].casefold()))
    moved = [r for r in ranked if r["places"]]
    up = sorted((r for r in moved if r["places"] > 0), key=lambda r: -r["places"])
    down = sorted((r for r in moved if r["places"] < 0), key=lambda r: r["places"])
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
        if main["p"] is None:
            continue
        change = view["change"]
        rows.append({
            "keyword": row["keyword"], "keyword_id": row["keyword_id"], "site_id": row["site_id"], "host": row["site"],
            "now": main["p"], "was": main["p"] + change if change is not None else None, "places": change or 0, "tool": main["tool"],
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
            found = conn.execute(
                text(
                    "SELECT MAX(query) query, SUM(IF(day >= :nf, impressions, 0)) now_i, SUM(IF(day >= :nf, position * impressions, 0)) now_p, "
                    "SUM(IF(day <= :bt, impressions, 0)) was_i, SUM(IF(day <= :bt, position * impressions, 0)) was_p FROM gsc_query "
                    "WHERE site_id = :s AND day BETWEEN :bf AND :e AND position IS NOT NULL GROUP BY query_hash "
                    f"HAVING SUM(IF(day >= :nf, impressions, 0)) >= {GSC_MIN_IMPRESSIONS}"
                ),
                {"nf": end - timedelta(days=6), "bt": end - timedelta(days=7), "bf": end - timedelta(days=13), "e": end, "s": site["id"]},
            ).mappings().all()
            tracked = {
                search._match(r[1]): r[0] for r in conn.execute(
                    text("SELECT k.id, k.keyword FROM keywords k JOIN site_keywords sk ON sk.keyword_id = k.id WHERE sk.site_id = :s"), {"s": site["id"]}
                ).all()
            }
            for row in found:
                now = round(float(row["now_p"]) / float(row["now_i"]), 1)
                was = round(float(row["was_p"]) / float(row["was_i"]), 1) if int(row["was_i"] or 0) >= GSC_MIN_IMPRESSIONS else None
                places = round(was - now, 1) if was is not None else 0
                rows.append({
                    "keyword": row["query"], "keyword_id": tracked.get(search._match(row["query"])), "site_id": site["id"], "host": site["host"],
                    "now": now, "was": was, "places": places if abs(places) >= GSC_MIN_PLACES else 0, "impressions": int(row["now_i"]),
                })
    answer = {"state": "ok" if rows else "no_rows" if ends else "not_connected", **_lists(rows)}
    if ends:  # each site compares its own last final days; the card names the latest
        end = max(ends)
        answer["through"], answer["from"] = str(end), str(end - timedelta(days=6))
    return answer


def rank_trends(engine: Engine, site_id: int | None = None) -> dict:
    return {"site_id": site_id, "checks": _checks(engine, site_id), "gsc": _gsc(engine, site_id)}
