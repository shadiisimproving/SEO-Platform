"""The sitemap checks of the monthly health test, for my own sites.

1. Find the sitemaps as seo/crawl/sitemap.py does for every other reader: robots.txt's Sitemap: lines, else the common
   addresses, index files followed, bounded and polite. Files are read up to Google's own 50 MB.
2. Learn what every listed page answers, asking as little as possible: what this test's crawl already saw comes first, then
   the daily read's answers in `pages` when they are at most FRESH_DAYS old, and only then one polite request per page, at
   most MAX_FETCHES per test, inside the daily request budget and the chunk's time. A test that runs out of time carries on in
   its next chunk from what it has learned (Progress is saved with the crawl). Pages still unknown are counted, never guessed.
3. Judge: the files (missing, unreachable, not XML, too big, not named in robots.txt), the listed pages (errors, redirects,
   noindex, blocked for Googlebot by robots.txt, canonical elsewhere), the dates (in the future, all the same), and the
   important pages left out: pages with Search Console clicks in the last 28 days, or pages the crawl found linked from the
   site, that can be indexed (answer themselves, no noindex, canonical to themselves) but are in no sitemap.

The weights are in seo/health/audit.py (SITEMAP_CHECKS), capped together at SITEMAP_MAX_COST.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.crawl import sitemap
from seo.crawl.extract import extract
from seo.health import audit
from seo.links.urls import host_key, normalize_url

REPORT_CODE = "sitemap"  # the health_issues row holding the whole report: page_count stays 0, like links_in
FRESH_DAYS = 7  # the daily read's answer stands for this long
MAX_FETCHES = 500  # listed or important pages asked about in one test, beyond what was already known
ROWS = 200  # rows kept per problem
MAX_URLS = 50_000  # Google's limit for one sitemap file
SAME_DATE_MIN = 10  # "every page has the same date" needs this many dated pages, or it's no pattern
FUTURE_GRACE = timedelta(days=1)  # time zones: a date up to a day ahead isn't in the future
GOOGLEBOT = "Googlebot"
HELD_BACK = "rate_limited"  # the site asked us to wait (429): the file wasn't asked, which says nothing about it
FETCH_FAILED = ("gone", "http_error", "server_error", "network_error", "robots", "blocked", "refused", "too_many_redirects", "left_scope", "redirect", "not_modified")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---- what is kept between chunks ------------------------------------------------------------------------

def listed_to_json(found: sitemap.SitemapResult) -> dict:
    return {
        "entries": [[e.url, e.lastmod] for e in found.entries], "sources": found.sources, "errors": found.errors, "problems": found.problems,
        "capped": found.capped, "cut": found.cut, "too_many_files": found.too_many_files, "from_robots": found.from_robots, "files": found.files,
    }


def listed_from_json(data: dict) -> sitemap.SitemapResult:
    return sitemap.SitemapResult(
        entries=[sitemap.Entry(url, lastmod) for url, lastmod in data.get("entries") or []], sources=list(data.get("sources") or []),
        errors=list(data.get("errors") or []), problems=dict(data.get("problems") or {}), capped=bool(data.get("capped")), cut=bool(data.get("cut")),
        too_many_files=bool(data.get("too_many_files")), from_robots=bool(data.get("from_robots")), files=dict(data.get("files") or {}),
    )


@dataclass
class Progress:
    listed: sitemap.SitemapResult
    clicked: list[list] = field(default_factory=list)  # [url, clicks] from Search Console, read once per test
    checked: dict[str, list] = field(default_factory=dict)  # answers learned by this step: normalized address -> [kind, detail]
    fetches: int = 0

    def to_json(self) -> dict:
        return {"listed": listed_to_json(self.listed), "clicked": self.clicked, "checked": self.checked, "fetches": self.fetches}

    @classmethod
    def from_json(cls, data: dict) -> Progress:
        return cls(listed_from_json(data["listed"]), list(data.get("clicked") or []), dict(data.get("checked") or {}), int(data.get("fetches") or 0))


@dataclass
class Outcome:
    listed: sitemap.SitemapResult | None = None
    report: dict | None = None
    paused: str | None = None  # "time" or "budget": carry on in the next chunk with `progress`
    stopped: bool = False
    progress: dict | None = None


# ---- what is already known ------------------------------------------------------------------------------

def known_from_pages(engine: Engine, host: str) -> dict[str, list]:
    """The daily read's answers for my site, at most FRESH_DAYS old, as page states. Only answers that say something."""
    known: dict[str, list] = {}
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT p.url, p.last_status, p.http_status, p.canonical, p.robots_meta, p.final_url, p.extras FROM pages p JOIN domains d ON d.id = p.domain_id "
            "WHERE d.host IN (:h, CONCAT('www.', :h)) AND p.last_checked_at > UTC_TIMESTAMP(3) - INTERVAL :d DAY"
        ), {"h": host, "d": FRESH_DAYS}).mappings().all()
    for r in rows:
        key = audit.address_key(r["url"])
        if not key:
            continue
        status, code = r["last_status"], r["http_status"]
        if status in ("ok", "not_modified", "baseline", "changed", "unchanged"):
            extras = r["extras"] if isinstance(r["extras"], dict) else json.loads(r["extras"] or "{}") if r["extras"] else {}
            if "noindex" in audit.robots_words(r["robots_meta"], (extras or {}).get("googlebot")):
                known[key] = ["noindex", None]
            elif r["canonical"] and audit._points_elsewhere(r["canonical"], r["url"]):
                known[key] = ["canonical", r["canonical"]]
            else:
                known[key] = ["ok", None]
        elif status == "moved" and r["final_url"]:
            known[key] = ["redirect", r["final_url"]]
        elif status == "gone" or status == "server_error" or (status == "http_error" and (code or 0) >= 400 and code not in (401, 403)):
            known[key] = ["broken", code or (500 if status == "server_error" else 404)]
    return known


