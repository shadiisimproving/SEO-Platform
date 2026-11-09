"""Who really ranks for my keywords. Counting only: no AI, and the same in any language or country.

Each domain's evidence is its place in the latest check of each keyword, so the numbers stay current
as new checks arrive. These are suggestions: nothing becomes a competitor until someone accepts it,
and a dismissed domain stays dismissed whatever new data says.
"""
from __future__ import annotations

import re

from sqlalchemy import Engine, text

from seo.backlinks import logos
from seo.backlinks.cleaner import hostname, root_domain
from seo.core.errors import Conflict, NotFound, Refused
from seo.competitors.keywords import _iso, latest_run, require_own
from seo.links import service as sites
from seo.serp import store
from seo.worker import queue

NEW_DAYS = 7
# A one-off is noise once there's enough data to tell.
ENOUGH_KEYWORDS = 5
MIN_APPEARANCES = 2

# Big sites that rank for everything. Shown apart, labelled, and still acceptable: this is a label, not a filter.
PLATFORMS = frozenset({
    "wikipedia.org", "wikimedia.org", "youtube.com", "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "tiktok.com",
    "pinterest.com", "reddit.com", "quora.com", "medium.com", "github.com", "apple.com", "microsoft.com", "yelp.com", "indeed.com",
    "glassdoor.com", "wikihow.com", "yahoo.com", "bing.com", "duckduckgo.com", "yandex.ru", "baidu.com", "vk.com", "whatsapp.com", "telegram.org",
})
_PLATFORM_NAMES = ("amazon", "google", "ebay", "tripadvisor", "booking", "aliexpress")
_PUBLIC_LEVELS = {"gov", "gouv", "gob", "mil", "govt", "go", "gc", "edu", "ac"}


def looks_like_platform(domain: str) -> str | None:
    labels = domain.split(".")
    if domain in PLATFORMS or (len(labels) >= 2 and labels[0] in _PLATFORM_NAMES):
        return "platform"
    if labels[-1] in ("gov", "edu"):
        return "public"
    # economie.gouv.fr and service.go.ke are public. go.com and gov.example aren't: there it's the site's own name.
    if len(labels) >= 2 and labels[-2] in _PUBLIC_LEVELS and (len(labels) >= 3 or len(labels[-1]) == 2):
        return "public"
    return None


def domain_of(host: str) -> str:
    """The root domain, in the spelling search results are stored in."""
    ascii_host = store.to_ascii_host(host)
    return root_domain(ascii_host) or ascii_host


def my_domains(conn) -> set[str]:
    return {domain_of(row[0]) for row in conn.execute(text("SELECT host FROM sites WHERE kind = 'own'"))}


