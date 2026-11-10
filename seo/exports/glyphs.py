"""Which font draws which characters, and Arabic joined and ordered so a PDF shows it as it is read.

The PDF library places one glyph per character, left to right. Latin and Cyrillic need nothing more. Arabic needs
its letters swapped for their joined forms and the run turned around; this does both in plain Python, well enough
for search queries and page titles. It is not a full bidirectional layout: long mixed sentences can come out with
their parts in the wrong order.
"""
from __future__ import annotations

import threading
from functools import lru_cache
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_DIR = Path(__file__).resolve().parent / "fonts"
REGULAR, MEDIUM, BOLD, ARABIC, OTHER = "Geist", "Geist-Medium", "Geist-SemiBold", "NotoSansArabic", "DejaVuSans"
_FILES = {REGULAR: "Geist-Regular.ttf", MEDIUM: "Geist-Medium.ttf", BOLD: "Geist-SemiBold.ttf", ARABIC: "NotoSansArabic-Regular.ttf", OTHER: "DejaVuSans.ttf"}
_cmaps: dict[str, dict] = {}


def register() -> None:
    if _cmaps:
        return
    for name, file in _FILES.items():
        font = TTFont(name, str(FONT_DIR / file))
        pdfmetrics.registerFont(font)
        _cmaps[name] = font.face.charToGlyph
    pdfmetrics.registerFontFamily(REGULAR, normal=REGULAR, bold=BOLD, italic=REGULAR, boldItalic=BOLD)


# Arabic letters: (isolated, final, initial, medial) or (isolated, final) for the ones that never join forward.
_FORMS = {
    0x0621: (0xFE80,), 0x0622: (0xFE81, 0xFE82), 0x0623: (0xFE83, 0xFE84), 0x0624: (0xFE85, 0xFE86), 0x0625: (0xFE87, 0xFE88),
    0x0626: (0xFE89, 0xFE8A, 0xFE8B, 0xFE8C), 0x0627: (0xFE8D, 0xFE8E), 0x0628: (0xFE8F, 0xFE90, 0xFE91, 0xFE92), 0x0629: (0xFE93, 0xFE94),
    0x062A: (0xFE95, 0xFE96, 0xFE97, 0xFE98), 0x062B: (0xFE99, 0xFE9A, 0xFE9B, 0xFE9C), 0x062C: (0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0),
    0x062D: (0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4), 0x062E: (0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8), 0x062F: (0xFEA9, 0xFEAA), 0x0630: (0xFEAB, 0xFEAC),
    0x0631: (0xFEAD, 0xFEAE), 0x0632: (0xFEAF, 0xFEB0), 0x0633: (0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4), 0x0634: (0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8),
    0x0635: (0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC), 0x0636: (0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0), 0x0637: (0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4),
    0x0638: (0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8), 0x0639: (0xFEC9, 0xFECA, 0xFECB, 0xFECC), 0x063A: (0xFECD, 0xFECE, 0xFECF, 0xFED0),
    0x0640: (0x0640, 0x0640, 0x0640, 0x0640), 0x0641: (0xFED1, 0xFED2, 0xFED3, 0xFED4), 0x0642: (0xFED5, 0xFED6, 0xFED7, 0xFED8),
    0x0643: (0xFED9, 0xFEDA, 0xFEDB, 0xFEDC), 0x0644: (0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0), 0x0645: (0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4),
    0x0646: (0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8), 0x0647: (0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC), 0x0648: (0xFEED, 0xFEEE), 0x0649: (0xFEEF, 0xFEF0),
    0x064A: (0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4),
}
_LAM_ALEF = {0x0622: (0xFEF5, 0xFEF6), 0x0623: (0xFEF7, 0xFEF8), 0x0625: (0xFEF9, 0xFEFA), 0x0627: (0xFEFB, 0xFEFC)}


def _is_mark(code: int) -> bool:
    return 0x064B <= code <= 0x065F or code == 0x0670


def is_arabic(char: str) -> bool:
    code = ord(char)
    return 0x0600 <= code <= 0x06FF or 0x0750 <= code <= 0x077F or 0xFB50 <= code <= 0xFDFF or 0xFE70 <= code <= 0xFEFF


