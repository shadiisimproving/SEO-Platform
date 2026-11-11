"""Search Console's generative AI performance report (Search results → Generative AI: AI Overviews and AI Mode), uploaded
by hand. Google's API doesn't give it (its search types refuse every generative-AI value), so its Export is the only way.

What Google documents (support.google.com/webmasters/answer/16984139, read 2026-11-10): one metric, impressions; grouped
by page (the canonical URL), country, device and date (Pacific time); a filter on search type ("Web: text-based" or
"Web: multimodal"); Export downloads "both the chart and table data", and values shown as "~" or "-" are zeros in the
download. Like the Performance report's own export, that's a zip of CSV files, one per tab (pages, countries, devices,
dates) and a Filters file; one tab can also be downloaded alone, or opened as a Google Sheet and saved as CSV.

So this reader is tolerant: a .zip or one or more .csv files; each table is known by its first column's header, in
English, French, Spanish or German; the impressions column by its name; commas, semicolons or tabs; thousands written
with commas or spaces; "~" and "-" as 0. The period comes from the dates table, or else from the Filters file. Uploading
the same site, search type and period again replaces the earlier upload.
"""
from __future__ import annotations

import csv
import io
import json
import re
import unicodedata
import zipfile
from datetime import date, datetime, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.core.errors import Refused
from seo.links.urls import host_key

MAX_BYTES = 5 * 1024 * 1024  # one upload; a zip's files together may hold up to MAX_UNZIPPED
MAX_UNZIPPED = 25 * 1024 * 1024
MAX_FILES = 12
PAGES_KEPT = 500
NOT_THE_REPORT = "Not Search Console's generative AI report. Open Performance → Generative AI → Export → Download CSV."


def _fold(value: str) -> str:
    clean = unicodedata.normalize("NFKD", (value or "").strip().lstrip("﻿")).casefold()
    return "".join(c for c in clean if not unicodedata.combining(c))


# The first column's header names the table. English first, then the French, Spanish and German screens.
_TABLES = {
    "pages": ("top pages", "pages", "page", "url", "urls", "pages les plus populaires", "principales pages", "pages principales", "paginas principales", "paginas", "pagina", "top-seiten", "seiten", "seite"),
    "countries": ("country", "countries", "pays", "pais", "paises", "land", "lander"),
    "devices": ("device", "devices", "appareil", "appareils", "dispositivo", "dispositivos", "gerat", "gerate"),
    "days": ("date", "dates", "day", "jour", "fecha", "fechas", "datum"),
    "filters": ("filter", "filters", "filtre", "filtres", "filtro", "filtros"),
}
_DEVICES = {"mobile": "MOBILE", "mobil": "MOBILE", "movil": "MOBILE", "desktop": "DESKTOP", "ordinateur": "DESKTOP", "ordenador": "DESKTOP", "computer": "DESKTOP", "tablet": "TABLET", "tablette": "TABLET", "tableta": "TABLET"}
_RELATIVE = (  # Filters → Date, as the screen words it
    (re.compile(r"(\d+)\s*(?:\w+\s+)?(day|days|jour|jours|dias|tage)\b"), "days"), (re.compile(r"(\d+)\s*(?:\w+\s+)?(month|months|mois|meses|monate)\b"), "months"),
)


def _number(value) -> int:
    word = (value or "").strip()
    if word in ("", "~", "-", "—", "–"):
        return 0
    word = word.replace(" ", "").replace(" ", "").replace(" ", "").replace(",", "").replace("'", "")
    if re.fullmatch(r"\d+\.\d{3}(\.\d{3})*", word):  # 1.234 as German thousands
        word = word.replace(".", "")
    try:
        number = float(word)
    except ValueError:
        return 0
    return int(round(number)) if 0 <= number < 1e12 else 0


def _day(value) -> date | None:
    word = (value or "").strip()
    for pattern in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%b %d, %Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(word, pattern).date()
        except ValueError:
            continue
    return None


def _rows(raw: bytes) -> list[list[str]]:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            body = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise Refused(NOT_THE_REPORT)
    if "\x00" in body:
        raise Refused(NOT_THE_REPORT)
    sample = body[:4096]
    delimiter = max((",", ";", "\t"), key=sample.count)
    return [row for row in csv.reader(io.StringIO(body), delimiter=delimiter) if any(cell.strip() for cell in row)]


def _table(rows: list[list[str]]) -> tuple[str, list[list[str]]] | None:
    """Which table this is, and its rows. None when the header says nothing we know."""
    if not rows:
        return None
    head = [_fold(cell) for cell in rows[0]]
    kind = next((name for name, words in _TABLES.items() if head[0] in words), None)
    if kind is None:
        return None
    return kind, rows


