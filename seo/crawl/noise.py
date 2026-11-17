"""What changes on a page without anyone editing it, so it's never shown as an edit (SEO review 2026-11-17, W1-W3).

A page's main text is kept as blocks (one per paragraph, list item, heading, cell), one per line. A site's template is
learned from its own pages, never from a list per site:
- repeated: a block found on many of the site's pages (related posts, newsletter and social labels, office lists, forms);
- unstable: a block that differed between two reads of one page a few seconds apart (random "related pages" lists).
Both are left out when a page's text is compared with its last version, as is the block order (a shuffled list). A
template block is known by its words, not its numbers, so a price or a counter moving inside it changes nothing. A text saved as "?" by a latin1 table counts as the same text.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter

from sqlalchemy import Connection, text

BLOCK_SEP = "\n"  # PageFields.text holds one block a line; joined with spaces it's the old text, so its hash is unchanged
TEXT_FORMAT = 2  # page_versions.fields["text_format"]: 2 = one block a line. Older versions are one line.
REPEAT_MIN_PAGES = 3
REPEAT_SHARE = 0.02  # a block on at least 2% of the site's read pages (and on 3) is the site's template
REPEATED, UNSTABLE = "repeated", "unstable"
SAMPLE_CHARS = 300

_NUMBER = re.compile(r"\d+(?:[.,\s]\d+)*")
_SPACE = re.compile(r"\s+")
_LISTING_PATH = re.compile(
    r"/(author|auteur|autor|tag|tags|etiquette|category|categorie|categories|page|search|recherche|feed)(/|$)|/(19|20)\d{2}(/\d{1,2})?/?$", re.I
)
_LISTING_QUERY = re.compile(r"(^|[?&])(s|q|page|paged|cat|tag)=", re.I)

# Why an event is kept but not shown (change_events.hidden_reason).
SAME = "same_text"  # before = after, or only a "?" where the other side has a letter latin1 couldn't hold
TEMPLATE = "template"  # only the site's repeated or unstable blocks, their order, or numbers changed
LISTING = "listing"  # a list of posts (category, tag, author, /page/2): it changes when anything is published
REDIRECT = "redirect"  # the address redirects: the text read was another page's
FOUND_LATER = "found_later"  # a page found after the first read, but its own date is before watching began
FIRST_READ = "first_read"  # found while the first read of the site was still going


def block_key(block: str) -> str:
    """Case, spacing and numbers don't make a block different: a price or a counter moving is the same block."""
    normal = _SPACE.sub(" ", _NUMBER.sub("#", (block or "").casefold())).strip()
    return hashlib.sha1(normal.encode("utf-8")).hexdigest()[:16]


def blocks_of(value: str | None) -> list[str]:
    return [b.strip() for b in (value or "").split(BLOCK_SEP) if b.strip()]


def page_keys(page_text: str, headings=None, h1=None) -> list[str]:
    """What pages.blocks holds: the keys of a page's blocks and headings, once each."""
    keys = {block_key(b) for b in blocks_of(page_text)}
    keys |= {block_key(h[1] if isinstance(h, (list, tuple)) else h) for h in (headings or []) if h}
    keys |= {block_key(h) for h in (h1 or []) if h}
    return sorted(keys)


def lossy(value: str) -> str:
    """How a latin1 column saves a text: every character it can't hold becomes "?"."""
    return value.encode("latin-1", "replace").decode("latin-1")


def same_value(stored, fresh) -> bool:
    """The stored value and a new read say the same thing. A stored "?" against a letter latin1 can't hold is the same:
    the table lost it, nobody edited it."""
    a = stored if isinstance(stored, str) or stored is None else json.dumps(stored, ensure_ascii=False)
    b = fresh if isinstance(fresh, str) or fresh is None else json.dumps(fresh, ensure_ascii=False)
    a, b = (a or "").strip(), (b or "").strip()
    if a == b:
        return True
    if "?" in a and lossy(b) == a:
        return True
    return "?" in b and lossy(a) == b


def steady_blocks(page_text: str, skip: set[str]) -> Counter:
    """The blocks left once the site's template is taken out, as a count, so order doesn't matter. A number moving in
    the main text is an edit (a price in an article); only inside a template block does it not count."""
    return Counter(_SPACE.sub(" ", b) for b in blocks_of(page_text) if block_key(b) not in skip)


def steady_text(page_text: str, skip: set[str]) -> str:
    return BLOCK_SEP.join(b for b in blocks_of(page_text) if block_key(b) not in skip)


def steady_headings(headings, skip: set[str]) -> list:
    out = []
    for h in headings or []:
        value = h[1] if isinstance(h, (list, tuple)) and len(h) > 1 else h
        if isinstance(value, str) and block_key(value) not in skip:
            out.append(list(h) if isinstance(h, (list, tuple)) else h)
    return out


def is_listing(url: str) -> bool:
    """A list of posts rather than a page: category, tag, author, search, /page/2, a year or month archive."""
    rest = (url or "").split("://", 1)[-1]
    path, _, query = rest.partition("/")[2].partition("?")
    return bool(_LISTING_PATH.search("/" + path) or (query and _LISTING_QUERY.search("?" + query)))


def skip_set(conn: Connection, domain_id: int) -> set[str]:
    return {r[0] for r in conn.execute(text("SELECT block_hash FROM site_boilerplate WHERE domain_id = :d"), {"d": domain_id})}


