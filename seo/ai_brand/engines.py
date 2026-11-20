"""The two providers that ask AI assistants for us: Bright Data's AI scrapers and Semscraper. What their docs said is in
README.md beside this file. Nothing here decides when to ask: only service.py does, after the owner pressed the button.

Each client has the same two steps, so the job can treat every AI alike:
- send(engine_id, prompts, country, language) -> [(job_id, cost)], one per prompt, in order. Bright Data gives one snapshot
  for all of them; Semscraper one task each, and charges when it's sent.
- collect(engine_id, {answer_id: (job_id, prompt)}) -> {answer_id: Reply} for those ready. Not ready yet: left out.
EngineFailed means this AI can't answer any of them now; the others carry on.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Callable
from urllib.parse import quote_plus, urlsplit

from sqlalchemy import Engine, text

from seo.collectors import http
from seo.collectors.http import SourceError
from seo.core import crypto
from seo.sources import service as sources

BRIGHT_TOOL, SEMSCRAPER_TOOL = "Bright Data AI", "Semscraper"  # names in credit_ledger and tool_usage
BRIGHT_BASE = "https://api.brightdata.com/datasets/v3"
SEMSCRAPER_BASE = "https://api.semscraper.com/v1"
BRIGHT_PER_ANSWER = Decimal("0.0015")  # $1.50 per 1,000 records, pay as you go
SEMSCRAPER_PER_ANSWER = Decimal("0.0003")  # €0.30 per 1,000 searches of one page

ENGINES: dict[str, dict] = {
    "chatgpt": {"name": "ChatGPT", "provider": "brightdata", "host": "chatgpt.com", "dataset": "gd_m7aof0k82r803d5bjm", "url": "https://chatgpt.com/"},
    "perplexity": {"name": "Perplexity", "provider": "brightdata", "host": "perplexity.ai", "dataset": "gd_m7dhdot1vw9a7gc1n", "url": "https://www.perplexity.ai/"},
    "gemini": {"name": "Gemini", "provider": "brightdata", "host": "gemini.google.com", "dataset": "gd_mbz66arm2mf9cu856y", "url": "https://gemini.google.com/"},
    "ai_mode": {"name": "Google AI Mode", "provider": "brightdata", "host": "google.com", "dataset": "gd_mcswdt6z2elth3zqr2", "url": "https://www.google.com/search?udm=50&q="},
    "ai_overview": {"name": "Google AI Overviews", "provider": "semscraper", "host": "google.com"},
}
ORDER = tuple(ENGINES)
PROVIDERS = {
    "brightdata": {"tool": BRIGHT_TOOL, "key": "brightdata_ai", "per_answer": BRIGHT_PER_ANSWER, "currency": "USD", "price": "$1.50 per 1,000 answers"},
    "semscraper": {"tool": SEMSCRAPER_TOOL, "key": "semscraper", "per_answer": SEMSCRAPER_PER_ANSWER, "currency": "EUR", "price": "€0.30 per 1,000 answers"},
}


class EngineFailed(Exception):
    """This AI can't answer now. `charged` says whether money may already have gone (it never has, at send time, here)."""


@dataclass
class Reply:
    prompt: str
    text: str = ""
    sources: list = field(default_factory=list)
    model: str | None = None
    error: str | None = None
    no_answer: bool = False  # Google showed no AI Overview for it: a real answer, not a failure


def host_of(url: str) -> str:
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _source(url, title=None, host=None, cited=None) -> dict | None:
    url = url.strip() if isinstance(url, str) else ""
    found = host_of(url) if url.startswith(("http://", "https://")) else ""
    host = found or (str(host).strip().lower().removeprefix("www.") if host else "")
    if not host:
        return None
    return {"url": url if found else "", "host": host, "title": (str(title).strip()[:300] if title else ""), "cited": bool(cited) if cited is not None else True}


def _merge(found: list) -> list:
    """One entry per address (or per site when there's no address), the first title kept, cited if any copy was."""
    out, seen = [], {}
    for item in found:
        if not item:
            continue
        key = item["url"] or item["host"]
        if key in seen:
            seen[key]["cited"] = seen[key]["cited"] or item["cited"]
            seen[key]["title"] = seen[key]["title"] or item["title"]
            continue
        seen[key] = item
        out.append(item)
    return out[:60]


def _list(value) -> list:
    return value if isinstance(value, list) else []


# ---- Bright Data ------------------------------------------------------------------------------------


