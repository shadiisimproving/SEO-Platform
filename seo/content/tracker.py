"""Content → Content tracker: every published piece of my sites, with its publish date, the search it targets and how it does.

Built like the agency dashboard's "Suivi des contenus" (owner, 2026-11-20). Everything comes from what the app already stores,
so it costs nothing:
- **The pieces.** Pages the page reader saw as articles (they say their own date: datePublished or article:published_time),
  plus any page a person added. Removing one keeps a row with `removed_at`, so a page the reader sees again stays removed.
- **Publish date.** Typed, else the page's own date, else the sitemap's lastmod, else the Wayback Machine's first copy, else
  the day the app first saw the page. Where it came from is always said.
- **Target query.** Typed or picked, else Search Console's top query for the page over the last 90 days.
- **Google position.** The latest rank check when the query is a tracked keyword (with its tool, as everywhere), else Search
  Console's average for that query on that page over the last 28 days of data: read again every month, on the day it's dated.
  When Google shows another page of the site for the query, the position says "via" that page.
- **Visits, Google clicks, average position, leads.** For the period picked, counted from the publish date when it falls
  inside it. Leads are Google Analytics key events on the page the visit landed on.

A `content_items` row holds only what a person set; a page tracked automatically has no row until someone changes it.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.accounts import access
from seo.competitors.keywords import require_own
from seo.competitors.insights import SITEMAP_SAME_DATE
from seo.core.errors import NotFound, Refused
from seo.metrics import service as metrics
from seo.metrics.service import _path
from seo.serp import store

QUERY_DAYS = 90  # Search Console's top query for a page is read over this many days
POSITION_DAYS = 28  # one monthly reading of the position
NEW_DAYS = 90  # "New pages found": pages dated in the last this many days
MAX_SUGGESTIONS = 8
MONTHS = 12  # the row panel's history
DATE_FROM = ("typed", "page", "sitemap", "archive", "first_seen")


def _hash(path: str) -> str:
    return hashlib.sha256(path.encode("utf-8")).hexdigest()


def _key(query: str | None) -> str:
    return store.clean_keyword(query or "").casefold()


def _json(value) -> dict:
    if value in (None, ""):
        return {}
    try:
        loaded = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _site_pages(conn, host: str) -> dict[str, dict]:
    """What the page reader knows of my site's pages, by path: title and every date that can say when it was published."""
    out: dict[str, dict] = {}
    rows = conn.execute(text(
        "SELECT p.url, p.title, p.extras, p.sitemap_lastmod, p.first_archived, p.first_seen_at FROM pages p JOIN domains d ON d.id = p.domain_id "
        "WHERE d.host IN (:h, :w) AND p.content_hash IS NOT NULL AND (p.last_status IS NULL OR p.last_status <> 'gone') LIMIT 20000"
    ), {"h": host, "w": f"www.{host}"}).mappings()
    for row in rows:
        path = _path(row["url"])
        extras = _json(row["extras"])
        known = out.get(path)
        page = {
            "title": (row["title"] or "").strip(), "page": _day(extras.get("published")), "sitemap": row["sitemap_lastmod"],
            "archive": row["first_archived"], "first_seen": _day(row["first_seen_at"]),
        }
        if known:  # https and http, or with and without www: keep what either knows
            for name, value in page.items():
                known[name] = known[name] or value
        else:
            out[path] = page
    # A sitemap that gives most pages one same date (a plugin writing "today" everywhere) says nothing about publishing:
    # its dates are left out, as on the competitor screens (competitors.insights.SITEMAP_SAME_DATE).
    lastmods = Counter(p["sitemap"] for p in out.values() if p["sitemap"])
    if lastmods and lastmods.most_common(1)[0][1] >= SITEMAP_SAME_DATE * len(out) and len(out) > 2:
        for page in out.values():
            page["sitemap"] = None
    return out


def _published(row: dict | None, page: dict | None) -> tuple[date | None, str | None]:
    if row and row.get("published_on"):
        return row["published_on"], "typed"
    for source in DATE_FROM[1:]:
        if page and page.get(source):
            return page[source], source
    return None, None


