"""The day a page states about itself, in the forms sites write it (SEO review 2026-11-17, W7).

ISO ("2026-11-16T07:10:55+04:00"), the e-mail form ("Tue, 03 Feb 2015 10:00:00 GMT"), English words ("May 26, 2020,
11:26:50 AM", "26 May 2020"), French words ("26 mai 2020", "17 novembre 2026"), Arabic month names ("17 نوفمبر 2026"), and
day/month/year with slashes, dots or dashes ("26/05/2020", "21-05-2019"), in Western or Arabic-Indic digits ("١٧/١١/٢٠٢٦").
Anything else is no date, never today. A day after today is no publish date either (published_day): a page dated May 2027
isn't published yet, so it never counts as published in the last 30 days (SEO review 2026-11-18, N6).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from email.utils import parsedate_to_datetime

_MONTHS = {
    "jan": 1, "january": 1, "janvier": 1, "janv": 1, "feb": 2, "february": 2, "février": 2, "fevrier": 2, "févr": 2, "fevr": 2,
    "mar": 3, "march": 3, "mars": 3, "apr": 4, "april": 4, "avril": 4, "avr": 4, "may": 5, "mai": 5, "jun": 6, "june": 6, "juin": 6,
    "jul": 7, "july": 7, "juillet": 7, "juil": 7, "aug": 8, "august": 8, "août": 8, "aout": 8, "sep": 9, "sept": 9, "september": 9,
    "septembre": 9, "oct": 10, "october": 10, "octobre": 10, "nov": 11, "november": 11, "novembre": 11, "dec": 12, "december": 12,
    "décembre": 12, "decembre": 12, "déc": 12,
    # Arabic, as Gulf and Egyptian sites write it, and the Levantine names.
    "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "إبريل": 4, "مايو": 5, "يونيو": 6, "يوليو": 7, "أغسطس": 8, "اغسطس": 8,
    "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
    "شباط": 2, "آذار": 3, "نيسان": 4, "أيار": 5, "حزيران": 6, "تموز": 7, "آب": 8, "أيلول": 9,
}
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_WORD_FIRST = re.compile(r"^([^\W\d_]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})", re.I)  # May 26, 2020
_DAY_FIRST = re.compile(r"^(\d{1,2})(?:er)?\s+([^\W\d_]+)\.?,?\s+(\d{4})", re.I)  # 26 May 2020, 1er mai 2020, 17 نوفمبر 2026
_NUMERIC = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})")  # 26/05/2020, 21-05-2019: day first, as in Europe


def _make(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def page_day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    m = _ISO.match(raw)
    if m:
        return _make(int(m[1]), int(m[2]), int(m[3]))
    m = _WORD_FIRST.match(raw)
    if m and m[1].lower() in _MONTHS:
        return _make(int(m[3]), _MONTHS[m[1].lower()], int(m[2]))
    m = _DAY_FIRST.match(raw)
    if m and m[2].lower() in _MONTHS:
        return _make(int(m[3]), _MONTHS[m[2].lower()], int(m[1]))
    m = _NUMERIC.match(raw)
    if m:
        return _make(int(m[3]), int(m[2]), int(m[1]))
    try:
        return parsedate_to_datetime(raw).date()
    except (TypeError, ValueError, IndexError):
        return None


def published_day(value, today: date | None = None) -> date | None:
    """The day a page says it was published, or None when that day is after today (scheduled, or a wrong year)."""
    day = page_day(value)
    if day is None:
        return None
    return None if day > (today or date.today()) else day
