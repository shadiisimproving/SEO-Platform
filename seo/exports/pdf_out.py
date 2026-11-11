"""PDF: a report to send to a client or a boss, in the app's Clear look.

White page, dark ink, one blue, and green or red only on a change. The header says whose site, which screen, which
days and filters, and when it was made. Then the headline numbers as tiles, the charts (drawn here, as shapes), and
each table with its header row repeated on every page. A4, upright, or on its side when a table is wide.
"""
from __future__ import annotations

import io
import math
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import BaseDocTemplate, CondPageBreak, Flowable, Frame, KeepTogether, LongTable, PageTemplate, Paragraph, Spacer, TableStyle

from seo.exports import fmt, glyphs
from seo.exports.model import MAX_PDF_ROWS, NUMERIC, Chart, Report, Table, Tile
from seo.exports.safe import http_url

INK = colors.HexColor("#0F2233")
TEXT2 = colors.HexColor("#3B4B59")
MUTED = colors.HexColor("#5B6B78")
LINE = colors.HexColor("#E3EBF2")
LINE2 = colors.HexColor("#CBD6E0")
HEAD_BG = colors.HexColor("#F7F9FB")
BLUE = colors.HexColor("#176AAB")
GOOD = colors.HexColor("#067647")
BAD = colors.HexColor("#B42318")
SERIES = [colors.HexColor(c) for c in ("#1A72B5", "#6D4AFF", "#0B7F72", "#B54708", "#3BA4E8", "#4338CA")]
MARGIN = 40
DASH = "—"

def _tone_colour(tone: str | None):
    return GOOD if tone == "good" else BAD if tone == "bad" else None


# ---- the header of the report -------------------------------------------------------------------------


class Cover(Flowable):
    """Whose site, which screen, which days, and when it was made."""

    def __init__(self, report: Report, width: float):
        super().__init__()
        self.report, self.width = report, width
        lang = report.lang
        t = lambda words: fmt.tr(lang, words)  # noqa: E731
        facts = []
        if report.period:
            facts.append(fmt.period(lang, *report.period))
        if report.compare:
            facts.append(f"{t('compared with')} {fmt.period(lang, *report.compare)}")
        self.facts = "  ·  ".join(facts)
        self.filters = "  ·  ".join(f"{t(label)}{' ' if lang == 'fr' else ''}: {fmt.filter_value(lang, value)}" for label, value in report.filters if fmt.filter_value(lang, value))
        self.made = f"{t('Made on')} {fmt.day(lang, report.made_at or datetime.now())}"
        self.height = 62 + (18 if self.facts else 0) + (14 if self.filters else 0) + 6

    def wrap(self, _aw, _ah):
        return self.width, self.height

    def draw(self):
        c, report, top = self.canv, self.report, self.height
        x = 0.0
        name = report.site or fmt.tr(report.lang, "All sites")
        if report.logo:
            try:
                image = ImageReader(io.BytesIO(report.logo[0]))
                c.drawImage(image, 0, top - 20, 18, 18, mask="auto", preserveAspectRatio=True)
                x = 25
            except Exception:  # noqa: BLE001 - an icon the PDF library can't read is left out, never an error
                x = 0
        if not x:
            # No icon: the site's first letter on a blue tile, as the app does.
            c.setFillColor(BLUE)
            c.roundRect(0, top - 20, 18, 18, 4, stroke=0, fill=1)
            c.setFillColor(colors.white)
            glyphs.draw(c, 9, top - 15.3, (name[:1] or "S").upper(), glyphs.BOLD, 10.5, "center")
            x = 25
        c.setFillColor(TEXT2)
        glyphs.draw(c, x, top - 15.5, glyphs.fit(name, glyphs.MEDIUM, 11, self.width - 200), glyphs.MEDIUM, 11)
        c.setFillColor(MUTED)
        glyphs.draw(c, self.width, top - 15.5, self.made, glyphs.REGULAR, 9, "right")
        c.setFillColor(INK)
        glyphs.draw(c, 0, top - 52, glyphs.fit(fmt.tr(report.lang, report.title), glyphs.BOLD, 24, self.width), glyphs.BOLD, 24)
        y = top - 52
        if self.facts:
            y -= 18
            c.setFillColor(TEXT2)
            glyphs.draw(c, 0, y, glyphs.fit(self.facts, glyphs.REGULAR, 10, self.width), glyphs.REGULAR, 10)
        if self.filters:
            y -= 14
            c.setFillColor(MUTED)
            glyphs.draw(c, 0, y, glyphs.fit(self.filters, glyphs.REGULAR, 9, self.width), glyphs.REGULAR, 9)
        c.setStrokeColor(LINE)
        c.setLineWidth(1)
        c.line(0, 3, self.width, 3)
        c.setStrokeColor(BLUE)
        c.setLineWidth(2.2)
        c.line(0, 3, 44, 3)


