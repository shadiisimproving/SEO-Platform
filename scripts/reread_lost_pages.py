"""Read again the pages whose title or headings were saved as "?" (2026-11-20, the owner: "we need the system to read it").

Before the utf8mb4 conversion the tables were latin1, so a page in Arabic, Russian or another script kept "?????" for a
title. The conversion keeps what is read next; the daily read then repairs each such page when its turn comes, with no
edit recorded (seo.crawl.store.text_was_lost). This script only brings that forward, so the screens are right sooner.
Only after the conversion: it refuses to run before, since it would save "?" again.

    python -m scripts.reread_lost_pages                 dry run: per site, how many pages would be read again. Changes nothing
    python -m scripts.reread_lost_pages --apply         reads one batch (200 pages, politely: robots.txt, spacing per site
                                                        and the daily request budget all apply), then stops
    options: --pages N (pages per run, default 200), --host example.com (one site only), --test (DB_NAME_TEST)

Safe to run twice: a page read again is no longer "?", so it isn't picked again. A page that is gone, blocked or still
unreadable keeps its "?" and is counted as left; the screens show its address instead of its title. Exit code 3 means
pages are left that could still be read, so a loop can carry on:

    until python -m scripts.reread_lost_pages --apply; [ $? -ne 3 ]; do sleep 60; done
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402

from seo.competitors import pages  # noqa: E402
from seo.core import charset  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.core.models import Domain, Page  # noqa: E402
from seo.crawl import store  # noqa: E402
from seo.links import service as links_service  # noqa: E402

MORE_LEFT = 3
READABLE = ("ok", "not_modified")  # a page that answered last time; gone, blocked and moved ones can't give their text back


def not_converted(engine) -> list[str]:
    """The pages table's text columns still outside utf8mb4: while there's one, a read would save "?" again."""
    with engine.connect() as conn:
        return sorted({f"{c['tbl']}.{c['col']}" for c in charset.columns_to_convert(conn) if c["tbl"] in ("pages", "page_versions") and c["charset"] != charset.CHARSET})


def lost_pages(engine, host: str | None = None) -> list[dict]:
    """Every page whose stored title or headings are "?", the ones that answered last time first."""
    query = select(Page.__table__, Domain.host).join(Domain, Domain.id == Page.domain_id).where(Page.content_hash.is_not(None), Page.title.like("%??%") | Page.meta_description.like("%??%") | Page.h1.like("%??%") | Page.headings.like("%??%"))
    if host:
        query = query.where(Domain.host == host.lower())
    with engine.connect() as conn:
        rows = [r for r in conn.execute(query.order_by(Domain.host, Page.id)) if store.text_was_lost(r)]
    return [{"url": r.url, "host": r.host, "readable": r.last_status in READABLE, "firecrawl": r.read_with == "firecrawl"} for r in rows]


def run(engine, apply: bool, pages_per_run: int = 200, host: str | None = None, log=print) -> dict:
    """{host: {"done": repaired now, "failed": asked and still "?", "left": still to ask, "cannot": gone, blocked, or read by Firecrawl}}."""
    found = lost_pages(engine, host)
    out: dict[str, dict] = {}
    for p in found:
        slot = out.setdefault(p["host"], {"done": 0, "failed": 0, "left": 0, "cannot": 0})
        slot["left" if p["readable"] and not p["firecrawl"] else "cannot"] += 1
    if apply:
        fetcher = links_service.fetcher_factory()
        todo = [p for p in found if p["readable"] and not p["firecrawl"]][:pages_per_run]
        for p in todo:
            slot = out[p["host"]]
            slot["left"] -= 1
            try:
                pages.read_page(engine, p["url"], p["host"], fetcher)
            except Exception as exc:  # noqa: BLE001 - one page failing must not stop the run
                if log:
                    log(f"  {p['url']}: {type(exc).__name__}")
            with engine.connect() as conn:
                now = conn.execute(select(Page.__table__).where(Page.url == p["url"])).first()
            slot["failed" if store.text_was_lost(now) else "done"] += 1
    if log:
        for name, slot in sorted(out.items()):
            log(f"{name}: {slot['done']} read again, {slot['failed']} still unreadable, {slot['left']} left, {slot['cannot']} can't be read (gone, blocked or read another way)")
        if not out:
            log('No page holds "?" in its title or headings.')
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="read and save (without it, only say how many pages)")
    parser.add_argument("--pages", type=int, default=200, help="pages per run")
    parser.add_argument("--host", help="one site only")
    parser.add_argument("--test", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    engine = make_engine(test=args.test)
    waiting = not_converted(engine)
    if waiting:
        print(f"Not converted to utf8mb4 yet ({len(waiting)} columns, e.g. {waiting[0]}): a read would save \"?\" again. Run python -m scripts.convert_utf8mb4 first.")
        return 2
    out = run(engine, args.apply, args.pages, args.host)
    return MORE_LEFT if any(slot["left"] for slot in out.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
