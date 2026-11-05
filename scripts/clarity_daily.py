#!/usr/bin/env python3
"""Run the Clarity harvester at most once per site per UTC day.

Cron on hosting starts this every hour. It runs `harvest.py --site X --only-missing`,
the unchanged harvester from the Clarity project.

Why this guard exists: a project allows 10 requests a day and a pass costs 7, and
--only-missing guards the "logical day" (now minus 12 h). A morning and an
afternoon run can be two logical days inside one UTC day, which is 14 requests:
the second pass hits 429 partway and eats the requests kept for recovery. So a site
gets one pass per UTC day, first chance after 06:00 UTC (10:00 Dubai), to keep pulls
about 24 h apart. A site whose last pass is over 30 h old goes immediately, because
the API only reaches back 72 h.

A stamp is written only if a manifest from this run shows a request that reached the
API. A crash or a dead network spent nothing, so the next hourly run tries again.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
import tomllib
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLARITY_DIR = ROOT.parent / "Clarity Analaysis"
DEFAULT_VAR_DIR = ROOT / "var"
FIRST_HOUR_UTC = 6
OVERDUE_HOURS = 30
HARVEST_TIMEOUT_SECONDS = 600


class NoSites(Exception):
    pass


@contextmanager
def lock(var_dir: Path):
    folder = Path(var_dir) / "clarity"
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / "run.lock", "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def active_sites(clarity_dir: Path) -> list[str]:
    config = clarity_dir / "config"
    for name in ("sites.generated.toml", "sites.toml"):
        path = config / name
        if path.exists():
            with open(path, "rb") as handle:
                data = tomllib.load(handle)
            slugs = [s["slug"] for s in data.get("site", []) if s.get("active", True)]
            if slugs:
                return slugs
    raise NoSites(f"No active Clarity sites in {config}")


def _stamp_path(var_dir: Path, slug: str) -> Path:
    return Path(var_dir) / "clarity" / f"{slug}.json"


def _read_stamp(var_dir: Path, slug: str) -> dict | None:
    try:
        return json.loads(_stamp_path(var_dir, slug).read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _write_stamp(var_dir: Path, slug: str, now: datetime) -> None:
    path = _stamp_path(var_dir, slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump({"day": now.date().isoformat(), "at": now.isoformat()}, handle)


def _spent_quota_since(clarity_dir: Path, slug: str, started_ns: int) -> bool:
    """Did a manifest written by this run record a request reaching the API?"""
    for manifest in (clarity_dir / "data" / "raw" / slug).glob("*/*__manifest.json"):
        if manifest.stat().st_mtime_ns < started_ns:
            continue
        try:
            calls = json.loads(manifest.read_text()).get("calls", [])
        except (OSError, json.JSONDecodeError):
            continue
        if any(call.get("http_status") == 200 for call in calls):
            return True
    return False


def run_site(slug: str, now: datetime, clarity_dir: Path, var_dir: Path, python: str) -> str:
    stamp = _read_stamp(var_dir, slug)
    if stamp:
        if stamp.get("day") == now.date().isoformat():
            return "already_today"
        last = datetime.fromisoformat(stamp["at"])
        age_hours = (now - last).total_seconds() / 3600
        if now.hour < FIRST_HOUR_UTC and age_hours < OVERDUE_HOURS:
            return "too_early"

    started_ns = time.time_ns()
    try:
        subprocess.run(
            [python, "harvest.py", "--site", slug, "--only-missing"],
            cwd=clarity_dir,
            timeout=HARVEST_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(f"[{slug}] harvester timed out after {HARVEST_TIMEOUT_SECONDS} s", file=sys.stderr)

    if _spent_quota_since(clarity_dir, slug, started_ns):
        _write_stamp(var_dir, slug, now)
        return "harvested"
    return "no_quota_spent"


def run_all(
    now: datetime | None = None,
    clarity_dir: Path = DEFAULT_CLARITY_DIR,
    var_dir: Path = DEFAULT_VAR_DIR,
    python: str | None = None,
) -> dict[str, str]:
    now = now or datetime.now(timezone.utc)
    clarity_dir, var_dir = Path(clarity_dir), Path(var_dir)
    python = python or str(clarity_dir / ".venv" / "bin" / "python")
    with lock(var_dir) as held:
        if not held:
            return {"_": "busy"}
        return {slug: run_site(slug, now, clarity_dir, var_dir, python) for slug in active_sites(clarity_dir)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily Clarity pull, at most once per site per UTC day.")
    parser.add_argument("--clarity-dir", type=Path, default=DEFAULT_CLARITY_DIR)
    parser.add_argument("--var-dir", type=Path, default=DEFAULT_VAR_DIR)
    args = parser.parse_args()
    outcomes = run_all(clarity_dir=args.clarity_dir, var_dir=args.var_dir)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(stamp, " ".join(f"{slug}={result}" for slug, result in outcomes.items()), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
