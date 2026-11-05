"""The crawl measurement: its numbers must be right, or the plan's estimates are wrong."""
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from sqlalchemy import text

from seo.crawl.fetch import PoliteFetcher
from seo.crawl.spike import choose_pages, crawl_domain, scale_estimate


class Mini:
    """Three pages: one that answers 304, one whose text changes, one that blocks us."""

    def __init__(self):
        self.visits = {"/changing": 0}
        mini = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send(self, code, body=b"", headers=None):
                self.send_response(code)
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                html = {"Content-Type": "text/html; charset=utf-8"}
                if self.path == "/robots.txt":
                    self.send(200, b"User-agent: *\n", {"Content-Type": "text/plain"})
                elif self.path == "/sitemap.xml":
                    rows = "".join(
                        f"<url><loc>{mini.base}{p}</loc></url>" for p in ("/stable", "/changing", "/blocked")
                    )
                    body = f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>'
                    self.send(200, body.encode(), {"Content-Type": "application/xml"})
                elif self.path == "/stable":
                    if self.headers.get("If-None-Match") == '"s1"':
                        self.send(304)
                    else:
                        page = b"<html><body><main><p>Texte stable</p></main></body></html>"
                        self.send(200, page, {**html, "ETag": '"s1"'})
                elif self.path == "/changing":
                    mini.visits["/changing"] += 1
                    page = f"<html><body><main><p>Version {mini.visits['/changing']}</p></main></body></html>"
                    self.send(200, page.encode(), html)
                else:
                    self.send(403, b"no", html)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@pytest.fixture
def mini():
    server = Mini()
    yield server
    server.server.shutdown()


def test_two_passes_measure_baseline_unchanged_changed_and_blocked(engine, mini):
    fetcher = PoliteFetcher(delay=0.01, is_allowed=lambda url: url.startswith(mini.base))
    report = crawl_domain(engine, mini.base, pages=10, passes=2, fetcher=fetcher)

    assert report["sitemap_pages"] == 3
    first, second = report["passes"]
    assert first["outcomes"] == {"baseline": 2, "blocked": 1}
    assert second["outcomes"] == {"not_modified": 1, "changed": 1, "blocked": 1}
    assert first["pages"] == 3
    assert second["not_modified_rate"] == pytest.approx(1 / 3, abs=0.01)
    assert second["blocked_rate"] == pytest.approx(1 / 3, abs=0.01)
    assert first["seconds_per_page"] > 0
    assert first["parse_cpu_ms_per_page"] > 0
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM pages")).scalar() == 3
        assert conn.execute(text("SELECT COUNT(*) FROM change_events WHERE kind='content'")).scalar() == 1


def test_site_with_no_sitemap_is_reported_not_crashed(engine):
    fetcher = PoliteFetcher(delay=0.01, is_allowed=lambda url: False)
    report = crawl_domain(engine, "http://127.0.0.1:1", pages=10, passes=1, fetcher=fetcher)
    assert report["sitemap_pages"] == 0
    assert report["note"]


def test_choose_pages_spreads_across_the_site_rather_than_taking_the_first_section():
    urls = [f"/p{i}" for i in range(1000)]
    chosen = choose_pages(urls, 10)
    assert len(chosen) == 10
    assert chosen[0] == "/p0"
    assert chosen[-1] >= "/p900" or int(chosen[-1][2:]) >= 900


def test_choose_pages_returns_everything_when_there_are_few():
    assert choose_pages(["/a", "/b"], 10) == ["/a", "/b"]


def test_scale_estimate_for_the_planned_budget():
    estimate = scale_estimate(
        seconds_per_page=3.2, cpu_ms_per_page=20.0, not_modified_rate=0.5, db_bytes_per_1000_pages=10_000_000
    )
    # 40,000 pages at 4 domains at once, 3.2 s each.
    assert estimate["crawl_hours_per_day"] == pytest.approx(40_000 * 3.2 / 4 / 3600, abs=0.01)
    assert estimate["cpu_minutes_per_day"] == pytest.approx(40_000 * 20 / 1000 / 60, abs=0.01)
    assert estimate["baseline_db_mb"] == pytest.approx(400, abs=1)
