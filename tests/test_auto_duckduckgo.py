"""DuckDuckGo positions are checked by themselves every day, and by Refresh data, on free searches only and never through
SerpApi (owner, 2026-11-11): DuckDuckGo direct first, then Bright Data's free credits within a monthly share."""
import calendar
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy import text

from seo.links import service as links
from seo.serp import auto_ddg, connections, refresh
from seo.serp.tools import BrightData, SearchFailed
from tests.test_refresh import ALLOW, Fake, save, spent, track, world  # noqa: F401 - world is the shared fixture

DDG, BRIGHT = connections.DDG, connections.BRIGHT


def runs(world):
    with world.engine.connect() as conn:
        return [dict(r) for r in conn.execute(text("SELECT id, site_id, by_name, mode, depth, allow_paid, idem_key, status FROM rank_runs ORDER BY id")).mappings().all()]


def tools_of(world, run_id):
    with world.engine.connect() as conn:
        return sorted({r[0] for r in conn.execute(text("SELECT tool FROM rank_run_items WHERE run_id = :r"), {"r": run_id}).all()})


def tools(world, ddg=None, bright=None):
    """DuckDuckGo direct (no credits), then Bright Data and SerpApi with free credits: the real order for DuckDuckGo."""
    world.ddg = ddg or Fake(DDG)
    world.bright = bright or Fake(BRIGHT, free_monthly=5000)
    world.serp = Fake("SerpApi", free_monthly=250)
    world.tools["duckduckgo"] = [world.ddg, world.bright, world.serp]


def blocked_ddg():
    return Fake(DDG, stop_after=0)  # a bot check on the very first search, as live on 2026-11-11


def share_of(monkeypatch, per_day):
    """Make today's Bright Data share exactly per_day searches."""
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(auto_ddg, "MONTH_CAP", per_day * (calendar.monthrange(now.year, now.month)[1] - now.day + 1))


# ---- every day ------------------------------------------------------------------------------------

def test_each_day_every_one_of_my_sites_gets_a_free_duckduckgo_direct_check(world):
    tools(world)
    other = links.add_site(world.engine, "https://second.example/", "own", is_allowed=ALLOW)["id"]
    track(world, "one", "two")
    track(world, "three", site=other)
    assert sorted(auto_ddg.enqueue_due(world.engine)) == sorted([world.site, other])
    made = runs(world)
    assert all(r["by_name"] == "Automatic" and r["mode"] == "pick" and r["depth"] == 10 and not r["allow_paid"] and r["idem_key"].startswith("auto-ddg-") for r in made)
    world.drain()
    assert sorted(call[0] for call in world.ddg.calls) == ["one", "three", "two"]
    assert world.bright.calls == [] and world.serp.calls == []  # it worked, so no credits at all


def test_cron_calling_it_every_hour_still_makes_one_run_a_day(world):
    tools(world)
    track(world, "one")
    assert auto_ddg.enqueue_due(world.engine) == [world.site]
    assert auto_ddg.enqueue_due(world.engine) == []  # still queued
    world.drain()
    assert auto_ddg.enqueue_due(world.engine) == []  # done and fresh
    assert len(runs(world)) == 1 and len(world.ddg.calls) == 1


def test_after_a_bot_check_bright_data_takes_over_and_serpapi_is_never_used(world):
    tools(world, ddg=blocked_ddg())
    track(world, "one", "two", "three")
    auto_ddg.enqueue_due(world.engine)
    world.drain()
    first = refresh.run_dict(world.engine, runs(world)[0]["id"])
    assert first["status"] == "stopped" and first["done"] == 0
    # The next hourly pass: DuckDuckGo direct rests, Bright Data checks what's left, on free credits.
    assert auto_ddg.enqueue_due(world.engine) == [world.site]
    second = runs(world)[1]
    assert tools_of(world, second["id"]) == [BRIGHT] and not second["allow_paid"]
    world.drain()
    assert sorted(call[0] for call in world.bright.calls) == ["one", "three", "two"]
    assert world.serp.calls == [] and spent(world, "SerpApi") == 0
    assert auto_ddg.enqueue_due(world.engine) == []  # all fresh now
    assert len(world.bright.calls) == 3


def test_while_duckduckgo_direct_rests_it_is_not_knocked_on_again(world):
    tools(world, ddg=blocked_ddg())
    track(world, "one")
    auto_ddg.enqueue_due(world.engine)
    world.drain()
    assert world.client.post(f"/api/sites/{world.site}/collect", json={}).get_json()["rankings"] is True
    assert tools_of(world, runs(world)[-1]["id"]) == [BRIGHT]


