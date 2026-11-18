"""The Refresh button and the ranking rules, on the real database and worker, with fake search tools that count every spend."""
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from seo.core.errors import Conflict, Refused
from seo.links import service as links
from seo.serp import connections, rankings, refresh, store
from seo.serp.tools import Answer, Found, SearchFailed, TimedOut, ToolStopped
from seo.web import create_app
from seo.worker.runner import tick

ALLOW = lambda url: True  # noqa: E731
ME = "me.example"


class Fake:
    """A search tool that answers from a table, and writes down each search that really went out."""

    def __init__(self, name, free_monthly=None, position=3, location="FR", free_once=None, paid_per=None, credits_per_page=1, stop_after=None, fail=(), time_out=(), per_hour=None, manual_only=False, explode=None, bot_check=False):
        self.name, self.free_monthly, self.position, self.location, self.stop_after = name, free_monthly, position, location, stop_after
        self.free_once, self.paid_per, self.credits_per_page, self.fail, self.time_out = free_once, paid_per, credits_per_page, set(fail), set(time_out)
        self.most_per_search = credits_per_page
        self.per_hour, self.manual_only, self.explode, self.bot_check = per_hour, manual_only, explode, bot_check
        self.calls = []
        self.tries = 0  # every search asked of it, including the ones it refused

    def search(self, keyword, engine, country, language, device, depth):
        self.tries += 1
        if self.stop_after is not None and len(self.calls) >= self.stop_after:
            raise ToolStopped(f"{self.name} asked for a bot check.", bot_check=self.bot_check)
        self.calls.append((keyword, engine, depth))
        if self.explode:
            raise self.explode
        if keyword in self.time_out:
            raise TimedOut("The request failed: ReadTimeout")
        if keyword in self.fail:
            raise SearchFailed("It answered 500")
        position = self.position[keyword] if isinstance(self.position, dict) else self.position
        rows = [Found(i + 1, f"https://rival{i}.example/x", "T") for i in range(max(0, min(depth, 10)))]
        if position is not None and position <= len(rows):
            rows[position - 1] = Found(position, f"https://{ME}/page", "Mine")
        return Answer(self.name, self.location, depth, rows, "not_captured", [], self.credits_per_page * ((depth + 9) // 10) if self.free_monthly is not None or self.free_once is not None or self.paid_per is not None else 0)


class Killed(BaseException):
    """What a killed process looks like from inside: nothing after this line runs."""


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    w = SimpleNamespace(engine=engine, tools={}, client=create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client())
    monkeypatch.setattr(connections, "tool_factory", lambda eng, name: list(w.tools.get(name, [])))
    w.site = links.add_site(engine, f"https://{ME}/", "own", is_allowed=ALLOW)["id"]
    w.drain = lambda: tick(engine, "refresh", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    return w


def track(world, *names, country="FR", language="fr", site=None):
    ids = []
    with world.engine.begin() as conn:
        for name in names:
            conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, :l)"), {"k": name, "h": store.keyword_hash(name), "c": country, "l": language})
            keyword_id = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = :c AND language = :l"), {"h": store.keyword_hash(name), "c": country, "l": language}).scalar_one()
            conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site or world.site, "k": keyword_id})
            ids.append(keyword_id)
    return ids


def ask(ids, **extra):
    return {"keyword_ids": ids, "engines": ["google"], "depth": 10, "include_recent": True, **extra}


def run_now(world, ids, **extra):
    started = refresh.start(world.engine, ask(ids, **extra), extra.pop("by", None))
    world.drain()
    return refresh.run_dict(world.engine, started["id"])


def save(world, keyword_id, tool="SerpApi", location="FR", depth=10, position=3, status="ok", name="google", at=None):
    rows = [Found(i + 1, f"https://rival{i}.example/x", "T") for i in range(max(depth, position or 0))]
    if position is not None:
        rows[position - 1] = Found(position, f"https://{ME}/page", "Mine")
    return store.save_check(world.engine, keyword_id, name, Answer(tool, location, depth, rows, "not_captured", [], 1), "refresh", at=at, status=status)


def row_of(world, keyword_id, name="google"):
    listed = rankings.listing(world.engine, world.site)
    return next(r for r in listed["rows"] if r["keyword_id"] == keyword_id)["engines"][name]


def spent(world, tool):
    with world.engine.connect() as conn:
        return int(conn.execute(text("SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE tool = :t"), {"t": tool}).scalar())


def statuses(world, run_id):
    with world.engine.connect() as conn:
        return [r[0] for r in conn.execute(text("SELECT status FROM rank_run_items WHERE run_id = :r ORDER BY id"), {"r": run_id}).all()]


# ---- spend -------------------------------------------------------------------------------------------

def test_a_run_saves_one_check_per_keyword_and_counts_what_it_spent(world):
    tool = Fake("SerpApi", free_monthly=250)
    world.tools["google"] = [tool]
    run = run_now(world, track(world, "one", "two", "three"))
    assert run["status"] == "done" and run["done"] == 3 and run["failed"] == 0
    assert len(tool.calls) == 3 and spent(world, "SerpApi") == 3 and connections.used_this_month(world.engine, "SerpApi") == 3


def test_a_double_click_counts_once(world):
    tool = Fake("SerpApi", free_monthly=250)
    world.tools["google"] = [tool]
    ids = track(world, "one", "two")
    first = refresh.start(world.engine, ask(ids, token="same-token-123"))
    second = refresh.start(world.engine, ask(ids, token="same-token-123"))
    assert second["id"] == first["id"] and second["repeat"] is True
    world.drain()
    assert len(tool.calls) == 2 and spent(world, "SerpApi") == 2
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM rank_runs")).scalar() == 1


def test_two_people_never_pay_twice_and_the_second_is_told_who(world):
    tool = Fake("SerpApi", free_monthly=250)
    world.tools["google"] = [tool]
    ids = track(world, "one", "two", "three")
    refresh.start(world.engine, ask(ids[:2]), "Sara")
    seen = refresh.preview(world.engine, ask(ids))
    assert {(r["keyword"], r["by"]) for r in seen["running"]} == {("one", "Sara"), ("two", "Sara")} and seen["checks"] == 1
    second = refresh.start(world.engine, ask(ids), "Nour")
    assert second["total"] == 1 and {(r["keyword"], r["by"]) for r in second["excluded"]} == {("one", "Sara"), ("two", "Sara")}
    world.drain()
    assert sorted(call[0] for call in tool.calls) == ["one", "three", "two"] and spent(world, "SerpApi") == 3


