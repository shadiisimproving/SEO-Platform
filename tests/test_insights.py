"""Search insights: each detector fires above its floor and stays quiet below it, on final, whole days only; the engine keeps
findings between runs, marks them gone, brings "Not useful" back at twice worse, raises one alert per big drop and feeds Today."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.collectors.common import digest
from seo.insights import data, engine as insights, movement, rules, service, wins
from seo.metrics import today

END = date(2026, 11, 1)  # last final day
FRESH = END + timedelta(days=1)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from) VALUES (:s, 'gsc', :d, :f)"), {"s": site_id, "d": END, "f": FRESH})
    return site_id


class World:
    """Made-up Search Console days, written in bulk. Each call adds to what's there."""

    def __init__(self, engine, site_id):
        self.engine, self.site = engine, site_id
        self.daily: dict[date, list] = {}

    def add(self, day: date, query: str, page: str, clicks: int, shown: int, position: float):
        with self.engine.begin() as conn:
            for table, key, column, name in (("gsc_query", "query_hash", "query", query), ("gsc_page", "page_hash", "page", page)):
                conn.execute(
                    text(
                        f"INSERT INTO {table} (site_id, day, {key}, {column}, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, :i, :p) "
                        "ON DUPLICATE KEY UPDATE position = (position * impressions + VALUES(position) * VALUES(impressions)) / (impressions + VALUES(impressions)), clicks = clicks + VALUES(clicks), impressions = impressions + VALUES(impressions)"
                    ),
                    {"s": self.site, "d": day, "h": digest(name), "n": name, "c": clicks, "i": shown, "p": position},
                )
            conn.execute(
                text("INSERT INTO gsc_query_page (site_id, day, pair_hash, query, page, clicks, impressions, position) VALUES (:s, :d, :h, :q, :pg, :c, :i, :p)"),
                {"s": self.site, "d": day, "h": digest(query, page), "q": query, "pg": page, "c": clicks, "i": shown, "p": position},
            )
        slot = self.daily.setdefault(day, [0, 0, 0.0])
        slot[0] += clicks
        slot[1] += shown
        slot[2] += position * shown

    def spread(self, first: date, last: date, query: str, page: str, clicks: int, shown: int, position: float):
        day = first
        while day <= last:
            self.add(day, query, page, clicks, shown, position)
            day += timedelta(days=1)

    def save(self, extra_clicks: dict | None = None):
        """gsc_daily as Google gives it: the queries' sums, plus whatever rare queries it hides."""
        with self.engine.begin() as conn:
            conn.execute(text("DELETE FROM gsc_daily WHERE site_id = :s"), {"s": self.site})
            for day, (c, i, w) in self.daily.items():
                conn.execute(
                    text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, :p)"),
                    {"s": self.site, "d": day, "c": c + (extra_clicks or {}).get(day, 0), "i": i, "p": w / i if i else None},
                )


def _before(days_back_from: int, days_back_to: int):
    return END - timedelta(days=days_back_from), END - timedelta(days=days_back_to)


NOW = (END - timedelta(days=27), END)
BEFORE = (END - timedelta(days=55), END - timedelta(days=28))


def _found(engine, site, kind=None, status="open"):
    sql = "SELECT * FROM search_findings WHERE site_id = :s AND status = :st" + (" AND kind = :k" if kind else "")
    with engine.connect() as conn:
        return [dict(r) | {"evidence": json.loads(r["evidence"]) if isinstance(r["evidence"], str) else r["evidence"]} for r in conn.execute(text(sql), {"s": site, "st": status, "k": kind}).mappings().all()]


# ---- A1 ------------------------------------------------------------------------------------------


def test_breakdown_parts_add_up_and_name_ranking_when_only_positions_fell(engine, site):
    w = World(engine, site)
    # Same impressions, worse positions, and the click rate follows the curve down: the loss is ranking.
    for query, before_pos, now_pos in (("blue shoes", 3, 8), ("red shoes", 4, 9), ("green hat", 2, 2)):
        shown = 100
        w.spread(*BEFORE, query, "https://shop-one.test/" + query.split()[0], round(shown * data.default_rate(before_pos)), shown, before_pos)
        w.spread(*NOW, query, "https://shop-one.test/" + query.split()[0], round(shown * data.default_rate(now_pos)), shown, now_pos)
    w.add(END - timedelta(days=3), "new thing", "https://shop-one.test/new", 7, 20, 5)
    w.add(BEFORE[0] + timedelta(days=2), "old thing", "https://shop-one.test/old", 5, 20, 5)
    w.save(extra_clicks={END - timedelta(days=1): 9})
    ctx = data.load(engine, site)
    found = movement.breakdown(ctx).findings[0]
    parts, ev = found.evidence["parts"], found.evidence
    assert ev["change"] == ev["now"]["clicks"] - ev["before"]["clicks"]
    assert sum(parts.values()) == pytest.approx(ev["change"], abs=len(parts))  # rounded parts
    assert ev["main"] == "ranking"
    assert parts["ranking"] < 0 and abs(parts["demand"]) < 1
    assert parts["new"] == 7 and parts["lost"] == -5 * 1 and parts["hidden"] == 9
    assert [m["query"] for m in ev["movers"]["ranking"]][:2] == ["blue shoes", "red shoes"]
    assert found.severity == "big" and found.at_stake > 0


