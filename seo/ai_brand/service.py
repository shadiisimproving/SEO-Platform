"""What AI says about us: the questions, the price shown first, one run at a time, and the job that collects the answers.

Only a press of the button starts a run (start()), after estimate() gave the price and the owner said yes. Nothing here is
ever queued by a schedule. The job sends each question once, comes back every 30 s with RunAgain until the answers are in,
counts each answer once in credit_ledger, and lets one AI fail without stopping the others. README.md has the providers.
"""
from __future__ import annotations

import json
import time
import unicodedata
from collections import Counter
from decimal import Decimal

from sqlalchemy import Engine, bindparam, text

from seo.ai_brand import engines as E
from seo.competitors.keywords import require_own
from seo.core.errors import Conflict, NotFound, Refused
from seo.extras import ai
from seo.metrics import countries
from seo.serp import connections
from seo.worker import queue
from seo.worker.runner import RunAgain, handler

LANE = "refresh"
JOB_KIND = "ai_brand.run"
MAX_PER_RUN = 10
MAX_QUESTIONS = 30
WAIT_SECONDS = 30
GIVE_UP_MINUTES = 30
READ_SECONDS = 35  # time for AI readings in one pass; the rest wait for the next
FINAL = ("complete", "partial", "failed")
NO_ANSWER_TEXT = ""

SUGGEST = {
    "fr": {
        "brand": ["Que pensez-vous de {brand} ?", "{brand} est-il fiable ?", "Quels sont les avis clients sur {brand} ?", "{brand} ou ses concurrents : lequel choisir ?"],
        "keyword": "Quelle est la meilleure société pour « {keyword} » ?",
    },
    "en": {
        "brand": ["What do you think of {brand}?", "Is {brand} reliable?", "What do customers say about {brand}?", "{brand} or its competitors: which should I choose?"],
        "keyword": "What is the best company for “{keyword}”?",
    },
}


def _fold(value: str) -> str:
    clean = " ".join(str(value or "").split()).casefold()
    return "".join(ch for ch in unicodedata.normalize("NFKD", clean) if not unicodedata.combining(ch))


def _clean_question(value) -> str:
    if not isinstance(value, str) or not value.strip():
        raise Refused("Type the question first.")
    words = " ".join(value.split())
    if len(words) > 400:
        raise Refused("Keep a question under 400 characters.")
    return words


def _site(conn, site_id) -> dict:
    return require_own(conn, site_id)


# ---- the brand name and the site's market -----------------------------------------------------------

def _setting(conn, name: str) -> str | None:
    return conn.execute(text("SELECT value FROM serp_settings WHERE name = :n"), {"n": name}).scalar()


def brand_of(conn, site: dict) -> tuple[str, bool]:
    """(name, saved). Until the owner saves one, the site's first brand word (the same rows brand_words() reads), else its host."""
    saved = _setting(conn, f"brand_name:{site['id']}")
    if saved:
        return saved, True
    word = conn.execute(text("SELECT pattern FROM site_rules WHERE kind = 'brand' AND (site_id = :s OR site_id IS NULL) ORDER BY site_id IS NULL, id LIMIT 1"), {"s": site["id"]}).scalar()
    if word and word.strip():
        return " ".join(word.split()), False
    return site["host"].split(".")[0].replace("-", " ").title(), False


def save_brand(engine: Engine, site_id, name) -> dict:
    if not isinstance(name, str) or not name.strip():
        raise Refused("Type the company's name.")
    name = " ".join(name.split())
    if len(name) > 80:
        raise Refused("Keep the name under 80 characters.")
    with engine.begin() as conn:
        _site(conn, site_id)
        conn.execute(text("INSERT INTO serp_settings (name, value) VALUES (:n, :v) ON DUPLICATE KEY UPDATE value = :v"), {"n": f"brand_name:{site_id}", "v": name})
    return {"brand": name, "saved": True}


def market_of(conn, site: dict) -> tuple[str, str]:
    """(language, country) the questions are asked in: the site's tracked keywords' most common, else its target country and
    its address's ending."""
    rows = conn.execute(text("SELECT k.language, k.country FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s"), {"s": site["id"]}).all()
    languages = Counter(r[0].lower()[:2] for r in rows if r[0])
    places = Counter(r[1].lower() for r in rows if r[1])
    country = places.most_common(1)[0][0] if places else ""
    if not country:
        three = conn.execute(text("SELECT country FROM site_search_countries WHERE site_id = :s ORDER BY created_at LIMIT 1"), {"s": site["id"]}).scalar()
        country = (countries.alpha2(three) or "").lower() if three else ""
    ending = site["host"].rsplit(".", 1)[-1]
    language = languages.most_common(1)[0][0] if languages else ("fr" if ending in ("fr", "be", "ch", "lu") or country in ("fr", "be", "ch", "lu") else "en")
    if not country and ending in ("fr", "de", "es", "it", "be", "ch", "uk", "ae"):
        country = "gb" if ending == "uk" else ending
    return language, country


