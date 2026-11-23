"""Watching a competitor's site: what it published, changed and removed.

Sitemap dates decide what to read. An RSS feed, where a site has one, spots new posts sooner. Everything
goes through the polite fetcher: robots.txt, 3 seconds between requests, the daily budget. A site that
blocks the crawler is shown as blocked. The first pass only records a starting point, so it doesn't
report every existing page as new.

One run is short, so a short cron tick can finish a large site: the first job works out what to read, and
every CHUNK_SECONDS the job queues itself again with what's left. A site gets at most PAGES_PER_DAY reads a
day, so a large site's first pass takes several days, and it only counts as finished once every page it
lists has been tried.
"""
from __future__ import annotations

import json
import time
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urljoin

from lxml import etree, html as lxml_html
from sqlalchemy import Engine, text

from seo.competitors import pages, tracking
from seo.core import budget
from seo.crawl import noise, pagedates, sitemap, store as crawl_store
from seo.crawl.fetch import FetchResult
from seo.links import service as links_service
from seo.links.checker import extract_links
from seo.links.urls import page_key
from seo.serp.store import canonical_url, host_and_domain, on_host, to_ascii_host
from seo.worker import queue
from seo.worker.runner import handler

JOB_KIND = "competitors.crawl"
LANE = "crawl"
MAX_DISCOVERED = 5000
PAGES_PER_DAY = 300
CHUNK_SECONDS = 45.0
REREAD_DAYS = 14  # a date in a sitemap may not be honest, so every page is read again now and then
UNLISTED_DAYS = 3  # a page the site stopped listing may be gone, so it's looked at sooner
MAX_FEEDS = 3
STOP_AFTER_FAILURES = 3  # in a row: the site isn't answering, or it's blocking us, so hammering it helps nobody
SETTLED_STATUSES = ("gone", "robots")  # these won't change tomorrow, so they wait for the slow re-read
READABLE_STATUSES = ("ok", "not_modified", "not_html")
BLOCKED_TEXT = "Blocks bots, so edits can't be tracked."
BUDGET_TEXT = "Today's crawl budget is used up. This site's read carries on tomorrow."
TODAY_DONE_TEXT = "This site has had its reads for today. It carries on tomorrow."
SLOW_DOWN_TEXT = "The site asked the app to slow down, so it stopped for today. It carries on tomorrow."
DOWN_TEXT = "The site isn't answering properly right now. The app tries again tomorrow."
LEFT_TEXT = "This address now redirects to another website, so nothing was read."
# A sitemap that is cut (a file failed or too many files, seo/crawl/sitemap.py) no longer holds the first read forever:
# it waits up to FIRST_PASS_WAIT_DAYS for the whole list, then ends and says so (code review 2026-11-18, #6).
FIRST_PASS_WAIT_DAYS = 3
CUT_TEXT = "Sitemap incomplete: new pages may be missed."
CUT_WAIT_TEXT = "Part of the sitemap didn't load. The first read waits a few days for the whole list."


def feed_links(body: bytes, base_url: str) -> list[str]:
    """Addresses of RSS or Atom feeds a page declares."""
    try:
        doc = lxml_html.document_fromstring(body)
    except (ValueError, TypeError, etree.ParserError):
        return []
    found = []
    for link in doc.iterfind(".//link[@rel]"):
        kind = (link.get("type") or "").lower()
        if "alternate" in (link.get("rel") or "").lower() and ("rss" in kind or "atom" in kind) and link.get("href"):
            address = canonical_url(urljoin(base_url, link.get("href").strip()))
            if address:
                found.append(address)
    return list(dict.fromkeys(found))


def _local_name(element) -> str:
    return etree.QName(element).localname if isinstance(element.tag, str) else ""


def parse_feed(body: bytes) -> list[str]:
    """The address of each post in an RSS or Atom feed."""
    try:
        root = etree.fromstring(body, parser=etree.XMLParser(resolve_entities=False, no_network=True, recover=True))
    except (etree.XMLSyntaxError, ValueError):
        return []
    if root is None:
        return []
    urls = []
    for element in root.iter():
        if _local_name(element) not in ("item", "entry"):
            continue
        for child in element:
            if _local_name(child) == "link" and child.get("rel") in (None, "alternate"):
                href = (child.get("href") or child.text or "").strip()
                if href.startswith(("http://", "https://")):
                    urls.append(href)
                    break
    return urls


def _set(engine: Engine, competitor_id: int, **values) -> None:
    clause = ", ".join(f"{name} = :{name}" for name in values)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE competitor_crawls SET {clause} WHERE competitor_id = :c"), {**values, "c": competitor_id})


