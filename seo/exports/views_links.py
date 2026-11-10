"""Backlinks (every section), the Links checker, Site health and Uptime."""
from __future__ import annotations

from seo.core.errors import Refused
from seo.exports import fmt, registry
from seo.exports.build import C
from seo.exports.model import Chart, Report, Series, Table, Tile
from seo.exports.registry import view

STATUS = {"live": "Live", "lost": "Lost", "planned": "To do", "found": "Found", "pending": "Waiting", "removed": "Removed", "nofollow": "Nofollow"}
STAGES = {"new": "New", "contacted": "Contacted", "agreed": "Agreed", "refused": "Refused"}


def _own_site(engine, args) -> int:
    from seo.competitors.keywords import require_own

    raw = str(args.get("site_id") or "")
    if not raw.isdigit() or len(raw) > 18:
        raise Refused("Pick one site to export its links.")
    with engine.connect() as conn:
        require_own(conn, int(raw))
    return int(raw)


def _words(table: dict):
    return lambda value: table.get(value, str(value or "").replace("_", " ").capitalize())


BACKLINK_COLUMNS = [
    C("source_url", "Page with the link", "url", width=4.4),
    C("domain", "Site", "text", width=2.2, pdf=False),
    C("target_url", "My page", "text", width=2.6),
    C("anchor", "Link text", "text", width=2.2, get=lambda r: r.get("anchor") or (r.get("check") or {}).get("anchor") or r.get("anchor_auto")),
    C("status", "Status", "text", width=1.2, get=lambda r: _words(STATUS)(r.get("status")), translate=True),
    C("authority", "Authority", "int"),
    C("spam_score", "Spam score", "float"),
    C("link_type", "Kind", "text", width=1.3),
    C("mediator", "Mediator", "text", width=1.6),
    C("cost", "Cost", "money"),
    C("placed", "Placed", "date"),
    C("checked", "Checked", "date", get=lambda r: (r.get("check") or {}).get("checked_at")),
]
TODO_COLUMNS = [
    C("source_url", "Page for the link", "url", width=4.4), C("domain", "Site", "text", width=2.2, pdf=False), C("target_url", "My page", "text", width=2.6),
    C("keyword", "Keyword", "text", width=2), C("mediator", "Mediator", "text", width=1.6), C("link_type", "Kind", "text", width=1.3),
    C("cost", "Cost", "money"), C("owner", "Owner", "text", width=1.4), C("due", "Due", "date"), C("sent_at", "Sent", "date"),
]
PROSPECT_COLUMNS = [
    C("url", "Page", "url", width=4.4), C("domain", "Site", "text", width=2.2, pdf=False), C("authority", "Authority", "int"), C("spam_score", "Spam score", "float"),
    C("stage", "Stage", "text", width=1.3, get=lambda r: _words(STAGES)(r.get("stage")), translate=True), C("owner", "Owner", "text", width=1.4), C("rating", "Rating", "int"),
    C("source_file", "From", "text", width=2), C("created_at", "Added", "date"),
]
RECLAIM_COLUMNS = [
    C("page", "My page that is gone", "url", width=4.4), C("http", "Answer", "int"), C("sites", "Sites linking", "int"), C("logged_links", "Links logged", "int"),
    C("gsc_links", "Links in Search Console", "int"), C("domains", "Linking sites", "text", width=4),
]


FOUND_COLUMNS = [
    C("source_url", "Page with the link", "url", width=4.4), C("domain", "Site", "text", width=2.2, pdf=False), C("target_url", "My page", "text", width=2.6),
    C("found_by", "Found by", "text", width=1.8), C("created_at", "First seen", "date"), C("status", "Ignored", "bool", get=lambda r: r.get("status") == "ignored"),
]
MEDIATOR_COLUMNS = [
    C("name", "Mediator", "text", width=2.4), C("platform", "Platform", "text", width=1.8), C("contact", "Contact", "text", width=2.6), C("price_text", "Price", "text", width=1.8),
    C("links", "Links", "int"), C("live", "Live", "int"), C("lost", "Lost", "int"), C("planned", "To do", "int"), C("notes", "Notes", "text", width=3.4),
]
OUTCOMES = {"found": "Link found", "missing": "Link gone", "page_gone": "Page gone", "unknown": "Could not read"}
CHECK_COLUMNS = [
    C("checked_at", "Checked", "datetime"), C("source_url", "Page with the link", "url", width=4.4),
    C("outcome", "Result", "text", width=1.8, get=lambda r: _words(OUTCOMES)(r.get("outcome")), translate=True), C("http_status", "Answer", "int"),
    C("is_nofollow", "Nofollow", "bool"), C("anchor", "Link text", "text", width=2.2), C("final_url", "Ends at", "url", width=3),
]
MAX_CHECKED_LINKS = 300


