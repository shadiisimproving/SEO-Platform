"""Clarity's own dashboard downloads (Dashboard → Export), one CSV per site.

Clarity exports two kinds of file. Both hold totals for one whole period, never days:
- "dashboard": sessions, bots, scroll depth, insights (rage and dead clicks...), browsers, top pages, smart events,
  referrers, JavaScript errors, page speed and bot types.
- "ai": Copilot's citations of the site, its share of authority, the questions asked (when Clarity includes them),
  the pages cited and AI referral visits.

So they are stored as snapshots in `clarity_reports`, never spread over days in `clarity_daily`: splitting a total
into days would invent numbers. The site is found from the page addresses in the file, since the project name is
whatever someone typed in Clarity. Uploading the same site, kind and period again replaces the snapshot, keeping any
section the new file left out (Clarity's AI download sometimes has the questions table and sometimes not).
"""
from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter
from datetime import date, datetime, timedelta

from sqlalchemy import Engine, bindparam, text

from seo.core.errors import Refused
from seo.links.urls import host_key

MAX_BYTES = 2 * 1024 * 1024
MAX_FILES = 20
_MAX_ROWS = 500
_MAX_TEXT = 500
DASHBOARD, AI = "dashboard", "ai"
NOT_CLARITY = "This isn't a Clarity dashboard download. In Clarity, open Dashboard and press Export."

_RANGE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\b.*?-\s*(\d{1,2})/(\d{1,2})/(\d{4})\b")
_INSIGHTS = {"Rage clicks": "rage_clicks", "Dead click": "dead_clicks", "Dead clicks": "dead_clicks", "Excessive scrolling": "excessive_scrolling", "Quick back click": "quick_back"}
_BOTS = {
    "webScraperBotSessions": "web_scraper", "suspiciousDeviceBotSessions": "suspicious_device", "suspiciousNetworkBotSessions": "suspicious_network",
    "suspiciousInteractionBotSessions": "suspicious_interaction", "ppcAdFraudBotSessions": "ad_fraud", "otherBotsSessions": "other",
}


# ---- reading one file --------------------------------------------------------------------------------
def _number(value) -> float | None:
    """'9682', '1.22', '44.34', '4.62%', '6.741s', '320ms'. Seconds and milliseconds come back as they are written."""
    word = (value or "").strip().replace(",", "").removesuffix("%").removesuffix("ms").removesuffix("s").strip()
    try:
        number = float(word)
    except ValueError:
        return None
    return number if number == number and abs(number) < 1e12 else None  # NaN and nonsense are blanks


def _whole(value) -> int | None:
    number = _number(value)
    return None if number is None or number < 0 else int(round(number))


def _ms(value) -> int | None:
    """Clarity writes LCP in seconds ('6.741s') and INP in milliseconds ('320ms')."""
    word = (value or "").strip().lower()
    number = _number(word)
    if number is None:
        return None
    return int(round(number)) if word.endswith("ms") else int(round(number * 1000))


def _text(value) -> str:
    return (value or "").strip()[:_MAX_TEXT]


def _blocks(rows: list[list[str]]) -> list[list[list[str]]]:
    blocks, current = [], []
    for row in rows:
        if not any(cell.strip() for cell in row):
            if current:
                blocks.append(current)
            current = []
        else:
            current.append(row)
    if current:
        blocks.append(current)
    return blocks


def _period(word: str) -> tuple[date, date]:
    match = _RANGE.match(word or "")
    if not match:
        raise Refused("This Clarity file has no date range that can be read.")
    m1, d1, y1, m2, d2, y2 = (int(x) for x in match.groups())
    try:
        start, end = date(y1, m1, d1), date(y2, m2, d2)  # Clarity writes month/day/year
    except ValueError as exc:
        raise Refused("This Clarity file has a date range that isn't real dates.") from exc
    if start > end or end > date.today() + timedelta(days=1) or (end - start).days > 800:
        raise Refused("This Clarity file has a date range that can't be right.")
    return start, end


def _rows_after_blank(block: list[list[str]]) -> list[list[str]]:
    """Data rows of a 'Metric' block: they start with an empty first cell."""
    return [row for row in block[1:] if row and not row[0].strip()]


