"""Competitor edits and new pages nobody made (SEO expert review 2026-11-17, accuracy/competitors-exports.md W0-W3, W6, W7).

Made-up sites only. Every expected count is worked out by hand in the test.
"""
import itertools
import json

import pytest
from datetime import date, timedelta

from sqlalchemy import text

from seo.competitors import insights
from seo.crawl import noise, pagedates, store
from seo.crawl.extract import extract
from seo.crawl.fetch import FetchResult
from seo.metrics import today
from tests.test_competitor_follow import first_read, next_day  # noqa: F401
from tests.test_competitors_backend import add_rival, rows, scalar, sitemap_xml, world  # noqa: F401  (world is a fixture)


class Live(dict):
    """world.pages, where a value can be a function: called on every request, so a page can change between two reads."""

    def get(self, key, default=None):
        value = super().get(key, default)
        return value() if callable(value) else value


def live_pages(world):
    world.pages = Live(world.pages)
    return world.pages


def article(title, body, related=(), widget="", published=None):
    """A page as a CMS writes it: the article, then a related-pages list and a widget inside the main text."""
    items = "".join(f"<li><a href='/r{n}'>{name}</a></li>" for n, name in related)
    stamp = f'<script type="application/ld+json">{{"@type": "Article", "datePublished": "{published}"}}</script>' if published else ""
    return (
        f'<html lang="fr"><head><title>{title}</title>{stamp}</head><body><main><h1>{title}</h1><p>{body}</p>'
        f'<div class="related"><h3>Voir aussi</h3><ul>{items}</ul></div><div class="newsletter">{widget}</div></main></body></html>'
    )


def edits(world, host="rival.example"):
    return rows(world.engine, "SELECT e.kind, p.url, e.hidden, e.hidden_reason FROM change_events e JOIN pages p ON p.id = e.page_id JOIN domains d ON d.id = e.domain_id WHERE d.host = :h ORDER BY e.id", h=host)


def visible(world, host="rival.example"):
    return [(e["kind"], e["url"].split("rival.example")[-1]) for e in edits(world, host) if not e["hidden"]]


TOWNS = "Lyon Paris Nice Lille Nantes Rennes Brest Metz Tours Caen Dijon Reims Pau Agen Albi Arles Blois Brive Cahors Dax Gap Laval Lens Mende Nancy Niort Paris Rodez Sens Tulle Vannes Vichy".split()
POOL = [(n, f"Avocat fiscaliste {town} proche conseil entreprise") for n, town in enumerate(TOWNS)]
SUBJECTS = ["licence", "visa", "bureau", "banque", "comptable"]
BODIES = {f"/p{n}": f"Notre guide {word}: comment créer une société, les étapes, les coûts et les délais" for n, word in enumerate(SUBJECTS)}


def random_site(world, seed=0, pool=12):
    """Five pages, each with a related list of 3 of `pool` pages, a new pick on every request (meyranpartners.fr, W1)."""
    pages = live_pages(world)
    picks = itertools.count(seed)

    def page(path):
        def build():
            n = next(picks)
            chosen = [POOL[(n * 5 + k * 7) % pool] for k in range(3)]
            return article(f"Page {SUBJECTS[int(path[2:])]}", BODIES[path], related=chosen)
        return build

    pages["rival.example/"] = article("Accueil", "Bienvenue chez nous, cabinet de conseil")
    for path in BODIES:
        pages[f"rival.example{path}"] = page(path)
    pages["rival.example/sitemap.xml"] = sitemap_xml(list(BODIES))


# ---- 1 and 2: blocks that change by themselves, confirmed by a second read ----------------------------------------


@pytest.mark.parametrize("pool, learned_as", [(12, "repeated"), (31, "unstable")])
def test_a_related_list_picked_at_random_on_every_request_is_never_an_edit(world, pool, learned_as):
    # 12 pages to pick from: each shows on many pages, so it's the site's template. 31: most show on one page only, so
    # they're only known by two reads of one page disagreeing.
    random_site(world, pool=pool)
    rival = first_read(world)
    for _ in range(3):
        next_day(world, rival)
    assert visible(world) == []  # 5 pages read 4 times each: the stored text differed every time, nobody edited it
    assert scalar(world.engine, "SELECT COUNT(*) FROM site_boilerplate WHERE kind = :k", k=learned_as) > 0