def _finish(engine: Engine, competitor_id: int, status: str, message: str | None = None, **values) -> None:
    values = {"status": status, "message": message[:500] if message else None, **values}
    clause = ", ".join(f"{name} = :{name}" for name in values)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE competitor_crawls SET {clause}, finished_at = UTC_TIMESTAMP(3) WHERE competitor_id = :c"), {**values, "c": competitor_id})


def _discover(fetcher, start_url: str, host: str, charge) -> tuple[dict[str, str | None], str, bool, str, bool, str | None]:
    """What the site lists itself. Returns address -> sitemap date, how the start page answered, whether a sitemap listed
    everything, where the list came from (sitemap, feed or links), whether the sitemap had more than MAX_DISCOVERED pages,
    and why a sitemap list was cut: "files" (more sitemap files than MAX_SITEMAPS, the same every day) or "failed" (a file
    failed or was too large today), else None. A cut list isn't whole today (SEO review 2026-11-17, W2)."""

    def stay_on(url: str) -> bool:
        return on_host(host_and_domain(url)[0], host)

    urls: dict[str, str | None] = {}
    found = sitemap.discover(fetcher, start_url, max_pages=MAX_DISCOVERED)
    charge()
    for entry in found.entries:
        normal = canonical_url(entry.url)
        if normal:
            urls[normal] = entry.lastmod
    complete_list = bool(urls) and not found.capped and not getattr(found, "cut", False)
    source = "sitemap" if urls else "links"
    front = fetcher.get(start_url, stay_on=stay_on)
    charge()
    if front.status == "ok" and front.body:
        base = front.final_url or start_url
        for feed in [address for address in feed_links(front.body, base) if stay_on(address)][:MAX_FEEDS]:
            answer = fetcher.get(feed, any_type=True, stay_on=stay_on)
            charge()
            if answer.status == "ok" and answer.body:
                for url in parse_feed(answer.body):
                    normal = canonical_url(url)
                    if normal and stay_on(normal):
                        urls.setdefault(normal, None)
                        if source == "links":
                            source = "feed"
        if not urls:  # no sitemap and no feed: follow the start page's own links
            for link in extract_links(front.body, base):
                normal = canonical_url(link)
                if normal and stay_on(normal):
                    urls.setdefault(normal, None)
    urls.setdefault(canonical_url(start_url), None)
    cut = None
    if getattr(found, "cut", False) and source == "sitemap":
        cut = "failed" if found.problems or found.errors or not getattr(found, "too_many_files", False) else "files"
    return urls, front.status, complete_list, source, bool(found.capped), cut


# How each site is followed (2026-11-10, plan-seo-command-center-competitor-update-detection.md): the site's size and
# signals decide, so an edit shows within a day where the site's dates can't be trusted too.
FULL_DAILY_PAGES = 250  # a site this small has every page read every day, with no need for dates
TOP_RANK = 20  # pages placed this high for my keywords are read every day on a site whose dates can't be trusted
HUB_PAGES = 5  # with the start page, the pages with the most links (blog, categories), where new posts show first
HUB_MIN_LINKS = 20  # fewer links than this and a page isn't a list of other pages
EVERY_FEW_DAYS = 3  # other ranking pages, and pages edited lately
RECENT_EDIT_DAYS = 30
RANKING_DAYS = 60  # ranking checks this recent decide what ranks
WP_RECHECK_DAYS = 7  # a site whose WordPress list was closed is asked again a week later
WP_PER_LIST = 100
TRUST_MIN_MISSES = 3  # edits the site's dates kept quiet about before they stop counting
TRUST_MISS_SHARE = 0.3
HAS_DATES_SHARE = 0.5  # at least half the listed pages carry a date, or the sitemap gives none worth following
ALL, SITEMAP, WORDPRESS, TIERS = "all", "sitemap", "wordpress", "tiers"
DATE, QUIET = "date", "quiet"  # why a page was read: its date said it changed, or its date said it didn't

SAME_DATE_SHARE = 0.8  # when this share of a sitemap's dated pages carry one day, the dates say nothing (F62)
SAME_DATE_MIN = 20
OTHERS_SHARE = 3  # at least a third of the day's reads go to pages the sitemap's dates don't point at, when there are any


def _lastmod(value: str | None) -> datetime | date | None:
    """A sitemap date read once (F128): W3C/ISO as the protocol says, or the e-mail form some sites write ("Tue, 03 Feb 2015").
    A date with a time is a moment in UTC; a plain day stays a day. Anything else is no date."""
    raw = (value or "").strip()
    if not raw:
        return None
    if len(raw) == 10:
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None
    moment = sitemap.parse_lastmod(raw)  # aware, in UTC; None when it can't be read
    return moment.replace(tzinfo=None) if moment else None


def _sitemap_date_is_newer(lastmod, checked_at) -> bool:
    """A day the same as the last read's counts as newer: the edit may have come after it, and it costs one read at most,
    since the next read is on a later day."""
    when = _lastmod(lastmod) if isinstance(lastmod, str) or lastmod is None else lastmod
    if when is None or not checked_at:
        return False
    if isinstance(when, datetime):
        return when > checked_at
    return when >= checked_at.date()


