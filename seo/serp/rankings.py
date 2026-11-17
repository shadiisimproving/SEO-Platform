"""What the Keywords screen shows: every ranking with its tool, and numbers that never mix unlike results.

Change, Up, Down, the trend and the Top 10 change only compare checks with the same tool, location and depth, on the same
target (which holds the device). A tool switch shows no number, and says so. Beyond the depth checked is ">10", not a drop.
Suspect results stay visible, and are left out of trends. A check from another location stays on its own line.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import Engine, text

from seo.accounts import access
from seo.competitors.keywords import _iso, require_own
from seo.core.errors import NotFound
from seo.metrics import countries
from seo.serp import connections, store
from seo.serp.tools import counts_for_keyword, google_redirect, same_place

# Tags Google and ad tools add to an address. The same page with one of these is still that page: Reserve with Google
# alone gave a home page dozens of "other pages" (?rwg_token=…), one per visit.
_TRACKING = ("rwg_token", "srsltid", "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "yclid", "_gl", "mc_cid", "mc_eid")


def page_address(url: str) -> str:
    """The page an address is: no #part, no tracking tags (utm_*, hsa_* and the names above); other query parts stay."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in _TRACKING and not k.startswith(("utm_", "hsa_"))]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), ""))


def _fold_pages(seen: dict) -> dict:
    """Search Console's pages for one query, tagged copies added into their page's impressions."""
    folded: dict = {}
    for url, shows in seen.items():
        page = page_address(url)
        folded[page] = folded.get(page, 0) + (shows or 0)
    return folded

ENGINES = connections.ENGINE_ORDER
DEVICE = "desktop"  # the screen shows desktop. A mobile check is another target, so it can never be compared with these.
HOURS_TO_AGREE = 48
OWN_DAYS = 28


@dataclass
class Seen:
    check_id: int
    keyword_id: int
    engine: str
    tool: str
    location: str
    depth: int
    status: str
    ai_state: str
    at: datetime
    rows: list = field(default_factory=list)  # (position, url, host) of pages on any of my sites
    cited: list = field(default_factory=list)  # hosts of my sites this check's AI Overview cites

    def own(self, host: str):
        return next((row for row in self.rows if store.on_host(row[2], host)), None)

    def position(self, host: str):
        best = self.own(host)
        return best[0] if best else None

    def kind(self) -> tuple:
        return self.tool, self.location, self.depth


def _sites(conn, site_id: int | None) -> list[dict]:
    if site_id is not None:
        return [require_own(conn, site_id)]
    visible = set(access.own_site_ids(conn))  # "all sites" is all of *their* sites
    return [dict(row) for row in conn.execute(text("SELECT id, host, kind FROM sites WHERE kind = 'own' ORDER BY id")).mappings().all() if row["id"] in visible]


def _load_checks(conn, keyword_ids: list[int], hosts: list[str]) -> dict[tuple[int, str], list[Seen]]:
    if not keyword_ids:
        return {}
    by_target: dict[tuple[int, str], list[Seen]] = defaultdict(list)
    by_id: dict[int, Seen] = {}
    for start in range(0, len(keyword_ids), 1000):
        marks = ",".join(str(int(i)) for i in keyword_ids[start:start + 1000])
        for row in conn.execute(
            text(
                f"SELECT c.id, t.keyword_id, t.engine, c.tool, c.real_location, c.depth, c.status, c.ai_state, c.checked_at FROM serp_targets t JOIN serp_checks c ON c.target_id = t.id "
                f"WHERE t.device = '{DEVICE}' AND t.keyword_id IN ({marks}) AND c.status IN ('ok', 'suspect') ORDER BY c.id"
            )
        ).mappings():
            seen = Seen(row["id"], row["keyword_id"], row["engine"], row["tool"], row["real_location"], row["depth"], row["status"], row["ai_state"], row["checked_at"])
            by_target[(seen.keyword_id, seen.engine)].append(seen)
            by_id[seen.check_id] = seen
    ascii_hosts = [store.to_ascii_host(host) for host in hosts]
    if not ascii_hosts:
        return by_target
    conditions = " OR ".join(f"host = :h{i} OR host LIKE :s{i}" for i in range(len(ascii_hosts)))
    params = {}
    for i, host in enumerate(ascii_hosts):
        params[f"h{i}"], params[f"s{i}"] = host, "%." + host.replace("%", r"\%").replace("_", r"\_")
    ids = list(by_id)
    for start in range(0, len(ids), 1000):
        marks = ",".join(str(i) for i in ids[start:start + 1000])
        for row in conn.execute(text(f"SELECT check_id, position, url, host FROM serp_results WHERE check_id IN ({marks}) AND ({conditions}) ORDER BY check_id, position"), params).mappings():
            by_id[row["check_id"]].rows.append((row["position"], row["url"], row["host"]))
        for row in conn.execute(text(f"SELECT check_id, host FROM ai_citations WHERE check_id IN ({marks}) AND ({conditions})"), params).mappings():
            by_id[row["check_id"]].cited.append(row["host"])
    return by_target


