"""Bing, Yandex, Clarity, PageSpeed and Open PageRank. Written from each one's documentation and tested on fakes: none has run on a real key yet.

Clarity's field names come from the Clarity project's own parser, which has read real answers.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from sqlalchemy import Engine, text

from seo.collectors import common, http
from seo.collectors.http import SourceError
from seo.core import crypto
from seo.sources import service

# ---- Bing ----------------------------------------------------------------------------------------
BING = "https://ssl.bing.com/webmaster/api.svc/json"
_MS_DATE = re.compile(r"/Date\((-?\d+)")


def _bing_day(value):
    match = _MS_DATE.search(str(value or ""))
    return datetime.fromtimestamp(int(match.group(1)) / 1000, tz=timezone.utc).date() if match else None


def collect_bing(engine: Engine, site_id: int) -> bool:
    src = common.source_row(engine, site_id, "bing")
    key = service.app_key(engine, "bing")
    if not key:
        raise SourceError("auth", "Bing Webmaster has no key.")
    site_url = src["property"] or f"https://{src['host']}/"
    params = {"siteUrl": site_url, "apikey": key}
    stats = http.request("GET", f"{BING}/GetRankAndTrafficStats", "Bing Webmaster", params=params).json().get("d") or []
    queries = http.request("GET", f"{BING}/GetQueryStats", "Bing Webmaster", params=params).json().get("d") or []
    through = None
    # Bing gives several weeks of one query. The newest row is what it says now.
    newest: dict[str, dict] = {}
    for row in queries:
        text_value = str(row.get("Query") or "")
        if not text_value:
            continue
        when = _bing_day(row.get("Date"))
        held = newest.get(text_value)
        if held is None or (when and held["when"] and when > held["when"]):
            newest[text_value] = {"when": when, "row": row}
    with engine.begin() as conn:
        for row in stats:
            day = _bing_day(row.get("Date"))
            if day is None:
                continue
            through = max(through, day) if through else day
            conn.execute(
                text("INSERT INTO bing_daily (site_id, day, clicks, impressions) VALUES (:s, :d, :c, :i) ON DUPLICATE KEY UPDATE clicks = :c, impressions = :i"),
                {"s": site_id, "d": day, "c": int(row.get("Clicks") or 0), "i": int(row.get("Impressions") or 0)},
            )
        for query, held in newest.items():
            row = held["row"]
            conn.execute(
                text(
                    "INSERT INTO bing_query (site_id, query_hash, query, clicks, impressions, position, seen_at) VALUES (:s, :h, :q, :c, :i, :p, UTC_TIMESTAMP(3)) "
                    "ON DUPLICATE KEY UPDATE clicks = :c, impressions = :i, position = :p, seen_at = UTC_TIMESTAMP(3)"
                ),
                {"s": site_id, "h": common.digest(query), "q": query[:500], "c": int(row.get("Clicks") or 0), "i": int(row.get("Impressions") or 0), "p": row.get("AvgImpressionPosition")},
            )
    service.note_app_key(engine, "bing", None)
    common.succeeded(engine, site_id, "bing", through)
    return True


# ---- Yandex --------------------------------------------------------------------------------------
YANDEX = "https://api.webmaster.yandex.net/v4"
YANDEX_MOST = 3000
YANDEX_PAGE = 500


def collect_yandex(engine: Engine, site_id: int) -> bool:
    src = common.source_row(engine, site_id, "yandex")
    token = service.app_key(engine, "yandex")
    if not token:
        raise SourceError("auth", "Yandex Webmaster has no token.")
    headers = {"Authorization": f"OAuth {token}"}
    user_id = http.request("GET", f"{YANDEX}/user", "Yandex Webmaster", headers=headers).json().get("user_id")
    host_id = src["property"] or f"https:{src['host']}:443"
    rows = []
    offset = 0
    while offset < YANDEX_MOST:
        body = http.request(
            "GET", f"{YANDEX}/user/{user_id}/hosts/{quote(host_id, safe=':')}/search-queries/popular", "Yandex Webmaster", headers=headers,
            params=[("order_by", "TOTAL_SHOWS"), ("query_indicator", "TOTAL_SHOWS"), ("query_indicator", "TOTAL_CLICKS"), ("query_indicator", "AVG_SHOW_POSITION"), ("limit", YANDEX_PAGE), ("offset", offset)],
        ).json()
        batch = body.get("queries") or []
        rows.extend(batch)
        offset += len(batch)
        if not batch or offset >= int(body.get("count") or 0):
            break
    with engine.begin() as conn:
        for row in rows:
            query, numbers = str(row.get("query_text") or ""), row.get("indicators") or {}
            if not query:
                continue
            conn.execute(
                text(
                    "INSERT INTO yandex_query (site_id, query_hash, query, shows, clicks, position, seen_at) VALUES (:s, :h, :q, :w, :c, :p, UTC_TIMESTAMP(3)) "
                    "ON DUPLICATE KEY UPDATE shows = :w, clicks = :c, position = :p, seen_at = UTC_TIMESTAMP(3)"
                ),
                {"s": site_id, "h": common.digest(query), "q": query[:500], "w": int(numbers.get("TOTAL_SHOWS") or 0), "c": int(numbers.get("TOTAL_CLICKS") or 0), "p": numbers.get("AVG_SHOW_POSITION")},
            )
    service.note_app_key(engine, "yandex", None)
    common.succeeded(engine, site_id, "yandex", common.today(engine))
    return True


# ---- Clarity -------------------------------------------------------------------------------------
CLARITY = "https://www.clarity.ms/export-data/api/v1/project-live-insights"


def _clarity_blocks(payload) -> dict[str, list[dict]]:
    return {str(block.get("metricName")): block.get("information") or [] for block in payload if isinstance(block, dict)} if isinstance(payload, list) else {}


def _number(row: dict, *names):
    for name in names:
        if row.get(name) not in (None, ""):
            try:
                return float(row[name])
            except (TypeError, ValueError):
                return None
    return None


def collect_clarity(engine: Engine, site_id: int) -> bool:
    """Two requests of the 10 a project allows per day, and one pass per UTC day: the caller checks that."""
    src = common.source_row(engine, site_id, "clarity")
    if not src["secret"]:
        raise SourceError("auth", "This site has no Clarity token.")
    try:
        token = crypto.decrypt(src["secret"])
    except (crypto.MissingKey, crypto.UnsafeKeyFile, crypto.BadKey) as exc:
        raise SourceError("auth", str(exc)) from exc
    headers = {"Authorization": f"Bearer {token}"}
    totals = http.request("GET", CLARITY, "Clarity", headers=headers, params={"numOfDays": "1"}).json()
    sources = http.request("GET", CLARITY, "Clarity", headers=headers, params={"numOfDays": "1", "dimension1": "Source"}).json()
    blocks = _clarity_blocks(totals)
    first = lambda name: (blocks.get(name) or [{}])[0]  # noqa: E731
    sessions = _number(first("Traffic"), "totalSessionCount")
    scroll = _number(first("ScrollDepth"), "averageScrollDepth")
    rage = _number(first("RageClickCount"), "subTotal", "sessionsCount")
    dead = _number(first("DeadClickCount"), "subTotal", "sessionsCount")
    referrers = [{"source": row.get("Source"), "sessions": _number(row, "totalSessionCount")} for row in _clarity_blocks(sources).get("Traffic", []) if row.get("Source")]
    day = common.today(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO clarity_daily (site_id, day, sessions, scroll_depth, rage_clicks, dead_clicks, referrers, raw) VALUES (:s, :d, :n, :c, :r, :x, :f, :w) "
                "ON DUPLICATE KEY UPDATE sessions = :n, scroll_depth = :c, rage_clicks = :r, dead_clicks = :x, referrers = :f, raw = :w"
            ),
            {"s": site_id, "d": day, "n": sessions, "c": scroll, "r": rage, "x": dead, "f": json.dumps(referrers, ensure_ascii=False), "w": json.dumps(totals, ensure_ascii=False)},
        )
        common.save_coverage(conn, site_id, "clarity", day, 1)
    common.succeeded(engine, site_id, "clarity", day)
    return True


# ---- PageSpeed -----------------------------------------------------------------------------------
PAGESPEED = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


def _pagespeed_run(url: str, strategy: str, key: str | None) -> dict:
    params = {"url": url, "strategy": strategy, "category": "performance"}
    if key:
        params["key"] = key
    body = http.request("GET", PAGESPEED, "PageSpeed Insights", timeout=120, params=params).json()
    light = body.get("lighthouseResult") or {}
    score = ((light.get("categories") or {}).get("performance") or {}).get("score")
    field = ((body.get("loadingExperience") or {}).get("metrics")) or {}
    audits = light.get("audits") or {}
    pick = lambda name: (field.get(name) or {}).get("percentile")  # noqa: E731
    lab = lambda name: (audits.get(name) or {}).get("numericValue")  # noqa: E731
    has_field = pick("LARGEST_CONTENTFUL_PAINT_MS") is not None
    cls = pick("CUMULATIVE_LAYOUT_SHIFT_SCORE")
    return {
        "performance": round(score * 100) if isinstance(score, (int, float)) else None,  # always the lab test's score
        "lcp": pick("LARGEST_CONTENTFUL_PAINT_MS") if has_field else (round(lab("largest-contentful-paint")) if lab("largest-contentful-paint") is not None else None),
        "inp": pick("INTERACTION_TO_NEXT_PAINT") if has_field else None,
        "cls": (cls / 100 if cls is not None else None) if has_field else lab("cumulative-layout-shift"),
        "field": has_field,
        # Too few visitors on the page: Google answers with the whole site's and says so. Kept apart, never as the page's.
        "origin": has_field and bool((body.get("loadingExperience") or {}).get("origin_fallback")),
    }


def collect_pagespeed(engine: Engine, site_id: int) -> bool:
    """Home page, phone and computer. It works with no key, with a smaller limit, so a missing key isn't an error."""
    src = common.source_row(engine, site_id, "pagespeed")
    key = service.app_key(engine, "pagespeed")
    url = src["property"] or src["start_url"]
    for strategy in ("mobile", "desktop"):
        run = _pagespeed_run(url, strategy, key)
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO cwv_runs (site_id, url, strategy, performance, lcp_ms, inp_ms, cls, field_data, field_origin) VALUES (:s, :u, :t, :p, :l, :i, :c, :f, :o)"),
                {"s": site_id, "u": url, "t": strategy, "p": run["performance"], "l": run["lcp"], "i": run["inp"], "c": run["cls"], "f": run["field"], "o": run["origin"]},
            )
    if key:
        service.note_app_key(engine, "pagespeed", None)
    common.succeeded(engine, site_id, "pagespeed", common.today(engine))
    return True


