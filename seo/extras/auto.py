"""Moz and Cloudflare for every website, by themselves (the owner's request, 2026-11-09: "add it for each website").

Every own site and every competitor that at least one site has On goes on the Important domains list and is looked up
once a month. Moz stops at its free rows and never pays; own sites come first, so they're never the ones left out.
A competitor set to Pages only or Off is left alone, as before: no credit, free or paid, is spent on it.
A tool with no key is skipped without a word; the profile's button says what's missing.
"""
from __future__ import annotations

from sqlalchemy import Engine, text

from seo.core.errors import Refused
from seo.extras import service as extras
from seo.worker import queue
from seo.worker.runner import handler

JOB_KIND = "extras.domain_numbers"
LANE = "collectors"


def wanted(engine: Engine) -> list[str]:
    """My sites first, then each competitor some site has On, oldest first."""
    with engine.connect() as conn:
        mine = [row[0] for row in conn.execute(text("SELECT host FROM sites WHERE kind = 'own' ORDER BY id")).all()]
        rivals = [row[0] for row in conn.execute(text(
            "SELECT s.host FROM sites s JOIN site_competitors sc ON sc.competitor_id = s.id "
            "WHERE s.kind = 'competitor' GROUP BY s.id, s.host HAVING SUM(sc.tracking = 'on') > 0 ORDER BY s.id"
        )).all()]
    out = []
    for host in mine + rivals:
        try:
            domain = extras.clean_domain(host)
        except Refused:
            continue  # an address the lists can't hold, such as an IP
        if domain not in out:
            out.append(domain)
    return out


def look_up(engine: Engine, domains: list[str] | None = None) -> dict:
    """Puts each domain on the list, then asks Moz and Cloudflare for whatever hasn't been read this month."""
    allowed = wanted(engine)
    domains = allowed if domains is None else [d for d in (_clean(x) for x in domains) if d in allowed]
    with engine.connect() as conn:
        already = {row[0] for row in conn.execute(text("SELECT target FROM moz_metrics WHERE important = 1")).all()}
    for domain in domains:
        if domain not in already:
            extras.mark(engine, domain)
    result = {"domains": len(domains), "moz": None, "cloudflare": None}
    if not domains:
        return result
    try:
        answer = extras.fetch_moz(engine, domains)
        result["moz"] = {"fetched": answer["fetched"], "held_back": answer["held_back"], "error": answer["error"]}
    except Refused:
        pass  # Moz isn't connected
    try:
        answer = extras.fetch_popularity(engine, only=domains, stale_only=True)
        result["cloudflare"] = {"error": answer["error"]}
    except Refused:
        pass  # Cloudflare isn't connected
    return result


def _clean(value) -> str | None:
    try:
        return extras.clean_domain(value)
    except Refused:
        return None


def queue_for(engine: Engine, hosts: list[str]) -> None:
    """A new competitor: its numbers and mine, a minute later instead of tonight."""
    domains = sorted({d for d in (_clean(h) for h in hosts) if d})
    if domains:
        queue.enqueue(engine, LANE, JOB_KIND, payload={"domains": domains}, dedupe_key=f"domain-numbers:{','.join(domains)}", max_attempts=2)


def enqueue_due(engine: Engine) -> None:
    """Every night. A domain read this month costs nothing, so a daily run only reaches the new ones and the next month."""
    queue.enqueue(engine, LANE, JOB_KIND, payload={}, dedupe_key="domain-numbers:all", max_attempts=2)


@handler(JOB_KIND)
def run(job, engine: Engine) -> None:
    look_up(engine, (job.payload or {}).get("domains"))