def _view(seen: Seen, host: str, now: datetime, home: bool, verdict: str | None = None) -> dict:
    best = seen.own(host)
    return {
        "check_id": seen.check_id, "tool": seen.tool, "p": best[0] if best else None, "url": best[1] if best else None, "depth": seen.depth, "location": seen.location,
        "checked_at": _iso(seen.at), "age_days": round((now - seen.at).total_seconds() / 86400, 2), "status": seen.status, "home": home, "verdict": verdict or seen.status,
    }


def movement(now_p: int | None, then_p: int | None) -> str:
    """How a keyword moved between two like-for-like checks (same tool, location and depth). Beyond the depth is a real
    state, "out of the top N": found → out is "lost" (a drop), out → found is "new" (a gain), out → out is "out"."""
    if now_p is not None and then_p is not None:
        return "up" if now_p < then_p else "down" if now_p > then_p else "same"
    if then_p is not None:
        return "lost"
    if now_p is not None:
        return "new"
    return "out"


def engine_view(checks: list[Seen], host: str, country: str, language: str, order: list[str], gap: int, now: datetime, own: dict | None = None) -> dict:
    """One keyword on one engine. `checks` are oldest first."""
    home, away = [], []
    for seen in checks:
        (home if counts_for_keyword(seen.engine, country, seen.location, language) else away).append(seen)
    good = [seen for seen in home if seen.status == "ok"]

    latest_by_tool: dict[str, Seen] = {}
    for seen in good:
        latest_by_tool[seen.tool] = seen
    place = {name: at for at, name in enumerate(order)}
    main, passed_over = None, None
    if latest_by_tool:
        # The first tool in your order that has a result (the owner's rule), unless its result is older than
        # store.MAIN_MAX_AGE_DAYS and another tool has a newer one: then the newer one, and the row says why.
        main, passed_over = store.pick_main(list(latest_by_tool.values()), place, now, tool=lambda c: c.tool, ident=lambda c: c.check_id, at=lambda c: c.at)
    flagged_only = False
    if main is None and home:  # only suspect results: shown as such, and counted as nothing
        main, flagged_only = home[-1], True

    change, change_note, trend, move, was, url_changed = None, None, [], None, None, False
    if main is not None and not flagged_only:
        same = [seen for seen in good if seen.kind() == main.kind()]
        before = [seen for seen in same if seen.check_id < main.check_id]
        trend = [{"at": _iso(seen.at), "p": seen.position(host)} for seen in same if seen.position(host) is not None]
        if before:
            now_p, then_p = main.position(host), before[-1].position(host)
            move, was = movement(now_p, then_p), then_p
            if now_p is not None and then_p is not None:
                change = then_p - now_p  # a smaller position is better, so up is positive
                now_url, then_url = (main.own(host) or (None, None))[1], (before[-1].own(host) or (None, None))[1]
                url_changed = bool(now_url and then_url and page_address(now_url).rstrip("/") != page_address(then_url).rstrip("/"))
        else:
            earlier = [seen for seen in good if seen.check_id < main.check_id]
            if earlier:
                last = earlier[-1]
                change_note = "tool changed" if last.tool != main.tool else "depth changed" if last.depth != main.depth else "location changed"

    verdict = None
    if main is not None:
        same_before = [seen for seen in good if seen.kind() == main.kind() and seen.check_id < main.check_id]
        verdict = "suspect" if main.status == "suspect" else ("ok" if same_before or (own and own.get("position") is not None) else "unverifiable")

    disagree = None
    fresh = [seen for seen in latest_by_tool.values() if seen.position(host) is not None]
    for i, one in enumerate(fresh):
        for other in fresh[i + 1:]:
            hours = abs((one.at - other.at).total_seconds()) / 3600
            diff = abs(one.position(host) - other.position(host))
            if hours <= HOURS_TO_AGREE and diff > gap and (disagree is None or diff > disagree["diff"]):
                disagree = {"tools": [one.tool, other.tool], "diff": diff}

    others = [_view(seen, host, now, True) for name, seen in latest_by_tool.items() if main is None or name != main.tool]
    others.sort(key=lambda row: place.get(row["tool"], len(place)))
    latest_away: dict[tuple, Seen] = {}
    for seen in away:
        latest_away[(seen.tool, seen.location)] = seen
    suspects = [_view(seen, host, now, True) for seen in home if seen.status == "suspect" and (main is None or seen.check_id > main.check_id)]
    main_view = _view(main, host, now, True, verdict) if main else None
    if main_view and passed_over is not None:
        main_view["passed_over"] = {"tool": passed_over.tool, "age_days": round((now - passed_over.at).total_seconds() / 86400, 2)}
    if main_view:
        main_view["old"] = main_view["age_days"] > store.MAIN_MAX_AGE_DAYS  # the row's amber age badge
    return {
        "main": main_view,
        "change": change, "change_note": change_note, "move": move, "was": was, "url_changed": url_changed, "trend": trend, "others": others, "suspects": suspects, "disagree": disagree,
        "away": [_view(seen, host, now, False) for seen in latest_away.values()],
        "never": not checks,
        "own": own.get("position") if own else None, "impressions": own.get("impressions") if own else None, "clicks": own.get("clicks") if own else None,
    }


