"""The competitors backend, on the real test database and worker. A fake search tool and websites held in memory."""
import io
import re
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text

from seo.backlinks import logos
from seo.competitors import ai_watch, collective, crawl, gaps, keywords, notes, pairs, profile, suggest, quality, insights
from seo.competitors import pages as page_reader
from seo.core import budget, crypto
from seo.core.errors import Conflict, NotFound, Refused
from seo.crawl.fetch import PoliteFetcher
from seo.links import service as links
from seo.serp import connections, store
from seo.serp.tools import ABSENT, NOT_CAPTURED, PRESENT, Answer, Found, SearchFailed, ToolStopped
from seo.web import create_app
from seo.worker import queue
from seo.worker.runner import tick

ALLOW = lambda url: True  # noqa: E731
ACCENTED, ASCII = "münchen-kaffee.example", "xn--mnchen-kaffee-wob.example"


class FakeTool:
    def __init__(self, name="Free Tool", free_monthly=None, results=None, charged=1, stop_after=None, fail=(), ai=NOT_CAPTURED, location="FR", most_per_search=1):
        self.name, self.free_monthly, self.results, self.charged = name, free_monthly, results or {}, charged
        self.stop_after, self.fail, self.ai, self.location, self.most_per_search = stop_after, set(fail), ai, location, most_per_search
        self.calls = []

    def search(self, keyword, engine, country, language, device, depth):
        if self.stop_after is not None and len(self.calls) >= self.stop_after:
            raise ToolStopped(f"{self.name} asked for a bot check.")
        self.calls.append(keyword)
        if keyword in self.fail:
            raise SearchFailed("It timed out.")
        urls = self.results.get(keyword, self.results.get("*", ["https://rival.example/x"]))
        return Answer(self.name, self.location, depth, [Found(i + 1, url, "A title") for i, url in enumerate(urls)], self.ai, [], self.charged)


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    w = SimpleNamespace(engine=engine, tools={}, pages={}, requests=[], client=create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client())

    def website(request):
        w.requests.append(str(request.url))
        key = f"{request.url.host}{request.url.raw_path.decode()}"
        found = w.pages.get(key)
        if found is None:
            return httpx.Response(404, text="nope")
        if isinstance(found, int):
            return httpx.Response(found, text="no")
        if isinstance(found, tuple):
            return httpx.Response(found[0], headers={"location": found[1]})
        if key.endswith(".xml"):
            return httpx.Response(200, text=found, headers={"content-type": "application/xml"})
        if key.endswith(".txt"):
            return httpx.Response(200, text=found, headers={"content-type": "text/plain"})
        return httpx.Response(200, html=found)

    monkeypatch.setattr(connections, "tool_factory", lambda eng, name: list(w.tools.get(name, [])))
    monkeypatch.setattr(quality, "queue_checks", lambda eng, part=0: _pass_page_checks(eng))
    monkeypatch.setattr(logos, "queue_for", lambda eng, domains: None)  # icons have their own tests, and would add requests and jobs here
    monkeypatch.setattr(crawl, "queue_own_if_never_read", lambda eng, site_id: False)  # my site's first read has its own tests, and would add jobs here
    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=ALLOW, transport=httpx.MockTransport(website)))
    w.own = links.add_site(engine, "https://me.example/", "own", is_allowed=ALLOW)["id"]
    w.drain = lambda lane="refresh": tick(engine, lane, lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    return w


def _pass_page_checks(engine):
    with engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'good' WHERE quality = 'pending'"))


def rows(engine, sql, **params):
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def scalar(engine, sql, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def track(engine, site_id, keyword, country="FR", language="fr"):
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO keywords (keyword, keyword_hash, country, language) VALUES (:k, :h, :c, :l)"), {"k": keyword, "h": store.keyword_hash(keyword), "c": country, "l": language})
        keyword_id = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h AND country = :c AND language = :l"), {"h": store.keyword_hash(keyword), "c": country, "l": language}).scalar_one()
        conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": keyword_id})
    return keyword_id


def seed(engine, site_id, keyword, urls, tool="SerpApi", location="FR", depth=10, ai=NOT_CAPTURED, cited=(), search_engine="google"):
    """Saves one check as the worker would. Positions follow the order of urls."""
    keyword_id = track(engine, site_id, keyword)
    found = [Found(i + 1, f"https://{url}" if "://" not in url else url, "A title") for i, url in enumerate(urls)]
    return store.save_check(engine, keyword_id, search_engine, Answer(tool, location, depth, found, ai, [f"https://{c}" for c in cited], 1), "refresh")


def run_of(world, run_id):
    return keywords.run_dict(world.engine, run_id)


def add_rival(world, host="rival.example", site_id=None):
    return suggest.add_competitor(world.engine, site_id or world.own, host, "manual", ALLOW)["id"]


# ---- first check on upload -----------------------------------------------------------------------

def test_upload_runs_one_check_per_new_keyword_and_counts_it(world):
    tool = FakeTool("Paid By Credit", free_monthly=10)
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "one\ntwo\nthree", "FR", "fr")
    assert run["status"] == "queued" and run["total"] == 3 and run["new_keywords"] == 3
    world.drain()
    done = run_of(world, run["id"])
    assert done["status"] == "complete" and done["checked"] == 3 and done["tool"] == "Paid By Credit"
    assert sorted(tool.calls) == ["one", "three", "two"]
    assert connections.used_this_month(world.engine, "Paid By Credit") == 3
    assert scalar(world.engine, "SELECT COUNT(*) FROM serp_checks WHERE trigger_kind = 'first_upload' AND status = 'ok'") == 3


def test_a_second_upload_checks_only_what_is_new(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    keywords.upload(world.engine, world.own, "one\ntwo")
    world.drain()
    tool.calls.clear()
    run = keywords.upload(world.engine, world.own, "two\nthree")
    assert run["new_keywords"] == 1
    world.drain()
    assert tool.calls == ["three"]


def test_all_already_checked_is_complete_with_no_search(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    keywords.upload(world.engine, world.own, "one")
    world.drain()
    tool.calls.clear()
    run = keywords.upload(world.engine, world.own, "one")
    assert run["status"] == "complete" and run["new_keywords"] == 0
    world.drain()
    assert tool.calls == []


def test_a_keyword_another_of_my_sites_checked_costs_nothing(world):
    tool = FakeTool(free_monthly=5)
    world.tools["google"] = [tool]
    keywords.upload(world.engine, world.own, "shared", "FR", "fr")
    world.drain()
    other = links.add_site(world.engine, "https://second.example/", "own", is_allowed=ALLOW)["id"]
    run = keywords.upload(world.engine, other, "shared", "FR", "fr")
    world.drain()
    assert run["status"] == "complete" and tool.calls == ["shared"] and connections.used_this_month(world.engine, tool.name) == 1
    assert [c.keyword for c in store.latest_checks(world.engine, other)] == ["shared"]


def test_the_same_word_in_another_market_is_another_keyword(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    keywords.upload(world.engine, world.own, "shared", "FR", "fr")
    keywords.upload(world.engine, world.own, "shared", "DE", "de")
    world.drain()
    assert tool.calls == ["shared", "shared"]


def test_no_tool_connected_waits_with_a_plain_reason_then_resumes(world):
    run = keywords.upload(world.engine, world.own, "one\ntwo")
    assert run["status"] == "waiting" and run["stop_reason"] == "No search tool connected: add a key in Settings."
    assert scalar(world.engine, "SELECT COUNT(*) FROM site_keywords") == 2  # the list is kept
    assert keywords.resume_waiting(world.engine) == []
    tool = FakeTool()
    world.tools["google"] = [tool]
    assert keywords.resume_waiting(world.engine) == [run["id"]]
    world.drain()
    resumed = run_of(world, run["id"])
    assert resumed["status"] == "complete" and resumed["checked"] == 2 and resumed["stop_reason"] is None


def test_a_stopped_tool_passes_to_the_next_free_tool(world):
    first, second = FakeTool("First", stop_after=1), FakeTool("Second")
    world.tools["google"] = [first, second]
    run = keywords.upload(world.engine, world.own, "one\ntwo\nthree")
    world.drain()
    assert first.calls == ["one"] and second.calls == ["two", "three"]
    assert run_of(world, run["id"])["status"] == "complete"
    assert sorted(r["tool"] for r in rows(world.engine, "SELECT tool FROM serp_checks")) == ["First", "Second", "Second"]


def test_when_every_free_tool_stops_it_keeps_what_was_saved_and_says_so(world):
    tool = FakeTool("Only", stop_after=1)
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "one\ntwo")
    world.drain()
    stopped = run_of(world, run["id"])
    assert stopped["status"] == "waiting" and stopped["checked"] == 1
    assert "bot check" in stopped["stop_reason"] and "saved" in stopped["stop_reason"]
    assert len(store.latest_checks(world.engine, world.own)) == 1


def test_it_stops_at_the_free_allowance_and_never_passes_it(world):
    tool = FakeTool("Credits", free_monthly=2)
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "one\ntwo\nthree\nfour")
    world.drain()
    stopped = run_of(world, run["id"])
    assert stopped["status"] == "waiting" and stopped["checked"] == 2 and len(tool.calls) == 2
    assert "no free checks left" in stopped["stop_reason"]
    assert connections.used_this_month(world.engine, "Credits") == 2 and connections.free_left(world.engine, tool) == 0
    assert keywords.resume_waiting(world.engine) == []  # nothing to spend, so nothing starts
    world.drain()
    assert len(tool.calls) == 2


def test_a_search_that_can_cost_two_never_passes_the_allowance(world):
    tool = FakeTool("Two Credits", free_monthly=3, charged=2, most_per_search=2)
    world.tools["google"] = [tool]
    keywords.upload(world.engine, world.own, "one\ntwo\nthree")
    world.drain()
    assert len(tool.calls) == 1 and connections.used_this_month(world.engine, tool.name) == 2


def test_a_first_check_moves_on_to_the_next_engine_when_one_runs_out(world):
    google, other = FakeTool("Google Tool", free_monthly=1), FakeTool("Other Tool")
    world.tools.update(google=[google], duckduckgo=[other])
    run = keywords.upload(world.engine, world.own, "one\ntwo")
    world.drain()
    assert run_of(world, run["id"])["status"] == "complete"
    assert sorted(r["engine"] for r in rows(world.engine, "SELECT t.engine FROM serp_checks c JOIN serp_targets t ON t.id = c.target_id")) == ["duckduckgo", "google"]


def test_a_failed_check_is_not_done_and_is_tried_on_a_later_run_without_looping(world):
    tool = FakeTool(fail=["bad"])
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "good\nbad")
    world.drain()
    assert tool.calls.count("bad") == 1  # once in this run, however many jobs it took
    failed = run_of(world, run["id"])
    assert failed["status"] == "waiting" and failed["checked"] == 1 and failed["failed"] == 1 and "couldn't be checked" in failed["stop_reason"]
    tool.fail.clear()
    assert keywords.resume_waiting(world.engine) == [run["id"]]
    world.drain()
    assert tool.calls.count("bad") == 2 and tool.calls.count("good") == 1
    assert run_of(world, run["id"])["status"] == "complete"
    assert {c.keyword for c in store.latest_checks(world.engine, world.own)} == {"good", "bad"}


def test_a_keyword_that_always_fails_stops_holding_the_list_back(world):
    tool = FakeTool(fail=["bad"])
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "bad")
    for _ in range(keywords.FIRST_CHECK_TRIES):
        world.drain()
        keywords.resume_waiting(world.engine)
    world.drain()
    assert run_of(world, run["id"])["status"] == "complete" and tool.calls.count("bad") == keywords.FIRST_CHECK_TRIES


def test_a_tool_answering_in_an_odd_shape_fails_one_keyword_not_the_list(world):
    class Broken(FakeTool):
        def search(self, keyword, *args):
            if keyword == "odd":
                raise KeyError("link")
            return super().search(keyword, *args)

    world.tools["google"] = [Broken()]
    run = keywords.upload(world.engine, world.own, "odd\nfine")
    world.drain()
    assert run_of(world, run["id"])["checked"] == 1 and run_of(world, run["id"])["failed"] == 1
    assert "KeyError" in scalar(world.engine, "SELECT error FROM serp_checks WHERE status = 'failed'")


def test_a_large_list_carries_on_in_a_new_job(world, monkeypatch):
    monkeypatch.setattr(keywords, "CHUNK_SECONDS", 0)
    tool = FakeTool()
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "one\ntwo\nthree")
    jobs = 0
    while True:
        claimed = queue.claim(world.engine, "refresh", "test")
        if not claimed:
            break
        jobs += 1
        keywords.run_check(claimed[0], world.engine)
        queue.complete(world.engine, claimed[0].id, "test")
    assert jobs == 3 and sorted(tool.calls) == ["one", "three", "two"]
    assert run_of(world, run["id"])["status"] == "complete"


# ---- refresh: only from the call -------------------------------------------------------------------

