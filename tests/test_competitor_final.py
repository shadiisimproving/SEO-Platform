"""Last competitor change-detection fixes before deploy (SEO review 2026-11-18, accuracy/final-competitors-exports.md:
W0/W1 noise left, W6 redirects, N1 one "added in 30 days", N3 moved isn't edited, N4 listings, N6 dates, N8 Today's day, N9).

Made-up sites only. Every expected count is worked out by hand in the test.
"""
import gzip
import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from seo.competitors import collective, insights, profile, reclassify
from seo.crawl import noise, pagedates, store
from seo.metrics import today
from tests.test_competitor_follow import first_read, next_day  # noqa: F401
from tests.test_competitor_noise import article, edits, live_pages, visible
from tests.test_competitors_backend import add_rival, rows, scalar, sitemap_xml, world  # noqa: F401  (world is a fixture)


# ---- read time: blocks that rotate, other pages' titles, a canonical elsewhere, a page moved ---------------------------


def office_home(offices):
    items = "".join(f"<li>{o}</li>" for o in offices)
    return f"<html><head><title>Cabinet de conseil</title></head><body><main><h1>Cabinet de conseil</h1><p>Nos bureaux</p><ul>{items}</ul></main></body></html>"


def test_an_office_list_rotating_on_the_home_page_is_not_an_edit(world):
    # meyranpartners.fr: the home page shows 3 of its offices, a new pick each day. Once an office has been on the page,
    # it coming back is the list rotating, not writing.
    pages = live_pages(world)
    pages["rival.example/"] = office_home(["Paris", "Lyon", "Nice"])
    pages["rival.example/a"] = article("Guide", "Un guide")
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/", "/a"])
    rival = first_read(world)
    for offices in (["Lyon", "Nice", "Genève"], ["Nice", "Genève", "Paris"], ["Genève", "Paris", "Lyon"], ["Paris", "Lyon", "Nice"]):
        pages["rival.example/"] = office_home(offices)
        next_day(world, rival)
    # Genève came (new to the page, an edit that day). Paris came back the next day, so the list rotates: Genève's day is
    # looked at again with that known and hidden, and nothing after it is an edit.
    assert visible(world) == []
    assert {e["hidden_reason"] for e in edits(world)} <= {"template"}
    pages["rival.example/"] = office_home(["Paris", "Lyon", "Nice", "Tokyo, Japon"])  # a new office is still an edit
    next_day(world, rival)
    assert visible(world) == [("content", "/")]


def test_a_see_also_teaser_that_is_another_pages_title_is_not_an_edit(world):
    # meyranpartners.fr: each article shows one "see also" heading, the title of another article, a new pick each day.
    pages = live_pages(world)
    titles = [f"Créer une société à Dubaï depuis {town}" for town in ("Paris", "Lyon", "Nice", "Lille")]
    for n, title in enumerate(titles):
        pages[f"rival.example/a{n}"] = article(f"{title} - Cabinet", f"Notre guide numéro {n} sur la création de société")
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/sitemap.xml"] = sitemap_xml([f"/a{n}" for n in range(4)] + ["/guide"])

    def guide(pick):
        return f"<html><head><title>Guide</title></head><body><main><h1>Guide complet</h1><p>Le texte du guide</p><h3>{titles[pick]}</h3></main></body></html>"

    pages["rival.example/guide"] = guide(0)
    rival = first_read(world)
    for pick in (1, 2, 3):
        pages["rival.example/guide"] = guide(pick)
        next_day(world, rival)
    assert visible(world) == []
    assert scalar(world.engine, "SELECT COUNT(*) FROM site_boilerplate WHERE kind = 'title'") > 0


