"""Search: Overview (Search Console), Insights and Keywords."""
from __future__ import annotations

from seo.exports import registry
from seo.exports.build import C, change, diff
from seo.exports.model import MAX_ROWS, Chart, Report, Series, Table, Tile
from seo.exports.registry import view

NO_MATCH = "Nothing matches these filters."
DIM_TITLES = {"query": "Queries", "page": "Pages", "country": "Countries", "device": "Devices"}
DIM_FIRST = {"query": ("Query", "text"), "page": ("Page", "url"), "country": ("Country", "text"), "device": ("Device", "text")}
SHOW_WORDS = {"gaining": "Gaining", "losing": "Losing", "new": "New", "lost": "Lost", "top3": "Top 3", "4-10": "Positions 4–10", "11-20": "Positions 11–20", "21+": "Positions 21+"}
MODE_WORDS = {"contains": "contains", "not": "doesn't contain", "exact": "is exactly", "regex": "matches"}


def _breakdown_table(search, scope, dim: str, show: str, brand: str, filters: dict | None, compare: bool) -> Table:
    data = search.breakdown(scope, dim, show, brand, filters, limit=MAX_ROWS + 1)
    first, kind = DIM_FIRST[dim]
    columns = [C("name", first, kind, width=5.2 if dim in ("query", "page") else 3), C("clicks", "Clicks", "int")]
    if compare:
        columns += [C("clicks_before", "Clicks before", "int"), C("clicks_change", "Change", "delta", get=lambda r: diff(r.get("clicks"), r.get("clicks_before")))]
    columns += [C("impressions", "Impressions", "int"), C("click_rate", "Click rate", "pct100"), C("position", "Position", "position")]
    if compare:
        columns.append(C("position_before", "Position before", "position"))
    if dim == "query" and data.get("has_brand"):
        columns.append(C("brand", "Brand", "bool"))
    picked = filters or {}
    narrowed = show != "all" or brand not in ("all", "", None) or bool(picked.get("q")) or any(picked.get(k) is not None for k in ("min_clicks", "min_impressions", "pos_from", "pos_to"))
    return Table(dim, DIM_TITLES[dim], columns, data["rows"], total=data.get("total"), empty=NO_MATCH if narrowed else "Nothing to show for this period.")


@view("overview", "Search overview")
def overview(engine, args) -> Report:
    from seo.metrics import search

    scope, window = search.scope_for(engine, args)
    data = search.overview(scope, window)
    totals, before = data.get("totals") or {}, data.get("before") or {}
    compare = scope.has_compare
    report = Report("overview", "Search overview", site=registry.site_host(engine, args.get("site_id")),
                    period=registry.days(window["from"], window["to"]),
                    compare=registry.days(window.get("compare_from"), window.get("compare_to")) if compare else None)
    report.tiles = [
        Tile("Clicks", totals.get("clicks"), "int", change(totals.get("clicks"), before.get("clicks"))),
        Tile("Impressions", totals.get("impressions"), "int", change(totals.get("impressions"), before.get("impressions"))),
        Tile("Click rate", totals.get("click_rate"), "pct100", change(totals.get("click_rate"), before.get("click_rate"))),
        Tile("Average position", totals.get("position"), "position", change(totals.get("position"), before.get("position")), lower_is_better=True),
    ]
    series, compared = data.get("series") or [], data.get("compare_series") or []
    labels = [_short_day(p.get("day")) for p in series]
    for key, title in (("clicks", "Clicks"), ("impressions", "Impressions")):
        lines = [Series(title, [p.get(key) for p in series])]
        if compare and compared:
            lines.append(Series("Before", [p.get(key) for p in compared][: len(series)], dashed=True))
        report.charts.append(Chart(title, labels, lines))

    picked = args.get("dim", "query")
    show, brand = args.get("show", "all"), args.get("brand", "all")
    filters = search.filter_from(args)
    for dim in DIM_TITLES:
        mine = dim == picked
        # The chips and filters on screen belong to the table being looked at; the other tables come whole.
        report.tables.append(_breakdown_table(search, scope, dim, show if mine else "all", brand if mine and dim == "query" else "all", filters if mine else None, compare))
    if picked == "opportunities":
        report.tables.insert(0, _opportunities_table(search, scope, args.get("kind", "almost")))
        report.filters.append(("Opportunities", OPP_TITLES.get(args.get("kind", "almost"), "")))
    elif picked in DIM_TITLES:
        report.tables.sort(key=lambda t: t.id != picked)
        where = DIM_TITLES[picked]
        if show != "all":
            report.filters.append((where, SHOW_WORDS.get(show, show)))
        if brand in ("brand", "non_brand") and picked == "query":
            report.filters.append(("Brand", "Brand only" if brand == "brand" else "Without brand"))
        if picked in ("query", "page"):
            if filters.get("q"):
                report.filters.append((DIM_FIRST[picked][0], f"{MODE_WORDS.get(filters['q_mode'], filters['q_mode'])} “{filters['q']}”"))
            for key, label in (("min_clicks", "Min clicks"), ("min_impressions", "Min impressions"), ("pos_from", "Position from"), ("pos_to", "Position to")):
                if filters.get(key) is not None:
                    report.filters.append((label, f"{filters[key]:g}"))
    return report


