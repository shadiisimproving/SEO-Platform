"""Settings, read from .env beside the code. The encryption key is never here."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
VAR = ROOT / "var"

load_dotenv(ROOT / ".env")


def get(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"{name} is not set. Run scripts/setup_db.sh, which writes it to .env.")
    return value
