"""Semscraper as a rank tool and as the main tool for Google's AI Overviews, with SerpApi as the fallback.

Every answer here is hand-written: nothing contacts Semscraper or SerpApi. The sites are made up.
"""
import json
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text

from seo.core.errors import Refused
from seo.links import service as links
from seo.serp import connections, refresh, store
from seo.serp.tools import (
    ABSENT, NOT_CAPTURED, PRESENT, HiddenAddresses, SearchFailed, Semscraper, TimedOut, ToolStopped, read_semscraper, semscraper_price,
)
from seo.sources import service as sources
from seo.web import create_app
from seo.worker.runner import tick
from tests.test_refresh import ALLOW, ME, Fake

# ---- hand-written Semscraper answers -----------------------------------------------------------------------------------


def organic(n=10, page=1, start=1, mine_at=None):
    items = []
    for i in range(n):
        rank = start + i
        url = f"https://{ME}/page" if rank == mine_at else f"https://rival{rank}.example/x"
        items.append({"rank_type": rank, "rank_serp": rank + 2, "page": page, "pixel": 100 * rank, "domain": url.split("/")[2], "url": url, "title": f"Result {rank}"})
    return {"type": "organic", "items": items}


def serp(blocks, overview=None, status="done", task="t-1", cost=None):
    row = {"id": task, "status": status, "keyword": "coffee", "serp_info": {"result_count": 1000, "ai_overview": overview or {"type": "none", "text": None, "complete": True}}, "results": blocks}
    if cost is not None:
        row["cost"] = cost
    return row


OVERVIEW = {"type": "sync", "text": "Coffee is a brewed drink.", "complete": True}
CITED = [
    {"type": "ai_overview_citation", "items": [{"url": "https://cited-one.example/a", "domain": "cited-one.example", "title": "One", "brand": "One", "visible": True}]},
    {"type": "ai_overview_citation_source", "items": [{"url": "https://cited-two.example/b", "domain": "cited-two.example", "visible": False}]},
]


class FakeSemscraper:
    """The API as its documentation shows it: POST /v1/serp makes a task, GET /v1/serp?ids= gives it once done."""

    def __init__(self, result=None, pending=0, post_status=200, post_body=None, get_status=200, cost="0.0003", balance=12.5):
        self.result, self.pending, self.post_status, self.post_body, self.get_status = result, pending, post_status, post_body, get_status
        self.cost, self.balance = cost, balance
        self.posts, self.gets, self.seen = [], 0, []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        assert request.url.host == "api.semscraper.com"
        if request.url.path == "/v1/billing/credit":
            if self.get_status != 200:
                return httpx.Response(self.get_status, json={"error": "Unauthorized"})
            return httpx.Response(200, json={"status": "ok", "count": 1, "data": [{"balance": self.balance}]})
        if request.method == "POST":
            body = json.loads(request.content)
            self.posts.append(body)
            if self.post_status != 200:
                return httpx.Response(self.post_status, json=self.post_body or {"error": "Bad Request", "message": "nope", "code": 400})
            data = [{"id": f"t-{len(self.posts)}", "status": "pending", **task, "cost": self.cost} for task in body]
            return httpx.Response(200, json={"status": "ok", "count": len(data), "currency": "EUR", "total_cost": self.cost, "data": data})
        self.gets += 1
        if self.get_status != 200:
            return httpx.Response(self.get_status, json={"error": "nope"})
        ids = request.url.params["ids"].split(",")
        if self.gets <= self.pending:
            return httpx.Response(200, json={"status": "ok", "count": 1, "data": [{"id": ids[0], "status": "processing"}]})
        row = dict(self.result if self.result is not None else serp([organic()]))
        row["id"] = ids[0]
        return httpx.Response(200, json={"status": "ok", "count": 1, "data": [row]})


def semscraper(api: FakeSemscraper, **kw) -> Semscraper:
    tool = Semscraper("SEM-SECRET-KEY", client=httpx.Client(transport=httpx.MockTransport(api)), sleep=lambda seconds: None, **kw)
    return tool


