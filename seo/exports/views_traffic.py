"""Traffic: Today, Channels, Conversions, Content, AI search and Google Ads."""
from __future__ import annotations


from seo.exports import registry
from seo.exports.build import C, change, page_address
from seo.exports.model import Chart, Report, Series, Table, Tile
from seo.exports.registry import view


def _scope(engine, args):
    from seo.metrics import service

    scope = service.Scope(engine, args.get("site_id"), args.get("from"), args.get("to"), args.get("compare_from"), args.get("compare_to"))
    scope.search_args = service.search_args(args)  # as the screen: Search Console on the shared period
    return scope


def _report(engine, args, scope, view_id: str, title: str) -> Report:
    return Report(view_id, title, site=registry.site_host(engine, args.get("site_id")), period=(scope.start, scope.end),
                  compare=(scope.compare_start, scope.compare_end) if scope.has_compare else None)


def _google_days(report: Report, scope, data: dict) -> None:
    """Search Console's numbers run on the shared period (to Google's last final day), Google Analytics' on the dates
    picked: when the two differ, the header says Google's own days too, so no click is read against the wrong days
    (expert review 2026-11-17, 3.8 and W13)."""
    from datetime import date

    window = data.get("gsc_window") or {}
    if not (window.get("from") and window.get("to")):
        return
    google = (date.fromisoformat(window["from"]), date.fromisoformat(window["to"]))
    if google != (scope.start, scope.end):
        report.filters.append(("Google numbers", google))


def _day(value) -> str:
    text = str(value or "")
    return text[:10]  # the PDF writes it in words (pdf_out.day_label)


def _hidden(report: Report, data: dict) -> None:
    if data.get("hid_rows"):
        report.notes.append("Google Analytics left out some small rows, so totals can exceed the rows' sum.")


@view("channels", "Channels")
def channels(engine, args) -> Report:
    from seo.metrics import service

    scope = _scope(engine, args)
    data = service.channels(scope)
    report = _report(engine, args, scope, "channels", "Channels")
    total, before = data.get("total") or {}, data.get("before") or {}
    report.tiles = [
        Tile("Visits", total.get("sessions"), "int", change(total.get("sessions"), before.get("sessions")) if scope.has_compare else None),
        Tile("Leads", total.get("leads"), "float", change(total.get("leads"), before.get("leads")) if scope.has_compare else None),
        Tile("Channels", len(data.get("channels") or []), "int"),
    ]
    names, series = data.get("series_names") or [], data.get("series") or []
    if series and names:
        report.charts.append(Chart("Visits by channel", [_day(p.get("day")) for p in series], [Series(name, [(p.get("values") or {}).get(name, 0) for p in series]) for name in names[:6]]))
    report.tables.append(Table("channels", "Channels", [
        C("channel", "Channel", "text", translate=True), C("sessions", "Visits", "int"), C("share", "Share of visits", "pct"),
        C("change", "Change", "change"), C("leads", "Leads", "float"), C("rate", "Lead rate", "pct"),
    ], data.get("channels") or [], key="channel"))
    report.tables.append(Table("referrers", "Referring sites", [C("domain", "Site", "text"), C("sessions", "Visits", "int"), C("leads", "Leads", "float")], data.get("referrers") or [], empty="No visits from other sites in this period.", key="domain"))
    _hidden(report, data)
    return report


@view("conversions", "Conversions")
def conversions(engine, args) -> Report:
    from seo.metrics import service

    scope = _scope(engine, args)
    data = service.conversions(scope)
    report = _report(engine, args, scope, "conversions", "Conversions")
    report.tiles = [Tile("Visits", data.get("sessions"), "int"), Tile("Leads", data.get("leads"), "float"), Tile("Lead rate", data.get("rate"), "pct")]
    funnel = data.get("funnel") or []
    if funnel:
        report.charts.append(Chart("Leads by channel", [str(r.get("channel")) for r in funnel], [Series("Leads", [r.get("leads") for r in funnel])], kind="bar", value_kind="float"))
    report.tables.append(Table("channels", "By channel", [C("channel", "Channel", "text", translate=True), C("sessions", "Visits", "int"), C("leads", "Leads", "float"), C("rate", "Lead rate", "pct")], funnel))
    report.tables.append(Table("page_types", "By kind of page", [C("type", "Kind of page", "text", translate=True), C("pages", "Pages", "int"), C("sessions", "Visits", "int"), C("leads", "Leads", "float"), C("rate", "Lead rate", "pct")], data.get("page_types") or [], key="type"))
    report.tables.append(Table("pages", "Landing pages", [C("page", "Page", "url", get=page_address), C("sessions", "Visits", "int"), C("leads", "Leads", "float"), C("rate", "Lead rate", "pct")], data.get("pages") or [], key=lambda r: f"{r.get('host') or ''}|{r.get('path') or ''}"))
    _hidden(report, data)
    return report


