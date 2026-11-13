"""What a task can be about, to pick from in the task panel: the pages, keywords, rankings, backlinks, linking
websites, technical issues, competitors and notes the app already knows for a site. Anything but a backlink,
competitor or note can also be typed, so this only suggests."""
from __future__ import annotations

from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.competitors.keywords import require_own
from seo.metrics.service import _path
from seo.serp import rankings, store

DAYS = 28
_MAX = 2000
_MAX_PAGES = 5000


def _pages(conn, site_id: int) -> list[dict]:
    """Every page of the site we know: read by the site reader, seen in Search Console or Google Analytics at any
    time, or seen in a search result. Clicks are Search Console's for the last 28 days. One row per page, matched
    by its path as on the Pages screen, so /visa, /visa/ and https://www.shop.example/visa/?x=1 are one page."""
    host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": site_id}).scalar() or ""
    host = host.lower().removeprefix("www.")
    since = date.today() - timedelta(days=DAYS)
    found: dict[str, dict] = {}

    def add(url: str, title: str = "", clicks: int = 0) -> None:
        if not url or not _same_site(url, host):
            return
        path = _path(url)
        one = found.setdefault(path, {"url": f"https://{host}{path}", "title": "", "clicks": 0})
        one["title"] = one["title"] or (title or "")
        one["clicks"] += clicks

    for r in conn.execute(text(
        "SELECT p.url, p.title FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w) AND p.content_hash IS NOT NULL LIMIT :n"
    ), {"h": host, "w": f"www.{host}", "n": _MAX_PAGES}).mappings():
        add(r["url"], r["title"])
    for r in conn.execute(text(
        "SELECT MAX(page) AS page, SUM(CASE WHEN day >= :d THEN clicks ELSE 0 END) AS clicks FROM gsc_page WHERE site_id = :s "
        "GROUP BY page_hash ORDER BY clicks DESC LIMIT :n"
    ), {"s": site_id, "d": since, "n": _MAX_PAGES}).mappings():
        add(r["page"], "", int(r["clicks"] or 0))
    for r in conn.execute(text(
        "SELECT DISTINCT url, title FROM serp_results WHERE host = :h OR host LIKE :sub LIMIT :n"
    ), {"h": store.to_ascii_host(host), "sub": f"%.{store.to_ascii_host(host)}", "n": _MAX_PAGES}).mappings():
        add(store.canonical_url(r["url"]) or r["url"], r["title"])
    for r in _ga_pages(conn, site_id):
        add(r)
    return sorted(found.values(), key=lambda p: (-p["clicks"], p["url"]))[:_MAX_PAGES]


def _ga_pages(conn, site_id: int) -> list[str]:
    """Pages Google Analytics has seen, as paths ("(not set)" isn't one and is left out by _same_site)."""
    return [r[0] for r in conn.execute(text(
        "SELECT DISTINCT path FROM ga4_page_daily WHERE site_id = :s LIMIT :n"), {"s": site_id, "n": _MAX_PAGES}) if r[0]]


def _same_site(url: str, host: str) -> bool:
    """A path alone belongs to the site; a full address only when it's on the site or one of its subdomains."""
    if "://" not in url:
        return url.startswith("/")
    other = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    return other == host or other.endswith(f".{host}")


def _rankings(engine: Engine, site_id: int) -> tuple[list[dict], list[dict]]:
    """Tracked keywords, and one ranking per keyword and engine that has a position."""
    keywords, ranked = [], []
    for row in rankings.rows_of_site(engine, site_id):
        keywords.append({"keyword": row["keyword"], "impressions": row.get("impressions")})
        for name, view in (row.get("engines") or {}).items():
            main = view.get("main") or {}
            position = main.get("p") if main else None
            if position is None and view.get("own") is None:
                continue
            ranked.append({
                "ref": f"{row['keyword_id']}:{name}", "keyword": row["keyword"], "engine": name,
                "position": position if position is not None else round(view["own"], 1), "page": row.get("page") or "",
            })
    return keywords, ranked


def _backlinks(conn, site_id: int) -> list[dict]:
    rows = conn.execute(text(
        "SELECT id, domain, source_url, target_url, status, seo_verdict FROM backlinks WHERE site_id = :s "
        "ORDER BY status = 'lost', status = 'planned', domain LIMIT 2000"
    ), {"s": site_id}).mappings()
    return [{"id": r["id"], "domain": r["domain"], "source": r["source_url"], "target": r["target_url"] or "",
             "status": r["status"], "verdict": r["seo_verdict"] or ""} for r in rows]


