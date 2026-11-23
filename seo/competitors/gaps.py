"""Domains that link to my competitors but not to me.

Competitor backlinks with no paid data come from Common Crawl, which the Mac reads about every few months, and from
files: a SEMrush or Ubersuggest export. Nothing here calls a paid API. Spam is flagged, never removed (quality.py), and
only good domains can be added. Adding a gap makes a prospect, which never counts as a backlink until someone logs it.
"""
from __future__ import annotations

import hashlib
from urllib.parse import urlsplit

from sqlalchemy import Engine, bindparam, text

from seo.accounts import access
from seo.backlinks import cleaner, logos
from seo.backlinks import service as backlinks
from seo.competitors import pairs, quality
from seo.competitors.keywords import _iso, require_own
from seo.competitors.suggest import domain_of, my_domains, tracked_competitors
from seo.core.errors import NotFound, Refused
from seo.serp import store


GOOD, SPAM = quality.GOOD, quality.SPAM
MAX_LISTED = 2000  # Common Crawl can find tens of thousands of domains. The most useful come first.
MAX_FILTERED_LISTED = 2000  # flagged, not removed: they stay in the list
BY_HAND = "By hand"  # the source of a link someone ticked, read in a tool with no connection here
CC_HEADERS = ("Referring domain", "Common Crawl rank", "Common Crawl domains", "Outside links", "Hosts", "Common Crawl release")


def _rank(authority: int | None) -> int:
    return -1 if authority is None else authority


def import_referrers(engine: Engine, site_id: int, competitor_id: int, data: bytes, file_name: str) -> dict:
    with engine.connect() as conn:
        require_own(conn, site_id)
        pairs._competitor(conn, site_id, competitor_id)
    cleaner.check_upload(file_name, len(data))
    from_common_crawl = _read_common_crawl_file(data)
    if from_common_crawl is not None:
        rows, release = from_common_crawl
        report = import_common_crawl(engine, competitor_id, rows, release)
        return {"total": len(rows), "kept": len(rows), "removed": 0, "removed_spam": 0, "removed_no_url": 0, "domains": len(rows), "source_label": "Common Crawl", "unknown_spam": len(rows), "flagged": report["filtered"], **report}
    # Spam rows stay, marked by their score, so the screen can show what went and why. They can never be added.
    result = cleaner.clean_csv(data, need_spam=False, keep_spam=True)
    domains: dict[str, cleaner.KeptRow] = {}
    for row in result.rows:
        domain = store.to_ascii_host(row.domain)
        current = domains.get(domain)
        if current is None or _rank(row.authority) > _rank(current.authority):
            domains[domain] = row
    with engine.begin() as conn:
        for domain, row in domains.items():
            conn.execute(
                text(
                    "INSERT INTO competitor_referrers (competitor_id, domain, sample_url, authority, authority_label, spam_score, source_file, source_label) "
                    "VALUES (:c, :d, :u, :a, :l, :sp, :f, :sl) ON DUPLICATE KEY UPDATE sample_url = VALUES(sample_url), authority = VALUES(authority), "
                    "authority_label = VALUES(authority_label), spam_score = VALUES(spam_score), source_file = VALUES(source_file), source_label = VALUES(source_label), "
                    "last_seen_at = UTC_TIMESTAMP(3)"
                ),
                {"c": competitor_id, "d": domain[:190], "u": row.url, "a": row.authority, "l": result.authority_label, "sp": row.spam_score, "f": file_name[:255], "sl": result.source_label},
            )
    _save_links(engine, competitor_id, data, file_name, result.source_label)
    quality.note_domains(engine, [{"domain": domain} for domain in domains])
    # The file's score stays with the file (competitor_referrers): link_domains holds only what the app's own checks found.
    with engine.connect() as conn:
        system = {domain: conn.execute(text("SELECT quality, reason FROM link_domains WHERE domain = :d"), {"d": domain[:190]}).first() for domain in domains}
    flagged = sum(
        1 for domain, row in domains.items()
        if quality.verdict(row.spam_score, *(system[domain] or (None, None)))[0] == SPAM
    )
    quality.queue_checks(engine)
    return {
        "total": result.total, "kept": result.kept - result.removed_spam, "removed": result.removed, "removed_spam": result.removed_spam, "removed_no_url": result.removed_no_url,
        "domains": len(domains), "flagged": flagged, "source_label": result.source_label, "unknown_spam": result.unknown_spam,
    }


MAX_LINKS_PER_DOMAIN = 50  # the row lists the strongest; a forum can carry hundreds of links to one competitor


