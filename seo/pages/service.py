"""The Pages screen: every page of my sites with its numbers, and one page's whole story.

A page is matched by its path on its site, so https://shop.example/visa, /visa/ and /visa?x=1 are one page, as on the
Content screen (metrics.service._path). Tasks and notes are counted here too, so the list can sort and filter by them."""
from __future__ import annotations

import json
from datetime import date
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.competitors import pages as page_store
from seo.competitors import pairs
from seo.competitors.keywords import _iso, require_own
from seo.core.errors import Refused
from seo.metrics import period
from seo.metrics import service as metrics
from seo.metrics.service import Spelling, _path, spelled_path
from seo.serp import rankings

_MAX_ROWS = 5000


def _load(value, empty):
    if value is None or value == "":
        return empty
    return json.loads(value) if isinstance(value, str) else value


def _host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.") if "://" in (url or "") else ""


def _same_site(url: str, host: str) -> bool:
    """A path alone belongs to whichever site it's read on; a full address only to its own site."""
    other = _host_of(url)
    return not other or other == host or other.endswith(f".{host}")


def _sites(conn, site_ids) -> dict[int, str]:
    if not site_ids:
        return {}
    marks = ", ".join(str(int(s)) for s in site_ids)
    return {r[0]: r[1] for r in conn.execute(text(f"SELECT id, host FROM sites WHERE id IN ({marks}) AND kind = 'own'"))}


def _counts(conn, sites: dict[int, str]) -> dict[tuple[int, str], dict]:
    """Open tasks, notes, live backlinks and Google's index verdict, per (site, path)."""
    out: dict[tuple[int, str], dict] = {}

    def slot(site: int, path: str) -> dict:
        return out.setdefault((site, path), {"tasks_open": 0, "notes": 0, "backlinks": 0, "indexed": None})

    marks = ", ".join(str(int(s)) for s in sites) or "0"
    for row in conn.execute(text(f"SELECT site_id, site_host, pages FROM tasks WHERE deleted_at IS NULL AND status <> 'done' AND pages IS NOT NULL AND (site_id IN ({marks}) OR site_id IS NULL)")).mappings():
        targets = [row["site_id"]] if row["site_id"] in sites else list(sites)
        for link in _load(row["pages"], []):
            for site in targets:
                if _same_site(link, sites[site]):
                    slot(site, _path(link))["tasks_open"] += 1
    for row in conn.execute(text(f"SELECT site_id, page_url FROM notes WHERE deleted_at IS NULL AND scope = 'page' AND site_id IN ({marks})")).mappings():
        if row["page_url"]:
            slot(row["site_id"], _path(row["page_url"]))["notes"] += 1
    for row in conn.execute(text(f"SELECT site_id, COALESCE(target_final_url, target_url) AS target FROM backlinks WHERE site_id IN ({marks}) AND status = 'live' AND target_url IS NOT NULL")).mappings():
        slot(row["site_id"], _path(row["target"]))["backlinks"] += 1
    for row in conn.execute(text(f"SELECT site_id, url, verdict FROM gsc_inspections WHERE site_id IN ({marks}) AND verdict IS NOT NULL")).mappings():
        slot(row["site_id"], _path(row["url"]))["indexed"] = row["verdict"] == "PASS"
    return out


