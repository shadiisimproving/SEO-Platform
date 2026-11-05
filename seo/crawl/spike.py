"""Measure a real crawl, so the plan's estimates come from data rather than guesses.

    python -m seo.crawl.spike site-a.com site-b.com --pages 150 --passes 2

Domains are input only. GET requests only, 3 s apart per domain, at most 4 domains at
once. The second pass shows how many pages answer 304 and how many are really unchanged.
"""
from __future__ import annotations

import argparse
import json
import resource
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo import config
from seo.core.db import make_engine
from seo.crawl import sitemap, store
from seo.crawl.extract import extract
from seo.crawl.fetch import PoliteFetcher

DOMAINS_AT_ONCE = 4
DAILY_REQUESTS = 40_000


def choose_pages(urls: list[str], count: int) -> list[str]:
    """Evenly spaced, so a sample isn't all from one section of the site."""
    if len(urls) <= count:
        return list(urls)
    step = len(urls) / count
    return [urls[int(i * step)] for i in range(count)]


def scale_estimate(
    seconds_per_page: float, cpu_ms_per_page: float, not_modified_rate: float, db_bytes_per_1000_pages: float
) -> dict:
    return {
        "crawl_hours_per_day": DAILY_REQUESTS * seconds_per_page / DOMAINS_AT_ONCE / 3600,
        "cpu_minutes_per_day": DAILY_REQUESTS * cpu_ms_per_page / 1000 / 60,
        "not_modified_rate": not_modified_rate,
        "baseline_db_mb": DAILY_REQUESTS * db_bytes_per_1000_pages / 1000 / 1_000_000,
    }


def _crawl_pass(engine, domain_id, urls, fetcher) -> dict:
    outcomes: Counter = Counter()
    statuses: Counter = Counter()
    parse_cpu = thread_cpu = 0.0
    total_bytes = js_only = 0
    words: list[int] = []
    started = time.monotonic()
    for url in urls:
        cpu_before = time.thread_time()
        etag, last_modified = store.validators(engine, url)
        result = fetcher.get(url, etag=etag, last_modified=last_modified)
        statuses[result.status] += 1
        total_bytes += result.bytes
        fields = None
        if result.status == "ok" and result.body is not None:
            parse_start = time.thread_time()
            fields = extract(result.body, result.final_url or url, charset=result.charset)
            parse_cpu += time.thread_time() - parse_start
            js_only += int(fields.js_only)
            words.append(fields.word_count)
        outcomes[store.save_fetch(engine, domain_id, url, result, fields)] += 1
        thread_cpu += time.thread_time() - cpu_before
    pages = len(urls) or 1
    return {
        "pages": len(urls),
        "outcomes": dict(outcomes),
        "statuses": dict(statuses),
        "seconds_per_page": (time.monotonic() - started) / pages,
        "parse_cpu_ms_per_page": parse_cpu * 1000 / pages,
        "total_cpu_ms_per_page": thread_cpu * 1000 / pages,
        "kb_per_page": total_bytes / 1024 / pages,
        "not_modified_rate": statuses["not_modified"] / pages,
        "unchanged_rate": outcomes["unchanged"] / pages,
        "changed_rate": outcomes["changed"] / pages,
        "blocked_rate": statuses["blocked"] / pages,
        "rate_limited_rate": statuses["rate_limited"] / pages,
        "js_only_rate": js_only / pages,
        "median_words": sorted(words)[len(words) // 2] if words else 0,
    }


def crawl_domain(engine: Engine, base_url: str, pages: int, passes: int, fetcher: PoliteFetcher | None = None) -> dict:
    own_fetcher = fetcher is None
    fetcher = fetcher or PoliteFetcher()
    host = urlsplit(base_url).netloc
    report: dict = {"domain": host, "passes": [], "sitemap_pages": 0, "note": ""}
    try:
        started = time.monotonic()
        found = sitemap.discover(fetcher, base_url, max_pages=max(pages * 20, 2000))
        report["sitemap_seconds"] = time.monotonic() - started
        report["sitemap_pages"] = len(found.entries)
        report["sitemap_capped"] = found.capped
        report["has_lastmod_rate"] = (
            sum(1 for e in found.entries if e.lastmod) / len(found.entries) if found.entries else 0
        )
        if not found.entries:
            report["note"] = "No readable sitemap, or the site refused us."
            return report
        urls = choose_pages([e.url for e in found.entries], pages)
        domain_id = store.get_or_create_domain(engine, host)
        for _ in range(passes):
            report["passes"].append(_crawl_pass(engine, domain_id, urls, fetcher))
        return report
    finally:
        if own_fetcher:
            fetcher.close()


def _db_bytes(engine: Engine) -> dict[str, int]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name, data_length + index_length FROM information_schema.tables "
                "WHERE table_schema = DATABASE()"
            )
        ).all()
    return {name: int(size or 0) for name, size in rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("domains", nargs="+")
    parser.add_argument("--pages", type=int, default=150)
    parser.add_argument("--passes", type=int, default=2)
    args = parser.parse_args()

    engine = make_engine()
    before = _db_bytes(engine)
    process_start = time.process_time()
    wall_start = time.monotonic()

    def run(domain: str) -> dict:
        try:
            return crawl_domain(engine, f"https://{domain}", args.pages, args.passes)
        except Exception as exc:  # noqa: BLE001 - one site must not end the measurement
            return {"domain": domain, "passes": [], "sitemap_pages": 0, "note": f"{type(exc).__name__}: {exc}"}

    with ThreadPoolExecutor(DOMAINS_AT_ONCE) as pool:
        reports = list(pool.map(run, args.domains))

    after = _db_bytes(engine)
    first_pages = sum(r["passes"][0]["pages"] for r in reports if r["passes"])
    growth = sum(after.values()) - sum(before.values())
    summary = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "domains": reports,
        "wall_minutes": (time.monotonic() - wall_start) / 60,
        "process_cpu_seconds": time.process_time() - process_start,
        "peak_memory_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1_048_576,
        "db_growth_bytes": growth,
        "db_bytes_per_1000_pages": growth / first_pages * 1000 if first_pages else 0,
        "db_by_table": {name: after.get(name, 0) - before.get(name, 0) for name in after},
    }
    out = config.ROOT / "reports" / "raw"
    out.mkdir(parents=True, exist_ok=True)
    path = Path(out / f"crawl-spike-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json")
    path.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"\nSaved to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
