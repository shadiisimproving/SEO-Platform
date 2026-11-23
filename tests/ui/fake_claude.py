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
    "why_dropped": json.dumps({
        "cause": "A rival rewrote its guide for 2026 and passed you, while your page still says 2025.",
        "proof": ["rival-guide.test went from 5 to 2 after adding a Visa options section and two FAQ questions.",
                  "Your page fell from 3 to 5 on the same check; its title still says 2025.",
                  "Most clicks were lost to Ranking, not to fewer searches."],
        "do": ["Update the title and the text for 2026.", "Add a Visa options section and answer how long it takes and what it costs.",
               "Add FAQ structured data to the questions."],
        "sure": "likely",
    }),
    "weekly": "Clicks fell this month, mostly because blue shoes lost places. Fix the blue page first, then the ski page, which drops every autumn.",
}


FRENCH = {
    "why_dropped": json.dumps({
        "cause": "Un concurrent a réécrit son guide pour 2026 et vous a dépassé ; votre page dit encore 2025.",
        "proof": ["rival-guide.test est passé de 5 à 2 après une section Visa et deux questions de FAQ.", "Votre page est passée de 3 à 5 au même relevé."],
        "do": ["Mettez le titre et le texte à jour pour 2026.", "Ajoutez une section sur les visas et répondez aux questions de délai et de coût.",
               "Ajoutez les données structurées FAQ."],
        "sure": "likely",
    }, ensure_ascii=False),
}


class _Messages:
    def __init__(self, owner):
        self.owner = owner

    def create(self, **kwargs):
        self.owner.calls.append(kwargs)
        purpose = next((p for p, words in PURPOSE_WORDS.items() if words in kwargs.get("system", "")), "explain")
        usage = SimpleNamespace(input_tokens=1800, output_tokens=420, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        user, system = kwargs["messages"][0]["content"], kwargs.get("system", "")
        words = brand_reading(user, system) if purpose == "brand" else versus_reading(user, system) if purpose == "versus" else onsite_reading(user) if purpose == "onsite" else (FRENCH.get(purpose) if "Write in French" in system else None) or ANSWERS[purpose]
        return SimpleNamespace(stop_reason="end_turn", usage=usage, content=[SimpleNamespace(type="text", text=words)])


def brand_reading(user: str, system: str) -> str:
    """What AI says: named when the company's name is in the answer, in the run's language, like a real reading would."""
    company = json.loads(user.split("<company>", 1)[1].split("</company>", 1)[0])
    answer = user.split("<answer>", 1)[1].lower()
    aka = json.loads(user.split("<also_known_as>", 1)[1].split("</also_known_as>", 1)[0]) if "<also_known_as>" in user else []
    named = any(n.lower() in answer for n in [company, *aka])
    french = "in French" in system
    if not named:
        return json.dumps({"brand_named": False, "summary": "La réponse ne cite pas l'entreprise." if french else "The answer doesn't mention the company.", "tone": "neutral", "pros": [], "cons": [], "competitors": ["Rival One", "Café Monde"]})
    negative = "avoid" in answer or "éviter" in answer
    return json.dumps({
        "brand_named": True,
        "summary": ("La réponse cite l'entreprise parmi les choix sérieux, avec des prix clairs." if french else "The answer lists the company among the serious choices, with clear prices.") if not negative else ("La réponse met en garde contre l'entreprise." if french else "The answer warns against the company."),
        "tone": "negative" if negative else "positive",
        "pros": ["Prix clairs", "Accompagnement en français", "Café livré chaque mois"] if french else ["Clear prices", "Help in French", "Coffee delivered every month"],
        "cons": ["Délais parfois longs", "Abonnement peu flexible"] if french else ["Sometimes slow", "Subscription not very flexible"],
        "competitors": ["Rival One"],
    }, ensure_ascii=False)


def versus_reading(user: str, system: str) -> str:
    """Head-to-head: "recommend <company>" is us, "choose <competitor>" is them, anything else a tie, like a real reading."""
    company = json.loads(user.split("<company>", 1)[1].split("</company>", 1)[0])
    rival = json.loads(user.split("<competitor>", 1)[1].split("</competitor>", 1)[0])
    answer = user.split("<answer>", 1)[1].lower()
    aka = json.loads(user.split("<also_known_as>", 1)[1].split("</also_known_as>", 1)[0]) if "<also_known_as>" in user else []
    winner = "us" if any(f"recommend {n.lower()}" in answer for n in [company, *aka]) else "them" if f"choose {rival.lower()}" in answer else "tie"
    french = "in French" in system
    return json.dumps({
        "winner": winner, "brand_named": any(n.lower() in answer for n in [company, *aka]), "tone": "positive" if winner == "us" else "neutral",
        "summary": {"us": "La réponse recommande l'entreprise.", "them": "La réponse recommande le concurrent.", "tie": "La réponse laisse le choix."}[winner] if french
        else {"us": "The answer recommends the company.", "them": "The answer recommends the competitor.", "tie": "The answer leaves the choice open."}[winner],
        "us": ["Café livré chaque mois", "Café en grains de plusieurs origines"] if french else ["Coffee delivered every month", "A plain brewing guide"],
        "them": ["Trois formats et livraison gratuite", "Résiliation à tout moment", "Moulins à café en vente"] if french else ["Three sizes and free delivery", "Cancel any time", "Fresh coffee beans"],
        "competitors": [rival],
    }, ensure_ascii=False)


def onsite_reading(user: str) -> str:
    """"On your site?": the word match on the passages sent, so the marks are steady and plausible."""
    from seo.ai_brand import onsite

    listed = json.loads(user.split("<points>", 1)[1].split("</points>", 1)[0])
    out = []
    for item in listed:
        best = None
        for page in item["pages"]:
            fake = {"url": page["url"], "text": f"{page['title']} {page['passage']}"}
            fake["stems"] = {w[:onsite.STEM] for w in onsite.words_of(fake["text"])}
            got = onsite.by_words(item["point"], [fake], set())
            if best is None or got["score"] > best[0]["score"]:
                best = (got, page["page"])
        mark = best[0]["mark"] if best else "missing"
        out.append({"i": item["i"], "mark": mark, "page": best[1] if best and mark != "missing" else None})
    return json.dumps({"results": out})


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