def search(tool, depth=10, country="FR", language="fr"):
    return tool.search("coffee", "google", country, language, "desktop", depth)


# ---- the parser ---------------------------------------------------------------------------------------------------------


def test_it_sends_one_task_with_the_key_and_reads_the_organic_results_in_order():
    api = FakeSemscraper(serp([organic(10, mine_at=4)]), pending=2)
    answer = search(semscraper(api))
    assert api.posts == [[{"search_engine": "google_search", "keyword": "coffee", "device": "desktop", "depth": 1, "location": "fr", "language": "fr", "priority": 5}]]
    assert all(r.headers["authorization"] == "Bearer SEM-SECRET-KEY" for r in api.seen)
    assert api.gets == 3  # asked until it said done
    assert [f.position for f in answer.results] == list(range(1, 11)) and answer.results[3].url == f"https://{ME}/page"
    assert answer.tool == "Semscraper" and answer.real_location == "FR" and answer.charged == 1
    assert answer.ai_state == ABSENT and answer.ai_citations == []


def test_rows_are_put_in_googles_order_whatever_order_they_come_in():
    first, second = organic(10, page=1, start=1), organic(10, page=2, start=11)
    answer = search(semscraper(FakeSemscraper(serp([second, first]), cost="0.0005")), depth=20)
    assert [f.url for f in answer.results][:2] == ["https://rival1.example/x", "https://rival2.example/x"]
    assert answer.results[10].url == "https://rival11.example/x" and len(answer.results) == 20


def test_a_deeper_check_asks_for_more_pages_and_is_billed_for_what_was_found():
    api = FakeSemscraper(serp([organic(10), organic(10, page=2, start=11)]), cost="0.0005")
    answer = search(semscraper(api), depth=30)
    assert api.posts[0][0]["depth"] == 3
    assert answer.charged == 2  # €0.0005 is two pages: the third had nothing, and isn't billed
    assert answer.real_cost == Decimal("0.0005")


def test_prices_per_page():
    assert semscraper_price(1) == Decimal("0.0003") and semscraper_price(5) == Decimal("0.0011") and semscraper_price(0) == 0


def test_an_ai_overview_is_present_with_every_address_it_cites():
    answer = search(semscraper(FakeSemscraper(serp([organic(), *CITED], OVERVIEW))))
    assert answer.ai_state == PRESENT and answer.ai_citations == ["https://cited-one.example/a", "https://cited-two.example/b"]


def test_a_brand_named_without_a_link_is_not_a_source_and_spoils_nothing():
    brand = [{"type": "ai_overview_citation", "items": [{"brand": "Rival One", "visible": True}]}, {"type": "ai_overview_panel", "items": [{"url": "https://panel.example/p", "domain": "panel.example"}]}]
    assert read_semscraper(serp([organic(), *brand], OVERVIEW), 10)[1:] == (PRESENT, ["https://panel.example/p"])


def test_no_overview_is_a_no():
    results, state, cited = read_semscraper(serp([organic()], {"type": "none", "text": None, "complete": True}), 10)
    assert state == ABSENT and cited == [] and len(results) == 10
    assert read_semscraper({"status": "done", "results": [organic()]}, 10)[1] == ABSENT  # no serp_info at all


def test_an_overview_cut_short_or_unreadable_is_not_captured_never_a_no():
    assert read_semscraper(serp([organic(), *CITED], {**OVERVIEW, "complete": False}), 10)[1:] == (NOT_CAPTURED, [])
    assert read_semscraper(serp([organic(), *CITED], {"type": "async", "text": None, "complete": True}), 10)[1:] == (NOT_CAPTURED, [])
    # sources with no overview to go with them: something's off
    assert read_semscraper(serp([organic(), *CITED], {"type": "none", "text": None}), 10)[1] == NOT_CAPTURED


