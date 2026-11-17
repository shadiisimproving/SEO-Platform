"""Stored competitor events looked at again with the noise rules (SEO expert review 2026-11-17, W1-W3, W6, W2).

The reader now stops these at the source (seo.crawl.noise, store.save_fetch, crawl._report_new). Events saved before
that were saved with the text one line, not one block a line, so a site's template is found here from its own pages'
stored texts instead: runs of words found on many of its pages. Nothing is deleted; an event the rules call noise is
marked hidden with the rule's name, so it can be shown again by setting hidden = 0.

Rules, in order:
- same_text: before = after as stored, an HTML entity apart, or a "?" where the other side has a letter latin1 lost;
- listing: a text or heading change on a list of posts (category, tag, author, /page/2);
- redirect: the page's canonical moved from itself to another of its pages, with its title, text and the rest at the same
  moment: the address redirects and the target's page was read. Those events become one "redirect" event;
- template: only the order of blocks, numbers, or words the site shows on many pages changed;
- found_later / first_read: a "new page" whose own date is before watching began, or one with no date found while the
  site's first read was still going (its list came in a few hundred pages a day).

Safe to run again: hidden events stay hidden, and a redirect event is added once.
"""
from __future__ import annotations

import difflib
import gzip
import html
import json
import math
import re
from collections import Counter, defaultdict
from datetime import timedelta

from sqlalchemy import Connection, text

from seo.competitors.crawl import PAGES_PER_DAY, own_day
from seo.crawl import noise, pagedates
from seo.crawl.store import changed_words, steady_words
from seo.links.urls import page_key

FIELD_KINDS = ("title", "meta", "canonical", "robots", "h1", "headings", "schema", "search_title")
RUN = 5  # words in a row: long enough that new writing rarely matches another page by chance
COMMON_PAGES = 3  # a run of RUN words on this many of the site's pages (the page itself counts once) is copied, not written
SMALL_MOVE_WORDS = 15  # a change this small made only of words already on the page is labels moving, not writing
TEMPLATE_SHARE = 0.9  # this share of the changed words sit in runs the site shows on many pages: the change is the template
BACKLOG_SHARE = 0.8  # a day that found this share of a day's reads as new pages was still the site's first read
_DIGITS = re.compile(r"\d+")


def _norm(words: list[str]) -> list[str]:
    return [_DIGITS.sub("#", w.casefold()) for w in words]


def _runs(words: list[str]) -> set[int]:
    return {hash(tuple(words[i:i + RUN])) for i in range(len(words) - RUN + 1)}


def _json(value):
    if isinstance(value, (list, dict)) or value is None:
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _unzip(blob) -> str:
    return gzip.decompress(blob).decode("utf-8", "replace") if blob else ""


class _Site:
    """What a site's own stored pages say is its template."""

    def __init__(self, conn: Connection, domain_id: int):
        self.domain_id = domain_id
        self.pages = {
            r["id"]: dict(r)
            for r in conn.execute(
                text("SELECT id, url, title, h1, headings, extras, sitemap_lastmod, first_archived, first_seen_at FROM pages WHERE domain_id = :d"), {"d": domain_id}
            ).mappings()
        }
        # Every saved version, each page counted once: a block picked at random on every request shows on many pages
        # across their versions (meyranpartners.fr: teasers of 3-6 other articles on each page, a new pick each read).
        grams: dict[int, set[int]] = defaultdict(set)
        heads: dict[int, set[str]] = defaultdict(set)
        for page_id, blob, fields in conn.execute(
            text("SELECT v.page_id, v.text_gz, v.fields FROM page_versions v JOIN pages p ON p.id = v.page_id WHERE p.domain_id = :d"), {"d": domain_id}
        ):
            grams[page_id] |= _runs(_norm(steady_words(_unzip(blob).replace(noise.BLOCK_SEP, " "))))
            for h in (_json(fields) or {}).get("headings") or []:
                if isinstance(h, list) and len(h) > 1:
                    heads[page_id].add(noise.block_key(h[1]))
        for page in self.pages.values():
            heads[page["id"]] |= {noise.block_key(h[1]) for h in (_json(page["headings"]) or []) if isinstance(h, list) and len(h) > 1}
        self.df: Counter = Counter()
        for found in grams.values():
            self.df.update(found)
        self.read = len(grams)
        self.floor = COMMON_PAGES
        heading_df: Counter = Counter()
        for found in heads.values():
            heading_df.update(found)
        self.common_headings = {key for key, n in heading_df.items() if n >= self.floor}
        # A heading that is another page's title or main heading is a link to that page ("see also" teasers).
        for page in self.pages.values():
            self.common_headings.add(noise.block_key(page["title"] or ""))
            self.common_headings |= {noise.block_key(h) for h in (_json(page["h1"]) or []) if isinstance(h, str)}

    def _common_positions(self, words: list[str]) -> list[bool]:
        """For each word, whether a run of RUN words around it is on COMMON_PAGES of the site's pages or more."""
        common = [False] * len(words)
        for i in range(len(words) - RUN + 1):
            if self.df[hash(tuple(words[i:i + RUN]))] >= self.floor:
                for k in range(i, i + RUN):
                    common[k] = True
        return common

    def text_change_is_template(self, before: str, after: str) -> bool:
        """Every changed word sits in a run of three the site shows on many pages, in the text it's in. Words are
        judged where they stand, so a list of links in a new random order still reads as the template, while a sentence
        added to the article doesn't."""
        a, b = _norm(steady_words(before.replace(noise.BLOCK_SEP, " "))), _norm(steady_words(after.replace(noise.BLOCK_SEP, " ")))
        if Counter(a) == Counter(b):
            return True  # the same words in another order: a shuffled list
        common_a, common_b = self._common_positions(a), self._common_positions(b)
        removed, added = Counter(a) - Counter(b), Counter(b) - Counter(a)
        if removed and added and sum(removed.values()) + sum(added.values()) <= SMALL_MOVE_WORDS and set(added) <= set(a) and set(removed) <= set(b):
            return True  # a few labels moved around (a form's fields, an office list): no word was written that wasn't there
        changed = covered = 0
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
            if tag == "equal":
                continue
            for common, lo, hi in ((common_a, i1, i2), (common_b, j1, j2)):
                changed += hi - lo
                covered += sum(common[lo:hi])
        return changed > 0 and covered >= TEMPLATE_SHARE * changed


