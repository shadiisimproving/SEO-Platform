"""Links and competitors say what they claim (SEO expert review 2026-11-17, items #7, #11, #13 and section 2).

Each test has a known answer worked out by hand: which files' links are gone, which tool's scores sort together, how many
pages (not change rows) were edited, and how many linking sites are real (not spam).
"""
from sqlalchemy import text

from seo.backlinks import cleaner
from seo.competitors import collective, gaps, insights
from tests.test_competitors_backend import add_rival, world  # noqa: F401  (world is a fixture)
from tests.test_link_gap_links import gap

# A SEMrush backlinks export, as it comes: Nofollow, Sponsored, Ugc and Lost link columns (links F5).
SEMRUSH = (
    "Page ascore,Source title,Source url,Target url,Anchor,Nofollow,Sponsored,Ugc,First seen,Last seen,Lost link,Authority Score\n"
    "40,Forum,https://forum.dead.example/t/1,https://rival.example/,cheap,true,false,true,2024-01-01,2025-03-01,true,30\n"
    "50,Press,https://pr-wire.example/news/1,https://rival.example/,rival,false,true,false,2025-01-01,2026-11-01,false,60\n"
    "45,Blog,https://blog.follow.example/post,https://rival.example/a,guide,false,false,false,2025-01-01,2026-11-01,false,54\n"
).encode("utf-8")

UBERSUGGEST = (
    "Source URL,Target URL,Domain Authority,Page Authority,Spam Score,Anchor Text\n"
    "https://dubai-directory.example/listing,https://rival.example/,70,20,1,rival\n"
    "https://blog.follow.example/post,https://rival.example/a,80,20,1,guide\n"
).encode("utf-8")


# ---- #13: a file's nofollow, sponsored, ugc and lost columns ------------------------------------------------

def test_the_reader_keeps_rel_and_lost_from_a_semrush_file():
    links = {l["domain"]: l for l in cleaner.link_rows(SEMRUSH)}
    assert links["dead.example"]["lost"] is True and links["dead.example"]["rel"] == "nofollow ugc"
    assert links["pr-wire.example"]["lost"] is False and links["pr-wire.example"]["rel"] == "sponsored"
    assert links["follow.example"]["rel"] == "follow"


def test_a_file_that_says_nothing_leaves_rel_and_lost_unknown():
    link = cleaner.link_rows(UBERSUGGEST)[0]
    assert link["rel"] is None and link["lost"] is None


def test_lost_links_are_no_gap_and_paid_ones_are_marked_not_followed(world):  # noqa: F811
    rival = add_rival(world)
    report = gaps.import_referrers(world.engine, world.own, rival, SEMRUSH, "semrush.csv")
    assert report["lost"] == 1 and report["domains"] == 2
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrers WHERE domain = 'dead.example'")).scalar() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrer_links WHERE domain = 'dead.example'")).scalar() == 0
    assert gap(world, "pr-wire.example")["followed"] is False
    assert gap(world, "follow.example")["followed"] is True
    answer = gaps.link_gaps(world.engine, world.own)
    assert answer["funnel"]["not_followed"] == 1


def test_a_link_the_next_file_says_is_lost_leaves_the_list(world):  # noqa: F811
    rival = add_rival(world)
    alive = SEMRUSH.replace(b"2025-03-01,true", b"2025-03-01,false")
    gaps.import_referrers(world.engine, world.own, rival, alive, "old.csv")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrer_links WHERE domain = 'dead.example'")).scalar() == 1
    gaps.import_referrers(world.engine, world.own, rival, SEMRUSH, "new.csv")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrer_links WHERE domain = 'dead.example'")).scalar() == 0


# ---- #7: scores of one tool sort together ---------------------------------------------------------------------

def test_scale_of_reads_the_tool_from_the_label():
    assert cleaner.scale_of("Authority Score (SEMrush)") == cleaner.scale_of("SEMrush") == "semrush"
    assert cleaner.scale_of("Domain Authority (Ubersuggest)") == "ubersuggest"
    assert cleaner.scale_of("DR (CSV)") == "dr (csv)" != cleaner.scale_of("DA (CSV)")
    assert cleaner.scale_ranks(["A (SEMrush)", "B (SEMrush)", "C (Ubersuggest)"]) == {"semrush": 0, "ubersuggest": 1}


def _two_tools(world):  # noqa: F811
    """SEMrush scores pr-wire (60) and follow (54) for one rival; Ubersuggest scores dubai-directory (70) and follow (80) for another."""
    rival = add_rival(world)
    second = add_rival(world, host="second.example")
    gaps.import_referrers(world.engine, world.own, rival, SEMRUSH, "semrush.csv")
    gaps.import_referrers(world.engine, world.own, second, UBERSUGGEST.replace(b"rival.example", b"second.example"), "ubersuggest.csv")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'good'"))


