#!/usr/bin/env python3
"""A compressed copy of the database, once a day through cron on hosting. Keeps the newest 14.

API keys inside it stay encrypted: the key that opens them lives elsewhere and is never dumped. Run by hand on the Mac.
A failed dump is removed, so a broken file can't pass for a good backup.
"""
from __future__ import annotations

import gzip
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from seo import config  # noqa: E402

KEEP = 14


def run(folder: Path | None = None, keep: int = KEEP, runner=subprocess.Popen) -> Path:
    folder = Path(folder) if folder else config.VAR / "backups" / "database"
    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    target = folder / f"{config.get('DB_NAME')}-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.sql.gz"
    partial = target.with_suffix(".partial")
    dump = shutil.which("mariadb-dump") or shutil.which("mysqldump")
    if not dump:
        raise SystemExit("Neither mariadb-dump nor mysqldump is installed.")
    # The password goes through the environment, so it never shows in the process list.
    env = {**os.environ, "MYSQL_PWD": config.get("DB_PASSWORD")}
    command = [dump, "-h", config.get("DB_HOST", "127.0.0.1"), "-P", config.get("DB_PORT", "3306"), "-u", config.get("DB_USER"), "--single-transaction", "--quick", "--default-character-set=utf8mb4", config.get("DB_NAME")]
    process = runner(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    try:
        with gzip.open(partial, "wb") as out:
            shutil.copyfileobj(process.stdout, out)
        error = process.stderr.read()
        if process.wait() != 0:
            raise SystemExit(f"The backup failed: {error.decode(errors='replace')[:400]}")
        os.chmod(partial, 0o600)
        partial.rename(target)
    finally:
        partial.unlink(missing_ok=True)
    for old in sorted(folder.glob("*.sql.gz"))[:-keep]:
        old.unlink()
    return target


if __name__ == "__main__":
    print(f"Saved {run()}")
