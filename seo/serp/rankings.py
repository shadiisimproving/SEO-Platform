"""What the Keywords screen shows: every ranking with its tool, and numbers that never mix unlike results.

Change, Up, Down, the trend and the Top 10 change only compare checks with the same tool, location and depth, on the same
target (which holds the device). A tool switch shows no number, and says so. Beyond the depth checked is ">10", not a drop.
Suspect results stay visible, and are left out of trends. A check from another location stays on its own line.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
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


TWO_PAGES_SHARE = 0.2  # a second page with fewer of the impressions is a stray showing, not a page competing


def second_page_counts(pages_seen: dict) -> bool:
    """Two of my pages compete in Search Console when the second one holds a real share of the keyword's impressions
    (at least TWO_PAGES_SHARE of them), not when it showed once (rankings review 3.8: 41 against 1)."""
    shows = sorted((n or 0 for n in pages_seen.values()), reverse=True)
    total = sum(shows)
    return len(shows) >= 2 and total > 0 and shows[1] / total >= TWO_PAGES_SHARE


def _fold_pages(seen: dict) -> dict:
    """Search Console's pages for one query, tagged copies added into their page's impressions."""
    folded: dict = {}
    for url, shows in seen.items():
        page = page_address(url)
        folded[page] = folded.get(page, 0) + (shows or 0)
    return folded

ENGINES = connections.ENGINE_ORDER
DEVICE = "desktop"  # the screen shows desktop. A mobile check is another target, so it can never be compared with these.
HOURS_TO_AGREE = store.CROSS_HOURS  # tools disagree only between checks this close (store.clash)
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
    why: str | None = None  # a suspect check's reason (serp_checks.error)

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
                f"SELECT c.id, t.keyword_id, t.engine, c.tool, c.real_location, c.depth, c.status, c.ai_state, c.checked_at, c.error FROM serp_targets t JOIN serp_checks c ON c.target_id = t.id "
                f"WHERE t.device = '{DEVICE}' AND t.keyword_id IN ({marks}) AND c.status IN ('ok', 'suspect') ORDER BY c.id"
            )
        ).mappings():
            seen = Seen(row["id"], row["keyword_id"], row["engine"], row["tool"], row["real_location"], row["depth"], row["status"], row["ai_state"], row["checked_at"], why=row["error"] if row["status"] == "suspect" else None)
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


def _read(seen: Seen, host: str) -> store.Read:
    return store.Read(seen.check_id, seen.tool, seen.depth, seen.at, seen.position(host), can_miss=seen.status == "ok")


def _view(seen: Seen, host: str, now: datetime, home: bool, verdict: str | None = None) -> dict:
    best = seen.own(host)
    return {
        "check_id": seen.check_id, "tool": seen.tool, "p": best[0] if best else None, "url": best[1] if best else None, "depth": seen.depth, "location": seen.location,
        "checked_at": _iso(seen.at), "age_days": round((now - seen.at).total_seconds() / 86400, 2), "status": seen.status, "home": home, "verdict": verdict or seen.status,
        "why": store.suspect_why(seen.why),
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


def engine_view(checks: list[Seen], host: str, country: str, language: str, order: list[str], gap: int, now: datetime, own: dict | None = None, main_tool: str = "") -> dict:
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
        # The main tool's result while it is fresh, otherwise the newest (store.pick_main, the rule every screen shares).
        main, passed_over = store.pick_main(list(latest_by_tool.values()), main_tool, now, tool=lambda c: c.tool, ident=lambda c: c.check_id, at=lambda c: c.at)
    flagged_only = False
    if main is None and home:  # only suspect results: shown as such, and counted as nothing
        main, flagged_only = home[-1], True

    # Tools that disagree (store.settle, the rule Competitors shares): a third tool's check of the same days decides which is
    # shown; with none, the newest stays and the row carries the other answer too ("also").
    disagree = None
    if main is not None and not flagged_only:
        reads = {seen.check_id: _read(seen, host) for seen in home}
        witnesses = [reads[seen.check_id] for seen in home if store.can_witness(seen.why)]
        locked = bool(main_tool) and main.tool == main_tool and passed_over is None
        shown, disagree = store.settle(reads[main.check_id], [reads[seen.check_id] for seen in latest_by_tool.values()], witnesses, gap, locked)
        if shown.id != main.check_id:
            main = next(seen for seen in good if seen.check_id == shown.id)

    change, change_note, trend, move, was, url_changed, history = None, None, [], None, None, False, []
    if main is not None and not flagged_only:
        same = [seen for seen in good if seen.kind() == main.kind()]
        before = [seen for seen in same if seen.check_id < main.check_id]
        trend = [{"at": _iso(seen.at), "p": seen.position(host)} for seen in same if seen.position(host) is not None]
        # Every check with the main one's tool, place and depth, "not found" ones too (p None): By bucket's period change
        # needs them to tell a keyword that entered the results from one that was never checked before the period.
        history = [{"at": _iso(seen.at), "p": seen.position(host)} for seen in same if seen.check_id <= main.check_id]
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
        "change": change, "change_note": change_note, "move": move, "was": was, "url_changed": url_changed, "trend": trend, "history": history, "others": others, "suspects": suspects, "disagree": disagree,
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


def _add_own(table: dict, key, query: str, clicks, impressions, position) -> None:
    """Queries with the same matching key (store.match_key) count for one tracked keyword: clicks and impressions add up,
    and the position is weighted by impressions. Which spellings went in is kept, so the screen can say so."""
    slot = table.setdefault(key, {"clicks": 0, "impressions": 0, "_weighted": 0.0, "_shown": 0, "_plain": None, "_queries": set()})
    shown = int(impressions or 0)
    slot["clicks"] += int(clicks or 0)
    slot["impressions"] += shown
    slot["_queries"].add(store.clean_keyword(query).casefold())
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


def _public(slot: dict | None) -> dict | None:
    return {k: v for k, v in slot.items() if not k.startswith("_")} if slot else None


def tracked_spellings(conn, site_ids: list[int]) -> dict[int, frozenset]:
    """Per site, the matching keys tracked under two or more spellings (store.shared_keys)."""
    if not site_ids:
        return {}
    marks = ",".join(str(int(i)) for i in site_ids)
    words: dict[int, list] = defaultdict(list)
    for row in conn.execute(text(f"SELECT sk.site_id, k.keyword FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id IN ({marks})")).mappings():
        words[row["site_id"]].append(row["keyword"])
    return {site_id: store.shared_keys(found) for site_id, found in words.items()}


def search_windows(engine: Engine, site_ids: list[int]) -> dict:
    """Per site, (first, last) day of Search Console's shared 28 days (period.for_site): Google's final days only."""
    from seo.metrics import period

    windows = {}
    for site_id in site_ids:
        scope, _ = period.for_site(engine, site_id, OWN_DAYS)
        windows[site_id] = (scope.start, scope.end)
    return windows


def _own_tools(conn, site_ids: list[int], shared: dict[int, frozenset] | None = None, windows: dict | None = None) -> dict:
    """Search Console, Bing's and Yandex's own numbers for my sites, by matching key (store.match_key): every spelling of a
    keyword tracked once, or only its exact query when the site tracks two spellings of it. Empty until each is connected."""
    shared = shared or {}
    tables: dict[str, dict] = {"google": {}, "bing": {}, "yandex": {}, "google_country": {}}
    pages: dict = defaultdict(dict)
    through = {}
    if not site_ids:
        return {"positions": tables, "pages": pages, "through": through}

    def key(site_id, query):
        return store.match_key(query, shared.get(site_id, frozenset()))

    marks = ",".join(str(int(i)) for i in site_ids)
    # The shared period (seo.metrics.period): the last 28 of Google's final days, as Overview and Insights count them.
    # Google's fresh days (the last two or three, still changing) never count.
    windows = windows or {}
    for row in conn.execute(text(f"SELECT site_id, MAX(day) AS last FROM gsc_query WHERE site_id IN ({marks}) GROUP BY site_id")).mappings():
        if row["last"] is not None:
            through[row["site_id"]] = windows.get(row["site_id"], (row["last"] - timedelta(days=OWN_DAYS - 1), row["last"]))[1]
    for site_id in list(through):
        first, last = windows.get(site_id, (through[site_id] - timedelta(days=OWN_DAYS - 1), through[site_id]))
        for row in conn.execute(
            text(
                "SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position "
                "FROM gsc_query WHERE site_id = :s AND day BETWEEN :first AND :last GROUP BY query_hash, query"
            ),
            {"s": site_id, "first": first, "last": last},
        ).mappings():
            _add_own(tables["google"], (site_id, key(site_id, row["query"])), row["query"], row["clicks"], row["impressions"], row["position"])
        for row in conn.execute(
            text("SELECT query, page, SUM(impressions) AS impressions FROM gsc_query_page WHERE site_id = :s AND day BETWEEN :first AND :last GROUP BY pair_hash, query, page"),
            {"s": site_id, "first": first, "last": last},
        ).mappings():
            seen = pages[(site_id, key(site_id, row["query"]))]
            seen[row["page"]] = seen.get(row["page"], 0) + int(row["impressions"] or 0)
        # The same, in each country the site's queries are read for: a keyword's own country, not a world average.
        for row in conn.execute(
            text(
                "SELECT country, query, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position "
                "FROM gsc_query_country WHERE site_id = :s AND day BETWEEN :first AND :last GROUP BY country, query_hash, query"
            ),
            {"s": site_id, "first": first, "last": last},
        ).mappings():
            _add_own(tables["google_country"], (site_id, row["country"], key(site_id, row["query"])), row["query"], row["clicks"], row["impressions"], row["position"])
    for row in conn.execute(text(f"SELECT site_id, query, clicks, impressions, position FROM bing_query WHERE site_id IN ({marks})")).mappings():
        _add_own(tables["bing"], (row["site_id"], key(row["site_id"], row["query"])), row["query"], row["clicks"], row["impressions"], row["position"])
    for row in conn.execute(text(f"SELECT site_id, query, clicks, shows, position FROM yandex_query WHERE site_id IN ({marks})")).mappings():
        _add_own(tables["yandex"], (row["site_id"], key(row["site_id"], row["query"])), row["query"], row["clicks"], row["shows"], row["position"])
    for table in tables.values():
        _settle_own(table)
    return {"positions": tables, "pages": pages, "through": through}


SPARK_DAYS = 28  # the row's sparkline: Search Console's daily position over these final days


def _gsc_daily(conn, tracked: list, through: dict) -> dict:
    """Search Console's daily position for each tracked keyword over its last SPARK_DAYS final days, for the row's sparkline:
    the keyword's own country when that country's rows reach the first day, otherwise every country (the panel's rule,
    metrics/keyword_timeline._series). {(site_id, keyword_id): [{day, p}]}, days with no impressions left out."""
    from seo.metrics.keyword_timeline import _hashes

    out: dict = {}
    by_site: dict = defaultdict(list)
    for track in tracked:
        by_site[track["site_id"]].append(track)
    for site_id, rows in by_site.items():
        last = through.get(site_id)
        final = conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": site_id}).scalar()
        if final and last and final < last:
            last = final
        # The shared period can end after the newest day Search Console has sent: the line ends on that day, not on empty ones.
        newest = conn.execute(text("SELECT MAX(day) FROM gsc_query WHERE site_id = :s"), {"s": site_id}).scalar()
        if newest and last and newest < last:
            last = newest
        if not last:
            continue
        first = last - timedelta(days=SPARK_DAYS - 1)
        hashes = {h: track for track in rows for h in _hashes(track["keyword"])}
        if not hashes:
            continue
        reach = {r["country"]: r["first"] for r in conn.execute(text("SELECT country, MIN(day) AS first FROM gsc_query_country WHERE site_id = :s GROUP BY country"), {"s": site_id}).mappings()}
        local_codes = {countries.alpha3(t["country"]) for t in rows if t["country"]} - {None}
        local_codes = {c for c in local_codes if reach.get(c) and reach[c] <= first}
        days: dict = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
        marks = ",".join(f":h{i}" for i in range(len(hashes)))
        params = {"s": site_id, "a": first, "b": last, **{f"h{i}": h for i, h in enumerate(hashes)}}
        for row in conn.execute(text(f"SELECT day, query, query_hash, impressions, position FROM gsc_query WHERE site_id = :s AND day BETWEEN :a AND :b AND query_hash IN ({marks})"), params).mappings():
            track = hashes[row["query_hash"]]
            code3 = countries.alpha3(track["country"]) if track["country"] else None
            if code3 in local_codes or not row["impressions"] or row["position"] is None:
                continue
            acc = days[(site_id, track["id"])][row["day"]]
            acc[0] += float(row["position"]) * int(row["impressions"]); acc[1] += int(row["impressions"])
        if local_codes:
            cmarks = ",".join(f":c{i}" for i in range(len(local_codes)))
            cparams = {**params, **{f"c{i}": c for i, c in enumerate(sorted(local_codes))}}
            for row in conn.execute(text(f"SELECT day, country, query_hash, impressions, position FROM gsc_query_country WHERE site_id = :s AND day BETWEEN :a AND :b AND country IN ({cmarks}) AND query_hash IN ({marks})"), cparams).mappings():
                track = hashes[row["query_hash"]]
                if countries.alpha3(track["country"]) != row["country"] or not row["impressions"] or row["position"] is None:
                    continue
                acc = days[(site_id, track["id"])][row["day"]]
                acc[0] += float(row["position"]) * int(row["impressions"]); acc[1] += int(row["impressions"])
        for key, by_day in days.items():
            out[key] = [{"day": str(day), "p": round(w / n, 1)} for day, (w, n) in sorted(by_day.items()) if n]
    return out


def _rows(engine: Engine, site_id: int | None, keyword_id: int | None = None) -> dict:
    # The shared period is read before this connection opens: a route never holds two connections at once (test_db_pool).
    with engine.connect() as conn:
        wanted = [site["id"] for site in _sites(conn, site_id)]
    windows = search_windows(engine, wanted)
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
        shared = tracked_spellings(conn, site_ids)  # all of each site's keywords, even when one keyword is asked for
        own = _own_tools(conn, site_ids, shared, windows)
        daily = _gsc_daily(conn, tracked, own["through"])
        from seo.serp import volumes

        searched = volumes.lookup(conn, [dict(t) for t in tracked])
        # Whichever button pressed it: this screen's Refresh, or Check again in Competitors.
        finished = [
            conn.execute(text("SELECT MAX(finished_at) FROM rank_runs")).scalar(),
            conn.execute(text("SELECT MAX(finished_at) FROM keyword_uploads WHERE kind = 'refresh'")).scalar(),
        ]
        last_run = max((day for day in finished if day), default=None)
    order = {name: connections.order_for(engine, name) for name in ENGINES}
    chosen_tool = connections.main_tool(engine)
    gap = int(connections.get_setting(engine, "disagree_gap"))
    rows = []
    for track in tracked:
        host, key = hosts[track["site_id"]], store.match_key(track["keyword"], shared.get(track["site_id"], frozenset()))
        engines = {}
        for name in ENGINES:
            own_row = own["positions"].get(name, {}).get((track["site_id"], key))
            engines[name] = engine_view(checks.get((track["id"], name), []), host, track["country"], track["language"], order[name], gap, now, _public(own_row), chosen_tool)
        ai = _ai(checks.get((track["id"], "google"), []), host, track["country"], track["language"], now)
        pages_seen = _fold_pages(own["pages"].get((track["site_id"], key), {}))
        # The check shown on Google (pick_main), not whichever check came last: a suspect or far-away one says nothing here.
        shown_id = (engines["google"]["main"] or {}).get("check_id")
        shown_check = next((seen for seen in checks.get((track["id"], "google"), []) if seen.check_id == shown_id), None)
        # Two addresses: a result whose address Google hid may be either page, so it isn't a second one.
        scraped_two = bool(shown_check) and len({page_address(row[1]) for row in shown_check.rows if row[1] and store.on_host(row[2], host)}) >= 2
        two_pages = scraped_two or second_page_counts(pages_seen)
        # Which pages they are: Search Console's by impressions, then any other address the shown check found.
        competing = [{"url": url, "impressions": shows, "position": None} for url, shows in sorted(pages_seen.items(), key=lambda kv: -kv[1])]
        if shown_check:
            for position, url, row_host in shown_check.rows:
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
            "ranking_url": main_url, "gsc_page": gsc_page,
            # Search Console's numbers include other spellings of it ("cafe" for "café"): only when the site tracks one spelling.
            "other_spellings": bool(google_own and google_own["_queries"] - {store.clean_keyword(track["keyword"]).casefold()}),
            "two_pages": two_pages,
            "pages": competing if two_pages else [],
            # Our own Search Console impressions over 28 days, under their real name. The row key "volume" that once held them
            # is gone: search volume is search_volume, always with its source (seo/serp/volumes.py), and never these.
            "impressions": google_own["impressions"] if google_own else None,
            "search_volume": volumes.of_row(searched, track["keyword"], track["country"]),
            "gsc_daily": daily.get((track["site_id"], track["id"]), []),
            # Search Console in the keyword's own country, when the site's queries are read for it (None otherwise; the
            # world average stays in engines.google.own).
            "own_country": {"country": track["country"].upper(), **{k: (round(v, 1) if k == "position" and v is not None else v) for k, v in local.items() if not k.startswith("_")}} if local else None,
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
            line = [t for t in connections.not_blocked(engine, connections.tools_for(engine, name)) if not connections.always_paid(t) or connections.paid_ready(engine, t)]
            first_tool[name] = line[0].name if line else None
        return first_tool[name]

    by_key = {(w["site_id"], w["keyword_id"]): w for w in waiting}
    for row in rows:
        w = by_key.get((row["site_id"], row["keyword_id"]))
        if w is None or any(view["main"] for view in row["engines"].values()):
            continue
        row["checking"] = {"engine": w["engine"], "tool": w["tool"] or tool_for(w["engine"])}


GSC_WINDOW = 7  # days averaged for one Search Console reading: a single day of it jumps around


def _gsc_two_windows(conn, table: str, site_id: int, then: tuple[date, date], now: tuple[date, date], by_country: bool) -> dict:
    """Impression-weighted position and impressions per query (and country) in two date windows, in one read."""
    lead = "country, " if by_country else ""
    sql = (
        f"SELECT {lead}query, "
        "SUM(CASE WHEN day BETWEEN :a1 AND :b1 THEN position * impressions END) / NULLIF(SUM(CASE WHEN day BETWEEN :a1 AND :b1 THEN impressions END), 0) AS then_p, "
        "SUM(CASE WHEN day BETWEEN :a1 AND :b1 THEN impressions ELSE 0 END) AS then_i, "
        "SUM(CASE WHEN day BETWEEN :a2 AND :b2 THEN position * impressions END) / NULLIF(SUM(CASE WHEN day BETWEEN :a2 AND :b2 THEN impressions END), 0) AS now_p, "
        "SUM(CASE WHEN day BETWEEN :a2 AND :b2 THEN impressions ELSE 0 END) AS now_i "
        f"FROM {table} WHERE site_id = :s AND (day BETWEEN :a1 AND :b1 OR day BETWEEN :a2 AND :b2) GROUP BY {lead}query_hash, query"
    )
    out = {}
    for row in conn.execute(text(sql), {"s": site_id, "a1": then[0], "b1": then[1], "a2": now[0], "b2": now[1]}).mappings():
        key = store.clean_keyword(row["query"]).casefold()
        reading = {
            "then": round(float(row["then_p"]), 1) if row["then_p"] is not None else None, "then_impressions": int(row["then_i"] or 0),
            "now": round(float(row["now_p"]), 1) if row["now_p"] is not None else None, "now_impressions": int(row["now_i"] or 0),
        }
        out[(row["country"], key) if by_country else key] = reading
    return out


def gsc_positions(engine: Engine, site_id: int | None, then_end: date, now_end: date) -> dict:
    """Search Console's position for every tracked keyword at two moments, for By bucket's "Search Console" source: the
    7 days ending on `then_end` (the day before the period, or a year back) and the 7 days ending on `now_end`, or on the
    last final day Search Console has when that is earlier (site_sources.data_through).
    Impression-weighted, like the table's own column. The keyword's own country when that country's rows reach back to the
    first window's days, otherwise every country for both numbers: one table never gives "before" and the other "now".
    No impressions in a window: no position (None), which By bucket shows as no data, never as "lost"."""
    if then_end > now_end:
        then_end = now_end
    span = timedelta(days=GSC_WINDOW - 1)
    rows, through = {}, {}
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
        for site in sites:
            last = conn.execute(text("SELECT MAX(day) FROM gsc_query WHERE site_id = :s"), {"s": site["id"]}).scalar()
            if not last:
                continue
            # After data_through come Google's early numbers, read again until final (collectors/gsc.py): left out.
            final = conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": site["id"]}).scalar()
            if final and final < last:
                last = final
            end = min(now_end, last)
            start = min(then_end, end)
            then, now = (start - span, start), (end - span, end)
            through[site["host"]] = {"then": str(start), "now": str(end)}
            tracked = conn.execute(
                text("SELECT k.id, k.keyword, k.country FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s"), {"s": site["id"]}
            ).mappings().all()
            reach = {r["country"]: r["first"] for r in conn.execute(text("SELECT country, MIN(day) AS first FROM gsc_query_country WHERE site_id = :s GROUP BY country"), {"s": site["id"]}).mappings()}
            everywhere = _gsc_two_windows(conn, "gsc_query", site["id"], then, now, False)
            wanted = {countries.alpha3(t["country"]) for t in tracked if t["country"]} - {None}
            local = _gsc_two_windows(conn, "gsc_query_country", site["id"], then, now, True) if any(reach.get(c) and reach[c] <= then[1] for c in wanted) else {}
            for track in tracked:
                key = store.clean_keyword(track["keyword"]).casefold()
                code3 = countries.alpha3(track["country"]) if track["country"] else None
                if code3 and reach.get(code3) and reach[code3] <= then[1]:  # the country has days in the "before" window
                    reading, scope = local.get((code3, key)), code3
                else:
                    reading, scope = everywhere.get(key), "all"
                empty = {"then": None, "then_impressions": 0, "now": None, "now_impressions": 0}
                rows[f"{site['id']}:{track['id']}"] = {**(reading or empty), "scope": scope}
    return {"rows": rows, "through": through, "window_days": GSC_WINDOW}


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
        own_urls: dict[int, str | None] = {}  # the page of mine each check found: the ranking URL, check by check, one line per page
        for result in conn.execute(text(f"SELECT check_id, position, url, host FROM serp_results WHERE check_id IN ({marks}) ORDER BY position")).mappings():
            if result["check_id"] not in own_rows and store.on_host(result["host"], host):
                own_rows[result["check_id"]] = result["position"]
                own_urls[result["check_id"]] = page_address(result["url"]) if result["url"] and not google_redirect(result["url"]) else None
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
        line["points"].append({"at": _iso(check["checked_at"]), "p": own_rows.get(check["id"]), "url": own_urls.get(check["id"]), "suspect": check["status"] == "suspect"})
    listed = connections.tool_list(engine)
    return {
        "row": {**row, "engines": {engine_name: view}}, "engine": engine_name, "lines": list(lines.values()), "competitors": competitors,
        "checks": [
            {"id": check["id"], "tool": check["tool"], "location": check["real_location"], "depth": check["depth"], "status": check["status"], "error": check["error"], "why": store.suspect_why(check["error"]) if check["status"] == "suspect" else None, "p": own_rows.get(check["id"]), "url": own_urls.get(check["id"]), "checked_at": _iso(check["checked_at"])}
            for check in every
        ],
        "tools": [tool for tool in listed["tools"] if engine_name in tool["engines"] or tool["name"] in connections.DEFAULT_ORDER.get(engine_name, [])],
        "order": connections.order_for(engine, engine_name), "disagree_gap": built["gap"],
    }


def queries(engine: Engine, site_id: int | None, engine_name: str) -> dict:
    """What each engine's own tool says, keyword or not. Bing updates weekly, and the others lag a few days."""
    with engine.connect() as conn:
        sites = _sites(conn, site_id)
    windows = search_windows(engine, [site["id"] for site in sites]) if engine_name == "google" else {}
    with engine.connect() as conn:
        rows = []
        for site in sites:
            if engine_name == "google":
                if not conn.execute(text("SELECT 1 FROM gsc_query WHERE site_id = :s LIMIT 1"), {"s": site["id"]}).first():
                    continue
                first, last = windows[site["id"]]
                found = conn.execute(
                    text(
                        "SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position "
                        "FROM gsc_query WHERE site_id = :s AND day BETWEEN :first AND :last GROUP BY query_hash, query ORDER BY clicks DESC, impressions DESC LIMIT 500"
                    ),
                    {"s": site["id"], "first": first, "last": last},
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