# ---- Open PageRank -------------------------------------------------------------------------------
OPEN_PAGERANK = "https://openpagerank.keywordseverywhere.com/v1/domains/bulk"
OPR_BATCH = 100


def _opr_rows(body) -> list[dict]:
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for name in ("data", "response", "results", "domains"):
            if isinstance(body.get(name), list):
                return body[name]
    return []


def collect_authority(engine: Engine, month: str) -> int:
    """Every domain the app knows, once a month. How many were scored."""
    key = service.app_key(engine, "openpagerank")
    if not key:
        return 0
    with engine.connect() as conn:
        domains = [row[0] for row in conn.execute(
            text(
                "SELECT d FROM (SELECT host AS d FROM sites UNION SELECT domain AS d FROM backlinks) known "
                "WHERE d NOT IN (SELECT domain FROM authority_monthly WHERE month = :m) ORDER BY d LIMIT 3000"
            ), {"m": month}).all()]
    done = 0
    for begin in range(0, len(domains), OPR_BATCH):
        batch = domains[begin:begin + OPR_BATCH]
        body = http.request("POST", OPEN_PAGERANK, "Open PageRank", headers={"Authorization": f"Bearer {key}"}, json={"domains": batch}).json()
        with engine.begin() as conn:
            for row in _opr_rows(body):
                domain = str(row.get("domain") or "").lower()
                score = row.get("page_rank_decimal", row.get("open_page_rank", row.get("score")))
                if domain not in batch:
                    continue
                conn.execute(
                    text("INSERT INTO authority_monthly (domain, month, score) VALUES (:d, :m, :s) ON DUPLICATE KEY UPDATE score = :s"),
                    {"d": domain, "m": month, "s": score if isinstance(score, (int, float)) else None},
                )
                done += 1
            # A domain it had no answer for has been asked, so it isn't asked again every hour this month.
            for domain in batch:
                conn.execute(text("INSERT IGNORE INTO authority_monthly (domain, month, score) VALUES (:d, :m, NULL)"), {"d": domain, "m": month})
    service.note_app_key(engine, "openpagerank", None)
    return done
