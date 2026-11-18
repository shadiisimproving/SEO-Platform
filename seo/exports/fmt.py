"""Values as people read them, in English or French. Used by the PDF, and for the words in every format."""
from __future__ import annotations

from datetime import date, datetime

from seo.exports.model import Typed
from seo.exports.words import FR

MINUS = "−"
NBSP = " "
MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "fr": ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
}
MISSING: set[str] = set()  # English words asked for in French that have none yet. A test reads this.


def tr(lang: str, words: str | None) -> str:
    if not words:
        return ""
    if lang != "fr":
        return words
    found = FR.get(words)
    if found is None:
        from seo.exports.sentences import french

        found = french(words)  # a sentence the server wrote in English, by its pattern
    if found is None:
        MISSING.add(words)
        return words
    return found


def as_day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def as_moment(value) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, str) and len(value) >= 16:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def as_number(value) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def day(lang: str, value, year: bool = True) -> str:
    d = as_day(value)
    if d is None:
        return ""
    month = MONTHS["fr" if lang == "fr" else "en"][d.month - 1]
    return f"{d.day} {month}{f' {d.year}' if year else ''}"


def moment(lang: str, value) -> str:
    m = as_moment(value)
    if m is None:
        return day(lang, value)
    return f"{day(lang, m)}, {m.hour:02d}:{m.minute:02d}"


def period(lang: str, start: date, end: date) -> str:
    if start == end:
        return day(lang, start)
    return f"{day(lang, start, year=start.year != end.year)} {'–'} {day(lang, end)}"


def number(lang: str, value, digits: int = 0) -> str:
    n = as_number(value)
    if n is None:
        return ""
    text = f"{abs(n):,.{digits}f}"
    if lang == "fr":
        text = text.replace(",", NBSP).replace(".", ",")
    return (MINUS if n < 0 and round(abs(n), digits) else "") + text


def _trim(lang: str, value: float, digits: int, trim: bool = True) -> str:
    """In a headline, one decimal only when it says something: 5 %, 5.5 %. In a column, always, so the numbers line up."""
    whole = trim and float(round(value, digits)).is_integer()
    return number(lang, value, 0 if whole else digits)


def percent(lang: str, value: float, digits: int = 1, trim: bool = True) -> str:
    if 99 < abs(value) < 100:
        digits = 2  # 99.97 % must not read as 100 %
    return f"{_trim(lang, value, digits, trim)}{NBSP if lang == 'fr' else ''}%"


def signed(lang: str, value: float, digits: int = 0, suffix: str = "", trim: bool = True) -> str:
    if round(value, digits) == 0:
        return f"{number(lang, 0, 0 if trim else digits)}{suffix}"
    body = _trim(lang, abs(value), digits, trim) if digits else number(lang, abs(value))
    return f"{'+' if value > 0 else MINUS}{body}{suffix}"


def change_words(lang: str, value, kind: str = "change") -> str:
    """A headline's change in its own unit (Tile.change_kind): +5 %, +2 (a count), +1.5 pts (a click rate), or a position's
    places, which say better or worse because a lower position is the better one."""
    n = as_number(value)
    if n is None:
        return ""
    if kind == "delta":
        return signed(lang, n, 0 if float(n).is_integer() else 1)
    if kind == "points":
        return signed(lang, n, 1, f"{NBSP}pts")
    if kind == "places":
        size = _trim(lang, abs(n), 1)
        if round(n, 1) == 0:
            return tr(lang, "Same place")
        if lang == "fr":
            return f"{'recul' if n > 0 else 'gain'} de {size} place{'s' if abs(n) >= 2 else ''}"
        return f"{size} place{'s' if abs(n) != 1 else ''} {'worse' if n > 0 else 'better'}"
    return signed(lang, n, 1, f"{NBSP if lang == 'fr' else ''}%", trim=True)


def filter_value(lang: str, value) -> str:
    """A filter's value in the file's header: a day as a day, the app's own words in French, and anything typed or
    picked on screen (already in the screen's language) as it is."""
    if isinstance(value, (date, datetime)):
        return day(lang, value)
    if isinstance(value, tuple) and len(value) == 2 and all(isinstance(v, date) for v in value):
        return period(lang, *value)  # a span of days, such as Google's own period beside the one picked
    words = str(value or "")
    if lang != "fr" or not words or isinstance(value, Typed):
        return words
    from seo.exports.sentences import french

    return FR.get(words) or french(words) or words


def cell(lang: str, value, kind: str, translate: bool | str = False, trim: bool = False) -> str:
    """One value in words. Empty when there is none: a dash says "no data" in the PDF, added by the writer."""
    if value is None or value == "":
        return ""
    if kind == "bool":
        return tr(lang, "Yes" if value else "No")
    if kind == "date":
        return day(lang, value)
    if kind == "datetime":
        return moment(lang, value)
    if kind in ("text", "url"):
        if isinstance(value, (list, tuple, set)):
            return ", ".join(str(v) for v in value if v not in (None, ""))
        if translate == "known":  # names, of which a few are words: French when there is one, no complaint when not
            return FR.get(str(value), str(value)) if lang == "fr" else str(value)
        return tr(lang, str(value)) if translate else str(value)
    n = as_number(value)
    if n is None:
        return str(value)
    if kind == "int":
        return number(lang, n)
    if kind == "float":
        return number(lang, n, 0 if trim and float(n).is_integer() else 1)
    if kind == "position":
        return number(lang, n, 1)
    if kind == "money":
        return number(lang, n, 2)
    if kind == "pct":
        return percent(lang, n * 100, trim=trim)
    if kind == "pct100":
        return percent(lang, n, trim=trim)
    if kind == "change":
        return signed(lang, n, 1, f"{NBSP if lang == 'fr' else ''}%", trim=trim)
    if kind in ("delta", "delta_low"):
        return signed(lang, n, 0 if float(n).is_integer() else 1)
    return str(value)


def tone(value, kind: str) -> str | None:
    """good, bad or None, for a change value's colour."""
    n = as_number(value)
    if n is None or kind not in ("change", "delta", "delta_low") or n == 0:
        return None
    up_is_good = kind != "delta_low"
    return "good" if (n > 0) == up_is_good else "bad"
