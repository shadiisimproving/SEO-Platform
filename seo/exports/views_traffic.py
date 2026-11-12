"""Traffic: Today, Channels, Conversions, Content, AI search and Google Ads."""
from __future__ import annotations

from datetime import timedelta

from seo.exports import fmt, registry
from seo.exports.build import C, change, page_address
from seo.exports.model import Chart, Report, Series, Table, Tile
from seo.exports.registry import view


def _scope(engine, args):
    from seo.metrics import service

    return service.Scope(engine, args.get("site_id"), args.get("from"), args.get("to"), args.get("compare_from"), args.get("compare_to"))


def _report(engine, args, scope, view_id: str, title: str) -> Report:
    return Report(view_id, title, site=registry.site_host(engine, args.get("site_id")), period=(scope.start, scope.end),
                  compare=(scope.compare_start, scope.compare_end) if scope.has_compare else None)


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
        C("position", "Position", "position"), C("sessions", "Visits", "int"), C("leads", "Leads", "float"), C("ai", "AI visits", "int"),
    ], pages, total=data.get("total_pages"), key=lambda r: f"{r.get('host') or ''}|{r.get('path') or ''}"))
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
                "content": "Content changed", "canonical": "Canonical changed", "schema": "Structured data changed", "links": "Links changed", "redirect": "Redirect changed",
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
    data = today_view.for_person(today_view.today(engine, site_id))  # chosen access: only their sections, as on screen
    results = data.get("results") or {}
    report = Report("today", "Today", site=registry.site_host(engine, site_id))
    through, days = fmt.as_day(results.get("through")), results.get("days")
    if through and isinstance(days, int) and days > 0:
        report.period = (through - timedelta(days=days - 1), through)
    for key, label in (("clicks", "Google clicks"), ("visits", "Visits"), ("leads", "Leads")):
        item = results.get(key) or {}
        report.tiles.append(Tile(label, item.get("value"), "int", item.get("change")))
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
            C("leads", "Leads", "int"), C("leads_change", "Leads change", "change"), C("alerts", "Alerts", "int"),
        ], data.get("sites") or []))
    moves = [
        C("what", "Page or keyword", "url", get=lambda r: r.get("page") or r.get("query")),
        C("kind", "Measured in", "text", width=1.4, get=lambda r: "Position" if r.get("type") == "keyword" else "Clicks", translate=True),
        C("now", "Now", "int", get=lambda r: r.get("now") if r.get("type") == "keyword" else r.get("clicks")), C("was", "Before", "int"),
        C("change", "Change", "change"), C("places", "Places gained", "delta", get=lambda r: (r.get("was") - r.get("now")) if r.get("type") == "keyword" and r.get("was") is not None and r.get("now") is not None else None),
    ]
    report.tables.append(Table("going_up", "Pages going up", moves, data.get("going_up") or [], empty="No page is clearly going up."))
    report.tables.append(Table("going_down", "Pages going down", moves, data.get("going_down") or [], empty="No page is clearly going down."))
    report.tables.append(Table("rival_changes", "Competitor changes", [
        C("host", "Competitor", "text"), C("url", "Their page", "url"), C("kind", "What changed", "text", translate=True, get=lambda r: CHANGE_KINDS.get(r.get("kind"), str(r.get("kind") or "").replace("_", " ").capitalize())), C("when", "When", "datetime"),
    ], data.get("rival_changes") or [], empty="No competitor changed a watched page."))
    return report