def test_a_hidden_source_makes_the_overview_not_captured():
    hidden = [{"type": "ai_overview_citation", "items": [{"url": "https://guess.example/", "url_approx": True, "goto_url": "https://www.google.com/goto?url=CAES"}]}]
    assert read_semscraper(serp([organic(), *hidden], OVERVIEW), 10)[1:] == (NOT_CAPTURED, [])


def test_a_hidden_result_keeps_its_place_and_its_site():
    block = organic(3)
    block["items"][1] = {**block["items"][1], "url": "https://rival2.example/", "url_approx": True, "goto_url": "https://www.google.com/goto?url=CAES123", "domain": "rival2.example"}
    answer = search(semscraper(FakeSemscraper(serp([block]))))
    assert [(f.position, f.url, f.host) for f in answer.results] == [(1, "https://rival1.example/x", ""), (2, "", "rival2.example"), (3, "https://rival3.example/x", "")]


def test_a_hidden_result_without_its_site_refuses_the_whole_answer_and_keeps_the_page_counted():
    block = organic(3)
    block["items"][0] = {**block["items"][0], "url_approx": True, "goto_url": "https://www.google.com/goto?url=CAES", "domain": ""}
    with pytest.raises(HiddenAddresses) as caught:
        search(semscraper(FakeSemscraper(serp([block]))))
    assert caught.value.charged == 1


@pytest.mark.parametrize("status, body, kind, words", [
    (401, None, ToolStopped, "Semscraper refused the key."),
    (403, None, ToolStopped, "Semscraper refused the key."),
    (402, None, ToolStopped, "Semscraper has no credit left."),
    (400, {"error": "Bad Request", "message": "Insufficient credit balance", "code": 400}, ToolStopped, "Semscraper has no credit left."),
    (429, None, ToolStopped, "Semscraper asked us to slow down, so this tool stopped."),
    (400, {"error": "Bad Request", "message": "location is invalid", "code": 400}, SearchFailed, "Semscraper answered 400: location is invalid"),
    (500, None, SearchFailed, "Semscraper answered 500: nope"),
])
def test_errors_at_send_stop_or_fail_and_charge_nothing(status, body, kind, words):
    with pytest.raises(kind) as caught:
        search(semscraper(FakeSemscraper(post_status=status, post_body=body)))
    assert str(caught.value) == words and caught.value.charged == 0


def test_a_search_that_never_finishes_times_out_and_stays_charged():
    clock = iter(range(0, 1000, 50))
    tool = semscraper(FakeSemscraper(pending=10**6), clock=lambda: next(clock))
    with pytest.raises(TimedOut) as caught:
        search(tool, depth=20)
    assert caught.value.charged == 2  # billed when it was sent


def test_a_task_semscraper_couldnt_do_isnt_charged():
    with pytest.raises(SearchFailed) as caught:
        search(semscraper(FakeSemscraper(serp([], status="failed"))))
    assert "couldn't do this search" in str(caught.value) and caught.value.charged == 0


def test_the_test_reads_the_balance_for_free():
    api = FakeSemscraper(balance=3.2)
    assert semscraper(api).test() == 3.2 and api.posts == []
    with pytest.raises(ToolStopped, match="no credit left"):
        semscraper(FakeSemscraper(balance=0)).test()
    with pytest.raises(ToolStopped, match="refused the key"):
        semscraper(FakeSemscraper(get_status=401)).test()


def test_it_is_google_only():
    with pytest.raises(SearchFailed):
        semscraper(FakeSemscraper()).search("coffee", "bing", "FR", "fr", "desktop", 10)