def _impressions_column(head: list[str]) -> int | None:
    folded = [_fold(cell) for cell in head]
    return next((i for i, cell in enumerate(folded) if cell.startswith("impression") or cell.startswith("impresion")), None)


def _files(name: str, raw: bytes) -> list[tuple[str, bytes]]:
    """A zip's CSV files, or the one CSV."""
    if raw[:4] == b"PK\x03\x04":
        try:
            archive = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as exc:
            raise Refused(NOT_THE_REPORT) from exc
        members = [m for m in archive.infolist() if not m.is_dir() and m.filename.lower().endswith(".csv") and "__macosx" not in m.filename.lower()]
        if not members:
            raise Refused(NOT_THE_REPORT)
        if len(members) > MAX_FILES or sum(m.file_size for m in members) > MAX_UNZIPPED:
            raise Refused("This zip holds more than a Search Console export does.")
        return [(m.filename, archive.read(m)) for m in members]
    lowered = name.lower()
    if lowered.endswith((".xlsx", ".xls", ".ods")):
        raise Refused("Download the report as CSV (Export → Download CSV), not as a spreadsheet.")
    return [(name, raw)]


def parse(uploads: list[tuple[str, bytes]], today: date | None = None) -> dict:
    """Every table found across the files, the period and the search type."""
    tables: dict[str, list] = {}
    filters: dict[str, str] = {}
    for name, raw in uploads:
        for member, body in _files(name, raw):
            found = _table(_rows(body))
            if found is None:
                continue
            kind, rows = found
            if kind == "filters":
                for row in rows[1:]:
                    if len(row) >= 2:
                        filters[_fold(row[0])] = row[1].strip()
                continue
            column = _impressions_column(rows[0])
            if column is None:
                continue
            items = []
            for row in rows[1:]:
                if len(row) <= column or not row[0].strip():
                    continue
                key, shown = row[0].strip()[:500], _number(row[column])
                if kind == "days":
                    day = _day(key)
                    if day is None:
                        continue
                    key = day.isoformat()
                elif kind == "devices":
                    key = _DEVICES.get(_fold(key), key.upper())
                items.append({"key": key, "impressions": shown})
            tables.setdefault(kind, []).extend(items)
    if not any(tables.get(k) for k in ("pages", "countries", "devices", "days")):
        raise Refused(NOT_THE_REPORT)
    start, end, known = _period(tables.get("days") or [], filters, today or date.today())
    search_type = "multimodal" if any("multimodal" in _fold(v) for v in filters.values()) else "web"
    return {"tables": tables, "period_start": start, "period_end": end, "period_known": known, "search_type": search_type, "filters": filters}


def _period(days: list[dict], filters: dict, today: date) -> tuple[date, date, bool]:
    if days:
        found = sorted(d["key"] for d in days)
        return date.fromisoformat(found[0]), date.fromisoformat(found[-1]), True
    said = next((v for k, v in filters.items() if k in ("date", "dates", "periode", "fecha", "datum", "zeitraum")), "")
    dated = re.findall(r"\d{4}-\d{2}-\d{2}", said)
    if len(dated) >= 2:
        return date.fromisoformat(min(dated)), date.fromisoformat(max(dated)), True
    folded = _fold(said)
    end = today - timedelta(days=2)  # Search Console's own last day, about two days back
    for pattern, unit in _RELATIVE:
        hit = pattern.search(folded)
        if hit:
            size = int(hit.group(1))
            start = end - timedelta(days=size - 1) if unit == "days" else end - timedelta(days=round(size * 30.44) - 1)
            return start, end, False
    return end, end, False


def _summary(report: dict) -> dict:
    tables = report["tables"]
    by = lambda kind: sorted(_merged(tables.get(kind) or []), key=lambda r: -r["impressions"])  # noqa: E731
    days, pages = sorted(_merged(tables.get("days") or []), key=lambda r: r["key"]), by("pages")
    total = sum(d["impressions"] for d in days) if days else sum(p["impressions"] for p in pages) if pages else sum(r["impressions"] for r in by("countries"))
    return {
        "impressions": total, "pages": pages[:PAGES_KEPT], "pages_count": len(pages), "countries": by("countries")[:50], "devices": by("devices"),
        "days": days, "period_known": report["period_known"], "search_type": report["search_type"],
    }


def _merged(rows: list[dict]) -> list[dict]:
    out: dict[str, int] = {}
    for r in rows:
        out[r["key"]] = out.get(r["key"], 0) + r["impressions"]
    return [{"key": k, "impressions": v} for k, v in out.items()]


