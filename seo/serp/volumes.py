"""Search volume per keyword (plan-seo-command-center-features-missing-vs-mickaz.md, item 7), always with its source.

Two free sources, never mixed and never called Google's volume unless they are:
- "Bing": Bing Webmaster's keyword data (GetKeywordStats), Bing's own searches, read with the Bing key already saved in
  Settings. Only a click starts it (Keywords → Volumes → Get Bing volumes), one keyword a request, in the collectors lane.
- "From file: <name>": a file someone uploaded (seo/imports/keyword_volumes.py), such as Keyword Planner's export.
Google Ads' own volume stays parked (the owner's "Soon"), and no paid volume service is used.

Which one a row shows: a file over Bing (a file is usually Google's Keyword Planner), the keyword's own country over a row
that names no country, the newest upload first, then its latest month. Search Console's impressions stay in their own column:
they are our own impressions, never volume.
"""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, datetime, timezone

from sqlalchemy import Engine, text

from seo.collectors import http
from seo.collectors.http import SourceError
from seo.competitors.keywords import require_own
from seo.core.errors import Refused
from seo.serp import store
from seo.sources import service
from seo.worker import queue
from seo.worker.runner import RunAgain, handler

BING = "https://ssl.bing.com/webmaster/api.svc/json"
JOB_KIND = "volumes.bing"
LANE = "collectors"
CHUNK_SECONDS = 40.0
FRESH_DAYS = 7  # a keyword Bing answered for this recently isn't asked again
SOURCES = ("bing", "file")


def _bing_month(value) -> str | None:
    import re

    match = re.search(r"/Date\((-?\d+)", str(value or ""))
    if not match:
        return None
    return datetime.fromtimestamp(int(match.group(1)) / 1000, tz=timezone.utc).strftime("%Y-%m")


def save(conn, keyword: str, source: str, source_name: str, country: str, language: str, month: str, searches: int, by: str | None) -> None:
    """One keyword's searches for one month from one source. The same row again replaces its number."""
    conn.execute(
        text(
            "INSERT INTO keyword_volumes (keyword_hash, keyword, source, source_name, country, language, month, searches, added_by) "
            "VALUES (:h, :k, :s, :n, :c, :l, :m, :v, :b) ON DUPLICATE KEY UPDATE searches = :v, keyword = :k, added_by = :b, created_at = UTC_TIMESTAMP(3)"
        ),
        {"h": store.keyword_hash(keyword), "k": store.clean_keyword(keyword)[:400], "s": source, "n": (source_name or "")[:190], "c": (country or "").upper()[:2],
         "l": (language or "").lower()[:10], "m": month or "", "v": int(searches), "b": (by or None) and by[:120]},
    )


def lookup(conn, tracked: list[dict]) -> dict:
    """{keyword_hash|COUNTRY: {searches, source, name, month, country, months: [{month, searches}]}} for each tracked
    keyword (dicts with keyword and country) that any source has. Keywords no source has are left out."""
    hashes = list({store.keyword_hash(t["keyword"]) for t in tracked})
    if not hashes:
        return {}
    found: dict[str, list[dict]] = defaultdict(list)
    for start in range(0, len(hashes), 500):
        part = hashes[start:start + 500]
        marks = ",".join(f":h{i}" for i in range(len(part)))
        for row in conn.execute(
            text(f"SELECT keyword_hash, source, source_name, country, month, searches, created_at FROM keyword_volumes WHERE keyword_hash IN ({marks})"),
            {f"h{i}": h for i, h in enumerate(part)},
        ).mappings():
            if row["source"] == "bing" and not row["month"]:
                continue  # Bing was asked and had nothing: unknown, never 0
            found[row["keyword_hash"]].append(dict(row))
    out = {}
    for track in tracked:
        key = store.keyword_hash(track["keyword"])
        country = (track.get("country") or "").upper()
        rows = [r for r in found.get(key, []) if r["country"] in (country, "")] if country else found.get(key, [])
        if not rows:
            continue
        groups: dict[tuple, list[dict]] = defaultdict(list)
        for r in rows:
            groups[(r["source"], r["source_name"], r["country"])].append(r)
        # A file first, then the keyword's own country, then the newest upload.
        best = max(groups, key=lambda g: (g[0] == "file", bool(country) and g[2] == country, max(r["created_at"] for r in groups[g])))
        chosen = sorted(groups[best], key=lambda r: r["month"])
        latest = _latest(chosen)
        out[f"{key}|{country}"] = {
            "searches": latest["searches"], "source": best[0], "name": best[1] or None, "month": latest["month"] or None, "country": best[2] or None,
            "months": [{"month": r["month"], "searches": r["searches"]} for r in chosen if r["month"]][-12:],
        }
    return out


def _latest(rows: list[dict]) -> dict:
    """The newest month that has ended (a month still running holds only part of its searches), else the newest one."""
    this_month = date.today().strftime("%Y-%m")
    dated = [r for r in rows if r["month"]]
    if not dated:
        return rows[-1]
    ended = [r for r in dated if r["month"] < this_month]
    return (ended or dated)[-1]


