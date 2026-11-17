"""The code review of branch fix-all-2026-11-17 (2026-11-17): each finding with a known answer worked out by hand."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.accounts import access
from seo.collectors import common
from seo.competitors import gaps
from seo.insights import service as insights
from seo.metrics import period, search, today
from tests.test_competitors_backend import add_rival, world  # noqa: F401  (world is a fixture)
from tests.test_link_gap_links import gap
from tests.test_links_numbers_true import SEMRUSH

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


def _page_day(engine, site_id, day, name, clicks, read=True):
    """One page's day in the page table, and (read=True) the day marked as read in coverage, as the Search Console pull does."""
    page = f"https://mine.example/{name}/"
    with engine.begin() as conn:
        if clicks is not None:
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, 100, 5)"),
                         {"s": site_id, "d": day, "h": common.digest(page), "p": page, "c": clicks})
        if read:
            common.save_coverage(conn, site_id, "gsc", day, 1)


# ---- 1. Overview "See page" on saved data: the page table's own history decides the comparison ------------------------


def test_see_page_on_saved_data_makes_no_gain_from_a_page_table_that_starts_late(engine, site):
    """Totals for 14 days, the page table only the last 9. The page gets 10 clicks a day, flat. 7 days vs the 7 before:
    the earlier week has only 2 stored page days (20 clicks), so the old answer was "+250%". Now: no comparison, and why."""
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET connection_id = NULL WHERE site_id = :s"), {"s": site})  # saved data only
        for n in range(14):
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, 100, 1000, 5)"), {"s": site, "d": END - timedelta(days=n)})
    for n in range(9):
        _page_day(engine, site, END - timedelta(days=n), "quote", 10)
    scope, window = search.scope_for(engine, {"site_id": str(site), "range": "custom", "from": (END - timedelta(days=6)).isoformat(), "to": END.isoformat(), "compare": "prev"})
    one = search.overview(scope, window, page="https://mine.example/quote/")
    assert one["totals"]["clicks"] == 70
    assert one["before"] is None and one["compare_series"] is None
    assert one["compare_unavailable"] == "rows_history" and one["compare_from"] is None and one["compare_to"] is None
    assert one["history_from"] == (END - timedelta(days=8)).isoformat()  # the head says "data from" the page table's first day
    assert one["answer"] is None or one["answer"].get("kind") != "up"
    whole = search.overview(scope, window)  # the whole site's totals reach back: compared as before
    assert whole["before"]["clicks"] == 700 and whole["compare_unavailable"] is None


# ---- 2. Today's Going up: only full weeks of the page table are compared ------------------------------------------------


def test_today_names_no_page_new_while_the_page_table_holds_only_this_week(engine, site):
    """After a new connection the page table holds the last 7 days only. Three pages at 3 clicks a day were all "New"."""
    for n in range(7):
        for name in ("a", "b", "c"):
            _page_day(engine, site, END - timedelta(days=n), name, 3)
    answer = today.today(engine, site)
    assert [m for m in answer["going_up"] if m["type"] == "page"] == []


def test_today_makes_no_gain_from_an_earlier_week_stored_in_part(engine, site):
    """The week before holds only its last 3 days (3 clicks), this week all 7 (7 clicks a day = 49): no +1533%."""
    for n in range(7):
        _page_day(engine, site, END - timedelta(days=n), "a", 7)
    for n in range(7, 10):
        _page_day(engine, site, END - timedelta(days=n), "a", 1)
    assert [m for m in today.today(engine, site)["going_up"] if m["type"] == "page"] == []


def test_today_says_new_when_the_earlier_week_was_read_and_the_page_had_nothing(engine, site):
    """Both weeks read (coverage for 14 days); /old/ has 2 clicks a day in both, /fresh/ 0 before and 4 a day now (28)."""
    for n in range(14):
        _page_day(engine, site, END - timedelta(days=n), "old", 2)
        if n < 7:
            _page_day(engine, site, END - timedelta(days=n), "fresh", 4, read=False)
    up = [m for m in today.today(engine, site)["going_up"] if m["type"] == "page"]
    assert [(m["path"], m["new"], m["was"], m["clicks"]) for m in up] == [("/fresh/", True, 0, 28)]


# ---- 3. Link gaps: a domain a newer file marks all lost leaves; a live link on a page with a lost one stays --------------


def test_a_domain_whose_links_the_newer_file_marks_lost_leaves_link_gaps(world):  # noqa: F811
    rival = add_rival(world)
    alive = SEMRUSH.replace(b"2025-03-01,true", b"2025-03-01,false")
    gaps.import_referrers(world.engine, world.own, rival, alive, "old.csv")
    assert gap(world, "dead.example")["domain"] == "dead.example"
    gaps.import_referrers(world.engine, world.own, rival, SEMRUSH, "new.csv")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrers WHERE domain = 'dead.example'")).scalar() == 0
    answer = gaps.link_gaps(world.engine, world.own)
    assert "dead.example" not in {g["domain"] for g in answer["gaps"] + answer["filtered"]}
    assert gap(world, "pr-wire.example")["domain"] == "pr-wire.example"  # the file's live links stay