def _ai(checks: list[Seen], host: str, country: str, language: str, now: datetime) -> dict:
    """AI Overviews are Google's. Unknown stays "not captured", and never turns into a "no"."""
    captured = [seen for seen in checks if seen.status == "ok" and seen.ai_state != "not_captured" and same_place(country, seen.location, language)]
    if not captured:
        return {"state": "not-captured"}
    seen = captured[-1]
    state = "none" if seen.ai_state == "absent" else "cited" if any(store.on_host(cited, host) for cited in seen.cited) else "overview"
    return {"state": state, "tool": seen.tool, "age_days": round((now - seen.at).total_seconds() / 86400, 2)}


def _add_own(table: dict, key, clicks, impressions, position) -> None:
    """Spellings with the same key (store.keyword_key: "café", "cafe", "Café") are one search: clicks and impressions add
    up, and the position is weighted by impressions."""
    slot = table.setdefault(key, {"clicks": 0, "impressions": 0, "_weighted": 0.0, "_shown": 0, "_plain": None, "spellings": 0})
    shown = int(impressions or 0)
    slot["clicks"] += int(clicks or 0)
    slot["impressions"] += shown
    slot["spellings"] += 1
    if position is not None:
        if shown:
            slot["_weighted"] += float(position) * shown
            slot["_shown"] += shown
        elif slot["_plain"] is None:
            slot["_plain"] = float(position)


def _settle_own(table: dict) -> dict:
    for slot in table.values():
        slot["position"] = slot["_weighted"] / slot["_shown"] if slot["_shown"] else slot["_plain"]
        for name in ("_weighted", "_shown", "_plain"):
            slot.pop(name, None)
    return table