def _listed(block, key_name: str, value_name: str = "sessions", *, skip_header: bool = True) -> list[dict]:
    out = []
    for row in _rows_after_blank(block) if skip_header else block[1:]:
        cells = row[1:] if skip_header else row
        if len(cells) < 2 or not cells[0].strip():
            continue
        count = _whole(cells[1])
        if count is None:
            continue
        out.append({key_name: _text(cells[0]), value_name: count})
        if len(out) >= _MAX_ROWS:
            break
    return out


def parse(raw: bytes) -> dict:
    """One CSV in, its project, period and sections out. Refuses anything that isn't one of Clarity's two downloads."""
    try:
        body = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise Refused(NOT_CLARITY) from exc
    rows = list(csv.reader(io.StringIO(body)))
    if len(rows) < 3 or not rows[0] or rows[0][0].strip() != "Project name" or len(rows[1]) < 2 or rows[1][0].strip() != "Date range":
        raise Refused(NOT_CLARITY)
    start, end = _period(rows[1][1])
    found: dict = {}
    for block in _blocks(rows[2:]):
        head = [cell.strip() for cell in block[0]]
        first = head[0] if head else ""
        name = head[1] if len(head) > 1 else ""
        if first == "Query":
            queries = []
            for row in block[1:]:
                if len(row) >= 2 and row[0].strip() and _whole(row[1]) is not None:
                    queries.append({"query": _text(row[0]), "citations": _whole(row[1]), "share": _number(row[2]) if len(row) > 2 else None})
                if len(queries) >= _MAX_ROWS:
                    break
            found.setdefault(AI, {})["queries"] = queries
        elif first == "Page URL":
            found.setdefault(AI, {})["pages"] = _listed(block, "url", "citations", skip_header=False)
        elif first != "Metric":
            continue
        elif name == "Share of authority (SoA)":
            ai = found.setdefault(AI, {})
            if len(head) == 3:  # one number: "Metric","Share of authority (SoA)","24.09"
                ai["share_of_authority"] = _number(head[2])
            for row in _rows_after_blank(block):  # or a table: You / All other domains, with citations and a percentage
                if len(row) >= 4 and row[1].strip() == "You":
                    ai["share_of_authority"], ai["your_citations"] = _number(row[3]), _whole(row[2])
                elif len(row) >= 3 and row[1].strip() == "All other domains":
                    ai["others_citations"] = _whole(row[2])
        elif name == "Page citations" and len(head) > 2:
            found.setdefault(AI, {})["citations"] = _whole(head[2])
        elif name == "AI referral traffic" and len(head) > 2:
            found.setdefault(AI, {})["ai_referral_sessions"] = _whole(head[2])
        else:
            _dashboard_block(found, name, block)
    if not found:
        raise Refused(NOT_CLARITY)
    project = _text(rows[0][1] if len(rows[0]) > 1 else "")[:200] or None
    return {"project_name": project, "period_start": start, "period_end": end, "sections": found}


