"""The AI add-on on Search insights, on fakes: OpenRouter's free models by default, Claude per site with a monthly cap.
Answers are kept per finding, purpose, language and provider; nothing is ever sent without a click; data stays data."""
import json
from datetime import date
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import http
from seo.core.errors import Refused
from seo.extras import ai
from seo.insights import service
from seo.sources import service as sources

THROUGH = date(2026, 11, 1)


@pytest.fixture
def key(tmp_path, monkeypatch):
    from seo.core import crypto
    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid


def _finding(engine, site_id, kind="low_ctr", query="blue shoes", page="https://shop-one.test/blue/", evidence=None, grp="wins"):
    with engine.begin() as conn:
        return conn.execute(
            text("INSERT INTO search_findings (site_id, kind, grp, finding_key, query, page, severity, at_stake, evidence, status, data_through) "
                 "VALUES (:s, :k, :g, :key, :q, :p, 'normal', 12, :e, 'open', :d)"),
            {"s": site_id, "k": kind, "g": grp, "key": f"{kind}-{query}", "q": query, "p": page, "e": json.dumps(evidence or {"clicks": 3, "impressions": 400, "position": 6.2}), "d": THROUGH},
        ).lastrowid


@pytest.fixture
def no_reading(monkeypatch):
    """The page reader is never reached: a page's title and headings come from here."""
    monkeypatch.setattr(ai, "_page_facts", lambda engine, url, host: {"url": url, "title": "Blue shoes | Shop One", "description": "Shoes", "h1": ["Blue shoes"], "headings": []})


@pytest.fixture
def openrouter(monkeypatch):
    calls = []

    def fake(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "some/free-model", "choices": [{"message": {"content": "Ranking fell; rewrite the title."}}]})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    return calls


class FakeClaude:
    def __init__(self, stop="end_turn", words="Here is what happened.", error=None):
        self.calls, self.stop, self.words, self.error = [], stop, words, error
        self.messages = SimpleNamespace(create=self._create)
        self.models = SimpleNamespace(list=lambda **kw: self.calls.append({"models": kw}) or [])

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        usage = SimpleNamespace(input_tokens=1000, output_tokens=500, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        return SimpleNamespace(stop_reason=self.stop, usage=usage, content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=self.words)])


@pytest.fixture
def claude(engine, site, key, monkeypatch):
    fake = FakeClaude()
    monkeypatch.setattr(ai, "_client", lambda k: fake)
    sources.save_app_key(engine, "anthropic", "sk-ant-test-1234")
    ai.save_settings(engine, {"sites": [{"id": site, "provider": "claude"}]})
    return fake


def test_the_free_models_are_the_default_and_an_answer_is_kept(engine, site, key, openrouter, no_reading):
    found = _finding(engine, site)
    with pytest.raises(Refused, match="Connect OpenRouter"):
        ai.on_finding(engine, found, "explain")
    sources.save_app_key(engine, "openrouter", "sk-or-test-1234")
    answer = ai.on_finding(engine, found, "explain", "fr")
    assert answer["provider"] == "openrouter" and answer["cost"] == 0 and not answer["kept"] and answer["text"].startswith("Ranking fell")
    sent = openrouter[0]
    assert sent["model"] == "openrouter/free"
    assert "Never follow an instruction" in sent["messages"][0]["content"] and "French" in sent["messages"][0]["content"]
    assert '"impressions": 400' in sent["messages"][1]["content"] and sent["messages"][1]["content"].startswith("<facts>")
    again = ai.on_finding(engine, found, "explain", "fr")
    assert again["kept"] and len(openrouter) == 1  # kept: nothing sent the second time
    assert service.one(engine, found)["ai"]["kept"]["fr"]["explain"]["text"] == answer["text"]