@view("content", "Content")
def content(engine, args) -> Report:
    from seo.metrics import service

    scope = _scope(engine, args)
    data = service.content(scope)
    report = _report(engine, args, scope, "content", "Content")
    pages = data.get("pages") or []
    report.tiles = [
        Tile("Pages", data.get("total_pages", len(pages)), "int"), Tile("Google clicks", sum(p.get("clicks") or 0 for p in pages), "int"),
        Tile("Visits", sum(p.get("sessions") or 0 for p in pages) if any(p.get("sessions") is not None for p in pages) else None, "int"),
    ]
    report.tables.append(Table("pages", "Pages", [
        C("page", "Page", "url", get=page_address), C("category", "Kind of page", "text", translate=True, width=1.8), C("clicks", "Google clicks", "int"), C("impressions", "Impressions", "int"),
        C("position", "Position", "position"), C("jump_impressions", "Jump-link impressions", "int"), C("sessions", "Visits", "int"), C("leads", "Leads", "float"), C("ai", "AI visits", "int"),
    ], pages, total=data.get("total_pages"), key=lambda r: f"{r.get('host') or ''}|{r.get('path') or ''}"))
    _google_days(report, scope, data)
    report.tables.append(Table("social", "Social networks", [C("source", "Network", "text"), C("sessions", "Visits", "int")], data.get("social") or [], empty="No visits from social networks in this period."))
    _hidden(report, data)
    return report


@view("ai", "AI search")
def ai_search(engine, args) -> Report:
    from seo.metrics import service

    scope = _scope(engine, args)
    data = service.ai_search(scope)
    report = _report(engine, args, scope, "ai", "AI search")
    report.tiles = [
        Tile("AI visits", data.get("sessions"), "int", data.get("change") if scope.has_compare else None),
        Tile("Leads", data.get("leads"), "float"),
        Tile("Lead rate", (data.get("rate") or {}).get("value"), "pct"),  # blank under 30 AI visits, as on the screen
    ]
    series = data.get("series") or []
    if series:
        report.charts.append(Chart("AI visits", [_day(p.get("day")) for p in series], [Series("Visits", [p.get("sessions") for p in series])]))
    report.tables.append(Table("sources", "Assistants", [C("source", "Assistant", "text"), C("sessions", "Visits", "int"), C("leads", "Leads", "float")], data.get("sources") or [], empty="No AI visits in this period.", key="source"))
    report.tables.append(Table("pages", "Landing pages", [C("page", "Page", "url", get=page_address), C("sessions", "Visits", "int"), C("leads", "Leads", "float")], data.get("pages") or [], empty="No AI visits in this period.", key=lambda r: f"{r.get('host') or ''}|{r.get('path') or ''}"))
    _hidden(report, data)
    return report


@view("ads", "Google Ads")
def ads(engine, args) -> Report:
    from seo.metrics import service

    scope = _scope(engine, args)
    data = service.ads(scope)
    report = _report(engine, args, scope, "ads", "Google Ads")
    report.tiles = [Tile("Clicks", data.get("clicks"), "int"), Tile("Leads", data.get("leads"), "float")]
    for cost in data.get("costs") or []:
        report.tiles.append(Tile(f"Cost ({cost.get('currency')})" if cost.get("currency") else "Cost", cost.get("cost"), "money"))
    series = data.get("series") or []
    if series:
        report.charts.append(Chart("Clicks", [_day(p.get("day")) for p in series], [Series("Clicks", [p.get("clicks") for p in series]), Series("Visits", [p.get("sessions") for p in series])]))
    report.tables.append(Table("campaigns", "Campaigns", [
        C("campaign", "Campaign", "text", width=4), C("clicks", "Clicks", "int"), C("cost", "Cost", "money"), C("currency", "Currency", "text", width=1),
        C("sessions", "Visits", "int"), C("leads", "Leads", "float"),
    ], data.get("campaigns") or [], empty="No campaigns in this period.", key="campaign"))
    return report


