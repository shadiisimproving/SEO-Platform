"""Today's Social drafts for flow_social.cjs, on the UI harness's made-up sites (after app_server.py has built them).

site-one.example gets the helpers' token, Grok's step failed (signed out), one feed topic, an X post and a LinkedIn post in
Arabic, an English comment on an X post (status 1858000000000000001) and an English comment on a LinkedIn post, and one
weekly suggestion about 900 characters. Everything goes through the app's own code (seo.social.service), as the helpers
would send it. Made-up data only.

  DB_NAME_TEST=<the harness's database> .venv/bin/python tests/ui/seed_social.py
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from seo.core.db import make_engine  # noqa: E402
from seo.social import grok, service  # noqa: E402

engine = make_engine(test=True)
assert engine.url.database.endswith("_test")

with engine.begin() as conn:
    site = conn.execute(text("SELECT id FROM sites WHERE host = 'site-one.example'")).scalar()
    conn.execute(text("DELETE FROM social_items WHERE site_id = :s"), {"s": site})
    conn.execute(text("DELETE FROM social_runs WHERE site_id = :s"), {"s": site})
    conn.execute(text("DELETE FROM social_topics WHERE site_id = :s"), {"s": site})
assert site, "run app_server.py first: it builds site-one.example"

service.new_token(engine, site)
now = datetime.now(timezone.utc).replace(tzinfo=None)
with engine.begin() as conn:
    service._save_topic(conn, site, "rss", None, "New free zone licence rules", "https://news.example/free-zone-licence", "What changes for small companies.", now)
    topic_id = conn.execute(text("SELECT id FROM social_topics WHERE site_id = :s AND link = 'https://news.example/free-zone-licence'"), {"s": site}).scalar()


def signed_out(niche, now):
    raise grok.GrokFailed("Grok is signed out. On the server, run: grok login --device-auth")


service.gather_grok(engine, site, service.today(), research=signed_out)
service.add_targets(engine, site, [
    {"url": "https://x.com/someone/status/1858000000000000001", "author": "someone", "text": "Which free zone is cheapest for a one-person company?", "lang": "en"},
    {"url": "https://www.linkedin.com/posts/someone-else-activity-7260000000000000001", "author": "Someone Else", "text": "We moved our office to a free zone this year.", "lang": "en"},
])
wanted = {w["platform"]: w["id"] for w in service.brief(engine, site)["comments_wanted"]}
print(service.inbox(engine, site, {
    "posts": [
        {"platform": "x", "topic_id": topic_id, "text": "قواعد جديدة لرخص المناطق الحرة: ما الذي يتغير للشركات الصغيرة؟"},
        {"platform": "linkedin", "topic_id": topic_id, "text": "قواعد جديدة لرخص المناطق الحرة. إليكم ما يعنيه ذلك للشركات الصغيرة، خطوة بخطوة."},
    ],
    "comments": [
        {"item_id": wanted["x"], "text": "It depends on the activity: compare the licence and the visa costs together."},
        {"item_id": wanted["linkedin"], "text": "Good move. Did the visa costs change for your team?"},
    ],
    "proposals": [{"text": "Keep LinkedIn posts under 900 characters.", "why": "The posts you kept were all shorter."}],
}))