def test_a_live_link_on_the_same_page_as_a_lost_one_is_kept(world):  # noqa: F811
    """One forum page links twice to the rival: one link lost, one live. The domain stays, with its live link."""
    rival = add_rival(world)
    both = SEMRUSH + b"41,Forum,https://forum.dead.example/t/1,https://rival.example/b,rival guide,false,false,false,2025-01-01,2026-11-01,false,30\n"
    report = gaps.import_referrers(world.engine, world.own, rival, both, "semrush.csv")
    assert report["lost"] == 1 and report["domains"] == 3
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrers WHERE domain = 'dead.example'")).scalar() == 1
        assert conn.execute(text("SELECT anchor FROM competitor_referrer_links WHERE domain = 'dead.example'")).scalars().all() == ["rival guide"]
    assert gap(world, "dead.example")["followed"] is True


def test_a_domain_also_in_common_crawl_stays_but_loses_the_files_old_numbers(world):  # noqa: F811
    rival = add_rival(world)
    alive = SEMRUSH.replace(b"2025-03-01,true", b"2025-03-01,false")
    gaps.import_referrers(world.engine, world.own, rival, alive, "old.csv")
    gaps.import_common_crawl(world.engine, rival, [{"domain": "dead.example"}], "CC-2026-40")
    gaps.import_referrers(world.engine, world.own, rival, SEMRUSH, "new.csv")
    with world.engine.connect() as conn:
        row = conn.execute(text("SELECT authority, sample_url, followed, source_label FROM competitor_referrers WHERE domain = 'dead.example'")).mappings().first()
    assert row is not None and row["authority"] is None and row["sample_url"] is None and row["followed"] is None and row["source_label"] == "Common Crawl"


# ---- 4. Insights → Technical: pages Google didn't show, counted once ---------------------------------------------------


def test_technical_counts_only_pages_not_already_listed_and_each_once(engine, site):
    """3 pages flagged by the health test, all shown by Google this week (so Technical lists them); 2 not indexed, both
    among those 3. Before: "5 problems". Now: 0. Then /gone/ (404, not shown) and /hidden/ (not indexed, not shown) and a
    canonicalised alternate (on purpose, not a problem): 2."""
    for name in ("a", "b", "c"):
        _page_day(engine, site, END, name, 1)
    with engine.begin() as conn:
        audit = conn.execute(text("INSERT INTO health_audits (site_id, status) VALUES (:s, 'complete')"), {"s": site}).lastrowid
        for code, names in (("broken_pages", ["a"]), ("noindex", ["b", "c"])):
            conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, :c, :n, :p)"),
                         {"a": audit, "c": code, "n": len(names), "p": json.dumps([f"https://mine.example/{n}/" for n in names])})
        for h, name in (("1", "b"), ("2", "c")):
            conn.execute(text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage) VALUES (:s, :h, :u, 'NEUTRAL', 'Excluded by noindex tag')"), {"s": site, "h": h, "u": f"https://mine.example/{name}/"})
    assert insights.technical_elsewhere(engine, [site])["pages"] == 0
    with engine.begin() as conn:
        audit = conn.execute(text("INSERT INTO health_audits (site_id, status) VALUES (:s, 'complete')"), {"s": site}).lastrowid
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, 'broken_pages', 2, :p)"), {"a": audit, "p": json.dumps(["https://mine.example/a/", "https://mine.example/gone"])})
        conn.execute(text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage) VALUES (:s, '3', 'https://mine.example/hidden/', 'FAIL', 'Not found (404)')"), {"s": site})
        conn.execute(text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage) VALUES (:s, '4', 'https://mine.example/amp/', 'NEUTRAL', 'Alternate page with proper canonical tag')"), {"s": site})
        conn.execute(text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage) VALUES (:s, '5', 'https://mine.example/gone/', 'FAIL', 'Not found (404)')"), {"s": site})
    assert insights.technical_elsewhere(engine, [site]) == {"pages": 2, "critical": 1, "not_indexed": 2}


# ---- 6. Today's leads drop: Mark seen lasts; leads drops go first ------------------------------------------------------


def _leads(engine, site_id, day, leads):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, 'Organic', 'google', 'organic', 100, 100, :k)"),
                     {"s": site_id, "d": day, "h": common.digest("o"), "k": leads})


def test_a_leads_drop_marked_seen_stays_hidden_when_ga4_adds_a_day(engine, site):
    for n in range(56):
        _leads(engine, site, END - timedelta(days=n), 0 if n < 28 else 1)  # 28 → 0
    key = next(r for r in today.today(engine, site)["todo"] if r["kind"] == "leads_drop")["seen_key"]
    today.mark_drop_seen(engine, key)
    _leads(engine, site, END + timedelta(days=1), 0)  # GA4's next day: the same drop (27 → 0)
    assert not [r for r in today.today(engine, site)["todo"] if r["kind"] == "leads_drop"]