def test_a_page_whose_canonical_is_another_page_has_no_edits_of_its_own(world):
    # e.zone /dubai-free-zone-company-formation/ names /dubai-free-zone-business-setup/ as its canonical: the rewrite read
    # at the old address on 17 Nov was the target's (W6).
    pages = live_pages(world)
    old = '<html><head><title>{t}</title><link rel="canonical" href="https://rival.example/target/"></head><body><main><h1>{t}</h1><p>{b}</p></main></body></html>'
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/old/"] = old.format(t="Dubai Free Zone Company Setup", b="Le texte de la cible " * 20)
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/old/"])
    rival = first_read(world)
    pages["rival.example/old/"] = old.format(t="Dubai Free Zones Compared", b="Un tout autre texte, réécrit " * 20)
    next_day(world, rival)
    assert visible(world) == []
    assert {e["hidden_reason"] for e in edits(world) if e["hidden"]} == {"duplicate"}


def test_a_moved_page_is_one_moved_event_even_when_the_script_recorded_it_first(world):
    # N9: the reclassify script records a move with final_url left empty when the page was read again later; the next
    # read finding the redirect must not add a second "Moved".
    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/a/"] = article("A", "Un billet")
    pages["rival.example/b/"] = article("B", "Un autre billet")
    pages["rival.example/target/"] = article("Cible", "La page cible")
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/a/", "/b/", "/target/"])
    rival = first_read(world)
    with world.engine.begin() as conn:
        page = conn.execute(text("SELECT id, domain_id FROM pages WHERE url = 'https://rival.example/a/'")).mappings().first()
        conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value) VALUES (:p, :d, 'redirect', 'https://rival.example/a/', 'https://rival.example/target/')"),
                     {"p": page["id"], "d": page["domain_id"]})
    pages["rival.example/a/"] = (301, "https://rival.example/target/")
    pages["rival.example/b/"] = (301, "https://rival.example/target/")
    next_day(world, rival)
    next_day(world, rival)
    moved = sorted(e["url"] for e in edits(world) if e["kind"] == "redirect")
    assert moved == ["https://rival.example/a/", "https://rival.example/b/"]  # one each, never two


def test_a_moved_page_that_answers_again_is_a_new_start_not_an_edit(world):
    pages = live_pages(world)
    pages["rival.example/"] = article("Accueil", "Bienvenue")
    pages["rival.example/a/"] = article("Ancien billet", "Un vieux billet")
    pages["rival.example/sitemap.xml"] = sitemap_xml(["/a/"])
    rival = first_read(world)
    pages["rival.example/a/"] = (301, "https://rival.example/")
    next_day(world, rival)
    pages["rival.example/a/"] = article("Autre chose", "Un tout autre texte, sans rapport avec le billet " * 5)
    next_day(world, rival)
    assert visible(world) == [("redirect", "/a/")]  # what's read there after the move isn't an edit of the old page


def test_words_that_change_by_themselves_are_not_counted():
    # bonjourdubai.fr /legoland/: an affiliate price glued to a word, "de306" -> "de311" (17 Nov).
    assert store.changed_words("Billets à partir de306 € et de189 € la nuit", "Billets à partir de311 € et de192 € la nuit") == 0
    # takweenadvisory.ae: an Arabic "updated on" stamp, 29 أكتوبر -> 11 نوفمبر, and a full stop with a stray "<".
    assert store.changed_words("آخر تحديث 29 أكتوبر الشريك.", "آخر تحديث 11 نوفمبر الشريك<.") == 0
    # A price in the article, a word changed, and a year in a sentence are still edits.
    assert store.changed_words("Le prix est 1000 euros", "Le prix est 2000 euros") == 1
    assert store.changed_words("authorise the firm", "authorize the firm") == 1
    assert store.steady_words("COVID19 B2B") == ["COVID19", "B2B"]