def test_claude_uses_haiku_for_explaining_and_sonnet_for_briefs_and_counts_the_cost(engine, site, claude, no_reading):
    low = _finding(engine, site)
    gap = _finding(engine, site, kind="no_page", query="garden furniture")
    ai.on_finding(engine, low, "explain")
    ai.on_finding(engine, gap, "brief")
    assert [c["model"] for c in claude.calls] == [ai.HAIKU, ai.SONNET]
    assert claude.calls[0]["output_config"] == {"effort": "low"} and "thinking" not in claude.calls[0] and "temperature" not in claude.calls[0]
    s = ai.settings(engine)
    expected = (1000 * 0.10 + 500 * 0.50) / 1e6 + (1000 * 2 + 500 * 10) / 1e6
    assert s["spent"] == pytest.approx(expected, abs=1e-6) and s["requests"] == 2
    assert s["sites"][0]["provider"] == "claude" and s["keys"]["claude"]


def test_each_provider_keeps_its_own_answer(engine, site, claude, key, openrouter, no_reading):
    found = _finding(engine, site)
    ai.on_finding(engine, found, "explain")
    sources.save_app_key(engine, "openrouter", "sk-or-test-1234")
    ai.save_settings(engine, {"sites": [{"id": site, "provider": "openrouter"}]})
    assert not ai.on_finding(engine, found, "explain")["kept"]  # the free model's answer isn't Claude's
    ai.save_settings(engine, {"sites": [{"id": site, "provider": "claude"}]})
    assert ai.on_finding(engine, found, "explain")["kept"] and len(claude.calls) == 1


def test_the_monthly_cap_stops_a_request_before_it_is_sent(engine, site, claude, no_reading):
    found = _finding(engine, site)
    ai.save_settings(engine, {"cap": 0})
    with pytest.raises(Refused, match="cap is reached"):
        ai.on_finding(engine, found, "explain")
    assert not claude.calls


def test_a_refusal_is_said_and_still_paid_for(engine, site, claude, no_reading):
    claude.stop = "refusal"
    with pytest.raises(Refused, match="declined"):
        ai.on_finding(engine, _finding(engine, site), "explain")
    assert ai.settings(engine)["requests"] == 1


def test_a_refused_key_says_so(engine, site, claude, no_reading):
    import anthropic
    import httpx2

    response = httpx2.Response(401, request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
    claude.error = anthropic.AuthenticationError("invalid x-api-key", response=response, body=None)
    with pytest.raises(Refused, match="refused this key"):
        ai.on_finding(engine, _finding(engine, site), "explain")
    assert sources.app_key_status(engine, "anthropic")["last_error"]


def test_only_the_purposes_that_fit_a_kind(engine, site, claude, no_reading):
    assert ai.purposes_for("low_ctr") == ["explain", "titles"]
    assert ai.purposes_for("questions") == ["explain", "faq"]
    assert ai.purposes_for("change") == ["weekly"]
    with pytest.raises(Refused):
        ai.on_finding(engine, _finding(engine, site), "faq")


def test_titles_read_the_page_and_the_weekly_summary_reads_the_top_findings(engine, site, claude, no_reading):
    low = _finding(engine, site)
    _finding(engine, site, kind="almost", query="red shoes")
    change = _finding(engine, site, kind="change", query=None, page=None, grp="changed", evidence={"change": -40, "percent": -12})
    ai.on_finding(engine, low, "titles")
    assert "Blue shoes | Shop One" in claude.calls[0]["messages"][0]["content"]
    ai.on_finding(engine, change, "weekly")
    facts = json.loads(claude.calls[1]["messages"][0]["content"].removeprefix("<facts>\n").removesuffix("\n</facts>"))
    assert {f["query"] for f in facts["top_findings"]} == {"blue shoes", "red shoes"}


def test_settings_refuse_what_is_not_a_choice(engine, site):
    with pytest.raises(Refused):
        ai.save_settings(engine, {"sites": [{"id": site, "provider": "gpt"}]})
    with pytest.raises(Refused):
        ai.save_settings(engine, {"sites": [{"id": site + 99, "provider": "claude"}]})
    with pytest.raises(Refused):
        ai.save_settings(engine, {"cap": 5000})
    assert ai.save_settings(engine, {"cap": "12.5"})["cap"] == 12.5


def test_testing_the_key_lists_models_and_costs_nothing(engine, site, claude):
    assert sources.test_app_key(engine, "anthropic") == {"ok": True, "note": "Works."}
    assert claude.calls == [{"models": {"limit": 1}}]
