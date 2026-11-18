"""Saving what a search engine showed, and reading back the latest of it.

A check is never overwritten. Positions are only ever compared between checks with the same tool,
location and depth, so a change of tool can't look like a ranking move.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
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


_LIGATURES = str.maketrans({"œ": "oe", "æ": "ae"})


def _latin_bare(ch: str) -> str:
    """A Latin letter without its accent (é → e). Other scripts keep their marks: in Japanese or Hindi they change the word."""
    if ch.isascii() or not ("\u00c0" <= ch <= "\u024f" or "\u1e00" <= ch <= "\u1eff"):
        return ch
    return "".join(part for part in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(part))


def keyword_key(value: str) -> str:
    """For matching only: cleaned, any case, any Latin accent ("Café en grains" = "cafe en grains" = "CAFÉ EN GRAINS").
    Never the keyword's identity: Google ranks "créer société dubai" and "creer societe dubai" differently (live checks,
    2026-11-17), so each spelling the owner tracks stays its own keyword with its own history (keyword_hash)."""
    folded = unicodedata.normalize("NFC", clean_keyword(value).casefold())
    return "".join(_latin_bare(ch) for ch in folded).translate(_LIGATURES)


def shared_keys(tracked_words) -> frozenset:
    """The matching keys (keyword_key) that a site tracks under two or more spellings, such as "café" and "cafe"."""
    spellings: dict[str, set] = {}
    for words in tracked_words:
        spellings.setdefault(keyword_key(words), set()).add(clean_keyword(words).casefold())
    return frozenset(key for key, seen in spellings.items() if len(seen) > 1)


def match_key(value: str, shared=frozenset()) -> tuple:
    """Which tracked keyword a search engine's query counts for. A keyword tracked under one spelling gets every spelling
    of it (French searchers mostly drop accents), so their numbers add up. When the owner tracks two spellings, each one
    gets only its own exact query (any case), so nothing is counted twice."""
    folded = keyword_key(value)
    return ("exact", clean_keyword(value).casefold()) if folded in shared else ("any", folded)


def keyword_hash(value: str) -> str:
    """A keyword's identity: its exact cleaned text, any case. Accents count (see keyword_key)."""
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


def shown_another_query(keyword: str, shown: str) -> bool:
    """Whether the results page showed a query other than the keyword. Case, spacing and Latin accents don't count: Google
    writing "créer société dubaï" for "creer societe dubai" is the same search."""
    return bool(shown) and keyword_key(shown) != keyword_key(keyword)


def another_query_reason(tool: str, shown: str) -> str:
    return f"{tool}'s page showed results for \u201c{shown[:120]}\u201d, not for this keyword."


