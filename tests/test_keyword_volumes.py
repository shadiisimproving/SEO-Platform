"""Keywords, Track C (plan-seo-command-center-mickaz-missing-features-geo-keywords-2026-11-20.md): search volume from a file or
Bing, always with its source; Search Console's daily line for the row's sparkline; one chart line per ranking page; links
found by a tool as markers. Made-up sites only (seo-command-center-no-own-data-in-repo)."""
from datetime import date, datetime, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import http
from seo.collectors.common import digest
from seo.core.errors import Refused
from seo.imports import keyword_volumes as kv
from seo.links import service as links
from seo.metrics import keyword_timeline as kt
from seo.serp import rankings, store, volumes
from seo.sources import service
from seo.web import create_app
from seo.worker.runner import RunAgain

ME = "volumes-me.example"
ALLOW = lambda url: True  # noqa: E731


@pytest.fixture
def key(tmp_path, monkeypatch):
    from seo.core import crypto
    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)
    return path


@pytest.fixture
def site(engine):
    return links.add_site(engine, f"https://{ME}/", "own", is_allowed=ALLOW)["id"]


def track(engine, site, keyword, country="FR", language="fr"):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, :l)"), {"k": keyword, "h": store.keyword_hash(keyword), "c": country, "l": language})
        kid = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = :c"), {"h": store.keyword_hash(keyword), "c": country}).scalar_one()
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
    return kid


def row_of(engine, site, keyword):
    return next(r for r in rankings.listing(engine, site)["rows"] if r["keyword"] == keyword)


# ---- files ----------------------------------------------------------------------------------------------------------

def test_a_plain_csv_with_english_or_french_headings(engine, site):
    track(engine, site, "Sofa repair")
    answer = kv.upload(engine, "volumes-tool.csv", "Keyword,Volume,Country,Month\nsofa repair,1,300,FR,2026-10\n".replace("1,300", '"1,300"').encode(), "Ana")
    assert answer == {"name": "volumes-tool.csv", "keywords": 1, "rows": 1, "skipped": 0}
    vol = row_of(engine, site, "Sofa repair")["search_volume"]
    assert vol["searches"] == 1300 and vol["source"] == "file" and vol["name"] == "volumes-tool.csv" and vol["month"] == "2026-10"
    kv.upload(engine, "outil.csv", "Mot-clé;Volume\nsofa repair;800\n".encode(), "Ana")
    assert kv.read("x.csv", "Mot-clé;Volume\ncanapé;1 200\n".encode())["rows"] == [("canapé", "", "", 1200)]


def test_keyword_planner_utf16_month_columns_and_ranges(engine, site):
    body = "Keyword Stats 2026-11-01\nAll locations\nKeyword\tAvg. monthly searches\tSearches: Sep 2026\tSearches: Oct 2026\nsofa repair\t1K – 10K\t900\t1100\nchair glue\t1K – 10K\t\t\n"
    found = kv.read("Keyword Stats.csv", b"\xff\xfe" + body.encode("utf-16-le"))
    assert found["rows"] == [("sofa repair", "", "2026-09", 900), ("sofa repair", "", "2026-10", 1100)]
    assert found["skipped"] == 1  # a range only: never turned into a guess
    with pytest.raises(Refused, match="No keyword column"):
        kv.read("x.csv", b"Word,Volume\nsofa,10\n")
    with pytest.raises(Refused, match="1K"):
        kv.read("x.csv", "Keyword,Volume\nsofa,1K – 10K\n".encode())
    with pytest.raises(Refused, match="CSV"):
        kv.read("x.xlsx", b"PK")


def test_the_same_file_name_replaces_its_rows_and_can_be_removed(engine, site):
    track(engine, site, "sofa repair")
    kv.upload(engine, "tool.csv", b"Keyword,Volume\nsofa repair,100\nold word,5\n", None)
    kv.upload(engine, "tool.csv", b"Keyword,Volume\nsofa repair,200\n", None)
    assert row_of(engine, site, "sofa repair")["search_volume"]["searches"] == 200
    assert [f["keywords"] for f in volumes.sources(engine)["files"]] == [1]
    assert volumes.remove_file(engine, "tool.csv") == 1
    assert row_of(engine, site, "sofa repair")["search_volume"] is None
    with pytest.raises(Refused):
        volumes.remove_file(engine, "tool.csv")


