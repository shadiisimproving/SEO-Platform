"""Stored competitor events looked at again with the noise rules (SEO expert review 2026-11-17, W1-W3, W6, W2).

The reader now stops these at the source (seo.crawl.noise, store.save_fetch, crawl._report_new). Events saved before
that were saved with the text one line, not one block a line, so a site's template is found here from its own pages'
stored texts instead: runs of words found on many of its pages. Nothing is deleted; an event the rules call noise is
marked hidden with the rule's name, so it can be shown again by setting hidden = 0.

Rules, in order:
- same_text: before = after as stored, an HTML entity apart, or a "?" where the other side has a letter latin1 lost;
- listing: a text or heading change on a list of posts (category, tag, author, /page/2);
- redirect: the page's canonical moved from itself to another of its pages, with its title, text and the rest at the same
  moment (at least one other event of the page within 5 s): the address redirects and the target's page was read. Those
  events become one "redirect" event, and the page is marked moved only when nothing was read of it since. A canonical
  change alone stays shown: it is a real edit;
- duplicate: the page named another page as its canonical before and after: the text read was that page's;
- redirect (after a move): an edit of a page already recorded as moved is the target's, never the old address's;
- template: only the order of blocks, numbers, or words the site shows on many pages changed, or words found in other
  pages' titles ("see also" teasers), or headings that showed on a page for one read only, or a few words that were on
  the page before and came back (a rotating office list), or a few words in a slot the site changes on many reads (a
  form field whose label is picked at random);
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
SLOT_WORDS = 3  # a change of at most this many words on each side, between the same words before and after, is in a slot
SLOT_CONTEXT = 3  # words each side of a slot that say where it is
ROTATING_SLOT = 3  # a slot changed this many times across the site's reads is a label picked at random, not writing
BLIP_DAYS = 7  # a heading on a page for one read only, between two reads this close, came and went by itself
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


def _slots(a: list[str], b: list[str]) -> tuple[list[int], bool]:
    """Where two texts differ, as slots (the words around each small change), and whether every change is that small."""
    out, small = [], True
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if i2 - i1 > SLOT_WORDS or j2 - j1 > SLOT_WORDS:
            small = False
            continue
        out.append(hash((tuple(a[max(0, i1 - SLOT_CONTEXT):i1]), tuple(a[i2:i2 + SLOT_CONTEXT]))))
    return out, small


def _came_and_went(seen: list[tuple[object, set[str]]]) -> set[str]:
    """Keys present for a run of reads with reads without them on both sides (or the other way round), the reads either
    side no more than BLIP_DAYS apart."""
    out: set[str] = set()
    for key in set().union(*(keys for _when, keys in seen)) if seen else ():
        marks = [key in keys for _when, keys in seen]
        k = 1
        while k < len(marks):
            if marks[k] != marks[k - 1]:
                end = k
                while end < len(marks) and marks[end] == marks[k]:
                    end += 1
                if end < len(marks) and (seen[end][0] - seen[k - 1][0]).days <= BLIP_DAYS:
                    out.add(key)
                    break
                k = end
            else:
                k += 1
    return out


class _Site:
    """What a site's own stored pages say is its template."""

    def __init__(self, conn: Connection, domain_id: int):
        self.domain_id = domain_id
        self.pages = {
            r["id"]: dict(r)
            for r in conn.execute(
                text("SELECT id, url, title, h1, headings, canonical, extras, sitemap_lastmod, first_archived, first_seen_at FROM pages WHERE domain_id = :d"), {"d": domain_id}
            ).mappings()
        }
        # Every saved version, each page counted once: a block picked at random on every request shows on many pages
        # across their versions (meyranpartners.fr: teasers of 3-6 other articles on each page, a new pick each read).
        grams: dict[int, set[int]] = defaultdict(set)
        heads: dict[int, set[str]] = defaultdict(set)
        heads_seen: dict[int, list] = defaultdict(list)  # per page, each version's time and headings, oldest first
        self.first_seen: dict[int, dict[str, object]] = defaultdict(dict)  # per page, when each word first showed on it
        self.slots: Counter = Counter()
        last: tuple[int, list[str]] | None = None
        for page_id, blob, fields, taken in conn.execute(
            text("SELECT v.page_id, v.text_gz, v.fields, v.taken_at FROM page_versions v JOIN pages p ON p.id = v.page_id WHERE p.domain_id = :d ORDER BY v.page_id, v.taken_at, v.id"),
            {"d": domain_id},
        ):
            words = steady_words(_unzip(blob).replace(noise.BLOCK_SEP, " "))
            normal = _norm(words)
            grams[page_id] |= _runs(normal)
            seen = self.first_seen[page_id]
            for word in {w.casefold() for w in words}:
                seen.setdefault(word, taken)
            # The slots this read changed against the page's read before (a form label picked at random each time).
            if last is not None and last[0] == page_id and last[1] != normal and abs(len(last[1]) - len(normal)) <= 2 * SLOT_WORDS * 4:
                self.slots.update(set(_slots(last[1], normal)[0]))
            last = (page_id, normal)
            keys = set()
            for h in (_json(fields) or {}).get("headings") or []:
                if isinstance(h, list) and len(h) > 1:
                    keys.add(noise.block_key(h[1]))
            heads[page_id] |= keys
            heads_seen[page_id].append((taken, keys))
        self.version_times = {page_id: [when for when, _keys in seen] for page_id, seen in heads_seen.items()}
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
        # A heading that is another page's title (with or without the site's name) or main heading is a link to that
        # page ("see also" teasers); so are those words inside a text.
        self.extra_runs: set[int] = set()
        for page in self.pages.values():
            self.common_headings.add(noise.block_key(page["title"] or ""))
            h1 = [h for h in (_json(page["h1"]) or []) if isinstance(h, str)]
            self.common_headings |= {noise.block_key(h) for h in h1} | noise.title_keys(page["title"], h1)
            for words in [noise._TITLE_TAIL.sub("", page["title"] or "")] + h1:
                if len(words.split()) >= RUN:
                    self.extra_runs |= _runs(_norm(steady_words(words)))
        # A heading that came onto a page and went again (or went and came back) within a few days: a block the page
        # picks by itself (meyranpartners.fr's random reference boxes), learned as unstable on the whole site.
        for seen in heads_seen.values():
            self.common_headings |= _came_and_went(seen)

    def _common_positions(self, words: list[str]) -> list[bool]:
        """For each word, whether a run of RUN words around it is on COMMON_PAGES of the site's pages or more."""
        common = [False] * len(words)
        for i in range(len(words) - RUN + 1):
            run = hash(tuple(words[i:i + RUN]))
            if self.df[run] >= self.floor or run in self.extra_runs:
                for k in range(i, i + RUN):
                    common[k] = True
        return common

    def came_back(self, page_id: int, before: str, after: str, before_at) -> bool:
        """A few words changed, and every word that came was on this page in a read before: a list rotating through the
        same items (meyranpartners.fr's offices on its home page: Monaco, Montréal, Genève, picked anew each day)."""
        times = self.version_times.get(page_id) or []
        if not any(when < before_at for when in times):
            return False  # no read before the one compared with: nothing could come back
        a = [w.casefold() for w in steady_words(before.replace(noise.BLOCK_SEP, " "))]
        b = [w.casefold() for w in steady_words(after.replace(noise.BLOCK_SEP, " "))]
        removed, added = Counter(a) - Counter(b), Counter(b) - Counter(a)
        if not added or sum(removed.values()) + sum(added.values()) > SMALL_MOVE_WORDS:
            return False
        seen = self.first_seen.get(page_id) or {}
        return all(word in seen and seen[word] <= before_at for word in added)

    def in_rotating_slots(self, before: str, after: str) -> bool:
        """Every change is a word or three in a slot the site changes on many reads: a form field's label picked at random
        (clemenceaugroup.com: Phone, Company, URL, X/Twitter)."""
        found, small = _slots(_norm(steady_words(before.replace(noise.BLOCK_SEP, " "))), _norm(steady_words(after.replace(noise.BLOCK_SEP, " "))))
        return small and bool(found) and all(self.slots[slot] >= ROTATING_SLOT for slot in found)

    def text_change_is_template(self, before: str, after: str) -> bool:
        """Every changed word sits in a run of three the site shows on many pages, in the text it's in. Words are
        judged where they stand, so a list of links in a new random order still reads as the template, while a sentence
        added to the article doesn't."""
        # Words are compared with their numbers: a price or a year moving in the article is an edit, as the live rule says
        # (noise.steady_blocks). Numbers are only set aside to find the runs the site shows on many pages (its template),
        # so a counter inside the template still changes nothing (code review 2026-11-18, #7).
        a = [w.casefold() for w in steady_words(before.replace(noise.BLOCK_SEP, " "))]
        b = [w.casefold() for w in steady_words(after.replace(noise.BLOCK_SEP, " "))]
        if Counter(a) == Counter(b):
            return True  # the same words in another order: a shuffled list
        common_a, common_b = self._common_positions(_norm(a)), self._common_positions(_norm(b))
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


