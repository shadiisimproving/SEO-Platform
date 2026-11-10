"""Search Console per country, AI Overviews in the numbers, the page's own words in findings, Google's AI report upload, and
Today in the reader's language with each source's true state. Made-up sites and rows only."""
import io
import json
import zipfile
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, gsc, http
from seo.collectors.common import digest
from seo.core.errors import Refused
from seo.imports import gsc_ai_report
from seo.insights import aio, engine as insights, onpage, rules
from seo.insights.finding import Finding
from seo.metrics import search, today
from seo.serp import rankings, store
from seo.sources import credentials
from seo.web import create_app

END = date(2026, 11, 1)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('site-one.example', 'https://site-one.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from) VALUES (:s, 'gsc', :d, :f)"), {"s": site_id, "d": END, "f": END + timedelta(days=1)})
    return site_id


def _country_clicks(engine, site, country, clicks, day=END):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_country (site_id, day, country, clicks, impressions, position) VALUES (:s, :d, :c, :k, 100, 5)"), {"s": site, "d": day, "c": country, "k": clicks})


def _query_country(engine, site, day, country, query, clicks, shown, position):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO gsc_query_country (site_id, day, country, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :c, :h, :q, :k, :i, :p)"),
            {"s": site, "d": day, "c": country, "h": digest(query), "q": query, "k": clicks, "i": shown, "p": position},
        )


# ---- which countries ----------------------------------------------------------------------------------


def test_target_countries_are_the_top_one_or_two_by_clicks_unless_chosen(engine, site):
    assert gsc.target_countries(engine, site) == {"countries": [], "chosen": False}
    _country_clicks(engine, site, "fra", 100)
    _country_clicks(engine, site, "bel", 20)
    _country_clicks(engine, site, "che", 5)
    assert gsc.target_countries(engine, site) == {"countries": ["fra"], "chosen": False}  # Belgium has under a quarter of France
    _country_clicks(engine, site, "bel", 10, day=END - timedelta(days=1))
    assert gsc.target_countries(engine, site)["countries"] == ["fra", "bel"]
    answer = search.set_countries(engine, site, ["FR"])
    assert answer["chosen"] is True and [c["key"] for c in answer["countries"]] == ["fra"] and answer["top"][0]["code"] == "FR"
    assert gsc.target_countries(engine, site) == {"countries": ["fra"], "chosen": True}
    with pytest.raises(Refused):
        search.set_countries(engine, site, ["Narnia"])
    with pytest.raises(Refused):
        search.set_countries(engine, site, ["fr", "be", "ch", "es"])
    assert search.set_countries(engine, site, [])["chosen"] is False  # back to automatic


def test_the_collector_reads_queries_for_each_target_country_and_again_when_they_change(engine, site, monkeypatch, tmp_path):
    from seo.core import crypto
    from seo.sources import service as sources

    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)
    asked = []

    def fake(request):
        body = json.loads(request.content)
        end = date.fromisoformat(body["endDate"])
        if body["dimensions"] == ["date"]:
            return httpx.Response(200, json={"rows": [{"keys": [(end - timedelta(days=n)).isoformat()], "clicks": 10, "impressions": 100, "position": 7.0} for n in range(3)]})
        if body["dimensions"] == ["country"]:
            return httpx.Response(200, json={"rows": [{"keys": ["fra"], "clicks": 9, "impressions": 90, "position": 6.0}, {"keys": ["bel"], "clicks": 1, "impressions": 10, "position": 9.0}]})
        filters = body.get("dimensionFilterGroups")
        if filters:
            country = filters[0]["filters"][0]["expression"]
            asked.append((country, body["startDate"], body["rowLimit"]))
            return httpx.Response(200, json={"rows": [{"keys": [f"query in {country}"], "clicks": 2, "impressions": 20, "position": 4.5}]})
        return httpx.Response(200, json={"rows": []})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    monkeypatch.setattr(credentials, "token_override", lambda connection_id: "fake-token")
    connection = sources.add_google(engine, "Team", "robot", {"client_email": "robot@x.iam.gserviceaccount.com", "private_key": "k", "private_key_id": "abcd1234"})
    sources.save_site_source(engine, site, "gsc", {"connection_id": connection["id"], "property": "sc-domain:site-one.example"})
    assert gsc.collect(engine, site) is True  # the country table fills on the way, and the queries of its top country follow
    newest = common.google_today(engine)
    assert {a[0] for a in asked} == {"fra"} and len(asked) == 3 and all(a[2] <= gsc.ROW_LIMIT for a in asked)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM gsc_query_country WHERE site_id = :s AND country = 'fra' AND day = :d"), {"s": site, "d": newest}).scalar() == 1
    asked.clear()
    assert gsc.collect(engine, site) is True
    assert asked == [] or {a[0] for a in asked} == {"fra"}  # only what Google may still revise, no more
    search.set_countries(engine, site, ["fra", "bel"])
    asked.clear()
    assert gsc.collect(engine, site) is True
    assert {a[0] for a in asked} == {"fra", "bel"} and len({a[1] for a in asked}) == 3  # every stored day again, both countries
    assert all(a[2] == gsc.DAY_ROW_BUDGET // 2 for a in asked)  # two countries share Google's 50,000 rows a day


# ---- Keywords: the keyword's own country ---------------------------------------------------------------


def test_keywords_get_the_search_console_position_in_their_own_country_and_impressions_by_name(engine, site):
    with engine.begin() as conn:
        keyword = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES ('sofa repair', :h, 'fr', 'fr')"), {"h": store.keyword_hash("sofa repair")}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": keyword})
        for n in range(3):
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, 'sofa repair', 1, 100, 14)"), {"s": site, "d": END - timedelta(days=n), "h": digest("sofa repair")})
    for n in range(3):
        _query_country(engine, site, END - timedelta(days=n), "fra", "sofa repair", 1, 60, 8.0)
        _query_country(engine, site, END - timedelta(days=n), "usa", "sofa repair", 0, 40, 23.0)
    [row] = rankings.listing(engine, site)["rows"]
    assert row["impressions"] == row["volume"] == 300  # our own 28 days of impressions, under its real name
    assert row["own_country"] == {"country": "FR", "position": 8.0, "impressions": 180, "clicks": 3}
    assert row["engines"]["google"]["own"] == pytest.approx(14.0)  # the world average stays where it was