def test_bright_data_keeps_to_its_daily_share_oldest_positions_first(world, monkeypatch):
    tools(world, ddg=blocked_ddg())
    share_of(monkeypatch, 2)
    ids = track(world, "fresh-ish", "never", "oldest", "older")
    long_ago = lambda days: (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
    save(world, ids[0], tool=DDG, name="duckduckgo", at=long_ago(2))
    save(world, ids[2], tool=DDG, name="duckduckgo", at=long_ago(9))
    save(world, ids[3], tool=DDG, name="duckduckgo", at=long_ago(5))
    auto_ddg.enqueue_due(world.engine)
    world.drain()  # DuckDuckGo direct's daily try: a bot check
    auto_ddg.enqueue_due(world.engine)
    assert auto_ddg.enqueue_due(world.engine) == []  # today's share is taken by the run waiting
    world.drain()
    assert [call[0] for call in world.bright.calls] == ["never", "oldest"]
    assert auto_ddg.enqueue_due(world.engine) == []  # and spent
    assert world.client.post(f"/api/sites/{world.site}/collect", json={}).get_json()["rankings"] is False  # Refresh data too


def test_never_past_bright_datas_own_free_credits(world):
    tools(world, ddg=blocked_ddg(), bright=Fake(BRIGHT, free_monthly=2))
    track(world, "one", "two", "three", "four")
    auto_ddg.enqueue_due(world.engine)
    world.drain()
    auto_ddg.enqueue_due(world.engine)
    world.drain()
    assert len(world.bright.calls) == 2 and world.serp.calls == []


def test_serpapi_alone_is_never_used(world):
    world.tools["duckduckgo"] = [Fake("SerpApi", free_monthly=250)]
    track(world, "one")
    assert auto_ddg.enqueue_due(world.engine) == [] and runs(world) == []
    assert world.client.post(f"/api/sites/{world.site}/collect", json={}).get_json()["rankings"] is False


def test_competitors_and_sites_without_keywords_are_left_alone(world):
    tools(world)
    rival = links.add_site(world.engine, "https://rival.example/", "competitor", is_allowed=ALLOW)["id"]
    track(world, "x", site=rival)  # even a keyword linked to a competitor isn't searched
    assert auto_ddg.enqueue_due(world.engine) == [] and runs(world) == []


def test_keywords_a_person_is_refreshing_on_duckduckgo_are_left_out(world):
    tools(world)
    ids = track(world, "one", "two")
    refresh.start(world.engine, {"keyword_ids": ids[:1], "engines": ["duckduckgo"], "depth": 10}, "Sara")
    auto_ddg.enqueue_due(world.engine)
    world.drain()
    assert sorted(call[0] for call in world.ddg.calls) == ["one", "two"]  # each searched once


# ---- Refresh data ---------------------------------------------------------------------------------

def test_refresh_data_checks_duckduckgo_too(world):
    tools(world)
    track(world, "one", "two")
    answer = world.client.post(f"/api/sites/{world.site}/collect", json={})
    assert answer.status_code == 202 and answer.get_json()["rankings"] is True
    assert runs(world)[0]["by_name"] == "Automatic" and runs(world)[0]["idem_key"] is None
    assert world.client.post(f"/api/sites/{world.site}/collect", json={}).get_json()["rankings"] is False  # running
    world.drain()
    assert sorted(call[0] for call in world.ddg.calls) == ["one", "two"] and world.bright.calls == []
    assert world.client.post(f"/api/sites/{world.site}/collect", json={}).get_json()["rankings"] is False  # fresh
    assert len(world.ddg.calls) == 2


def test_refresh_data_only_checks_keywords_not_checked_lately(world):
    tools(world)
    old, fresh = track(world, "old", "fresh")
    save(world, fresh, tool=DDG, name="duckduckgo")
    save(world, old, tool=DDG, name="duckduckgo", at=(datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S"))
    assert world.client.post(f"/api/sites/{world.site}/collect", json={}).get_json()["rankings"] is True
    world.drain()
    assert [call[0] for call in world.ddg.calls] == ["old"]


def test_refresh_this_one_does_not_check_rankings(world):
    tools(world)
    track(world, "one")
    assert world.client.post(f"/api/sites/{world.site}/collect", json={"sources": ["ga4"]}).get_json()["rankings"] is False
    assert runs(world) == []


def test_a_daily_run_and_a_refresh_data_run_never_search_the_same_keyword_twice(world):
    tools(world)
    track(world, "one")
    assert world.client.post(f"/api/sites/{world.site}/collect", json={}).get_json()["rankings"] is True
    assert auto_ddg.enqueue_due(world.engine) == []  # already being checked
    world.drain()
    assert len(world.ddg.calls) == 1


# ---- Bright Data reads DuckDuckGo's plain HTML page --------------------------------------------------

def _ddg_html(*hosts):
    rows = "".join(f'<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2F{h}%2Fpage">{h}</a></div>' for h in hosts)
    return f"<html><body>{rows}</body></html>".encode()


def _bright(body, seen):
    def answer(request):
        seen.append(request)
        return httpx.Response(200, content=body, headers={"content-type": "text/html"})

    return BrightData("KEY", "serp_api1", client=httpx.Client(transport=httpx.MockTransport(answer)))


def test_bright_data_asks_for_duckduckgos_html_page_and_reads_it_like_duckduckgo_direct():
    seen = []
    found = _bright(_ddg_html("a.example", "mine.example", "b.example"), seen).search("café dubaï", "duckduckgo", "AE", "fr", "desktop", 10)
    sent = json.loads(seen[0].content)
    address = urlsplit(sent["url"])
    assert len(seen) == 1 and sent["zone"] == "serp_api1" and sent["format"] == "raw"
    assert address.netloc == "html.duckduckgo.com" and address.path == "/html/"
    assert parse_qs(address.query) == {"q": ["café dubaï"], "kl": ["xa-en"]}  # no brd_json: there's no parsed JSON for DuckDuckGo
    assert [(r.position, r.url) for r in found.results] == [(1, "https://a.example/page"), (2, "https://mine.example/page"), (3, "https://b.example/page")]
    assert found.tool == "Bright Data" and found.real_location == "xa-en" and found.charged == 1


def test_bright_data_says_when_nobody_ranks_and_fails_on_a_page_it_cant_read():
    assert _bright(b'<html><div class="no-results">No results.</div></html>', []).search("x", "duckduckgo", "FR", "fr", "desktop", 10).results == []
    with pytest.raises(SearchFailed) as failed:
        _bright(b"<html>Something else entirely</html>", []).search("x", "duckduckgo", "FR", "fr", "desktop", 10)
    assert failed.value.charged == 1  # the page came back, so it was billed