def of_row(found: dict, keyword: str, country: str | None) -> dict | None:
    return found.get(f"{store.keyword_hash(keyword)}|{(country or '').upper()}")


def sources(engine: Engine) -> dict:
    """What the Volumes panel lists: whether a Bing key is saved, how many keywords Bing answered, and each file loaded."""
    with engine.connect() as conn:
        files = [
            {"name": r["source_name"], "keywords": int(r["n"]), "months": int(r["m"]), "added_at": r["at"].strftime("%Y-%m-%dT%H:%M:%SZ") if r["at"] else None, "by": r["by"]}
            for r in conn.execute(text(
                "SELECT source_name, COUNT(DISTINCT keyword_hash) AS n, COUNT(DISTINCT NULLIF(month, '')) AS m, MAX(created_at) AS at, MAX(added_by) AS `by` "
                "FROM keyword_volumes WHERE source = 'file' GROUP BY source_name ORDER BY MAX(created_at) DESC"
            )).mappings()
        ]
        bing = conn.execute(text("SELECT COUNT(DISTINCT keyword_hash) AS n, MAX(created_at) AS at FROM keyword_volumes WHERE source = 'bing' AND month <> ''")).mappings().first()
        running = [r[0] for r in conn.execute(text("SELECT active_key FROM jobs WHERE kind = :k AND active_key IS NOT NULL"), {"k": JOB_KIND})]
    status = service.app_key_status(engine, "bing")
    return {
        "bing": {"key": bool(status.get("connected")), "keywords": int(bing["n"] or 0), "read_at": bing["at"].strftime("%Y-%m-%dT%H:%M:%SZ") if bing["at"] else None,
                 "running_sites": sorted(int(k.split(":")[1]) for k in running if k and k.startswith("volumes-bing:"))},
        "files": files,
    }


def remove_file(engine: Engine, name: str) -> int:
    with engine.begin() as conn:
        gone = conn.execute(text("DELETE FROM keyword_volumes WHERE source = 'file' AND source_name = :n"), {"n": name}).rowcount
    if not gone:
        raise Refused("That file's volumes are already gone.")
    return gone


# ---- Bing ------------------------------------------------------------------------------------------------------

def start_bing(engine: Engine, site_id: int, by: str | None) -> dict:
    """Get Bing volumes: queues one job per site that reads each of its keywords Bing hasn't answered for this week."""
    with engine.connect() as conn:
        require_own(conn, site_id)
    if not service.app_key(engine, "bing"):
        raise Refused("Add the Bing Webmaster key in Settings first.")
    job = queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": site_id, "by": by}, dedupe_key=f"volumes-bing:{site_id}", max_attempts=3)
    return {"queued": job is not None, "waiting": len(_due(engine, site_id))}


def _due(engine: Engine, site_id: int) -> list[dict]:
    with engine.connect() as conn:
        tracked = conn.execute(
            text("SELECT k.id, k.keyword, k.country, k.language FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s ORDER BY k.id"),
            {"s": site_id},
        ).mappings().all()
        fresh = {r[0] for r in conn.execute(text(f"SELECT keyword_hash FROM keyword_volumes WHERE source = 'bing' AND created_at >= UTC_TIMESTAMP(3) - INTERVAL {FRESH_DAYS} DAY"))}
    return [dict(t) for t in tracked if store.keyword_hash(t["keyword"]) not in fresh]


def read_bing(engine: Engine, key: str, keyword: str, country: str, language: str) -> dict[str, int]:
    """Bing's searches per month for one keyword: GetKeywordStats' dated Impressions (Bing's own searches), added up by month."""
    params = {"q": keyword, "apikey": key}
    if country:
        params["country"] = country.lower()
    if language:
        params["language"] = f"{language.lower()}-{country.upper()}" if country else language.lower()
    rows = http.request("GET", f"{BING}/GetKeywordStats", "Bing Webmaster", params=params).json().get("d") or []
    months: dict[str, int] = defaultdict(int)
    for row in rows:
        month = _bing_month(row.get("Date"))
        if month:
            months[month] += int(row.get("Impressions") or 0)
    return dict(months)


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    payload = job.payload or {}
    site_id, by = payload.get("site_id"), payload.get("by")
    key = service.app_key(engine, "bing")
    if not key:
        return  # the key was removed since: nothing to read with
    started = time.monotonic()
    for track in _due(engine, site_id):
        if time.monotonic() - started > CHUNK_SECONDS:
            raise RunAgain(2)
        try:
            months = read_bing(engine, key, track["keyword"], track["country"] or "", track["language"] or "")
        except SourceError as exc:
            service.note_app_key(engine, "bing", str(exc))
            if exc.kind == "temporary":
                raise RunAgain(900) from exc
            return  # a refused key or Bing's limit: stop, the Volumes panel says so
        with engine.begin() as conn:
            if not months:  # Bing has no searches for it: remembered as such, so it isn't asked again this week
                save(conn, track["keyword"], "bing", "", track["country"] or "", track["language"] or "", "", 0, by)
            for month, searches in months.items():
                save(conn, track["keyword"], "bing", "", track["country"] or "", track["language"] or "", month, searches, by)
    service.note_app_key(engine, "bing", None)
