"""Search insights, the rest of the catalogue: A4, A6, A7, B2, B3, C6–C11, D1–D3, E1–E3, F1. Each one fires above its floor
and stays quiet below it, on made-up shop-one.test data (see test_insights.py for the World helper)."""
import json
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import text

from seo.collectors.common import digest
from seo.insights import data, decline, engine as insights, impact, movement, rules, technical, value, wins, words
from tests.test_insights import BEFORE, END, NOW, World, _found, site  # noqa: F401 - site is a fixture

HOME = "https://shop-one.test/"


def _brand(engine, site_id, word="shopone"):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, 'brand', :w)"), {"s": site_id, "w": word})


def _kinds(result, kind):
    return [f for f in result.findings if f.kind == kind]


# ---- words ---------------------------------------------------------------------------------------


def test_words_fold_plurals_and_spot_questions():
    assert words.tokens("Créer sociétés à Séville") == ["creer", "societe", "seville"]
    assert words.is_question("comment créer une société") and words.is_question("how much is a visa") and words.is_question("visa prix ?")
    assert words.is_question("combien coute un visa") and not words.is_question("visa prix seville")
    assert words.share(["comptable"], ["comptabilite"]) and not words.share(["visa"], ["vivre"])
    assert words.is_home("https://x.test/") and words.is_home("https://x.test/fr/") and not words.is_home("https://x.test/visa/")


# ---- A4 ------------------------------------------------------------------------------------------


def test_a_query_that_lost_three_places_is_said_with_its_page(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "blue shoes", HOME + "blue", 4, 100, 4)
    w.spread(*NOW, "blue shoes", HOME + "blue", 2, 100, 9)
    w.spread(*BEFORE, "red shoes", HOME + "red", 4, 100, 4)
    w.spread(*NOW, "red shoes", HOME + "red", 4, 100, 5)  # one place: not enough
    w.save()
    found = _kinds(movement.queries_down(data.load(engine, site)), "query_down")
    assert [f.query for f in found] == ["blue shoes"]
    f = found[0]
    assert f.page == HOME + "blue" and f.evidence["places"] == 5
    expected = 100 * 28 * (data.default_rate(4) - data.default_rate(9)) * rules.MONTH
    assert f.at_stake == pytest.approx(expected, abs=1)


# ---- A6 ------------------------------------------------------------------------------------------


def _devices(engine, site_id, first, last, mobile, desktop):
    with engine.begin() as conn:
        day = first
        while day <= last:
            for device, clicks in (("MOBILE", mobile), ("DESKTOP", desktop)):
                conn.execute(text("INSERT INTO gsc_device (site_id, day, device, clicks, impressions, position) VALUES (:s, :d, :v, :c, :i, 5)"), {"s": site_id, "d": day, "v": device, "c": clicks, "i": clicks * 20})
            day += timedelta(days=1)


def test_one_device_carrying_the_drop_is_said(engine, site):
    w = World(engine, site)
    w.spread(BEFORE[0], NOW[1], "shoes", HOME, 10, 100, 5)
    w.save()
    _devices(engine, site, *BEFORE, mobile=6, desktop=4)
    _devices(engine, site, *NOW, mobile=2, desktop=4)  # mobile −112, desktop steady
    found = _kinds(movement.segments(data.load(engine, site)), "segment")
    assert len(found) == 1 and found[0].evidence["segment"] == "MOBILE" and found[0].evidence["down"]
    assert found[0].at_stake == pytest.approx(112 * rules.MONTH, abs=1)


def test_a_drop_spread_over_devices_names_none(engine, site):
    w = World(engine, site)
    w.spread(BEFORE[0], NOW[1], "shoes", HOME, 10, 100, 5)
    w.save()
    _devices(engine, site, *BEFORE, mobile=6, desktop=6)
    _devices(engine, site, *NOW, mobile=3, desktop=3)
    assert not _kinds(movement.segments(data.load(engine, site)), "segment")


# ---- A7 ------------------------------------------------------------------------------------------


def test_a_query_jumping_between_places_is_unstable_and_a_steady_one_is_not(engine, site):
    w = World(engine, site)
    day = NOW[0]
    n = 0
    while day <= NOW[1]:
        w.add(day, "jumpy", HOME + "jumpy", 0, 10, 2 if n % 2 else 12)
        w.add(day, "steady", HOME + "steady", 1, 10, 5)
        day += timedelta(days=1)
        n += 1
    w.save()
    found = _kinds(movement.unstable(data.load(engine, site)), "unstable")
    assert [f.query for f in found] == ["jumpy"]
    assert found[0].evidence["better"] <= 2.5 and found[0].evidence["worse"] >= 11.5 and found[0].at_stake > 0


# ---- C11 -----------------------------------------------------------------------------------------