def import_files(engine: Engine, site_id, uploads: list[tuple[str, bytes]], user_id: int | None = None, today: date | None = None) -> dict:
    """One upload: the files of one export. Refused whole when it isn't the report or is about another site."""
    try:
        site_id = int(site_id)
    except (TypeError, ValueError) as exc:
        raise Refused("Pick the site this report is about.") from exc
    if not uploads:
        raise Refused("Choose the export file first.")
    if len(uploads) > MAX_FILES:
        raise Refused(f"Upload at most {MAX_FILES} files at once.")
    for name, raw in uploads:
        if len(raw) > MAX_BYTES:
            raise Refused(f"{name[:80]} is too large. The limit is {MAX_BYTES // (1024 * 1024)} MB.")
    with engine.connect() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s AND kind = 'own'"), {"s": site_id}).scalar()
    if not host:
        raise Refused("That site isn't one of yours.")
    report = parse(uploads, today)
    page_hosts = {host_key(p["key"]) for p in report["tables"].get("pages") or [] if "://" in p["key"]} - {""}
    mine = host_key(f"https://{host}")
    if page_hosts and not any(h == mine or h.endswith("." + mine) for h in page_hosts):
        raise Refused(f"This report is about {sorted(page_hosts)[0]}, not {host}. Pick that site, or export the right property.")
    data = _summary(report)
    names = [name[:120] for name, _ in uploads]
    with engine.begin() as conn:
        held = conn.execute(
            text("SELECT id FROM gsc_ai_reports WHERE site_id = :s AND search_type = :t AND period_start = :a AND period_end = :b"),
            {"s": site_id, "t": report["search_type"], "a": report["period_start"], "b": report["period_end"]},
        ).scalar()
        values = {"s": site_id, "t": report["search_type"], "a": report["period_start"], "b": report["period_end"], "f": ", ".join(names)[:200], "d": json.dumps(data, ensure_ascii=False), "u": user_id}
        if held:
            conn.execute(text("UPDATE gsc_ai_reports SET data = :d, file_name = :f, uploaded_by = :u, uploaded_at = UTC_TIMESTAMP(3) WHERE id = :i"), {**values, "i": held})
        else:
            conn.execute(text("INSERT INTO gsc_ai_reports (site_id, search_type, period_start, period_end, file_name, data, uploaded_by) VALUES (:s, :t, :a, :b, :f, :d, :u)"), values)
    return {
        "site_id": site_id, "host": host, "replaced": bool(held), "search_type": report["search_type"], "period_start": report["period_start"].isoformat(),
        "period_end": report["period_end"].isoformat(), "period_known": report["period_known"], "impressions": data["impressions"], "pages": data["pages_count"],
    }


def latest(engine: Engine, site_ids: list[int], full: bool = True) -> dict:
    """Per site, the newest upload (the one ending last, then uploaded last) and the one before it of the same length, for a
    change. full=False keeps the totals only (what the AI search screen's summary needs)."""
    if not site_ids:
        return {"sites": []}
    statement = text(
        "SELECT r.id, r.site_id, s.host, r.search_type, r.period_start, r.period_end, r.data, r.uploaded_at FROM gsc_ai_reports r JOIN sites s ON s.id = r.site_id "
        "WHERE r.site_id IN :ids AND r.search_type = 'web' ORDER BY s.host, r.period_end DESC, r.uploaded_at DESC"
    ).bindparams(bindparam("ids", expanding=True))
    per_site: dict[int, dict] = {}
    with engine.connect() as conn:
        for row in conn.execute(statement, {"ids": site_ids}).mappings():
            data = row["data"] if isinstance(row["data"], dict) else json.loads(row["data"] or "{}")
            site = per_site.get(row["site_id"])
            length = (row["period_end"] - row["period_start"]).days
            if site is None:
                site = {"site_id": row["site_id"], "host": row["host"], "period_start": row["period_start"].isoformat(), "period_end": row["period_end"].isoformat(),
                        "uploaded_at": row["uploaded_at"].strftime("%Y-%m-%dT%H:%M:%SZ"), "uploads": 0, "_length": length, "before": None,
                        **(data if full else {k: data.get(k) for k in ("impressions", "pages_count", "period_known")})}
                per_site[row["site_id"]] = site
            elif site["before"] is None and length == site["_length"] and row["period_end"].isoformat() < site["period_start"]:
                site["before"] = {"period_start": row["period_start"].isoformat(), "period_end": row["period_end"].isoformat(), "impressions": data.get("impressions")}
            site["uploads"] += 1
    for site in per_site.values():
        site.pop("_length")
    return {"sites": list(per_site.values())}