def _versions_around(conn: Connection, page_id: int, when) -> tuple[str | None, str | None]:
    found = conn.execute(
        text("SELECT text_gz FROM page_versions WHERE page_id = :p AND taken_at <= :t + INTERVAL 2 SECOND ORDER BY taken_at DESC, id DESC LIMIT 2"),
        {"p": page_id, "t": when},
    ).all()
    if len(found) < 2:
        return None, None
    return _unzip(found[1][0]), _unzip(found[0][0])


def _first_read_until(conn: Connection, domain_id: int):
    """The last day the site's first read was still taking in its backlog: a day that found nearly a full day of
    reads as pages never seen. None when no day did."""
    days = conn.execute(
        text("SELECT DATE(first_seen_at) AS day, COUNT(*) AS n FROM pages WHERE domain_id = :d GROUP BY DATE(first_seen_at) ORDER BY day"), {"d": domain_id}
    ).all()
    busy = [k for k, (_day, n) in enumerate(days) if n >= BACKLOG_SHARE * PAGES_PER_DAY]
    if not busy:
        return None
    last = busy[-1]
    # The day after the last full one took in the rest of the backlog (dmcc.ae: 300 a day, then 144 on 16 Nov).
    return days[last + 1][0] if last + 1 < len(days) else days[last][0]


