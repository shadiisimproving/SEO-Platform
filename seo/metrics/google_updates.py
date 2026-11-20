"""Google updates: Google's own list of ranking updates, and what each one did to my Search Console numbers.

Google lists every confirmed ranking update (core, spam, reviews...) on its Search Status Dashboard, with the day it began and the
day it finished rolling out. The list is read at most twice a day (the hourly collect-due, or someone opening the card) and kept:
a failed read shows the last one.

The effect compares the days after the update finished (or, while it's still rolling out, the days since it began) with the
same weekdays just before it began, so weekends weigh the same on both sides. Then it asks what else could explain it:
- the site's normal ups and downs: a change smaller than its usual swing isn't called a loss or a gain;
- brand searches: people typing the brand don't care about an update, so the verdict counts the other clicks;
- the season: the same weeks a year earlier, when Search Console still has them;
- my own edits to my pages in those weeks.
It's a match in time, not proof, and the screen says so.
"""
from __future__ import annotations

import json
import logging
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx
from sqlalchemy import Engine, bindparam, text

from seo.collectors import http
from seo.collectors.common import digest
from seo.core.errors import NotFound
from seo.metrics import countries, search
from seo.metrics.service import Scope

log = logging.getLogger(__name__)

FEED = "https://status.search.google.com/incidents.json"
DASHBOARD = "https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history"
READ_EVERY_HOURS = 12
WINDOW_DAYS = 14  # compared on each side, at most
MIN_DAYS = 3  # fewer days after it began than this, and it's too early to say anything
SHOWN = 12  # updates in the list
MOVERS = 5  # pages, keywords, sections, devices and countries shown each way
ENOUGH_CLICKS = 30  # clicks in the days before: with fewer, a change is noise
CHANGED_PCT = 10.0  # the smallest change ever called a loss or a gain, however calm the site usually is
NOISE_SPREAD = 2.0  # a change has to pass this many standard deviations of the site's usual swing
NOISE_SAMPLES = 8  # past steps measured for the usual swing, at most
NOISE_MIN_SAMPLES = 3  # fewer, and only CHANGED_PCT applies
SEASON_SHARE = 0.5  # last year moved the same way by at least this share of this year's change: probably the season
MOVER_MIN_CLICKS = 3  # a page or keyword moving by less than this isn't worth a row
RECOVERY_AFTER_DAYS = 28  # a loss is followed up once this long has passed since the days after it
EDITS_LISTED = 20
RIVALS = 5
NOTIFY_STARTED_DAYS = 14  # an update that began longer ago than this isn't announced as new
NOTIFY_ENDED_DAYS = 45
TODAY_DAYS = 60  # a loss stays on Today's list this long after the update ended
KIND = "google_update"  # the bell's kind

# ---- Google's list ------------------------------------------------------------------------------------


def _day(value) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc).date()
    except ValueError:
        return None


def kind_of(name: str) -> str:
    lower = (name or "").lower()
    for word in ("core", "spam", "review", "helpful content", "link"):
        if word in lower:
            return {"helpful content": "helpful", "review": "reviews"}.get(word, word)
    return "other"


def parse(items) -> list[dict]:
    """Only ranking updates. Google's list also holds crawling, indexing and serving incidents, which aren't updates."""
    found = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or (item.get("service_name") or "").strip().lower() != "ranking":
            continue
        began = _day(item.get("begin"))
        name = str(item.get("external_desc") or "").strip()
        if not item.get("id") or not began or not name:
            continue
        uri = str(item.get("uri") or "")
        found.append({
            "id": str(item["id"])[:40], "name": name[:200], "kind": kind_of(name), "began": began, "ended": _day(item.get("end")),
            "url": f"https://status.search.google.com/{uri}" if uri.startswith("incidents/") else DASHBOARD,
        })
    return found


