#!/usr/bin/env python3
"""Make the file to upload in Settings > Microsoft Clarity > Old Clarity data. Run it on the Mac:

  .venv/bin/python scripts/clarity_archive_export.py

It reads the old Clarity project's database without changing it, and writes daily counts only. Visitor sessions,
recording links, pages and tokens stay behind, so the old database itself never goes to the server.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from seo.core.errors import Refused  # noqa: E402
from seo.imports import clarity_archive  # noqa: E402

DEFAULT_DB = ROOT.parent / "Clarity Analaysis" / "data" / "clarity.db"
DEFAULT_OUT = ROOT / "var" / "clarity-archive.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Make the Clarity archive file to upload in Settings.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="the old project's clarity.db")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="where to write the file")
    args = parser.parse_args(argv)
    try:
        data = clarity_archive.read_archive(args.db)
    except Refused as exc:
        print(exc, file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    for site in data["sites"]:
        days = [row["day"] for row in site["days"]]
        span = f", {days[0]} to {days[-1]}" if days else ""
        print(f"{site['host']}: {len(days)} day{'' if len(days) == 1 else 's'}{span}")
    print(f"Written to {args.out} ({args.out.stat().st_size / 1024:.0f} KB). Upload it in Settings > Microsoft Clarity > Old Clarity data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
