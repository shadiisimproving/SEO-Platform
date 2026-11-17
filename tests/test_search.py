"""Search → Overview: Search Console's ranges and maths, live reads with saved data behind them, tables, opportunities, the check."""
import json
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, http
from seo.core.errors import Refused
from seo.metrics import search
from seo.serp import store
from seo.sources import credentials
from seo.web import create_app

END = date(2026, 11, 7)  # the last final day; the two after it aren't final yet


@pytest.fixture
def site(engine):
    search._live_cache.clear()
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from, fresh_through) VALUES (:s, 'gsc', :d, :f, :t)"), {"s": site_id, "d": END, "f": END + timedelta(days=1), "t": END + timedelta(days=2)})
        # The day-by-day tables were read this far back (rows are sparse in these tests: a day can have none)
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status) VALUES (:s, 'gsc', :d, 'ok')"), {"s": site_id, "d": END - timedelta(days=480)})
    return site_id


@pytest.fixture
def google(engine, site, monkeypatch):
    """Search Console connected, with a fake Google that counts its requests."""
    calls, answers = [], {}

    def fake(request):
        calls.append(json.loads(request.content))
        body = calls[-1]
        handler = answers.get(tuple(body["dimensions"]))
        return handler(body) if handler else httpx.Response(200, json={"rows": []})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    monkeypatch.setattr(credentials, "token_override", lambda connection_id: "fake-token")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO google_connections (id, label, kind, secret, last4) VALUES (1, 'T', 'robot', 'x', 'y')"))
        conn.execute(text("UPDATE site_sources SET connection_id = 1, property = 'sc-domain:shop-one.test' WHERE site_id = :s"), {"s": site})

    class G: pass
    g = G(); g.calls = calls; g.answers = answers
    return g


def _day(engine, site, day, clicks, shown, position):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p)"), {"s": site, "d": day, "c": clicks, "i": shown, "p": position})


def _row(engine, site, table, day, name, clicks, shown, position):
    key, column = {"gsc_query": ("query_hash", "query"), "gsc_page": ("page_hash", "page")}.get(table, (None, None))
    with engine.begin() as conn:
        if key:
            conn.execute(text(f"INSERT INTO {table} (site_id, day, {key}, {column}, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, :i, :p)"), {"s": site, "d": day, "h": common.digest(name), "n": name, "c": clicks, "i": shown, "p": position})
        else:
            column = "country" if table == "gsc_country" else "device"
            conn.execute(text(f"INSERT INTO {table} (site_id, day, {column}, clicks, impressions, position) VALUES (:s, :d, :n, :c, :i, :p)"), {"s": site, "d": day, "n": name, "c": clicks, "i": shown, "p": position})


def _pair(engine, site, day, query, page, clicks, shown, position):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :p, :c, :i, :o)"),
            {"s": site, "d": day, "h": common.digest(query, page), "q": query, "p": page, "c": clicks, "i": shown, "o": position},
        )


def _scope(engine, site, range_key="28d", compare="prev", **extra):
    return search.scope_for(engine, {"site_id": str(site), "range": range_key, "compare": compare, **extra})


# ---- Ranges ----------------------------------------------------------------------------------------


def test_month_ranges_are_calendar_months_back_like_search_console():
    assert search._months_back(date(2026, 11, 7), 3) == date(2026, 8, 8)
    assert search._months_back(date(2026, 3, 31), 1) == date(2026, 3, 1)  # 28 Feb, then the next day
    assert search._months_back(date(2026, 11, 7), 16) == date(2025, 7, 8)


def test_ranges_end_on_the_last_final_day_and_the_fresh_days_are_only_drawn(engine, site):
    _day(engine, site, END - timedelta(days=500), 1, 1, 1.0)  # history far enough back for every comparison
    _scope_, window = _scope(engine, site)
    assert (window["from"], window["to"]) == ((END - timedelta(days=27)).isoformat(), END.isoformat())
    assert (window["compare_from"], window["compare_to"]) == ((END - timedelta(days=55)).isoformat(), (END - timedelta(days=28)).isoformat())
    assert window["fresh_from"] == (END + timedelta(days=1)).isoformat() and window["fresh_to"] == (END + timedelta(days=2)).isoformat()
    assert window["final_through"] == END.isoformat() and window["newest"] == (END + timedelta(days=2)).isoformat()
    _scope_, window = _scope(engine, site, "28d", "yoy")
    assert (window["compare_from"], window["compare_to"]) == ("2025-10-12", "2025-11-08")  # 364 days back: same weekdays
    _scope_, window = _scope(engine, site, "7d", "none")
    assert window["from"] == "2026-11-01" and window["compare_from"] is None


