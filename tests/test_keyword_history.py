"""A keyword's history: our line, rivals from the same checks, and the page's edits, backlinks and boosts on their days."""
import hashlib
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import text

from seo.accounts import service
from seo.accounts.endpoints import ENDPOINTS, OWNERS
from seo.core.errors import NotFound, Refused
from seo.serp import keyword_history as kh
from seo.web import create_app
from tests.test_insights_mix import check, keyword, rival
from tests.test_search import site  # noqa: F401

HOME = "https://shop-one.test/"
PAGE = HOME + "guide/"
PASSWORD = "correct horse battery"


def days_ago(n):
    return (datetime.now(UTC) - timedelta(days=n)).date().isoformat()


def stored_page(engine, url, host="shop-one.test"):
    with engine.begin() as conn:
        domain = conn.execute(text("SELECT id FROM domains WHERE host = :h"), {"h": host}).scalar() or conn.execute(text("INSERT INTO domains (host) VALUES (:h)"), {"h": host}).lastrowid
        return conn.execute(
            text("INSERT INTO pages (domain_id, url, url_hash) VALUES (:d, :u, :h)"), {"d": domain, "u": url, "h": hashlib.sha256(url.encode()).hexdigest()}
        ).lastrowid, domain


def edit(engine, page, kind, ago, before="old", after="new", words=None):
    page_id, domain = page
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, changed_words, detected_at) VALUES (:p, :d, :k, :b, :a, :w, :t)"),
            {"p": page_id, "d": domain, "k": kind, "b": before, "a": after, "w": words, "t": datetime.now(UTC) - timedelta(days=ago)},
        )


def backlink(engine, site_id, source, target, placed=None, sent_ago=None, status="live", final=None):
    with engine.begin() as conn:
        return conn.execute(
            text("INSERT INTO backlinks (site_id, source_url, domain, status, target_url, target_final_url, placed, sent_at, anchor) VALUES (:s, :u, :d, :st, :t, :f, :p, :sent, 'the anchor')"),
            {"s": site_id, "u": source, "d": source.split("/")[2], "st": status, "t": target, "f": final, "p": placed, "sent": datetime.now(UTC) - timedelta(days=sent_ago) if sent_ago is not None else None},
        ).lastrowid


def line_of(found, tool="SerpApi"):
    return next(line for line in found["lines"] if line["tool"] == tool)


def places(points):
    return [point["p"] for point in points]


# ---- the days people type ----

@pytest.mark.parametrize("typed, day", [
    ("2026-11-03", date(2026, 11, 3)), ("2026-11-03 10:00", date(2026, 11, 3)), ("2026/11/3", date(2026, 11, 3)),
    ("03/11/2026", date(2026, 11, 3)), ("3.11.26", date(2026, 11, 3)), ("3-11-2026", date(2026, 11, 3)),
    ("3 Nov 2026", date(2026, 11, 3)), ("3 novembre 2026", date(2026, 11, 3)), ("1er août 2026", date(2026, 8, 1)),
    ("Nov 3, 2026", date(2026, 11, 3)), ("November 3rd 2026", date(2026, 11, 3)),
    ("", None), (None, None), ("soon", None), ("Q4", None), ("31/02/2026", None), ("3 Smarch 2026", None),
])
def test_a_typed_day_is_read_or_left_alone(typed, day):
    assert kh.parse_day(typed) == day


def test_one_page_has_one_spelling():
    same = {kh.page_key(u) for u in (PAGE, "http://www.shop-one.test/guide", "https://shop-one.test/guide/?utm_source=x&gclid=1", "https://SHOP-ONE.test/guide/#top")}
    assert same == {"shop-one.test/guide"}
    assert kh.page_key("https://shop-one.test/guide/?page=2") != kh.page_key(PAGE)
    assert kh.page_key(HOME) == "shop-one.test" and kh.page_key("") == "" and kh.page_key("not an address") == ""


# ---- our line and theirs ----