def _link_hash(link: dict) -> str:
    key = "\n".join((link["source_url"], link["target_url"] or "", link["anchor"] or ""))
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def _save_links(engine: Engine, competitor_id: int, data: bytes, file_name: str, source_label: str) -> int:
    """Every link in the file, with its anchor text and Page Authority. A link already saved gets the file's newer scores and dates."""
    links = cleaner.link_rows(data)
    rows = [
        {**link, "c": competitor_id, "d": store.to_ascii_host(link["domain"])[:190], "h": _link_hash(link), "f": file_name[:255], "sl": source_label}
        for link in links
    ]
    if not rows:
        return 0
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO competitor_referrer_links (competitor_id, domain, link_hash, source_url, source_title, target_url, anchor, authority, page_authority, spam_score, "
                "first_seen, last_seen, source_file, source_label) VALUES (:c, :d, :h, :source_url, :source_title, :target_url, :anchor, :authority, :page_authority, :spam_score, "
                ":first_seen, :last_seen, :f, :sl) ON DUPLICATE KEY UPDATE source_title = COALESCE(VALUES(source_title), source_title), authority = VALUES(authority), "
                "page_authority = VALUES(page_authority), spam_score = VALUES(spam_score), first_seen = COALESCE(LEAST(first_seen, VALUES(first_seen)), VALUES(first_seen), first_seen), "
                "last_seen = COALESCE(GREATEST(last_seen, VALUES(last_seen)), VALUES(last_seen), last_seen), source_file = VALUES(source_file), source_label = VALUES(source_label)"
            ),
            rows,
        )
    return len(rows)


def _links_by_domain(conn, site_id: int, removed: dict[str, list[int]]) -> dict[str, list[dict]]:
    """Each domain's links to the tracked competitors, strongest page first. A competitor someone untied from the domain brings none."""
    found: dict[str, list[dict]] = {}
    for row in conn.execute(
        text(
            "SELECT l.*, s.host FROM competitor_referrer_links l JOIN site_competitors sc ON sc.competitor_id = l.competitor_id AND sc.site_id = :s AND sc.tracking <> 'off' "
            "JOIN sites s ON s.id = l.competitor_id"
        ),
        {"s": site_id},
    ).mappings():
        if row["competitor_id"] in removed.get(row["domain"], ()):
            continue
        found.setdefault(row["domain"], []).append({
            "competitor_id": row["competitor_id"], "host": row["host"], "source_url": row["source_url"], "source_title": row["source_title"], "target_url": row["target_url"],
            "anchor": row["anchor"], "page_authority": row["page_authority"], "spam_score": row["spam_score"],
            "first_seen": row["first_seen"].isoformat() if row["first_seen"] else None, "last_seen": row["last_seen"].isoformat() if row["last_seen"] else None,
        })
    for links in found.values():
        links.sort(key=lambda l: (-(l["page_authority"] if l["page_authority"] is not None else -1), l["anchor"] or "", l["source_url"]))
    return found


def _read_common_crawl_file(data: bytes) -> tuple[list[dict], str] | None:
    """The file scripts/common_crawl_links.py writes, uploaded when the app is on hosting. None for any other file."""
    table, _ = cleaner.parse_table(cleaner.decode_csv(data))
    if not table or tuple(cell.strip() for cell in table[0]) != CC_HEADERS:
        return None
    number = lambda cell: int(cell) if cell.strip().isdigit() else None  # noqa: E731
    rows, release = [], "Common Crawl"
    for cells in table[1:]:
        if len(cells) < len(CC_HEADERS) or not cells[0].strip():
            continue
        rows.append({"domain": cells[0].strip().lower(), "rank": number(cells[1]), "total": number(cells[2]), "outlinks": number(cells[3]), "hosts": number(cells[4])})
        release = cells[5].strip() or release
    return rows, release


def import_common_crawl(engine: Engine, competitor_id: int, rows: list[dict], release: str) -> dict:
    """Rows have a domain, and its rank, the total, outlinks and hosts. A row from a file keeps what the file said."""
    clean = [{**row, "domain": store.to_ascii_host(row["domain"])[:190]} for row in rows]
    with engine.begin() as conn:
        for row in clean:
            conn.execute(
                text(
                    "INSERT INTO competitor_referrers (competitor_id, domain, source_file, source_label, in_common_crawl) VALUES (:c, :d, :f, 'Common Crawl', 1) "
                    "ON DUPLICATE KEY UPDATE in_common_crawl = 1, last_seen_at = UTC_TIMESTAMP(3)"
                ),
                {"c": competitor_id, "d": row["domain"], "f": release[:255]},
            )
        conn.execute(
            text("INSERT INTO competitor_common_crawl (competitor_id, release_name, domains) VALUES (:c, :r, :n) ON DUPLICATE KEY UPDATE release_name = :r, domains = :n, run_at = UTC_TIMESTAMP(3)"),
            {"c": competitor_id, "r": release[:60], "n": len(clean)},
        )
    quality.note_domains(engine, clean)
    quality.queue_checks(engine)
    with engine.connect() as conn:
        counts = dict(conn.execute(
            text("SELECT d.quality, COUNT(*) FROM competitor_referrers r JOIN link_domains d ON d.domain = r.domain WHERE r.competitor_id = :c AND r.in_common_crawl = 1 GROUP BY d.quality"),
            {"c": competitor_id},
        ).all())
    return {"domains": len(clean), "filtered": int(counts.get("spam", 0)), "to_check": int(counts.get("pending", 0))}