class BrightDataAI:
    tool = BRIGHT_TOOL

    def __init__(self, key: str):
        self.key = key

    def _call(self, method: str, path: str, **kwargs):
        try:
            return http.request(method, f"{BRIGHT_BASE}{path}", "Bright Data", timeout=60, headers={"Authorization": f"Bearer {self.key}"}, **kwargs)
        except SourceError as exc:
            raise EngineFailed(str(exc)) from exc

    def send(self, engine_id: str, prompts: list[str], country: str, language: str) -> list[tuple[str, Decimal]]:
        spec = ENGINES[engine_id]
        rows = []
        for prompt in prompts:
            row = {"url": spec["url"] + quote_plus(prompt) if engine_id == "ai_mode" else spec["url"], "prompt": prompt}
            if country:
                row["country"] = country.upper() if engine_id == "ai_mode" else country.lower()
            if engine_id == "ai_mode" and language:
                row["hl"] = language
            if engine_id == "chatgpt":
                row["web_search"] = True  # lets it search the web, so it cites sources
            rows.append(row)
        reply = self._call("POST", "/trigger", params={"dataset_id": spec["dataset"], "include_errors": "true", "format": "json"}, json={"input": rows})
        try:
            snapshot = reply.json().get("snapshot_id")
        except (ValueError, AttributeError):
            snapshot = None
        if not snapshot:
            raise EngineFailed("Bright Data didn't say where to collect the answers.")
        return [(str(snapshot), Decimal("0")) for _ in prompts]  # billed per record delivered, so counted on arrival

    def collect(self, engine_id: str, wanted: dict) -> dict:
        snapshot = next(iter(wanted.values()))[0]
        progress = self._call("GET", f"/progress/{snapshot}")
        try:
            state = progress.json()
        except ValueError:
            state = {}
        status = str(state.get("status") or "").lower()
        if status in ("failed", "canceled", "cancelled"):
            raise EngineFailed(f"Bright Data stopped: {state.get('error_message') or status}.")
        if status and status != "ready":
            return {}
        data = self._call("GET", f"/snapshot/{snapshot}", params={"format": "json"})
        if data.status_code == 202:
            return {}
        try:
            records = data.json()
        except ValueError:
            # Without format=json the download is NDJSON: one record a line.
            records = [json.loads(line) for line in data.text.splitlines() if line.strip().startswith("{")]
        if isinstance(records, dict):
            if str(records.get("status") or "").lower() in ("building", "running", "starting"):
                return {}
            records = records.get("data") if isinstance(records.get("data"), list) else [records]
        return match_records(engine_id, wanted, [r for r in _list(records) if isinstance(r, dict)])


def _prompt_of(record: dict) -> str:
    echo = record.get("input") if isinstance(record.get("input"), dict) else {}
    return str(record.get("prompt") or echo.get("prompt") or "").strip()


def read_record(engine_id: str, record: dict) -> Reply:
    prompt = _prompt_of(record)
    if record.get("error") or record.get("error_code"):
        return Reply(prompt, error=str(record.get("error") or record.get("error_code"))[:300])
    words = record.get("answer_text") or record.get("answer_text_markdown") or record.get("answer_text_raw") or ""
    found = []
    for item in _list(record.get("citations")):
        if isinstance(item, dict):
            found.append(_source(item.get("url"), item.get("title"), item.get("domain"), item.get("cited", True)))
    for name in ("search_sources", "links_attached", "references"):
        for item in _list(record.get(name)):
            if isinstance(item, dict):
                found.append(_source(item.get("url"), item.get("title") or item.get("text"), item.get("domain"), name != "search_sources"))
    if not str(words).strip():
        return Reply(prompt, error="The AI gave no answer.")
    return Reply(prompt, text=str(words).strip(), sources=_merge(found), model=(str(record["model"])[:60] if record.get("model") else None))


def match_records(engine_id: str, wanted: dict, records: list) -> dict:
    """Each answer gets the record with its prompt; any left over go to the rest in order. A missing one fails."""
    replies = [read_record(engine_id, r) for r in records]
    out, free = {}, list(range(len(replies)))
    for answer_id, (_job, prompt) in wanted.items():
        hit = next((i for i in free if replies[i].prompt.strip().casefold() == prompt.strip().casefold()), None)
        if hit is not None:
            out[answer_id] = replies[hit]
            free.remove(hit)
    for answer_id, (_job, prompt) in wanted.items():
        if answer_id not in out:
            if free:  # its prompt came back changed (trimmed, re-spaced): the records keep the order they were sent in
                out[answer_id] = replies[free.pop(0)]
            else:
                out[answer_id] = Reply(prompt, error="Bright Data sent no answer for this question.")
    return out


# ---- Semscraper ---------------------------------------------------------------------------------------


