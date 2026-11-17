"""The test app for flow_insights_who_passed.cjs: tests/ui/seed_who_passed.py's days and checks, one insights run, and the
crawl worker reading the rival pages above mine on a fake internet (fake_google's rival-guide.test and its Wayback copy).

  DB_NAME_TEST=test_x_test DB_POOL_SIZE=2 .venv/bin/python tests/ui/who_passed_server.py --port 8293

Claude is faked (tests/ui/fake_claude.py): nothing is sent, nothing is spent. Every other option is tests/ui/app_server.py's,
which this runs with --empty. It empties that test database first.
"""
from __future__ import annotations

import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import httpx  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.crawl.fetch import PoliteFetcher  # noqa: E402
from tests.ui import app_server, demo_world, fake_claude, fake_google, seed_who_passed  # noqa: E402

MY_PAGE = (
    "<html lang='en'><head><title>Company setup guide 2025 | Shop One</title><meta name='description' content='Set up a company in 2025.'></head>"
    "<body><main><h1>Company setup guide</h1><h2>Costs</h2><p>" + "Setting up takes a few steps. " * 70 + "</p><h2>Steps</h2><p>Updated for 2025.</p>"
    "<h3>How long does it take?</h3><p>About a month.</p><a href='/visa/'>Visa</a></main></body></html>"
)


def _internet(websites):
    rival = fake_google.rival_site()

    def answer(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host in ("rival-guide.test", "other-rival.test"):
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            return rival.handle_request(httpx.Request(request.method, str(request.url).replace(host, "rival-guide.test")))
        if host == seed_who_passed.HOST:
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            if request.url.path == "/guide/":
                return httpx.Response(200, html=MY_PAGE)
            return httpx.Response(200, html=f"<html><head><title>Shop One {request.url.path}</title></head><body><main><h1>Shop One</h1><p>{'A page. ' * 80}</p></main></body></html>")
        return websites(request)

    return answer


def _install(original):
    def install(websites, *args, **kwargs):
        tool = original(websites, *args, **kwargs)
        from seo.links import service as links

        links.fetcher_factory = lambda: PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(_internet(websites)))
        return tool

    return install


def _seed_when_up(port: int) -> None:
    for _ in range(240):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2)
            break
        except OSError:
            time.sleep(0.5)
    print("who passed seeded:", seed_who_passed.seed(make_engine(test=True)), flush=True)


def main() -> None:
    argv = sys.argv[1:]
    if "--empty" not in argv:
        argv.append("--empty")
    port = int(argv[argv.index("--port") + 1]) if "--port" in argv else 8293
    sys.argv = [sys.argv[0], *argv]
    fake_claude.install()
    demo_world.install = _install(demo_world.install)
    app_server.demo_world.install = demo_world.install
    threading.Thread(target=_seed_when_up, args=(port,), daemon=True).start()
    app_server.main()


if __name__ == "__main__":
    main()
