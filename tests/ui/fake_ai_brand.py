"""A fake Bright Data (AI scrapers) and Semscraper for What AI says. Nothing leaves the machine and nothing is spent.

Shapes follow seo/ai_brand/README.md: a trigger gives a snapshot, its progress says running once then ready, and the
snapshot holds one record per prompt with answer_text and citations. Semscraper takes tasks and answers them done at once.
fake_google._answer sends these hosts here, so the local harness and the tests use the same fake.

The answer repeats the question, so a question naming the company gets an answer naming it. One engine can be made to fail
with FAIL["engine"] = "chatgpt" (a refused trigger), to see one AI fail while the others answer.
"""
from __future__ import annotations

import itertools
import json
import re
from urllib.parse import parse_qs, urlsplit

import httpx

DATASETS = {"gd_m7aof0k82r803d5bjm": "chatgpt", "gd_m7dhdot1vw9a7gc1n": "perplexity", "gd_mbz66arm2mf9cu856y": "gemini", "gd_mcswdt6z2elth3zqr2": "ai_mode"}
SNAPSHOTS: dict[str, dict] = {}
TASKS: dict[str, dict] = {}
FAIL: dict[str, str | None] = {"engine": None}
CALLS: list[str] = []
_ids = itertools.count(1)

OTHERS = {
    "chatgpt": ["https://www.trustpilot.com/review/rival-one.example", "https://rival-one.example/subscription"],
    "perplexity": ["https://www.reddit.com/r/coffee/comments/abc/best_subscription/", "https://cafe-monde.example/abonnement"],
    "gemini": ["https://rival-one.example/", "https://en.wikipedia.org/wiki/Coffee"],
    "ai_mode": ["https://cafe-monde.example/grains", "https://www.trustpilot.com/review/rival-one.example"],
}
OWN = "https://site-one.example/subscription"  # the harness's first site (tests/ui/demo_world.py)


def reset() -> None:
    SNAPSHOTS.clear()
    TASKS.clear()
    CALLS.clear()
    FAIL["engine"] = None


def _own(prompt: str) -> str:
    """The harness's first site, cited when the question is about the company (it names a capitalised brand)."""
    return OWN if any(w[:1].isupper() for w in prompt.split()[1:]) else ""


# A head-to-head question as the app suggests it: "Choisir plutôt X ou Y ?" / "Should I choose X or Y?".
VERSUS = re.compile(r"(?:Choisir plutôt|Should I choose)\s+(.+?)\s+(?:ou|or)\s+(.+?)\s*\?")
# Who each AI picks in a head-to-head answer: ChatGPT and AI Mode the company, Perplexity the competitor, Gemini neither.
PICKS = {"chatgpt": "us", "ai_mode": "us", "perplexity": "them", "gemini": "tie"}


def _versus(engine: str, us: str, them: str) -> str:
    lines = [f"{us} delivers a monthly coffee subscription to your door.", f"{us} also has a plain brewing guide.",
             f"{them} offers three sizes and free delivery.", f"{them} lets you cancel any time.", f"{them} sells fresh coffee beans."]
    pick = PICKS.get(engine, "tie")
    end = {"us": f"For a simple start, I recommend {us}.", "them": f"For more choice, I would choose {them}.", "tie": "It depends on what matters most to you."}[pick]
    return " ".join([f"Comparing {us} and {them}.", *lines, end])


def _text(engine: str, prompt: str) -> str:
    pair = VERSUS.search(prompt)
    if pair:
        return _versus(engine, pair.group(1), pair.group(2))
    if "fiable" in prompt or "reliable" in prompt:
        return f"About “{prompt}”: reviews are mixed, some say to avoid long delays. Rival One is often compared."
    return f"About “{prompt}”: well-known choices are Rival One and Café Monde. ({engine} answer)"


def _record(engine: str, row: dict) -> dict:
    prompt = row.get("prompt", "")
    urls = ([_own(prompt)] if _own(prompt) else []) + OTHERS[engine]
    return {
        "url": row.get("url"), "prompt": prompt, "answer_text": _text(engine, prompt), "model": "fake-model", "country": row.get("country"),
        "citations": [{"url": u, "title": f"Page {n}", "domain": urlsplit(u).hostname, "cited": True} for n, u in enumerate(urls, 1)],
        "links_attached": [{"url": OTHERS[engine][0], "text": "source"}],
    }


def answer(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    CALLS.append(f"{request.method} {url}")
    if not request.headers.get("authorization", "").startswith("Bearer "):
        return httpx.Response(401, json={"error": "no key"})
    parts = urlsplit(url)
    query = {k: v[0] for k, v in parse_qs(parts.query).items()}
    if parts.hostname == "api.brightdata.com":
        if parts.path.endswith("/trigger"):
            engine = DATASETS.get(query.get("dataset_id", ""))
            if engine is None:
                return httpx.Response(400, json={"error": "dataset not found"})
            if FAIL["engine"] == engine:
                return httpx.Response(403, json={"error": "This dataset is not available for your account."})
            rows = json.loads(request.content).get("input", [])
            snap = f"sd_fake{next(_ids)}"
            SNAPSHOTS[snap] = {"engine": engine, "rows": rows, "polls": 0}
            return httpx.Response(200, json={"snapshot_id": snap})
        if "/progress/" in parts.path:
            snap = SNAPSHOTS.get(parts.path.rsplit("/", 1)[-1])
            if snap is None:
                return httpx.Response(404, json={"error": "Snapshot not found"})
            snap["polls"] += 1
            return httpx.Response(200, json={"status": "running" if snap["polls"] < 2 else "ready"})
        if "/snapshot/" in parts.path:
            snap = SNAPSHOTS.get(parts.path.rsplit("/", 1)[-1])
            if snap is None:
                return httpx.Response(404, json={"error": "Snapshot not found"})
            return httpx.Response(200, json=[_record(snap["engine"], row) for row in snap["rows"]])
    if parts.hostname == "api.semscraper.com":
        if parts.path.endswith("/billing/credit"):
            return httpx.Response(200, json={"data": [{"balance": 12.5}]})
        if parts.path.endswith("/serp") and request.method == "POST":
            tasks = json.loads(request.content)
            out = []
            for task in tasks:
                tid = f"t{next(_ids)}"
                TASKS[tid] = task
                out.append({"id": tid, "status": "pending", **task, "cost": 0.0003})
            return httpx.Response(200, json={"status": "ok", "count": len(out), "currency": "EUR", "total_cost": round(0.0003 * len(out), 5), "data": out})
        if parts.path.endswith("/serp"):
            rows = []
            for tid in query.get("ids", "").split(","):
                task = TASKS.get(tid)
                if task is None:
                    continue
                prompt = task["keyword"]
                has = "?" in prompt and "fiable" not in prompt and "reliable" not in prompt
                urls = ([_own(prompt)] if _own(prompt) else []) + ["https://cafe-monde.example/grains"]
                rows.append({
                    "id": tid, "status": "done", "keyword": prompt,
                    "serp_info": {"result_count": 1000, "ai_overview": {"type": "sync" if has else "none", "text": f"Google's overview on “{prompt}”: Rival One is well known." if has else None, "complete": True}},
                    "results": [{"type": "ai_overview_panel", "items": [{"url": u, "domain": urlsplit(u).hostname, "title": "Guide", "visible": True} for u in urls]}] if has else [],
                })
            return httpx.Response(200, json={"data": rows})
    return httpx.Response(404, json={"error": f"The fake doesn't know {url}"})