def _own_tools(conn, site_ids: list[int]) -> dict:
    """Search Console, Bing's and Yandex's own numbers for my sites, by the keyword's key (store.keyword_key). Empty until each is connected."""
    tables: dict[str, dict] = {"google": {}, "bing": {}, "yandex": {}, "google_country": {}}
    pages: dict = defaultdict(dict)
    through = {}
    if not site_ids:
        return {"positions": tables, "pages": pages, "through": through}
    marks = ",".join(str(int(i)) for i in site_ids)
    for row in conn.execute(text(f"SELECT site_id, MAX(day) AS last FROM gsc_query WHERE site_id IN ({marks}) GROUP BY site_id")).mappings():
        through[row["site_id"]] = row["last"]
    for site_id, last in through.items():
        for row in conn.execute(
            text(
                "SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position "
                f"FROM gsc_query WHERE site_id = :s AND day > :last - INTERVAL {OWN_DAYS} DAY GROUP BY query_hash, query"
            ),
            {"s": site_id, "last": last},
        ).mappings():
            _add_own(tables["google"], (site_id, store.keyword_key(row["query"])), row["clicks"], row["impressions"], row["position"])
        for row in conn.execute(
            text(f"SELECT query, page, SUM(impressions) AS impressions FROM gsc_query_page WHERE site_id = :s AND day > :last - INTERVAL {OWN_DAYS} DAY GROUP BY pair_hash, query, page"),
            {"s": site_id, "last": last},
        ).mappings():
            seen = pages[(site_id, store.keyword_key(row["query"]))]
            seen[row["page"]] = seen.get(row["page"], 0) + int(row["impressions"] or 0)
        # The same, in each country the site's queries are read for: a keyword's own country, not a world average.
        for row in conn.execute(
            text(
                "SELECT country, query, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position "
                f"FROM gsc_query_country WHERE site_id = :s AND day > :last - INTERVAL {OWN_DAYS} DAY AND day <= :last GROUP BY country, query_hash, query"
            ),
            {"s": site_id, "last": last},
        ).mappings():
            _add_own(tables["google_country"], (site_id, row["country"], store.keyword_key(row["query"])), row["clicks"], row["impressions"], row["position"])
    for row in conn.execute(text(f"SELECT site_id, query, clicks, impressions, position FROM bing_query WHERE site_id IN ({marks})")).mappings():
        _add_own(tables["bing"], (row["site_id"], store.keyword_key(row["query"])), row["clicks"], row["impressions"], row["position"])
    for row in conn.execute(text(f"SELECT site_id, query, clicks, shows, position FROM yandex_query WHERE site_id IN ({marks})")).mappings():
        _add_own(tables["yandex"], (row["site_id"], store.keyword_key(row["query"])), row["clicks"], row["shows"], row["position"])
    for table in tables.values():
        _settle_own(table)
    return {"positions": tables, "pages": pages, "through": through}


def _rows(engine: Engine, site_id: int | None, keyword_id: int | None = None) -> dict:
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        site_ids = [site["id"] for site in sites]
        hosts = {site["id"]: site["host"] for site in sites}
        now = conn.execute(text("SELECT UTC_TIMESTAMP(3)")).scalar()
        tracked = []
        if site_ids:
            marks = ",".join(str(i) for i in site_ids)
            clause = "AND k.id = :k" if keyword_id is not None else ""
            tracked = conn.execute(
                text(f"SELECT sk.site_id, k.id, k.keyword, k.country, k.language FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id IN ({marks}) {clause} ORDER BY k.keyword"),
                {"k": keyword_id},
            ).mappings().all()
        checks = _load_checks(conn, list({row["id"] for row in tracked}), list(hosts.values()))
        own = _own_tools(conn, site_ids)
        # Whichever button pressed it: this screen's Refresh, or Check again in Competitors.
        finished = [
            conn.execute(text("SELECT MAX(finished_at) FROM rank_runs")).scalar(),
            conn.execute(text("SELECT MAX(finished_at) FROM keyword_uploads WHERE kind = 'refresh'")).scalar(),
        ]
        last_run = max((day for day in finished if day), default=None)
    order = {name: connections.order_for(engine, name) for name in ENGINES}
    gap = int(connections.get_setting(engine, "disagree_gap"))
    rows = []
    for track in tracked:
        host, key = hosts[track["site_id"]], store.keyword_key(track["keyword"])
        engines = {}
        for name in ENGINES:
            own_row = own["positions"].get(name, {}).get((track["site_id"], key))
            engines[name] = engine_view(checks.get((track["id"], name), []), host, track["country"], track["language"], order[name], gap, now, own_row)
        ai = _ai(checks.get((track["id"], "google"), []), host, track["country"], track["language"], now)
        pages_seen = _fold_pages(own["pages"].get((track["site_id"], key), {}))
        latest_google = checks.get((track["id"], "google"), [])
        # Two addresses: a result whose address Google hid may be either page, so it isn't a second one.
        scraped_two = latest_google and len({page_address(row[1]) for row in latest_google[-1].rows if row[1] and store.on_host(row[2], host)}) >= 2
        # Which pages they are: Search Console's by impressions, then any other address the latest Google check found.
        competing = [{"url": url, "impressions": shows, "position": None} for url, shows in sorted(pages_seen.items(), key=lambda kv: -kv[1])]
        if latest_google:
            for position, url, row_host in latest_google[-1].rows:
                if not url or not store.on_host(row_host, host):
                    continue
                url = page_address(url)
                known = next((item for item in competing if item["url"].rstrip("/") == url.rstrip("/")), None)
                if known:
                    known["position"] = known["position"] or position
                else:
                    competing.append({"url": url, "impressions": None, "position": position})
        # The page that ranked: the URL our newest check found (Google first). Search Console's most-shown page over 28 days is
        # another fact, kept apart and named as such on screen ("Most shown in Search Console"), never passed off as the ranking URL.
        main_url = next((view["main"]["url"] for view in engines.values() if view["main"] and view["main"]["url"]), None)
        gsc_page = max(pages_seen, key=pages_seen.get) if pages_seen else None
        page = main_url or gsc_page
        google_own = own["positions"]["google"].get((track["site_id"], key))
        code3 = countries.alpha3(track["country"]) if track["country"] else None
        local = own["positions"].get("google_country", {}).get((track["site_id"], code3, key)) if code3 else None
        rows.append({
            "id": f"{track['site_id']}:{track['id']}", "keyword_id": track["id"], "site_id": track["site_id"], "site": host, "keyword": track["keyword"],
            "country": track["country"], "language": track["language"], "engines": engines, "ai": ai, "page": page,
            "ranking_url": main_url, "gsc_page": gsc_page, "spellings": google_own["spellings"] if google_own else 0,
            "two_pages": len(pages_seen) >= 2 or bool(scraped_two),
            "pages": competing if len(pages_seen) >= 2 or scraped_two else [],
            # "volume" is kept for older readers: it was never search volume, only our own impressions over 28 days.
            "volume": google_own["impressions"] if google_own else None, "impressions": google_own["impressions"] if google_own else None,
            # Search Console in the keyword's own country, when the site's queries are read for it (None otherwise; the
            # world average stays in engines.google.own).
            "own_country": {"country": track["country"].upper(), **{k: (round(v, 1) if k == "position" and v is not None else v) for k, v in local.items() if k != "spellings"}} if local else None,
        })
    return {"rows": rows, "through": own["through"], "last_refresh": last_run, "now": now, "order": order, "gap": gap}


