"""For driving the links checker by hand in a browser, with a real server and worker.

Starts, on this machine only:
- a fixture website on 127.0.0.1:8203. `localhost:8203` plays another website.
- the app on 127.0.0.1:8202, using the test database, which it empties first.
- a worker that picks up scans, as cron does on hosting.

Run: .venv/bin/python tests/ui/links_server.py
No real website is contacted. The fixture records every request at /__hits.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from seo.core.db import make_engine  # noqa: E402
from seo.core.schema import upgrade_to_head  # noqa: E402
from seo.crawl.fetch import PoliteFetcher  # noqa: E402
from seo.links import service  # noqa: E402
from seo.web import create_app  # noqa: E402
from seo.worker.runner import tick  # noqa: E402

SITE_PORT, APP_PORT = 8203, 8202
OFF_SITE = f"http://localhost:{SITE_PORT}"
HITS: list[str] = []
LOCAL_HOSTS = {"127.0.0.1", "localhost"}


def links(*hrefs: str) -> bytes:
    return ("<html><body>" + "".join(f'<a href="{h}">link</a>' for h in hrefs) + "</body></html>").encode()


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code: int, body: bytes = b"", headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        host = (self.headers.get("Host") or "").split(":")[0]
        path = self.path
        if path == "/__hits":
            return self.send(200, json.dumps(HITS).encode(), {"Content-Type": "application/json"})
        HITS.append(f"{host}{path}")
        if path == "/robots.txt":
            return self.send(200, b"User-agent: *\nDisallow: /private\n", {"Content-Type": "text/plain"})
        if host == "localhost":  # another website
            if path == "/landing":
                return self.send(200, links(f"{OFF_SITE}/deeper-off-site"))
            if path == "/ok":
                return self.send(200, links(f"{OFF_SITE}/never-read"))
            if path == "/gone":
                return self.send(404)
            if path == "/blocked":
                return self.send(403)
            if path == "/bot-wall":
                return self.send(999)
            return self.send(404)
        if path == "/":
            many = [f"/p{i}" for i in range(1, 41)]
            body = links(
                "/about", "/about?utm_source=news", "/about?utm_medium=mail#top", "/gone", "/removed", "/server-error",
                "/chain1", "/away", "/private/secret", "/slow", f"{OFF_SITE}/ok", f"{OFF_SITE}/gone", f"{OFF_SITE}/blocked", f"{OFF_SITE}/bot-wall", *many,
            ) + b'<img src="/missing-image.png"><script>var x = "<a href=/from-js>x</a>";</script>'
            return self.send(200, body)
        if path == "/about":
            return self.send(200, links("/gone", f"{OFF_SITE}/gone"))
        if path == "/gone":
            return self.send(404)
        if path == "/removed":
            return self.send(410)
        if path == "/server-error":
            return self.send(500)
        if path == "/chain1":
            return self.send(301, b"", {"Location": "/chain2"})
        if path == "/chain2":
            return self.send(301, b"", {"Location": "/chain3"})
        if path == "/chain3":
            return self.send(301, b"", {"Location": "/about"})
        if path == "/away":
            return self.send(302, b"", {"Location": f"{OFF_SITE}/landing"})
        if path == "/slow":
            time.sleep(5.3)
            return self.send(200, links())
        if path.startswith("/p"):
            return self.send(200, links("/gone"))
        return self.send(404)


def main() -> None:
    engine = make_engine(test=True)
    assert engine.url.database.endswith("_test"), "refusing to reset a non-test database"
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for (table,) in conn.execute(text("SHOW TABLES")).all():
            conn.execute(text(f"DROP TABLE `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    upgrade_to_head(engine)

    only_this_machine = lambda url: urlsplit(url).hostname in LOCAL_HOSTS  # noqa: E731
    service.fetcher_factory = lambda: PoliteFetcher(delay=0.35, is_allowed=only_this_machine)

    ThreadingHTTPServer.allow_reuse_address = True
    threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", SITE_PORT), Fixture).serve_forever, daemon=True).start()

    def worker():
        while True:
            tick(engine, "crawl", lock_dir=ROOT / "var" / "locks-ui", budget_seconds=5, db_wait_seconds=1)
            time.sleep(0.4)

    threading.Thread(target=worker, daemon=True).start()
    app = create_app(engine=engine, url_allowed=lambda url: True, screens_dir=ROOT / "design" / "mockups", auth=False)
    print(f"app on http://127.0.0.1:{APP_PORT}/  fixture site http://127.0.0.1:{SITE_PORT}/", flush=True)
    app.run(host="127.0.0.1", port=APP_PORT, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