# ---- wiring -------------------------------------------------------------------------------------------------------------


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    w = SimpleNamespace(engine=engine, tools={}, client=create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client())
    w.api = FakeSemscraper(serp([organic(10, mine_at=2), *CITED], OVERVIEW))
    w.serpapi = Fake("SerpApi", free_monthly=250, position=5)
    w.serpapi.gives_ai = True
    w.bright = Fake("Bright Data", free_monthly=5000, position=7, paid_per=0.0015)
    monkeypatch.setattr(connections, "tool_factory", lambda eng, name: list(w.tools.get(name, [])))
    w.site = links.add_site(engine, f"https://{ME}/", "own", is_allowed=ALLOW)["id"]
    w.drain = lambda: tick(engine, "refresh", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    w.sem = semscraper(w.api)
    w.tools["google"] = [w.sem, w.bright, w.serpapi]
    return w


def track(world, *names, country="FR", language="fr"):
    ids = []
    with world.engine.begin() as conn:
        for name in names:
            conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, :l)"), {"k": name, "h": store.keyword_hash(name), "c": country, "l": language})
            keyword_id = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = :c AND language = :l"), {"h": store.keyword_hash(name), "c": country, "l": language}).scalar_one()
            conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": world.site, "k": keyword_id})
            ids.append(keyword_id)
    return ids


def run_now(world, ids, **extra):
    started = refresh.start(world.engine, {"keyword_ids": ids, "engines": ["google"], "depth": 10, "include_recent": True, **extra})
    world.drain()
    return refresh.run_dict(world.engine, started["id"])


def ledger(world, tool):
    with world.engine.connect() as conn:
        return conn.execute(text("SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(cost), 0), COALESCE(MIN(paid), 1) FROM credit_ledger WHERE tool = :t"), {"t": tool}).one()


def used_tools(world, run_id):
    with world.engine.connect() as conn:
        return [r[0] for r in conn.execute(text("SELECT used_tool FROM rank_run_items WHERE run_id = :r ORDER BY id"), {"r": run_id}).all()]


def test_it_reuses_the_semscraper_app_key_and_has_no_key_field_of_its_own(engine):
    assert "Semscraper" not in [t.name for t in connections.tools_for(engine, "google")]  # no key yet: not built
    sources.save_app_key(engine, "semscraper", "sem-test-key-5678")
    built = connections._build(engine, "Semscraper")
    assert isinstance(built, Semscraper) and built.key == "sem-test-key-5678"
    row = next(r for r in connections.tool_list(engine)["tools"] if r["name"] == "Semscraper")
    assert row["auth"] == "app" and row["connected"] and row["last4"] and row["always_paid"] and row["currency"] == "EUR"
    assert row["engines"] == ["google"] and row["gives_ai"] and row["price"] == "€0.30 per 1,000" and row["free_serps_left"] == 1000
    with pytest.raises(Refused, match="Settings → Semscraper"):
        connections.save_key(engine, "Semscraper", "another-key")
    with pytest.raises(Refused, match="Settings → Semscraper"):
        connections.remove_key(engine, "Semscraper")
    assert sources.app_key(engine, "semscraper") == "sem-test-key-5678"  # What AI says keeps its key
    from seo.ai_brand import engines as ai_engines

    assert ai_engines.client(engine, "semscraper").key == "sem-test-key-5678"


def test_semscraper_is_first_in_googles_default_order_only(engine):
    assert connections.DEFAULT_ORDER["google"][0] == "Semscraper"
    assert all("Semscraper" not in connections.DEFAULT_ORDER[name] for name in ("duckduckgo", "bing", "yandex"))
    assert connections.get_setting(engine, "main_tool") == ""  # the main tool setting is left as it is
    connections.save_setting(engine, "main_tool", "Semscraper")
    assert connections.order_for(engine, "google")[0] == "Semscraper" and connections.order_for(engine, "duckduckgo")[0] == "DuckDuckGo direct"


def test_paid_use_is_one_switch(world):
    assert world.client.put("/api/tools/Semscraper/paid", json={"on": True}).get_json() == {"paid_on": True}
    assert connections.paid_on(world.engine, "Semscraper")


