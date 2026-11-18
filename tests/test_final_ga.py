"""Final Google Analytics and Search Console fixes (final review 2026-11-18: final-search-console-analytics.md W2b, N1-N4,
N6; final-competitors-exports.md N2, N7). Every figure is worked out by hand from the rows the test stores."""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors import common
from seo.exports import fmt, registry
from seo.metrics import ga4_checks, service, today as today_view
from tests.test_collectors import key, world  # noqa: F401 - fixtures

END = date(2026, 11, 16)
START = END - timedelta(days=27)  # 28 days: 20 Oct - 16 Nov
BEFORE_START, BEFORE_END = START - timedelta(days=28), START - timedelta(days=1)  # 22 Sep - 19 Oct


def _site(engine, host):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, 'own')"), {"h": host, "u": f"https://{host}/"}).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, property, data_through) VALUES (:s, 'ga4', '1', :d)"), {"s": site_id, "d": END})
    return site_id


def _day(engine, site_id, day, sessions, key_events=0.0, channel="Organic Search"):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events, leads) VALUES (:s, :d, :h, :c, 'google', 'organic', :x, :x, :k, 0)"),
            {"s": site_id, "d": day, "h": common.digest(channel, "google", "organic"), "c": channel, "x": sessions, "k": key_events},
        )
        conn.execute(
            text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, key_events, leads) VALUES (:s, :d, :h, '/contact/', :x, :k, 0)"),
            {"s": site_id, "d": day, "h": common.digest("/contact/"), "x": sessions, "k": key_events},
        )
        conn.execute(text("INSERT IGNORE INTO coverage (site_id, source, day, `rows`) VALUES (:s, 'ga4', :d, 1)"), {"s": site_id, "d": day})


def _scope(engine, site, start=START, end=END, cs=BEFORE_START, ce=BEFORE_END):
    return service.Scope(engine, site, start.isoformat(), end.isoformat(), cs.isoformat() if cs else None, ce.isoformat() if ce else None)


@pytest.fixture
def two_sites(engine):
    """forms.example: 100 visits a day, 10 of them with a key event. noforms.example: 300 visits a day, never a key event."""
    forms, noforms = _site(engine, "forms.example"), _site(engine, "noforms.example")
    for n in range(56):
        day = BEFORE_START + timedelta(days=n)
        _day(engine, forms, day, 100, 10)
        _day(engine, noforms, day, 300, 0)
    return forms, noforms


# ---- W2b: sites that record no key event stay out of the lead rate -----------------------------------------------


def test_the_lead_rate_leaves_out_sites_that_record_no_key_event(engine, two_sites):
    forms, noforms = two_sites
    channels = service.channels(_scope(engine, "all"))
    # 28 days: 2,800 + 8,400 visits, 280 with a key event. The rate is 280 / 2,800 = 10%, not 280 / 11,200 = 2.5%.
    assert channels["total"] == {"sessions": 11200, "leads": 280.0, "converted": 280.0, "rated": 2800}
    assert channels["channels"][0]["rate"] == 0.1 and channels["before"]["rated"] == 2800
    assert channels["no_lead_hosts"] == ["noforms.example"]
    assert all(day["rated"] == 100 for day in channels["days"])  # each day's rate: 10 of 100
    conversions = service.conversions(_scope(engine, "all"))
    assert conversions["rate"] == 0.1 and conversions["rated"] == 2800 and conversions["sessions"] == 11200
    assert conversions["funnel"][0]["lost"] == 2520  # 2,800 - 280: noforms' visits never were going to "become a lead"
    assert conversions["page_types"][0]["rate"] == 0.1 and conversions["before"]["rate"] == 0.1
    assert conversions["no_lead_hosts"] == ["noforms.example"]
    detail = service.channel_detail(_scope(engine, "all"), "Organic Search")
    assert detail["totals"]["rate"] == 0.1  # the side panel gives the row's rate
    # One site alone: no rate when it records nothing, never 0%.
    assert service.conversions(_scope(engine, noforms))["rate"] is None and service.conversions(_scope(engine, noforms))["no_lead_hosts"] == []
    assert service.conversions(_scope(engine, forms))["rate"] == 0.1


