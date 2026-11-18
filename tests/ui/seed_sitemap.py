"""The Sitemap card's states for flow_sitemap_card.cjs, on the UI harness's made-up sites (after app_server.py has built them).

site-one.example: a finished test whose sitemap has one of each problem, judged by the real code (seo/health/sitemaps.judge)
from made-up answers, and the bell for it (ring_sitemap, comparing with an earlier test). site-two.example keeps the demo's
own test, which found no sitemap at all.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_sitemap.py
"""
import json
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.core.db import make_engine  # noqa: E402
from seo.crawl import sitemap  # noqa: E402
from seo.health import audit, service as health, sitemaps  # noqa: E402

HOST = "site-one.example"
ROOT = f"https://{HOST}"

engine = make_engine(test=True)
assert engine.url.database.endswith("_test")

good = [f"{ROOT}/guide/brew-{i}" for i in range(30)]
listed = sitemap.SitemapResult(
    entries=[sitemap.Entry(u, "2026-10-01") for u in [f"{ROOT}/", f"{ROOT}/subscription", *good, f"{ROOT}/old-offer", f"{ROOT}/old-shop", f"{ROOT}/chain1",
                                                     f"{ROOT}/decafeine", f"{ROOT}/private/beta", f"{ROOT}/abonnement?ref=1"]],
    sources=[f"{ROOT}/sitemap_index.xml"], from_robots=False,
    files={f"{ROOT}/sitemap_index.xml": {"kind": "index", "urls": 2, "guess": True, "html": False},
           f"{ROOT}/sitemap-pages.xml": {"kind": "urlset", "urls": 36, "guess": False, "html": False},
           f"{ROOT}/sitemap-guides.xml": {"kind": "urlset", "urls": 30, "guess": False, "html": False}},
)
key = audit.address_key
statuses = {key(e.url): ["ok", None] for e in listed.entries}
statuses[key(f"{ROOT}/old-offer")] = ["broken", 404]
statuses[key(f"{ROOT}/old-shop")] = ["broken", 500]
statuses[key(f"{ROOT}/chain1")] = ["redirect", f"{ROOT}/subscription"]
statuses[key(f"{ROOT}/decafeine")] = ["noindex", None]
statuses[key(f"{ROOT}/private/beta")] = ["blocked", None]
statuses[key(f"{ROOT}/abonnement?ref=1")] = ["canonical", f"{ROOT}/abonnement"]
statuses[key(f"{ROOT}/cafe-grains")] = ["ok", None]
statuses[key(f"{ROOT}/moulins")] = ["ok", None]
clicked = [[f"{ROOT}/cafe-grains", 64], [f"{ROOT}/moulins", 9]]
report = sitemaps.judge(listed, statuses, clicked, audit.Findings(), f"{ROOT}/")

with engine.begin() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": HOST}).scalar_one()
    latest = conn.execute(text("SELECT id, counts FROM health_audits WHERE site_id = :s AND status = 'complete' ORDER BY id DESC LIMIT 1"), {"s": site}).mappings().first()
    assert latest, "the demo's test of site-one hasn't finished yet"
    counts = json.loads(latest["counts"]) if isinstance(latest["counts"], str) else latest["counts"]
    # The test before had a readable sitemap with nothing broken, so the bell has something to compare with.
    before = conn.execute(text("SELECT id, counts FROM health_audits WHERE site_id = :s AND status = 'complete' AND id < :i ORDER BY id DESC LIMIT 1"),
                          {"s": site, "i": latest["id"]}).mappings().first()
    if before:
        old = json.loads(before["counts"]) if isinstance(before["counts"], str) else before["counts"]
        old["sitemap"] = {"bad_file": False, "broken": 0, "listed": 36}
        conn.execute(text("UPDATE health_audits SET counts = :c WHERE id = :i"), {"c": json.dumps(old), "i": before["id"]})
    counts["issues"] = {c: n for c, n in counts.get("issues", {}).items() if c not in audit.SITEMAP_CHECKS} | report["counts"]
    counts["sitemap"] = sitemaps.summary(report)
    conn.execute(text("UPDATE health_audits SET counts = :c WHERE id = :i"), {"c": json.dumps(counts), "i": latest["id"]})
    conn.execute(text("DELETE FROM health_issues WHERE audit_id = :i AND code IN :codes".replace(":codes", "(" + ",".join(f"'{c}'" for c in [*audit.SITEMAP_CHECKS, sitemaps.REPORT_CODE]) + ")")), {"i": latest["id"]})
    for code, urls in sitemaps.issue_pages(report).items():
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, :c, :n, :p)"), {"a": latest["id"], "c": code, "n": report["counts"][code], "p": json.dumps(urls)})
    conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, :c, 0, :p)"), {"a": latest["id"], "c": sitemaps.REPORT_CODE, "p": json.dumps(report)})
print("site-one sitemap problems:", report["counts"], "· bell:", health.ring_sitemap(engine, site, latest["id"]) if before else "no earlier test")