def _joined(word: str) -> str:
    """Each letter in the form its neighbours call for."""
    codes = [ord(c) for c in word]
    out: list[int] = []
    i, joins_back = 0, False
    while i < len(codes):
        code = codes[i]
        forms = _FORMS.get(code)
        if forms is None:
            out.append(code)
            if not _is_mark(code):
                joins_back = False
            i += 1
            continue
        j = i + 1
        while j < len(codes) and _is_mark(codes[j]):
            j += 1
        after = codes[j] if j < len(codes) else None
        if code == 0x0644 and after in _LAM_ALEF:
            out.append(_LAM_ALEF[after][1 if joins_back else 0])
            i, joins_back = j + 1, False
            continue
        forward = len(forms) == 4 and after in _FORMS and len(_FORMS[after]) > 1
        if len(forms) == 1:
            out.append(forms[0])
        elif joins_back and forward:
            out.append(forms[3])
        elif joins_back:
            out.append(forms[1])
        elif forward:
            out.append(forms[2])
        else:
            out.append(forms[0])
        joins_back = forward
        i += 1
    return "".join(chr(c) for c in out)


def _visual(text: str) -> str:
    """Arabic runs joined and turned around. A line that starts in Arabic has its parts turned around too."""
    parts: list[tuple[bool, str]] = []
    for char in text:
        rtl = is_arabic(char)
        if parts and (parts[-1][0] == rtl or (char in "  " and parts[-1][0])):
            parts[-1] = (parts[-1][0], parts[-1][1] + char)
        else:
            parts.append((rtl, char))
    fixed: list[tuple[bool, str]] = []
    for rtl, run in parts:
        if rtl:
            tail = run[len(run.rstrip("  ")):]
            body = run[: len(run) - len(tail)] if tail else run
            fixed.append((True, _joined(body)[::-1]))
            if tail:
                fixed.append((False, tail))
        else:
            fixed.append((False, run))
    first_strong = next((rtl for rtl, run in fixed if rtl or any(c.isalpha() for c in run)), False)
    if first_strong:
        fixed.reverse()
    return "".join(run for _rtl, run in fixed)


_seen = threading.local()


def start_watch() -> None:
    """Begin noting whether any character has no glyph in any font. One PDF at a time per thread."""
    _seen.missing = False


def missed() -> bool:
    return bool(getattr(_seen, "missing", False))


def runs(text: str, base: str = REGULAR) -> tuple[tuple[str, str], ...]:
    """The text as (font, piece) runs: the base font where it has the glyph, Arabic or the wide fallback where not.
    A character no font has is drawn as "?", and noted, so the PDF can say so."""
    found, lost = _runs(text, base)
    if lost:
        _seen.missing = True
    return found


@lru_cache(maxsize=4096)
def _runs(text: str, base: str) -> tuple[tuple[tuple[str, str], ...], bool]:
    register()
    if text.isascii():
        return ((base, text),), False
    lost = False
    if any(is_arabic(c) for c in text):
        text = _visual(text)
    main, out = _cmaps[base], []
    for char in text:
        code = ord(char)
        if code in main or char in "\n\t":
            font = base
        elif code in _cmaps[ARABIC]:
            font = ARABIC
        elif code in _cmaps[OTHER]:
            font = OTHER
        elif code in (0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0xFEFF):
            continue  # invisible marks: nothing to draw
        else:
            font, char, lost = base, "?", True
        if out and out[-1][0] == font:
            out[-1][1] += char
        else:
            out.append([font, char])
    return tuple((font, piece) for font, piece in out), lost


def width(text: str, base: str, size: float) -> float:
    return sum(pdfmetrics.stringWidth(piece, font, size) for font, piece in runs(text, base))


def draw(canvas, x: float, y: float, text: str, base: str, size: float, align: str = "left") -> float:
    """Draw one line with the right font for each piece. Returns its width."""
    total = width(text, base, size)
    if align == "right":
        x -= total
    elif align == "center":
        x -= total / 2
    for font, piece in runs(text, base):
        canvas.setFont(font, size)
        canvas.drawString(x, y, piece)
        x += pdfmetrics.stringWidth(piece, font, size)
    return total


def fit(text: str, base: str, size: float, most: float) -> str:
    """The text, cut with an ellipsis if it is wider than `most`."""
    if width(text, base, size) <= most:
        return text
    while text and width(text + "…", base, size) > most:
        text = text[:-1]
    return text.rstrip() + "…"


def markup(text: str, base: str = REGULAR) -> str:
    """The text as paragraph markup, escaped, with a font tag around each piece the base font can't draw."""
    out = []
    for font, piece in runs(text, base):
        safe = piece.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        out.append(safe if font == base else f'<font name="{font}">{safe}</font>')
    return "".join(out)