def test_the_exports_say_which_sites_are_left_out_of_the_rate(engine, two_sites):
    args = {"site_id": "all", "from": START.isoformat(), "to": END.isoformat(), "compare_from": BEFORE_START.isoformat(), "compare_to": BEFORE_END.isoformat()}
    report = registry.build(engine, "conversions", args)
    assert next(t for t in report.tiles if "rate" in t.label).value == 0.1
    assert "Left out of the rate, no leads or key events recorded: noforms.example." in report.notes
    fmt.MISSING.clear()
    french = registry.build(engine, "conversions", args, "fr")
    assert "Exclus du taux, aucune demande ni aucun événement clé enregistré : noforms.example." in [fmt.tr("fr", n) for n in french.notes]
    assert not fmt.MISSING, sorted(fmt.MISSING)


# ---- N4 and N6: a key event rate is an upper bound; the exports point to Settings → Sites --------------------------------


def test_a_key_event_rate_is_labelled_at_most_and_points_to_settings_sites(engine, two_sites):
    args = {"site_id": "all", "from": START.isoformat(), "to": END.isoformat()}
    report = registry.build(engine, "conversions", args)
    assert [t.label for t in report.tiles] == ["Visits", "Key events", "Key event rate, at most"]
    assert {c.label for tb in report.tables for c in tb.columns} >= {"Key event rate, at most"} and "Lead rate" not in {c.label for tb in report.tables for c in tb.columns}
    assert any(n.startswith("Key event rate, at most: each key event counts as one visit") for n in report.notes)
    assert "Key events: every Google Analytics key event. Pick which ones are leads in Settings → Sites." in report.notes
    assert not any("Settings → Google Analytics" in n for n in report.notes)


def test_no_export_points_to_settings_google_analytics_any_more():
    from pathlib import Path

    folder = Path(__file__).resolve().parent.parent / "seo" / "exports"
    assert not [p.name for p in folder.glob("*.py") if "Settings → Google Analytics" in p.read_text()]


# ---- N1 and N3: a period before with almost no data, on one site of several ------------------------------------------------


@pytest.fixture
def late_tag(engine):
    """steady.example: 10 visits a day for 56 days, so 280 now and 280 before (0%). late.example's tag started 10 days
    before the period: 2 visits a day then (20), and 24 a day on the period's last 10 days (240). Before the fix, 10 days
    with data before against 10 now passed as "enough", and late.example read +1,100%; All sites +73.3% (520 / 300)."""
    steady, late = _site(engine, "steady.example"), _site(engine, "late.example")
    for n in range(56):
        _day(engine, steady, BEFORE_START + timedelta(days=n), 10)
    for n in range(10):
        _day(engine, late, BEFORE_END - timedelta(days=n), 2)
        _day(engine, late, END - timedelta(days=n), 24)
    return steady, late


def test_too_little_data_before_is_judged_by_the_periods_length(engine, late_tag):
    steady, late = late_tag
    assert ga4_checks.little_before(engine, late, BEFORE_START, BEFORE_END) is True  # 10 days of 28: under half
    assert ga4_checks.little_before(engine, steady, BEFORE_START, BEFORE_END) is False
    alone = service.channels(_scope(engine, late))
    assert alone["little_before"] is True and alone["before"] is None and alone["little_hosts"] == ["late.example"]
    assert service.conversions(_scope(engine, late))["changes"] == {}


