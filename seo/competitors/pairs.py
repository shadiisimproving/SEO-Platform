"""My page against a competitor's page.

The app picks pairs from who ranks for the same keywords. A pair someone changes is marked manual
and is never overwritten after that: refresh_auto_pairs() only ever touches its own rows.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

from sqlalchemy import Engine, text

from seo.competitors import pages
from seo.competitors.keywords import _iso, require_own
from seo.core.errors import Conflict, NotFound, Refused
from seo.links.urls import normalize_url, page_key
from seo.serp import store

TERM_MIN_LENGTH = 3
MAX_TERMS = 25


def _competitor(conn, site_id: int, competitor_id) -> dict:
    if type(competitor_id) is not int:
        raise Refused("competitor_id must be a number.")
    row = conn.execute(
        text("SELECT s.id, s.host FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s AND sc.competitor_id = :c"),
        {"s": site_id, "c": competitor_id},
    ).mappings().first()
    if row is None:
        raise NotFound("Competitor not found.")
    return dict(row)


def _competitors(conn, site_id: int) -> list[dict]:
    # Automatic pairs come from shared keywords, so only competitors whose keywords are followed get new ones.
    rows = conn.execute(text("SELECT s.id, s.host FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s AND sc.tracking = 'on'"), {"s": site_id}).mappings().all()
    return [dict(r) for r in rows]


def _page_id(url: str) -> str:
    """What makes two addresses the same page: no www, no scheme, one spelling of an accented host."""
    return page_key(store.canonical_url(url))


def _shared_count(checks, my_url: str, their_url: str) -> int:
    """Keywords where both pages show up in the latest results. A pair someone chose has no other count."""
    wanted = {_page_id(my_url), _page_id(their_url)}
    return len({check.keyword_id for check in checks if wanted <= {_page_id(r.url) for r in check.results}})


def refresh_auto_pairs(engine: Engine, site_id: int) -> int:
    """Pick, for each of my pages, the page each competitor ranks with most often beside it."""
    with engine.connect() as conn:
        site = require_own(conn, site_id)
        competitors = _competitors(conn, site_id)
    if not competitors:
        return 0
    checks = store.latest_checks(engine, site_id)
    written = 0
    for competitor in competitors:
        together: dict[str, dict[str, set[int]]] = defaultdict(lambda: defaultdict(set))
        their_best: dict[str, int] = {}
        # Both sites on the page, but Google didn't give one of the addresses: those pairs can't be judged, so none goes.
        kept: set[str] = set()  # my pages beside a page of theirs with no address
        mine_unnamed = False  # a page of mine with no address: it may be any of them
        for check in checks:
            mine = check.best_on(site["host"])
            theirs = check.best_on(competitor["host"])
            if mine is None or theirs is None:
                continue
            my_url, their_url = store.canonical_url(mine.url), store.canonical_url(theirs.url)
            if my_url and their_url:
                together[my_url][their_url].add(check.keyword_id)  # by keyword: one seen on two engines is still one
                their_best[their_url] = min(their_best.get(their_url, 999), theirs.position)
            elif my_url:
                kept.add(pages.url_hash(my_url))
            else:
                mine_unnamed = True
        with engine.begin() as conn:
            live_hashes = set()
            for my_url, counts in together.items():
                their_url, keywords = sorted(counts.items(), key=lambda kv: (-len(kv[1]), their_best[kv[0]], kv[0]))[0]
                shared = len(keywords)
                hashed = pages.url_hash(my_url)
                live_hashes.add(hashed)
                written += conn.execute(
                    text(
                        "INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, source, shared_keywords) "
                        "VALUES (:s, :c, :m, :h, :t, 'auto', :n) ON DUPLICATE KEY UPDATE "
                        "their_url = IF(source = 'manual', their_url, VALUES(their_url)), "
                        "shared_keywords = IF(source = 'manual', shared_keywords, VALUES(shared_keywords)), "
                        "updated_at = IF(source = 'manual', updated_at, UTC_TIMESTAMP(3))"
                    ),
                    {"s": site_id, "c": competitor["id"], "m": my_url, "h": hashed, "t": their_url, "n": shared},
                ).rowcount
            # Automatic pairs that no longer share a keyword go. Manual ones always stay.
            rows = conn.execute(
                text("SELECT id, my_url_hash FROM page_pairs WHERE site_id = :s AND competitor_id = :c AND source = 'auto'"),
                {"s": site_id, "c": competitor["id"]},
            ).mappings().all()
            for row in rows:
                if row["my_url_hash"] not in live_hashes and row["my_url_hash"] not in kept and not mine_unnamed:
                    conn.execute(text("DELETE FROM page_pairs WHERE id = :i"), {"i": row["id"]})
            # A manual pair keeps its pages. Only its count follows the rankings.
            mine_chosen = conn.execute(
                text("SELECT id, my_url, their_url FROM page_pairs WHERE site_id = :s AND competitor_id = :c AND source = 'manual'"),
                {"s": site_id, "c": competitor["id"]},
            ).mappings().all()
            for row in mine_chosen:
                conn.execute(text("UPDATE page_pairs SET shared_keywords = :n WHERE id = :i"), {"n": _shared_count(checks, row["my_url"], row["their_url"]), "i": row["id"]})
    return written


def _pair_row(conn, pair_id: int) -> dict:
    row = conn.execute(
        text(
            "SELECT p.*, me.host AS my_host, them.host AS their_host FROM page_pairs p JOIN sites me ON me.id = p.site_id "
            "JOIN sites them ON them.id = p.competitor_id WHERE p.id = :i"
        ),
        {"i": pair_id},
    ).mappings().first()
    if row is None:
        raise NotFound("That pair doesn't exist.")
    return dict(row)


def _side_state(page: dict | None) -> str:
    """read if we hold the page and its last answer didn't say otherwise. Otherwise that answer: gone, blocked, robots."""
    status = page["last_status"] if page else None
    if status in (None, "ok", "not_modified"):
        return "read" if page and page["content_hash"] else "not_read"
    return status


