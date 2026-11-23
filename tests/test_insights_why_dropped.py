"""Insights part 2 and the rest of part 3 (2026-11-17): "Explain with AI" (why_dropped) on a drop, and the insights run queuing
the "who passed me" look. Made-up sites on fakes only; no request leaves the machine."""
import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from seo.competitors import rival_changes
from seo.core.errors import Refused
from seo.extras import ai
from seo.insights import engine as insights, service
from seo.sources import service as sources
from tests.test_insights_ai import FakeClaude, key, no_reading  # noqa: F401 - fixtures
from tests.test_rival_changes import MY_URL, competitor, finding as rival_finding, net, site  # noqa: F401 - fixtures
from tests.ui import fake_google

GOOD = json.dumps({
    "cause": "A rival rewrote its guide and passed you.",
    "proof": ["rival-guide.test went from 7 to 2.", "Ranking lost 9 clicks.", "Google still indexes the page."],
    "do": ["Update the title for 2026.", "Add a Visa section.", "Answer the two new FAQ questions."],
    "sure": "likely",
})


@pytest.fixture
def claude(engine, site, key, monkeypatch):  # noqa: F811 - key is a fixture
    fake = FakeClaude(words=GOOD)
    monkeypatch.setattr(ai, "_client", lambda k: fake)
    sources.save_app_key(engine, "anthropic", "sk-ant-test-1234")
    ai.save_settings(engine, {"sites": [{"id": site, "provider": "claude"}]})
    return fake


def page_down(engine, site_id, queries=("company setup",), stake=20.0):
    evidence = {
        "path": "/guide/", "clicks": 40, "clicks_before": 58, "percent": -31, "impressions": 900, "impressions_before": 950, "position": 7.9, "position_before": 6.5,
        "why": "ranking", "split": {"ranking": -14.2, "click_rate": -2.1, "searches": -1.7, "other": 0},
        "queries": [{"query": q, "clicks": 10, "clicks_before": 18, "position": 5.0, "position_before": 3.0, "tag": "places"} for q in queries],
        "since": (datetime.now() - timedelta(days=9)).strftime("%Y-%m-%d"), "last_year": {"clicks": 50, "clicks_before": 52, "percent": -4},
    }
    with engine.begin() as conn:
        return conn.execute(
            text("INSERT INTO search_findings (site_id, kind, grp, finding_key, page, severity, at_stake, evidence, status, data_through) "
                 "VALUES (:s, 'page_down', 'changed', :k, :p, 'normal', :a, :e, 'open', '2026-11-01')"),
            {"s": site_id, "k": f"page_down-{stake}", "p": MY_URL, "a": stake, "e": json.dumps(evidence)},
        ).lastrowid


def facts_of(engine, finding_id):
    return ai.why_facts(engine, ai._finding(engine, finding_id))


# ---- purposes ---------------------------------------------------------------------------------------


def test_explain_with_ai_is_for_drops_only_and_replaces_the_short_explain():
    for kind in ("page_down", "query_down", "rank_drop", "rival_passed", "ctr_drop"):
        assert ai.purposes_for(kind) == ["why_dropped"], kind
    for kind in ("low_ctr", "page_up", "compete", "questions", "change"):
        assert "why_dropped" not in ai.purposes_for(kind), kind
    assert ai.purposes_for("low_ctr") == ["explain", "titles"]
    spec = ai.PURPOSES["why_dropped"]
    assert spec["model"] == ai.SONNET and spec["effort"] == "medium"


def test_why_dropped_isnt_asked_for_another_kind(engine, site, claude, no_reading):  # noqa: F811
    with engine.begin() as conn:
        fid = conn.execute(
            text("INSERT INTO search_findings (site_id, kind, grp, finding_key, query, severity, at_stake, evidence, status, data_through) VALUES (:s, 'low_ctr', 'wins', 'x', 'q', 'normal', 1, '{}', 'open', '2026-11-01')"),
            {"s": site},
        ).lastrowid
    with pytest.raises(Refused):
        ai.on_finding(engine, fid, "why_dropped")
    assert not claude.calls


# ---- facts ------------------------------------------------------------------------------------------


def test_the_facts_carry_the_split_the_searches_and_the_rivals_above(engine, site, net, no_reading):  # noqa: F811
    competitor(engine, site)
    passed = rival_finding(engine, site, [(1, "https://stranger.test/a", None), (2, fake_google.RIVAL_URL, 7)], before_checked=datetime(2026, 1, 15))
    rival_changes.run_site(engine, site)
    facts = facts_of(engine, passed)
    assert facts["finding"] == "rival_passed" and facts["page_now"]["title"]
    above = facts["pages_above_me"]
    assert [r["site"] for r in above] == ["rival-guide.test"] and above[0]["earlier_copy"] == "wayback" and above[0]["changes"]
    assert {c["field"] for c in above[0]["changes"]} >= {"title", "years"}
    # A page that fell on the same search shows the same rivals, with its own split and searches.
    down = page_down(engine, site)
    facts = facts_of(engine, down)
    assert facts["clicks_lost_to"] == {"ranking": -14.2, "click_rate": -2.1, "searches": -1.7, "hidden_searches": 0}
    assert facts["searches_behind"][0]["query"] == "company setup" and facts["fall_started"] and facts["same_weeks_last_year"]["percent"] == -4
    assert facts["pages_above_me"][0]["site"] == "rival-guide.test"
    assert "split" not in facts["numbers"] and "queries" not in facts["numbers"]
    assert service.one(engine, down)["rivals_from"] == passed == service.one(engine, passed)["rivals_from"]