def _versions_around(conn: Connection, page_id: int, when, full: bool = False):
    """The text saved with an event and the one before it; with full, also when the one before was read and both reads'
    fields."""
    found = conn.execute(
        text("SELECT text_gz, taken_at, fields FROM page_versions WHERE page_id = :p AND taken_at <= :t + INTERVAL 2 SECOND ORDER BY taken_at DESC, id DESC LIMIT 2"),
        {"p": page_id, "t": when},
    ).all()
    if len(found) < 2:
        return (None, None, None, None, None) if full else (None, None)
    if full:
        return _unzip(found[1][0]), _unzip(found[0][0]), found[1][1], _json(found[1][2]) or {}, _json(found[0][2]) or {}
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
    # A page recorded as moved: what's read at its address afterwards is the target's page (SEO review 2026-11-18, W6).
    moved_at: dict[int, object] = {}
    for row in conn.execute(text("SELECT page_id, MIN(detected_at) FROM change_events WHERE domain_id = :d AND kind = 'redirect' AND hidden = 0 GROUP BY page_id"), {"d": domain_id}):
        moved_at[row[0]] = row[1]
    for e in events:
        page = site.pages.get(e["page_id"]) or {}
        url, kind, before, after = page.get("url") or "", e["kind"], e["before_value"], e["after_value"]
        if kind in FIELD_KINDS:
            if noise.same_value(before, after) or html.unescape(before or "").strip() == html.unescape(after or "").strip():
                reasons[e["id"]] = noise.SAME
                continue
        if kind not in ("new_page", "page_gone", "redirect", "canonical"):
            moved = moved_at.get(e["page_id"])
            if moved is not None and (e["detected_at"] - moved).total_seconds() > 5:
                reasons[e["id"]] = noise.REDIRECT
                continue
            if noise.canonical_elsewhere(url, page.get("canonical")):
                _old, _new, _at, was, now = _versions_around(conn, e["page_id"], e["detected_at"], full=True)
                if was is not None and noise.canonical_elsewhere(url, was.get("canonical")) and noise.canonical_elsewhere(url, now.get("canonical")):
                    reasons[e["id"]] = noise.DUPLICATE
                    continue
        if kind in ("headings", "content") and noise.is_listing(url, page.get("title")):
            reasons[e["id"]] = noise.LISTING
            continue
        if kind == "canonical" and after and page_key(after) != page_key(url) and (not before or page_key(before) == page_key(url)):
            moved_with = [o for o in events if o["page_id"] == e["page_id"] and o["id"] != e["id"] and o["kind"] not in ("canonical", "new_page", "page_gone")
                          and abs((o["detected_at"] - e["detected_at"]).total_seconds()) <= 5]
            if moved_with:  # the title, text or the rest moved with it: the address redirects (code review 2026-11-18, #8)
                redirects[(e["page_id"], e["detected_at"])] = after
            continue  # a canonical change alone is a real SEO edit (pages consolidated): it stays shown
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
            old, new, old_at, _was, _now = _versions_around(conn, e["page_id"], e["detected_at"], full=True)
            if old is None:
                continue
            if (changed_words(old.replace(noise.BLOCK_SEP, " "), new.replace(noise.BLOCK_SEP, " ")) == 0 or site.text_change_is_template(old, new)
                    or site.came_back(e["page_id"], old, new, old_at) or site.in_rotating_slots(old, new)):
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
    for e in events:  # saved by one read: the same page within a few seconds, and anything read at the old address after
        if e["kind"] not in ("new_page", "page_gone", "redirect") and any((e["detected_at"] - when).total_seconds() >= -5 for when in moments.get(e["page_id"], ())):
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
        # The page is "moved" now only if nothing was read of it since: an old redirect the page came back from isn't.
        later = conn.execute(text(
            "SELECT 1 FROM page_versions WHERE page_id = :p AND taken_at > :t + INTERVAL 5 SECOND "
            "UNION ALL SELECT 1 FROM change_events WHERE page_id = :p AND detected_at > :t + INTERVAL 5 SECOND LIMIT 1"
        ), {"p": page_id, "t": when}).first()
        if not later:
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