# ---- headline numbers ----------------------------------------------------------------------------------


class Tiles(Flowable):
    def __init__(self, tiles: list[Tile], width: float, lang: str, per_row: int):
        super().__init__()
        self.tiles, self.width, self.lang = tiles, width, lang
        self.per_row = min(per_row, max(1, len(tiles))) if len(tiles) <= per_row else per_row
        self.gap, self.tile_h = 9, 58
        self.rows = (len(tiles) + self.per_row - 1) // self.per_row
        self.height = self.rows * self.tile_h + (self.rows - 1) * self.gap

    def wrap(self, _aw, _ah):
        return self.width, self.height

    def draw(self):
        c, lang = self.canv, self.lang
        cols = self.per_row
        tile_w = (self.width - self.gap * (cols - 1)) / cols
        for index, tile in enumerate(self.tiles):
            col, row = index % cols, index // cols
            x = col * (tile_w + self.gap)
            y = self.height - (row + 1) * self.tile_h - row * self.gap
            c.setStrokeColor(LINE)
            c.setFillColor(colors.white)
            c.setLineWidth(0.9)
            c.roundRect(x, y, tile_w, self.tile_h, 7, stroke=1, fill=1)
            inner = tile_w - 24
            c.setFillColor(MUTED)
            glyphs.draw(c, x + 12, y + self.tile_h - 17, glyphs.fit(fmt.tr(lang, tile.label), glyphs.REGULAR, 8.5, inner), glyphs.REGULAR, 8.5)
            words = fmt.cell(lang, tile.value, tile.kind, trim=True) or DASH
            size = 18
            while size > 10 and glyphs.width(words, glyphs.BOLD, size) > inner:
                size -= 1
            c.setFillColor(INK)
            glyphs.draw(c, x + 12, y + 20, glyphs.fit(words, glyphs.BOLD, size, inner), glyphs.BOLD, size)
            below = None
            if tile.change is not None:
                tone = fmt.tone(tile.change, "delta_low" if tile.lower_is_better else "change")
                c.setFillColor(_tone_colour(tone) or MUTED)
                below = fmt.cell(lang, tile.change, "change", trim=True)
                used = glyphs.draw(c, x + 12, y + 7.5, below, glyphs.MEDIUM, 8.5)
                if tile.hint:
                    c.setFillColor(MUTED)
                    glyphs.draw(c, x + 12 + used + 4, y + 7.5, glyphs.fit(fmt.tr(lang, tile.hint), glyphs.REGULAR, 8, inner - used - 4), glyphs.REGULAR, 8)
            elif tile.hint:
                c.setFillColor(MUTED)
                glyphs.draw(c, x + 12, y + 7.5, glyphs.fit(fmt.tr(lang, tile.hint), glyphs.REGULAR, 8, inner), glyphs.REGULAR, 8)


# ---- charts, drawn as shapes -----------------------------------------------------------------------------


def day_label(lang: str, label) -> str:
    """A chart's day in words, "11 Oct" or "11 oct.", and its hour when it has one. Anything else as it is."""
    words = str(label)
    found = fmt.as_day(words) if len(words) >= 10 and words[4:5] == "-" else None
    if found is None:
        return words
    hour = f" {words[11:13]}h" if len(words) >= 13 and words[10] in "T " else ""
    return f"{fmt.day(lang, found, year=False)}{hour}"