def listing(scope: metrics.Scope) -> dict:
    """Every page of my sites: Search Console and Google Analytics numbers for the period, plus pages only the
    reader knows, with what's attached to each."""
    content = metrics.content(scope, limit=_MAX_ROWS)
    with scope.engine.connect() as conn:
        sites = _sites(conn, scope.site_ids)
        site_of_host = {host: site for site, host in sites.items()}
        rows: dict[tuple[int, str], dict] = {}

        def row_for(site: int, path: str) -> dict:
            return rows.setdefault((site, path), {
                "site_id": site, "host": sites[site], "path": path, "title": "", "clicks": None, "impressions": None,
                "position": None, "sessions": None, "leads": None, "ai": None, "clicks_before": None, "change": None, "read": False,
            })

        # Shown as Google or the site spells it (content() already picked Search Console's, else Google Analytics'); the
        # page reader's spelling comes before Google Analytics'. Rows are still matched on _path().
        spelling = Spelling()
        for item in content["pages"]:
            site = site_of_host.get(item["host"])
            if site is None or item.get("unknown"):
                continue
            key = _path(item.get("key") or item["path"])
            row = row_for(site, key)
            for name in ("clicks", "impressions", "position", "sessions", "leads", "ai"):
                row[name] = item[name]
            spelling.offer((site, key), item["path"], 0 if item["clicks"] is not None else 2)
        for site, host in sites.items():
            for page in conn.execute(text(
                "SELECT p.url, p.title FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w) AND p.content_hash IS NOT NULL LIMIT 5000"
            ), {"h": host, "w": f"www.{host}"}).mappings():
                row = row_for(site, _path(page["url"]))
                row["read"] = True
                row["title"] = row["title"] or (page["title"] or "")
                spelling.offer((site, _path(page["url"])), page["url"], 1)
        # The earlier period of the shared rule, per site, only where Search Console's page table covers it from its first
        # day: a page table that starts later would turn missing history into gains (expert review 2026-11-17). There, a
        # page with no row before had no clicks before (0); elsewhere nothing is compared (None).
        window = content["gsc_window"]
        compared: set[int] = set()
        if window.get("compare_from") and (window.get("rows_compare") or {}).get("page"):
            start = date.fromisoformat(window["compare_from"])
            compared = {r["site_id"] for r in scope.fetch("SELECT site_id, MIN(day) first FROM gsc_page WHERE site_id IN :sites GROUP BY site_id") if r["first"] and r["first"] <= start}
            for item in scope.fetch(
                "SELECT site_id, MAX(page) page, SUM(clicks) clicks FROM gsc_page WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY site_id, page_hash",
                date.fromisoformat(window["compare_from"]), date.fromisoformat(window["compare_to"]),
            ):
                key = (item["site_id"], _path(item["page"]))
                if key in rows and item["site_id"] in compared:
                    rows[key]["clicks_before"] = (rows[key]["clicks_before"] or 0) + int(item["clicks"] or 0)
        for (site, _), row in rows.items():
            if site in compared:
                row["clicks_before"] = row["clicks_before"] or 0
                row["change"] = (row["clicks"] or 0) - row["clicks_before"]
            else:
                row["change"] = None
        counts = _counts(conn, sites)
    listed = []
    for key, row in rows.items():
        row.update(counts.get(key, {"tasks_open": 0, "notes": 0, "backlinks": 0, "indexed": None}))
        row["path"] = spelling.get(key, row["path"])
        row["url"] = f"https://{row['host']}{row['path']}"
        listed.append(row)
    listed.sort(key=lambda r: (-(r["clicks"] or 0), -(r["sessions"] or 0), r["host"], r["path"]))
    return {
        "pages": listed[:_MAX_ROWS], "total": len(listed),
        "summary": {
            "pages": len(listed), "with_clicks": sum(1 for r in listed if r["clicks"]),
            "not_indexed": sum(1 for r in listed if r["indexed"] is False), "open_tasks": sum(1 for r in listed if r["tasks_open"]),
            "losing": sum(1 for r in listed if (r["change"] or 0) < 0),
        },
        "compared": bool(compared),  # False: no Search Console page data for the whole period before, so no Change
        "gsc": content["gsc"], "ga4": content["ga4"], "gsc_window": content["gsc_window"],
    }


def _read(conn, host: str, path: str) -> tuple[dict | None, int | None]:
    """What the page reader saw, trying the usual spellings of the address."""
    tries = [f"https://{host}{path}", f"https://{host}{path.rstrip('/')}", f"https://www.{host}{path}", f"http://{host}{path}"]
    for url in dict.fromkeys(tries):
        page = page_store.load(conn, url)
        if page is not None:
            side = pairs._side(conn, url)
            side.pop("_text", None)
            return side, page["id"]
    return None, None