def ranking_summary(checks, my_url: str, their_url: str) -> dict:
    """Who ranks higher, in the latest check of each keyword. Both positions always come from the same check."""
    my_key, their_key = _page_id(my_url), _page_id(their_url)
    my_host, their_host = store.host_and_domain(my_url)[0], store.host_and_domain(their_url)[0]
    keywords, gaps = [], []
    they_ahead = i_ahead = level = only_mine = only_theirs = not_known = 0
    for check in store.one_per_keyword(checks):  # a keyword checked on two engines is one keyword, and its positions aren't averaged across them
        mine = next((r for r in check.results if _page_id(r.url) == my_key), None)
        theirs = next((r for r in check.results if _page_id(r.url) == their_key), None)
        if mine is None and theirs is None:
            continue
        if (mine is None and check.unnamed_on(my_host)) or (theirs is None and check.unnamed_on(their_host)):
            not_known += 1  # Google gave a page of that site without its address: it may be this one, so nothing is said
            continue
        if mine is not None and theirs is not None:
            gaps.append(mine.position - theirs.position)
            if theirs.position < mine.position:
                they_ahead += 1
            elif mine.position < theirs.position:
                i_ahead += 1
            else:
                level += 1
        elif mine is not None:
            only_mine += 1
        else:
            only_theirs += 1
        # Which tool measured both positions, and when: one check gives both, so You and Them are always comparable (2026-11-12).
        # check_id lets the screen tell, and say, if a row ever holds two checks.
        keywords.append({"keyword": check.keyword, "my_position": mine.position if mine else None, "their_position": theirs.position if theirs else None, "depth": check.depth,
                         "engine": check.engine, "tool": getattr(check, "tool", None), "checked_at": _iso(getattr(check, "checked_at", None)), "check_id": getattr(check, "id", None)})
    # Those both pages rank for come first, biggest gap first: they say the most about this pair.
    keywords.sort(key=lambda k: (k["my_position"] is None or k["their_position"] is None, -abs((k["my_position"] or 0) - (k["their_position"] or 0)), k["keyword"]))
    return {
        "shared": len(gaps), "they_ahead": they_ahead, "i_ahead": i_ahead, "level": level, "only_mine": only_mine, "only_theirs": only_theirs,
        "not_known": not_known, "gap": round(sum(gaps) / len(gaps), 1) if gaps else None, "keywords": keywords[:5], "keywords_total": len(keywords),
    }


