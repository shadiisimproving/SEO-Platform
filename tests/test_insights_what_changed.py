"""Insights → What changed, part 1 of the 2026-11-17 rework (no AI): less noise, a real why per page, when the fall
started, Google's indexing answer, my own edits, and the panel's facts. Made-up shop-one.test data (World, test_insights.py)."""
import hashlib
import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from seo.insights import data, engine as insights, movement, rules, service
from tests.test_insights import BEFORE, END, NOW, World, _found, site  # noqa: F401 - site is a fixture

HOME = "https://shop-one.test/"


def _spread_total(w: World, first, last, query, page, clicks: int, shown_a_day: int, position: float):
    """`clicks` over the days, as evenly as whole numbers allow."""
    days = (last - first).days + 1
    for n in range(days):
        share = clicks * (n + 1) // days - clicks * n // days
        w.add(first + timedelta(days=n), query, page, share, shown_a_day, position)


def _kinds(result, kind):
    return [f for f in result.findings if f.kind == kind]


# ---- 1b. A real why per page ---------------------------------------------------------------------------


def test_a_page_at_6_5_to_7_9_with_58_to_46_clicks_lost_them_to_ranking(engine, site):
    """The owner's real case: the old guess said "Lower click rate" for a fall of 1.4 places."""
    w = World(engine, site)
    page = HOME + "banned-drugs/"
    _spread_total(w, *BEFORE, "banned drugs dubai", page, 58, 50, 6.5)
    _spread_total(w, *NOW, "banned drugs dubai", page, 46, 50, 7.9)
    w.save()
    ctx = data.load(engine, site)
    old = movement._why({"position_before": 6.5, "position": 7.9, "impressions_before": 1400, "impressions": 1400})
    assert old == "appeal"  # what it used to say
    f = _kinds(movement.pages(ctx), "page_down")[0]
    e = f.evidence
    assert e["why"] == "ranking"
    assert e["split"]["ranking"] < e["split"]["click_rate"] and e["split"]["ranking"] <= -10
    assert sum(e["split"].values()) == pytest.approx(-12, abs=0.5)
    assert not e.get("uncertain")  # 12 clicks alone could be chance, but 1.4 places over 1,400 impressions are not
    assert e["queries"][0]["tag"] == "places"


def test_since_is_the_first_day_the_page_fell(engine, site):
    w = World(engine, site)
    page = HOME + "boots"
    fell = NOW[0] + timedelta(days=9)
    w.spread(BEFORE[0], fell - timedelta(days=1), "boots", page, 4, 60, 4)
    w.spread(fell, NOW[1], "boots", page, 1, 60, 9)
    w.save()
    f = _kinds(movement.pages(data.load(engine, site)), "page_down")[0]
    assert f.evidence["why"] == "ranking" and f.evidence["since"] == fell.isoformat()


def test_since_by_clicks_when_the_page_did_not_lose_places(engine, site):
    w = World(engine, site)
    page = HOME + "hats"
    fell = NOW[0] + timedelta(days=5)
    w.spread(BEFORE[0], fell - timedelta(days=1), "hats", page, 8, 100, 3)
    w.spread(fell, NOW[1], "hats", page, 2, 100, 3)
    w.save()
    f = _kinds(movement.pages(data.load(engine, site)), "page_down")[0]
    assert f.evidence["why"] == "appeal" and f.evidence["since"] == fell.isoformat()
    assert f.evidence["queries"][0]["tag"] == "click_rate"


def test_not_indexed_beats_every_other_cause(engine, site):
    w = World(engine, site)
    page = HOME + "boots"
    w.spread(*BEFORE, "boots", page, 4, 60, 4)
    w.spread(*NOW, "boots", page, 1, 60, 9)
    w.save()
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage, google_canonical, last_crawl, inspected_at) VALUES (:s, :h, :u, 'NEUTRAL', 'Crawled - currently not indexed', :c, :l, UTC_TIMESTAMP())"),
            {"s": site, "h": hashlib.sha256(page.encode()).hexdigest(), "u": page, "c": HOME + "boots-2", "l": datetime(2026, 10, 20, 8)},
        )
    f = _kinds(movement.pages(data.load(engine, site)), "page_down")[0]
    assert f.evidence["why"] == "not_indexed"
    assert f.evidence["google"]["state"] == "not_indexed" and f.evidence["google"]["google_canonical"] == HOME + "boots-2"