def test_a_real_edit_on_a_page_with_a_random_list_is_still_seen_once(world):
    random_site(world)
    rival = first_read(world)
    for _ in range(3):
        next_day(world, rival)
    BODIES["/p2"] = BODIES["/p2"] + " Nouveau paragraphe: la licence coûte désormais moins cher en zone franche."
    try:
        next_day(world, rival)
        next_day(world, rival)
    finally:
        BODIES["/p2"] = BODIES["/p2"].split(" Nouveau paragraphe")[0]
    assert visible(world) == [("content", "/p2")]


def test_a_newsletter_label_that_rotates_across_the_whole_site_is_not_an_edit(world):
    pages = live_pages(world)
    label = {"now": "Recevez nos mises à jour"}
    for path in BODIES:
        pages[f"rival.example{path}"] = (lambda p: lambda: article(f"Page {SUBJECTS[int(p[2:])]}", BODIES[p], widget=label["now"]))(path)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/sitemap.xml"] = sitemap_xml(list(BODIES))
    rival = first_read(world)
    next_day(world, rival)  # every page read once more, so the site's own pages say what its template is
    label["now"] = "Abonnez-vous à la lettre"
    next_day(world, rival)
    assert visible(world) == []  # g12.ae and clemenceaugroup.com: a widget label on every page


def test_a_list_in_a_new_order_or_a_price_in_the_template_is_not_an_edit():
    skip = {noise.block_key("à partir de 306 € la nuit")}
    before = noise.BLOCK_SEP.join(["Intro du guide", "E-mail", "Message", "à partir de 306 € la nuit"])
    after = noise.BLOCK_SEP.join(["Intro du guide", "Message", "E-mail", "à partir de 311 € la nuit"])
    assert noise.steady_blocks(before, skip) == noise.steady_blocks(after, skip)
    # A price in the article itself is an edit.
    assert noise.steady_blocks("Prix 1000", set()) != noise.steady_blocks("Prix 2000", set())


def test_text_is_kept_one_block_a_line_and_hashes_as_before():
    html = b"<html><body><main><h1>Titre</h1><p>Un  paragraphe <b>gras</b></p><ul><li>un</li><li>deux</li></ul></main></body></html>"
    fields = extract(html, "https://x.example/")
    assert fields.text.split("\n") == ["Titre", "Un paragraphe gras", "un", "deux"]
    assert fields.flat_text == "Titre Un paragraphe gras un deux"
    import hashlib
    assert fields.content_hash == hashlib.sha256(b"Titre Un paragraphe gras un deux").hexdigest()


# ---- 3: "?" text and before = after ---------------------------------------------------------------------------------

URL = "https://www.example.com/a/"


def _ok():
    return FetchResult(url=URL, status="ok", http_status=200, seconds=0.1, bytes=10)


def _page(title, meta="Une description", body="Texte"):
    return extract(f'<html><head><title>{title}</title><meta name="description" content="{meta}"></head><body><main><p>{body}</p></main></body></html>'.encode(), URL)


def test_a_title_a_latin1_table_saved_as_question_marks_is_not_an_edit_every_day(engine):
    domain = store.get_or_create_domain(engine, "www.example.com")
    store.save_fetch(engine, domain, URL, _ok(), _page("Vuk Stankovic | فريق تكوين", meta="📋 Lien utile"))
    with engine.begin() as conn:  # as the live latin1 table kept them
        conn.execute(text("UPDATE pages SET title = 'Vuk Stankovic | ???? ?????', meta_description = '? Lien utile'"))
    assert store.save_fetch(engine, domain, URL, _ok(), _page("Vuk Stankovic | فريق تكوين", meta="📋 Lien utile")) == "unchanged"
    assert rows(engine, "SELECT * FROM change_events") == []
    # A real Arabic title change is still one.
    assert store.save_fetch(engine, domain, URL, _ok(), _page("Vuk Stankovic | مستشار", meta="📋 Lien utile")) == "changed"
    assert [e["kind"] for e in rows(engine, "SELECT kind FROM change_events")] == ["title"]