def _overrides(conn, site_id: int) -> dict[str, str]:
    return dict(conn.execute(text("SELECT domain, decision FROM link_gap_overrides WHERE site_id = :s"), {"s": site_id}).all())


def _top_percent(rank, total) -> float | None:
    if not rank or not total:
        return None
    share = rank / total * 100
    return max(0.01, round(share, 2)) if share < 1 else round(share)


def _with_edit(entry: dict, edit, removed: list[int]) -> dict:
    """What was typed by hand wins. What the files said stays beside it, so the panel can show what it replaced."""
    added = entry.pop("added_by_hand")
    typed_score = edit is not None and edit["authority"] is not None
    entry.update(auto_authority=entry["authority"], auto_authority_label=entry["authority_label"], authority_by_hand=typed_score, edit=None)
    if typed_score:
        entry["authority"], entry["authority_label"] = edit["authority"], edit["authority_label"]
    if edit is not None and edit["sample_url"]:
        entry["sample_url"] = edit["sample_url"]
    if edit is not None and (typed_score or edit["sample_url"] or added or removed):
        entry["edit"] = {
            "authority": edit["authority"], "authority_label": edit["authority_label"], "sample_url": edit["sample_url"],
            "by": edit["edited_by"], "at": _iso(edit["edited_at"]), "added": sorted(added), "removed": sorted(removed),
            "hand_only": len(added) == entry["competitor_count"] and not removed,  # only someone's typing keeps it on the list
        }
    return entry


def _all_gaps(engine: Engine, site_id: int) -> dict:
    with engine.connect() as conn:
        require_own(conn, site_id)
        mine = my_domains(conn)
        competitors = [c for c in tracked_competitors(conn, site_id) if c["tracking"] != "off"]
        logged = conn.execute(text("SELECT domain, status FROM backlinks WHERE site_id = :s"), {"s": site_id}).all()
        prospects = {row[0] for row in conn.execute(text("SELECT domain FROM prospects WHERE site_id = :s"), {"s": site_id})}
        decisions = _overrides(conn, site_id)
        crawls = {row["competitor_id"]: row for row in conn.execute(text("SELECT * FROM competitor_common_crawl")).mappings()}
        edits = {row["domain"]: row for row in conn.execute(text("SELECT * FROM link_domain_edits")).mappings()}
        removed: dict[str, list[int]] = {}
        for domain, competitor_id in conn.execute(
            text("SELECT r.domain, r.competitor_id FROM competitor_referrers r JOIN site_competitors sc ON sc.competitor_id = r.competitor_id AND sc.site_id = :s AND sc.tracking <> 'off' WHERE r.removed_by_hand = 1"),
            {"s": site_id},
        ).all():
            removed.setdefault(domain, []).append(competitor_id)
        rows = conn.execute(
            text(
                "SELECT r.*, s.host, d.quality, d.reason, d.page_note, d.page_title, d.cc_rank, d.cc_total, d.cc_outlinks FROM competitor_referrers r "
                "JOIN site_competitors sc ON sc.competitor_id = r.competitor_id AND sc.site_id = :s AND sc.tracking <> 'off' JOIN sites s ON s.id = r.competitor_id "
                "LEFT JOIN link_domains d ON d.domain = r.domain WHERE r.removed_by_hand = 0"
            ),
            {"s": site_id},
        ).mappings().all()
        links = _links_by_domain(conn, site_id, removed)
    # A domain can have several rows: a lost link and a new live one means it links to me. A planned link doesn't, yet.
    linking = {domain for domain, status in logged if status in ("live", "found")}
    typed_in = {row["domain"] for row in rows if row["source_label"] == BY_HAND}
    lost = {domain for domain, status in logged if status == "lost"} - linking
    planned = {domain for domain, status in logged if status == "planned"} - linking  # in Backlinks → To do, on its way to a mediator
    own_rivals = {domain_of(c["host"]) for c in competitors}
    by_domain: dict[str, dict] = {}
    already = set()  # domains, not rows: a domain can link to several competitors
    with_data, with_file = set(), set()
    for row in rows:
        with_data.add(row["competitor_id"])
        if row["source_label"] not in ("Common Crawl", BY_HAND):
            with_file.add(row["competitor_id"])
        domain = row["domain"]
        if domain in mine or domain == domain_of(row["host"]):
            continue
        if domain in linking:
            already.add(domain)
            continue
        decision = decisions.get(domain)
        entry = by_domain.setdefault(domain, {
            "domain": domain, "display": store.to_display_host(domain), "competitors": [], "authority": None, "authority_label": None, "spam_score": None, "sample_url": row["sample_url"],
            "sources": set(), "first_seen": row["first_seen_at"], "in_consideration": domain in prospects, "in_todo": domain in planned, "lost_link": domain in lost, "is_competitor": domain in own_rivals,
            "system_quality": row["quality"], "system_reason": row["reason"], "kept": decision == "keep",
            "page_note": row["page_note"], "title": row["page_title"], "top_percent": _top_percent(row["cc_rank"], row["cc_total"]), "cc_rank": row["cc_rank"], "outlinks": row["cc_outlinks"],
            "added_by_hand": [],
        })
        entry["competitors"].append({"id": row["competitor_id"], "host": row["host"]})
        entry["sample_url"] = entry["sample_url"] or row["sample_url"]
        if row["source_label"] == BY_HAND and not row["in_common_crawl"]:
            entry["added_by_hand"].append(row["competitor_id"])
        if row["authority"] is not None and (entry["authority"] is None or row["authority"] > entry["authority"]):
            entry["authority"], entry["authority_label"] = row["authority"], row["authority_label"]
        if row["spam_score"] is not None:
            entry["spam_score"] = max(entry["spam_score"] or 0, row["spam_score"])
        if row["source_label"]:
            entry["sources"].add(row["source_label"])
        if row["in_common_crawl"]:
            entry["sources"].add("Common Crawl")
        entry["first_seen"] = min(entry["first_seen"], row["first_seen_at"])
    for domain, entry in by_domain.items():
        # A person's decision beats every rule, then the uploaded file's spam score, then the app's own checks (quality.verdict).
        state, reason, flagged_by = quality.verdict(entry["spam_score"], entry.pop("system_quality"), entry.pop("system_reason"), decisions.get(domain))
        # Someone found this one in a tool, so it shows while its home page waits. The check still runs and can still flag it.
        if state == quality.PENDING and domain in typed_in:
            state = GOOD
        entry.update(quality=state, reason=reason, flagged_by=flagged_by, reason_words=quality.reason_words(reason) if state == SPAM else None)
    everything = [
        _with_edit({**entry, "sources": sorted(entry["sources"]), "first_seen": _iso(entry["first_seen"]), "competitor_count": len(entry["competitors"]), **_link_fields(links.get(entry["domain"], []))}, edits.get(entry["domain"]), removed.get(entry["domain"], []))
        for entry in by_domain.values()
    ]
    # Most competitors first, then the best authority. Common Crawl's rank only orders those with no score from a file.
    everything.sort(key=lambda g: (-g["competitor_count"], -(g["authority"] if g["authority"] is not None else -1), g["cc_rank"] or 10**12, g["domain"]))
    return {
        "competitors": [
            {
                "id": c["id"], "host": c["host"], "has_data": c["id"] in with_data, "has_file": c["id"] in with_file,
                "common_crawl": crawls[c["id"]]["release_name"] if c["id"] in crawls else None,
                "common_crawl_domains": crawls[c["id"]]["domains"] if c["id"] in crawls else None,
                "common_crawl_at": _iso(crawls[c["id"]]["run_at"]) if c["id"] in crawls else None,
            }
            for c in competitors
        ],
        "already_linking": len(already),
        "everything": everything,
    }