def test_breakdown_is_steady_below_the_floor_and_waits_for_history(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "shoes", "https://shop-one.test/", 10, 100, 5)
    w.spread(*NOW, "shoes", "https://shop-one.test/", 10, 104, 5)
    w.save()
    found = movement.breakdown(data.load(engine, site)).findings[0]
    assert found.evidence["steady"] and found.severity == "info"
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM gsc_daily WHERE site_id = :s AND day < :d"), {"s": site, "d": NOW[0]})
    result = movement.breakdown(data.load(engine, site))
    assert result.needs == {"change": "history"} and not result.findings and "change" not in result.ran


def test_fresh_days_are_never_read_and_a_partial_day_takes_its_twin_out(engine, site):
    w = World(engine, site)
    w.spread(*BEFORE, "shoes", "https://shop-one.test/", 10, 100, 5)
    w.spread(*NOW, "shoes", "https://shop-one.test/", 10, 100, 5)
    w.add(FRESH, "shoes", "https://shop-one.test/", 0, 3, 5)  # a fresh, low day
    w.save()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status) VALUES (:s, 'gsc', :d, 'partial')"), {"s": site, "d": END - timedelta(days=2)})
    ctx = data.load(engine, site)
    assert ctx.end == END
    assert set(ctx.skip) == {END - timedelta(days=2), END - timedelta(days=30)}
    found = movement.breakdown(ctx).findings[0]
    assert found.evidence["now"]["clicks"] == found.evidence["before"]["clicks"] == 270  # 27 days each: the partial one and its twin left out
    assert not movement.odd_days(ctx).findings


# ---- A2 ------------------------------------------------------------------------------------------


def test_an_odd_day_against_the_same_weekday_and_two_in_a_row_is_big(engine, site):
    w = World(engine, site)
    first = END - timedelta(days=7 * 9)
    day = first
    while day <= END:
        weekend = day.weekday() >= 5
        w.add(day, "shoes", "https://shop-one.test/", 8 if weekend else 40, 400, 4)  # quiet weekends are normal
        day += timedelta(days=1)
    w.save()
    assert not movement.odd_days(data.load(engine, site)).findings
    with engine.begin() as conn:
        conn.execute(text("UPDATE gsc_daily SET clicks = 4 WHERE site_id = :s AND day = :d"), {"s": site, "d": END - timedelta(days=1) if (END - timedelta(days=1)).weekday() < 5 else END - timedelta(days=3)})
    odd = movement.odd_days(data.load(engine, site)).findings
    assert len(odd) == 1 and odd[0].evidence["low"] and odd[0].severity == "normal" and odd[0].at_stake == pytest.approx(36)
    weekdays = [END - timedelta(days=b) for b in range(7) if (END - timedelta(days=b)).weekday() < 5]
    with engine.begin() as conn:
        for d in weekdays[:2]:
            conn.execute(text("UPDATE gsc_daily SET clicks = 3 WHERE site_id = :s AND day = :d"), {"s": site, "d": d})
    odd = movement.odd_days(data.load(engine, site)).findings
    assert {f.severity for f in odd if f.subject in {d.isoformat() for d in weekdays[:2]}} == {"big"}


# ---- A3, A5 --------------------------------------------------------------------------------------


def test_a_page_losing_clicks_names_its_queries_and_why(engine, site):
    w = World(engine, site)
    page = "https://shop-one.test/boots"
    w.spread(*BEFORE, "boots", page, 4, 60, 3)
    w.spread(*NOW, "boots", page, 1, 60, 9)
    w.spread(*BEFORE, "small", "https://shop-one.test/small", 1, 10, 5)
    w.spread(*NOW, "small", "https://shop-one.test/small", 0, 10, 5)  # 28 → 0 but the drop would be under the floor? no: 28 ≥ 20
    w.save()
    result = movement.pages(data.load(engine, site))
    down = {f.page: f for f in result.findings if f.kind == "page_down"}
    assert down[page].evidence["why"] == "ranking" and down[page].evidence["queries"][0]["query"] == "boots"
    assert down[page].severity == "big" and down[page].at_stake == pytest.approx(84 * rules.MONTH, abs=0.1)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM gsc_page WHERE page = 'https://shop-one.test/small'"))
    w2 = movement.pages(data.load(engine, site))
    assert "https://shop-one.test/small" not in {f.page for f in w2.findings}


