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

import time
from datetime import date, datetime
from urllib.parse import urljoin

from lxml import etree, html as lxml_html
from sqlalchemy import Engine, text

from seo.competitors import pages, tracking
from seo.core import budget
from seo.crawl import sitemap, store as crawl_store
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
BLOCKED_TEXT = "This site doesn't allow automated visitors, so its edits can't be tracked. The app doesn't try to get past that."
BUDGET_TEXT = "Today's crawl budget is used up. This site's read carries on tomorrow."
TODAY_DONE_TEXT = "This site has had its reads for today. It carries on tomorrow."
SLOW_DOWN_TEXT = "The site asked the app to slow down, so it stopped for today. It carries on tomorrow."
DOWN_TEXT = "The site isn't answering properly right now. The app tries again tomorrow."
LEFT_TEXT = "This address now redirects to another website, so nothing was read."


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


def _discover(fetcher, start_url: str, host: str, charge) -> tuple[dict[str, str | None], str, bool, str, bool]:
    """What the site lists itself. Returns address -> sitemap date, how the start page answered, whether a sitemap listed
    everything, where the list came from (sitemap, feed or links), and whether the sitemap had more than MAX_DISCOVERED pages."""

    def stay_on(url: str) -> bool:
        return on_host(host_and_domain(url)[0], host)

    urls: dict[str, str | None] = {}
    found = sitemap.discover(fetcher, start_url, max_pages=MAX_DISCOVERED)
    charge()
    for entry in found.entries:
        normal = canonical_url(entry.url)
        if normal:
            urls[normal] = entry.lastmod
    complete_list = bool(urls) and not found.capped
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
    return urls, front.status, complete_list, source, bool(found.capped)


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
    urls, front_status, complete_list, source, capped = _discover(fetcher, start_url, host, charge)
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
                    "SELECT url, last_status, content_hash, last_checked_at, last_checked_at >= UTC_DATE() AS today, "
                    "last_checked_at < UTC_TIMESTAMP(3) - INTERVAL :d DAY AS stale, last_checked_at < UTC_TIMESTAMP(3) - INTERVAL :u DAY AS unlisted_due "
                    "FROM pages WHERE domain_id = :i ORDER BY id"
                ),
                {"i": domain_id, "d": REREAD_DAYS, "u": UNLISTED_DAYS},
            ).mappings()
        }
        ranking = [
            canonical_url(row[0])
            for row in conn.execute(text("SELECT DISTINCT r.url FROM serp_results r WHERE r.host = :h OR r.host LIKE :sub LIMIT 500"), {"h": ascii_host, "sub": f"%.{ascii_host}"})
        ]

    listed = {page_key(url): (url, lastmod) for url, lastmod in urls.items()}
    site_lists = set(listed)  # what the site itself lists, before the pages only a Firecrawl list added (those aren't news)
    for key, row in known.items():  # pages a Firecrawl list added, which the site itself doesn't list: never tried yet
        if row["last_status"] is None and not row["content_hash"]:
            listed.setdefault(key, (row["url"], None))
    ranking_by_key = {page_key(url): url for url in ranking if url}
    trust_dates = not _dates_say_nothing(urls)
    # Each holds (when it was last read, [url, can_be_new]): the longest unread go first, so no page waits for ever (F62).
    new, due, unlisted, rest = [], [], [], []
    # Pages that rank for my keywords are always watched, and go first: a large site's first pass takes days.
    for key in dict.fromkeys([*ranking_by_key, *listed]):
        url, lastmod = listed.get(key) or (ranking_by_key[key], None)
        row = known.get(key)
        if row is None:
            new.append([url, key in listed])  # a page only seen in search results isn't new, it's newly noticed
        elif row["today"]:
            continue
        elif not row["content_hash"]:
            # Never read well yet, so its first good read can still be news (F69), when the site lists it.
            if row["last_checked_at"] is None:  # known but never tried, such as a page a Firecrawl list added: first in line
                due.append((None, [url, key in site_lists]))
            elif row["last_status"] not in SETTLED_STATUSES or row["stale"]:
                rest.append((row["last_checked_at"], [url, key in site_lists]))  # tried again, but not ahead of pages with news
        elif trust_dates and _sitemap_date_is_newer(lastmod, row["last_checked_at"]):
            due.append((row["last_checked_at"], [url, False]))
        elif row["stale"]:
            rest.append((row["last_checked_at"], [url, False]))
    for key, row in known.items():  # the site no longer lists these: reading them is how a removed page gets noticed
        if key in listed or key in ranking_by_key or not row["content_hash"] or row["last_status"] == "gone" or row["today"]:
            continue
        if complete_list and row["unlisted_due"]:
            unlisted.append((row["last_checked_at"], [row["url"], False]))
        elif row["stale"]:
            rest.append((row["last_checked_at"], [row["url"], False]))
    oldest = lambda items: [entry for _when, entry in sorted(items, key=lambda x: x[0] or datetime.min)]  # noqa: E731
    due, others = oldest(due), oldest(unlisted + rest)
    after_new = max(0, room - len(new))
    keep = min(len(others), after_new // OTHERS_SHARE) if len(due) + len(others) > after_new else len(others)
    todo = new + due[: after_new - keep] + others[:keep]
    todo += [entry for entry in due[after_new - keep:] + others[keep:]][: max(0, room - len(todo))]
    return {
        "part": 0,
        "todo": todo[:room],
        "first_pass_ends": not baseline_done and len(new) <= room,
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
        url, can_be_new = todo.pop(0)
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
            _report_event(engine, url, domain_id, "new_page")
        elif before is not None and before["content_hash"] and before["last_status"] != "gone" and outcome == "gone":
            _report_event(engine, url, domain_id, "page_gone")
        _set(engine, competitor_id, pages_read=plan["read"], pages_known=plan["known"])

        plan["robots"] += outcome == "robots"
        plan["good"] += outcome in ("baseline", "changed", "unchanged", "not_modified", "firecrawl")
        plan["failures"] = plan["failures"] + 1 if outcome in ("blocked", "network_error", "server_error") else 0
        if outcome == "rate_limited":
            stop = ("ok", SLOW_DOWN_TEXT)
        elif plan["failures"] >= STOP_AFTER_FAILURES:
            stop = ("blocked", BLOCKED_TEXT) if outcome == "blocked" else ("failed", DOWN_TEXT)
        if stop:
            break

    totals = {"pages_read": plan["read"], "pages_known": plan["known"]}
    if stop:  # stopped early: what's left is for tomorrow, and a first pass isn't finished
        _finish(engine, competitor_id, stop[0], stop[1], **totals)
    elif plan["robots"] and not plan["good"] and not plan["start_page_readable"]:  # only a few allowed files, and no pages
        _finish(engine, competitor_id, "blocked", BLOCKED_TEXT, **totals)
    elif plan["first_pass_ends"] or baseline_done:
        _finish(engine, competitor_id, "ok", None, baseline_done=True, **totals)
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
