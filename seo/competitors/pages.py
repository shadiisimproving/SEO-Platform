"""Reading one page of a stored site, and everything we can say about it without AI."""
from __future__ import annotations

import gzip
import hashlib
import re
import unicodedata
from functools import lru_cache

from sqlalchemy import Engine, text

from seo.core import budget
from seo.core.errors import Refused
from seo.crawl import store as crawl_store
from seo.crawl.extract import extract
from seo.links import service as links_service
from seo.serp.store import canonical_url, host_and_domain, on_host
from seo.worker import queue
from seo.worker.runner import handler

LANE = "crawl"
JOB_KIND = "pages.read"
# Letters and digits, plus the vowel signs of the Indian scripts, which regular expressions don't count as letters.
_WORD = re.compile("(?:[^\\W_]|[\u0900-\u0963\u0966-\u0dff])+", re.UNICODE)
_JAPANESE_VOICING = ("\u3099", "\u309a")  # they make カ and ガ different letters, unlike an accent
_LIGATURES = str.maketrans({"œ": "oe", "æ": "ae"})
_NO_SPACE_SCRIPT = re.compile("[฀-๿຀-໿ក-៿က-႟぀-ヿ㐀-䶿一-鿿豈-﫿]")


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def fold(value: str) -> str:
    """Compare text as people read it: case, accents and Arabic vowel marks don't matter."""
    decomposed = unicodedata.normalize("NFKD", value or "")
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch) or ch in _JAPANESE_VOICING)
    return stripped.casefold().translate(_LIGATURES)


def words_of(value: str) -> list[str]:
    return _WORD.findall(fold(value))


def has_no_spaces(value: str) -> bool:
    return bool(_NO_SPACE_SCRIPT.search(value))


@lru_cache(maxsize=16)
def _searchable(haystack: str) -> tuple[str, str]:
    """A page's text in the two forms a phrase is looked for in. A pair page asks this once per keyword, so it's kept."""
    return f" {' '.join(words_of(haystack))} ", "".join(fold(haystack).split())


def contains_phrase(haystack: str, phrase: str) -> bool:
    folded = fold(phrase)
    if has_no_spaces(folded):  # these scripts have no spaces to match on
        return "".join(folded.split()) in _searchable(haystack)[1]
    needle = " ".join(words_of(phrase))
    return bool(needle) and f" {needle} " in _searchable(haystack)[0]


def clean_page_url(url: str, site_host: str) -> str:
    if not isinstance(url, str):
        raise Refused("That doesn't look like a web address.")
    normal = canonical_url(url if "://" in url else f"https://{url}")
    if not normal:
        raise Refused("That doesn't look like a web address.")
    if not on_host(host_and_domain(normal)[0], site_host):
        raise Refused(f"That page isn't on {site_host}.")
    return normal


def queue_read(engine: Engine, site_id: int, url: str) -> None:
    queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": site_id, "url": url}, dedupe_key=f"page:{url_hash(url)[:40]}", max_attempts=2)


def read_page(engine: Engine, url: str, host: str, fetcher) -> str:
    """Goes through the polite fetcher, so robots.txt, spacing and the address guard all apply."""
    domain_id = crawl_store.get_or_create_domain(engine, host)
    etag, last_modified = crawl_store.validators(engine, url)
    before = fetcher.requests
    # A redirect to another site isn't followed: what's saved under this address must be this site's own page.
    result = fetcher.get(url, etag=etag, last_modified=last_modified, stay_on=lambda address: on_host(host_and_domain(address)[0], host))
    budget.charge(engine, fetcher.requests - before)
    fields = None
    if result.status == "ok" and result.body is not None:
        fields = extract(result.body, result.final_url or url, charset=result.charset)
    return crawl_store.save_fetch(engine, domain_id, url, result, fields)


@handler(JOB_KIND)
def run_read(job, engine: Engine) -> None:
    payload = job.payload or {}
    with engine.connect() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :i"), {"i": payload.get("site_id")}).scalar()
    url = payload.get("url") or ""
    if not host or not on_host(host_and_domain(url)[0], host) or not budget.has_room(engine):
        return  # only ever reads a page of a stored site, and only inside the daily budget
    fetcher = links_service.fetcher_factory()
    try:
        read_page(engine, url, host, fetcher)
    finally:
        fetcher.close()


def load(conn, url: str) -> dict | None:
    row = conn.execute(text("SELECT * FROM pages WHERE url_hash = :h"), {"h": url_hash(url)}).mappings().first()
    return dict(row) if row else None


def page_text(conn, page_id: int) -> str:
    blob = conn.execute(text("SELECT text_gz FROM page_versions WHERE page_id = :p ORDER BY id DESC LIMIT 1"), {"p": page_id}).scalar()
    return gzip.decompress(blob).decode("utf-8", "replace") if blob else ""