GAINS, DROPS = ("up", "new"), ("down", "lost")


def top10_step(view: dict) -> int:
    """+1 when a like-for-like pair entered the top 10, −1 when it left it, 0 otherwise. Dropping out of the depth checked
    (at depth 10, the top 10 itself) is leaving it; coming in from beyond it is entering."""
    move, main = view.get("move"), view.get("main") or {}
    if move is None:
        return 0
    now_p, was = main.get("p"), view.get("was")
    inside_now = now_p is not None and now_p <= 10
    inside_then = was is not None and was <= 10
    return (1 if inside_now and not inside_then else 0) - (1 if inside_then and not inside_now else 0)


def tiles(rows: list[dict], engine_name: str) -> dict:
    """Top 10 here always means scraped results. It's never added to Search Console's, and its change only counts like-for-like pairs.
    A keyword that left the depth checked counts as Down ("lost"), one that came in as Up ("new")."""
    tracked = len(rows)
    ranked = top10 = up = down = compared = lost = new = none = cited = 0
    top10_change = 0
    for row in rows:
        view = row["engines"][engine_name]
        main = view["main"]
        usable = main and main["status"] == "ok"
        position = main["p"] if usable else None
        if position is not None:
            ranked += 1
            if position <= 10:
                top10 += 1
        elif usable:  # checked, and not found. A keyword nobody has checked yet isn't "not ranked": nothing is known.
            none += 1
        move = view.get("move")
        if move is not None:
            compared += 1
            up += move in GAINS
            down += move in DROPS
            lost += move == "lost"
            new += move == "new"
            top10_change += top10_step(view)
        cited += row["ai"]["state"] == "cited"
    return {
        "tracked": tracked, "ranked": ranked, "not_ranked": none, "top10": top10, "top10_source": "scraped", "up": up, "down": down, "lost": lost, "new": new,
        "top10_change": top10_change if compared else None, "compared": compared, "cited": cited,
    }


def rows_of_site(engine: Engine, site_id: int) -> list[dict]:
    """The same rows the Keywords screen shows, for Insights to read beside Search Console."""
    return _rows(engine, site_id)["rows"]


