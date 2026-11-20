"""The backlinks built for my sites: one or many at a time, with every column of the template kept.

What comes in is a spreadsheet's cells, so nothing is trusted: each text has a length limit, a cell that looks like a
formula stays text, and a price is read into a number with what was typed kept beside it, because the currency matters.

design/mockups/bulk-links.js is the browser copy of the status words, limits and price reading.
tests/test_backlinks_service.py checks that both give the same result.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable

from sqlalchemy import Engine, bindparam, text

from seo.backlinks import ahrefs, anchors, cleaner, indexed, logos, mediators, source_index
from seo.competitors.keywords import _iso, require_own
from seo.core.errors import NotFound, Refused
from seo.links.urls import page_key
from seo.serp import store

log = logging.getLogger(__name__)

MAX_ROWS = 5000
NOT_LISTED_DAYS = 60  # Search Console's links lag weeks and are a sample, so a link newer than this isn't missing from them yet
TOO_MANY = "At most 5,000 rows per upload. Split the file and try again."
MAX_ADDRESS = 2048
MAX_DOMAIN = 190
MAX_COST = Decimal("9999999999.99")
# The longest each text can be. Every column has room for this, plus the apostrophe in front of a formula.
LIMITS = {
    "target_url": 2048, "anchor": 1000, "link_type": 100, "placed": 60, "due": 60, "renewal": 60, "price_text": 60, "mediator": 180,
    "contact": 250, "platform": 180, "utm_source": 180, "utm_medium": 180, "utm_campaign": 180, "owner": 100, "notes": 5000, "keyword": 250,
    "billed_text": 60,  # Bought links: what we were billed; price_text stays what it really cost
}
WORDS = {
    "target_url": "Target page", "anchor": "Anchor text", "link_type": "Link type", "placed": "Date placed", "due": "Due date", "renewal": "Renewal date", "price_text": "Price", "mediator": "Mediator",
    "contact": "Contact", "platform": "Platform", "utm_source": "UTM source", "utm_medium": "UTM medium", "utm_campaign": "UTM campaign", "owner": "Owner", "notes": "Notes", "keyword": "Keyword",
    "billed_text": "Billed",
}
LIVE, LOST, PLANNED, FOUND, IGNORED = "live", "lost", "planned", "found", "ignored"
STATUSES = (LIVE, LOST, PLANNED, FOUND)
NOT_LOGGED = (FOUND, IGNORED)  # seen by a tool, but nobody has logged it. Ignored ones are kept, and can come back.
STATUS_WORDS = {
    "": LIVE, "live": LIVE, "active": LIVE, "actif": LIVE, "en ligne": LIVE,
    "lost": LOST, "perdu": LOST, "perdue": LOST,
    "planned": PLANNED, "pending": PLANNED, "prevu": PLANNED, "prevue": PLANNED, "en attente": PLANNED,
    "found": FOUND,
}
# An anchor type set by hand, in the words people use, English or French. Empty or "automatic" lets the app work it out from the anchor text.
# design/mockups/bulk-links.js has the browser's copy.
ANCHOR_KINDS = (anchors.BRAND, anchors.BRAND_KW, anchors.URL, anchors.EXACT, anchors.PARTIAL, anchors.GENERIC, anchors.OTHER)
ANCHOR_WORDS = {
    "": None, "auto": None, "automatic": None, "automatique": None,
    "brand": anchors.BRAND, "branding": anchors.BRAND, "brand name": anchors.BRAND, "marque": anchors.BRAND, "nom de marque": anchors.BRAND,
    "url": anchors.URL, "bare url": anchors.URL, "naked url": anchors.URL, "url nue": anchors.URL, "adresse": anchors.URL,
    "exact": anchors.EXACT, "exact keyword": anchors.EXACT, "exact match": anchors.EXACT, "optimisee": anchors.EXACT, "optimise": anchors.EXACT, "mot cle exact": anchors.EXACT,
    "partial": anchors.PARTIAL, "partial keyword": anchors.PARTIAL, "partial match": anchors.PARTIAL, "semi optimisee": anchors.PARTIAL, "semi optimise": anchors.PARTIAL, "partielle": anchors.PARTIAL,
    "generic": anchors.GENERIC, "generique": anchors.GENERIC,
    "other": anchors.OTHER, "autre": anchors.OTHER,
    "brand kw": anchors.BRAND_KW, "brand keyword": anchors.BRAND_KW, "exact match domain": anchors.BRAND_KW, "marque mot cle": anchors.BRAND_KW,
}
# How often the links check reads a live link (seo/backlinks/live.py): weekly when someone pays for it, else monthly (links F2).
CHECK_EVERY_DAYS, PAID_CHECK_EVERY_DAYS = 30, 7
ROW_FIELDS = {"site_id", "source_url", "status", "cost", "anchor_kind", *LIMITS}
# The two rows in templates/backlinks-template.csv. Left in by mistake, they must never count as real links.
EXAMPLE_SOURCES = ("https://example-blog.example/article", "https://example-directory.example/listing/123")

# Phase 5 sets this: site ID to {backlink ID: {"visits", "leads", "label", "shared"}}. Until then visits and leads stay unknown, never 0.
traffic_provider: Callable[[Engine, int], dict[int, dict]] | None = None

_COLUMNS = ("site_id", "source_url", "domain", "status", "cost", "billed", "anchor_kind", *LIMITS)
_INSERT = text(f"INSERT INTO backlinks ({', '.join(_COLUMNS)}) VALUES ({', '.join(f':{c}' for c in _COLUMNS)})")
_UPDATE = text(f"UPDATE backlinks SET {', '.join(f'{c} = :{c}' for c in _COLUMNS)} WHERE id = :id")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_NUMBER_OR_PHONE = re.compile(r"^[+-]?[\d\s().,]*$")
_WEB_ADDRESS = re.compile(r"^https?://", re.IGNORECASE)
_MONEY_MARK = r"(?:us\$|usd|\$|dollars?|aed|dirhams?|dhs?|د\.إ\.?|euros?|eur|€|gbp|£)"
_MARK_FIRST = re.compile(rf"^{_MONEY_MARK}\s*")
_MARK_LAST = re.compile(rf"\s*{_MONEY_MARK}$")
_GROUPED = re.compile(r"^\d{1,3}(?:[\s']\d{3})+(?:[.,]\d+)?$")
_THOUSANDS = {",": re.compile(r"^\d{1,3}(?:,\d{3})*$"), ".": re.compile(r"^\d{1,3}(?:\.\d{3})*$")}


def parse_price(raw) -> Decimal | None:
    """The number in a price however it's typed: 1 500, 1,500, 1.500,50, $150, 150 €, AED 500. None if there isn't one."""
    value = _MARK_LAST.sub("", _MARK_FIRST.sub("", str(raw if raw is not None else "").strip().lower())).strip()
    if _GROUPED.match(value):
        value = re.sub(r"[\s']", "", value)
    if not re.fullmatch(r"\d[\d.,]*", value):
        return None
    number = _plain_number(value)
    if number is None:
        return None
    amount = Decimal(number).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return amount if amount <= MAX_COST else None


def _plain_number(value: str) -> str | None:
    commas, dots = value.count(","), value.count(".")
    if commas and dots:  # the last one is the decimal mark, the other groups thousands: 1.500,50 or 1,500.50
        mark = "," if value.rfind(",") > value.rfind(".") else "."
        other = "." if mark == "," else ","
        whole, _, part = value.rpartition(mark)
        return f"{whole.replace(other, '')}.{part}" if part and _THOUSANDS[other].match(whole) else None
    if not commas and not dots:
        return value
    mark = "," if commas else "."
    if value.count(mark) > 1:  # 1,500,000
        return value.replace(mark, "") if _THOUSANDS[mark].match(value) else None
    whole, part = value.split(mark)
    if len(part) == 3 and len(whole) <= 3 and not whole.startswith("0"):  # 1,500 and 1.500 are thousands: nobody prices in tenths of a cent
        return whole + part
    return f"{whole}.{part}" if part else None


def source_key(url: str) -> str:
    """One page, however it's spelled: http or https, www or not, a trailing slash, tracking parameters."""
    return page_key(store.canonical_url(url)).rstrip("/")


