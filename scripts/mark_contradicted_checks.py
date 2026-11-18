#!/usr/bin/env python3
"""Stored rank checks that every other tool contradicts: marked suspect, with why (SEO review 2026-11-17, rankings 3.1-3.2).

  .venv/bin/python scripts/mark_contradicted_checks.py            # a dry run: says what it would mark, and changes nothing
  .venv/bin/python scripts/mark_contradicted_checks.py --apply    # does it. Back up first: .venv/bin/python scripts/backup_db.py

New checks are judged as they are saved (store.save_check → store.cross_check). This applies the same rule
(store.odd_one_out) to the checks saved before it: a check that shares fewer than 4 of its top-10 sites with every other
tool's check of the same keyword, from the same place, within 48 hours, while those checks are backed by another one. Its
rows are kept (a check is never overwritten). A suspect check never gives the shown position, is greyed on the keyword
panel with the reason, and raises no Insights finding. Then each own site's page pairs are rebuilt and Insights queued.
A second run marks nothing new.
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.serp import store  # noqa: E402


def run(engine, apply: bool) -> dict:
    marked: list[tuple[int, str]] = []
    with engine.begin() as conn:
        targets = [row[0] for row in conn.execute(text("SELECT DISTINCT target_id FROM serp_checks WHERE status = 'ok' ORDER BY target_id")).all()]
        seen: set[int] = set()
        for target in targets:
            found = store.judge_target(conn, target, apply=apply, marked_before=seen)
            seen.update(check_id for check_id, _ in found)
            marked += found
        tools = Counter()
        if marked:
            marks = ",".join(str(int(i)) for i, _ in marked)
            for tool, engine_name in conn.execute(text(f"SELECT c.tool, t.engine FROM serp_checks c JOIN serp_targets t ON t.id = c.target_id WHERE c.id IN ({marks})")).all():
                tools[f"{tool} on {engine_name}"] += 1
        sites = [row[0] for row in conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id")).all()]
    if apply and marked:
        from seo.competitors import pairs
        from seo.insights import engine as insights_engine

        for site_id in sites:
            pairs.refresh_auto_pairs(engine, site_id)
            insights_engine.enqueue(engine, site_id)  # Rank and clicks reads these checks
    return {"marked": marked, "tools": dict(tools), "sites": sites}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="mark them (without it, only say what would change)")
    parser.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    found = run(make_engine(test=args.test_db), args.apply)
    verb = "Marked" if args.apply else "Would mark"
    print(f"{verb} {len(found['marked'])} checks suspect: " + (", ".join(f"{n} {name}" for name, n in sorted(found["tools"].items())) or "none") + ".")
    if args.apply and found["marked"]:
        print(f"Pairs rebuilt and Insights queued for sites: {', '.join(map(str, found['sites']))}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