def _nice_top(value: float) -> float:
    """The top of the scale: four equal steps of a round size, so the grid reads 0, 50, 100, 150, 200."""
    if value <= 0:
        return 4.0
    quarter = value / 4
    power = 10 ** math.floor(math.log10(quarter))
    for step in (1, 2, 2.5, 5, 10):
        if step * power >= quarter:
            return 4 * step * power
    return 40 * power


def _short(lang: str, value: float) -> str:
    if abs(value) >= 1_000_000:
        return fmt.number(lang, value / 1_000_000, 0 if value % 1_000_000 == 0 else 1) + " M"
    if abs(value) >= 10_000:
        return fmt.number(lang, value / 1000, 0 if value % 1000 == 0 else 1) + " k"
    return fmt.number(lang, value, 0 if float(value).is_integer() else 1)


class LineChart(Flowable):
    def __init__(self, chart: Chart, width: float, lang: str, height: float = 178):
        super().__init__()
        self.chart, self.width, self.height, self.lang = chart, width, height, lang

    def wrap(self, _aw, _ah):
        return self.width, self.height

    def draw(self):
        c, chart, lang = self.canv, self.chart, self.lang
        c.setFillColor(INK)
        glyphs.draw(c, 0, self.height - 12, fmt.tr(lang, chart.title), glyphs.BOLD, 11)
        # The legend, right of the title: a short stroke and the name for each line.
        x = self.width
        for index in range(len(chart.series) - 1, -1, -1):
            series = chart.series[index]
            name = fmt.tr(lang, series.name)
            x -= glyphs.width(name, glyphs.REGULAR, 8.5)
            c.setFillColor(TEXT2)
            glyphs.draw(c, x, self.height - 11.5, name, glyphs.REGULAR, 8.5)
            colour = SERIES[self._colour_index(index)]
            c.setStrokeColor(colour)
            c.setLineWidth(1.8)
            c.setDash(3, 2) if series.dashed else c.setDash()
            c.line(x - 18, self.height - 8.5, x - 5, self.height - 8.5)
            c.setDash()
            x -= 32
        left, right, bottom, top = 38, 6, 22, self.height - 30
        plot_w, plot_h = self.width - left - right, top - bottom
        values = [v for s in chart.series for v in s.values if v is not None]
        peak = _nice_top(max(values) if values else 1)
        c.setLineWidth(0.6)
        for step in range(5):
            y = bottom + plot_h * step / 4
            c.setStrokeColor(LINE2 if step == 0 else LINE)
            c.line(left, y, left + plot_w, y)
            c.setFillColor(MUTED)
            glyphs.draw(c, left - 6, y - 2.8, _short(lang, peak * step / 4), glyphs.REGULAR, 7.5, "right")
        count = len(chart.labels)
        if count:
            wanted = max(2, min(count, int(plot_w // 56)))  # as many as fit with room between them, so two never touch
            picks = sorted({round(i * (count - 1) / max(1, wanted - 1)) for i in range(wanted)})
            for i in picks:
                px = left + (plot_w * i / (count - 1) if count > 1 else plot_w / 2)
                c.setFillColor(MUTED)
                align = "left" if i == 0 else "right" if i == count - 1 else "center"
                glyphs.draw(c, px, bottom - 12, day_label(lang, chart.labels[i]), glyphs.REGULAR, 7.5, align)
        for index, series in enumerate(chart.series):
            colour = SERIES[self._colour_index(index)]
            c.setStrokeColor(colour)
            c.setLineWidth(1.1 if series.dashed else 1.7)
            c.setLineJoin(1)
            c.setLineCap(1)
            c.setDash(3, 2.2) if series.dashed else c.setDash()
            n = len(series.values)
            path, drawing, points = c.beginPath(), False, []
            for i, value in enumerate(series.values):
                if value is None:
                    drawing = False
                    continue
                px = left + (plot_w * i / (n - 1) if n > 1 else plot_w / 2)
                py = bottom + plot_h * max(0.0, min(1.0, value / peak))
                points.append((px, py))
                if drawing:
                    path.lineTo(px, py)
                else:
                    path.moveTo(px, py)
                    drawing = True
            c.drawPath(path, stroke=1, fill=0)
            c.setDash()
            if len(points) == 1 or (n <= 12 and not series.dashed):
                c.setFillColor(colour)
                for px, py in points:
                    c.circle(px, py, 1.9, stroke=0, fill=1)

    def _colour_index(self, index: int) -> int:
        """A comparison line takes the colour of the line it is compared with."""
        series = self.chart.series
        if series[index].dashed and index > 0:
            return (index - 1) % len(SERIES)
        return sum(1 for s in series[:index] if not s.dashed) % len(SERIES)


class BarChart(Flowable):
    """Bars lying down, one per label, longest first as given. For shares and rankings."""

    def __init__(self, chart: Chart, width: float, lang: str):
        super().__init__()
        self.chart, self.width, self.lang = chart, width, lang
        self.count = min(len(chart.labels), 12)
        self.row_h = 17
        self.height = 24 + self.count * self.row_h

    def wrap(self, _aw, _ah):
        return self.width, self.height

    def draw(self):
        c, chart, lang = self.canv, self.chart, self.lang
        c.setFillColor(INK)
        glyphs.draw(c, 0, self.height - 12, fmt.tr(lang, chart.title), glyphs.BOLD, 11)
        values = [(chart.series[0].values[i] or 0) for i in range(self.count)] if chart.series else []
        peak = max(values) if values and max(values) > 0 else 1
        labels = [fmt.cell(lang, label, "text", "known") for label in chart.labels[: self.count]]  # channel names and the like: the app's words when it has them
        label_w = min(self.width * 0.34, max((glyphs.width(label, glyphs.REGULAR, 8.5) for label in labels), default=40) + 8)
        value_w = 58
        bar_w = self.width - label_w - value_w
        for i in range(self.count):
            y = self.height - 24 - (i + 1) * self.row_h + 4
            c.setFillColor(TEXT2)
            glyphs.draw(c, 0, y + 2.5, glyphs.fit(labels[i], glyphs.REGULAR, 8.5, label_w - 8), glyphs.REGULAR, 8.5)
            c.setFillColor(HEAD_BG)
            c.roundRect(label_w, y, bar_w, 10, 2.5, stroke=0, fill=1)
            length = bar_w * values[i] / peak
            if length > 0.5:
                c.setFillColor(SERIES[0])
                c.roundRect(label_w, y, max(length, 3), 10, 2.5, stroke=0, fill=1)
            c.setFillColor(INK)
            glyphs.draw(c, self.width, y + 2.5, fmt.cell(lang, values[i], chart.value_kind), glyphs.MEDIUM, 8.5, "right")


# ---- tables ----------------------------------------------------------------------------------------------


def _styles():
    body = ParagraphStyle("cell", fontName=glyphs.REGULAR, fontSize=8.3, leading=10.6, textColor=INK, splitLongWords=1, wordWrap=None)
    return {
        "cell": body,
        "head": ParagraphStyle("head", parent=body, fontName=glyphs.BOLD, fontSize=7.6, leading=9.4, textColor=MUTED, splitLongWords=0),
        "head_r": ParagraphStyle("head_r", parent=body, fontName=glyphs.BOLD, fontSize=7.6, leading=9.4, textColor=MUTED, alignment=2, splitLongWords=0),
        "h2": ParagraphStyle("h2", fontName=glyphs.BOLD, fontSize=12.5, leading=16, textColor=INK, spaceAfter=1),
        "count": ParagraphStyle("count", fontName=glyphs.REGULAR, fontSize=8.5, leading=11, textColor=MUTED, spaceAfter=5),
        "note": ParagraphStyle("note", fontName=glyphs.REGULAR, fontSize=8.5, leading=11.5, textColor=MUTED),
        "empty": ParagraphStyle("empty", fontName=glyphs.REGULAR, fontSize=9.5, leading=13, textColor=TEXT2),
    }


def _text_cell(value: str, kind: str, style, raw=None) -> Paragraph:
    shown = value if len(value) <= 600 else value[:600] + "…"
    link = http_url(raw if raw is not None else value) if kind == "url" else None
    words = glyphs.markup(shown)
    if link:
        href = link.replace("&", "&amp;").replace('"', "%22").replace("<", "%3C").replace(">", "%3E")
        words = f'<a href="{href}" color="#176AAB">{words}</a>'
    return Paragraph(words, style)


PLAIN = (*NUMERIC, "date", "datetime", "bool")
PAD = 13.0


def _address(report: Report, words: str) -> str:
    """An address as the screens show it: without https://, and a page of the report's own site by its path alone."""
    if not http_url(words):
        return words
    shown = words.split("://", 1)[1]
    if report.site and (shown == report.site or shown.startswith(f"{report.site}/")):
        shown = shown[len(report.site):] or "/"
    return shown


def _cells(report: Report, table: Table) -> list[list[tuple[str, object]]]:
    """Every shown cell in words, beside its raw value."""
    lang = report.lang
    out = []
    for row in table.rows[:MAX_PDF_ROWS]:
        line = []
        for column in table.columns:
            raw = column.value(row)
            words = fmt.cell(lang, raw, column.kind, column.translate)
            line.append((_address(report, words) if column.kind == "url" else words, raw))
        out.append(line)
    return out


def _for_reading(report: Report, table: Table, cells) -> tuple[Table, list]:
    """A column with nothing in it on any row is left out of the PDF, so the others have room, and so is a Site column
    that only repeats the site the header names. Excel and CSV keep every column."""
    if not cells:
        return table, cells

    def says_something(i: int) -> bool:
        words = {row[i][0] for row in cells} - {""}
        if not table.columns[i].pdf or (report.site and table.columns[i].label == "Site" and words <= {report.site}):
            return False
        return bool(words)

    keep = [i for i in range(len(table.columns)) if i == 0 or says_something(i)]
    if len(keep) == len(table.columns):
        return table, cells
    slim = Table(table.id, table.title, [table.columns[i] for i in keep], table.rows, total=table.total, note=table.note, empty=table.empty)
    return slim, [[row[i] for i in keep] for row in cells]


def _widths(report: Report, table: Table, cells, width: float) -> tuple[list[float], bool]:
    """Column widths for this page width, and whether they fit without squeezing the words.

    A column of numbers or dates is as wide as its widest value or its heading's longest word, no more. The words
    (queries, addresses) share what is left.
    """
    lang = report.lang
    sample = cells[:400]
    natural, wordy = [], []
    for i, column in enumerate(table.columns):
        label = fmt.tr(lang, column.label)
        # A heading takes two lines at most: as wide as its longest word, or half of itself.
        head = max(max((glyphs.width(word, glyphs.BOLD, 7.6) for word in label.split()), default=10), glyphs.width(label, glyphs.BOLD, 7.6) * 0.56) + PAD
        longest = max((glyphs.width(row[i][0][:120], glyphs.REGULAR, 8.3) for row in sample), default=0) + PAD
        if column.kind in PLAIN:
            natural.append(max(head, longest, 34))
        else:
            wordy.append(i)
            natural.append(max(head, min(longest, 250 if column.kind == "url" else 190), 46))
    total = sum(natural)
    if total <= width:
        spare = width - total
        grow = wordy or list(range(len(natural)))
        base = sum(natural[i] for i in grow)
        for i in grow:
            natural[i] += spare * natural[i] / base
        return natural, True
    # The widest columns give way first: every column narrower than the limit keeps its full width.
    if not wordy:
        scale = width / total
        return [w * scale for w in natural], False
    fixed = sum(w for i, w in enumerate(natural) if i not in wordy)
    low, high = 0.0, max(natural[i] for i in wordy)
    for _ in range(40):
        limit = (low + high) / 2
        if fixed + sum(min(natural[i], limit) for i in wordy) > width:
            high = limit
        else:
            low = limit
    limit = max(low, 40)
    for i in wordy:
        natural[i] = min(natural[i], limit)
    scale = width / sum(natural)
    return [w * scale for w in natural], limit >= 118


def _table_flowables(report: Report, table: Table, width: float, styles, cells) -> list:
    lang = report.lang
    t = lambda words: fmt.tr(lang, words)  # noqa: E731
    shown = len(cells)
    all_rows = max(table.total or 0, table.count)
    if not table.rows:
        count = ""
    elif shown < all_rows:
        count = t("First {shown} of {total} rows; Excel and CSV hold more.").replace("{shown}", fmt.number(lang, shown)).replace("{total}", fmt.number(lang, all_rows))
    else:
        count = (t("1 row") if all_rows == 1 else t("{n} rows").replace("{n}", fmt.number(lang, all_rows)))
    head = [Paragraph(glyphs.markup(t(table.title), glyphs.BOLD), styles["h2"])]
    if count:
        head.append(Paragraph(glyphs.markup(count), styles["count"]))
    if table.note:
        head.append(Paragraph(glyphs.markup(t(table.note)), styles["count"]))
    if not table.rows or not table.columns:
        return [KeepTogether(head + [Paragraph(glyphs.markup(t(table.empty)), styles["empty"]), Spacer(1, 16)])]

    widths, _fits = _widths(report, table, cells, width)
    data = [[Paragraph(glyphs.markup(t(c.label), glyphs.BOLD), styles["head_r" if c.kind in NUMERIC else "head"]) for c in table.columns]]
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), HEAD_BG),
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, LINE2),
        ("LINEBELOW", (0, 1), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
        ("FONT", (0, 1), (-1, -1), glyphs.REGULAR, 8.3, 10.6),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 4.2),
        ("TOPPADDING", (0, 0), (-1, 0), 5.5), ("BOTTOMPADDING", (0, 0), (-1, 0), 5.5),
    ]
    for i, column in enumerate(table.columns):
        if column.kind in NUMERIC:
            commands.append(("ALIGN", (i, 1), (i, -1), "RIGHT"))
    for r, row in enumerate(cells, start=1):
        line = []
        for i, column in enumerate(table.columns):
            words, raw = row[i]
            if not words:
                line.append(DASH)
                commands.append(("TEXTCOLOR", (i, r), (i, r), LINE2))
            elif column.kind in PLAIN and glyphs.runs(words)[0][0] == glyphs.REGULAR and len(glyphs.runs(words)) == 1:
                line.append(words)
                colour = _tone_colour(fmt.tone(raw, column.kind))
                if colour:
                    commands.append(("TEXTCOLOR", (i, r), (i, r), colour))
            else:
                line.append(_text_cell(words, column.kind, styles["cell"], raw))
        data.append(line)
    flow = LongTable(data, colWidths=widths, repeatRows=1, splitByRow=1)
    flow.setStyle(TableStyle(commands))
    flow.hAlign = "LEFT"
    # The heading stays with the table's first rows: never alone at the foot of a page.
    return [CondPageBreak(84), *head, flow, Spacer(1, 18)]