_EXAMPLE_KEYS = frozenset(source_key(address) for address in EXAMPLE_SOURCES)


def _plain_word(word) -> str:
    bare = unicodedata.normalize("NFD", str(word if word is not None else ""))
    return " ".join("".join(ch for ch in bare if not unicodedata.combining(ch)).casefold().split())


def _short(address) -> str:
    shown = str(address).strip()
    return shown if len(shown) <= 120 else f"{shown[:117]}..."


def _as_text(row: dict, field: str, name: str) -> str | None:
    value = row.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise Refused(f"{name}: {WORDS[field]} must be text.")
    clean = _CONTROL.sub("", str(value)).strip()
    if not clean:
        return None
    if len(clean) > LIMITS[field]:
        raise Refused(f"{name}: {WORDS[field]} is too long. The limit is {LIMITS[field]:,} characters.")
    # A spreadsheet would run these as formulas. The apostrophe makes it show them as text. A phone number isn't one.
    if len(clean) > 1 and clean[0] in "=+-@" and not _NUMBER_OR_PHONE.match(clean):
        return f"'{clean}"
    return clean


def _clean_row(row) -> dict:
    if not isinstance(row, dict):
        raise Refused("Each row must have a site and a source page.")
    site_id = row.get("site_id")
    if type(site_id) is not int:
        raise Refused("site_id must be a number.")
    extra = sorted(set(row) - ROW_FIELDS)
    if extra:
        raise Refused(f"Only {', '.join(sorted(ROW_FIELDS))} are accepted. This row also sent: {', '.join(extra)}.")
    source = row.get("source_url")
    if not isinstance(source, str) or not source.strip():
        raise Refused("Every row needs a source page.")
    address = cleaner.full_url(_CONTROL.sub("", source))
    name = _short(address)
    domain = store.host_and_domain(address)[1] if _WEB_ADDRESS.match(address) and not re.search(r"\s", address) else ""
    key = source_key(address) if domain else ""
    if not key or not cleaner.root_domain(domain) or len(domain) > MAX_DOMAIN:
        raise Refused(f"{name}: Not a web address.")
    if len(address) > MAX_ADDRESS:
        raise Refused(f"{name}: That web address is too long.")
    if key in _EXAMPLE_KEYS:
        raise Refused(f"{name}: Example row: delete it")
    status = STATUS_WORDS.get(_plain_word(row.get("status")))
    if status is None:
        raise Refused(f"{name}: The status {_short(row.get('status'))} isn't known. Use Live, Lost or Planned.")
    anchor_kind = anchor_kind_of(row.get("anchor_kind"))
    if anchor_kind is False:
        raise Refused(f"{name}: The anchor type {_short(row.get('anchor_kind'))} isn't known. Use Brand, Brand + keyword, Bare URL, Exact keyword, Partial keyword, Generic or Other.")
    clean = {"site_id": site_id, "source_url": address, "domain": domain, "status": status, "key": key, "anchor_kind": anchor_kind}
    clean.update({field: _as_text(row, field, name) for field in LIMITS})
    clean["cost"] = _cost_of(row, clean["price_text"], name)
    clean["billed"] = parse_price(clean["billed_text"]) if clean["billed_text"] else None
    return clean


