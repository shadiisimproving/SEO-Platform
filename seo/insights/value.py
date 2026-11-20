"""D. Value: which clicks bring leads, joined with GA4's key events over the last 90 days.

- D1, a page that brings leads and is losing clicks, said again under Leads, first.
- D2, a page with plenty of search clicks and no lead in 90 days: a conversion problem, not an SEO one.
- D3, on every finding about a page: the leads a month its clicks at stake stand for, at that page's own lead rate when it
  has enough sessions, the site's otherwise. Clicks stay the ranking unit; the leads are shown beside them.

Pages are matched by path (service._path), since GA4 reports paths and Search Console full addresses.

A lead is a visit with a key event the owner ticked as a lead (seo/metrics/leads.py). Until the site ticks one, the rate is
visits with any key event, and every finding says "key events" (lead_kind). The 90 days start after the last day GA4 changed
how it counts them (seo/metrics/ga4_checks.py), so a stretch of one key event per visit never inflates leads at stake.
"""
from __future__ import annotations

from datetime import date, timedelta

from seo.insights import rules
from seo.insights.data import Ctx
from seo.insights.finding import Finding, Result
from seo.insights.movement import _path as short_path
from seo.metrics import ga4_checks
from seo.metrics import leads as lead_rules
from seo.metrics.service import _path

LEAD_KINDS = ("page_down", "dropped_out", "decay")


def _leads(ctx: Ctx) -> tuple[dict[str, dict], dict] | None:
    kind = lead_rules.kind(ctx.engine, [ctx.site_id])
    since = ctx.end - timedelta(days=rules.LEAD_DAYS - 1)
    for change in ga4_checks.crossing(ga4_checks.tracking_changes(ctx.engine, ctx.site_id, kind), since, ctx.end):
        since = max(since, date.fromisoformat(change["day"]))
    rows = ctx.fetch(
        f"SELECT MAX(path) path, SUM(sessions) sessions, SUM({lead_rules.count_sql(kind)}) leads, SUM({lead_rules.converted_sql(kind)}) conv "
        "FROM ga4_page_daily WHERE site_id = :s AND day BETWEEN :a AND :e GROUP BY page_hash", a=since, e=ctx.end,
    )
    if not rows:
        return None
    by_path: dict[str, dict] = {}
    for r in rows:
        slot = by_path.setdefault(_path(r["path"]), {"sessions": 0, "leads": 0.0, "conv": 0.0})
        slot["sessions"] += int(r["sessions"] or 0)
        slot["leads"] += float(r["leads"] or 0)
        slot["conv"] += float(r["conv"] or 0)
    sessions = sum(v["sessions"] for v in by_path.values())
    leads = sum(v["leads"] for v in by_path.values())
    conv = sum(v["conv"] for v in by_path.values())
    return by_path, {"sessions": sessions, "leads": leads, "rate": min(conv, sessions) / sessions if sessions else 0.0, "kind": kind, "since": since.isoformat()}


def _rate(page: dict | None, site: dict) -> tuple[float, str]:
    if page and page["sessions"] >= rules.LEAD_MIN_SESSIONS:
        return min(page["conv"], page["sessions"]) / page["sessions"], "page"
    return site["rate"], "site"


def leads(ctx: Ctx, findings: list[Finding]) -> Result:
    out = Result()
    found = _leads(ctx)
    if found is None:
        out.needs.update(lead_page="ga4", no_leads="ga4")
        return out
    by_path, site = found
    if not site["leads"]:
        out.needs.update(lead_page="key_events", no_leads="key_events")
        return out
    out.ran.update({"lead_page", "no_leads"})
    # D3: leads a month at stake, beside the clicks.
    for f in findings:
        url = f.page or f.evidence.get("page")
        if not url or f.at_stake <= 0:
            continue
        page = by_path.get(_path(url))
        rate, basis = _rate(page, site)
        f.evidence["leads_at_stake"] = round(f.at_stake * rate, 2)
        f.evidence["lead_rate"] = {"rate": round(rate * 100, 2), "basis": basis, "kind": site["kind"]}
    # D1: a lead page losing clicks.
    for f in list(findings):
        if f.kind not in LEAD_KINDS or not f.page:
            continue
        page = by_path.get(_path(f.page))
        if not page or not page["leads"]:
            continue
        rate, basis = _rate(page, site)
        monthly = f.at_stake * rate
        out.findings.append(Finding(
            "lead_page", "leads", f.page, page=f.page, at_stake=f.at_stake, severity="big" if monthly >= rules.LEAD_BIG else "normal",
            evidence={
                "path": short_path(f.page), "because": f.kind, "leads": round(page["leads"], 1), "sessions": page["sessions"], "days": (ctx.end - date.fromisoformat(site["since"])).days + 1,
                "leads_at_stake": round(monthly, 2), "lead_rate": {"rate": round(rate * 100, 2), "basis": basis, "kind": site["kind"]}, "lead_kind": site["kind"],
                **{k: f.evidence[k] for k in ("clicks", "clicks_before", "percent", "below_peak", "peak", "last", "seasonal") if k in f.evidence},
            },
        ).settle())
    # D2: clicks but no leads.
    since = ctx.end - timedelta(days=rules.LEAD_DAYS - 1)
    clicked = ctx.fetch(
        "SELECT MAX(page) page, SUM(clicks) c, SUM(impressions) i FROM gsc_page WHERE site_id = :s AND day BETWEEN :a AND :e AND day NOT IN :skip GROUP BY page_hash HAVING SUM(clicks) >= :m",
        a=since, e=ctx.end, m=rules.NO_LEADS_MIN_CLICKS,
    )
    quiet = []
    for r in clicked:
        page = by_path.get(_path(r["page"]))
        if not page or page["sessions"] < rules.LEAD_MIN_SESSIONS or page["leads"]:
            continue  # no GA4 sessions for it means its path didn't match, not that it brings no one
        clicks = int(r["c"] or 0)
        quiet.append(Finding(
            "no_leads", "leads", r["page"], page=r["page"],
            evidence={
                "path": short_path(r["page"]), "clicks": clicks, "impressions": int(r["i"] or 0), "sessions": page["sessions"], "days": rules.LEAD_DAYS,
                "site_rate": round(site["rate"] * 100, 2), "expected": round(page["sessions"] * site["rate"], 1), "lead_kind": site["kind"],
            },
        ))
    out.findings += sorted(quiet, key=lambda f: -f.evidence["clicks"])[: rules.NO_LEADS_KEPT]
    return out