def test_when_a_colleague_has_all_of_them_it_refuses_and_nothing_is_left_behind(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    ids = track(world, "one")
    refresh.start(world.engine, ask(ids), "Sara")
    with pytest.raises(Conflict):
        refresh.start(world.engine, ask(ids), "Nour")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM rank_runs")).scalar() == 1


def test_a_crash_keeps_the_spend_and_never_repeats_that_search(world):
    tool = Fake("SerpApi", free_monthly=250)
    second = Fake("Searlo", free_once=3000)
    world.tools["google"] = [tool, second]
    ids = track(world, "boom", "after")
    real_search = tool.search

    def search(keyword, *args):
        if keyword == "boom":
            tool.calls.append((keyword,))
            raise Killed()
        return real_search(keyword, *args)

    tool.search = search
    started = refresh.start(world.engine, ask(ids))
    with pytest.raises(Killed):
        world.drain()
    assert spent(world, "SerpApi") == 1  # written down before the search went out
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE kind = 'refresh.run'"))
    world.drain()
    run = refresh.run_dict(world.engine, started["id"])
    assert run["status"] == "done" and run["done"] == 1 and run["failed"] == 1
    assert [call[0] for call in tool.calls].count("boom") == 1 and second.calls == []
    assert spent(world, "SerpApi") == 2


def test_a_timeout_is_never_tried_again_and_stays_charged(world):
    first, second = Fake("SerpApi", free_monthly=250, time_out={"slow"}), Fake("Searlo", free_once=3000)
    world.tools["google"] = [first, second]
    run = run_now(world, track(world, "slow", "fine"))
    assert run["failed"] == 1 and run["done"] == 1 and run["status"] == "done"
    assert [call[0] for call in first.calls] == ["slow", "fine"] and second.calls == []
    assert spent(world, "SerpApi") == 2
    assert "timeout" in statuses(world, run["id"])


def test_running_out_of_free_credits_moves_to_the_next_free_tool_and_says_so(world):
    first, second = Fake("SerpApi", free_monthly=2), Fake("Searlo", free_once=3000)
    world.tools["google"] = [first, second]
    run = run_now(world, track(world, "a", "b", "c", "d"))
    assert run["status"] == "done" and run["done"] == 4
    assert len(first.calls) == 2 and len(second.calls) == 2
    assert run["moved"] == {"from": "SerpApi", "to": "Searlo", "why": "ran out of free checks"}
    assert connections.free_left(world.engine, first) == 0


def test_the_free_allowance_is_never_passed(world):
    tool = Fake("HasData", free_monthly=25, credits_per_page=10)
    world.tools["google"] = [tool]
    run = run_now(world, track(world, "a", "b", "c", "d"))
    assert len(tool.calls) == 2 and spent(world, "HasData") == 20  # a third would need 30 of the 25
    assert run["status"] == "stopped" and run["done"] == 2 and run["not_run"] == 2


def test_with_no_free_tool_left_it_stops_keeps_what_was_saved_and_says_so(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=2)]
    run = run_now(world, track(world, "a", "b", "c"))
    assert run["status"] == "stopped" and run["done"] == 2 and run["not_run"] == 1
    assert "No free tools left for Google" in run["stop_reason"]
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM serp_checks WHERE status = 'ok'")).scalar() == 2
        assert conn.execute(text("SELECT COUNT(*) FROM rank_run_items WHERE active_key IS NOT NULL")).scalar() == 0


def test_a_bot_check_refunds_the_estimate_and_moves_on(world):
    first, second = Fake("SerpApi", free_monthly=250, stop_after=1), Fake("Searlo", free_once=3000)
    world.tools["google"] = [first, second]
    run = run_now(world, track(world, "a", "b"))
    assert run["status"] == "done" and run["done"] == 2 and spent(world, "SerpApi") == 1 and spent(world, "Searlo") == 1
    assert "bot check" in run["stop_reason"]


def ddg_world(world, works=False):
    """DuckDuckGo direct first, as on a server DuckDuckGo blocks, then SerpApi."""
    blocked, other = Fake("DuckDuckGo direct", stop_after=None if works else 0, bot_check=True), Fake("SerpApi", free_monthly=250)
    world.tools["duckduckgo"] = [blocked, other]
    return blocked, other


def test_the_tray_says_why_a_tool_handed_over_not_always_credits(world):
    blocked, other = ddg_world(world)
    run = run_now(world, track(world, "a", "b"), engines=["duckduckgo"])
    assert run["done"] == 2 and blocked.tries == 1 and len(other.calls) == 2
    assert run["moved"] == {"from": "DuckDuckGo direct", "to": "SerpApi", "why": "was blocked by a bot check"}


def test_after_a_bot_check_automatic_runs_skip_that_tool_for_a_day(world):
    blocked, other = ddg_world(world)
    ids = track(world, "a", "b")
    run_now(world, ids, engines=["duckduckgo"])
    seen = refresh.preview(world.engine, ask(ids, engines=["duckduckgo"]))
    assert [b["name"] for b in seen["blocked"]] == ["DuckDuckGo direct"] and "bot check" in seen["blocked"][0]["why"]
    assert seen["blocked"][0]["at"] and seen["blocked"][0]["until"] > seen["blocked"][0]["at"]
    assert {tool["name"]: tool["checks"] for tool in seen["tools"]} == {"SerpApi": 2}  # the checks go to the next tool
    second = run_now(world, ids, engines=["duckduckgo"])
    assert blocked.tries == 1 and second["status"] == "done" and second["done"] == 2 and second["moved"] is None
    assert "DuckDuckGo direct was skipped" in second["stop_reason"]