def _mediators_here(everyone: list[dict], links: list[dict]) -> list[dict]:
    """The mediators with their counts for this site's links, as the Mediators tab shows them. One with no link here is left out."""
    out = []
    for person in everyone:
        mine = [b for b in links if b.get("mediator") == person.get("name")]
        if mine:
            out.append({**person, "links": len(mine), "live": sum(1 for b in mine if b.get("status") == "live"), "lost": sum(1 for b in mine if b.get("status") == "lost"), "planned": sum(1 for b in mine if b.get("status") == "planned")})
    return out


def _checks(engine, live, links: list[dict]) -> list[dict]:
    """Each link's check history, from the same function its side panel reads. The links are this site's own, already checked above."""
    rows = []
    for link in links[:MAX_CHECKED_LINKS]:
        for check in live.history(engine, link["id"]):
            rows.append({**check, "source_url": link.get("source_url")})
    rows.sort(key=lambda r: str(r.get("checked_at") or ""), reverse=True)
    return rows


@view("backlinks", "Backlinks")
def backlinks(engine, args) -> Report:
    from seo.backlinks import live, mediators, reclaim, service
    from seo.competitors import gaps

    site_id = _own_site(engine, args)
    rows = service.list_for_site(engine, site_id)
    # As the screen splits them: built links in Done, planned ones in To do, and links only ever found by a tool apart.
    done = [r for r in rows if r.get("status") not in ("planned", "found", "ignored")]
    todo = [r for r in rows if r.get("status") == "planned"]
    found = [r for r in rows if r.get("status") in ("found", "ignored")]
    summary = live.summary(engine, site_id)
    report = Report("backlinks", "Backlinks", site=registry.site_host(engine, site_id))
    report.tiles = [
        Tile("Links live", sum(1 for r in done if r.get("status") == "live"), "int"), Tile("Lost this week", summary.get("lost_this_week"), "int"),
        Tile("To do", len(todo), "int"), Tile("In consideration", None, "int"),
    ]
    prospects = gaps.list_prospects(engine, site_id)
    report.tiles[3].value = len(prospects)
    report.tables = [
        Table("done", "Done", BACKLINK_COLUMNS, done, empty="No links logged yet.", key="id"),
        Table("todo", "To do", TODO_COLUMNS, todo, empty="Nothing waiting to be placed.", key="id"),
        Table("consideration", "In consideration", PROSPECT_COLUMNS, prospects, empty="No sites in consideration.", key="id"),
        Table("reclaim", "Links to win back", RECLAIM_COLUMNS, reclaim.list_for_site(engine, site_id), empty="No page that is gone still has links."),
        Table("found", "Found but never logged", FOUND_COLUMNS, found, empty="No link was found that isn't logged.", key="id"),
        Table("mediators", "Mediators", MEDIATOR_COLUMNS, _mediators_here(mediators.list_all(engine), done + todo), empty="No mediators yet.", key="name"),
        Table("checks", "Check history", CHECK_COLUMNS, _checks(engine, live, done), note="The last checks of each link, newest first.", empty="No link has been checked yet."),
    ]
    section = args.get("table")
    if section in [t.id for t in report.tables]:
        report.tables.sort(key=lambda t: t.id != section)
    return report


def _latest(rows: list[dict], wanted) -> dict | None:
    if wanted and str(wanted).isdigit():
        return next((r for r in rows if r.get("id") == int(wanted)), None)
    return next((r for r in rows if r.get("status") == "complete"), rows[0] if rows else None)


@view("links", "Links checker")
def links(engine, args) -> Report:
    from seo.links import service

    site_id = _own_site(engine, args)
    report = Report("links", "Links checker", site=registry.site_host(engine, site_id))
    scan = _latest(service.list_scans(engine, site_id), args.get("scan_id"))
    columns = [
        C("group", "Group", "text", width=1.8, translate=True), C("page", "Page with the link", "url", width=4), C("target_url", "Link", "url", width=4),
        C("status_code", "Answer", "int"), C("reason", "Reason", "text", width=2, translate=True), C("hops", "Hops", "int"), C("final_url", "Ends at", "url", width=3),
    ]
    if scan is None:
        report.tables.append(Table("issues", "Links to fix", columns, [], empty="This site hasn't been checked yet."))
        return report
    data = service.get_scan(engine, scan["id"])
    rows = []
    for issue in data.get("issues") or []:
        for page in issue.get("pages") or [""]:
            rows.append({**issue, "group": service.GROUPS.get(issue.get("category"), issue.get("category")), "page": page})
    found = data.get("scan") or scan
    report.filters.append(("Checked on", fmt.as_day(found.get("finished_at") or found.get("created_at")) or ""))
    report.tiles = [Tile("Pages read", found.get("pages_read", found.get("pages_crawled")), "int"), Tile("Links checked", found.get("links_checked"), "int"), Tile("Links to fix", len(data.get("issues") or []), "int")]
    report.tables.append(Table("issues", "Links to fix", columns, rows, empty="No broken links found."))
    return report


SEVERITY = {"crit": "Critical", "warn": "Warning", "info": "For information"}


