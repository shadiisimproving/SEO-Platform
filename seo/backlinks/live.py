"""Is a logged backlink still there: the monthly check, and the Check now button.

The page is read once through the polite fetcher: robots.txt, 3 s spacing, the private address guard and the daily budget all apply.
Nothing is ever deleted. A link that has gone is flagged lost, and comes back to live by itself if the link reappears.

One miss on the monthly check proves little, because pages fail and move for a day, so it's read again the next day and only then flagged.
A person pressing Check now has asked for an answer, so a clean miss counts at once. A page that couldn't be read is never a miss.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from urllib.parse import unquote, urljoin, urlsplit

from lxml import etree, html as lxml_html
from sqlalchemy import Engine, text

from seo.core import budget
from seo.core.errors import NotFound, Refused
from seo.health import service as health_service
from seo.links import service as links_service
from seo.links.urls import host_key
from seo.worker import queue
from seo.worker.runner import RunAgain, handler

JOB_KIND = "backlinks.check"
LANE = "crawl"
CHUNK_SECONDS = 40.0
CHECK_EVERY_DAYS = 30
RECHECK_HOURS = 20
MISSES_TO_LOSE = 2
FOUND, MISSING, PAGE_GONE, UNKNOWN = "found", "missing", "page_gone", "unknown"
SHOWN_URLS = 10
# Not worth waiting a month to find out again.
_SOON_REASONS = ("network", "server", "rate_limited")
_REASONS = {"robots": "robots", "blocked": "turned_away", "rate_limited": "rate_limited", "network_error": "network", "server_error": "server", "refused": "refused", "not_html": "not_html", "too_large": "too_large", "too_many_redirects": "redirects", "http_error": "http_error"}
_SPACES = re.compile(r"\s+")


@dataclass
class LinkSeen:
    found: bool = False
    href: str | None = None
    anchor: str | None = None
    rel: str | None = None
    is_nofollow: bool | None = None
    to_target: bool = False  # it points at the logged target page, not just somewhere on the site


@dataclass
class Reading:
    outcome: str
    reason: str | None = None
    http_status: int | None = None
    final_url: str | None = None
    seen: LinkSeen = field(default_factory=LinkSeen)


def clean_path(address: str | None) -> str:
    """What a page is called, whichever way it was written: no domain, query or fragment, no trailing slash, accents decoded.

    Phase 5 matches GA4's landing pages against this, so a target saved without its slash still matches.
    """
    value = (address or "").strip()
    if not value:
        return ""
    if value.startswith("//"):
        value = f"https:{value}"
    try:
        path = urlsplit(value if "://" in value else f"https://x/{value.lstrip('/')}").path
    except ValueError:
        return ""
    path = unquote(path).rstrip("/")
    return path or "/"


def _anchor_of(element) -> str:
    words = _SPACES.sub(" ", element.text_content() or "").strip()
    if words:
        return words[:1000]
    for image in element.iterfind(".//img"):  # a link that is only a picture: its alt text is the anchor
        alt = _SPACES.sub(" ", image.get("alt") or "").strip()
        if alt:
            return alt[:1000]
    return ""


def find_link(body: bytes, page_url: str, site_host: str, target: str | None) -> LinkSeen:
    """A link to my site on this page. The logged target page first, or else any link to the site."""
    try:
        doc = lxml_html.document_fromstring(body)
    except (ValueError, TypeError, etree.ParserError):
        return LinkSeen()
    base = doc.find(".//base[@href]")
    base_url = urljoin(page_url, base.get("href")) if base is not None else page_url
    wanted = clean_path(target)
    mine = host_key(f"https://{site_host}/")
    fallback = None
    for element in doc.iterfind(".//a[@href]"):
        try:
            href = urljoin(base_url, (element.get("href") or "").strip())
        except ValueError:
            continue
        if host_key(href) != mine:
            continue
        hits_target = bool(wanted) and clean_path(href) == wanted
        if hits_target or not wanted:
            return _seen(element, href, True)
        fallback = fallback if fallback is not None else (element, href)
    return _seen(fallback[0], fallback[1], False) if fallback else LinkSeen()


def _seen(element, href: str, to_target: bool) -> LinkSeen:
    rel = " ".join((element.get("rel") or "").lower().split())
    return LinkSeen(True, href[:2048], _anchor_of(element), rel[:120] or None, "nofollow" in rel.split(), to_target)


def read_page(fetcher, source_url: str, site_host: str, target: str | None) -> Reading:
    answer = fetcher.get(source_url)
    if answer.status == "gone":
        return Reading(PAGE_GONE, http_status=answer.http_status, final_url=answer.final_url)
    if answer.status != "ok" or answer.body is None:
        return Reading(UNKNOWN, _REASONS.get(answer.status, answer.status), answer.http_status, answer.final_url)
    final = answer.final_url or source_url
    seen = find_link(answer.body, final, site_host, target)
    return Reading(FOUND if seen.found else MISSING, http_status=answer.http_status, final_url=final, seen=seen)


# ---- saving what was seen ----------------------------------------------------------------------------

def _changes(row, seen: LinkSeen) -> list[dict]:
    """Compared with the last reading, never with what someone typed: an anchor logged loosely isn't a change."""
    changes = []
    if row["is_nofollow"] is not None and bool(row["is_nofollow"]) != bool(seen.is_nofollow):
        changes.append({"what": "nofollow", "before": bool(row["is_nofollow"]), "after": bool(seen.is_nofollow)})
    if row["seen_anchor"] is not None and row["seen_anchor"] != (seen.anchor or ""):
        changes.append({"what": "anchor", "before": row["seen_anchor"], "after": seen.anchor or ""})
    return changes