def test_the_skip_ends_after_a_day_and_a_search_that_works_lifts_it(world, monkeypatch):
    from datetime import timedelta

    blocked, _other = ddg_world(world)
    ids = track(world, "a")
    run_now(world, ids, engines=["duckduckgo"])
    assert connections.blocked(world.engine, "DuckDuckGo direct")
    real_now = connections._now
    monkeypatch.setattr(connections, "_now", lambda: real_now() + timedelta(hours=connections.BLOCK_HOURS, minutes=1))
    assert connections.blocked(world.engine, "DuckDuckGo direct") is None
    blocked.stop_after = None  # DuckDuckGo lets it through again
    run_now(world, ids, engines=["duckduckgo"])
    assert blocked.tries == 2 and len(blocked.calls) == 1
    monkeypatch.setattr(connections, "_now", real_now)
    connections.note_blocked(world.engine, "DuckDuckGo direct", "DuckDuckGo asked for a bot check.")
    run_now(world, ids, engines=["duckduckgo"], mode="pick", picked=["DuckDuckGo direct"])
    assert connections.blocked(world.engine, "DuckDuckGo direct") is None


def test_a_blocked_tool_picked_by_hand_still_runs_and_the_preview_warns_first(world):
    blocked, other = ddg_world(world, works=True)
    ids = track(world, "a")
    connections.note_blocked(world.engine, "DuckDuckGo direct", "DuckDuckGo asked for a bot check.")
    body = ask(ids, engines=["duckduckgo"], mode="pick", picked=["DuckDuckGo direct"])
    seen = refresh.preview(world.engine, body)
    assert [b["name"] for b in seen["blocked"]] == ["DuckDuckGo direct"] and seen["checks"] == 1
    run = run_now(world, ids, engines=["duckduckgo"], mode="pick", picked=["DuckDuckGo direct"])
    assert blocked.tries == 1 and run["done"] == 1 and other.calls == []


def test_a_bot_check_in_another_job_also_rests_the_tool(world):
    blocked, _other = ddg_world(world)
    with pytest.raises(ToolStopped):
        connections.spend_on_search(world.engine, blocked, "a", "duckduckgo", "FR", "fr")
    assert connections.blocked(world.engine, "DuckDuckGo direct")
    assert [tool.name for tool in connections.not_blocked(world.engine, world.tools["duckduckgo"])] == ["SerpApi"]


def test_a_failed_search_goes_to_the_next_tool_without_charging(world):
    first, second = Fake("SerpApi", free_monthly=250, fail={"bad"}), Fake("Searlo", free_once=3000)
    world.tools["google"] = [first, second]
    run = run_now(world, track(world, "bad"))
    assert run["done"] == 1 and spent(world, "SerpApi") == 0 and spent(world, "Searlo") == 1


def test_a_tool_answering_oddly_stops_being_used_and_results_stay(world):
    first, second = Fake("SerpApi", free_monthly=250, explode=KeyError("organic")), Fake("Searlo", free_once=3000)
    world.tools["google"] = [first, second]
    run = run_now(world, track(world, "a", "b"))
    assert run["done"] == 2 and len(first.calls) == 1 and len(second.calls) == 2
    assert "can't read" in run["stop_reason"]


def test_never_moves_to_a_paid_tool_unless_switched_on(world):
    tool = Fake("Bright Data", free_monthly=1, paid_per=0.0015)
    world.tools["google"] = [tool]
    run = run_now(world, track(world, "a", "b"))
    assert len(tool.calls) == 1 and run["status"] == "stopped"
    # asking for paid isn't enough either: the tool's own switch is still off
    run = run_now(world, track(world, "c"), allow_paid=True, paid_cap=5)
    assert len(tool.calls) == 1 and run["status"] == "stopped"


def test_paid_runs_only_when_switched_on_within_the_limit_and_after_every_free_tool(world):
    paid_tool, free_tool = Fake("Bright Data", free_monthly=1, paid_per=0.01), Fake("Searlo", free_once=1)
    world.tools["google"] = [paid_tool, free_tool]
    connections.set_paid(world.engine, "Bright Data", True)
    run = run_now(world, track(world, "a", "b", "c", "d", "e"), allow_paid=True, paid_cap=0.02)
    assert len(free_tool.calls) == 1  # the free tool was used up before paying for anything
    assert len(paid_tool.calls) == 3 and run["done"] == 4 and run["not_run"] == 1 and run["spent"] == pytest.approx(0.02)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT SUM(amount) FROM credit_ledger WHERE paid = 1")).scalar() == 2
    assert connections.used_this_month(world.engine, "Bright Data") == 1  # paid credits don't eat the free allowance


def test_a_tool_with_no_pay_as_you_go_price_cannot_be_switched_on(world):
    with pytest.raises(Refused):
        connections.set_paid(world.engine, "SerpApi", True)


def test_one_time_credits_do_not_come_back_next_month(world):
    tool = Fake("Searlo", free_once=3)
    world.tools["google"] = [tool]
    run_now(world, track(world, "a", "b"))
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE tool_usage SET period = '2020-01' WHERE tool = 'Searlo'"))
    assert connections.free_left(world.engine, tool) == 1


def test_monthly_credits_do_come_back(world):
    tool = Fake("SerpApi", free_monthly=3)
    world.tools["google"] = [tool]
    run_now(world, track(world, "a", "b"))
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE tool_usage SET period = '2020-01' WHERE tool = 'SerpApi'"))
    assert connections.free_left(world.engine, tool) == 3


def test_the_hourly_limit_hands_over_to_the_next_tool(world):
    first, second = Fake("SerpApi", free_monthly=250, per_hour=2), Fake("Searlo", free_once=3000)
    world.tools["google"] = [first, second]
    run = run_now(world, track(world, "a", "b", "c"))
    assert len(first.calls) == 2 and len(second.calls) == 1 and run["done"] == 3


def test_deeper_checks_cost_more_and_the_preview_says_how_much(world):
    tool = Fake("HasData", free_monthly=1000, credits_per_page=10)
    world.tools["google"] = [tool]
    ids = track(world, "a", "b")
    seen = refresh.preview(world.engine, ask(ids, depth=30))
    row = seen["tools"][0]
    assert seen["pages"] == 3 and seen["checks"] == 2 and row["credits"] == 60 and row["left_after"] == 940 and seen["runs_out_after"] is None
    run_now(world, ids, depth=30)
    assert spent(world, "HasData") == 60 and tool.calls[0][2] == 30