# ---- questions ----------------------------------------------------------------------------------------

def _question(row) -> dict:
    return {"id": row["id"], "text": row["text"], "source": row["source"], "active": bool(row["active"])}


def questions(conn, site_id: int) -> list[dict]:
    rows = conn.execute(text("SELECT id, text, source, active FROM brand_questions WHERE site_id = :s ORDER BY id"), {"s": site_id}).mappings().all()
    return [_question(r) for r in rows]


def add_question(engine: Engine, site_id, words, source: str = "owner") -> dict:
    words = _clean_question(words)
    source = source if source in ("owner", "suggested") else "owner"
    with engine.begin() as conn:
        _site(conn, site_id)
        conn.execute(text("SELECT id FROM sites WHERE id = :s FOR UPDATE"), {"s": site_id})
        have = questions(conn, site_id)
        if any(_fold(q["text"]) == _fold(words) for q in have):
            raise Refused("That question is already in the list.")
        if len(have) >= MAX_QUESTIONS:
            raise Refused(f"The list holds at most {MAX_QUESTIONS} questions. Remove one first.")
        active = sum(q["active"] for q in have) < MAX_PER_RUN  # a run asks at most 10: the 11th waits, unticked
        new = conn.execute(text("INSERT INTO brand_questions (site_id, text, source, active) VALUES (:s, :t, :o, :a)"), {"s": site_id, "t": words, "o": source, "a": active}).lastrowid
        row = conn.execute(text("SELECT id, text, source, active FROM brand_questions WHERE id = :i"), {"i": new}).mappings().first()
    return _question(row)


def _own_question(conn, question_id: int) -> dict:
    row = conn.execute(text("SELECT id, site_id, text, source, active FROM brand_questions WHERE id = :i"), {"i": question_id}).mappings().first()
    if row is None:
        raise NotFound("That question isn't there any more.")
    return dict(row)


def edit_question(engine: Engine, question_id: int, body: dict) -> dict:
    with engine.begin() as conn:
        row = _own_question(conn, question_id)
        conn.execute(text("SELECT id FROM sites WHERE id = :s FOR UPDATE"), {"s": row["site_id"]})
        sets, values = [], {"i": question_id}
        if "text" in body:
            words = _clean_question(body["text"])
            if any(_fold(q["text"]) == _fold(words) and q["id"] != question_id for q in questions(conn, row["site_id"])):
                raise Refused("That question is already in the list.")
            sets.append("text = :t")
            values["t"] = words
        if "active" in body:
            if not isinstance(body["active"], bool):
                raise Refused("Asked is yes or no.")
            if body["active"] and not row["active"] and sum(q["active"] for q in questions(conn, row["site_id"])) >= MAX_PER_RUN:
                raise Refused(f"A run asks at most {MAX_PER_RUN} questions. Untick one first.")
            sets.append("active = :a")
            values["a"] = body["active"]
        if not sets:
            raise Refused("Nothing to change.")
        conn.execute(text(f"UPDATE brand_questions SET {', '.join(sets)} WHERE id = :i"), values)
        fresh = conn.execute(text("SELECT id, text, source, active FROM brand_questions WHERE id = :i"), {"i": question_id}).mappings().first()
    return _question(fresh)


def remove_question(engine: Engine, question_id: int) -> None:
    with engine.begin() as conn:
        _own_question(conn, question_id)
        conn.execute(text("DELETE FROM brand_questions WHERE id = :i"), {"i": question_id})


def top_keywords(conn, site_id: int, brand: str, limit: int = 3) -> list[str]:
    """The site's tracked keywords with the most Search Console impressions in 90 days, brand searches left out."""
    rows = conn.execute(
        text(
            "SELECT k.keyword, COALESCE((SELECT SUM(q.impressions) FROM gsc_query q WHERE q.site_id = sk.site_id AND q.query = k.keyword "
            "AND q.day >= UTC_DATE() - INTERVAL 90 DAY), 0) seen FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id "
            "WHERE sk.site_id = :s ORDER BY seen DESC, k.id LIMIT 40"
        ),
        {"s": site_id},
    ).all()
    words = [_fold(w) for w in [brand, *(r[0] for r in conn.execute(text("SELECT pattern FROM site_rules WHERE kind = 'brand' AND (site_id = :s OR site_id IS NULL)"), {"s": site_id}).all())] if w]
    out = []
    for keyword, _seen in rows:
        folded = _fold(keyword)
        if any(w and w in folded for w in words) or folded in (_fold(k) for k in out):
            continue
        out.append(" ".join(keyword.split()))
        if len(out) >= limit:
            break
    return out


