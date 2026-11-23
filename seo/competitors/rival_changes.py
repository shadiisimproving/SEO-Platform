"""Who passed me and what they changed.

When a page-1 ranking moves (an insights finding, rival_passed or rank_drop, with my place before or now in the top 10 of the
latest Google check), the followed competitors' pages now above mine are read again and compared with an earlier copy:

1. Now: read with the polite reader (pages.read_page), charged to the crawl budget. A page already read today isn't read again.
2. Earlier: the newest copy we stored before my drop (the previous check, or the finding's "since" day). Otherwise the Wayback
   Machine's copy closest before that day, kept in memory only. Otherwise none, and the card says what they have now.
3. What changed, field by field (seo/crawl/diff.py), with my ranking page's facts beside it.

Limits: at most 5 rival pages per finding and 30 reads per site per day; competitors set to Off are never read; the Wayback
Machine is asked at most once per page and day. Sites above me that aren't followed competitors are listed, never read.

Their page text is someone else's words: it's stored as data, shown escaped, and given to AI only inside the facts.

Entry points: enqueue_for_site() after an insights run, the job handler, and for_finding() for the finding's panel.
"""
from __future__ import annotations

import gzip
import json
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import Engine, text

from seo.accounts import access
from seo.competitors import history, pages
from seo.competitors.tracking import PAGES_SQL
from seo.core import budget
from seo.core.errors import NotFound
from seo.crawl import diff
from seo.serp import store
from seo.worker import queue
from seo.worker.runner import RunAgain, handler

JOB_KIND = "rival_changes"
LANE = "crawl"  # it reads pages, like every other page read
KINDS = frozenset({"rival_passed", "rank_drop"})
TOP = 10  # page 1: my place before or now
PER_FINDING = 5
READS_PER_DAY = 30
RUN_SECONDS = 120  # then the same job carries on after the lane's other work
NO_CHECK_DAYS = 28  # no previous check and no "since": the earlier copy is looked for this long before the check
ROWS_SHOWN = 6


def _dedupe(site_id: int) -> str:
    return f"rival_changes:{site_id}"


def enqueue_for_site(engine: Engine, site_id: int) -> int | None:
    """Queue one look for this site's findings. Safe to call after every insights run: one job per site at a time."""
    return queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": int(site_id)}, dedupe_key=_dedupe(site_id), max_attempts=2)


# ---- reading a finding --------------------------------------------------------------------------


def _evidence(row) -> dict:
    value = row["evidence"]
    return value if isinstance(value, dict) else json.loads(value or "{}")


def applies(kind: str, evidence: dict) -> bool:
    """A page-1 ranking that moved: my place before or now in the top 10."""
    if kind not in KINDS:
        return False
    return any(isinstance(p, int) and p <= TOP for p in (evidence.get("was"), evidence.get("scraped")))


def _stamp(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "").replace(" ", "T"))
    except ValueError:
        return None


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if isinstance(value, datetime) else None


def wanted_before(evidence: dict) -> datetime | None:
    """The moment the earlier copy must come from: the finding's "since" day, else the previous check, else 28 days before this check."""
    since = evidence.get("since")
    if isinstance(since, str):
        try:
            return datetime.combine(date.fromisoformat(since[:10]), datetime.min.time())
        except ValueError:
            pass
    before = _stamp(evidence.get("before_checked"))
    if before is not None:
        return before
    checked = _stamp(evidence.get("checked"))
    return checked - timedelta(days=NO_CHECK_DAYS) if checked else None


def _competitors(conn, site_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute(
        text("SELECT c.id, c.host, sc.tracking FROM site_competitors sc JOIN sites c ON c.id = sc.competitor_id WHERE sc.site_id = :s"), {"s": site_id}
    ).mappings().all()]


def _above(evidence: dict, my_host: str) -> list[dict]:
    """Results above my page. A finding saved before "above" existed falls back on its results, without earlier places."""
    if isinstance(evidence.get("above"), list):
        return [r for r in evidence["above"] if isinstance(r, dict) and r.get("url")]
    mine = evidence.get("scraped")
    mine = mine if isinstance(mine, int) else (evidence.get("depth") or TOP) + 1
    return [
        {"position": r["position"], "url": r["url"], "host": r.get("host") or "", "before": None}
        for r in evidence.get("results") or [] if isinstance(r, dict) and r.get("url") and r.get("position", 99) < mine and not store.on_host(r.get("host") or "", my_host)
    ]


