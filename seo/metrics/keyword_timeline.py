"""One keyword over time, for the keyword panel's "Position over time" (plan-seo-command-center-mickaz-features-and-ai-brand.md,
step 2): Search Console's daily position, and what was done around it, as markers on the same dates.

Markers, each on its day (same kind on the same day folds into one, "3 edits"):
- bought links: status live, lost or planned (never "found": nobody bought those), whose keyword is this one or whose
  target is one of the keyword's pages, on the day placed. `placed` is free text: a link whose date isn't YYYY-MM-DD is
  listed with no day, never put on a guessed one;
- my page edits: what the site reader saw change on one of the keyword's pages (change_events on my own domain);
- finished tasks naming this keyword or one of its pages, on completed_at;
- traffic boosts on one of its pages or naming the keyword (a band from start to end), once that table exists.
Bands: Google's own updates (google_updates), from began to ended, still rolling out up to today.

Search Console's line uses the same country rule as By bucket (rankings.gsc_positions): the keyword's own country when
those rows reach the start of the range, otherwise every country, for the whole line. Days after site_sources.data_through
aren't final and are left out. A period longer than 3 months is drawn one point a week (impression-weighted)."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Engine, bindparam, inspect, text

from seo.competitors.keywords import require_own
from seo.core.errors import NotFound
from seo.metrics import countries
from seo.serp import store

WEEKLY_AFTER_DAYS = 92
MAIN_PAGE_SHARE = 0.2  # a second page counts as the keyword's own from a fifth of its impressions
BOUGHT = ("live", "lost", "planned")


def page_key(url: str | None) -> str:
    """An address without its scheme, www., query or last slash, lower-case host: the same page however it was written."""
    if not url:
        return ""
    parts = urlsplit(url if "//" in url else f"https://{url}")
    host = (parts.hostname or "").lower().removeprefix("www.")
    return f"{host}{parts.path.rstrip('/') or ''}"


def _day(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _variants(keyword: str) -> list[str]:
    clean = store.clean_keyword(keyword)
    return list(dict.fromkeys([clean, clean.casefold(), clean.lower()]))


def _hashes(keyword: str) -> list[str]:
    from seo.collectors.common import digest

    return [digest(v) for v in _variants(keyword)]


def _series(conn, site_id: int, keyword: str, country: str | None, start: date, end: date) -> tuple[list[dict], str]:
    key = store.clean_keyword(keyword).casefold()
    code3 = countries.alpha3(country) if country else None
    scope = "all"
    if code3:
        first = conn.execute(text("SELECT MIN(day) FROM gsc_query_country WHERE site_id = :s AND country = :c"), {"s": site_id, "c": code3}).scalar()
        if first and first <= start:
            scope = code3
    if scope == "all":
        sql = "SELECT day, query, impressions, position FROM gsc_query WHERE site_id = :s AND day BETWEEN :a AND :b"
        params = {"s": site_id, "a": start, "b": end}
    else:
        sql = "SELECT day, query, impressions, position FROM gsc_query_country WHERE site_id = :s AND country = :c AND day BETWEEN :a AND :b"
        params = {"s": site_id, "c": scope, "a": start, "b": end}
    # Search Console's own query text, by its stored md5 (indexed): the keyword as typed, and lower-cased as Google sends it.
    sql += " AND query_hash IN :hashes"
    params["hashes"] = tuple(_hashes(keyword))
    days: dict[date, list[float]] = defaultdict(lambda: [0.0, 0])
    for row in conn.execute(text(sql), params).mappings():
        if store.clean_keyword(row["query"]).casefold() != key or not row["impressions"]:
            continue
        acc = days[row["day"]]
        acc[0] += float(row["position"]) * int(row["impressions"])
        acc[1] += int(row["impressions"])
    weekly = (end - start).days > WEEKLY_AFTER_DAYS
    if weekly:
        weeks: dict[date, list[float]] = defaultdict(lambda: [0.0, 0])
        for day, (weighted, shown) in days.items():
            monday = day - timedelta(days=day.weekday())
            weeks[monday][0] += weighted
            weeks[monday][1] += shown
        days = weeks
    points = [{"day": str(day), "p": round(weighted / shown, 1), "impressions": shown} for day, (weighted, shown) in sorted(days.items()) if shown]
    return points, scope


def _markers(conn, site_id: int, host: str, keyword: str, page_keys: set[str], start: date, end: date) -> tuple[list[dict], list[dict], list[dict]]:
    key = store.clean_keyword(keyword).casefold()
    marks: list[dict] = []
    undated: list[dict] = []
    for link in conn.execute(
        text("SELECT id, domain, source_url, target_url, placed, keyword, anchor, status FROM backlinks WHERE site_id = :s AND status IN :st"),
        {"s": site_id, "st": BOUGHT},
    ).mappings():
        same_keyword = link["keyword"] and store.clean_keyword(link["keyword"]).casefold() == key
        if not same_keyword and page_key(link["target_url"]) not in page_keys:
            continue
        item = {"kind": "link", "id": link["id"], "text": link["domain"] or "", "detail": link["anchor"] or "", "url": link["source_url"] or "", "status": link["status"]}
        day = _day(link["placed"])
        if day is None:
            undated.append({**item, "placed": link["placed"] or ""})
        elif start <= day <= end:
            marks.append({**item, "day": str(day)})
    if page_keys:
        edits = defaultdict(lambda: {"kinds": set(), "pages": set()})
        for row in conn.execute(
            text(
                "SELECT DATE(e.detected_at) AS day, e.kind, p.url FROM change_events e JOIN pages p ON p.id = e.page_id JOIN domains d ON d.id = e.domain_id "
                "WHERE (d.host = :h OR d.host = :w) AND e.detected_at >= :a AND e.detected_at < :b AND e.kind <> 'new_page'"
            ),
            {"h": host, "w": f"www.{host}", "a": start, "b": end + timedelta(days=1)},
        ).mappings():
            if page_key(row["url"]) in page_keys:
                one = edits[row["day"]]
                one["kinds"].add(row["kind"])
                one["pages"].add(row["url"])
        for day, one in edits.items():
            marks.append({"kind": "edit", "day": str(day), "text": ", ".join(sorted(one["kinds"])), "count": len(one["kinds"]), "pages": sorted(one["pages"])})
    for task in conn.execute(
        text("SELECT id, title, completed_at, keywords, pages FROM tasks WHERE site_id = :s AND deleted_at IS NULL AND status = 'done' AND completed_at >= :a AND completed_at < :b"),
        {"s": site_id, "a": start, "b": end + timedelta(days=1)},
    ).mappings():
        import json

        def listed(value):
            try:
                found = json.loads(value) if isinstance(value, str) else (value or [])
            except ValueError:
                found = []
            return [str(x) for x in found if x]

        if key in {store.clean_keyword(x).casefold() for x in listed(task["keywords"])} or page_keys & {page_key(x) for x in listed(task["pages"])}:
            marks.append({"kind": "task", "id": task["id"], "day": str(task["completed_at"].date()), "text": task["title"]})
    bands: list[dict] = []
    names = set(inspect(conn).get_table_names())
    if "google_updates" in names:
        for row in conn.execute(
            text("SELECT id, name, kind, began, ended, url FROM google_updates WHERE began <= :b AND (ended IS NULL OR ended >= :a) ORDER BY began"),
            {"a": start, "b": end},
        ).mappings():
            bands.append({"kind": "google", "day": str(row["began"]), "end": str(row["ended"] or end), "text": row["name"], "url": row["url"], "rolling": row["ended"] is None})
    if "traffic_boosts" in names:
        for row in conn.execute(
            text("SELECT id, url, keywords, started, ended, source FROM traffic_boosts WHERE site_id = :s AND started <= :b AND (ended IS NULL OR ended >= :a) ORDER BY started"),
            {"s": site_id, "a": start, "b": end},
        ).mappings():
            import json

            try:
                words = json.loads(row["keywords"]) if isinstance(row["keywords"], str) else (row["keywords"] or [])
            except ValueError:
                words = []
            if page_key(row["url"]) in page_keys or key in {store.clean_keyword(str(w)).casefold() for w in words}:
                bands.append({"kind": "boost", "id": row["id"], "day": str(row["started"]), "end": str(row["ended"] or end), "text": row["source"] or "", "url": row["url"], "rolling": row["ended"] is None})
    # The same kind on the same day: one marker that says how many.
    folded: dict[tuple, dict] = {}
    for mark in marks:
        slot = (mark["kind"], mark["day"])
        if slot in folded:
            folded[slot]["count"] = folded[slot].get("count", 1) + mark.get("count", 1)
            folded[slot]["items"].append(mark)
        else:
            folded[slot] = {**mark, "count": mark.get("count", 1), "items": [mark]}
    return sorted(folded.values(), key=lambda m: (m["day"], m["kind"])), bands, undated


def timeline(engine: Engine, site_id: int, keyword_id: int, start: date, end: date, also_pages: list[str] | None = None) -> dict:
    """also_pages: the page our own check found ranking, which Search Console may rank second (the panel sends it)."""
    if start > end:
        start, end = end, start
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        track = conn.execute(
            text("SELECT k.id, k.keyword, k.country FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s AND k.id = :k"),
            {"s": site_id, "k": keyword_id},
        ).mappings().first()
        if track is None:
            raise NotFound("This keyword isn't tracked for this site.")
        final = conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": site_id}).scalar()
        last = conn.execute(text("SELECT MAX(day) FROM gsc_query WHERE site_id = :s"), {"s": site_id}).scalar()
        through = min(d for d in (final, last) if d) if (final or last) else None
        line_end = min(end, through) if through else end
        series, scope = _series(conn, site_id, track["keyword"], track["country"], start, line_end) if through else ([], "all")
        # The keyword's own pages: the one Search Console shows most for it over the range, and any other with at least a
        # fifth of its impressions. Every page it ever touched would pull in links and edits meant for other keywords.
        key = store.clean_keyword(track["keyword"]).casefold()
        shown: dict[str, int] = defaultdict(int)
        for row in conn.execute(
            text("SELECT query, page, SUM(impressions) AS n FROM gsc_query_page WHERE site_id = :s AND day BETWEEN :a AND :b AND query IN :v GROUP BY query, page"),
            {"s": site_id, "a": start, "b": end, "v": tuple(_variants(track["keyword"]))},
        ).mappings():
            if store.clean_keyword(row["query"]).casefold() == key:
                shown[page_key(row["page"])] += int(row["n"] or 0)
        total = sum(shown.values())
        ranked = sorted(shown.items(), key=lambda kv: -kv[1])
        pages = {ranked[0][0]} | {p for p, n in ranked[1:] if total and n / total >= MAIN_PAGE_SHARE} if ranked else set()
        host_key = page_key(site["host"])
        pages |= {page_key(u) for u in (also_pages or [])[:3] if page_key(u).split("/")[0] == host_key}  # only my own site's pages
        markers, bands, undated = _markers(conn, site_id, site["host"], track["keyword"], pages, start, end)
    return {
        "keyword_id": keyword_id, "site_id": site_id, "from": str(start), "to": str(end), "through": str(through) if through else None,
        "weekly": (end - start).days > WEEKLY_AFTER_DAYS, "scope": scope, "series": series,
        "markers": markers, "bands": bands, "undated": undated, "pages": sorted(pages),
    }