def suggestions(engine: Engine, site_id) -> dict:
    """Questions to add, in the site's language: about the brand, then about its top keywords. Those already listed are left out."""
    with engine.connect() as conn:
        site = _site(conn, site_id)
        brand, _saved = brand_of(conn, site)
        language, _country = market_of(conn, site)
        words = SUGGEST["fr" if language == "fr" else "en"]
        found = [w.format(brand=brand) for w in words["brand"]] + [words["keyword"].format(keyword=k) for k in top_keywords(conn, site["id"], brand)]
        have = {_fold(q["text"]) for q in questions(conn, site["id"])}
    return {"suggestions": [w for w in found if _fold(w) not in have], "language": language}


# ---- the price, and starting a run ---------------------------------------------------------------------

def _engine_list(conn_state: dict, wanted=None) -> list[dict]:
    out = []
    for engine_id in E.ORDER:
        spec = E.ENGINES[engine_id]
        if wanted is not None and engine_id not in wanted:
            continue
        out.append({"id": engine_id, "name": spec["name"], "host": spec["host"], "provider": spec["provider"], "connected": bool(conn_state.get(spec["provider"]))})
    return out


def _pick_engines(wanted) -> list[str] | None:
    if wanted is None:
        return None
    if not isinstance(wanted, list) or not wanted or not all(isinstance(e, str) and e in E.ENGINES for e in wanted):
        raise Refused("Pick at least one AI.")
    return list(dict.fromkeys(wanted))


def _asked(conn, site_id: int) -> list[dict]:
    return [q for q in questions(conn, site_id) if q["active"]]


def estimate(engine: Engine, site_id, wanted=None) -> dict:
    """How many answers a run takes, on which AIs, and what each provider charges. Nothing is sent."""
    wanted = _pick_engines(wanted)
    keys = E.connected(engine)
    with engine.connect() as conn:
        site = _site(conn, site_id)
        asked = _asked(conn, site["id"])
        language, country = market_of(conn, site)
        busy = _running(conn, site["id"])
    listed = _engine_list(keys, wanted)
    usable = [e for e in listed if e["connected"]]
    lines = []
    for provider, info in E.PROVIDERS.items():
        mine = [e for e in usable if e["provider"] == provider]
        if not mine:
            continue
        answers = len(mine) * min(len(asked), MAX_PER_RUN)
        lines.append({"provider": provider, "tool": info["tool"], "engines": [e["id"] for e in mine], "answers": answers, "each": str(info["per_answer"]), "currency": info["currency"], "total": str(info["per_answer"] * answers), "price": info["price"]})
    return {
        "questions": len(asked), "max_questions": MAX_PER_RUN, "engines": listed, "usable": [e["id"] for e in usable],
        "missing": sorted({e["provider"] for e in listed if not e["connected"]}), "answers": sum(line["answers"] for line in lines),
        "lines": lines, "language": language, "country": country, "running": busy,
    }


def _running(conn, site_id: int) -> bool:
    return bool(conn.execute(
        text(
            "SELECT 1 FROM brand_runs r WHERE r.site_id = :s AND r.status IN ('queued', 'running') "
            "AND (r.created_at >= UTC_TIMESTAMP(3) - INTERVAL 60 SECOND OR EXISTS (SELECT 1 FROM jobs j WHERE j.active_key = CONCAT('ai_brand:', r.id))) LIMIT 1"
        ),
        {"s": site_id},
    ).first())


def start(engine: Engine, site_id, wanted=None, user_id: int | None = None) -> dict:
    """The owner said yes to the price: one run, its answer rows written before anything is sent, and its job queued."""
    wanted = _pick_engines(wanted)
    priced = estimate(engine, site_id, wanted)
    if not priced["usable"]:
        raise Refused("Paste a Bright Data or Semscraper key in Settings first.")
    if not priced["questions"]:
        raise Refused("Add a question first.")
    if priced["questions"] > MAX_PER_RUN:
        raise Refused(f"A run asks at most {MAX_PER_RUN} questions. Untick some first.")
    with engine.begin() as conn:
        site = _site(conn, site_id)
        conn.execute(text("SELECT id FROM sites WHERE id = :s FOR UPDATE"), {"s": site["id"]}).first()  # a double click makes one run
        if _running(conn, site["id"]):
            raise Conflict("The AIs are already being asked. The answers show here when they're in.")
        asked = _asked(conn, site["id"])
        run_id = conn.execute(
            text("INSERT INTO brand_runs (site_id, status, questions, engines, language, country, estimate, started_by) VALUES (:s, 'queued', :q, :e, :l, :c, :x, :u)"),
            {"s": site["id"], "q": json.dumps([{"id": q["id"], "text": q["text"]} for q in asked], ensure_ascii=False), "e": json.dumps(priced["usable"]),
             "l": priced["language"], "c": priced["country"], "x": json.dumps({"lines": priced["lines"], "answers": priced["answers"]}), "u": user_id},
        ).lastrowid
        for engine_id in priced["usable"]:
            currency = E.PROVIDERS[E.ENGINES[engine_id]["provider"]]["currency"]
            for q in asked:
                conn.execute(text("INSERT INTO brand_answers (run_id, question_id, question, engine, currency) VALUES (:r, :q, :t, :e, :c)"), {"r": run_id, "q": q["id"], "t": q["text"], "e": engine_id, "c": currency})
    queue.enqueue(engine, LANE, JOB_KIND, payload={"run_id": run_id}, dedupe_key=f"ai_brand:{run_id}", max_attempts=3)
    return run_dict(engine, run_id)