def classify(conn: Connection, domain_id: int) -> dict:
    """Marks this site's noise events hidden. Returns {"hidden": {reason: n}, "redirects": n, "first_read_open": bool}."""
    site = _Site(conn, domain_id)
    events = conn.execute(
        text("SELECT id, page_id, kind, before_value, after_value, detected_at FROM change_events WHERE domain_id = :d AND hidden = 0 ORDER BY id"),
        {"d": domain_id},
    ).mappings().all()
    reasons: dict[int, str] = {}
    redirects: dict[tuple[int, object], str] = {}
    watch_start = min((p["first_seen_at"] for p in site.pages.values() if p["first_seen_at"]), default=None)
    backlog_until = _first_read_until(conn, domain_id)
    for e in events:
        page = site.pages.get(e["page_id"]) or {}
        url, kind, before, after = page.get("url") or "", e["kind"], e["before_value"], e["after_value"]
        if kind in FIELD_KINDS:
            if noise.same_value(before, after) or html.unescape(before or "").strip() == html.unescape(after or "").strip():
                reasons[e["id"]] = noise.SAME
                continue
        if kind in ("headings", "content") and noise.is_listing(url):
            reasons[e["id"]] = noise.LISTING
            continue
        if kind == "canonical" and after and page_key(after) != page_key(url) and (not before or page_key(before) == page_key(url)):
            redirects[(e["page_id"], e["detected_at"])] = after
            continue
        if kind in ("h1", "headings", "schema"):
            was, now = _json(before) or [], _json(after) or []
            label = lambda items: Counter(json.dumps(x, ensure_ascii=False) for x in items)  # noqa: E731
            if label(was) == label(now):
                reasons[e["id"]] = noise.TEMPLATE
                continue
            if kind == "headings":
                keep = lambda items: Counter(json.dumps(x, ensure_ascii=False) for x in items if not (isinstance(x, list) and len(x) > 1 and noise.block_key(x[1]) in site.common_headings))  # noqa: E731
                if keep(was) == keep(now):
                    reasons[e["id"]] = noise.TEMPLATE
            continue
        if kind == "content":
            old, new = _versions_around(conn, e["page_id"], e["detected_at"])
            if old is None:
                continue
            if changed_words(old.replace(noise.BLOCK_SEP, " "), new.replace(noise.BLOCK_SEP, " ")) == 0 or site.text_change_is_template(old, new):
                reasons[e["id"]] = noise.TEMPLATE
            continue
        if kind == "new_page" and watch_start is not None:
            extras = _json(page.get("extras")) or {}
            stated = own_day(extras, page.get("sitemap_lastmod"), page.get("first_archived"))
            if stated is not None:
                if stated < watch_start.date() - timedelta(days=1):
                    reasons[e["id"]] = noise.FOUND_LATER
            elif backlog_until is not None and page.get("first_seen_at") and page["first_seen_at"].date() <= backlog_until:
                reasons[e["id"]] = noise.FIRST_READ
    # A redirect: every event of that page at that moment was the target's page, read under the old address.
    moments = defaultdict(list)
    for page_id, when in redirects:
        moments[page_id].append(when)
    for e in events:  # saved by one read: the same page within a few seconds
        if e["kind"] not in ("new_page", "page_gone") and any(abs((e["detected_at"] - when).total_seconds()) <= 5 for when in moments.get(e["page_id"], ())):
            reasons[e["id"]] = noise.REDIRECT
    by_reason: Counter = Counter()
    for event_id, reason in reasons.items():
        conn.execute(text("UPDATE change_events SET hidden = 1, hidden_reason = :r WHERE id = :i"), {"r": reason, "i": event_id})
        by_reason[reason] += 1
    added = 0
    for (page_id, when), target in redirects.items():
        url = site.pages[page_id]["url"]
        seen = conn.execute(text("SELECT 1 FROM change_events WHERE page_id = :p AND kind = 'redirect' AND after_value = :a LIMIT 1"), {"p": page_id, "a": target}).first()
        if not seen:
            conn.execute(
                text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, 'redirect', :b, :a, :t)"),
                {"p": page_id, "d": domain_id, "b": url, "a": target, "t": when},
            )
            added += 1
        conn.execute(text("UPDATE pages SET final_url = :a, last_status = 'moved' WHERE id = :p"), {"a": target, "p": page_id})
    noise.last_edit_dates(conn, {e["page_id"] for e in events if e["id"] in reasons})
    # A site whose first read is still taking in its backlog isn't past its first read: new pages it finds aren't news.
    busy_days = [day for day, n in conn.execute(text("SELECT DATE(first_seen_at), COUNT(*) FROM pages WHERE domain_id = :d GROUP BY DATE(first_seen_at)"), {"d": domain_id}) if n >= BACKLOG_SHARE * PAGES_PER_DAY]
    still_reading = bool(busy_days) and max(busy_days) >= _newest_day(conn) - timedelta(days=1)
    if still_reading:
        conn.execute(text("UPDATE competitor_crawls cc JOIN sites s ON s.id = cc.competitor_id JOIN domains d ON d.host = s.host SET cc.baseline_done = 0 WHERE d.id = :d"), {"d": domain_id})
    return {"hidden": dict(by_reason), "redirects": added, "first_read_open": still_reading}


def _newest_day(conn: Connection):
    newest = conn.execute(text("SELECT MAX(first_seen_at) FROM pages")).scalar()
    return newest.date() if newest else pagedates.page_day("1970-01-01")


def counts(conn: Connection) -> dict[str, dict]:
    """Per site: shown edit events, pages edited, and new pages, over every stored event."""
    out: dict[str, dict] = defaultdict(lambda: {"edit_events": 0, "edited_pages": 0, "new_pages": 0})
    for r in conn.execute(
        text(
            "SELECT d.host, SUM(e.kind NOT IN ('new_page', 'page_gone')) AS ev, COUNT(DISTINCT CASE WHEN e.kind NOT IN ('new_page', 'page_gone') THEN e.page_id END) AS pg, "
            "SUM(e.kind = 'new_page') AS np FROM change_events e JOIN domains d ON d.id = e.domain_id WHERE e.hidden = 0 GROUP BY d.host"
        )
    ).mappings():
        out[r["host"]] = {"edit_events": int(r["ev"] or 0), "edited_pages": int(r["pg"] or 0), "new_pages": int(r["np"] or 0)}
    return dict(out)


def run(conn: Connection, log=print) -> dict:
    domains = [r[0] for r in conn.execute(text("SELECT DISTINCT domain_id FROM change_events ORDER BY domain_id"))]
    report = {}
    for domain_id in domains:
        host = conn.execute(text("SELECT host FROM domains WHERE id = :d"), {"d": domain_id}).scalar()
        report[host] = classify(conn, domain_id)
        if log:
            log(f"{host}: {report[host]}")
    return report