def _domains(conn, site_id: int) -> list[dict]:
    """Websites I'd like a link from: In consideration, and Link gaps (who links to my competitors)."""
    found: dict[str, dict] = {}
    for r in conn.execute(text("SELECT domain, spam_score FROM prospects WHERE site_id = :s LIMIT 3000"), {"s": site_id}).mappings():
        found.setdefault(r["domain"], {"domain": r["domain"], "where": "consideration", "spam": (r["spam_score"] or 0) >= 30})
    for r in conn.execute(text(
        "SELECT r.domain, MAX(r.spam_score) AS spam, COUNT(DISTINCT r.competitor_id) AS rivals FROM competitor_referrers r "
        "JOIN site_competitors sc ON sc.competitor_id = r.competitor_id WHERE sc.site_id = :s AND r.removed_by_hand = 0 "
        "GROUP BY r.domain ORDER BY rivals DESC LIMIT 3000"
    ), {"s": site_id}).mappings():
        found.setdefault(r["domain"], {"domain": r["domain"], "where": "gap", "spam": (r["spam"] or 0) >= 30, "rivals": int(r["rivals"])})
    return list(found.values())[:_MAX]


def _technical(conn, site_id: int) -> list[dict]:
    """The latest health test's problems, the latest links check's broken links, pages Google hasn't indexed and slow pages."""
    out: list[dict] = []
    audit = conn.execute(text(
        "SELECT id FROM health_audits WHERE site_id = :s AND status = 'complete' ORDER BY id DESC LIMIT 1"), {"s": site_id}).scalar()
    if audit:
        for r in conn.execute(text("SELECT code, page_count FROM health_issues WHERE audit_id = :a AND page_count > 0 ORDER BY page_count DESC"), {"a": audit}):
            out.append({"ref": f"health:{r[0]}", "part": "health", "code": r[0], "count": int(r[1])})
    scan = conn.execute(text(
        "SELECT id FROM link_scans WHERE site_id = :s AND status = 'complete' ORDER BY id DESC LIMIT 1"), {"s": site_id}).scalar()
    if scan:
        for r in conn.execute(text(
            "SELECT target_url, category, status_code, JSON_LENGTH(pages) AS n FROM link_issues WHERE scan_id = :a AND category = 'broken' ORDER BY n DESC LIMIT 300"
        ), {"a": scan}).mappings():
            out.append({"ref": f"link:{r['target_url']}"[:500], "part": "link", "url": r["target_url"], "code": str(r["status_code"] or ""), "count": int(r["n"] or 0)})
    for r in conn.execute(text(
        "SELECT url, coverage FROM gsc_inspections WHERE site_id = :s AND verdict IS NOT NULL AND verdict <> 'PASS' ORDER BY url LIMIT 300"
    ), {"s": site_id}).mappings():
        out.append({"ref": f"index:{r['url']}"[:500], "part": "index", "url": r["url"], "code": r["coverage"] or "", "count": 1})
    latest: dict[tuple, dict] = {}
    for r in conn.execute(text(
        "SELECT url, strategy, performance FROM cwv_runs WHERE site_id = :s ORDER BY id DESC LIMIT 2000"), {"s": site_id}).mappings():
        latest.setdefault((r["url"], r["strategy"]), dict(r))
    slow = sorted((r for r in latest.values() if r["performance"] is not None and r["performance"] < 50), key=lambda r: r["performance"])
    for r in slow[:100]:
        out.append({"ref": f"speed:{r['url']}"[:500], "part": "speed", "url": r["url"], "code": r["strategy"], "count": int(r["performance"])})
    return out


def _competitors(conn, site_id: int) -> list[dict]:
    return [{"id": r[0], "host": r[1]} for r in conn.execute(text(
        "SELECT s.id, s.host FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s ORDER BY s.host"
    ), {"s": site_id})]


def _notes(conn, site_id: int) -> list[dict]:
    out = []
    for r in conn.execute(text(
        "SELECT id, scope, LEFT(body, 400) AS body, updated_at FROM notes WHERE deleted_at IS NULL AND (site_id = :s OR site_id IS NULL) "
        "ORDER BY updated_at DESC LIMIT 200"
    ), {"s": site_id}).mappings():
        first = next((line.strip() for line in (r["body"] or "").splitlines() if line.strip()), "")
        out.append({"id": r["id"], "scope": r["scope"], "text": first[:160]})
    return out


def for_site(engine: Engine, site_id: int) -> dict:
    with engine.connect() as conn:
        require_own(conn, site_id)
        pages = _pages(conn, site_id)
        keywords, ranked = _rankings(engine, site_id)
        return {
            "site_id": site_id, "pages": pages, "keywords": keywords, "rankings": ranked,
            "backlinks": _backlinks(conn, site_id), "domains": _domains(conn, site_id), "technical": _technical(conn, site_id),
            "competitors": _competitors(conn, site_id), "notes": _notes(conn, site_id),
        }
