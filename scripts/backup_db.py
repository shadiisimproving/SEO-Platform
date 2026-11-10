#!/usr/bin/env python3
"""A compressed copy of the database and of the note files, once a day through cron on hosting and before every release.

Copies are kept by age, not by count, so a day of many uploads can't push out last week's: every database copy from the
last two days, then the newest of each of the last 14 days, 8 weeks and 6 months. Each file is read back after writing
(the whole gzip, and the dump's own "Dump completed" last line; every note file in the archive), and one that doesn't
check out is removed, so a broken file can't pass for a good backup. Restoring: scripts/restore_db.py, deploy/DEPLOY.md.

API keys inside it stay encrypted: the key that opens them lives elsewhere and is never dumped. Run by hand on the Mac.
"""
from __future__ import annotations

import gzip
import os
import re
import shutil
import subprocess
import threading
import sys
import tarfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from seo import config  # noqa: E402

KEEP = {"daily": 14, "weekly": 8, "monthly": 6, "all_hours": 48}
KEEP_NOTE_FILES = {"daily": 7, "weekly": 4, "monthly": 3, "all_hours": 0}  # large: each note file can be up to 25 MB
STAMP = re.compile(r"-(\d{8}-\d{6})\.")


def prune(folder: Path, pattern: str, keep: dict, now: datetime | None = None) -> list[Path]:
    """Removes the copies the rule doesn't keep, and returns them. A file whose name has no date is never removed."""
    now = now or datetime.now(timezone.utc)
    dated = []
    for path in folder.glob(pattern):
        found = STAMP.search(path.name)
        try:
            dated.append((datetime.strptime(found.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc), path))
        except (AttributeError, ValueError):
            continue
    dated.sort(reverse=True)  # newest first, so the first one seen in a day, week or month is that period's newest
    kept = {path for when, path in dated if now - when < timedelta(hours=keep["all_hours"])}
    for count, period in ((keep["daily"], lambda when: when.date()), (keep["weekly"], lambda when: when.isocalendar()[:2]), (keep["monthly"], lambda when: (when.year, when.month))):
        periods = []
        for when, path in dated:
            if period(when) not in periods:
                if len(periods) == count:
                    break
                periods.append(period(when))
                kept.add(path)
    removed = [path for _, path in dated if path not in kept]
    for path in removed:
        path.unlink()
    return removed


def verify_dump(path: Path) -> None:
    """Reads the whole file back: gzip checks every byte, and the dump tool writes its last line only once it's done."""
    tail = b""
    try:
        with gzip.open(path, "rb") as stream:
            while chunk := stream.read(1 << 20):
                tail = (tail + chunk)[-4096:]
    except (OSError, EOFError) as exc:
        raise SystemExit(f"The backup can't be read back ({exc}), so it was removed.")
    if b"-- Dump completed" not in tail:
        raise SystemExit("The backup stops before the dump's last line, so it was removed.")


def verify_archive(path: Path, expected_files: int) -> None:
    try:
        with tarfile.open(path, "r:gz") as archive:
            found = sum(1 for member in archive if member.isfile())
    except (OSError, EOFError, tarfile.TarError) as exc:
        raise SystemExit(f"The note files copy can't be read back ({exc}), so it was removed.")
    if found != expected_files:
        raise SystemExit(f"The note files copy holds {found} files, not {expected_files}, so it was removed.")


def run(folder: Path | None = None, keep: dict = KEEP, runner=subprocess.Popen) -> Path:
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
    # Read at the same time as the dump: a dump with a lot of warnings would fill this pipe and stop, and never finish.
    errors: list[bytes] = []
    reader = threading.Thread(target=lambda: errors.append(process.stderr.read()), daemon=True)
    reader.start()
    try:
        with gzip.open(partial, "wb") as out:
            shutil.copyfileobj(process.stdout, out)
        reader.join()
        error = errors[0] if errors else b""
        if process.wait() != 0:
            raise SystemExit(f"The backup failed: {error.decode(errors='replace')[:400]}")
        os.chmod(partial, 0o600)
        verify_dump(partial)
        partial.rename(target)
    finally:
        partial.unlink(missing_ok=True)
    prune(folder, "*.sql.gz", keep)
    return target


def run_note_files(folder: Path | None = None, keep: dict = KEEP_NOTE_FILES) -> Path | None:
    """Files attached to notes exist only on this disk, and the database only points at them."""
    source = Path(os.environ.get("SEO_NOTE_FILES") or config.VAR / "note-files")
    if not source.is_dir() or not any(source.iterdir()):
        return None
    folder = Path(folder) if folder else config.VAR / "backups" / "note-files"
    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    target = folder / f"note-files-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.tar.gz"
    partial = target.with_suffix(".partial")
    added = []

    def count(member: tarfile.TarInfo) -> tarfile.TarInfo:
        if member.isfile():
            added.append(member.name)
        return member

    try:
        with tarfile.open(partial, "w:gz") as archive:
            archive.add(source, arcname="note-files", filter=count)
        os.chmod(partial, 0o600)
        verify_archive(partial, len(added))
        partial.rename(target)
    finally:
        partial.unlink(missing_ok=True)
    prune(folder, "note-files-*.tar.gz", keep)
    return target


if __name__ == "__main__":
    print(f"Saved {run()}")
    files = run_note_files()
    if files:
        print(f"Saved {files}")
