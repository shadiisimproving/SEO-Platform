"""A website's icon, so a long list of links is easy to tell apart.

Our own server fetches it once and keeps a copy. A service like Google's would be simpler, but it would tell someone
else every domain on the list, and the screens load nothing from outside. It goes through the polite fetcher, so
robots.txt, spacing and the address guard all apply. A site with no icon, or that says no, simply shows its first letter.
"""
from __future__ import annotations

import base64
import re
import time
from urllib.parse import urljoin

from lxml import etree, html as lxml_html
from sqlalchemy import Engine, text

from seo.core import budget
from seo.links import service as links_service
from seo.serp.store import to_ascii_host
from seo.worker import queue
from seo.worker.runner import handler

JOB_KIND = "logos.fetch"
LANE = "crawl"
CHUNK_SECONDS = 40.0
MAX_BYTES = 200_000
RETRY_DAYS = 30  # a site with no icon today may have one later
_DOMAIN = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")
_SIZE = re.compile(r"(\d+)x\d+")


def image_type(data: bytes) -> str | None:
    """What the bytes really are. What a server says, and what an address ends in, can both be wrong."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"\x00\x00\x01\x00"):
        return "image/x-icon"
    if b"<svg" in data[:1000].lower() and b"<html" not in data[:1000].lower():
        return "image/svg+xml"
    return None


def icon_addresses(body: bytes, page_url: str) -> list[str]:
    """Icons a page names, the clearest first, then the usual address."""
    found: list[tuple[int, str]] = []
    try:
        doc = lxml_html.document_fromstring(body)
    except (ValueError, TypeError, etree.ParserError):
        doc = None
    if doc is not None:
        for link in doc.iterfind(".//link[@rel]"):
            rel = (link.get("rel") or "").lower().split()
            href = (link.get("href") or "").strip()
            if not href or not ({"icon", "apple-touch-icon", "apple-touch-icon-precomposed"} & set(rel)):
                continue
            sizes = (link.get("sizes") or "").lower()
            size = max((int(n) for n in _SIZE.findall(sizes)), default=0)
            if sizes == "any" or href.lower().endswith(".svg"):
                size = max(size, 512)  # it scales to any size
            found.append((size or (180 if "apple-touch-icon" in rel else 32), href if href.startswith("data:") else urljoin(page_url, href)))
    found.sort(key=lambda item: -item[0])
    return list(dict.fromkeys([url for _, url in found] + [urljoin(page_url, "/favicon.ico")]))


def _from_data_address(address: str) -> bytes | None:
    head, _, payload = address.partition(",")
    if ";base64" not in head or len(payload) > MAX_BYTES * 2:
        return None
    try:
        return base64.b64decode(payload, validate=False)
    except ValueError:
        return None


def _usable(data: bytes | None) -> str | None:
    return image_type(data) if data and len(data) <= MAX_BYTES else None


def fetch_for(engine: Engine, domain: str, fetcher, charge) -> str:
    """Finds and keeps one site's icon. Returns found or none."""
    def counted(url: str, **options):
        before = fetcher.requests
        result = fetcher.get(url, **options)
        charge(fetcher.requests - before)
        return result

    start = f"https://{domain}/"
    home = counted(start)
    if home.status == "network_error":
        home = counted(f"https://www.{domain}/")
    keep = None
    if home.status == "ok" and home.body is not None:
        for address in icon_addresses(home.body, home.final_url or start):
            if address.startswith("data:"):
                data = _from_data_address(address)
            else:
                answer = counted(address, any_type=True)
                data = answer.body if answer.status == "ok" else None
            kind = _usable(data)
            if kind:
                keep = (data, kind, address[:1000] if not address.startswith("data:") else None)
                break
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE site_logos SET status = :st, image = :i, content_type = :c, source_url = :u, checked_at = UTC_TIMESTAMP(3) WHERE domain = :d"),
            {"st": "found" if keep else "none", "i": keep[0] if keep else None, "c": keep[1] if keep else None, "u": keep[2] if keep else None, "d": domain},
        )
    return "found" if keep else "none"


def queue_for(engine: Engine, domains) -> None:
    """Ask for these sites' icons. One already kept, or looked for recently, isn't asked for again. Never holds anything up."""
    # An accented domain is stored in its ASCII spelling, the one every server answers to.
    ascii_names = {to_ascii_host(d.strip()) for d in domains if isinstance(d, str)}
    clean = sorted(d for d in ascii_names if _DOMAIN.match(d))
    if not clean:
        return
    with engine.begin() as conn:
        for domain in clean:
            conn.execute(
                text(
                    "INSERT INTO site_logos (domain, status) VALUES (:d, 'pending') ON DUPLICATE KEY UPDATE "
                    f"status = IF(status = 'none' AND checked_at < UTC_TIMESTAMP(3) - INTERVAL {RETRY_DAYS} DAY, 'pending', status)"
                ),
                {"d": domain[:190]},
            )
    _queue_job(engine)


def queue_missing(engine: Engine, domains) -> None:
    """Like queue_for, for a long list shown on screen: only the sites never asked about are written, so opening a list costs one read."""
    wanted = {to_ascii_host(d.strip()) for d in domains if isinstance(d, str) and d.strip()}
    wanted = {d for d in wanted if _DOMAIN.match(d)}
    if not wanted:
        return
    with engine.connect() as conn:
        asked = {row[0] for row in conn.execute(text("SELECT domain FROM site_logos"))}
    fresh = wanted - asked
    if fresh:
        queue_for(engine, fresh)


def _queue_job(engine: Engine, part: int = 0) -> None:
    with engine.connect() as conn:
        if conn.execute(text("SELECT 1 FROM site_logos WHERE status = 'pending' LIMIT 1")).first():
            queue.enqueue(engine, LANE, JOB_KIND, payload={"part": part}, dedupe_key=f"logos:{part}", max_attempts=2)


@handler(JOB_KIND)
def run_fetch(job, engine: Engine) -> None:
    part = (job.payload or {}).get("part", 0)
    started = time.monotonic()
    fetcher = links_service.fetcher_factory()
    done_one = False
    try:
        while (not done_one or time.monotonic() - started < CHUNK_SECONDS) and budget.has_room(engine):
            with engine.connect() as conn:
                domain = conn.execute(text("SELECT domain FROM site_logos WHERE status = 'pending' ORDER BY domain LIMIT 1")).scalar()
            if domain is None:
                return
            fetch_for(engine, domain, fetcher, lambda n: budget.charge(engine, n))
            done_one = True
    finally:
        fetcher.close()
    if budget.has_room(engine):
        _queue_job(engine, part + 1)


def known(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        return [row[0] for row in conn.execute(text("SELECT domain FROM site_logos WHERE status = 'found' ORDER BY domain"))]


def image_of(engine: Engine, domain: str) -> tuple[bytes, str] | None:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT image, content_type FROM site_logos WHERE domain = :d AND status = 'found'"), {"d": domain}).first()
    return (bytes(row[0]), row[1]) if row else None