def save_check(engine: Engine, keyword_id: int, engine_name: str, answer: Answer, trigger: str = "refresh", device: str = "desktop", at: str | None = None, status: str = "ok", reason: str | None = None) -> int:
    """Saves one check. One whose page showed another query is kept as suspect, with why. Then the cross-tool rule
    (cross_check) looks at this check beside the other tools' checks of the same keyword."""
    shown = getattr(answer, "query_shown", "") or ""
    asked = getattr(answer, "asked", None) or None
    with engine.begin() as conn:
        target = target_id(conn, keyword_id, engine_name, device)
        if status == "ok" and shown:
            words = conn.execute(text("SELECT keyword FROM keywords WHERE id = :k"), {"k": keyword_id}).scalar() or ""
            if shown_another_query(words, shown):
                status, reason = "suspect", another_query_reason(answer.tool, shown)
        check_id = conn.execute(
            text(
                "INSERT INTO serp_checks (target_id, tool, real_location, depth, status, ai_state, trigger_kind, error, asked, query_shown, checked_at) "
                "VALUES (:t, :tool, :loc, :depth, :status, :ai, :trig, :why, :asked, :shown, COALESCE(:at, UTC_TIMESTAMP(3)))"
            ),
            {"t": target, "tool": answer.tool, "loc": answer.real_location, "depth": answer.depth, "status": status, "ai": answer.ai_state, "trig": trigger, "at": at,
             "why": reason[:500] if reason else None, "asked": json.dumps(asked, ensure_ascii=False) if asked else None, "shown": shown[:300] or None},
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
        if status == "ok":
            cross_check(conn, target, check_id)
    return check_id


# ---- the cross-tool rule ---------------------------------------------------------------------------------------------
# Two tools searching the same keyword from the same place within two days see mostly the same sites in the top 10. On the
# live data (2026-11-17) honest pairs shared 4 to 9 of 10; SerpApi's wrong answers shared 0 to 3 (most often the same two
# sites every Dubai company search shows). Fewer than 2 caught almost none of them, so the line is 4.
CROSS_HOURS = 48
AGREE_SITES = 4  # top-10 sites two checks must share to agree
MIN_SITES = 5  # a check with fewer sites in its top 10 says too little to judge, or to judge by


@dataclass
class _Judged:
    id: int
    target: int
    tool: str
    location: str
    at: datetime
    sites: set


def _agree(one: "_Judged", other: "_Judged") -> bool:
    return len(one.sites & other.sites) >= AGREE_SITES


def _apart(one: "_Judged", other: "_Judged") -> float:
    return abs((one.at - other.at).total_seconds()) / 3600


def _near(one: "_Judged", other: "_Judged") -> bool:
    return one.id != other.id and one.location == other.location and _apart(one, other) <= CROSS_HOURS


OWN_BACKING_HOURS = 12  # a tool backs its own answer only from another run: two searches of one batch can share one glitch


def odd_one_out(check: "_Judged", pool: list) -> "_Judged | None":
    """The other tool's check that shows this one is wrong, or None.

    A check is wrong when it agrees with no other tool's check of the keyword (or of the same keyword spelt with other
    accents) from the same place within CROSS_HOURS, its own tool doesn't back it from another run, and a check it
    disagrees with is backed by a third one. Two tools that only disagree with each other prove nothing: neither is marked."""
    if len(check.sites) < MIN_SITES:
        return None
    near = [other for other in pool if _near(check, other) and len(other.sites) >= MIN_SITES]
    others = [other for other in near if other.tool != check.tool]
    if not others or any(_agree(check, other) for other in others):
        return None
    if any(_agree(check, same) for same in near if same.tool == check.tool and _apart(check, same) >= OWN_BACKING_HOURS):
        return None
    for other in others:
        third = [x for x in pool if _near(other, x) and x.id != check.id and x.tool != check.tool and len(x.sites) >= MIN_SITES and _backs(other, x)]
        if any(_agree(other, x) for x in third):
            return other
    return None


def _backs(other: "_Judged", x: "_Judged") -> bool:
    """Whether x can vouch for `other`: another tool, or the same tool from another run (OWN_BACKING_HOURS apart). A
    search of the same keyword spelt with other accents by the same tool never does, even later: it is the same tool
    reading the same page twice, and one glitch can be in both (code review 2026-11-18, #10)."""
    if x.tool != other.tool:
        return True
    return x.target == other.target and _apart(other, x) >= OWN_BACKING_HOURS


def cross_reason(other_tool: str, other_at) -> str:
    day = other_at.strftime("%Y-%m-%d") if hasattr(other_at, "strftime") else str(other_at)[:10]
    return f"Shares fewer than {AGREE_SITES} of its top 10 sites with {other_tool}'s check of {day}, which another check backs."


# Marks this rule and save_check write: a check they marked is never a witness for another.
_NOT_WITNESS = ("Shares fewer than ", "'s page showed results for ")


def _twin_targets(conn, target: int) -> list[int]:
    """This target and those of the same keyword spelt with other accents or case, same engine, device, country, language."""
    me = conn.execute(text(
        "SELECT k.keyword, k.country, k.language, t.engine, t.device FROM serp_targets t JOIN keywords k ON k.id = t.keyword_id WHERE t.id = :t"
    ), {"t": target}).mappings().first()
    if me is None:
        return [target]
    rows = conn.execute(text(
        "SELECT t.id, k.keyword FROM serp_targets t JOIN keywords k ON k.id = t.keyword_id "
        "WHERE k.keyword = :w AND k.country = :c AND k.language = :l AND t.engine = :e AND t.device = :d"  # the collation folds accents
    ), {"w": me["keyword"], "c": me["country"], "l": me["language"], "e": me["engine"], "d": me["device"]}).all()
    key = keyword_key(me["keyword"])
    return sorted({target, *(row[0] for row in rows if keyword_key(row[1]) == key)})


def _pool(conn, targets: list[int], start=None, end=None) -> list:
    """The witnesses: checks that read a page, whatever else made some of them suspect (Google hiding addresses still shows
    the sites), but never one this rule or another query marked. Google's own redirects aren't a site."""
    where = "AND c.checked_at BETWEEN :a AND :b" if start is not None else ""
    marks = ",".join(str(int(t)) for t in targets)
    checks = [
        row for row in conn.execute(text(
            f"SELECT id, target_id, tool, real_location, checked_at, error FROM serp_checks c WHERE target_id IN ({marks}) AND status IN ('ok', 'suspect') {where} ORDER BY id"
        ), {"a": start, "b": end}).all()
        if not any(mark in (row[5] or "") for mark in _NOT_WITNESS)
    ]
    if not checks:
        return []
    ids = ",".join(str(int(row[0])) for row in checks)
    sites: dict[int, set] = {row[0]: set() for row in checks}
    for check_id, domain in conn.execute(text(f"SELECT check_id, domain FROM serp_results WHERE check_id IN ({ids}) AND position <= 10")).all():
        if domain and not domain.startswith("google."):
            sites[check_id].add(domain)
    return [_Judged(row[0], row[1], row[2], row[3] or "", row[4], sites[row[0]]) for row in checks]


_CROSS_WHY = re.compile(r"^Shares fewer than (?P<n>\d+) of its top 10 sites with (?P<tool>.+?)'s check of (?P<day>\d{4}-\d{2}-\d{2}), which another check backs\.$")
_QUERY_WHY = re.compile(r"^(?P<tool>.+?)'s page showed results for \u201c(?P<query>.*)\u201d, not for this keyword\.$", re.DOTALL)


def suspect_why(error: str | None) -> dict | None:
    """Why a check is suspect, for the screen to say in the reader's language: the cross-tool rule or another query.
    Other reasons (older marks) give None: the screen then says "Suspect result" alone."""
    hit = _CROSS_WHY.match(error or "")
    if hit:
        return {"kind": "cross", "tool": hit["tool"], "day": hit["day"], "sites": int(hit["n"])}
    hit = _QUERY_WHY.match(error or "")
    if hit:
        return {"kind": "query", "tool": hit["tool"], "query": hit["query"]}
    return None


def judge_target(conn, target: int, around_id: int | None = None, apply: bool = True, marked_before: set | None = None) -> list[tuple[int, str]]:
    """Marks the "ok" checks of one target (and its accent twins) the cross-tool rule finds wrong: suspect, with why (shown greyed on the panel).
    With around_id, only the checks a new check can change: those within CROSS_HOURS of it. Never un-marks. Returns (id, why).
    marked_before: ids a dry run already found, so they count as marked without being written."""
    twins = _twin_targets(conn, target)
    marks = ",".join(str(int(t)) for t in twins)
    oks = {row[0] for row in conn.execute(text(f"SELECT id FROM serp_checks WHERE target_id IN ({marks}) AND status = 'ok'")).all()}
    if around_id is not None:
        at = conn.execute(text("SELECT checked_at FROM serp_checks WHERE id = :i"), {"i": around_id}).scalar()
        if at is None:
            return []
        span = timedelta(hours=3 * CROSS_HOURS)
        pool = _pool(conn, twins, at - span, at + span)
        judged = [c for c in pool if c.id in oks and abs((c.at - at).total_seconds()) <= CROSS_HOURS * 3600]
    else:
        pool = _pool(conn, twins)
        judged = [c for c in pool if c.id in oks]
    if marked_before:
        pool = [c for c in pool if c.id not in marked_before]
        judged = [c for c in judged if c.id not in marked_before]
    marked = []
    for check in judged:
        other = odd_one_out(check, pool)
        if other is None:
            continue
        why = cross_reason(other.tool, other.at)
        marked.append((check.id, why))
        pool = [c for c in pool if c.id != check.id]  # a check marked wrong backs nothing
        if apply:
            conn.execute(text("UPDATE serp_checks SET status = 'suspect', error = :w WHERE id = :i AND status = 'ok'"), {"w": why, "i": check.id})
    return marked


def cross_check(conn, target: int, check_id: int) -> list[tuple[int, str]]:
    return judge_target(conn, target, around_id=check_id)


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


MAIN_MAX_AGE_DAYS = 14  # like MIX_FRESH_DAYS: past this, the main tool's result gives way to a newer one from another tool


def pick_main(candidates: list, main: str, now, *, tool, ident, at):
    """Which tool's newest result speaks for a keyword: (chosen, passed_over). The one rule for Keywords and every other
    screen (Competitors, pairs, AI Overviews read store.latest_checks, which calls this too).

    `candidates` holds one usable result per tool: never a suspect one, never one from another place.
    - A main tool set (owner's rule, 2026-11-13): its result, unless it is older than MAIN_MAX_AGE_DAYS and another tool has a
      newer one (2026-11-17): then the newest of those, and passed_over is the main tool's old result, so the screen can say
      "Bright Data's check is 120 days old".
    - No main tool, or none from it: the newest result, whatever its tool. A tool's place in the order says which tool a
      Refresh tries first, not whose answer is right (2026-11-18: SerpApi won by its place over newer, agreeing checks).
    """
    if not candidates:
        return None, None
    newest = max(candidates, key=lambda c: (at(c), ident(c)))
    first = next((c for c in candidates if main and tool(c) == main), None)
    if first is None:
        return newest, None
    if now is None or (now - at(first)).total_seconds() <= MAIN_MAX_AGE_DAYS * 86400:
        return first, None
    newer = [c for c in candidates if c is not first and at(c) > at(first)]
    if not newer:
        return first, None
    return max(newer, key=lambda c: (at(c), ident(c))), first


def _by_main_tool(engine: Engine, checks: list[Check]) -> list[Check]:
    """One check per target, by pick_main, from each tool's newest check that can fill the keyword's row (the keyword's own
    country): exactly what Keywords shows."""
    from seo.serp.connections import main_tool
    from seo.serp.tools import counts_for_keyword

    main = main_tool(engine)
    by_target: dict[int, dict[str, Check]] = {}
    for check in sorted(checks, key=lambda c: c.id):
        if counts_for_keyword(check.engine, check.country, check.real_location, check.language):
            by_target.setdefault(check.target_id, {})[check.tool] = check  # the newest per tool wins
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # every session is UTC, and checked_at is stored in UTC
    best: dict[int, Check] = {}
    for target_id, per_tool in by_target.items():
        best[target_id], _ = pick_main(list(per_tool.values()), main, now, tool=lambda c: c.tool, ident=lambda c: c.id, at=lambda c: c.checked_at)
    return [check for check in checks if best.get(check.target_id) is check]


# The newest usable check of each tool and place (so a check from another country never hides the one that counts).
_NEWEST_PER_TOOL = (
    "c.id = (SELECT MAX(c2.id) FROM serp_checks c2 WHERE c2.target_id = t.id AND c2.tool = c.tool AND c2.real_location = c.real_location AND c2.status = 'ok')"
)


def latest_checks(engine: Engine, site_id: int, engine_name: str | None = None) -> list[Check]:
    """The usable check of each keyword this site tracks, one per engine and device, from the main tool when it has one."""
    clause = "AND t.engine = :e" if engine_name else ""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_CHECK_COLUMNS} FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id "
                f"JOIN serp_targets t ON t.keyword_id = k.id {clause} "
                "JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' AND " + _NEWEST_PER_TOOL + " "
                "WHERE sk.site_id = :s ORDER BY k.keyword"
            ),
            {"s": site_id, "e": engine_name},
        ).mappings().all()
        return _attach(conn, _by_main_tool(engine, [Check(**_check_args(r)) for r in rows]))