def test_my_own_edit_comes_with_the_sentences_that_changed(engine, site, no_reading):  # noqa: F811
    import gzip
    import hashlib

    down = page_down(engine, site, queries=())
    with engine.begin() as conn:
        domain = conn.execute(text("INSERT INTO domains (host) VALUES ('shop-one.test')")).lastrowid
        pid = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, last_checked_at) VALUES (:d, :u, :h, UTC_TIMESTAMP())"), {"d": domain, "u": MY_URL, "h": hashlib.sha256(MY_URL.encode()).hexdigest()}).lastrowid
        edited = datetime.now() - timedelta(days=11)
        for n, (words, at) in enumerate((("Costs start at 3,000. Visas take a month.", edited - timedelta(days=20)), ("Costs start at 3,000. Visas take two weeks now.", edited))):
            conn.execute(
                text("INSERT INTO page_versions (page_id, taken_at, fields, text_gz) VALUES (:p, :t, '{}', :g)"),
                {"p": pid, "t": at, "g": gzip.compress(words.encode())},
            )
        conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at, changed_words) VALUES (:p, :d, 'content', '420 words', '380 words', :t, 40)"), {"p": pid, "d": domain, "t": edited})
    edit = facts_of(engine, down)["my_edit_before_the_fall"]
    assert edit[0]["what"] == "content" and edit[0]["words_changed"] == 40
    assert "ADDED: Visas take two weeks now." in edit[0]["sentences"] and "REMOVED: Visas take a month." in edit[0]["sentences"]


def test_the_facts_fit_in_20000_characters_and_the_rivals_go_first(engine, site, no_reading, monkeypatch):  # noqa: F811
    down = page_down(engine, site, queries=[f"search {n}" for n in range(10)])
    huge = [{"site": f"rival{n}.test", "url": f"https://rival{n}.test/", "changes": [{"field": "sections", "added": ["x" * 290] * 8, "removed": ["y" * 290] * 8}] * 9} for n in range(5)]
    monkeypatch.setattr(ai, "_rival_facts", lambda engine, rival_id: json.loads(json.dumps(huge)))
    monkeypatch.setattr(rival_changes, "related", lambda engine, f: 1)
    facts = facts_of(engine, down)
    assert len(json.dumps(facts, ensure_ascii=False, default=str)) <= ai.MOST_FACTS
    assert len(facts["searches_behind"]) == 10 and facts["clicks_lost_to"]  # the panel's own facts stay whole
    assert len(facts.get("pages_above_me", [])) < 5 or all(len(r["changes"]) <= 2 for r in facts["pages_above_me"])
    small = ai.fit({"numbers": {"a": 1}, "pages_above_me": [{"changes": [{"field": "title"}]}]})
    assert small["pages_above_me"]  # nothing cut when it fits


# ---- asking and the answer ------------------------------------------------------------------------------


def test_the_prompt_says_the_facts_are_data_and_the_answer_is_parsed(engine, site, claude, no_reading):  # noqa: F811
    down = page_down(engine, site)
    answer = ai.on_finding(engine, down, "why_dropped", "fr")
    call = claude.calls[0]
    assert call["model"] == ai.SONNET and call["output_config"] == {"effort": "medium"}
    assert ai.DATA_LINE in call["system"] and "untrusted" in call["system"] and "French" in call["system"] and "JSON" in call["system"]
    sent = call["messages"][0]["content"]
    assert sent.startswith("<facts>") and sent.endswith("</facts>") and '"clicks_lost_to"' in sent and len(sent) <= ai.MOST_FACTS + 20
    assert answer["parsed"] == {"cause": "A rival rewrote its guide and passed you.", "proof": json.loads(GOOD)["proof"], "do": json.loads(GOOD)["do"], "sure": "likely"}
    assert answer["text"].startswith("A rival rewrote") and "1. Update the title" in answer["text"] and "Certitude" in answer["text"]
    assert ai.on_finding(engine, down, "why_dropped", "fr")["kept"] and len(claude.calls) == 1
    assert service.one(engine, down)["ai"]["kept"]["fr"]["why_dropped"]["parsed"]["sure"] == "likely"


def test_an_answer_out_of_shape_is_shown_as_plain_text(engine, site, claude, no_reading):  # noqa: F811
    claude.words = "The page fell because of ranking. Update it."
    answer = ai.on_finding(engine, page_down(engine, site), "why_dropped")
    assert answer["parsed"] is None and answer["text"] == "The page fell because of ranking. Update it."