def test_brand_holding_the_total_up_hides_a_non_brand_loss(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "shopone shoes", HOME, 2, 20, 1)
    w.spread(*NOW, "shopone shoes", HOME, 4, 30, 1)
    w.spread(*BEFORE, "cheap shoes", HOME + "cheap", 4, 100, 3)
    w.spread(*NOW, "cheap shoes", HOME + "cheap", 2, 100, 3)
    w.save()
    assert movement.brand_split(data.load(engine, site)).needs == {"brand_split": "brand_words"}
    _brand(engine, site)
    found = _kinds(movement.brand_split(data.load(engine, site)), "brand_split")
    assert len(found) == 1
    ev = found[0].evidence
    assert ev["other_change"] == -56 and ev["brand_change"] == 56 and ev["percent"] == -50


# ---- B2 ------------------------------------------------------------------------------------------


def test_a_slow_position_slide_over_eight_weeks(engine, site):
    w = World(engine, site)
    first = END - timedelta(days=7 * rules.SLIDE_WEEKS - 1)
    w.add(first - timedelta(days=30), "old", HOME, 1, 1, 1)  # history goes back far enough
    day = first
    while day <= END:
        week = (day - first).days // 7
        w.add(day, "sliding", HOME + "s", 1, 10, 3 + week * 0.6)  # 0.6 places a week
        w.add(day, "flat", HOME + "f", 1, 10, 4)
        day += timedelta(days=1)
    w.save()
    ctx = data.load(engine, site)
    found = _kinds(decline.slide(ctx), "slide")
    assert [f.query for f in found] == ["sliding"]
    assert found[0].evidence["slope"] == pytest.approx(0.6, abs=0.05) and found[0].evidence["position"] > found[0].evidence["position_before"]
    assert not decline.slide(ctx, {"sliding"}).findings  # already said under What changed


# ---- B3 ------------------------------------------------------------------------------------------


def test_a_drop_that_also_happened_last_year_is_seasonal_and_counts_half(engine, site):
    w = World(engine, site)
    year = timedelta(days=rules.SEASON_DAYS)
    for shift in (year, timedelta(0)):
        w.spread(BEFORE[0] - shift, BEFORE[1] - shift, "ski jackets", HOME + "ski", 10, 200, 4)
        w.spread(NOW[0] - shift, NOW[1] - shift, "ski jackets", HOME + "ski", 4, 200, 4)
    w.spread(BEFORE[0], BEFORE[1], "boots", HOME + "boots", 10, 200, 4)  # dropped this year only
    w.spread(NOW[0], NOW[1], "boots", HOME + "boots", 4, 200, 4)
    w.spread(BEFORE[0] - year, NOW[1] - year, "boots", HOME + "boots", 10, 200, 4)
    w.save()
    ctx = data.load(engine, site)
    pages = movement.pages(ctx).findings
    stakes = {f.page: f.at_stake for f in pages}
    decline.seasonal(ctx, pages)
    by_page = {f.page: f for f in pages}
    ski, boots = by_page[HOME + "ski"], by_page[HOME + "boots"]
    assert ski.evidence["seasonal"] and ski.evidence["last_year"]["percent"] == -60
    assert ski.at_stake == pytest.approx(stakes[HOME + "ski"] * rules.SEASON_STAKE, abs=0.1) and ski.severity != "big"
    assert not boots.evidence.get("seasonal") and boots.at_stake == stakes[HOME + "boots"]


def test_seasonal_waits_for_a_year_of_history(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "shoes", HOME, 10, 100, 5)
    w.spread(*NOW, "shoes", HOME, 2, 100, 5)
    w.save()
    ctx = data.load(engine, site)
    assert decline.seasonal(ctx, movement.pages(ctx).findings).needs == {"seasonal": "history"}


# ---- C6 to C10 -----------------------------------------------------------------------------------


def test_a_page_near_page_one_on_ten_queries(engine, site):
    w = World(engine, site)
    for n in range(10):
        w.spread(*NOW, f"garden tool {n}", HOME + "garden", 0, 2, 15)
    for n in range(9):
        w.spread(*NOW, f"kitchen thing {n}", HOME + "kitchen", 0, 2, 15)
    w.save()
    found = _kinds(wins.page_near(data.load(engine, site)), "page_near")
    assert [f.page for f in found] == [HOME + "garden"]
    assert found[0].evidence["queries_count"] == 10 and found[0].at_stake > 0