# ---- Insights: country, AI Overview, the page's own words -----------------------------------------------


def _write(engine, site, day, query, page, clicks, shown, position):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, :i, :p)"), {"s": site, "d": day, "h": digest(query), "n": query, "c": clicks, "i": shown, "p": position})
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, :i, :p)"), {"s": site, "d": day, "h": digest(page), "n": page, "c": clicks, "i": shown, "p": position})
        conn.execute(text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :pg, :c, :i, :p)"), {"s": site, "d": day, "h": digest(query, page), "q": query, "pg": page, "c": clicks, "i": shown, "p": position})
        conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p) ON DUPLICATE KEY UPDATE clicks = clicks + :c, impressions = impressions + :i"), {"s": site, "d": day, "c": clicks, "i": shown, "p": position})


def _found(engine, site, kind):
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text("SELECT query, at_stake, evidence FROM search_findings WHERE site_id = :s AND kind = :k AND status = 'open'"), {"s": site, "k": kind}).mappings().all()]


def test_almost_on_page_one_worldwide_but_on_page_one_in_france_is_not_almost(engine, site):
    for n in range(28):
        _write(engine, site, END - timedelta(days=n), "sofa repair", "https://site-one.example/sofa/", 0, 10, 14.0)
        _query_country(engine, site, END - timedelta(days=n), "fra", "sofa repair", 0, 6, 7.0)
    search.set_countries(engine, site, ["fra"])
    insights.run(engine, site)
    assert not _found(engine, site, "almost")  # position 7 in France: already on page 1 there


def _check(engine, keyword_id, ai_state, cited, at, location="FR"):
    with engine.begin() as conn:
        target = store.target_id(conn, keyword_id, "google")
        check = conn.execute(
            text("INSERT INTO serp_checks (target_id, tool, real_location, depth, status, ai_state, trigger_kind, checked_at) VALUES (:t, 'serpapi', :l, 10, 'ok', :a, 'refresh', :at)"),
            {"t": target, "l": location, "a": ai_state, "at": at},
        ).lastrowid
        if cited:
            conn.execute(text("INSERT INTO ai_citations (check_id, url, host, domain) VALUES (:c, 'https://site-one.example/sofa/', 'site-one.example', 'site-one.example')"), {"c": check})


def _keyword(engine, site, word="sofa repair"):
    with engine.begin() as conn:
        keyword = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:w, :h, 'fr', 'fr')"), {"w": word, "h": store.keyword_hash(word)}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": keyword})
    return keyword


