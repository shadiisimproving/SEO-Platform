"""Link gaps keep every link of a competitor's file: anchor text, Page Authority, the page it's on and the page it points to."""
from sqlalchemy import text

from seo.backlinks import cleaner
from seo.competitors import gaps
from tests.test_competitors_backend import add_rival, world  # noqa: F401  (world is a fixture)

UBERSUGGEST = (
    "﻿No,Source Page Title,Source URL,Target URL,Domain Authority,Page Authority,Spam Score,Anchor Text,First Seen,Last Seen\n"
    '1,"Company setup - Forum","https://forum.good.example/thread-1","https://rival.example/contact/",61,33,1,"company setup dubai","2025-05-13","2026-11-04"\n'
    '2,"-","https://forum.good.example/thread-2","https://rival.example/",61,41,1,"rival.example","2024-01-02","2026-10-01"\n'
    '3,"Other","https://www.other.example/page","https://rival.example/free-zone",30,12,2,"free zone, cheap","2023-03-03","2026-09-09"\n'
    '4,"Spam","https://spam.example/x","https://rival.example/",10,5,88,"buy now","2022-01-01","2026-01-01"\n'
    '5,"No url","-","https://rival.example/",10,5,1,"nothing","2022-01-01","2026-01-01"\n'
).encode("utf-8")


def gap(world, domain, quality="good"):  # noqa: F811
    with world.engine.begin() as conn:  # the home-page check runs later in a worker; here it has said yes
        conn.execute(text("UPDATE link_domains SET quality = :q WHERE domain = :d"), {"q": quality, "d": domain})
    answer = gaps.link_gaps(world.engine, world.own)
    return {g["domain"]: g for g in answer["gaps"] + answer["filtered"]}[domain]


def test_the_reader_keeps_each_link_with_its_anchor_page_authority_and_pages():
    links = cleaner.link_rows(UBERSUGGEST)
    assert len(links) == 4  # the row with no usable URL is left out, spam stays
    first = links[0]
    assert first["domain"] == "good.example" and first["source_url"] == "https://forum.good.example/thread-1"
    assert first["target_url"] == "https://rival.example/contact/" and first["anchor"] == "company setup dubai"
    assert (first["authority"], first["page_authority"], first["spam_score"]) == (61, 33, 1)
    assert (first["first_seen"], first["last_seen"]) == ("2025-05-13", "2026-11-04")
    assert first["source_title"] == "Company setup - Forum" and links[1]["source_title"] is None  # "-" means none
    assert links[2]["anchor"] == "free zone, cheap"  # a quoted comma stays in the anchor


def test_a_file_with_only_domains_has_no_links():
    assert cleaner.link_rows(b"Domain\nplain.example\n") == []


def test_every_link_is_listed_in_its_domain_row_strongest_page_first(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, UBERSUGGEST, "backlink-report.csv")
    row = gap(world, "good.example")
    assert row["link_count"] == 2 and row["best_page_authority"] == 41
    assert [l["anchor"] for l in row["links"]] == ["rival.example", "company setup dubai"]
    assert row["links"][0]["host"] == "rival.example" and row["links"][0]["target_url"] == "https://rival.example/"
    assert row["authority"] == 61  # the domain's own columns don't change
    spam = gap(world, "spam.example", "spam")
    assert spam["links"][0]["spam_score"] == 88


def test_uploading_the_same_file_again_adds_no_link_twice(world):  # noqa: F811
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, UBERSUGGEST, "a.csv")
    newer = UBERSUGGEST.replace(b",61,33,1,", b",61,38,1,").replace(b'"2026-11-04"', b'"2026-11-09"')
    gaps.import_referrers(world.engine, world.own, rival, newer, "b.csv")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrer_links")).scalar() == 4
    link = next(l for l in gap(world, "good.example")["links"] if l["anchor"] == "company setup dubai")
    assert link["page_authority"] == 38 and link["last_seen"] == "2026-11-09" and link["first_seen"] == "2025-05-13"


def test_a_competitor_untied_by_hand_brings_no_links(world):  # noqa: F811
    first = add_rival(world)
    second = add_rival(world, host="second.example")
    gaps.import_referrers(world.engine, world.own, first, UBERSUGGEST, "a.csv")
    gaps.import_referrers(world.engine, world.own, second, UBERSUGGEST.replace(b"rival.example", b"second.example"), "b.csv")
    assert gap(world, "good.example")["link_count"] == 4
    gaps.save_edit(world.engine, "good.example", remove_competitors=[second])
    row = gap(world, "good.example")
    assert row["link_count"] == 2 and {l["host"] for l in row["links"]} == {"rival.example"}