def refresh(engine: Engine, force: bool = False) -> bool:
    """Read Google's list when the last read is old. True when it was read. A failure keeps the last list."""
    with engine.connect() as conn:
        last = conn.execute(text("SELECT MAX(read_at) FROM google_updates")).scalar()
    if not force and last and last > datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=READ_EVERY_HOURS):
        return False
    try:
        with http.client(timeout=20) as client:
            reply = client.get(FEED)
        reply.raise_for_status()
        updates = parse(reply.json())
    except (httpx.HTTPError, ValueError):
        log.warning("Google's list of updates couldn't be read", exc_info=True)
        return False
    with engine.begin() as conn:
        for u in updates:
            conn.execute(
                text(
                    "INSERT INTO google_updates (id, name, kind, began, ended, url, read_at) VALUES (:id, :name, :kind, :began, :ended, :url, UTC_TIMESTAMP(3)) "
                    "ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), began = VALUES(began), ended = VALUES(ended), url = VALUES(url), read_at = VALUES(read_at)"
                ),
                u,
            )
        if not updates:  # an empty answer still counts as a read, so it isn't asked again at once
            conn.execute(text("UPDATE google_updates SET read_at = UTC_TIMESTAMP(3)"))
    return True


def _updates(engine: Engine, since: date) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM google_updates WHERE began >= :d ORDER BY began DESC LIMIT :n"), {"d": since, "n": SHOWN}).mappings().all()
    return [dict(r) for r in rows]


def _update(engine: Engine, update_id: str) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM google_updates WHERE id = :i"), {"i": update_id}).mappings().first()
    if row is None:
        raise NotFound("That Google update isn't known.")
    return dict(row)


# ---- the days compared ------------------------------------------------------------------------------


def windows(began: date, ended: date | None, last_final: date) -> dict | None:
    """The days compared. None when it's too early to say anything.

    The days before are the days after moved back by whole weeks, to just before the update began: the same weekdays on each
    side, so a weekend on one side only never looks like a change."""
    after_from = (ended + timedelta(days=1)) if ended else began + timedelta(days=1)
    room = (last_final - after_from).days + 1
    if room < MIN_DAYS:
        return None
    days = min(WINDOW_DAYS, room)
    after_to = after_from + timedelta(days=days - 1)
    weeks = (after_to - began).days // 7 + 1
    before_from, before_to = after_from - timedelta(weeks=weeks), after_to - timedelta(weeks=weeks)
    return {"before": (before_from, before_to), "after": (after_from, after_to), "days": days, "rolling": ended is None, "partial": days < WINDOW_DAYS}


def _shift(span: tuple[date, date], days: int) -> tuple[date, date]:
    return span[0] - timedelta(days=days), span[1] - timedelta(days=days)