def _first_checks(engine: Engine, rows: list[dict]) -> None:
    """A keyword just added waits for its first free check (an upload's run, seo.competitors.keywords). Until a result comes,
    its row says which tool is on it ("Checking with SerpApi…") instead of blank dashes."""
    from seo.competitors.keywords import _HAS_JOB, STALE_RUN_SECONDS

    if not rows:
        return
    with engine.connect() as conn:
        waiting = conn.execute(text(
            "SELECT sk.site_id, sk.keyword_id, u.engine, u.tool FROM keyword_uploads u JOIN site_keywords sk ON sk.upload_id = u.id "
            f"WHERE u.kind = 'upload' AND u.status IN ('queued', 'running') AND (u.created_at >= UTC_TIMESTAMP(3) - INTERVAL {STALE_RUN_SECONDS} SECOND OR {_HAS_JOB})"
        )).mappings().all()
    if not waiting:
        return
    first_tool: dict[str, str | None] = {}

    def tool_for(name: str) -> str | None:
        if name not in first_tool:
            line = connections.not_blocked(engine, connections.tools_for(engine, name))
            first_tool[name] = line[0].name if line else None
        return first_tool[name]

    by_key = {(w["site_id"], w["keyword_id"]): w for w in waiting}
    for row in rows:
        w = by_key.get((row["site_id"], row["keyword_id"]))
        if w is None or any(view["main"] for view in row["engines"].values()):
            continue
        row["checking"] = {"engine": w["engine"], "tool": w["tool"] or tool_for(w["engine"])}


def listing(engine: Engine, site_id: int | None = None) -> dict:
    built = _rows(engine, site_id)
    _first_checks(engine, built["rows"])
    through = [day for day in built["through"].values() if day]
    return {
        "rows": built["rows"], "tiles": {name: tiles(built["rows"], name) for name in ENGINES},
        "data_through": str(max(through)) if through else None, "last_refresh": _iso(built["last_refresh"]), "order": built["order"], "disagree_gap": built["gap"], "site_id": site_id,
    }


def detail(engine: Engine, site_id: int, keyword_id: int, engine_name: str) -> dict:
    """Everything the side panel shows: every tool, every check, and who else is on the page."""
    if engine_name not in ENGINES:
        raise NotFound("That search engine doesn't exist.")
    built = _rows(engine, site_id, keyword_id)
    if not built["rows"]:
        raise NotFound("That keyword isn't tracked by this site.")
    row = built["rows"][0]
    view = row["engines"][engine_name]
    with engine.connect() as conn:
        host = require_own(conn, site_id)["host"]
        target = conn.execute(text(f"SELECT id FROM serp_targets WHERE keyword_id = :k AND engine = :e AND device = '{DEVICE}'"), {"k": keyword_id, "e": engine_name}).scalar()
        every = conn.execute(
            text("SELECT id, tool, real_location, depth, status, error, checked_at FROM serp_checks WHERE target_id = :t ORDER BY id DESC LIMIT 200"),
            {"t": target},
        ).mappings().all() if target else []
        marks = ",".join(str(int(check["id"])) for check in every) or "0"
        own_rows: dict[int, int] = {}
        own_urls: dict[int, str | None] = {}  # the page of mine each check found: the ranking URL, check by check
        for result in conn.execute(text(f"SELECT check_id, position, url, host FROM serp_results WHERE check_id IN ({marks}) ORDER BY position")).mappings():
            if result["check_id"] not in own_rows and store.on_host(result["host"], host):
                own_rows[result["check_id"]] = result["position"]
                own_urls[result["check_id"]] = page_address(result["url"]) if result["url"] else None
        main = view["main"]
        competitors = []
        if main:
            rows_now = conn.execute(text("SELECT position, url, host, domain FROM serp_results WHERE check_id = :c ORDER BY position LIMIT 50"), {"c": main["check_id"]}).mappings().all()
            before = next((check for check in every if check["id"] < main["check_id"] and check["status"] == "ok" and check["tool"] == main["tool"] and check["real_location"] == main["location"] and check["depth"] == main["depth"]), None)
            then = {}
            if before:
                for old in conn.execute(text("SELECT position, domain FROM serp_results WHERE check_id = :c ORDER BY position"), {"c": before["id"]}).mappings():
                    then.setdefault(old["domain"], old["position"])
            rival_hosts = {r[0] for r in conn.execute(text("SELECT s.host FROM site_competitors sc JOIN sites s ON s.id = sc.competitor_id WHERE sc.site_id = :s AND sc.tracking = 'on'"), {"s": site_id}).all()}
            for result in rows_now:
                mine = store.on_host(result["host"], host)
                was = then.get(result["domain"])
                competitors.append({
                    "position": result["position"], "host": store.to_display_host(result["host"]), "url": result["url"], "mine": mine,
                    "rival": any(store.on_host(result["host"], rival) for rival in rival_hosts), "change": (was - result["position"]) if before and was else None,
                    # Saved before 2026-11-11 from Google's hidden link, under google.com: whose result it was isn't known.
                    "hidden": google_redirect(result["url"]),
                })
    # A line per tool, location and depth: only those can share a chart.
    lines: dict[tuple, dict] = {}
    for check in reversed(every):
        if check["status"] == "failed":
            continue
        key = (check["tool"], check["real_location"], check["depth"])
        line = lines.setdefault(key, {"tool": key[0], "location": key[1], "depth": key[2], "home": counts_for_keyword(engine_name, row["country"], key[1], row["language"]), "points": []})
        line["points"].append({"at": _iso(check["checked_at"]), "p": own_rows.get(check["id"]), "suspect": check["status"] == "suspect"})
    listed = connections.tool_list(engine)
    return {
        "row": {**row, "engines": {engine_name: view}}, "engine": engine_name, "lines": list(lines.values()), "competitors": competitors,
        "checks": [
            {"id": check["id"], "tool": check["tool"], "location": check["real_location"], "depth": check["depth"], "status": check["status"], "error": check["error"], "p": own_rows.get(check["id"]), "url": own_urls.get(check["id"]), "checked_at": _iso(check["checked_at"])}
            for check in every
        ],
        "tools": [tool for tool in listed["tools"] if engine_name in tool["engines"] or tool["name"] in connections.DEFAULT_ORDER.get(engine_name, [])],
        "order": connections.order_for(engine, engine_name), "disagree_gap": built["gap"],
    }