def test_a_file_beats_bing_and_the_keyword_country_beats_none(engine, site):
    track(engine, site, "sofa repair", country="FR")
    with engine.begin() as conn:
        volumes.save(conn, "sofa repair", "bing", "", "FR", "fr", "2026-09", 70, None)
        volumes.save(conn, "Sofa  Repair", "bing", "", "FR", "fr", "2026-10", 90, None)  # the same keyword however it's typed
    vol = row_of(engine, site, "sofa repair")["search_volume"]
    assert (vol["source"], vol["searches"], vol["month"]) == ("bing", 90, "2026-10")
    assert vol["months"] == [{"month": "2026-09", "searches": 70}, {"month": "2026-10", "searches": 90}]
    kv.upload(engine, "world.csv", b"Keyword,Volume\nsofa repair,5000\n", None)
    kv.upload(engine, "spain.csv", b"Keyword,Volume,Country\nsofa repair,7,ES\n", None)  # another country never counts
    kv.upload(engine, "france.csv", b"Keyword,Volume,Country\nsofa repair,400,FR\n", None)
    vol = row_of(engine, site, "sofa repair")["search_volume"]
    assert (vol["source"], vol["name"], vol["searches"]) == ("file", "france.csv", 400)


def test_impressions_are_never_volume(engine, site):
    track(engine, site, "sofa repair")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'sofa repair', 1, 500, 4)"),
                     {"s": site, "d": date(2026, 11, 10), "h": digest("sofa repair")})
    row = row_of(engine, site, "sofa repair")
    assert row["impressions"] == 500 and row["search_volume"] is None and "volume" not in row


# ---- Bing ---------------------------------------------------------------------------------------------------------

def _ms(day: date) -> str:
    return f"/Date({int(datetime(day.year, day.month, day.day).timestamp() * 1000)})/"


class Job:
    def __init__(self, payload):
        self.payload, self.id, self.attempts = payload, 1, 1


def test_bing_needs_its_key_and_reads_months_on_a_click_only(engine, site, key, monkeypatch):
    kid = track(engine, site, "sofa repair")
    track(engine, site, "chair glue")
    with pytest.raises(Refused, match="Bing Webmaster key"):
        volumes.start_bing(engine, site, "Ana")
    service.save_app_key(engine, "bing", "bing-key-1234")
    asked = []

    def fake(request: httpx.Request):
        asked.append(dict(request.url.params))
        if request.url.params["q"] == "chair glue":
            return httpx.Response(200, json={"d": []})
        return httpx.Response(200, json={"d": [
            {"Date": _ms(date(2026, 9, 7)), "Query": "sofa repair", "Impressions": 40, "BroadImpressions": 90},
            {"Date": _ms(date(2026, 9, 14)), "Query": "sofa repair", "Impressions": 20, "BroadImpressions": 50},
            {"Date": _ms(date(2026, 10, 5)), "Query": "sofa repair", "Impressions": 30, "BroadImpressions": 60},
        ]})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    assert volumes.start_bing(engine, site, "Ana")["queued"] is True
    assert volumes.start_bing(engine, site, "Ana")["queued"] is False  # one at a time per site
    volumes.run(Job({"site_id": site, "by": "Ana"}), engine)
    assert {a["q"] for a in asked} == {"sofa repair", "chair glue"}
    assert asked[0]["country"] == "fr" and asked[0]["language"] == "fr-FR"
    vol = row_of(engine, site, "sofa repair")["search_volume"]
    assert (vol["source"], vol["searches"], vol["month"]) == ("bing", 30, "2026-10")
    assert vol["months"] == [{"month": "2026-09", "searches": 60}, {"month": "2026-10", "searches": 30}]
    assert row_of(engine, site, "chair glue")["search_volume"] is None  # Bing had nothing: unknown, never 0
    asked.clear()
    volumes.run(Job({"site_id": site, "by": "Ana"}), engine)
    assert asked == []  # both were asked this week
    assert volumes.sources(engine)["bing"]["keywords"] == 1 and kid


def test_bing_refusing_the_key_stops_and_an_outage_waits(engine, site, key, monkeypatch):
    track(engine, site, "sofa repair")
    service.save_app_key(engine, "bing", "bing-key-1234")
    monkeypatch.setattr(http, "transport", httpx.MockTransport(lambda r: httpx.Response(401, json={"message": "bad key"})))
    volumes.run(Job({"site_id": site}), engine)
    assert "refused" in service.app_key_status(engine, "bing")["last_error"]
    monkeypatch.setattr(http, "transport", httpx.MockTransport(lambda r: httpx.Response(503)))
    with pytest.raises(RunAgain):
        volumes.run(Job({"site_id": site}), engine)


def test_the_routes(engine, site, key):
    app = create_app(engine, auth=False)
    client = app.test_client()
    track(engine, site, "sofa repair")
    import io
    answer = client.post("/api/keyword-volumes/file", data={"file": (io.BytesIO(b"Keyword,Volume\nsofa repair,42\n"), "tool.csv")}, content_type="multipart/form-data")
    assert answer.status_code == 201 and answer.get_json()["keywords"] == 1
    assert client.get("/api/keyword-volumes").get_json()["files"][0]["name"] == "tool.csv"
    assert client.post("/api/keyword-volumes/bing", json={"site_id": site}).status_code == 400  # no Bing key yet
    assert client.delete("/api/keyword-volumes/file?name=tool.csv").get_json() == {"removed": 1}


# ---- the row's sparkline, the panel's lines and markers -------------------------------------------------------