class _Search:
    """Search Console for one site: each page's top query, and each query's position per page over the last 28 days."""

    def __init__(self, conn, site_id: int):
        self.through = conn.execute(text("SELECT MAX(day) FROM gsc_query_page WHERE site_id = :s"), {"s": site_id}).scalar()
        self.top: dict[str, tuple[str, int, int]] = {}
        self.position: dict[tuple[str, str], tuple[float, int]] = {}
        self.best: dict[str, tuple[str, int]] = {}
        if self.through is None:
            return
        start, month = self.through - timedelta(days=QUERY_DAYS - 1), self.through - timedelta(days=POSITION_DAYS - 1)
        rows = conn.execute(text(
            "SELECT MAX(query) query, MAX(page) page, SUM(clicks) c, SUM(impressions) i, "
            "SUM(CASE WHEN day >= :m THEN impressions ELSE 0 END) mi, SUM(CASE WHEN day >= :m THEN position * impressions ELSE 0 END) mw "
            "FROM gsc_query_page WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY pair_hash"
        ), {"s": site_id, "a": start, "b": self.through, "m": month}).mappings()
        for row in rows:
            path, key = _path(row["page"]), _key(row["query"])
            clicks, impressions = int(row["c"] or 0), int(row["i"] or 0)
            top = self.top.get(path)
            if top is None or (clicks, impressions) > (top[1], top[2]):
                self.top[path] = (row["query"], clicks, impressions)
            recent = int(row["mi"] or 0)
            if recent:
                was = self.position.get((path, key))
                weight = float(row["mw"] or 0) + (was[0] * was[1] if was else 0)
                total = recent + (was[1] if was else 0)
                self.position[(path, key)] = (weight / total, total)
                best = self.best.get(key)
                if best is None or total > best[1]:
                    self.best[key] = (path, total)

    def reading(self, path: str, query: str | None) -> dict | None:
        if not query or self.through is None:
            return None
        key = _key(query)
        here = self.position.get((path, key))
        via = None
        if here is None:
            best = self.best.get(key)
            if best is None:
                return None
            via = best[0]
            here = self.position[(via, key)]
        return {"value": round(here[0], 1), "from": "search_console", "tool": None, "read_on": _iso(self.through), "via": via, "out_of": None}


def _checks(engine: Engine, site_id: int, queries: set[str]) -> dict[str, dict]:
    """The latest Google rank check of each target query that is a tracked keyword of the site."""
    if not queries:
        return {}
    with engine.connect() as conn:
        tracked = {_key(r[0]) for r in conn.execute(text("SELECT k.keyword FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s"), {"s": site_id})}
    if not tracked & queries:
        return {}
    from seo.serp import rankings

    out: dict[str, dict] = {}
    for row in rankings.rows_of_site(engine, site_id):
        key = _key(row.get("keyword"))
        if key not in queries or key in out:
            continue
        main = ((row.get("engines") or {}).get("google") or {}).get("main")
        if not main or main.get("status") != "ok":
            continue
        out[key] = {
            "value": main.get("p"), "from": "check", "tool": main.get("tool"), "read_on": (main.get("checked_at") or "")[:10] or None,
            "url": main.get("url"), "out_of": main.get("depth") if main.get("p") is None else None,
        }
    return out


def _day_rows(conn, sql: str, site_id: int, start: date, end: date) -> list:
    return conn.execute(text(sql), {"s": site_id, "a": start, "b": end}).mappings().all()