# ---- the job ---------------------------------------------------------------------------------------------

def _answers(conn, run_id: int, status: str | None = None) -> list[dict]:
    sql = "SELECT * FROM brand_answers WHERE run_id = :r" + (" AND status = :st" if status else "") + " ORDER BY id"
    return [dict(r) for r in conn.execute(text(sql), {"r": run_id, "st": status}).mappings().all()]


def _ids_update(conn, sql: str, ids: list[int], **values) -> int:
    statement = text(sql).bindparams(bindparam("ids", expanding=True))
    return conn.execute(statement, {"ids": ids, **values}).rowcount


def _fail(engine: Engine, ids: list[int], why: str, from_status: str) -> None:
    if not ids:
        return
    with engine.begin() as conn:
        _ids_update(conn, "UPDATE brand_answers SET status = 'failed', error = :w WHERE id IN :ids AND status = :f", ids, w=why[:500], f=from_status)


def _send(engine: Engine, run: dict, engine_id: str, rows: list[dict]) -> None:
    provider = E.ENGINES[engine_id]["provider"]
    info = E.PROVIDERS[provider]
    ids = [r["id"] for r in rows]
    client = E.client(engine, provider)
    if client is None:
        _fail(engine, ids, f"No {info['tool']} key: paste one in Settings.", "pending")
        return
    with engine.begin() as conn:  # marked first: if the process dies mid-send, these are never sent again
        claimed = _ids_update(conn, "UPDATE brand_answers SET status = 'sending' WHERE id IN :ids AND status = 'pending'", ids)
    if claimed != len(ids):
        return  # another pass took them
    try:
        sent = client.send(engine_id, [r["question"] for r in rows], run["country"], run["language"])
    except E.EngineFailed as exc:
        _fail(engine, ids, str(exc), "sending")
        return
    except Exception as exc:  # noqa: BLE001 - it may have gone out: never sent again, so never paid twice
        _fail(engine, ids, f"{type(exc).__name__}: {exc}. Not sent again, in case it was charged.", "sending")
        return
    for row, (job_id, cost) in zip(rows, sent):
        with engine.begin() as conn:
            if not job_id:
                conn.execute(text("UPDATE brand_answers SET status = 'failed', error = :w WHERE id = :i AND status = 'sending'"), {"w": f"{info['tool']} didn't take this question.", "i": row["id"]})
                continue
            moved = conn.execute(text("UPDATE brand_answers SET status = 'waiting', job_id = :j, cost = :c WHERE id = :i AND status = 'sending'"), {"j": job_id[:120], "c": cost, "i": row["id"]}).rowcount
        if moved and cost:  # Semscraper charges when a question is sent
            connections.count_use(engine, info["tool"], 1, paid=True, cost=cost, run_id=run["id"], search_engine=engine_id[:20], note="What AI says: sent")


def _brand_named(brand: str, words: str) -> bool:
    return bool(brand) and _fold(brand) in _fold(words)


def _save(engine: Engine, run: dict, brand: str, row: dict, reply: E.Reply) -> None:
    provider = E.ENGINES[row["engine"]]["provider"]
    info = E.PROVIDERS[provider]
    if reply.error:
        with engine.begin() as conn:
            conn.execute(text("UPDATE brand_answers SET status = 'failed', error = :w, answered_at = UTC_TIMESTAMP(3) WHERE id = :i AND status = 'waiting'"), {"w": reply.error[:500], "i": row["id"]})
        return
    cost = info["per_answer"] if provider == "brightdata" else Decimal(str(row["cost"] or 0))
    named = _brand_named(brand, reply.text) if reply.text else False
    with engine.begin() as conn:
        moved = conn.execute(
            text("UPDATE brand_answers SET status = 'done', answer_text = :t, sources = :s, brand_named = :b, signed_out = 1, cost = :c, "
                 "answered_at = UTC_TIMESTAMP(3) WHERE id = :i AND status = 'waiting'"),
            {"t": reply.text or NO_ANSWER_TEXT, "s": json.dumps(reply.sources, ensure_ascii=False), "b": named, "c": cost, "i": row["id"]},
        ).rowcount
    if moved and provider == "brightdata":  # billed per answer delivered: counted once, when it arrives
        connections.count_use(engine, info["tool"], 1, paid=True, cost=cost, run_id=run["id"], search_engine=row["engine"][:20], note="What AI says: answer")