class Semscraper:
    tool = SEMSCRAPER_TOOL

    def __init__(self, key: str):
        self.key = key

    def _call(self, method: str, path: str, **kwargs):
        try:
            return http.request(method, f"{SEMSCRAPER_BASE}{path}", "Semscraper", timeout=60, headers={"Authorization": f"Bearer {self.key}"}, **kwargs)
        except SourceError as exc:
            raise EngineFailed(str(exc)) from exc

    def balance(self):
        data = self._call("GET", "/billing/credit").json()
        rows = data.get("data") if isinstance(data, dict) else None
        return rows[0].get("balance") if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None

    def send(self, engine_id: str, prompts: list[str], country: str, language: str) -> list[tuple[str, Decimal]]:
        tasks = [{"search_engine": "google_search", "keyword": p, "device": "desktop", "depth": 1, "location": (country or "us").lower(), "language": (language or "en").lower()} for p in prompts]
        reply = self._call("POST", "/serp", json=tasks)
        try:
            rows = reply.json().get("data")
        except (ValueError, AttributeError):
            rows = None
        if not isinstance(rows, list) or len(rows) != len(prompts):
            raise EngineFailed("Semscraper didn't take the questions.")
        out = []
        for row in rows:
            task = row.get("id") if isinstance(row, dict) else None
            try:
                cost = Decimal(str(row.get("cost"))) if row.get("cost") is not None else SEMSCRAPER_PER_ANSWER
            except (ArithmeticError, ValueError):
                cost = SEMSCRAPER_PER_ANSWER
            out.append((str(task) if task else "", cost))
        return out

    def collect(self, engine_id: str, wanted: dict) -> dict:
        ids = [job for job, _prompt in wanted.values() if job][:100]
        out = {aid: Reply(prompt, error="Semscraper didn't take this question.") for aid, (job, prompt) in wanted.items() if not job}
        if not ids:
            return out
        data = self._call("GET", "/serp", params={"ids": ",".join(ids), "output": "json"}).json()
        rows = data.get("data") if isinstance(data, dict) else data
        by_id = {str(r.get("id")): r for r in _list(rows) if isinstance(r, dict)}
        for answer_id, (job, prompt) in wanted.items():
            row = by_id.get(job)
            if not job or row is None or str(row.get("status") or "").lower() in ("pending", "processing"):
                continue
            out[answer_id] = read_serp(prompt, row)
        return out


def read_serp(prompt: str, row: dict) -> Reply:
    if str(row.get("status") or "").lower() not in ("done", ""):
        return Reply(prompt, error=f"Semscraper: {row.get('status')}.")
    info = row.get("serp_info") if isinstance(row.get("serp_info"), dict) else {}
    overview = info.get("ai_overview") if isinstance(info.get("ai_overview"), dict) else {}
    words = str(overview.get("text") or "").strip()
    found = []
    for block in _list(row.get("results")):
        if not isinstance(block, dict) or block.get("type") not in ("ai_overview_panel", "ai_overview_citation", "ai_overview_citation_source"):
            continue
        for item in _list(block.get("items")):
            if isinstance(item, dict):
                found.append(_source(item.get("url"), item.get("title") or item.get("brand"), item.get("domain"), block.get("type") != "ai_overview_citation_source"))
    if not words:
        return Reply(prompt, no_answer=True, sources=_merge(found))
    return Reply(prompt, text=words, sources=_merge(found), model="Google AI Overview" + ("" if overview.get("complete", True) else " (cut short)"))


# ---- keys ---------------------------------------------------------------------------------------------

# Tests and the local harness replace this to run with no network: (engine, provider) -> client or None.
client_factory: Callable[[Engine, str], object | None] | None = None


def bright_key(engine: Engine) -> str | None:
    """The key pasted for the AI scrapers, or else the account key saved for Bright Data search (its zone isn't used)."""
    own = sources.app_key(engine, "brightdata_ai")
    if own:
        return own
    with engine.connect() as conn:
        sealed = conn.execute(text("SELECT secret FROM connections WHERE tool = 'Bright Data'")).scalar()
    if not sealed:
        return None
    try:
        return json.loads(crypto.decrypt(sealed))["key"]
    except (crypto.BadKey, crypto.MissingKey, crypto.UnsafeKeyFile, ValueError, KeyError, TypeError):
        return None


def client(engine: Engine, provider: str):
    if client_factory is not None:
        return client_factory(engine, provider)
    if provider == "brightdata":
        key = bright_key(engine)
        return BrightDataAI(key) if key else None
    key = sources.app_key(engine, "semscraper")
    return Semscraper(key) if key else None


def connected(engine: Engine) -> dict[str, bool]:
    """Which providers have a key now, without decrypting more than needed."""
    if client_factory is not None:
        return {p: client_factory(engine, p) is not None for p in PROVIDERS}
    with engine.connect() as conn:
        tools = {row[0] for row in conn.execute(text("SELECT tool FROM connections WHERE tool IN ('Bright Data', :a, :b)"), {"a": sources.APP_KEYS["brightdata_ai"], "b": sources.APP_KEYS["semscraper"]})}
    return {"brightdata": "Bright Data" in tools or sources.APP_KEYS["brightdata_ai"] in tools, "semscraper": sources.APP_KEYS["semscraper"] in tools}