class Side(Flowable):
    """Two charts side by side."""

    def __init__(self, left: Flowable, right: Flowable, gap: float = 22):
        super().__init__()
        self.left, self.right, self.gap = left, right, gap
        self.width = left.width + gap + right.width
        self.height = max(left.height, right.height)

    def wrap(self, _aw, _ah):
        return self.width, self.height

    def draw(self):
        self.left.drawOn(self.canv, 0, self.height - self.left.height)
        self.right.drawOn(self.canv, self.left.width + self.gap, self.height - self.right.height)


# ---- pages -------------------------------------------------------------------------------------------------


class _Pages(pdf_canvas.Canvas):
    """Keeps every page until the end, so the footer can say "Page 2 of 7"."""

    def __init__(self, *args, footer: str = "", page_word: str = "Page", of_word: str = "of", **kwargs):
        super().__init__(*args, **kwargs)
        self._saved, self._footer, self._page_word, self._of_word = [], footer, page_word, of_word

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            width, _height = self._pagesize
            self.setStrokeColor(LINE)
            self.setLineWidth(0.6)
            self.line(MARGIN, 30, width - MARGIN, 30)
            self.setFillColor(MUTED)
            glyphs.draw(self, MARGIN, 18, glyphs.fit(self._footer, glyphs.REGULAR, 7.8, width - 2 * MARGIN - 90), glyphs.REGULAR, 7.8)
            glyphs.draw(self, width - MARGIN, 18, f"{self._page_word} {self._pageNumber} {self._of_word} {total}", glyphs.REGULAR, 7.8, "right")
            super().showPage()
        super().save()


