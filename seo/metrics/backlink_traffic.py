"""Which backlink brought which visits. Matched when asked, so a link logged late still gets its history.

UTM is exact and wins. A session matched by UTM is never also counted by domain, because the referral table leaves out
every row carrying a campaign. Without UTM it's the same domain and the same landing page.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import Engine, text

from seo.backlinks import service as backlink_service
from seo.backlinks.cleaner import root_domain
from seo.backlinks.live import traffic_targets
from seo.collectors.ga4 import NOT_SET
from seo.metrics import leads as lead_rules
from seo.metrics.service import _path, _pct_change, parse_day


FINAL_LAG_DAYS = 3  # Search Console's days become final about this late, when the site's own "through" day isn't known


def install() -> None:
    """Fills visits and leads on the Backlinks list."""
    backlink_service.traffic_provider = for_backlink_list


def traffic(engine: Engine, site_id: int, start, end) -> dict:
    """{backlink id: {visits, leads, basis, shared_by, pages}}. basis is utm or domain. Once GA4 has data, a link it never saw has 0 visits. Before that, nothing is known."""
    first, last = parse_day(start, "start date"), parse_day(end, "end date")
    values = {"s": site_id, "a": first, "b": last}
    col = lead_rules.count_sql(lead_rules.kind(engine, [site_id]))  # leads once the site picked them, else key events
    with engine.connect() as conn:
        has_data = conn.execute(text("SELECT 1 FROM coverage WHERE site_id = :s AND source = 'ga4' AND day BETWEEN :a AND :b LIMIT 1"), values).first()
        hid = conn.execute(text("SELECT MAX(hid_rows) FROM coverage WHERE site_id = :s AND source = 'ga4' AND day BETWEEN :a AND :b"), values).scalar()
        campaigns = conn.execute(text(f"SELECT MAX(source) source, MAX(medium) medium, MAX(campaign) campaign, MAX(path) path, SUM(sessions) sessions, SUM({col}) leads FROM ga4_campaign_daily WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY row_hash"), values).mappings().all()
        referrals = conn.execute(text(f"SELECT MAX(domain) domain, MAX(path) path, SUM(sessions) sessions, SUM({col}) leads FROM ga4_referral_daily WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY row_hash"), values).mappings().all()
    if not has_data:
        return {"has_data": False, "hid_rows": False, "links": {}}
    by_domain: dict[tuple[str, str], dict] = defaultdict(lambda: {"sessions": 0, "leads": 0.0})
    for row in referrals:
        # GA4 names the host that sent the visit, such as blog.example.com, while a link stores example.com.
        item = by_domain[(root_domain(row["domain"]) or row["domain"], _path(row["path"]))]
        item["sessions"] += int(row["sessions"] or 0)
        item["leads"] += float(row["leads"] or 0)
    # Several links on one domain to one page can't be told apart, so they share one number and say so.
    groups: dict[tuple[str, tuple[str, ...]], list[int]] = defaultdict(list)
    tagged: dict[tuple, list[int]] = defaultdict(list)
    answer = {}
    for link in traffic_targets(engine, site_id):
        utm = link["utm"]
        if utm:
            # Values are case sensitive, as in GA4.
            rows = [r for r in campaigns if (r["campaign"] == utm["campaign"] if utm["campaign"] else r["campaign"] in NOT_SET) and (not utm["source"] or r["source"] == utm["source"]) and (not utm["medium"] or r["medium"] == utm["medium"])]
            answer[link["id"]] = {"visits": sum(int(r["sessions"] or 0) for r in rows), "leads": round(sum(float(r["leads"] or 0) for r in rows), 2), "basis": "utm", "shared_by": 1, "pages": sorted({_path(r["path"]) for r in rows})}
            tagged[(utm["campaign"], utm["source"], utm["medium"])].append(link["id"])
        elif link["paths"]:
            # The logged target, and where it really ends up: a target that redirects still matches.
            groups[(link["domain"], tuple(sorted({_path(path) for path in link["paths"]})))].append(link["id"])
        else:
            answer[link["id"]] = {"visits": None, "leads": None, "basis": "no_target", "shared_by": 1, "pages": []}
    for (domain, paths), ids in groups.items():
        sessions, leads = 0, 0.0
        for path in paths:
            found = by_domain.get((root_domain(domain) or domain, path))
            if found:
                sessions += found["sessions"]
                leads += found["leads"]
        for backlink_id in ids:
            answer[backlink_id] = {"visits": sessions, "leads": round(leads, 2), "basis": "domain", "shared_by": len(ids), "pages": list(paths)}
            if len(ids) > 1:
                answer[backlink_id]["group"] = f"d{min(ids)}"
    # Two links with the same UTM share one number too, and say so (F10).
    for ids in tagged.values():
        if len(ids) > 1:
            for backlink_id in ids:
                answer[backlink_id].update(shared_by=len(ids), group=f"u{min(ids)}")
    return {"has_data": True, "hid_rows": bool(hid), "links": answer}


def for_backlink_list(engine: Engine, site_id: int) -> dict[int, dict]:
    """What the Backlinks list shows: the last 12 months, so a link logged late still gets its history. A link GA4 can't say anything about stays unknown."""
    with engine.connect() as conn:
        today = conn.execute(text("SELECT UTC_DATE()")).scalar()
    found = traffic(engine, site_id, (today - timedelta(days=365)).isoformat(), today.isoformat())
    rows = {}
    for backlink_id, item in found["links"].items():
        if item["visits"] is None:
            continue
        label = "shared" if item["shared_by"] > 1 else item["basis"]
        rows[backlink_id] = {"visits": item["visits"], "leads": item["leads"], "label": label, "shared": item["shared_by"] if item["shared_by"] > 1 else None}
        if item.get("group"):  # links that share one number: a total counts the group once (F10)
            rows[backlink_id]["group"] = item["group"]
    return rows