def learn_unstable(conn: Connection, domain_id: int, first_text: str, second_text: str) -> int:
    """Blocks in one read and not in the other, a few seconds apart: nobody edited them, they change on every request.
    Returns how many weren't known yet."""
    one = {block_key(b): b for b in blocks_of(first_text)}
    two = {block_key(b): b for b in blocks_of(second_text)}
    known = skip_set(conn, domain_id)
    differ = {k: one.get(k) or two.get(k) for k in (set(one) ^ set(two)) - known}  # only blocks not known yet: a new one is news
    for key, sample in differ.items():
        conn.execute(
            text(
                "INSERT INTO site_boilerplate (domain_id, block_hash, kind, sample) VALUES (:d, :h, :k, :s) "
                "ON DUPLICATE KEY UPDATE kind = :k, learned_at = UTC_TIMESTAMP(3)"
            ),
            {"d": domain_id, "h": key, "k": UNSTABLE, "s": (sample or "")[:SAMPLE_CHARS]},
        )
    return len(differ)


def refresh_repeated(conn: Connection, domain_id: int) -> int:
    """Blocks found on many of the site's pages become its template. Counted from pages.blocks, which every read fills."""
    counts: Counter = Counter()
    read = 0
    for (value,) in conn.execute(text("SELECT blocks FROM pages WHERE domain_id = :d AND blocks IS NOT NULL"), {"d": domain_id}):
        keys = json.loads(value) if isinstance(value, str) else value
        if isinstance(keys, list):
            read += 1
            counts.update(set(keys))
    floor = max(REPEAT_MIN_PAGES, int(REPEAT_SHARE * read + 0.999))
    common = {key: n for key, n in counts.items() if n >= floor}
    # Kept once learned, even when no page shows it any more: an edit recorded while it was still on the pages is
    # compared with it (a label changed on every page is the old label gone and the new one come).
    rows = [{"d": domain_id, "h": key, "k": REPEATED, "n": n} for key, n in common.items()]
    for start in range(0, len(rows), 500):
        conn.execute(
            text("INSERT INTO site_boilerplate (domain_id, block_hash, kind, pages) VALUES (:d, :h, :k, :n) ON DUPLICATE KEY UPDATE pages = VALUES(pages)"),
            rows[start:start + 500],
        )
    return len(common)


RECHECK_KINDS = ("content", "headings")


def _versions_around(conn, page_id: int, when) -> tuple[str | None, str | None, bool]:
    """The text saved with an event and the one before it, and whether both were saved one block a line."""
    import gzip

    found = conn.execute(
        text(
            "SELECT id, text_gz, JSON_VALUE(fields, '$.text_format') AS f FROM page_versions WHERE page_id = :p AND taken_at <= :t + INTERVAL 2 SECOND "
            "ORDER BY taken_at DESC, id DESC LIMIT 2"
        ),
        {"p": page_id, "t": when},
    ).all()
    if len(found) < 2:
        return None, None, False
    after, before = found[0], found[1]
    blocks = str(after.f or "") == str(TEXT_FORMAT) and str(before.f or "") == str(TEXT_FORMAT)
    unzip = lambda blob: gzip.decompress(blob).decode("utf-8", "replace") if blob else ""  # noqa: E731
    return unzip(before.text_gz), unzip(after.text_gz), blocks


def recheck_events(conn: Connection, domain_id: int, days: int | None = 2) -> int:
    """Edits recorded before the site's template was known, looked at again with what is known now: a newsletter label
    changed on every page is an edit on the first pages read that day, and the template once the day's reads show it on
    them all. Those are hidden, and each page's last edit date follows. Returns how many were hidden."""
    from seo.crawl.store import changed_words  # here, as store imports this module

    skip = skip_set(conn, domain_id)
    if not skip:
        return 0
    since = "" if days is None else f"AND detected_at > UTC_TIMESTAMP(3) - INTERVAL {int(days)} DAY "
    events = conn.execute(
        text(
            f"SELECT id, page_id, kind, before_value, after_value, detected_at FROM change_events WHERE domain_id = :d AND hidden = 0 "
            f"AND kind IN ('content', 'headings') {since}ORDER BY id"
        ),
        {"d": domain_id},
    ).mappings().all()
    hide, pages = [], set()
    for e in events:
        if e["kind"] == "headings":
            was, now = json.loads(e["before_value"] or "[]"), json.loads(e["after_value"] or "[]")
            if steady_headings(was, skip) == steady_headings(now, skip):
                hide.append(e["id"])
            continue
        before, after, blocks = _versions_around(conn, e["page_id"], e["detected_at"])
        if not blocks:
            continue
        if steady_blocks(before, skip) == steady_blocks(after, skip) or changed_words(steady_text(before, skip), steady_text(after, skip)) == 0:
            hide.append(e["id"])
            pages.add(e["page_id"])
    for event_id in hide:
        conn.execute(text("UPDATE change_events SET hidden = 1, hidden_reason = :r WHERE id = :i"), {"r": TEMPLATE, "i": event_id})
    pages |= {e["page_id"] for e in events if e["id"] in set(hide)}
    last_edit_dates(conn, pages)
    return len(hide)


def last_edit_dates(conn: Connection, page_ids) -> None:
    """A page's last edit is its newest shown edit; with none, it has no edit date (so "Updated, 12 months" can't count it)."""
    for page_id in page_ids:
        conn.execute(
            text(
                "UPDATE pages SET last_changed_at = (SELECT MAX(detected_at) FROM change_events WHERE page_id = :p AND hidden = 0 "
                "AND kind NOT IN ('new_page', 'page_gone')) WHERE id = :p"
            ),
            {"p": page_id},
        )