def _collect(engine: Engine, run: dict, brand: str, engine_id: str, rows: list[dict]) -> None:
    provider = E.ENGINES[engine_id]["provider"]
    client = E.client(engine, provider)
    if client is None:
        _fail(engine, [r["id"] for r in rows], f"The {E.PROVIDERS[provider]['tool']} key was removed before the answers came.", "waiting")
        return
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row["job_id"] if provider == "brightdata" else "all", []).append(row)
    for group in groups.values():
        try:
            replies = client.collect(engine_id, {r["id"]: (r["job_id"], r["question"]) for r in group})
        except E.EngineFailed as exc:
            _fail(engine, [r["id"] for r in group], str(exc), "waiting")
            continue
        except Exception as exc:  # noqa: BLE001 - tried again on the next pass
            print(f"ai_brand: collect {engine_id} failed: {type(exc).__name__}: {exc}", flush=True)
            continue
        for row in group:
            if row["id"] in replies:
                _save(engine, run, brand, row, replies[row["id"]])


def _read(engine: Engine, run: dict, brand: str, started: float) -> bool:
    """AI's reading of each new answer. True when some are left for the next pass (time ran out)."""
    if ai.provider_of(engine, run["site_id"]) not in ("openrouter", "claude"):
        return False  # the raw answers show; the screen says to pick an AI
    lang = run["language"] if run["language"] in ai.LANGUAGES else "en"
    with engine.connect() as conn:
        todo = [r for r in _answers(conn, run["id"], "done") if r["answer_text"] and r["summary"] is None and r["read_error"] is None]
    for row in todo:
        if time.monotonic() - started > READ_SECONDS:
            return True
        try:
            found = ai.read_brand_answer(engine, run["site_id"], brand, row["question"], row["answer_text"], lang)
        except Refused as exc:
            with engine.begin() as conn:
                conn.execute(text("UPDATE brand_answers SET read_error = :e WHERE id = :i"), {"e": str(exc)[:300], "i": row["id"]})
            continue
        named = found["brand_named"] if isinstance(found["brand_named"], bool) else bool(row["brand_named"])
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE brand_answers SET summary = :s, tone = :t, pros = :p, cons = :c, competitors = :o, brand_named = :b, read_by = :m WHERE id = :i"),
                {"s": found["summary"], "t": found["tone"], "p": json.dumps(found["pros"], ensure_ascii=False), "c": json.dumps(found["cons"], ensure_ascii=False),
                 "o": json.dumps(found["competitors"], ensure_ascii=False), "b": named, "m": f"{found['provider']}: {found['model']}"[:120], "i": row["id"]},
            )
    return False