def _link_fields(links: list[dict]) -> dict:
    """The links the row lists, how many there are, and the best Page Authority among them, for sorting."""
    scores = [l["page_authority"] for l in links if l["page_authority"] is not None]
    return {"links": links[:MAX_LINKS_PER_DOMAIN], "link_count": len(links), "best_page_authority": max(scores) if scores else None}


def link_gaps(engine: Engine, site_id: int, competitor_id: int | None = None) -> dict:
    """Spam is flagged, never removed. `gaps` holds the good ones, the only ones that can be added, and `filtered` the flagged ones, each with its reason.

    With `competitor_id` (a competitor's own page, 2026-11-16): only the domains linking to that competitor, before the lists
    are cut, so a competitor whose domains sit low in the shared order still gets all of its own. The counts are its own too.
    Each domain still names every competitor it links to. Same queries either way: the filter runs on what was read."""
    report = _all_gaps(engine, site_id)
    everything = report.pop("everything")
    if competitor_id is not None:
        everything = [g for g in everything if any(c["id"] == competitor_id for c in g["competitors"])]
    good = [g for g in everything if g["quality"] == GOOD]
    spam = [g for g in everything if g["quality"] == SPAM]
    # Every domain on the list, and every competitor it links to, gets its icon, flagged or not. Ones listed before this was added catch up here.
    logos.queue_missing(engine, [g["domain"] for g in good[:MAX_LISTED] + spam[:MAX_FILTERED_LISTED]] + [c["host"] for c in report["competitors"]])
    return {
        **report,
        "gaps": good[:MAX_LISTED],
        "filtered": spam[:MAX_FILTERED_LISTED],
        "funnel": {"found": len(everything), "filtered": len(spam), "checking": sum(1 for g in everything if g["quality"] == quality.PENDING), "good": len(good)},
    }