def _dashboard_block(found: dict, name: str, block: list[list[str]]) -> None:
    pairs = {row[1].strip(): row[2] for row in _rows_after_blank(block) if len(row) >= 3}
    d = None
    if name == "Sessions":
        d = found.setdefault(DASHBOARD, {})
        d["sessions"], d["bot_sessions"] = _whole(pairs.get("Total sessions")), _whole(pairs.get("Bot sessions"))
    elif name == "Pages per session":
        found.setdefault(DASHBOARD, {})["pages_per_session"] = _number(pairs.get("Average"))
    elif name == "Scroll depth":
        found.setdefault(DASHBOARD, {})["scroll_depth"] = _number(pairs.get("Average"))
    elif name == "Active time spent":
        d = found.setdefault(DASHBOARD, {})
        d["active_seconds"], d["total_seconds"] = _whole(pairs.get("Active time")), _whole(pairs.get("Total time"))
    elif name == "Users overview":
        d = found.setdefault(DASHBOARD, {})
        d["unique_users"], d["new_user_sessions"], d["returning_user_sessions"] = (
            _whole(pairs.get("Unique users")), _whole(pairs.get("Sessions with new users")), _whole(pairs.get("Sessions with returning users")))
    elif name == "Insights":
        insights = {}
        for row in _rows_after_blank(block):
            key = _INSIGHTS.get(row[1].strip()) if len(row) >= 3 else None
            if key:
                insights[key] = {"sessions": _whole(row[2]), "share": _number(row[3]) if len(row) > 3 else None}
        found.setdefault(DASHBOARD, {})["insights"] = insights
    elif name == "Browsers":
        found.setdefault(DASHBOARD, {})["browsers"] = _listed(block, "name")
    elif name == "Top pages":
        found.setdefault(DASHBOARD, {})["top_pages"] = _listed(block, "url")
    elif name == "Smart events":
        found.setdefault(DASHBOARD, {})["smart_events"] = _listed(block, "name")
    elif name == "Referrer":
        found.setdefault(DASHBOARD, {})["referrers"] = _listed(block, "source")
    elif name == "JavaScript errors":
        total, errors = None, []
        for row in _rows_after_blank(block):
            label = row[1].strip() if len(row) > 1 else ""
            if label.lower() == "total javascript errors" and len(row) > 2:
                total = _whole(row[2])
            elif label and len(row) > 2 and _whole(row[2]) is not None and len(errors) < 50:
                errors.append({"message": _text(label), "sessions": _whole(row[2])})
        found.setdefault(DASHBOARD, {})["js_errors"] = {"total": total, "top": errors}
    elif name == "Performance overview":
        found.setdefault(DASHBOARD, {})["performance"] = {
            "score": _number(pairs.get("Score")), "lcp_ms": _ms(pairs.get("LCP (Largest Contentful Paint)")),
            "inp_ms": _ms(pairs.get("INP (Interaction to Next Paint)")), "cls": _number(pairs.get("CLS (Cumulative Layout Shift)")),
        }
    elif name == "Bot traffic":
        bots = {_BOTS[row[0].strip()]: _whole(row[1]) for row in block[1:] if len(row) >= 2 and row[0].strip() in _BOTS}
        found.setdefault(DASHBOARD, {})["bots"] = bots


def _hosts_in(sections: dict) -> Counter:
    hosts: Counter = Counter()
    for row in sections.get(DASHBOARD, {}).get("top_pages", []) + sections.get(AI, {}).get("pages", []):
        host = host_key(row["url"]) if row["url"].lower().startswith(("http://", "https://")) else ""
        if host:
            hosts[host] += 1
    return hosts


# ---- putting files into the app ------------------------------------------------------------------------
def _own_sites(conn) -> dict[str, int]:
    return {host: site_id for site_id, host in conn.execute(text("SELECT id, host FROM sites WHERE kind = 'own'"))}


def import_files(engine: Engine, files: list[tuple[str, bytes]], *, site_id: int | None = None, preview: bool = False, user_id: int | None = None) -> dict:
    """Each file is read and saved on its own, so one bad file doesn't stop the others. A preview writes nothing."""
    if not files:
        raise Refused("Choose the Clarity files first.")
    if len(files) > MAX_FILES:
        raise Refused(f"Upload at most {MAX_FILES} files at once.")
    answers = []
    with engine.connect() as conn:
        own = _own_sites(conn)
        if site_id is not None and site_id not in own.values():
            raise Refused("That site isn't one of yours.")
    for filename, raw in files:
        answer = {"file": filename[:200]}
        try:
            if not filename.lower().endswith(".csv"):
                raise Refused("Upload the .csv files Clarity downloads.")
            if len(raw) > MAX_BYTES:
                raise Refused(f"This file is too large. The limit is {MAX_BYTES // (1024 * 1024)} MB.")
            report = parse(raw)
            answer.update(_save(engine, report, own, site_id, preview, user_id))
        except Refused as exc:
            answer["error"] = str(exc)
        answers.append(answer)
    return {"preview": preview, "files": answers}