def write(report: Report) -> bytes:
    glyphs.register()
    glyphs.start_watch()
    lang = report.lang
    upright = A4[0] - 2 * MARGIN
    tables, cells = [], {}
    for table in report.tables:
        slim, shown = _for_reading(report, table, _cells(report, table))
        tables.append(slim)
        cells[slim.id] = shown
    wide = any(table.rows and table.columns and not _widths(report, table, cells[table.id], upright)[1] for table in tables)
    page = landscape(A4) if wide else A4
    width = page[0] - 2 * MARGIN
    styles = _styles()
    story: list = [Cover(report, width), Spacer(1, 14)]
    if report.tiles:
        story += [Tiles(report.tiles, width, lang, per_row=6 if wide else 4), Spacer(1, 18)]
    charts = [c for c in report.charts if c.labels and any(v is not None for s in c.series for v in s.values)]
    lines = [c for c in charts if c.kind != "bar"]
    while len(lines) >= 2:
        first, second = lines.pop(0), lines.pop(0)
        half = (width - 22) / 2
        story += [Side(LineChart(first, half, lang, 150), LineChart(second, half, lang, 150)), Spacer(1, 18)]
    for chart in lines:
        story += [LineChart(chart, width, lang), Spacer(1, 18)]
    for chart in charts:
        if chart.kind == "bar":
            story += [BarChart(chart, width, lang), Spacer(1, 18)]
    for table in tables:
        story += _table_flowables(report, table, width, styles, cells[table.id])
    if not report.tables and not report.tiles and not charts:
        story.append(Paragraph(glyphs.markup(fmt.tr(lang, "Nothing to show for this period.")), styles["empty"]))
    # Words drawn straight onto the page (header, tiles, charts) are looked at now, so a missing character is known before the last line is written.
    for words in [report.site or "", fmt.tr(lang, report.title), *(fmt.filter_value(lang, value) for _label, value in report.filters), *(fmt.tr(lang, t.label) for t in report.tiles), *(day_label(lang, label) for c in charts for label in c.labels), *(fmt.tr(lang, s.name) for c in charts for s in c.series)]:
        glyphs.runs(words)
    notes = list(report.notes)
    if glyphs.missed():
        report.undrawn = True
        notes.append("Some characters show as “?” in this PDF; Excel and CSV keep them.")
    for note in notes:
        story.append(Paragraph(glyphs.markup(fmt.tr(lang, note)), styles["note"]))
        story.append(Spacer(1, 4))

    out = io.BytesIO()
    title = fmt.tr(lang, report.title)
    footer = "  ·  ".join(part for part in ("SEO Command Center", report.site or fmt.tr(lang, "All sites"), title) if part)
    doc = BaseDocTemplate(out, pagesize=page, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=36, bottomMargin=42,
                          title=title, author="SEO Command Center", subject=report.site or "", creator="SEO Command Center")
    frame = Frame(MARGIN, 42, width, page[1] - 36 - 42, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="body")
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame])])
    doc.build(story, canvasmaker=lambda *a, **k: _Pages(*a, footer=footer, page_word=fmt.tr(lang, "Page"), of_word=fmt.tr(lang, "of"), **k))
    return out.getvalue()
