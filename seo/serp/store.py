"""Saving what a search engine showed, and reading back the latest of it.

A check is never overwritten. Positions are only ever compared between checks with the same tool,
location and depth, so a change of tool can't look like a ranking move.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from urllib.parse import quote, urlsplit, urlunsplit

import idna
from sqlalchemy import Engine, text

from seo.backlinks.cleaner import root_domain
from seo.links.urls import host_key, normalize_url
from seo.serp.connections import ENGINE_ORDER
from seo.serp.tools import Answer

_SPACE = re.compile(r"\s+")
# Control characters, and the invisible marks a copy and paste brings along. They'd split one keyword into two.
_INVISIBLE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b\u200e\u200f\ufeff]")
_ESCAPE = re.compile(r"%[0-9a-f]{2}", re.IGNORECASE)


def clean_keyword(value: str) -> str:
    """Same keyword whatever the spacing or width of its characters. Case stays as typed for display."""
    return _SPACE.sub(" ", _INVISIBLE.sub("", unicodedata.normalize("NFKC", value or ""))).strip()


def keyword_hash(value: str) -> str:
    return hashlib.sha256(clean_keyword(value).casefold().encode("utf-8")).hexdigest()


@lru_cache(maxsize=4096)
def to_ascii_host(host: str) -> str:
    """Accented hosts have two spellings. Search results are stored in this one, so they can be compared."""
    lowered = (host or "").strip().lower()
    if lowered.isascii():
        return lowered
    try:
        return idna.encode(lowered, uts46=True).decode("ascii")  # the rules browsers and httpx use, so straße is not strasse
    except idna.IDNAError:
        try:
            return lowered.encode("idna").decode("ascii")
        except UnicodeError:
            return lowered


def to_display_host(host: str) -> str:
    if not host or not host.isascii() or "xn--" not in host:
        return host
    try:
        return idna.decode(host)
    except idna.IDNAError:
        return host


def host_and_domain(url: str) -> tuple[str, str]:
    host = to_ascii_host(host_key(url))
    return host, root_domain(host) or host


def site_of(found) -> tuple[str, str]:
    """(host, domain) of a result. One whose link Google hid has no address, only the site it showed under the title."""
    if found.url:
        return host_and_domain(found.url)
    return host_and_domain(f"https://{found.host}/") if getattr(found, "host", "") else ("", "")


def on_host(host: str, site_host: str) -> bool:
    """An address is on a site if it's that host or a subdomain of it, whichever way either is spelled."""
    host, site_host = to_ascii_host(host), to_ascii_host(site_host)
    return bool(site_host) and (host == site_host or host.endswith("." + site_host))


def canonical_url(url: str) -> str:
    """One spelling for one page, whoever gave it: a search tool, a sitemap or a person typing. "" if unusable.

    On top of normalize_url(), an accented host and an accented path both take their ASCII form.
    """
    normal = normalize_url(url)
    if not normal:
        return ""
    parts = urlsplit(normal)
    host = to_ascii_host(parts.hostname or "")
    netloc = f"{host}:{parts.port}" if parts.port else host
    path = _ESCAPE.sub(lambda hit: hit.group(0).upper(), quote(parts.path, safe="/%:@!$&'()*+,;=~-._"))
    return urlunsplit((parts.scheme, netloc, path, parts.query, ""))


def target_id(conn, keyword_id: int, engine_name: str, device: str = "desktop") -> int:
    conn.execute(text("INSERT IGNORE INTO serp_targets (keyword_id, engine, device) VALUES (:k, :e, :d)"), {"k": keyword_id, "e": engine_name, "d": device})
    return conn.execute(text("SELECT id FROM serp_targets WHERE keyword_id = :k AND engine = :e AND device = :d"), {"k": keyword_id, "e": engine_name, "d": device}).scalar_one()