def anchor_kind_of(value) -> str | None | bool:
    """The anchor type a cell names, None for "work it out", or False when the word isn't known."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, str):
        return False
    return ANCHOR_WORDS.get(anchors.clean(value), False)


def _cost_of(row: dict, price_text: str | None, name: str) -> Decimal | None:
    if price_text:
        return parse_price(price_text)
    given = row.get("cost")
    if given is None:
        return None
    cost = parse_price(given) if isinstance(given, (int, float, str)) and not isinstance(given, bool) else None
    if cost is None:
        raise Refused(f"{name}: The cost must be a number.")
    return cost


def _own_and_locked(conn, rows: list[dict]) -> None:
    """Refuses a competitor's site or an unknown one. Each site stays locked until this upload ends, so two uploads at once can't save one page twice."""
    for site_id in sorted({row["site_id"] for row in rows}):
        try:
            require_own(conn, site_id)
        except Refused as err:
            first = next(row for row in rows if row["site_id"] == site_id)
            raise type(err)(f"{_short(first['source_url'])}: {err}") from None
        conn.execute(text("SELECT id FROM sites WHERE id = :s FOR UPDATE"), {"s": site_id})


def save_many(engine: Engine, rows) -> dict:
    """All or nothing for a refused row. A page already logged for that site is skipped, and said so."""
    if not isinstance(rows, list) or not rows:
        raise Refused("Send at least one row.")
    if len(rows) > MAX_ROWS:
        raise Refused(TOO_MANY)
    clean = [_clean_row(row) for row in rows]
    saved_ids: list[int] = []
    skipped: list[dict] = []
    removed: list[int] = []
    no_longer_prospects: set[tuple[int, str]] = set()
    with engine.begin() as conn:
        _own_and_locked(conn, clean)
        known = {}
        for site_id in {row["site_id"] for row in clean}:
            for found in conn.execute(text("SELECT id, source_url, status FROM backlinks WHERE site_id = :s ORDER BY id"), {"s": site_id}).mappings():
                known.setdefault((site_id, source_key(found["source_url"])), found)
        here: set[tuple[int, str]] = set()
        for row in clean:
            spot = (row["site_id"], row["key"])
            already = known.get(spot)
            if spot in here or (already is not None and already["status"] not in NOT_LOGGED):
                skipped.append({"site_id": row["site_id"], "source_url": row["source_url"], "why": "Twice in this file" if spot in here else "Already logged"})
                continue
            here.add(spot)
            if row["status"] != LOST:  # a lost link is still worth getting back, so it stays where it is
                no_longer_prospects.add((row["site_id"], row["domain"]))
            values = {column: row[column] for column in _COLUMNS}
            if already is None:
                saved_ids.append(conn.execute(_INSERT, values).lastrowid)
            else:  # seen but never logged: now it's a real link, and this is the same row
                conn.execute(_UPDATE, {**values, "id": already["id"]})
                saved_ids.append(already["id"])
        for site_id, domain in sorted(no_longer_prospects):
            _keep_what_the_prospect_knew(conn, site_id, domain)
            removed += _remove_prospects(conn, site_id, domain)
        mediators.ensure_from_rows(conn, [row for row in clean if row["mediator"]])
        answer = _rows_by_id(conn, saved_ids)
    _ask_for_icons(engine, {row["domain"] for row in answer})
    return {"saved": answer, "skipped": skipped, "prospects_removed": removed}


def _keep_what_the_prospect_knew(conn, site_id: int, domain: str) -> None:
    """Placing a link mustn't lose the authority and spam score the file gave for that site."""
    conn.execute(text(
        "UPDATE backlinks b JOIN prospects p ON p.site_id = b.site_id AND p.domain = b.domain "
        "SET b.authority = COALESCE(b.authority, p.authority), b.authority_label = COALESCE(b.authority_label, p.authority_label), "
        "b.spam_score = COALESCE(b.spam_score, p.spam_score), b.page_authority = COALESCE(b.page_authority, p.page_authority), "
        "b.rating = COALESCE(b.rating, p.rating) WHERE b.site_id = :s AND b.domain = :d"
    ), {"s": site_id, "d": domain})


