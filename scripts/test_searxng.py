#!/usr/bin/env python3
"""Try a local SearXNG, one engine at a time, and record what really comes back.

    python scripts/test_searxng.py --engines bing,duckduckgo,yandex
    python scripts/test_searxng.py --engines google --max-keywords 3

Google is a separate run on a day with no browser tests, because they share an IP.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

ROOT = Path(__file__).resolve().parent.parent
KEYWORDS = ["creer societe dubai", "freezone dubai", "emirates id"]
OUR_SITE = "creer-societe-dubai.fr"
PAUSE_SECONDS = 5
# An unknown engine makes SearXNG fall back to its defaults, which include Google.
ENGINES = {"bing", "duckduckgo", "yandex", "brave", "google"}


def bare(host: str) -> str:
    return host[4:] if host.startswith("www.") else host


def search(client: httpx.Client, keyword: str, engine: str) -> dict:
    started = time.monotonic()
    try:
        response = client.get(
            "http://127.0.0.1:8899/search",
            params={"q": keyword, "format": "json", "language": "fr-FR", "engines": engine, "timeout_limit": 15},
        )
    except httpx.HTTPError as exc:
        return {"keyword": keyword, "engine": engine, "error": f"{type(exc).__name__}: {exc}"}
    if response.status_code != 200:
        return {"keyword": keyword, "engine": engine, "error": f"HTTP {response.status_code}"}
    data = response.json()
    domains: list[str] = []
    for row in data.get("results") or []:
        host = bare(urlparse(row.get("url") or "").hostname or "")
        if host:
            domains.append(host)
    return {
        "keyword": keyword,
        "engine": engine,
        "results": len(domains),
        "our_position": domains.index(OUR_SITE) + 1 if OUR_SITE in domains else None,
        "top_5": domains[:5],
        "unresponsive": data.get("unresponsive_engines") or [],
        "seconds": round(time.monotonic() - started, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engines", required=True)
    parser.add_argument("--max-keywords", type=int, default=len(KEYWORDS))
    args = parser.parse_args()

    unknown = {e.strip() for e in args.engines.split(",")} - ENGINES
    if unknown:
        parser.error(f"unknown engines: {sorted(unknown)}; choose from {sorted(ENGINES)}")

    rows = []
    with httpx.Client(timeout=30, trust_env=False) as client:
        for engine in args.engines.split(","):
            for keyword in KEYWORDS[: args.max_keywords]:
                row = search(client, keyword, engine.strip())
                rows.append(row)
                print(json.dumps(row, ensure_ascii=False), flush=True)
                time.sleep(PAUSE_SECONDS)

    out = ROOT / "reports" / "raw"
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (out / f"searxng-{stamp}.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