def decide(engine: Engine, site_id: int, domain: str, decision: str, restore=None) -> dict:
    """Keep it, mark it as spam, or hand it back to the rules.

    Spam and In consideration never show together (UI critique 2026-11-12): marking a domain as spam takes it off this
    site's In consideration list, and the rows taken off come back in `prospects_removed`, whole. Undo sends them back as
    `restore` with the decision "auto", which puts each one back as it was: owner, status and rating included."""
    if decision not in ("keep", "spam", "auto"):
        raise Refused("Keep it, mark it as spam, or go back to automatic.")
    if not isinstance(domain, str) or not domain.strip():
        raise Refused("Say which domain.")
    if restore is not None and (decision != "auto" or not isinstance(restore, list) or len(restore) > 20):
        raise Refused("Only Undo can put a domain back in consideration.")
    removed: list[dict] = []
    with engine.begin() as conn:
        require_own(conn, site_id)
        if decision == "auto":
            conn.execute(text("DELETE FROM link_gap_overrides WHERE site_id = :s AND domain = :d"), {"s": site_id, "d": domain[:190]})
        else:
            conn.execute(
                text("INSERT INTO link_gap_overrides (site_id, domain, decision) VALUES (:s, :d, :v) ON DUPLICATE KEY UPDATE decision = :v"),
                {"s": site_id, "d": domain[:190], "v": decision},
            )
        if decision == "spam":
            rows = conn.execute(text("SELECT * FROM prospects WHERE site_id = :s AND domain = :d"), {"s": site_id, "d": domain[:190]}).mappings().all()
            removed = [_prospect_row(r) for r in rows]
            if rows:
                conn.execute(text("DELETE FROM prospects WHERE site_id = :s AND domain = :d"), {"s": site_id, "d": domain[:190]})
        for row in restore or []:
            _restore_prospect(conn, site_id, domain[:190], row)
    return {"prospects_removed": removed}


def _prospect_row(r) -> dict:
    return {"id": r["id"], "site_id": r["site_id"], "url": r["url"], "domain": r["domain"], "authority": r["authority"], "authority_label": r["authority_label"],
            "spam_score": r["spam_score"], "source_file": r["source_file"], "source_kind": r["source_kind"], "created_at": _iso(r["created_at"]), "owner": r["owner"] or "",
            "stage": r["stage"], "page_authority": r["page_authority"], "rating": r["rating"]}


def _restore_prospect(conn, site_id: int, domain: str, row) -> None:
    """One row taken off by marking spam, put back with its own id. Only that domain, on that site, can come back this way."""
    if not isinstance(row, dict) or row.get("domain") != domain or row.get("site_id") != site_id:
        raise Refused("Only Undo can put a domain back in consideration.")
    url = row.get("url")
    if not isinstance(url, str) or not url.strip() or len(url) > _MAX_URL:
        raise Refused("Only Undo can put a domain back in consideration.")
    owner = row.get("owner") or None
    if owner is not None and (not isinstance(owner, str) or len(owner) > _MAX_OWNER):
        raise Refused("The owner's name must be text, up to 120 characters.")
    stage = row.get("stage") or "new"
    if stage not in PROSPECT_STAGES:
        raise Refused("That isn't a status a prospect can have.")
    kind = row.get("source_kind") if row.get("source_kind") in ("csv", "link_gap") else "link_gap"
    pid = row.get("id") if type(row.get("id")) is int and row.get("id") > 0 else None
    conn.execute(
        text(
            "INSERT IGNORE INTO prospects (id, site_id, url, domain, authority, authority_label, spam_score, source_file, source_kind, page_authority, rating, owner, stage) "
            "VALUES (:i, :s, :u, :d, :a, :l, :sp, :f, :k, :pa, :r, :o, :st)"
        ),
        {"i": pid, "s": site_id, "u": url, "d": domain, "a": _number_or_none(row.get("authority"), "Authority"), "l": _text_or_none(row.get("authority_label"), "label", _MAX_LABEL),
         "sp": _number_or_none(row.get("spam_score"), "Spam score"), "f": _text_or_none(row.get("source_file"), "file", _MAX_FILE), "k": kind,
         "pa": _number_or_none(row.get("page_authority"), "Page Authority"), "r": _rating(row.get("rating")), "o": owner, "st": stage},
    )


def _listed_domain(conn, domain) -> str:
    if not isinstance(domain, str) or not domain.strip():
        raise Refused("Say which domain.")
    clean = store.to_ascii_host(domain.strip().lower())[:190]
    if conn.execute(text("SELECT 1 FROM competitor_referrers WHERE domain = :d LIMIT 1"), {"d": clean}).first() is None:
        raise NotFound("That domain isn't on the list.")
    return clean


def _competitor_ids(conn, value) -> list[int]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(type(item) is int for item in value):
        raise Refused("Say which competitor by its number.")
    known = {row[0] for row in conn.execute(text("SELECT DISTINCT competitor_id FROM site_competitors"))}
    if set(value) - known:
        raise Refused("That isn't one of your competitors.")
    return list(dict.fromkeys(value))


def _checked_score(authority, authority_label) -> tuple[int | None, str]:
    if authority in ("", None):
        authority = None
    elif type(authority) is not int or not 0 <= authority <= 100:
        raise Refused("Score must be 0 to 100.")
    if authority_label is not None and not isinstance(authority_label, str):
        raise Refused("The tool's name must be text.")
    label = (authority_label or "").strip()
    if len(label) > _MAX_LABEL:
        raise Refused(f"The tool's name is too long. It can hold {_MAX_LABEL} characters.")
    if authority is not None and not label:
        raise Refused("Say which tool this score comes from.")
    if label and authority is None:
        raise Refused("Type the score from that tool too.")
    return authority, label


