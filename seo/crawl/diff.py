"""What changed on a page between two copies of it, field by field: the facts a person compares, not a wall of text.

Both sides are a page's fields as we store them (a PageFields.as_dict(), a page_versions.fields value or a pages row: the
names are the same) plus its main text. Nothing here reads the internet or the database.

It says:
- title, meta description and main heading, before → after;
- headings added and removed;
- word count before → after;
- years the page mentions (2025 → 2026: the "updated for this year" edit);
- questions added and removed (the FAQ, from extras.questions);
- structured data types added and removed;
- internal and external link counts;
- the published and modified dates the page states;
- the sentences added and removed, trimmed.

A page's words are someone else's: values are cut short here, and shown escaped wherever they appear.
"""
from __future__ import annotations

import re
from datetime import date

from seo.extras.summaries import _text_change

MOST_CHARS = 300  # a title, a heading, a sentence
MOST_LISTED = 12  # headings, questions or sentences named in one change
SECTION_CHARS = 240
SECTIONS_LISTED = 8
_YEAR = re.compile(r"(?<![\d.,])(19[89]\d|20\d\d)(?!\d|[.,]\d)")  # not 1,2025 € or 3.2026
_SPACE = re.compile(r"\s+")
# Shown in this order, the strongest signs of a rewrite first. A card shows the first few.
ORDER = ("title", "years", "words", "headings", "questions", "sections", "schema", "meta", "h1", "modified", "published", "internal_links", "external_links")


def _clip(value, most: int = MOST_CHARS) -> str:
    value = _SPACE.sub(" ", value if isinstance(value, str) else "").strip()
    return value if len(value) <= most else value[: most - 1].rstrip() + "…"


def _key(value: str) -> str:
    return _SPACE.sub(" ", value).strip().casefold()


def _heading_texts(fields: dict) -> list[str]:
    out = []
    for item in fields.get("headings") or []:
        value = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else item
        if isinstance(value, str) and value.strip():
            out.append(_clip(value))
    return out


def years_in(*texts: str) -> list[int]:
    """Years a page mentions, from 1980 to next year. Older numbers and prices that look like years are left out."""
    newest = date.today().year + 1
    found = set()
    for value in texts:
        for match in _YEAR.findall(value or ""):
            year = int(match)
            if 1980 <= year <= newest:
                found.add(year)
    return sorted(found)


def facts(fields: dict | None, text: str = "") -> dict | None:
    """One side, as compared and as shown beside a rival's: my page's facts use this too."""
    if not fields:
        return None
    extras = fields.get("extras") or {}
    h1 = [_clip(v) for v in (fields.get("h1") or []) if isinstance(v, str) and v.strip()][:3]
    headings = _heading_texts(fields)
    title, meta = _clip(fields.get("title")), _clip(fields.get("meta_description"))
    questions = [_clip(q) for q in (extras.get("questions") or []) if isinstance(q, str)][:50]
    words = fields.get("word_count")
    return {
        "title": title,
        "meta": meta,
        "h1": h1,
        "headings": headings[:80],
        "words": int(words) if isinstance(words, (int, float)) else None,
        "years": years_in(title, meta, " ".join(h1), " ".join(headings), text or ""),
        "questions": questions,
        "schema": sorted({s for s in (fields.get("schema_types") or []) if isinstance(s, str)}),
        "internal_links": fields.get("internal_links"),
        "external_links": fields.get("external_links"),
        "published": _clip(extras.get("published"), 30) or None,
        "modified": _clip(extras.get("modified"), 30) or None,
    }


def _added_removed(before: list[str], after: list[str]) -> tuple[list[str], list[str]]:
    was, now = {_key(v) for v in before}, {_key(v) for v in after}
    added = list(dict.fromkeys(v for v in after if _key(v) not in was))
    removed = list(dict.fromkeys(v for v in before if _key(v) not in now))
    return added, removed