def test_ranges_refuse_what_search_console_does_not_offer(engine, site):
    with pytest.raises(Refused):
        _scope(engine, site, "30d")
    with pytest.raises(Refused):
        _scope(engine, site, "28d", "week")
    with pytest.raises(Refused):
        _scope(engine, site, "custom", "prev", **{"from": "2024-01-01", "to": "2026-11-07"})


# ---- Overview: saved data, then live -----------------------------------------------------------------


def test_overview_without_a_key_uses_saved_totals_not_queries_added_up(engine, site):
    _day(engine, site, END, 30, 1000, 8.0)
    _day(engine, site, END - timedelta(days=1), 10, 1000, 12.0)
    _row(engine, site, "gsc_query", END, "rare one hidden by google", 2, 10, 4.0)  # queries never add up to the total
    scope, window = _scope(engine, site, compare="none")
    found = search.overview(scope, window)
    assert found["origin"] == "saved"
    assert found["totals"] == {"clicks": 40, "impressions": 2000, "click_rate": 2.0, "position": 10.0}  # weighted by impressions
    assert found["before"] is None and found["queries"] == 1


def test_overview_reads_google_live_and_keeps_it_ten_minutes(engine, site, google):
    def dates(body):
        start, end = date.fromisoformat(body["startDate"]), date.fromisoformat(body["endDate"])
        rows = [{"keys": [(start + timedelta(days=n)).isoformat()], "clicks": 5, "impressions": 100, "position": 9.0} for n in range((end - start).days + 1)]
        return httpx.Response(200, json={"rows": rows})
    google.answers[("date",)] = dates
    _day(engine, site, END, 1, 1, 1.0)  # saved data that's out of date: live wins
    _day(engine, site, END - timedelta(days=400), 1, 1, 1.0)  # the saved days reach back far enough to compare
    scope, window = _scope(engine, site, "7d", "prev")
    found = search.overview(scope, window)
    assert found["origin"] == "live" and found["totals"]["clicks"] == 35 and found["before"]["clicks"] == 35
    assert all(c["dataState"] == "all" for c in google.calls)
    asked = len(google.calls)
    search.overview(*_scope(engine, site, "7d", "prev"))
    assert len(google.calls) == asked  # from the cache
    search.overview(*_scope(engine, site, "7d", "prev"), fresh=True)
    assert len(google.calls) == asked + 2  # Refresh asks again


def test_overview_falls_back_to_saved_data_when_google_fails(engine, site, google):
    google.answers[("date",)] = lambda body: httpx.Response(500, json={"error": {"message": "backend error"}})
    _day(engine, site, END, 7, 70, 5.0)
    found = search.overview(*_scope(engine, site, "7d", "none"))
    assert found["origin"] == "saved" and found["live_error"] and found["totals"]["clicks"] == 7


def test_last_24_hours_come_from_googles_hourly_data(engine, site, google):
    def hours(body):
        assert body["dataState"] == "hourly_all"
        rows = [{"keys": [f"2026-11-0{6 + n // 24}T{n % 24:02d}:00:00-08:00"], "clicks": 1 if n >= 24 else 2, "impressions": 10, "position": 5.0} for n in range(48)]
        return httpx.Response(200, json={"rows": rows})
    google.answers[("hour",)] = hours
    found = search.overview(*_scope(engine, site, "24h", "prev"))
    assert found["granularity"] == "hour" and len(found["series"]) == 24
    assert found["totals"]["clicks"] == 24 and found["before"]["clicks"] == 48


