"""Excel: typed cells, a frozen header row with the filter on, set widths, and an About sheet saying what the file is."""
from __future__ import annotations

import io
import re
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from seo.exports import fmt
from seo.exports.model import NUMERIC, Report, Table
from seo.exports.safe import cell_text, http_url

INK, MUTED, LINE, HEAD_BG, BLUE, GOOD, BAD = "0F2233", "5B6B78", "E3EBF2", "F7F9FB", "176AAB", "067647", "B42318"
FORMATS = {
    "int": "#,##0", "float": "#,##0.0", "position": "0.0", "money": "#,##0.00", "pct": "0.0%", "pct100": "0.0%",
    "change": "+0.0%;-0.0%;0%", "delta": "+#,##0;-#,##0;0", "delta_low": "+#,##0;-#,##0;0",
    "date": "yyyy-mm-dd", "datetime": "yyyy-mm-dd hh:mm",
}
WIDTHS = {"text": 28, "url": 46, "int": 12, "float": 12, "position": 11, "money": 13, "pct": 11, "pct100": 11, "change": 12, "delta": 12, "delta_low": 12, "date": 12, "datetime": 17, "bool": 9}
_SHEET_BAD = re.compile(r"[\[\]:*?/\\]")
_HEAD_FONT = Font(name="Calibri", bold=True, color=INK)
_HEAD_FILL = PatternFill("solid", fgColor=HEAD_BG)
_HEAD_EDGE = Border(bottom=Side(style="thin", color="CBD6E0"))


def _sheet_name(title: str, used: set[str]) -> str:
    name = _SHEET_BAD.sub(" ", title).strip().strip("'")[:31] or "Sheet"
    base, n = name, 2
    while name.lower() in used:
        tail = f" {n}"
        name, n = base[: 31 - len(tail)] + tail, n + 1
    used.add(name.lower())
    return name


def _typed(lang: str, value, column):
    """(value, number format, is a link). Text always goes through the formula guard and is stored as text."""
    kind = column.kind
    if value is None or value == "":
        return None, None, False
    if kind in NUMERIC:
        n = fmt.as_number(value)
        if n is None:
            return cell_text(value), None, False
        if kind in ("pct100", "change"):
            n = n / 100
        if kind in ("delta", "delta_low") and not float(n).is_integer():
            return n, "+#,##0.0;-#,##0.0;0", False
        return n, FORMATS[kind], False
    if kind == "date":
        d = fmt.as_day(value)
        return (d, FORMATS[kind], False) if d else (cell_text(value), None, False)
    if kind == "datetime":
        m = fmt.as_moment(value)
        return (m, FORMATS[kind], False) if m else (cell_text(value), None, False)
    words = fmt.cell(lang, value, kind, column.translate)
    return cell_text(words)[:32000], None, kind == "url" and bool(http_url(words))


def _table_sheet(sheet, report: Report, table: Table) -> None:
    lang = report.lang
    for index, column in enumerate(table.columns, start=1):
        head = sheet.cell(row=1, column=index, value=cell_text(fmt.tr(lang, column.label)))
        head.font, head.fill, head.border = _HEAD_FONT, _HEAD_FILL, _HEAD_EDGE
        head.alignment = Alignment(horizontal="right" if column.kind in NUMERIC else "left", vertical="center", wrap_text=True)
        sheet.column_dimensions[get_column_letter(index)].width = (column.width * 10) if column.width else WIDTHS.get(column.kind, 18)
    link_font = Font(name="Calibri", color=BLUE, underline="single")
    good, bad = Font(name="Calibri", color=GOOD), Font(name="Calibri", color=BAD)
    links = 0
    for r, row in enumerate(table.rows, start=2):
        for index, column in enumerate(table.columns, start=1):
            raw = column.value(row)
            value, number_format, is_link = _typed(lang, raw, column)
            if value is None:
                continue
            cell = sheet.cell(row=r, column=index, value=value)
            if isinstance(value, str):
                cell.data_type = "s"  # text stays text, even "=1+1" or "1e5"
                if column.kind in ("text",) and len(value) > 60:
                    cell.alignment = Alignment(wrap_text=True, vertical="top")
            if number_format:
                cell.number_format = number_format
            if is_link and links < 60000:  # a sheet holds about 65,000 links; past that they stay as text
                cell.hyperlink, cell.font, links = http_url(value), link_font, links + 1
            tone = fmt.tone(raw, column.kind)
            if tone:
                cell.font = good if tone == "good" else bad
    sheet.freeze_panes = "A2"
    if table.columns:
        sheet.auto_filter.ref = f"A1:{get_column_letter(len(table.columns))}{max(1, len(table.rows) + 1)}"
    sheet.row_dimensions[1].height = 22
    sheet.sheet_view.showGridLines = True