def tracked_competitors(conn, site_id: int) -> list[dict]:
    rows = conn.execute(
        text("SELECT s.id, s.host, sc.source, sc.tracking, sc.created_at FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s ORDER BY s.host"),
        {"s": site_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def suggestions(engine: Engine, site_id: int) -> dict:
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        mine = my_domains(conn)
        tracked = {domain_of(row["host"]) for row in tracked_competitors(conn, site_id)}
        dismissed = {row["domain"]: row["created_at"] for row in conn.execute(text("SELECT domain, created_at FROM competitor_dismissals WHERE site_id = :s"), {"s": site_id}).mappings()}
        keywords_total = conn.execute(text("SELECT COUNT(*) FROM site_keywords WHERE site_id = :s"), {"s": site_id}).scalar()
        # When a domain was first seen on this site's keywords, to mark what's new.
        first_seen = dict(conn.execute(
            text(
                "SELECT r.domain, MIN(c.checked_at) FROM site_keywords sk JOIN serp_targets t ON t.keyword_id = sk.keyword_id "
                "JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' JOIN serp_results r ON r.check_id = c.id "
                "WHERE sk.site_id = :s GROUP BY r.domain"
            ),
            {"s": site_id},
        ).all())
        new_after = conn.execute(text("SELECT UTC_TIMESTAMP(3) - INTERVAL :d DAY"), {"d": NEW_DAYS}).scalar()

    checks = store.latest_checks(engine, site_id)
    checked = {check.keyword_id for check in checks}
    seen: dict[str, dict] = {}
    engine_rank = {name: i for i, name in enumerate(store.ENGINE_ORDER)}
    for check in checks:
        my_row = check.best_on(site["host"])
        per_domain: dict[str, store.Row] = {}
        for row in check.results:
            per_domain.setdefault(row.domain, row)  # its best place on this page
        for domain, row in per_domain.items():
            if domain in mine:
                continue
            entry = seen.setdefault(domain, {"domain": domain, "evidence": [], "keywords": set(), "positions": {}, "both": set(), "engines": set()})
            entry["keywords"].add(check.keyword_id)
            # One position per keyword, from the first engine in the app's order that shows it: an average must not mix engines.
            rank = engine_rank.get(check.engine, len(engine_rank))
            if check.keyword_id not in entry["positions"] or rank < entry["positions"][check.keyword_id][0]:
                entry["positions"][check.keyword_id] = (rank, row.position)
            entry["engines"].add(check.engine)
            if my_row is not None:
                entry["both"].add(check.keyword_id)
            entry["evidence"].append({
                "keyword": check.keyword, "position": row.position, "url": row.url, "engine": check.engine, "tool": check.tool,
                "location": check.real_location, "my_position": my_row.position if my_row else None, "my_depth": check.depth,
                "checked_at": _iso(check.checked_at),
            })

    least = MIN_APPEARANCES if len(checked) >= ENOUGH_KEYWORDS else 1
    suggested, platforms, gone = [], [], []
    for domain, entry in seen.items():
        if domain in tracked:
            continue
        positions = [position for _, position in entry["positions"].values()]
        item = {
            "domain": domain,
            "display": store.to_display_host(domain),
            "keywords": len(entry["keywords"]),
            "share": round(len(entry["keywords"]) / max(1, len(checked)), 3),
            "average_position": round(sum(positions) / len(positions), 1),
            "best_position": min(positions),
            "top3": sum(1 for p in positions if p <= 3),
            "both_rank": len(entry["both"]),
            "engines": sorted(entry["engines"]),
            "kind": looks_like_platform(domain),
            "new": bool(first_seen.get(domain) and first_seen[domain] >= new_after),
            "first_seen": _iso(first_seen.get(domain)),
            "evidence": sorted(entry["evidence"], key=lambda e: (e["position"], e["keyword"]))[:100],
        }
        if domain in dismissed:
            gone.append({**item, "dismissed_at": _iso(dismissed[domain])})
        elif len(entry["keywords"]) < least:
            continue
        elif item["kind"]:
            platforms.append(item)
        else:
            suggested.append(item)
    order = lambda item: (-item["keywords"], item["average_position"], item["domain"])  # noqa: E731
    suggested.sort(key=order)
    platforms.sort(key=order)
    gone.sort(key=order)
    # A dismissed domain with no appearances in the latest checks is still listed, so it can be restored.
    for domain, at in dismissed.items():
        if domain not in seen:
            gone.append({"domain": domain, "display": store.to_display_host(domain), "keywords": 0, "dismissed_at": _iso(at), "evidence": []})
    return {
        "keywords_total": keywords_total,
        "keywords_checked": len(checked),
        "keywords_waiting": max(0, keywords_total - len(checked)),
        "last_check": _iso(max((c.checked_at for c in checks), default=None)),
        "tools": sorted({c.tool for c in checks}),
        "engines": sorted({c.engine for c in checks}),
        "min_appearances": least,
        "run": latest_run(engine, site_id),
        "suggestions": suggested[:50],
        "platforms": platforms[:30],
        "dismissed": gone,
    }


def _clean_domain(value) -> str:
    """Suggestions are by root domain, so that's the spelling a decision about one is stored in."""
    domain = root_domain(store.to_ascii_host(hostname(value))) if isinstance(value, str) else ""
    if not domain:
        raise Refused("That doesn't look like a website's domain.")
    return domain


def queue_crawl(engine: Engine, competitor_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO competitor_crawls (competitor_id, status) VALUES (:c, 'queued') ON DUPLICATE KEY UPDATE status = IF(status = 'running', status, 'queued')"),
            {"c": competitor_id},
        )
    queue.enqueue(engine, "crawl", "competitors.crawl", payload={"competitor_id": competitor_id}, dedupe_key=f"competitor:{competitor_id}", max_attempts=2)


def add_competitor(engine: Engine, site_id: int, address: str, source: str = "manual", is_allowed=None, refresh_pairs: bool = True) -> dict:
    """Links a competitor to my site. Its row in `sites` is shared if another of my sites already watches it."""
    from seo.competitors import pairs

    raw = address.strip() if isinstance(address, str) else ""
    if not raw:
        raise Refused("Enter the competitor's address.")
    url = raw if "://" in raw else f"https://{raw}"
    scheme, rest = url.split("://", 1)
    # "a@b.example" and "mailto:a@b.example" would read as a login on b.example, and ftp:// isn't a website.
    if scheme.lower() not in ("http", "https") or "@" in rest.split("/", 1)[0]:
        raise Refused("That doesn't look like a website address.")
    host = store.host_and_domain(url)[0]
    with engine.connect() as conn:
        require_own(conn, site_id)
        for (own_host,) in conn.execute(text("SELECT host FROM sites WHERE kind = 'own'")):
            if store.on_host(host, own_host) or store.on_host(own_host, host):
                raise Refused(f"{store.to_display_host(host)} is part of your own websites, so it can't be a competitor.")
        # A site may be stored in either spelling of an accented host, so look for both.
        row = conn.execute(text("SELECT id, host FROM sites WHERE host IN (:a, :d)"), {"a": host, "d": store.to_display_host(host)}).mappings().first()
    if row:
        competitor_id, host = row["id"], row["host"]
    else:
        kwargs = {"is_allowed": is_allowed} if is_allowed else {}
        competitor_id = sites.add_site(engine, f"https://{host}/", sites.COMPETITOR, **kwargs)["id"]
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM site_competitors WHERE site_id = :s AND competitor_id = :c"), {"s": site_id, "c": competitor_id}).first():
            raise Conflict(f"{store.to_display_host(host)} is already one of this website's competitors.")
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source) VALUES (:s, :c, :o)"), {"s": site_id, "c": competitor_id, "o": source})
        conn.execute(text("DELETE FROM competitor_dismissals WHERE site_id = :s AND domain = :d"), {"s": site_id, "d": domain_of(host)})
    queue_crawl(engine, competitor_id)
    logos.queue_for(engine, [domain_of(host)])
    if refresh_pairs:
        pairs.refresh_auto_pairs(engine, site_id)
    return {"id": competitor_id, "host": host, "source": source}


MANY_AT_MOST = 200


def split_addresses(value) -> list[str]:
    """A pasted list: one per line, or separated by commas, semicolons, tabs or spaces. Repeats are dropped, first one kept."""
    parts = value if isinstance(value, list) else re.split(r"[\s,;]+", value if isinstance(value, str) else "")
    out, seen = [], set()
    for part in parts:
        item = part.strip().strip("\"'<>") if isinstance(part, str) else ""
        key = item.lower().split("://", 1)[-1].split("/", 1)[0].removeprefix("www.")  # one site, whichever of its pages was pasted
        if item and key not in seen:
            seen.add(key)
            out.append(item)
    return out


def add_many(engine: Engine, site_id: int, addresses, is_allowed=None) -> dict:
    """Adds each address the way one is added by hand. One bad address doesn't stop the others; each says why it wasn't added."""
    from seo.competitors import pairs

    items = split_addresses(addresses)
    if not items:
        raise Refused("Enter at least one competitor's address.")
    if len(items) > MANY_AT_MOST:
        raise Refused(f"Add up to {MANY_AT_MOST} competitors at a time. This list has {len(items)}.")
    with engine.connect() as conn:
        require_own(conn, site_id)
    added, already, refused = [], [], []
    for item in items:
        try:
            added.append(add_competitor(engine, site_id, item, "manual", is_allowed, refresh_pairs=False))
        except Conflict as err:
            already.append({"address": item, "reason": str(err)})
        except Refused as err:
            refused.append({"address": item, "reason": str(err)})
    if added:
        pairs.refresh_auto_pairs(engine, site_id)
    return {"added": added, "already": already, "refused": refused}


def accept(engine: Engine, site_id: int, domain: str, is_allowed=None) -> dict:
    return add_competitor(engine, site_id, _clean_domain(domain), "suggested", is_allowed)


def dismiss(engine: Engine, site_id: int, domain: str) -> None:
    clean = _clean_domain(domain)
    with engine.begin() as conn:
        require_own(conn, site_id)
        conn.execute(text("INSERT IGNORE INTO competitor_dismissals (site_id, domain) VALUES (:s, :d)"), {"s": site_id, "d": clean})


def restore(engine: Engine, site_id: int, domain: str) -> None:
    clean = _clean_domain(domain)
    with engine.begin() as conn:
        require_own(conn, site_id)
        conn.execute(text("DELETE FROM competitor_dismissals WHERE site_id = :s AND domain = :d"), {"s": site_id, "d": clean})


def remove_competitor(engine: Engine, site_id: int, competitor_id: int) -> None:
    """Stops watching for this site. Its data stays, because another site may watch it and it may be added back."""
    with engine.begin() as conn:
        require_own(conn, site_id)
        done = conn.execute(text("DELETE FROM site_competitors WHERE site_id = :s AND competitor_id = :c"), {"s": site_id, "c": competitor_id}).rowcount
        if not done:
            raise NotFound("That competitor isn't on this website.")
        conn.execute(text("DELETE FROM page_pairs WHERE site_id = :s AND competitor_id = :c"), {"s": site_id, "c": competitor_id})