def test_same_value_rules():
    assert noise.same_value("Travailler à Dubaï ?", "Travailler à Dubaï 🔎")
    assert noise.same_value('["A", "B"]', ["A", "B"])
    assert not noise.same_value("تأسيس", "مرحبا")
    assert not noise.same_value("????", "Abcd")  # "?" stands only for letters latin1 can't hold


# ---- 4: redirects -----------------------------------------------------------------------------------------------------


def test_a_page_that_now_redirects_is_one_moved_event_never_a_rewrite(world):
    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/spc-in-a-nutshell/"] = article("SPC in a nutshell", "Un vieux billet court")
    pages["rival.example/spc/"] = article("SPC free zone", "Une page de service bien plus longue " * 30)
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/spc-in-a-nutshell/", "/spc/"])
    rival = first_read(world)
    pages["rival.example/spc-in-a-nutshell/"] = (301, "https://rival.example/spc/")
    next_day(world, rival)
    next_day(world, rival)
    assert [(e["kind"], e["url"]) for e in edits(world)] == [("redirect", "https://rival.example/spc-in-a-nutshell/")]
    moved = rows(world.engine, "SELECT title, final_url, last_status FROM pages WHERE url = 'https://rival.example/spc-in-a-nutshell/'")[0]
    assert moved == {"title": "SPC in a nutshell", "final_url": "https://rival.example/spc/", "last_status": "moved"}
    assert rows(world.engine, "SELECT after_value FROM change_events")[0]["after_value"] == "https://rival.example/spc/"


# ---- 5: new pages -------------------------------------------------------------------------------------------------------


def test_the_first_read_does_not_end_while_a_sitemap_file_failed(world):
    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    for n in range(4):
        pages[f"rival.example/a{n}"] = article(f"A{n}", f"Texte {n}")
    pages["rival.example/robots.txt"] = "User-agent: *\nSitemap: https://rival.example/sitemap_index.xml\n"
    pages["rival.example/sitemap_index.xml"] = (
        '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        "<sitemap><loc>https://rival.example/s1.xml</loc></sitemap><sitemap><loc>https://rival.example/s2.xml</loc></sitemap></sitemapindex>"
    )
    pages["rival.example/s1.xml"] = sitemap_xml(["/a0", "/a1"])
    pages["rival.example/s2.xml"] = 500  # the second file fails today (well-tax.com on 10 Nov)
    rival = first_read(world)
    assert not scalar(world.engine, "SELECT baseline_done FROM competitor_crawls WHERE competitor_id = :c", c=rival)
    pages["rival.example/s2.xml"] = sitemap_xml(["/a2", "/a3"])
    next_day(world, rival)  # the whole list read at last: these pages were there all along, none is new
    assert scalar(world.engine, "SELECT baseline_done FROM competitor_crawls WHERE competitor_id = :c", c=rival)
    assert visible(world) == []


def test_a_page_found_later_is_new_only_when_its_own_date_is_after_watching_began(world):
    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/old"] = article("Old", "Texte")
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/old"])
    rival = first_read(world)
    soon = (date.today() + timedelta(days=1)).isoformat()
    pages["rival.example/thank-you/"] = article("Merci", "Merci pour votre message", published="2023-06-28T10:00:00+00:00")
    pages["rival.example/frs-102-changes/"] = article("FRS 102", "Les changements", published=f"{soon}T09:00:00+00:00")
    pages["rival.example/no-date/"] = article("Sans date", "Une page sans date")
    pages["rival.example/listed-2020/"] = article("Vieux", "Une page listée avec une vieille date")
    pages["rival.example/sitemap.xml"] = (
        sitemap_xml(["/old", "/thank-you/", "/frs-102-changes/", "/no-date/"], date=soon).replace("</urlset>", "")
        + "<url><loc>https://rival.example/listed-2020/</loc><lastmod>2020-05-26</lastmod></url></urlset>"
    )
    next_day(world, rival)
    assert sorted(visible(world)) == [("new_page", "/frs-102-changes/"), ("new_page", "/no-date/")]
    hidden = sorted((e["url"].split("rival.example")[-1], e["hidden_reason"]) for e in edits(world) if e["hidden"])
    assert hidden == [("/listed-2020/", "found_later"), ("/thank-you/", "found_later")]