def test_the_preview_says_when_it_runs_out_and_spends_nothing(world):
    first, second = Fake("SerpApi", free_monthly=2), Fake("Searlo", free_once=1)
    world.tools["google"] = [first, second]
    seen = refresh.preview(world.engine, ask(track(world, "a", "b", "c", "d", "e")))
    assert seen["checks"] == 3 and seen["unassigned"] == 2 and seen["runs_out_after"] == 3
    assert first.calls == [] and second.calls == [] and spent(world, "SerpApi") == 0
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM rank_runs")).scalar() == 0


def test_what_was_just_checked_is_skipped_unless_asked_and_a_deeper_check_still_runs(world):
    tool = Fake("SerpApi", free_monthly=250)
    world.tools["google"] = [tool]
    ids = track(world, "a", "b")
    save(world, ids[0])
    body = {"keyword_ids": ids, "engines": ["google"], "depth": 10}
    seen = refresh.preview(world.engine, body)
    assert seen["checks"] == 1 and [r["keyword"] for r in seen["recent"]] == ["a"]
    assert refresh.preview(world.engine, {**body, "include_recent": True})["checks"] == 2
    assert refresh.preview(world.engine, {**body, "depth": 20})["checks"] == 2  # a top 10 can't answer a top 20
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 2 DAY"))
    assert refresh.preview(world.engine, body)["checks"] == 2


def test_cancel_keeps_what_was_saved_and_frees_the_rest(world):
    tool = Fake("SerpApi", free_monthly=250)
    world.tools["google"] = [tool]
    ids = track(world, "a", "b", "c")
    real_search = tool.search

    def search(keyword, *args):
        refresh.cancel(world.engine, started["id"])
        return real_search(keyword, *args)

    tool.search = search
    started = refresh.start(world.engine, ask(ids))
    world.drain()
    run = refresh.run_dict(world.engine, started["id"])
    assert run["status"] == "cancelled" and run["done"] == 1 and run["not_run"] == 2 and len(tool.calls) == 1
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM rank_run_items WHERE active_key IS NOT NULL")).scalar() == 0