def test_lists_of_posts_are_listings():
    # N4: takweenadvisory.ae, dmcc.ae, virtuzone.com, efirst.ae.
    for url in ("https://t.example/en/blog", "https://t.example/ar/blog/", "https://t.example/en/services/all", "https://t.example/ar",
                "https://t.example/insights", "https://t.example/insights?hsLang=en", "https://t.example/blog.php", "https://t.example/fr-fr/"):
        assert noise.is_listing(url), url
    assert noise.is_listing("https://v.example/entrepreneurship/", "Entrepreneurship Archives - Virtuzone")
    assert noise.is_listing("https://v.example/actus/", "Archives des actualités")
    for url in ("https://t.example/", "https://t.example/en/blog/golden-visa", "https://t.example/hr/", "https://t.example/insights/dmcc-report"):
        assert not noise.is_listing(url, "Golden visa guide"), url


# ---- stored events looked at again ---------------------------------------------------------------------------------------


class Stored:
    """Pages, versions and events written straight into the tables, as the live database holds them (text one line)."""

    def __init__(self, engine, host="rival.example"):
        self.engine, self.host = engine, host
        self.domain = store.get_or_create_domain(engine, host)
        self.start = datetime(2026, 11, 9, 2, 0)
        self.ids = {}

    def page(self, path, title="T", canonical=None, h1=None, status="ok"):
        url = f"https://{self.host}{path}"
        with self.engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO pages (domain_id, url, url_hash, title, h1, canonical, content_hash, first_seen_at, extras, last_status) "
                "VALUES (:d, :u, SHA2(:u, 256), :t, :h, :c, 'h', :f, '{}', :s)"
            ), {"d": self.domain, "u": url, "t": title, "h": json.dumps(h1 or []), "c": canonical, "f": self.start, "s": status})
            self.ids[path] = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar()
        return self.ids[path]

    def version(self, path, words, day, headings=None, canonical=None):
        fields = {"headings": headings or [], "canonical": canonical}
        with self.engine.begin() as conn:
            conn.execute(text("INSERT INTO page_versions (page_id, fields, text_gz, taken_at) VALUES (:p, :f, :t, :at)"),
                         {"p": self.ids[path], "f": json.dumps(fields), "t": gzip.compress(words.encode()), "at": self.start + timedelta(days=day)})

    def event(self, path, kind, day, before=None, after=None):
        with self.engine.begin() as conn:
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, :k, :b, :a, :at)"),
                         {"p": self.ids[path], "d": self.domain, "k": kind, "b": before, "a": after, "at": self.start + timedelta(days=day)})

    def classify(self):
        with self.engine.begin() as conn:
            return reclassify.classify(conn, self.domain)

    def shown(self):
        return [(r["kind"], r["url"].split(self.host)[-1]) for r in rows(self.engine, "SELECT e.kind, p.url FROM change_events e JOIN pages p ON p.id = e.page_id WHERE e.hidden = 0 ORDER BY e.id")]


ARTICLE = "Notre article explique chaque étape du dossier de création de société, les frais, les délais et les pièges à éviter"