def test_page_dates_in_the_forms_sites_write_them():
    assert pagedates.page_day("May 26, 2020, 11:26:50 AM") == date(2020, 5, 26)
    assert pagedates.page_day("2026-11-16T07:10:55+04:00") == date(2026, 11, 16)
    assert pagedates.page_day("26 mai 2020") == date(2020, 5, 26)
    assert pagedates.page_day("Tue, 03 Feb 2015 10:00:00 GMT") == date(2015, 2, 3)
    assert pagedates.page_day("26/05/2020") == date(2020, 5, 26)
    assert pagedates.page_day("someday") is None and pagedates.page_day("") is None


def test_the_new_pages_chart_never_puts_an_undated_old_page_in_this_month(world):
    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/a"] = article("A", "Texte a", published="May 26, 2020, 11:26:50 AM")
    pages["rival.example/b"] = article("B", "Texte b")  # no date: found in the first read
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/a", "/b"])
    first_read(world)
    with world.engine.connect() as conn:
        theirs = insights._pages(conn, "rival.example")
    appeared = {p["url"].split("rival.example")[-1]: p["appeared"] for p in theirs}
    assert appeared["/a"] == date(2020, 5, 26) and appeared["/b"] is None


# ---- 6: Today's competitor changes ---------------------------------------------------------------------------------------


def test_today_finds_a_paired_rival_page_edit_behind_600_newer_changes_elsewhere(world):
    add_rival(world)
    with world.engine.begin() as conn:
        domain = store.get_or_create_domain(world.engine, "rival.example")
        conn.execute(text("INSERT INTO pages (domain_id, url, url_hash) VALUES (:d, 'https://rival.example/paired/', SHA2('https://rival.example/paired/', 256))"), {"d": domain})
        paired = conn.execute(text("SELECT id FROM pages WHERE url = 'https://rival.example/paired/'")).scalar()
        conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, 'title', 'A', 'B', UTC_TIMESTAMP(3) - INTERVAL 2 DAY)"), {"p": paired, "d": domain})
        for n in range(600):
            conn.execute(text("INSERT INTO pages (domain_id, url, url_hash) VALUES (:d, :u, SHA2(:u, 256))"), {"d": domain, "u": f"https://rival.example/o{n}"})
        conn.execute(text(
            "INSERT INTO change_events (page_id, domain_id, kind, detected_at) SELECT id, domain_id, 'content', UTC_TIMESTAMP(3) - INTERVAL 1 HOUR FROM pages WHERE url LIKE 'https://rival.example/o%'"
        ))
        conn.execute(text(
            "INSERT INTO change_events (page_id, domain_id, kind, detected_at, hidden, hidden_reason) VALUES (:p, :d, 'content', UTC_TIMESTAMP(3), 1, 'template')"
        ), {"p": paired, "d": domain})
        rival = conn.execute(text("SELECT id FROM sites WHERE host = 'rival.example'")).scalar()
        conn.execute(text("INSERT INTO page_pairs (site_id, competitor_id, my_url, my_url_hash, their_url, shared_keywords) VALUES (:s, :c, 'https://me.example/mine/', SHA2('https://me.example/mine/', 256), 'https://rival.example/paired/', 5)"), {"s": world.own, "c": rival})
    shown, other = today._rival_changes(world.engine, world.own)
    assert [(r["kind"], r["url"]) for r in shown] == [("title", "https://rival.example/paired/")]  # the hidden one is left out
    assert other == 600
    shown_all, _ = today._rival_changes(world.engine, None)
    assert [r["url"] for r in shown_all] == ["https://rival.example/paired/"]


# ---- listing pages ------------------------------------------------------------------------------------------------------


def test_listing_pages_are_known():
    assert noise.is_listing("https://x.example/blog/page/3/")
    assert noise.is_listing("https://x.example/category/news/")
    assert noise.is_listing("https://x.example/ar/author/vuk-stankovic")
    assert noise.is_listing("https://x.example/?s=dubai")
    assert not noise.is_listing("https://x.example/creer-societe-dubai/")