def test_search_console_daily_line_for_the_sparkline(engine, site):
    track(engine, site, "sofa repair", country="FR")
    last = date(2026, 11, 16)
    with engine.begin() as conn:
        for n, (p, i) in enumerate([(9, 10), (7, 30), (5, 10)]):
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'sofa repair', 0, :i, :p)"),
                         {"s": site, "d": last - timedelta(days=2 - n), "h": digest("sofa repair"), "i": i, "p": p})
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'sofa repair', 0, 0, 50)"),
                     {"s": site, "d": last - timedelta(days=5), "h": digest("sofa repair")})  # no impressions: no point
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'sofa repair', 0, 9, 1)"),
                     {"s": site, "d": last - timedelta(days=40), "h": digest("sofa repair")})  # before the 28 days
    daily = row_of(engine, site, "sofa repair")["gsc_daily"]
    assert daily == [{"day": "2026-11-14", "p": 9.0}, {"day": "2026-11-15", "p": 7.0}, {"day": "2026-11-16", "p": 5.0}]
    # France's own rows, once they reach the first of the 28 days, are the line instead.
    with engine.begin() as conn:
        for n in range(28):
            conn.execute(text("INSERT INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) VALUES (:s, :d, 'fra', :h, 'sofa repair', 0, 5, 3)"),
                         {"s": site, "d": last - timedelta(days=n), "h": digest("sofa repair")})
    daily = row_of(engine, site, "sofa repair")["gsc_daily"]
    assert len(daily) == 28 and {p["p"] for p in daily} == {3.0}


def test_one_line_per_ranking_page_and_found_links_as_markers(engine, site):
    kid = track(engine, site, "sofa repair")
    pages = {"a": f"https://{ME}/sofa/", "b": f"https://{ME}/blog/sofa/"}
    with engine.begin() as conn:
        for day, page, p, i in [(date(2026, 9, 1), pages["a"], 6, 80), (date(2026, 9, 2), pages["a"], 4, 40), (date(2026, 9, 2), pages["b"], 12, 10), (date(2026, 9, 2), pages["b"] + "?utm_source=x", 14, 10)]:
            conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, 'sofa repair', :pg, 0, :i, :p)"),
                         {"s": site, "d": day, "h": digest("sofa repair", page), "pg": page, "i": i, "p": p})
            conn.execute(text("INSERT IGNORE INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'sofa repair', 0, 1, 5)"),
                         {"s": site, "d": day, "h": digest("sofa repair")})
        conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, target_url, status, anchor, created_at) VALUES (:s, 'https://found.example/x', 'found.example', :t, 'found', 'sofa', '2026-09-05 10:00:00')"), {"s": site, "t": pages["a"]})
        conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain, target_url, status, anchor, created_at) VALUES (:s, 'https://other.example/x', 'other.example', :t, 'found', 'x', '2026-09-05 10:00:00')"), {"s": site, "t": f"https://{ME}/contact/"})
    answer = kt.timeline(engine, site, kid, date(2026, 8, 20), date(2026, 11, 17))
    lines = answer["url_lines"]
    assert [line["url"] for line in lines] == [pages["a"], pages["b"]]  # the tagged copy is the same page
    assert lines[0]["points"] == [{"day": "2026-09-01", "p": 6.0, "impressions": 80}, {"day": "2026-09-02", "p": 4.0, "impressions": 40}]
    assert lines[1]["points"] == [{"day": "2026-09-02", "p": 13.0, "impressions": 20}]
    found = [m for m in answer["markers"] if m["kind"] == "found"]
    assert [(m["text"], m["day"]) for m in found] == [("found.example", "2026-09-05")]  # a link to another page stays out


def test_the_panel_lines_say_which_page_each_check_found(engine, site):
    kid = track(engine, site, "sofa repair", country="")
    with engine.begin() as conn:
        target = conn.execute(text("INSERT INTO serp_targets (keyword_id, engine, device) VALUES (:k, 'google', 'desktop')"), {"k": kid}).lastrowid
        for n, url in enumerate([f"https://{ME}/sofa/?srsltid=abc", f"https://{ME}/blog/sofa/"]):
            check = conn.execute(text("INSERT INTO serp_checks (target_id, tool, real_location, depth, status, ai_state, checked_at) VALUES (:t, 'SerpApi', '', 10, 'ok', 'absent', :at)"),
                                 {"t": target, "at": datetime(2026, 11, 12 + n, 9)}).lastrowid
            conn.execute(text("INSERT INTO serp_results (check_id, position, url, host, domain) VALUES (:c, :p, :u, :h, :h)"), {"c": check, "p": 3 + n, "u": url, "h": ME})
    detail = rankings.detail(engine, site, kid, "google")
    points = detail["lines"][0]["points"]
    assert [p["url"] for p in points] == [f"https://{ME}/sofa/", f"https://{ME}/blog/sofa/"]