def _save(engine: Engine, row, reading: Reading, trigger: str, target_final: str | None) -> dict:
    """Returns what the caller should raise an alert about."""
    seen = reading.seen
    outcome = reading.outcome
    changes = _changes(row, seen) if outcome == FOUND else []
    misses = row["miss_count"]
    status = row["status"]
    went_lost = came_back = False
    if outcome == FOUND:
        misses = 0
        if status == "lost":
            status, came_back = "live", True
    elif outcome in (MISSING, PAGE_GONE):
        misses += 1
        if status == "live" and (trigger == "button" or misses >= MISSES_TO_LOSE):
            status, went_lost = "lost", True
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO backlink_checks (backlink_id, outcome, reason, trigger_kind, http_status, final_url, is_nofollow, rel, anchor, href, changes) "
                "VALUES (:b, :o, :r, :t, :h, :f, :n, :l, :a, :u, :c)"
            ),
            {"b": row["id"], "o": outcome, "r": reading.reason, "t": trigger, "h": reading.http_status, "f": reading.final_url, "n": seen.is_nofollow, "l": seen.rel, "a": seen.anchor, "u": seen.href, "c": json.dumps(changes, ensure_ascii=False) if changes else None},
        )
        # A reading that found nothing says nothing about nofollow or the anchor, so the last known ones stay.
        conn.execute(
            text(
                "UPDATE backlinks SET checked_at = UTC_TIMESTAMP(3), check_outcome = :o, check_reason = :r, final_url = COALESCE(:f, final_url), miss_count = :m, status = :st, "
                "is_nofollow = IF(:found, :n, is_nofollow), seen_rel = IF(:found, :l, seen_rel), seen_anchor = IF(:found, :a, seen_anchor), seen_href = IF(:found, :u, seen_href), "
                "target_final_url = COALESCE(:tf, target_final_url), lost_at = CASE WHEN :lost THEN UTC_TIMESTAMP(3) WHEN :back THEN NULL ELSE lost_at END WHERE id = :i"
            ),
            {"o": outcome, "r": reading.reason, "f": reading.final_url, "m": misses, "st": status, "found": outcome == FOUND, "n": seen.is_nofollow, "l": seen.rel, "a": seen.anchor or "", "u": seen.href, "tf": target_final, "lost": went_lost, "back": came_back, "i": row["id"]},
        )
    return {"lost": went_lost, "changes": changes}


def _raise_alert(engine: Engine, row, kind: str, title_one: str, title_many: str) -> None:
    """One open alert per site, as elsewhere. It adds up until someone has seen it."""
    with engine.connect() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": row["site_id"]}).scalar()
        open_detail = conn.execute(text("SELECT detail FROM alerts WHERE site_id = :s AND kind = :k AND acknowledged_at IS NULL"), {"s": row["site_id"], "k": kind}).scalar()
    before = json.loads(open_detail) if isinstance(open_detail, str) else (open_detail or {})
    urls = ([row["source_url"]] + [u for u in before.get("urls", []) if u != row["source_url"]])[:SHOWN_URLS]
    count = int(before.get("count", 0)) + (0 if row["source_url"] in before.get("urls", []) else 1)
    title = title_one.format(host=host) if count == 1 else title_many.format(host=host, n=count)
    health_service._alert(engine, row["site_id"], None, kind, "warn", title, {"count": count, "urls": urls})


