#!/usr/bin/env python3
"""Serve the mockups locally with caching off, so a reload always shows the latest."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent / "mockups"
PORT = 8201


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    # A fresh browser asks for every file at once. The default queue of 5 reset some of those connections, which left a page half loaded.
    request_queue_size = 256


if __name__ == "__main__":
    server = Server(("127.0.0.1", PORT), partial(NoCache, directory=str(ROOT)))
    print(f"Mockups at http://127.0.0.1:{PORT}/")
    server.serve_forever()
