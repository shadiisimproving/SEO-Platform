"""A fake Semscraper for its rank tool (seo/serp/tools.py: Semscraper), on the demo world's made-up results. Nothing leaves the
machine and nothing is spent. The shapes are those of semscraper.com/en/documentation: POST /v1/serp makes a task (pending,
with its cost), GET /v1/serp?ids= says processing once, then done with organic blocks and the AI Overview.

Who ranks and who the overview cites come from tests/ui/demo_world.py, so Semscraper and the fake SerpApi there agree.
To see the fallback, create the file FAIL_FILE: every new search then answers 500, and SerpApi takes over.

  DB_NAME_TEST=test_mzsemui_test .venv/bin/python tests/ui/app_server.py --port 8330 --semscraper
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path

import httpx

from seo.serp.tools import ABSENT, PRESENT
from tests.ui import demo_world

FAIL_FILE = Path(__file__).resolve().parent.parent.parent / "var" / "fake-semscraper-fail"
TASKS: dict[str, dict] = {}
CALLS: list[str] = []
_ids = itertools.count(1)
ROUND = {"no": 2}  # the demo tool's round, so both tools tell the same story


def _row(task_id: str, task: dict) -> dict:
    keyword = task["keyword"]
    found = next((k for k in demo_world.KEYWORDS if k[0] == keyword), None)
    order = list(found[3]) if found else [f"{demo_world.RIVALS[len(keyword) % 3]}/page", f"new-entrant.example/{len(keyword)}", f"{demo_world.ME}/page"]
    items = []
    for n, path in enumerate(order[: task["depth"] * 10], start=1):
        url = f"https://{path}" if "/" in path else f"https://{path}/"
        items.append({"rank_type": n, "rank_serp": n + 1, "page": (n - 1) // 10 + 1, "pixel": 120 * n, "domain": path.split("/")[0], "url": url, "title": f"{path.split('/')[0]}: {keyword}", "description": ""})
    state, cited = demo_world._ai_for(keyword, ROUND["no"])
    blocks = [{"type": "organic", "items": items}]
    overview = {"type": "none", "text": None, "complete": True}
    if state == PRESENT:
        overview = {"type": "sync", "text": f"Google's overview on {keyword}.", "complete": True}
        blocks.append({"type": "ai_overview_citation", "items": [{"url": f"https://{c}", "domain": c.split("/")[0], "title": c, "brand": c.split(".")[0], "visible": True} for c in cited]})
    elif state != ABSENT:
        overview = {"type": "async", "text": None, "complete": False}
    return {"id": task_id, "status": "done", **task, "cost": 0.0003, "serp_info": {"result_count": 1000, "ai_overview": overview}, "results": blocks}


def answer(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    CALLS.append(f"{request.method} {path}")
    if request.headers.get("authorization", "") != "Bearer fake-semscraper-key":
        return httpx.Response(401, json={"error": "Unauthorized", "message": "Invalid API key", "code": 401})
    if path == "/v1/billing/credit":
        return httpx.Response(200, json={"status": "ok", "count": 1, "data": [{"balance": 12.5}]})
    if path == "/v1/serp" and request.method == "POST":
        if FAIL_FILE.exists():
            return httpx.Response(500, json={"error": "Internal Server Error", "message": "fake failure", "code": 500})
        out = []
        for task in json.loads(request.content):
            task_id = f"rank{next(_ids)}"
            TASKS[task_id] = {**task, "polls": 0}
            out.append({"id": task_id, "status": "pending", **task, "cost": 0.0003})
        return httpx.Response(200, json={"status": "ok", "count": len(out), "currency": "EUR", "total_cost": round(0.0003 * len(out), 5), "data": out})
    if path == "/v1/serp":
        rows = []
        for task_id in request.url.params.get("ids", "").split(","):
            task = TASKS.get(task_id)
            if task is None:
                continue
            task["polls"] += 1
            clean = {k: v for k, v in task.items() if k != "polls"}
            rows.append({"id": task_id, "status": "processing"} if task["polls"] < 2 else _row(task_id, clean))
        return httpx.Response(200, json={"status": "ok", "count": len(rows), "data": rows})
    return httpx.Response(404, json={"error": "Not Found", "message": f"The fake doesn't know {path}", "code": 404})


def tool():
    """The real rank tool, talking to this fake."""
    from seo.serp.tools import Semscraper

    made = Semscraper("fake-semscraper-key", client=httpx.Client(transport=httpx.MockTransport(answer)))
    made.poll_seconds = 0.3
    return made
