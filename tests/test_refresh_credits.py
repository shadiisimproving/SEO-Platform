"""Credit counting on every search (F57, F58, F15), AI Overviews first on Google, and the repeat guard on Recheck."""
from decimal import Decimal

import pytest
from sqlalchemy import text

from seo.core.errors import Refused
from seo.serp import connections, refresh
from seo.serp.tools import Answer, Found, SearchFailed, TimedOut, ToolStopped
from tests.test_refresh import ME, Fake, ask, run_now, save, spent, track, world  # noqa: F401 - world is a fixture


class Paged(Fake):
    """A tool billed per page, that can fail or time out on a given page of a deep search."""

    def __init__(self, name, fail_page=None, time_out_page=None, stop_page=None, gives_ai=False, **kw):
        super().__init__(name, **kw)
        self.fail_page, self.time_out_page, self.stop_page, self.gives_ai = fail_page, time_out_page, stop_page, gives_ai

    def search(self, keyword, engine, country, language, device, depth):
        self.calls.append((keyword, engine, depth))
        pages = (depth + 9) // 10
        for page in range(1, pages + 1):
            charged = (page - 1) * self.credits_per_page
            for wanted, kind in ((self.fail_page, SearchFailed), (self.time_out_page, TimedOut), (self.stop_page, ToolStopped)):
                if wanted == page:
                    exc = kind(f"page {page} went wrong")
                    exc.charged = charged
                    raise exc
        rows = [Found(i + 1, f"https://rival{i}.example/x", "T") for i in range(depth)]
        rows[2] = Found(3, f"https://{ME}/page", "Mine")
        return Answer(self.name, self.location, depth, rows, "present" if self.gives_ai else "not_captured", [], pages * self.credits_per_page)


def ledger(world, tool):
    with world.engine.connect() as conn:
        return [(int(r[0]), r[1]) for r in conn.execute(text("SELECT amount, note FROM credit_ledger WHERE tool = :t ORDER BY id"), {"t": tool}).all()]


# ---- the helper ---------------------------------------------------------------------------------------

def test_a_search_failing_on_page_3_keeps_the_two_pages_that_were_charged(world):
    tool = Paged("HasData", free_monthly=1000, credits_per_page=10, fail_page=3)
    with pytest.raises(SearchFailed) as caught:
        connections.spend_on_search(world.engine, tool, "deep", "google", "FR", "fr", depth=30)
    assert spent(world, "HasData") == 20 and caught.value.credits_kept == 20
    assert connections.used_this_month(world.engine, "HasData") == 20


def test_a_timeout_keeps_the_pages_that_went_out_and_gives_back_the_rest(world):
    tool = Paged("Searlo", free_once=3000, time_out_page=2)
    with pytest.raises(TimedOut) as caught:
        connections.spend_on_search(world.engine, tool, "deep", "google", "FR", "fr", depth=50)
    assert caught.value.credits_kept == 2 and spent(world, "Searlo") == 2  # page 1 answered, page 2 may be billed, 3 to 5 never went


def test_a_bot_check_on_the_first_page_gives_everything_back(world):
    tool = Paged("SerpApi", free_monthly=250, stop_page=1)
    with pytest.raises(ToolStopped):
        connections.spend_on_search(world.engine, tool, "k", "google", depth=20)
    assert spent(world, "SerpApi") == 0 and [amount for amount, _ in ledger(world, "SerpApi")] == [2, -2]  # written first, then given back


def test_a_crash_inside_the_tool_keeps_the_estimate(world):
    tool = Fake("Searlo", free_once=3000, explode=KeyError("organic"))
    with pytest.raises(KeyError) as caught:
        connections.spend_on_search(world.engine, tool, "k", "google", depth=20)
    assert spent(world, "Searlo") == 2 and caught.value.credits_kept == 2


def test_paid_searches_carry_their_dollars(world):
    tool = Paged("Bright Data", free_monthly=0, paid_per=0.01)
    answer = connections.spend_on_search(world.engine, tool, "k", "google", depth=20, paid=True)
    assert answer.cost == Decimal("0.02")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT SUM(cost) FROM credit_ledger WHERE paid = 1")).scalar() == Decimal("0.02")
    assert connections.used_this_month(world.engine, "Bright Data") == 0