def _page_facts(page: dict | None) -> dict | None:
    """The few numbers a list can show. None until the page has been read."""
    if page is None or not page["content_hash"]:
        return None
    as_list = lambda v: v if isinstance(v, list) else json.loads(v or "[]")  # noqa: E731
    return {
        "words": page["word_count"] or 0, "headings": len(as_list(page["headings"])) + len(as_list(page["h1"])),
        "schema_types": as_list(page["schema_types"]), "js_only": bool(page["js_only"]),
    }


def _pair_dict(conn, row: dict, checks=None, loaded: dict | None = None) -> dict:
    if loaded is None:
        loaded = pages.load_many(conn, [row["my_url"], row["their_url"]])
    my_page, their_page = loaded.get(row["my_url"]), loaded.get(row["their_url"])
    return {
        "ranking": ranking_summary(checks, row["my_url"], row["their_url"]) if checks is not None else None,
        "my_facts": _page_facts(my_page), "their_facts": _page_facts(their_page),
        "id": row["id"], "site_id": row["site_id"], "competitor_id": row["competitor_id"], "competitor": row["their_host"],
        "my_url": row["my_url"], "their_url": row["their_url"], "source": row["source"], "hidden": bool(row["hidden"]),
        "shared_keywords": row["shared_keywords"], "updated_at": _iso(row["updated_at"]),
        "my_title": (my_page or {}).get("title") or "", "their_title": (their_page or {}).get("title") or "",
        "my_state": _side_state(my_page), "their_state": _side_state(their_page),
    }


def list_pairs(engine: Engine, site_id: int, competitor_id: int | None = None, include_hidden: bool = False) -> list[dict]:
    with engine.connect() as conn:
        require_own(conn, site_id)
    checks = store.latest_checks(engine, site_id)
    with engine.connect() as conn:
        require_own(conn, site_id)
        clause = "AND p.competitor_id = :c" if competitor_id else ""
        shown = "" if include_hidden else "AND p.hidden = 0"
        rows = conn.execute(
            text(
                "SELECT p.*, me.host AS my_host, them.host AS their_host FROM page_pairs p JOIN sites me ON me.id = p.site_id "
                f"JOIN sites them ON them.id = p.competitor_id WHERE p.site_id = :s {shown} {clause} "
                "ORDER BY p.source = 'manual' DESC, p.shared_keywords DESC, p.my_url"
            ),
            {"s": site_id, "c": competitor_id},
        ).mappings().all()
        loaded = pages.load_many(conn, [u for r in rows for u in (r["my_url"], r["their_url"])])  # every pair's pages at once (F77)
        return [_pair_dict(conn, dict(r), checks, loaded) for r in rows]


def create_pair(engine: Engine, site_id: int, competitor_id: int, my_url: str, their_url: str) -> dict:
    with engine.begin() as conn:
        site = require_own(conn, site_id)
        competitor = _competitor(conn, site_id, competitor_id)
        mine, theirs = pages.clean_page_url(my_url, site["host"]), pages.clean_page_url(their_url, competitor["host"])
        hashed = pages.url_hash(mine)
        conn.execute(
            text(
                "INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, source, hidden) VALUES (:s, :c, :m, :h, :t, 'manual', 0) "
                "ON DUPLICATE KEY UPDATE their_url = VALUES(their_url), source = 'manual', hidden = 0, updated_at = UTC_TIMESTAMP(3)"
            ),
            {"s": site_id, "c": competitor_id, "m": mine, "h": hashed, "t": theirs},
        )
        pair_id = conn.execute(text("SELECT id FROM page_pairs WHERE site_id = :s AND competitor_id = :c AND my_url_hash = :h"), {"s": site_id, "c": competitor_id, "h": hashed}).scalar_one()
    _recount(engine, pair_id)
    queue_reads(engine, pair_id)
    return pair_detail(engine, pair_id)