OPP_TITLES = {"almost": "Almost on page 1", "low_ctr": "Low click rate", "compete": "Two pages compete", "lost": "Lost queries"}
_OPP_COLUMNS = {
    "almost": [C("position", "Position", "position"), C("impressions", "Impressions", "int"), C("clicks", "Clicks", "int")],
    "low_ctr": [C("click_rate", "Click rate", "pct100"), C("expected_rate", "Usual rate", "pct100"), C("position", "Position", "position"), C("impressions", "Impressions", "int")],
    "compete": [C("impressions", "Impressions", "int"), C("pages", "Pages sharing it", "text", width=6, get=lambda r: " | ".join(f"{p.get('page')} ({p.get('share')}%)" for p in r.get("pages") or []))],
    "lost": [C("clicks_before", "Clicks before", "int"), C("impressions_before", "Impressions before", "int"), C("position_before", "Position before", "position")],
}


def _opportunities_table(search, scope, kind: str) -> Table:
    data = search.opportunities(scope, kind, limit=MAX_ROWS + 1)
    columns = [C("name", "Query", "text", width=5.2), *_OPP_COLUMNS.get(kind, [])]
    return Table("opportunities", OPP_TITLES.get(kind, "Opportunities"), columns, data.get("rows") or [], total=data.get("total"))


def _short_day(value) -> str:
    text = str(value or "")
    return text[:13] if len(text) > 11 else text[:10]  # a day, or a day and its hour: the PDF writes it in words (pdf_out.day_label)


@view("insights", "Search insights")
def insights(engine, args) -> Report:
    from seo.insights import service

    status = args.get("status", "open")
    group = args.get("group", "first")
    data = service.listing(engine, args.get("site_id"), group, status)
    summary = data.get("summary") or {}
    report = Report("insights", "Search insights", site=registry.site_host(engine, args.get("site_id")))
    report.tiles = [Tile("Open findings", summary.get("open"), "int"), Tile("Clicks at stake", summary.get("at_stake"), "int"), Tile("Fixed in 30 days", summary.get("fixed"), "int")]
    if group != "first":
        report.filters.append(("Group", GROUP_WORDS.get(group, group)))
    if status != "open":
        report.filters.append(("Status", STATUS_WORDS.get(status, status)))
    columns = [
        C("kind", "Finding", "text", width=2.6, get=lambda r: FINDING_NAMES.get(r.get("kind"), str(r.get("kind") or "").replace("_", " ").capitalize()), translate=True),
        C("subject", "Subject", "text", width=4.6, get=lambda r: r.get("query") or r.get("page") or ""),
        C("host", "Site", "text", width=2.4),
        C("group", "Group", "text", get=lambda r: GROUP_WORDS.get(r.get("group"), r.get("group")), translate=True, width=1.8),
        C("at_stake", "Clicks at stake", "int"),
        C("first_seen", "First seen", "date"),
        C("task", "Task", "text", translate=True, width=1.6),
    ]
    report.tables.append(Table("findings", "Findings", columns, data.get("rows") or [], empty="No findings here.", key="id"))
    return report