def clicked_pages(engine: Engine, site_id: int, host: str) -> list[list]:
    """[url, clicks] for each page of my site with Search Console clicks in the last 28 days, most first."""
    from seo.health import indexing  # noqa: PLC0415 - indexing reads Search Console through metrics, which reads this package

    out = [[url, clicks] for url, clicks in indexing.clicked_pages(engine, site_id) if clicks > 0 and host_key(url) == host]
    return sorted(out, key=lambda r: (-r[1], r[0]))


# ---- asking -------------------------------------------------------------------------------------------

def _ask(fetcher, url: str, on_site: Callable[[str], bool]) -> list:
    result = fetcher.get(url, stay_on=on_site)
    holder = audit.Findings()
    fields = None
    if result.status == "ok" and result.body is not None:
        try:
            fields = extract(result.body, result.final_url or url, charset=result.charset)
        except (ValueError, RecursionError):
            fields = None
    if result.status == "robots" or result.held_back:
        return ["unknown", None]
    audit.note_status(holder, url, result, fields)
    return holder.statuses.get(audit.address_key(url), ["unknown", None])


def run(
    engine: Engine, site_id: int, host: str, start_url: str, fetcher, found: audit.Findings, saved: dict | None,
    can_continue: Callable[[], str | None], charge: Callable[[int], None],
) -> Outcome:
    """The whole sitemap step, or as much of it as this chunk has time for. can_continue: None to go on, else "stop", "time" or "budget"."""
    on_site = lambda url: host_key(url) == host  # noqa: E731
    asked_before = fetcher.requests
    if saved:
        progress = Progress.from_json(saved)
        fetcher.sitemaps_from_robots(start_url)  # a new chunk's fetcher reads robots.txt again, to judge Googlebot's rules
    else:
        listed = sitemap.discover(fetcher, start_url, max_pages=200_000, max_bytes=sitemap.MAX_UNZIPPED_BYTES)
        progress = Progress(listed=listed, clicked=clicked_pages(engine, site_id, host))
    charge(fetcher.requests - asked_before)
    known = known_from_pages(engine, host)

    def state_of(key: str) -> list | None:
        return found.statuses.get(key) or progress.checked.get(key) or known.get(key)

    # Every listed page, then the clicked pages that aren't listed: their answer decides whether they are left out.
    listed_keys = list(dict.fromkeys(k for k in (audit.address_key(e.url) for e in progress.listed.entries) if k))
    in_sitemap = set(listed_keys)
    ask_at = {audit.address_key(e.url): normalize_url(e.url) for e in progress.listed.entries}
    ask_at.update({audit.address_key(u): normalize_url(u) for u, _ in progress.clicked if audit.address_key(u) not in ask_at})
    wanted = listed_keys + [k for k in (audit.address_key(u) for u, _ in progress.clicked) if k and k not in in_sitemap]
    for key in wanted:
        if key in in_sitemap and fetcher.agent_may_fetch(ask_at[key], GOOGLEBOT) is False:
            progress.checked[key] = ["blocked", None]
            continue
        if state_of(key) is not None:
            continue
        if progress.fetches >= MAX_FETCHES:
            continue  # the rest stay unknown, and are counted as not checked
        why = can_continue()
        if why:
            if why == "stop":
                return Outcome(listed=progress.listed, stopped=True)
            return Outcome(listed=progress.listed, paused=why, progress=progress.to_json())
        before = fetcher.requests
        progress.checked[key] = _ask(fetcher, ask_at[key], on_site)
        progress.fetches += 1
        charge(fetcher.requests - before)
    statuses = {**known, **progress.checked, **found.statuses}
    for key, value in progress.checked.items():
        if value[0] == "blocked":
            statuses[key] = value  # Googlebot's rules win over what our crawler read
    return Outcome(listed=progress.listed, report=judge(progress.listed, statuses, progress.clicked, found, start_url))