def _finish(engine: Engine, run_id: int) -> None:
    with engine.begin() as conn:
        rows = _answers(conn, run_id)
        done = sum(r["status"] == "done" for r in rows)
        status = "complete" if done == len(rows) else "partial" if done else "failed"
        usd = sum(Decimal(str(r["cost"] or 0)) for r in rows if r["currency"] == "USD")
        error = None if done else next((r["error"] for r in rows if r["error"]), "No AI answered.")
        conn.execute(text("UPDATE brand_runs SET status = :s, cost = :c, error = :e, finished_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"s": status, "c": usd, "e": (error or None) and error[:500], "i": run_id})


@handler(JOB_KIND)
def run_job(job, engine: Engine) -> None:
    run_id = (job.payload or {}).get("run_id")
    started = time.monotonic()
    with engine.connect() as conn:
        run = conn.execute(text("SELECT *, TIMESTAMPDIFF(MINUTE, created_at, UTC_TIMESTAMP(3)) age FROM brand_runs WHERE id = :i"), {"i": run_id}).mappings().first()
        if run is None or run["status"] in FINAL:
            return
        run = dict(run)
        site = conn.execute(text("SELECT id, host FROM sites WHERE id = :s"), {"s": run["site_id"]}).mappings().first()
        brand = brand_of(conn, dict(site))[0] if site else ""
        stuck = [r["id"] for r in _answers(conn, run_id, "sending")]
    with engine.begin() as conn:
        conn.execute(text("UPDATE brand_runs SET status = 'running' WHERE id = :i AND status = 'queued'"), {"i": run_id})
    _fail(engine, stuck, "Stopped while being sent. Not sent again, in case it was charged.", "sending")
    with engine.connect() as conn:
        pending = _answers(conn, run_id, "pending")
    for engine_id in E.ORDER:
        rows = [r for r in pending if r["engine"] == engine_id]
        if rows:
            _send(engine, run, engine_id, rows)
    with engine.connect() as conn:
        waiting = _answers(conn, run_id, "waiting")
    for engine_id in E.ORDER:
        rows = [r for r in waiting if r["engine"] == engine_id]
        if rows:
            _collect(engine, run, brand, engine_id, rows)
    left = _read(engine, run, brand, started)
    with engine.connect() as conn:
        still = [r["id"] for r in _answers(conn, run_id, "waiting")]
    if still and run["age"] >= GIVE_UP_MINUTES:
        _fail(engine, still, f"No answer after {GIVE_UP_MINUTES} minutes.", "waiting")
        still = []
    if still:
        raise RunAgain(WAIT_SECONDS)
    if left:
        raise RunAgain(0)
    _finish(engine, run_id)


# ---- what the screen reads ---------------------------------------------------------------------------------

def _json(value, default):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return default
    return default if value is None else value


def _is_mine(host: str, mine: str) -> bool:
    return bool(host) and (host == mine or host.endswith("." + mine))


def _iso(value):
    return value.isoformat() if value is not None else None


def _answer_dict(row: dict, mine: str) -> dict:
    sources = [{**s, "mine": _is_mine(s.get("host", ""), mine)} for s in _json(row["sources"], []) if isinstance(s, dict)]
    return {
        "id": row["id"], "question_id": row["question_id"], "question": row["question"], "engine": row["engine"],
        "engine_name": E.ENGINES.get(row["engine"], {}).get("name", row["engine"]), "status": row["status"],
        "answer_text": row["answer_text"], "no_answer": row["status"] == "done" and not row["answer_text"], "signed_out": bool(row["signed_out"]),
        "sources": sources, "brand_named": None if row["brand_named"] is None else bool(row["brand_named"]), "summary": row["summary"], "tone": row["tone"],
        "pros": _json(row["pros"], []), "cons": _json(row["cons"], []), "competitors": _json(row["competitors"], []),
        "read_by": row["read_by"], "read_error": row["read_error"], "error": row["error"], "cost": str(row["cost"] or 0), "currency": row["currency"],
        "answered_at": _iso(row["answered_at"]),
    }


def ranked_sources(answers: list[dict], rivals: tuple[str, ...] = ()) -> list[dict]:
    """Each site cited, by how many answers cite it, with the AIs that did (and how many answers each), its addresses and its
    group: mine, competitor (a tracked competitor's site), social (SOCIAL_HOSTS) or other."""
    found: dict[str, dict] = {}
    for a in answers:
        for s in a["sources"]:
            host = s.get("host")
            if not host:
                continue
            item = found.setdefault(host, {"host": host, "answers": 0, "engines": [], "by_engine": {}, "urls": [], "mine": s.get("mine", False),
                                           "group": source_group(host, bool(s.get("mine")), rivals), "seen": set()})
            if a["id"] not in item["seen"]:
                item["seen"].add(a["id"])
                item["answers"] += 1
                item["by_engine"][a["engine"]] = item["by_engine"].get(a["engine"], 0) + 1
            if a["engine"] not in item["engines"]:
                item["engines"].append(a["engine"])
            if s.get("url") and s["url"] not in [u["url"] for u in item["urls"]]:
                item["urls"].append({"url": s["url"], "title": s.get("title") or ""})
    out = [{k: v for k, v in item.items() if k != "seen"} for item in found.values()]
    out.sort(key=lambda x: (-x["answers"], not x["mine"], x["host"]))
    for item in out:
        item["urls"] = item["urls"][:8]
    return out


# ---- the combined picture: one verdict, one row per AI, points, competitors, source groups --------------------------------
# Tone as a number: each answer that names the company counts positive = 1, neutral = 0.5, negative = 0; the score is their
# average as a whole percent ("80% positive"). Answers that don't name the company, or weren't read by an AI, don't count.
TONE_SCORE = {"positive": 1.0, "neutral": 0.5, "negative": 0.0}
# Sites counted as "Social & forums" in the source groups (a subdomain counts too: m.youtube.com, old.reddit.com).
SOCIAL_HOSTS = ("youtube.com", "youtu.be", "reddit.com", "facebook.com", "linkedin.com", "x.com", "twitter.com", "instagram.com",
                "tiktok.com", "quora.com", "trustpilot.com")
GROUPS = ("mine", "competitor", "social", "other")


def source_group(host: str, mine: bool, rivals: tuple[str, ...] = ()) -> str:
    host = (host or "").lower().removeprefix("www.")
    if mine:
        return "mine"
    if any(_is_mine(host, r) for r in rivals):
        return "competitor"
    if any(_is_mine(host, s) for s in SOCIAL_HOSTS):
        return "social"
    return "other"


def tone_score(answers: list[dict]) -> int | None:
    scores = [TONE_SCORE[a["tone"]] for a in answers if a.get("brand_named") and a.get("tone") in TONE_SCORE]
    return round(100 * sum(scores) / len(scores)) if scores else None


def tone_word(score: int | None) -> str | None:
    """The small label beside the number: positive from 67 %, negative up to 33 %, mixed between (neutral when every answer was)."""
    if score is None:
        return None
    return "positive" if score >= 67 else "negative" if score <= 33 else "neutral" if score == 50 else "mixed"


def point_key(words: str) -> str:
    """Two points are the same when they match once folded (case, accents), with punctuation and extra spaces dropped."""
    return " ".join("".join(ch if ch.isalnum() else " " for ch in _fold(words)).split())


def grouped_points(answers: list[dict], field: str) -> list[dict]:
    """The same strength (or weak point) said by several AIs, once, ranked by how many AIs said it, then by how many answers."""
    found: dict[str, dict] = {}
    for a in answers:
        for words in a.get(field) or []:
            key = point_key(words)
            if not key:
                continue
            item = found.setdefault(key, {"key": key, "text": words, "engines": [], "answers": []})
            if a["engine"] not in item["engines"]:
                item["engines"].append(a["engine"])
            if a["id"] not in [x["id"] for x in item["answers"]]:
                item["answers"].append({"id": a["id"], "engine": a["engine"], "question": a["question"]})
    out = list(found.values())
    for item in out:
        item["ais"] = len(item["engines"])
    out.sort(key=lambda x: (-x["ais"], -len(x["answers"]), x["key"]))
    return out


def named_competitors(answers: list[dict], brand: str = "") -> list[dict]:
    """The other companies the AIs named, ranked by how many AIs named each. The company itself is left out."""
    own = point_key(brand)
    found: dict[str, dict] = {}
    for a in answers:
        for name in a.get("competitors") or []:
            key = point_key(name)
            if not key or (own and key == own):
                continue
            item = found.setdefault(key, {"name": name, "engines": [], "answers": 0, "by_engine": {}, "seen": set()})
            if a["engine"] not in item["engines"]:
                item["engines"].append(a["engine"])
            if a["id"] not in item["seen"]:
                item["seen"].add(a["id"])
                item["answers"] += 1
                item["by_engine"][a["engine"]] = item["by_engine"].get(a["engine"], 0) + 1
    out = [{**{k: v for k, v in item.items() if k != "seen"}, "ais": len(item["engines"])} for item in found.values()]
    out.sort(key=lambda x: (-x["ais"], -x["answers"], point_key(x["name"])))
    return out


def per_engine(answers: list[dict], engines: list[str]) -> list[dict]:
    """One row per AI asked: does it name you, its tone as a number, does it cite your site (in how many answers), how many sites."""
    rows = []
    for engine_id in engines:
        mine = [a for a in answers if a["engine"] == engine_id]
        done = [a for a in mine if a["status"] == "done"]
        said = [a for a in done if a["answer_text"]]
        score = tone_score(said)
        rows.append({
            "engine": engine_id, "name": E.ENGINES.get(engine_id, {}).get("name", engine_id), "host": E.ENGINES.get(engine_id, {}).get("host", ""),
            "asked": len(mine), "answered": len(said), "no_answer": len(done) - len(said), "failed": sum(a["status"] == "failed" for a in mine),
            "named": sum(bool(a["brand_named"]) for a in said), "tone_score": score, "tone_word": tone_word(score), "tone_before": None, "tone_change": None,
            "cited_mine": sum(any(s.get("mine") for s in a["sources"]) for a in said),
            "sources": len({s["host"] for a in said for s in a["sources"] if s.get("host")}),
        })
    return rows


def picture(answers: list[dict], engines: list[str], sources: list[dict], brand: str = "") -> dict:
    """Everything the screen's combined view needs, worked out once here. The screen filters it by AI."""
    said = [a for a in answers if a["status"] == "done" and a["answer_text"]]
    rows = per_engine(answers, engines)
    answered = [r for r in rows if r["answered"]]
    score = tone_score(said)
    groups = {g: {"sites": 0, "citations": 0} for g in GROUPS}
    for s in sources:
        groups[s["group"]]["sites"] += 1
        groups[s["group"]]["citations"] += s["answers"]
    return {
        "named_by": sum(1 for r in answered if r["named"]), "answered_by": len(answered), "answers": len(said),
        "named_answers": sum(bool(a["brand_named"]) for a in said), "cited_mine": sum(any(s.get("mine") for s in a["sources"]) for a in said),
        "tone_score": score, "tone_word": tone_word(score), "tone_before": None, "tone_change": None,
        "engines": rows, "pros": grouped_points(said, "pros"), "cons": grouped_points(said, "cons"),
        "competitors": named_competitors(said, brand), "source_groups": groups,
    }


def _rivals(conn, site_id: int) -> tuple[str, ...]:
    hosts = conn.execute(text("SELECT s.host FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s"), {"s": site_id}).scalars().all()
    return tuple(h.lower().removeprefix("www.") for h in hosts if h)


def run_dict(engine: Engine, run_id: int, mine: str | None = None) -> dict:
    with engine.connect() as conn:
        run = conn.execute(text("SELECT r.*, s.host FROM brand_runs r JOIN sites s ON s.id = r.site_id WHERE r.id = :i"), {"i": run_id}).mappings().first()
        if run is None:
            raise NotFound("That run isn't there any more.")
        rows = _answers(conn, run_id)
        rivals = _rivals(conn, run["site_id"])
        brand = brand_of(conn, {"id": run["site_id"], "host": run["host"]})[0]
    answers = [_answer_dict(r, mine or run["host"]) for r in rows]
    costs: dict[str, Decimal] = {}
    for a in answers:
        costs[a["currency"]] = costs.get(a["currency"], Decimal("0")) + Decimal(a["cost"])
    states = Counter(a["status"] for a in answers)
    engines = _json(run["engines"], [])
    sources = ranked_sources([a for a in answers if a["status"] == "done"], rivals)
    return {
        "id": run["id"], "site_id": run["site_id"], "status": run["status"], "created_at": _iso(run["created_at"]), "finished_at": _iso(run["finished_at"]),
        "error": run["error"], "engines": engines, "questions": _json(run["questions"], []), "language": run["language"], "country": run["country"],
        "estimate": _json(run["estimate"], {}), "costs": {k: str(v) for k, v in costs.items()},
        "total": len(answers), "done": states["done"], "failed": states["failed"], "waiting": states["pending"] + states["sending"] + states["waiting"],
        "answers": answers, "sources": sources, "picture": picture(answers, engines, sources, brand),
    }


def _tone_against(now: dict, then: dict) -> None:
    """The tone's change against the run before, overall and per AI, in points ("80% positive ▲13")."""
    def diff(a, b):
        return None if a is None or b is None else a - b
    now["tone_before"] = then["tone_score"]
    now["tone_change"] = diff(now["tone_score"], then["tone_score"])
    before = {r["engine"]: r for r in then["engines"]}
    for row in now["engines"]:
        old = before.get(row["engine"])
        row["tone_before"] = old["tone_score"] if old else None
        row["tone_change"] = diff(row["tone_score"], row["tone_before"])


def state(engine: Engine, site_id) -> dict:
    """Everything the tab shows: the brand, the questions, which keys are there, the latest run and what changed since the one before."""
    keys = E.connected(engine)
    with engine.connect() as conn:
        site = _site(conn, site_id)
        brand, saved = brand_of(conn, site)
        language, country = market_of(conn, site)
        listed = questions(conn, site["id"])
        runs = conn.execute(text("SELECT id, status FROM brand_runs WHERE site_id = :s ORDER BY id DESC LIMIT 20"), {"s": site["id"]}).mappings().all()
        busy = _running(conn, site["id"])
    finished = [r["id"] for r in runs if r["status"] in ("complete", "partial")]
    running = next((r["id"] for r in runs if r["status"] in ("queued", "running")), None) if busy else None
    last = run_dict(engine, finished[0]) if finished else None
    since = None
    if last and len(finished) > 1:
        before = run_dict(engine, finished[1])
        now_hosts, then_hosts = {s["host"] for s in last["sources"]}, {s["host"] for s in before["sources"]}
        since = {"previous_at": before["created_at"], "new": sorted(now_hosts - then_hosts), "lost": sorted(then_hosts - now_hosts)}
        _tone_against(last["picture"], before["picture"])
    failed_last = None
    if runs and runs[0]["status"] == "failed":
        failed_last = run_dict(engine, runs[0]["id"])
    return {
        "site_id": site["id"], "host": site["host"], "brand": brand, "brand_saved": saved, "language": language, "country": country,
        "reader": ai.provider_of(engine, site["id"]), "questions": listed, "max_questions": MAX_PER_RUN, "max_list": MAX_QUESTIONS,
        "engines": _engine_list(keys), "keys": keys, "running": run_dict(engine, running) if running else None,
        "last": last, "since": since, "failed": failed_last,
    }
