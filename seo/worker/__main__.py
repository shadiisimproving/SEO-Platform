"""Command line for the scheduler: python -m seo.worker tick --lane crawl"""
from __future__ import annotations

import argparse
import sys

from seo.backlinks import ahrefs as backlink_ahrefs, indexed as backlink_indexed, live as backlink_checks, logos, reclaim as backlink_reclaim, source_index as backlink_source_index  # noqa: F401 - register their job handlers
from seo.uptime import service as uptime_service  # registers the uptime check's job handler
from seo.competitors import crawl as competitor_crawl, firecrawl, history, keywords, pages, probe, quality  # noqa: F401 - register their job handlers
from seo.collectors import jobs as collector_jobs
from seo.extras import auto as extras_auto  # registers its job handler
from seo.core.db import make_engine
from seo.health import indexing as health_indexing, service as health_service  # register the health test's and the indexing check's job handlers
from seo.insights import engine as insights_engine  # noqa: F401 - registers the Search insights job handler
from seo.links import service as links_service  # registers the links checker's job handler
from seo.notifications import new_queries  # noqa: F401 - registers the new-search notification's job handler
from seo.social import transcripts as social_transcripts  # noqa: F401 - registers the video transcript job handler
from seo.serp import auto_ddg, refresh  # noqa: F401 - refresh registers the Refresh button's job handler. Only collect-due starts one: auto_ddg's free DuckDuckGo check.
from seo.worker.runner import EXIT_CODES, tick


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="seo.worker")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("tick", help="run one short pass of one lane")
    run.add_argument("--lane", required=True)
    run.add_argument("--budget", type=float, default=50, help="seconds before it stops claiming jobs")
    run.add_argument("--db-wait", type=float, default=600, help="seconds to wait for the database")
    run.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    due = commands.add_parser("links-due", help="queue a links check for each of my sites not checked in 7 days")
    due.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    health = commands.add_parser("health-due", help="queue a health test for each of my sites with none this month")
    health.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    rivals = commands.add_parser("competitors-due", help="queue today's read of each competitor, and carry on keyword lists that waited for a tool")
    rivals.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    watch = commands.add_parser("uptime-due", help="queue an uptime check for each of my sites not checked in the last 10 minutes, and run them")
    watch.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    watch.add_argument("--budget", type=float, default=240, help="seconds before it stops checking")
    placed = commands.add_parser("backlinks-due", help="queue a live check for each of my sites with a backlink due one")
    placed.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    social = commands.add_parser("social-due", help="read each Social site's feeds and newsletters, then ask Grok for X trends and posts to comment on")
    social.add_argument("--no-grok", action="store_true", help="feeds and newsletters only")
    social.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    collect = commands.add_parser("collect-due", help="queue each site's data sources that are due, this month's authority scores, and today's DuckDuckGo positions")
    collect.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    engine = make_engine(test=args.test_db)
    if args.command == "social-due":
        from seo.social import service as social_service

        for done in social_service.gather_day(engine, with_grok=not args.no_grok):
            rss, mail, grok = done["rss"], done["mail"], done["grok"]
            print(f"social-due: site {done['site_id']}: {rss['added']} from feeds, {mail.get('added', 0)} from newsletters, "
                  f"grok {grok.get('error') or grok.get('targets', 0) if not grok.get('skipped') else 'off'}")
        return 0
    if args.command == "collect-due":
        queued = collector_jobs.enqueue_due(engine)
        collector_jobs.enqueue_authority(engine)
        ddg = auto_ddg.enqueue_due(engine)  # DuckDuckGo positions once a day, with its free tool only (owner, 2026-11-11)
        ddg_words = f", DuckDuckGo positions for {len(ddg)} site{'' if len(ddg) == 1 else 's'}" if ddg else ""
        print(f"collect-due: queued {len(queued)} source{'' if len(queued) == 1 else 's'}{ddg_words}")
        return 0
    if args.command == "uptime-due":
        queued = uptime_service.enqueue_due(engine)
        # Run at once, in uptime's own lane: a check never waits for the crawl lane's next tick, or behind a scan (F14).
        done = tick(engine, uptime_service.LANE, budget_seconds=args.budget, db_wait_seconds=60)
        print(f"uptime-due: queued {len(queued)} site{'' if len(queued) == 1 else 's'}, checked {done.processed}")
        return 0
    if args.command == "backlinks-due":
        queued = backlink_checks.enqueue_due(engine)
        reclaim_queued = backlink_reclaim.enqueue_due(engine)  # the same monthly rhythm: my pages that Search Console says have links
        inspect_queued = backlink_indexed.enqueue_due(engine)  # is each linked page of mine indexed: sites with Search Console connected
        searched = backlink_source_index.enqueue_due(engine)  # is each linking page on Google: site: searches on free credits
        traffic = backlink_ahrefs.enqueue(engine)  # each linking website's traffic, only with an Ahrefs key
        print(f"backlinks-due: queued {len(queued)} site{'' if len(queued) == 1 else 's'}, {len(reclaim_queued)} for reclaim, {len(inspect_queued)} for the index check"
              f"{', the linking pages search' if searched else ''}{', Ahrefs traffic' if traffic else ''}")
        return 0
    if args.command == "links-due":
        queued = links_service.enqueue_due(engine)
        print(f"links-due: queued {len(queued)} site{'' if len(queued) == 1 else 's'}")
        return 0
    if args.command == "health-due":
        queued = health_service.enqueue_due(engine)
        inspecting = health_indexing.enqueue_due(engine)  # is every page on Google: URL Inspection, spread over days within the quota
        print(f"health-due: queued {len(queued)} site{'' if len(queued) == 1 else 's'}" + (f", {len(inspecting)} for the indexing check" if inspecting else ""))
        return 0
    if args.command == "competitors-due":
        queued = competitor_crawl.enqueue_due(engine)
        resumed = keywords.resume_waiting(engine)
        quality.queue_checks(engine)  # linking domains still waiting for their home page to be read
        history.enqueue_due(engine)  # the Wayback Machine and domain dates: monthly, or the next day after a failed try
        extras_auto.enqueue_due(engine)  # Moz and Cloudflare for every website, once a month each
        firecrawl_weekly = firecrawl.enqueue_weekly(engine)  # only where the owner said yes to its weekly cost
        guessed = competitor_crawl.guess_blocked_edits(engine)  # sites that block the reader: titles that changed in my ranking checks
        mine = competitor_crawl.own_count(engine, queued)  # my own sites are read daily too, so their pages sit beside a competitor's
        rivals = len(queued) - mine
        own_words = f" and {mine} of my sites" if mine else ""
        weekly_words = f", {len(firecrawl_weekly)} weekly Firecrawl check{'' if len(firecrawl_weekly) == 1 else 's'}" if firecrawl_weekly else ""
        print(f"competitors-due: queued {rivals} competitor{'' if rivals == 1 else 's'}{own_words}, resumed {len(resumed)} keyword list{'' if len(resumed) == 1 else 's'}{weekly_words}{f', {guessed} probable edit' + ('' if guessed == 1 else 's') + ' on blocked sites' if guessed else ''}")
        return 0
    result = tick(engine, args.lane, budget_seconds=args.budget, db_wait_seconds=args.db_wait)
    line = (
        f"{result.lane}: {result.status} processed={result.processed} "
        f"failed={result.failed} recovered={result.recovered}"
    )
    if result.message:
        line += f" ({result.message})"
    print(line, file=sys.stdout if result.status in ("ok", "busy") else sys.stderr)
    return EXIT_CODES[result.status]


if __name__ == "__main__":
    sys.exit(main())