def test_long_ranges_are_drawn_in_weeks_and_fresh_days_are_marked(engine, site):
    for n in range(-2, 200):
        _day(engine, site, END - timedelta(days=n), 10, 100, 5.0)
    found = search.overview(*_scope(engine, site, "6m", "none"))
    assert found["granularity"] == "week" and found["series"][0]["clicks"] == 70
    assert not any(p["fresh"] for p in found["series"])  # weeks only hold final days
    seven = search.overview(*_scope(engine, site, "7d", "none"))
    assert [p["fresh"] for p in seven["series"]][-3:] == [False, True, True] and len(seven["series"]) == 9
    assert seven["totals"]["clicks"] == 70  # drawn, never counted


def test_the_answer_says_steady_below_the_noise_floor_and_names_what_moved(engine, site):
    for n in range(28):
        _day(engine, site, END - timedelta(days=n), 10, 100, 5.0)
        _day(engine, site, END - timedelta(days=28 + n), 10, 100, 5.0)
    assert search.overview(*_scope(engine, site))["answer"]["kind"] == "steady"
    with engine.begin() as conn:
        conn.execute(text("UPDATE gsc_daily SET clicks = 5 WHERE day > :d"), {"d": END - timedelta(days=28)})
    _row(engine, site, "gsc_page", END - timedelta(days=40), "https://shop-one.test/a/", 100, 1000, 3.0)
    _row(engine, site, "gsc_page", END - timedelta(days=3), "https://shop-one.test/a/", 20, 900, 6.0)
    answer = search.overview(*_scope(engine, site))["answer"]
    assert answer["kind"] == "down" and answer["percent"] == -50
    assert answer["drivers"][0] == {"dim": "page", "name": "https://shop-one.test/a/", "change": -80}


# ---- Tables ------------------------------------------------------------------------------------------


def test_tables_split_gaining_losing_new_and_lost_with_a_floor(engine, site):
    now, was = END - timedelta(days=3), END - timedelta(days=40)
    _row(engine, site, "gsc_query", now, "up", 9, 100, 4.0)
    _row(engine, site, "gsc_query", was, "up", 2, 50, 6.0)
    _row(engine, site, "gsc_query", now, "down", 1, 40, 9.0)
    _row(engine, site, "gsc_query", was, "down", 6, 60, 7.0)
    _row(engine, site, "gsc_query", now, "brand new", 4, 30, 15.0)
    _row(engine, site, "gsc_query", now, "tiny new", 0, 3, 40.0)
    _row(engine, site, "gsc_query", was, "gone", 7, 80, 8.0)
    scope, _window = _scope(engine, site)
    names = lambda show: [r["name"] for r in search.breakdown(scope, "query", show)["rows"]]  # noqa: E731
    assert names("gaining") == ["up", "brand new"]
    assert names("losing") == ["gone", "down"]
    assert names("new") == ["brand new"] and search.breakdown(scope, "query", "new")["small_hidden"] == 1
    assert names("lost") == ["gone"]
    assert names("top3") == [] and names("4-10") == ["up", "down"] and names("11-20") == ["brand new"]
    row = search.breakdown(scope, "query")["rows"][0]
    assert row == {**row, "name": "up", "clicks": 9, "clicks_before": 2, "position": 4.0, "position_before": 6.0, "click_rate": 9.0}


def test_brand_words_ignore_case_and_accents(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, 'brand', 'Shop One')"), {"s": site})
    for name in ("shop one prices", "SHÔP ONE", "sofa delivery"):
        _row(engine, site, "gsc_query", END, name, 3, 30, 4.0)
    scope, _window = _scope(engine, site)
    assert sorted(r["name"] for r in search.breakdown(scope, "query", brand="brand")["rows"]) == ["SHÔP ONE", "shop one prices"]
    assert [r["name"] for r in search.breakdown(scope, "query", brand="non_brand")["rows"]] == ["sofa delivery"]