def test_a_search_another_page_took_is_tagged_with_that_page(engine, site):
    w = World(engine, site)
    page, other = HOME + "boots", HOME + "boots-new"
    w.spread(*BEFORE, "rain boots", page, 4, 60, 4)
    w.spread(*NOW, "rain boots", other, 4, 60, 4)
    w.spread(*BEFORE, "boots", page, 2, 30, 5)
    w.spread(*NOW, "boots", page, 2, 30, 5)
    w.save()
    f = _kinds(movement.pages(data.load(engine, site)), "page_down")[0]
    q = f.evidence["queries"][0]
    assert q["query"] == "rain boots" and q["tag"] == "other_page" and q["other_page"] == other
    assert f.evidence["why"] == "demand"  # lost searches count as "Searches"


# ---- 1a. Noise --------------------------------------------------------------------------------------------


def test_a_small_page_drop_could_be_chance_and_comes_last_out_of_the_totals(engine, site):
    w = World(engine, site)
    _spread_total(w, *BEFORE, "scarves", HOME + "scarves", 30, 20, 5)
    _spread_total(w, *NOW, "scarves", HOME + "scarves", 18, 20, 5)  # −12 < 2·√48 ≈ 13.9: could be chance
    _spread_total(w, *BEFORE, "gloves", HOME + "gloves", 140, 100, 3)
    _spread_total(w, *NOW, "gloves", HOME + "gloves", 70, 100, 3)  # −70: real
    w.save()
    insights.run(engine, site)
    down = {f["page"]: f for f in _found(engine, site, "page_down")}
    assert down[HOME + "scarves"]["evidence"]["uncertain"] and down[HOME + "scarves"]["severity"] == "info"
    assert not down[HOME + "gloves"]["evidence"].get("uncertain") and down[HOME + "gloves"]["severity"] != "info"
    rows = service.listing(engine, site, "changed")["rows"]
    kinds = [(r["page"], bool(r["evidence"].get("uncertain"))) for r in rows if r["kind"] == "page_down"]
    assert kinds[-1] == (HOME + "scarves", True)  # last, whatever it has at stake
    summary = service.listing(engine, site, "changed")["summary"]
    assert summary["to_recover"] == round(70 * rules.MONTH)  # the chance drop isn't counted


def test_falling_out_of_the_top_3_is_said_even_under_3_places(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "visa price", HOME + "visa", 10, 100, 2.6)
    w.spread(*NOW, "visa price", HOME + "visa", 6, 100, 4.4)
    w.spread(*BEFORE, "visa form", HOME + "form", 2, 100, 8)
    w.spread(*NOW, "visa form", HOME + "form", 2, 100, 9.5)  # 1.5 places, not from the top 3: nothing
    w.save()
    found = _kinds(movement.queries_down(data.load(engine, site)), "query_down")
    assert [f.query for f in found] == ["visa price"] and found[0].evidence["top3_lost"]


def test_fewer_clicks_at_the_same_position(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "what is a free zone", HOME + "free-zone", 3, 100, 2)
    w.spread(*NOW, "what is a free zone", HOME + "free-zone", 1, 110, 2.3)  # 84 → 28 clicks at about the same place
    w.spread(*BEFORE, "free zone list", HOME + "list", 3, 100, 2)
    w.spread(*NOW, "free zone list", HOME + "list", 3, 100, 2)
    w.save()
    found = _kinds(movement.queries_down(data.load(engine, site)), "ctr_drop")
    assert [f.query for f in found] == ["what is a free zone"]
    e = found[0].evidence
    assert e["click_rate_before"] == 3.0 and e["click_rate"] == pytest.approx(0.91, abs=0.01)
    assert found[0].at_stake == pytest.approx(110 * 28 * (0.03 - 28 / 3080) * rules.MONTH, abs=0.5)
    assert "ctr_drop" in service.LOSS_KINDS


def test_alike_searches_on_one_page_are_one_row(engine, site):
    w = World(engine, site)
    for q in ("company setup dubai", "dubai company setup", "company setups dubai 2026"):
        w.spread(*BEFORE, q, HOME + "setup", 4, 100, 3)
        w.spread(*NOW, q, HOME + "setup", 1, 100, 8)
    w.save()
    found = _kinds(movement.queries_down(data.load(engine, site)), "query_down")
    assert len(found) == 1
    e = found[0].evidence
    assert len(e["alike"]) == 3 and e["clicks_before"] == 3 * 4 * 28 and e["clicks"] == 3 * 28 and e["impressions"] == 3 * 2800
    assert e["position"] == 8 and e["position_before"] == 3
    single = (data.default_rate(3) - data.default_rate(8)) * 2800 * rules.MONTH
    assert found[0].at_stake == pytest.approx(3 * single, abs=1)


