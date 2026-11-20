"""Search volumes from a file (plan item 7): any tool's export, Keyword Planner's included, uploaded by hand on Keywords → Volumes.

Read by its headings, in English or French: a keyword column, and either one volume column ("Volume", "Avg. monthly
searches", "Recherches mensuelles moyennes", "searches"…) or Keyword Planner's month columns ("Searches: Oct 2026"), plus an
optional country and month. Every row is stored with the file's name, so "From file: <name>" always says where a number
came from, and uploading the same name again replaces that file's rows. A range such as "1K – 10K" is not a number: that
row is skipped and counted, never turned into a guess. CSV or TSV, UTF-8 or UTF-16 (Keyword Planner's own encoding).
"""
from __future__ import annotations

import csv
import io
import re

from sqlalchemy import Engine, text

from seo.core.errors import Refused
from seo.serp import store, volumes

MAX_BYTES = 5_000_000
MAX_ROWS = 50_000
KEYWORD_HEADS = ("keyword", "keywords", "mot-clé", "mot clé", "mot-cle", "mot cle", "mots-clés", "mots clés", "query", "requête", "requete", "search term", "terme")
VOLUME_HEADS = ("volume", "search volume", "searches", "avg. monthly searches", "avg monthly searches", "monthly searches", "recherches mensuelles moyennes",
                "nombre moyen de recherches mensuelles", "recherches", "volume de recherche", "sv")
COUNTRY_HEADS = ("country", "pays", "location", "country code", "code pays")
MONTH_HEADS = ("month", "mois", "date", "period", "période")
_MONTHS = {
    "jan": 1, "janv": 1, "january": 1, "janvier": 1, "feb": 2, "fév": 2, "fev": 2, "févr": 2, "february": 2, "février": 2, "mar": 3, "mars": 3, "march": 3,
    "apr": 4, "avr": 4, "april": 4, "avril": 4, "may": 5, "mai": 5, "jun": 6, "juin": 6, "june": 6, "jul": 7, "juil": 7, "july": 7, "juillet": 7,
    "aug": 8, "août": 8, "aout": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "septembre": 9, "oct": 10, "october": 10, "octobre": 10,
    "nov": 11, "november": 11, "novembre": 11, "dec": 12, "déc": 12, "december": 12, "décembre": 12,
}
_SEARCHES_MONTH = re.compile(r"^(?:searches|recherches)\s*:?\s*(.+)$", re.IGNORECASE)
_RANGE = re.compile(r"[–—-]|\bk\b|\d\s*k$|\d\s*m$", re.IGNORECASE)


def _text_of(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _rows(data: bytes) -> list[list[str]]:
    body = _text_of(data)
    try:
        dialect = csv.Sniffer().sniff(body[:4000], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel_tab if "\t" in body[:4000] else csv.excel
    return [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(body), dialect)]


def month_of(value: str) -> str | None:
    """'2026-10', '10/2026', 'Oct 2026', 'octobre 2026' → '2026-10'. None when it isn't a month."""
    value = (value or "").strip().lower()
    if m := re.match(r"^(\d{4})-(\d{1,2})(?:-\d{1,2})?$", value):
        year, month = int(m.group(1)), int(m.group(2))
    elif m := re.match(r"^(\d{1,2})[/.](\d{4})$", value):
        month, year = int(m.group(1)), int(m.group(2))
    elif m := re.match(r"^([a-zéû.]+)\s+(\d{4})$", value):
        month, year = _MONTHS.get(m.group(1).rstrip(".")), int(m.group(2))
        if not month:
            return None
    else:
        return None
    return f"{year:04d}-{month:02d}" if 1 <= month <= 12 and 2000 <= year <= 2100 else None


def number_of(value: str) -> int | None:
    """'1,300' '1 300' '1300' → 1300. A range ('1K – 10K'), a word or a blank: None."""
    value = (value or "").strip().replace(" ", " ").replace(" ", " ")
    if not value or _RANGE.search(value):
        return None
    digits = re.sub(r"[\s,.']", "", value)
    return int(digits) if digits.isdigit() and len(digits) <= 10 else None


def _find(heads: list[str], names: tuple) -> int | None:
    low = [h.strip().lower() for h in heads]
    return next((i for i, h in enumerate(low) if h in names), None)


def read(name: str, data: bytes) -> dict:
    """{rows: [(keyword, country, month, searches)], skipped, keywords} or Refused with what to fix."""
    if len(data) > MAX_BYTES:
        raise Refused("File too large: keep it under 5 MB.")
    if name.lower().endswith((".xlsx", ".xls")):
        raise Refused("Save it as CSV first, not Excel.")
    table = _rows(data)
    # Keyword Planner puts a title and a date line above its headings: the headings are the first row naming a keyword column.
    head_at = next((i for i, row in enumerate(table[:12]) if _find(row, KEYWORD_HEADS) is not None), None)
    if head_at is None:
        raise Refused("No keyword column found. Name it Keyword (or Mot-clé), with a Volume column beside it.")
    heads = table[head_at]
    k_col, v_col, c_col, m_col = _find(heads, KEYWORD_HEADS), _find(heads, VOLUME_HEADS), _find(heads, COUNTRY_HEADS), _find(heads, MONTH_HEADS)
    month_cols = [(i, month_of(_SEARCHES_MONTH.match(h).group(1))) for i, h in enumerate(heads) if _SEARCHES_MONTH.match(h.strip())]
    month_cols = [(i, m) for i, m in month_cols if m]
    if v_col is None and not month_cols:
        raise Refused("No volume column found. Name it Volume (or Avg. monthly searches).")
    out, skipped = [], 0
    for row in table[head_at + 1:]:
        if len(out) >= MAX_ROWS * 13:
            break
        keyword = store.clean_keyword(row[k_col]) if k_col < len(row) else ""
        if not keyword:
            continue
        country = (row[c_col] if c_col is not None and c_col < len(row) else "").strip().upper()
        country = country if re.fullmatch(r"[A-Z]{2}", country) else ""
        got = False
        if month_cols:  # one row per month the file has
            for i, month in month_cols:
                n = number_of(row[i]) if i < len(row) else None
                if n is not None:
                    out.append((keyword, country, month, n))
                    got = True
        if v_col is not None and not got:
            n = number_of(row[v_col]) if v_col < len(row) else None
            month = month_of(row[m_col]) if m_col is not None and m_col < len(row) else None
            if n is not None:
                out.append((keyword, country, month or "", n))
                got = True
        skipped += not got
    if not out:
        raise Refused("No row had a number in its volume column. A range like 1K – 10K can't be read as a number.")
    return {"rows": out, "skipped": skipped, "keywords": len({store.keyword_hash(k) for k, *_ in out})}


def upload(engine: Engine, name: str, data: bytes, by: str | None) -> dict:
    """Store a file's volumes under its name. The same name again replaces what that file said before."""
    name = (name or "").strip().replace("\\", "/").split("/")[-1][:190] or "file.csv"
    found = read(name, data)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM keyword_volumes WHERE source = 'file' AND source_name = :n"), {"n": name})
        for keyword, country, month, searches in found["rows"]:
            volumes.save(conn, keyword, "file", name, country, "", month, searches, by)
    return {"name": name, "keywords": found["keywords"], "rows": len(found["rows"]), "skipped": found["skipped"]}