# ---- Refresh uses it ----------------------------------------------------------------------------------

def test_refresh_keeps_the_credits_of_pages_that_worked_before_a_later_page_failed(world):
    first = Paged("HasData", free_monthly=1000, credits_per_page=10, fail_page=3)
    second = Fake("Searlo", free_once=3000)
    world.tools["google"] = [first, second]
    run = run_now(world, track(world, "deep"), depth=30)
    assert run["done"] == 1 and spent(world, "HasData") == 20 and spent(world, "Searlo") == 3


def test_paid_timeouts_count_against_the_runs_limit_and_the_tool_is_dropped_after_three(world):
    tool = Fake("Bright Data", free_monthly=0, paid_per=0.01, time_out={"a", "b", "c", "d", "e"})
    world.tools["google"] = [tool]
    connections.set_paid(world.engine, "Bright Data", True)
    run = run_now(world, track(world, "a", "b", "c", "d", "e"), allow_paid=True, paid_cap=1)
    assert len(tool.calls) == 3  # dropped after three timeouts in a row, not tried on every keyword
    assert run["spent"] == pytest.approx(0.03)  # what the timeouts may have cost is held against the limit
    assert "failed 3 searches in a row" in run["stop_reason"]


def test_paid_timeouts_stop_at_the_limit(world):
    tool = Fake("Bright Data", free_monthly=0, paid_per=0.01, time_out={"a", "b"})
    world.tools["google"] = [tool]
    connections.set_paid(world.engine, "Bright Data", True)
    run = run_now(world, track(world, "a", "b", "c", "d"), allow_paid=True, paid_cap=0.02)
    assert len(tool.calls) == 2 and run["spent"] == pytest.approx(0.02) and run["not_run"] == 2


# ---- AI Overviews first on Google ---------------------------------------------------------------------

def test_google_goes_to_the_ai_overview_tool_first_while_it_has_free_searches(world):
    bright = Paged("Bright Data", free_monthly=5000, paid_per=0.0015)
    serp = Paged("SerpApi", free_monthly=2, gives_ai=True)
    world.tools["google"] = [bright, serp]  # the saved order puts Bright Data first
    run = run_now(world, track(world, "a", "b", "c"))
    assert run["done"] == 3 and len(serp.calls) == 2 and len(bright.calls) == 1
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM serp_checks WHERE ai_state = 'present'")).scalar() == 2


def test_the_ai_first_rule_can_be_switched_off_and_other_engines_keep_the_order(world):
    bright, serp = Paged("Bright Data", free_monthly=5000), Paged("SerpApi", free_monthly=250, gives_ai=True)
    world.tools["google"] = [bright, serp]
    world.tools["bing"] = [bright, serp]
    run_now(world, track(world, "a"), engines=["bing"])
    assert len(bright.calls) == 1 and serp.calls == []
    connections.save_setting(world.engine, "ai_first", "0")
    run_now(world, track(world, "b"))
    assert len(bright.calls) == 2 and serp.calls == []
    with pytest.raises(Refused):
        connections.save_setting(world.engine, "ai_first", "maybe")


def test_the_preview_counts_the_ai_overview_tool_first(world):
    world.tools["google"] = [Paged("Bright Data", free_monthly=5000), Paged("SerpApi", free_monthly=1, gives_ai=True)]
    seen = refresh.preview(world.engine, ask(track(world, "a", "b")))
    checks = {p["name"]: p["checks"] for p in seen["tools"]}
    assert checks == {"SerpApi": 1, "Bright Data": 1}


def test_the_tool_list_says_which_tool_goes_first_for_google_and_why(world):
    listed = connections.tool_list(world.engine)
    assert listed["first_for_ai"] == {"google": ["Semscraper", "SerpApi"]} and "SerpApi while it has free searches" in listed["first_for_ai_why"]
    assert listed["order"]["google"][:2] == ["Semscraper", "Bright Data"]  # the saved order itself is untouched
    connections.save_setting(world.engine, "ai_first", "0")
    assert connections.tool_list(world.engine)["first_for_ai"] == {}


