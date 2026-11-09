"""A competitor's profile tabs (Pages, Activity, Their site), built from what's already collected. Nothing here calls out.

Facts only, never advice. Anything not measured is None, never 0, so the screen shows a dash: my own site is only
partly read (the pages paired with theirs), so my side stays None until it has pages.

When a page appeared: the date it states (datePublished), else the Wayback Machine's first copy, else the day the
daily read reported it as new. When it was last updated: the date it states (dateModified), the last change the app
saw, or its sitemap date when the sitemap's dates mean something (under half the pages share one date).
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Engine, text

from seo.competitors import history, pairs, quality, tracking
from seo.competitors.keywords import _iso, require_own
from seo.competitors.pages import fold
from seo.competitors.suggest import domain_of, my_domains
from seo.serp import store

MONTHS = 12
BEST_PAGES = 20
SECTIONS = 12
QUESTIONS = 100
TOP_LINKS = 10
LANGUAGE_SHARE = 0.1  # a language on fewer pages than this is a stray page, not a version of the site
SITEMAP_SAME_DATE = 0.5

_PAGE_COLUMNS = (
    "p.id, p.url, p.title, p.meta_description, p.robots_meta, p.lang, p.headings, p.word_count, p.schema_types, p.internal_links, "
    "p.extras, p.sitemap_lastmod, p.first_archived, p.last_changed_at"
)


def _json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


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


def _pages(conn, host: str) -> list[dict]:
    """Pages read and still there. A page that's gone isn't one of theirs any more."""
    rows = conn.execute(
        text(
            f"SELECT {_PAGE_COLUMNS}, (SELECT MIN(e.detected_at) FROM change_events e WHERE e.page_id = p.id AND e.kind = 'new_page') AS reported_new "
            "FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w) AND p.content_hash IS NOT NULL AND (p.last_status IS NULL OR p.last_status <> 'gone')"
        ),
        {"h": host, "w": f"www.{host}"},
    ).mappings().all()
    out = []
    for row in rows:
        page = dict(row)
        for name in ("headings", "schema_types", "extras"):
            page[name] = _json(page[name])
        page["extras"] = page["extras"] if isinstance(page["extras"], dict) else {}
        out.append(page)
    _add_dates(out)
    return out


def _add_dates(pages: list[dict]) -> None:
    lastmods = Counter(p["sitemap_lastmod"] for p in pages if p["sitemap_lastmod"])
    honest = bool(lastmods) and lastmods.most_common(1)[0][1] < SITEMAP_SAME_DATE * len(pages)
    for page in pages:
        page["appeared"] = _day(page["extras"].get("published")) or page["first_archived"] or _day(page["reported_new"])
        updated = [_day(page["extras"].get("modified")), _day(page["last_changed_at"]), page["sitemap_lastmod"] if honest else None]
        page["updated"] = max((d for d in updated if d), default=None)


def _section(url: str) -> str:
    path = "/" + url.split("://", 1)[-1].partition("/")[2]
    path = path.split("?", 1)[0].split("#", 1)[0]
    first, _, rest = path.lstrip("/").partition("/")
    return f"/{first}/" if first and rest else "/"


def _events(conn, host: str, kind: str, days: int) -> list[str]:
    return [
        row[0]
        for row in conn.execute(
            text(
                "SELECT p.url FROM change_events e JOIN domains d ON d.id = e.domain_id JOIN pages p ON p.id = e.page_id "
                f"WHERE d.host IN (:h, :w) AND e.kind = :k AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL {int(days)} DAY"
            ),
            {"h": host, "w": f"www.{host}", "k": kind},
        )
    ]


# ---- facts ----------------------------------------------------------------------------------------

def _moz(conn, host: str) -> dict:
    row = conn.execute(
        text("SELECT domain_authority, popularity FROM moz_metrics WHERE target IN (:h, :d) ORDER BY (target = :h) DESC LIMIT 1"),
        {"h": host, "d": domain_of(host)},
    ).mappings().first()
    return dict(row) if row else {"domain_authority": None, "popularity": None}


def _languages(pages: list[dict]) -> list[str]:
    codes = Counter((p["lang"] or "").split("-")[0].lower() for p in pages if p["lang"])
    return [code for code, n in codes.most_common(3) if code and n >= LANGUAGE_SHARE * len(pages)]


def _facts(conn, host: str, my_host: str, theirs: list[dict], mine: list[dict], blocked: bool) -> dict:
    past = history.state(conn, host) or {"status": history.QUEUED}
    my_past = history.state(conn, my_host) or {}
    moz, my_moz = _moz(conn, host), _moz(conn, my_host)
    return {
        "first_capture": _date_iso(past.get("first_capture")),
        "registered_on": _date_iso(past.get("registered_on")),
        "expires_on": _date_iso(past.get("expires_on")),
        "my_registered_on": _date_iso(my_past.get("registered_on")),
        "da": moz["domain_authority"], "my_da": my_moz["domain_authority"],
        "popularity": moz["popularity"], "my_popularity": my_moz["popularity"],
        "pages": None if blocked or not theirs else len(theirs),
        "my_pages": len(mine),
        "languages": _languages(theirs),
        "cms": None,  # not read from pages yet
        "history": {
            "status": past["status"], "message": past.get("message"), "fetched_at": _iso(past.get("fetched_at")),
            "archived_pages": past.get("archived_pages"), "capped": bool(past.get("capped")),
        },
    }


def _date_iso(value) -> str | None:
    return value.isoformat() if isinstance(value, date) else None


# ---- activity -------------------------------------------------------------------------------------

def _rhythm(conn, host: str, theirs: list[dict], mine: list[dict], by_year: dict) -> dict:
    today = datetime.now(timezone.utc).date()
    keys = []
    year, month = today.year, today.month
    for _ in range(MONTHS):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    keys.reverse()

    def per_month(pages):
        counts = Counter(p["appeared"].strftime("%Y-%m") for p in pages if p["appeared"])
        return [counts.get(key, 0) for key in keys]

    their_months, my_months = per_month(theirs), per_month(mine) if mine else [None] * MONTHS
    new_urls = _events(conn, host, "new_page", 30)
    sections = Counter(_section(url) for url in new_urls)
    year_ago = today - timedelta(days=365)

    def updated_share(pages):
        # Among pages with an update date. A page with none isn't "not updated": nobody knows.
        dated = [p for p in pages if p["updated"]]
        return round(sum(1 for p in dated if p["updated"] >= year_ago) / len(dated), 3) if dated else None

    return {
        "months": [{"month": key, "theirs": t, "mine": m} for key, t, m in zip(keys, their_months, my_months)],
        "new_30d": len(new_urls),
        # My site's pages are read when paired, not every day, so nothing reports its new or removed pages yet.
        "my_new_30d": None,
        "top_section": sections.most_common(1)[0][0] if sections else None,
        "updated_12m": {"theirs": updated_share(theirs), "mine": updated_share(mine)},
        "removed_30d": len(_events(conn, host, "page_gone", 30)),
        "my_removed_30d": None,
        "by_year": [{"year": int(y), "pages": n} for y, n in sorted((by_year or {}).items())],
    }


# ---- pages ----------------------------------------------------------------------------------------

def _sections(theirs: list[dict], mine: list[dict]) -> list[dict]:
    since = datetime.now(timezone.utc).date() - timedelta(days=90)
    groups: dict[str, list[dict]] = defaultdict(list)
    for page in theirs:
        groups[_section(page["url"])].append(page)
    my_counts = Counter(_section(p["url"]) for p in mine)
    out = []
    for path, pages in groups.items():
        changed = [p["last_changed_at"] for p in pages if p["last_changed_at"]]
        out.append({
            "path": path, "pages": len(pages), "my_pages": my_counts.get(path, 0),
            "new_90d": sum(1 for p in pages if p["appeared"] and p["appeared"] >= since),
            "last_change": _iso(max(changed)) if changed else None,
        })
    out.sort(key=lambda s: (-s["pages"], s["path"]))
    return out[:SECTIONS]


def _questions(theirs: list[dict], mine: list[dict]) -> list[dict]:
    """Questions in their headings that none of my read pages asks."""
    asked = {fold(q) for p in mine for q in (p["extras"].get("questions") or []) if isinstance(q, str)}
    out, seen = [], set()
    for page in sorted(theirs, key=lambda p: p["url"]):
        for question in page["extras"].get("questions") or []:
            if not isinstance(question, str):
                continue
            key = fold(question)
            if key and key not in seen and key not in asked:
                seen.add(key)
                out.append({"text": question, "source": "heading", "url": page["url"]})
    return out[:QUESTIONS]


def _best_pages(conn, site_id: int, competitor_id: int, my_host: str, host: str, checks: list[store.Check], theirs: list[dict]) -> list[dict]:
    """Their pages by how many of my keywords each ranks for, from the latest check of each keyword."""
    titles = {history.page_key(p["url"]): p["title"] for p in theirs if p["title"]}
    paired = {
        history.page_key(row["their_url"]): row
        for row in conn.execute(
            text("SELECT id, my_url, their_url FROM page_pairs WHERE site_id = :s AND competitor_id = :c AND hidden = 0"), {"s": site_id, "c": competitor_id}
        ).mappings()
    }
    my_titles = {
        history.page_key(row[0]): row[1]
        for row in conn.execute(
            text("SELECT p.url, p.title FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w) AND p.title IS NOT NULL"),
            {"h": my_host, "w": f"www.{my_host}"},
        )
    }
    by_url: dict[str, dict] = {}
    for check in store.one_per_keyword(checks):
        found, mine = check.best_on(host), check.best_on(my_host)
        if found is None:
            continue
        key = history.page_key(found.url)
        row = by_url.setdefault(key, {"url": found.url, "title": titles.get(key) or found.title or None, "keywords": 0, "best_position": found.position, "my_url": None, "my_title": None, "pair_id": None})
        row["keywords"] += 1
        row["best_position"] = min(row["best_position"], found.position)
        if mine is not None and row["my_url"] is None:
            row["my_url"] = mine.url
    for key, row in by_url.items():
        pair = paired.get(key)
        if pair is not None:
            row["pair_id"], row["my_url"] = pair["id"], pair["my_url"]
        if row["my_url"]:
            row["my_title"] = my_titles.get(history.page_key(row["my_url"]))
    return sorted(by_url.values(), key=lambda r: (-r["keywords"], r["best_position"], r["url"]))[:BEST_PAGES]


def _cannibal(past: list[store.Check], host: str) -> dict[str, int]:
    """Keywords where their result landed on different pages across checks."""
    urls: dict[str, set[str]] = defaultdict(set)
    for check in past:
        found = check.best_on(host)
        if found is not None:
            urls[check.keyword].add(history.page_key(found.url))
    return {keyword: len(found) for keyword, found in urls.items() if len(found) > 1}


# ---- their site -----------------------------------------------------------------------------------

def _links(conn, site_id: int, competitor_id: int, host: str) -> dict:
    mine = my_domains(conn)
    decisions = dict(conn.execute(text("SELECT domain, decision FROM link_gap_overrides WHERE site_id = :s"), {"s": site_id}).all())
    rows = conn.execute(
        text(
            "SELECT r.domain, r.authority, r.authority_label, d.quality FROM competitor_referrers r LEFT JOIN link_domains d ON d.domain = r.domain "
            "WHERE r.competitor_id = :c AND r.removed_by_hand = 0"
        ),
        {"c": competitor_id},
    ).mappings().all()
    rows = [r for r in rows if r["domain"] not in mine and r["domain"] != domain_of(host)]
    logged = conn.execute(text("SELECT domain, status FROM backlinks WHERE site_id = :s"), {"s": site_id}).all()
    linking_me = {domain for domain, status in logged if status in ("live", "found")}

    def spam(row) -> bool:
        decision = decisions.get(row["domain"])
        return decision == "spam" or (decision != "keep" and row["quality"] == quality.SPAM)

    top = sorted(rows, key=lambda r: (spam(r), -(r["authority"] if r["authority"] is not None else -1), r["domain"]))[:TOP_LINKS]
    return {
        "linking_domains": len(rows) if rows else None,
        "my_linking_domains": len(linking_me) if logged else None,
        "not_to_me": sum(1 for r in rows if r["domain"] not in linking_me and not spam(r)),
        "top": [{"domain": r["domain"], "authority": r["authority"], "authority_label": r["authority_label"], "spam": spam(r)} for r in top],
    }


def _average(values) -> float | None:
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values)) if values else None


def _share(pages, test) -> float | None:
    return round(sum(1 for p in pages if test(p)) / len(pages), 3) if pages else None


def _schema_shares(pages) -> list | None:
    if not pages:
        return None
    counts = Counter(kind for p in pages for kind in set(p["schema_types"] or []) if isinstance(kind, str))
    return [[kind, round(n / len(pages), 3)] for kind, n in counts.most_common(4)]


def _shared_titles(pages) -> int | None:
    if not pages:
        return None
    titles = Counter(fold(p["title"]) for p in pages if p["title"])
    return sum(n for n in titles.values() if n > 1)


def _missing_alt(pages) -> float | None:
    images = sum(int(p["extras"].get("images") or 0) for p in pages)
    return round(sum(int(p["extras"].get("images_no_alt") or 0) for p in pages) / images, 3) if images else None


def _build(theirs: list[dict], mine: list[dict]) -> list[dict]:
    """How each side builds its pages. Each row is measured on the pages read, mine only once some are."""
    rows = [
        ("words", "Average words per page", "number", lambda ps: _average(p["word_count"] for p in ps), False),
        ("title", "Average title length", "number", lambda ps: _average(len(p["title"]) for p in ps if p["title"]), False),
        ("meta", "Pages with a meta description", "share", lambda ps: _share(ps, lambda p: bool((p["meta_description"] or "").strip())), False),
        ("schema", "Structured data", "list", _schema_shares, False),
        ("questions", "Pages with questions in headings", "share", lambda ps: _share(ps, lambda p: bool(p["extras"].get("questions"))), False),
        ("videos", "Pages with a video", "share", lambda ps: _share(ps, lambda p: int(p["extras"].get("videos") or 0) > 0), False),
        ("dupes", "Pages sharing a title with another", "number", _shared_titles, False),
        ("noindex", "Pages hidden from search (noindex)", "number", lambda ps: sum(1 for p in ps if "noindex" in (p["robots_meta"] or "").lower()) if ps else None, False),
        ("alt", "Images without alt text", "share", _missing_alt, True),
        ("internal", "Average links to their own pages", "number", lambda ps: _average(p["internal_links"] for p in ps), True),
        ("hreflang", "Language versions (hreflang)", "list", lambda ps: sorted({code for p in ps for code in (p["extras"].get("hreflang") or [])})[:8] if ps else None, True),
        ("tables", "Pages with a table", "share", lambda ps: _share(ps, lambda p: int(p["extras"].get("tables") or 0) > 0), True),
    ]
    if not theirs:
        return []
    out = []
    for key, label, kind, measure, more in rows:
        entry = {"key": key, "label": label, "kind": kind, "mine": measure(mine) if mine else None, "theirs": measure(theirs)}
        if more:
            entry["more"] = True
        out.append(entry)
    return out


# ---- all of it ------------------------------------------------------------------------------------

def insights(engine: Engine, site_id: int, competitor_id: int) -> dict:
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        competitor = pairs._competitor(conn, site_id, competitor_id)
        setting = tracking.of_site(conn, site_id).get(competitor_id, tracking.ON)
        host, my_host = competitor["host"], site["host"]
        crawl = conn.execute(text("SELECT status FROM competitor_crawls WHERE competitor_id = :c"), {"c": competitor_id}).scalar()
        theirs, mine = _pages(conn, host), _pages(conn, my_host)
        facts = _facts(conn, host, my_host, theirs, mine, crawl == "blocked")
        past = history.state(conn, host) or {}
        rhythm = _rhythm(conn, host, theirs, mine, past.get("pages_by_year"))
        links = _links(conn, site_id, competitor_id, host) if setting != tracking.OFF else {"linking_domains": None, "my_linking_domains": None, "not_to_me": 0, "top": []}
        best, cannibal = [], {}
        if setting == tracking.ON:  # keyword numbers only for a competitor that's followed
            best = _best_pages(conn, site_id, competitor_id, my_host, host, store.latest_checks(engine, site_id), theirs)
    if setting == tracking.ON:
        cannibal = _cannibal(store.history(engine, site_id), host)
    return {
        "facts": facts,
        "best_pages": best,
        "sections": _sections(theirs, mine),
        "questions": _questions(theirs, mine),
        "rhythm": rhythm,
        "links": links,
        "build": _build(theirs, mine),
        "keywords": {"features": {}, "cannibal": cannibal},  # search features aren't saved from any tool yet, so they stay silent
    }