def test_stored_noise_left_after_the_first_rules_is_hidden_and_real_edits_stay(engine):
    site = Stored(engine)
    # 1. The home page's office list rotating (meyranpartners.fr, 17 Nov): every office that came was on it before.
    site.page("/")
    for day, offices in enumerate(["Paris Lyon Nice Genève", "Lyon Nice Genève", "Genève Paris Lyon", "Nice Paris"]):
        site.version("/", f"Cabinet de conseil Nos bureaux {offices}", day)
    site.event("/", "content", 3, "10 words", "8 words")  # Genève, Paris, Lyon -> Nice, Paris: Nice was there on day 0
    # 2. A random reference box: a heading on the page for two reads, gone on the third (DIFC Courts, 15-17 Nov).
    box = ["h3", "Juridiction commerciale internationale DIFC Courts"]
    site.page("/guide")
    for day, heads in enumerate([[["h2", "Le guide"]], [["h2", "Le guide"], box], [["h2", "Le guide"], box], [["h2", "Le guide"]]]):
        site.version("/guide", f"{ARTICLE} guide", day, headings=heads)
    site.event("/guide", "headings", 1, json.dumps([["h2", "Le guide"]]), json.dumps([["h2", "Le guide"], box]))
    site.event("/guide", "headings", 3, json.dumps([["h2", "Le guide"], box]), json.dumps([["h2", "Le guide"]]))
    # 3. A form field whose label is picked at random (clemenceaugroup.com): the same slot changed on 3 reads across pages.
    for n, labels in enumerate([("URL", "Phone"), ("Phone", "Company"), ("X/Twitter", "Phone")]):
        site.page(f"/form{n}")
        site.version(f"/form{n}", f"{ARTICLE} {n} Name Email {labels[0]} Message Send", 0)
        site.version(f"/form{n}", f"{ARTICLE} {n} Name Email {labels[1]} Message Send", 1)
        site.event(f"/form{n}", "content", 1, "30 words", "30 words")
    # 4. A sidebar of the newest posts: its words are other pages' titles (dubaimadame.com, societe-emirats.com).
    site.page("/dafz-ou-dmcc", title="DAFZ ou DMCC quelle zone franche pour le commerce - Societe Emirats")
    site.page("/visa-emploi", title="Visa de résidence après une perte d'emploi - Societe Emirats")
    site.page("/article")
    site.version("/article", f"{ARTICLE} Derniers articles Visa de résidence après une perte d'emploi", 0)
    site.version("/article", f"{ARTICLE} Derniers articles DAFZ ou DMCC quelle zone franche pour le commerce", 1)
    site.event("/article", "content", 1, "30 words", "30 words")
    # 5. A blog index and an archive (N4).
    for path, title in (("/en/blog", "Blog"), ("/entrepreneurship/", "Entrepreneurship Archives - Rival")):
        site.page(path, title=title)
        site.version(path, f"{ARTICLE} un", 0)
        site.version(path, f"{ARTICLE} deux nouveaux billets aujourd'hui", 1)
        site.event(path, "content", 1, "30 words", "33 words")
    # 6. A page naming another as its canonical, rewritten (e.zone, W6), and a page already moved, edited later.
    site.page("/old/", canonical="https://rival.example/target/")
    site.version("/old/", "Le texte de la cible", 0, canonical="https://rival.example/target/")
    site.version("/old/", "Un tout autre texte réécrit pour la cible", 1, canonical="https://rival.example/target/")
    site.event("/old/", "title", 1, "Dubai Free Zone Company Setup", "Dubai Free Zones Compared")
    site.event("/old/", "content", 1, "5 words", "8 words")
    site.page("/moved/")
    site.version("/moved/", f"{ARTICLE} Name Phone like", 0)
    site.version("/moved/", f"{ARTICLE} like Referrer", 3)
    site.event("/moved/", "redirect", 1, "https://rival.example/moved/", "https://rival.example/spc/")
    site.event("/moved/", "content", 3, "30 words", "29 words")
    # Real edits stay: a sentence written, a spelling fixed, a heading renamed, a title rewritten.
    site.page("/real")
    site.version("/real", f"{ARTICLE} fin", 0)
    site.version("/real", f"{ARTICLE} Nouveau: les frais baissent de moitié cette année pour les créateurs fin", 1)
    site.event("/real", "content", 1, "30 words", "40 words")
    site.page("/spelling")
    site.version("/spelling", f"{ARTICLE} what they authorise.", 0)
    site.version("/spelling", f"{ARTICLE} what they authorize.", 1)
    site.event("/spelling", "content", 1, "30 words", "30 words")
    site.page("/heading")
    site.version("/heading", ARTICLE, 0, headings=[["h2", "Les frais"]])
    site.version("/heading", ARTICLE, 1, headings=[["h2", "Les frais en 2026"]])
    site.event("/heading", "headings", 1, json.dumps([["h2", "Les frais"]]), json.dumps([["h2", "Les frais en 2026"]]))
    site.event("/heading", "title", 1, "Les frais", "Les frais de création en 2026")

    result = site.classify()
    assert site.shown() == [("redirect", "/moved/"), ("content", "/real"), ("content", "/spelling"), ("headings", "/heading"), ("title", "/heading")]
    # 1 home + 2 box + 3 form + 1 sidebar = 7 template; 2 listing; 2 duplicate; 1 redirect (edited after the move).
    assert result["hidden"] == {"template": 7, "listing": 2, "duplicate": 2, "redirect": 1}
    assert site.classify()["hidden"] == {}  # safe to run again
    counted = reclassify.counts(engine.connect(), site.domain)["rival.example"]
    assert counted == {"edit_events": 4, "edited_pages": 3, "new_pages": 0}  # the move isn't an edit (N3)


