"""What an export holds, whatever file it becomes."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable

# The most rows one table carries. Past it the file says so; nothing waits on a request that never ends.
MAX_ROWS = 20_000
# A PDF is for reading. Longer tables belong in the Excel or CSV file, and the PDF says that.
MAX_PDF_ROWS = 1_000

# How a column's values are typed, in every format:
#   text      words                         url       an address, a link in Excel and the PDF
#   int       a whole number                float     one decimal
#   pct       a share from 0 to 1           pct100    a percentage already times 100 (5.0 means 5 %)
#   change    a signed percentage, +/− and coloured (already times 100)
#   delta     a signed number, +/− and coloured     delta_low  the same, where lower is better (a position)
#   position  a rank, one decimal           money     an amount
#   date      a day                         datetime  a day and time (UTC)
#   bool      yes or no
KINDS = ("text", "url", "int", "float", "pct", "pct100", "change", "delta", "delta_low", "position", "money", "date", "datetime", "bool")
NUMERIC = ("int", "float", "pct", "pct100", "change", "delta", "delta_low", "position", "money")


class Typed(str):
    """Words someone typed or a screen sent already in its language: never looked up as one of the app's words."""


@dataclass
class Column:
    key: str
    label: str  # English. words.py holds the French.
    kind: str = "text"
    width: float = 0  # a hint for Excel's column width, in tens of characters; 0 means the kind's usual width. The PDF measures the text itself
    get: Callable[[dict], Any] | None = None
    translate: bool | str = False  # the values are the app's own words (a status), so they follow the language. "known": only those that have French
    pdf: bool = True  # False: only repeats another column (a link's domain beside its address), so the PDF leaves it out for room. Excel and CSV keep it

    def value(self, row: dict):
        return self.get(row) if self.get else row.get(self.key)


@dataclass
class Table:
    id: str
    title: str
    columns: list[Column]
    rows: list[dict]
    total: int | None = None  # how many rows there are in all, when the service itself held some back
    note: str | None = None
    empty: str = "Nothing to show for this period."
    key: Callable[[dict], Any] | str = ""  # what names a row, so "the rows on screen, in their order" can be asked for

    def row_key(self, row: dict) -> str:
        found = self.key(row) if callable(self.key) else row.get(self.key)
        return "" if found is None else str(found)

    @property
    def count(self) -> int:
        return len(self.rows)


@dataclass
class Tile:
    label: str
    value: Any
    kind: str = "int"
    change: float | None = None  # signed percentage against the comparison
    lower_is_better: bool = False
    hint: str | None = None


@dataclass
class Series:
    name: str
    values: list[float | None]
    dashed: bool = False


@dataclass
class Chart:
    title: str
    labels: list[str]
    series: list[Series]
    kind: str = "line"  # line or bar
    value_kind: str = "int"


@dataclass
class Report:
    view: str
    title: str
    site: str | None = None  # a host, or None for all sites
    period: tuple[date, date] | None = None
    compare: tuple[date, date] | None = None
    filters: list[tuple[str, str]] = field(default_factory=list)  # (label, value) in words
    tiles: list[Tile] = field(default_factory=list)
    charts: list[Chart] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    made_at: datetime | None = None
    lang: str = "en"
    subject: str | None = None  # what the file is about besides the site (one competitor), for its name
    logo: tuple[bytes, str] | None = None  # the site's icon and its type, when the app has one
    capped: bool = False
    undrawn: bool = False  # the PDF met a character none of its fonts can draw
    recount: Callable[["Report"], None] | None = None  # tiles that count the table's rows, counted again once it holds only the rows on screen

    def table(self, table_id: str | None) -> Table | None:
        if table_id:
            return next((t for t in self.tables if t.id == table_id), None)
        return self.tables[0] if self.tables else None
