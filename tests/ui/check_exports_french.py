"""Every export, in French, read cell by cell: is any English left?

  DB_NAME_TEST=test_export_test .venv/bin/python tests/ui/check_exports_french.py

Run it on the demo database (tests/ui/app_server.py fills it; the app need not be running). It builds every view in
French and reports:
  - a label, heading, tile or status word that has no French in seo/exports/words.py or seo/exports/sentences.py;
  - a cell whose words are on the English word list. That list is every English word the exports know (the keys of
    words.py) that isn't also a French word there, so made-up data in English (a keyword, a page title) is not flagged
    unless it uses those words. What it prints for a column of free text written by people is theirs, not ours.
Exit code 1 when a label or a status word is untranslated.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.exports import fmt, registry  # noqa: E402
from seo.exports.words import FR  # noqa: E402

WORD = re.compile(r"[A-Za-zÀ-ÿ']{4,}")
# Words people type or that are names: never a sign of an untranslated cell.
NAMES = {"google", "search", "console", "analytics", "clarity", "bing", "yandex", "serpapi", "semrush", "ahrefs", "moz", "common", "crawl", "fiverr", "firecrawl", "anthropic", "openrouter", "pagespeed",
         "insights", "indexnow", "webmaster", "bright", "data", "authority", "score", "media", "agency", "linkagency", "nour", "guest", "post", "home", "kitchen", "review", "local", "news"}


def english_words() -> set[str]:
    french = {w.lower() for value in FR.values() for w in WORD.findall(value)}
    return {w.lower() for key in FR for w in WORD.findall(key)} - french - NAMES


def check(engine, site: int, rival: int | None) -> tuple[list, list]:
    """(labels without French, cells with English words), for every view built in French. tests/test_exports.py runs it too."""
    english = english_words()
    period = {"from": "2026-10-12", "to": "2026-11-08", "compare_from": "2026-09-14", "compare_to": "2026-10-11"}
    labels, cells = [], []
    for view in registry.listing():
        args = {"site_id": str(site), **period, "range": "28d", "compare": "prev"}
        if view["id"] == "competitor":
            if not rival:
                continue
            args["competitor_id"] = str(rival)
        if view["id"] == "site-page":
            args["url"] = "/"
        for variant in ({}, {"site_id": None}) if view["id"] in ("today", "uptime", "tasks", "notes", "resources") else ({},):
            asked = {k: v for k, v in {**args, **variant}.items() if v is not None}
            fmt.MISSING.clear()
            report = registry.build(engine, view["id"], asked, "fr")
            said = [report.title, *(label for label, _value in report.filters), *(t.label for t in report.tiles), *(t.hint for t in report.tiles if t.hint), *report.notes,
                    *(c.title for c in report.charts), *(s.name for c in report.charts for s in c.series)]
            for table in report.tables:
                said += [table.title, table.empty, *(c.label for c in table.columns)] + ([table.note] if table.note else [])
                for column in table.columns:
                    if column.kind not in ("text", "url"):
                        continue
                    for row in table.rows:
                        raw = column.value(row)
                        shown = fmt.cell("fr", raw, column.kind, column.translate)
                        if column.kind == "url" or not shown:
                            continue
                        hits = sorted({w.lower() for w in WORD.findall(shown)} & english)
                        if hits:
                            cells.append((view["id"], table.id, column.label, "status word" if column.translate else "free text", shown[:90], hits))
            for words in said:
                fmt.tr("fr", words)
            # The header's filter values and a bar chart's labels are the app's words when they aren't typed text or names.
            for shown in [fmt.filter_value("fr", value) for _label, value in report.filters] + [fmt.cell("fr", label, "text", "known") for c in report.charts if c.kind == "bar" for label in c.labels]:
                hits = sorted({w.lower() for w in WORD.findall(shown)} & english)
                if hits:
                    cells.append((view["id"], "header", "filter or chart", "status word", shown[:90], hits))
            labels += [(view["id"], words) for words in sorted(fmt.MISSING)]
    return labels, cells


def main() -> int:
    engine = make_engine(test=True)
    with engine.connect() as conn:
        site = conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id LIMIT 1")).scalar()
        rival = conn.execute(text("SELECT competitor_id FROM site_competitors WHERE site_id = :s ORDER BY competitor_id LIMIT 1"), {"s": site}).scalar() if site else None
    if not site:
        print("No site in this database. Start tests/ui/app_server.py once to fill it.")
        return 2
    labels, cells = check(engine, site, rival)
    for view_id, words in sorted(set(labels)):
        print(f"NO FRENCH  {view_id}: {words!r}")
    seen = set()
    for view_id, table_id, column, kind, shown, hits in cells:
        if (view_id, table_id, column, shown) in seen:
            continue
        seen.add((view_id, table_id, column, shown))
        print(f"ENGLISH?   {view_id} / {table_id} / {column} ({kind}): {shown!r}  [{', '.join(hits)}]")
    status_words = [c for c in cells if c[3] == "status word"]
    print(f"\n{len(set(labels))} label(s) or status word(s) without French, {len(seen)} cell(s) with English words ({len({(c[0], c[1], c[2], c[4]) for c in status_words})} in columns the app writes itself).")
    return 1 if labels else 0


if __name__ == "__main__":
    raise SystemExit(main())
