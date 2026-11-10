"""Competitors: the list, one competitor's profile, page against page, keyword check and link gaps."""
from __future__ import annotations

import re

from seo.core.errors import Refused
from seo.exports import registry
from seo.exports.build import C
from seo.exports.model import Report, Table, Tile, Typed
from seo.exports.registry import view

TRACKING = {"on": "On", "pages": "Pages only", "off": "Off"}


# As the competitor screens name them (comp-list.js KINDS). The ranking and AI ones are followed by the keyword, in its own column.
MOVE_KINDS = {'title': 'Title changed', 'meta': 'Meta description changed', 'h1': 'Main heading changed', 'headings': 'Subheadings changed', 'canonical': 'Preferred address changed', 'robots': 'Instructions to search engines changed', 'schema': 'Structured data changed', 'content': 'Page text changed', 'new_page': 'New page found', 'page_gone': 'Page removed', 'rank_new': 'Started ranking for', 'rank_lost': 'Dropped out of the results for', 'rank_up': 'Moved up on', 'rank_down': 'Moved down on', 'ai_cited': 'Cited in the AI Overview for', 'ai_dropped': 'No longer cited in the AI Overview for'}


def _site(args) -> int:
    raw = args.get("site_id")
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,18}", raw):
        raise Refused("Pick one site to export its competitors.")
    return int(raw)


def _humanise(value) -> str:
    return str(value or "").replace("_", " ").capitalize()


@view("competitors", "Competitors")
def competitors(engine, args) -> Report:
    from seo.competitors import collective, profile, tracking

    site_id = _site(args)
    rows = tracking.apply_to_overview(engine, site_id, profile.overview(engine, site_id))
    report = Report("competitors", "Competitors", site=registry.site_host(engine, site_id))
    report.tiles = [
        Tile("Competitors", len(rows), "int"), Tile("Keywords shared", sum(r.get("shared") or 0 for r in rows), "int"),
        Tile("Where I am ahead", sum(r.get("i_ahead") or 0 for r in rows), "int"), Tile("Where they are ahead", sum(r.get("they_ahead") or 0 for r in rows), "int"),
    ]
    report.tables.append(Table("competitors", "Competitors", [
        C("display", "Competitor", "text", width=3.4), C("shared", "Keywords shared", "int"), C("i_ahead", "I am ahead", "int"), C("they_ahead", "They are ahead", "int"),
        C("theirs_only", "Only they rank", "int"), C("edits_30d", "Page changes, 30 days", "int"),
        C("tracking", "Tracking", "text", width=1.4, get=lambda r: TRACKING.get(r.get("tracking"), r.get("tracking")), translate=True), C("added_at", "Added", "date"),
    ], rows, empty="No competitors yet."))
    words = collective.keywords(engine, site_id)
    report.tables.append(Table("keywords", "Keywords where they are ahead", [
        C("keyword", "Keyword", "text", width=4), C("country", "Country", "text", width=1), C("my_best", "My position", "int", get=lambda r: (r.get("my_best") or {}).get("position")),
        C("rivals", "Ahead of me", "text", width=5, get=lambda r: ", ".join(f"{x.get('display') or x.get('host')} ({x.get('position')})" if x.get("position") else str(x.get("display") or x.get("host")) for x in r.get("rivals_ahead") or [])),
        C("checked_at", "Checked", "date"),
    ], words.get("keywords") or [], total=words.get("total"), empty="No keyword where a competitor is ahead."))
    moves = collective.moves(engine, site_id)
    report.tables.append(Table("moves", "What they did", [
        C("at", "When", "datetime"), C("rival", "Competitor", "text", width=3, get=lambda r: (r.get("rival") or {}).get("display")), C("kind", "What", "text", width=2.4, get=lambda r: MOVE_KINDS.get(r.get("kind"), _humanise(r.get("kind"))), translate=True),
        C("keyword", "Keyword", "text", width=3.4), C("url", "Page", "url"),
    ], moves.get("moves") or [], total=moves.get("total"), empty="Nothing new from competitors."))
    return report


