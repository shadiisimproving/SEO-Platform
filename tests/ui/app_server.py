"""The real app with a real worker, on a fake internet, for trying it by hand.

  DB_NAME_TEST=seo_cc_b_test .venv/bin/python tests/ui/app_server.py --port 8210 [--empty | --keep]

It empties that test database first (it refuses any database not ending in _test), fills it through the real
code unless --empty is given, and serves the screens. --keep skips all that and carries on with what's there. Local only. No real website or search tool is contacted.
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from seo.accounts.service import count_users, create_user  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.core.schema import upgrade_to_head  # noqa: E402
from seo.web import create_app  # noqa: E402
from seo.worker.runner import tick  # noqa: E402
from seo.collectors import jobs as collector_jobs  # noqa: E402, F401 - registers its job handlers
from tests.ui import demo_world, fake_firecrawl, fake_google  # noqa: E402


def reset(engine) -> None:
    assert engine.url.database.endswith("_test"), "refusing to reset a non-test database"
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for (table,) in conn.execute(text("SHOW TABLES")).all():
            conn.execute(text(f"DROP TABLE `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    upgrade_to_head(engine)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8210)
    parser.add_argument("--empty", action="store_true", help="start with no sites, to try the first-run screens")
    parser.add_argument("--keep", action="store_true", help="keep what's in the database, so a restart loses nothing")
    parser.add_argument("--login", action="store_true", help="ask for a login, with admin@example.com / demo-password-1")
    parser.add_argument("--slow", type=float, default=0.25, help="seconds between requests, so progress can be seen")
    args = parser.parse_args()

    engine = make_engine(test=True)
    lock_dir = ROOT / "var" / f"locks-{engine.url.database}"
    if not args.keep:
        reset(engine)
    if args.keep or args.empty:
        websites, tool = demo_world.Websites(), None
        tool = demo_world.install(websites, delay=args.slow)
    else:
        world = demo_world.build(engine, lock_dir)
        websites, tool = world["websites"], demo_world.install(world["websites"], world["tool"], delay=args.slow)
        print("sites:", world["sites"], "rivals:", world["rivals"], flush=True)

    def worker(lane: str) -> None:
        while True:
            try:
                tick(engine, lane, lock_dir=lock_dir, budget_seconds=5, db_wait_seconds=1)
            except Exception as exc:  # noqa: BLE001 - keep the harness alive and say why
                print(f"worker {lane}: {exc}", flush=True)
            time.sleep(0.4)

    fake_google.install()
    fake_firecrawl.install(websites)
    for lane in ("refresh", "crawl", "collectors"):
        threading.Thread(target=worker, args=(lane,), daemon=True).start()
    app = create_app(engine=engine, url_allowed=lambda url: True, screens_dir=ROOT / "design" / "mockups", auth=args.login, secret_key="local-test-harness-only")
    if args.login and not count_users(engine):
        create_user(engine, "admin@example.com", "Demo admin", "admin", password="demo-password-1", must_change=False)
    print(f"app on http://127.0.0.1:{args.port}/", flush=True)
    app.run(host="127.0.0.1", port=args.port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