def listing(scope: metrics.Scope, today: date | None = None) -> dict:
    """Every tracked piece of the sites in scope, newest first, with the "New pages found" the reader offers."""
    today = today or date.today()
    gsc_state, ga4_state = metrics._sources_state(scope, "gsc"), metrics._sources_state(scope, "ga4")
    gsc_ok, ga4_ok = gsc_state["state"] == "ok", ga4_state["state"] == "ok"
    items: list[dict] = []
    suggestions: list[dict] = []
    with scope.engine.connect() as conn:
        sites = {r[0]: r[1] for r in conn.execute(
            text("SELECT id, host FROM sites WHERE id IN :ids AND kind = 'own'").bindparams(bindparam("ids", expanding=True)), {"ids": scope.site_ids or [0]}
        )}
        for site_id, host in sites.items():
            pages = _site_pages(conn, host)
            rows = {r["path"]: dict(r) for r in conn.execute(text("SELECT path, title, published_on, target_query, removed_at, added_by FROM content_items WHERE site_id = :s"), {"s": site_id}).mappings()}
            tracked: dict[str, dict | None] = {path: row for path, row in rows.items() if row["removed_at"] is None}
            for path, page in pages.items():
                if page["page"] and path not in rows:
                    tracked[path] = None  # an article the reader found: tracked until someone removes it
            search = _Search(conn, site_id)
            day_clicks = _day_rows(conn, "SELECT page, day, clicks, impressions, position FROM gsc_page WHERE site_id = :s AND day BETWEEN :a AND :b", site_id, scope.start, scope.end) if tracked else []
            day_visits = _day_rows(conn, "SELECT path, day, sessions, key_events FROM ga4_page_daily WHERE site_id = :s AND day BETWEEN :a AND :b", site_id, scope.start, scope.end) if tracked else []
            clicks_by: dict[str, list] = defaultdict(list)
            for r in day_clicks:
                path = _path(r["page"])
                if path in tracked:
                    clicks_by[path].append(r)
            visits_by: dict[str, list] = defaultdict(list)
            for r in day_visits:
                path = _path(r["path"])
                if path in tracked:
                    visits_by[path].append(r)
            site_items = []
            for path, row in tracked.items():
                page = pages.get(path)
                published, published_from = _published(row, page)
                typed_query = (row or {}).get("target_query")
                top = search.top.get(path)
                query = typed_query or (top[0] if top else None)
                title = (row or {}).get("title") or (page or {}).get("title") or ""
                since = max(scope.start, published) if published else scope.start
                after = bool(published and published > scope.end)
                clicks = impressions = 0
                weight = 0.0
                for r in clicks_by.get(path, []):
                    if r["day"] >= since:
                        clicks += int(r["clicks"] or 0)
                        impressions += int(r["impressions"] or 0)
                        weight += float(r["position"] or 0) * int(r["impressions"] or 0)
                sessions, leads = 0, 0.0
                for r in visits_by.get(path, []):
                    if r["day"] >= since:
                        sessions += int(r["sessions"] or 0)
                        leads += float(r["key_events"] or 0)
                site_items.append({
                    "site_id": site_id, "host": host, "path": path, "url": f"https://{host}{path}",
                    "title": title, "title_from": "typed" if (row or {}).get("title") else "page" if (page or {}).get("title") else "address",
                    "published": _iso(published), "published_from": published_from, "auto": row is None,
                    "query": query, "query_from": "typed" if typed_query else "search_console" if query else None,
                    "position": search.reading(path, query),
                    "clicks": None if not gsc_ok or after else clicks, "impressions": None if not gsc_ok or after else impressions,
                    "avg_position": round(weight / impressions, 1) if impressions and not after else None,
                    "sessions": None if not ga4_ok or after else sessions, "leads": None if not ga4_ok or after else round(leads, 2),
                    "counted_from": _iso(since) if not after else None, "after_period": after,
                })
            checks = _checks(scope.engine, site_id, {_key(i["query"]) for i in site_items if i["query"]})
            for item in site_items:
                check = checks.get(_key(item["query"])) if item["query"] else None
                if check:
                    url = check.pop("url")
                    check["via"] = _path(url) if url and _path(url) != item["path"] else None
                    item["position"] = check
            items.extend(site_items)
            # New pages found: dated in the last 90 days by the page, its sitemap or the Wayback Machine, and not tracked or removed.
            for path, page in pages.items():
                if path == "/" or path in tracked or path in rows:
                    continue
                found, source = _published(None, {**page, "first_seen": None})
                if found and today - timedelta(days=NEW_DAYS) <= found <= today:
                    suggestions.append({"site_id": site_id, "host": host, "path": path, "url": f"https://{host}{path}", "title": page["title"], "published": _iso(found), "published_from": source})
    items.sort(key=lambda i: (i["published"] or "", i["host"], i["path"]), reverse=True)
    suggestions.sort(key=lambda s: (s["published"], s["path"]), reverse=True)
    recent = today - timedelta(days=NEW_DAYS)
    in_top = lambda i: i["position"] is not None and i["position"]["value"] is not None and i["position"]["value"] <= 10  # noqa: E731
    return {
        "items": items, "total": len(items),
        "summary": {
            "pieces": len(items), "recent": sum(1 for i in items if i["published"] and i["published"] >= recent.isoformat()),
            "with_clicks": sum(1 for i in items if i["clicks"]), "with_leads": sum(1 for i in items if i["leads"]), "top10": sum(1 for i in items if in_top(i)),
        },
        "suggestions": suggestions[:MAX_SUGGESTIONS], "gsc": gsc_state, "ga4": ga4_state,
        "period": {"from": scope.start.isoformat(), "to": scope.end.isoformat()},
    }


# ---- one piece: its months and the queries it could target ---------------------------------------------------------------