def test_a_run_that_lost_its_job_frees_its_keywords(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    ids = track(world, "a")
    started = refresh.start(world.engine, ask(ids))
    with world.engine.begin() as conn:
        conn.execute(text("DELETE FROM jobs"))
        conn.execute(text("UPDATE rank_runs SET created_at = UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE"))
    assert refresh.active_runs(world.engine) == []
    assert refresh.run_dict(world.engine, started["id"])["status"] == "stopped"
    assert refresh.start(world.engine, ask(ids))["total"] == 1


def test_choose_tools_runs_each_ticked_tool_and_keeps_both_results(world):
    one, two, other = Fake("SerpApi", free_monthly=250, position=3), Fake("Searlo", free_once=3000, position=5), Fake("HasData", free_monthly=1000)
    world.tools["google"] = [one, two, other]
    ids = track(world, "a")
    run = run_now(world, ids, mode="pick", picked=["SerpApi", "Searlo"])
    assert run["done"] == 2 and len(one.calls) == 1 and len(two.calls) == 1 and other.calls == []
    view = row_of(world, ids[0])
    assert {view["main"]["tool"], view["others"][0]["tool"]} == {"SerpApi", "Searlo"}


def test_a_chosen_tool_that_cannot_run_does_not_quietly_become_another(world):
    gone, other = Fake("SerpApi", free_monthly=0), Fake("Searlo", free_once=3000)
    world.tools["google"] = [gone, other]
    run = run_now(world, track(world, "a"), mode="pick", picked=["SerpApi"])
    assert run["status"] == "stopped" and other.calls == [] and gone.calls == []


def test_the_browser_backup_only_runs_when_ticked(world):
    browser = Fake("Browser on this Mac", manual_only=True)
    world.tools["google"] = [browser]
    ids = track(world, "a")
    with pytest.raises(Refused):
        refresh.start(world.engine, ask(ids))
    assert browser.calls == []
    assert connections.tools_for(world.engine, "google") == []
    with pytest.raises(Refused, match="country"):
        refresh.start(world.engine, ask(ids, mode="pick", picked=["Browser on this Mac"]))
    connections.save_setting(world.engine, "mac_country", "ae")
    run = run_now(world, ids, mode="pick", picked=["Browser on this Mac"])
    assert run["done"] == 1 and len(browser.calls) == 1


def test_uploading_a_list_never_uses_the_browser_or_paid_credits(world):
    from seo.competitors import keywords

    browser, paid = Fake("Browser on this Mac", manual_only=True), Fake("Bright Data", free_monthly=1, paid_per=0.01)
    world.tools["google"] = [browser, paid]
    connections.set_paid(world.engine, "Bright Data", True)
    run = keywords.upload(world.engine, world.site, "one\ntwo\nthree", "FR", "fr")
    world.drain()
    assert browser.calls == [] and len(paid.calls) == 1
    assert keywords.run_dict(world.engine, run["id"])["status"] == "waiting"
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM credit_ledger WHERE paid = 1")).scalar() == 0


def test_the_daily_job_never_restarts_a_check_again_that_ran_out(world):
    from seo.competitors import keywords

    tool = Fake("SerpApi", free_monthly=1)
    world.tools["google"] = [tool]
    track(world, "a", "b")
    run = keywords.refresh(world.engine, world.site)
    world.drain()
    assert keywords.run_dict(world.engine, run["id"])["status"] == "waiting" and len(tool.calls) == 1
    assert "Press it again" in keywords.run_dict(world.engine, run["id"])["stop_reason"]
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE tool_usage SET period = '2020-01'"))  # next month: the credits are back
    assert keywords.resume_waiting(world.engine) == []
    world.drain()
    assert len(tool.calls) == 1


def test_no_schedule_can_start_a_refresh():
    """Read the source: the scheduler's commands must never reach refresh.start or the job's kind."""
    import inspect

    import seo.worker.__main__ as cli
    from seo.competitors import crawl, keywords, quality
    from seo.health import service as health
    from seo.links import service as links_service

    for module in (cli, crawl, keywords, quality, health, links_service):
        source = inspect.getsource(module)
        assert "refresh.start" not in source and "refresh.run" not in source and "JOB_KIND = \"refresh" not in source
    parser_commands = [line for line in inspect.getsource(cli).splitlines() if "add_parser(" in line]
    assert parser_commands and not any("refresh" in line for line in parser_commands)


# ---- ranking rules -----------------------------------------------------------------------------------

def test_change_compares_the_same_tool_location_and_depth(world):
    [k] = track(world, "a")
    save(world, k, position=7)
    save(world, k, position=4)
    view = row_of(world, k)
    assert view["main"]["p"] == 4 and view["change"] == 3 and view["change_note"] is None
    assert [point["p"] for point in view["trend"]] == [7, 4]


def test_a_tool_switch_is_never_a_ranking_move(world):
    [k] = track(world, "a")
    connections.set_order(world.engine, "google", ["Bright Data", "SerpApi", "HasData", "Searlo", "Browser on this Mac"])
    save(world, k, tool="SerpApi", position=9)
    save(world, k, tool="Bright Data", position=2)
    view = row_of(world, k)
    assert view["main"]["tool"] == "Bright Data" and view["change"] is None and view["change_note"] == "tool changed"
    assert [point["p"] for point in view["trend"]] == [2]
    tile = rankings.listing(world.engine, world.site)["tiles"]["google"]
    assert tile["up"] == 0 and tile["down"] == 0 and tile["compared"] == 0 and tile["top10_change"] is None


def test_a_depth_change_is_not_compared(world):
    [k] = track(world, "a")
    save(world, k, depth=10, position=9)
    save(world, k, depth=20, position=5)
    view = row_of(world, k)
    assert view["change"] is None and view["change_note"] == "depth changed"


def test_another_location_stays_on_its_own_line_and_never_in_the_row(world):
    [k] = track(world, "a", country="FR")
    save(world, k, location="FR", position=8)
    save(world, k, tool="Browser on this Mac", location="AE", position=1)
    view = row_of(world, k)
    assert view["main"]["tool"] == "SerpApi" and view["main"]["p"] == 8 and view["change"] is None
    assert [(line["tool"], line["location"], line["p"]) for line in view["away"]] == [("Browser on this Mac", "AE", 1)]
    assert view["others"] == []


def test_only_another_location_means_no_position_for_this_country(world):
    [k] = track(world, "a", country="FR")
    save(world, k, tool="Browser on this Mac", location="AE", position=1)
    view = row_of(world, k)
    assert view["main"] is None and len(view["away"]) == 1
    assert rankings.listing(world.engine, world.site)["tiles"]["google"]["ranked"] == 0


def test_beyond_the_depth_is_out_of_the_top_n_a_drop_with_no_made_up_number(world):
    """Was "not a drop" until 2026-11-17: a keyword that fell off the page was never Down (expert review F1)."""
    [k] = track(world, "a")
    save(world, k, position=4)
    save(world, k, position=None)
    view = row_of(world, k)
    assert view["main"]["p"] is None and view["main"]["depth"] == 10
    assert view["change"] is None and view["move"] == "lost"  # no invented number of places, but a drop
    assert [point["p"] for point in view["trend"]] == [4]
    tile = rankings.listing(world.engine, world.site)["tiles"]["google"]
    assert tile["down"] == 1 and tile["not_ranked"] == 1


def test_suspect_results_stay_visible_and_stay_out_of_trends(world):
    [k] = track(world, "a")
    save(world, k, position=5)
    save(world, k, position=9, status="suspect")
    save(world, k, position=4)
    view = row_of(world, k)
    assert [point["p"] for point in view["trend"]] == [5, 4] and view["change"] == 1
    detail = rankings.detail(world.engine, world.site, k, "google")
    assert any(point["suspect"] and point["p"] == 9 for line in detail["lines"] for point in line["points"])


def test_a_newest_suspect_result_shows_beside_the_last_good_one(world):
    [k] = track(world, "a")
    save(world, k, position=5)
    save(world, k, position=9, status="suspect")
    view = row_of(world, k)
    assert view["main"]["p"] == 5 and [row["p"] for row in view["suspects"]] == [9]


def test_only_suspect_results_are_marked_and_count_for_nothing(world):
    [k] = track(world, "a")
    save(world, k, position=2, status="suspect")
    view = row_of(world, k)
    assert view["main"]["verdict"] == "suspect" and view["change"] is None
    assert rankings.listing(world.engine, world.site)["tiles"]["google"]["top10"] == 0


def test_a_new_result_never_overwrites_an_old_one(world):
    [k] = track(world, "a")
    first = save(world, k, position=5)
    save(world, k, position=6)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM serp_checks")).scalar() == 2
        assert conn.execute(text("SELECT COUNT(*) FROM serp_results WHERE check_id = :c AND position = 5 AND host = :h"), {"c": first, "h": ME}).scalar() == 1


def test_with_no_main_tool_the_newest_check_speaks_for_the_row_whatever_the_order(world):
    """2026-11-18: the order says which tool a Refresh tries first, not whose answer is right. The main tool still wins."""
    [k] = track(world, "a")
    save(world, k, tool="Bright Data", position=8)
    save(world, k, tool="Searlo", position=2)
    assert row_of(world, k)["main"]["tool"] == "Searlo"  # newest, though Bright Data is first in the default order
    connections.set_order(world.engine, "google", ["Bright Data", "Searlo", "SerpApi", "HasData", "Browser on this Mac"])
    view = row_of(world, k)
    assert view["main"]["tool"] == "Searlo" and [row["tool"] for row in view["others"]] == ["Bright Data"]
    connections.save_setting(world.engine, "main_tool", "Bright Data")
    assert row_of(world, k)["main"]["tool"] == "Bright Data"


def test_tools_disagree_only_within_48_hours_and_past_the_editable_gap(world):
    [k] = track(world, "a")
    save(world, k, tool="Bright Data", position=2)
    save(world, k, tool="SerpApi", position=5)
    assert row_of(world, k)["disagree"] is None  # exactly 3 apart isn't more than 3
    connections.save_setting(world.engine, "disagree_gap", 2)
    assert row_of(world, k)["disagree"]["diff"] == 3
    connections.save_setting(world.engine, "disagree_gap", 3)
    save(world, k, tool="SerpApi", position=9)
    assert row_of(world, k)["disagree"]["diff"] == 7
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 3 DAY WHERE tool = 'SerpApi'"))
    assert row_of(world, k)["disagree"] is None


def test_top_10_tile_is_scraped_only_and_never_adds_search_console(world):
    [one, two] = track(world, "one", "two")
    save(world, one, position=3)
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, UTC_DATE(), 'x', 'two', 5, 100, 2.5)"), {"s": world.site})
    listed = rankings.listing(world.engine, world.site)
    tile = listed["tiles"]["google"]
    assert tile["top10"] == 1 and tile["top10_source"] == "scraped"
    assert next(r for r in listed["rows"] if r["keyword_id"] == two)["engines"]["google"]["own"] == 2.5