def test_all_sites_compare_only_the_sites_with_a_fair_period_before(engine, late_tag):
    steady, late = late_tag
    channels = service.channels(_scope(engine, "all"))
    assert channels["total"]["sessions"] == 520  # the sum is every site's
    assert channels["before"]["sessions"] == 280 and channels["compared"]["sessions"] == 280  # the change: steady's alone, 0%
    assert channels["little_before"] is False and channels["little_hosts"] == ["late.example"] and channels["compared_sites"] == [steady]
    assert channels["channels"][0]["change"] == 0.0
    conversions = service.conversions(_scope(engine, "all"))
    assert conversions["changes"]["sessions"] == 0.0 and conversions["compared"]["sessions"] == 280
    # Today, on the same 28 days, says the same: 0% on 1 of 2 sites, late.example left out with its reason.
    visits = today_view.today(engine, None, {"range": "28d"})["results"]["visits"]
    assert visits["value"] == 520 and visits["change"] == 0 and visits["compared"] == 1 and visits["sites"] == 2
    assert visits["left_out"] == [{"host": "late.example", "why": "little_before"}]


def test_the_exports_say_the_change_covers_fewer_sites(engine, late_tag):
    args = {"site_id": "all", "from": START.isoformat(), "to": END.isoformat(), "compare_from": BEFORE_START.isoformat(), "compare_to": BEFORE_END.isoformat()}
    report = registry.build(engine, "channels", args)
    assert report.tiles[0].value == 520 and report.tiles[0].change == 0.0  # 280 against 280, not 520 against 300
    assert "Visits change on 1 of 2 sites: too little data before on late.example." in report.notes
    today = registry.build(engine, "today", {"site_id": "all", "range": "28d"})
    assert "Visits change on 1 of 2 sites: too little data before on late.example." in today.notes
    fmt.MISSING.clear()
    assert fmt.tr("fr", "Visits change on 1 of 2 sites: too little data before on late.example.") == "Évolution des visites sur 1 des 2 sites : trop peu de données avant sur late.example."


# ---- N2 and N7: what the export files say about their own days ----------------------------------------------------------------


def test_the_overview_export_says_when_country_and_device_data_start():
    from seo.exports import views_search
    from seo.exports.model import Report

    window = {"from": "2026-10-19", "to": "2026-11-15", "compare_from": "2026-09-21", "compare_to": "2026-10-18", "history_from": "2025-07-19", "hourly": False,
              "rows_from": {"query": "2025-07-19", "page": "2025-07-19", "country": "2026-11-05", "device": "2026-11-05"},
              "rows_compare": {"query": True, "page": True, "country": False, "device": False}}
    assert views_search._rows_note(window, "country") == "Country data starts on 2026-11-05: days before aren't counted."
    assert views_search._rows_note(window, "device") == "Device data starts on 2026-11-05: days before aren't counted."
    assert views_search._rows_note(window, "query") is None
    # Once the backfill has reached the period's start, nothing is said.
    assert views_search._rows_note({**window, "rows_from": {**window["rows_from"], "country": "2025-07-19"}, "rows_compare": {**window["rows_compare"], "country": True}}, "country") is None
    fmt.MISSING.clear()
    assert fmt.tr("fr", "Country data starts on 2026-11-05: days before aren't counted.") == "Les données par pays commencent le 5 nov. 2026 : les jours d'avant ne sont pas comptés."
    report = Report("overview", "Search overview")
    views_search._period_notes(report, {"compare_unavailable": "google"})
    assert report.notes == ["No comparison: Google keeps 16 months of data."]
    assert fmt.tr("fr", report.notes[0]) == "Sans comparaison : Google garde 16 mois de données." and not fmt.MISSING


def test_the_pages_export_gives_googles_own_comparison_days():
    from types import SimpleNamespace

    from seo.exports import views_traffic
    from seo.exports.model import Report

    scope = SimpleNamespace(start=date(2026, 10, 20), end=date(2026, 11, 16), compare_start=date(2026, 9, 22), compare_end=date(2026, 10, 19), has_compare=True)
    report = Report("pages", "Pages")
    views_traffic._google_days(report, scope, {"gsc_window": {"from": "2026-10-19", "to": "2026-11-15", "compare_from": "2026-09-21", "compare_to": "2026-10-18"}})
    assert report.filters == [("Google numbers", (date(2026, 10, 19), date(2026, 11, 15))), ("Google numbers before", (date(2026, 9, 21), date(2026, 10, 18)))]