def queries(engine: Engine, site_id: int | None, engine_name: str) -> dict:
    """What each engine's own tool says, keyword or not. Bing updates weekly, and the others lag a few days."""
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        rows = []
        for site in sites:
            if engine_name == "google":
                last = conn.execute(text("SELECT MAX(day) FROM gsc_query WHERE site_id = :s"), {"s": site["id"]}).scalar()
                if not last:
                    continue
                found = conn.execute(
                    text(
                        "SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position "
                        f"FROM gsc_query WHERE site_id = :s AND day > :last - INTERVAL {OWN_DAYS} DAY GROUP BY query_hash, query ORDER BY clicks DESC, impressions DESC LIMIT 500"
                    ),
                    {"s": site["id"], "last": last},
                ).mappings().all()
            elif engine_name == "bing":
                found = conn.execute(text("SELECT query, clicks, impressions, position FROM bing_query WHERE site_id = :s ORDER BY clicks DESC, impressions DESC LIMIT 500"), {"s": site["id"]}).mappings().all()
            elif engine_name == "yandex":
                found = conn.execute(text("SELECT query, clicks, shows AS impressions, position FROM yandex_query WHERE site_id = :s ORDER BY clicks DESC, shows DESC LIMIT 500"), {"s": site["id"]}).mappings().all()
            else:
                found = []
            rows += [
                {"site": site["host"], "query": row["query"], "clicks": int(row["clicks"] or 0), "impressions": int(row["impressions"] or 0), "position": float(row["position"]) if row["position"] is not None else None}
                for row in found
            ]
    return {"rows": rows[:1000], "engine": engine_name}


def forget(engine: Engine, site_id: int, keyword_id: int) -> None:
    """Stop following a keyword on this site. Its past checks stay, because nothing is ever overwritten."""
    with engine.begin() as conn:
        require_own(conn, site_id)
        gone = conn.execute(text("DELETE FROM site_keywords WHERE site_id = :s AND keyword_id = :k"), {"s": site_id, "k": keyword_id}).rowcount
    if not gone:
        raise NotFound("That keyword isn't tracked by this site.")


def follow_again(engine: Engine, site_id: int, keyword_id: int) -> None:
    with engine.begin() as conn:
        require_own(conn, site_id)
        if not conn.execute(text("SELECT 1 FROM keywords WHERE id = :k"), {"k": keyword_id}).first():
            raise NotFound("That keyword doesn't exist.")
        conn.execute(text("INSERT IGNORE INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site_id, "k": keyword_id})