def test_no_page_of_its_own_for_a_search_only_the_home_page_answers_badly(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "garden furniture", HOME, 0, 8, 20)  # the home page on page 2: no page of its own
    w.spread(*NOW, "shop one store", HOME, 5, 8, 2)  # the home page doing well: fine
    w.spread(*NOW, "garden furniture sale", HOME + "garden-furniture/", 0, 8, 20)  # a page about it exists
    w.spread(*NOW, "watering can", HOME + "kitchen/", 0, 8, 25)  # a page about something else
    w.save()
    found = {f.query: f for f in _kinds(wins.no_page(data.load(engine, site)), "no_page")}
    assert set(found) == {"garden furniture", "watering can"}
    assert found["garden furniture"].evidence["home"] and not found["watering can"].evidence["home"]


def test_question_searches_grouped_by_their_page(engine, site):
    w = World(engine, site)
    for q in ("how to clean shoes", "comment laver des chaussures", "why do shoes smell"):
        w.spread(*NOW, q, HOME + "care", 0, 2, 8)
    w.spread(*NOW, "shoe care kit", HOME + "care", 1, 5, 4)
    w.spread(*NOW, "how to tie laces", HOME + "laces", 0, 2, 8)  # one question only
    w.save()
    found = _kinds(wins.questions(data.load(engine, site)), "questions")
    assert [f.page for f in found] == [HOME + "care"]
    assert found[0].evidence["queries_count"] == 3 and found[0].severity == "info"


def test_a_topic_with_demand_but_no_strong_page_is_flagged(engine, site):
    w = World(engine, site)
    for n, extra in enumerate(("cheap", "best", "price", "online", "kids", "red")):
        w.spread(*NOW, f"umbrella {extra}", HOME + f"rain-{n}", 0, 3, 25)  # weak: page 3
    for n, extra in enumerate(("cheap", "best", "price", "online", "kids", "red")):
        w.spread(*NOW, f"sandals {extra}", HOME + "sandals", 3, 3, 3)  # strong page
    for n in range(10):
        w.spread(*NOW, f"filler{n} thing{n}", HOME + f"f{n}", 0, 1, 30)
    w.save()
    found = _kinds(wins.topics(data.load(engine, site)), "topic")
    assert [f.evidence["word"] for f in found] == ["umbrella"]
    assert found[0].evidence["queries_count"] == 6 and found[0].evidence["label"] == "umbrella" and found[0].at_stake > 0


def test_topics_need_enough_queries(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "umbrella cheap", HOME, 0, 3, 25)
    w.save()
    assert wins.topics(data.load(engine, site)).needs == {"topic": "more_data"}


def test_worth_tracking_skips_what_is_tracked_and_the_brand(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "rain boots", HOME + "boots", 2, 10, 8)
    w.spread(*NOW, "snow boots", HOME + "boots", 2, 10, 8)
    w.spread(*NOW, "shopone boots", HOME, 5, 10, 1)
    w.save()
    _brand(engine, site)
    with engine.begin() as conn:
        kid = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash) VALUES ('snow boots', :h)"), {"h": digest("snow boots")}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
    found = _kinds(wins.worth_tracking(data.load(engine, site)), "track")
    assert [f.query for f in found] == ["rain boots"]


# ---- D -------------------------------------------------------------------------------------------


def _ga4(engine, site_id, path, sessions, leads, days=60):
    with engine.begin() as conn:
        for back in range(days):
            conn.execute(
                text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, :h, :p, :x, :x, :k)"),
                {"s": site_id, "d": END - timedelta(days=back), "h": digest(path)[:32], "p": path, "x": sessions, "k": leads},
            )


def test_leads_rank_a_lead_page_first_and_find_clicks_without_leads(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "quote form", HOME + "quote/", 10, 200, 3)
    w.spread(*NOW, "quote form", HOME + "quote/", 4, 200, 3)
    w.spread(BEFORE[0], NOW[1], "free guide", HOME + "guide/", 5, 100, 3)
    w.save()
    ctx = data.load(engine, site)
    assert value.leads(ctx, []).needs == {"lead_page": "ga4", "no_leads": "ga4"}
    _ga4(engine, site, "/quote/", 10, 1)  # a 10% lead rate
    _ga4(engine, site, "/guide/", 5, 0)
    ctx = data.load(engine, site)
    drops = movement.pages(ctx).findings
    result = value.leads(ctx, drops)
    lead = _kinds(result, "lead_page")
    assert len(lead) == 1 and lead[0].page == HOME + "quote/" and lead[0].grp == "leads"
    assert lead[0].evidence["lead_rate"] == {"rate": 10.0, "basis": "page"}
    assert drops[0].evidence["leads_at_stake"] == pytest.approx(drops[0].at_stake * 0.1, abs=0.01)
    assert lead[0].severity == "big"  # 168 clicks a month × 10% = 16.8 leads a month
    quiet = _kinds(result, "no_leads")
    assert [f.page for f in quiet] == [HOME + "guide/"] and quiet[0].evidence["clicks"] == 280