def test_refresh_runs_only_when_asked_and_refuses_while_one_runs(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    keywords.upload(world.engine, world.own, "one\ntwo")
    world.drain()
    tool.calls.clear()
    world.drain()
    assert tool.calls == [] and keywords.resume_waiting(world.engine) == []  # nothing runs by itself
    run = keywords.refresh(world.engine, world.own)
    with pytest.raises(Conflict):
        keywords.refresh(world.engine, world.own)
    world.drain()
    assert sorted(tool.calls) == ["one", "two"]
    assert run_of(world, run["id"])["status"] == "complete"
    assert scalar(world.engine, "SELECT COUNT(*) FROM serp_checks WHERE trigger_kind = 'refresh'") == 2


def test_refresh_finishes_even_if_some_keywords_fail(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    keywords.upload(world.engine, world.own, "one\ntwo")
    world.drain()
    tool.fail.add("two")
    run = keywords.refresh(world.engine, world.own)
    world.drain()
    done = run_of(world, run["id"])
    assert done["status"] == "complete" and done["checked"] == 1 and done["failed"] == 1


def test_refresh_stays_on_its_engine_when_its_tool_stops(world):
    google, other = FakeTool("Google Tool"), FakeTool("Other Tool")
    world.tools.update(google=[google], duckduckgo=[other])
    keywords.upload(world.engine, world.own, "one")
    world.drain()
    google.stop_after = 0
    run = keywords.refresh(world.engine, world.own)
    world.drain()
    assert run_of(world, run["id"])["status"] == "waiting" and other.calls == []


def test_refresh_needs_a_list_first(world):
    with pytest.raises(Refused):
        keywords.refresh(world.engine, world.own)


def test_a_run_that_lost_its_job_does_not_block_the_button_forever(world):
    world.tools["google"] = [FakeTool()]
    keywords.upload(world.engine, world.own, "one")
    world.drain()
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE keyword_uploads SET status = 'running', created_at = UTC_TIMESTAMP(3) - INTERVAL 1 HOUR"))
    assert keywords.refresh(world.engine, world.own)["status"] == "queued"


# ---- suggestions ---------------------------------------------------------------------------------

def many_keywords(world):
    seed(world.engine, world.own, "k1", ["big.example/a", "me.example/1", "small.example/x"])
    seed(world.engine, world.own, "k2", ["me.example/2", "big.example/b", "other.example/y"])
    seed(world.engine, world.own, "k3", ["big.example/c", "other.example/z", "wikipedia.org/w"])
    seed(world.engine, world.own, "k4", ["other.example/z", "economie.gouv.fr/w", "wikipedia.org/w2"])
    seed(world.engine, world.own, "k5", ["economie.gouv.fr/x", "m.me.example/phone", "www.big.example/d"])


def test_suggestions_count_order_and_show_their_evidence(world):
    many_keywords(world)
    answer = suggest.suggestions(world.engine, world.own)
    assert answer["keywords_total"] == 5 and answer["keywords_checked"] == 5 and answer["keywords_waiting"] == 0 and answer["min_appearances"] == 2
    assert [(s["domain"], s["keywords"]) for s in answer["suggestions"]] == [("big.example", 4), ("other.example", 3)]
    big = answer["suggestions"][0]
    assert big["share"] == 0.8 and big["best_position"] == 1 and big["both_rank"] == 3 and big["top3"] == 4 and big["average_position"] == 1.8
    first = next(e for e in big["evidence"] if e["keyword"] == "k1")
    assert (first["position"], first["url"], first["engine"], first["tool"], first["location"], first["my_position"]) == (1, "https://big.example/a", "google", "SerpApi", "FR", 2)
    assert next(e for e in big["evidence"] if e["keyword"] == "k3")["my_position"] is None
    ids = {r["keyword"]: r["id"] for r in rows(world.engine, "SELECT id, keyword FROM keywords")}
    assert all(e["keyword_id"] == ids[e["keyword"]] for e in big["evidence"])  # the keyword on screen opens its own details


def test_a_one_off_is_left_out_once_there_is_enough_data(world):
    many_keywords(world)
    assert "small.example" not in [s["domain"] for s in suggest.suggestions(world.engine, world.own)["suggestions"]]


def test_with_little_data_a_single_appearance_counts(world):
    seed(world.engine, world.own, "k1", ["lone.example/a"])
    answer = suggest.suggestions(world.engine, world.own)
    assert answer["min_appearances"] == 1 and [s["domain"] for s in answer["suggestions"]] == ["lone.example"]


def test_my_own_domains_are_left_out_and_platforms_are_labelled_apart(world):
    links.add_site(world.engine, "https://second.example/", "own", is_allowed=ALLOW)
    seed(world.engine, world.own, "k1", ["second.example/a", "me.example/b", "blog.me.example/c", "wikipedia.org/w", "economie.gouv.fr/x"])
    answer = suggest.suggestions(world.engine, world.own)
    assert answer["suggestions"] == []
    assert sorted((p["domain"], p["kind"]) for p in answer["platforms"]) == [("economie.gouv.fr", "public"), ("wikipedia.org", "platform")]


def test_a_tracked_competitor_is_not_suggested(world):
    seed(world.engine, world.own, "k1", ["rival.example/a", "shop.rival.example/b", "new.example/c"])
    add_rival(world)
    assert [s["domain"] for s in suggest.suggestions(world.engine, world.own)["suggestions"]] == ["new.example"]


def test_dismissed_stays_dismissed_through_new_data_and_can_be_restored(world):
    seed(world.engine, world.own, "k1", ["gone.example/a", "stay.example/b"])
    suggest.dismiss(world.engine, world.own, "gone.example")
    seed(world.engine, world.own, "k2", ["gone.example/c"])
    seed(world.engine, world.own, "k1", ["gone.example/a2"])
    answer = suggest.suggestions(world.engine, world.own)
    assert "gone.example" not in [s["domain"] for s in answer["suggestions"]]
    assert [d["domain"] for d in answer["dismissed"]] == ["gone.example"] and answer["dismissed"][0]["keywords"] == 2
    suggest.restore(world.engine, world.own, "gone.example")
    answer = suggest.suggestions(world.engine, world.own)
    assert "gone.example" in [s["domain"] for s in answer["suggestions"]] and answer["dismissed"] == []


def test_a_dismissed_domain_with_no_results_is_still_listed(world):
    suggest.dismiss(world.engine, world.own, "www.absent.example")
    assert suggest.suggestions(world.engine, world.own)["dismissed"][0]["domain"] == "absent.example"


def test_accepting_makes_a_competitor_site_and_link_and_queues_a_crawl(world):
    seed(world.engine, world.own, "k1", ["rival.example/a"])
    accepted = suggest.accept(world.engine, world.own, "rival.example", ALLOW)
    site = rows(world.engine, "SELECT host, kind FROM sites WHERE id = :i", i=accepted["id"])[0]
    assert site == {"host": "rival.example", "kind": "competitor"}
    assert rows(world.engine, "SELECT source FROM site_competitors WHERE site_id = :s", s=world.own) == [{"source": "suggested"}]
    assert scalar(world.engine, "SELECT COUNT(*) FROM jobs WHERE kind = 'competitors.crawl'") == 1
    with pytest.raises(Conflict):
        suggest.accept(world.engine, world.own, "rival.example", ALLOW)
    assert suggest.suggestions(world.engine, world.own)["suggestions"] == []


def test_numbers_change_when_a_new_check_arrives(world):
    seed(world.engine, world.own, "k1", ["rival.example/a"])
    assert suggest.suggestions(world.engine, world.own)["suggestions"][0]["average_position"] == 1
    seed(world.engine, world.own, "k1", ["x.example/1", "y.example/2", "rival.example/a"])
    assert next(s for s in suggest.suggestions(world.engine, world.own)["suggestions"] if s["domain"] == "rival.example")["average_position"] == 3
    seed(world.engine, world.own, "k1", ["x.example/1"])
    assert [s["domain"] for s in suggest.suggestions(world.engine, world.own)["suggestions"]] == ["x.example"]


@pytest.mark.parametrize("call", [
    lambda w, rival: suggest.suggestions(w.engine, rival),
    lambda w, rival: keywords.upload(w.engine, rival, "x"),
    lambda w, rival: keywords.refresh(w.engine, rival),
    lambda w, rival: suggest.add_competitor(w.engine, rival, "new.example", "manual", ALLOW),
    lambda w, rival: suggest.dismiss(w.engine, rival, "new.example"),
    lambda w, rival: gaps.link_gaps(w.engine, rival),
    lambda w, rival: pairs.list_pairs(w.engine, rival),
    lambda w, rival: ai_watch.watch(w.engine, rival),
    lambda w, rival: profile.overview(w.engine, rival),
    lambda w, rival: gaps.log_backlink(w.engine, rival, "https://x.example/", "live"),
    lambda w, rival: notes.create(w.engine, "all", "text", rival),
])
def test_a_competitor_id_as_site_id_is_refused(world, call):
    rival = add_rival(world)
    with pytest.raises(Refused) as refused:
        call(world, rival)
    assert refused.value.http == 400


@pytest.mark.parametrize("site_id", [999999, "1", True, None, 1.5])
def test_unknown_or_badly_typed_site_ids_are_refused(world, site_id):
    with pytest.raises(Refused):
        suggest.suggestions(world.engine, site_id)


def test_my_own_site_cannot_be_a_competitor(world):
    for address in ("me.example", "https://www.me.example/x", "blog.me.example"):
        with pytest.raises(Refused):
            suggest.add_competitor(world.engine, world.own, address, "manual", ALLOW)


# ---- accented hosts, as my own site and as a competitor --------------------------------------------

@pytest.mark.parametrize("own_spelling", [ACCENTED, ASCII])
def test_my_accented_site_is_found_in_results_whichever_way_it_is_spelled(world, own_spelling):
    mine = links.add_site(world.engine, f"https://{own_spelling}/", "own", is_allowed=ALLOW)["id"]
    seed(world.engine, mine, "kaffee", [f"{ASCII}/a", f"{ACCENTED}/b", "rival.example/c"])
    check = store.latest_checks(world.engine, mine)[0]
    assert check.best_on(own_spelling).position == 1
    answer = suggest.suggestions(world.engine, mine)
    assert [s["domain"] for s in answer["suggestions"]] == ["rival.example"]  # never suggested as its own competitor
    assert answer["suggestions"][0]["evidence"][0]["my_position"] == 1
    assert all(u["url"].startswith(f"https://{ASCII}/") for u in pairs.page_options(world.engine, mine))
    assert len(pairs.page_options(world.engine, mine)) == 2
    for address in (ACCENTED, ASCII):
        with pytest.raises(Refused):
            suggest.add_competitor(world.engine, mine, address, "manual", ALLOW)


@pytest.mark.parametrize("typed", [ACCENTED, ASCII])
def test_an_accented_competitor_is_one_site_whichever_way_it_is_typed(world, typed):
    seed(world.engine, world.own, "kaffee", ["me.example/a", f"{ASCII}/b"])
    answer = suggest.suggestions(world.engine, world.own)
    assert (answer["suggestions"][0]["domain"], answer["suggestions"][0]["display"]) == (ASCII, ACCENTED)
    suggest.dismiss(world.engine, world.own, typed)
    assert [d["domain"] for d in suggest.suggestions(world.engine, world.own)["dismissed"]] == [ASCII]
    rival = add_rival(world, typed)
    answer = suggest.suggestions(world.engine, world.own)
    assert answer["suggestions"] == [] and answer["dismissed"] == []  # adding it clears the dismissal
    with pytest.raises(Conflict):
        add_rival(world, ACCENTED)
    with pytest.raises(Conflict):
        add_rival(world, ASCII)
    assert profile.overview(world.engine, world.own)[0]["shared"] == 1
    assert profile.profile(world.engine, world.own, rival)["display"] == ACCENTED


def test_a_competitor_stored_in_the_accented_spelling_is_reused(world):
    rival = links.add_site(world.engine, f"https://{ACCENTED}/", "competitor", is_allowed=ALLOW)["id"]
    assert add_rival(world, ASCII) == rival


# ---- pairs ------------------------------------------------------------------------------------------

def paired_world(world):
    seed(world.engine, world.own, "k1", ["rival.example/t1", "me.example/m1"])
    seed(world.engine, world.own, "k2", ["rival.example/t1", "me.example/m1"])
    seed(world.engine, world.own, "k3", ["rival.example/t2", "me.example/m1"])
    seed(world.engine, world.own, "k4", ["me.example/m2", "rival.example/t3"])
    return add_rival(world)


def by_my_url(world, include_hidden=False):
    return {p["my_url"]: p for p in pairs.list_pairs(world.engine, world.own, include_hidden=include_hidden)}


def test_pairs_are_picked_from_who_ranks_for_the_same_keywords(world):
    paired_world(world)
    found = by_my_url(world)
    assert found["https://me.example/m1"]["their_url"] == "https://rival.example/t1" and found["https://me.example/m1"]["shared_keywords"] == 2
    assert found["https://me.example/m2"]["their_url"] == "https://rival.example/t3" and found["https://me.example/m2"]["source"] == "auto"


def test_a_tie_goes_to_their_best_position_then_the_address(world):
    seed(world.engine, world.own, "k1", ["x.example/1", "rival.example/low", "me.example/m"])
    seed(world.engine, world.own, "k2", ["rival.example/high", "me.example/m"])
    add_rival(world)
    assert by_my_url(world)["https://me.example/m"]["their_url"] == "https://rival.example/high"


def test_a_keyword_seen_on_two_engines_counts_once(world):
    seed(world.engine, world.own, "k1", ["rival.example/t", "me.example/m"])
    seed(world.engine, world.own, "k1", ["rival.example/t", "me.example/m"], tool="DuckDuckGo direct", search_engine="duckduckgo")
    add_rival(world)
    assert by_my_url(world)["https://me.example/m"]["shared_keywords"] == 1
    overview = profile.overview(world.engine, world.own)[0]
    assert overview["shared"] == 1 and profile.profile(world.engine, world.own, overview["id"])["compare"]["shared"] == 1


def test_a_manual_pair_survives_refresh_and_new_data(world):
    paired_world(world)
    pair = by_my_url(world)["https://me.example/m1"]
    changed = pairs.update_pair(world.engine, pair["id"], their_url="https://rival.example/my-choice")
    assert changed["source"] == "manual" and changed["their_url"] == "https://rival.example/my-choice"
    for round_no in range(3):
        seed(world.engine, world.own, "k1", ["rival.example/fresh", "me.example/m1"])
        seed(world.engine, world.own, f"new{round_no}", ["rival.example/fresh", "me.example/m1"])
        pairs.refresh_auto_pairs(world.engine, world.own)
    after = by_my_url(world)["https://me.example/m1"]
    assert (after["id"], after["their_url"], after["source"]) == (pair["id"], "https://rival.example/my-choice", "manual")


def test_a_manual_pair_stays_when_it_no_longer_shares_a_keyword(world):
    paired_world(world)
    pair = by_my_url(world)["https://me.example/m2"]
    pairs.update_pair(world.engine, pair["id"], their_url="https://rival.example/mine")
    seed(world.engine, world.own, "k4", ["somebody.example/x"])
    pairs.refresh_auto_pairs(world.engine, world.own)
    after = by_my_url(world)["https://me.example/m2"]
    assert after["their_url"] == "https://rival.example/mine" and after["shared_keywords"] == 0


def test_an_automatic_pair_follows_the_data_and_goes_when_it_stops_sharing(world):
    paired_world(world)
    seed(world.engine, world.own, "k4", ["me.example/m2", "rival.example/moved"])
    pairs.refresh_auto_pairs(world.engine, world.own)
    assert by_my_url(world)["https://me.example/m2"]["their_url"] == "https://rival.example/moved"
    seed(world.engine, world.own, "k4", ["somebody.example/x"])
    pairs.refresh_auto_pairs(world.engine, world.own)
    assert "https://me.example/m2" not in by_my_url(world)


def test_a_hidden_pair_stays_hidden_and_can_come_back(world):
    paired_world(world)
    pair = by_my_url(world)["https://me.example/m1"]
    jobs_before = scalar(world.engine, "SELECT COUNT(*) FROM jobs")
    assert pairs.update_pair(world.engine, pair["id"], hidden=True)["hidden"] is True
    assert scalar(world.engine, "SELECT COUNT(*) FROM jobs") == jobs_before  # hiding reads nothing
    seed(world.engine, world.own, "k1", ["rival.example/fresh", "me.example/m1"])
    pairs.refresh_auto_pairs(world.engine, world.own)
    assert "https://me.example/m1" not in by_my_url(world)
    assert by_my_url(world, include_hidden=True)["https://me.example/m1"]["hidden"] is True
    assert pairs.update_pair(world.engine, pair["id"], hidden=False)["hidden"] is False
    assert "https://me.example/m1" in by_my_url(world)


def test_back_to_automatic(world):
    paired_world(world)
    pair = by_my_url(world)["https://me.example/m1"]
    pairs.update_pair(world.engine, pair["id"], their_url="https://rival.example/mine", hidden=True)
    back = pairs.back_to_automatic(world.engine, pair["id"])
    assert (back["source"], back["their_url"], back["hidden"], back["shared_keywords"]) == ("auto", "https://rival.example/t1", False, 2)
    made = pairs.create_pair(world.engine, world.own, pair["competitor_id"], "https://me.example/never-ranks", "https://rival.example/any")
    assert made["source"] == "manual"
    assert pairs.back_to_automatic(world.engine, made["id"]) == {"removed": True}


def test_wrong_host_urls_and_bad_changes_are_refused(world):
    rival = paired_world(world)
    pair = by_my_url(world)["https://me.example/m1"]
    for my_url, their_url in (("https://other.example/x", "https://rival.example/y"), ("https://me.example/x", "https://me.example/y"), ("not a url", "https://rival.example/y"), (123, "https://rival.example/y")):
        with pytest.raises(Refused):
            pairs.create_pair(world.engine, world.own, rival, my_url, their_url)
    with pytest.raises(Refused):
        pairs.update_pair(world.engine, pair["id"], their_url="https://other.example/x")
    with pytest.raises(Refused):
        pairs.update_pair(world.engine, pair["id"], hidden="yes")
    with pytest.raises(Refused):
        pairs.update_pair(world.engine, pair["id"])
    with pytest.raises(NotFound):
        pairs.update_pair(world.engine, 999999, hidden=True)
    other_rival = links.add_site(world.engine, "https://not-mine.example/", "competitor", is_allowed=ALLOW)["id"]
    with pytest.raises(NotFound):
        pairs.create_pair(world.engine, world.own, other_rival, "https://me.example/a", "https://not-mine.example/b")
    assert by_my_url(world)["https://me.example/m1"]["source"] == "auto"


def test_moving_a_pair_onto_a_page_already_paired_is_refused(world):
    paired_world(world)
    found = by_my_url(world)
    with pytest.raises(Conflict):
        pairs.update_pair(world.engine, found["https://me.example/m1"]["id"], my_url="https://me.example/m2")


@pytest.mark.parametrize("page, state", [
    (None, "not_read"),
    ({"last_status": None, "content_hash": None}, "not_read"),
    ({"last_status": "ok", "content_hash": "abc"}, "read"),
    ({"last_status": "not_modified", "content_hash": "abc"}, "read"),
    ({"last_status": None, "content_hash": "abc"}, "read"),
    ({"last_status": "ok", "content_hash": None}, "not_read"),
    ({"last_status": "gone", "content_hash": "abc"}, "gone"),
    ({"last_status": "robots", "content_hash": None}, "robots"),
    ({"last_status": "blocked", "content_hash": None}, "blocked"),
])
def test_side_states(page, state):
    assert pairs._side_state(page) == state


def test_page_against_page_compares_both_sides_in_any_language(world):
    rival = add_rival(world)
    world.pages["me.example/fr"] = '<html lang="fr"><head><title>Le Café en grains</title><meta name="description" content="Du CAFE en grains"></head><body><main><h1>Café en grains</h1><h2>Nos origines</h2><p>Texte sur le café en grains.</p></main></body></html>'
    world.pages["rival.example/fr"] = '<html lang="fr"><head><title>Autre page</title></head><body><main><h1>Boutique</h1><h2>Torréfaction artisanale</h2><p>Rien à voir.</p></main></body></html>'
    seed(world.engine, world.own, "café en grains", ["me.example/fr", "rival.example/fr"])
    pair = pairs.create_pair(world.engine, world.own, rival, "me.example/fr", "rival.example/fr")
    assert pair["mine"]["state"] == "not_read" and pair["my_state"] == "not_read"
    world.drain("crawl")
    detail = pairs.pair_detail(world.engine, pair["id"])
    assert detail["my_state"] == "read" and detail["their_state"] == "read" and detail["shared_keywords"] == 1
    row = detail["keywords"][0]
    assert (row["my_position"], row["their_position"], row["ai_state"], row["ai_cites_me"], row["ai_cites_them"]) == (1, 2, NOT_CAPTURED, None, None)
    assert row["mine"]["title"] is True and row["mine"]["h1"] is True and row["mine"]["meta"] is True and row["mine"]["body"] is True
    assert row["theirs"]["title"] is False and row["theirs"]["body"] is False
    assert {"term": "torrefaction", "headings": 1} in detail["terms_they_use"] and "Torréfaction artisanale" in detail["headings_only_theirs"]
    assert "_text" not in detail["mine"]
    # A page answering 304 was read before, so it still counts as read.
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE pages SET last_status = 'not_modified' WHERE url = 'https://me.example/fr'"))
    assert pairs.pair_detail(world.engine, pair["id"])["my_state"] == "read"


def test_a_page_redirecting_to_another_site_is_not_read(world):
    rival = add_rival(world)
    world.pages["rival.example/away"] = (301, "https://elsewhere.example/landing")
    world.pages["elsewhere.example/landing"] = "<html><title>Not theirs</title></html>"
    pair = pairs.create_pair(world.engine, world.own, rival, "https://me.example/a", "https://rival.example/away")
    world.drain("crawl")
    assert not [url for url in world.requests if "elsewhere.example" in url]
    assert pairs.pair_detail(world.engine, pair["id"])["their_state"] == "left_scope"


# ---- profile ----------------------------------------------------------------------------------------

def test_timeline_merges_edits_new_and_removed_pages_and_ranking_moves(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a", "x.example/1", "y.example/2", "me.example/m"])
    seed(world.engine, world.own, "k1", ["x.example/1", "y.example/2", "rival.example/a", "me.example/m"])
    domain = rows(world.engine, "SELECT id FROM domains")
    with world.engine.begin() as conn:
        domain_id = conn.execute(text("INSERT INTO domains (host) VALUES ('rival.example')")).lastrowid if not domain else domain[0]["id"]
        page_id = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash) VALUES (:d, 'https://rival.example/p', 'h1')"), {"d": domain_id}).lastrowid
        for kind in ("title", "new_page", "page_gone"):
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value) VALUES (:p, :d, :k, 'old', 'new')"), {"p": page_id, "d": domain_id, "k": kind})
    timeline = profile.profile(world.engine, world.own, rival)["timeline"]
    assert {"title", "new_page", "page_gone", "rank_down"} <= {e["kind"] for e in timeline}
    move = next(e for e in timeline if e["kind"] == "rank_down")
    assert (move["from"], move["to"], move["keyword"], move["tool"]) == (1, 3, "k1", "SerpApi")
    assert move["keyword_id"] == {r["keyword"]: r["id"] for r in rows(world.engine, "SELECT id, keyword FROM keywords")}["k1"]
    assert [e["at"] for e in timeline] == sorted((e["at"] for e in timeline), reverse=True)


@pytest.mark.parametrize("other", [{"tool": "Other Tool"}, {"location": "DE"}, {"depth": 100}])
def test_a_change_of_tool_location_or_depth_is_never_a_ranking_move(world, other):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a"], ai=PRESENT, cited=["rival.example/a"])
    seed(world.engine, world.own, "k1", ["x.example/1", "y.example/2", "z.example/3", "rival.example/a"], ai=ABSENT, **other)
    answer = profile.profile(world.engine, world.own, rival)
    assert [e for e in answer["timeline"] if e["kind"].startswith(("rank_", "ai_"))] == []


def test_moves_compare_each_tool_with_itself_across_a_switch(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a"])
    seed(world.engine, world.own, "k1", ["x.example/1", "rival.example/a"], tool="Other Tool")
    seed(world.engine, world.own, "k1", ["x.example/1", "y.example/2", "rival.example/a"])
    moves = [e for e in profile.profile(world.engine, world.own, rival)["timeline"] if e["kind"].startswith("rank_")]
    assert [(m["kind"], m["from"], m["to"], m["tool"]) for m in moves] == [("rank_down", 1, 3, "SerpApi")]


def test_small_moves_are_left_out_and_appearing_or_dropping_out_are_events(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["x.example/1", "rival.example/a"])
    seed(world.engine, world.own, "k1", ["rival.example/a", "x.example/1"])
    seed(world.engine, world.own, "k1", ["x.example/1"])
    seed(world.engine, world.own, "k1", ["rival.example/b"])
    kinds = [e["kind"] for e in profile.profile(world.engine, world.own, rival)["timeline"] if e["kind"].startswith("rank_")]
    assert sorted(kinds) == ["rank_lost", "rank_new"]


def test_past_and_current_keywords_and_how_we_compare(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "now shared", ["rival.example/a", "me.example/m"])
    seed(world.engine, world.own, "i lead", ["me.example/m", "rival.example/a"])
    seed(world.engine, world.own, "only them", ["rival.example/b"])
    seed(world.engine, world.own, "only me", ["me.example/m"])
    seed(world.engine, world.own, "used to", ["rival.example/old"])
    seed(world.engine, world.own, "used to", ["x.example/1"])
    answer = profile.profile(world.engine, world.own, rival)
    status = {row["keyword"]: row["status"] for row in answer["keywords"]}
    assert status == {"now shared": "shared", "i lead": "shared", "only them": "theirs_only", "only me": "mine_only"}
    assert [(p["keyword"], p["last_position"], p["last_url"]) for p in answer["past_keywords"]] == [("used to", 1, "https://rival.example/old")]
    ids = {r["keyword"]: r["id"] for r in rows(world.engine, "SELECT id, keyword FROM keywords")}
    assert all(row["keyword_id"] == ids[row["keyword"]] for row in answer["keywords"] + answer["past_keywords"])
    compare = answer["compare"]
    assert (compare["shared"], compare["they_ahead"], compare["i_ahead"], compare["theirs_only"], compare["mine_only"], compare["my_average"], compare["their_average"]) == (2, 1, 1, 1, 1, 1.5, 1.5)
    overview = profile.overview(world.engine, world.own)[0]
    assert (overview["shared"], overview["they_ahead"], overview["i_ahead"], overview["theirs_only"]) == (2, 1, 1, 1)


def test_another_tool_not_showing_them_does_not_make_a_keyword_past(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k1", ["rival.example/a"])
    seed(world.engine, world.own, "k1", ["x.example/1"], tool="Other Tool")
    assert profile.profile(world.engine, world.own, rival)["past_keywords"] == []


def test_a_competitor_not_on_this_site_is_refused(world):
    stranger = links.add_site(world.engine, "https://stranger.example/", "competitor", is_allowed=ALLOW)["id"]
    with pytest.raises(NotFound):
        profile.profile(world.engine, world.own, stranger)
    with pytest.raises(NotFound):
        suggest.remove_competitor(world.engine, world.own, stranger)
    with pytest.raises(NotFound):
        gaps.import_referrers(world.engine, world.own, stranger, b"URL\nhttps://a.example/\n", "x.csv")


# ---- link gaps --------------------------------------------------------------------------------------

REFERRERS = (
    b"Source url,Authority Score,Toxic Score\n"
    b"https://good.example/post,60,3\n"
    b"https://blog.good.example/other,70,1\n"
    b"https://spam.example/x,10,88\n"
    b"https://unknown.example/y,20,\n"
    b"https://me.example/self,40,1\n"
    b"https://rival.example/own-link,40,1\n"
    b"https://already.example/z,40,1\n"
    b"https://found.example/z,40,1\n"
    b"https://lost.example/z,40,1\n"
)


def gap_world(world):
    rival = add_rival(world)
    report = gaps.import_referrers(world.engine, world.own, rival, REFERRERS, "links.csv")
    assert report["removed_spam"] == 1 and report["unknown_spam"] == 1 and report["source_label"] == "SEMrush"
    gaps.log_backlink(world.engine, world.own, "https://already.example/page", "live")
    gaps.log_backlink(world.engine, world.own, "found.example", "found")
    gaps.log_backlink(world.engine, world.own, "https://lost.example/page", "lost")
    return rival


def gap_map(world):
    return {g["domain"]: g for g in gaps.link_gaps(world.engine, world.own)["gaps"]}


def test_gaps_leave_out_what_links_to_me_my_own_and_the_competitor_itself(world):
    gap_world(world)
    answer = gaps.link_gaps(world.engine, world.own)
    assert sorted(g["domain"] for g in answer["gaps"]) == ["good.example", "lost.example", "unknown.example"]
    assert answer["already_linking"] == 2 and answer["competitors"][0]["has_data"] is True


def test_gaps_flag_lost_links_keep_unknown_spam_unknown_and_keep_the_best_authority(world):
    gap_world(world)
    found = gap_map(world)
    assert found["lost.example"]["lost_link"] is True and found["good.example"]["lost_link"] is False
    assert found["unknown.example"]["spam_score"] is None and found["good.example"]["spam_score"] == 1
    assert found["good.example"]["authority"] == 70 and found["good.example"]["authority_label"] == "Authority Score (SEMrush)"


def test_a_live_link_beats_an_older_lost_one(world):
    gap_world(world)
    gaps.log_backlink(world.engine, world.own, "https://lost.example/new", "live")
    assert "lost.example" not in gap_map(world)


def test_a_domain_linking_to_two_competitors_ranks_first(world):
    gap_world(world)
    second = add_rival(world, "rival-two.example")
    gaps.import_referrers(world.engine, world.own, second, b"Source url,Toxic Score\nhttps://unknown.example/two,2\nhttps://rival.example/link,2\n", "two.csv")
    answer = gaps.link_gaps(world.engine, world.own)["gaps"]
    assert answer[0]["domain"] == "unknown.example" and answer[0]["competitor_count"] == 2 and answer[0]["spam_score"] == 2
    assert next(g for g in answer if g["domain"] == "rival.example")["is_competitor"] is True


def test_a_csv_with_only_a_domain_column_works(world):
    rival = add_rival(world)
    report = gaps.import_referrers(world.engine, world.own, rival, b"Domain\nplain.example\nwww.second.example\n", "domains.csv")
    assert report["domains"] == 2 and report["unknown_spam"] == 2
    assert sorted(gap_map(world)) == ["plain.example", "second.example"]


def test_a_file_with_no_usable_column_says_so(world):
    rival = add_rival(world)
    from seo.backlinks.cleaner import CleanerError

    with pytest.raises(CleanerError):
        gaps.import_referrers(world.engine, world.own, rival, b"Foo,Bar\n1,2\n", "x.csv")
    with pytest.raises(CleanerError):
        gaps.import_referrers(world.engine, world.own, rival, b"URL\nhttps://a.example/\n", "x.xlsx")


def test_adding_to_consideration_never_makes_a_backlink_and_logging_one_removes_it(world):
    gap_world(world)
    before = scalar(world.engine, "SELECT COUNT(*) FROM backlinks")
    added = gaps.add_to_prospects(world.engine, world.own, ["good.example", "not-a-gap.example", "already.example"])
    assert added == {"added": ["good.example"], "skipped": ["not-a-gap.example", "already.example"]}
    assert scalar(world.engine, "SELECT COUNT(*) FROM backlinks") == before
    prospect = gaps.list_prospects(world.engine, world.own)[0]
    assert (prospect["domain"], prospect["source_kind"], prospect["authority"]) == ("good.example", "link_gap", 70)
    assert gap_map(world)["good.example"]["in_consideration"] is True
    assert gaps.add_to_prospects(world.engine, world.own, ["good.example"]) == {"added": [], "skipped": ["good.example"]}
    gaps.log_backlink(world.engine, world.own, "https://blog.good.example/mention", "live")
    assert "good.example" not in gap_map(world)
    assert gaps.list_prospects(world.engine, world.own) == []


def test_logging_a_lost_link_keeps_the_prospect(world):
    gap_world(world)
    gaps.add_to_prospects(world.engine, world.own, ["unknown.example"])
    gaps.log_backlink(world.engine, world.own, "https://unknown.example/old", "lost")
    assert [p["domain"] for p in gaps.list_prospects(world.engine, world.own)] == ["unknown.example"]
    assert gap_map(world)["unknown.example"]["lost_link"] is True


@pytest.mark.parametrize("url, status", [("not a url", "live"), ("", "live"), (None, "live"), (123, "live"), ("https://ok.example/", "maybe")])
def test_bad_backlinks_are_refused(world, url, status):
    with pytest.raises(Refused):
        gaps.log_backlink(world.engine, world.own, url, status)
    assert scalar(world.engine, "SELECT COUNT(*) FROM backlinks") == 0


# ---- AI Overview watch ------------------------------------------------------------------------------

def test_ai_states_and_who_is_cited(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "cited", ["me.example/a"], ai=PRESENT, cited=["me.example/a", "rival.example/b", "third.example/c"])
    seed(world.engine, world.own, "not cited", ["me.example/a"], ai=PRESENT, cited=["third.example/c"])
    seed(world.engine, world.own, "no overview", ["me.example/a"], ai=ABSENT)
    seed(world.engine, world.own, "no data", ["me.example/a"], ai=NOT_CAPTURED)
    seed(world.engine, world.own, "other engine", ["me.example/a"], tool="DuckDuckGo direct", search_engine="duckduckgo")
    answer = ai_watch.watch(world.engine, world.own)
    found = {r["keyword"]: r for r in answer["keywords"]}
    assert found["cited"]["state"] == PRESENT and found["cited"]["cited_me"] is True and found["cited"]["competitors_cited"] == [{"id": rival, "host": "rival.example"}]
    assert found["cited"]["my_cited_urls"] == ["https://me.example/a"] and found["cited"]["others_cited"] == ["third.example"]
    assert found["not cited"]["cited_me"] is False
    assert found["no overview"]["state"] == ABSENT and found["no overview"]["cited_me"] is False
    for keyword in ("no data", "other engine"):
        assert found[keyword]["state"] == NOT_CAPTURED and found[keyword]["cited_me"] is None  # never a "no"
    summary = answer["summary"]
    assert (summary["tracked"], summary["captured"], summary["not_captured"], summary["with_overview"], summary["cited_me"]) == (5, 3, 2, 2, 1)
    assert summary["rivals"] == [{"host": "rival.example", "keywords": 1}]
    ids = {r["keyword"]: r["id"] for r in rows(world.engine, "SELECT id, keyword FROM keywords")}
    assert all(r["keyword_id"] == ids[r["keyword"]] for r in answer["keywords"])


def test_changes_compare_like_with_like_and_skip_what_was_not_captured(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "k", ["me.example/a"], ai=ABSENT)
    seed(world.engine, world.own, "k", ["me.example/a"], ai=NOT_CAPTURED)
    seed(world.engine, world.own, "k", ["me.example/a"], ai=PRESENT, cited=["me.example/a", "rival.example/b"])
    seed(world.engine, world.own, "k", ["me.example/a"], ai=PRESENT, cited=["rival.example/b"])
    seed(world.engine, world.own, "switched", ["me.example/a"], ai=ABSENT)
    seed(world.engine, world.own, "switched", ["me.example/a"], ai=PRESENT, cited=["me.example/a"], tool="Other Tool")
    changes = ai_watch.watch(world.engine, world.own)["changes"]
    kinds = sorted((c["keyword"], c["kind"]) for c in changes)
    assert kinds == [("k", "me_cited"), ("k", "me_dropped"), ("k", "overview_appeared"), ("k", "rival_cited")]
    assert next(c for c in changes if c["kind"] == "rival_cited")["competitor_id"] == rival
    ids = {r["keyword"]: r["id"] for r in rows(world.engine, "SELECT id, keyword FROM keywords")}
    assert all(c["keyword_id"] == ids[c["keyword"]] for c in changes)


def test_trend_counts_by_day_without_what_was_not_captured(world):
    seed(world.engine, world.own, "a", ["me.example/a"], ai=PRESENT, cited=["me.example/a"])
    seed(world.engine, world.own, "b", ["me.example/a"], ai=ABSENT)
    seed(world.engine, world.own, "c", ["me.example/a"], ai=NOT_CAPTURED)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = '2026-10-01 10:00:00' WHERE id = 1"))
    trend = ai_watch.watch(world.engine, world.own)["trend"]
    assert trend[0] == {"day": "2026-10-01", "checked": 1, "overviews": 1, "cited_me": 1}
    assert (trend[1]["checked"], trend[1]["overviews"], trend[1]["cited_me"]) == (1, 0, 0)


def test_ai_watch_spends_nothing(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    seed(world.engine, world.own, "a", ["me.example/a"], ai=ABSENT)
    ai_watch.watch(world.engine, world.own)
    world.drain()
    assert tool.calls == [] and scalar(world.engine, "SELECT COUNT(*) FROM jobs") == 0


# ---- notes ----------------------------------------------------------------------------------------------

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 40


def _upload(world, note_id, payload, name):
    return world.client.post(f"/api/notes/{note_id}/files", data={"file": (io.BytesIO(payload), name)}, content_type="multipart/form-data")


@pytest.fixture
def file_store(monkeypatch, tmp_path):
    monkeypatch.setenv("SEO_NOTE_FILES", str(tmp_path / "files"))
    return tmp_path / "files"


def test_a_note_can_be_only_an_image_and_it_is_shown_in_the_browser(world, file_store):
    note = notes.create(world.engine, "all", "")
    assert notes.list_notes(world.engine) == []  # empty, so not a note yet
    reply = _upload(world, note["id"], PNG_BYTES, "screenshot.png")
    assert reply.status_code == 201
    saved = reply.get_json()["files"]
    assert [(f["name"], f["size"], f["is_image"]) for f in saved] == [("screenshot.png", len(PNG_BYTES), True)]
    assert [n["id"] for n in notes.list_notes(world.engine)] == [note["id"]]
    shown = world.client.get(f"/api/note-files/{saved[0]['id']}")
    assert shown.data == PNG_BYTES and shown.mimetype == "image/png"
    assert "attachment" not in shown.headers.get("Content-Disposition", "")
    assert "sandbox" in shown.headers["Content-Security-Policy"]


@pytest.mark.parametrize("payload, name", [(b"<script>alert(1)</script>", "looks-like-a-photo.png"), (b"<svg onload='alert(1)'/>", "logo.svg"), (b"<html><script>x</script></html>", "page.html")])
def test_anything_that_is_not_really_an_image_only_downloads(world, file_store, payload, name):
    note = notes.create(world.engine, "all", "Files")
    saved = _upload(world, note["id"], payload, name).get_json()["files"][0]
    assert saved["is_image"] is False
    sent = world.client.get(f"/api/note-files/{saved['id']}")
    assert sent.mimetype == "application/octet-stream"
    assert sent.headers["Content-Disposition"].startswith("attachment")
    assert sent.data == payload


def test_any_kind_of_file_keeps_its_name_but_never_chooses_where_it_is_stored(world, file_store):
    note = notes.create(world.engine, "all", "Files")
    saved = _upload(world, note["id"], b"a,b\n1,2\n", "../../etc/rapport été.csv").get_json()["files"][0]
    assert saved["name"] == "rapport été.csv"
    stored = list(file_store.iterdir())
    assert len(stored) == 1 and re.fullmatch(r"[0-9a-f]{32}", stored[0].name)


def test_a_file_too_large_or_empty_is_refused_and_nothing_is_left_behind(world, file_store, monkeypatch):
    monkeypatch.setattr(notes, "MAX_FILE_BYTES", 10)
    note = notes.create(world.engine, "all", "Files")
    too_big = _upload(world, note["id"], b"x" * 11, "big.bin")
    assert too_big.status_code == 400 and "25 MB" in too_big.get_json()["error"]
    assert _upload(world, note["id"], b"", "empty.bin").status_code == 400
    assert notes.list_notes(world.engine)[0]["files"] == []
    assert list(file_store.iterdir()) == []


def test_a_file_can_be_deleted_and_brought_back(world, file_store):
    note = notes.create(world.engine, "all", "")
    saved = _upload(world, note["id"], PNG_BYTES, "a.png").get_json()["files"][0]
    assert world.client.delete(f"/api/note-files/{saved['id']}").status_code == 200
    assert world.client.get(f"/api/note-files/{saved['id']}").status_code == 404
    assert notes.list_notes(world.engine) == []  # with its only file gone, the note is empty again
    assert world.client.post(f"/api/note-files/{saved['id']}/restore").get_json()["files"][0]["id"] == saved["id"]
    assert world.client.get(f"/api/note-files/{saved['id']}").data == PNG_BYTES


def test_a_note_with_files_can_be_deleted_and_restored_with_them(world, file_store):
    note = notes.create(world.engine, "all", "With a file")
    _upload(world, note["id"], PNG_BYTES, "a.png")
    notes.delete(world.engine, note["id"])
    assert notes.list_notes(world.engine) == []
    assert len(notes.restore(world.engine, note["id"])["files"]) == 1


def test_a_file_needs_a_note_that_exists(world, file_store):
    assert _upload(world, 999, PNG_BYTES, "a.png").status_code == 404
    assert world.client.get("/api/note-files/999").status_code == 404
    assert not list(file_store.glob("*"))


def test_notes_on_all_one_competitor_and_a_page(world):
    rival = add_rival(world)
    every = notes.create(world.engine, "all", "On all of them", world.own)
    one = notes.create(world.engine, "competitor", "On this one", world.own, rival)
    page = notes.create(world.engine, "page", "On this page", world.own, rival, "rival.example/p?utm_source=x")
    assert page["page_url"] == "https://rival.example/p" and one["competitor"] == "rival.example" and every["competitor_id"] is None
    assert [n["id"] for n in notes.list_notes(world.engine, "all")] == [every["id"]]
    assert sorted(n["id"] for n in notes.list_notes(world.engine, competitor_id=rival)) == [one["id"], page["id"]]
    for spelling in ("https://rival.example/p", "https://rival.example/p?utm_campaign=y", "rival.example/p"):
        assert [n["id"] for n in notes.list_notes(world.engine, page_url=spelling)] == [page["id"]]


def test_notes_on_a_screen_and_on_a_whole_website(world):
    rival = add_rival(world)
    screen = notes.create(world.engine, "screen", "Ask the mediator", world.own, rival, screen="backlinks")
    site = notes.create(world.engine, "site", "Redesign in March", world.own, rival)
    everywhere = notes.create(world.engine, "site", "For all my sites")
    assert screen["screen"] == "backlinks" and screen["competitor_id"] is None and site["competitor_id"] is None and site["screen"] is None
    assert [n["id"] for n in notes.list_notes(world.engine, "screen", screen="backlinks", site_id=world.own)] == [screen["id"]]
    assert notes.list_notes(world.engine, "screen", screen="keywords") == []
    assert sorted(n["id"] for n in notes.list_notes(world.engine, "site", site_id=world.own)) == sorted([site["id"], everywhere["id"]])
    for wrong in ({"screen": None}, {"screen": "nowhere"}):
        with pytest.raises(Refused):
            notes.create(world.engine, "screen", "x", world.own, **wrong)
    answer = world.client.post("/api/notes", json={"scope": "screen", "body": "Through the API", "site_id": world.own, "screen": "tasks"})
    assert answer.status_code == 201 and answer.get_json()["screen"] == "tasks"
    assert [n["body"] for n in world.client.get(f"/api/notes?scope=screen&screen=tasks&site_id={world.own}").get_json()["notes"]] == ["Through the API"]


def test_notes_on_a_keyword_whatever_its_case_and_spacing(world):
    rival = add_rival(world)
    mine = notes.create(world.engine, "keyword", "Rank this one first", world.own, rival, keyword="  Open  a Shop in Seville ")
    everywhere = notes.create(world.engine, "keyword", "On every site", keyword="open a shop in seville")
    other = notes.create(world.engine, "keyword", "Another", world.own, keyword="tax return")
    assert mine["keyword"] == "Open a Shop in Seville" and mine["competitor_id"] is None
    assert sorted(n["id"] for n in notes.list_notes(world.engine, "keyword", keyword="OPEN A SHOP IN SEVILLE", site_id=world.own)) == sorted([mine["id"], everywhere["id"]])
    assert [n["id"] for n in notes.list_notes(world.engine, "keyword", keyword="tax return")] == [other["id"]]
    for wrong in (None, "", "   ", 5, "x" * 401):
        with pytest.raises(Refused):
            notes.create(world.engine, "keyword", "x", world.own, keyword=wrong)
    answer = world.client.post("/api/notes", json={"scope": "keyword", "body": "Through the API", "site_id": world.own, "keyword": "Company Setup"})
    assert answer.status_code == 201 and answer.get_json()["keyword"] == "Company Setup"
    assert [n["body"] for n in world.client.get(f"/api/notes?scope=keyword&keyword=company%20setup&site_id={world.own}").get_json()["notes"]] == ["Through the API"]


def test_note_options_list_my_pages_and_keywords(world):
    from seo.serp import store
    with world.engine.begin() as conn:
        kid = conn.execute(text("INSERT INTO keywords (keyword, keyword_hash) VALUES ('company setup', :h)"), {"h": store.keyword_hash("company setup")}).lastrowid
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": world.own, "k": kid})
    one = world.client.get(f"/api/notes/options?site_id={world.own}").get_json()
    assert one["keywords"] == ["company setup"] and isinstance(one["pages"], list)
    assert world.client.get("/api/notes/options").get_json()["keywords"] == ["company setup"]
    rival = add_rival(world)
    assert world.client.get(f"/api/notes/options?site_id={rival}").status_code == 400  # a competitor isn't one of my sites


def test_notes_on_a_day_a_linking_website_and_a_task(world):
    from seo.tasks import service as tasks

    day = notes.create(world.engine, "date", "Changed every title", world.own, day="2026-10-03")
    everywhere = notes.create(world.engine, "date", "Google update", day="2026-10-03")
    assert day["day"] == "2026-10-03"
    assert sorted(n["id"] for n in notes.list_notes(world.engine, "date", day="2026-10-03", site_id=world.own)) == sorted([day["id"], everywhere["id"]])
    for wrong in (None, "", "03/10/2026", "1999-12-31", "2099-01-01"):
        with pytest.raises(Refused):
            notes.create(world.engine, "date", "x", world.own, day=wrong)

    seller = notes.create(world.engine, "domain", "Asked a price: 80 euros", world.own, domain="https://WWW.Blog-Seller.example/write-for-us")
    assert seller["domain"] == "blog-seller.example"
    assert [n["id"] for n in notes.list_notes(world.engine, "domain", domain="blog-seller.example")] == [seller["id"]]
    for wrong in (None, "", "not a site", "localhost"):
        with pytest.raises(Refused):
            notes.create(world.engine, "domain", "x", world.own, domain=wrong)

    task = tasks.create(world.engine, {"title": "Rewrite the pricing page", "site_id": world.own})
    on_task = notes.create(world.engine, "task", "Wait for the new prices", None, task_id=task["id"])
    assert on_task["task"] == "Rewrite the pricing page" and on_task["site_id"] == world.own  # a task's note goes with the task's site
    assert [n["id"] for n in notes.list_notes(world.engine, task_id=task["id"])] == [on_task["id"]]
    with pytest.raises(Refused):
        notes.create(world.engine, "task", "x", world.own, task_id="1")
    with pytest.raises(NotFound):
        notes.create(world.engine, "task", "x", world.own, task_id=999999)

    answer = world.client.post("/api/notes", json={"scope": "domain", "body": "Through the API", "domain": "links.example"})
    assert answer.status_code == 201 and answer.get_json()["domain"] == "links.example"
    assert [n["body"] for n in world.client.get(f"/api/notes?task_id={task['id']}").get_json()["notes"]] == ["Wait for the new prices"]


def test_a_note_on_a_group_of_pages_shows_on_every_page_in_it(world):
    group = notes.create(world.engine, "section", "Every guide needs a date", world.own, page_url="shop-one.example/blog/guides")
    assert group["page_url"] == "https://shop-one.example/blog/guides/"
    page = notes.create(world.engine, "page", "This one is old", world.own, page_url="https://shop-one.example/blog/guides/brew")
    inside = notes.list_notes(world.engine, page_url="https://shop-one.example/blog/guides/brew")
    assert sorted(n["id"] for n in inside) == sorted([group["id"], page["id"]])
    assert notes.list_notes(world.engine, page_url="https://shop-one.example/blog/other") == []
    assert notes.list_notes(world.engine, page_url="https://shop-one.example/blog/GUIDES/brew") == []  # addresses are case-sensitive
    assert [n["id"] for n in notes.list_notes(world.engine, "section", page_url="https://shop-one.example/blog/guides/")] == [group["id"]]
    with pytest.raises(Refused):
        notes.create(world.engine, "section", "x", world.own, page_url="https://shop-one.example/")  # that's the whole website


def test_note_options_list_folders_linking_websites_and_tasks(world):
    from seo.tasks import service as tasks

    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO backlinks (site_id, source_url, domain) VALUES (:s, 'https://links.example/a', 'links.example')"), {"s": world.own})
    task = tasks.create(world.engine, {"title": "Ask for a link", "site_id": world.own})
    one = world.client.get(f"/api/notes/options?site_id={world.own}").get_json()
    assert "links.example" in one["domains"]
    assert [t["id"] for t in one["tasks"]] == [task["id"]]
    assert one["tasks"][0]["site_host"] == task["site_host"] and task["site_host"]  # health tasks share titles across sites: the picker tells them apart by site
    assert notes._sections([{"url": "https://shop-one.example/blog/guides/brew"}, {"url": "https://shop-one.example/blog/news"}]) == [
        {"url": "https://shop-one.example/blog/", "pages": 2}, {"url": "https://shop-one.example/blog/guides/", "pages": 1},
    ]


def test_notes_on_a_day_are_markers_on_the_overview_chart(world):
    from seo.metrics import search
    from seo.metrics.service import Scope

    notes.create(world.engine, "date", "Changed every title\nand the menus", world.own, day="2026-10-03")
    notes.create(world.engine, "date", "", world.own, day="2026-10-04")  # empty: not a note yet
    marks = search.markers(Scope(world.engine, world.own, "2026-10-01", "2026-10-10"))
    assert [(m["kind"], m["day"], m["text"]) for m in marks] == [("dated", "2026-10-03", "Changed every title")]


def test_the_database_refuses_a_scope_it_does_not_know(world):
    from sqlalchemy.exc import DBAPIError
    with pytest.raises(DBAPIError), world.engine.begin() as conn:
        conn.execute(text("INSERT INTO notes (scope, body) VALUES ('bogus', 'x')"))


def test_a_note_on_an_accented_page_is_found_in_either_spelling(world):
    note = notes.create(world.engine, "page", "Seite", None, None, f"https://{ACCENTED}/café")
    assert [n["id"] for n in notes.list_notes(world.engine, page_url=f"https://{ASCII}/caf%C3%A9")] == [note["id"]]


def test_note_update_soft_delete_and_restore(world):
    note = notes.create(world.engine, "all", "First")
    assert notes.update(world.engine, note["id"], "Second")["body"] == "Second"
    notes.delete(world.engine, note["id"])
    assert notes.list_notes(world.engine) == []
    assert scalar(world.engine, "SELECT body FROM notes WHERE id = :i", i=note["id"]) == "Second"  # the text is kept
    restored = notes.restore(world.engine, note["id"])
    assert restored["body"] == "Second" and restored["deleted_at"] is None
    assert [n["id"] for n in notes.list_notes(world.engine)] == [note["id"]]


def test_very_long_notes_and_arabic_are_kept_whole(world):
    long_body, arabic = "و" * 1_500_000, "ملاحظة عن المنافس: يغيّر الأسعار كل شهر 🙂"
    assert len(notes.create(world.engine, "all", long_body)["body"]) == 1_500_000
    assert notes.create(world.engine, "all", arabic)["body"] == arabic
    with pytest.raises(Refused):
        notes.create(world.engine, "all", "x" * (notes.MAX_BYTES + 1))


@pytest.mark.parametrize("args", [
    ("everything", "text"), ("all", None), ("all", 5), ("competitor", "text"), ("page", "text"), ("page", "text", None, None, 123), ("competitor", "text", None, "nope"),
])
def test_bad_notes_are_refused(world, args):
    with pytest.raises(Refused):
        notes.create(world.engine, *args)
    assert scalar(world.engine, "SELECT COUNT(*) FROM notes") == 0


def test_notes_refuse_unknown_ids_and_a_competitor_not_on_this_site(world):
    stranger = links.add_site(world.engine, "https://stranger.example/", "competitor", is_allowed=ALLOW)["id"]
    with pytest.raises(NotFound):
        notes.create(world.engine, "competitor", "text", None, 999999)
    with pytest.raises(NotFound):
        notes.create(world.engine, "competitor", "text", world.own, stranger)
    with pytest.raises(NotFound):
        notes.create(world.engine, "all", "text", 999999)
    for call in (lambda: notes.update(world.engine, 999999, "x"), lambda: notes.delete(world.engine, 999999), lambda: notes.restore(world.engine, 999999)):
        with pytest.raises(NotFound):
            call()


# ---- watching a competitor's site --------------------------------------------------------------------

def page_html(title, words="some words on this page", extra=""):
    return f'<html lang="en"><head><title>{title}</title>{extra}</head><body><main><h1>{title}</h1><p>{words}</p></main></body></html>'


def sitemap_xml(paths, host="rival.example", date="2026-01-01"):
    urls = "".join(f"<url><loc>https://{host}{p}</loc><lastmod>{date}</lastmod></url>" for p in paths)
    return f'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'


def rival_site(world, paths=("/a", "/b")):
    world.pages["rival.example/"] = page_html("Home")
    for path in paths:
        world.pages[f"rival.example{path}"] = page_html(f"Page {path}")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(paths)


def crawl_state(world, rival):
    return rows(world.engine, "SELECT status, baseline_done, pages_read, pages_known, message FROM competitor_crawls WHERE competitor_id = :c", c=rival)[0]


def events(world):
    return sorted((e["kind"], e["url"]) for e in rows(world.engine, "SELECT e.kind, p.url FROM change_events e JOIN pages p ON p.id = e.page_id"))


def age_pages(world, days=20):
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE pages SET last_checked_at = last_checked_at - INTERVAL :d DAY"), {"d": days})


def test_the_first_pass_reports_nothing_as_new(world):
    rival_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    state = crawl_state(world, rival)
    assert state["status"] == "ok" and state["baseline_done"] == 1 and state["pages_read"] == 3 and state["pages_known"] == 3
    assert events(world) == []
    assert budget.used_today(world.engine) == len(world.requests)


def test_after_the_first_pass_new_removed_and_edited_pages_are_events(world):
    rival_site(world, ("/a", "/b", "/c"))
    rival = add_rival(world)
    world.drain("crawl")
    world.pages["rival.example/a"] = page_html("Edited title")
    world.pages["rival.example/new"] = page_html("Brand new")
    world.pages["rival.example/b"] = 404
    del world.pages["rival.example/c"]  # gone, and no longer listed either
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(("/a", "/b", "/new"))
    age_pages(world)
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    found = events(world)
    assert ("new_page", "https://rival.example/new") in found
    assert ("page_gone", "https://rival.example/b") in found and ("page_gone", "https://rival.example/c") in found
    assert ("title", "https://rival.example/a") in found
    timeline = profile.profile(world.engine, world.own, rival)["timeline"]
    assert {"new_page", "page_gone", "title"} <= {e["kind"] for e in timeline}
    # The first read found every page, and none of those counts as new: the figure agrees with the timeline.
    assert profile.profile(world.engine, world.own, rival)["compare"]["pages"]["theirs"]["new_pages_30d"] == 1
    # Reading it all again changes nothing, and a removed page is only reported once.
    before = len(events(world))
    age_pages(world)
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    assert len(events(world)) == before


def test_a_newer_sitemap_date_means_read_it_now(world, monkeypatch):
    monkeypatch.setattr(crawl, "FULL_DAILY_PAGES", 1)  # a big site: a small one has every page read daily anyway
    rival_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    age_pages(world, 1)
    world.requests.clear()
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(("/a", "/b"), date="2030-01-01").replace("<lastmod>2030-01-01</lastmod>", "<lastmod>2026-01-01</lastmod>", 1)
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    assert "https://rival.example/b" in world.requests and "https://rival.example/a" not in world.requests


def test_a_page_only_seen_in_search_results_is_read_but_is_not_called_new(world):
    rival_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    world.pages["rival.example/old-page"] = page_html("Old but newly noticed")
    seed(world.engine, world.own, "k", ["rival.example/old-page"])
    age_pages(world, 1)
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    assert "https://rival.example/old-page" in world.requests and events(world) == []


def test_a_site_moving_to_www_is_not_a_whole_new_site(world):
    rival_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(("/a", "/b"), host="www.rival.example")
    age_pages(world, 1)
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    assert events(world) == []


def test_a_site_that_blocks_robots_is_blocked_with_no_page_requests(world):
    world.pages["rival.example/robots.txt"] = "User-agent: *\nDisallow: /\n"
    world.pages["rival.example/"] = page_html("Home")
    rival = add_rival(world)
    world.drain("crawl")
    state = crawl_state(world, rival)
    assert state["status"] == "blocked" and state["baseline_done"] == 0 and state["message"] == "Blocks bots, so edits can't be tracked."
    assert world.requests == ["https://rival.example/robots.txt"]


def test_a_site_answering_403_is_blocked_and_one_that_is_down_is_not_called_blocked(world):
    world.pages["rival.example/"] = 403
    rival = add_rival(world)
    world.drain("crawl")
    assert crawl_state(world, rival)["status"] == "blocked"
    world.pages["rival.example/"] = 500
    suggest.queue_crawl(world.engine, rival)
    world.drain("crawl")
    state = crawl_state(world, rival)
    assert state["status"] == "failed" and "isn't answering" in state["message"]


def test_it_stops_quickly_when_pages_start_blocking_and_the_first_pass_is_not_finished(world):
    paths = [f"/p{i}" for i in range(8)]
    rival_site(world, paths)
    for path in paths:
        world.pages[f"rival.example{path}"] = 403
    world.pages["rival.example/sitemap.xml"] = sitemap_xml(paths)
    rival = add_rival(world)
    world.drain("crawl")
    state = crawl_state(world, rival)
    assert state["status"] == "blocked" and state["baseline_done"] == 0 and state["pages_read"] == crawl.STOP_AFTER_FAILURES


def test_a_slow_down_answer_stops_the_run_and_the_first_pass_is_not_finished(world):
    rival_site(world)
    world.pages["rival.example/a"] = 429
    rival = add_rival(world)
    world.drain("crawl")
    state = crawl_state(world, rival)
    assert state["baseline_done"] == 0 and "slow down" in state["message"]


def test_rss_links_are_found_and_off_site_addresses_are_never_read(world):
    feed = '<link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="alternate" type="application/rss+xml" href="https://feeds.elsewhere.example/x.xml">'
    world.pages["rival.example/"] = page_html("Home", extra=feed)
    world.pages["rival.example/post-1"] = page_html("Post")
    world.pages["rival.example/feed.xml"] = (
        '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>https://rival.example/</link>'
        "<item><link>https://rival.example/post-1</link></item><item><link>https://other.example/not-theirs</link></item></channel></rss>"
    )
    rival = add_rival(world)
    world.drain("crawl")
    assert crawl_state(world, rival)["status"] == "ok"
    assert "https://rival.example/post-1" in world.requests
    assert not [url for url in world.requests if "other.example" in url or "elsewhere.example" in url]


def test_parse_feed_reads_rss_and_atom():
    rss = b'<rss><channel><link>https://s.example/</link><item><title>a</title><link>https://s.example/1</link></item></channel></rss>'
    atom = b'<feed xmlns="http://www.w3.org/2005/Atom"><link rel="self" href="https://s.example/f"/><entry><link rel="alternate" href="https://s.example/2"/></entry></feed>'
    assert crawl.parse_feed(rss) == ["https://s.example/1"]
    assert crawl.parse_feed(atom) == ["https://s.example/2"]
    assert crawl.parse_feed(b"not xml") == []


def test_no_sitemap_follows_the_start_pages_own_links_and_stays_on_the_site(world):
    world.pages["rival.example/"] = '<html><body><a href="/one">o</a><a href="https://blog.rival.example/two">t</a><a href="https://far.example/x">f</a></body></html>'
    world.pages["rival.example/one"] = page_html("One")
    world.pages["blog.rival.example/two"] = page_html("Two")
    add_rival(world)
    world.drain("crawl")
    assert "https://rival.example/one" in world.requests and "https://blog.rival.example/two" in world.requests
    assert not [url for url in world.requests if "far.example" in url]


def test_an_exhausted_budget_sends_nothing_and_finishes_nothing(world):
    rival_site(world)
    budget.charge(world.engine, budget.DAILY_CRAWL_REQUESTS)
    rival = add_rival(world)
    world.drain("crawl")
    state = crawl_state(world, rival)
    assert world.requests == [] and state["baseline_done"] == 0 and "budget" in state["message"]


def test_a_budget_running_out_midway_leaves_the_first_pass_unfinished(world, monkeypatch):
    rival_site(world, [f"/p{i}" for i in range(5)])
    rival = add_rival(world)
    answers = iter([True, True, False])
    monkeypatch.setattr(crawl.budget, "has_room", lambda engine, limit=0: next(answers, False))
    world.drain("crawl")
    state = crawl_state(world, rival)
    assert state["baseline_done"] == 0 and state["pages_read"] == 1 and "budget" in state["message"]


def run_jobs_one_at_a_time(world):
    done = 0
    while True:
        claimed = queue.claim(world.engine, "crawl", "test")
        if not claimed:
            return done
        crawl.run_crawl(claimed[0], world.engine)
        queue.complete(world.engine, claimed[0].id, "test")
        done += 1


def test_a_large_site_stops_each_chunk_and_queues_itself_with_a_new_key(world, monkeypatch):
    monkeypatch.setattr(crawl, "CHUNK_SECONDS", 0)  # every job gives the lane back after one page
    rival_site(world, ("/a", "/b", "/c"))
    rival = add_rival(world)
    claimed = queue.claim(world.engine, "crawl", "test")[0]
    crawl.run_crawl(claimed, world.engine)
    state = crawl_state(world, rival)
    assert state["status"] == "running" and state["baseline_done"] == 0 and state["pages_read"] == 1
    assert rows(world.engine, "SELECT dedupe_key FROM jobs WHERE status = 'queued' AND kind = 'competitors.crawl'") == [{"dedupe_key": f"competitor:{rival}:part:1"}]
    # Asking again while it runs doesn't start a second read.
    queue.complete(world.engine, claimed.id, "test")
    sent = len(world.requests)
    suggest.queue_crawl(world.engine, rival)
    jobs = run_jobs_one_at_a_time(world)
    assert jobs >= 4
    state = crawl_state(world, rival)
    assert state["status"] == "ok" and state["baseline_done"] == 1 and state["pages_read"] == 4
    assert events(world) == []
    assert len([url for url in world.requests[sent:] if url == "https://rival.example/sitemap.xml"]) == 0  # no second look at the sitemap


def test_pages_per_day_is_per_day_not_per_chunk_and_the_first_pass_takes_as_long_as_it_takes(world, monkeypatch):
    monkeypatch.setattr(crawl, "PAGES_PER_DAY", 2)
    monkeypatch.setattr(crawl, "CHUNK_SECONDS", 0)
    rival_site(world, ("/a", "/b", "/c", "/d"))  # five pages with the start page
    rival = add_rival(world)
    run_jobs_one_at_a_time(world)
    read = lambda: scalar(world.engine, "SELECT COUNT(*) FROM pages WHERE content_hash IS NOT NULL")  # noqa: E731
    assert read() == 2
    state = crawl_state(world, rival)
    assert state["baseline_done"] == 0 and "carries on tomorrow" in state["message"]
    # Asking again the same day reads nothing more.
    suggest.queue_crawl(world.engine, rival)
    run_jobs_one_at_a_time(world)
    assert read() == 2 and crawl_state(world, rival)["baseline_done"] == 0
    age_pages(world, 1)
    suggest.queue_crawl(world.engine, rival)
    run_jobs_one_at_a_time(world)
    assert read() == 4 and crawl_state(world, rival)["baseline_done"] == 0
    age_pages(world, 1)
    suggest.queue_crawl(world.engine, rival)
    run_jobs_one_at_a_time(world)
    assert read() == 5 and crawl_state(world, rival)["baseline_done"] == 1
    assert events(world) == []  # real pages from a long first pass are never reported as new


def test_daily_queue_is_once_a_day_and_only_for_watched_sites(world):
    rival_site(world)
    rival = add_rival(world)
    links.add_site(world.engine, "https://unwatched.example/", "competitor", is_allowed=ALLOW)
    world.drain("crawl")
    assert crawl.enqueue_due(world.engine) == [world.own]  # my site, never read yet; the rival was read today
    world.drain("crawl")
    assert crawl.enqueue_due(world.engine) == []
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE competitor_crawls SET finished_at = UTC_TIMESTAMP(3) - INTERVAL 2 DAY"))
    assert crawl.enqueue_due(world.engine) == [rival, world.own]  # my own site is read daily too (owner, 2026-11-09)


READ_MY_SITE_NOW = crawl.queue_own_if_never_read  # the real one, before the world fixture turns it off


def test_my_own_site_is_read_too_so_a_profile_can_compare(world):
    """Owner, 2026-11-09: "You" on a competitor's profile was always empty, because only competitors were read."""
    world.pages["me.example/"] = page_html("My home")
    for path in ("/a", "/b"):
        world.pages[f"me.example{path}"] = page_html(f"My page {path}")
    world.pages["me.example/sitemap.xml"] = sitemap_xml(("/a", "/b"), host="me.example")
    crawl.run_crawl(SimpleNamespace(payload={"competitor_id": world.own}), world.engine)
    world.drain("crawl")
    assert crawl_state(world, world.own)["pages_read"] >= 2
    rival_site(world)
    rival = add_rival(world)
    world.drain("crawl")
    facts = insights.insights(world.engine, world.own, rival)["facts"]
    assert facts["my_pages"] >= 2 and facts["my_reading"]["read_once"]


def test_adding_a_competitor_reads_my_site_if_it_never_was(world, monkeypatch):
    monkeypatch.setattr(crawl, "queue_own_if_never_read", READ_MY_SITE_NOW)
    rival_site(world)
    add_rival(world)
    assert crawl_state(world, world.own)["status"] == "queued"
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT 1 FROM jobs WHERE kind = 'competitors.crawl' AND payload LIKE :p"), {"p": f'%"competitor_id": {world.own}%'}).first()


# ---- the API, every route ---------------------------------------------------------------------------

def test_api_keyword_routes(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    client = world.client
    made = client.post("/api/keywords/upload", json={"site_id": world.own, "text": "one, with comma\ntwo", "country": "fr", "language": "FR"})
    assert made.status_code == 202 and made.get_json()["total"] == 2
    world.drain()
    assert sorted(tool.calls) == ["one, with comma", "two"]
    assert client.get(f"/api/keywords/runs/{made.get_json()['id']}").get_json()["status"] == "complete"
    assert client.get("/api/keywords/runs/999999").status_code == 404
    assert client.post("/api/keywords/refresh", json={"site_id": world.own}).status_code == 202
    assert client.post("/api/keywords/refresh", json={"site_id": world.own}).status_code == 409
    from io import BytesIO

    file_reply = client.post("/api/keywords/upload", data={"site_id": str(world.own), "file": (BytesIO("Mot-clé;Vol\ncafé;1\n".encode("cp1252")), "list.csv")}, content_type="multipart/form-data")
    assert file_reply.status_code == 202 and file_reply.get_json()["file_name"] == "list.csv"
    assert client.post("/api/keywords/upload", data={"site_id": str(world.own), "file": (BytesIO(b"PK\x03\x04"), "list.xlsx")}, content_type="multipart/form-data").status_code == 400


@pytest.mark.parametrize("path, body", [
    ("/api/keywords/upload", {"site_id": "USE_OWN", "text": "x", "url": "https://x.example/"}),
    ("/api/keywords/upload", {"site_id": "USE_OWN"}),
    ("/api/keywords/upload", {"site_id": "USE_OWN", "text": 5}),
    ("/api/keywords/upload", {"site_id": "USE_OWN", "text": "x", "country": "France"}),
    ("/api/keywords/upload", {"site_id": "USE_OWN", "text": "x", "country": 5}),
    ("/api/keywords/upload", {"site_id": "USE_OWN", "text": "x", "language": "this-is-too-long"}),
    ("/api/keywords/upload", {"site_id": "USE_OWN", "text": "   "}),
    ("/api/keywords/upload", {"site_id": "1", "text": "x"}),
    ("/api/keywords/refresh", {"site_id": True}),
    ("/api/competitors", {"site_id": "USE_OWN", "address": 5}),
    ("/api/competitors", {"site_id": "USE_OWN", "address": "x.example", "extra": 1}),
    ("/api/competitors/suggestions/accept", {"site_id": "USE_OWN", "domain": 5}),
    ("/api/competitors/suggestions/accept", {"site_id": "USE_OWN", "domain": "not a domain"}),
    ("/api/competitors/suggestions/explode", {"site_id": "USE_OWN", "domain": "x.example"}),
    ("/api/link-gaps/add", {"site_id": "USE_OWN", "domains": "x.example"}),
    ("/api/link-gaps/add", {"site_id": "USE_OWN", "domains": [5]}),
    ("/api/backlinks", {"site_id": "USE_OWN", "source_url": 5}),
    ("/api/notes", {"scope": "nope", "body": "x"}),
    ("/api/notes", {"scope": "all", "body": "x", "site_id": "1"}),
    ("/api/notes", {"scope": "all", "body": "x", "extra": 1}),
])
def test_api_refuses_bad_requests_with_a_sentence(world, path, body):
    body = {k: (world.own if v == "USE_OWN" else v) for k, v in body.items()}
    reply = world.client.post(path, json=body)
    assert reply.status_code == 400, reply.get_data(as_text=True)
    assert reply.get_json()["error"]
    assert scalar(world.engine, "SELECT COUNT(*) FROM jobs") == 0


def test_api_needs_json_and_a_site_id(world):
    assert world.client.post("/api/keywords/refresh", data="site_id=1").status_code == 400
    for path in ("competitors", "competitors/suggestions", "page-pairs", "link-gaps", "ai-watch", "prospects", "competitors/1/profile"):
        if path != "prospects":  # since 2026-11-10 no site_id means every one of my sites, so a page load asks once
            assert world.client.get(f"/api/{path}").status_code == 400, path
        assert world.client.get(f"/api/{path}?site_id=abc").status_code == 400, path
        assert world.client.get(f"/api/{path}?site_id=²").status_code == 400, path
        assert world.client.get(f"/api/{path}?site_id=999999").status_code == 404, path
    assert world.client.get("/api/prospects").status_code == 200


def test_api_competitor_routes(world):
    client = world.client
    seed(world.engine, world.own, "k1", ["rival.example/a", "me.example/m"])
    seed(world.engine, world.own, "k2", ["other.example/a", "me.example/m"])
    answer = client.get(f"/api/competitors/suggestions?site_id={world.own}").get_json()
    assert sorted(s["domain"] for s in answer["suggestions"]) == ["other.example", "rival.example"]
    assert client.post("/api/competitors/suggestions/dismiss", json={"site_id": world.own, "domain": "other.example"}).status_code == 200
    assert [d["domain"] for d in client.get(f"/api/competitors/suggestions?site_id={world.own}").get_json()["dismissed"]] == ["other.example"]
    assert client.post("/api/competitors/suggestions/restore", json={"site_id": world.own, "domain": "other.example"}).status_code == 200
    accepted = client.post("/api/competitors/suggestions/accept", json={"site_id": world.own, "domain": "rival.example"})
    assert accepted.status_code == 200
    rival = accepted.get_json()["id"]
    manual = client.post("/api/competitors", json={"site_id": world.own, "address": "https://manual.example/any"})
    assert manual.status_code == 201 and manual.get_json()["host"] == "manual.example"
    assert client.post("/api/competitors", json={"site_id": world.own, "address": "manual.example"}).status_code == 409
    assert client.post("/api/competitors", json={"site_id": world.own, "address": "me.example"}).status_code == 400
    listed = client.get(f"/api/competitors?site_id={world.own}").get_json()["competitors"]
    assert {c["host"]: c["source"] for c in listed} == {"rival.example": "suggested", "manual.example": "manual"}
    profile_answer = client.get(f"/api/competitors/{rival}/profile?site_id={world.own}").get_json()
    assert profile_answer["compare"]["shared"] == 1 and profile_answer["crawl"]["status"] == "queued"
    assert client.post(f"/api/competitors/{rival}/crawl?site_id={world.own}").status_code == 202
    assert client.post(f"/api/competitors/999999/crawl?site_id={world.own}").status_code == 404
    assert client.get(f"/api/competitors/999999/profile?site_id={world.own}").status_code == 404
    assert client.delete(f"/api/competitors/{rival}?site_id={world.own}").status_code == 200
    assert client.delete(f"/api/competitors/{rival}?site_id={world.own}").status_code == 404


def test_many_competitors_are_added_from_one_pasted_list(world):
    client = world.client
    client.post("/api/competitors", json={"site_id": world.own, "address": "old.example"})
    pasted = "https://one.example/page\n two.example ,www.three.example; \n\none.example\nold.example\nme.example\nmailto:a@b.example\tnot-an-address"
    answer = client.post("/api/competitors/many", json={"site_id": world.own, "addresses": pasted})
    assert answer.status_code == 200
    body = answer.get_json()
    assert [a["host"] for a in body["added"]] == ["one.example", "two.example", "three.example"]
    assert [a["address"] for a in body["already"]] == ["old.example"]
    assert {r["address"]: r["reason"] for r in body["refused"]} == {
        "me.example": "me.example is part of your own websites, so it can't be a competitor.",
        "mailto:a@b.example": "Not a website address.",
        "not-an-address": "Not a website address.",
    }
    listed = client.get(f"/api/competitors?site_id={world.own}").get_json()["competitors"]
    assert sorted(c["host"] for c in listed) == ["old.example", "one.example", "three.example", "two.example"]


def test_adding_many_needs_an_address_my_site_and_a_short_enough_list(world):
    client = world.client
    assert client.post("/api/competitors/many", json={"site_id": world.own, "addresses": " ,\n "}).status_code == 400
    assert client.post("/api/competitors/many", json={"site_id": 999999, "addresses": "a.example"}).status_code == 404
    too_many = "\n".join(f"r{i}.example" for i in range(suggest.MANY_AT_MOST + 1))
    refused = client.post("/api/competitors/many", json={"site_id": world.own, "addresses": too_many})
    assert refused.status_code == 400 and "up to 200" in refused.get_json()["error"]
    assert suggest.split_addresses(["a.example", "A.example/", "b.example"]) == ["a.example", "b.example"]


def test_api_pair_routes(world):
    client = world.client
    rival = paired_world(world)
    listed = client.get(f"/api/page-pairs?site_id={world.own}").get_json()["pairs"]
    pair = next(p for p in listed if p["my_url"] == "https://me.example/m1")
    assert client.get(f"/api/page-pairs?site_id={world.own}&competitor_id={rival}").get_json()["pairs"] == listed
    assert client.get(f"/api/page-pairs/{pair['id']}").get_json()["keywords"]
    assert client.get("/api/page-pairs/999999").status_code == 404
    changed = client.patch(f"/api/page-pairs/{pair['id']}", json={"their_url": "https://rival.example/mine"})
    assert changed.status_code == 200 and changed.get_json()["source"] == "manual"
    assert client.patch(f"/api/page-pairs/{pair['id']}", json={"their_url": "https://nope.example/"}).status_code == 400
    assert client.patch(f"/api/page-pairs/{pair['id']}", json={"site_id": 1}).status_code == 400
    assert client.patch(f"/api/page-pairs/{pair['id']}", json={}).status_code == 400
    assert client.post(f"/api/page-pairs/{pair['id']}/read").status_code == 202
    assert client.post(f"/api/page-pairs/{pair['id']}/automatic").get_json()["source"] == "auto"
    made = client.post("/api/page-pairs", json={"site_id": world.own, "competitor_id": rival, "my_url": "me.example/new", "their_url": "rival.example/new"})
    assert made.status_code == 201 and made.get_json()["my_url"] == "https://me.example/new"
    assert client.post("/api/page-pairs", json={"site_id": world.own, "competitor_id": 999999, "my_url": "me.example/n", "their_url": "rival.example/n"}).status_code == 404
    hidden = client.patch(f"/api/page-pairs/{made.get_json()['id']}", json={"hidden": True}).get_json()
    assert hidden["hidden"] is True
    assert made.get_json()["id"] not in [p["id"] for p in client.get(f"/api/page-pairs?site_id={world.own}").get_json()["pairs"]]
    assert made.get_json()["id"] in [p["id"] for p in client.get(f"/api/page-pairs?site_id={world.own}&include_hidden=1").get_json()["pairs"]]
    options = client.get(f"/api/sites/{world.own}/pages").get_json()["pages"]
    assert "https://me.example/m1" in [o["url"] for o in options]
    assert client.get("/api/sites/999999/pages").status_code == 404


def test_api_gap_prospect_and_backlink_routes(world):
    from io import BytesIO

    client = world.client
    rival = add_rival(world)
    upload = lambda data, name: client.post("/api/link-gaps/import", data={"site_id": str(world.own), "competitor_id": str(rival), "file": (BytesIO(data), name)}, content_type="multipart/form-data")  # noqa: E731
    assert upload(REFERRERS, "links.csv").get_json()["removed_spam"] == 1
    bad = upload(b"Foo,Bar\n1,2\n", "bad.csv")
    assert bad.status_code == 400 and bad.get_json()["headers"] == ["Foo", "Bar"]
    assert upload(b"URL\nhttps://a.example\n", "bad.xlsx").status_code == 400
    assert client.post("/api/link-gaps/import", data={"site_id": str(world.own), "competitor_id": str(rival)}, content_type="multipart/form-data").status_code == 400
    assert client.post("/api/link-gaps/import", data={"site_id": "x", "competitor_id": str(rival), "file": (BytesIO(b"URL\nhttps://a.example\n"), "a.csv")}, content_type="multipart/form-data").status_code == 400
    assert "good.example" in [g["domain"] for g in client.get(f"/api/link-gaps?site_id={world.own}").get_json()["gaps"]]
    assert client.post("/api/link-gaps/add", json={"site_id": world.own, "domains": ["good.example"]}).get_json()["added"] == ["good.example"]
    prospects = client.get(f"/api/prospects?site_id={world.own}").get_json()["prospects"]
    assert client.delete(f"/api/prospects/{prospects[0]['id']}").status_code == 200
    assert client.delete(f"/api/prospects/{prospects[0]['id']}").status_code == 404
    logged = client.post("/api/backlinks", json={"site_id": world.own, "source_url": "https://blog.good.example/x"})
    assert logged.status_code == 201 and logged.get_json() == {"id": logged.get_json()["id"], "domain": "good.example", "status": "live"}
    assert "good.example" not in [g["domain"] for g in client.get(f"/api/link-gaps?site_id={world.own}").get_json()["gaps"]]


def test_api_ai_watch_and_notes_routes(world):
    client = world.client
    rival = add_rival(world)
    seed(world.engine, world.own, "k", ["me.example/a"], ai=NOT_CAPTURED)
    assert client.get(f"/api/ai-watch?site_id={world.own}").get_json()["keywords"][0]["cited_me"] is None
    made = client.post("/api/notes", json={"scope": "competitor", "body": "ملاحظة", "site_id": world.own, "competitor_id": rival})
    assert made.status_code == 201 and made.get_json()["body"] == "ملاحظة"
    note_id = made.get_json()["id"]
    page = client.post("/api/notes", json={"scope": "page", "body": "On a page", "site_id": None, "competitor_id": None, "page_url": "https://rival.example/p"})
    assert page.status_code == 201
    assert client.post("/api/notes", json={"scope": "all", "body": "All", "site_id": None, "competitor_id": None, "page_url": None}).status_code == 201
    assert [n["id"] for n in client.get(f"/api/notes?competitor_id={rival}").get_json()["notes"]] == [note_id]
    assert [n["body"] for n in client.get("/api/notes?page_url=https%3A%2F%2Frival.example%2Fp").get_json()["notes"]] == ["On a page"]
    assert [n["body"] for n in client.get("/api/notes?scope=all").get_json()["notes"]] == ["All"]
    assert client.get("/api/notes?scope=nope").status_code == 400
    assert len(client.get(f"/api/notes?site_id={world.own}").get_json()["notes"]) == 3
    assert client.patch(f"/api/notes/{note_id}", json={"body": "Changed"}).get_json()["body"] == "Changed"
    assert client.patch(f"/api/notes/{note_id}", json={"body": 5}).status_code == 400
    assert client.patch("/api/notes/999999", json={"body": "x"}).status_code == 404
    assert client.delete(f"/api/notes/{note_id}").status_code == 200
    assert note_id not in [n["id"] for n in client.get("/api/notes").get_json()["notes"]]
    assert client.post(f"/api/notes/{note_id}/restore").get_json()["body"] == "Changed"


def test_api_connection_routes_keep_the_key_secret_and_resume_a_waiting_list(world, monkeypatch, tmp_path):
    monkeypatch.setattr(crypto, "default_key_path", lambda: tmp_path / "key")
    client = world.client
    assert client.put("/api/connections/SerpApi", json={"key": "SECRETKEY1234"}).status_code == 400  # no encryption key yet, and it says why
    crypto.init_key(tmp_path / "key")
    run = keywords.upload(world.engine, world.own, "one")
    assert run["status"] == "waiting"
    assert client.get("/api/connections/SerpApi").get_json() == {"tool": "SerpApi", "connected": False}
    tool = FakeTool()
    world.tools["google"] = [tool]
    saved = client.put("/api/connections/SerpApi", json={"key": "SECRETKEY1234"})
    assert saved.status_code == 200 and saved.get_json()["connected"] is True and saved.get_json()["last4"] == "…1234"
    assert "SECRETKEY" not in saved.get_data(as_text=True)
    assert "SECRETKEY" not in scalar(world.engine, "SELECT secret FROM connections")
    world.drain()
    assert run_of(world, run["id"])["status"] == "complete"
    for bad in ({"key": ""}, {"key": 5}, {"other": "x"}):
        assert client.put("/api/connections/SerpApi", json=bad).status_code == 400
    assert client.put("/api/connections/Nope", json={"key": "x"}).status_code == 400
    assert client.delete("/api/connections/SerpApi").status_code == 200
    assert client.get("/api/connections/SerpApi").get_json()["connected"] is False


def test_a_real_key_builds_the_real_tool_and_an_unreadable_one_says_so(world, monkeypatch, tmp_path):
    monkeypatch.setattr(crypto, "default_key_path", lambda: tmp_path / "key")
    monkeypatch.setattr(connections, "tool_factory", None)
    crypto.init_key(tmp_path / "key")
    assert [tool.name for tool in connections.tools_for(world.engine, "google")] == []
    assert [tool.name for tool in connections.tools_for(world.engine, "duckduckgo")] == ["DuckDuckGo direct"]
    assert keywords.choose_engine(world.engine) == "duckduckgo"
    connections.save_key(world.engine, "SerpApi", "SECRETKEY1234")
    assert [tool.name for tool in connections.tools_for(world.engine, "google")] == ["SerpApi"]
    assert keywords.choose_engine(world.engine) == "google"
    (tmp_path / "key").unlink()
    assert connections.tools_for(world.engine, "google") == []  # no crash: it just can't run
    assert "encryption key" in connections.status(world.engine, "SerpApi")["last_error"]


# ---- page against page: who's ahead, for the list -------------------------------------------------

def test_a_pair_says_who_ranks_higher_and_by_how_much(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "one", [f"https://rival.example/a", "https://me.example/a"])
    seed(world.engine, world.own, "two", [f"https://rival.example/a", "https://other.example/x", "https://other2.example/x", "https://me.example/a"])
    seed(world.engine, world.own, "three", ["https://me.example/a", "https://rival.example/a"])
    seed(world.engine, world.own, "only them", ["https://rival.example/a"])
    seed(world.engine, world.own, "only me", ["https://me.example/a"])
    pairs.refresh_auto_pairs(world.engine, world.own)
    pair = pairs.list_pairs(world.engine, world.own, rival)[0]
    ranking = pair["ranking"]
    assert (ranking["shared"], ranking["they_ahead"], ranking["i_ahead"], ranking["level"]) == (3, 2, 1, 0)
    assert (ranking["only_mine"], ranking["only_theirs"]) == (1, 1)
    assert ranking["gap"] == 1.0  # (1 + 3 - 1) / 3
    assert ranking["keywords"][0]["keyword"] == "two"  # the biggest gap comes first
    assert ranking["keywords_total"] == 5
    ids = {r["keyword"]: r["id"] for r in rows(world.engine, "SELECT id, keyword FROM keywords")}
    assert all(k["keyword_id"] == ids[k["keyword"]] for k in ranking["keywords"])
    assert pairs.pair_detail(world.engine, pair["id"])["ranking"] == ranking


def test_a_pair_gives_page_numbers_only_once_a_page_has_been_read(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "one", ["https://rival.example/a", "https://me.example/a"])
    pairs.refresh_auto_pairs(world.engine, world.own)
    pair = pairs.list_pairs(world.engine, world.own, rival)[0]
    assert pair["my_facts"] is None and pair["their_facts"] is None


def test_a_page_missing_from_a_keyword_names_the_sites_other_page(world):
    rival = add_rival(world)
    seed(world.engine, world.own, "shared", ["https://rival.example/a", "https://me.example/a"])
    seed(world.engine, world.own, "other page", ["https://me.example/b", "https://rival.example/a"])
    pairs.refresh_auto_pairs(world.engine, world.own)
    pair = next(p for p in pairs.list_pairs(world.engine, world.own, rival) if p["my_url"].endswith("/a"))
    rows = {r["keyword"]: r for r in pairs.pair_detail(world.engine, pair["id"])["keywords"]}
    assert rows["other page"]["my_position"] is None
    assert rows["other page"]["my_other"] == {"url": "https://me.example/b", "position": 1}
    assert rows["shared"]["my_other"] is None
    with world.engine.connect() as conn:  # each keyword row opens that keyword's own details
        ids = dict(conn.execute(text("SELECT keyword, id FROM keywords")).all())
    assert all(r["keyword_id"] == ids[k] for k, r in rows.items())


# ---- all my competitors together ------------------------------------------------------------------

def second_site(world, host="me-two.example"):
    return links.add_site(world.engine, f"https://{host}/", "own", is_allowed=ALLOW)["id"]


def rival_row(answer, host="rival.example"):
    return next(r for r in answer["rivals"] if r["host"] == host)


def add_page_change(world, host, kind="title"):
    with world.engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO domains (host) VALUES (:h)"), {"h": host})
        domain_id = conn.execute(text("SELECT id FROM domains WHERE host = :h"), {"h": host}).scalar_one()
        url = f"https://{host}/page"
        conn.execute(text("INSERT IGNORE INTO pages (domain_id, url, url_hash) VALUES (:d, :u, SHA2(:u, 256))"), {"d": domain_id, "u": url})
        page_id = conn.execute(text("SELECT id FROM pages WHERE domain_id = :d AND url = :u"), {"d": domain_id, "u": url}).scalar_one()
        conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value) VALUES (:p, :d, :k, 'old', 'new')"), {"p": page_id, "d": domain_id, "k": kind})


def test_a_rival_on_two_of_my_sites_counts_each_keyword_and_edit_once(world):
    two = second_site(world)
    add_rival(world)
    add_rival(world, site_id=two)
    seed(world.engine, world.own, "shared word", ["https://rival.example/a", "https://me.example/a"])
    track(world.engine, two, "shared word")
    add_page_change(world, "rival.example")
    row = rival_row(collective.rivals(world.engine))
    assert [s["host"] for s in row["sites"]] == ["me.example", "me-two.example"]
    assert row["ranks_on"] == 1 and row["they_ahead"] == 1 and row["edits_30d"] == 1
    answer = collective.keywords(world.engine)
    assert answer["total"] == 1 and answer["keywords"][0]["my_sites"] == ["me.example", "me-two.example"]
    assert collective.moves(world.engine)["total"] == 1


def test_my_own_edits_sit_beside_the_rivals_counted_the_same_way(world):
    two = second_site(world)
    add_rival(world)
    seed(world.engine, world.own, "shared word", ["https://rival.example/a", "https://me.example/a"])  # with a ranking check too, as on a real site
    add_page_change(world, "rival.example")
    add_page_change(world, "me.example")
    add_page_change(world, "me.example", kind="h1")
    with world.engine.begin() as conn:  # an edit older than the period doesn't count, for me as for them
        conn.execute(text("UPDATE change_events e JOIN domains d ON d.id = e.domain_id SET e.detected_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY WHERE d.host = 'me.example' AND e.kind = 'h1'"))
    answer = collective.rivals(world.engine)
    mine = {m["host"]: m for m in answer["mine"]}
    assert list(mine) == ["me.example", "me-two.example"]
    assert mine["me.example"]["edits_30d"] == 1 and mine["me.example"]["reading_since"]
    assert mine["me-two.example"]["edits_30d"] == 0 and mine["me-two.example"]["reading_since"] is None
    assert mine["me-two.example"]["crawl"]["status"] == "none" or "baseline_done" in mine["me-two.example"]["crawl"]
    assert rival_row(answer)["edits_30d"] == 1
    # The edits themselves come along for "See your edits": the same 30 days, so the old h1 edit isn't there either.
    assert [e["kind"] for e in mine["me.example"]["recent_edits"]] == [e["kind"] for e in mine["me.example"]["recent_edits"] if e["kind"] != "h1"] and len(mine["me.example"]["recent_edits"]) == 1
    assert mine["me.example"]["recent_edits"][0]["url"].startswith("https://me.example/") and mine["me-two.example"]["recent_edits"] == []
    one = collective.rivals(world.engine, two)
    assert [m["host"] for m in one["mine"]] == ["me-two.example"]


RIVAL_PAGE, MY_PAGE = "https://rival.example/a", "https://me.example/a"


def _gap(place):
    """Search results with the rival first and my page at this place, or missing."""
    if place is None:
        return [RIVAL_PAGE]
    return [RIVAL_PAGE, *[f"https://other{i}.example/" for i in range(2, place)], MY_PAGE]


def _my_row(world):
    return collective.keywords(world.engine)["keywords"][0]


def test_the_first_check_of_a_keyword_has_nothing_to_compare_with(world):
    add_rival(world)
    seed(world.engine, world.own, "word", _gap(3))
    row = _my_row(world)
    assert row["my_best"]["position"] == 3 and row["my_move"] is None


def test_my_latest_change_says_where_i_was_and_when_it_changed(world):
    add_rival(world)
    seed(world.engine, world.own, "word", _gap(5))
    seed(world.engine, world.own, "word", _gap(3))
    row = _my_row(world)
    assert row["my_best"]["position"] == 3
    assert row["my_move"]["changed"] is True and row["my_move"]["was"] == 5 and row["my_move"]["at"] == row["checked_at"]


def test_a_later_check_with_the_same_place_keeps_the_date_it_changed(world):
    add_rival(world)
    seed(world.engine, world.own, "word", _gap(5))
    seed(world.engine, world.own, "word", _gap(3))
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 10 DAY"))
    changed_on = _my_row(world)["my_move"]["at"]
    seed(world.engine, world.own, "word", _gap(3))
    row = _my_row(world)
    assert row["my_move"] == {"changed": True, "was": 5, "at": changed_on}
    assert row["checked_at"] != changed_on


def test_no_change_says_since_when(world):
    add_rival(world)
    seed(world.engine, world.own, "word", _gap(3))
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 10 DAY"))
    first_seen = _my_row(world)["checked_at"]
    seed(world.engine, world.own, "word", _gap(3))
    assert _my_row(world)["my_move"] == {"changed": False, "was": 3, "at": first_seen}


def test_falling_out_of_the_results_and_coming_back_are_changes(world):
    add_rival(world)
    seed(world.engine, world.own, "word", _gap(3))
    seed(world.engine, world.own, "word", _gap(None))
    row = _my_row(world)
    assert row["my_best"] is None and row["my_move"]["changed"] is True and row["my_move"]["was"] == 3
    seed(world.engine, world.own, "word", _gap(4))
    assert _my_row(world)["my_move"]["was"] is None


@pytest.mark.parametrize("other", [{"tool": "HasData"}, {"location": "AE"}, {"depth": 20}])
def test_a_check_of_another_kind_is_never_compared(world, other):
    add_rival(world)
    seed(world.engine, world.own, "word", _gap(9), **other)
    seed(world.engine, world.own, "word", _gap(3))
    assert _my_row(world)["my_move"] is None


def test_my_position_is_the_best_of_the_sites_the_rival_is_linked_to(world):
    two = second_site(world)
    add_rival(world)
    add_rival(world, site_id=two)
    seed(world.engine, world.own, "word", ["https://me-two.example/a", "https://rival.example/a", "https://me.example/a"])
    track(world.engine, two, "word")
    row = rival_row(collective.rivals(world.engine))
    assert row["i_ahead"] == 1 and row["they_ahead"] == 0
    assert collective.keywords(world.engine)["total"] == 0


def test_a_rival_is_only_compared_on_keywords_of_the_sites_it_is_linked_to(world):
    two = second_site(world)
    add_rival(world, site_id=two)
    seed(world.engine, world.own, "only on my first site", ["https://rival.example/a"])
    assert rival_row(collective.rivals(world.engine))["ranks_on"] is None
    assert collective.keywords(world.engine)["total"] == 0


def test_a_site_better_placed_does_not_hide_a_rival_beating_the_site_it_is_linked_to(world):
    two = second_site(world)
    add_rival(world, site_id=two)
    seed(world.engine, world.own, "word", ["https://me.example/a", "https://rival.example/a", "https://me-two.example/a"])
    track(world.engine, two, "word")
    assert rival_row(collective.rivals(world.engine))["they_ahead"] == 1
    row = collective.keywords(world.engine)["keywords"][0]
    assert row["my_best"]["host"] == "me.example" and row["my_best"]["position"] == 1
    assert row["rivals_ahead"][0]["my_host"] == "me-two.example" and row["rivals_ahead"][0]["my_position"] == 3


def test_the_keyword_rows_add_up_to_the_rivals_table(world):
    two = second_site(world)
    add_rival(world)
    add_rival(world, "rival-two.example", site_id=two)
    seed(world.engine, world.own, "one", ["https://rival.example/a", "https://me.example/a"])
    seed(world.engine, two, "two", ["https://rival-two.example/a"])
    seed(world.engine, two, "three", ["https://me-two.example/a", "https://rival-two.example/a"])
    table = collective.rivals(world.engine)["rivals"]
    beats = sum(r["they_ahead"] + r["not_found"] for r in table)
    assert beats == sum(len(k["rivals_ahead"]) for k in collective.keywords(world.engine)["keywords"]) == 2


def test_the_same_word_in_another_market_is_another_keyword(world):
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://rival.example/a"])
    other = track(world.engine, world.own, "word", country="DE", language="de")
    store.save_check(world.engine, other, "google", Answer("SerpApi", "DE", 10, [Found(1, "https://rival.example/de", "A title")], NOT_CAPTURED, [], 1), "refresh")
    assert rival_row(collective.rivals(world.engine))["ranks_on"] == 2
    assert sorted(k["country"] for k in collective.keywords(world.engine)["keywords"]) == ["DE", "FR"]


def test_a_keyword_on_two_engines_counts_once_in_the_collective_view(world):
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://rival.example/a"], search_engine="google")
    seed(world.engine, world.own, "word", ["https://rival.example/a"], search_engine="bing")
    assert rival_row(collective.rivals(world.engine))["ranks_on"] == 1
    assert collective.keywords(world.engine)["total"] == 1


def test_each_keyword_is_compared_inside_its_own_check_and_says_which_tool(world):
    add_rival(world)
    seed(world.engine, world.own, "one", ["https://rival.example/a", "https://me.example/a"], tool="SerpApi", depth=10)
    seed(world.engine, world.own, "two", ["https://me.example/a", "https://rival.example/a"], tool="Searlo", depth=100)
    answer = collective.rivals(world.engine)
    assert answer["coverage"]["tools"] == ["Searlo", "SerpApi"]
    row = rival_row(answer)
    assert row["they_ahead"] == 1 and row["i_ahead"] == 1
    assert "average" not in str(row)
    only = collective.keywords(world.engine)["keywords"]
    assert [(k["keyword"], k["tool"], k["depth"]) for k in only] == [("one", "SerpApi", 10)]


def test_no_tool_switch_reads_as_a_move_in_the_collective_view(world):
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://rival.example/a"], tool="SerpApi")
    seed(world.engine, world.own, "word", ["https://x.example/a", "https://y.example/b", "https://rival.example/a"], tool="Searlo")
    assert collective.moves(world.engine)["moves"] == []


def test_a_ranking_move_needs_the_check_before_it_however_old_and_appears_once(world):
    two = second_site(world)
    add_rival(world)
    add_rival(world, site_id=two)
    seed(world.engine, world.own, "word", ["https://x.example/a", "https://y.example/b", "https://rival.example/a"])
    track(world.engine, two, "word")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 90 DAY"))
    seed(world.engine, world.own, "word", ["https://rival.example/a"])
    found = collective.moves(world.engine)["moves"]
    assert [(m["kind"], m["from"], m["to"]) for m in found] == [("rank_up", 3, 1)]


def test_a_move_older_than_the_window_is_left_out(world):
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://x.example/a", "https://y.example/b", "https://rival.example/a"])
    seed(world.engine, world.own, "word", ["https://rival.example/a"])
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY"))
    assert collective.moves(world.engine)["total"] == 0


def test_no_checks_is_unknown_not_zero(world):
    add_rival(world)
    track(world.engine, world.own, "never checked")
    answer = collective.rivals(world.engine)
    row = rival_row(answer)
    assert row["ranks_on"] is None and row["they_ahead"] is None and row["not_found"] is None
    assert answer["coverage"] == {"keywords": 1, "checked": 0, "tools": [], "newest": None, "oldest": None}


def test_a_rival_absent_from_every_check_is_zero_not_unknown(world):
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://me.example/a"])
    assert rival_row(collective.rivals(world.engine))["ranks_on"] == 0


def test_not_found_for_me_is_kept_apart_from_they_are_ahead(world):
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://rival.example/a"])
    row = rival_row(collective.rivals(world.engine))
    assert row["not_found"] == 1 and row["they_ahead"] == 0
    keyword = collective.keywords(world.engine)["keywords"][0]
    assert keyword["my_best"] is None and keyword["rivals_ahead"][0]["my_position"] is None and keyword["depth"] == 10


def test_narrowing_to_a_site_matches_that_sites_own_numbers(world):
    two = second_site(world)
    add_rival(world)
    add_rival(world, site_id=two)
    add_rival(world, "only-mine.example")
    seed(world.engine, world.own, "one", ["https://rival.example/a", "https://me.example/a", "https://only-mine.example/a"])
    seed(world.engine, world.own, "two", ["https://me.example/a", "https://rival.example/a"])
    seed(world.engine, world.own, "three", ["https://rival.example/a"])
    seed(world.engine, two, "elsewhere", ["https://rival.example/a"])
    narrowed = collective.rivals(world.engine, world.own)
    assert [s["id"] for s in narrowed["sites"]] == [world.own]
    existing = {r["host"]: r for r in profile.overview(world.engine, world.own)}
    for row in narrowed["rivals"]:
        same = existing[row["host"]]
        assert (row["ranks_on"], row["they_ahead"], row["i_ahead"], row["not_found"], row["edits_30d"]) == (same["shared"] + same["theirs_only"], same["they_ahead"], same["i_ahead"], same["theirs_only"], same["edits_30d"])
        assert [s["id"] for s in row["sites"]] == [world.own]


def test_blocked_and_unread_rivals_are_named_so_silence_is_not_read_as_calm(world):
    blocked = add_rival(world, "blocked.example")
    add_rival(world, "unread.example")
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO competitor_crawls (competitor_id, status) VALUES (:c, 'blocked') ON DUPLICATE KEY UPDATE status = 'blocked'"), {"c": blocked})
    answer = collective.moves(world.engine)
    assert answer["blocked"] == ["blocked.example"] and answer["not_started"] == ["unread.example"]


def test_a_shared_link_domain_keeps_one_state_per_site(world):
    two = second_site(world)
    rival = add_rival(world)
    add_rival(world, site_id=two)
    gaps.import_referrers(world.engine, world.own, rival, b"Source url,Toxic Score\nhttps://both.example/x,2\n", "file.csv")
    gaps.decide(world.engine, two, "both.example", "spam")
    answer = collective.links(world.engine)
    row = next(g for g in answer["gaps"] if g["domain"] == "both.example")
    assert {s["host"]: s["quality"] for s in row["sites"]} == {"me.example": "good", "me-two.example": "spam"}
    assert row["rival_count"] == 1 and answer["funnel"]["good"] == 1
    refused = gaps.add_to_prospects(world.engine, two, ["both.example"])
    assert refused["added"] == [] and refused["skipped"] == ["both.example"]
    assert gaps.add_to_prospects(world.engine, world.own, ["both.example"])["added"] == ["both.example"]
    after = next(g for g in collective.links(world.engine)["gaps"] if g["domain"] == "both.example")
    assert {s["host"]: s["in_consideration"] for s in after["sites"]} == {"me.example": True, "me-two.example": False}


def test_a_domain_shared_by_rivals_of_different_sites_counts_each_rival_once_and_sorts_first(world):
    two = second_site(world)
    first = add_rival(world)
    second = add_rival(world, "rival-two.example", site_id=two)
    add_rival(world, site_id=two)
    gaps.import_referrers(world.engine, world.own, first, b"Domain\nshared.example\nsingle.example\n", "a.csv")
    gaps.import_referrers(world.engine, two, second, b"Domain\nshared.example\n", "b.csv")
    answer = collective.links(world.engine)
    assert answer["gaps"][0]["domain"] == "shared.example" and answer["gaps"][0]["rival_count"] == 2
    assert [r["host"] for r in answer["gaps"][0]["rivals"]] == ["rival-two.example", "rival.example"]
    assert answer["rivals_total"] == 2 and answer["rivals_with_data"] == 2


def test_a_domain_flagged_on_every_site_goes_to_the_flagged_list_and_stays_visible(world):
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, b"Domain\nbad.example\n", "a.csv")
    gaps.decide(world.engine, world.own, "bad.example", "spam")
    answer = collective.links(world.engine)
    assert answer["gaps"] == [] and [g["domain"] for g in answer["flagged"]] == ["bad.example"]
    assert answer["funnel"]["flagged"] == 1


def test_the_collective_routes_take_an_optional_site_and_refuse_anything_not_mine(world):
    rival_host = add_rival(world)
    for part in ("rivals", "keywords", "moves", "links"):
        assert world.client.get(f"/api/collective/{part}").status_code == 200
        reply = world.client.get(f"/api/collective/{part}?site_id={world.own}")
        assert reply.status_code == 200 and [s["id"] for s in reply.get_json()["sites"]] == [world.own]
        assert world.client.get(f"/api/collective/{part}?site_id=abc").status_code == 400
        assert world.client.get(f"/api/collective/{part}?site_id=").status_code == 400
        assert world.client.get(f"/api/collective/{part}?site_id=999999").status_code == 404
        assert world.client.get(f"/api/collective/{part}?site_id={rival_host}").status_code == 400


def test_viewing_the_collective_page_spends_nothing_and_changes_nothing(world):
    tool = FakeTool()
    world.tools["google"] = [tool]
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://rival.example/a"])
    before = scalar(world.engine, "SELECT COUNT(*) FROM serp_checks")
    for part in ("rivals", "keywords", "moves", "links"):
        world.client.get(f"/api/collective/{part}")
    world.drain()
    assert tool.calls == [] and scalar(world.engine, "SELECT COUNT(*) FROM serp_checks") == before


def test_with_no_sites_or_no_rivals_the_collective_answers_are_empty(world):
    answer = collective.rivals(world.engine)
    assert answer["rivals"] == [] and collective.keywords(world.engine)["keywords"] == []
    assert collective.moves(world.engine)["moves"] == [] and collective.links(world.engine)["gaps"] == []


# ---- link data typed by hand, from tools with no connection here ------------------------------------

def edit_world(world):
    rival = gap_world(world)
    other = add_rival(world, "rival-two.example")
    return rival, other


def test_a_score_typed_by_hand_replaces_the_files_and_says_whose_it_is(world):
    edit_world(world)
    gaps.save_edit(world.engine, "good.example", authority=81, authority_label=" Ahrefs ", by="Sara")
    row = gap_map(world)["good.example"]
    assert row["authority"] == 81 and row["authority_label"] == "Ahrefs" and row["authority_by_hand"] is True
    assert row["auto_authority"] == 70 and row["auto_authority_label"] == "Authority Score (SEMrush)"
    assert row["edit"]["by"] == "Sara" and row["edit"]["at"].endswith("Z")
    assert gap_map(world)["lost.example"]["authority_by_hand"] is False and gap_map(world)["lost.example"]["edit"] is None


def test_a_later_upload_or_common_crawl_never_overwrites_what_was_typed(world):
    rival, other = edit_world(world)
    gaps.save_edit(world.engine, "good.example", authority=81, authority_label="Ahrefs", remove_competitors=[rival], add_competitors=[other])
    gaps.import_referrers(world.engine, world.own, rival, REFERRERS, "links-again.csv")
    gaps.import_common_crawl(world.engine, rival, [{"domain": "good.example", "rank": 5, "total": 100, "outlinks": 1, "hosts": 1}], "CC-2026")
    row = gap_map(world)["good.example"]
    assert row["authority"] == 81
    assert [c["id"] for c in row["competitors"]] == [other]


def test_how_many_follows_the_competitors_ticked_by_hand(world):
    rival, other = edit_world(world)
    gaps.save_edit(world.engine, "good.example", add_competitors=[other])
    row = gap_map(world)["good.example"]
    assert row["competitor_count"] == 2 and row["edit"]["added"] == [other]
    assert next(g for g in collective.links(world.engine)["gaps"] if g["domain"] == "good.example")["rival_count"] == 2
    gaps.save_edit(world.engine, "good.example", remove_competitors=[other])
    row = gap_map(world)["good.example"]
    assert row["competitor_count"] == 1 and row["edit"] is None


def test_a_domain_keeps_at_least_one_competitor(world):
    rival, _ = edit_world(world)
    with pytest.raises(Refused, match="at least one competitor"):
        gaps.save_edit(world.engine, "good.example", authority=50, authority_label="Moz", remove_competitors=[rival])
    row = gap_map(world)["good.example"]
    assert row["competitor_count"] == 1 and row["authority"] == 70  # nothing was half saved


def test_the_example_link_can_be_corrected_and_stays_on_that_domain(world):
    edit_world(world)
    gaps.save_edit(world.engine, "good.example", sample_url="https://www.good.example/real-link")
    assert gap_map(world)["good.example"]["sample_url"] == "https://www.good.example/real-link"
    with pytest.raises(Refused, match="isn't on good.example"):
        gaps.save_edit(world.engine, "good.example", sample_url="https://other.example/x")
    with pytest.raises(Refused):
        gaps.save_edit(world.engine, "good.example", sample_url="javascript:alert(1)")


def test_adding_a_domain_takes_the_score_typed_by_hand(world):
    edit_world(world)
    gaps.save_edit(world.engine, "good.example", authority=81, authority_label="Ahrefs")
    gaps.add_to_prospects(world.engine, world.own, ["good.example"])
    prospect = next(p for p in gaps.list_prospects(world.engine, world.own) if p["domain"] == "good.example")
    assert prospect["authority"] == 81 and prospect["authority_label"] == "Ahrefs"


def test_going_back_restores_what_the_files_said(world):
    rival, other = edit_world(world)
    gaps.save_edit(world.engine, "good.example", authority=81, authority_label="Ahrefs", sample_url="https://good.example/x", add_competitors=[other], remove_competitors=[rival])
    gaps.reset_edit(world.engine, "good.example")
    row = gap_map(world)["good.example"]
    assert row["authority"] == 70 and row["authority_by_hand"] is False and row["edit"] is None
    assert [c["id"] for c in row["competitors"]] == [rival]
    assert row["sample_url"] == "https://blog.good.example/other"


@pytest.mark.parametrize("fields, words", [
    ({"authority": 101, "authority_label": "Moz"}, "0 to 100"),
    ({"authority": -1, "authority_label": "Moz"}, "0 to 100"),
    ({"authority": 5.5, "authority_label": "Moz"}, "0 to 100"),
    ({"authority": True, "authority_label": "Moz"}, "0 to 100"),
    ({"authority": 50}, "which tool"),
    ({"authority": 50, "authority_label": "   "}, "which tool"),
    ({"authority_label": "Moz"}, "score"),
    ({"authority": 50, "authority_label": "x" * 121}, "too long"),
    ({"add_competitors": [999999]}, "competitor"),
    ({"add_competitors": "1"}, "competitor"),
])
def test_bad_hand_edits_are_refused(world, fields, words):
    edit_world(world)
    with pytest.raises(Refused, match=words):
        gaps.save_edit(world.engine, "good.example", **fields)


def test_a_domain_not_on_the_list_cant_be_edited(world):
    edit_world(world)
    with pytest.raises(NotFound):
        gaps.save_edit(world.engine, "nowhere.example", authority=5, authority_label="Moz")
    with pytest.raises(NotFound):
        gaps.reset_edit(world.engine, "nowhere.example")


def test_the_summary_lists_every_competitor_a_domain_could_link_to(world):
    rival, other = edit_world(world)
    answer = collective.links(world.engine)
    assert {r["id"] for r in answer["rivals"]} == {rival, other}


# ---- a domain added by hand, read in a tool with no connection here ----------------------------------

def site_host(world) -> str:
    with world.engine.connect() as conn:
        return conn.execute(text("SELECT host FROM sites WHERE id = :i"), {"i": world.own}).scalar()


def test_a_domain_added_by_hand_shows_at_once_with_its_score(world):
    rival, _ = edit_world(world)
    answer = gaps.add_domain(world.engine, "https://Blog.Fresh.example/some-post", competitors=[rival], authority=44, authority_label="Ahrefs", by="Sara")
    assert answer["domain"] == "fresh.example" and answer["existing"] is False and answer["flagged"] is False
    row = gap_map(world)["fresh.example"]
    assert row["authority"] == 44 and row["authority_label"] == "Ahrefs" and row["authority_by_hand"] is True
    assert row["sample_url"] == "https://Blog.Fresh.example/some-post"
    assert [c["id"] for c in row["competitors"]] == [rival] and row["edit"]["hand_only"] is True
    assert next(g for g in collective.links(world.engine)["gaps"] if g["domain"] == "fresh.example")["rival_count"] == 1


def test_a_domain_added_by_hand_is_still_checked_for_spam(world):
    rival, _ = edit_world(world)
    gaps.add_domain(world.engine, "fresh.example", competitors=[rival])
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'pending', reason = NULL WHERE domain = 'fresh.example'"))
    assert "fresh.example" in gap_map(world)  # it shows while its check waits, unlike a domain from a file
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'spam', reason = 'parked' WHERE domain = 'fresh.example'"))
    report = gaps.link_gaps(world.engine, world.own)
    assert "fresh.example" not in {g["domain"] for g in report["gaps"]}
    assert "fresh.example" in {g["domain"] for g in report["filtered"]}


def test_a_spammy_name_added_by_hand_is_flagged_and_says_so(world):
    rival, _ = edit_world(world)
    answer = gaps.add_domain(world.engine, "best-casino-poker.example", competitors=[rival])
    assert answer["flagged"] is True
    report = gaps.link_gaps(world.engine, world.own)
    assert "best-casino-poker.example" in {g["domain"] for g in report["filtered"]}


def test_adding_a_domain_already_listed_keeps_what_was_there(world):
    rival, other = edit_world(world)
    gaps.save_edit(world.engine, "good.example", authority=81, authority_label="Ahrefs")
    answer = gaps.add_domain(world.engine, "good.example", competitors=[other])
    assert answer["existing"] is True
    row = gap_map(world)["good.example"]
    assert row["authority"] == 81 and {c["id"] for c in row["competitors"]} == {rival, other}
    assert row["edit"]["hand_only"] is False


def test_a_domain_that_already_links_to_me_says_so(world):
    rival, _ = edit_world(world)
    answer = gaps.add_domain(world.engine, "already.example", competitors=[rival])
    assert answer["links_to"] == [site_host(world)]
    assert "already.example" not in gap_map(world)


@pytest.mark.parametrize("address, words", [("not an address", "web address"), ("", "domain"), (None, "domain"), ("https://", "web address")])
def test_a_bad_address_is_refused(world, address, words):
    rival, _ = edit_world(world)
    with pytest.raises(Refused, match=words):
        gaps.add_domain(world.engine, address, competitors=[rival])


def test_adding_needs_a_competitor_and_refuses_my_site_and_the_competitor_itself(world):
    rival, _ = edit_world(world)
    with pytest.raises(Refused, match="Pick a competitor"):
        gaps.add_domain(world.engine, "fresh.example", competitors=[])
    with pytest.raises(Refused, match="your own"):
        gaps.add_domain(world.engine, "https://me.example/page", competitors=[rival])
    with pytest.raises(Refused, match="competitor itself"):
        gaps.add_domain(world.engine, "rival.example", competitors=[rival])


def test_a_refused_score_adds_nothing(world):
    rival, _ = edit_world(world)
    with pytest.raises(Refused, match="which tool"):
        gaps.add_domain(world.engine, "fresh.example", competitors=[rival], authority=50)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT 1 FROM competitor_referrers WHERE domain = 'fresh.example'")).first() is None


def test_removing_a_domain_added_by_hand_removes_it_and_undo_brings_it_back(world):
    rival, _ = edit_world(world)
    gaps.add_domain(world.engine, "fresh.example", competitors=[rival], authority=44, authority_label="Ahrefs")
    gaps.reset_edit(world.engine, "fresh.example")
    assert "fresh.example" not in gap_map(world)
    gaps.add_domain(world.engine, "fresh.example", competitors=[rival], authority=44, authority_label="Ahrefs")
    assert gap_map(world)["fresh.example"]["authority"] == 44


def test_the_add_domain_route_takes_the_account_name(world):
    rival, _ = edit_world(world)
    reply = world.client.post("/api/link-gaps/add-domain", json={"domain": "fresh.example", "competitors": [rival]})
    assert reply.status_code == 200 and reply.json["domain"] == "fresh.example"
    assert world.client.post("/api/link-gaps/add-domain", json={"domain": "fresh.example", "extra": 1}).status_code == 400


def test_a_spam_row_with_no_address_is_counted_once(world):
    rival, _ = edit_world(world)
    report = gaps.import_referrers(world.engine, world.own, rival, b"Source url,Toxic Score\nn/a,99\nhttps://fine.example/post,2\n", "links.csv")
    assert report["removed"] == 1 and report["removed_no_url"] == 1 and report["removed_spam"] == 0 and report["kept"] == 1


def test_a_page_pair_counts_a_keyword_once_however_many_engines_checked_it():
    from types import SimpleNamespace

    def check(engine, mine, theirs):
        rows = [SimpleNamespace(url="https://mine.example/a", position=mine), SimpleNamespace(url="https://rival.example/a", position=theirs)]
        return SimpleNamespace(keyword_id=1, keyword="coffee", engine=engine, depth=10, results=rows)

    summary = pairs.ranking_summary([check("bing", 1, 9), check("google", 5, 3)], "https://mine.example/a", "https://rival.example/a")
    assert (summary["shared"], summary["they_ahead"], summary["i_ahead"], summary["gap"], summary["keywords_total"]) == (1, 1, 0, 2, 1)


def test_a_page_pairs_positions_say_which_tool_measured_them_and_when():
    """Both positions of a pair's keyword come from one check, so the list can name its tool and date beside them (2026-11-12)."""
    from datetime import datetime
    from types import SimpleNamespace

    rows = [SimpleNamespace(url="https://mine.example/a", position=4), SimpleNamespace(url="https://rival.example/a", position=2)]
    check = SimpleNamespace(keyword_id=1, keyword="coffee", engine="google", tool="SerpApi", checked_at=datetime(2026, 11, 10, 8, 0), depth=10, results=rows)
    keyword = pairs.ranking_summary([check], "https://mine.example/a", "https://rival.example/a")["keywords"][0]
    assert (keyword["my_position"], keyword["their_position"], keyword["engine"], keyword["tool"]) == (4, 2, "google", "SerpApi")
    assert keyword["checked_at"].startswith("2026-11-10T08:00")


def test_a_suggested_rivals_average_doesnt_mix_engines(world):
    world.tools["google"] = [FakeTool("Credits", free_monthly=100, results={"*": ["https://rival-a.example/x"]})]
    run = keywords.upload(world.engine, world.own, "coffee")
    world.drain()
    keyword_id = store.latest_checks(world.engine, world.own)[0].keyword_id
    rows = [Found(i + 1, f"https://filler{i}.example/", "T") for i in range(8)] + [Found(9, "https://rival-a.example/x", "T")]
    store.save_check(world.engine, keyword_id, "bing", Answer("Other", "FR", 10, rows, NOT_CAPTURED, [], 1), "refresh")
    found = next(s for s in suggest.suggestions(world.engine, world.own)["suggestions"] if s["domain"] == "rival-a.example")
    assert run and found["average_position"] == 1


def test_a_tools_hourly_limit_isnt_called_this_months_and_the_list_carries_on_in_an_hour(world):
    tool = FakeTool("Credits", free_monthly=100)
    tool.per_hour = 2
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "one\ntwo\nthree\nfour")
    world.drain()
    stopped = run_of(world, run["id"])
    assert stopped["status"] == "waiting" and stopped["checked"] == 2
    assert "this hour" in stopped["stop_reason"] and "this month" not in stopped["stop_reason"]
    with world.engine.connect() as conn:
        wait = conn.execute(text("SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(3), run_after) FROM jobs WHERE status = 'queued' AND kind = :k ORDER BY id DESC LIMIT 1"), {"k": keywords.JOB_KIND}).scalar()
    assert wait is not None and 55 <= wait <= 60


def test_a_month_with_no_credits_left_still_says_so(world):
    tool = FakeTool("Credits", free_monthly=1)
    tool.per_hour = 50
    world.tools["google"] = [tool]
    run = keywords.upload(world.engine, world.own, "one\ntwo")
    world.drain()
    assert "this month" in run_of(world, run["id"])["stop_reason"]


# ---- Who is moving: everything known behind each row (2026-11-10, "as much data as possible") ---------------------------------
def test_a_page_change_carries_everything_known_about_its_page_in_both_views(world):
    add_rival(world)
    add_page_change(world, "rival.example", kind="new_page")
    add_page_change(world, "rival.example", kind="title")
    with world.engine.begin() as conn:
        conn.execute(text(
            "UPDATE pages SET title = 'Their page', meta_description = 'What it says', h1 = '[\"Big heading\"]', "
            "headings = '[[\"h2\", \"How much?\"], [\"h3\", \"Fees\"]]', word_count = 1240, schema_types = '[\"FAQPage\"]', "
            "internal_links = 30, external_links = 4, http_status = 200, lang = 'en', sitemap_lastmod = '2026-11-01', "
            "extras = '{\"images\": 6, \"images_no_alt\": 2, \"videos\": 1, \"published\": \"2026-10-30\", \"questions\": [\"How much?\"]}'"
        ))
    found = collective.moves(world.engine)["moves"]
    assert len(found) == 2 and all("page_id" not in m for m in found)
    page = found[0]["page"]
    assert page["title"] == "Their page" and page["description"] == "What it says" and page["h1"] == ["Big heading"]
    assert page["headings"] == [["h2", "How much?"], ["h3", "Fees"]] and page["headings_total"] == 2
    assert (page["words"], page["internal_links"], page["external_links"], page["status"], page["lang"]) == (1240, 30, 4, 200, "en")
    assert page["schema"] == ["FAQPage"] and page["sitemap_date"] == "2026-11-01"
    assert (page["images"], page["images_no_alt"], page["videos"], page["published"]) == (6, 2, 1, "2026-10-30")
    assert page["questions"] == ["How much?"] and page["edits"] == 1  # the title edit; finding the page isn't an edit
    timeline = profile.profile(world.engine, world.own, rival_row(collective.rivals(world.engine))["id"])["timeline"]
    assert {e["kind"] for e in timeline} == {"new_page", "title"} and all(e["page"]["words"] == 1240 for e in timeline)


def test_a_ranking_move_says_where_it_was_checked_and_where_i_stood(world):
    add_rival(world)
    seed(world.engine, world.own, "word", ["https://x.example/a", "https://me.example/a", "https://rival.example/a"])
    seed(world.engine, world.own, "word", ["https://rival.example/a", "https://me.example/a"])
    [move] = collective.moves(world.engine)["moves"]
    assert move["kind"] == "rank_up" and move["mine"]["position"] == 2 and move["mine"]["host"] == "me.example"
    assert {"country", "device", "location", "depth", "language"} <= set(move)


def test_who_is_moving_can_look_further_back_but_only_over_the_periods_offered(world):
    add_rival(world)
    add_page_change(world, "rival.example")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE change_events SET detected_at = UTC_TIMESTAMP(3) - INTERVAL 60 DAY"))
    assert collective.moves(world.engine)["total"] == 0
    longer = collective.moves(world.engine, days=90)
    assert longer["total"] == 1 and longer["days"] == 90 and longer["periods"] == [7, 30, 90, 365]
    assert collective.moves(world.engine, days=5000)["days"] == 30