def update_pair(engine: Engine, pair_id: int, my_url=None, their_url=None, hidden=None) -> dict:
    """Any change makes the pair mine: later rankings won't replace it."""
    if my_url is None and their_url is None and hidden is None:
        raise Refused("Say what to change: my_url, their_url or hidden.")
    if hidden is not None and type(hidden) is not bool:
        raise Refused("hidden must be true or false.")
    with engine.begin() as conn:
        row = _pair_row(conn, pair_id)
        mine = pages.clean_page_url(my_url, row["my_host"]) if my_url is not None else row["my_url"]
        theirs = pages.clean_page_url(their_url, row["their_host"]) if their_url is not None else row["their_url"]
        hashed = pages.url_hash(mine)
        # One pair per page of mine and competitor. A hidden one gives way. A visible one is the pair to change instead.
        twin = conn.execute(
            text("SELECT id, hidden FROM page_pairs WHERE site_id = :s AND competitor_id = :c AND my_url_hash = :h AND id <> :i"),
            {"s": row["site_id"], "c": row["competitor_id"], "h": hashed, "i": pair_id},
        ).mappings().first()
        if twin and not twin["hidden"]:
            raise Conflict("You already compare that page with this competitor. Change that pair instead.")
        if twin:
            conn.execute(text("DELETE FROM page_pairs WHERE id = :i"), {"i": twin["id"]})
        conn.execute(
            text("UPDATE page_pairs SET my_url = :m, my_url_hash = :h, their_url = :t, hidden = :v, source = 'manual', updated_at = UTC_TIMESTAMP(3) WHERE id = :i"),
            {"m": mine, "h": hashed, "t": theirs, "v": bool(row["hidden"]) if hidden is None else hidden, "i": pair_id},
        )
    if my_url is not None or their_url is not None:  # hiding a pair has no reason to visit anyone's site
        _recount(engine, pair_id)
        queue_reads(engine, pair_id)
    return pair_detail(engine, pair_id)


def _recount(engine: Engine, pair_id: int) -> None:
    with engine.connect() as conn:
        row = _pair_row(conn, pair_id)
    count = _shared_count(store.latest_checks(engine, row["site_id"]), row["my_url"], row["their_url"])
    with engine.begin() as conn:
        conn.execute(text("UPDATE page_pairs SET shared_keywords = :n WHERE id = :i"), {"n": count, "i": pair_id})


def back_to_automatic(engine: Engine, pair_id: int) -> dict:
    with engine.begin() as conn:
        row = _pair_row(conn, pair_id)
        conn.execute(text("UPDATE page_pairs SET source = 'auto', hidden = 0, shared_keywords = 0 WHERE id = :i"), {"i": pair_id})
    refresh_auto_pairs(engine, row["site_id"])
    with engine.connect() as conn:
        still = conn.execute(text("SELECT id FROM page_pairs WHERE id = :i"), {"i": pair_id}).scalar()
    return pair_detail(engine, still) if still else {"removed": True}


def queue_reads(engine: Engine, pair_id: int) -> None:
    with engine.connect() as conn:
        row = _pair_row(conn, pair_id)
    pages.queue_read(engine, row["site_id"], row["my_url"])
    pages.queue_read(engine, row["competitor_id"], row["their_url"])


