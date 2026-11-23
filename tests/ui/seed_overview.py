"""What flow_overview.cjs needs on the UI harness's demo world: Search Console connected for site-one.example and read
in full through the real collector from the fake Google (tests/ui/fake_google.py: 16 months, seven made-up queries
over several pages, countries and devices). The flow's header used to ask for this by hand ("connect it once and
press Refresh data"); without it the demo world has two weeks of three queries, all tracked already, so the flow's
query, panel, Show-list and 24-hour steps had nothing to work on.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_overview.py
"""
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.collectors import gsc  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.insights import engine as insights  # noqa: E402
from tests.ui import fake_google  # noqa: E402

HOST = "site-one.example"
engine = make_engine(test=True)
assert engine.url.database.endswith("_test")
fake_google.install()

with engine.begin() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = :h"), {"h": HOST}).scalar()
    assert site, "run app_server.py first: it builds the demo world"
    if not conn.execute(text("SELECT id FROM google_connections LIMIT 1")).first():
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('Team robot', 'robot', 'x', 'abcd')"))
    cid = conn.execute(text("SELECT id FROM google_connections LIMIT 1")).scalar()
    conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property) VALUES (:s, 'gsc', :i, :p) "
                      "ON DUPLICATE KEY UPDATE connection_id = :i, property = :p, not_used = 0, last_error = NULL"), {"s": site, "i": cid, "p": f"sc-domain:{HOST}"})
runs = 0
while not gsc.collect(engine, site, budget_seconds=120):
    runs += 1
    assert runs < 40, "the fake Google read never finished"
print(f"{HOST} read from the fake Google in {runs + 1} runs; insights needs:", insights.run(engine, site).get("needs"))