def test_a_warn_leads_drop_goes_above_a_crit_page_drop(engine, site):
    """28 leads → 15 (−46%, "warn") against a "crit" lost-clicks alert: leads lost come first."""
    for n in range(56):
        _leads(engine, site, END - timedelta(days=n), (1 if n < 15 else 0) if n < 28 else 1)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO alerts (site_id, kind, severity, title, detail) VALUES (:s, 'search_drop', 'crit', '/big/: −80% Google clicks', :d)"),
                     {"s": site, "d": json.dumps({"finding_key": "b", "detail": "~463 clicks/month at stake"})})
    todo = today.today(engine, site)["todo"]
    assert todo[0]["kind"] == "leads_drop" and todo[0]["severity"] == "warn"
    assert todo[1]["title"] == "/big/: −80% Google clicks"


# ---- 9. The period rule: any day count, and both chart lines drop the same weeks --------------------------------------


def test_for_site_works_for_any_number_of_days(engine, site):
    with engine.begin() as conn:
        for n in range(28):
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, 1, 1, 1)"), {"s": site, "d": END - timedelta(days=n)})
    _scope, window = period.for_site(engine, site, 14)
    assert (window["from"], window["to"], window["days"]) == ((END - timedelta(days=13)).isoformat(), END.isoformat(), 14)
    assert window["compare_to"] == (END - timedelta(days=14)).isoformat() and window["compare_from"] == (END - timedelta(days=27)).isoformat()


def test_both_chart_lines_leave_out_the_same_weeks():
    """4 weeks ending 28 Oct vs the 4 before. The earlier period has nothing for its first 10 days, so its first two weeks
    are short. Both lines then start at their third week, so week 3 is drawn against week 3."""
    start, end = date(2026, 10, 1), date(2026, 10, 28)
    before_start, before_end = date(2026, 9, 3), date(2026, 9, 30)
    points = lambda a, b, skip=0: [{"day": (a + timedelta(days=n)).isoformat(), "clicks": 1} for n in range(skip, (b - a).days + 1)]  # noqa: E731
    totals = lambda chunk: {"clicks": sum(p["clicks"] for p in chunk)}  # noqa: E731
    series, left_out, compare = period.weeks_pair(points(start, end), points(before_start, before_end, skip=10), start, end, before_start, before_end, 7, totals)
    assert [p["day"] for p in series] == ["2026-10-15", "2026-10-22"]
    assert [p["day"] for p in compare] == ["2026-09-17", "2026-09-24"]
    assert left_out == {"from": "2026-10-01", "to": "2026-10-14", "days": 14}
    alone, _ = period.weeks(points(start, end), start, end, 7, totals)  # one line alone keeps its 4 whole weeks
    assert len(alone) == 4


# ---- 10. Today for a limited login: counts only over what it may see ---------------------------------------------------


def test_today_counts_for_a_limited_login_leave_out_rows_it_cannot_see(monkeypatch):
    who = access.Access(full=False, sites=frozenset({1}), sections={"today": "view", "insights": "view"}, spend=False)
    monkeypatch.setattr(today.access, "current", lambda: who)
    answer = {
        "todo": [{"kind": "leads_drop", "link": "#conversions", "reason": "losing_leads"}, {"kind": "page_drop", "link": "#overview", "reason": "losing_clicks"}],
        "going_down": [{"type": "page"}], "going_up": [], "moves_window": {"from": "2026-10-14", "to": "2026-10-20"}, "todo_drops": 2,
        "rival_changes": [], "other_edits": 0,
    }
    seen = today.for_person(answer)
    assert seen["todo"] == [] and seen["todo_drops"] == 0 and seen["moves_window"] is None


# ---- 5. Pages: a page that fell to no clicks and was never read is still under Losing clicks -----------------------------


def test_a_page_that_fell_to_nothing_and_was_never_read_is_listed_as_losing(engine):
    """28 days ending 16 Nov vs the 28 before (21 Sept - 18 Oct). /gone had 200 clicks before and no row since (deindexed),
    and the page reader never read it: it is listed with 0 clicks and a change of -200, first under Losing clicks."""
    from seo.web import create_app

    with engine.begin() as conn:
        one = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('one.example', 'https://one.example/', 'own')")).lastrowid
        for day, h, page, clicks in (("2026-09-21", "a", "https://one.example/a", 30), ("2026-11-16", "a", "https://one.example/a", 20), ("2026-10-05", "g", "https://one.example/gone", 200)):
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, :c, 5)"), {"s": one, "d": day, "h": h, "p": page, "c": clicks})
    client = create_app(engine=engine, auth=False).test_client()
    reply = client.get("/api/site-pages?from=2026-10-20&to=2026-11-16&compare_from=2026-09-21&compare_to=2026-10-18").json
    by = {r["url"]: r for r in reply["pages"]}
    assert (by["https://one.example/gone"]["clicks"], by["https://one.example/gone"]["clicks_before"], by["https://one.example/gone"]["change"]) == (0, 200, -200)
    assert by["https://one.example/a"]["change"] == -10 and reply["summary"]["losing"] == 2