def test_our_line_and_rivals_come_from_the_same_checks(engine, site):
    kid = keyword(engine, site, "blue shoes")
    rival(engine, site, "rival.test")
    check(engine, kid, [(1, "https://rival.test/a"), (4, PAGE), (6, "https://other.test/")], ago=20)
    check(engine, kid, [(2, PAGE), (3, "https://www.rival.test/a"), (5, "https://rival.test/b")], ago=10)
    check(engine, kid, [(1, PAGE), (2, "https://other.test/")], ago=1)
    # Another tool saw the rival first: that's another line, and never joins this one.
    check(engine, kid, [(1, "https://rival.test/a"), (9, PAGE)], ago=5, tool="Bright Data")

    found = kh.history(engine, site, kid, "google")
    assert found["page"] == PAGE and len(found["lines"]) == 2
    ours = line_of(found)
    assert places(ours["points"]) == [4, 2, 1] and [p["suspect"] for p in ours["points"]] == [False, False, False]
    assert [(r["host"], r["tracked"], r["seen"]) for r in ours["rivals"]] == [("rival.test", True, 2), ("other.test", False, 2)]
    assert places(ours["rivals"][0]["points"]) == [1, 3, None]  # its best place in each check; absent leaves a gap
    assert places(ours["rivals"][1]["points"]) == [6, None, 2]
    assert [p["at"] for p in ours["rivals"][0]["points"]] == [p["at"] for p in ours["points"]]
    other = line_of(found, "Bright Data")
    assert places(other["points"]) == [9] and places(other["rivals"][0]["points"]) == [1]


def test_followed_rivals_come_first_and_only_a_few_other_sites_are_offered(engine, site):
    kid = keyword(engine, site, "blue shoes")
    rival(engine, site, "zeta-rival.test")
    rival(engine, site, "never-there.test")
    with engine.begin() as conn:  # keyword numbers hidden for this one: it is no line
        rid = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('pages-only.test', 'https://pages-only.test/', 'competitor')")).lastrowid
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source, tracking) VALUES (:s, :r, 'manual', 'pages')"), {"s": site, "r": rid})
    crowd = [(n + 3, f"https://site{n}.test/") for n in range(7)]
    check(engine, kid, [(1, PAGE), (2, "https://pages-only.test/"), (10, "https://zeta-rival.test/"), *crowd[:4]], ago=4, depth=20)
    check(engine, kid, [(1, PAGE), (2, "https://pages-only.test/"), *crowd], ago=1, depth=20)
    rivals = line_of(kh.history(engine, site, kid, "google"))["rivals"]
    assert rivals[0]["host"] == "zeta-rival.test" and rivals[0]["tracked"]
    assert [r["host"] for r in rivals[1:]] == ["pages-only.test", "site0.test", "site1.test", "site2.test", "site3.test"]
    assert not any(r["tracked"] for r in rivals[1:]) and len(rivals) == 1 + kh.OTHERS


def test_a_suspect_check_gives_rivals_no_point(engine, site):
    kid = keyword(engine, site, "blue shoes")
    rival(engine, site, "rival.test")
    check(engine, kid, [(3, PAGE), (1, "https://rival.test/")], ago=9)
    odd = check(engine, kid, [(8, PAGE), (2, "https://rival.test/")], ago=2)
    with engine.begin() as conn:
        conn.execute(text("UPDATE serp_checks SET status = 'suspect' WHERE id = :i"), {"i": odd.check_id if hasattr(odd, "check_id") else odd})
    ours = line_of(kh.history(engine, site, kid, "google"))
    assert [(p["p"], p["suspect"]) for p in ours["points"]] == [(3, False), (8, True)]
    assert places(ours["rivals"][0]["points"]) == [1]


# ---- what we did to the page ----

