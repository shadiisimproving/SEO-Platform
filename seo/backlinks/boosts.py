"""Boost URL (plan-seo-command-center-mickaz-features-and-ai-brand.md, step 4): traffic sent to one of my pages on purpose
(ads, social, a newsletter, a traffic service), from a start day to an end day, or still running.

Each boost shows what happened:
- visits to that page in Google Analytics (ga4_page_daily, by path) during the boost against the same number of days just
  before it. While it runs, "during" is up to yesterday;
- for each keyword it names, the Search Console position over the 28 days before the start against the 28 days from the
  start (bought.py's rule: the days after must be final, else "waiting"; too few impressions, "few").
It is drawn as a band on the keyword charts (metrics/keyword_timeline.py)."""
from __future__ import annotations

from datetime import date, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.backlinks.bought import _compare, _last_final, currency_in
from seo.backlinks.service import parse_price
from seo.competitors.keywords import require_own
from seo.core.errors import NotFound, Refused
from seo.metrics import countries
from seo.serp import store

SOURCES = ("ads", "social", "newsletter", "traffic service", "other")
MAX_KEYWORDS = 10
FIELDS = {"site_id", "url", "keywords", "started", "ended", "source", "billed_text", "cost_text", "note"}


def _date(value, words: str, required: bool = True) -> date | None:
    if value in (None, "") and not required:
        return None
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise Refused(words) from None


def _clean(conn, body: dict) -> dict:
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    extra = sorted(set(body) - FIELDS)
    if extra:
        raise Refused(f"Only {', '.join(sorted(FIELDS))} are accepted.")
    site_id = body.get("site_id")
    if type(site_id) is not int:
        raise Refused("site_id must be a number.")
    site = require_own(conn, site_id)
    url = str(body.get("url") or "").strip()
    parts = urlsplit(url if "//" in url else f"https://{url}")
    host = (parts.hostname or "").lower().removeprefix("www.")
    if not url or host != site["host"].lower().removeprefix("www."):
        raise Refused(f"The page must be on {site['host']}.")
    if len(url) > 2048:
        raise Refused("That web address is too long.")
    words = body.get("keywords") or []
    if isinstance(words, str):
        words = [w for w in (x.strip() for x in words.replace(",", "\n").split("\n")) if w]
    if not isinstance(words, list) or any(not isinstance(w, str) for w in words):
        raise Refused("Keywords must be a list of words.")
    kept: dict[str, str] = {}
    for word in words:  # the same keyword typed twice, in other capitals, is one
        clean = store.clean_keyword(word)[:250]
        if clean and clean.casefold() not in kept:
            kept[clean.casefold()] = clean
    words = list(kept.values())[:MAX_KEYWORDS]
    started = _date(body.get("started"), "The start day must be a date.")
    ended = _date(body.get("ended"), "The end day must be a date.", required=False)
    if ended and ended < started:
        raise Refused("The end day comes before the start day.")
    source = str(body.get("source") or "").strip()[:120] or None
    texts = {k: (str(body.get(k) or "").strip()[:60] or None) for k in ("billed_text", "cost_text")}
    for key, label in (("billed_text", "billed"), ("cost_text", "cost")):
        if texts[key] and parse_price(texts[key]) is None:
            raise Refused(f"The {label} price must be a number.")
    note = str(body.get("note") or "").strip()[:5000] or None
    return {
        "site_id": site_id, "url": url if "//" in url else f"https://{url}", "keywords": words, "started": started, "ended": ended, "source": source,
        "billed_text": texts["billed_text"], "billed": parse_price(texts["billed_text"]) if texts["billed_text"] else None,
        "cost_text": texts["cost_text"], "cost": parse_price(texts["cost_text"]) if texts["cost_text"] else None, "note": note,
    }


def add(engine: Engine, body: dict, by: str | None = None) -> dict:
    import json

    with engine.begin() as conn:
        row = _clean(conn, body)
        new_id = conn.execute(
            text("INSERT INTO traffic_boosts (site_id, url, keywords, started, ended, source, billed_text, billed, cost_text, cost, note, created_by) "
                 "VALUES (:site_id, :url, :keywords, :started, :ended, :source, :billed_text, :billed, :cost_text, :cost, :note, :by)"),
            {**row, "keywords": json.dumps(row["keywords"], ensure_ascii=False), "by": by},
        ).lastrowid
    return one(engine, new_id)


def update(engine: Engine, boost_id: int, body: dict) -> dict:
    import json

    with engine.begin() as conn:
        old = conn.execute(text("SELECT site_id FROM traffic_boosts WHERE id = :i"), {"i": boost_id}).scalar()
        if old is None:
            raise NotFound("That boost is gone.")
        row = _clean(conn, body)
        if row["site_id"] != old:
            raise Refused("A boost stays on its site.")
        conn.execute(
            text("UPDATE traffic_boosts SET url = :url, keywords = :keywords, started = :started, ended = :ended, source = :source, billed_text = :billed_text, billed = :billed, "
                 "cost_text = :cost_text, cost = :cost, note = :note WHERE id = :id"),
            {**row, "keywords": json.dumps(row["keywords"], ensure_ascii=False), "id": boost_id},
        )
    return one(engine, boost_id)