def test_clicks_at_stake_are_lowered_where_an_ai_overview_shows_and_the_finding_says_so(engine, site):
    keyword = _keyword(engine, site)
    with engine.connect() as conn:
        now = conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar()
    found = [Finding("almost", "wins", "sofa repair", query="sofa repair", at_stake=100.0), Finding("almost", "wins", "other", query="other", at_stake=100.0), Finding("page_down", "changed", "/p", page="/p", at_stake=100.0)]
    _check(engine, keyword, "not_captured", False, now - timedelta(days=1))
    aio.lower_stakes(engine, site, found)
    assert [f.at_stake for f in found] == [100.0, 100.0, 100.0]  # "not captured" is never taken as an AI Overview
    _check(engine, keyword, "present", True, now)
    aio.lower_stakes(engine, site, found)
    assert found[0].at_stake == pytest.approx(100 * rules.AI_OVERVIEW_SHARE) and found[0].evidence["ai_overview"]["cited"] is True
    assert found[1].at_stake == 100.0 and found[2].at_stake == 100.0  # another search, and clicks really lost, stay as they are


def test_ai_overview_changes_show_on_today_in_both_languages(engine, site):
    keyword = _keyword(engine, site)
    with engine.connect() as conn:
        now = conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar()
    _check(engine, keyword, "present", True, now - timedelta(days=3))
    _check(engine, keyword, "present", False, now - timedelta(hours=2))
    [row] = [r for r in today.today(engine, site)["todo"] if r["kind"] == "ai_overview"]
    assert row["change"] == "aio_uncited" and row["severity"] == "warn" and row["title"] == "“sofa repair”: Google's AI Overview no longer cites you"
    assert row["words"]["title"] == ["“{keyword}”: Google's AI Overview no longer cites you", {"keyword": "sofa repair"}]
    _check(engine, keyword, "absent", False, now - timedelta(hours=1))
    assert [r["change"] for r in today.today(engine, site)["todo"] if r["kind"] == "ai_overview"] == ["aio_gone"]


def test_a_finding_says_when_the_search_is_not_in_the_pages_title_or_h1(engine, site):
    with engine.begin() as conn:
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('site-one.example')")).lastrowid
        for url, title, h1 in (("https://site-one.example/sofa/", "Sofas for every home", ["Our sofas"]), ("https://site-one.example/repair/", "Sofa repair in town", ["Sofa repair"])):
            from seo.competitors import pages
            conn.execute(
                text("INSERT INTO pages (domain_id, url, url_hash, title, h1, headings, meta_description, content_hash, last_checked_at) VALUES (:d, :u, :h, :t, :h1, '[]', '', 'x', UTC_TIMESTAMP(3))"),
                {"d": domain, "u": url, "h": pages.url_hash(url), "t": title, "h1": json.dumps(h1)},
            )
    found = [Finding("top3", "wins", "sofa repair", query="sofa repair", page="https://site-one.example/sofa"), Finding("top3", "wins", "sofa repair", query="sofa repair", page="https://site-one.example/repair/"), Finding("top3", "wins", "x", query="x", page="https://site-one.example/never-read/")]
    onpage.add(engine, found)
    assert found[0].evidence["on_page"]["title"] is False and found[0].evidence["on_page"]["h1"] is False  # found without its last slash
    assert found[1].evidence["on_page"]["title"] is True and found[1].evidence["on_page"]["h1"] is True
    assert "on_page" not in found[2].evidence  # never read: says nothing, never "missing"


# ---- Google's AI report, uploaded ------------------------------------------------------------------------


def _zip(files: dict) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, body in files.items():
            archive.writestr(name, body)
    return out.getvalue()


EXPORT = {
    "Pages.csv": "Top pages,Impressions\nhttps://site-one.example/sofa/,\"1,240\"\nhttps://site-one.example/repair/,~\nhttps://www.site-one.example/,310\n",
    "Countries.csv": "Country,Impressions\nFrance,1400\nBelgium,150\n",
    "Devices.csv": "Device,Impressions\nMobile,1200\nDesktop,350\nTablet,-\n",
    "Dates.csv": "Date,Impressions\n2026-10-30,500\n2026-10-31,520\n2026-11-01,530\n",
    "Filters.csv": "Filter,Value\nSearch type,Web: text-based\nDate,Last 3 days\n",
}


def test_the_ai_report_zip_is_read_whole_and_a_second_upload_of_the_period_replaces_it(engine, site):
    answer = gsc_ai_report.import_files(engine, site, [("site-one.example-Performance-on-Search-2026-11-03.zip", _zip(EXPORT))])
    assert answer == {**answer, "period_start": "2026-10-30", "period_end": "2026-11-01", "period_known": True, "impressions": 1550, "pages": 3, "replaced": False, "search_type": "web"}
    [row] = gsc_ai_report.latest(engine, [site])["sites"]
    assert [p["key"] for p in row["pages"]] == ["https://site-one.example/sofa/", "https://www.site-one.example/", "https://site-one.example/repair/"]
    assert row["pages"][-1]["impressions"] == 0  # "~" is a zero, as Google says
    assert {d["key"]: d["impressions"] for d in row["devices"]} == {"MOBILE": 1200, "DESKTOP": 350, "TABLET": 0}
    assert gsc_ai_report.import_files(engine, site, [("again.zip", _zip(EXPORT))])["replaced"] is True
    assert gsc_ai_report.latest(engine, [site])["sites"][0]["uploads"] == 1