def _step(days: int) -> int:
    """Windows of this length moved back without overlapping, and still on the same weekdays."""
    return 7 * -(-days // 7)


def _pct(now, before) -> float | None:
    return round((now - before) / before * 100, 1) if before else None


# ---- the numbers, read once per site and question -----------------------------------------------------


class Days:
    """Clicks, impressions and position for each day of a range, with brand clicks apart. One read, then any window is a sum."""

    def __init__(self, scope: Scope, start: date, end: date, brand: list[str]):
        self.brand_on = bool(brand)
        rows = scope.fetch(
            "SELECT day, SUM(clicks) c, SUM(impressions) i, SUM(position * impressions) pw, SUM(CASE WHEN position IS NULL THEN 0 ELSE impressions END) pi "
            "FROM gsc_daily WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY day", start, end,
        )
        self.days = {r["day"]: (int(r["c"] or 0), int(r["i"] or 0), float(r["pw"] or 0), int(r["pi"] or 0)) for r in rows}
        self.brand: dict[date, int] = {}
        if brand:
            names = scope.fetch("SELECT query_hash, MAX(query) query FROM gsc_query WHERE site_id IN :sites AND day BETWEEN :a AND :b GROUP BY query_hash", start, end)
            hashes = [r["query_hash"] for r in names if search.is_brand(r["query"], brand)]
            if hashes:
                statement = text("SELECT day, SUM(clicks) c FROM gsc_query WHERE site_id IN :sites AND day BETWEEN :a AND :b AND query_hash IN :h GROUP BY day").bindparams(
                    bindparam("sites", expanding=True), bindparam("h", expanding=True))
                with scope.engine.connect() as conn:
                    self.brand = {r["day"]: int(r["c"] or 0) for r in conn.execute(statement, {"sites": scope.site_ids, "a": start, "b": end, "h": hashes}).mappings()}

    def window(self, span: tuple[date, date]) -> dict | None:
        """None unless every day of the window is there: a half-empty window would look like a fall."""
        day, total, brand, shown, weighted, counted, have = span[0], 0, 0, 0, 0.0, 0, 0
        while day <= span[1]:
            if day in self.days:
                have += 1
                c, i, pw, pi = self.days[day]
                total, shown, weighted, counted = total + c, shown + i, weighted + pw, counted + pi
                brand += self.brand.get(day, 0)
            day += timedelta(days=1)
        if have < (span[1] - span[0]).days + 1:
            return None
        return {"clicks": total - brand, "all_clicks": total, "brand_clicks": brand, "impressions": shown, "position": round(weighted / counted, 1) if counted else None,
                "from": span[0].isoformat(), "to": span[1].isoformat()}


def usual_swing(days: Days, span: dict) -> float | None:
    """How much this site's clicks usually move between two windows of this length, as a standard deviation in %.
    Measured on the weeks before the update, so the update itself can't widen it."""
    step, changes = _step(span["days"]), []
    for n in range(NOISE_SAMPLES):
        later, earlier = days.window(_shift(span["before"], step * n)), days.window(_shift(span["before"], step * (n + 1)))
        if later is None or earlier is None or not earlier["clicks"]:
            break
        changes.append((later["clicks"] - earlier["clicks"]) / earlier["clicks"] * 100)
    return round(statistics.pstdev(changes), 1) if len(changes) >= NOISE_MIN_SAMPLES else None


def threshold(swing: float | None) -> float:
    return max(CHANGED_PCT, NOISE_SPREAD * swing) if swing is not None else CHANGED_PCT


def verdict(before: dict, after: dict, swing: float | None = None, last_year: float | None = None) -> str:
    """lost, gained, normal (within the usual ups and downs), season (last year did the same), little (too few clicks to tell)."""
    if before["clicks"] < ENOUGH_CLICKS and after["clicks"] < ENOUGH_CLICKS:
        return "little"
    change = _pct(after["clicks"], before["clicks"])
    if change is None:
        return "gained"
    if abs(change) < threshold(swing):
        return "normal"
    if last_year is not None and last_year * change > 0 and abs(last_year) >= SEASON_SHARE * abs(change):
        return "season"
    return "lost" if change < 0 else "gained"


# ---- the effect of one update on some sites ----------------------------------------------------------


def _last_final(scope: Scope) -> date:
    newest, fresh_from = search._newest(scope)
    return search.final_day(newest, fresh_from)


def _first_day(scope: Scope) -> date | None:
    row = scope.fetch("SELECT MAX(f) d FROM (SELECT MIN(day) f FROM gsc_daily WHERE site_id IN :sites GROUP BY site_id) firsts")
    return row[0]["d"] if row else None


def _head(update: dict) -> dict:
    return {
        "id": update["id"], "name": update["name"], "kind": update["kind"], "began": update["began"].isoformat(),
        "ended": update["ended"].isoformat() if update["ended"] else None, "url": update["url"], "rolling": update["ended"] is None,
    }


def effect(scope: Scope, update: dict, last_final: date | None = None, first_day: date | None = None, brand: list[str] | None = None) -> dict:
    last_final = last_final or _last_final(scope)
    first_day = first_day if first_day is not None else _first_day(scope)
    brand = search.brand_words(scope) if brand is None else brand
    answer = _head(update)
    span = windows(update["began"], update["ended"], last_final)
    if span is None:
        return {**answer, "verdict": "early"}
    if first_day is None or first_day > span["before"][0]:
        return {**answer, "verdict": "no_data"}
    reach = _shift(span["before"], _step(span["days"]) * (NOISE_SAMPLES + 1))[0]
    days = Days(scope, min(reach, span["before"][0] - timedelta(days=364)), last_final, brand)
    before, after = days.window(span["before"]), days.window(span["after"])
    if before is None or after is None:
        return {**answer, "verdict": "no_data"}
    swing = usual_swing(days, span)
    ly_before, ly_after = days.window(_shift(span["before"], 364)), days.window(_shift(span["after"], 364))
    last_year = _pct(ly_after["clicks"], ly_before["clicks"]) if ly_before and ly_after else None
    said = verdict(before, after, swing, last_year)
    out = {
        **answer, "verdict": said, "days": span["days"], "partial": span["partial"], "before": before, "after": after,
        "clicks_pct": _pct(after["clicks"], before["clicks"]), "all_clicks_pct": _pct(after["all_clicks"], before["all_clicks"]),
        "impressions_pct": _pct(after["impressions"], before["impressions"]),
        "position_change": round(after["position"] - before["position"], 1) if before["position"] is not None and after["position"] is not None else None,
        "brand_out": days.brand_on, "usual_swing": swing, "threshold": round(threshold(swing), 1), "last_year_pct": last_year,
    }
    # Followed up a month on: did the clicks come back? The same length and weekdays, ending at most on the last final day.
    if said == "lost" and not span["rolling"] and (last_final - span["after"][1]).days >= RECOVERY_AFTER_DAYS:
        weeks = ((last_final - timedelta(days=span["days"] - 1)) - span["after"][0]).days // 7
        recent = days.window(_shift(span["after"], -7 * weeks))
        lost = before["clicks"] - after["clicks"]
        if recent and lost:
            out["recovery"] = {"pct": round((recent["clicks"] - after["clicks"]) / lost * 100), "clicks": recent["clicks"], "from": recent["from"], "to": recent["to"]}
    return out


def listing(engine: Engine, site, read: bool = True) -> dict:
    """read=False uses the list already saved (an export never waits on Google)."""
    read_now = refresh(engine) if read else False
    scope = Scope(engine, site, "2000-01-01", "2000-01-01")
    last_final, first_day = _last_final(scope), _first_day(scope)
    since = (first_day or last_final) - timedelta(days=WINDOW_DAYS)
    brand = search.brand_words(scope)
    many = len(scope.site_ids) > 1
    hosts = {}
    if many:
        with engine.connect() as conn:
            hosts = dict(conn.execute(text("SELECT id, host FROM sites WHERE id IN :s").bindparams(bindparam("s", expanding=True)), {"s": scope.site_ids}).all())
    updates = []
    for u in _updates(engine, since):
        if not many:
            updates.append(effect(scope, u, last_final, first_day, brand))
            continue
        # All my sites: one verdict per site, never the sites added together (one site's loss would hide in another's gain).
        per_site = []
        for site_id in scope.site_ids:
            found = effect(Scope(engine, site_id, "2000-01-01", "2000-01-01"), u)
            per_site.append({"site_id": site_id, "host": hosts.get(site_id), "verdict": found["verdict"], "clicks_pct": found.get("clicks_pct")})
        updates.append({**_head(u), "verdict": "sites", "sites": per_site})
    with engine.connect() as conn:
        read_at = conn.execute(text("SELECT MAX(read_at) FROM google_updates")).scalar()
    return {
        "updates": updates, "many": many, "brand_words": bool(brand),
        "read_at": read_at.strftime("%Y-%m-%dT%H:%M:%SZ") if read_at else None, "source": DASHBOARD, "last_final": last_final.isoformat(),
        "read_now": read_now,  # the chart was drawn before this read, so the screen asks for it again to show the bands
    }


# ---- why it moved ----------------------------------------------------------------------------------


def why(row: dict) -> str:
    """One short reason a page or keyword moved: its place, how often it was searched, or how often it was clicked."""
    before, after = row.get("position_before"), row.get("position_after")
    if before is not None and after is not None and abs(after - before) >= 1:
        return "position_down" if after > before else "position_up"
    shown = _pct(row.get("impressions_after") or 0, row.get("impressions_before") or 0)
    if shown is not None and abs(shown) >= 20:
        return "searched_less" if shown < 0 else "searched_more"
    return "click_rate"


def _compare(scope: Scope, table: str, column: str, span: dict) -> list[dict]:
    """Every page, keyword, device or country with its clicks, impressions and position on each side."""
    (b1, b2), (a1, a2) = span["before"], span["after"]
    group = {"gsc_page": "page_hash", "gsc_query": "query_hash"}.get(table, column)
    rows = scope.fetch(
        f"SELECT MAX({column}) name, SUM(CASE WHEN day <= :b THEN clicks ELSE 0 END) cb, SUM(CASE WHEN day >= :a2 THEN clicks ELSE 0 END) ca, "
        "SUM(CASE WHEN day <= :b THEN impressions ELSE 0 END) ib, SUM(CASE WHEN day >= :a2 THEN impressions ELSE 0 END) ia, "
        "SUM(CASE WHEN day <= :b THEN position * impressions END) / NULLIF(SUM(CASE WHEN day <= :b AND position IS NOT NULL THEN impressions END), 0) pb, "
        "SUM(CASE WHEN day >= :a2 THEN position * impressions END) / NULLIF(SUM(CASE WHEN day >= :a2 AND position IS NOT NULL THEN impressions END), 0) pa "
        f"FROM {table} WHERE site_id IN :sites AND ((day BETWEEN :a AND :b) OR (day BETWEEN :a2 AND :b2)) GROUP BY {group}",
        b1, b2, a2=a1, b2=a2,
    )
    return [{
        "name": r["name"], "clicks_before": int(r["cb"] or 0), "clicks_after": int(r["ca"] or 0), "change": int(r["ca"] or 0) - int(r["cb"] or 0),
        "impressions_before": int(r["ib"] or 0), "impressions_after": int(r["ia"] or 0),
        "position_before": round(float(r["pb"]), 1) if r["pb"] is not None else None, "position_after": round(float(r["pa"]), 1) if r["pa"] is not None else None,
    } for r in rows]


def _split(rows: list[dict]) -> dict:
    moved = [{**r, "why": why(r)} for r in rows if abs(r["change"]) >= MOVER_MIN_CLICKS]
    return {
        "down": sorted((m for m in moved if m["change"] < 0), key=lambda m: m["change"])[:MOVERS],
        "up": sorted((m for m in moved if m["change"] > 0), key=lambda m: -m["change"])[:MOVERS],
    }


def section_of(page: str) -> str:
    """A page's first folder: /blog/visa-dubai/ is in /blog/. A page at the top level is in "/"."""
    path = urlsplit(page).path if "://" in (page or "") else (page or "")
    parts = [p for p in path.split("/") if p]
    return f"/{parts[0]}/" if len(parts) > 1 else "/"


def sections(pages: list[dict]) -> dict:
    grouped: dict[str, dict] = {}
    for p in pages:
        name = section_of(p["name"])
        held = grouped.setdefault(name, {"name": name, "pages": 0, "clicks_before": 0, "clicks_after": 0})
        held["pages"] += 1
        held["clicks_before"] += p["clicks_before"]
        held["clicks_after"] += p["clicks_after"]
    if len(grouped) < 2:  # one section is the whole site: nothing to tell apart
        return {"down": [], "up": []}
    moved = [{**g, "change": g["clicks_after"] - g["clicks_before"]} for g in grouped.values()]
    moved = [m for m in moved if abs(m["change"]) >= MOVER_MIN_CLICKS]
    return {"down": sorted((m for m in moved if m["change"] < 0), key=lambda m: m["change"])[:MOVERS], "up": sorted((m for m in moved if m["change"] > 0), key=lambda m: -m["change"])[:MOVERS]}


def own_edits(scope: Scope, span: dict) -> dict:
    """My own page edits from the first day before to the last day after. Counted only from the first time the app read the site."""
    if len(scope.site_ids) != 1:
        return {"count": None, "items": [], "reading_since": None, "partial": False}
    start, end = datetime.combine(span["before"][0], datetime.min.time()), datetime.combine(span["after"][1] + timedelta(days=1), datetime.min.time())
    values = {"s": scope.site_ids[0], "a": start, "b": end}
    with scope.engine.connect() as conn:
        since = conn.execute(text("SELECT MIN(p.first_seen_at) FROM sites s JOIN domains d ON d.host = s.host JOIN pages p ON p.domain_id = d.id WHERE s.id = :s"), values).scalar()
        rows = conn.execute(text(
            "SELECT e.kind, e.detected_at, p.url FROM sites s JOIN domains d ON d.host = s.host JOIN change_events e ON e.domain_id = d.id JOIN pages p ON p.id = e.page_id "
            "WHERE s.id = :s AND e.detected_at >= :a AND e.detected_at < :b ORDER BY e.detected_at DESC, e.id DESC"
        ), values).mappings().all()
    pages: dict[str, dict] = {}
    for r in rows:
        held = pages.setdefault(r["url"], {"url": r["url"], "kinds": [], "last": r["detected_at"].strftime("%Y-%m-%d")})
        if r["kind"] not in held["kinds"]:
            held["kinds"].append(r["kind"])
    return {
        # Reading began after these weeks: nothing can be said about them.
        "count": len(pages) if since and since.date() <= span["after"][1] else None, "items": list(pages.values())[:EDITS_LISTED],
        "reading_since": since.strftime("%Y-%m-%d") if since else None,
        "partial": bool(since and since.date() > span["before"][0]),  # reading began inside the weeks compared: earlier edits aren't known
    }


def rivals(scope: Scope, span: dict, began: date) -> dict:
    """Which websites rose on the keywords where I fell, from Google rank checks on each side of the update. Each keyword
    compares its last check before the update with its last check after, made with the same tool, place and depth."""
    if len(scope.site_ids) != 1:
        return {"checked": 0, "items": []}
    from seo.serp import store

    with scope.engine.connect() as conn:
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": scope.site_ids[0]}).scalar()
    (b1, _b2), (a1, a2) = span["before"], span["after"]
    sides: dict[tuple, dict] = defaultdict(dict)
    for check in store.history(scope.engine, scope.site_ids[0], "google"):
        at = check.checked_at
        day = at.date() if isinstance(at, datetime) else at
        kind = (check.target_id, check.tool, check.real_location, check.depth)
        if b1 - timedelta(days=14) <= day < began:  # checks aren't daily: one up to two weeks before still says where things stood
            sides[kind]["before"] = check  # oldest first, so the last one wins
        elif a1 <= day <= a2 + timedelta(days=7):
            sides[kind]["after"] = check
    gains: dict[str, dict] = {}
    checked = 0
    for pair in sides.values():
        if "before" not in pair or "after" not in pair:
            continue
        checked += 1
        then, now = pair["before"], pair["after"]
        mine_then, mine_now = then.best_on(host), now.best_on(host)
        if mine_then is None or (mine_now is not None and mine_now.position <= mine_then.position):
            continue  # I didn't fall on this keyword
        for row in now.results[:20]:
            if store.on_host(row.host, host):
                continue
            was = then.best_on(row.host)
            if was is not None and row.position >= was.position:
                continue
            name = row.domain or row.host
            held = gains.setdefault(name, {"domain": name, "keywords": [], "best": row.position})
            if then.keyword not in held["keywords"]:
                held["keywords"].append(then.keyword)
            held["best"] = min(held["best"], row.position)
    items = sorted(gains.values(), key=lambda g: (-len(g["keywords"]), g["best"]))[:RIVALS]
    return {"checked": checked, "items": [{**item, "count": len(item["keywords"]), "keywords": item["keywords"][:5]} for item in items]}


def detail(engine: Engine, site, update_id: str) -> dict:
    scope = Scope(engine, site, "2000-01-01", "2000-01-01")
    update = _update(engine, update_id)
    last_final = _last_final(scope)
    answer = effect(scope, update, last_final)
    span = windows(update["began"], update["ended"], last_final)
    empty = {"down": [], "up": []}
    if answer["verdict"] in ("early", "no_data") or span is None:
        return {**answer, "pages": empty, "queries": empty, "sections": empty, "devices": empty, "countries": empty,
                "edits": {"count": None, "items": [], "reading_since": None, "partial": False}, "rivals": {"checked": 0, "items": []}}
    pages = _compare(scope, "gsc_page", "page", span)
    countries_moved = _split(_compare(scope, "gsc_country", "country", span))
    for side in countries_moved.values():
        for row in side:
            row["code"] = countries.alpha2(row["name"])
    return {
        **answer, "pages": _split(pages), "queries": _split(_compare(scope, "gsc_query", "query", span)), "sections": sections(pages),
        "devices": _split(_compare(scope, "gsc_device", "device", span)), "countries": countries_moved,
        "edits": own_edits(scope, span), "rivals": rivals(scope, span, update["began"]),
    }


# ---- the chart, the bell and Today ---------------------------------------------------------------------


def chart_marks(scope: Scope) -> list[dict]:
    """Updates that overlap the chart's period, as marks with a start and an end."""
    if not scope.site_ids:
        return []
    with scope.engine.connect() as conn:
        rows = conn.execute(text("SELECT id, name, began, ended FROM google_updates WHERE began <= :b AND COALESCE(ended, :b) >= :a ORDER BY began"), {"a": scope.start, "b": scope.end}).mappings().all()
    return [{"kind": "google", "id": r["id"], "site_id": None, "day": r["began"].isoformat(), "end": r["ended"].isoformat() if r["ended"] else None, "text": r["name"]} for r in rows]


def _own_sites(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text("SELECT id, host FROM sites WHERE kind = 'own' ORDER BY id")).mappings()]