def _checked_link(sample_url, clean: str) -> str | None:
    url = sample_url.strip() if isinstance(sample_url, str) else sample_url
    if url in ("", None):
        return None
    found = _domain_of_address(url)
    if not found:
        raise Refused("Not a web address.")
    if store.to_ascii_host(found) != clean:
        raise Refused(f"That link isn't on {clean}.")
    return url


def save_edit(engine: Engine, domain, authority=None, authority_label=None, sample_url=None, add_competitors=None, remove_competitors=None, by=None) -> None:
    """What someone read in a tool with no connection here. A score always says which tool it's from, because scores from different tools don't compare."""
    authority, label = _checked_score(authority, authority_label)
    with engine.begin() as conn:  # a refusal below leaves nothing half saved
        clean = _listed_domain(conn, domain)
        _write_edit(conn, clean, authority, label, _checked_link(sample_url, clean), add_competitors, remove_competitors, by)


def _write_edit(conn, clean: str, authority, label: str, url, add_competitors, remove_competitors, by) -> None:
    add, remove = _competitor_ids(conn, add_competitors), _competitor_ids(conn, remove_competitors)
    for competitor_id in add:
        conn.execute(
            text("INSERT INTO competitor_referrers (competitor_id, domain, source_label) VALUES (:c, :d, :l) ON DUPLICATE KEY UPDATE removed_by_hand = 0"),
            {"c": competitor_id, "d": clean, "l": BY_HAND},
        )
    for competitor_id in remove:
        conn.execute(text("UPDATE competitor_referrers SET removed_by_hand = 1 WHERE competitor_id = :c AND domain = :d"), {"c": competitor_id, "d": clean})
    # A link only ever known from someone's tick simply goes. One a file or Common Crawl reported stays remembered as removed.
    conn.execute(text("DELETE FROM competitor_referrers WHERE domain = :d AND removed_by_hand = 1 AND source_label = :l AND in_common_crawl = 0"), {"d": clean, "l": BY_HAND})
    if conn.execute(text("SELECT 1 FROM competitor_referrers WHERE domain = :d AND removed_by_hand = 0 LIMIT 1"), {"d": clean}).first() is None:
        raise Refused("A domain needs at least one competitor. To hide it, mark it as spam.")
    conn.execute(
        text(
            "INSERT INTO link_domain_edits (domain, authority, authority_label, sample_url, edited_by, edited_at) VALUES (:d, :a, :l, :u, :b, UTC_TIMESTAMP(3)) "
            "ON DUPLICATE KEY UPDATE authority = :a, authority_label = :l, sample_url = :u, edited_by = :b, edited_at = UTC_TIMESTAMP(3)"
        ),
        {"d": clean, "a": authority, "l": label or None, "u": url, "b": by[:100] if by else None},
    )


def add_domain(engine: Engine, domain, competitors=None, authority=None, authority_label=None, sample_url=None, by=None) -> dict:
    """A domain read in a tool with no connection here. The name check runs now and the home-page check later, as for any other."""
    if not isinstance(domain, str) or not domain.strip():
        raise Refused("Say which domain.")
    address = domain.strip()
    clean = store.to_ascii_host(cleaner.root_domain(address))[:190] if cleaner.root_domain(address) else ""
    if not clean:
        raise Refused("Not a web address.")
    authority, label = _checked_score(authority, authority_label)
    # A pasted page is the example link, unless another was given.
    if not sample_url and address.lower().startswith(("http://", "https://")) and urlsplit(address).path not in ("", "/"):
        sample_url = address
    url = _checked_link(sample_url, clean)
    with engine.begin() as conn:
        chosen = _competitor_ids(conn, competitors)
        if not chosen:
            raise Refused("Pick a competitor.")
        if clean in my_domains(conn):
            raise Refused("That's one of your own websites.")
        marks = {f"c{i}": competitor_id for i, competitor_id in enumerate(chosen)}
        in_list = ", ".join(f":{name}" for name in marks)
        hosts = conn.execute(text(f"SELECT host FROM sites WHERE id IN ({in_list})"), marks).all()
        if any(domain_of(row[0]) == clean for row in hosts):
            raise Refused("That's the competitor itself.")
        existing = conn.execute(text("SELECT 1 FROM competitor_referrers WHERE domain = :d AND removed_by_hand = 0 LIMIT 1"), {"d": clean}).first() is not None
        before = conn.execute(text("SELECT * FROM link_domain_edits WHERE domain = :d"), {"d": clean}).mappings().first()
        # Adding what's already listed only adds to it: what was typed before stays unless something new was typed.
        if before is not None and authority is None:
            authority, label = before["authority"], before["authority_label"] or ""
        _write_edit(conn, clean, authority, label, url or (before["sample_url"] if before is not None else None), chosen, None, by)
        links_to = [row[0] for row in conn.execute(
            text(
                f"SELECT DISTINCT s.host FROM site_competitors sc JOIN sites s ON s.id = sc.site_id JOIN backlinks b ON b.site_id = sc.site_id "
                f"WHERE sc.competitor_id IN ({in_list}) AND b.domain = :d AND b.status IN ('live', 'found') ORDER BY s.host"
            ),
            {**marks, "d": clean},
        )]
    quality.note_domains(engine, [{"domain": clean}])
    quality.queue_checks(engine)
    logos.queue_for(engine, [clean])
    with engine.connect() as conn:
        flagged = conn.execute(text("SELECT quality FROM link_domains WHERE domain = :d"), {"d": clean}).scalar() == SPAM
    return {"domain": clean, "existing": existing, "flagged": flagged, "links_to": links_to}