# ---- dates, added, moved -----------------------------------------------------------------------------------------------


def test_page_dates_in_more_forms_and_never_in_the_future():
    # N6: commitbiz.com writes 21-05-2019; French and Arabic month names; Arabic-Indic digits.
    assert pagedates.page_day("21-05-2019") == date(2019, 5, 21)
    assert pagedates.page_day("17 novembre 2026") == date(2026, 11, 17)
    assert pagedates.page_day("1er décembre 2025") == date(2025, 12, 1)
    assert pagedates.page_day("17 نوفمبر 2026") == date(2026, 11, 17)
    assert pagedates.page_day("١٧/١١/٢٠٢٦") == date(2026, 11, 17)
    assert pagedates.page_day("2026-11-16T07:10:55+04:00") == date(2026, 11, 16)
    # daftime: two pages dated May 2027 are not published yet.
    assert pagedates.published_day("2027-05-01", today=date(2026, 11, 18)) is None
    assert pagedates.published_day("2026-11-17", today=date(2026, 11, 18)) == date(2026, 11, 17)
    assert insights.appeared_day("2027-05-01", None, None, today=date(2026, 11, 18)) is None
    assert insights.appeared_day("2027-05-01", None, datetime(2026, 11, 12, 3), today=date(2026, 11, 18)) == date(2026, 11, 12)


def _read_page(conn, domain, path, published=None, first_seen=None, status="ok"):
    url = f"https://rival.example{path}"
    extras = json.dumps({"published": published} if published else {})
    conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, content_hash, extras, first_seen_at, last_status) VALUES (:d, :u, SHA2(:u, 256), 'h', :e, :f, :s)"),
                 {"d": domain, "u": url, "e": extras, "f": first_seen, "s": status})
    return conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar()


def test_added_in_30_days_is_one_number_on_the_card_and_the_profile(world):
    # N1: watching began 12 days ago. Known answer, by hand:
    #   /old         dated 2019, read in the first read             -> no
    #   /before      dated 20 days ago (before watching began)      -> no (the profile counted it, the card didn't)
    #   /first-read  dated 5 days ago, found while the first read went on (no new_page event) -> yes (the card missed it)
    #   /reported    no date, reported new 3 days ago               -> yes
    #   /future      dated next year                                -> no
    #   /gone-new    dated 2 days ago, but gone since               -> no
    # = 2 on the card, the profile's Activity tab and its "New pages in 30 days".
    rival = add_rival(world)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    day = lambda n: (now - timedelta(days=n)).date().isoformat()  # noqa: E731
    domain = store.get_or_create_domain(world.engine, "rival.example")
    with world.engine.begin() as conn:
        _read_page(conn, domain, "/", first_seen=now - timedelta(days=12))
        _read_page(conn, domain, "/old", "2019-03-01", now - timedelta(days=12))
        _read_page(conn, domain, "/before", day(20), now - timedelta(days=11))
        _read_page(conn, domain, "/first-read", day(5), now - timedelta(days=5))
        reported = _read_page(conn, domain, "/reported", None, now - timedelta(days=3))
        conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, after_value, detected_at) VALUES (:p, :d, 'new_page', 'x', :t)"),
                     {"p": reported, "d": domain, "t": now - timedelta(days=3)})
        _read_page(conn, domain, "/future", f"{now.year + 1}-05-01", now - timedelta(days=4))
        _read_page(conn, domain, "/gone-new", day(2), now - timedelta(days=2), status="gone")
    card = next(r for r in collective.rivals(world.engine)["rivals"] if r["host"] == "rival.example")
    with world.engine.connect() as conn:
        theirs = insights._pages(conn, "rival.example")
        rhythm = insights._rhythm(conn, "rival.example", "me.example", theirs, [], {})
    prof = profile.profile(world.engine, world.own, rival)
    assert card["added_30d"] == 2
    assert rhythm["new_30d"] == 2
    assert prof["compare"]["pages"]["theirs"]["new_pages_30d"] == 2


