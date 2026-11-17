"""A competitor's profile tabs (Pages, Activity, Their site), built from what's already collected. Nothing here calls out.

Facts only, never advice. Anything not measured is None, never 0, so the screen shows a dash: my own site is only
partly read (the pages paired with theirs), so my side stays None until it has pages.

When a page appeared: the date it states (datePublished), else the Wayback Machine's first copy, else the day the
daily read reported it as new. When it was last updated: the date it states (dateModified), the last change the app
saw, or its sitemap date when the sitemap's dates mean something (under half the pages share one date).
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit

from sqlalchemy import Engine, bindparam, text

from seo.competitors import history, pairs, quality, tracking
from seo.competitors.keywords import _iso, require_own
from seo.competitors.pages import fold
from seo.competitors.suggest import domain_of, my_domains
from seo.crawl import pagedates
from seo.insights import words as topic_words
from seo.serp import store

MONTHS = 12
BEST_PAGES = 500  # the profile pages them 25 at a time (2026-11-10), so the list isn't cut at one screen
SECTIONS = 12
QUESTION_PAGES = 300  # pages with questions sent to the screen, the closest to my topics first; the profile pages them
TOPIC_DAYS = 90  # my Search Console searches of this many days say what my site is about
TOPIC_SEARCHES = 3000
BIG_VOCABULARY = 1000  # words counted across my searches, keywords and titles
EVERYWHERE = 0.3  # a word in more than this share of their questions is their whole site's subject, not a topic
_LISTING_PATH = re.compile(r"/(author|auteur|autor|tag|tags|etiquette|category|categorie|categories|page|search|recherche|feed|amp|wp-json)(/|$)|/(19|20)\d{2}(/\d{1,2})?/?$", re.I)
_LISTING_QUERY = re.compile(r"(^|&)(s|q|page|paged|p|cat|tag)=", re.I)
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
    """ISO and the other forms sites write ("May 26, 2020, 11:26:50 AM", "26 mai 2020"): one reader, seo.crawl.pagedates (W7)."""
    return pagedates.page_day(value)


def _pages(conn, host: str) -> list[dict]:
    """Pages read and still there. A page that's gone isn't one of theirs any more."""
    rows = conn.execute(
        text(
            f"SELECT {_PAGE_COLUMNS}, (SELECT MIN(e.detected_at) FROM change_events e WHERE e.page_id = p.id AND e.kind = 'new_page' AND e.hidden = 0) AS reported_new "
            "FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w) AND p.content_hash IS NOT NULL AND (p.last_status IS NULL OR p.last_status NOT IN ('gone', 'moved'))"
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
                f"WHERE d.host IN (:h, :w) AND e.kind = :k AND e.hidden = 0 AND e.detected_at > UTC_TIMESTAMP(3) - INTERVAL {int(days)} DAY"
            ),
            {"h": host, "w": f"www.{host}", "k": kind},
        )
    ]


# ---- facts ----------------------------------------------------------------------------------------

def _moz(conn, host: str) -> dict:
    row = conn.execute(
        text("SELECT domain_authority, popularity, linking_domains FROM moz_metrics WHERE target IN (:h, :d) ORDER BY (target = :h) DESC LIMIT 1"),
        {"h": host, "d": domain_of(host)},
    ).mappings().first()
    return dict(row) if row else {"domain_authority": None, "popularity": None, "linking_domains": None}


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
        "moz_links": moz["linking_domains"], "my_moz_links": my_moz["linking_domains"],  # Moz's count, shown when no CSV of their links exists
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

EDIT_SKIP = ("new_page", "page_gone")  # a page coming or going isn't an edit


def _edits_by_month(conn, host: str, keys: list[str]) -> tuple[list[int], str | None, int]:
    """Pages edited per month over the chart's months, the day the app first saw any change on that site, and how many
    different pages were edited over those months. Pages, not change rows: one rewrite saves a title, a meta and a text
    change, and is still one page edited (SEO review 2026-11-17, #11)."""
    where = "WHERE d.host IN (:h, :w) AND e.hidden = 0 AND e.kind NOT IN :skip AND e.detected_at >= :start"
    args = {"h": host, "w": f"www.{host}", "skip": list(EDIT_SKIP), "start": f"{keys[0]}-01"}
    rows = conn.execute(
        text(
            "SELECT DATE_FORMAT(e.detected_at, '%Y-%m') AS ym, COUNT(DISTINCT e.page_id) AS n FROM change_events e JOIN domains d ON d.id = e.domain_id "
            f"{where} GROUP BY ym"
        ).bindparams(bindparam("skip", expanding=True)),
        args,
    ).all()
    pages = conn.execute(
        text(f"SELECT COUNT(DISTINCT e.page_id) FROM change_events e JOIN domains d ON d.id = e.domain_id {where}").bindparams(bindparam("skip", expanding=True)), args,
    ).scalar()
    counts = {ym: int(n) for ym, n in rows}
    first = conn.execute(
        text("SELECT MIN(e.detected_at) FROM change_events e JOIN domains d ON d.id = e.domain_id WHERE d.host IN (:h, :w) AND e.hidden = 0"),
        {"h": host, "w": f"www.{host}"},
    ).scalar()
    return [counts.get(key, 0) for key in keys], first.date().isoformat() if first else None, int(pages or 0)


def _rhythm(conn, host: str, my_host: str, theirs: list[dict], mine: list[dict], by_year: dict) -> dict:
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
    their_edits, edits_since, their_pages = _edits_by_month(conn, host, keys)
    my_edits, my_edits_since, my_pages = _edits_by_month(conn, my_host, keys) if mine else ([None] * MONTHS, None, None)
    # Published in the last 30 days by the pages' own dates, else the day the app reported them new (W10): "They
    # published N pages in 30 days" counted only pages seen new since watching began.
    month_ago = today - timedelta(days=30)
    new_urls = [p["url"] for p in theirs if p["appeared"] and p["appeared"] >= month_ago]
    sections = Counter(_section(url) for url in new_urls)
    year_ago = today - timedelta(days=365)

    def updated_share(pages):
        # Among pages with an update date. A page with none isn't "not updated": nobody knows.
        dated = [p for p in pages if p["updated"]]
        return round(sum(1 for p in dated if p["updated"] >= year_ago) / len(dated), 3) if dated else None

    return {
        "months": [{"month": key, "theirs": t, "mine": m} for key, t, m in zip(keys, their_months, my_months)],
        # Edits to pages they already had, by the month the app saw them. Only counted since the app started watching.
        "edits": [{"month": key, "theirs": t, "mine": m} for key, t, m in zip(keys, their_edits, my_edits)],
        "edits_since": {"theirs": edits_since, "mine": my_edits_since},
        "edited_pages": {"theirs": their_pages, "mine": my_pages},  # different pages, so a page edited in two months counts once
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


def _is_listing(url: str) -> bool:
    """An author, tag, category, date or results page: its headings are other posts' titles, not questions it answers."""
    parts = urlsplit(url or "")
    if _LISTING_QUERY.search(parts.query or ""):
        return True
    return bool(_LISTING_PATH.search(parts.path or "/")) or topic_words.is_home(url)


def _h1(page: dict) -> str:
    for heading in page["headings"] or []:
        if isinstance(heading, (list, tuple)) and len(heading) == 2 and str(heading[0]).lower() == "h1":
            return str(heading[1])
    return page["title"] or ""


def _topic_counts(conn, site_id: int, mine: list[dict]) -> Counter:
    """In how many of my searches, keywords and page titles each word appears: what my site is about, in its visitors' words."""
    since = datetime.now(timezone.utc).date() - timedelta(days=TOPIC_DAYS)
    texts = [row[0] for row in conn.execute(
        text("SELECT query FROM gsc_query WHERE site_id = :s AND day >= :d GROUP BY query_hash, query ORDER BY SUM(impressions) DESC LIMIT :n"),
        {"s": site_id, "d": since, "n": TOPIC_SEARCHES},
    )]
    texts += [row[0] for row in conn.execute(
        text("SELECT k.keyword FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s"), {"s": site_id}
    )]
    texts += [_h1(p) for p in mine]
    counts: Counter = Counter()
    for item in texts:
        counts.update(set(topic_words.tokens(item)))
    return counts


def _questions(conn, site_id: int, theirs: list[dict], mine: list[dict]) -> dict:
    """Their questions, grouped by the page that answers them, those closest to my topics first.

    A question on a listing page (author, tag, home…) is the title of another post: it's moved to that post when the
    app read it, and dropped when it didn't. A question I already ask in a heading is left out. A word that's in most of
    their questions ("dubai" on a Dubai blog) says nothing about the topic, so it doesn't count as a match."""
    asked = {fold(q) for p in mine for q in (p["extras"].get("questions") or []) if isinstance(q, str)}
    by_h1 = {}
    for page in theirs:
        if not _is_listing(page["url"]):
            by_h1.setdefault(fold(_h1(page)).strip(" ?"), page)
    found: dict[str, dict] = {}  # folded question → {text, page}
    dropped = 0
    for page in sorted(theirs, key=lambda p: (_is_listing(p["url"]), p["url"])):  # a real page claims a question before a listing does
        listing = _is_listing(page["url"])
        for question in page["extras"].get("questions") or []:
            if not isinstance(question, str):
                continue
            key = fold(question).strip()
            if not key or key in asked or key in found:
                continue
            owner = by_h1.get(key.strip(" ?"))
            if owner is None and listing:
                dropped += 1
                continue
            found[key] = {"text": question, "page": owner or page}
    if not found:
        return {"groups": [], "total": 0, "related": 0, "judged": False, "dropped": dropped}

    mine_counts = _topic_counts(conn, site_id, mine)
    judged = bool(mine_counts)
    their_counts: Counter = Counter()
    for item in found.values():
        item["words"] = topic_words.tokens(item["text"])
        their_counts.update(set(item["words"]))
    everywhere = {w for w, n in their_counts.items() if len(found) >= 10 and n > EVERYWHERE * len(found)}
    # On a big list, a word in one search only is noise; a small site has few searches, so each one counts.
    least = 2 if sum(mine_counts.values()) > BIG_VOCABULARY else 1
    topics = {w for w, n in mine_counts.items() if n >= least and w not in everywhere}
    stems = {w[: topic_words.PREFIX] for w in topics if len(w) >= topic_words.PREFIX}  # topic_words.same, as two set lookups

    def score(words) -> int:
        return sum(1 for w in words if w not in everywhere and (w in topics or (len(w) >= topic_words.PREFIX and w[: topic_words.PREFIX] in stems)))

    groups: dict[str, dict] = {}
    for item in found.values():
        page = item["page"]
        group = groups.setdefault(page["url"], {"url": page["url"], "title": _h1(page) or page["title"], "questions": [], "score": 0})
        if fold(item["text"]).strip(" ?") == fold(group["title"] or "").strip(" ?"):
            # The page's own title: shown once, as the row's name, never again as one of its questions.
            group["score"] = max(group["score"], score(item["words"]) if judged else 0)
            group["own"] = item["text"]
            continue
        points = score(item["words"]) if judged else 0
        group["questions"].append({"text": item["text"], "score": points})
        group["score"] = max(group["score"], points)
    out = list(groups.values())
    for group in out:
        own = group.pop("own", None)
        if own and not group["questions"]:  # a page that is the answer to one question: that question is its row
            group["questions"].append({"text": own, "score": group["score"]})
        group["questions"].sort(key=lambda q: -q["score"])
        group["related"] = group["score"] > 0
        # Only the related questions are offered on a related page: the rest of it is another topic.
        if group["related"]:
            group["other"] = [q["text"] for q in group["questions"] if q["score"] == 0]
            group["questions"] = [q["text"] for q in group["questions"] if q["score"] > 0]
        else:
            group["other"] = []
            group["questions"] = [q["text"] for q in group["questions"]]
    out.sort(key=lambda g: (not g["related"], -g["score"], -len(g["questions"]), g["url"]))
    out = out[:QUESTION_PAGES]
    return {
        "groups": out,
        "total": sum(len(g["questions"]) + len(g["other"]) for g in out),
        "related": sum(len(g["questions"]) for g in out if g["related"]),
        "judged": judged,
        "dropped": dropped,
    }


def _stem(word: str) -> str:
    return word[: topic_words.PREFIX] if len(word) >= topic_words.PREFIX else word


def _my_questions(page: dict) -> list[str]:
    own = fold(_h1(page)).strip(" ?")
    return [q for q in page["extras"].get("questions") or [] if isinstance(q, str) and fold(q).strip(" ?") != own]


def _closest_page(title: str, candidates: list[tuple[dict, set[str]]], common: set[str]) -> dict | None:
    """My page whose main heading shares the most words with theirs. Two shared words at least: one word alone ("visa") is too loose to call it the same subject."""
    wanted = {_stem(w) for w in topic_words.tokens(title or "")} - common
    best, most = None, 1
    for page, words in candidates:
        shared = len(wanted & words)
        if shared > most:
            best, most = page, shared
    return best


def _attach_my_pages(conn, site_id: int, competitor_id: int, groups: list[dict], best: list[dict], mine: list[dict]) -> None:
    """Beside each page of theirs, the page of mine it's compared with, and the questions that page asks.

    In order: the pair saved in Page vs page, then my page ranking for the same keyword, then my page with the closest main heading.
    "how" says which, so a guess never reads as a fact. None when nothing of mine is close."""
    if not groups:
        return
    paired = {
        history.page_key(row["their_url"]): row["my_url"]
        for row in conn.execute(
            text("SELECT my_url, their_url FROM page_pairs WHERE site_id = :s AND competitor_id = :c AND hidden = 0"), {"s": site_id, "c": competitor_id}
        ).mappings()
    }
    ranked = {history.page_key(row["url"]): row["my_url"] for row in best if row.get("my_url")}
    read = {history.page_key(p["url"]): p for p in mine}
    candidates = [(p, {_stem(w) for w in topic_words.tokens(_h1(p))}) for p in mine if not _is_listing(p["url"])]
    counts: Counter = Counter(w for _, words in candidates for w in words)
    common = {w for w, n in counts.items() if len(candidates) >= 10 and n > EVERYWHERE * len(candidates)}  # a city's name on a site about that city says nothing
    candidates = [(p, words - common) for p, words in candidates]
    for group in groups:
        key = history.page_key(group["url"])
        url, how = (paired[key], "paired") if key in paired else (ranked[key], "keyword") if key in ranked else (None, None)
        page = read.get(history.page_key(url)) if url else _closest_page(group["title"], candidates, common)
        if url is None and page is not None:
            url, how = page["url"], "topic"
        group["mine"] = None if url is None else {
            "url": url, "how": how, "read": page is not None,
            "title": (_h1(page) or page["title"]) if page else None,
            "questions": _my_questions(page) if page else [],
        }


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
        if found is None or not found.url:  # Google didn't give that page's address: it can't count for any page of theirs
            continue
        key = history.page_key(found.url)
        row = by_url.setdefault(key, {"url": found.url, "title": titles.get(key) or found.title or None, "keywords": 0, "best_position": found.position, "my_url": None, "my_title": None, "pair_id": None})
        row["keywords"] += 1
        row["best_position"] = min(row["best_position"], found.position)
        if mine is not None and mine.url and row["my_url"] is None:
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
        if found is not None and found.url:  # a result with no address is no page at all, never "another page"
            urls[check.keyword].add(history.page_key(found.url))
    return {keyword: len(found) for keyword, found in urls.items() if len(found) > 1}


# ---- their site -----------------------------------------------------------------------------------

def _links(conn, site_id: int, competitor_id: int, host: str) -> dict:
    mine = my_domains(conn)
    decisions = dict(conn.execute(text("SELECT domain, decision FROM link_gap_overrides WHERE site_id = :s"), {"s": site_id}).all())
    rows = conn.execute(
        text(
            "SELECT r.domain, r.authority, r.authority_label, r.spam_score, r.source_label, r.in_common_crawl, d.quality, d.reason FROM competitor_referrers r "
            "LEFT JOIN link_domains d ON d.domain = r.domain "
            "WHERE r.competitor_id = :c AND r.removed_by_hand = 0"
        ),
        {"c": competitor_id},
    ).mappings().all()
    rows = [r for r in rows if r["domain"] not in mine and r["domain"] != domain_of(host)]
    logged = conn.execute(text("SELECT domain, status FROM backlinks WHERE site_id = :s"), {"s": site_id}).all()
    linking_me = {domain for domain, status in logged if status in ("live", "found")}

    def spam(row) -> bool:
        return quality.verdict(row["spam_score"], row["quality"], row["reason"], decisions.get(row["domain"]))[0] == quality.SPAM

    top = sorted(rows, key=lambda r: (spam(r), -(r["authority"] if r["authority"] is not None else -1), r["domain"]))[:TOP_LINKS]
    flagged = sum(1 for r in rows if spam(r))
    sources = sorted({"Common Crawl" if r["in_common_crawl"] and not r["source_label"] else r["source_label"] or "Common Crawl" for r in rows})
    # Spam never counts: five spam domains made a rival "Ahead" (SEO review 2026-11-17, #11). It's said apart, as "+5 flagged".
    # My number comes from my Backlinks list, theirs from their files or Common Crawl: two sources, so the screen names both and
    # calls no winner (`same_source` false).
    return {
        "linking_domains": len(rows) - flagged if rows else None,
        "linking_flagged": flagged,
        "linking_sources": sources,
        "my_linking_domains": len(linking_me) if logged else None,
        "my_linking_source": "Backlinks",
        "same_source": False,
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
        ("words", "Words per page", "number", lambda ps: _average(p["word_count"] for p in ps), False),
        ("title", "Title length", "number", lambda ps: _average(len(p["title"]) for p in ps if p["title"]), False),
        ("meta", "With a meta description", "share", lambda ps: _share(ps, lambda p: bool((p["meta_description"] or "").strip())), False),
        ("schema", "Structured data", "list", _schema_shares, False),
        ("questions", "With questions in headings", "share", lambda ps: _share(ps, lambda p: bool(p["extras"].get("questions"))), False),
        ("videos", "With a video", "share", lambda ps: _share(ps, lambda p: int(p["extras"].get("videos") or 0) > 0), False),
        ("dupes", "Duplicate titles", "number", _shared_titles, False),
        ("noindex", "Hidden (noindex)", "number", lambda ps: sum(1 for p in ps if "noindex" in (p["robots_meta"] or "").lower()) if ps else None, False),
        ("alt", "Images without alt text", "share", _missing_alt, True),
        ("internal", "Internal links per page", "number", lambda ps: _average(p["internal_links"] for p in ps), True),
        ("hreflang", "Languages (hreflang)", "list", lambda ps: sorted({code for p in ps for code in (p["extras"].get("hreflang") or [])})[:8] if ps else None, True),
        ("tables", "With a table", "share", lambda ps: _share(ps, lambda p: int(p["extras"].get("tables") or 0) > 0), True),
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
        mine_read = conn.execute(text("SELECT status, finished_at, message FROM competitor_crawls WHERE competitor_id = :s"), {"s": site_id}).mappings().first()
        facts["my_reading"] = None if mine_read is None else {"status": mine_read["status"], "read_once": mine_read["finished_at"] is not None}
        past = history.state(conn, host) or {}
        rhythm = _rhythm(conn, host, my_host, theirs, mine, past.get("pages_by_year"))
        questions = _questions(conn, site_id, theirs, mine)
        links = _links(conn, site_id, competitor_id, host) if setting != tracking.OFF else {"linking_domains": None, "linking_flagged": 0, "linking_sources": [], "my_linking_domains": None, "my_linking_source": "Backlinks", "same_source": False, "not_to_me": 0, "top": []}
        best, cannibal = [], {}
        if setting == tracking.ON:  # keyword numbers only for a competitor that's followed
            best = _best_pages(conn, site_id, competitor_id, my_host, host, store.latest_checks(engine, site_id), theirs)
        _attach_my_pages(conn, site_id, competitor_id, questions["groups"], best, mine)
    if setting == tracking.ON:
        cannibal = _cannibal(store.history(engine, site_id), host)
    return {
        "facts": facts,
        "best_pages": best,
        "sections": _sections(theirs, mine),
        "questions": questions,
        "rhythm": rhythm,
        "links": links,
        "build": _build(theirs, mine),
        "keywords": {"features": {}, "cannibal": cannibal},  # search features aren't saved from any tool yet, so they stay silent
    }