def test_learned_template_is_refreshed_from_the_sites_own_pages(engine):
    domain = store.get_or_create_domain(engine, "www.example.com")
    with engine.begin() as conn:
        for n in range(4):
            keys = noise.page_keys(noise.BLOCK_SEP.join([f"Article unique {'abcd'[n]}", "Abonnez-vous à la lettre"]))
            conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, blocks) VALUES (:d, :u, SHA2(:u, 256), :b)"), {"d": domain, "u": f"https://www.example.com/{n}", "b": json.dumps(keys)})
        assert noise.refresh_repeated(conn, domain) == 1
        assert noise.skip_set(conn, domain) == {noise.block_key("Abonnez-vous à la lettre")}


# ---- 7: stored events looked at again ---------------------------------------------------------------------------------


def test_stored_events_are_hidden_by_the_rules_and_real_edits_stay(engine):
    import gzip

    from seo.competitors import reclassify

    domain = store.get_or_create_domain(engine, "rival.example")
    teasers = [f"voir aussi notre guide complet sur la {w} à dubaï en détail" for w in ("licence", "banque", "fiscalité", "résidence", "comptabilité")]
    article_words = ["licence", "visa", "bureau", "banque", "fiscal"]
    with engine.begin() as conn:
        ids = []
        for n in range(5):
            url = f"https://rival.example/p{n}"
            conn.execute(text(
                "INSERT INTO pages (domain_id, url, url_hash, title, content_hash, first_seen_at, extras) VALUES (:d, :u, SHA2(:u, 256), 'T', 'h', UTC_TIMESTAMP(3) - INTERVAL 5 DAY, '{}')"
            ), {"d": domain, "u": url})
            ids.append(conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar())
        body = {n: f"Notre article sur le {article_words[n]} explique chaque étape du dossier" for n in range(5)}

        def version(page, words, minutes_ago):
            conn.execute(text("INSERT INTO page_versions (page_id, fields, text_gz, taken_at) VALUES (:p, '{}', :t, UTC_TIMESTAMP(3) - INTERVAL :m MINUTE)"),
                         {"p": page, "t": gzip.compress(words.encode()), "m": minutes_ago})

        def event(page, kind, before=None, after=None, minutes_ago=0):
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, :k, :b, :a, UTC_TIMESTAMP(3) - INTERVAL :m MINUTE)"),
                         {"p": page, "d": domain, "k": kind, "b": before, "a": after, "m": minutes_ago})

        for n, page in enumerate(ids):  # two reads each, a different pair of teasers each time
            version(page, f"{body[n]} {teasers[n % 5]} {teasers[(n + 1) % 5]}", 60)
            version(page, f"{body[n]} {teasers[(n + 2) % 5]} {teasers[(n + 3) % 5]}", 10)
        event(ids[0], "content", "30 words", "30 words", minutes_ago=10)  # only the teasers changed
        version(ids[1], f"{body[1]} Nouveau: les frais de dossier baissent de moitié cette année pour tous les créateurs {teasers[0]}", 5)
        event(ids[1], "content", "30 words", "40 words", minutes_ago=5)  # a real sentence written
        event(ids[2], "title", "Vuk | ????", "Vuk | فريق")  # "?" saved by latin1
        event(ids[3], "canonical", "https://rival.example/p3", "https://rival.example/p4", minutes_ago=3)  # it now redirects to p4
        event(ids[3], "title", "T", "Target title", minutes_ago=3)
        conn.execute(text("UPDATE pages SET extras = '{\"published\": \"2023-06-28T10:00:00\"}', first_seen_at = UTC_TIMESTAMP(3) WHERE id = :p"), {"p": ids[4]})
        event(ids[4], "new_page", None, "https://rival.example/p4")  # found late, dated 2023
    with engine.begin() as conn:
        result = reclassify.classify(conn, domain)
        again = reclassify.classify(conn, domain)
    shown = rows(engine, "SELECT e.kind, p.url FROM change_events e JOIN pages p ON p.id = e.page_id WHERE e.hidden = 0 ORDER BY e.id")
    assert [(r["kind"], r["url"][-2:]) for r in shown] == [("content", "p1"), ("redirect", "p3")]
    assert result["hidden"] == {"template": 1, "same_text": 1, "redirect": 2, "found_later": 1} and result["redirects"] == 1
    assert again["hidden"] == {} and again["redirects"] == 0  # safe to run again
    assert scalar(engine, "SELECT final_url FROM pages WHERE id = :p", p=ids[3]) == "https://rival.example/p4"


