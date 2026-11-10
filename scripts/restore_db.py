#!/usr/bin/env python3
"""Puts a database copy made by backup_db.py back. When to use it and in which order: deploy/DEPLOY.md, "Backups".

    python scripts/restore_db.py var/backups/database/<file>.sql.gz --replace     into the database named in .env
    python scripts/restore_db.py <file>.sql.gz --database <name>                  into another, empty database

The file is read back in full first. A database that already has tables is emptied only with --replace, because that
removes everything in it, including anything newer than the copy. It ends by printing how many rows each table has.
The encryption key isn't in the copy and isn't needed here; the app needs it afterwards to read the saved API keys.
"""
from __future__ import annotations

import argparse
import gzip
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.backup_db import verify_dump  # noqa: E402
from seo import config  # noqa: E402
from seo.core.db import make_engine  # noqa: E402


def row_counts(engine) -> dict[str, int]:
    with engine.connect() as conn:
        names = [name for (name,) in conn.execute(text("SHOW TABLES"))]
        return {name: conn.execute(text(f"SELECT COUNT(*) FROM `{name}`")).scalar() for name in names}


def restore(path: Path, database: str, replace: bool = False) -> dict[str, int]:
    if not re.fullmatch(r"\w+", database):
        raise SystemExit(f"Not a database name: {database!r}")
    verify_dump(Path(path))
    client = shutil.which("mariadb") or shutil.which("mysql")
    if not client:
        raise SystemExit("Neither mariadb nor mysql is installed.")
    engine = create_engine(make_engine().url.set(database=database))
    try:
        existing = list(row_counts(engine))
        if existing and not replace:
            raise SystemExit(
                f"{database} already has {len(existing)} tables. Add --replace to empty it first: that removes everything in it."
            )
        with engine.begin() as conn:
            conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
            for name in existing:
                conn.execute(text(f"DROP TABLE `{name}`"))
            conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        # The password goes through the environment, so it never shows in the process list.
        env = {**os.environ, "MYSQL_PWD": config.get("DB_PASSWORD")}
        command = [client, "-h", config.get("DB_HOST", "127.0.0.1"), "-P", config.get("DB_PORT", "3306"), "-u", config.get("DB_USER"), "--default-character-set=utf8mb4", database]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, env=env)
        with gzip.open(path, "rb") as stream:
            shutil.copyfileobj(stream, process.stdin)
        process.stdin.close()
        if process.wait() != 0:
            raise SystemExit(f"Loading the copy into {database} failed (above). It may be half loaded: run this again with --replace.")
        return row_counts(engine)
    finally:
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Put a database copy made by backup_db.py back.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--database", default=None, help="default: DB_NAME from .env, the live database")
    parser.add_argument("--replace", action="store_true", help="empty the database first, if it has tables")
    args = parser.parse_args()
    target = args.database or config.get("DB_NAME")
    counts = restore(args.file, target, replace=args.replace)
    for name, rows in counts.items():
        print(f"  {name}: {rows} rows")
    print(f"Put back {args.file.name} into {target}: {len(counts)} tables, {sum(counts.values())} rows.")