def delete(engine: Engine, boost_id: int) -> None:
    with engine.begin() as conn:
        site_id = conn.execute(text("SELECT site_id FROM traffic_boosts WHERE id = :i"), {"i": boost_id}).scalar()
        if site_id is None:
            raise NotFound("That boost is gone.")
        require_own(conn, site_id)
        conn.execute(text("DELETE FROM traffic_boosts WHERE id = :i"), {"i": boost_id})


def _paths(url: str) -> list[str]:
    path = urlsplit(url).path or "/"
    bare = path.rstrip("/") or "/"
    return list(dict.fromkeys([bare, f"{bare}/" if bare != "/" else "/", path]))


def _visits(conn, site_id: int, url: str, start: date, end: date) -> int | None:
    row = conn.execute(
        text("SELECT SUM(sessions), COUNT(*) FROM ga4_page_daily WHERE site_id = :s AND day BETWEEN :a AND :b AND path IN :p"),
        {"s": site_id, "a": start, "b": end, "p": tuple(_paths(url))},
    ).first()
    return int(row[0] or 0)


def _result(conn, row: dict, last_final: date | None, ga4_through: date | None, codes: dict) -> dict:
    today = date.today()
    end = min(row["ended"] or today - timedelta(days=1), ga4_through or today - timedelta(days=1))
    visits = None
    if ga4_through and end >= row["started"]:
        days = (end - row["started"]).days + 1
        visits = {
            "during": _visits(conn, row["site_id"], row["url"], row["started"], end),
            "before": _visits(conn, row["site_id"], row["url"], row["started"] - timedelta(days=days), row["started"] - timedelta(days=1)),
            "days": days, "through": str(end),
        }
    positions = []
    for word in row["keywords"]:
        code3 = codes.get(store.clean_keyword(word).casefold())
        positions.append({"keyword": word, **_compare(conn, row["site_id"], word, code3, row["started"], last_final)})
    return {"visits": visits, "positions": positions, "running": row["ended"] is None or row["ended"] >= today}


def _as_dict(row) -> dict:
    import json

    words = row["keywords"]
    if isinstance(words, str):
        try:
            words = json.loads(words)
        except ValueError:
            words = []
    return {
        "id": row["id"], "site_id": row["site_id"], "url": row["url"], "keywords": words or [], "started": row["started"], "ended": row["ended"],
        "source": row["source"], "billed_text": row["billed_text"], "billed": float(row["billed"]) if row["billed"] is not None else None,
        "cost_text": row["cost_text"], "cost": float(row["cost"]) if row["cost"] is not None else None, "note": row["note"],
        "currency": currency_in(row["cost_text"]) or currency_in(row["billed_text"]), "created_by": row["created_by"],
    }


def _listing(conn, site_id: int, boost_id: int | None = None) -> list[dict]:
    clause = "AND id = :i" if boost_id is not None else ""
    rows = [_as_dict(r) for r in conn.execute(text(f"SELECT * FROM traffic_boosts WHERE site_id = :s {clause} ORDER BY started DESC, id DESC"), {"s": site_id, "i": boost_id}).mappings()]
    last_final = _last_final(conn, site_id)
    ga4_through = conn.execute(text("SELECT MAX(day) FROM ga4_page_daily WHERE site_id = :s"), {"s": site_id}).scalar()
    codes = {
        store.clean_keyword(r["keyword"]).casefold(): countries.alpha3(r["country"]) if r["country"] else None
        for r in conn.execute(text("SELECT k.keyword, k.country FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s"), {"s": site_id}).mappings()
    }
    out = []
    for row in rows:
        result = _result(conn, row, last_final, ga4_through, codes)
        out.append({**row, "started": str(row["started"]), "ended": str(row["ended"]) if row["ended"] else None, "result": result})
    return out


def listing(engine: Engine, site_id: int) -> dict:
    with engine.connect() as conn:
        require_own(conn, site_id)
        return {"site_id": site_id, "boosts": _listing(conn, site_id), "sources": list(SOURCES)}


def one(engine: Engine, boost_id: int) -> dict:
    with engine.connect() as conn:
        site_id = conn.execute(text("SELECT site_id FROM traffic_boosts WHERE id = :i"), {"i": boost_id}).scalar()
        if site_id is None:
            raise NotFound("That boost is gone.")
        require_own(conn, site_id)
        return _listing(conn, site_id, boost_id)[0]