def _notify(conn, site_id: int, key: str, title: str, detail: dict) -> bool:
    """Once per key and site: a notification already sent (read or not) is never sent again."""
    if conn.execute(text("SELECT 1 FROM notifications WHERE site_id = :s AND kind = :k AND subject_key = :key"), {"s": site_id, "k": KIND, "key": key}).first():
        return False
    conn.execute(
        text("INSERT INTO notifications (site_id, kind, subject_key, title, detail) VALUES (:s, :k, :key, :t, :d)"),
        {"s": site_id, "k": KIND, "key": key, "t": title[:300], "d": json.dumps(detail, ensure_ascii=False, default=str)},
    )
    return True


def announce(engine: Engine, today: date | None = None) -> int:
    """The bell: when Google starts an update, and when one has finished and its effect can be read, once per site. Returns how many."""
    today = today or datetime.now(timezone.utc).date()
    with engine.connect() as conn:
        updates = [dict(r) for r in conn.execute(text("SELECT * FROM google_updates WHERE began >= :d ORDER BY began"), {"d": today - timedelta(days=NOTIFY_ENDED_DAYS + 60)}).mappings()]
    sent = 0
    for site in _own_sites(engine):
        if _first_day(Scope(engine, site["id"], "2000-01-01", "2000-01-01")) is None:
            continue  # no Search Console numbers: nothing an update could be compared with, so nothing to announce
        for u in updates:
            base = {"update_id": u["id"], "name": u["name"], "began": u["began"].isoformat(), "ended": u["ended"].isoformat() if u["ended"] else None, "host": site["host"]}
            if (today - u["began"]).days <= NOTIFY_STARTED_DAYS:
                with engine.begin() as conn:
                    sent += _notify(conn, site["id"], digest("google-update", u["id"], "started"), f"Google started the {u['name']}", {**base, "state": "started"})
            if not u["ended"] or (today - u["ended"]).days > NOTIFY_ENDED_DAYS:
                continue
            found = effect(Scope(engine, site["id"], "2000-01-01", "2000-01-01"), u)
            if found["verdict"] in ("early", "no_data"):
                continue  # not readable yet: asked again at the next run
            with engine.begin() as conn:
                sent += _notify(conn, site["id"], digest("google-update", u["id"], "ended"), f"{u['name']}: {found['verdict']}",
                                {**base, "state": "ended", "verdict": found["verdict"], "clicks_pct": found.get("clicks_pct")})
    return sent


