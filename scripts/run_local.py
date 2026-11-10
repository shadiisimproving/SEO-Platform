"""The real app on this Mac: real database, real search tools, real websites. It asks for a login, and listens on this Mac only.

  .venv/bin/python scripts/run_local.py        # then open http://127.0.0.1:8200/

Unlike tests/ui/app_server.py, this uses keys you paste in Settings and really contacts websites and search tools.
The worker runs only while this does: on the Mac nothing happens by itself, and on hosting cron takes over.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from seo.accounts.service import count_users  # noqa: E402
from seo.backlinks import live, logos  # noqa: E402, F401 - register their job handlers
from seo.uptime import service as uptime  # noqa: E402, F401 - registers its job handler
from seo.collectors import jobs as collector_jobs  # noqa: E402, F401 - registers its job handlers
from seo.competitors import crawl, firecrawl, keywords, pages, probe, quality  # noqa: E402, F401 - register their job handlers
from seo.core.db import make_engine  # noqa: E402
from seo.core.schema import upgrade_to_head  # noqa: E402
from seo.health import service as health  # noqa: E402, F401
from seo.serp import refresh  # noqa: E402, F401 - registers the Refresh button's job handler
from seo.web import create_app  # noqa: E402
from seo.worker.runner import tick  # noqa: E402

PORT = 8200


def main() -> None:
    engine = make_engine()
    upgrade_to_head(engine)
    lock_dir = ROOT / "var" / "locks-local"

    def worker(lane: str) -> None:
        while True:
            try:
                tick(engine, lane, lock_dir=lock_dir, budget_seconds=5, db_wait_seconds=1)
            except Exception as exc:  # noqa: BLE001 - keep going and say why
                print(f"worker {lane}: {exc}", flush=True)
            time.sleep(1)

    for lane in ("refresh", "crawl", "collectors"):
        threading.Thread(target=worker, args=(lane,), daemon=True).start()
    app = create_app(engine=engine, screens_dir=ROOT / "design" / "mockups")
    if not count_users(engine):
        print("No accounts yet. Make yours with: .venv/bin/python -m seo.accounts create-admin --username you --name 'Your name'", flush=True)
    print(f"app on http://127.0.0.1:{PORT}/", flush=True)
    app.run(host="127.0.0.1", port=PORT, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
