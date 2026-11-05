"""The real app and worker with several fake search tools, for trying Keywords and Refresh by hand. Nothing touches the internet.

  DB_NAME_TEST=seo_cc_refresh_test .venv/bin/python tests/ui/keywords_server.py --port 8222 [--empty] [--login]

It empties that test database first (it refuses any database not ending in _test). Sites are .example addresses.
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from seo.accounts.service import create_user  # noqa: E402
from seo.core.db import make_engine  # noqa: E402
from seo.serp import connections, refresh  # noqa: E402, F401
from seo.serp.tools import NOT_CAPTURED, Answer, Found, ToolStopped  # noqa: E402
from seo.web import create_app  # noqa: E402
from seo.worker.runner import tick  # noqa: E402
from tests.ui import app_server, demo_world  # noqa: E402


class Slow(demo_world.DemoTool):
    """The demo's answers, a little slowly, so progress can be seen."""

    delay = 0.5
    shift = 0
    location = None
    cost = 1
    sees_ai = True

    def search(self, keyword, engine, country, language, device, depth):
        time.sleep(self.delay)
        answer = super().search(keyword, "google", country, language, device, depth)
        rows = answer.results
        if self.shift and len(rows) > self.shift:
            rows = rows[self.shift:] + rows[:self.shift]
            rows = [Found(i + 1, row.url, row.title) for i, row in enumerate(rows)]
        return Answer(self.name, self.location or country, depth, rows, answer.ai_state if self.sees_ai else NOT_CAPTURED, answer.ai_citations if self.sees_ai else [], self.cost * ((depth + 9) // 10))


class Serp(Slow):
    name = "SerpApi"
    engines = ("google", "duckduckgo", "bing", "yandex")
    free_monthly = 250
    gives_ai = True
    most_per_search = 2


class Bright(Slow):
    name = "Bright Data"
    engines = ("google", "duckduckgo", "bing", "yandex")
    free_monthly = 12  # a little left, so running out can be seen
    paid_per = 0.0015
    shift = 1
    sees_ai = False
    gives_ai = False


class Sear(Slow):
    name = "Searlo"
    engines = ("google",)
    free_monthly = None
    free_once = 3000
    paid_per = 0.0008
    shift = 2
    sees_ai = False
    gives_ai = False


class Duck(Slow):
    name = "DuckDuckGo direct"
    engines = ("duckduckgo",)
    free_monthly = None
    cost = 0
    sees_ai = False
    gives_ai = False


class Mac(Slow):
    name = "Browser on this Mac"
    engines = ("google", "bing", "yandex")
    free_monthly = None
    manual_only = True
    location = "AE"
    cost = 0
    sees_ai = False
    gives_ai = False

    def search(self, keyword, *args):
        if "captcha" in keyword:
            raise ToolStopped("A captcha appeared and didn't clear, so the browser backup stopped. The app doesn't try to get past it.")
        return super().search(keyword, *args)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8222)
    parser.add_argument("--empty", action="store_true")
    parser.add_argument("--login", action="store_true")
    args = parser.parse_args()
    engine = make_engine(test=True)
    lock_dir = ROOT / "var" / f"locks-{engine.url.database}"
    app_server.reset(engine)
    if args.empty:
        demo_world.install(demo_world.Websites(), delay=0)
    else:
        world = demo_world.build(engine, lock_dir)
        demo_world.install(world["websites"], world["tool"], delay=0)
    table = {"google": [Bright(), Serp(), Sear(), Mac()], "duckduckgo": [Duck(), Serp()], "bing": [Serp(), Mac()], "yandex": [Mac()]}
    connections.tool_factory = lambda eng, name: list(table.get(name, []))
    connections.save_setting(engine, "mac_country", "AE")

    def worker(lane: str) -> None:
        while True:
            try:
                result = tick(engine, lane, lock_dir=lock_dir, budget_seconds=5, db_wait_seconds=1)
                if result.status not in ("ok", "busy"):  # a migration added while this runs stops the worker, and says why
                    print(f"worker {lane}: {result.status} {result.message}", flush=True)
            except Exception as exc:  # noqa: BLE001 - keep the harness alive and say why
                print(f"worker {lane}: {exc}", flush=True)
            time.sleep(0.4)

    for lane in ("refresh", "crawl"):
        threading.Thread(target=worker, args=(lane,), daemon=True).start()
    app = create_app(engine=engine, url_allowed=lambda url: True, screens_dir=ROOT / "design" / "mockups", auth=args.login, secret_key="local-test-harness-only")
    if args.login:
        create_user(engine, "admin@example.com", "Demo admin", "admin", password="demo-password-1", must_change=False)
        create_user(engine, "sara@example.com", "Sara", "member", password="demo-password-1", must_change=False)
    print(f"app on http://127.0.0.1:{args.port}/", flush=True)
    app.run(host="127.0.0.1", port=args.port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