def latest_ai_checks(engine: Engine, site_id: int) -> list[Check]:
    """Per keyword, the newest usable Google check that really looked for an AI Overview (ai_state present or absent), from
    the keyword's own country. Tools that can't see AI Overviews (Searlo, HasData, Bright Data) never answer here, so a newer
    check from one of them can't turn a seen overview into "not captured" (analytics review W4)."""
    from seo.serp.tools import counts_for_keyword

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_CHECK_COLUMNS} FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id "
                "JOIN serp_targets t ON t.keyword_id = k.id AND t.engine = 'google' AND t.device = 'desktop' "
                "JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' AND c.ai_state <> 'not_captured' "
                "WHERE sk.site_id = :s ORDER BY c.id"
            ),
            {"s": site_id},
        ).mappings().all()
        newest: dict[int, Check] = {}
        for row in rows:
            check = Check(**_check_args(row))
            if counts_for_keyword(check.engine, check.country, check.real_location, check.language):
                newest[check.keyword_id] = check
        return _attach(conn, list(newest.values()))


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
                "JOIN serp_checks c ON c.target_id = t.id AND c.status = 'ok' AND " + _NEWEST_PER_TOOL + " "
                f"WHERE {_keywords_of(site_ids)} ORDER BY k.keyword"
            )
        ).mappings().all()
        return _attach(conn, _by_main_tool(engine, [Check(**_check_args(r)) for r in rows]))


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