def test_the_ai_report_reader_takes_french_semicolons_one_tab_and_a_filters_period(engine, site):
    pages = "﻿Pages les plus populaires;Impressions\nhttps://site-one.example/canape/;1 234\nhttps://site-one.example/;~\n".encode("utf-8")
    filters = "Filtre,Valeur\nType de recherche,Web : texte\nDate,28 derniers jours\n".encode("utf-8")
    answer = gsc_ai_report.import_files(engine, site, [("Pages.csv", pages), ("Filtres.csv", filters)], today=date(2026, 11, 10))
    assert answer["impressions"] == 1234 and answer["period_known"] is False
    assert (answer["period_start"], answer["period_end"]) == ("2026-10-12", "2026-11-08")


def test_the_ai_report_reader_refuses_what_it_cannot_trust(engine, site):
    with pytest.raises(Refused, match="generative AI report"):
        gsc_ai_report.import_files(engine, site, [("other.csv", b"Query,Clicks\nsofa,3\n")])
    with pytest.raises(Refused, match="CSV"):
        gsc_ai_report.import_files(engine, site, [("report.xlsx", b"PK\x05\x06" + b"\0" * 18)])
    with pytest.raises(Refused, match="not site-one.example"):
        gsc_ai_report.import_files(engine, site, [("Pages.csv", b"Top pages,Impressions\nhttps://shop-two.example/a/,5\n")])
    with pytest.raises(Refused):
        gsc_ai_report.import_files(engine, "x", [("Pages.csv", b"Top pages,Impressions\n")])


def test_the_ai_report_is_uploaded_through_the_api_and_shows_on_ai_search_data(engine, site):
    client = create_app(engine=engine, auth=False).test_client()
    answer = client.post("/api/search/ai-report", data={"site_id": str(site), "file": (io.BytesIO(_zip(EXPORT)), "export.zip")}, content_type="multipart/form-data")
    assert answer.status_code == 201 and answer.get_json()["impressions"] == 1550
    assert client.get(f"/api/search/ai-report?site_id={site}").get_json()["sites"][0]["countries"][0] == {"key": "France", "impressions": 1400}
    ai = client.get(f"/api/metrics/ai?site_id={site}&from=2026-10-01&to=2026-10-28").get_json()
    assert ai["google_ai"]["impressions"] == 1550 and "pages" not in ai["google_ai"]["sites"][0]
    assert client.post("/api/search/ai-report", data={"site_id": str(site)}, content_type="multipart/form-data").status_code == 400


# ---- Today: each source's real state, words to translate ------------------------------------------------


def test_today_says_waiting_for_first_data_right_after_google_is_connected(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO google_connections (id, label, kind, secret, last4) VALUES (1, 'T', 'robot', 'x', 'y')"))
        conn.execute(text("UPDATE site_sources SET connection_id = 1, property = 'sc-domain:site-one.example', data_through = NULL, fresh_from = NULL WHERE site_id = :s"), {"s": site})
        conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property) VALUES (:s, 'ga4', 1, '123')"), {"s": site})
    results = today.today(engine, site)["results"]
    assert results["clicks"]["value"] is None and results["clicks"]["source"] == "waiting" and results["visits"]["source"] == "waiting"
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_error = 'Google refused the key' WHERE site_id = :s AND source = 'gsc'"), {"s": site})
    assert today.today(engine, site)["results"]["clicks"]["source"] == "failing"


def test_today_findings_come_with_their_words_apart_for_the_reader_language(engine, site):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO search_findings (site_id, kind, grp, finding_key, query, page, severity, at_stake, evidence, status, data_through) VALUES (:s, 'top3', 'wins', :k, 'sofa repair', 'https://site-one.example/sofa/', 'normal', 42.4, '{}', 'open', :d)"),
            {"s": site, "k": digest("x"), "d": END},
        )
    [row] = [r for r in today.today(engine, site)["todo"] if r["kind"] == "search_finding"]
    assert row["title"] == "“sofa repair” is close to the top 3"
    assert row["words"]["title"][0] == "“{query}” is close to the top 3" and row["words"]["title"][1]["query"] == "sofa repair"
    assert row["words"]["detail"] == ["About {n} clicks a month at stake", {"n": 42}]