def _save(engine: Engine, report: dict, own: dict[str, int], site_id: int | None, preview: bool, user_id: int | None) -> dict:
    hosts = _hosts_in(report["sections"])
    if site_id is None:
        known = [host for host, _ in hosts.most_common() if host in own]
        if not known:
            if hosts:
                raise Refused(f"This file is about {hosts.most_common(1)[0][0]}, which isn't one of your sites in the app. Add it first, or pick the site.")
            raise Refused("This file has no page addresses, so its site can't be found. Pick the site, then upload it again.")
        target = own[known[0]]
    else:
        target = site_id
    host = next(h for h, i in own.items() if i == target)
    out = {"host": host, "site_id": target, "period_start": report["period_start"].isoformat(), "period_end": report["period_end"].isoformat(), "kinds": []}
    with engine.begin() as conn:
        for kind, data in sorted(report["sections"].items()):
            held = conn.execute(
                text("SELECT id, data FROM clarity_reports WHERE site_id = :s AND kind = :k AND period_start = :a AND period_end = :b"),
                {"s": target, "k": kind, "a": report["period_start"], "b": report["period_end"]},
            ).first()
            out["kinds"].append({"kind": kind, "replaces": held is not None, "summary": _summary(kind, data)})
            if preview:
                continue
            if held is None:
                conn.execute(
                    text("INSERT INTO clarity_reports (site_id, kind, period_start, period_end, project_name, data, uploaded_by) VALUES (:s, :k, :a, :b, :p, :d, :u)"),
                    {"s": target, "k": kind, "a": report["period_start"], "b": report["period_end"], "p": report["project_name"], "d": json.dumps(data, ensure_ascii=False), "u": user_id},
                )
            else:
                old = held[1] if isinstance(held[1], dict) else json.loads(held[1] or "{}")
                conn.execute(
                    text("UPDATE clarity_reports SET data = :d, project_name = :p, uploaded_by = :u, uploaded_at = CURRENT_TIMESTAMP(3) WHERE id = :i"),
                    {"d": json.dumps({**old, **data}, ensure_ascii=False), "p": report["project_name"], "u": user_id, "i": held[0]},
                )
    return out


def _summary(kind: str, data: dict) -> dict:
    if kind == DASHBOARD:
        return {"sessions": data.get("sessions"), "bot_sessions": data.get("bot_sessions")}
    return {"citations": data.get("citations"), "share_of_authority": data.get("share_of_authority"), "queries": len(data["queries"]) if "queries" in data else None}


# ---- reading them back -----------------------------------------------------------------------------------
def latest(engine: Engine, site_ids: list[int]) -> dict:
    """The newest snapshot of each kind per site: the one that ends last, then the one uploaded last."""
    if not site_ids:
        return {"sites": []}
    query = text(
        "SELECT r.site_id, s.host, r.kind, r.period_start, r.period_end, r.data, r.uploaded_at FROM clarity_reports r JOIN sites s ON s.id = r.site_id "
        "WHERE r.site_id IN :ids ORDER BY s.host, r.kind, r.period_end DESC, r.uploaded_at DESC"
    ).bindparams(bindparam("ids", expanding=True))
    per_site: dict[int, dict] = {}
    counts: Counter = Counter()
    with engine.connect() as conn:
        for row in conn.execute(query, {"ids": site_ids}).mappings():
            counts[(row["site_id"], row["kind"])] += 1
            site = per_site.setdefault(row["site_id"], {"site_id": row["site_id"], "host": row["host"]})
            if row["kind"] in site:
                continue
            data = row["data"] if isinstance(row["data"], dict) else json.loads(row["data"] or "{}")
            if row["kind"] == DASHBOARD:
                data = _without_own_referrals(data, row["host"])
            site[row["kind"]] = {"period_start": row["period_start"].isoformat(), "period_end": row["period_end"].isoformat(), "uploaded_at": _iso(row["uploaded_at"]), **data}
    for (site_id, kind), n in counts.items():
        per_site[site_id][kind]["older"] = n - 1
    return {"sites": list(per_site.values())}


def _without_own_referrals(data: dict, host: str) -> dict:
    """Clarity lists the site itself as a referrer when a visitor moves between its pages. That isn't a source."""
    referrers = data.get("referrers") or []
    own = [r for r in referrers if host_key(f"https://{r['source']}") == host]
    if not own:
        return data
    return {**data, "referrers": [r for r in referrers if r not in own], "own_referrals": sum(r["sessions"] for r in own)}


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    return None