def check_one(engine: Engine, row, fetcher, trigger: str, resolved: dict[str, str | None]) -> None:
    """Read one link's page, and save it. `resolved` remembers where my own target pages end up, so one page is only read once in a run."""
    with engine.connect() as conn:
        site_host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": row["site_id"]}).scalar()
    sent_before = fetcher.requests
    reading = read_page(fetcher, row["source_url"], site_host, row["target_url"])
    target_final = None
    if reading.outcome == FOUND and reading.seen.href:
        href = reading.seen.href
        if href not in resolved:
            answer = fetcher.get(href, any_type=True)
            resolved[href] = answer.final_url if answer.status in ("ok", "not_html", "too_large") else None
        target_final = resolved[href]
    budget.charge(engine, fetcher.requests - sent_before)
    result = _save(engine, row, reading, trigger, target_final)
    if result["lost"]:
        _raise_alert(engine, row, "backlink_lost", "{host}: a backlink was lost", "{host}: {n} backlinks were lost")
    if result["changes"]:
        _raise_alert(engine, row, "backlink_changed", "{host}: a backlink changed", "{host}: {n} backlinks changed")


_DUE = (
    "SELECT * FROM backlinks WHERE site_id = :s AND status IN ('live', 'lost') AND ("
    " checked_at IS NULL OR checked_at < UTC_TIMESTAMP(3) - INTERVAL :every DAY"
    " OR (status = 'live' AND miss_count > 0 AND checked_at < UTC_TIMESTAMP(3) - INTERVAL :soon HOUR)"
    " OR (check_outcome = 'unknown' AND check_reason IN ('network', 'server', 'rate_limited') AND checked_at < UTC_TIMESTAMP(3) - INTERVAL :soon HOUR)"
    ") ORDER BY checked_at IS NOT NULL, checked_at, id"
)
_DUE_ARGS = {"every": CHECK_EVERY_DAYS, "soon": RECHECK_HOURS}


@handler(JOB_KIND)
def run_check(job, engine: Engine) -> None:
    payload = job.payload or {}
    if payload.get("backlink_id"):
        _run_button(engine, payload["backlink_id"])
        return
    site_id = payload.get("site_id")
    with engine.connect() as conn:
        kind = conn.execute(text("SELECT kind FROM sites WHERE id = :s"), {"s": site_id}).scalar()
    if kind != links_service.OWN:  # the queue said so, and the worker checks again
        return
    if not budget.has_room(engine):
        raise RunAgain(budget.seconds_until_new_day(engine))
    started = time.monotonic()
    fetcher = links_service.fetcher_factory()
    resolved: dict[str, str | None] = {}
    done_ids: set[int] = set()
    try:
        while time.monotonic() - started < CHUNK_SECONDS and budget.has_room(engine):
            with engine.connect() as conn:
                row = next((r for r in conn.execute(text(_DUE), {"s": site_id, **_DUE_ARGS}).mappings() if r["id"] not in done_ids), None)
            if row is None:
                return
            done_ids.add(row["id"])
            check_one(engine, row, fetcher, "monthly", resolved)
    finally:
        fetcher.close()
    raise RunAgain(budget.seconds_until_new_day(engine) if not budget.has_room(engine) else 3)


def _run_button(engine: Engine, backlink_id: int) -> None:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM backlinks WHERE id = :i"), {"i": backlink_id}).mappings().first()
    if row is None or row["status"] in ("found", "ignored"):
        return
    fetcher = links_service.fetcher_factory()
    try:
        check_one(engine, row, fetcher, "button", {})
    finally:
        fetcher.close()


