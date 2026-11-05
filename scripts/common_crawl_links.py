"""Find who links to each competitor, from Common Crawl's newest web graph. Free, with no key. Run it on the Mac.

  .venv/bin/python scripts/common_crawl_links.py                      # every competitor in the app
  .venv/bin/python scripts/common_crawl_links.py --domains a.com,b.fr --csv-only    # just make the files

About 11 GB passes through this Mac, which took about 7 minutes on the first real run. It never stores the big files, except a
1 GB list it deletes at the end. Results go to var/common-crawl/<release>/<domain>.csv and into the app's database,
where spam is flagged and only the good ones can be added. Once the app is on hosting, upload the CSV in Link gaps instead.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from seo import config  # noqa: E402
from seo.backlinks.cleaner import root_domain  # noqa: E402
from seo.competitors import commoncrawl as cc  # noqa: E402
from seo.competitors import gaps, quality  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.serp.store import to_ascii_host  # noqa: E402


def say(message: str) -> None:
    print(message, flush=True)


def keep_vertices(client: httpx.Client, release: str, folder: Path) -> Path:
    path = folder / "vertices.txt.gz"
    if path.exists():
        return path
    partial = path.with_suffix(".part")
    say("Downloading the list of domains (about 1 GB)...")
    with partial.open("wb") as out:
        for chunk in cc.download_chunks(client, cc.file_url(release, "vertices")):
            out.write(chunk)
    partial.rename(path)
    return path


def from_disk(path: Path):
    with path.open("rb") as stream:
        while chunk := stream.read(cc.CHUNK_BYTES):
            yield chunk


def lines_of(path: Path):
    return cc.whole_lines(cc.gunzip_blocks(from_disk(path)))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--domains", help="comma-separated, instead of every competitor in the app")
    parser.add_argument("--csv-only", action="store_true", help="write the files without touching the database")
    parser.add_argument("--test-db", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    engine = None if args.csv_only else make_engine(test=args.test_db)
    competitor_ids: dict[str, int] = {}
    if args.domains:
        domains = [root_domain(to_ascii_host(d.strip())) or d.strip() for d in args.domains.split(",") if d.strip()]
    else:
        if engine is None:
            parser.error("--csv-only needs --domains")
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT DISTINCT s.id, s.host FROM sites s JOIN site_competitors sc ON sc.competitor_id = s.id")).all()
        domains = []
        for site_id, host in rows:
            name = root_domain(to_ascii_host(host)) or host
            competitor_ids[name] = site_id
            domains.append(name)
    if engine is not None and args.domains:
        with engine.connect() as conn:
            for domain in domains:
                found = conn.execute(text("SELECT id FROM sites WHERE kind = 'competitor' AND (host = :d OR host LIKE :sub) LIMIT 1"), {"d": domain, "sub": f"%.{domain}"}).scalar()
                if found:
                    competitor_ids[domain] = found
    if not domains:
        say("No competitors to look up. Add some first, or pass --domains.")
        return 0

    client = httpx.Client(timeout=120, headers={"User-Agent": cc.USER_AGENT}, follow_redirects=True)
    release = cc.latest_release(client)
    say(f"Release {release['id']}: {release['domains']:,} domains. Looking up: {', '.join(domains)}")
    folder = config.VAR / "common-crawl" / release["id"]
    folder.mkdir(parents=True, exist_ok=True)

    vertices = keep_vertices(client, release["id"], folder)
    ids = cc.find_ids(lines_of(vertices), domains)
    missing = [d for d in domains if d not in ids]
    if missing:
        say(f"Not in this release, so nothing can be found for: {', '.join(missing)}")
    if not ids:
        return 0

    say("Reading who links to whom (about 7.6 GB, compressed). This is the long part...")
    marks = [0]

    def progress(read: int) -> None:
        if read - marks[0] >= 5_000_000_000:
            marks[0] = read
            say(f"  {read / 1e9:,.0f} GB read after unpacking, of about 35 GB")

    found = cc.find_referrers(cc.whole_lines(cc.gunzip_blocks(cc.download_chunks(client, cc.file_url(release["id"], "edges")))), {n: d for d, n in ids.items()}, progress)
    numbers = {number for per in found.values() for number in per}
    say(f"Found {len(numbers):,} linking domains. Naming them...")
    names = cc.names_for(lines_of(vertices), numbers)

    say("Reading the ranking (2.5 GB)...")
    ranks = cc.ranks_for(cc.whole_lines(cc.gunzip_blocks(cc.download_chunks(client, cc.file_url(release["id"], "ranks")))), {name for name, _ in names.values()}, 10**12)

    for domain, per in found.items():
        rows = []
        for number, outlinks in per.items():
            if number not in names:
                continue
            name, hosts = names[number]
            rows.append({"domain": name, "rank": ranks.get(name), "total": release["domains"], "outlinks": outlinks, "hosts": hosts})
        path = folder / f"{domain}.csv"
        with path.open("w", newline="", encoding="utf-8") as out:
            writer = csv.writer(out)
            writer.writerow([gaps.CC_HEADERS[0], *gaps.CC_HEADERS[1:]])
            for row in rows:
                writer.writerow([row["domain"], row["rank"] or "", row["total"], row["outlinks"], row["hosts"], release["id"]])
        say(f"{domain}: {len(rows):,} linking domains, saved to {path}")
        if engine is not None and domain in competitor_ids:
            report = gaps.import_common_crawl(engine, competitor_ids[domain], rows, release["id"])
            say(f"  in the app: {report['filtered']:,} flagged as spam, {report['to_check']:,} home pages to read next")
    (folder / "vertices.txt.gz").unlink(missing_ok=True)
    say("Done. Home pages are read by the worker, and Link gaps then shows which domains are good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