@dataclass
class Sides:
    targets: list[dict] = field(default_factory=list)  # followed (On or Pages only), to read, best first
    not_followed: list[dict] = field(default_factory=list)  # listed only, never read: not a competitor, or one set to Off


def sides(conn, site_id: int, my_host: str, evidence: dict) -> Sides:
    competitors = _competitors(conn, site_id)
    was = evidence.get("was")
    out, seen = Sides(), set()
    for row in sorted(_above(evidence, my_host), key=lambda r: r["position"]):
        url = store.canonical_url(row["url"]) or row["url"]
        if url in seen:
            continue
        seen.add(url)
        host = row.get("host") or store.host_and_domain(url)[0]
        rival = next((c for c in competitors if store.on_host(host, c["host"])), None)
        before = row.get("before")
        item = {"host": host, "url": url, "position": {"before": before, "now": row["position"]}, "competitor_id": rival["id"] if rival else None, "tracking": rival["tracking"] if rival else None}
        if rival is None or rival["tracking"] == "off":
            out.not_followed.append(item)
            continue
        item["rival_host"] = rival["host"]
        item["passed"] = isinstance(was, int) and (before is None or before > was)
        out.targets.append(item)
    out.targets.sort(key=lambda t: (not t["passed"], t["position"]["now"]))  # the ones that passed me first
    out.targets = out.targets[:PER_FINDING]
    return out


# ---- the job ------------------------------------------------------------------------------------


@dataclass
class _Run:
    engine: Engine
    site_id: int
    host: str
    left: int
    started: float = field(default_factory=time.monotonic)
    fetcher: object = None
    asked: dict = field(default_factory=dict)  # (url hash, day) → a Wayback answer already had in this run
    mine: dict = field(default_factory=dict)  # my url → my page's facts

    def get_fetcher(self):
        if self.fetcher is None:
            from seo.links import service as links_service

            self.fetcher = links_service.fetcher_factory()
        return self.fetcher

    def can_read(self) -> bool:
        return self.left > 0 and budget.has_room(self.engine)


def reads_today(conn, site_id: int) -> int:
    return int(conn.execute(
        text("SELECT COALESCE(SUM(read_count), 0) FROM rival_page_changes WHERE site_id = :s AND read_at >= UTC_DATE()"), {"s": site_id}
    ).scalar() or 0)


def _page(conn, url: str) -> dict | None:
    row = conn.execute(
        text("SELECT *, (last_checked_at >= UTC_DATE()) AS read_today FROM pages WHERE url_hash = :h"), {"h": pages.url_hash(url)}
    ).mappings().first()
    if row is None:
        return None
    page = dict(row)
    for name in _JSON_COLUMNS:  # a plain SELECT gives JSON columns back as text
        if isinstance(page.get(name), str):
            try:
                page[name] = json.loads(page[name])
            except ValueError:
                page[name] = None
    return page


_JSON_COLUMNS = ("h1", "headings", "schema_types", "extras")


def _read(run: _Run, url: str, host: str) -> tuple[dict | None, int]:
    """The stored page, read first unless it was read today. Returns (page, reads spent)."""
    with run.engine.connect() as conn:
        page = _page(conn, url)
    if page is not None and page["read_today"]:
        return page, 0
    if not run.can_read():
        return page, -1  # no read left today: the page waits
    pages.read_page(run.engine, url, host, run.get_fetcher())
    run.left -= 1
    with run.engine.connect() as conn:
        return _page(conn, url), 1


def _text(conn, page_id: int) -> str:
    return pages.page_text(conn, page_id)


def _my_facts(run: _Run, my_url: str | None) -> tuple[dict | None, int]:
    if not my_url:
        return None, 0
    if my_url in run.mine:
        return run.mine[my_url], 0
    page, spent = _read(run, my_url, run.host)
    facts = None
    if page is not None and page.get("content_hash"):
        with run.engine.connect() as conn:
            facts = diff.facts(page, _text(conn, page["id"]))
    run.mine[my_url] = facts
    return facts, max(spent, 0)


def _stored_before(conn, page_id: int, before: datetime) -> dict | None:
    row = conn.execute(
        text("SELECT id, taken_at, fields, text_gz FROM page_versions WHERE page_id = :p AND taken_at < :t ORDER BY taken_at DESC, id DESC LIMIT 1"),
        {"p": page_id, "t": before},
    ).mappings().first()
    if row is None:
        return None
    fields = row["fields"] if isinstance(row["fields"], dict) else json.loads(row["fields"] or "{}")
    return {"at": row["taken_at"], "fields": fields, "text": gzip.decompress(row["text_gz"]).decode("utf-8", "replace") if row["text_gz"] else ""}