def test_filters_match_text_like_search_console_and_cut_by_numbers(engine, site):
    for name, clicks, shown, position in (("créer société dubai", 9, 300, 4.0), ("Creer Societe", 2, 40, 12.0), ("visa dubai", 0, 120, 25.0), ("tva", 1, 8, 3.0)):
        _row(engine, site, "gsc_query", END, name, clicks, shown, position)
    scope, _window = _scope(engine, site)

    def names(**args):
        return sorted(r["name"] for r in search.breakdown(scope, "query", filters=search.filter_from(args))["rows"])

    assert names(q="CREER societe") == ["Creer Societe", "créer société dubai"]  # case and accents don't matter
    assert names(q="dubai", q_mode="not") == ["Creer Societe", "tva"]
    assert names(q="creer societe", q_mode="exact") == ["Creer Societe"]
    assert names(q="CRÉER société dubai", q_mode="exact") == ["créer société dubai"]  # exact keeps accents, not case
    assert names(q="^(visa|tva)", q_mode="regex") == ["tva", "visa dubai"]
    assert names(min_clicks="1", min_impressions="10") == ["Creer Societe", "créer société dubai"]
    assert names(pos_from="3,5", pos_to="20") == ["Creer Societe", "créer société dubai"]
    counted = search.breakdown(scope, "query", filters=search.filter_from({"q": "dubai"}))
    assert counted["counts"]["all"] == 2 and counted["total"] == 2  # the Show menu counts follow the filter
    for bad in ({"q": "(", "q_mode": "regex"}, {"q_mode": "sounds like"}, {"min_clicks": "lots"}, {"q": "x" * 201}):
        with pytest.raises(Refused):
            search.breakdown(scope, "query", filters=search.filter_from(bad))


def test_page_filters_read_the_address(engine, site):
    for page in ("https://shop-one.test/blog/sofa/", "https://shop-one.test/prices/"):
        _row(engine, site, "gsc_page", END, page, 3, 30, 4.0)
    scope, _window = _scope(engine, site)
    rows = search.breakdown(scope, "page", filters=search.filter_from({"q": "/blog/"}))["rows"]
    assert [r["name"] for r in rows] == ["https://shop-one.test/blog/sofa/"]


def test_a_query_already_tracked_says_so_whatever_its_market(engine, site):
    _row(engine, site, "gsc_query", END, "Sofa  Delivery", 3, 30, 4.0)
    _row(engine, site, "gsc_query", END, "sofa repair", 2, 30, 4.0)
    with engine.begin() as conn:
        keyword_id = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES ('sofa delivery', :h, 'fr', 'fr')"), {"h": store.keyword_hash("sofa delivery")}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": keyword_id})
    rows = {r["name"]: r["tracked"] for r in search.breakdown(_scope(engine, site)[0], "query")["rows"]}
    assert rows == {"Sofa  Delivery": True, "sofa repair": False}


def test_a_keyword_tracked_with_accents_marks_both_spellings_tracked(engine, site):
    """One key for a keyword whatever its accents (store.keyword_key, 2026-11-17): "café moulu" tracked means "cafe moulu"
    is tracked too, so it's never suggested as Worth tracking, and Track can't add it twice."""
    _row(engine, site, "gsc_query", END, "cafe moulu", 3, 30, 4.0)
    _row(engine, site, "gsc_query", END, "café moulu", 2, 30, 4.0)
    with engine.begin() as conn:
        for words in ("café moulu",):
            keyword_id = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES (:w, :h, 'fr', 'fr')"), {"w": words, "h": store.keyword_hash(words)}).lastrowid
            conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": keyword_id})
    rows = {r["name"]: r["tracked"] for r in search.breakdown(_scope(engine, site)[0], "query")["rows"]}
    assert rows == {"cafe moulu": True, "café moulu": True}


def test_countries_carry_a_two_letter_code_for_names(engine, site):
    _row(engine, site, "gsc_country", END, "fra", 5, 50, 4.0)
    _row(engine, site, "gsc_country", END, "zzz", 1, 5, 9.0)
    rows = search.breakdown(_scope(engine, site)[0], "country")["rows"]
    assert [(r["key"], r["code"]) for r in rows] == [("fra", "FR"), ("zzz", None)]


# ---- Opportunities -----------------------------------------------------------------------------------


def test_almost_on_page_one_is_positions_11_to_20_with_real_impressions(engine, site):
    _row(engine, site, "gsc_query", END, "page two", 1, 300, 13.0)
    _row(engine, site, "gsc_query", END, "already page one", 1, 900, 6.0)
    _row(engine, site, "gsc_query", END, "too small", 0, 5, 12.0)
    rows = search.opportunities(_scope(engine, site)[0], "almost")["rows"]
    assert [r["name"] for r in rows] == ["page two"]


