"""The test app for the Search insights flows: empty, then shop-one.test's made-up Search Console days and one insights
run (tests/ui/seed_insights.py), and Claude faked (tests/ui/fake_claude.py), so nothing reaches Anthropic.

  DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/insights_server.py --port 8281 [--catalogue] [--login]

--catalogue: data that sets off every kind (flow_insights_catalogue.cjs, flow_insights_ai.cjs). Without it: flow_insights.cjs.
Every other option is tests/ui/app_server.py's, which this runs with --empty. It empties that test database first.
"""
from __future__ import annotations

import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from seo.core.db import make_engine  # noqa: E402
from tests.ui import app_server, fake_claude, seed_insights  # noqa: E402


def _seed_when_up(port: int, catalogue: bool) -> None:
    """After app_server has emptied and migrated the database and is answering: the made-up days, then the run."""
    for _ in range(240):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2)
            break
        except OSError:
            time.sleep(0.5)
    print("insights seeded:", seed_insights.seed(make_engine(test=True), catalogue), flush=True)


def main() -> None:
    catalogue = "--catalogue" in sys.argv
    argv = [a for a in sys.argv[1:] if a != "--catalogue"]
    if "--empty" not in argv:
        argv.append("--empty")
    port = int(argv[argv.index("--port") + 1]) if "--port" in argv else 8210
    sys.argv = [sys.argv[0], *argv]
    fake_claude.install()
    threading.Thread(target=_seed_when_up, args=(port, catalogue), daemon=True).start()
    app_server.main()


if __name__ == "__main__":
    main()