def test_a_page_below_the_floor_stays_quiet(engine, site):
    w = World(engine, site)
    w.add(BEFORE[0], "tiny", "https://shop-one.test/tiny", 15, 100, 5)
    w.add(NOW[0], "tiny", "https://shop-one.test/tiny", 5, 100, 5)
    w.save()
    assert not movement.pages(data.load(engine, site)).findings


def test_a_page_that_left_google_is_said_once_with_what_the_health_test_saw(engine, site):
    w = World(engine, site)
    gone = "https://shop-one.test/visa"
    w.spread(END - timedelta(days=60), END - timedelta(days=7), "visa", gone, 2, 30, 6)
    w.spread(END - timedelta(days=60), END, "home", "https://shop-one.test/", 5, 50, 2)
    w.save()
    with engine.begin() as conn:
        audit = conn.execute(text("INSERT INTO health_audits (site_id, status) VALUES (:s, 'complete')"), {"s": site}).lastrowid
        conn.execute(text("INSERT INTO health_issues (audit_id, code, page_count, pages) VALUES (:a, 'noindex', 1, :p)"), {"a": audit, "p": json.dumps([gone])})
    insights.run(engine, site)
    out = _found(engine, site, "dropped_out")
    assert len(out) == 1 and out[0]["evidence"]["causes"] == ["noindex"] and out[0]["severity"] == "big"
    assert not _found(engine, site, "page_down")  # not said twice
    with engine.connect() as conn:
        alert = conn.execute(text("SELECT title, detail FROM alerts WHERE site_id = :s AND kind = 'search_drop'"), {"s": site}).mappings().all()
    assert len(alert) == 1 and alert[0]["title"] == "/visa dropped out of Google"


# ---- B1 ------------------------------------------------------------------------------------------