@view("competitor", "Competitor profile")
def competitor(engine, args) -> Report:
    from seo.competitors import profile, tracking

    site_id = _site(args)
    raw = args.get("competitor_id")
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,18}", raw):
        raise Refused("Pick a competitor.")
    data = tracking.apply_to_profile(engine, site_id, profile.profile(engine, site_id, int(raw)))
    compare = data.get("compare") or {}
    report = Report("competitor", "Competitor profile", site=registry.site_host(engine, site_id))
    report.filters.append(("Competitor", Typed(data.get("display") or data.get("host") or "")))
    report.subject = data.get("host") or data.get("display")
    report.tiles = [
        Tile("Keywords shared", compare.get("shared"), "int"), Tile("I am ahead", compare.get("i_ahead"), "int"), Tile("They are ahead", compare.get("they_ahead"), "int"),
        Tile("My average position", compare.get("my_average"), "position"), Tile("Their average position", compare.get("their_average"), "position"),
    ]
    report.tables.append(Table("keywords", "Keywords", [
        C("keyword", "Keyword", "text", width=3.6), C("country", "Country", "text", width=1), C("my_position", "My position", "int"), C("their_position", "Their position", "int"),
        C("my_url", "My page", "url"), C("their_url", "Their page", "url"), C("checked_at", "Checked", "date"),
    ], data.get("keywords") or [], empty="No keyword compared yet."))
    report.tables.append(Table("pairs", "Page against page", PAIR_COLUMNS, data.get("pairs") or [], empty="No pages matched yet."))
    report.tables.append(Table("timeline", "What they did", [
        C("at", "When", "datetime"), C("kind", "What", "text", width=2.4, get=lambda r: MOVE_KINDS.get(r.get("kind"), _humanise(r.get("kind"))), translate=True), C("keyword", "Keyword", "text", width=3.4), C("url", "Page", "url"),
    ], data.get("timeline") or [], empty="Nothing new from this competitor."))
    return report


def _facts(side: str, key: str):
    return lambda r: (r.get(f"{side}_facts") or {}).get(key)


PAIR_COLUMNS = [
    C("my_url", "My page", "url"), C("their_url", "Their page", "url"), C("competitor", "Competitor", "text", width=2.2),
    C("shared_keywords", "Keywords shared", "int"), C("i_ahead", "I am ahead", "int", get=lambda r: (r.get("ranking") or {}).get("i_ahead")),
    C("they_ahead", "They are ahead", "int", get=lambda r: (r.get("ranking") or {}).get("they_ahead")),
    C("my_words", "My words", "int", get=_facts("my", "words")), C("their_words", "Their words", "int", get=_facts("their", "words")),
]


@view("page-pairs", "Page against page")
def page_pairs(engine, args) -> Report:
    from seo.competitors import pairs

    site_id = _site(args)
    raw = args.get("competitor_id")
    competitor_id = int(raw) if isinstance(raw, str) and re.fullmatch(r"[0-9]{1,18}", raw) else None
    rows = pairs.list_pairs(engine, site_id, competitor_id, args.get("include_hidden") == "1")
    report = Report("page-pairs", "Page against page", site=registry.site_host(engine, site_id))
    report.tiles = [Tile("Pairs of pages", len(rows), "int"), Tile("Where they are ahead", sum(1 for r in rows if ((r.get("ranking") or {}).get("they_ahead") or 0) > ((r.get("ranking") or {}).get("i_ahead") or 0)), "int")]
    report.tables.append(Table("pairs", "Page against page", PAIR_COLUMNS, rows, empty="No pages matched yet."))
    return report


@view("keyword-check", "Keyword check")
def keyword_check(engine, args) -> Report:
    from seo.competitors import probe

    site_id = _site(args)
    data = probe.listing(engine, site_id)
    rows = data.get("keywords") or []
    report = Report("keyword-check", "Keyword check", site=registry.site_host(engine, site_id))
    report.tiles = [Tile("Keywords", len(rows), "int"), Tile("Checked", sum(1 for r in rows if r.get("checked")), "int"), Tile("Where I rank", sum(1 for r in rows if r.get("me")), "int")]
    report.tables.append(Table("keywords", "Keywords", [
        C("keyword", "Keyword", "text", width=3.6), C("country", "Country", "text", width=1), C("me", "My position", "int", get=lambda r: (r.get("me") or {}).get("position")),
        C("my_url", "My page", "url", get=lambda r: (r.get("me") or {}).get("url")),
        C("competitors", "Competitors that rank", "text", width=5, get=lambda r: ", ".join(f"{x.get('display')} ({x.get('position')})" for x in r.get("competitors") or [])),
        C("tracked", "Followed", "bool"), C("checked_at", "Checked", "date"),
    ], rows, empty="No keywords typed yet."))
    return report


def _gap_columns() -> list:
    return [
        C("display", "Site", "text", width=3), C("title", "Name", "text", width=2.6), C("authority", "Authority", "int"), C("spam_score", "Spam score", "float"),
        C("competitor_count", "Competitors it links to", "int"),
        C("competitors", "Which ones", "text", width=4, get=lambda r: ", ".join(str(x.get("host")) for x in r.get("competitors") or [])),
        C("sample_url", "A page with a link", "url"), C("reason_words", "Why filtered out", "text", width=3, translate=True),
        C("in_consideration", "In consideration", "bool"),
    ]


