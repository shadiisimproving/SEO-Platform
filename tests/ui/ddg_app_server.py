"""tests/ui/app_server.py, plus DuckDuckGo tools on a fake DuckDuckGo: the real DuckDuckGo direct and Bright Data code
reads the pages. DDG_BLOCKED=1 makes DuckDuckGo answer DuckDuckGo direct with its bot check (202), as it does live.
A SerpApi tripwire is in the DuckDuckGo order too: if anything ever calls it, the log says SERPAPI CALLED.

  DB_NAME_TEST=test_autoddg_test .venv/bin/python tests/ui/ddg_app_server.py --port 8273               (flow_auto_duckduckgo)
  DDG_BLOCKED=1 DB_NAME_TEST=test_autoddg_test .venv/bin/python tests/ui/ddg_app_server.py --port 8273 (flow_auto_duckduckgo_blocked)

Every other option is app_server.py's. Made-up sites only; nothing leaves the machine.
"""
import json
import os
import runpy
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
from tests.ui import demo_world  # noqa: E402
from seo.serp import connections, tools  # noqa: E402

orig = demo_world.install
BLOCKED = os.environ.get("DDG_BLOCKED") == "1"


def results_page(q: str) -> bytes:
    rows = []
    for i in range(1, 11):
        host = demo_world.ME if i == 4 else f"rival{i}.example"
        rows.append(f'<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2F{host}%2F{i}">{q} {i}</a></div>')
    return ("<html><body>" + "".join(rows) + "</body></html>").encode()


def ddg_site(request: httpx.Request) -> httpx.Response:
    if BLOCKED:
        return httpx.Response(202, text="<html>anomaly: please confirm you are a person</html>")
    return httpx.Response(200, content=results_page(request.url.params.get("q", "")), headers={"content-type": "text/html"})


def bright_api(request: httpx.Request) -> httpx.Response:
    target = json.loads(request.content)["url"]
    if not target.startswith("https://duckduckgo.com/?"):
        # What a zone answered live for any other address: nothing, and Bright Data's own error code.
        return httpx.Response(200, content=b"", headers={"x-brd-error": "No parser found for this resource", "x-brd-error-code": "parse_no_parser"})
    return httpx.Response(200, content=results_page(parse_qs(urlsplit(target).query)["q"][0]), headers={"content-type": "text/html"})


class SerpApiTripwire:
    name = "SerpApi"
    engines = ("duckduckgo",)
    free_monthly = 250

    def search(self, *args, **kwargs):
        print("SERPAPI CALLED", args[:2], flush=True)
        raise tools.SearchFailed("tripwire")


def install(*args, **kwargs):
    google = orig(*args, **kwargs)

    def factory(engine, name):
        if name == "google":
            return [google]
        if name == "duckduckgo":
            return [
                tools.DuckDuckGoDirect(client=httpx.Client(transport=httpx.MockTransport(ddg_site)), sleep=lambda s: time.sleep(min(s, 0.6))),
                tools.BrightData("KEY", "serp_api1", client=httpx.Client(transport=httpx.MockTransport(bright_api))),
                SerpApiTripwire(),
            ]
        return []

    connections.tool_factory = factory
    return google


demo_world.install = install
runpy.run_path(str(ROOT / "tests" / "ui" / "app_server.py"), run_name="__main__")