def enqueue_due(engine: Engine) -> list[int]:
    """Queue a check for each of my sites with a link that's due. Safe to call as often as cron likes."""
    with engine.connect() as conn:
        sites = [row[0] for row in conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id"))]
        due = [site_id for site_id in sites if conn.execute(text(f"SELECT 1 FROM ({_DUE}) d LIMIT 1"), {"s": site_id, **_DUE_ARGS}).first()]
    queued = []
    for site_id in due:
        if queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": site_id}, dedupe_key=f"backlinks:{site_id}", max_attempts=3) is not None:
            queued.append(site_id)
    return queued


def check_now(engine: Engine, backlink_id: int) -> bool:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT status FROM backlinks WHERE id = :i"), {"i": backlink_id}).mappings().first()
    if row is None:
        raise NotFound("That backlink doesn't exist.")
    if row["status"] in ("found", "ignored"):
        raise Refused("Log this link first, then it can be checked.")
    return queue.enqueue(engine, LANE, JOB_KIND, payload={"backlink_id": backlink_id}, dedupe_key=f"backlink:{backlink_id}", max_attempts=2) is not None


def history(engine: Engine, backlink_id: int, limit: int = 20) -> list[dict]:
    with engine.connect() as conn:
        if conn.execute(text("SELECT 1 FROM backlinks WHERE id = :i"), {"i": backlink_id}).first() is None:
            raise NotFound("That backlink doesn't exist.")
        rows = conn.execute(text("SELECT * FROM backlink_checks WHERE backlink_id = :i ORDER BY id DESC LIMIT :n"), {"i": backlink_id, "n": limit}).mappings().all()
    return [
        {
            "id": r["id"], "outcome": r["outcome"], "reason": r["reason"], "trigger": r["trigger_kind"], "http_status": r["http_status"], "final_url": r["final_url"],
            "is_nofollow": None if r["is_nofollow"] is None else bool(r["is_nofollow"]), "rel": r["rel"], "anchor": r["anchor"], "href": r["href"],
            "changes": (json.loads(r["changes"]) if isinstance(r["changes"], str) else r["changes"]) or [], "checked_at": r["checked_at"].strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        for r in rows
    ]


def summary(engine: Engine, site_id: int | None = None) -> dict:
    """For Today. Dates typed some other way ("le 3 mars") can't be counted here, and stay readable on the link itself."""
    where, args = ("site_id = :s", {"s": site_id}) if site_id is not None else ("site_id IN (SELECT id FROM sites WHERE kind = 'own')", {})
    iso = r"'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'"
    with engine.connect() as conn:
        follow_up = conn.execute(text(
            f"SELECT COUNT(*) FROM backlinks WHERE {where} AND ((status = 'planned' AND due REGEXP {iso} AND STR_TO_DATE(due, '%Y-%m-%d') <= UTC_DATE() + INTERVAL 7 DAY) "
            "OR (status = 'live' AND miss_count > 0))"
        ), args).scalar()
        renewals = conn.execute(text(
            f"SELECT COUNT(*) FROM backlinks WHERE {where} AND status = 'live' AND renewal REGEXP {iso} AND STR_TO_DATE(renewal, '%Y-%m-%d') BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL 30 DAY"
        ), args).scalar()
        lost = conn.execute(text(f"SELECT COUNT(*) FROM backlinks WHERE {where} AND status = 'lost' AND lost_at >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY"), args).scalar()
    return {"follow_up": int(follow_up), "renewals_30d": int(renewals), "lost_this_week": int(lost)}


def traffic_targets(engine: Engine, site_id: int) -> list[dict]:
    """What Phase 5 matches GA4 rows against: one entry per real link of a site.

    `paths` holds the logged target and where it really ends up, both from clean_path(), so a target that redirects also matches its final page.
    A planned link has no traffic to match, and nor does one a tool found that nobody logged.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, domain, status, target_url, target_final_url, seen_href, placed, created_at, utm_source, utm_medium, utm_campaign FROM backlinks WHERE site_id = :s AND status IN ('live', 'lost')"), {"s": site_id}).mappings().all()
    answer = []
    for row in rows:
        paths = []
        for address in (row["target_url"], row["seen_href"], row["target_final_url"]):
            path = clean_path(address)
            if path and path not in paths:
                paths.append(path)
        utm = {"source": row["utm_source"], "medium": row["utm_medium"], "campaign": row["utm_campaign"]} if row["utm_campaign"] or row["utm_source"] else None
        answer.append({"id": row["id"], "domain": row["domain"], "status": row["status"], "paths": paths, "utm": utm, "placed": row["placed"], "created_at": row["created_at"].strftime("%Y-%m-%d")})
    return answer


