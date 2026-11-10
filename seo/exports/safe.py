"""Nothing from a web page or a typed box may run in a spreadsheet, break a header, or carry a secret out."""
from __future__ import annotations

import re
import unicodedata

from seo.links.service import _safe_cell  # the one guard the app's CSV downloads already use

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Field names that must never be in a file, whatever a service hands back.
SECRET = re.compile(r"(key|token|secret|password|credential|authorization|cookie|refresh)", re.I)
_LEADING = ("=", "+", "-", "@", "\t", "\r", "\n")


def cell_text(value) -> str:
    """Text for a CSV or Excel cell: no control characters, and never read as a formula.

    A cell starting with = + - or @ gets an apostrophe in front, as the Links checker's CSV does. Leading spaces
    don't hide one: Excel trims them before deciding.
    """
    text = "" if value is None else _CONTROL.sub("", str(value))
    if text.lstrip(" ")[:1] in _LEADING:
        return _safe_cell(text) if text[:1] in _LEADING else f"'{text}"
    return text


def filename(*parts: str, ext: str) -> str:
    """Letters, digits, dots and dashes only, so it is safe in a header and on any disk."""
    words = []
    for part in parts:
        plain = unicodedata.normalize("NFKD", str(part or "")).encode("ascii", "ignore").decode()
        plain = re.sub(r"[^A-Za-z0-9.]+", "-", plain).strip("-.").lower()
        if plain:
            words.append(plain[:60])
    return f"{'-'.join(words) or 'export'}.{ext}"


def http_url(value) -> str | None:
    """Only http and https addresses become links. Anything else stays plain text."""
    text = str(value or "").strip()
    return text if re.match(r"^https?://[^\s<>\"']+$", text, re.I) and len(text) < 2000 else None


def without_secrets(row: dict) -> dict:
    return {k: v for k, v in row.items() if not SECRET.search(str(k))}