def test_unstable_needs_real_views_and_goes_to_quick_wins(engine, site):
    w = World(engine, site)
    day, n = NOW[0], 0
    while day <= NOW[1]:
        w.add(day, "jumpy", HOME + "jumpy", 1, 12, 2 if n % 2 else 12)  # 336 views, 12 a day
        w.add(day, "thin", HOME + "thin", 0, 4, 2 if n % 2 else 12)  # 4 a day: too few to say where it ranks
        day += timedelta(days=1)
        n += 1
    w.save()
    found = movement.unstable(data.load(engine, site)).findings
    assert [(f.kind, f.query, f.grp) for f in found] == [("unstable", "jumpy", "wins")]


def test_a_weighted_day_counts_by_its_views():
    # Three quiet days at 15 and one busy day at 3: the busy day is most of what people saw.
    assert movement._weighted_quartiles([(15, 5), (15, 5), (15, 5), (3, 100)]) == (3, 3, 3)


def test_unstable_with_far_too_few_clicks_is_said_as_rarely_clicked(engine, site):
    w = World(engine, site)
    day, n = NOW[0], 0
    while day <= NOW[1]:
        w.add(day, "jumpy", HOME + "jumpy", 0, 12, 2 if n % 2 else 12)
        day += timedelta(days=1)
        n += 1
    w.save()
    found = movement.unstable(data.load(engine, site)).findings
    assert len(found) == 1 and found[0].kind == "no_click" and found[0].grp == "wins"
    assert "better" not in found[0].evidence and found[0].evidence["from"] == "unstable"


# ---- 1c. The panel ----------------------------------------------------------------------------------------


def test_the_page_panel_has_google_my_edit_and_a_search_console_link(engine, site):
    w = World(engine, site)
    page = HOME + "boots"
    fell = NOW[0] + timedelta(days=9)
    w.spread(BEFORE[0], fell - timedelta(days=1), "boots", page, 4, 60, 4)
    w.spread(fell, NOW[1], "boots", page, 1, 60, 9)
    w.save()
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET property = 'sc-domain:shop-one.test' WHERE site_id = :s AND source = 'gsc'"), {"s": site})
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop-one.test')")).lastrowid
        pid = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, last_checked_at) VALUES (:d, :u, :h, UTC_TIMESTAMP())"), {"d": domain, "u": page, "h": hashlib.sha256(page.encode()).hexdigest()}).lastrowid
        for kind, before, after, at in (("title", "Boots", "Boots for sale", fell - timedelta(days=3)), ("content", "800 words", "500 words", fell - timedelta(days=3)), ("h1", "a", "b", fell - timedelta(days=30))):
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, :k, :b, :a, :t)"), {"p": pid, "d": domain, "k": kind, "b": before, "a": after, "t": datetime.combine(at, datetime.min.time()) + timedelta(hours=10)})
        conn.execute(
            text("INSERT INTO gsc_inspections (site_id, url_hash, url, verdict, coverage, last_crawl, inspected_at) VALUES (:s, :h, :u, 'PASS', 'Submitted and indexed', :l, UTC_TIMESTAMP())"),
            {"s": site, "h": hashlib.sha256(page.encode()).hexdigest(), "u": page, "l": datetime(2026, 10, 28, 9)},
        )
    insights.run(engine, site)
    row = _found(engine, site, "page_down")[0]
    f = service.one(engine, row["id"])
    d = f["detail"]
    assert d["google"]["state"] == "indexed" and d["google"]["crawled"] == "2026-10-28"
    assert [x["kind"] for x in d["edit"]["events"]] in (["title", "content"], ["content", "title"])  # the last edit's day only
    assert d["edit"]["events"][0]["at"] == (fell - timedelta(days=3)).isoformat()
    assert d["console"].startswith("https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Ashop-one.test&page=!https%3A%2F%2Fshop-one.test%2Fboots")
    assert f"end_date={END.strftime('%Y%m%d')}" in d["console"] and "compare_start_date=" in d["console"]


def test_no_edit_seen_says_whether_the_reader_knows_the_page(engine, site):
    assert service.own_edit(engine, HOME + "never-read", "2026-10-20") == {"read": False, "since": "2026-10-20", "events": []}
