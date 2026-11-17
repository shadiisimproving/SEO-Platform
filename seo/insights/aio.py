"""Google's AI Overviews on the keywords we track, from the rank checks that could read them (seo/serp).

Two uses:
- Clicks at stake is lowered on a query where an AI Overview shows: it takes a share of the clicks the plain results would
  get. The finding says so, with the share used.
- Today lists what changed between the last two checks that could read the AI Overview: one appeared, one went, we got
  cited, we lost the citation. A check that couldn't read it ("not captured") is never taken as "no AI Overview".
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.accounts import access
from seo.insights import rules
from seo.insights.finding import Finding
from seo.serp import store
from seo.serp.tools import same_place

# Kinds whose clicks at stake come from a click-rate curve: the curve assumes ten plain results, so an AI Overview above
# them lowers it. Kinds that measure clicks really lost (a page losing clicks, dropped out) are left alone.
CURVE_KINDS = frozenset({"almost", "top3", "no_click", "low_ctr", "compete", "no_page", "query_down", "unstable", "slide", "rank_drop", "rival_passed", "rival_gap", "striking", "rank_no_click"})


def _key(keyword: str) -> str:
    return store.clean_keyword(keyword).casefold()


def states(engine: Engine, site_id: int | None = None) -> dict:
    """(site_id, cleaned keyword) → the last two readable checks, newest first: [{state, cited, at, keyword, host}]."""
    values: dict = {"s": site_id} if site_id else {}
    with engine.connect() as conn:
        clause = "AND sk.site_id = :s" if site_id else access.site_clause("sk.site_id", values, conn).lstrip()  # their sites only
        rows = conn.execute(
            text(
                "SELECT sk.site_id, s.host, k.id keyword_id, k.keyword, k.country, k.language, c.id, c.ai_state, c.real_location, c.checked_at FROM site_keywords sk "
                "JOIN sites s ON s.id = sk.site_id AND s.kind = 'own' JOIN keywords k ON k.id = sk.keyword_id "
                "JOIN serp_targets t ON t.keyword_id = k.id AND t.engine = 'google' AND t.device = 'desktop' JOIN serp_checks c ON c.target_id = t.id "
                f"WHERE c.status = 'ok' AND c.ai_state IN ('present', 'absent') {clause} ORDER BY c.id"
            ),
            values,
        ).mappings().all()
        rows = [r for r in rows if same_place(r["country"], r["real_location"], r["language"])]
        cited: dict[int, list[str]] = {}
        ids = [r["id"] for r in rows if r["ai_state"] == "present"]
        if ids:
            statement = text("SELECT check_id, host FROM ai_citations WHERE check_id IN :ids").bindparams(bindparam("ids", expanding=True))
            for c in conn.execute(statement, {"ids": ids}).mappings().all():
                cited.setdefault(c["check_id"], []).append(c["host"])
    out: dict = {}
    for r in rows:
        seen = {"state": r["ai_state"], "cited": any(store.on_host(h, r["host"]) for h in cited.get(r["id"], [])), "at": r["checked_at"], "keyword": r["keyword"], "keyword_id": r["keyword_id"], "host": r["host"], "site_id": r["site_id"]}
        slot = out.setdefault((r["site_id"], _key(r["keyword"])), [])
        slot.insert(0, seen)
        del slot[2:]
    return out


def lower_stakes(engine: Engine, site_id: int, findings: list[Finding]) -> None:
    """Where the last readable check saw an AI Overview on the finding's query, its clicks at stake count AI_OVERVIEW_SHARE."""
    seen = states(engine, site_id)
    if not seen:
        return
    for f in findings:
        if f.kind not in CURVE_KINDS or not f.query or f.at_stake <= 0:
            continue
        latest = seen.get((site_id, _key(f.query)))
        if not latest or latest[0]["state"] != "present":
            continue
        f.at_stake = f.at_stake * rules.AI_OVERVIEW_SHARE
        f.evidence["ai_overview"] = {"share": rules.AI_OVERVIEW_SHARE, "cited": latest[0]["cited"], "checked": latest[0]["at"].date().isoformat()}
        f.settle()


def changes(engine: Engine, site_id: int | None, now: datetime, days: int = 7) -> list[dict]:
    """What changed between the last two readable checks, when the newer one is from the last `days` days."""
    out = []
    for (site, _key_), pair in states(engine, site_id).items():
        if len(pair) < 2 or pair[0]["at"] < now - timedelta(days=days):
            continue
        new, old = pair
        if new["state"] == "present" and old["state"] == "absent":
            kind = "aio_cited_new" if new["cited"] else "aio_appeared"
        elif new["state"] == "absent" and old["state"] == "present":
            kind = "aio_gone"
        elif new["state"] == "present" and new["cited"] != old["cited"]:
            kind = "aio_cited" if new["cited"] else "aio_uncited"
        else:
            continue
        out.append({"kind": kind, "site_id": site, "host": new["host"], "keyword": new["keyword"], "keyword_id": new["keyword_id"], "at": new["at"]})
    return out