# ---- judging --------------------------------------------------------------------------------------------

def _real_files(listed: sitemap.SitemapResult) -> dict[str, dict]:
    """The files that are sitemaps or claim to be: a common address answering with a web page is only a guess that missed."""
    return {url: f for url, f in listed.files.items() if not (f.get("guess") and f.get("html"))}


def _group(rows: list[dict], key=None) -> dict:
    if key:
        rows = sorted(rows, key=key)
    return {"count": len(rows), "rows": rows[:ROWS]}


def judge(listed: sitemap.SitemapResult, statuses: dict[str, list], clicked: list[list], found: audit.Findings, start_url: str, now: datetime | None = None) -> dict:
    now = now or _now()
    files = _real_files(listed)
    groups: dict[str, dict] = {}

    def put(code: str, rows: list[dict], key=None) -> None:
        if rows:
            groups[code] = _group(rows, key)

    readable = {u: f for u, f in files.items() if f["kind"] in ("index", "urlset")}
    held_back = [u for u, f in files.items() if f["kind"] == HELD_BACK]
    put("sitemap_unreachable", [{"url": u, "why": f["kind"]} for u, f in files.items() if f["kind"] in FETCH_FAILED])
    put("sitemap_invalid", [{"url": u} for u, f in files.items() if f["kind"] in ("error", "unknown")])
    put("sitemap_too_big", [{"url": u, "urls": f.get("urls", 0)} for u, f in files.items() if f["kind"] == "too_large" or f.get("urls", 0) > MAX_URLS])
    if not files:
        groups["sitemap_missing"] = {"count": 1, "rows": [{"url": u} for u in (urlsplit(start_url)._replace(path=p, query="").geturl() for p in sitemap.COMMON_PATHS[:3])]}
    elif readable and not listed.from_robots:
        put("sitemap_not_in_robots", [{"url": u} for u in listed.sources or list(readable)])

    entries = list({audit.address_key(e.url): e for e in listed.entries if audit.address_key(e.url)}.items())
    rows: dict[str, list[dict]] = {"listed_broken": [], "listed_redirect": [], "listed_noindex": [], "listed_blocked": [], "listed_canonical": []}
    unchecked = 0
    for key, entry in entries:
        kind, detail = (statuses.get(key) or ["unknown", None])[:2]
        if kind == "broken":
            rows["listed_broken"].append({"url": entry.url, "code": detail})
        elif kind == "redirect":
            rows["listed_redirect"].append({"url": entry.url, "to": detail})
        elif kind == "noindex":
            rows["listed_noindex"].append({"url": entry.url})
        elif kind == "blocked":
            rows["listed_blocked"].append({"url": entry.url})
        elif kind == "canonical":
            rows["listed_canonical"].append({"url": entry.url, "to": detail})
        elif kind != "ok":
            unchecked += 1
    for code, found_rows in rows.items():
        put(code, found_rows, key=lambda r: r["url"])

    dated = [(e.url, e.lastmod_at) for _, e in entries if e.lastmod_at is not None]
    put("lastmod_future", [{"url": u, "lastmod": at.strftime("%Y-%m-%d")} for u, at in dated if at > now + FUTURE_GRACE], key=lambda r: r["url"])
    if len(dated) >= SAME_DATE_MIN and len(dated) == len(entries) and len({at for _, at in dated}) == 1:
        groups["lastmod_same"] = {"count": len(dated), "rows": [], "date": dated[0][1].strftime("%Y-%m-%d")}

    # Important pages left out. Only said when the whole sitemap was read: a file that failed may hold them.
    complete = bool(readable) and not (listed.capped or listed.too_many_files or any(f["kind"] not in ("index", "urlset") for f in files.values()))
    in_sitemap = {key for key, _ in entries}
    important: dict[str, dict] = {}
    for url, clicks in clicked:
        key = audit.address_key(url)
        if key:
            important.setdefault(key, {"url": url, "clicks": int(clicks), "linked": False})
    start_key = audit.address_key(start_url)
    linked = [found.link_names[k] for k, n in found.links_in.items() if n and k in found.link_names] + [start_url]
    for url in linked:
        key = audit.address_key(url)
        if key and not urlsplit(key).query:  # filters and page numbers are left to the site's own rules
            important.setdefault(key, {"url": url, "clicks": 0, "linked": True})["linked"] = True
    missing = []
    for key, page in important.items():
        if (statuses.get(key) or [None])[0] == "ok" and key not in in_sitemap:
            missing.append(page)
    if complete:
        put("sitemap_missing_pages", missing, key=lambda r: (-r["clicks"], r["url"]))
    counts = {code: g["count"] for code, g in groups.items()}
    return {
        "found": bool(readable), "from_robots": listed.from_robots, "files": [{"url": u, "kind": f["kind"], "urls": f.get("urls", 0)} for u, f in files.items()][:ROWS],
        "listed": len(entries), "unchecked": unchecked, "complete": complete, "important": len(important) if complete else 0,
        "missing_not_judged": not complete and bool(readable), "held_back": held_back[:ROWS],
        "groups": groups, "counts": counts,
    }


def issue_pages(report: dict) -> dict[str, list[str]]:
    """Each problem with its addresses, as the health test's other checks are kept: for Pages, tasks and the history."""
    return {code: [r["url"] for r in g["rows"]] for code, g in (report.get("groups") or {}).items()}


def score_input(report: dict | None) -> dict | None:
    if not report:
        return None
    return {"counts": report.get("counts") or {}, "listed": report.get("listed", 0), "important": report.get("important", 0)}


BAD_FILE = ("sitemap_missing", "sitemap_unreachable", "sitemap_invalid")


def summary(report: dict | None) -> dict | None:
    """What the bell compares from one test to the next."""
    if not report:
        return None
    counts = report.get("counts") or {}
    return {"bad_file": any(counts.get(c) for c in BAD_FILE), "broken": int(counts.get("listed_broken", 0)), "listed": report.get("listed", 0)}