@view("link-gaps", "Link gaps")
def link_gaps(engine, args) -> Report:
    from seo.competitors import gaps

    site_id = _site(args)
    data = gaps.link_gaps(engine, site_id)
    funnel = data.get("funnel") or {}
    report = Report("link-gaps", "Link gaps", site=registry.site_host(engine, site_id))
    report.tiles = [
        Tile("Sites found", funnel.get("found"), "int"), Tile("Worth a look", funnel.get("good"), "int"),
        Tile("Filtered out", funnel.get("filtered"), "int"), Tile("Already link to me", data.get("already_linking"), "int"),
    ]
    columns = _gap_columns()
    report.tables.append(Table("gaps", "Sites that link to competitors, not to me", [c for c in columns if c.key != "reason_words"], data.get("gaps") or [], total=funnel.get("good"), empty="No link gaps found yet."))
    report.tables.append(Table("filtered", "Filtered out", [c for c in columns if c.key != "in_consideration"], data.get("filtered") or [], total=funnel.get("filtered"), empty="Nothing was filtered out."))
    return report


AI_STATES = {"present": "Shown", "none": "Not shown", "absent": "Not shown", "not_captured": "Not captured", "unknown": "Not captured"}
AI_KINDS = {"rival_cited": "A competitor was cited", "rival_dropped": "A competitor is no longer cited", "me_cited": "I was cited", "me_dropped": "I am no longer cited",
            "overview_appeared": "An AI Overview appeared", "overview_gone": "The AI Overview went away"}


@view("ai-watch", "AI Overview watch")
def ai_overview_watch(engine, args) -> Report:
    from seo.competitors import ai_watch

    site_id = _site(args)
    data = ai_watch.watch(engine, site_id)
    summary = data.get("summary") or {}
    report = Report("ai-watch", "AI Overview watch", site=registry.site_host(engine, site_id))
    report.tiles = [
        Tile("Keywords followed", summary.get("tracked"), "int"), Tile("With an AI Overview", summary.get("with_overview"), "int"),
        Tile("Where I am cited", summary.get("cited_me"), "int"), Tile("Not captured", summary.get("not_captured"), "int"),
    ]
    trend = data.get("trend") or []
    if len(trend) > 1:
        from seo.exports.model import Chart, Series

        report.charts.append(Chart("AI Overviews", [str(p.get("day"))[:10] for p in trend],
                                   [Series("With an AI Overview", [p.get("overviews") for p in trend]), Series("Where I am cited", [p.get("cited_me") for p in trend])]))
    report.tables.append(Table("keywords", "Keywords", [
        C("keyword", "Keyword", "text", width=3.6), C("country", "Country", "text", width=1),
        C("state", "AI Overview", "text", width=1.6, get=lambda r: AI_STATES.get(r.get("state"), _humanise(r.get("state"))), translate=True), C("cited_me", "Cites me", "bool"),
        C("competitors_cited", "Competitors cited", "text", width=3.4, get=lambda r: ", ".join(str(x.get("host")) for x in r.get("competitors_cited") or [])),
        C("others_cited", "Other sites cited", "text", width=3.4), C("my_cited_urls", "My pages cited", "text", width=3.4), C("checked_at", "Checked", "date"),
    ], data.get("keywords") or [], empty="No keyword has been checked for an AI Overview yet.", key="keyword"))
    report.tables.append(Table("rivals", "Competitors cited most", [C("host", "Competitor", "text"), C("keywords", "Keywords", "int")], summary.get("rivals") or [], empty="No competitor is cited."))
    report.tables.append(Table("changes", "What changed", [
        C("at", "When", "datetime"), C("kind", "What", "text", width=3, get=lambda r: AI_KINDS.get(r.get("kind"), _humanise(r.get("kind"))), translate=True),
        C("keyword", "Keyword", "text", width=3.4), C("competitor", "Competitor", "text", width=2.6),
    ], data.get("changes") or [], empty="Nothing changed."))
    return report


@view("competitor-notes", "Competitor notes")
def competitor_notes(engine, args) -> Report:
    """The Notes tab inside Competitors: the notes of one of my sites, about its competitors and their pages."""
    from seo.competitors import notes as service
    from seo.exports.views_work import _note_subject, _plain, _words, SCOPES

    site_id = _site(args)
    host = registry.site_host(engine, site_id)
    rows = [r for r in service.list_notes(engine, None, None, None, site_id, None, None, None, None, None) if not r.get("deleted_at") and r.get("scope") in ("all", "competitor", "page", "section") and (_plain(r.get("body")) or r.get("files"))]
    rows.sort(key=lambda r: (str(r.get("updated_at") or ""), r.get("id") or 0), reverse=True)
    report = Report("competitor-notes", "Competitor notes", site=host)
    report.tiles = [Tile("Notes", len(rows), "int"), Tile("With files", sum(1 for r in rows if r.get("files")), "int")]
    report.tables.append(Table("notes", "Notes", [
        C("updated_at", "Changed", "date"), C("scope", "Attached to", "text", width=1.4, get=lambda r: _words(SCOPES, r.get("scope")), translate=True),
        C("subject", "Which one", "text", width=3.2, get=_note_subject), C("body", "Note", "text", width=6.5, get=lambda r: _plain(r.get("body"))),
        C("files", "Files", "int", get=lambda r: len(r.get("files") or []) or None),
    ], rows, empty="No notes yet.", key="id"))
    return report
