"""The made-up extras flow_gsc_screen_numbers.cjs reads, on the UI harness's demo world (after app_server.py has built it
and read Search Console from the fake Google):

- two jump links of site-one.example/abonnement (#prix and #faq), 100 impressions and no click each, every day Search
  Console has: 5,600 impressions in any 28 days, which must be said apart from the page's own numbers;
- the site's change finding made a −90 fall of which −80 are searches Google doesn't list (hidden), so the "Why" list
  leads with hidden searches and names no main cause.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_gsc2.py
"""
import json
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.collectors import common  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.insights import data, engine as insights, rules  # noqa: E402
from seo.insights.finding import Finding  # noqa: E402

HOST = "site-one.example"
engine = make_engine(test=True)
assert engine.url.database.endswith("_test")

with engine.begin() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": HOST}).scalar()
    page = conn.execute(text("SELECT page FROM gsc_page WHERE site_id = :s AND page LIKE '%/abonnement' LIMIT 1"), {"s": site}).scalar() or f"https://{HOST}/abonnement"
    days = [d for (d,) in conn.execute(text("SELECT DISTINCT day FROM gsc_daily WHERE site_id = :s"), {"s": site})]
    for jump in (f"{page}#prix", f"{page}#faq"):
        for day in days:
            conn.execute(text("INSERT IGNORE INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, 0, 100, 9)"),
                         {"s": site, "d": day, "h": common.digest(jump), "p": jump})
print("jump links on", len(days), "days of", page)

print("insights:", insights.run(engine, site).get("added"))
# The demo world's Search Console is too short for the change breakdown to run ("history"), so its finding is written here,
# shaped as seo/insights/movement.breakdown writes it: a −90 fall of which −80 are searches Google doesn't list.
ctx = data.load(engine, site)
span = ctx.end - ctx.start + timedelta(days=1)  # the period before, as long, just before it (too early for the demo's data)
now = data.totals(ctx, ctx.start, ctx.end)
before = {**now, "clicks": now["clicks"] + 90}
parts = {"demand": -4, "ranking": -3, "appeal": -3, "new": 0, "lost": 0, "hidden": -80}
finding = Finding("change", "changed", "site", at_stake=90 * rules.MONTH, severity="normal", evidence={
    "now": now, "before": before, "change": -90, "percent": round(-90 / before["clicks"] * 100), "steady": False, "main": None,
    "parts": parts, "movers": {name: [] for name in parts if name != "hidden"}, "pages": [], "explains": [],
    "from": ctx.start.isoformat(), "to": ctx.end.isoformat(), "before_from": (ctx.start - span).isoformat(), "before_to": (ctx.start - timedelta(days=1)).isoformat(),
    "days": (ctx.end - ctx.start).days + 1, "split_left_out": [], "curve": "generic",
}).settle()
with engine.begin() as conn:
    conn.execute(text("DELETE FROM search_findings WHERE site_id = :s AND kind = 'change'"), {"s": site})
    conn.execute(text("INSERT INTO search_findings (site_id, kind, grp, finding_key, severity, at_stake, evidence, status, data_through) VALUES (:s, 'change', 'changed', :k, :v, :a, :e, 'open', :d)"),
                 {"s": site, "k": finding.key(site), "v": finding.severity, "a": finding.at_stake, "e": json.dumps(finding.evidence, default=str), "d": ctx.end})
print("change finding written: −90, −80 hidden")