def save_check(engine: Engine, keyword_id: int, engine_name: str, answer: Answer, trigger: str = "refresh", device: str = "desktop", at: str | None = None, status: str = "ok") -> int:
    with engine.begin() as conn:
        target = target_id(conn, keyword_id, engine_name, device)
        check_id = conn.execute(
            text(
                "INSERT INTO serp_checks (target_id, tool, real_location, depth, status, ai_state, trigger_kind, checked_at) "
                "VALUES (:t, :tool, :loc, :depth, :status, :ai, :trig, COALESCE(:at, UTC_TIMESTAMP(3)))"
            ),
            {"t": target, "tool": answer.tool, "loc": answer.real_location, "depth": answer.depth, "status": status, "ai": answer.ai_state, "trig": trigger, "at": at},
        ).lastrowid
        for found in answer.results:
            host, domain = site_of(found)  # a hidden result is saved with its site and an empty address
            if not host:
                continue
            conn.execute(
                text("INSERT INTO serp_results (check_id, position, url, host, domain, title) VALUES (:c, :p, :u, :h, :d, :t)"),
                {"c": check_id, "p": found.position, "u": found.url, "h": host[:190], "d": domain[:190], "t": found.title[:500]},
            )
        for url in answer.ai_citations:
            host, domain = host_and_domain(url)
            if host:
                conn.execute(text("INSERT INTO ai_citations (check_id, url, host, domain) VALUES (:c, :u, :h, :d)"), {"c": check_id, "u": url, "h": host[:190], "d": domain[:190]})
    return check_id


def save_failed_check(engine: Engine, keyword_id: int, engine_name: str, tool: str, error: str, trigger: str = "refresh", device: str = "desktop") -> None:
    with engine.begin() as conn:
        target = target_id(conn, keyword_id, engine_name, device)
        conn.execute(
            text("INSERT INTO serp_checks (target_id, tool, status, trigger_kind, error) VALUES (:t, :tool, 'failed', :trig, :e)"),
            {"t": target, "tool": tool, "trig": trigger, "e": error[:500]},
        )


@dataclass
class Row:
    position: int
    url: str
    host: str
    domain: str
    title: str


@dataclass
class Check:
    id: int
    keyword_id: int
    keyword: str
    country: str
    language: str
    target_id: int
    engine: str
    device: str
    tool: str
    real_location: str
    depth: int
    ai_state: str
    checked_at: object
    results: list[Row] = field(default_factory=list)
    citations: list[Row] = field(default_factory=list)

    def same_kind_as(self, other: "Check") -> bool:
        return (self.target_id, self.tool, self.real_location, self.depth) == (other.target_id, other.tool, other.real_location, other.depth)

    def best_on(self, site_host: str) -> Row | None:
        for row in self.results:  # already in position order
            if on_host(row.host, site_host):
                return row
        return None

    def unnamed_on(self, site_host: str) -> bool:
        """A result on this site whose address Google didn't give: any page of the site may be that one."""
        return any(not row.url and on_host(row.host, site_host) for row in self.results)

    def cites(self, site_host: str) -> bool:
        return any(on_host(row.host, site_host) for row in self.citations)


_CHECK_COLUMNS = (
    "c.id, t.keyword_id, k.keyword, k.country, k.language, c.target_id, t.engine, t.device, c.tool, c.real_location, c.depth, c.ai_state, c.checked_at"
)


def _attach(conn, checks: list[Check]) -> list[Check]:
    by_id = {check.id: check for check in checks}
    ids = list(by_id)
    for start in range(0, len(ids), 500):
        part = ids[start:start + 500]
        marks = ",".join(str(int(i)) for i in part)
        for row in conn.execute(text(f"SELECT check_id, position, url, host, domain, title FROM serp_results WHERE check_id IN ({marks}) ORDER BY check_id, position")).mappings():
            by_id[row["check_id"]].results.append(Row(row["position"], row["url"], row["host"], row["domain"], row["title"] or ""))
        for row in conn.execute(text(f"SELECT check_id, url, host, domain FROM ai_citations WHERE check_id IN ({marks}) ORDER BY id")).mappings():
            by_id[row["check_id"]].citations.append(Row(0, row["url"], row["host"], row["domain"], ""))
    return checks