def _dates_say_nothing(urls: dict[str, str | None]) -> bool:
    """A sitemap that stamps every page with the same day (often "today") tells nothing about what changed."""
    days = [d.date() if isinstance(d, datetime) else d for d in (_lastmod(v) for v in urls.values()) if d is not None]
    if len(days) < SAME_DATE_MIN:
        return False
    most = max(days.count(day) for day in set(days))
    return most >= SAME_DATE_SHARE * len(days)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)  # the database keeps UTC without a zone


def _wordpress_dates(fetcher, start_url: str, host: str, charge) -> dict[str, tuple[str, datetime]] | None:
    """WordPress's own list of its latest edits, by page: the posts and the pages most recently changed, with the time
    of each change. Public and free, and honest where a sitemap plugin isn't. None when the site has no such list."""
    origin = "/".join(start_url.split("/")[:3])
    found: dict[str, tuple[str, datetime]] = {}
    answered = False
    for kind in ("posts", "pages"):
        address = f"{origin}/wp-json/wp/v2/{kind}?per_page={WP_PER_LIST}&orderby=modified&order=desc&_fields=link,modified_gmt"
        reply = fetcher.get(address, any_type=True, stay_on=lambda url: on_host(host_and_domain(url)[0], host))
        charge()
        if reply.status != "ok" or not reply.body:
            continue
        try:
            items = json.loads(reply.body)
        except ValueError:
            continue
        if not isinstance(items, list):
            continue
        answered = True
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("link"), str):
                continue
            try:
                when = datetime.fromisoformat(str(item.get("modified_gmt") or "")[:19])
            except ValueError:
                continue
            normal = canonical_url(item["link"])
            if normal and on_host(host_and_domain(normal)[0], host):
                found[page_key(normal)] = (normal, when)
    return found if answered else None


def _dates_trusted(row) -> bool:
    """The site's dates stop counting once they've kept quiet about enough of the edits the app found itself."""
    agreed, missed = int(row.get("dates_agreed") or 0), int(row.get("dates_missed") or 0)
    return not (missed >= TRUST_MIN_MISSES and missed > TRUST_MISS_SHARE * (agreed + missed))


def _has_dates(urls: dict[str, str | None]) -> bool:
    return bool(urls) and sum(1 for value in urls.values() if _lastmod(value) is not None) >= HAS_DATES_SHARE * len(urls)


def _search_signals(conn, ascii_host: str) -> tuple[set[str], set[str], dict[str, tuple[datetime, str, str, str]]]:
    """From my recent ranking checks: this site's pages placed in the top TOP_RANK, all its ranking pages, and the pages
    whose title in the results changed between two checks of the same keyword, a sign of an edit: (when it was seen, the
    page's address, the title before, the title now)."""
    rows = conn.execute(
        text(
            "SELECT r.url, r.position, r.title, c.target_id, c.tool, c.checked_at FROM serp_results r JOIN serp_checks c ON c.id = r.check_id "
            "WHERE (r.host = :h OR r.host LIKE :sub) AND c.status = 'ok' AND c.checked_at >= UTC_TIMESTAMP(3) - INTERVAL :d DAY "
            "ORDER BY c.checked_at DESC, c.id DESC LIMIT 20000"
        ),
        {"h": ascii_host, "sub": f"%.{ascii_host}", "d": RANKING_DAYS},
    ).mappings()
    top, ranking, moved, latest = set(), set(), {}, {}
    for row in rows:
        url = canonical_url(row["url"])
        if not url:
            continue
        key = page_key(url)
        ranking.add(key)
        if row["position"] is not None and row["position"] <= TOP_RANK:
            top.add(key)
        title = (row["title"] or "").strip()
        if not title:
            continue
        seen = (key, row["target_id"], row["tool"])
        if seen not in latest:
            latest[seen] = (title, row["checked_at"])  # newest first
        elif latest[seen] is not None:
            newest, when = latest[seen]
            if newest != title and key not in moved:
                moved[key] = (when, url, title, newest)
            latest[seen] = None  # only the two newest checks are compared
    return top, ranking, moved


def _read_today(engine: Engine, domain_id: int) -> int:
    with engine.connect() as conn:
        return conn.execute(text("SELECT COUNT(*) FROM pages WHERE domain_id = :i AND last_checked_at >= UTC_DATE()"), {"i": domain_id}).scalar()


