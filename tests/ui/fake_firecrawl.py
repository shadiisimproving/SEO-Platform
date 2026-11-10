"""A fake Firecrawl and two made-up competitors it helps with, for trying the reading hints by hand. No real call.

- spa-rival.example: every page is an empty JavaScript shell to the app's reader. Firecrawl "renders" the real text.
- nomap-rival.example: no sitemap, so the app only finds its home page's links. Firecrawl's list finds the deeper pages.

Paste any key starting with fc- in Settings → Firecrawl. The fake has 936 of 1,000 credits and spends one per call.
"""
from __future__ import annotations

import json

import httpx

from seo.collectors import http
from seo.competitors import firecrawl
from tests.ui.demo_world import page_html

SPA, NOMAP = "spa-rival.example", "nomap-rival.example"
SHELL = '<!doctype html><html><head><title>Loading…</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
SPA_PAGES = ("/", "/pricing", "/free-zones", "/visas")
NOMAP_LINKED = ("/", "/services", "/contact")
NOMAP_DEEP = ("/guides/mainland-company", "/guides/free-zone-costs", "/blog/golden-visa-2026")


class FakeFirecrawl:
    def __init__(self):
        self.left, self.of = 936, 1000
        self.rendered = {f"https://{SPA}{path}": page_html(f"Rival app {path}", "Company setup made simple.", f"Rival {path}", ("Prices", "Steps"), 700) for path in SPA_PAGES}
        for path in (*NOMAP_LINKED, *NOMAP_DEEP):
            self.rendered[f"https://{NOMAP}{path}"] = page_html(f"No-map {path}", "", f"No-map {path}", ("Guide",), 500)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if not request.headers.get("authorization", "").startswith("Bearer fc-"):
            return httpx.Response(401, json={"success": False, "error": "Unauthorized"})
        path = request.url.path
        if path == "/v2/team/credit-usage":
            return httpx.Response(200, json={"success": True, "data": {"remainingCredits": self.left, "planCredits": self.of, "billingPeriodEnd": "2026-11-20T08:47:38.727Z"}})
        if self.left < 1:
            return httpx.Response(402, json={"success": False, "error": "Payment required"})
        body = json.loads(request.content or b"{}")
        self.left -= 1
        if path == "/v2/map":
            host = httpx.URL(body["url"]).host.removeprefix("www.")
            return httpx.Response(200, json={"success": True, "links": [{"url": url} for url in self.rendered if httpx.URL(url).host == host]})
        if path == "/v2/scrape":
            html = self.rendered.get(body["url"].rstrip("/") or body["url"]) or self.rendered.get(body["url"])
            meta = {"statusCode": 200 if html else 404, "url": body["url"]}
            return httpx.Response(200, json={"success": True, "data": {"rawHtml": html or "", "metadata": meta}})
        return httpx.Response(404, json={"success": False, "error": "Not found"})


def install(websites) -> FakeFirecrawl:
    """Adds the two sites to the fake internet, and answers Firecrawl's calls, including Settings → Test."""
    pages = websites.pages
    for path in SPA_PAGES:
        pages[f"{SPA}{path}"] = SHELL
    pages[f"{SPA}/robots.txt"] = "User-agent: *\nAllow: /\n"
    pages[f"{SPA}/sitemap.xml"] = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>https://{SPA}{p}</loc></url>" for p in SPA_PAGES) + "</urlset>"
    pages[f"{NOMAP}/robots.txt"] = "User-agent: *\nAllow: /\n"
    pages[f"{NOMAP}/"] = page_html("No-map rival", "", "No-map rival", ("About",), 400, links_to=NOMAP_LINKED[1:])
    for path in (*NOMAP_LINKED[1:], *NOMAP_DEEP):
        pages[f"{NOMAP}{path}"] = page_html(f"No-map {path}", "", f"No-map {path}", ("Guide",), 500)

    fake = FakeFirecrawl()
    firecrawl.transport = httpx.MockTransport(fake)
    before = http.transport

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.firecrawl.dev":
            return fake(request)
        return before.handle_request(request) if before else httpx.Response(404)

    http.transport = httpx.MockTransport(answer)
    return fake