def before_after(engine: Engine, backlink_id: int, days: int = 28) -> dict:
    """The target page's Search Console numbers around the day the link went live, beside the whole site's change. Correlation, not proof."""
    with engine.connect() as conn:
        link = conn.execute(text("SELECT site_id, target_url, placed FROM backlinks WHERE id = :i"), {"i": backlink_id}).mappings().first()
    if link is None or not link["target_url"] or not link["placed"]:
        return {"state": "no_date", "note": "It needs a target page and a date placed."}
    try:
        placed = date.fromisoformat(str(link["placed"])[:10])
    except ValueError:
        return {"state": "no_date", "note": "Date placed must be YYYY-MM-DD."}
    windows = {"before": (placed - timedelta(days=days), placed - timedelta(days=1)), "after": (placed, placed + timedelta(days=days - 1))}
    # The "after" days must all be final in Search Console, or a link placed 10 days ago compares 28 days with 8 (F11).
    with engine.connect() as conn:
        through = conn.execute(text("SELECT MAX(data_through) FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": link["site_id"]}).scalar()
        today = conn.execute(text("SELECT UTC_DATE()")).scalar()
    last_final = through or (today - timedelta(days=FINAL_LAG_DAYS))
    if windows["after"][1] > last_final:
        ready = windows["after"][1] + (timedelta(days=FINAL_LAG_DAYS) if through is None else (today - through))
        return {"state": "waiting", "placed": placed.isoformat(), "days": days, "ready_on": max(ready, today).isoformat(),
                "note": f"The {days} days after the link aren't all in Search Console yet."}
    target = _path(link["target_url"])
    out: dict = {"state": "ok", "placed": placed.isoformat(), "days": days, "label": "Correlation, not proof"}
    with engine.connect() as conn:
        for name, (first, last) in windows.items():
            pages = conn.execute(text("SELECT page, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) w FROM gsc_page WHERE site_id = :s AND day BETWEEN :a AND :b GROUP BY page_hash, page"), {"s": link["site_id"], "a": first, "b": last}).mappings().all()
            site = conn.execute(text("SELECT SUM(clicks) c FROM gsc_daily WHERE site_id = :s AND day BETWEEN :a AND :b"), {"s": link["site_id"], "a": first, "b": last}).scalar()
            matching = [row for row in pages if _path(row["page"]) == target]
            shown = sum(int(row["i"] or 0) for row in matching)
            out[name] = {
                "clicks": sum(int(row["c"] or 0) for row in matching), "impressions": shown,
                "position": round(sum(float(row["w"] or 0) for row in matching) / shown, 1) if shown else None, "site_clicks": int(site or 0),
            }
    out["page_change"] = _pct_change(out["after"]["clicks"], out["before"]["clicks"])
    out["site_change"] = _pct_change(out["after"]["site_clicks"], out["before"]["site_clicks"])
    return out