def _plan(engine: Engine, competitor_id: int, site, baseline_done: bool, fetcher, charge) -> dict | None:
    """Decides today's reading, or says why there is none and returns None."""
    host, start_url = site["host"], site["start_url"]
    domain_id = crawl_store.get_or_create_domain(engine, host)
    room = PAGES_PER_DAY - _read_today(engine, domain_id)
    if room <= 0:
        _finish(engine, competitor_id, "ok", TODAY_DONE_TEXT)
        return None
    urls, front_status, complete_list, source, capped, cut = _discover(fetcher, start_url, host, charge)
    start_page_readable = front_status in READABLE_STATUSES
    if start_page_readable or len(urls) > 1:  # a blocked site's empty list says nothing about how it lists its pages
        _set(engine, competitor_id, list_source=source, list_capped=capped)
    if not start_page_readable and len(urls) <= 1:
        if front_status in ("robots", "blocked"):
            _finish(engine, competitor_id, "blocked", BLOCKED_TEXT)
        elif front_status == "rate_limited":
            _finish(engine, competitor_id, "ok", SLOW_DOWN_TEXT)
        else:
            _finish(engine, competitor_id, "failed", LEFT_TEXT if front_status == "left_scope" else DOWN_TEXT)
        return None

    ascii_host = to_ascii_host(host)
    with engine.connect() as conn:
        known = {
            page_key(row["url"]): row  # by page, so a site moving from http to https or to www isn't a whole new site
            for row in conn.execute(
                text(
                    "SELECT url, last_status, content_hash, read_with, internal_links, last_checked_at, last_checked_at >= UTC_DATE() AS today, "
                    "last_checked_at < UTC_TIMESTAMP(3) - INTERVAL :d DAY AS stale, last_checked_at < UTC_TIMESTAMP(3) - INTERVAL :u DAY AS unlisted_due, "
                    "last_checked_at < UTC_TIMESTAMP(3) - INTERVAL :f DAY AS few_days, last_changed_at >= UTC_TIMESTAMP(3) - INTERVAL :r DAY AS edited_lately, "
                    "NOT EXISTS (SELECT 1 FROM page_links l WHERE l.page_id = pages.id) AS no_links "
                    "FROM pages WHERE domain_id = :i ORDER BY id"
                ),
                {"i": domain_id, "d": REREAD_DAYS, "u": UNLISTED_DAYS, "f": EVERY_FEW_DAYS, "r": RECENT_EDIT_DAYS},
            ).mappings()
        }
        ranking = [
            canonical_url(row[0])
            for row in conn.execute(text("SELECT DISTINCT r.url FROM serp_results r WHERE r.host = :h OR r.host LIKE :sub LIMIT 500"), {"h": ascii_host, "sub": f"%.{ascii_host}"})
        ]
        top, _recent_ranking, serp_moved = _search_signals(conn, ascii_host)
        state = dict(conn.execute(text("SELECT wp_api, wp_checked_at, dates_agreed, dates_missed FROM competitor_crawls WHERE competitor_id = :c"), {"c": competitor_id}).mappings().first() or {})

    listed = {page_key(url): (url, lastmod) for url, lastmod in urls.items()}
    site_lists = set(listed)  # what the site itself lists, before the pages only a Firecrawl list added (those aren't news)
    for key, row in known.items():  # pages a Firecrawl list added, which the site itself doesn't list: never tried yet
        if row["last_status"] is None and not row["content_hash"]:
            listed.setdefault(key, (row["url"], None))
    ranking_by_key = {page_key(url): url for url in ranking if url}
    live = {key for key, row in known.items() if row["content_hash"] and row["last_status"] != "gone"}
    size = len(set(listed) | live | set(ranking_by_key))

    # How this site is followed today: every page when it's small, else WordPress's list of edits, else honest sitemap
    # dates, else tiers (ranking and hub pages daily, other ranking and lately edited pages every few days, the rest in turn).
    wp_dates: dict[str, datetime] = {}
    if size > FULL_DAILY_PAGES or size > PAGES_PER_DAY:
        checked = state.get("wp_checked_at")
        if state.get("wp_api") != "no" or not checked or checked < _now() - timedelta(days=WP_RECHECK_DAYS):
            answer = _wordpress_dates(fetcher, start_url, host, charge)
            _set(engine, competitor_id, wp_api="yes" if answer is not None else "no", wp_checked_at=_now())
            for key, (address, when) in (answer or {}).items():
                wp_dates[key] = when
                if key not in listed and key not in known:  # WordPress may know pages the sitemap leaves out
                    listed[key] = (address, None)
                    site_lists.add(key)
    dates_mean_something = not _dates_say_nothing(urls)
    trust_dates = dates_mean_something and _dates_trusted(state)
    if size <= FULL_DAILY_PAGES and size <= PAGES_PER_DAY:
        mode = ALL
    elif wp_dates:
        mode = WORDPRESS
    elif trust_dates and _has_dates(urls):
        mode = SITEMAP
    else:
        mode = TIERS
    _set(engine, competitor_id, follow_mode=mode)
    start_key = page_key(canonical_url(start_url) or start_url)
    hubs = {start_key} | {
        key for key, row in sorted(known.items(), key=lambda item: -(item[1]["internal_links"] or 0))[:HUB_PAGES]
        if row["content_hash"] and (row["internal_links"] or 0) >= HUB_MIN_LINKS
    } if mode == TIERS else set()

    # Each holds (when it was last read, [url, can_be_new, why]): the longest unread go first, so no page waits for ever (F62).
    new, due, daily, few, unlisted, rest = [], [], [], [], [], []
    # Pages that rank for my keywords are always watched, and go first: a large site's first pass takes days.
    for key in dict.fromkeys([*ranking_by_key, *listed]):
        url, lastmod = listed.get(key) or (ranking_by_key[key], None)
        row = known.get(key)
        if row is None:
            new.append([url, key in listed, "", lastmod])  # a page only seen in search results isn't new, it's newly noticed
            continue
        if row["today"] or row["read_with"] == "firecrawl":
            continue  # read already, or only Firecrawl can read it (its weekly check, when the owner said yes)
        if not row["content_hash"]:
            # Never read well yet, so its first good read can still be news (F69), when the site lists it.
            if row["last_checked_at"] is None:  # known but never tried, such as a page a Firecrawl list added: first in line
                due.append((None, [url, key in site_lists, ""]))
            elif row["last_status"] not in SETTLED_STATUSES or row["stale"]:
                rest.append((row["last_checked_at"], [url, key in site_lists, ""]))  # tried again, but not ahead of pages with news
            continue
        checked = row["last_checked_at"]
        wp_when = wp_dates.get(key)
        if wp_when is not None:
            date_moved, why = wp_when >= checked, ""
        else:
            date_moved = dates_mean_something and _sitemap_date_is_newer(lastmod, checked)
            why = (DATE if date_moved else QUIET) if dates_mean_something and _lastmod(lastmod) is not None else ""
        moved_in_search = key in serp_moved and serp_moved[key][0] > checked
        entry = (checked, [url, False, why])
        if (date_moved and (trust_dates or wp_when is not None)) or moved_in_search:
            due.append(entry)
        elif mode == ALL or (mode == TIERS and (key in top or key in hubs)):
            daily.append(entry)
        elif mode == TIERS and (key in ranking_by_key or row["edited_lately"]) and row["few_days"]:
            few.append(entry)
        elif mode == TIERS and key not in ranking_by_key and not row["edited_lately"]:
            rest.append(entry)  # in turn with what's left of the day, without waiting REREAD_DAYS
        elif row["stale"] or row["no_links"]:  # its links were never saved (the site map's "By links" view): read in turn, behind the news
            rest.append(entry)
    for key, row in known.items():  # the site no longer lists these: reading them is how a removed page gets noticed
        if key in listed or key in ranking_by_key or not row["content_hash"] or row["last_status"] == "gone" or row["today"] or row["read_with"] == "firecrawl":
            continue
        if mode == ALL or (complete_list and row["unlisted_due"]):
            unlisted.append((row["last_checked_at"], [row["url"], False, ""]))
        elif row["stale"] or mode == TIERS:
            rest.append((row["last_checked_at"], [row["url"], False, ""]))
    oldest = lambda items: [entry for _when, entry in sorted(items, key=lambda x: x[0] or datetime.min)]  # noqa: E731
    due, others = oldest(due) + oldest(daily) + oldest(few), oldest(unlisted + rest)
    after_new = max(0, room - len(new))
    keep = min(len(others), after_new // OTHERS_SHARE) if len(due) + len(others) > after_new else len(others)
    todo = new + due[: after_new - keep] + others[:keep]
    todo += [entry for entry in due[after_new - keep:] + others[keep:]][: max(0, room - len(todo))]
    with engine.begin() as conn:
        noise.refresh_repeated(conn, domain_id)  # the site's template, from its own pages, once a day
        watch_start = conn.execute(text("SELECT MIN(first_seen_at) FROM pages WHERE domain_id = :d"), {"d": domain_id}).scalar()
        waited = bool(conn.execute(text("SELECT :w < UTC_TIMESTAMP(3) - INTERVAL :n DAY"), {"w": watch_start, "n": FIRST_PASS_WAIT_DAYS}).scalar()) if watch_start else False
    listed_all = len(new) <= room
    # Too many sitemap files is the same every day, like a capped list; a failed file may load tomorrow, so the first read
    # waits for it, but only FIRST_PASS_WAIT_DAYS from the first page seen, never for ever (#6).
    whole = complete_list or source != "sitemap" or capped or cut == "files" or waited
    return {
        "part": 0,
        "todo": todo[:room],
        # The first read ends only once the whole list has been read: a sitemap file that failed today (W2) leaves pages
        # out of the list, and they'd all be reported as new tomorrow. A list from a feed or links is never "whole".
        "first_pass_ends": not baseline_done and listed_all and whole,
        "cut": cut if not complete_list and not capped else None,
        "waits_for_list": not baseline_done and listed_all and not whole,
        "watch_start": (watch_start or _now()).isoformat(),
        "start_page_readable": start_page_readable,
        "known": len(listed),
        "read": 0,
        "good": 0,
        "robots": 0,
        "failures": 0,
    }


def _report_event(engine: Engine, url: str, domain_id: int, kind: str) -> None:
    column = "after_value" if kind == "new_page" else "before_value"
    with engine.begin() as conn:
        page_id = conn.execute(text("SELECT id FROM pages WHERE url_hash = :h"), {"h": pages.url_hash(url)}).scalar()
        if page_id:
            conn.execute(text(f"INSERT INTO change_events (page_id, domain_id, kind, {column}) VALUES (:p, :d, :k, :v)"), {"p": page_id, "d": domain_id, "k": kind, "v": url})


def own_day(extras: dict | None, sitemap_date=None, first_archived=None):
    """The day a page says it was published, else the earliest of its sitemap date and first Wayback copy."""
    published = pagedates.page_day((extras or {}).get("published"))
    if published:
        return min(published, date.today())  # a page dated next year is new today at the earliest, never older (N6)
    others = [d for d in (pagedates.page_day(sitemap_date), pagedates.page_day(first_archived)) if d]
    return min(others) if others else None


def _report_new(engine: Engine, url: str, domain_id: int, lastmod, watch_start) -> None:
    """A page found after the first read is new only when its own date (or, with none, the day it was found) is after
    watching began. An older page the app found late is kept as "found later", not shown (SEO review 2026-11-17, W2)."""
    with engine.begin() as conn:
        row = conn.execute(text("SELECT id, extras, first_archived FROM pages WHERE url_hash = :h"), {"h": pages.url_hash(url)}).mappings().first()
        if not row:
            return
        day = _lastmod(lastmod)
        if day is not None:
            conn.execute(text("UPDATE pages SET sitemap_lastmod = :d WHERE id = :i"), {"d": day.date() if isinstance(day, datetime) else day, "i": row["id"]})
        extras = json.loads(row["extras"]) if isinstance(row["extras"], str) else row["extras"]
        stated = own_day(extras, day, row["first_archived"])
        start = pagedates.page_day(watch_start)
        old = stated is not None and start is not None and stated < start - timedelta(days=1)
        conn.execute(
            text("INSERT INTO change_events (page_id, domain_id, kind, after_value, hidden, hidden_reason) VALUES (:p, :d, 'new_page', :v, :h, :r)"),
            {"p": row["id"], "d": domain_id, "v": url, "h": old, "r": noise.FOUND_LATER if old else None},
        )


def _read_pages(engine: Engine, competitor_id: int, site, plan: dict, baseline_done: bool, fetcher, meter) -> None:
    host = site["host"]
    domain_id = crawl_store.get_or_create_domain(engine, host)
    started = time.monotonic()
    todo, read_now = plan["todo"], 0
    stop: tuple[str, str] | None = None
    while todo:
        if read_now and time.monotonic() - started >= CHUNK_SECONDS:
            plan["part"] += 1
            queue.enqueue(engine, LANE, JOB_KIND, payload={"competitor_id": competitor_id, "plan": plan}, dedupe_key=f"competitor:{competitor_id}:part:{plan['part']}", max_attempts=2)
            return
        if not budget.has_room(engine):
            stop = ("ok", BUDGET_TEXT)
            break
        entry = todo.pop(0)
        url, can_be_new, why = entry[0], entry[1], entry[2] if len(entry) > 2 else ""
        lastmod = entry[3] if len(entry) > 3 else None
        with engine.connect() as conn:
            before = conn.execute(text("SELECT content_hash, last_status FROM pages WHERE url_hash = :h"), {"h": pages.url_hash(url)}).mappings().first()
        try:
            outcome = pages.read_page(engine, url, host, fetcher)
        except Exception as exc:  # noqa: BLE001 - one page failing is saved as such, so it doesn't go first again tomorrow and stop the day (F97)
            outcome = pages.UNREADABLE
            crawl_store.save_fetch(engine, domain_id, url, FetchResult(url=url, status=pages.UNREADABLE, error=f"{type(exc).__name__}: {exc}"[:300]), None)
        meter.charged = fetcher.requests
        read_now += 1
        plan["read"] += 1
        if (before is None or not before["content_hash"]) and can_be_new and baseline_done and outcome == "baseline":  # a row with no text yet is new too (F69)
            _report_new(engine, url, domain_id, lastmod, plan.get("watch_start"))
        elif before is not None and before["content_hash"] and before["last_status"] != "gone" and outcome == "gone":
            _report_event(engine, url, domain_id, "page_gone")
        if outcome == "changed" and why in (DATE, QUIET):  # an edit found: had the site's own date said so?
            column = "dates_agreed" if why == DATE else "dates_missed"
            with engine.begin() as conn:
                conn.execute(text(f"UPDATE competitor_crawls SET {column} = {column} + 1 WHERE competitor_id = :c"), {"c": competitor_id})
        _set(engine, competitor_id, pages_read=plan["read"], pages_known=plan["known"])

        plan["robots"] += outcome == "robots"
        plan["good"] += outcome in ("baseline", "changed", "unchanged", "not_modified", "firecrawl", "moved", pages.UNCONFIRMED)
        plan["failures"] = plan["failures"] + 1 if outcome in ("blocked", "network_error", "server_error") else 0
        if outcome == "rate_limited":
            stop = ("ok", SLOW_DOWN_TEXT)
        elif plan["failures"] >= STOP_AFTER_FAILURES:
            stop = ("blocked", BLOCKED_TEXT) if outcome == "blocked" else ("failed", DOWN_TEXT)
        if stop:
            break

    totals = {"pages_read": plan["read"], "pages_known": plan["known"]}
    with engine.begin() as conn:
        # The day's reads are in: what the site shows on many pages today is its template, and an edit recorded before
        # that was known (a widget label changed on every page) is hidden now (SEO review 2026-11-17, W1).
        noise.refresh_repeated(conn, domain_id)
        noise.recheck_events(conn, domain_id)
    if stop:  # stopped early: what's left is for tomorrow, and a first pass isn't finished
        _finish(engine, competitor_id, stop[0], stop[1], **totals)
    elif plan["robots"] and not plan["good"] and not plan["start_page_readable"]:  # only a few allowed files, and no pages
        _finish(engine, competitor_id, "blocked", BLOCKED_TEXT, **totals)
    elif plan["first_pass_ends"] or baseline_done:
        _finish(engine, competitor_id, "ok", CUT_TEXT if plan.get("cut") else None, baseline_done=True, **totals)
    elif plan.get("waits_for_list"):
        _finish(engine, competitor_id, "ok", CUT_WAIT_TEXT, **totals)
    else:
        _finish(engine, competitor_id, "ok", f"First read of this site: {plan['read']} pages today, of about {plan['known']}. It carries on tomorrow, up to {PAGES_PER_DAY} pages a day.", **totals)


class _Meter:
    """Charges the daily budget for what the fetcher has sent since the last charge."""

    def __init__(self, engine: Engine, fetcher):
        self.engine, self.fetcher, self.charged = engine, fetcher, 0

    def charge(self) -> None:
        if self.fetcher.requests > self.charged:
            budget.charge(self.engine, self.fetcher.requests - self.charged)
            self.charged = self.fetcher.requests


@handler(JOB_KIND)
def run_crawl(job, engine: Engine) -> None:
    payload = job.payload or {}
    competitor_id, plan = payload.get("competitor_id"), payload.get("plan")
    with engine.connect() as conn:
        site = conn.execute(text("SELECT id, host, start_url, kind FROM sites WHERE id = :i"), {"i": competitor_id}).mappings().first()
        if site is None or site["kind"] not in (links_service.COMPETITOR, links_service.OWN):
            return  # my own sites are read too (owner, 2026-11-09), so a profile's "You" is real
        if plan is None and conn.execute(text("SELECT 1 FROM jobs WHERE active_key LIKE :k LIMIT 1"), {"k": f"competitor:{competitor_id}:part:%"}).first():
            return  # today's reading is still going, and it carries on by itself
        paused = site["kind"] == links_service.COMPETITOR and not tracking.reads_pages(conn, competitor_id)
    if paused:
        # Turned off after this job was queued: nothing is fetched, and a read that never ran stops saying it's waiting.
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM competitor_crawls WHERE competitor_id = :c AND status = 'queued' AND finished_at IS NULL"), {"c": competitor_id})
            conn.execute(text("UPDATE competitor_crawls SET status = 'ok' WHERE competitor_id = :c AND status = 'queued'"), {"c": competitor_id})
        return
    with engine.begin() as conn:
        started = ", started_at = UTC_TIMESTAMP(3)" if plan is None else ""
        conn.execute(
            text(f"INSERT INTO competitor_crawls (competitor_id, status, started_at) VALUES (:c, 'running', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE status = 'running'{started}"),
            {"c": competitor_id},
        )
        baseline_done = bool(conn.execute(text("SELECT baseline_done FROM competitor_crawls WHERE competitor_id = :c"), {"c": competitor_id}).scalar())

    fetcher = links_service.fetcher_factory()
    meter = _Meter(engine, fetcher)
    try:
        if plan is None:
            if not budget.has_room(engine):
                _finish(engine, competitor_id, "ok", BUDGET_TEXT)
                return
            plan = _plan(engine, competitor_id, site, baseline_done, fetcher, meter.charge)
        if plan is not None:
            _read_pages(engine, competitor_id, site, plan, baseline_done, fetcher, meter)
    except Exception as exc:  # noqa: BLE001 - one site failing must say so, not stay running
        _finish(engine, competitor_id, "failed", f"{type(exc).__name__}: {exc}")
    finally:
        meter.charge()
        fetcher.close()


def enqueue_due(engine: Engine) -> list[int]:
    """Every competitor a site of mine watches, and my own sites, once a day. Safe to call as often as cron likes.
    My sites are read the same way so their pages sit beside the competitor's on a profile; the row in
    competitor_crawls is keyed by the site's id whatever its kind."""
    with engine.connect() as conn:
        due = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT DISTINCT sc.competitor_id FROM site_competitors sc LEFT JOIN competitor_crawls cc ON cc.competitor_id = sc.competitor_id "
                    f"WHERE {tracking.PAGES_SQL} AND (cc.finished_at IS NULL OR cc.finished_at < UTC_DATE()) ORDER BY sc.competitor_id"
                )
            )
        ]
        due += [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT s.id FROM sites s LEFT JOIN competitor_crawls cc ON cc.competitor_id = s.id "
                    "WHERE s.kind = 'own' AND (cc.finished_at IS NULL OR cc.finished_at < UTC_DATE()) ORDER BY s.id"
                )
            )
        ]
    for competitor_id in due:
        queue.enqueue(engine, LANE, JOB_KIND, payload={"competitor_id": competitor_id}, dedupe_key=f"competitor:{competitor_id}", max_attempts=2)
    return due