def test_a_move_is_not_an_edit_on_the_cards_the_list_or_your_edits(world):
    # N3: business-setup-dubai.com "Your edits" 131 held 9 moved category pages. Known answer: /a rewritten (title and
    # text, one page), /b and /c moved: 1 page edited, 2 moved.
    rival = add_rival(world)
    domain = store.get_or_create_domain(world.engine, "rival.example")
    mine = store.get_or_create_domain(world.engine, "me.example")
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    with world.engine.begin() as conn:
        for host_domain, host in ((domain, "rival.example"), (mine, "me.example")):
            ids = {}
            for path in ("/a", "/b", "/c"):
                url = f"https://{host}{path}"
                conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, content_hash, first_seen_at) VALUES (:d, :u, SHA2(:u, 256), 'h', :f)"), {"d": host_domain, "u": url, "f": now - timedelta(days=5)})
                ids[path] = conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar()
            for path, kind in (("/a", "title"), ("/a", "content"), ("/b", "redirect"), ("/c", "redirect")):
                conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, :k, 'x', 'y', :t)"),
                             {"p": ids[path], "d": host_domain, "k": kind, "t": now})
    answer = collective.rivals(world.engine)
    card = next(r for r in answer["rivals"] if r["host"] == "rival.example")
    you = answer["mine"][0]
    assert (card["edited_30d"], card["moved_30d"], card["edits_30d"]) == (1, 2, 1)
    assert (you["edited_30d"], you["edits_30d"]) == (1, 1)
    with world.engine.connect() as conn:
        assert profile.edits_last_30_days(conn)[rival] == 1
        _months, _since, pages = insights._edits_by_month(conn, "rival.example", [now.strftime("%Y-%m")])
    assert pages == 1


def test_todays_rival_line_says_seen_unless_the_page_dates_its_change():
    # N8: well-tax.com /about-us/ was edited on 11 Nov (its dateModified) and seen on 17 Nov. A drop starting 18 Nov:
    # with the page's date, 7 days before; without, the day the app saw it, said as "seen", 1 day before.
    seen = datetime(2026, 11, 17, 3, 0)
    assert today._change_day({"detected_at": seen, "extras": json.dumps({"modified": "2026-11-11T10:00:00+04:00"})}) == (date(2026, 11, 11), True)
    assert today._change_day({"detected_at": seen, "extras": "{}"}) == (date(2026, 11, 17), False)
    # A modified date after the day seen is a later edit: it says nothing about this one.
    assert today._change_day({"detected_at": seen, "extras": {"modified": "2026-11-18"}}) == (date(2026, 11, 17), False)
    assert today._rival_words("/about-us/", 7, True) == ["Rival changed {path} {n} days before", {"path": "/about-us/", "n": 7}]
    assert today._rival_words("/about-us/", 1, False) == ["Rival changed {path}, seen 1 day before", {"path": "/about-us/"}]
    assert today._rival_words("/about-us/", 0, False) == ["Rival changed {path}, seen during the drop", {"path": "/about-us/"}]
