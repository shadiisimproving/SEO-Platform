"""Read Search Console's queries and pages again for the days whose stored text is "?" (expert review 2026-11-17, 4c).

Before the utf8mb4 conversion the tables were latin1, so Arabic, Russian and other queries and page addresses were saved as
"?". The conversion keeps what comes next; this brings back the 16 months already stored. Only after the conversion:
it refuses to run before, since it would only save "?" again.

    python -m scripts.reread_gsc_text                  dry run: per site, how many days would be read again. Changes nothing
    python -m scripts.reread_gsc_text --apply          reads one batch per site (60 days, 3 calls a day, a pause between
                                                       calls), then stops. Run it again until it says 0 days left
    python -m scripts.reread_gsc_text --apply --all    every stored day, not only the ones holding a "?"
    options: --days N (days per site per run, default 60), --pause S (seconds between calls, default 0.5), --test (DB_NAME_TEST)

Resumable and safe to run twice: each day read is recorded (coverage, source gsc_text), so a stopped run carries on and a
finished one reads nothing. Exit code 3 means days are left, so a loop can carry on:

    until python -m scripts.reread_gsc_text --apply; [ $? -ne 3 ]; do sleep 60; done
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from seo.collectors import common, gsc  # noqa: E402
from seo.core import charset  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.sources import credentials  # noqa: E402

MORE_LEFT = 3
TEXT_COLUMNS = {"gsc_query", "gsc_query_page", "gsc_page", "gsc_query_country"}


def not_converted(engine) -> list[str]:
    """The Search Console text columns still outside utf8mb4: while there's one, a read would save "?" again."""
    with engine.connect() as conn:
        return sorted({f"{c['tbl']}.{c['col']}" for c in charset.columns_to_convert(conn) if c["tbl"] in TEXT_COLUMNS and c["charset"] != charset.CHARSET})


def run(engine, apply: bool, days_per_run: int = 60, pause: float = 0.5, every_day: bool = False, log=print) -> dict:
    """{site host: {"done": days read now, "left": days still to read}}."""
    with engine.connect() as conn:
        sites = conn.execute(text("SELECT s.id, s.host FROM sites s JOIN site_sources ss ON ss.site_id = s.id AND ss.source = 'gsc' WHERE s.kind = 'own' AND ss.connection_id IS NOT NULL ORDER BY s.id")).all()
    today = common.google_today(engine)
    oldest = today - timedelta(days=gsc.HISTORY_DAYS)
    out = {}
    for site_id, host in sites:
        days = gsc.text_days(engine, site_id, oldest, today, every_day)
        done = 0
        if apply and days:
            src = common.source_row(engine, site_id, "gsc")
            token = credentials.access_token(engine, src["connection_id"])
            for day in days[:days_per_run]:
                gsc.text_day(engine, site_id, token, src["property"], day, pause)
                done += 1
        out[host] = {"done": done, "left": len(days) - done}
        if log:
            log(f"{host}: {done} days read again, {len(days) - done} left")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="read and save (without it, only say how many days)")
    parser.add_argument("--all", action="store_true", help="every stored day, not only the ones holding a '?'")
    parser.add_argument("--days", type=int, default=60, help="days per site per run")
    parser.add_argument("--pause", type=float, default=0.5, help="seconds between two calls to Google")
    parser.add_argument("--test", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    engine = make_engine(test=args.test)
    pending = not_converted(engine)
    if pending:
        print(f"Not run: convert the database to utf8mb4 first, or the text comes back as '?' again ({', '.join(pending[:4])}…). "
              "Back up, then: python -m scripts.convert_utf8mb4", file=sys.stderr)
        return 1
    started = time.monotonic()
    found = run(engine, args.apply, max(1, args.days), max(0.0, args.pause), args.all)
    left = sum(v["left"] for v in found.values())
    print(f"Database: {engine.url.database} ({'applied' if args.apply else 'dry run, nothing read'}, {time.monotonic() - started:.1f} s). Days left: {left}.")
    return MORE_LEFT if args.apply and left else 0


if __name__ == "__main__":
    sys.exit(main())