def _wayback(run: _Run, url: str, url_hash: str, day: date) -> dict:
    """{"source": "wayback", "at", "fields", "text"} or {"source": "none", "note"}. The archive is asked once per page and day, ever."""
    key = (url_hash, day)
    if key in run.asked:
        return run.asked[key]
    with run.engine.connect() as conn:
        earlier = conn.execute(
            text("SELECT before_source, before_at, diff FROM rival_page_changes WHERE rival_url_hash = :h AND wanted_before = :d AND before_source IN ('wayback', 'none') ORDER BY updated_at DESC LIMIT 1"),
            {"h": url_hash, "d": day},
        ).mappings().first()
    if earlier is not None:
        kept = earlier["diff"] if isinstance(earlier["diff"], dict) else json.loads(earlier["diff"] or "{}")
        if earlier["before_source"] == "wayback" and kept.get("before_fields"):
            found = {"source": "wayback", "at": earlier["before_at"], "fields": kept["before_fields"], "text": "", "sections": (kept.get("changes") or {}).get("sections"), "after_hash": kept.get("after_hash")}
        else:
            found = {"source": "none", "note": kept.get("note") or "no_copy"}
    else:
        try:
            capture = history.capture_lookup(url, day)
        except Exception as exc:  # noqa: BLE001 - HistoryFailed or a bad answer: no earlier copy this time, and it isn't asked again for this day
            found = {"source": "none", "note": "wayback_failed", "reason": str(exc)[:80] if isinstance(exc, history.HistoryFailed) else type(exc).__name__}
        else:
            if capture is None or not capture.fields.content_hash or capture.fields.word_count == 0:
                found = {"source": "none", "note": "no_copy"}
            else:
                found = {"source": "wayback", "at": capture.taken_at, "fields": capture.fields.as_dict(), "text": capture.fields.text}
    run.asked[key] = found
    return found


_UPSERT = text(
    "INSERT INTO rival_page_changes (site_id, finding_id, keyword_id, rival_url, rival_url_hash, host, my_url, position_before, position_now, wanted_before, "
    "before_at, before_source, after_at, read_at, read_count, diff, mine) VALUES (:s, :f, :k, :u, :h, :host, :my, :pb, :pn, :w, :ba, :bs, :aa, "
    "IF(:r > 0, UTC_TIMESTAMP(3), NULL), :r, :d, :m) ON DUPLICATE KEY UPDATE "
    # read_count first: MariaDB applies these left to right, so read_at must still be the old one when it's looked at
    "read_count = IF(:r > 0, IF(read_at >= UTC_DATE(), read_count + :r, :r), read_count), read_at = IF(:r > 0, UTC_TIMESTAMP(3), read_at), "
    "keyword_id = :k, host = :host, my_url = :my, position_before = :pb, position_now = :pn, wanted_before = :w, before_at = :ba, before_source = :bs, "
    "after_at = :aa, diff = :d, mine = :m, updated_at = UTC_TIMESTAMP(3)"
)


def _done(conn, finding_id: int, url_hash: str, checked: datetime | None) -> bool:
    """Already read after the check that showed them above me: nothing new until the next check."""
    after = conn.execute(text("SELECT after_at FROM rival_page_changes WHERE finding_id = :f AND rival_url_hash = :h"), {"f": finding_id, "h": url_hash}).scalar()
    return after is not None and checked is not None and after >= checked