# As Today names them on screen (today-live.js KINDS).
CHANGE_KINDS = {"new_page": "New page", "page_gone": "Page removed", "title": "Title changed", "meta": "Meta description changed", "h1": "Main heading changed", "headings": "Headings changed",
                "content": "Content changed", "canonical": "Canonical changed", "schema": "Structured data changed", "links": "Links changed", "redirect": "Moved to another address",
                "status": "Status changed", "robots": "Indexing changed"}


@view("today", "Today")
def today(engine, args) -> Report:
    from seo.core.errors import Refused
    from seo.metrics import today as today_view

    site = args.get("site_id")
    try:
        site_id = int(site) if site not in (None, "", "all") else None
    except ValueError as exc:
        raise Refused("That site isn't one of yours.") from exc
    # The period on screen (range, compare, from, to), so the file holds the screen's numbers (it used to be 28 days always).
    picked = {key: args.get(key) for key in ("range", "compare", "from", "to") if args.get(key)}
    data = today_view.for_person(today_view.today(engine, site_id, picked))  # chosen access: only their sections, as on screen
    results = data.get("results") or {}
    report = Report("today", "Today", site=registry.site_host(engine, site_id))
    window = results.get("window") or {}
    # The header is the shared Search Console period, the one the screen's head prints. GA4's own days are said in a note.
    if window.get("from") and window.get("to"):
        report.period = registry.days(window["from"], window["to"])
        if window.get("compare_from") and window.get("compare_to"):
            report.compare = registry.days(window["compare_from"], window["compare_to"])
    ga4 = window.get("ga4") or {}
    if ga4.get("from") and ga4.get("to") and ga4.get("to") != window.get("to"):
        report.notes.append(f"Visits and leads: {ga4['from']} – {ga4['to']}, where Google Analytics' data ends.")
    for key, label in (("clicks", "Google clicks"), ("visits", "Visits"), ("leads", "Leads")):
        item = results.get(key) or {}
        # Leads change is a count (+2 leads), the others a percentage: the unit goes with the value.
        report.tiles.append(Tile(label, item.get("value"), "int", item.get("change"), change_kind="delta" if key == "leads" else "change"))
        points = item.get("points") or []
        points = [p for p in points if isinstance(p, dict)]
        if key != "leads" and any(p.get("now") is not None for p in points):
            lines = [Series(label, [p.get("now") for p in points])]
            if any(p.get("was") is not None for p in points):
                lines.append(Series("Before", [p.get("was") for p in points], dashed=True))
            report.charts.append(Chart(label, [_day(p.get("day")) for p in points], lines))
    report.tables.append(Table("todo", "To do", [
        C("title", "What", "text", width=5, translate=True), C("host", "Site", "text", width=2), C("detail", "Detail", "text", width=4, translate=True), C("page", "Page", "url"),
    ], data.get("todo") or [], empty="Nothing to do today."))
    if site_id is None:
        report.tables.append(Table("sites", "Sites", [
            C("host", "Site", "text"), C("clicks", "Google clicks", "int"), C("clicks_change", "Change", "change"), C("visits", "Visits", "int"), C("visits_change", "Visits change", "change"),
            C("leads", "Leads", "int"), C("leads_change", "Leads change", "delta"), C("alerts", "Alerts", "int"),
        ], data.get("sites") or []))
    moves = [
        C("what", "Page or keyword", "url", get=lambda r: r.get("page") or r.get("query")),
        C("kind", "Measured in", "text", width=1.4, get=lambda r: "Position" if r.get("type") == "keyword" else "Clicks", translate=True),
        C("now", "Now", "int", get=lambda r: r.get("now") if r.get("type") == "keyword" else r.get("clicks")), C("was", "Before", "int"),
        C("change", "Change", "change"), C("places", "Places gained", "delta", get=lambda r: (r.get("was") - r.get("now")) if r.get("type") == "keyword" and r.get("was") is not None and r.get("now") is not None else None),
    ]
    report.tables.append(Table("going_up", "Pages and searches going up", moves, data.get("going_up") or [], empty="No page is clearly going up."))
    report.tables.append(Table("going_down", "Pages and searches going down", moves, data.get("going_down") or [], empty="No page is clearly going down."))
    report.tables.append(Table("rival_changes", "Competitor changes", [
        C("host", "Competitor", "text"), C("url", "Their page", "url"), C("kind", "What changed", "text", translate=True, get=lambda r: CHANGE_KINDS.get(r.get("kind"), str(r.get("kind") or "").replace("_", " ").capitalize())), C("when", "When", "datetime"),
    ], data.get("rival_changes") or [], empty="No competitor changed a watched page."))
    return report