# ---- "?" text stored before the utf8mb4 conversion: read again (expert review 2026-11-17, 4c) ----------------------------


def test_the_days_holding_question_marks_are_read_again_once(world, monkeypatch):
    import json

    import httpx

    from scripts import reread_gsc_text
    from seo.collectors import gsc
    from tests.test_collectors import _google

    _google(world)
    today = common.google_today(world.engine)
    broken, clean = today - timedelta(days=40), today - timedelta(days=41)
    with world.engine.begin() as conn:
        for day, q, page in ((broken, "????? ?????", "https://mine.example/????/"), (clean, "creer societe", "https://mine.example/a/")):
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, 3, 30, 4)"), {"s": world.site, "d": day})
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 3, 30, 4)"), {"s": world.site, "d": day, "h": common.digest(q), "q": q})
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, 3, 30, 4)"), {"s": world.site, "d": day, "h": common.digest(page), "p": page})
            conn.execute(text("INSERT INTO gsc_country (site_id, day, country, clicks, impressions, position) VALUES (:s, :d, 'are', 3, 30, 4)"), {"s": world.site, "d": day})
    arabic, page = "تأسيس شركة", "https://mine.example/تأسيس/"
    asked = []

    def google(request):
        body = json.loads(request.content)
        asked.append((tuple(body["dimensions"]), body["startDate"]))
        keys = {("page",): [page], ("query",): [arabic], ("query", "page"): [arabic, page]}[tuple(body["dimensions"])]
        return httpx.Response(200, json={"rows": [{"keys": keys, "clicks": 3, "impressions": 30, "position": 4.0}]})

    world.answers["searchAnalytics"] = google
    assert reread_gsc_text.run(world.engine, apply=False, log=None) == {"mine.example": {"done": 0, "left": 1}} and not asked  # a dry run asks Google nothing
    assert reread_gsc_text.run(world.engine, apply=True, pause=0, log=None) == {"mine.example": {"done": 1, "left": 0}}
    assert sorted(asked) == [(("page",), broken.isoformat()), (("query",), broken.isoformat()), (("query", "page"), broken.isoformat())]  # 3 calls, only the broken day
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT query FROM gsc_query WHERE day = :d"), {"d": broken}).scalars().all() == [arabic]
        assert conn.execute(text("SELECT page FROM gsc_page WHERE day = :d"), {"d": broken}).scalars().all() == [page]
        assert conn.execute(text("SELECT query, page FROM gsc_query_page WHERE day = :d"), {"d": broken}).all() == [(arabic, page)]
        assert conn.execute(text("SELECT query FROM gsc_query WHERE day = :d"), {"d": clean}).scalars().all() == ["creer societe"]  # untouched
        assert conn.execute(text("SELECT COUNT(*) FROM gsc_country WHERE day = :d"), {"d": broken}).scalar() == 1  # numbers aren't read again
    asked.clear()
    assert reread_gsc_text.run(world.engine, apply=True, pause=0, log=None) == {"mine.example": {"done": 0, "left": 0}} and not asked  # done once
    assert gsc.TEXT_SOURCE == "gsc_text" and reread_gsc_text.not_converted(world.engine) == []


def test_reading_again_refuses_before_the_conversion(engine, monkeypatch, capsys):
    from scripts import reread_gsc_text

    monkeypatch.setattr(reread_gsc_text, "not_converted", lambda engine: ["gsc_query.query"])
    monkeypatch.setattr(reread_gsc_text, "make_engine", lambda test=False: engine)
    assert reread_gsc_text.main(["--apply"]) == 1
    assert "convert the database to utf8mb4 first" in capsys.readouterr().err