def daily(engine: Engine) -> None:
    """From cron's collect-due: Google's list, then the bell. A problem here must never stop the data pulls."""
    try:
        refresh(engine)
        announce(engine)
    except Exception:  # noqa: BLE001
        log.exception("Google updates: the daily read or the bell failed")


def today_rows(engine: Engine, site_id: int | None, site_ids: list[int]) -> list[dict]:
    """One to-do line per site that lost clicks in an update that ended in the last TODAY_DAYS days."""
    now = datetime.now(timezone.utc).date()
    with engine.connect() as conn:
        updates = [dict(r) for r in conn.execute(text("SELECT * FROM google_updates WHERE ended IS NOT NULL AND ended >= :d ORDER BY began DESC"), {"d": now - timedelta(days=TODAY_DAYS)}).mappings()]
    if not updates:
        return []
    rows = []
    for site in _own_sites(engine):
        if site["id"] not in site_ids or (site_id is not None and site["id"] != site_id):
            continue
        scope = Scope(engine, site["id"], "2000-01-01", "2000-01-01")
        for u in updates:
            found = effect(scope, u)
            if found["verdict"] == "lost":
                rows.append({"update_id": u["id"], "site_id": site["id"], "host": site["host"], "name": u["name"], "lost_pct": abs(round(found["clicks_pct"] or 0)),
                             "key": digest("google-update-today", u["id"], site["id"]), "ended": u["ended"].isoformat()})
    return rows