def test_updated_in_12_months_is_not_shown_when_few_pages_carry_a_date():
    year_ago = date.today() - timedelta(days=365)
    recent, old, none = {"updated": date.today()}, {"updated": date(2020, 1, 1)}, {"updated": None}
    assert insights.updated_share_of([recent] * 3 + [none] * 483, year_ago) is None  # meyranpartners.fr: 3 of 486 dated
    assert insights.updated_share_of([recent] * 6 + [old] * 4 + [none] * 10, year_ago) == 0.6
    assert insights.updated_share_of([none] * 4, year_ago) is None


def _index(pages, children):
    pages["rival.example/robots.txt"] = "User-agent: *\nSitemap: https://rival.example/sitemap_index.xml\n"
    pages["rival.example/sitemap_index.xml"] = (
        '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(f"<sitemap><loc>https://rival.example/{name}</loc></sitemap>" for name in children) + "</sitemapindex>"
    )


def test_a_sitemap_file_that_keeps_failing_ends_the_first_read_after_a_few_days_and_says_why(world):
    """Code review 2026-11-18, #6: a dead sitemap file named every day used to hold the first read open for ever, so the
    rival's new pages were never reported."""
    from seo.competitors import crawl, profile

    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    for n in range(2):
        pages[f"rival.example/a{n}"] = article(f"A{n}", f"Texte {n}")
    _index(pages, ["s1.xml", "dead.xml"])
    pages["rival.example/s1.xml"] = sitemap_xml(["/a0", "/a1"])
    pages["rival.example/dead.xml"] = 404  # gone for good
    rival = first_read(world)
    def state():
        with world.engine.connect() as conn:
            return profile.crawl_states(conn, [rival])[rival]

    assert not state()["baseline_done"] and state()["sitemap_cut"] == "waiting"
    next_day(world, rival)
    assert not state()["baseline_done"]  # a day later it may still load
    with world.engine.begin() as conn:  # the first page was seen FIRST_PASS_WAIT_DAYS + 1 days ago
        conn.execute(text("UPDATE pages SET first_seen_at = first_seen_at - INTERVAL :n DAY"), {"n": crawl.FIRST_PASS_WAIT_DAYS + 1})
    next_day(world, rival)
    assert state()["baseline_done"] and state()["sitemap_cut"] == "cut" and state()["message"] == crawl.CUT_TEXT
    pages["rival.example/new-guide/"] = article("Nouveau", "Un nouveau guide", published=(date.today() + timedelta(days=1)).isoformat() + "T09:00:00+00:00")
    pages["rival.example/s1.xml"] = sitemap_xml(["/a0", "/a1", "/new-guide/"])
    next_day(world, rival)
    assert ("new_page", "/new-guide/") in visible(world)  # new pages are reported again


def test_more_sitemap_files_than_the_app_reads_does_not_hold_the_first_read(world):
    from seo.crawl import sitemap

    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    names = [f"post-sitemap{n}.xml" for n in range(sitemap.MAX_SITEMAPS + 2)]  # a big Yoast site
    for n, name in enumerate(names):
        pages[f"rival.example/{name}"] = sitemap_xml([f"/p{n}"])
        pages[f"rival.example/p{n}"] = article(f"P{n}", f"Texte {n}")
    _index(pages, names)
    rival = first_read(world)
    assert scalar(world.engine, "SELECT baseline_done FROM competitor_crawls WHERE competitor_id = :c", c=rival)  # was never
    assert scalar(world.engine, "SELECT message FROM competitor_crawls WHERE competitor_id = :c", c=rival) == "Sitemap incomplete: new pages may be missed."