def _one(run: _Run, finding: dict, evidence: dict, target: dict) -> str:
    """Reads and compares one rival page for one finding. Returns done, skipped or waiting."""
    url, url_hash = target["url"], pages.url_hash(target["url"])
    with run.engine.connect() as conn:
        if _done(conn, finding["id"], url_hash, _stamp(evidence.get("checked"))):
            return "skipped"
        # Never read a competitor set to Off, even if it changed since the finding was made.
        still = conn.execute(
            text(f"SELECT 1 FROM site_competitors sc JOIN sites c ON c.id = sc.competitor_id WHERE sc.site_id = :s AND c.id = :c AND {PAGES_SQL}"),
            {"s": run.site_id, "c": target["competitor_id"]},
        ).first()
    if still is None:
        return "skipped"
    page, spent = _read(run, url, target["rival_host"])
    if spent < 0:
        return "waiting"
    my_url = evidence.get("my_url") or finding.get("page")
    mine, my_reads = _my_facts(run, my_url)
    wanted = wanted_before(evidence)
    values = {
        "s": run.site_id, "f": finding["id"], "k": evidence.get("keyword_id"), "u": url, "h": url_hash, "host": target["host"][:190], "my": my_url,
        "pb": target["position"]["before"], "pn": target["position"]["now"], "w": wanted.date() if wanted else None, "r": spent + my_reads,
        "m": json.dumps(mine, ensure_ascii=False) if mine else None,
    }
    if page is None or not page.get("content_hash"):
        record = {"changed": None, "unreadable": (page or {}).get("last_status") or "not_read"}
        with run.engine.begin() as conn:
            conn.execute(_UPSERT, {**values, "ba": None, "bs": "none", "aa": (page or {}).get("last_checked_at"), "d": json.dumps(record)})
        return "done"
    with run.engine.connect() as conn:
        now_text = _text(conn, page["id"])
        stored = _stored_before(conn, page["id"], wanted) if wanted else None
    record: dict = {"now": diff.facts(page, now_text), "after_hash": page["content_hash"]}
    if stored is not None:
        source, before_at = "stored", stored["at"]
        record["changes"] = diff.compare(stored["fields"], stored["text"], page, now_text)
    elif wanted is not None:
        found = _wayback(run, url, url_hash, wanted.date())
        source, before_at = found["source"], found.get("at")
        if source == "wayback":
            changes = diff.compare(found["fields"], found.get("text") or "", page, now_text)
            if not found.get("text") and found.get("sections") and found.get("after_hash") == page["content_hash"]:
                changes["sections"] = found["sections"]  # the copy's text isn't kept, but this page hasn't changed since it was compared
                changes["changed"] = True
            record["changes"] = changes
            record["before_fields"] = found["fields"]  # its fields only, never its text, so a later look needn't ask the archive again
        else:
            record["note"] = found.get("note")
    else:
        source, before_at = "none", None
        record["note"] = "no_date"
    with run.engine.begin() as conn:
        conn.execute(_UPSERT, {**values, "ba": before_at, "bs": source, "aa": page["last_checked_at"], "d": json.dumps(record, ensure_ascii=False, default=str)})
    return "done"


def _findings(conn, site_id: int) -> list[dict]:
    rows = conn.execute(
        text("SELECT id, kind, query, page, evidence FROM search_findings WHERE site_id = :s AND status = 'open' AND kind IN ('rival_passed', 'rank_drop') ORDER BY at_stake DESC, id"),
        {"s": site_id},
    ).mappings().all()
    return [dict(r) | {"evidence": _evidence(r)} for r in rows]


def run_site(engine: Engine, site_id: int) -> dict:
    """Every finding of this site that qualifies, the most clicks at stake first, until today's reads run out."""
    with engine.connect() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :i AND kind = 'own'"), {"i": site_id}).scalar()
        if not host:
            return {"site_id": site_id, "done": 0}
        run = _Run(engine, site_id, host, READS_PER_DAY - reads_today(conn, site_id))
        findings = [f for f in _findings(conn, site_id) if applies(f["kind"], f["evidence"])]
    counts = {"done": 0, "skipped": 0, "waiting": 0}
    try:
        for finding in findings:
            with engine.connect() as conn:
                targets = sides(conn, site_id, host, finding["evidence"]).targets
            for target in targets:
                if time.monotonic() - run.started > RUN_SECONDS:
                    raise RunAgain(0)
                counts[_one(run, finding, finding["evidence"], target)] += 1
    finally:
        if run.fetcher is not None:
            run.fetcher.close()
    return {"site_id": site_id, **counts}


@handler(JOB_KIND)
def run_job(job, engine: Engine) -> None:
    site_id = (job.payload or {}).get("site_id")
    if isinstance(site_id, int):
        run_site(engine, site_id)


# ---- the panel ----------------------------------------------------------------------------------