@view("health", "Site health")
def health(engine, args) -> Report:
    from seo.health import service

    site_id = _own_site(engine, args)
    report = Report("health", "Site health", site=registry.site_host(engine, site_id))
    history = service.history(engine, site_id)
    audit = _latest(history, args.get("audit_id"))
    checks = [C("meaning", "Check", "text", width=4.4, translate=True), C("severity", "How serious", "text", width=1.5, get=lambda r: SEVERITY.get(r.get("severity"), r.get("severity")), translate=True),
              C("count", "Pages", "int"), C("previous", "Last time", "int"), C("change", "Change", "delta_low", get=lambda r: (r.get("count") or 0) - (r.get("previous") or 0) if r.get("previous") is not None else None)]
    if audit is None:
        report.tables.append(Table("checks", "Checks", checks, [], empty="This site hasn't been tested yet."))
        return report
    data = service.detail(engine, audit["id"])
    found, before = data.get("audit") or audit, data.get("previous_audit") or {}
    report.filters.append(("Tested on", fmt.as_day(found.get("finished_at") or found.get("created_at")) or ""))
    score, was = found.get("score"), before.get("score")
    report.tiles = [
        Tile("Health score", score, "int", hint="out of 100"), Tile("Last time", was, "int"),
        Tile("Pages read", found.get("pages_read"), "int"), Tile("Checks with problems", sum(1 for c in data.get("checks") or [] if c.get("count")), "int"),
    ]
    scored = [h for h in reversed(history) if h.get("score") is not None][-12:]
    if len(scored) > 1:
        report.charts.append(Chart("Health score", [str(h.get("created_at"))[:10] for h in scored], [Series("Score", [h.get("score") for h in scored])]))
    all_checks = data.get("checks") or []
    report.tables.append(Table("checks", "Checks", checks, [c for c in all_checks if c.get("count")] or all_checks, empty="No problems found."))
    pages = [{"meaning": c.get("meaning"), "severity": c.get("severity"), "page": page} for c in all_checks for page in (c.get("pages") or [])]
    report.tables.append(Table("pages", "Pages to fix", [C("page", "Page", "url", width=4.4), C("meaning", "Problem", "text", width=4, translate=True),
                                                         C("severity", "How serious", "text", width=1.5, get=lambda r: SEVERITY.get(r.get("severity"), r.get("severity")), translate=True)], pages, empty="No pages to fix."))
    return report


STATES = {"up": "Up", "down": "Down", "unknown": "Not known", "paused": "Not watched", "ok": "Fine", "expiring": "Expires soon", "expired": "Expired"}
OUTAGES = {"server_error": "Server error", "page_error": "Page error", "no_answer": "No answer", "redirect_loop": "Too many redirects"}  # as uptime.js names them


@view("uptime", "Uptime")
def uptime(engine, args) -> Report:
    from seo.uptime import service

    data = service.sites(engine)
    host = registry.site_host(engine, args.get("site_id"))
    sites = [s for s in data.get("sites") or [] if host is None or s.get("host") == host]
    report = Report("uptime", "Uptime", site=host)
    report.filters.append(("Period", "last 30 days"))
    watched = [s for s in sites if s.get("watching")]
    known = [s["uptime_percent"] for s in watched if s.get("uptime_percent") is not None]
    report.tiles = [
        Tile("Sites watched", len(watched), "int"), Tile("Up now", sum(1 for s in watched if s.get("state") == "up"), "int"),
        Tile("Average uptime", round(sum(known) / len(known), 2) if known else None, "pct100"), Tile("Incidents", sum(len(s.get("incidents") or []) for s in sites), "int"),
    ]
    state = _words(STATES)
    report.tables.append(Table("sites", "Sites", [
        C("host", "Site", "text", width=3), C("state", "Now", "text", width=1.3, get=lambda r: state(r.get("state")), translate=True), C("uptime_percent", "Uptime, 30 days", "pct100"),
        C("http_status", "Answer", "int"), C("certificate", "Certificate expires", "date", get=lambda r: (r.get("certificate") or {}).get("expires")),
        C("domain", "Domain expires", "date", get=lambda r: (r.get("domain") or {}).get("expires")), C("last_checked_at", "Checked", "datetime"),
    ], sites, empty="No site is watched yet."))
    incidents = [{**i, "host": s.get("host")} for s in sites for i in (s.get("incidents") or [])]
    incidents.sort(key=lambda i: str(i.get("started_at")), reverse=True)
    report.tables.append(Table("incidents", "Incidents", [
        C("host", "Site", "text", width=3), C("started_at", "Started", "datetime"), C("ended_at", "Ended", "datetime"), C("minutes", "Minutes down", "int"),
        C("http_status", "Answer", "int"), C("reason", "Reason", "text", width=2, get=lambda r: _words(OUTAGES)(r.get("reason")) if r.get("reason") else "", translate=True),
    ], incidents, empty="No incident in the last 30 days."))
    return report