def _months(today: date, count: int) -> list[str]:
    out, year, month = [], today.year, today.month
    for _ in range(count):
        out.append(f"{year:04d}-{month:02d}")
        month -= 1
        if not month:
            year, month = year - 1, 12
    return out[::-1]


def detail(engine: Engine, site_id: int, page: str, query: str | None = None, today: date | None = None) -> dict:
    """The row panel: the target query's position month by month, the page's clicks and visits month by month, and the
    queries the person can pick as its target (its own top Search Console queries, the site's tracked keywords, the
    keywords of tasks about this page)."""
    today = today or date.today()
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        access.require_site(site_id)
        path = _clean_page(page, site["host"])
        months = _months(today, MONTHS)
        start = date.fromisoformat(f"{months[0]}-01")
        wanted = _key(query) if query else None
        by_month: dict[str, dict] = {m: {"month": m, "position": None, "via": False, "clicks": None, "sessions": None, "leads": None} for m in months}
        weights: dict[str, list[float]] = defaultdict(lambda: [0.0, 0])
        elsewhere: dict[str, list[float]] = defaultdict(lambda: [0.0, 0])  # the same search on the site's other pages, by month
        queries: dict[str, list] = {}
        for row in conn.execute(text(
            "SELECT DATE_FORMAT(day, '%Y-%m') m, MAX(query) query, MAX(page) page, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w "
            "FROM gsc_query_page WHERE site_id = :s AND day >= :a GROUP BY m, pair_hash"
        ), {"s": site_id, "a": start}).mappings():
            key = _key(row["query"])
            if _path(row["page"]) != path:
                if wanted and key == wanted and row["m"] in by_month:
                    elsewhere[row["m"]][0] += float(row["w"] or 0)
                    elsewhere[row["m"]][1] += int(row["i"] or 0)
                continue
            if wanted and key == wanted and row["m"] in by_month:
                weights[row["m"]][0] += float(row["w"] or 0)
                weights[row["m"]][1] += int(row["i"] or 0)
            if row["m"] >= months[-3]:  # the last three months, for the choices
                got = queries.setdefault(key, [row["query"], 0, 0])
                got[1] += int(row["c"] or 0)
                got[2] += int(row["i"] or 0)
        for month in months:
            w, i = weights.get(month, (0.0, 0))
            if i:
                by_month[month]["position"] = round(w / i, 1)
            elif elsewhere.get(month, (0, 0))[1]:  # Google showed another page of the site for it that month, as the row's "via" says
                w, i = elsewhere[month]
                by_month[month]["position"], by_month[month]["via"] = round(w / i, 1), True
        for row in conn.execute(text(
            "SELECT DATE_FORMAT(day, '%Y-%m') m, MAX(page) page, SUM(clicks) c FROM gsc_page WHERE site_id = :s AND day >= :a GROUP BY m, page_hash"
        ), {"s": site_id, "a": start}).mappings():
            if _path(row["page"]) == path and row["m"] in by_month:
                by_month[row["m"]]["clicks"] = (by_month[row["m"]]["clicks"] or 0) + int(row["c"] or 0)
        for row in conn.execute(text(
            "SELECT DATE_FORMAT(day, '%Y-%m') m, MAX(path) path, SUM(sessions) v, SUM(key_events) k FROM ga4_page_daily WHERE site_id = :s AND day >= :a GROUP BY m, page_hash"
        ), {"s": site_id, "a": start}).mappings():
            if _path(row["path"]) == path and row["m"] in by_month:
                got = by_month[row["m"]]
                got["sessions"] = (got["sessions"] or 0) + int(row["v"] or 0)
                got["leads"] = round((got["leads"] or 0) + float(row["k"] or 0), 2)
        tracked = [r[0] for r in conn.execute(text("SELECT k.keyword FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s ORDER BY k.keyword LIMIT 300"), {"s": site_id})]
        from_tasks: list[str] = []
        for row in conn.execute(text("SELECT pages, keywords FROM tasks WHERE deleted_at IS NULL AND keywords IS NOT NULL AND (site_id = :s OR site_id IS NULL)"), {"s": site_id}).mappings():
            pages = _list(row["pages"])
            if any(_path(p) == path for p in pages if isinstance(p, str) and (p.startswith("/") or site["host"] in p)):
                from_tasks += [k for k in _list(row["keywords"]) if isinstance(k, str)]
    ranked = sorted(queries.values(), key=lambda q: (-q[1], -q[2], q[0]))[:10]
    return {
        "site_id": site_id, "path": path, "months": [by_month[m] for m in months],
        "choices": {
            "search_console": [{"query": q[0], "clicks": q[1], "impressions": q[2]} for q in ranked],
            "keywords": tracked, "tasks": sorted(set(from_tasks), key=str.casefold),
        },
    }