# ---- E -------------------------------------------------------------------------------------------


def test_one_page_under_two_addresses_is_a_duplicate(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "shoes", "https://shop-one.test/shoes/", 2, 20, 5)
    w.spread(*NOW, "shoes cheap", "https://www.shop-one.test/shoes", 1, 20, 7)
    w.spread(*NOW, "hats", "https://shop-one.test/hats/", 1, 20, 5)
    w.save()
    found = _kinds(technical.duplicates(data.load(engine, site)), "duplicate")
    assert len(found) == 1 and found[0].evidence["count"] == 2 and set(found[0].evidence["kinds"]) == {"www", "slash"}
    assert found[0].severity == "normal"


def test_a_page_google_shows_that_the_health_test_flags(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "shoes", HOME + "shoes/", 2, 20, 5)
    w.spread(*NOW, "hats", HOME + "hats/", 2, 20, 5)
    w.save()
    with engine.begin() as conn:
        audit = conn.execute(text("INSERT INTO health_audits (site_id, status) VALUES (:s, 'complete')"), {"s": site}).lastrowid
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, 'noindex', 1, :p)"), {"a": audit, "p": json.dumps([HOME + "shoes/"])})
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, 'almost_no_text', 1, :p)"), {"a": audit, "p": json.dumps([HOME + "hats/"])})
    found = _kinds(technical.shown_broken(data.load(engine, site)), "shown_broken")
    assert [f.page for f in found] == [HOME + "shoes/"] and found[0].evidence["causes"] == ["noindex"]


def test_data_gaps_only_for_what_a_new_pull_can_fix(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "shoes", HOME, 2, 20, 5)
    w.save()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_verify (site_id, period_start, period_end, ok, diff) VALUES (:s, :a, :b, 0, :d)"),
                     {"s": site, "a": NOW[0], "b": NOW[1], "d": json.dumps({"days": [], "queries": [{"q": 1}], "pages": []})})
    assert not technical.data_gaps(data.load(engine, site)).findings
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status) VALUES (:s, 'gsc', :d, 'partial')"), {"s": site, "d": END - timedelta(days=3)})
    found = technical.data_gaps(data.load(engine, site)).findings
    assert len(found) == 1 and found[0].evidence["partial"] == [(END - timedelta(days=3)).isoformat()] and found[0].evidence["verify"] is None


# ---- F1 ------------------------------------------------------------------------------------------


def _task(engine, site_id, done: date, pages=None, keywords=None, title="Rewrote the title"):
    with engine.begin() as conn:
        return conn.execute(
            text("INSERT INTO tasks (title, status, site_id, pages, keywords, completed_at) VALUES (:t, 'done', :s, :p, :k, :c)"),
            {"t": title, "s": site_id, "p": json.dumps(pages or []), "k": json.dumps(keywords or []), "c": datetime.combine(done, datetime.min.time())},
        ).lastrowid


def test_a_done_task_gets_its_before_and_after_and_a_recent_one_waits(engine, site):
    done = END - timedelta(days=40)
    w = World(engine, site)
    w.spread(done - timedelta(days=28), done - timedelta(days=1), "shoes", HOME + "shoes/", 2, 100, 8)
    w.spread(done, END, "shoes", HOME + "shoes/", 5, 100, 4)
    w.save()
    old = _task(engine, site, done, pages=["/shoes/"])
    recent = _task(engine, site, END - timedelta(days=10), keywords=["shoes"])
    _task(engine, site, done, title="Nothing named")
    found = {f.evidence["task_id"]: f for f in _kinds(impact.results(data.load(engine, site)), "task_result")}
    assert set(found) == {old, recent}
    ev = found[old].evidence
    assert ev["ready"] and ev["before"]["clicks"] == 56 and ev["after"]["clicks"] == 140 and ev["verdict"] == "better"
    assert ev["before"]["position"] == 8 and ev["after"]["position"] == 4
    assert not found[recent].evidence["ready"] and found[recent].evidence["ready_on"] == (END - timedelta(days=10) + timedelta(days=35)).isoformat()


# ---- The whole run -------------------------------------------------------------------------------


def test_a_full_run_saves_the_new_kinds_in_their_groups(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "blue shoes", HOME + "blue", 4, 100, 4)
    w.spread(*NOW, "blue shoes", HOME + "blue", 2, 100, 9)
    w.spread(*NOW, "garden furniture", HOME, 0, 8, 20)
    w.save()
    insights.run(engine, site)
    groups = {(r["kind"], r["grp"]) for r in _found(engine, site)}
    assert ("query_down", "changed") in groups and ("no_page", "wins") in groups
    assert all(len(kind) <= 30 for kind, _ in groups)
    assert not insights.run(engine, site)["added"]  # the same data again: nothing new