def test_edits_are_the_days_the_page_changed_with_what_changed(engine, site):
    kid = keyword(engine, site, "blue shoes")
    check(engine, kid, [(4, PAGE)])
    page = stored_page(engine, "https://www.shop-one.test/guide", host="www.shop-one.test")  # stored under another spelling
    edit(engine, page, "title", 12, "Old title", "New title")
    edit(engine, page, "content", 12, "900 words", "1100 words", words=180)
    edit(engine, page, "meta", 3)
    edit(engine, page, "new_page", 30)  # a page appearing isn't an edit
    edit(engine, stored_page(engine, HOME + "guide/more/"), "title", 5)  # another page, whose address contains this one's
    found = kh.history(engine, site, kid, "google")["edits"]
    assert [(e["at"], [c["kind"] for c in e["changes"]]) for e in found] == [(days_ago(12), ["title", "content"]), (days_ago(3), ["meta"])]
    assert found[0]["changes"][0] == {"kind": "title", "before": "Old title", "after": "New title", "words": None}
    assert found[0]["changes"][1]["words"] == 180


def test_backlinks_to_the_page_land_on_the_day_they_were_placed(engine, site):
    kid = keyword(engine, site, "blue shoes")
    check(engine, kid, [(4, PAGE)])
    iso = backlink(engine, site, "https://blog.test/post", "http://www.shop-one.test/guide?utm_source=blog", placed="2026-10-02")
    french = backlink(engine, site, "https://news.test/item", PAGE, placed="15/10/2026")
    words = backlink(engine, site, "https://mag.test/a", "https://shop-one.test/old-guide", placed="3 Nov 2026", final=PAGE)  # it redirects to the page
    sent = backlink(engine, site, "https://wait.test/a", PAGE, placed="soon", sent_ago=6, status="planned")
    backlink(engine, site, "https://nodate.test/a", PAGE, placed="Q4")  # placed, no usable day: counted
    backlink(engine, site, "https://found.test/a", PAGE, status="found")  # a tool found it: nobody forgot a date
    backlink(engine, site, "https://elsewhere.test/a", HOME + "other/", placed="2026-10-05")
    found = kh.history(engine, site, kid, "google")
    assert [(b["id"], b["at"]) for b in found["backlinks"]] == [(iso, "2026-10-02"), (french, "2026-10-15"), (words, "2026-11-03"), (sent, days_ago(6))]
    assert found["backlinks"][0]["domain"] == "blog.test" and found["backlinks"][0]["anchor"] == "the anchor" and found["backlinks"][3]["status"] == "planned"
    assert found["backlinks_undated"] == 1


def test_dated_notes_of_the_site_come_along(engine, site):
    kid = keyword(engine, site, "blue shoes")
    check(engine, kid, [(4, PAGE)])
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO notes (scope, site_id, day, body) VALUES ('date', :s, '2026-11-02', 'New menu went live'), ('site', :s, NULL, 'Not dated')"), {"s": site})
    assert [(n["at"], n["body"]) for n in kh.history(engine, site, kid, "google")["notes"]] == [("2026-11-02", "New menu went live")]


def test_a_keyword_another_site_tracks_is_not_found(engine, site):
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-two.test', 'https://shop-two.test/', 'own')")).lastrowid
    kid = keyword(engine, other, "blue shoes")
    with pytest.raises(NotFound):
        kh.history(engine, site, kid, "google")
    with pytest.raises(NotFound):
        kh.history(engine, other, kid, "askjeeves")


# ---- boosts ----

def test_a_boost_is_added_listed_on_its_page_and_deleted(engine, site):
    kid = keyword(engine, site, "blue shoes")
    check(engine, kid, [(4, PAGE)])
    client = create_app(engine=engine, auth=False).test_client()
    made = client.post("/api/boosts", json={"site_id": site, "page": "https://www.shop-one.test/guide?utm_campaign=push", "start": "2026-11-01", "end": "2026-11-08", "note": "  Paid   push  "})
    assert made.status_code == 201
    boost = made.get_json()
    assert boost["page"] == "https://www.shop-one.test/guide" and (boost["start"], boost["end"], boost["note"]) == ("2026-11-01", "2026-11-08", "Paid push")
    one_day = client.post("/api/boosts", json={"site_id": site, "page": PAGE, "start": "2026-10-20"}).get_json()
    assert one_day["end"] is None and one_day["note"] is None
    client.post("/api/boosts", json={"site_id": site, "page": HOME + "other/", "start": "2026-11-02"})  # another page: not on this keyword's chart

    found = client.get(f"/api/rankings/{kid}/history?site_id={site}").get_json()
    assert [b["id"] for b in found["boosts"]] == [one_day["id"], boost["id"]]
    with engine.connect() as conn:
        assert len(kh.boosts(conn, site)) == 3

    assert client.delete(f"/api/boosts/{boost['id']}").status_code == 200
    assert [b["id"] for b in client.get(f"/api/rankings/{kid}/history?site_id={site}").get_json()["boosts"]] == [one_day["id"]]
    assert client.delete(f"/api/boosts/{boost['id']}").status_code == 404


