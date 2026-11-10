"""Small helpers the view files share."""
from __future__ import annotations

from seo.exports.model import Column

C = Column


def change(now, before) -> float | None:
    """The change in percent, or None when there is nothing to compare with."""
    try:
        if before in (None, 0) or now is None:
            return None
        return round((float(now) - float(before)) / abs(float(before)) * 100, 1)
    except (TypeError, ValueError):
        return None


def diff(now, before):
    if now is None or before is None:
        return None
    value = round(float(now) - float(before), 1)
    return int(value) if value == int(value) else value


def page_address(row: dict) -> str:
    """A page as a full address when the row has its host and path."""
    host, path = row.get("host") or "", row.get("path") or ""
    if str(path).startswith("http"):
        return path
    return f"https://{host}{path}" if host else str(path)