def test_with_its_paid_use_off_a_refresh_passes_it_over_quietly(world):
    run = run_now(world, track(world, "coffee beans"), allow_paid=True, paid_cap=5)
    # the next tool takes its place: SerpApi, which goes in front on Google while it has free searches (ai_first)
    assert world.api.posts == [] and run["done"] == 1 and used_tools(world, run["id"]) == ["SerpApi"] and not run["stop_reason"]
    seen = refresh.preview(world.engine, {"keyword_ids": track(world, "coffee beans"), "engines": ["google"], "include_recent": True})
    assert seen["paid_off"] == ["Semscraper"]


def test_main_tool_semscraper_does_the_refresh_and_counts_its_euros(world):
    connections.save_setting(world.engine, "main_tool", "Semscraper")
    connections.set_paid(world.engine, "Semscraper", True)
    ids = track(world, "coffee beans", "decaf coffee")
    run = run_now(world, ids, allow_paid=True, paid_cap=1)
    assert run["status"] == "done" and used_tools(world, run["id"]) == ["Semscraper", "Semscraper"] and len(world.api.posts) == 2
    amount, cost, paid = ledger(world, "Semscraper")
    assert amount == 2 and Decimal(str(cost)) == Decimal("0.0006") and paid == 1
    assert connections.used_this_month(world.engine, "Semscraper") == 0  # paid use never eats a free allowance
    assert run["spent"] == pytest.approx(0.0006 * 1.2)  # held against the dollar limit at EUR_IN_USD
    with world.engine.connect() as conn:
        row = conn.execute(text("SELECT tool, ai_state FROM serp_checks ORDER BY id LIMIT 1")).one()
    assert tuple(row) == ("Semscraper", "present")


def test_a_free_serp_is_counted_at_the_price_semscraper_gave(world):
    world.api.cost = "0"
    connections.set_paid(world.engine, "Semscraper", True)
    run_now(world, track(world, "coffee beans"), allow_paid=True, paid_cap=1)
    amount, cost, _ = ledger(world, "Semscraper")
    assert amount == 1 and Decimal(str(cost)) == 0
    assert next(r for r in connections.tool_list(world.engine)["tools"] if r["name"] == "Semscraper")["free_serps_left"] == 999


def test_serpapi_takes_over_when_semscraper_fails_or_stops(world):
    connections.save_setting(world.engine, "main_tool", "Semscraper")
    connections.set_paid(world.engine, "Semscraper", True)
    world.tools["google"] = [world.sem, world.serpapi]
    world.api.post_status = 500
    run = run_now(world, track(world, "coffee beans"), allow_paid=True, paid_cap=1)
    assert run["done"] == 1 and used_tools(world, run["id"]) == ["SerpApi"] and len(world.serpapi.calls) == 1
    assert ledger(world, "Semscraper")[0] == 0  # a failed request isn't billed
    world.api.post_status, world.api.post_body = 401, None
    run = run_now(world, track(world, "decaf coffee"), allow_paid=True, paid_cap=1)
    assert used_tools(world, run["id"]) == ["SerpApi"] and "Semscraper refused the key." in (run["stop_reason"] or "")


def test_the_run_limit_stops_semscraper_then_the_next_tool_carries_on(world):
    connections.set_paid(world.engine, "Semscraper", True)
    # $0.01 holds 27 searches at €0.0003, counted as $0.00036 each
    run = run_now(world, track(world, *[f"k{n}" for n in range(30)]), allow_paid=True, paid_cap=0.01)
    used = used_tools(world, run["id"])
    assert used[:27] == ["Semscraper"] * 27 and "Semscraper" not in used[27:] and run["done"] == 30
    assert "spending limit" in run["stop_reason"]


def test_choose_tools_semscraper_without_paid_says_what_to_switch_on(world):
    run = run_now(world, track(world, "a"), mode="pick", picked=["Semscraper"])
    assert world.api.posts == [] and run["status"] == "stopped"
    assert "switch on its paid use in Settings" in run["stop_reason"]