def test_link_gaps_never_rank_an_ubersuggest_70_above_a_semrush_54(world):  # noqa: F811
    """Known answer: both tools score two domains, so the tie goes A to Z and SEMrush leads. follow.example links to both
    rivals, so it's first, and shows SEMrush's 54, not Ubersuggest's 80. Among the one-rival domains SEMrush's 60 comes
    before Ubersuggest's 70, which sits after on its own scale."""
    _two_tools(world)
    answer = gaps.link_gaps(world.engine, world.own)
    order = [(g["domain"], g["authority"], cleaner.scale_of(g["authority_label"]), g["scale_rank"]) for g in answer["gaps"]]
    assert order == [("follow.example", 54, "semrush", 0), ("pr-wire.example", 60, "semrush", 0), ("dubai-directory.example", 70, "ubersuggest", 1)]
    assert cleaner.scale_of(answer["score_scale"]) == "semrush"


def test_shared_links_on_competitors_sort_the_same_way(world):  # noqa: F811
    _two_tools(world)
    shared = collective.links(world.engine, world.own)
    assert [(g["domain"], g["authority"]) for g in shared["gaps"]] == [("follow.example", 54), ("pr-wire.example", 60), ("dubai-directory.example", 70)]


# ---- #11: their linking sites never count spam -----------------------------------------------------------------

def test_their_linking_sites_leave_spam_out_and_say_where_they_come_from(world):  # noqa: F811
    rival = add_rival(world)
    spammy = UBERSUGGEST.replace(b"/listing,https://rival.example/,70,20,1,", b"/listing,https://rival.example/,70,20,88,")  # the file's score says spam
    gaps.import_referrers(world.engine, world.own, rival, spammy, "ubersuggest.csv")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'good'"))
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": rival}).scalar()
        links = insights._links(conn, world.own, rival, host)
    assert links["linking_domains"] == 1 and links["linking_flagged"] == 1
    assert links["linking_sources"] == ["Ubersuggest"] and links["same_source"] is False


# ---- #11: "Updated, 12 months" and edit counts ------------------------------------------------------------------

def test_updated_share_counts_only_pages_with_a_date_of_their_own():
    """Two pages: one read for the first time (no edit seen, no date of its own), one edited. Before the fix both had
    last_changed_at, so the share was 2 of 2 = 100%. Now the first one has no date and stays out: 1 of 1."""
    from datetime import UTC, datetime
    pages = [
        {"extras": {}, "first_archived": None, "reported_new": None, "sitemap_lastmod": None, "last_changed_at": None},
        {"extras": {}, "first_archived": None, "reported_new": None, "sitemap_lastmod": None, "last_changed_at": datetime.now(UTC)},
    ]
    insights._add_dates(pages)
    assert [p["updated"] is not None for p in pages] == [False, True]


def _page_with_edits(world, host, path, kinds, days_ago=1):  # noqa: F811
    with world.engine.begin() as conn:
        domain = conn.execute(text("SELECT id FROM domains WHERE host = :h"), {"h": host}).scalar()
        if domain is None:
            domain = conn.execute(text("INSERT INTO domains (host) VALUES (:h)"), {"h": host}).lastrowid
        page = conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, content_hash) VALUES (:d, :u, SHA1(:u), 'x')"), {"d": domain, "u": f"https://{host}{path}"}).lastrowid
        for kind in kinds:
            conn.execute(text(f"INSERT INTO change_events (page_id, domain_id, kind, detected_at) VALUES (:p, :d, :k, UTC_TIMESTAMP(3) - INTERVAL {int(days_ago)} DAY)"), {"p": page, "d": domain, "k": kind})


def test_edit_counts_count_pages_not_change_rows(world):  # noqa: F811
    """Known answer: /subscription was rewritten (title, meta and text: 3 rows) and /guide edited once. 4 rows, 2 pages."""
    add_rival(world)
    _page_with_edits(world, "rival.example", "/subscription", ["title", "meta_description", "content"])
    _page_with_edits(world, "rival.example", "/guide", ["content"])
    _page_with_edits(world, "rival.example", "/new", ["new_page"])
    with world.engine.connect() as conn:
        facts = collective._card_facts(conn, ["rival.example"])["rival.example"]
        months = [f"{datetime_now_month()}"]
        by_month, since, pages = insights._edits_by_month(conn, "rival.example", months)
    assert (facts["edited_30d"], facts["added_30d"]) == (2, 1)
    assert by_month == [2] and pages == 2 and since is not None


def datetime_now_month():
    from datetime import UTC, datetime, timedelta
    return (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m")