def _list(value) -> list:
    if value in (None, ""):
        return []
    loaded = json.loads(value) if isinstance(value, str) else value
    return loaded if isinstance(loaded, list) else []


# ---- changes ---------------------------------------------------------------------------------------------------------------


def _clean_page(page, host: str) -> str:
    if not isinstance(page, str) or not page.strip():
        raise Refused("Say which page.")
    value = page.strip()
    if "://" in value:
        from urllib.parse import urlsplit

        name = (urlsplit(value).hostname or "").lower().removeprefix("www.")
        if name != host and not name.endswith(f".{host}"):
            raise Refused("That page isn't on this site.")
    elif not value.startswith("/"):
        value = f"/{value}"
    path = _path(value)
    if len(path) > 1000:
        raise Refused("That address is too long.")
    return path


def _values(body: dict) -> dict:
    """title, published_on, target_query: text, a YYYY-MM-DD date or empty. Empty goes back to what the app finds."""
    extra = sorted(set(body) - {"site_id", "page", "title", "published_on", "target_query", "removed"})
    if extra:
        raise Refused(f"A tracked piece can't carry: {', '.join(extra)}.")
    out: dict = {}
    for name, longest, word in (("title", 500, "The title"), ("target_query", 400, "The target query")):
        if name in body:
            value = body[name]
            if value is not None and not isinstance(value, str):
                raise Refused(f"{word} must be text.")
            value = store.clean_keyword(value) if name == "target_query" and value else (value or "").strip()
            if len(value) > longest:
                raise Refused(f"{word} is too long. It can hold {longest:,} characters.")
            out[name] = value or None
    if "published_on" in body:
        raw = body["published_on"]
        if raw in (None, ""):
            out["published_on"] = None
        else:
            try:
                day = date.fromisoformat(raw)
            except (TypeError, ValueError):
                raise Refused("Write the publish date as YYYY-MM-DD.") from None
            if day > date.today() + timedelta(days=366):
                raise Refused("That publish date is too far ahead.")
            out["published_on"] = day
    if "removed" in body:
        if not isinstance(body["removed"], bool):
            raise Refused("removed must be true or false.")
        out["removed"] = body["removed"]
    return out


def save(engine: Engine, body: dict, by: str | None = None) -> dict:
    """Adds a page, or changes what's set on one, or removes it (removed: true) or brings it back (removed: false).
    Only the fields sent change."""
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    site_id = body.get("site_id")
    values = _values(body)
    with engine.begin() as conn:
        site = require_own(conn, site_id)
        access.require_site(site_id)
        path = _clean_page(body.get("page"), site["host"])
        columns = {k: v for k, v in values.items() if k != "removed"}
        sets = [f"{name} = :{name}" for name in columns] + ["updated_at = UTC_TIMESTAMP(3)"]
        if "removed" in values:
            sets.append("removed_at = " + ("UTC_TIMESTAMP(3)" if values["removed"] else "NULL"))
        params = {"s": site_id, "p": path, "h": _hash(path), "by": (by or "")[:100] or None, **columns}
        names = "".join(f", {name}" for name in columns)
        marks = "".join(f", :{name}" for name in columns)
        removed = ", removed_at" if values.get("removed") else ""
        removed_mark = ", UTC_TIMESTAMP(3)" if values.get("removed") else ""
        conn.execute(text(
            f"INSERT INTO content_items (site_id, path, path_hash, added_by{names}{removed}) VALUES (:s, :p, :h, :by{marks}{removed_mark}) "
            f"ON DUPLICATE KEY UPDATE {', '.join(sets)}"
        ), params)
        row = conn.execute(text("SELECT path, title, published_on, target_query, removed_at FROM content_items WHERE site_id = :s AND path_hash = :h"), {"s": site_id, "h": _hash(path)}).mappings().first()
    if row is None:
        raise NotFound("That piece isn't tracked.")
    return {"site_id": site_id, "path": row["path"], "title": row["title"] or "", "published_on": _iso(row["published_on"]), "target_query": row["target_query"] or "", "removed": row["removed_at"] is not None}