def test_first_check_of_new_keywords_uses_semscraper_only_when_switched_on(world):
    from seo.competitors import keywords

    connections.save_setting(world.engine, "main_tool", "Semscraper")
    keywords.upload(world.engine, world.site, "coffee beans", "FR", "fr")
    world.drain()
    assert world.api.posts == [] and len(world.bright.calls) == 1  # off: the free tools do it
    connections.set_paid(world.engine, "Semscraper", True)
    keywords.upload(world.engine, world.site, "decaf coffee", "FR", "fr")
    world.drain()
    assert len(world.api.posts) == 1 and len(world.bright.calls) == 1
    amount, cost, paid = ledger(world, "Semscraper")
    assert amount == 1 and paid == 1 and Decimal(str(cost)) == Decimal("0.0003")


def test_free_only_work_never_uses_semscraper(world):
    from seo.backlinks import source_index
    from seo.competitors import probe

    connections.set_paid(world.engine, "Semscraper", True)
    assert not connections.can_afford_a_search(world.engine, world.sem)
    assert world.sem not in source_index._free_tools(world.engine)
    assert all(t["tool"] != "Semscraper" for t in probe._tools(world.engine, "google"))
    assert "Semscraper" not in connections.DEFAULT_ORDER["duckduckgo"]  # the daily DuckDuckGo check never sees it


# ---- Check AI Overviews: the dialog's API -------------------------------------------------------------------------------


def aio(world, ids, **extra):
    return world.client.post("/api/refresh/preview", json={"keyword_ids": ids, "engines": ["google"], "depth": 10, "mode": "ai", "picked": [], **extra}).get_json()


def test_check_ai_overviews_uses_semscraper_and_shows_its_euro_price(world):
    connections.set_paid(world.engine, "Semscraper", True)
    ids = track(world, *[f"coffee {n}" for n in range(156)])
    seen = aio(world, ids, allow_paid=True, paid_cap=1000)
    used = {p["name"]: p for p in seen["tools"] if p["checks"]}
    assert list(used) == ["Semscraper"] and used["Semscraper"]["checks"] == 156 and used["Semscraper"]["currency"] == "EUR"
    assert seen["cost_eur"] == pytest.approx(0.0468) and seen["cost"] == 0 and used["Semscraper"]["free_serps_left"] == 1000
    assert {p["name"] for p in seen["tools"]} == {"Semscraper", "SerpApi"}  # only the tools that read AI Overviews
    started = world.client.post("/api/refresh/runs", json={"keyword_ids": ids[:2], "engines": ["google"], "depth": 10, "mode": "ai", "picked": [], "allow_paid": True, "paid_cap": 0.01, "token": "aio-token-1"})
    assert started.status_code == 202
    world.drain()
    assert len(world.api.posts) == 2 and world.serpapi.calls == [] and world.bright.calls == []


def test_check_ai_overviews_falls_back_to_serpapi_and_says_semscraper_is_off(world):
    ids = track(world, "coffee beans", "decaf coffee")
    seen = aio(world, ids)
    assert [p["name"] for p in seen["tools"] if p["checks"]] == ["SerpApi"] and seen["paid_off"] == ["Semscraper"] and seen["cost_eur"] == 0
    world.client.post("/api/refresh/runs", json={"keyword_ids": ids, "engines": ["google"], "depth": 10, "mode": "ai", "picked": [], "token": "aio-token-2"})
    world.drain()
    assert world.api.posts == [] and len(world.serpapi.calls) == 2 and world.bright.calls == []  # never a tool that can't read AI Overviews


def test_check_ai_overviews_moves_to_serpapi_when_semscraper_breaks_mid_run(world):
    connections.set_paid(world.engine, "Semscraper", True)
    world.api.get_status = 503
    ids = track(world, "coffee beans")
    world.client.post("/api/refresh/runs", json={"keyword_ids": ids, "engines": ["google"], "depth": 10, "mode": "ai", "allow_paid": True, "paid_cap": 1, "token": "aio-token-3"})
    world.drain()
    assert len(world.api.posts) == 1 and len(world.serpapi.calls) == 1
    assert ledger(world, "Semscraper")[0] == 1  # it was sent, so it stays counted