def test_decay_finds_a_slow_slide_and_not_a_steady_page(engine, site):
    w = World(engine, site)
    for week in range(16):
        first = END - timedelta(days=7 * (15 - week) + 6)
        w.spread(first, first + timedelta(days=6), "guide", "https://shop-one.test/guide", max(1, 6 - week // 3), 80, 5)
        w.spread(first, first + timedelta(days=6), "home", "https://shop-one.test/", 4, 80, 2)
    w.save()
    result = __import__("seo.insights.decline", fromlist=["decay"]).decay(data.load(engine, site))
    pages = {f.page for f in result.findings}
    assert pages == {"https://shop-one.test/guide"}
    ev = result.findings[0].evidence
    assert len(ev["weeks"]) == 16 and ev["weeks"][0] > ev["weeks"][-1] and ev["below_peak"] >= 25


# ---- C -------------------------------------------------------------------------------------------


def test_quick_wins(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "almost page one", "https://shop-one.test/a", 0, 3, 14)
    w.spread(*NOW, "close to top", "https://shop-one.test/b", 1, 20, 6)
    w.spread(*NOW, "never clicked", "https://shop-one.test/c", 0, 10, 7)
    w.spread(*NOW, "two pages", "https://shop-one.test/d1", 0, 2, 8)
    w.spread(*NOW, "two pages", "https://shop-one.test/d2", 0, 2, 12)
    w.add(NOW[0], "too small", "https://shop-one.test/e", 0, 12, 15)  # 12 impressions in 28 days: under the floor of 20
    w.save()
    result = wins.wins(data.load(engine, site))
    by = {}
    for f in result.findings:
        by.setdefault(f.kind, set()).add(f.subject)
    assert "almost page one" in by["almost"] and "too small" not in by.get("almost", set())
    assert "close to top" in by["top3"]
    assert "never clicked" in by["no_click"]
    assert by["compete"] == {"two pages"}
    assert result.needs["low_ctr"] == "brand_words" and "low_ctr" not in result.ran
    compete = next(f for f in result.findings if f.kind == "compete")
    assert compete.page == "https://shop-one.test/d1" and [p["share"] for p in compete.evidence["pages"]] == [50, 50]


# ---- The engine ----------------------------------------------------------------------------------


def _simple_world(engine, site, now_clicks=1):
    w = World(engine, site)
    w.spread(*BEFORE, "boots", "https://shop-one.test/boots", 4, 60, 3)
    w.spread(*NOW, "boots", "https://shop-one.test/boots", now_clicks, 60, 9)
    w.save()
    return w


def test_a_second_run_updates_and_a_finding_that_went_away_is_gone(engine, site):
    _simple_world(engine, site)
    first = insights.run(engine, site)
    again = insights.run(engine, site)
    assert first["added"] > 0 and again["added"] == 0 and again["updated"] == first["added"]
    with engine.begin() as conn:
        conn.execute(text("UPDATE gsc_page SET clicks = 4 WHERE site_id = :s"), {"s": site})
    insights.run(engine, site)
    assert not _found(engine, site, "page_down")
    assert _found(engine, site, "page_down", status="gone")
    with engine.connect() as conn:
        assert not conn.execute(text("SELECT 1 FROM alerts WHERE kind = 'search_drop' AND acknowledged_at IS NULL")).first()


def test_a_kind_that_could_not_run_keeps_its_findings(engine, site):
    _simple_world(engine, site)
    insights.run(engine, site)
    assert _found(engine, site, "page_down")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM gsc_daily WHERE site_id = :s AND day < :d"), {"s": site, "d": NOW[0]})
    insights.run(engine, site)
    assert _found(engine, site, "page_down")  # no history now, so it couldn't look: still open


def test_not_useful_comes_back_only_at_twice_worse(engine, site):
    _simple_world(engine, site, now_clicks=3)
    insights.run(engine, site)
    finding = _found(engine, site, "page_down")[0]
    service.dismiss(engine, finding["id"])
    insights.run(engine, site)
    assert _found(engine, site, "page_down", status="dismissed")
    with engine.begin() as conn:
        conn.execute(text("UPDATE gsc_page SET clicks = 0 WHERE site_id = :s AND day >= :d"), {"s": site, "d": NOW[0]})
    insights.run(engine, site)
    assert _found(engine, site, "page_down")  # 28 lost → 112 lost: back


def test_a_done_task_marks_its_finding_done(engine, site):
    _simple_world(engine, site)
    insights.run(engine, site)
    finding = _found(engine, site, "page_down")[0]
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tasks (title, status, site_id, source) VALUES ('Fix boots', 'done', :s, :src)"), {"s": site, "src": json.dumps({"type": "search", "key": finding["finding_key"]})})
    insights.run(engine, site)
    assert _found(engine, site, "page_down", status="done")
    assert service.one(engine, finding["id"])["task"] == "done"


def test_runs_only_when_a_new_final_day_arrived(engine, site):
    _simple_world(engine, site)
    assert insights.enqueue_if_new(engine, site)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM jobs"))
    insights.run(engine, site)
    assert insights.enqueue_if_new(engine, site) is None
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions) VALUES (:s, :d, 1, 10)"), {"s": site, "d": FRESH})
        conn.execute(text("UPDATE site_sources SET fresh_from = :f WHERE site_id = :s"), {"s": site, "f": FRESH + timedelta(days=1)})
    assert insights.enqueue_if_new(engine, site)


def test_listing_names_each_subject_once_and_today_takes_the_normal_ones(engine, site):
    w = World(engine, site)
    w.spread(*NOW, "close to top", "https://shop-one.test/b", 1, 40, 6)
    w.spread(*NOW, "never clicked", "https://shop-one.test/c", 0, 10, 7)
    w.save()
    insights.run(engine, site)
    first = service.listing(engine, site, "first")
    subjects = [r["query"] or r["page"] for r in first["rows"]]
    assert len(subjects) == len(set(subjects)) and subjects
    rows = service.today_rows(engine, site)
    assert rows and all(r["severity"] == "normal" for r in rows)
    board = today.today(engine, site)
    found = [item for item in board["todo"] if item["kind"] == "search_finding"]
    assert found and all(item["seen_key"] and "keyword_id" in item for item in found)  # keyword_id: the query in the title opens its keyword
    assert len({item["id"] for item in board["todo"]}) == len(board["todo"])


def test_a_cliff_is_a_page_losing_clicks_not_a_slow_decline(engine, site):
    w = World(engine, site)
    for week in range(16):
        first = END - timedelta(days=7 * (15 - week) + 6)
        w.spread(first, first + timedelta(days=6), "cliff", "https://shop-one.test/cliff", 8 if week < 12 else 2, 80, 5)
    w.save()
    from seo.insights import decline

    assert not decline.decay(data.load(engine, site)).findings


def test_a_query_gone_from_google_this_week_is_not_a_quick_win(engine, site):
    w = World(engine, site)
    w.spread(NOW[0], END - timedelta(days=8), "gone query", "https://shop-one.test/g", 1, 20, 6)
    w.spread(*NOW, "here query", "https://shop-one.test/h", 1, 20, 6)
    w.save()
    subjects = {f.subject for f in wins.wins(data.load(engine, site)).findings}
    assert "here query" in subjects and "gone query" not in subjects
