#!/usr/bin/env python3
"""Rank checks read from Google's hidden result links before the fix of 2026-11-11: marked suspect, and what they decided undone.

  .venv/bin/python scripts/mark_hidden_google_links.py            # a dry run: says what it would change, and changes nothing
  .venv/bin/python scripts/mark_hidden_google_links.py --apply    # does it. Back up first: .venv/bin/python scripts/backup_db.py

Google may put its own redirect (https://www.google.com/goto?url=CAES…) where a result's address should be. Before the fix the
app took that redirect for the address, so the result was filed under google.com: your site at #1 read as "google.com at #1",
and you as "not in the top 10". The token can't be decoded, so those rows can't be repaired. This script:

1. marks each "ok" check holding such a row as suspect, with a sentence the keyword panel shows. Its rows are kept (a check is
   never overwritten), and a suspect check counts for nothing: not ranked, not "not ranked", in no competitor number or pair;
2. says "not captured" for a check whose AI Overview sources hold such a link: who it cites can't be said;
3. clears the "Is the linking page on Google" answers "not found" and "not indexed" decided since 30 October (when Google began
   slowing these links down), so the daily job searches those pages again on free credits. "Indexed" answers stay: a page that
   was found was really found. --only-bright-data narrows it to the answers Bright Data gave;
4. rebuilds the automatic page pairs and queues Insights for each of your sites. The other screens read live.

A row is a Google redirect by the same rule the search tools now use (seo.serp.tools.google_redirect). A second run changes
no check again. --until fixes the end of step 3 (the moment the fix went live); without it, it's now.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import Engine, bindparam, text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.serp.tools import google_redirect  # noqa: E402

SINCE = "2026-10-30"
CHUNK = 500
# Narrowed in SQL first, then each row is confirmed in Python by google_redirect().
_CANDIDATES = "(r.host LIKE 'google.%' OR r.host LIKE 'www.google.%') AND (r.url LIKE '%/goto?%' OR r.url LIKE '%/url?%')"


def sentence(n: int) -> str:
    """What the keyword panel shows beside the check."""
    return f"Google hid the address of {n} result{'' if n == 1 else 's'} in this check, so it can't say who isn't there."


def _hidden_rows(conn) -> list[dict]:
    rows = conn.execute(text(
        "SELECT r.check_id, r.url, c.tool, c.status, DATE(c.checked_at) AS day FROM serp_results r JOIN serp_checks c ON c.id = r.check_id "
        f"WHERE {_CANDIDATES} ORDER BY r.check_id, r.position"
    )).mappings().all()
    return [dict(r) for r in rows if google_redirect(r["url"])]


def _hidden_citations(conn) -> list[int]:
    """Checks whose AI Overview sources hold a Google redirect, and that still claim to know who it cites."""
    rows = conn.execute(text(
        "SELECT r.check_id, r.url FROM ai_citations r JOIN serp_checks c ON c.id = r.check_id "
        f"WHERE c.ai_state <> 'not_captured' AND {_CANDIDATES} ORDER BY r.check_id"
    )).mappings().all()
    return sorted({r["check_id"] for r in rows if google_redirect(r["url"])})


def _index_answers(conn, since: str, until: str, only_tool: str | None) -> list[dict]:
    clause = "AND src_index_via = :tool" if only_tool else ""
    return [dict(r) for r in conn.execute(text(
        "SELECT id, src_index, src_index_via FROM backlinks WHERE src_index IN ('not_found', 'not_indexed') "
        f"AND src_index_at >= :since AND src_index_at < :until {clause} ORDER BY id"
    ), {"since": since, "until": until, "tool": only_tool}).mappings().all()]


def survey(engine: Engine, since: str = SINCE, until: str | None = None, only_tool: str | None = None) -> dict:
    """Everything the dry run says, and everything apply() would change. Reads only."""
    with engine.connect() as conn:
        until = until or str(conn.execute(text("SELECT UTC_TIMESTAMP()")).scalar())
        hidden = _hidden_rows(conn)
        citations = _hidden_citations(conn)
        index = _index_answers(conn, since, until, only_tool)
        sites = [r[0] for r in conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id"))]
    by_kind: dict[tuple, dict] = {}
    to_mark: dict[int, int] = {}
    for row in hidden:
        group = by_kind.setdefault((str(row["day"]), row["tool"], row["status"]), {"day": str(row["day"]), "tool": row["tool"], "status": row["status"], "checks": set(), "rows": 0})
        group["checks"].add(row["check_id"])
        group["rows"] += 1
        if row["status"] == "ok":
            to_mark[row["check_id"]] = to_mark.get(row["check_id"], 0) + 1
    answers: dict[tuple, int] = {}
    for row in index:
        key = (row["src_index_via"] or "", row["src_index"])
        answers[key] = answers.get(key, 0) + 1
    return {
        "groups": [{**g, "checks": len(g["checks"])} for _, g in sorted(by_kind.items())],
        "to_mark": to_mark, "citations": citations, "index": [r["id"] for r in index],
        "index_groups": [{"via": via, "state": state, "answers": n} for (via, state), n in sorted(answers.items())],
        "since": since, "until": until, "only_tool": only_tool, "sites": sites,
    }


def _ids(conn, sql: str, ids: list[int], **params) -> int:
    done = 0
    for start in range(0, len(ids), CHUNK):
        done += conn.execute(text(sql).bindparams(bindparam("ids", expanding=True)), {"ids": ids[start:start + CHUNK], **params}).rowcount
    return done


def apply(engine: Engine, since: str = SINCE, until: str | None = None, only_tool: str | None = None) -> dict:
    """Does what survey() found, in one transaction, then rebuilds what reads it. Returns survey() and what was changed."""
    from seo.competitors import pairs  # imported here: the dry run needs none of this
    from seo.insights import engine as insights_engine

    found = survey(engine, since, until, only_tool)
    marked = cited = cleared = 0
    with engine.begin() as conn:
        for check_id, n in sorted(found["to_mark"].items()):
            marked += conn.execute(
                text("UPDATE serp_checks SET status = 'suspect', error = :e WHERE id = :i AND status = 'ok'"), {"e": sentence(n), "i": check_id}
            ).rowcount
        if found["citations"]:
            cited = _ids(conn, "UPDATE serp_checks SET ai_state = 'not_captured' WHERE id IN :ids AND ai_state <> 'not_captured'", found["citations"])
        if found["index"]:
            cleared = _ids(
                conn,
                "UPDATE backlinks SET src_index = NULL, src_index_via = NULL, src_index_at = NULL, src_index_misses = 0 "
                "WHERE id IN :ids AND src_index IN ('not_found', 'not_indexed')",
                found["index"],
            )
    rebuilt = []
    if marked or cited:
        for site_id in found["sites"]:
            pairs.refresh_auto_pairs(engine, site_id)
            insights_engine.enqueue(engine, site_id)  # Rank and clicks reads these checks
            rebuilt.append(site_id)
    return {**found, "marked": marked, "cited": cited, "cleared": cleared, "rebuilt": rebuilt}


def _many(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def report(found: dict, applied: bool) -> str:
    lines = ["Checks holding a Google redirect where an address should be (by day, tool and status):"]
    lines += [f"  {g['day']}  {g['tool']:<20} {g['status']:<8} {g['checks']:>5} {'check' if g['checks'] == 1 else 'checks':<6}  {g['rows']:>6} {'row' if g['rows'] == 1 else 'rows'}" for g in found["groups"]] or ["  none"]
    verb = "Marked" if applied else "Would mark"
    lines.append(f"{verb} suspect: {_many(found['marked'] if applied else len(found['to_mark']), 'check')} that said \"ok\".")
    verb = "Set" if applied else "Would set"
    lines.append(f"{verb} the AI Overview to \"not captured\" on {_many(found['cited'] if applied else len(found['citations']), 'check')}.")
    narrow = f", given by {found['only_tool']}" if found["only_tool"] else ""
    lines.append(f"\"Is the linking page on Google\" answers from {found['since']} to {found['until']} UTC{narrow}:")
    lines += [f"  {g['via'] or '(no tool)':<20} {g['state']:<12} {g['answers']:>5}" for g in found["index_groups"]] or ["  none"]
    verb = "Cleared" if applied else "Would clear"
    lines.append(f"{verb}: {_many(found['cleared'] if applied else len(found['index']), 'answer')}, searched again by the daily job.")
    if applied:
        lines.append(f"Pairs rebuilt and Insights queued for sites: {', '.join(map(str, found['rebuilt'])) or 'none (nothing changed)'}.")
    else:
        lines.append(f"Would rebuild pairs and queue Insights for sites: {', '.join(map(str, found['sites'])) if found['to_mark'] or found['citations'] else 'none'}.")
        lines.append("Nothing was changed. Back up first (scripts/backup_db.py), then run it again with --apply.")
    return "\n".join(lines)


def _moment(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("use a date such as 2026-11-12 or 2026-11-12T09:30") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="write the changes (without it: a dry run)")
    parser.add_argument("--since", type=_moment, default=SINCE, help=f"oldest backlink answer to clear (default {SINCE})")
    parser.add_argument("--until", type=_moment, default=None, help="newest backlink answer to clear (default: now)")
    parser.add_argument("--only-bright-data", action="store_true", help="clear only the backlink answers Bright Data gave")
    parser.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    engine = make_engine(test=args.test_db)
    only = "Bright Data" if args.only_bright_data else None
    if args.apply:
        print(report(apply(engine, args.since, args.until, only), True))
    else:
        print(report({**survey(engine, args.since, args.until, only), "marked": 0, "cited": 0, "cleared": 0}, False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