def test_top_10_change_only_counts_like_for_like(world):
    [one, two] = track(world, "one", "two")
    save(world, one, position=12)
    save(world, one, position=8)
    save(world, two, tool="SerpApi", position=2)
    save(world, two, tool="SerpApi", position=11)
    tile = rankings.listing(world.engine, world.site)["tiles"]["google"]
    assert tile["top10"] == 1 and tile["top10_change"] == 0 and tile["up"] == 1 and tile["down"] == 1


def test_own_tool_columns_read_each_engines_own_tool(world):
    [k] = track(world, "café Seville")
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO bing_query (site_id, query_hash, query, clicks, impressions, position) VALUES (:s, 'a', 'CAFÉ  seville', 1, 9, 4.5)"), {"s": world.site})
        conn.execute(text("INSERT INTO yandex_query (site_id, query_hash, query, shows, clicks, position) VALUES (:s, 'a', 'café seville', 9, 1, 6.5)"), {"s": world.site})
    assert row_of(world, k, "bing")["own"] == 4.5 and row_of(world, k, "yandex")["own"] == 6.5
    assert row_of(world, k, "google")["own"] is None  # not connected is blank, not zero


def test_ai_is_not_captured_until_a_tool_can_see_it_and_a_cite_is_a_cite(world):
    [k] = track(world, "a")
    save(world, k)
    listed = rankings.listing(world.engine, world.site)
    assert listed["rows"][0]["ai"]["state"] == "not-captured"
    store.save_check(world.engine, k, "google", Answer("SerpApi", "FR", 10, [Found(1, f"https://{ME}/", "T")], "present", [f"https://{ME}/x"], 1), "refresh")
    assert rankings.listing(world.engine, world.site)["rows"][0]["ai"]["state"] == "cited"
    store.save_check(world.engine, k, "google", Answer("SerpApi", "FR", 10, [Found(1, f"https://{ME}/", "T")], "absent", [], 1), "refresh")
    assert rankings.listing(world.engine, world.site)["rows"][0]["ai"]["state"] == "none"


def test_a_page_with_no_results_or_nothing_in_common_is_marked_suspect(world):
    [k] = track(world, "a")
    answer = lambda rows: Answer("SerpApi", "FR", 10, rows, "not_captured", [], 1)  # noqa: E731
    normal = [Found(i + 1, f"https://site{i}.example/", "T") for i in range(8)]
    assert refresh.assess(world.engine, k, "google", answer([])) == "suspect"
    assert refresh.assess(world.engine, k, "google", answer(normal)) == "ok"
    store.save_check(world.engine, k, "google", answer(normal), "refresh")
    moved = normal[:2] + [Found(i + 3, f"https://new{i}.example/", "T") for i in range(6)]
    assert refresh.assess(world.engine, k, "google", answer(moved)) == "ok"  # movement alone never is
    other = [Found(i + 1, f"https://other{i}.example/", "T") for i in range(8)]
    assert refresh.assess(world.engine, k, "google", answer(other)) == "suspect"


def test_suspect_results_never_feed_the_competitor_screens(world):
    [k] = track(world, "a")
    save(world, k, position=5)
    save(world, k, position=9, status="suspect")
    latest = store.latest_checks(world.engine, world.site, "google")
    assert latest[0].best_on(ME).position == 5


# ---- the API, and the tool list ------------------------------------------------------------------------

