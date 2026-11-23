"""What the app's own home-page check saw, made up, for the Link gaps flows. Run after tests/ui/app_server.py has built the demo world:

  DB_NAME_TEST=<same>_test .venv/bin/python tests/ui/seed_link_flags.py spam-facts    (tests/ui/flow_spam_facts.cjs)
  DB_NAME_TEST=<same>_test .venv/bin/python tests/ui/seed_link_flags.py links2        (tests/ui/flow_links2_fixes.cjs)

spam-facts: local-news.example redirects to link-shop.example, home-kitchen.example is parked, coffee-review.example is down,
all checked 2026-11-18 08:00. links2: the redirect and the site down checked 2026-11-11, home-kitchen.example's links last seen
in Feb 2025 (its file read today), and backlink 3 set to Brand by hand while the page reads "best coffee club".
Test databases only, .example sites only.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402


def flag(conn, domain: str, reason: str, at: str, to: str | None = None) -> None:
    conn.execute(text("UPDATE link_domains SET quality = 'spam', reason = :r, redirect_to = :t, checked_at = :at WHERE domain = :d"), {"r": reason, "t": to, "at": at, "d": domain})


def main(which: str) -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "test databases only"
    with engine.begin() as conn:
        if which == "spam-facts":
            at = "2026-11-18 08:00:00"
            flag(conn, "local-news.example", "leads_elsewhere", at, "link-shop.example")
            flag(conn, "home-kitchen.example", "parked", at)
            flag(conn, "coffee-review.example", "site_down", at)
        elif which == "links2":
            at = "2026-11-11 08:00:00"
            flag(conn, "local-news.example", "leads_elsewhere", at, "link-shop.example")
            flag(conn, "coffee-review.example", "site_down", at)
            conn.execute(text(
                "UPDATE competitor_referrer_links l JOIN competitor_referrers r ON r.competitor_id = l.competitor_id AND r.domain = l.domain "
                "SET l.last_seen = '2025-02-10', r.last_seen_at = UTC_TIMESTAMP(3) WHERE l.domain = 'home-kitchen.example'"
            ))
            conn.execute(text("UPDATE backlinks SET anchor_kind = 'brand', seen_anchor = 'best coffee club', check_outcome = 'found' WHERE id = 3"))
        else:
            raise SystemExit("say spam-facts or links2")
    print("seeded", which)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