def latest_checks(engine: Engine, site_id: int, engine_name: str | None = None) -> list[Check]:
    """The newest usable check of each keyword this site tracks, one per engine and device."""
    clause = "AND t.engine = :e" if engine_name else ""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_CHECK_COLUMNS} FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id "
                f"JOIN serp_targets t ON t.keyword_id = k.id {clause} "
                "JOIN serp_checks c ON c.id = (SELECT MAX(c2.id) FROM serp_checks c2 WHERE c2.target_id = t.id AND c2.status = 'ok') "
                "WHERE sk.site_id = :s ORDER BY k.keyword"
            ),
            {"s": site_id, "e": engine_name},
        ).mappings().all()
        return _attach(conn, [Check(**_check_args(r)) for r in rows])


def history(engine: Engine, site_id: int, engine_name: str | None = None, limit: int = 3000) -> list[Check]:
    """Every usable check for this site's keywords, oldest first."""
    clause = "AND t.engine = :e" if engine_name else ""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_CHECK_COLUMNS} FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id "
                f"JOIN serp_targets t ON t.keyword_id = k.id {clause} JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' "
                "WHERE sk.site_id = :s ORDER BY c.id DESC LIMIT :n"
            ),
            {"s": site_id, "e": engine_name, "n": limit},
        ).mappings().all()
        return _attach(conn, [Check(**_check_args(r)) for r in reversed(rows)])


def _keywords_of(site_ids: list[int]) -> str:
    """A subquery, so a keyword two of these sites share still gives each of its checks once."""
    marks = ",".join(str(int(i)) for i in site_ids)
    return f"k.id IN (SELECT keyword_id FROM site_keywords WHERE site_id IN ({marks}))"


def latest_checks_many(engine: Engine, site_ids: list[int]) -> list[Check]:
    """latest_checks for several sites, with each check once."""
    if not site_ids:
        return []
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_CHECK_COLUMNS} FROM keywords k JOIN serp_targets t ON t.keyword_id = k.id "
                "JOIN serp_checks c ON c.id = (SELECT MAX(c2.id) FROM serp_checks c2 WHERE c2.target_id = t.id AND c2.status = 'ok') "
                f"WHERE {_keywords_of(site_ids)} ORDER BY k.keyword"
            )
        ).mappings().all()
        return _attach(conn, [Check(**_check_args(r)) for r in rows])


def history_many(engine: Engine, site_ids: list[int], limit_per_site: int = 3000) -> list[Check]:
    """history for several sites, with each check once, oldest first. Not cut by date: a recent move needs the check before it, however old."""
    if not site_ids:
        return []
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_CHECK_COLUMNS} FROM keywords k JOIN serp_targets t ON t.keyword_id = k.id JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' "
                f"WHERE {_keywords_of(site_ids)} ORDER BY c.id DESC LIMIT :n"
            ),
            {"n": limit_per_site * len(site_ids)},
        ).mappings().all()
        return _attach(conn, [Check(**_check_args(r)) for r in reversed(rows)])


def one_per_keyword(checks: list[Check]) -> list[Check]:
    """A keyword checked on two engines is still one keyword. The first engine in the app's order speaks for it."""
    rank = {name: i for i, name in enumerate(ENGINE_ORDER)}
    best: dict[int, Check] = {}
    for check in checks:
        current = best.get(check.keyword_id)
        if current is None or rank.get(check.engine, len(rank)) < rank.get(current.engine, len(rank)):
            best[check.keyword_id] = check
    return list(best.values())


def _check_args(row) -> dict:
    return {
        "id": row["id"], "keyword_id": row["keyword_id"], "keyword": row["keyword"], "country": row["country"], "language": row["language"],
        "target_id": row["target_id"], "engine": row["engine"], "device": row["device"], "tool": row["tool"],
        "real_location": row["real_location"], "depth": row["depth"], "ai_state": row["ai_state"], "checked_at": row["checked_at"],
    }
