"""Today, Overview drops, Refresh feedback and brand words: the fixes of the SEO review of 2026-11-17 (SUMMARY #17, section 2,
COMPARISON lost places 1 and 4). Each test has numbers worked out by hand."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors import common
from seo.metrics import search, today
from seo.metrics.service import Scope

END = date(2026, 10, 20)


@pytest.fixture
def site(engine):
    search._live_cache.clear()
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO google_connections (label, kind, secret, last4) VALUES ('T', 'robot', 'x', 'y')"))
        for source, prop in (("gsc", "sc-domain:mine.example"), ("ga4", "1")):
            conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, :c, 1, :p, :d)"), {"s": site_id, "c": source, "p": prop, "d": END})
    return site_id


def _alert(engine, site_id, kind, severity, title, detail=None):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO alerts (site_id, kind, severity, title, detail) VALUES (:s, :k, :v, :t, :d)"), {"s": site_id, "k": kind, "v": severity, "t": title, "d": json.dumps(detail) if detail else None})


def _page_week(engine, site_id, name, was, now, shown=(100, 100), position=(5.0, 5.0)):
    """One day in each week: END - 10 (the week before) and END (this week)."""
    page = f"https://mine.example/{name}/"
    with engine.begin() as conn:
        for day, clicks, imp, pos in ((END - timedelta(days=10), was, shown[0], position[0]), (END, now, shown[1], position[1])):
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, :i, :o)"),
                         {"s": site_id, "d": day, "h": common.digest(page), "p": page, "c": clicks, "i": imp, "o": pos})
        for back in range(14):  # both weeks were read (Today compares only full weeks of the page table)
            common.save_coverage(conn, site_id, "gsc", END - timedelta(days=back), 1)


def _query(engine, site_id, day, query, clicks, shown, position):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, :c, :i, :p)"),
                     {"s": site_id, "d": day, "h": common.digest(query), "q": query, "c": clicks, "i": shown, "p": position})


def _leads(engine, site_id, day, leads, sessions=100):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, 'Organic', 'google', 'organic', :x, :x, :k)"),
                     {"s": site_id, "d": day, "h": common.digest("o"), "x": sessions, "k": leads})


# ---- SUMMARY #17 / daily F6: a 463-click drop goes above a 58-click one ------------------------------------------


def test_f6_drops_are_ordered_by_clicks_at_stake_not_by_database_order(engine, site):
    _alert(engine, site, "search_drop", "crit", "/blue/: −50% Google clicks", {"finding_key": "a", "detail": "~58 clicks/month at stake"})
    _alert(engine, site, "search_drop", "crit", "/quote/: −80% Google clicks", {"finding_key": "b", "detail": "~463 clicks/month at stake"})
    rows = [row["title"] for row in today.today(engine, site)["todo"]]
    assert rows == ["/quote/: −80% Google clicks", "/blue/: −50% Google clicks"]


def test_f6_a_week_on_week_drop_is_said_as_clicks_a_month_and_ranked_with_the_alerts(engine, site):
    # /fell/: 100 → 40 a week = 60 a week lost = 60 × 30 / 7 = 257 clicks a month: between a 463 and a 58 alert.
    _page_week(engine, site, "fell", 100, 40)
    _alert(engine, site, "search_drop", "crit", "/small/: −50% Google clicks", {"finding_key": "a", "detail": "~58 clicks/month at stake"})
    _alert(engine, site, "search_drop", "crit", "/big/: −80% Google clicks", {"finding_key": "b", "detail": "~463 clicks/month at stake"})
    todo = today.today(engine, site)["todo"]
    assert [row["title"] for row in todo] == ["/big/: −80% Google clicks", "/fell/: −60% Google clicks", "/small/: −50% Google clicks"]
    assert next(row for row in todo if row["kind"] == "page_drop")["stake"] == 257


# ---- daily F10: Going up follows the site's size, and a page with nothing before is new -----------------------------


def test_f10_move_floor_is_two_percent_of_the_site_never_under_five():
    assert today.move_floor(100) == 5 and today.move_floor(400) == 8 and today.move_floor(5000) == 100


def test_f10_a_page_going_5_to_80_is_going_up_and_20_to_16_is_noise(engine, site):
    _page_week(engine, site, "winner", 5, 80)
    _page_week(engine, site, "noise", 20, 16)
    _page_week(engine, site, "steady", 200, 200)
    # Site: 225 → 296 clicks a week, so the floor is max(5, round(296 × 2%)) = 6: the winner moved 75, the noise 4.
    data = today.today(engine, site)
    assert [(m["path"], m["was"], m["clicks"], m["change"]) for m in data["going_up"]] == [("/winner/", 5, 80, 1500)]
    assert data["going_down"] == []


def test_f10_a_page_with_no_clicks_the_week_before_is_new_not_a_made_up_percentage(engine, site):
    _page_week(engine, site, "brand-new", 0, 30)
    up = today.today(engine, site)["going_up"]
    assert [(m["path"], m["change"], m["new"]) for m in up] == [("/brand-new/", None, True)]


def test_f10_going_up_and_down_say_their_two_weeks(engine, site):
    _page_week(engine, site, "winner", 5, 80)
    window = today.today(engine, site)["moves_window"]
    assert window == {"from": "2026-10-14", "to": "2026-10-20", "before_from": "2026-10-07", "before_to": "2026-10-13"}


# ---- daily F8: one search, two answers, said in its row ----------------------------------------------------------------


def test_f8_a_finding_about_a_search_that_fell_this_week_says_so(engine, site):
    for query, was, now in (("cafe en grains", 8.0, 12.0),):
        _query(engine, site, END - timedelta(days=10), query, 1, 100, was)
        _query(engine, site, END, query, 1, 100, now)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO search_findings (site_id, kind, grp, finding_key, query, severity, at_stake, evidence, status) VALUES (:s, 'top3', 'wins', 'k1', 'cafe en grains', 'normal', 40, :e, 'open')"),
                     {"s": site, "e": json.dumps({})})
    data = today.today(engine, site)
    assert [(m["query"], m["was_pos"], m["now_pos"]) for m in data["going_down"]] == [("cafe en grains", 8.0, 12.0)]
    row = next(r for r in data["todo"] if r["kind"] == "search_finding")
    assert row["words"]["week"] == ["This week: avg pos {was} → {now}", {"was": 8.0, "now": 12.0}]


# ---- COMPARISON lost place 1: one line of likely cause on each drop row ---------------------------------------------


def test_drop_row_says_lost_places_when_the_position_fell(engine, site):
    _page_week(engine, site, "ranked-lower", 100, 40, shown=(1000, 1000), position=(4.0, 7.5))
    row = next(r for r in today.today(engine, site)["todo"] if r["kind"] == "page_drop")
    assert row["words"]["cause"] == ["Likely cause: lost places, avg pos {a} → {b}", {"a": 4.0, "b": 7.5}]


def test_drop_row_says_fewer_searches_when_impressions_fell(engine, site):
    _page_week(engine, site, "less-searched", 100, 40, shown=(1000, 400))
    row = next(r for r in today.today(engine, site)["todo"] if r["kind"] == "page_drop")
    assert row["words"]["cause"] == ["Likely cause: fewer searches, {a} → {b} impressions", {"a": 1000, "b": 400}]


def test_drop_row_says_lower_click_rate_at_the_same_place(engine, site):
    _page_week(engine, site, "less-clicked", 100, 40, shown=(1000, 1000))
    row = next(r for r in today.today(engine, site)["todo"] if r["kind"] == "page_drop")
    assert row["words"]["cause"] == ["Likely cause: lower click rate at the same place", {}]


def test_a_big_drop_alert_takes_its_cause_from_the_insight_behind_it(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO search_findings (site_id, kind, grp, finding_key, page, severity, at_stake, evidence, status) VALUES (:s, 'page_down', 'changed', 'pk', 'https://mine.example/quote/', 'big', 463, :e, 'open')"),
                     {"s": site, "e": json.dumps({"path": "/quote/", "clicks": 30, "clicks_before": 150, "impressions": 900, "impressions_before": 1000, "position": 9.1, "position_before": 3.2, "why": "ranking"})})
    _alert(engine, site, "search_drop", "crit", "/quote/: −80% Google clicks", {"finding_key": "pk", "detail": "~463 clicks/month at stake"})
    row = today.today(engine, site)["todo"][0]
    assert row["words"]["cause"] == ["Likely cause: lost places, avg pos {a} → {b}", {"a": 3.2, "b": 9.1}]


# ---- daily F13: leads halving raises a to-do -----------------------------------------------------------------------------


def _two_periods(engine, site, before_each, now_each):
    """28 days before and 28 days now, ending END, one lead count per day."""
    for n in range(56):
        day = END - timedelta(days=n)
        _leads(engine, site, day, now_each(n) if n < 28 else before_each(n))


def test_f13_leads_28_to_14_raise_a_to_do_above_lost_clicks(engine, site):
    _two_periods(engine, site, before_each=lambda n: 1, now_each=lambda n: n % 2)  # 28 before, 14 now
    _alert(engine, site, "search_drop", "crit", "/big/: −80% Google clicks", {"finding_key": "b", "detail": "~463 clicks/month at stake"})
    todo = today.today(engine, site)["todo"]
    assert todo[0]["kind"] == "leads_drop" and todo[0]["reason"] == "losing_leads"
    # No lead event picked: "Key events fell" (SEO review 2026-11-17, W1).
    assert todo[0]["words"]["title"] == ["Key events fell {percent}%: {was} → {now}", {"percent": 50, "was": 28, "now": 14}]
    assert todo[0]["severity"] == "crit" and todo[0]["link"] == "#conversions"
    assert any(row["kind"] == "leads_drop" for row in today.attention(engine, site))  # the side menu's badge counts it too


def test_f13_a_fall_chance_explains_raises_nothing(engine, site):
    # 6 → 4: of 10 leads, 4 or fewer in the second period happens 38% of the time by chance alone.
    _two_periods(engine, site, before_each=lambda n: 1 if n % 5 == 0 and n < 56 else 0, now_each=lambda n: 1 if n in (0, 7, 14, 21) else 0)
    assert not [row for row in today.today(engine, site)["todo"] if row["kind"] == "leads_drop"]
    assert today._below_chance(14, 28) and not today._below_chance(1, 4) and not today._below_chance(4, 6)


def test_f13_a_leads_drop_marked_as_seen_stays_hidden(engine, site):
    _two_periods(engine, site, before_each=lambda n: 1, now_each=lambda n: 0)
    key = next(r for r in today.today(engine, site)["todo"] if r["kind"] == "leads_drop")["seen_key"]
    today.mark_drop_seen(engine, key)
    assert not [r for r in today.today(engine, site)["todo"] if r["kind"] == "leads_drop"]


# ---- daily F24: brand words are whole words ----------------------------------------------------------------------------


@pytest.mark.parametrize(("query", "words", "brand"), [
    ("créer société Dubaï", ["dubai"], True),
    ("dubaihomes prices", ["dubai"], False),
    ("acme", ["acme"], True),
    ("acmeshop review", ["acme"], False),
    ("Always-Improving avis", ["always improving"], True),
    ("always more improving", ["always improving"], False),
    ("séville loyer", ["seville"], True),
])
def test_f24_brand_words_match_whole_words_with_accents_ignored(query, words, brand):
    assert search.is_brand(query, [search._fold(w) for w in words]) is brand


# ---- daily F4: a refused site isn't served the 10-minute live answer -------------------------------------------------------


def test_f4_a_site_whose_last_pull_was_refused_asks_google_again(engine, site, monkeypatch):
    calls = []

    def fake_query(token, prop, start, end, dims, limit, state, extra):
        calls.append(prop)
        return {"rows": []}

    monkeypatch.setattr(search.gsc, "_query", fake_query)
    monkeypatch.setattr(search.credentials, "access_token", lambda engine, cid: "t")
    source = {"site_id": site, "connection_id": 1, "property": "sc-domain:mine.example", "failing": False}
    search.live(engine, source, END, END, ["date"])
    search.live(engine, source, END, END, ["date"])
    assert len(calls) == 1  # kept 10 minutes while Google answers
    search.live(engine, {**source, "failing": True}, END, END, ["date"])
    assert len(calls) == 2  # asked again once a pull was refused
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_error = '403 forbidden' WHERE site_id = :s AND source = 'gsc'"), {"s": site})
    assert search._usable_sites(Scope(engine, site, "2026-10-01", "2026-10-01"))[0]["failing"]


# ---- COMPARISON lost place 1: "See page" filters the four numbers and the chart ---------------------------------------------


def test_overview_for_one_page_counts_that_page_only(engine, site):
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET connection_id = NULL WHERE site_id = :s"), {"s": site})  # saved data only
        for n in range(14):
            day = END - timedelta(days=n)
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, 100, 1000, 5)"), {"s": site, "d": day})
    for n in range(14):
        day = END - timedelta(days=n)
        page = "https://mine.example/quote/"
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, 100, 3)"),
                         {"s": site, "d": day, "h": common.digest(page), "p": page, "c": 2 if n < 7 else 10})
    scope, window = search.scope_for(engine, {"site_id": str(site), "range": "custom", "from": (END - timedelta(days=6)).isoformat(), "to": END.isoformat(), "compare": "prev"})
    whole = search.overview(scope, window)
    one = search.overview(scope, window, page="https://mine.example/quote/")
    assert whole["totals"]["clicks"] == 700 and whole["page"] is None
    assert one["totals"]["clicks"] == 14 and one["before"]["clicks"] == 70 and one["page"] == "https://mine.example/quote/"
    assert [p["clicks"] for p in one["series"]] == [2] * 7
    assert one["answer"]["kind"] == "down" and one["answer"]["drivers"] == []