def _remove_prospects(conn, site_id: int, domain: str) -> list[int]:
    ids = [found[0] for found in conn.execute(text("SELECT id FROM prospects WHERE site_id = :s AND domain = :d"), {"s": site_id, "d": domain})]
    if ids:
        conn.execute(text("DELETE FROM prospects WHERE site_id = :s AND domain = :d"), {"s": site_id, "d": domain})
    return ids


def rows_by_id(conn, ids: list[int]) -> list[dict]:
    return _rows_by_id(conn, ids)


def mediator_fields(row) -> dict:
    """What a mediator's own record can learn from one link."""
    return {field: row[field] for field in ("mediator", "contact", "platform", "price_text")}


def _rows_by_id(conn, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    query = text("SELECT * FROM backlinks WHERE id IN :ids").bindparams(bindparam("ids", expanding=True))
    found = {row["id"]: _as_dict(row) for row in conn.execute(query, {"ids": ids}).mappings()}
    return [found[backlink_id] for backlink_id in ids]


def _ask_for_icons(engine: Engine, domains: set[str]) -> None:
    """The links are already saved. A website's icon is only a nicety, so a problem asking for one can't undo that."""
    if not domains:
        return
    try:
        logos.queue_for(engine, sorted(domains))
    except Exception:  # noqa: BLE001 - see above
        log.exception("Couldn't ask for the icons of %d websites", len(domains))


def _as_dict(row) -> dict:
    return {
        "id": row["id"], "site_id": row["site_id"], "source_url": row["source_url"], "domain": row["domain"], "status": row["status"],
        **{field: row[field] for field in LIMITS}, "anchor_kind": row["anchor_kind"],
        "cost": float(row["cost"]) if row["cost"] is not None else None, "billed": float(row["billed"]) if row["billed"] is not None else None, "created_at": _iso(row["created_at"]),
        "authority": row["authority"], "authority_label": row["authority_label"], "spam_score": row["spam_score"], "page_authority": row["page_authority"], "rating": row["rating"],
        "article_url": row["article_url"], "sent_at": _iso(row["sent_at"]),
        "check": {
            "checked_at": _iso(row["checked_at"]), "outcome": row["check_outcome"], "reason": row["check_reason"], "misses": row["miss_count"],
            "is_nofollow": None if row["is_nofollow"] is None else bool(row["is_nofollow"]), "rel": row["seen_rel"], "anchor": row["seen_anchor"], "href": row["seen_href"],
            "final_url": row["final_url"], "target_final_url": row["target_final_url"], "lost_at": _iso(row["lost_at"]),
            "verdict": row["seo_verdict"], "reasons": _json_list(row["seo_reasons"]), "page_lang": row["page_lang"], "target_lang": row["target_lang"],
            "outbound_links": row["outbound_links"], "target_http": row["target_http"],
            # False: the last reading found the link on another page of my site than the logged target (links F3).
            "to_target": None if row["to_target"] is None else bool(row["to_target"]),
            # Paid links (a price, a mediator, a renewal date) are read weekly, the others monthly (links F2).
            "every_days": PAID_CHECK_EVERY_DAYS if row["status"] == "live" and (row["cost"] or row["price_text"] or row["mediator"] or row["renewal"]) else CHECK_EVERY_DAYS,
        },
        "found_by": row["found_by"], "gsc": {"seen": row["gsc_seen"], "seen_at": _iso(row["gsc_seen_at"]), "crawled": row["gsc_crawled"]}, "disavow": bool(row["disavow"]),
    }


def _json_list(value) -> list:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def list_for_site(engine: Engine, site_id: int) -> list[dict]:
    # Asked before the connection below is taken: asking inside it held one connection while waiting for a second, so a few
    # requests at once each held one and waited 30 s for another, then answered 500 (the pool fault of 2026-11-10).
    ahrefs_on = ahrefs.connected(engine)
    with engine.connect() as conn:
        require_own(conn, site_id)
        rows = conn.execute(text(
            "SELECT b.*, (SELECT a.score FROM authority_monthly a WHERE a.domain = b.domain AND a.score IS NOT NULL ORDER BY a.month DESC LIMIT 1) AS opr_score "
            "FROM backlinks b WHERE b.site_id = :s ORDER BY b.id DESC"
        ), {"s": site_id}).mappings().all()
        last_gsc = conn.execute(text("SELECT MAX(imported_at) FROM gsc_link_imports WHERE site_id = :s AND kind = 'latest'"), {"s": site_id}).scalar()
        site = conn.execute(text("SELECT host, start_url FROM sites WHERE id = :s"), {"s": site_id}).mappings().first()
        start_url = site["start_url"]
        inspected = indexed.for_site(conn, site_id)
        brand, keywords = anchors.words_for_site(conn, site_id, site["host"])
        traffic_of = ahrefs.for_domains(conn, {r["domain"] for r in rows}) if ahrefs_on else {}
    answer = []
    for row in rows:
        item = _as_dict(row)
        # Open PageRank, 0 to 10, from the monthly collector. Shown with its name when the file gave no DA: scores from two tools don't compare.
        item["opr"] = round(float(row["opr_score"]), 1) if row["opr_score"] is not None else None
        item["gsc"]["not_listed"] = _not_listed(row, last_gsc)
        page = indexed.target_page(dict(row), start_url) if row["status"] == LIVE else None
        item["target_index"] = inspected.get(indexed.url_hash(page)) if page else None  # is my page indexed, from URL Inspection
        item["source_index"] = source_index.shown(row)  # is the linking page on Google
        if item["source_index"] and item["source_index"]["state"] == source_index.NOT_INDEXED and item["check"].get("verdict") in ("counts", "weak"):
            item["check"]["verdict"] = "none"  # a page Google doesn't have passes nothing, whatever its link says
            item["check"]["reasons"] = [*item["check"].get("reasons", []), "source_not_indexed"]
        # The anchor the link checker read on the page decides (SEO review 2026-11-17, B3): a typed anchor can be wrong, as on
        # lavoixdunord.fr, logged "Créer Société Dubai" and set to Brand while the page says "Always Improving". A type set by
        # hand only counts when nothing was read. The worked-out one stays beside it, so the screen can say which is which.
        read = (row["seen_anchor"] or "").strip() or None
        item["anchor_read"] = read
        item["anchor_auto"] = anchors.kind(read or row["anchor"], brand, keywords)
        item["anchor_by_hand"] = bool(row["anchor_kind"]) and read is None
        item["anchor_type"] = row["anchor_kind"] if item["anchor_by_hand"] else item["anchor_auto"]
        item["site_traffic"] = traffic_of.get(row["domain"])  # Ahrefs' monthly organic visits to the linking website, only with its key
        answer.append(item)
    traffic = traffic_provider(engine, site_id) if traffic_provider else {}
    for row in answer:
        found = traffic.get(row["id"])
        if found:
            row.update(visits=found.get("visits"), leads=found.get("leads"), traffic_label=found.get("label"), shared=found.get("shared"), traffic_group=found.get("group"))
    return answer


def site_facts(engine: Engine, site_id: int) -> dict:
    """What the Backlinks screen needs about my site itself: its language, and whether Google can be asked if its pages are indexed."""
    with engine.connect() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": site_id}).scalar()
        langs = [r[0] for r in conn.execute(text(
            "SELECT LOWER(LEFT(p.lang, 2)) AS l FROM pages p JOIN domains d ON d.id = p.domain_id "
            "WHERE d.host IN (:h, CONCAT('www.', :h)) AND p.lang IS NOT NULL AND p.lang <> '' GROUP BY l ORDER BY COUNT(*) DESC LIMIT 1"
        ), {"h": host})]
        if not langs:  # not crawled yet: the language the link checks read on my target pages
            langs = [r[0] for r in conn.execute(text(
                "SELECT LOWER(LEFT(target_lang, 2)) AS l FROM backlinks WHERE site_id = :s AND target_lang IS NOT NULL AND target_lang <> '' GROUP BY l ORDER BY COUNT(*) DESC LIMIT 1"
            ), {"s": site_id})]
    return {"lang": langs[0] if langs else None, "index_check": indexed.is_on(engine, site_id), "ahrefs": ahrefs.connected(engine), "site_search": source_index.can_search(engine)}


def _not_listed(row, last_gsc) -> bool:
    """A live link Google's latest list leaves out, though it was logged long enough before that list. Only a hint: the list is a sample."""
    if last_gsc is None or row["status"] != LIVE or row["gsc_seen"]:
        return False
    placed = row["placed"] if row["placed"] and re.match(r"^\d{4}-\d{2}-\d{2}", row["placed"]) else None
    start = date_from(placed) if placed else row["created_at"].date()
    return start is not None and (last_gsc.date() - start).days >= NOT_LISTED_DAYS


def date_from(value: str):
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def get_one(engine: Engine, backlink_id: int) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM backlinks WHERE id = :i"), {"i": backlink_id}).mappings().all()
    if not rows:
        raise NotFound("That backlink doesn't exist.")
    return _as_dict(rows[0])


def update_one(engine: Engine, backlink_id: int, row) -> dict:
    """Corrects a link already logged. Every field is checked as on upload, and it can't become a page already logged for that site."""
    clean = _clean_row(row)
    with engine.begin() as conn:
        _own_and_locked(conn, [clean])
        before = conn.execute(text("SELECT status, source_url, target_url FROM backlinks WHERE id = :i FOR UPDATE"), {"i": backlink_id}).mappings().first()
        if before is None:
            raise NotFound("That backlink doesn't exist.")
        others = conn.execute(text("SELECT id, source_url, status FROM backlinks WHERE site_id = :s AND id <> :i"), {"s": clean["site_id"], "i": backlink_id}).mappings().all()
        for other in others:
            if source_key(other["source_url"]) != clean["key"]:
                continue
            if other["status"] not in NOT_LOGGED:
                raise Refused(f"{_short(clean['source_url'])}: Already logged")
            conn.execute(text("DELETE FROM backlinks WHERE id = :i"), {"i": other["id"]})  # seen but never logged: it's this same link
        conn.execute(_UPDATE, {**{column: clean[column] for column in _COLUMNS}, "id": backlink_id})
        _note_status_change(conn, backlink_id, before["status"], clean["status"])
        if source_key(before["source_url"]) != clean["key"] or (before["target_url"] or "") != (clean["target_url"] or ""):
            _forget_what_was_read(conn, backlink_id)  # it was about another page, so it says nothing about this one
        mediators.ensure_from_rows(conn, [clean])
        if clean["status"] != LOST:
            _keep_what_the_prospect_knew(conn, clean["site_id"], clean["domain"])
        removed = _remove_prospects(conn, clean["site_id"], clean["domain"]) if clean["status"] != LOST else []
        answer = _rows_by_id(conn, [backlink_id])[0]
    _ask_for_icons(engine, {answer["domain"]})
    # The row as the list shows it: an edit to a note mustn't blank the visits, leads and index marks on screen (F113).
    full = next((item for item in list_for_site(engine, clean["site_id"]) if item["id"] == backlink_id), None)
    return {"saved": full or answer, "prospects_removed": removed}


def _note_status_change(conn, backlink_id: int, before: str, after: str) -> None:
    """When it was lost, for "lost this week". A link uploaded as already lost wasn't lost this week, so only a change counts."""
    if before != LOST and after == LOST:
        conn.execute(text("UPDATE backlinks SET lost_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": backlink_id})
    elif before == LOST and after != LOST:
        conn.execute(text("UPDATE backlinks SET lost_at = NULL, miss_count = 0 WHERE id = :i"), {"i": backlink_id})


def _forget_what_was_read(conn, backlink_id: int) -> None:
    conn.execute(
        text(
            "UPDATE backlinks SET checked_at = NULL, check_outcome = NULL, check_reason = NULL, is_nofollow = NULL, seen_rel = NULL, seen_anchor = NULL, "
            "seen_href = NULL, to_target = NULL, final_url = NULL, target_final_url = NULL, miss_count = 0, seo_verdict = NULL, seo_reasons = NULL, page_lang = NULL, target_lang = NULL, "
            "outbound_links = NULL, target_http = NULL, gsc_seen = NULL, gsc_seen_at = NULL, gsc_crawled = NULL, "
            "src_index = NULL, src_index_via = NULL, src_index_at = NULL, src_index_misses = 0 WHERE id = :i"
        ),
        {"i": backlink_id},
    )


def ignore_found(engine: Engine, backlink_id: int, ignored) -> dict:
    """A link a tool found that nobody wants logged. It's kept, leaves the count, and can be brought back."""
    if type(ignored) is not bool:
        raise Refused("Say whether to ignore this link.")
    with engine.begin() as conn:
        row = conn.execute(text("SELECT status FROM backlinks WHERE id = :i FOR UPDATE"), {"i": backlink_id}).mappings().first()
        if row is None:
            raise NotFound("That backlink doesn't exist.")
        if row["status"] not in NOT_LOGGED:
            raise Refused("Only tool-found links can be ignored; this one is logged.")
        conn.execute(text("UPDATE backlinks SET status = :s WHERE id = :i"), {"s": IGNORED if ignored else FOUND, "i": backlink_id})
        return _rows_by_id(conn, [backlink_id])[0]


def delete_one(engine: Engine, backlink_id: int) -> None:
    with engine.begin() as conn:
        if not conn.execute(text("DELETE FROM backlinks WHERE id = :i"), {"i": backlink_id}).rowcount:
            raise NotFound("That backlink doesn't exist.")


def log_one(engine: Engine, site_id: int, source_url: str, status: str = LIVE) -> dict:
    """One address and what state it's in. Logged again, it keeps its row and takes the new state: a lost link can come back."""
    if status not in STATUSES:
        raise Refused("A backlink's status is live, lost, planned or found.")
    answer = save_many(engine, [{"site_id": site_id, "source_url": source_url, "status": status}])
    if answer["saved"]:
        row = answer["saved"][0]
        return {"id": row["id"], "domain": row["domain"], "status": row["status"]}
    key = source_key(answer["skipped"][0]["source_url"])
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, source_url, domain, status FROM backlinks WHERE site_id = :s ORDER BY id"), {"s": site_id}).mappings().all()
        row = next(found for found in rows if source_key(found["source_url"]) == key)
        now = row["status"] if status == FOUND else status  # being seen again says nothing new about a link already logged
        conn.execute(text("UPDATE backlinks SET status = :st WHERE id = :i"), {"st": now, "i": row["id"]})
        _note_status_change(conn, row["id"], row["status"], now)
        if now != LOST:
            _remove_prospects(conn, site_id, row["domain"])
    return {"id": row["id"], "domain": row["domain"], "status": now}
