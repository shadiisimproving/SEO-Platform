"""A fixture website for the whole-site scan tests, and a worker test_whole_site_scans runs as a separate process and kills with -9."""
import sys
import time

import httpx

from seo.core.db import make_engine
from seo.crawl.fetch import PoliteFetcher
from seo.links import service as links
from seo.worker.runner import tick

HOME = "https://shop.example/"
TEXT = "An ordinary paragraph of readable text about coffee, how it is roasted and how it gets delivered. " * 3


def good(name: str, title=None, description=None, h1=None, text_=TEXT, links_=()) -> str:
    """A page with nothing wrong with it, unless an argument says otherwise."""
    title = name if title is None else title
    description = f"About {name}" if description is None else description
    headings = (name,) if h1 is None else h1
    anchors = "".join(f'<a href="{href}">{href}</a>' for href in links_)
    return (
        f'<!doctype html><html lang="en"><head><title>{title}</title>'
        + (f'<meta name="description" content="{description}">' if description else "") + "</head><body><main>"
        + "".join(f"<h1>{h}</h1>" for h in headings) + f"<p>{text_}</p>{anchors}</main></body></html>"
    )


def big_site(pages: int) -> dict:
    """/ and /p1 to /pN. Page n links to the two pages after it, so the crawl has to find its way to all of them."""
    site = {}
    for n in range(pages + 1):
        children = tuple(f"/p{m}" for m in (n * 2 + 1, n * 2 + 2) if m <= pages)
        path = "/" if n == 0 else f"/p{n}"
        site[path] = good(f"Page {n}", links_=children)
    return site


def chunks_of(pages: int):
    """A chunk's clock that says time is up after this many pages, however fast the fake internet answers."""

    def clock():
        left = iter(range(pages - 1))
        return lambda: next(left, None) is None

    return clock


def answer(request: httpx.Request) -> httpx.Response:
    time.sleep(0.05)  # so the test can kill this process part way through a chunk
    path = request.url.raw_path.decode()
    if path == "/robots.txt":
        return httpx.Response(200, text="User-agent: *\n", headers={"content-type": "text/plain"})
    page = SITE.get(path)
    return httpx.Response(200, html=page) if page else httpx.Response(404, text="An error page")


SITE = big_site(30)

if __name__ == "__main__":
    engine = make_engine(test=True)
    links.fetcher_factory = lambda: PoliteFetcher(delay=0, is_allowed=lambda url: True, transport=httpx.MockTransport(answer))
    links.time_up_factory = chunks_of(3)
    tick(engine, "crawl", lock_dir=sys.argv[1], lease_seconds=2, heartbeat_seconds=600, budget_seconds=600)