def _card(target: dict, row: dict | None) -> dict:
    card = {k: target[k] for k in ("host", "url", "competitor_id", "tracking", "position", "passed")}
    if row is None:
        return {**card, "read": False, "before_source": None, "before_at": None, "after_at": None, "changed": None, "rows": [], "more": 0, "extra": []}
    record = row["diff"] if isinstance(row["diff"], dict) else json.loads(row["diff"] or "{}")
    mine = row["mine"] if isinstance(row["mine"], dict) else (json.loads(row["mine"]) if row["mine"] else None)
    changes = record.get("changes")
    if changes is not None:
        every, _ = diff.rows(changes, mine, 99)
        changed = bool(changes.get("changed"))
    else:
        every, _ = diff.now_rows(record.get("now"), mine, 99)
        changed = None  # no earlier copy: nothing to say about a change
    shown, extra = every[:ROWS_SHOWN], every[ROWS_SHOWN:]  # the rest behind the card's "+N more"
    return {
        **card, "read": True, "before_source": row["before_source"], "before_at": _iso(row["before_at"]), "after_at": _iso(row["after_at"]),
        "changed": changed, "unreadable": record.get("unreadable"), "note": record.get("note"), "rows": shown, "more": len(extra), "extra": extra,
    }


def for_finding(engine: Engine, finding_id: int) -> dict:
    """What the finding's "Who passed you" block shows: one card per followed page above mine, and the sites above me not followed."""
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT f.id, f.site_id, f.kind, f.query, f.page, f.evidence, s.host FROM search_findings f JOIN sites s ON s.id = f.site_id WHERE f.id = :i"), {"i": finding_id}
        ).mappings().first()
        if row is None or row["site_id"] not in access.own_site_ids(conn):
            raise NotFound("That insight doesn't exist any more.")
        evidence = _evidence(row)
        out = {
            "finding_id": row["id"], "kind": row["kind"], "keyword": row["query"], "applies": applies(row["kind"], evidence),
            "me": {"url": evidence.get("my_url") or row["page"], "before": evidence.get("was"), "now": evidence.get("scraped")},
            "status": "none", "cards": [], "not_followed": [],
        }
        if not out["applies"]:
            return out
        found = sides(conn, row["site_id"], row["host"], evidence)
        saved = {
            r["rival_url_hash"]: dict(r)
            for r in conn.execute(text("SELECT * FROM rival_page_changes WHERE finding_id = :f"), {"f": finding_id}).mappings().all()
        }
        reading = conn.execute(text("SELECT 1 FROM jobs WHERE active_key = :k"), {"k": _dedupe(row["site_id"])}).first() is not None
    out["cards"] = [_card(t, saved.get(pages.url_hash(t["url"]))) for t in found.targets]
    out["not_followed"] = found.not_followed
    if not out["cards"]:
        out["status"] = "none"
    elif all(c["read"] for c in out["cards"]):
        out["status"] = "ready"
    else:
        out["status"] = "reading" if reading else "waiting"
    return out


def related(engine: Engine, finding: dict) -> int | None:
    """The finding whose "Who passed you" block this one shows: itself for rival_passed and rank_drop, else (a page or a search
    that fell) the open page-1 rival_passed or rank_drop finding on its own search or one of the searches behind it."""
    evidence = finding["evidence"] if isinstance(finding.get("evidence"), dict) else json.loads(finding.get("evidence") or "{}")
    if finding["kind"] in KINDS:
        return finding["id"] if applies(finding["kind"], evidence) else None
    if finding["kind"] not in ("page_down", "query_down"):
        return None
    searches = [finding.get("query")] + [q.get("query") for q in evidence.get("queries") or [] if isinstance(q, dict)]
    searches = list(dict.fromkeys(q for q in searches if q))[:20]
    if not searches:
        return None
    from sqlalchemy import bindparam

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, kind, evidence FROM search_findings WHERE site_id = :s AND status = 'open' AND kind = 'rival_passed' AND query IN :q ORDER BY at_stake DESC, id")
            .bindparams(bindparam("q", expanding=True)), {"s": finding["site_id"], "q": searches},
        ).mappings().all()
    return next((r["id"] for r in rows if applies(r["kind"], _evidence(r))), None)


def look_again(engine: Engine, finding_id: int) -> dict:
    """After following a site from the block: queue a look for the finding's site now, and say what the block shows."""
    with engine.connect() as conn:
        site_id = conn.execute(text("SELECT site_id FROM search_findings WHERE id = :i"), {"i": finding_id}).scalar()
        if site_id is None or site_id not in access.own_site_ids(conn):
            raise NotFound("That insight doesn't exist any more.")
    enqueue_for_site(engine, site_id)
    return for_finding(engine, finding_id)
