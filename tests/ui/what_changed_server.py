"""The test app for flow_insights_what_changed.cjs: empty, then tests/ui/seed_what_changed.py's days and one insights run.

  DB_NAME_TEST=test_x_test DB_POOL_SIZE=2 .venv/bin/python tests/ui/what_changed_server.py --port 8291

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
from tests.ui import app_server, fake_claude, seed_what_changed  # noqa: E402


def _seed_when_up(port: int) -> None:
    for _ in range(240):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2)
            break
        except OSError:
            time.sleep(0.5)
    print("what changed seeded:", seed_what_changed.seed(make_engine(test=True)), flush=True)


def main() -> None:
    argv = sys.argv[1:]
    if "--empty" not in argv:
        argv.append("--empty")
    port = int(argv[argv.index("--port") + 1]) if "--port" in argv else 8291
    sys.argv = [sys.argv[0], *argv]
    fake_claude.install()
    threading.Thread(target=_seed_when_up, args=(port,), daemon=True).start()
    app_server.main()


if __name__ == "__main__":
    main()