def reset_edit(engine: Engine, domain) -> None:
    """Back to what files and Common Crawl say."""
    with engine.begin() as conn:
        clean = _listed_domain(conn, domain)
        conn.execute(text("DELETE FROM link_domain_edits WHERE domain = :d"), {"d": clean})
        conn.execute(text("DELETE FROM competitor_referrers WHERE domain = :d AND source_label = :l AND in_common_crawl = 0"), {"d": clean, "l": BY_HAND})
        conn.execute(text("UPDATE competitor_referrers SET removed_by_hand = 0 WHERE domain = :d"), {"d": clean})


def add_to_prospects(engine: Engine, site_id: int, domains: list) -> dict:
    if not isinstance(domains, list) or not domains or not all(isinstance(d, str) for d in domains):
        raise Refused("Pick a domain.")
    # Only the good ones. Spam, and anything not checked yet, is never added, whatever the request says.
    report = {g["domain"]: g for g in _all_gaps(engine, site_id)["everything"] if g["quality"] == GOOD}
    added, skipped = [], []
    with engine.begin() as conn:
        for domain in dict.fromkeys(domains):
            gap = report.get(store.to_ascii_host(domain))
            if gap is None or gap["in_consideration"] or gap.get("in_todo"):  # only what the gap list really offers
                skipped.append(domain)
                continue
            rivals = ", ".join(c["host"] for c in gap["competitors"])
            conn.execute(
                text(
                    "INSERT IGNORE INTO prospects (site_id, url, domain, authority, authority_label, spam_score, source_file, source_kind) "
                    "VALUES (:s, :u, :d, :a, :l, :sp, :f, 'link_gap')"
                ),
                {"s": site_id, "u": gap["sample_url"] or f"https://{gap['domain']}/", "d": gap["domain"], "a": gap["authority"], "l": gap["authority_label"], "sp": gap["spam_score"], "f": f"Link gap: {rivals}"[:255]},
            )
            added.append(domain)
    logos.queue_for(engine, added)
    return {"added": added, "skipped": skipped}


def list_prospects(engine: Engine, site_id: int | None) -> list[dict]:
    """One site's prospects, or (site_id None) those of every one of my sites at once, so a page load asks once, not once per site."""
    with engine.connect() as conn:
        if site_id is None:
            values: dict = {}
            mine = access.site_clause("p.site_id", values, conn)  # "all sites" is all of *their* sites
            rows = conn.execute(text(f"SELECT p.* FROM prospects p JOIN sites s ON s.id = p.site_id WHERE s.kind = 'own'{mine} ORDER BY p.id DESC"), values).mappings().all()
        else:
            require_own(conn, site_id)
            rows = conn.execute(text("SELECT * FROM prospects WHERE site_id = :s ORDER BY id DESC"), {"s": site_id}).mappings().all()
    return [
        {"id": r["id"], "site_id": r["site_id"], "url": r["url"], "domain": r["domain"], "authority": r["authority"], "authority_label": r["authority_label"],
         "spam_score": r["spam_score"], "source_file": r["source_file"], "source_kind": r["source_kind"], "created_at": _iso(r["created_at"]), "owner": r["owner"] or "", "stage": r["stage"], "page_authority": r["page_authority"], "rating": r["rating"]}
        for r in rows
    ]


PROSPECT_STAGES = ("new", "contacted", "agreed", "refused")


_UNSET = object()


def _rating(value) -> int | None:
    if value is not None and (type(value) is not int or not 1 <= value <= 5):
        raise Refused("A rating is a whole number from 1 to 5.")
    return value


def update_prospect(engine: Engine, prospect_id: int, owner=None, stage=None, rating=_UNSET) -> None:
    """Who's talking to this site, and how it's going. Only what's sent changes. A rating of None clears it."""
    if rating is not _UNSET:
        _rating(rating)
    if owner is not None and (not isinstance(owner, str) or len(owner) > 120):
        raise Refused("The owner's name must be text, up to 120 characters.")
    if stage is not None and stage not in PROSPECT_STAGES:
        raise Refused("That isn't a status a prospect can have.")
    with engine.begin() as conn:
        if not conn.execute(text("SELECT 1 FROM prospects WHERE id = :i"), {"i": prospect_id}).first():
            raise NotFound("That prospect doesn't exist.")
        if owner is not None:
            conn.execute(text("UPDATE prospects SET owner = :o WHERE id = :i"), {"o": owner.strip() or None, "i": prospect_id})
        if stage is not None:
            conn.execute(text("UPDATE prospects SET stage = :s WHERE id = :i"), {"s": stage, "i": prospect_id})
        if rating is not _UNSET:
            conn.execute(text("UPDATE prospects SET rating = :r WHERE id = :i"), {"r": rating, "i": prospect_id})