def profile(engine: Engine, site_id: int, page: str) -> dict:
    """One page: what it is, how it does, and everything linked to it. Search and visits come from their own routes."""
    if not isinstance(page, str) or not page.strip():
        raise Refused("Say which page.")
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        host = site["host"]
        if not _same_site(page, host):
            raise Refused("That page isn't on this site.")
        path = _path(page.strip())
        read, page_id = _read(conn, host, path)
        spelling = Spelling()  # shown as Search Console has it, else as the page reader found it, else as asked
        spelling.offer(path, page.strip(), 3)
        if read and read.get("url"):
            spelling.offer(path, read["url"], 1)
        edits = []
        if page_id is not None:
            edits = [{"kind": r["kind"], "before": (r["before_value"] or "")[:300], "after": (r["after_value"] or "")[:300], "at": _iso(r["detected_at"]), "words": r["changed_words"]}
                     for r in conn.execute(text("SELECT kind, before_value, after_value, detected_at, changed_words FROM change_events WHERE page_id = :p ORDER BY detected_at DESC LIMIT 30"), {"p": page_id}).mappings()]
        links = [
            {"id": r["id"], "domain": r["domain"], "source": r["source_url"], "status": r["status"], "verdict": r["seo_verdict"] or "", "anchor": r["anchor"] or "", "authority": r["authority"], "nofollow": r["is_nofollow"]}
            for r in conn.execute(text(
                "SELECT id, domain, source_url, status, seo_verdict, anchor, authority, is_nofollow, target_url, target_final_url FROM backlinks WHERE site_id = :s AND target_url IS NOT NULL ORDER BY status = 'lost', domain"
            ), {"s": site_id}).mappings()
            if path in (_path(r["target_url"]), _path(r["target_final_url"] or ""))
        ]
        linked = next((
            {"incoming": r["incoming_links"], "sites": r["linking_sites"], "at": _iso(r["imported_at"])}
            for r in conn.execute(text("SELECT target_url, incoming_links, linking_sites, imported_at FROM gsc_linked_pages WHERE site_id = :s AND dismissed = 0"), {"s": site_id}).mappings()
            if _path(r["target_url"]) == path
        ), None)
        inspection = next((
            {"verdict": r["verdict"], "coverage": r["coverage"] or "", "google_canonical": r["google_canonical"] or "", "last_crawl": _iso(r["last_crawl"]), "at": _iso(r["inspected_at"])}
            for r in conn.execute(text("SELECT url, verdict, coverage, google_canonical, last_crawl, inspected_at FROM gsc_inspections WHERE site_id = :s ORDER BY inspected_at DESC"), {"s": site_id}).mappings()
            if _path(r["url"]) == path
        ), None)
        speed: dict[str, dict] = {}
        for r in conn.execute(text("SELECT url, strategy, performance, lcp_ms, inp_ms, cls, field_data, field_origin, ran_at FROM cwv_runs WHERE site_id = :s ORDER BY id DESC LIMIT 3000"), {"s": site_id}).mappings():
            if r["strategy"] not in speed and _same_site(r["url"], host) and _path(r["url"]) == path:
                run = metrics.speed_run(r)
                speed[r["strategy"]] = {"score": run["performance"], "lcp_ms": run["lcp_ms"], "inp_ms": run["inp_ms"], "cls": run["cls"], "field": run["field"], "passed": run["passed"], "at": _iso(r["ran_at"])}
        health = []
        audit = conn.execute(text("SELECT id, created_at FROM health_audits WHERE site_id = :s AND status = 'complete' ORDER BY id DESC LIMIT 1"), {"s": site_id}).mappings().first()
        if audit:
            for r in conn.execute(text("SELECT code, pages FROM health_issues WHERE audit_id = :a AND page_count > 0"), {"a": audit["id"]}).mappings():
                listed = _load(r["pages"], [])
                if isinstance(listed, list) and any(isinstance(u, str) and _path(u) == path for u in listed):
                    health.append(r["code"])
        broken = []
        scan = conn.execute(text("SELECT id, created_at FROM link_scans WHERE site_id = :s AND status = 'complete' ORDER BY id DESC LIMIT 1"), {"s": site_id}).mappings().first()
        if scan:
            for r in conn.execute(text("SELECT category, target_url, status_code, reason, pages FROM link_issues WHERE scan_id = :a"), {"a": scan["id"]}).mappings():
                listed = _load(r["pages"], [])
                if any(isinstance(u, str) and _same_site(u, host) and _path(u) == path for u in listed):
                    broken.append({"category": r["category"], "target": r["target_url"], "status": r["status_code"], "reason": r["reason"]})
        # The shared 28 days (seo/metrics/period.py): ending on Google's last final day, as Today and Overview.
        _scope, window = period.for_site(engine, site_id, 28)
        gsc = conn.execute(text(
            "SELECT page, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_page WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY page_hash, page"
        ), {"s": site_id, "a": window["from"], "b": window["to"]}).mappings().all()
        clicks = impressions = 0
        weight = 0.0
        for r in gsc:
            if _same_site(r["page"], host) and _path(r["page"]) == path:
                spelling.offer(path, r["page"], 0, int(r["c"] or 0) * 1_000_000 + int(r["i"] or 0))
                clicks += int(r["c"] or 0)
                impressions += int(r["i"] or 0)
                weight += float(r["w"] or 0)
    ranked = []
    for row in rankings.rows_of_site(engine, site_id):
        if not row.get("page") or _path(row["page"]) != path:
            continue
        engines = {}
        for name, view in (row.get("engines") or {}).items():
            main = view.get("main") or {}
            if main.get("p") is not None or view.get("own") is not None:
                engines[name] = {"position": main.get("p"), "own": round(view["own"], 1) if view.get("own") is not None else None, "change": view.get("change")}
        ranked.append({"keyword_id": row["keyword_id"], "keyword": row["keyword"], "country": row["country"], "engines": engines, "impressions": row.get("impressions")})
    shown = spelling.get(path, path)
    return {
        "site_id": site_id, "host": host, "path": shown, "url": f"https://{host}{shown}", "title": (read or {}).get("title", ""),
        "google_28d": {"clicks": clicks, "impressions": impressions, "position": round(weight / impressions, 1) if impressions else None, "from": window["from"], "to": window["to"]},
        "read": read, "edits": edits, "rankings": ranked, "backlinks": links, "linked": linked,
        "technical": {
            "inspection": inspection, "speed": speed, "health": health, "health_at": _iso(audit["created_at"]) if audit else None,
            "links": broken, "links_at": _iso(scan["created_at"]) if scan else None,
        },
    }