def page_options(engine: Engine, site_id: int) -> list[dict]:
    """Pages we know on a site: read by the crawler, or seen in search results."""
    with engine.connect() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :i"), {"i": site_id}).scalar()
        if not host:
            raise NotFound("That website doesn't exist.")
        found: dict[str, str] = {}
        for row in conn.execute(
            text("SELECT p.url, p.title FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host = :h AND p.content_hash IS NOT NULL ORDER BY p.url LIMIT 500"),
            {"h": host},
        ).mappings():
            found[row["url"]] = row["title"] or ""
        for row in conn.execute(
            text("SELECT DISTINCT r.url, r.title FROM serp_results r WHERE r.host = :h OR r.host LIKE :sub LIMIT 500"),
            {"h": store.to_ascii_host(host), "sub": f"%.{store.to_ascii_host(host)}"},
        ).mappings():
            normal = store.canonical_url(row["url"])
            if normal:
                found.setdefault(normal, row["title"] or "")
    return [{"url": url, "title": title} for url, title in sorted(found.items())]


def _side(conn, url: str) -> dict:
    page = pages.load(conn, url)
    if page is None or not page["content_hash"]:
        return {"url": url, "state": _side_state(page), "http_status": (page or {}).get("http_status"), "last_checked_at": _iso((page or {}).get("last_checked_at"))}
    extras = page["extras"] if isinstance(page["extras"], dict) else json.loads(page["extras"] or "{}")
    as_list = lambda v: v if isinstance(v, list) else json.loads(v or "[]")  # noqa: E731
    body = pages.page_text(conn, page["id"])
    canonical = page["canonical"] or ""
    return {
        "url": url, "state": "read", "http_status": page["http_status"], "last_status": page["last_status"], "last_checked_at": _iso(page["last_checked_at"]),
        "last_changed_at": _iso(page["last_changed_at"]), "title": page["title"] or "", "title_length": len(page["title"] or ""),
        "meta_description": page["meta_description"] or "", "meta_length": len(page["meta_description"] or ""),
        "h1": as_list(page["h1"]), "headings": as_list(page["headings"]), "word_count": page["word_count"] or 0,
        "characters": extras.get("characters", len(body)), "lang": page["lang"] or "", "canonical": canonical,
        "canonical_elsewhere": bool(canonical and normalize_url(canonical) and normalize_url(canonical) != normalize_url(url)),
        "robots_meta": page["robots_meta"] or "", "noindex": "noindex" in (page["robots_meta"] or "").lower(),
        "schema_types": as_list(page["schema_types"]), "internal_links": page["internal_links"] or 0, "external_links": page["external_links"] or 0,
        "images": extras.get("images", 0), "images_no_alt": extras.get("images_no_alt", 0), "tables": extras.get("tables", 0), "lists": extras.get("lists", 0),
        "videos": extras.get("videos", 0), "forms": extras.get("forms", 0), "questions": extras.get("questions", []), "hreflang": extras.get("hreflang", []),
        "published": extras.get("published"), "modified": extras.get("modified"), "js_only": bool(page["js_only"]), "_text": body,
    }


def _heading_texts(side: dict) -> list[str]:
    return [*side.get("h1", []), *[h[1] for h in side.get("headings", [])]]


def _missing_terms(theirs: dict, mine: dict) -> list[dict]:
    """Words in their headings that appear nowhere on my page, most used first. No word lists, so any language works."""
    my_text = mine.get("_text", "") + " " + mine.get("title", "") + " " + " ".join(_heading_texts(mine))
    my_words = set(pages.words_of(my_text))
    counts: Counter = Counter()
    for heading in _heading_texts(theirs):
        for word in set(pages.words_of(heading)):
            if len(word) < TERM_MIN_LENGTH or word.isdigit() or word in my_words:
                continue
            if pages.has_no_spaces(word) and pages.contains_phrase(my_text, word):  # with no spaces, it can sit inside a longer run of my text
                continue
            counts[word] += 1
    return [{"term": word, "headings": n} for word, n in counts.most_common(MAX_TERMS)]


def _only_in(a: dict, b: dict) -> list[str]:
    other = {pages.fold(h).strip() for h in _heading_texts(b)}
    return [h for h in _heading_texts(a) if pages.fold(h).strip() not in other][:50]