SEARCH_TITLE = "search_title"  # a change event: the title in my ranking checks changed, on a site the app can't read


def guess_blocked_edits(engine: Engine) -> int:
    """A site that blocks the reader can't be read, so its edits are guessed from outside, for free: when two of my ranking
    checks of the same keyword show its page with different titles, the timeline says “Search title changed”.
    Each new title is reported once."""
    with engine.connect() as conn:
        hosts = [
            (row[0], row[1])
            for row in conn.execute(
                text(f"SELECT DISTINCT s.id, s.host FROM competitor_crawls cc JOIN sites s ON s.id = cc.competitor_id JOIN site_competitors sc ON sc.competitor_id = s.id WHERE cc.status = 'blocked' AND {tracking.PAGES_SQL}")
            )
        ]
    added = 0
    for _competitor_id, host in hosts:
        with engine.connect() as conn:
            _top, _ranking, moved = _search_signals(conn, to_ascii_host(host))
        if not moved:
            continue
        domain_id = crawl_store.get_or_create_domain(engine, host)
        for _key, (_when, url, before, after) in moved.items():
            with engine.begin() as conn:
                conn.execute(text("INSERT IGNORE INTO pages (domain_id, url, url_hash) VALUES (:d, :u, :h)"), {"d": domain_id, "u": url, "h": pages.url_hash(url)})
                page_id = conn.execute(text("SELECT id FROM pages WHERE url_hash = :h"), {"h": pages.url_hash(url)}).scalar()
                seen = conn.execute(
                    text("SELECT 1 FROM change_events WHERE page_id = :p AND kind = :k AND after_value = :a LIMIT 1"), {"p": page_id, "k": SEARCH_TITLE, "a": after}
                ).first()
                if seen:
                    continue
                conn.execute(
                    text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value) VALUES (:p, :d, :k, :b, :a)"),
                    {"p": page_id, "d": domain_id, "k": SEARCH_TITLE, "b": before, "a": after},
                )
                added += 1
    return added


def queue_own_if_never_read(engine: Engine, site_id: int) -> bool:
    """When a competitor is added, my site is read now if it never was, so the profile can compare at once."""
    with engine.connect() as conn:
        kind = conn.execute(text("SELECT kind FROM sites WHERE id = :s"), {"s": site_id}).scalar()
        read = conn.execute(text("SELECT 1 FROM competitor_crawls WHERE competitor_id = :s"), {"s": site_id}).first()
    if kind != links_service.OWN or read:
        return False
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO competitor_crawls (competitor_id, status) VALUES (:s, 'queued')"), {"s": site_id})
    queue.enqueue(engine, LANE, JOB_KIND, payload={"competitor_id": site_id}, dedupe_key=f"competitor:{site_id}", max_attempts=2)
    return True


def own_count(engine: Engine, site_ids: list[int]) -> int:
    """How many of these are my own sites, for the nightly log line."""
    if not site_ids:
        return 0
    with engine.connect() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM sites WHERE kind = 'own' AND id IN ({','.join(str(int(i)) for i in site_ids)})")).scalar())