def test_the_api_runs_a_refresh_from_preview_to_progress(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    ids = track(world, "a", "b")
    seen = world.client.post("/api/refresh/preview", json=ask(ids)).get_json()
    assert seen["checks"] == 2
    started = world.client.post("/api/refresh/runs", json=ask(ids, token="abcdefgh12345"))
    assert started.status_code == 202
    run_id = started.get_json()["id"]
    assert [r["id"] for r in world.client.get("/api/refresh/runs").get_json()["runs"]] == [run_id]
    world.drain()
    assert world.client.get(f"/api/refresh/runs/{run_id}").get_json()["done"] == 2
    listed = world.client.get(f"/api/rankings?site_id={world.site}").get_json()
    assert listed["tiles"]["google"]["tracked"] == 2 and listed["last_refresh"]


@pytest.mark.parametrize("bad", [
    {"keyword_ids": []}, {"keyword_ids": "1"}, {"keyword_ids": [True]}, {"engines": []}, {"engines": ["altavista"]}, {"depth": 15}, {"mode": "x"},
    {"mode": "pick", "picked": []}, {"allow_paid": True}, {"allow_paid": True, "paid_cap": -1}, {"allow_paid": True, "paid_cap": "x"}, {"site_id": "1"}, {"keyword_ids": [999999]},
])
def test_bad_requests_are_refused(world, bad):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    ids = track(world, "a")
    assert world.client.post("/api/refresh/preview", json={**ask(ids), **bad}).status_code == 400


def test_the_panel_lists_every_check_every_tool_and_who_else_is_on_the_page(world):
    [k] = track(world, "a")
    save(world, k, position=3)
    store.save_failed_check(world.engine, k, "google", "SerpApi", "It answered 500")
    save(world, k, position=2)
    save(world, k, tool="Browser on this Mac", location="AE", position=1)
    body = world.client.get(f"/api/rankings/{k}?site_id={world.site}&engine=google").get_json()
    assert [check["status"] for check in body["checks"]] == ["ok", "ok", "failed", "ok"]
    assert body["checks"][2]["error"] == "It answered 500"
    assert {(line["tool"], line["home"]) for line in body["lines"]} == {("SerpApi", True), ("Browser on this Mac", False)}
    mine = next(row for row in body["competitors"] if row["mine"])
    assert mine["position"] == 2 and mine["change"] == 1
    assert {tool["name"] for tool in body["tools"]} >= {"SerpApi", "Searlo"}


def test_the_last_refresh_counts_whichever_button_pressed_it(world):
    from seo.competitors import keywords

    assert rankings.listing(world.engine, world.site)["last_refresh"] is None
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    track(world, "a")
    keywords.refresh(world.engine, world.site)
    world.drain()
    assert rankings.listing(world.engine, world.site)["last_refresh"]


def test_forgetting_a_keyword_keeps_its_history_and_can_be_undone(world):
    [k] = track(world, "a")
    save(world, k)
    assert world.client.delete(f"/api/rankings/{k}?site_id={world.site}").status_code == 200
    assert rankings.listing(world.engine, world.site)["rows"] == []
    assert world.client.post(f"/api/rankings/{k}/restore?site_id={world.site}").status_code == 200
    assert row_of(world, k)["main"]["p"] == 3


def test_tool_order_is_per_engine_and_must_name_every_tool(world):
    assert connections.order_for(world.engine, "duckduckgo")[0] == "DuckDuckGo direct"
    changed = world.client.put("/api/tools/order", json={"engine": "bing", "order": ["SearXNG", "Bright Data", "SerpApi", "HasData", "Browser on this Mac"]})
    assert changed.status_code == 200 and connections.order_for(world.engine, "bing")[0] == "SearXNG"
    assert connections.order_for(world.engine, "google")[0] == "Bright Data"
    assert world.client.put("/api/tools/order", json={"engine": "bing", "order": ["SearXNG"]}).status_code == 400
    assert world.client.put("/api/tools/order", json={"engine": "nope", "order": []}).status_code == 400


def test_a_member_cannot_change_tools_or_keys(engine, monkeypatch):
    from seo.accounts import service as accounts

    client = create_app(engine=engine, secret_key="test-secret").test_client()
    accounts.create_user(engine, "boss@example.com", "Boss", "admin", password="a long enough password", must_change=False)
    accounts.create_user(engine, "m@example.com", "Member", password="a long enough password", must_change=False)
    csrf = {"X-CSRF-Token": client.post("/api/auth/login", json={"email": "m@example.com", "password": "a long enough password"}).get_json()["csrf"]}
    assert client.put("/api/connections/SerpApi", json={"key": "x"}, headers=csrf).status_code == 403
    assert client.delete("/api/connections/SerpApi", headers=csrf).status_code == 403
    assert client.put("/api/tools/order", json={}, headers=csrf).status_code == 403
    assert client.put("/api/tools/Bright Data/paid", json={"on": True}, headers=csrf).status_code == 403
    assert client.get("/api/tools", headers=csrf).status_code == 200


def test_the_run_names_who_started_it_from_the_login(engine, monkeypatch):
    from seo.accounts import service as accounts

    monkeypatch.setattr(connections, "tool_factory", lambda eng, name: [Fake("SerpApi", free_monthly=250)] if name == "google" else [])
    site = links.add_site(engine, f"https://{ME}/", "own", is_allowed=ALLOW)["id"]
    w = SimpleNamespace(engine=engine, site=site)
    ids = track(w, "a")
    client = create_app(engine=engine, secret_key="test-secret").test_client()
    accounts.create_user(engine, "m@example.com", "Sara", password="a long enough password", must_change=False)
    csrf = {"X-CSRF-Token": client.post("/api/auth/login", json={"email": "m@example.com", "password": "a long enough password"}).get_json()["csrf"]}
    assert client.post("/api/refresh/runs", json=ask(ids), headers=csrf).get_json()["by"] == "Sara"


def test_keys_for_the_new_tools_are_saved_encrypted_and_only_the_end_is_shown(world, monkeypatch, tmp_path):
    from seo.core import crypto

    key_path = tmp_path / "key"
    crypto.init_key(key_path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: key_path)
    monkeypatch.setattr(connections, "tool_factory", None)
    saved = connections.save_key(world.engine, "Bright Data", "BRIGHTSECRET9999", zone="serp_api1")
    assert saved["last4"] == "…9999" and saved["zone"] == "serp_api1"
    with world.engine.connect() as conn:
        assert "BRIGHTSECRET" not in conn.execute(text("SELECT secret FROM connections WHERE tool = 'Bright Data'")).scalar()
    built = {tool.name: tool for tool in connections.tools_for(world.engine, "google")}
    assert built["Bright Data"].key == "BRIGHTSECRET9999" and built["Bright Data"].zone == "serp_api1"
    # A new zone alone keeps the key.
    assert connections.save_key(world.engine, "Bright Data", "", zone="serp_two")["zone"] == "serp_two"
    assert [t for t in connections.tools_for(world.engine, "google") if t.name == "Bright Data"][0].key == "BRIGHTSECRET9999"
    with pytest.raises(Refused):
        connections.save_key(world.engine, "Bright Data", "KEY")  # no zone
    connections.save_key(world.engine, "HasData", "HASKEY1234")
    connections.save_key(world.engine, "Searlo", "SEARLOKEY1234")
    connections.save_key(world.engine, "SearXNG", "https://searx.example.com/")
    with pytest.raises(Refused):
        connections.save_key(world.engine, "SearXNG", "not an address")
    with pytest.raises(Refused):
        connections.save_key(world.engine, "DuckDuckGo direct", "x")
    assert [t.name for t in connections.tools_for(world.engine, "bing")] == ["Bright Data", "HasData", "SearXNG"]
    assert [t.name for t in connections.tools_for(world.engine, "google")] == ["Bright Data", "HasData", "Searlo"]
    assert connections.tools_for(world.engine, "google", include_manual=True)[-1].name == connections.BROWSER


def test_tool_list_gives_real_credits_and_hides_the_browser_on_hosting(world, monkeypatch):
    monkeypatch.setattr(connections, "tool_factory", None)
    monkeypatch.setattr(connections, "on_this_mac", lambda: True)
    connections.count_use(world.engine, "Searlo", 5)
    listed = connections.tool_list(world.engine)
    names = {tool["name"]: tool for tool in listed["tools"]}
    assert names["SerpApi"]["connected"] is False and names["SerpApi"]["of"] == 250
    assert names["Searlo"]["refills"] == "one-time" and names["Searlo"]["of"] == 3000
    assert names["DuckDuckGo direct"]["connected"] is True and names["DuckDuckGo direct"]["left"] is None
    assert connections.BROWSER in names and names[connections.BROWSER]["manual_only"] is True
    monkeypatch.setattr(connections, "on_this_mac", lambda: False)
    assert connections.BROWSER not in {tool["name"] for tool in connections.tool_list(world.engine)["tools"]}
    assert connections.tools_for(world.engine, "google", include_manual=True) == []


def test_ledger_rows_are_never_rewritten_and_a_refund_is_its_own_row(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250, fail={"bad"})]
    run_now(world, track(world, "bad"))
    with world.engine.connect() as conn:
        assert [r[0] for r in conn.execute(text("SELECT amount FROM credit_ledger ORDER BY id")).all()] == [1, -1]


