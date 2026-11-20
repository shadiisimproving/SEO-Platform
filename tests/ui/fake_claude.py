"""A fake Claude for trying the AI on Search insights by hand: no request leaves the Mac, nothing is spent at Anthropic.

  from tests.ui import fake_claude; fake_claude.install()

It answers each purpose with a short made-up text and real-looking usage, so the screen shows a cost and Settings → AI adds
it up. A page's title and headings come from here too, so the page reader isn't reached.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

ANSWERS = {
    "explain": "Ranking for this search slipped from the first half of page 1. Start by checking the page's title still says what people search.",
    "titles": "1. Blue Shoes for Every Day | Shop One\n2. Comfortable Blue Shoes, Free Delivery\n3. Blue Shoes: 40 Styles in Stock\n\n1. Comfortable blue shoes in 40 styles, delivered free in 2 days.\n2. Find blue shoes for work and weekends. Free returns.\n3. Blue shoes from €39, in stock now.",
    "brief": "## Goal\nOne page that answers garden furniture searches.\n\n## Outline\n## What to look for\n### Materials\n### Sizes\n## Questions people ask",
    "faq": "How do I clean suede shoes?\nBrush them dry with a suede brush. Check the label before using water.",
    "compete": "Keep /blue/ for this search: its title matches it. Re-target the other page on a nearby search.",
    "weekly": "Clicks fell this month, mostly because blue shoes lost places. Fix the blue page first, then the ski page, which drops every autumn.",
}


class _Messages:
    def __init__(self, owner):
        self.owner = owner

    def create(self, **kwargs):
        self.owner.calls.append(kwargs)
        purpose = next((p for p, words in PURPOSE_WORDS.items() if words in kwargs.get("system", "")), "explain")
        usage = SimpleNamespace(input_tokens=1800, output_tokens=420, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        words = brand_reading(kwargs["messages"][0]["content"], kwargs.get("system", "")) if purpose == "brand" else ANSWERS[purpose]
        return SimpleNamespace(stop_reason="end_turn", usage=usage, content=[SimpleNamespace(type="text", text=words)])


def brand_reading(user: str, system: str) -> str:
    """What AI says: named when the company's name is in the answer, in the run's language, like a real reading would."""
    company = json.loads(user.split("<company>", 1)[1].split("</company>", 1)[0])
    answer = user.split("<answer>", 1)[1].lower()
    named = company.lower() in answer
    french = "in French" in system
    if not named:
        return json.dumps({"brand_named": False, "summary": "La réponse ne cite pas l'entreprise." if french else "The answer doesn't mention the company.", "tone": "neutral", "pros": [], "cons": [], "competitors": ["Rival One", "Café Monde"]})
    negative = "avoid" in answer or "éviter" in answer
    return json.dumps({
        "brand_named": True,
        "summary": ("La réponse cite l'entreprise parmi les choix sérieux, avec des prix clairs." if french else "The answer lists the company among the serious choices, with clear prices.") if not negative else ("La réponse met en garde contre l'entreprise." if french else "The answer warns against the company."),
        "tone": "negative" if negative else "positive",
        "pros": ["Prix clairs", "Accompagnement en français"] if french else ["Clear prices", "Help in French"],
        "cons": ["Délais parfois longs"] if french else ["Sometimes slow"],
        "competitors": ["Rival One"],
    }, ensure_ascii=False)


class FakeClaude:
    def __init__(self):
        self.calls = []
        self.messages = _Messages(self)
        self.models = SimpleNamespace(list=lambda **kw: [])


PURPOSE_WORDS: dict[str, str] = {}


def install() -> FakeClaude:
    from seo.extras import ai

    PURPOSE_WORDS.update({purpose: spec["ask"][:40] for purpose, spec in ai.PURPOSES.items()})
    fake = FakeClaude()
    ai._client = lambda key: fake
    ai._page_facts = lambda engine, url, host: {"url": url, "title": "Blue shoes | Shop One", "description": "Shoes in blue.", "h1": ["Blue shoes"], "headings": json.loads("[]")}
    return fake