def delete_prospect(engine: Engine, prospect_id: int) -> None:
    with engine.begin() as conn:
        if not conn.execute(text("DELETE FROM prospects WHERE id = :i"), {"i": prospect_id}).rowcount:
            raise NotFound("That prospect doesn't exist.")


MAX_PROSPECTS_AT_ONCE = 5000  # the page sends a longer list in several requests
_MAX_URL, _MAX_DOMAIN, _MAX_FILE, _MAX_LABEL, _MAX_OWNER = 2048, 190, 255, 120, 120


def _number_or_none(value, word: str):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Refused(f"{word} must be a number.")
    return value


def _text_or_none(value, word: str, limit: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise Refused(f"{word} must be text, up to {limit} characters.")
    return value.strip() or None


def _domain_of_address(url) -> str:
    """The same domain a logged backlink gets, so placing a link removes its prospect."""
    if not isinstance(url, str) or len(url) > _MAX_URL or not url.lower().startswith(("http://", "https://")) or url.split() != [url]:
        return ""
    domain = store.host_and_domain(url)[1]
    return domain if cleaner.root_domain(domain) and len(domain) <= _MAX_DOMAIN else ""


def add_csv_prospects(engine: Engine, site_id: int, rows, file=None, authority_label=None) -> dict:
    """Links chosen from a file. The page has already filtered them, and the same rules hold here whatever a request says.

    A bad value refuses the whole request, so nothing is half saved. Spam is never added. One prospect per domain, as the table requires.
    """
    if not isinstance(rows, list) or not rows:
        raise Refused("Pick at least one link.")
    if len(rows) > MAX_PROSPECTS_AT_ONCE:
        raise Refused(f"Send up to {MAX_PROSPECTS_AT_ONCE} links at a time.")
    file, authority_label = _text_or_none(file, "The file name", _MAX_FILE), _text_or_none(authority_label, "The authority label", _MAX_LABEL)
    with engine.begin() as conn:
        require_own(conn, site_id)
        taken = {row[0] for row in conn.execute(text("SELECT domain FROM prospects WHERE site_id = :s"), {"s": site_id})}
        fresh, skipped = [], []
        for row in rows:
            url = row.get("url") if isinstance(row, dict) else None
            domain = _domain_of_address(url)
            if not domain:
                skipped.append({"url": url if isinstance(url, str) else "", "why": "no_address"})
                continue
            spam = _number_or_none(row.get("spam_score"), "The spam score")
            authority = _number_or_none(row.get("authority"), "The authority")
            page_authority = _number_or_none(row.get("page_authority"), "The page authority")
            rating = _rating(row.get("rating"))
            stage = row.get("stage", "new")
            if stage not in PROSPECT_STAGES:
                raise Refused("That isn't a status a prospect can have.")
            owner = _text_or_none(row.get("owner"), "The owner's name", _MAX_OWNER)
            if spam is not None and spam > cleaner.SPAM_THRESHOLD:
                skipped.append({"url": url, "why": "spam"})
            elif domain in taken:
                skipped.append({"url": url, "why": "already_in_consideration"})
            else:
                taken.add(domain)
                fresh.append({"s": site_id, "u": url, "d": domain, "a": authority, "l": authority_label, "sp": spam, "f": file, "o": owner, "st": stage, "pa": page_authority, "ra": rating})
        if fresh:
            conn.execute(
                text(
                    "INSERT IGNORE INTO prospects (site_id, url, domain, authority, authority_label, spam_score, source_file, source_kind, owner, stage, page_authority, rating) "
                    "VALUES (:s, :u, :d, :a, :l, :sp, :f, 'csv', :o, :st, :pa, :ra)"
                ),
                fresh,
            )
    domains = [row["d"] for row in fresh]
    logos.queue_for(engine, domains)
    wanted = set(domains)
    return {"added": [row for row in list_prospects(engine, site_id) if row["domain"] in wanted], "skipped": skipped}


def remove_prospects(engine: Engine, ids) -> int:
    """Undo of a large add, in one request."""
    if not isinstance(ids, list) or not ids or len(ids) > MAX_PROSPECTS_AT_ONCE or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        raise Refused("Send the list of prospects to remove.")
    query = text("DELETE FROM prospects WHERE id IN :ids").bindparams(bindparam("ids", expanding=True))
    with engine.begin() as conn:
        return conn.execute(query, {"ids": ids}).rowcount


def log_backlink(engine: Engine, site_id: int, source_url: str, status: str = "live") -> dict:
    """One link by its address alone. seo/backlinks/service.py saves one or many with every field."""
    return backlinks.log_one(engine, site_id, source_url, status)