def test_a_check_from_another_country_doesnt_block_a_refresh(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    ids = track(world, "a")
    save(world, ids[0], tool="Browser", location="AE")
    assert refresh.preview(world.engine, {"keyword_ids": ids, "engines": ["google"], "depth": 10})["checks"] == 1


def test_a_suspect_check_doesnt_block_a_refresh(world):
    world.tools["google"] = [Fake("SerpApi", free_monthly=250)]
    ids = track(world, "a")
    save(world, ids[0], status="suspect")
    assert refresh.preview(world.engine, {"keyword_ids": ids, "engines": ["google"], "depth": 10})["checks"] == 1


def test_a_keyword_never_checked_isnt_called_not_ranked(world):
    ids = track(world, "never", "seen", "missing")
    save(world, ids[1], position=4)
    save(world, ids[2], position=None)
    tile = rankings.listing(world.engine, world.site)["tiles"]["google"]
    assert tile["tracked"] == 3 and tile["ranked"] == 1 and tile["not_ranked"] == 1


# ---- a keyword just added says who is checking it (UI critique 2026-11-12) ----------------------------

def upload_running(world, *names, tool=None):
    """Keywords added through an upload whose first free check is queued, as seo.competitors.keywords.upload leaves them."""
    with world.engine.begin() as conn:
        upload = conn.execute(text("INSERT INTO keyword_uploads (site_id, engine, kind, total, new_keywords, status, tool) VALUES (:s, 'google', 'upload', :n, :n, 'queued', :t)"), {"s": world.site, "n": len(names), "t": tool}).lastrowid
    ids = track(world, *names)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_keywords SET upload_id = :u WHERE site_id = :s"), {"u": upload, "s": world.site})
    return upload, ids


def test_a_new_keyword_says_which_tool_is_checking_it_until_its_first_result(world):
    upload, (moka, press) = upload_running(world, "moka pot", "french press", tool="SerpApi")
    rows = {r["keyword"]: r for r in rankings.listing(world.engine, world.site)["rows"]}
    assert rows["moka pot"]["checking"] == {"engine": "google", "tool": "SerpApi"} and rows["french press"]["checking"]["tool"] == "SerpApi"
    save(world, moka)  # its first result is in: the row speaks for itself again, the other one still waits
    rows = {r["keyword"]: r for r in rankings.listing(world.engine, world.site)["rows"]}
    assert "checking" not in rows["moka pot"] and rows["french press"]["checking"]["tool"] == "SerpApi"
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE keyword_uploads SET status = 'complete' WHERE id = :u"), {"u": upload})
    assert all("checking" not in r for r in rankings.listing(world.engine, world.site)["rows"])


def test_before_the_first_search_starts_it_names_the_tool_first_in_line(world):
    upload_running(world, "moka pot")  # no search has gone out yet, so the run has no tool of its own
    line = connections.not_blocked(world.engine, connections.tools_for(world.engine, "google"))
    assert rankings.listing(world.engine, world.site)["rows"][0]["checking"] == {"engine": "google", "tool": line[0].name if line else None}


def test_an_upload_that_lost_its_job_does_not_say_checking_forever(world):
    upload, _ = upload_running(world, "moka pot", tool="SerpApi")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE keyword_uploads SET created_at = UTC_TIMESTAMP(3) - INTERVAL 1 HOUR WHERE id = :u"), {"u": upload})
    assert "checking" not in rankings.listing(world.engine, world.site)["rows"][0]


def test_the_main_tool_speaks_for_every_screen_and_another_tool_fills_in_with_its_name(world):
    from seo.serp import store

    [k, only_other] = track(world, "a", "b")
    save(world, k, tool="Bright Data", position=8)
    save(world, k, tool="SerpApi", position=2)  # newer, but not the main tool
    save(world, only_other, tool="SerpApi", position=4)
    connections.save_setting(world.engine, "main_tool", "Bright Data")
    view = row_of(world, k)
    assert view["main"]["tool"] == "Bright Data" and [row["tool"] for row in view["others"]] == ["SerpApi"]
    assert row_of(world, only_other)["main"]["tool"] == "SerpApi"  # Bright Data hasn't checked it: the next tool, named
    # Competitors, AI watch and the rest read store.latest_checks: the same tool as Keywords, not the newest check.
    latest = {c.keyword: c.tool for c in store.latest_checks(world.engine, world.site)}
    assert latest == {"a": "Bright Data", "b": "SerpApi"}
    assert {c.keyword: c.tool for c in store.latest_checks_many(world.engine, [world.site])} == latest