# As Insights names them on screen (insights-view.js KIND).
FINDING_NAMES = {'page_down': 'Losing clicks', 'page_up': 'Gaining clicks', 'dropped_out': 'Dropped out of Google', 'odd_day': 'Odd day', 'decay': 'Slowly losing clicks', 'almost': 'Almost on page 1', 'top3': 'Close to the top 3', 'low_ctr': 'Low click rate', 'no_click': 'Seen, never clicked', 'compete': 'Two pages compete', 'query_down': 'Query losing places', 'segment': 'One device or country', 'unstable': 'Unstable ranking', 'brand_split': 'Brand hides a loss', 'slide': 'Slowly losing places', 'page_near': 'Near page 1 on many searches', 'no_page': 'No page of its own', 'questions': 'Question searches', 'topic': 'Topic without a strong page', 'track': 'Worth tracking', 'lead_page': 'Page that brings leads', 'no_leads': 'Clicks but no leads', 'duplicate': 'One page, several addresses', 'shown_broken': 'Shown but broken', 'data_gaps': 'Data gaps', 'task_result': 'Task result', 'note_result': 'Note result', 'rank_drop': 'Just dropped', 'rank_rise': 'Just climbed', 'rival_passed': 'Rival passed you', 'rival_gap': 'Rivals lead, people search it', 'striking': 'Almost there, both agree', 'rank_no_click': 'Ranked, not clicked', 'page_switch': 'Another page shown', 'no_demand': 'Tracked, no searches'}
GROUP_WORDS = {"first": "To do first", "changed": "What changed", "decline": "Slow decline", "wins": "Quick wins", "leads": "Leads", "technical": "Technical", "impact": "Impact", "mix": "Rank and clicks"}
STATUS_WORDS = {"open": "Open", "dismissed": "Dismissed", "gone": "Gone", "done": "Done"}
ENGINE_NAMES = {"google": "Google", "bing": "Bing", "yandex": "Yandex", "duckduckgo": "DuckDuckGo"}


@view("keywords", "Keywords")
def keywords(engine, args) -> Report:
    from seo.serp import rankings

    raw_site = args.get("site_id", "")
    site_id = int(raw_site) if str(raw_site).isdigit() and len(str(raw_site)) <= 18 else None
    data = rankings.listing(engine, site_id)
    name = args.get("engine", "google")
    if name not in ENGINE_NAMES:
        name = "google"
    tiles = (data.get("tiles") or {}).get(name) or {}
    report = Report("keywords", "Keywords", site=registry.site_host(engine, site_id))
    report.filters.append(("Search engine", ENGINE_NAMES[name]))
    report.tiles = [
        Tile("Keywords followed", tiles.get("tracked"), "int"), Tile("In the top 10", tiles.get("top10"), "int"),
        Tile("Moved up", tiles.get("up"), "int"), Tile("Moved down", tiles.get("down"), "int"),
    ]

    def of(row):
        return (row.get("engines") or {}).get(name) or {}

    def main(row):
        return of(row).get("main") or {}

    def position(row):
        found = main(row)
        return found.get("p")

    columns = [
        C("keyword", "Keyword", "text", width=4),
        C("site", "Site", "text", width=2.4),
        C("country", "Country", "text", width=1.1),
        C("position", "Position", "int", get=position),
        C("change", "Change", "delta", get=lambda r: of(r).get("change")),
        C("own", "Own tool average", "position", get=lambda r: of(r).get("own")),
        C("impressions", "Impressions", "int", get=lambda r: of(r).get("impressions")),
        C("clicks", "Clicks", "int", get=lambda r: of(r).get("clicks")),
        C("volume", "Searches a month", "int"),
        C("page", "Page", "url", width=4.2, get=lambda r: main(r).get("url") or r.get("page")),
        C("tool", "Checked with", "text", width=1.6, get=lambda r: main(r).get("tool")),
        C("checked_at", "Checked", "datetime", get=lambda r: main(r).get("checked_at")),
    ]
    report.tables.append(Table("keywords", "Keywords", columns, data.get("rows") or [], empty="No keywords followed yet.", key="id"))

    def note(report: Report) -> None:  # once the table holds only the rows on screen
        if any(main(r) and position(r) is None for r in report.tables[0].rows):
            report.tables[0].note = "Empty position: not found in the results read."

    report.recount = note
    return report