def test_low_click_rate_waits_for_brand_words_then_uses_the_sites_own_curve(engine, site):
    scope, _window = _scope(engine, site)
    assert search.opportunities(scope, "low_ctr")["needs"] == "brand_words"
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, 'brand', 'shop one')"), {"s": site})
    for n in range(10):
        _row(engine, site, "gsc_query", END, f"sofa {n}", 10, 200, 2.0)  # 5% at position 2
    _row(engine, site, "gsc_query", END, "sofa weak", 1, 200, 2.0)  # 0.5%
    _row(engine, site, "gsc_query", END, "shop one", 0, 500, 2.0)  # brand: never on the list, never in the curve
    rows = search.opportunities(scope, "low_ctr")["rows"]
    assert [(r["name"], r["expected_rate"]) for r in rows] == [("sofa weak", 5.0)]


def test_two_pages_compete_only_with_volume_share_and_a_page_in_the_top_20(engine, site):
    for query, pages in {
        "sofa": [("https://shop-one.test/a/", 60, 8.0), ("https://shop-one.test/b/", 40, 12.0)],
        "chair": [("https://shop-one.test/c/", 95, 5.0), ("https://shop-one.test/d/", 5, 30.0)],
        "lamp": [("https://shop-one.test/e/", 3, 8.0), ("https://shop-one.test/f/", 3, 9.0)],
    }.items():
        _row(engine, site, "gsc_query", END, query, 5, sum(p[1] for p in pages), 9.0)
        for page, shown, position in pages:
            _pair(engine, site, END, query, page, 1, shown, position)
    rows = search.opportunities(_scope(engine, site)[0], "compete")["rows"]
    assert [r["name"] for r in rows] == ["sofa"]
    assert [(p["share"], p["position"]) for p in rows[0]["pages"]] == [(60, 8.0), (40, 12.0)]


# ---- Side panel, notes, the check ----------------------------------------------------------------------


def test_a_query_panel_shows_its_pages_as_shares_and_keeps_accents_apart(engine, site):
    _row(engine, site, "gsc_query", END, "créer société", 4, 40, 3.0)
    _pair(engine, site, END, "créer société", "https://shop-one.test/a/", 3, 30, 3.0)
    _pair(engine, site, END, "creer societe", "https://shop-one.test/b/", 1, 10, 9.0)
    found = search.detail(_scope(engine, site)[0], query="créer société")
    assert found["totals"]["clicks"] == 4 and [(p["name"], p["share"]) for p in found["split"]] == [("https://shop-one.test/a/", 100)]
    assert found["countries"] is None  # no key: nothing live


def test_notes_and_finished_tasks_are_markers_on_the_chart(engine, site):
    made = search.add_note(engine, site, (END - timedelta(days=3)).isoformat(), "Changed the titles", None)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tasks (title, status, site_id, updated_at) VALUES ('Fix the sofa page', 'done', :s, :d)"), {"s": site, "d": END - timedelta(days=2)})
        conn.execute(text("INSERT INTO tasks (title, status, site_id) VALUES ('Still to do', 'todo', :s)"), {"s": site})
    found = search.markers(_scope(engine, site)[0])
    assert [(m["kind"], m["text"]) for m in found] == [("note", "Changed the titles"), ("task", "Fix the sofa page")]
    with pytest.raises(Refused):
        search.add_note(engine, site, (END - timedelta(days=3)).isoformat(), "Changed the titles", None)  # the same note twice
    search.delete_note(engine, made["id"])
    with pytest.raises(Refused):
        search.add_note(engine, site, END.isoformat(), "   ", None)