def _keyword_rows(engine: Engine, row: dict, my_side: dict, their_side: dict) -> list[dict]:
    rows = []
    my_key, their_key = _page_id(row["my_url"]), _page_id(row["their_url"])
    for check in store.latest_checks(engine, row["site_id"]):
        mine = next((r for r in check.results if _page_id(r.url) == my_key), None)
        theirs = next((r for r in check.results if _page_id(r.url) == their_key), None)
        if mine is None and theirs is None:
            continue
        keyword = check.keyword
        captured = check.ai_state != "not_captured"  # no AI data is "not captured", never "not cited"
        # This page may be missing while another page of the same site ranks. Saying so stops ">10" reading as "the site isn't there".
        # An "other" with an empty address is a page of that site whose address Google didn't give: it may be this very page,
        # so the side is unknown (my_unknown, their_unknown), never "only theirs".
        my_other = check.best_on(row["my_host"]) if mine is None else None
        their_other = check.best_on(row["their_host"]) if theirs is None else None
        rows.append({
            "keyword": keyword, "engine": check.engine, "tool": check.tool, "location": check.real_location, "depth": check.depth,
            "checked_at": _iso(check.checked_at), "my_position": mine.position if mine else None, "their_position": theirs.position if theirs else None,
            "my_other": {"url": my_other.url, "position": my_other.position} if my_other else None,
            "their_other": {"url": their_other.url, "position": their_other.position} if their_other else None,
            "my_unknown": mine is None and check.unnamed_on(row["my_host"]), "their_unknown": theirs is None and check.unnamed_on(row["their_host"]),
            "ai_state": check.ai_state,
            "ai_cites_me": any(_page_id(c.url) == my_key for c in check.citations) if captured else None,
            "ai_cites_them": any(_page_id(c.url) == their_key for c in check.citations) if captured else None,
            "mine": _keyword_use(my_side, keyword), "theirs": _keyword_use(their_side, keyword),
        })
    return sorted(rows, key=lambda r: (r["their_position"] is None or r["my_position"] is None, r["keyword"]))


def _keyword_use(side: dict, keyword: str) -> dict | None:
    if side.get("state") != "read":
        return None
    return {
        "title": pages.contains_phrase(side.get("title", ""), keyword),
        "h1": any(pages.contains_phrase(h, keyword) for h in side.get("h1", [])),
        "headings": sum(1 for h in side.get("headings", []) if pages.contains_phrase(h[1], keyword)),
        "meta": pages.contains_phrase(side.get("meta_description", ""), keyword),
        "body": pages.contains_phrase(side.get("_text", ""), keyword),
    }


def pair_detail(engine: Engine, pair_id: int) -> dict:
    with engine.connect() as conn:
        row = _pair_row(conn, pair_id)
    checks = store.latest_checks(engine, row["site_id"])
    with engine.connect() as conn:
        summary = _pair_dict(conn, row, checks)
        mine, theirs = _side(conn, row["my_url"]), _side(conn, row["their_url"])
    both_read = mine["state"] == "read" and theirs["state"] == "read"
    keywords = _keyword_rows(engine, row, mine, theirs)
    same_language = not (mine.get("lang") and theirs.get("lang")) or mine["lang"][:2].lower() == theirs["lang"][:2].lower()
    detail = {
        **summary,
        "mine": {k: v for k, v in mine.items() if k != "_text"},
        "theirs": {k: v for k, v in theirs.items() if k != "_text"},
        "keywords": keywords,
        "same_language": same_language,
        "terms_they_use": _missing_terms(theirs, mine) if both_read and same_language else [],
        "terms_i_use": _missing_terms(mine, theirs) if both_read and same_language else [],
        "headings_only_theirs": _only_in(theirs, mine) if both_read else [],
        "headings_only_mine": _only_in(mine, theirs) if both_read else [],
    }
    return detail


__all__ = ["refresh_auto_pairs", "list_pairs", "create_pair", "update_pair", "back_to_automatic", "pair_detail", "page_options", "queue_reads"]