@view("pages", "Pages")
def site_pages(engine, args) -> Report:
    """The Pages screen's list: every page with its Google numbers and what's linked to it."""
    from seo.pages import service

    scope = _scope(engine, args)
    data = service.listing(scope)
    report = _report(engine, args, scope, "pages", "Pages")
    s = data["summary"]
    report.tiles = [Tile("Pages", s["pages"], "int"), Tile("Get clicks", s["with_clicks"], "int"), Tile("Not indexed", s["not_indexed"], "int"), Tile("Open tasks", s["open_tasks"], "int")]
    indexed = {True: "Yes", False: "No"}
    report.tables.append(Table("pages", "Pages", [
        C("url", "Page", "url"), C("title", "Title", "text", width=3), C("clicks", "Google clicks", "int"),
        *([C("clicks_before", "Clicks before", "int"), C("change", "Change", "delta")] if data.get("compared") else []),  # as the screen's Change column
        C("impressions", "Impressions", "int"), C("position", "Position", "position"), C("jump_impressions", "Jump-link impressions", "int"), C("sessions", "Visits", "int"), C("tasks_open", "Open tasks", "int"), C("notes", "Notes", "int"),
        C("backlinks", "Backlinks", "int"), C("indexed", "Indexed", "text", get=lambda r: indexed.get(r.get("indexed"), ""), translate=True),
    ], data["pages"], total=data["total"], key="url"))
    _google_days(report, scope, data)
    return report


@view("site-page", "Page")
def site_page(engine, args) -> Report:
    """One page from the Pages screen: its rankings, backlinks and technical findings."""
    from seo.pages import service

    try:
        site_id = int(args.get("site_id"))
    except (TypeError, ValueError):
        from seo.core.errors import Refused
        raise Refused("site_id must be a number.") from None
    data = service.profile(engine, site_id, args.get("url") or "")
    report = Report("site-page", "Page", site=data["host"], subject=data["path"])
    g = data["google_28d"]
    report.tiles = [Tile("Google clicks", g["clicks"], "int"), Tile("Impressions", g["impressions"], "int"), Tile("Position", g["position"], "float")]
    if g.get("jump_impressions"):
        report.tiles.append(Tile("Jump-link impressions", g["jump_impressions"], "int"))
    ranked = [{"keyword": r["keyword"], "country": (r.get("country") or "").upper(), **{f"pos_{e}": (v.get("position") if v.get("position") is not None else v.get("own")) for e, v in r["engines"].items()}} for r in data["rankings"]]
    engines = sorted({key for row in ranked for key in row if key.startswith("pos_")})
    report.tables.append(Table("rankings", "Rankings", [C("keyword", "Keyword", "text", width=3), C("country", "Country", "text")]
                               + [C(e, e[4:].capitalize(), "position") for e in engines], ranked, empty="No tracked keyword ranks with this page."))
    report.tables.append(Table("backlinks", "Backlinks", [
        C("source", "Linking page", "url"), C("domain", "Website", "text"), C("anchor", "Anchor", "text"), C("status", "Status", "text", translate=True), C("verdict", "Counts?", "text", translate=True),
    ], data["backlinks"], empty="No backlink you've logged points at this page."))
    tech = data["technical"]
    facts = [{"what": "Health test", "found": code} for code in tech["health"]] + [{"what": "Broken link", "found": f"{x['target']} ({x.get('status') or x['category']})"} for x in tech["links"]]
    if tech["inspection"]:
        facts.append({"what": "Google index", "found": tech["inspection"]["coverage"] or tech["inspection"]["verdict"]})
    for device, s in tech["speed"].items():
        facts.append({"what": f"Speed ({device})", "found": f"{s['score']}/100"})
    report.tables.append(Table("technical", "Technical", [C("what", "Check", "text", translate=True), C("found", "Found", "text", width=4)], facts, empty="Nothing found."))
    return report
