"""A believable world for trying the app by hand and for the sample screens. Nothing here touches the internet.

Everything goes through the real code: a fake search tool answers instead of a real one, and the websites
are pages held in memory behind the real polite fetcher. Sites use .example addresses, so it's unmistakably sample data.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from sqlalchemy import text

from seo.collectors.common import digest

from seo.backlinks import live, service as backlinks
from seo.competitors import crawl, gaps, keywords, notes, pages, suggest  # noqa: F401 - registers job handlers
from seo.crawl.fetch import PoliteFetcher
from seo.health import service as health
from seo.links import service as links
from seo.serp import connections, store
from seo.uptime import service as uptime
from seo.serp.tools import ABSENT, NOT_CAPTURED, PRESENT, Answer, Found, SearchFailed, ToolStopped
from seo.worker.runner import tick

ME, ME2, EMPTY = "site-one.example", "site-two.example", "site-three.example"
NO_ICON = {"forum-cafe.example"}  # so the first-letter fallback can be seen
RIVALS = ("rival-one.example", "rival-two.example", "cafe-monde.example")

# keyword, country, language, and who ranks where. "me" is site-one.
KEYWORDS = [
    ("coffee subscription", "FR", "en", ["rival-one.example/subscription", "site-one.example/subscription", "wikipedia.org/wiki/Coffee", "rival-two.example/plans", "beans-daily.example/box", "youtube.com/watch", "amazon.fr/coffee", "cafe-monde.example/abonnement"]),
    ("abonnement café", "FR", "fr", ["cafe-monde.example/abonnement", "rival-one.example/subscription", "site-one.example/abonnement", "rival-two.example/plans", "beans-daily.example/box", "economie.gouv.fr/cafe"]),
    ("café en grains", "FR", "fr", ["site-one.example/cafe-grains", "cafe-monde.example/grains", "rival-two.example/beans", "amazon.fr/grains", "beans-daily.example/beans"]),
    ("best coffee beans", "FR", "en", ["rival-two.example/beans", "rival-one.example/best-beans", "reddit.com/r/coffee", "beans-daily.example/beans", "site-one.example/cafe-grains", "youtube.com/watch2"]),
    ("specialty coffee online", "FR", "en", ["rival-one.example/shop", "beans-daily.example/shop", "cafe-monde.example/boutique", "rival-two.example/shop"]),
    ("قهوة مختصة", "FR", "ar", ["cafe-monde.example/ar/qahwa", "site-one.example/ar/qahwa", "rival-one.example/ar", "wikipedia.org/wiki/Qahwa"]),
    ("moulin à café", "FR", "fr", ["rival-two.example/grinders", "amazon.fr/moulin", "site-one.example/moulins", "cafe-monde.example/moulins"]),
    ("how to brew coffee", "FR", "en", ["rival-one.example/guide/brew", "site-one.example/guide/brew", "youtube.com/brew", "wikipedia.org/wiki/Brewed_coffee", "beans-daily.example/brew"]),
    ("コーヒー 定期便", "FR", "ja", ["rival-one.example/jp", "beans-daily.example/jp"]),
    ("cafe decaffeine", "FR", "fr", ["site-one.example/decafeine", "cafe-monde.example/decaf"]),
]


def _ai_for(keyword: str, round_no: int) -> tuple[str, list[str]]:
    """Who the AI Overview cites, changing between rounds so there's something to watch."""
    table = {
        "coffee subscription": [(PRESENT, ["rival-one.example/subscription", "wikipedia.org/wiki/Coffee"]), (PRESENT, ["rival-one.example/subscription", "site-one.example/subscription"]), (PRESENT, ["site-one.example/subscription", "rival-two.example/plans", "rival-one.example/subscription"])],
        "best coffee beans": [(ABSENT, []), (PRESENT, ["rival-two.example/beans", "reddit.com/r/coffee"]), (PRESENT, ["rival-two.example/beans", "beans-daily.example/beans"])],
        "how to brew coffee": [(PRESENT, ["site-one.example/guide/brew", "wikipedia.org/wiki/Brewed_coffee"]), (PRESENT, ["site-one.example/guide/brew"]), (PRESENT, ["rival-one.example/guide/brew", "wikipedia.org/wiki/Brewed_coffee"])],
        "abonnement café": [(ABSENT, []), (ABSENT, []), (ABSENT, [])],
        "café en grains": [(PRESENT, ["cafe-monde.example/grains"]), (ABSENT, []), (ABSENT, [])],
        "specialty coffee online": [(ABSENT, []), (ABSENT, []), (PRESENT, ["beans-daily.example/shop", "rival-one.example/shop"])],
    }
    states = table.get(keyword)
    if not states:
        return NOT_CAPTURED, []  # this keyword only ever went through a tool that can't see AI Overviews
    return states[min(round_no, len(states) - 1)]