def counts(conn: Connection, domain_id: int | None = None) -> dict[str, dict]:
    """Per site: shown edit events, pages edited, and new pages, over every stored event (or one site's). A move to
    another address isn't an edit (N3)."""
    out: dict[str, dict] = defaultdict(lambda: {"edit_events": 0, "edited_pages": 0, "new_pages": 0})
    one = "AND e.domain_id = :d" if domain_id is not None else ""
    for r in conn.execute(
        text(
            f"SELECT d.host, SUM(e.kind NOT IN {noise.NOT_EDITS}) AS ev, COUNT(DISTINCT CASE WHEN e.kind NOT IN {noise.NOT_EDITS} THEN e.page_id END) AS pg, "
            f"SUM(e.kind = 'new_page') AS np FROM change_events e JOIN domains d ON d.id = e.domain_id WHERE e.hidden = 0 {one} GROUP BY d.host"
        ), {"d": domain_id}
    ).mappings():
        out[r["host"]] = {"edit_events": int(r["ev"] or 0), "edited_pages": int(r["pg"] or 0), "new_pages": int(r["np"] or 0)}
    return dict(out)


def run(engine, apply: bool = False, log=print) -> tuple[dict, dict, dict]:
    """Every site with events, one transaction each: kept with apply, else rolled back at once. One site's locks are held
    only while that site is looked at, never across all of them, so the crawler writing pages meanwhile doesn't wait on
    the whole run (code review 2026-11-18, #12). Returns (before, report, after), per host."""
    with engine.connect() as conn:
        domains = [r[0] for r in conn.execute(text("SELECT DISTINCT domain_id FROM change_events ORDER BY domain_id"))]
    before, report, after = {}, {}, {}
    for domain_id in domains:
        with engine.connect() as conn:
            trans = conn.begin()
            try:
                host = conn.execute(text("SELECT host FROM domains WHERE id = :d"), {"d": domain_id}).scalar()
                before.update(counts(conn, domain_id))
                report[host] = classify(conn, domain_id)
                after.update(counts(conn, domain_id))
            except BaseException:
                trans.rollback()
                raise
            (trans.commit if apply else trans.rollback)()
        if log:
            log(f"{host}: {report[host]}")
    return before, report, after