@pytest.mark.parametrize("change", [
    {"start": ""}, {"start": "yesterday"}, {"start": "2026-11-09", "end": "2026-11-01"}, {"page": "https://rival.test/guide/"},
    {"page": "/guide/"}, {"page": ""}, {"note": "x" * 301}, {"site_id": "one"},
])
def test_a_boost_that_makes_no_sense_is_refused(engine, site, change):
    with pytest.raises(Refused):
        kh.add_boost(engine, {"site_id": site, "page": PAGE, "start": "2026-11-01", **change}, "Malik")
    with engine.connect() as conn:
        assert kh.boosts(conn, site) == []


def test_a_boost_keeps_who_recorded_it(engine, site):
    assert kh.add_boost(engine, {"site_id": site, "page": PAGE, "start": "2026-11-01"}, "Malik")["created_by"] == "Malik"


# ---- who may ----

def test_the_routes_are_in_the_access_table():
    assert ENDPOINTS["keywords_api.history"] == ("keywords competitors overview", "read", "")
    assert ENDPOINTS["keywords_api.boost_add"][:2] == ENDPOINTS["keywords_api.boost_delete"][:2] == ("keywords", "write")
    assert "page_boosts" in OWNERS["boost_id"]


def test_view_only_reads_the_history_and_cannot_touch_boosts_and_other_sites_stay_shut(engine, site):
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-two.test', 'https://shop-two.test/', 'own')")).lastrowid
    kid = keyword(engine, site, "blue shoes")
    check(engine, kid, [(4, PAGE)])
    mine = kh.add_boost(engine, {"site_id": site, "page": PAGE, "start": "2026-11-01"}, "Boss")["id"]
    theirs = kh.add_boost(engine, {"site_id": other, "page": "https://shop-two.test/", "start": "2026-11-01"}, "Boss")["id"]
    service.create_user(engine, "boss@example.com", "Boss", "admin", password=PASSWORD, must_change=False)
    for email, level in (("viewer@example.com", "view"), ("editor@example.com", "edit")):
        service.create_user(engine, email, level, "member", password=PASSWORD, must_change=False, access={"sites": [site], "sections": {"keywords": level}, "spend": False})
    app = create_app(engine=engine, secret_key="test-secret-key")

    def signed_in(email):
        client = app.test_client()
        reply = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert reply.status_code == 200, reply.get_json()
        return client, {"X-CSRF-Token": reply.get_json()["csrf"]}

    viewer, token = signed_in("viewer@example.com")
    assert viewer.get(f"/api/rankings/{kid}/history?site_id={site}").status_code == 200
    assert viewer.get(f"/api/rankings/{kid}/history?site_id={other}").status_code == 403
    assert viewer.post("/api/boosts", json={"site_id": site, "page": PAGE, "start": "2026-11-02"}, headers=token).status_code == 403
    assert viewer.delete(f"/api/boosts/{mine}", headers=token).status_code == 403

    editor, token = signed_in("editor@example.com")
    assert editor.post("/api/boosts", json={"site_id": other, "page": "https://shop-two.test/", "start": "2026-11-02"}, headers=token).status_code == 403
    assert editor.delete(f"/api/boosts/{theirs}", headers=token).status_code == 403
    made = editor.post("/api/boosts", json={"site_id": site, "page": PAGE, "start": "2026-11-02"}, headers=token)
    assert made.status_code == 201 and made.get_json()["created_by"] == "edit"
    assert editor.delete(f"/api/boosts/{mine}", headers=token).status_code == 200