def _sections(before_text: str, after_text: str) -> dict | None:
    if not before_text or not after_text or before_text == after_text:
        return None
    added, removed = [], []
    for line in _text_change(before_text, after_text).splitlines():
        if line.startswith("ADDED: "):
            added.append(_clip(line[7:], SECTION_CHARS))
        elif line.startswith("REMOVED: "):
            removed.append(_clip(line[9:], SECTION_CHARS))
    # A sentence said again and again (a menu, a repeated line) is named once, and one that only moved isn't a change.
    added, removed = list(dict.fromkeys(v for v in added if v)), list(dict.fromkeys(v for v in removed if v))
    both = set(added) & set(removed)
    added, removed = [v for v in added if v not in both], [v for v in removed if v not in both]
    if not added and not removed:
        return None
    return {"added": added[:SECTIONS_LISTED], "removed": removed[:SECTIONS_LISTED], "added_count": len(added), "removed_count": len(removed)}


def compare(before: dict | None, before_text: str, after: dict | None, after_text: str) -> dict:
    """{"changed": bool, <field>: change, ...}. Only fields that changed are there. Both sides' facts must be readable."""
    was, now = facts(before, before_text), facts(after, after_text)
    if was is None or now is None:
        return {"changed": False}
    out: dict = {}
    for name in ("title", "meta"):
        if was[name] != now[name]:
            out[name] = {"before": was[name], "after": now[name]}
    if [_key(v) for v in was["h1"]] != [_key(v) for v in now["h1"]]:
        out["h1"] = {"before": " / ".join(was["h1"]), "after": " / ".join(now["h1"])}
    added, removed = _added_removed(was["headings"], now["headings"])
    if added or removed:
        out["headings"] = {"added": added[:MOST_LISTED], "removed": removed[:MOST_LISTED], "before": len(was["headings"]), "after": len(now["headings"])}
    if was["words"] != now["words"]:
        out["words"] = {"before": was["words"], "after": now["words"]}
    if was["years"] != now["years"]:
        out["years"] = {"before": was["years"], "after": now["years"]}
    added, removed = _added_removed(was["questions"], now["questions"])
    if added or removed:
        out["questions"] = {"added": added[:MOST_LISTED], "removed": removed[:MOST_LISTED], "before": len(was["questions"]), "after": len(now["questions"])}
    added, removed = _added_removed(was["schema"], now["schema"])
    if added or removed:
        out["schema"] = {"added": added, "removed": removed}
    for name in ("internal_links", "external_links", "published", "modified"):
        if was[name] != now[name]:
            out[name] = {"before": was[name], "after": now[name]}
    sections = _sections(before_text, after_text)
    if sections:
        out["sections"] = sections
    return {"changed": bool(out), **out}


def _mine_for(name: str, mine: dict | None):
    if not mine:
        return None
    if name in ("headings", "questions"):
        return len(mine.get(name) or [])
    if name == "sections":
        return None
    if name == "h1":
        return " / ".join(mine.get("h1") or [])
    return mine.get(name)


def rows(changes: dict, mine: dict | None, most: int = 6) -> tuple[list[dict], int]:
    """The changes a card shows, strongest first, each with my page's value beside it. Returns (rows, how many more)."""
    found = [{"field": name, **changes[name], "mine": _mine_for(name, mine)} for name in ORDER if isinstance(changes.get(name), dict)]
    return found[:most], max(0, len(found) - most)


NOW_ORDER = ("title", "years", "words", "headings", "questions", "schema", "modified")


def now_rows(now: dict | None, mine: dict | None, most: int = 6) -> tuple[list[dict], int]:
    """No earlier copy: what they have now, beside mine, so the card still says something."""
    if not now:
        return [], 0
    found = []
    for name in NOW_ORDER:
        value = now.get(name)
        if name in ("headings", "questions"):
            value = len(value or [])
        if value in (None, "", []):
            continue
        found.append({"field": name, "before": None, "after": value, "mine": _mine_for(name, mine)})
    return found[:most], max(0, len(found) - most)
