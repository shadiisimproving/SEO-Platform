"""CSV: UTF-8 with the mark that makes Excel read accents, commas, and no `sep=` line (Excel garbles accents after one).

The same shape as the app's other CSV downloads. Numbers are plain (1234.5, -1), a percentage carries its sign
(5.25%, -12.5%) so a spreadsheet reads it as a percentage and not as 5, and days are 2026-11-10, so the file sorts and
sums wherever it is opened.
"""
from __future__ import annotations

import csv
import io
import zipfile

from seo.exports import fmt
from seo.exports.model import NUMERIC, Report, Table
from seo.exports.safe import cell_text, filename

BOM = "﻿"


def _value(lang: str, value, column) -> str:
    kind = column.kind
    if value is None or value == "":
        return ""
    if kind in NUMERIC:
        n = fmt.as_number(value)
        if n is None:
            return cell_text(value)
        n = round(n * 100, 4) if kind == "pct" else round(n, 2)  # a share from 0 to 1 keeps its precision as a percentage
        words = str(int(n)) if float(n).is_integer() else str(n)
        return f"{words}%" if kind in ("pct", "pct100", "change") else words
    if kind == "date":
        d = fmt.as_day(value)
        return d.isoformat() if d else cell_text(value)
    if kind == "datetime":
        m = fmt.as_moment(value)
        return m.strftime("%Y-%m-%d %H:%M") if m else cell_text(value)
    return cell_text(fmt.cell(lang, value, kind, column.translate))


def header(lang: str, column) -> str:
    return fmt.tr(lang, column.label)


def table_text(report: Report, table: Table) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow([cell_text(header(report.lang, c)) for c in table.columns])
    for row in table.rows:
        writer.writerow([_value(report.lang, c.value(row), c) for c in table.columns])
    return BOM + out.getvalue()


def write(report: Report, table_id: str | None = None) -> tuple[bytes, str, str]:
    """(body, mimetype, extension). One table is a .csv. Several, with none picked, are a .zip of them."""
    picked = report.table(table_id) if (table_id or len(report.tables) <= 1) else None
    if picked is not None or not report.tables:
        table = picked or Table("rows", report.title, [], [])
        return table_text(report, table).encode("utf-8"), "text/csv", "csv"
    body = io.BytesIO()
    with zipfile.ZipFile(body, "w", zipfile.ZIP_DEFLATED) as archive:
        for table in report.tables:
            archive.writestr(filename(report.view, table.id, ext="csv"), table_text(report, table).encode("utf-8"))
    return body.getvalue(), "application/zip", "zip"