def test_the_check_says_matches_or_names_each_difference(engine, site, google):
    days = [(END - timedelta(days=n)).isoformat() for n in range(28)]
    google.answers[("date",)] = lambda body: httpx.Response(200, json={"rows": [{"keys": [d], "clicks": 5, "impressions": 50} for d in days]})
    google.answers[("query",)] = lambda body: httpx.Response(200, json={"rows": [{"keys": ["sofa"], "clicks": 20, "impressions": 200}]})
    google.answers[("page",)] = lambda body: httpx.Response(200, json={"rows": []})
    for d in days:
        _day(engine, site, date.fromisoformat(d), 5, 50, 5.0)
    _row(engine, site, "gsc_query", END, "sofa", 20, 200, 4.0)
    assert search.verify(engine, site)["ok"] is True
    with engine.begin() as conn:
        conn.execute(text("UPDATE gsc_daily SET clicks = 4 WHERE day = :d"), {"d": END})
        conn.execute(text("INSERT INTO coverage (site_id, source, day) VALUES (:s, 'gsc', :d)"), {"s": site, "d": END})
    verdict = search.verify(engine, site)
    assert verdict["ok"] is False and verdict["fixable"] is True
    assert verdict["days"] == [{"day": END.isoformat(), "google": {"clicks": 5, "impressions": 50}, "saved": {"clicks": 4, "impressions": 50}}]
    assert search.last_verdict(_scope(engine, site)[0])["days"] == verdict["days"]
    assert search.fix(engine, site)["days"] == [END.isoformat()]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM coverage WHERE site_id = :s AND day = :d"), {"s": site, "d": END}).scalar() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = 'collect'")).scalar() == 1


def test_a_table_difference_with_matching_days_is_not_fixable(engine, site, google):
    days = [(END - timedelta(days=n)).isoformat() for n in range(28)]
    google.answers[("date",)] = lambda body: httpx.Response(200, json={"rows": [{"keys": [d], "clicks": 5, "impressions": 50} for d in days]})
    google.answers[("query",)] = lambda body: httpx.Response(200, json={"rows": [{"keys": ["sofa"], "clicks": 21, "impressions": 200}]})
    for d in days:
        _day(engine, site, date.fromisoformat(d), 5, 50, 5.0)
    _row(engine, site, "gsc_query", END, "sofa", 20, 200, 4.0)
    verdict = search.verify(engine, site)
    assert verdict["ok"] is False and verdict["fixable"] is False and verdict["queries"][0]["name"] == "sofa"
    with pytest.raises(Refused):
        search.fix(engine, site)


def test_the_search_apis_answer_and_refuse(engine, site):
    _day(engine, site, END, 3, 30, 5.0)
    client = create_app(engine=engine, auth=False).test_client()
    for path in ("overview", "breakdown?dim=page", "breakdown?dim=country", "opportunities?kind=compete", "detail?query=sofa", "brand"):
        sep = "&" if "?" in path else "?"
        assert client.get(f"/api/search/{path}{sep}site_id={site}&range=28d").status_code == 200, path
    assert client.get(f"/api/search/overview?site_id={site}&range=31d").status_code == 400
    assert client.get(f"/api/search/breakdown?site_id={site}&dim=colour").status_code == 400
    assert client.get(f"/api/search/breakdown?site_id={site}&range=28d&q=sofa&q_mode=not&min_clicks=1&pos_to=10").status_code == 200
    assert client.get(f"/api/search/breakdown?site_id={site}&range=28d&q=(&q_mode=regex").status_code == 400
    assert client.get(f"/api/search/breakdown?site_id={site}&show=gaining&compare=none").status_code == 400
    assert client.post("/api/search/notes", json={"site_id": site, "day": END.isoformat(), "text": "New menu"}).status_code == 201
    assert client.post("/api/search/verify", json={"site_id": site}).status_code == 400  # not connected


def test_a_brand_word_goes_in_once_whatever_its_accents(engine, site):
    search.add_brand_word(engine, site, "Séville")
    with pytest.raises(Refused):
        search.add_brand_word(engine, site, "seville")
    assert search.brand_words(_scope(engine, site)[0]) == ["seville"]


def test_the_last_24_hours_get_a_sentence_without_drivers(engine, site, google):
    google.answers[("hour",)] = lambda body: httpx.Response(200, json={"rows": [{"keys": [f"2026-11-0{6 + n // 24}T{n % 24:02d}:00:00-08:00"], "clicks": 1 if n < 24 else 3, "impressions": 10} for n in range(48)]})
    answer = search.overview(*_scope(engine, site, "24h", "prev"))["answer"]
    assert answer == {"kind": "up", "clicks": 72, "before": 24, "percent": 200, "drivers": []}
