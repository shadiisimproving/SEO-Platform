"""Finding a site's pages from its sitemaps, without ever raising."""
import gzip
from dataclasses import dataclass

from seo.crawl.sitemap import discover, parse_sitemap

BASE = "https://www.example.com"


def urlset(*urls, lastmod="2026-10-01"):
    rows = "".join(f"<url><loc>{u}</loc><lastmod>{lastmod}</lastmod></url>" for u in urls)
    return f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>'.encode()


def index(*urls):
    rows = "".join(f"<sitemap><loc>{u}</loc></sitemap>" for u in urls)
    return f'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</sitemapindex>'.encode()


@dataclass
class Fake:
    status: str
    body: bytes | None = None


class FakeFetcher:
    def __init__(self, pages, robots=()):
        self.pages = pages
        self.robots = list(robots)
        self.asked = []

    def sitemaps_from_robots(self, base):
        return self.robots

    def get(self, url, any_type=False):
        self.asked.append(url)
        body = self.pages.get(url)
        return Fake("ok", body) if body is not None else Fake("gone")


def test_parse_reads_urls_and_lastmod():
    parsed = parse_sitemap(urlset(f"{BASE}/a"))
    assert parsed["type"] == "urlset"
    assert parsed["entries"][0]["loc"] == f"{BASE}/a"
    assert parsed["entries"][0]["lastmod"] == "2026-10-01"


def test_parse_marks_broken_xml_as_an_error():
    assert parse_sitemap(b"<not xml")["type"] == "error"


def test_parse_does_not_expand_external_entities():
    evil = b'<?xml version="1.0"?><!DOCTYPE u [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>&x;</loc></url></urlset>'
    parsed = parse_sitemap(evil)
    assert "root:" not in str(parsed)


def test_uses_sitemaps_listed_in_robots_first():
    fetcher = FakeFetcher({f"{BASE}/from-robots.xml": urlset(f"{BASE}/a")}, robots=[f"{BASE}/from-robots.xml"])
    result = discover(fetcher, BASE)
    assert [e.url for e in result.entries] == [f"{BASE}/a"]
    assert result.sources == [f"{BASE}/from-robots.xml"]


def test_falls_back_to_common_paths():
    fetcher = FakeFetcher({f"{BASE}/wp-sitemap.xml": urlset(f"{BASE}/a")})
    assert [e.url for e in discover(fetcher, BASE).entries] == [f"{BASE}/a"]


def test_index_is_followed_to_its_children():
    fetcher = FakeFetcher(
        {
            f"{BASE}/sitemap.xml": index(f"{BASE}/one.xml", f"{BASE}/two.xml"),
            f"{BASE}/one.xml": urlset(f"{BASE}/a"),
            f"{BASE}/two.xml": urlset(f"{BASE}/b"),
        }
    )
    assert sorted(e.url for e in discover(fetcher, BASE).entries) == [f"{BASE}/a", f"{BASE}/b"]


def test_page_cap_stops_reading_more_sitemaps():
    fetcher = FakeFetcher(
        {
            f"{BASE}/sitemap.xml": index(f"{BASE}/one.xml", f"{BASE}/two.xml"),
            f"{BASE}/one.xml": urlset(*[f"{BASE}/p{i}" for i in range(10)]),
            f"{BASE}/two.xml": urlset(f"{BASE}/never"),
        }
    )
    result = discover(fetcher, BASE, max_pages=5)
    assert len(result.entries) == 5
    assert f"{BASE}/two.xml" not in fetcher.asked
    assert result.capped is True


def test_index_loop_terminates():
    fetcher = FakeFetcher({f"{BASE}/sitemap.xml": index(f"{BASE}/sitemap.xml")})
    assert discover(fetcher, BASE).entries == []


def test_gzip_sitemap_is_read():
    fetcher = FakeFetcher({f"{BASE}/sitemap.xml": gzip.compress(urlset(f"{BASE}/a"))})
    assert [e.url for e in discover(fetcher, BASE).entries] == [f"{BASE}/a"]


def test_broken_sitemap_is_reported_not_raised():
    fetcher = FakeFetcher({f"{BASE}/sitemap.xml": b"<nope"})
    result = discover(fetcher, BASE)
    assert result.entries == []
    assert f"{BASE}/sitemap.xml" in result.errors


def test_no_sitemap_at_all_returns_an_empty_result():
    result = discover(FakeFetcher({}), BASE)
    assert result.entries == []
    assert result.sources == []


def test_pages_on_other_domains_are_ignored_but_www_is_kept():
    fetcher = FakeFetcher(
        {f"{BASE}/sitemap.xml": urlset(f"{BASE}/a", "https://example.com/b", "https://other.com/c")}
    )
    assert {e.url for e in discover(fetcher, BASE).entries} == {f"{BASE}/a", "https://example.com/b"}


def test_duplicate_urls_are_kept_once():
    fetcher = FakeFetcher({f"{BASE}/sitemap.xml": urlset(f"{BASE}/a", f"{BASE}/a")})
    assert len(discover(fetcher, BASE).entries) == 1


def test_lastmod_is_kept_on_entries():
    fetcher = FakeFetcher({f"{BASE}/sitemap.xml": urlset(f"{BASE}/a")})
    assert discover(fetcher, BASE).entries[0].lastmod == "2026-10-01"