def _about(sheet, report: Report, names: dict[str, str]) -> None:
    lang = report.lang
    t = lambda words: fmt.tr(lang, words)  # noqa: E731
    sheet.column_dimensions["A"].width, sheet.column_dimensions["B"].width, sheet.column_dimensions["C"].width = 26, 44, 16
    sheet["A1"] = cell_text(fmt.tr(lang, report.title))
    sheet["A1"].font = Font(name="Calibri", bold=True, size=16, color=INK)
    rows: list[tuple[str, object, str | None]] = [(t("Site"), report.site or t("All sites"), None)]
    if report.period:
        rows.append((t("Period"), fmt.period(lang, *report.period), None))
    if report.compare:
        rows.append((t("Compared with"), fmt.period(lang, *report.compare), None))
    for label, value in report.filters:
        if fmt.filter_value(lang, value):
            rows.append((t(label), fmt.filter_value(lang, value), None))
    rows.append((t("Made on"), (report.made_at or datetime.now()).date(), "yyyy-mm-dd"))
    line = 3
    label_font = Font(name="Calibri", color=MUTED)
    for label, value, number_format in rows:
        sheet.cell(row=line, column=1, value=cell_text(label)).font = label_font
        cell = sheet.cell(row=line, column=2, value=cell_text(value) if isinstance(value, str) else value)
        cell.alignment = Alignment(horizontal="left")
        if number_format:
            cell.number_format = number_format
        line += 1
    if report.tiles:
        line += 1
        sheet.cell(row=line, column=1, value=t("Headline numbers")).font = _HEAD_FONT
        sheet.cell(row=line, column=3, value=t("Change")).font = _HEAD_FONT
        sheet.cell(row=line, column=3).alignment = Alignment(horizontal="right")
        line += 1
        for tile in report.tiles:
            sheet.cell(row=line, column=1, value=cell_text(t(tile.label))).font = label_font
            n = fmt.as_number(tile.value) if tile.kind in NUMERIC else None
            if n is not None:
                cell = sheet.cell(row=line, column=2, value=n / 100 if tile.kind in ("pct100", "change") else n)
                cell.number_format = FORMATS.get(tile.kind, "General")
            else:
                cell = sheet.cell(row=line, column=2, value=cell_text(fmt.cell(lang, tile.value, tile.kind)) or "—")
            cell.alignment = Alignment(horizontal="left")
            if tile.change is not None:
                change = sheet.cell(row=line, column=3, value=tile.change / 100)
                change.number_format = "+0.0%;-0.0%;0%"
                tone = fmt.tone(tile.change, "delta_low" if tile.lower_is_better else "change")
                change.font = Font(name="Calibri", color=GOOD if tone == "good" else BAD if tone == "bad" else INK)
            line += 1
    if report.tables:
        line += 1
        sheet.cell(row=line, column=1, value=t("Sheets")).font = _HEAD_FONT
        sheet.cell(row=line, column=2, value=t("Rows")).font = _HEAD_FONT
        line += 1
        for table in report.tables:
            name = names[table.id]
            cell = sheet.cell(row=line, column=1, value=name)
            cell.hyperlink, cell.font = f"#'{name}'!A1", Font(name="Calibri", color=BLUE, underline="single")
            count = sheet.cell(row=line, column=2, value=table.count)
            count.number_format, count.alignment = "#,##0", Alignment(horizontal="left")
            if table.total and table.total > table.count:
                sheet.cell(row=line, column=3, value=t("of {n} in all").replace("{n}", fmt.number(lang, table.total))).font = label_font
            line += 1
    notes = [fmt.tr(lang, n) for n in report.notes] + [f"{fmt.tr(lang, tb.title)}: {fmt.tr(lang, tb.note)}" for tb in report.tables if tb.note]
    if notes:
        line += 1
        for note in notes:
            cell = sheet.cell(row=line, column=1, value=cell_text(note))
            cell.font = label_font
            line += 1
    sheet.sheet_view.showGridLines = False


def write(report: Report) -> bytes:
    book = Workbook()
    about = book.active
    used: set[str] = set()
    about.title = _sheet_name(fmt.tr(report.lang, "About"), used)
    names = {table.id: _sheet_name(fmt.tr(report.lang, table.title), used) for table in report.tables}
    _about(about, report, names)
    for table in report.tables:
        _table_sheet(book.create_sheet(names[table.id]), report, table)
    book.properties.title = fmt.tr(report.lang, report.title)
    book.properties.creator = "SEO Command Center"
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()
