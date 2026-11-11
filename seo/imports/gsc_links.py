"""Search Console's Links report, uploaded by hand: its API has no Links data, so the export is the only way in.

Three exports are understood, whatever language Search Console is in, because the file is read by what's in it, not by its headings:
- "Latest links" (or "More sample links"): linking pages, with the day Google last crawled each. Linking pages nobody logged go to
  Found but never logged; logged links Google lists get "Google sees it".
- "Top linking sites": domains with counts. A logged link from one of them gets "Google sees the site".
- "Top linked pages": my own pages other sites link to. Each is read once a month, so one that's gone shows in Reclaim.

A file can be the .csv or the .zip Search Console downloads. Nothing in it is trusted: every address is checked like a typed one.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import zipfile
from datetime import date, datetime

from sqlalchemy import Engine, text

from seo.backlinks import cleaner, service
from seo.competitors.keywords import require_own
from seo.core.errors import Refused
from seo.links.urls import host_key, page_key
from seo.serp import store

LATEST, SITES, PAGES = "latest", "sites", "pages"
FOUND_BY = "Search Console"
MAX_BYTES = 10_000_000
MAX_ROWS = 50_000
_URL = re.compile(r"^https?://\S+$", re.IGNORECASE)
_DOMAIN = re.compile(r"^(?!-)[a-z0-9.-]+\.[a-z]{2,}$", re.IGNORECASE)
_NUMBER = re.compile(r"^\d[\d\s.,  ]*$")
_MONTHS = {
    "jan": 1, "janv": 1, "feb": 2, "fév": 2, "fev": 2, "févr": 2, "mar": 3, "mars": 3, "apr": 4, "avr": 4, "may": 5, "mai": 5, "jun": 6, "juin": 6,
    "jul": 7, "juil": 7, "aug": 8, "août": 8, "aout": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12, "déc": 12,
}


def _text_of(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _tables(name: str, data: bytes) -> list[list[list[str]]]:
    """Every table in the upload: one for a .csv, each .csv inside a .zip."""
    if len(data) > MAX_BYTES:
        raise Refused("File too large: a Search Console export is well under 10 MB.")
    if data[:4] == b"PK\x03\x04":
        try:
            box = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise Refused("Can't open that .zip.") from None
        found = []
        total = 0
        for info in box.infolist():
            if info.is_dir() or not info.filename.lower().endswith(".csv"):
                continue
            total += info.file_size
            if total > MAX_BYTES * 3:
                raise Refused("That .zip file holds too much.")
            found.append(_rows_of(box.read(info)))
        if not found:
            raise Refused("No .csv inside that .zip.")
        return found
    if name.lower().endswith((".xlsx", ".xls")):
        raise Refused("Download it as CSV, not Excel.")
    return [_rows_of(data)]


def _rows_of(data: bytes) -> list[list[str]]:
    body = _text_of(data)
    sample = body[:4000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(body), dialect) if any(cell.strip() for cell in row)]
    if len(rows) > MAX_ROWS + 1:
        raise Refused(f"One file can hold at most {MAX_ROWS:,} rows.")
    return rows


def parse_day(value: str) -> str | None:
    """Search Console writes the day as 2026-08-01, 8/1/26, 01/08/2026, Aug 1, 2026 or 1 août 2026, by language. YYYY-MM-DD or None."""
    raw = (value or "").strip().lower().replace(".", "")
    if not raw:
        return None
    match = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw)
    if match:
        return _day(int(match[1]), int(match[2]), int(match[3]))
    match = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", raw)
    if match:
        first, second, year = int(match[1]), int(match[2]), int(match[3])
        year += 2000 if year < 100 else 0
        month, day = (first, second) if first <= 12 and second > 12 else (second, first) if first > 12 else (first, second)
        return _day(year, month, day)
    words = re.findall(r"[^\W\d_]+|\d+", raw)
    numbers = [int(w) for w in words if w.isdigit()]
    names = [_MONTHS.get(w[:4]) or _MONTHS.get(w[:3]) for w in words if not w.isdigit()]
    months = [m for m in names if m]
    if months and len(numbers) >= 2:
        year = next((n for n in numbers if n > 31), None)
        day = next((n for n in numbers if n <= 31), None)
        if year and day:
            return _day(year, months[0], day)
    return None


def _day(year: int, month: int, day: int) -> str | None:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _number(value: str) -> int | None:
    raw = (value or "").strip()
    if not _NUMBER.match(raw):
        return None
    digits = re.sub(r"\D", "", raw)
    return int(digits) if digits and len(digits) < 12 else None


def _column(rows: list[list[str]], test) -> int | None:
    """The column where most filled cells pass `test`."""
    width = max((len(r) for r in rows), default=0)
    best, best_share = None, 0.6
    for index in range(width):
        cells = [r[index] for r in rows if index < len(r) and r[index]]
        if not cells:
            continue
        share = sum(1 for c in cells if test(c)) / len(cells)
        if share > best_share:
            best, best_share = index, share
    return best


def read(name: str, data: bytes, site_host: str) -> list[dict]:
    """What each table in the file is, and its rows. A table that is none of the three is refused, saying so."""
    answer = []
    for table in _tables(name, data):
        body = table[1:] if len(table) > 1 else table
        if not body:
            continue
        url_col = _column(body, lambda c: bool(_URL.match(c)))
        numbers = [i for i in range(max(len(r) for r in body)) if i != url_col and _column([[r[i] if i < len(r) else ""] for r in body], lambda c: _number(c) is not None) == 0]
        if url_col is not None:
            mine = sum(1 for r in body if url_col < len(r) and _URL.match(r[url_col]) and store.on_host(host_key(r[url_col]), site_host))
            date_col = _column(body, lambda c: parse_day(c) is not None)
            if mine > len(body) / 2:
                rows = [{"url": r[url_col], "links": _number(r[numbers[0]]) if numbers and numbers[0] < len(r) else None, "sites": _number(r[numbers[1]]) if len(numbers) > 1 and numbers[1] < len(r) else None} for r in body if url_col < len(r) and _URL.match(r[url_col])]
                answer.append({"kind": PAGES, "rows": rows})
            else:
                rows = [{"url": r[url_col], "crawled": parse_day(r[date_col]) if date_col is not None and date_col < len(r) else None} for r in body if url_col < len(r) and _URL.match(r[url_col])]
                answer.append({"kind": LATEST, "rows": rows})
            continue
        domain_col = _column(body, lambda c: bool(_DOMAIN.match(c)))
        if domain_col is not None:
            rows = [{"domain": r[domain_col].lower(), "pages": _number(r[numbers[0]]) if numbers and numbers[0] < len(r) else None, "targets": _number(r[numbers[1]]) if len(numbers) > 1 and numbers[1] < len(r) else None} for r in body if domain_col < len(r) and _DOMAIN.match(r[domain_col])]
            answer.append({"kind": SITES, "rows": rows})
    if not answer:
        raise Refused("Not a Search Console Links export. Open Links, then Export external links, and choose Latest links.")
    return answer


def _note_import(conn, site_id: int, kind: str, name: str, count: int) -> None:
    conn.execute(text("INSERT INTO gsc_link_imports (site_id, kind, file_name, `rows`) VALUES (:s, :k, :f, :n)"), {"s": site_id, "k": kind, "f": (name or "")[:255], "n": count})


def _latest(conn, site_id: int, site_host: str, rows: list[dict]) -> dict:
    known = {}
    for found in conn.execute(text("SELECT id, source_url, status FROM backlinks WHERE site_id = :s"), {"s": site_id}).mappings():
        known.setdefault(service.source_key(found["source_url"]), found)
    added = seen = again = skipped = 0
    here: set[str] = set()
    for row in rows:
        address = row["url"].strip()
        try:
            clean = service._clean_row({"site_id": site_id, "source_url": address, "status": "found"})
        except Refused:
            skipped += 1
            continue
        if store.on_host(host_key(clean["source_url"]), site_host) or clean["key"] in here:
            skipped += 1  # a link from my own site isn't a backlink, and a page twice is one page
            continue
        here.add(clean["key"])
        already = known.get(clean["key"])
        gsc = {"c": row.get("crawled")}
        if already is None:
            conn.execute(
                text("INSERT INTO backlinks (site_id, source_url, domain, status, found_by, gsc_seen, gsc_seen_at, gsc_crawled) VALUES (:s, :u, :d, 'found', :by, 'page', UTC_TIMESTAMP(3), :c)"),
                {"s": site_id, "u": clean["source_url"][:2048], "d": clean["domain"], "by": FOUND_BY, **gsc},
            )
            added += 1
            continue
        conn.execute(
            text("UPDATE backlinks SET gsc_seen = 'page', gsc_seen_at = UTC_TIMESTAMP(3), gsc_crawled = COALESCE(:c, gsc_crawled), found_by = IF(status IN ('found', 'ignored'), COALESCE(found_by, :by), found_by) WHERE id = :i"),
            {"i": already["id"], "by": FOUND_BY, **gsc},
        )
        if already["status"] in service.NOT_LOGGED:
            again += 1
        else:
            seen += 1
    return {"added": added, "seen": seen, "again": again, "skipped": skipped}


def _sites(conn, site_id: int, rows: list[dict]) -> dict:
    conn.execute(text("DELETE FROM gsc_linking_sites WHERE site_id = :s"), {"s": site_id})
    kept: set[str] = set()
    for row in rows:
        domain = cleaner.root_domain(row["domain"]) or row["domain"]
        if not domain or len(domain) > 190 or domain in kept:
            continue
        kept.add(domain)
        conn.execute(text("INSERT INTO gsc_linking_sites (site_id, domain, linking_pages, target_pages) VALUES (:s, :d, :p, :t)"), {"s": site_id, "d": domain, "p": row["pages"], "t": row["targets"]})
    return {"domains": len(kept)}


def _mark_sites_seen(conn, site_id: int) -> int:
    """A logged link whose domain Google lists, but not this exact page."""
    return conn.execute(text(
        "UPDATE backlinks b JOIN gsc_linking_sites g ON g.site_id = b.site_id AND g.domain = b.domain "
        "SET b.gsc_seen = 'site', b.gsc_seen_at = UTC_TIMESTAMP(3) WHERE b.site_id = :s AND (b.gsc_seen IS NULL OR b.gsc_seen = 'site')"
    ), {"s": site_id}).rowcount


def target_hash(url: str) -> str:
    return hashlib.sha256(page_key(url).rstrip("/").encode()).hexdigest()


def _pages(conn, site_id: int, site_host: str, rows: list[dict]) -> dict:
    kept = 0
    for row in rows:
        address = row["url"].strip()[:2048]
        if not store.on_host(host_key(address), site_host):
            continue
        conn.execute(
            text(
                "INSERT INTO gsc_linked_pages (site_id, target_url, target_hash, incoming_links, linking_sites) VALUES (:s, :u, :h, :l, :n) "
                "ON DUPLICATE KEY UPDATE incoming_links = VALUES(incoming_links), linking_sites = VALUES(linking_sites), imported_at = UTC_TIMESTAMP(3)"
            ),
            {"s": site_id, "u": address, "h": target_hash(address), "l": row["links"], "n": row["sites"]},
        )
        kept += 1
    return {"pages": kept}


def import_file(engine: Engine, site_id, name: str, data: bytes) -> dict:
    if type(site_id) is not int:
        raise Refused("Choose the site this export is for.")
    with engine.connect() as conn:
        require_own(conn, site_id)
        site_host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": site_id}).scalar()
    tables = read(name, data, site_host)
    answer = {"kinds": [], "added": 0, "seen": 0, "again": 0, "skipped": 0, "domains": 0, "pages": 0, "site_seen": 0}
    with engine.begin() as conn:
        conn.execute(text("SELECT id FROM sites WHERE id = :s FOR UPDATE"), {"s": site_id})
        for table in tables:
            kind, rows = table["kind"], table["rows"]
            part = _latest(conn, site_id, site_host, rows) if kind == LATEST else _sites(conn, site_id, rows) if kind == SITES else _pages(conn, site_id, site_host, rows)
            for key, value in part.items():
                answer[key] += value
            answer["kinds"].append(kind)
            _note_import(conn, site_id, kind, name, len(rows))
        answer["site_seen"] = _mark_sites_seen(conn, site_id)
    if PAGES in answer["kinds"]:
        from seo.backlinks import reclaim  # the job module imports the worker, which this upload doesn't otherwise need

        reclaim.enqueue(engine, site_id)
    return answer


def last_latest_import(conn, site_id: int) -> datetime | None:
    return conn.execute(text("SELECT MAX(imported_at) FROM gsc_link_imports WHERE site_id = :s AND kind = 'latest'"), {"s": site_id}).scalar()