def test_other_callers_keep_the_plain_order(world):
    bright, serp = Paged("Bright Data", free_monthly=5000), Paged("SerpApi", free_monthly=250, gives_ai=True)
    world.tools["google"] = [bright, serp]
    assert [t.name for t in connections.tools_for(world.engine, "google")] == ["Bright Data", "SerpApi"]
    assert [t.name for t in connections.tools_for(world.engine, "google", ai_first=True)] == ["SerpApi", "Bright Data"]


# ---- Recheck: the 12-hour rule on the server ----------------------------------------------------------

def recheck(world, keyword_id, tool, again=False):
    return refresh.start(world.engine, {"keyword_ids": [keyword_id], "engines": ["google"], "depth": 10, "mode": "pick", "picked": [tool], "include_recent": again})


def test_recheck_with_the_same_tool_just_after_a_check_spends_nothing(world):
    serp = Fake("SerpApi", free_monthly=250)
    world.tools["google"] = [serp, Fake("Searlo", free_once=3000)]
    (keyword_id,) = track(world, "k")
    save(world, keyword_id, tool="SerpApi")
    with pytest.raises(Refused) as caught:
        recheck(world, keyword_id, "SerpApi")
    assert str(caught.value) == refresh.RECENT_ONE and spent(world, "SerpApi") == 0
    response = world.client.post("/api/refresh/runs", json={"keyword_ids": [keyword_id], "engines": ["google"], "depth": 10, "mode": "pick", "picked": ["SerpApi"]})
    assert response.status_code == 400 and response.get_json()["error"] == refresh.RECENT_ONE


def test_recheck_with_another_tool_or_on_purpose_still_runs(world):
    serp, searlo = Fake("SerpApi", free_monthly=250), Fake("Searlo", free_once=3000)
    world.tools["google"] = [serp, searlo]
    (keyword_id,) = track(world, "k")
    save(world, keyword_id, tool="SerpApi")
    recheck(world, keyword_id, "Searlo")
    world.drain()
    assert len(searlo.calls) == 1
    recheck(world, keyword_id, "SerpApi", again=True)  # the person pressed again, knowing
    world.drain()
    assert len(serp.calls) == 1


def test_a_run_says_which_searches_failed_and_why(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250, fail={"bad"}, time_out={"slow"})]
    run = run_now(world, track(world, "bad", "slow", "fine"))
    found = {f["keyword"]: f for f in run["failures"]}
    assert set(found) == {"bad", "slow"} and found["slow"]["timed_out"] and not found["bad"]["timed_out"]
    assert found["bad"]["error"].endswith(".") and found["bad"]["tool"] == "SerpApi" and found["bad"]["engine"] == "google"
    assert world.client.get(f"/api/refresh/runs/{run['id']}").get_json()["failures"][0]["keyword_id"]


# ---- The main tool --------------------------------------------------------------------------------------

def test_the_main_tool_goes_first_on_every_engine_ahead_of_the_ai_overview_tool(world):
    bright = Paged("Bright Data", free_monthly=5000, paid_per=0.0015)
    serp = Paged("SerpApi", free_monthly=250, gives_ai=True)
    world.tools["google"] = [bright, serp]
    connections.save_setting(world.engine, "main_tool", "Bright Data")
    assert [t.name for t in connections.tools_for(world.engine, "google", ai_first=True)] == ["Bright Data", "SerpApi"]
    assert connections.order_for(world.engine, "duckduckgo")[0] == "Bright Data"  # ahead of the free direct check
    assert connections.tool_list(world.engine)["first_for_ai"] == {}
    run = run_now(world, track(world, "a", "b"))
    assert run["done"] == 2 and len(bright.calls) == 2 and serp.calls == []
    connections.save_setting(world.engine, "main_tool", "")
    assert [t.name for t in connections.tools_for(world.engine, "google", ai_first=True)] == ["SerpApi", "Bright Data"]
    with pytest.raises(Refused):
        connections.save_setting(world.engine, "main_tool", "Nobody")