class DemoTool:
    """Answers like a real tool, from the table above. Each round moves a few positions."""

    name = "SerpApi"
    engines = ("google",)
    free_monthly = 250
    gives_ai = True

    def __init__(self, round_no: int = 2):
        self.round_no = round_no

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        row = next((k for k in KEYWORDS if k[0] == keyword), None)
        order = list(row[3]) if row else [f"{RIVALS[len(keyword) % 3]}/page", f"new-entrant.example/{len(keyword)}", f"{ME}/page"]
        if self.round_no == 0 and len(order) > 2:
            order[0], order[2] = order[2], order[0]
        elif self.round_no == 1 and len(order) > 1:
            order[0], order[1] = order[1], order[0]
        results = [Found(i + 1, f"https://{path}" if "/" in path else f"https://{path}/", f"{path.split('/')[0]}: {keyword}") for i, path in enumerate(order)][:depth]
        state, cited = _ai_for(keyword, self.round_no)
        return Answer(self.name, country, depth, results, state, [f"https://{c}" for c in cited], 1)


class DemoToolTwo(DemoTool):
    name = "Bright Data"


def page_html(title: str, description: str = "", h1: str = "", headings: tuple = (), words: int = 300, extra: str = "", lang: str = "en", links_to: tuple = ()) -> str:
    body = " ".join(["coffee beans roast grinder subscription delivery"] * (words // 6))
    heads = "".join(f"<h2>{h}</h2><p>{body[:220]}</p>" for h in headings)
    anchors = "".join(f'<a href="{a}">link</a>' for a in links_to)
    return (
        f'<!doctype html><html lang="{lang}"><head><title>{title}</title><link rel="icon" href="/icon.svg">' + (f'<meta name="description" content="{description}">' if description else "") + f"{extra}</head>"
        f"<body><main>{f'<h1>{h1}</h1>' if h1 else ''}{heads}<p>{body}</p>{anchors}<img src='/a.png'><img src='/b.png' alt='beans'></main></body></html>"
    )


def _sitemap(host: str, paths: dict[str, str]) -> str:
    urls = "".join(f"<url><loc>https://{host}{p}</loc><lastmod>{date}</lastmod></url>" for p, date in paths.items())
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'


class Websites:
    """Every website the demo knows. `httpx.MockTransport` calls this instead of the network."""

    def __init__(self):
        self.pages: dict[str, object] = {}
        self.build(edited=False)
        self.requests: list[str] = []

    def build(self, edited: bool) -> None:
        p = self.pages
        p.clear()
        for host in (ME, ME2, EMPTY, *RIVALS, "beans-daily.example"):
            p[f"{host}/robots.txt"] = "User-agent: *\nDisallow: /private\n"
        my_pages = {
            "/": page_html("Site One coffee", "Fresh coffee delivered.", "Fresh coffee", ("Why us", "Our roasts"), links_to=("/subscription", "/cafe-grains", "/guide/brew", "/moulins", "/ar/qahwa", "/abonnement", "/decafeine")),
            "/subscription": page_html("Coffee subscription from Site One", "Monthly coffee subscription, delivered to your door.", "Coffee subscription", ("How it works", "What's in the box"), 650, '<script type="application/ld+json">{"@type":"Product"}</script>'),
            "/abonnement": page_html("Abonnement café", "Votre café livré chaque mois.", "Abonnement café", ("Comment ça marche",), 420, lang="fr"),
            "/cafe-grains": page_html("Café en grains", "Nos cafés en grains.", "Café en grains", ("Nos origines", "Torréfaction"), 800, lang="fr"),
            "/guide/brew": page_html("How to brew coffee", "A plain brewing guide.", "How to brew coffee", ("Water", "Grind", "Time"), 1500, '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-03-02"}</script>'),
            "/moulins": page_html("Moulins à café", "", "Moulins à café", (), 240, lang="fr"),
            "/ar/qahwa": page_html("قهوة مختصة", "قهوة طازجة تصلك كل شهر.", "قهوة مختصة", ("كيف نعمل", "ما هي القهوة المختصة؟"), 360, lang="ar"),
            "/decafeine": page_html("Café décaféiné", "Sans caféine.", "Café décaféiné", (), 180, lang="fr"),
        }
        if edited:  # this month's site has some real problems
            my_pages["/moulins"] = page_html("", "", "", (), 40, lang="fr")
            my_pages["/decafeine"] = page_html("Café décaféiné", "Sans caféine.", "Café décaféiné", (), 180, '<meta name="robots" content="noindex">', lang="fr")
            my_pages["/"] = page_html("Site One coffee", "Fresh coffee delivered.", "Fresh coffee", ("Why us", "Our roasts"), links_to=("/subscription", "/cafe-grains", "/guide/brew", "/moulins", "/ar/qahwa", "/abonnement", "/decafeine", "/old-offer", "/old-shop", "/chain1"))
            p[f"{ME}/old-offer"] = 404
            p[f"{ME}/old-shop"] = 500
            p[f"{ME}/chain1"] = (301, "/chain2")
            p[f"{ME}/chain2"] = (301, "/chain3")
            p[f"{ME}/chain3"] = (301, "/subscription")
        for path, html in my_pages.items():
            p[f"{ME}{path}"] = html
        p[f"{ME}/sitemap.xml"] = _sitemap(ME, {path: "2026-10-01" for path in my_pages})
        p[f"{ME2}/"] = page_html("Site Two", "Second site.", "Site Two", ("About",))
        p[f"{EMPTY}/"] = page_html("Site Three", "Third site.", "Site Three", ("About",))
        p[f"beans-daily.example/"] = page_html("Beans Daily", "Beans.", "Beans Daily")

        rival = {
            "/": page_html("Rival One", "Coffee club.", "Rival One coffee club", ("Join",)),
            "/subscription": page_html("The coffee subscription people love | Rival One", "Choose your coffee subscription: 3 sizes, free delivery, cancel any time." if edited else "Coffee subscription with free delivery.", "Coffee subscription", ("How it works", "Choose your size", "Free delivery", "Cancel any time", "Is a coffee subscription worth it?"), 1400 if edited else 1100, '<script type="application/ld+json">{"@type":"FAQPage"}</script><script type="application/ld+json">{"@type":"Product"}</script>'),
            "/best-beans": page_html("Best coffee beans", "Our pick of beans.", "Best coffee beans", ("Light roast", "Dark roast"), 900),
            "/guide/brew": page_html("How to brew coffee at home" if edited else "How to brew coffee", "Step by step.", "How to brew coffee", ("Water", "Grind", "Ratio", "Common mistakes"), 2100),
            "/shop": page_html("Shop", "All our coffee.", "Shop", (), 300),
            "/old-promo": page_html("Summer promo", "Summer offer.", "Summer promo", (), 200),
            "/ar": page_html("قهوة", "قهوة", "قهوة", (), 240, lang="ar"),
            "/jp": page_html("コーヒー", "コーヒー", "コーヒー 定期便", (), 240, lang="ja"),
        }
        if edited:
            rival["/gift-subscriptions"] = page_html("Gift a coffee subscription", "Gift boxes.", "Gift a coffee subscription", ("3 months", "6 months"), 700)
            del rival["/old-promo"]
            p["rival-one.example/old-promo"] = 404
        for path, html in rival.items():
            p[f"rival-one.example{path}"] = html
        p["rival-one.example/sitemap.xml"] = _sitemap("rival-one.example", {path: ("2026-11-02" if edited and path in ("/subscription", "/guide/brew", "/gift-subscriptions") else "2026-09-01") for path in rival} | ({"/old-promo": "2026-09-01"} if edited else {}))

        two = {
            "/": page_html("Rival Two", "Beans and plans.", "Rival Two", ("Plans",)),
            "/plans": page_html("Coffee plans", "Plans from 9 euros.", "Coffee plans", ("Starter", "Family"), 500),
            "/beans": page_html("Best coffee beans 2026", "Tested and ranked.", "Best coffee beans", ("How we test", "The ranking"), 2400),
            "/grinders": page_html("Moulins à café", "Comparatif.", "Moulins à café", ("Manuel", "Électrique"), 1300, lang="fr"),
            "/shop": page_html("Shop", "Shop.", "Shop", (), 200),
        }
        for path, html in two.items():
            p[f"rival-two.example{path}"] = html
        p["rival-two.example/sitemap.xml"] = _sitemap("rival-two.example", {path: "2026-08-15" for path in two})
        # Who links to the rivals: real-looking sites, and the spam the filter must catch from their home pages.
        for host in ("coffee-review.example", "barista-mag.example", "foodblog.example", "local-news.example", "home-kitchen.example", "forum-cafe.example", "already-mine.example", "roast-weekly.example", "cafe-culture.example", "ar-qahwa-blog.example"):
            p[f"{host}/"] = page_html(host.split(".")[0].replace("-", " ").title(), "Stories about coffee and how it is made.", "Coffee stories", ("Latest", "Reviews"), 400)
        p["parked-coffee.example/"] = page_html("parked-coffee.example", "", "", (), 60) .replace("</main>", "<p>This domain is for sale. Buy this domain today.</p></main>")
        p["fortune-palace.example/"] = page_html("Fortune Palace online casino", "The best casino bonus.", "Online casino", ("Slots",), 300)
        p["top-links-list.example/"] = page_html("Top links", "All the links.", "Top links", (), 300, links_to=tuple(f"https://site{i}.example/" for i in range(240)))
        p["old-coffee-club.example/"] = 404
        # Pages my logged links sit on, for the live check: one still there, one turned nofollow, one with the link taken off.
        p["already-mine.example/post"] = page_html("A good post", "A post.", "A good post", (), 300, f'<a href="https://{ME}/subscription">coffee subscription</a>')
        p["barista-mag.example/review"] = page_html("A review", "A review.", "A review", (), 300, f'<a href="https://{ME}/subscription" rel="nofollow sponsored">best coffee club</a>')
        p["foodblog.example/coffee"] = page_html("Coffee", "Coffee.", "Coffee", (), 300, f'<a href="https://{ME}/guide/brew">how to brew</a>')
        p["coffee-review.example/best-subscriptions"] = page_html("Best subscriptions", "Best.", "Best", (), 300)
        # This one doesn't allow crawlers at all, which the screens must say plainly.
        p["cafe-monde.example/robots.txt"] = "User-agent: *\nDisallow: /\n"

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        path = request.url.raw_path.decode()
        host = request.url.host.removeprefix("www.")
        if path == "/icon.svg" and host not in NO_ICON:
            # A made-up icon, different for each site.
            hue = sum(host.encode()) * 47 % 360
            letter = host[0].upper()
            return httpx.Response(200, text=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="hsl({hue},60%,45%)"/><text x="16" y="22" font-family="sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">{letter}</text></svg>', headers={"content-type": "image/svg+xml"})
        found = self.pages.get(f"{request.url.host.removeprefix('www.')}{path}")
        if found is None:
            # A home page for any other domain, so a list someone uploads while trying this isn't all "doesn't exist".
            if path == "/" and not any(key.startswith(request.url.host.removeprefix("www.") + "/") for key in self.pages):
                return httpx.Response(200, html=page_html("A real website", "A real website about something.", "A real website", ("About",), 400))
            return httpx.Response(404, text="not found")
        if isinstance(found, int):
            return httpx.Response(found, text="error")
        if isinstance(found, tuple):
            return httpx.Response(found[0], headers={"location": found[1]})
        if path.endswith(".xml"):
            return httpx.Response(200, text=found, headers={"content-type": "application/xml"})
        if path.endswith(".txt"):
            return httpx.Response(200, text=found, headers={"content-type": "text/plain"})
        return httpx.Response(200, html=found)


def install(websites: Websites, tool: DemoTool | None = None, delay: float = 0.0) -> DemoTool:
    """Point the real code at the fake internet. Returns the search tool, whose round can be changed."""
    tool = tool or DemoTool()
    links.fetcher_factory = lambda: PoliteFetcher(delay=delay, is_allowed=lambda url: True, transport=httpx.MockTransport(websites))
    connections.tool_factory = lambda engine, search_engine: [tool] if search_engine == "google" else []
    health.certificate_check = lambda host: 12 if host == ME2 else 210
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    uptime.is_allowed = lambda url: True
    uptime.internet_ok = lambda: True
    uptime.CONFIRM_AFTER_SECONDS = 0
    uptime.certificate_read = lambda host: uptime.Certificate(now + timedelta(days=12 if host == ME2 else 210))

    def registry(domain: str):
        if domain == EMPTY:  # an ending with no public date, as .ae really is
            raise uptime.NoRdap(domain)
        return date.today() + timedelta(days=9 if domain == ME2 else 300)

    uptime.rdap_lookup = registry
    return tool


def _drain(engine, lock_dir: Path) -> None:
    for lane in ("refresh", "crawl", "refresh", "crawl"):
        tick(engine, lane, lock_dir=lock_dir, budget_seconds=30, db_wait_seconds=1)


def _csv(rows: list[tuple]) -> bytes:
    lines = ["Source url,Source title,Authority score,Toxic score"] + [f"https://{d}/{p},{d},{a},{s}" for d, p, a, s in rows]
    return ("﻿" + "\n".join(lines)).encode("utf-8")


def _results_for_today(engine, ids: dict) -> None:
    """Two months of stored numbers, ending 3 days ago like Search Console, so Today has results and moves to show."""
    end = date.today() - timedelta(days=3)
    me, other = ids[ME], ids[ME2]
    with engine.begin() as conn:
        for back in range(0, 60):
            day = end - timedelta(days=back)
            recent = back < 28
            for site, visits, clicks, leads in ((me, 170 if recent else 150, 62 if recent else 48, 1 if recent else 1), (other, 76 if recent else 80, 29 if recent else 27, 0)):
                conn.execute(text("INSERT IGNORE INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, :i, 8.5)"), {"s": site, "d": day, "c": clicks, "i": clicks * 20})
                conn.execute(
                    text("INSERT IGNORE INTO ga4_source_daily (site_id, day, row_hash, channel, source, medium, sessions, users, key_events) VALUES (:s, :d, :h, 'Organic Search', 'google', 'organic', :v, :v, :k)"),
                    {"s": site, "d": day, "h": digest("Organic Search", "google", "organic"), "v": visits, "k": leads if back % 2 or not recent else 0},
                )
        pages = (("https://site-one.example/abonnement", 14, 8), ("https://site-one.example/cafe-grains", 12, 9), ("https://site-one.example/moulins", 6, 9), ("https://site-two.example/guide", 5, 4))
        for page, was, now in pages:
            site = other if ME2 in page else me
            for back in range(0, 14):
                conn.execute(
                    text("INSERT IGNORE INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :p, :c, 200, 6)"),
                    {"s": site, "d": end - timedelta(days=back), "h": digest(page), "p": page, "c": now if back < 7 else was},
                )
        queries = (("abonnement cafe", 4.0, 9.0), ("moulin a cafe", 11.0, 6.0), ("cafe en grains", 8.0, 12.0))
        for query, was, now in queries:
            for back in range(0, 14):
                conn.execute(
                    text("INSERT IGNORE INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 3, 40, :p)"),
                    {"s": me, "d": end - timedelta(days=back), "h": digest(query), "q": query, "p": now if back < 7 else was},
                )


def build(engine, lock_dir: Path) -> dict:
    """Fill an empty database. Takes a few seconds and contacts nothing."""
    websites = Websites()
    tool = install(websites)
    allow = lambda url: True  # noqa: E731
    ids = {
        ME: links.add_site(engine, f"https://{ME}/", "own", is_allowed=allow)["id"],
        ME2: links.add_site(engine, f"https://{ME2}/", "own", is_allowed=allow)["id"],
        EMPTY: links.add_site(engine, f"https://{EMPTY}/", "own", is_allowed=allow)["id"],
    }
    text_list = "\n".join(k[0] for k in KEYWORDS)
    # The list went in about two months ago, and two more checks followed.
    tool.round_no = 0
    first = keywords.upload(engine, ids[ME], text_list, "FR", "", "coffee-keywords.csv")
    _drain(engine, lock_dir)
    for round_no, age_days in ((1, 31), (2, 2)):
        tool.round_no = round_no
        keywords.refresh(engine, ids[ME])
        _drain(engine, lock_dir)
        with engine.begin() as conn:
            conn.execute(text("UPDATE keyword_uploads SET status = 'complete', finished_at = UTC_TIMESTAMP(3) WHERE status <> 'complete'"))
        if round_no == 1:
            with engine.begin() as conn:
                conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 62 DAY WHERE id <= (SELECT MAX(x.id) / 2 FROM (SELECT id FROM serp_checks) x)"))
                conn.execute(text("UPDATE serp_checks SET checked_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY WHERE checked_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY"))
    # A second site, smaller, sharing some keywords through one check.
    keywords.upload(engine, ids[ME2], "coffee subscription\ncafé en grains\ngrinder reviews\nespresso machine", "FR", "", None)
    _drain(engine, lock_dir)

    # Two rivals accepted from suggestions, one that turned out to block crawlers, one dismissed.
    rival_ids = {host: suggest.accept(engine, ids[ME], host, allow)["id"] for host in RIVALS}
    suggest.accept(engine, ids[ME2], "rival-two.example", allow)
    suggest.dismiss(engine, ids[ME], "new-entrant.example")
    _drain(engine, lock_dir)
    # Their sites a while later: edits, a new page, a page removed. The first pass above set the starting point.
    websites.build(edited=True)
    with engine.begin() as conn:
        conn.execute(text("UPDATE pages SET last_checked_at = UTC_TIMESTAMP(3) - INTERVAL 20 DAY"))
    for host, competitor_id in rival_ids.items():
        suggest.queue_crawl(engine, competitor_id)
    _drain(engine, lock_dir)
    with engine.begin() as conn:
        conn.execute(text("UPDATE change_events SET detected_at = UTC_TIMESTAMP(3) - INTERVAL (id MOD 9) DAY - INTERVAL (id * 37 MOD 600) MINUTE"))
        conn.execute(text("UPDATE competitor_crawls SET finished_at = UTC_TIMESTAMP(3) - INTERVAL 3 HOUR WHERE status = 'ok'"))

    # My pages get read too, so page against page has both sides.
    from seo.competitors import pairs

    pairs.refresh_auto_pairs(engine, ids[ME])
    pairs.refresh_auto_pairs(engine, ids[ME2])
    for row in pairs.list_pairs(engine, ids[ME]):
        pairs.queue_reads(engine, row["id"])
    _drain(engine, lock_dir)

    # Who links to the rivals: exports from the free tiers. One row is spam, one domain has no authority.
    gaps.import_referrers(engine, ids[ME], rival_ids["rival-one.example"], _csv([
        ("coffee-review.example", "best-subscriptions", 62, 3), ("barista-mag.example", "review", 71, 1), ("foodblog.example", "coffee", 38, 4),
        ("spammy-links.example", "x", 12, 88), ("local-news.example", "story", 54, 2), ("site-one.example", "self", 40, 2), ("already-mine.example", "post", 44, 1),
    ]), "rival-one-backlinks.csv")
    gaps.import_referrers(engine, ids[ME], rival_ids["rival-two.example"], _csv([
        ("coffee-review.example", "top-beans", 62, 3), ("barista-mag.example", "grinders", 71, 1), ("home-kitchen.example", "gear", 47, 6), ("forum-cafe.example", "thread", 29, ""),
    ]), "rival-two-backlinks.csv")
    # What Common Crawl would give for the rival no file was uploaded for, spam and all. It goes through the real filter.
    total = 134_979_706
    gaps.import_common_crawl(engine, rival_ids["cafe-monde.example"], [
        {"domain": "coffee-review.example", "rank": 1_204_332, "total": total, "outlinks": 310, "hosts": 3},
        {"domain": "roast-weekly.example", "rank": 3_418_905, "total": total, "outlinks": 88, "hosts": 1},
        {"domain": "cafe-culture.example", "rank": 8_002_117, "total": total, "outlinks": 41, "hosts": 2},
        {"domain": "ar-qahwa-blog.example", "rank": 11_500_000, "total": total, "outlinks": 12, "hosts": 1},
        {"domain": "small-coffee-blog.example", "rank": 98_000_000, "total": total, "outlinks": 9, "hosts": 1},
        {"domain": "web-directory-hub.example", "rank": 9_300_441, "total": total, "outlinks": 14_200, "hosts": 2},
        {"domain": "free-subdomains.example", "rank": 6_100_000, "total": total, "outlinks": 90, "hosts": 42_000},
        {"domain": "buy-backlinks-now.example", "rank": 7_700_000, "total": total, "outlinks": 600, "hosts": 1},
        {"domain": "parked-coffee.example", "rank": 7_100_000, "total": total, "outlinks": 2, "hosts": 1},
        {"domain": "fortune-palace.example", "rank": 5_900_000, "total": total, "outlinks": 55, "hosts": 1},
        {"domain": "top-links-list.example", "rank": 4_900_000, "total": total, "outlinks": 240, "hosts": 1},
        {"domain": "old-coffee-club.example", "rank": 12_900_000, "total": total, "outlinks": 7, "hosts": 1},
    ], "cc-main-2026-aug-sep-oct")
    _drain(engine, lock_dir)
    gaps.log_backlink(engine, ids[ME], "https://already-mine.example/post", "live")
    gaps.log_backlink(engine, ids[ME], "https://local-news.example/story", "lost")
    # Links placed through a mediator, each read by the real live check. Two more alerts would only repeat the point, so they're marked as seen below.
    placed = backlinks.save_many(engine, [
        {"site_id": ids[ME], "source_url": "https://barista-mag.example/review", "target_url": "/subscription", "anchor": "coffee club", "link_type": "Guest post", "price_text": "150 €", "mediator": "LinkAgency", "contact": "sara@linkagency.example", "platform": "Fiverr", "placed": "2026-10-01", "utm_source": "barista-mag", "utm_medium": "backlink", "utm_campaign": "bl-101"},
        {"site_id": ids[ME], "source_url": "https://foodblog.example/coffee", "target_url": "/guide/brew", "price_text": "90 €", "mediator": "LinkAgency", "placed": "2026-09-14"},
        {"site_id": ids[ME], "source_url": "https://coffee-review.example/best-subscriptions", "target_url": "/subscription", "price_text": "AED 500", "mediator": "Nour Media", "platform": "Direct", "renewal": (date.today() + timedelta(days=20)).isoformat()},
        {"site_id": ids[ME], "source_url": "https://home-kitchen.example/gear", "target_url": "/moulins", "status": "planned", "mediator": "Nour Media", "due": (date.today() + timedelta(days=3)).isoformat()},
    ])["saved"]
    for row in placed:
        live.check_now(engine, row["id"])
    live.enqueue_due(engine)
    _drain(engine, lock_dir)

    notes.create(engine, "all", "We only watch rivals who sell direct. Marketplaces don't count, even when they rank.", ids[ME])
    notes.create(engine, "competitor", "Rival One changes prices around the 1st of each month. Worth checking then.", ids[ME], rival_ids["rival-one.example"])
    notes.create(engine, "page", "Their FAQ block answers cancellation first. Ours doesn't mention it.", ids[ME], rival_ids["rival-one.example"], "https://rival-one.example/subscription")

    # Health: a good test some months back, then the real test of today's worse site.
    websites.build(edited=False)
    start_ok = health.start(engine, ids[ME], "monthly")
    _drain(engine, lock_dir)
    with engine.connect() as conn:
        good_score = conn.execute(text("SELECT score FROM health_audits WHERE id = :i"), {"i": start_ok}).scalar()
        columns = conn.execute(text("SELECT pages_read, requests_used, counts FROM health_audits WHERE id = :i"), {"i": start_ok}).mappings().first()
    history = [(6, good_score - 4), (5, good_score - 2), (4, good_score), (3, good_score + 1), (2, good_score), (1, good_score)]
    with engine.begin() as conn:  # earlier months, oldest first, so row order is date order as in real use
        conn.execute(text("DELETE FROM health_audits WHERE id = :i"), {"i": start_ok})
        for months_ago, value in history:
            conn.execute(
                text(
                    "INSERT INTO health_audits (site_id, status, trigger_kind, score, pages_read, requests_used, counts, created_at, started_at, finished_at) "
                    "VALUES (:s, 'complete', 'monthly', :v, :p, :r, :c, UTC_TIMESTAMP(3) - INTERVAL :m MONTH, UTC_TIMESTAMP(3) - INTERVAL :m MONTH, UTC_TIMESTAMP(3) - INTERVAL :m MONTH)"
                ),
                {"s": ids[ME], "v": min(100, value), "p": columns["pages_read"], "r": columns["requests_used"], "c": columns["counts"] if isinstance(columns["counts"], str) else json.dumps(columns["counts"]), "m": months_ago},
            )
        conn.execute(text("UPDATE alerts SET acknowledged_at = UTC_TIMESTAMP(3)"))
    websites.build(edited=True)
    health.start(engine, ids[ME], "monthly")
    health.start(engine, ids[ME2], "monthly")
    _drain(engine, lock_dir)
    # Uptime: the real check on each site, with a month of history where some days weren't watched and one short outage.
    for site_id in ids.values():
        uptime.check_now(engine, site_id)
    _drain(engine, lock_dir)
    today = date.today()
    with engine.begin() as conn:
        for back in range(1, 30):
            if back in (8, 9, 10, 21):  # nothing was running those days, so nobody knows
                continue
            down = 2 if back == 14 else 0
            conn.execute(text("INSERT INTO uptime_days (site_id, day, up_checks, down_checks) VALUES (:s, :d, :u, :o)"), {"s": ids[ME], "d": today - timedelta(days=back), "u": 96 - down, "o": down})
        conn.execute(text("INSERT INTO uptime_incidents (site_id, started_at, ended_at, reason, http_status) VALUES (:s, UTC_TIMESTAMP(3) - INTERVAL 14 DAY, UTC_TIMESTAMP(3) - INTERVAL 14 DAY + INTERVAL 30 MINUTE, 'server_error', 503)"), {"s": ids[ME]})
    _results_for_today(engine, ids)
    tool.round_no = 2
    return {"sites": ids, "rivals": rival_ids, "first_upload": first["id"], "websites": websites, "tool": tool}