@pytest.mark.parametrize("words, parsed", [
    ('```json\n{"cause": "Ranking", "proof": ["a"], "do": ["x", "y", "z", "w"], "sure": "SURE"}\n```', {"cause": "Ranking", "proof": ["a"], "do": ["x", "y", "z"], "sure": "sure"}),
    ('Here it is: {"cause": "C", "proof": [], "do": ["x"], "sure": "maybe"} done', {"cause": "C", "proof": [], "do": ["x"], "sure": "guess"}),
    ('{"cause": "C", "proof": ["a"], "do": [], "sure": "sure"}', None),  # no step: not the shape
    ('{"cause": "", "do": ["x"]}', None),
    ('{"cause": "C", "do": ["x"]', None),
    ("[1, 2]", None),
    ("", None),
])
def test_parsing_the_answer(words, parsed):
    assert ai.parse_why(words) == parsed


def test_a_free_model_is_marked_weaker(engine, site, key, no_reading, monkeypatch):  # noqa: F811
    import httpx

    from seo.collectors import http

    monkeypatch.setattr(http, "transport", httpx.MockTransport(lambda r: httpx.Response(200, json={"model": "x/free", "choices": [{"message": {"content": GOOD}}]})))
    sources.save_app_key(engine, "openrouter", "sk-or-test-1234")
    ai.save_settings(engine, {"sites": [{"id": site, "provider": "openrouter"}]})
    answer = ai.on_finding(engine, page_down(engine, site), "why_dropped")
    assert answer["weaker"] is True and answer["parsed"]["sure"] == "likely"


def test_the_weekly_summary_gets_the_page_rows_with_their_split(engine, site, claude, no_reading):  # noqa: F811
    page_down(engine, site)
    with engine.begin() as conn:
        change = conn.execute(
            text("INSERT INTO search_findings (site_id, kind, grp, finding_key, severity, at_stake, evidence, status, data_through) VALUES (:s, 'change', 'changed', 'c', 'normal', 30, '{\"change\": -30}', 'open', '2026-11-01')"),
            {"s": site},
        ).lastrowid
    claude.words = "Fewer clicks."
    ai.on_finding(engine, change, "weekly")
    sent = claude.calls[0]["messages"][0]["content"]
    facts = json.loads(sent.removeprefix("<facts>\n").removesuffix("\n</facts>"))
    assert facts["top_pages"][0]["page"] == MY_URL and facts["top_pages"][0]["cause"] == "ranking"
    assert facts["top_pages"][0]["clicks_lost_to"] == {"ranking": -14, "click_rate": -2, "searches": -2, "other": 0}


# ---- the insights run queues the rival look -------------------------------------------------------------


def test_the_hook_queues_once_for_a_page_one_move_and_never_otherwise(engine, site, net):  # noqa: F811
    competitor(engine, site)
    rival_finding(engine, site, [(2, fake_google.RIVAL_URL, 7)], was=14, now=18, key="off-page-one")
    assert insights.queue_rivals(engine, site) is None  # page 2: nothing to read
    rival_finding(engine, site, [(2, fake_google.RIVAL_URL, 7)], key="page-one")
    first = insights.queue_rivals(engine, site)
    assert first is not None and insights.queue_rivals(engine, site) is None  # one look per site at a time
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = 'rival_changes'")).scalar() == 1


def test_a_queue_error_never_breaks_the_hook(engine, site, net, monkeypatch):  # noqa: F811
    rival_finding(engine, site, [(2, fake_google.RIVAL_URL, 7)])

    def broken(*args, **kwargs):
        raise RuntimeError("queue down")

    monkeypatch.setattr(rival_changes, "enqueue_for_site", broken)
    assert insights.queue_rivals(engine, site) is None


def _mix_world(engine):
    """A real rival_passed finding from rank checks: me 3 → 4, rival-guide.test 5 → 2 (tests/test_insights_mix.py's helpers)."""
    from tests.test_insights import END, FRESH
    from tests.test_insights_mix import check, keyword, search_console

    with engine.begin() as conn:
        sid = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from) VALUES (:s, 'gsc', :d, :f)"), {"s": sid, "d": END, "f": FRESH})
    competitor(engine, sid)
    k = keyword(engine, sid, "company setup")
    search_console(engine, sid, "company setup", position=4.0)
    check(engine, k, [(3, "https://shop-one.test/page"), (5, fake_google.RIVAL_URL)], ago=10)
    check(engine, k, [(2, fake_google.RIVAL_URL), (4, "https://shop-one.test/page")], ago=1)
    return sid


def test_an_insights_run_queues_the_look_and_survives_a_broken_queue(engine, monkeypatch):
    sid = _mix_world(engine)
    insights.run(engine, sid)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT kind FROM search_findings WHERE site_id = :s AND kind = 'rival_passed' AND status = 'open'"), {"s": sid}).scalar() == "rival_passed"
        assert conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = 'rival_changes' AND active_key = :k"), {"k": f"rival_changes:{sid}"}).scalar() == 1
        conn.execute(text("DELETE FROM jobs"))
        conn.commit()

    def broken(*args, **kwargs):
        raise RuntimeError("queue down")

    monkeypatch.setattr(rival_changes, "enqueue_for_site", broken)
    result = insights.run(engine, sid)
    assert result["site_id"] == sid and "added" in result  # the run is saved and says so
