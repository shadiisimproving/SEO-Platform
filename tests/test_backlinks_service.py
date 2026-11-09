"""Backlinks kept on the server: every template column saved and read back, on the real test database."""
import base64
import csv
import io
import json
import shutil
import subprocess
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import text

from seo.backlinks import cleaner, logos, service
from seo.competitors import gaps
from seo.core.errors import NotFound, Refused
from seo.links import service as links
from tests.test_competitors_backend import REFERRERS, add_rival, gap_map, rows, scalar, world  # noqa: F401 - world is a fixture

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "templates" / "backlinks-template.csv"
ALLOW = lambda url: True  # noqa: E731
QUEUE_ICONS = logos.queue_for  # the world fixture swaps it for nothing
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(not NODE, reason="node is not installed")
COLUMNS = ["Our site", "Source page", "Target page", "Anchor text", "Link type", "Status", "Date placed", "Due date", "Renewal date", "Price", "Mediator", "Contact", "Platform", "UTM source", "UTM medium", "UTM campaign", "Owner", "Notes"]

FULL_ROW = {
    "source_url": "https://blog-expat.example/guide", "target_url": "/creer-societe/", "anchor": "créer sa société", "link_type": "Guest post", "status": "planned",
    "placed": "2026-10-01", "due": "2026-11-15", "renewal": "le 3 mars", "price_text": "AED 1,500.50", "mediator": "LinkAgency", "contact": "sara@agency.example",
    "platform": "Fiverr", "utm_source": "blog-expat", "utm_medium": "backlink", "utm_campaign": "bl-101", "owner": "Mickaël", "notes": "Paid in two parts.\nSecond part in December.",
}


def browser(command, **fields):
    out = subprocess.run([NODE, str(ROOT / "tests" / "js" / "bulk_links.cjs")], input=json.dumps({"command": command, **fields}), capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


def post(world, rows_sent):
    return world.client.post("/api/backlinks/bulk", json={"rows": rows_sent})


def listed(world, site_id=None):
    reply = world.client.get(f"/api/backlinks?site_id={site_id or world.own}")
    assert reply.status_code == 200, reply.get_data(as_text=True)
    return reply.get_json()["backlinks"]


def count(world):
    return scalar(world.engine, "SELECT COUNT(*) FROM backlinks")


# ---- correcting a link -------------------------------------------------------------------------------

def put(world, backlink_id, **fields):
    return world.client.put(f"/api/backlinks/{backlink_id}", json={"site_id": world.own, **fields})


def test_a_link_can_be_corrected_and_every_field_changes(world):
    saved = post(world, [{"site_id": world.own, **FULL_ROW}]).get_json()["saved"][0]
    reply = put(world, saved["id"], source_url=FULL_ROW["source_url"], status="lost", price_text="200 €", notes="Removed by the site.")
    assert reply.status_code == 200, reply.get_data(as_text=True)
    row = listed(world)[0]
    assert row["id"] == saved["id"] and row["status"] == "lost" and row["price_text"] == "200 €" and row["cost"] == 200 and row["notes"] == "Removed by the site."
    assert row["mediator"] is None  # the form sends the whole link, so a field it empties is emptied
    assert count(world) == 1


def test_a_link_cant_become_a_page_already_logged(world):
    saved = post(world, [{"site_id": world.own, "source_url": "https://one.example/a"}, {"site_id": world.own, "source_url": "https://two.example/b"}]).get_json()["saved"]
    first = next(row for row in saved if "one.example" in row["source_url"])
    reply = put(world, first["id"], source_url="https://two.example/b", status="live")
    assert reply.status_code >= 400 and "Already logged" in reply.get_data(as_text=True)
    assert sorted(row["source_url"] for row in listed(world)) == ["https://one.example/a", "https://two.example/b"]


def test_correcting_checks_fields_like_an_upload_and_a_missing_link_says_so(world):
    saved = post(world, [{"site_id": world.own, "source_url": "https://one.example/a"}]).get_json()["saved"][0]
    assert put(world, saved["id"], source_url="not an address", status="live").status_code >= 400
    assert put(world, saved["id"], source_url="https://one.example/a", status="weird").status_code >= 400
    assert listed(world)[0]["source_url"] == "https://one.example/a"
    assert put(world, saved["id"] + 999, source_url="https://one.example/a", status="live").status_code == 404


@needs_node
def test_the_browser_points_out_an_impossible_date_and_leaves_the_rest_alone():
    dates = ["31/02/2026", "2026-02-31", "12/03/2026", "03/25/2026", "2026-03-12", "le 3 mars", ""]
    answer = browser("check", table={
        "rows": [[f"https://site{i}.example/page", date] for i, date in enumerate(dates)],
        "map": ["src", "placed"], "sites": ["mine.example"], "defaultSite": "mine.example", "known": [],
    })
    assert [row["state"] for row in answer] == ["ok"] * len(dates)  # dates stay as typed, so none of these blocks a row
    assert [row["oddDate"] for row in answer] == ["31/02/2026", "2026-02-31", "", "", "", "", ""]


# ---- every column is kept ----------------------------------------------------------------------------

def test_every_template_column_is_saved_and_read_back(world):
    reply = post(world, [{"site_id": world.own, **FULL_ROW}])
    assert reply.status_code == 201, reply.get_data(as_text=True)
    answer = reply.get_json()
    assert answer["skipped"] == [] and len(answer["saved"]) == 1
    for row in (answer["saved"][0], listed(world)[0]):
        for field, value in FULL_ROW.items():
            assert row[field] == value, field
        assert row["site_id"] == world.own and row["domain"] == "blog-expat.example" and row["cost"] == 1500.5 and row["id"] and row["created_at"]


def test_only_the_source_page_is_needed_and_blank_means_live(world):
    assert post(world, [{"site_id": world.own, "source_url": "https://only.example/a", "status": "", "notes": "   ", "anchor": None}]).status_code == 201
    row = listed(world)[0]
    assert row["status"] == "live"
    for field in FULL_ROW:
        if field not in ("source_url", "status"):
            assert row[field] is None, field
    assert row["cost"] is None


def test_a_source_with_no_https_gets_it(world):
    post(world, [{"site_id": world.own, "source_url": "blog.only.example/a"}])
    row = listed(world)[0]
    assert (row["source_url"], row["domain"]) == ("https://blog.only.example/a", "only.example")


def test_many_rows_can_go_to_different_sites_of_mine(world):
    other = links.add_site(world.engine, "https://second.example/", "own", is_allowed=ALLOW)["id"]
    answer = post(world, [{"site_id": world.own, "source_url": "https://a.example/1"}, {"site_id": other, "source_url": "https://a.example/2"}]).get_json()
    assert [row["site_id"] for row in answer["saved"]] == [world.own, other]
    assert [row["source_url"] for row in listed(world)] == ["https://a.example/1"]
    assert [row["source_url"] for row in listed(world, other)] == ["https://a.example/2"]


def test_accents_and_any_language_are_kept(world):
    words = {"anchor": "créer sa société à Séville, été", "notes": "ملاحظة: تم الدفع نقدا 💶", "mediator": "Société Générale Médias", "owner": "Mickaël", "link_type": "Article invité", "platform": "Плат", "contact": "Zoë <zoë@exämple.example>"}
    assert post(world, [{"site_id": world.own, "source_url": "https://accents.example/é", **words}]).status_code == 201
    row = listed(world)[0]
    for field, value in words.items():
        assert row[field] == value


# ---- prices -----------------------------------------------------------------------------------------------

PRICES = [
    ("1 500", "1500"), ("1,500", "1500"), ("1.500,50", "1500.50"), ("$150", "150"), ("150 €", "150"), ("AED 500", "500"),
    ("1,500.50", "1500.50"), ("150,50", "150.50"), ("150.5", "150.50"), ("1.500", "1500"), ("0.500", "0.50"), ("1 500", "1500"), ("1 500,50 €", "1500.50"),
    ("US$ 99", "99"), ("500 dirhams", "500"), ("500AED", "500"), ("€90", "90"), ("aed 1,250", "1250"), ("USD 1,000,000", "1000000"), ("1.500.000", "1500000"), ("1'500", "1500"),
    ("150", "150"), ("0", "0"), ("EUR 12,5", "12.50"), ("£40", "40"),
    ("", None), ("   ", None), ("free", None), ("gratuit", None), ("=1+1", None), ("-50", None), ("+50", None), ("@SUM(A1)", None), ("150 per year", None), ("about 150", None),
    ("12.05.2026", None), ("1,5,0", None), ("15 00", None), ("1.5,00,0", None), ("99999999999", None), ("$", None), (".", None), (",", None),
]


@pytest.mark.parametrize("typed, number", PRICES)
def test_prices_are_read_whatever_way_they_are_typed(typed, number):
    assert service.parse_price(typed) == (None if number is None else Decimal(number))


@needs_node
def test_the_browser_reads_prices_the_same_way():
    typed = [value for value, _ in PRICES]
    assert browser("prices", values=typed) == [None if number is None else float(number) for _, number in PRICES]


@needs_node
def test_the_browser_knows_the_currency():
    assert browser("currencies", values=["$150", "150 €", "AED 500", "500 dirhams", "EUR 12", "US$ 9", "£4", "150", "", "free"]) == ["USD", "EUR", "AED", "AED", "EUR", "USD", "GBP", "", "", ""]


def test_the_price_as_typed_stays_beside_the_number(world):
    typed = ["1 500", "150 €", "AED 500", "free", "1.500,50"]
    post(world, [{"site_id": world.own, "source_url": f"https://p.example/{i}", "price_text": value} for i, value in enumerate(typed)])
    found = {row["price_text"]: row["cost"] for row in listed(world)}
    assert found == {"1 500": 1500, "150 €": 150, "AED 500": 500, "free": None, "1.500,50": 1500.5}


def test_a_bare_number_can_be_sent_as_cost(world):
    post(world, [{"site_id": world.own, "source_url": "https://p.example/n", "cost": 120.5}])
    assert listed(world)[0]["cost"] == 120.5


@pytest.mark.parametrize("cost", ["abc", True, [1], -5])
def test_a_cost_that_is_no_number_is_refused(world, cost):
    assert post(world, [{"site_id": world.own, "source_url": "https://p.example/n", "cost": cost}]).status_code == 400
    assert count(world) == 0


# ---- status words -----------------------------------------------------------------------------------------

STATUS_WORDS = [
    ("Live", "live"), ("LIVE", "live"), ("en ligne", "live"), ("En Ligne", "live"), ("actif", "live"), ("active", "live"), ("", "live"), (None, "live"), ("  ", "live"),
    ("Lost", "lost"), ("perdu", "lost"), ("Perdue", "lost"),
    ("Planned", "planned"), ("prévu", "planned"), ("prevu", "planned"), ("Prévue", "planned"), ("en attente", "planned"), ("pending", "planned"),
]


def test_status_words_in_english_and_french(world):
    sent = [{"site_id": world.own, "source_url": f"https://s.example/{i}", "status": word} for i, (word, _) in enumerate(STATUS_WORDS)]
    answer = post(world, sent)
    assert answer.status_code == 201, answer.get_data(as_text=True)
    assert [row["status"] for row in answer.get_json()["saved"]] == [status for _, status in STATUS_WORDS]


@needs_node
def test_the_browser_knows_the_same_status_words():
    assert browser("statuses", values=[word for word, _ in STATUS_WORDS] + ["maybe", "nofollow"]) == [status for _, status in STATUS_WORDS] + [None, None]


def test_an_unknown_status_is_refused_and_named(world):
    reply = post(world, [{"site_id": world.own, "source_url": "https://s.example/ok"}, {"site_id": world.own, "source_url": "https://s.example/a", "status": "maybe"}])
    assert reply.status_code == 400
    assert "https://s.example/a" in reply.get_json()["error"] and "maybe" in reply.get_json()["error"]
    assert count(world) == 0


# ---- duplicates ---------------------------------------------------------------------------------------------

def test_duplicates_are_skipped_and_named(world):
    post(world, [{"site_id": world.own, "source_url": "https://dup.example/page", "notes": "first"}])
    answer = post(world, [
        {"site_id": world.own, "source_url": "https://dup.example/page"},
        {"site_id": world.own, "source_url": "https://new.example/a"},
        {"site_id": world.own, "source_url": "https://new.example/a"},
    ]).get_json()
    assert [row["source_url"] for row in answer["saved"]] == ["https://new.example/a"]
    assert answer["skipped"] == [
        {"site_id": world.own, "source_url": "https://dup.example/page", "why": "Already logged"},
        {"site_id": world.own, "source_url": "https://new.example/a", "why": "Twice in this file"},
    ]
    assert listed(world)[-1]["notes"] == "first"
    assert count(world) == 2


@pytest.mark.parametrize("spelling", ["http://dup.example/page", "https://www.dup.example/page", "https://DUP.example/page/", "https://dup.example/page?utm_source=x", "https://dup.example/page#top", "dup.example/page"])
def test_another_spelling_of_the_same_page_is_a_duplicate(world, spelling):
    post(world, [{"site_id": world.own, "source_url": "https://dup.example/page"}])
    answer = post(world, [{"site_id": world.own, "source_url": spelling}]).get_json()
    assert answer["saved"] == [] and answer["skipped"][0]["why"] == "Already logged"


def test_two_pages_of_one_site_are_not_duplicates(world):
    answer = post(world, [{"site_id": world.own, "source_url": f"https://dup.example/{p}"} for p in ("a", "b", "a?id=1", "a?id=2")]).get_json()
    assert len(answer["saved"]) == 4 and answer["skipped"] == []


def test_the_same_page_can_link_to_two_of_my_sites(world):
    other = links.add_site(world.engine, "https://second.example/", "own", is_allowed=ALLOW)["id"]
    answer = post(world, [{"site_id": world.own, "source_url": "https://dup.example/a"}, {"site_id": other, "source_url": "https://dup.example/a"}]).get_json()
    assert len(answer["saved"]) == 2 and answer["skipped"] == []


def test_all_skipped_is_not_an_error_and_says_nothing_was_made(world):
    post(world, [{"site_id": world.own, "source_url": "https://dup.example/a"}])
    reply = post(world, [{"site_id": world.own, "source_url": "https://dup.example/a"}])
    assert reply.status_code == 200 and reply.get_json()["saved"] == []


# ---- what is refused ------------------------------------------------------------------------------------------

def test_a_competitors_site_is_refused_and_nothing_is_saved(world):
    rival = add_rival(world)
    reply = post(world, [{"site_id": world.own, "source_url": "https://fine.example/a"}, {"site_id": rival, "source_url": "https://bad.example/a"}])
    assert reply.status_code == 400
    assert "https://bad.example/a" in reply.get_json()["error"] and "own websites" in reply.get_json()["error"]
    assert count(world) == 0
    assert world.client.get(f"/api/backlinks?site_id={rival}").status_code == 400


def test_an_unknown_site_is_refused_and_nothing_is_saved(world):
    reply = post(world, [{"site_id": world.own, "source_url": "https://fine.example/a"}, {"site_id": 999999, "source_url": "https://bad.example/a"}])
    assert reply.status_code == 404
    assert "https://bad.example/a" in reply.get_json()["error"]
    assert count(world) == 0
    assert world.client.get("/api/backlinks?site_id=999999").status_code == 404
    assert world.client.get("/api/backlinks").status_code == 400
    assert world.client.get("/api/backlinks?site_id=abc").status_code == 400


@pytest.mark.parametrize("bad_rows", [
    "not a list", [], ["not a row"], [5], [None],
    [{"source_url": "https://no-site.example/"}],
    [{"site_id": "1", "source_url": "https://text-site.example/"}],
    [{"site_id": True, "source_url": "https://bool-site.example/"}],
    [{"site_id": "OWN"}],
    [{"site_id": "OWN", "source_url": ""}],
    [{"site_id": "OWN", "source_url": 5}],
    [{"site_id": "OWN", "source_url": "not a link"}],
    [{"site_id": "OWN", "source_url": "ftp://files.example/a"}],
    [{"site_id": "OWN", "source_url": "javascript:alert(1)"}],
    [{"site_id": "OWN", "source_url": "https://localhost/"}],
    [{"site_id": "OWN", "source_url": "https://fine.example/", "extra": "x"}],
    [{"site_id": "OWN", "source_url": "https://fine.example/", "notes": ["a list"]}],
    [{"site_id": "OWN", "source_url": "https://fine.example/", "anchor": {"a": 1}}],
    [{"site_id": "OWN", "source_url": "https://fine.example/", "owner": True}],
])
def test_bad_rows_are_refused_with_a_sentence(world, bad_rows):
    if isinstance(bad_rows, list):
        bad_rows = [{k: (world.own if v == "OWN" else v) for k, v in r.items()} if isinstance(r, dict) else r for r in bad_rows]
    reply = world.client.post("/api/backlinks/bulk", json={"rows": bad_rows})
    assert reply.status_code == 400, reply.get_data(as_text=True)
    assert reply.get_json()["error"]
    assert count(world) == 0


def test_the_upload_route_only_takes_rows(world):
    assert world.client.post("/api/backlinks/bulk", data="rows=1").status_code == 400
    assert world.client.post("/api/backlinks/bulk", json={"rows": [], "extra": 1}).status_code == 400
    assert world.client.post("/api/backlinks/bulk", json={}).status_code == 400


def test_more_than_5000_rows_is_refused_with_a_clear_sentence(world):
    many = [{"site_id": world.own, "source_url": f"https://many.example/{i}"} for i in range(5001)]
    reply = post(world, many)
    assert reply.status_code == 400
    assert "5,000" in reply.get_json()["error"]
    assert count(world) == 0


def test_5000_rows_are_accepted(world):
    answer = post(world, [{"site_id": world.own, "source_url": f"https://many.example/{i}", "price_text": "$5"} for i in range(5000)]).get_json()
    assert len(answer["saved"]) == 5000
    assert count(world) == 5000


def test_the_exact_example_rows_can_never_be_imported(world):
    reply = post(world, [{"site_id": world.own, "source_url": "https://example-blog.example/article"}])
    assert reply.status_code == 400
    assert "Example row" in reply.get_json()["error"]
    assert count(world) == 0


# ---- limits and formulas ----------------------------------------------------------------------------------------

def test_every_text_field_has_a_length_limit_and_fits_the_table_at_that_limit(world):
    for n, (field, limit) in enumerate(sorted(service.LIMITS.items())):
        at_limit = "=" + "x" * (limit - 1)  # the longest it can be, and one that also gets the apostrophe in front
        reply = post(world, [{"site_id": world.own, "source_url": f"https://l.example/ok{n}", field: at_limit}])
        assert reply.status_code == 201, field
        assert reply.get_json()["saved"][0][field] == f"'{at_limit}", field
        reply = post(world, [{"site_id": world.own, "source_url": "https://l.example/long", field: "x" * (limit + 1)}])
        assert reply.status_code == 400, field
        assert "https://l.example/long" in reply.get_json()["error"] and "too long" in reply.get_json()["error"], field
    assert count(world) == len(service.LIMITS)


def test_a_source_address_has_a_limit_too(world):
    reply = post(world, [{"site_id": world.own, "source_url": "https://l.example/" + "x" * 3000}])
    assert reply.status_code == 400 and count(world) == 0
    long_host = "a" * 200 + ".example"
    assert post(world, [{"site_id": world.own, "source_url": f"https://{long_host}/"}]).status_code == 400
    assert count(world) == 0


FORMULAS = ['=HYPERLINK("https://evil.example","click")', "=1+1", "+1+1", "-2+3", "@SUM(A1:A9)", "=cmd|' /C calc'!A0", "- paid in cash"]


@pytest.mark.parametrize("cell", FORMULAS)
def test_a_formula_looking_cell_stays_text(world, cell):
    assert post(world, [{"site_id": world.own, "source_url": "https://f.example/a", **{field: cell for field in service.LIMITS}}]).status_code == 201
    row = listed(world)[0]
    for field in service.LIMITS:
        assert row[field] == f"'{cell}", field  # a spreadsheet shows this as text and never runs it
    assert row["cost"] is None


def test_a_cell_with_a_hidden_start_is_still_caught(world):
    post(world, [{"site_id": world.own, "source_url": "https://f.example/a", "notes": "\t=1+1", "anchor": "\x01=1+1", "owner": "\r\n@x"}])
    row = listed(world)[0]
    assert (row["notes"], row["anchor"], row["owner"]) == ("'=1+1", "'=1+1", "'@x")


@pytest.mark.parametrize("cell", ["+971 50 123 4567", "+33 (0)6 12 34 56 78", "-5", "2026-11-04", "'=already safe", "-", "="])
def test_phone_numbers_and_plain_values_are_left_alone(world, cell):
    post(world, [{"site_id": world.own, "source_url": "https://f.example/a", "contact": cell}])
    assert listed(world)[0]["contact"] == cell


def test_a_source_page_can_never_be_a_formula(world):
    assert post(world, [{"site_id": world.own, "source_url": '=HYPERLINK("https://evil.example")'}]).status_code == 400
    assert count(world) == 0


# ---- link gaps and prospects ---------------------------------------------------------------------------------------

def gap_world(world):
    rival = add_rival(world)
    gaps.import_referrers(world.engine, world.own, rival, REFERRERS, "links.csv")
    return rival


def test_a_planned_link_is_still_a_gap(world):
    gap_world(world)
    post(world, [{"site_id": world.own, "source_url": "https://blog.good.example/planned", "status": "Planned"}])
    found = gap_map(world)
    assert "good.example" in found and found["good.example"]["lost_link"] is False


def test_a_live_link_is_not_a_gap(world):
    gap_world(world)
    post(world, [{"site_id": world.own, "source_url": "https://blog.good.example/live"}])
    assert "good.example" not in gap_map(world)


def test_a_found_link_is_not_a_gap_and_a_lost_one_is_flagged(world):
    gap_world(world)
    gaps.log_backlink(world.engine, world.own, "https://blog.good.example/found", "found")
    post(world, [{"site_id": world.own, "source_url": "https://unknown.example/old", "status": "lost"}])
    found = gap_map(world)
    assert "good.example" not in found and found["unknown.example"]["lost_link"] is True


def test_a_live_link_beats_a_planned_one(world):
    gap_world(world)
    post(world, [{"site_id": world.own, "source_url": "https://good.example/planned", "status": "planned"}, {"site_id": world.own, "source_url": "https://good.example/live"}])
    assert "good.example" not in gap_map(world)


@pytest.mark.parametrize("status, stays", [("live", False), ("planned", False), ("lost", True)])
def test_saving_removes_the_domain_from_prospects_as_logging_does(world, status, stays):
    gap_world(world)
    gaps.add_to_prospects(world.engine, world.own, ["good.example"])
    prospect = gaps.list_prospects(world.engine, world.own)[0]
    answer = post(world, [{"site_id": world.own, "source_url": "https://blog.good.example/a", "status": status}]).get_json()
    assert [p["domain"] for p in gaps.list_prospects(world.engine, world.own)] == (["good.example"] if stays else [])
    assert answer["prospects_removed"] == ([] if stays else [prospect["id"]])


def test_a_duplicate_removes_no_prospect(world):
    gap_world(world)
    post(world, [{"site_id": world.own, "source_url": "https://good.example/a", "status": "lost"}])
    gaps.add_to_prospects(world.engine, world.own, ["good.example"])
    answer = post(world, [{"site_id": world.own, "source_url": "https://good.example/a"}]).get_json()
    assert answer["saved"] == [] and answer["prospects_removed"] == []
    assert len(gaps.list_prospects(world.engine, world.own)) == 1


def test_a_prospect_on_another_site_stays(world):
    other = links.add_site(world.engine, "https://second.example/", "own", is_allowed=ALLOW)["id"]
    gap_world(world)
    gaps.add_to_prospects(world.engine, world.own, ["good.example"])
    post(world, [{"site_id": other, "source_url": "https://good.example/a"}])
    assert len(gaps.list_prospects(world.engine, world.own)) == 1


# ---- undo --------------------------------------------------------------------------------------------------------------

def test_undo_deletes_the_links_on_the_server(world):
    gap_world(world)
    saved = post(world, [{"site_id": world.own, "source_url": f"https://blog.good.example/{i}"} for i in range(2)]).get_json()["saved"]
    assert "good.example" not in gap_map(world)
    for row in saved:
        reply = world.client.delete(f"/api/backlinks/{row['id']}")
        assert reply.status_code == 200 and reply.get_json() == {"ok": True}
    assert listed(world) == [] and "good.example" in gap_map(world)
    gone = world.client.delete(f"/api/backlinks/{saved[0]['id']}")
    assert gone.status_code == 404 and gone.get_json()["error"]
    with pytest.raises(NotFound):
        service.delete_one(world.engine, saved[0]["id"])


def test_after_undo_the_same_address_can_be_saved_again(world):
    saved = post(world, [{"site_id": world.own, "source_url": "https://again.example/a"}]).get_json()["saved"]
    world.client.delete(f"/api/backlinks/{saved[0]['id']}")
    assert len(post(world, [{"site_id": world.own, "source_url": "https://again.example/a"}]).get_json()["saved"]) == 1


# ---- the older route for one address ----------------------------------------------------------------------------------------

def test_the_older_route_still_answers_as_it_did(world):
    logged = world.client.post("/api/backlinks", json={"site_id": world.own, "source_url": "https://old-route.example/x"})
    assert logged.status_code == 201
    assert logged.get_json() == {"id": logged.get_json()["id"], "domain": "old-route.example", "status": "live"}
    assert listed(world)[0]["id"] == logged.get_json()["id"]


def test_the_older_route_takes_planned_too(world):
    gap_world(world)
    answer = gaps.log_backlink(world.engine, world.own, "https://good.example/later", "planned")
    assert answer["status"] == "planned" and "good.example" in gap_map(world)


def test_logging_the_same_address_again_keeps_one_row_and_its_latest_state(world):
    first = gaps.log_backlink(world.engine, world.own, "https://again.example/a", "lost")
    second = gaps.log_backlink(world.engine, world.own, "https://www.again.example/a/", "live")
    assert second == {"id": first["id"], "domain": "again.example", "status": "live"}
    assert count(world) == 1 and listed(world)[0]["status"] == "live"
    assert gaps.log_backlink(world.engine, world.own, "https://again.example/a", "found")["status"] == "live"
    assert listed(world)[0]["status"] == "live"


def test_logging_again_as_live_removes_the_prospect(world):
    gap_world(world)
    gaps.log_backlink(world.engine, world.own, "https://good.example/a", "lost")
    gaps.add_to_prospects(world.engine, world.own, ["good.example"])
    gaps.log_backlink(world.engine, world.own, "https://good.example/a", "live")
    assert gaps.list_prospects(world.engine, world.own) == []


def test_a_found_link_becomes_a_real_one_when_logged_with_its_details(world):
    gaps.log_backlink(world.engine, world.own, "https://seen.example/a", "found")
    answer = post(world, [{"site_id": world.own, "source_url": "https://seen.example/a", "anchor": "seen", "price_text": "$5", "status": "live"}]).get_json()
    assert answer["skipped"] == [] and answer["saved"][0]["anchor"] == "seen"
    assert count(world) == 1
    row = listed(world)[0]
    assert (row["status"], row["anchor"], row["cost"]) == ("live", "seen", 5)


# ---- website icons --------------------------------------------------------------------------------------------------------------

def test_saved_links_ask_for_their_sites_icons_by_root_domain(world, monkeypatch):
    asked = []
    monkeypatch.setattr(logos, "queue_for", lambda engine, domains: asked.append(sorted(domains)))
    post(world, [{"site_id": world.own, "source_url": "https://blog.one.example/a"}, {"site_id": world.own, "source_url": "https://www.two.example/b"}, {"site_id": world.own, "source_url": "https://one.example/c", "status": "planned"}])
    assert asked == [["one.example", "two.example"]]


def test_nothing_saved_asks_for_no_icon(world, monkeypatch):
    post(world, [{"site_id": world.own, "source_url": "https://one.example/a"}])
    asked = []
    monkeypatch.setattr(logos, "queue_for", lambda engine, domains: asked.append(domains))
    assert post(world, [{"site_id": world.own, "source_url": "https://one.example/a"}]).get_json()["saved"] == []
    assert asked == []


def test_a_saved_link_really_queues_its_sites_icon(world, monkeypatch):
    monkeypatch.setattr(logos, "queue_for", QUEUE_ICONS)
    post(world, [{"site_id": world.own, "source_url": "https://blog.one.example/a"}])
    assert rows(world.engine, "SELECT domain, status FROM site_logos") == [{"domain": "one.example", "status": "pending"}]
    assert scalar(world.engine, "SELECT COUNT(*) FROM jobs WHERE kind = :k", k=logos.JOB_KIND) == 1


def test_a_failed_icon_request_never_fails_the_save(world, monkeypatch):
    def breaks(engine, domains):
        raise RuntimeError("the queue is down")

    monkeypatch.setattr(logos, "queue_for", breaks)
    reply = post(world, [{"site_id": world.own, "source_url": "https://one.example/a"}])
    assert reply.status_code == 201 and len(reply.get_json()["saved"]) == 1
    assert count(world) == 1


# ---- the template ------------------------------------------------------------------------------------------------------------------

def test_the_template_file_is_a_complete_excel_ready_csv():
    data = TEMPLATE.read_bytes()
    assert data.startswith(b"\xef\xbb\xbfOur site,")  # the mark keeps accents right in Excel, and a "sep=" line would make Excel ignore it
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    assert rows[0] == COLUMNS and len(rows) == 3
    assert all(len(row) == len(COLUMNS) for row in rows)


def test_the_app_parser_opens_the_template_as_columns():
    table, delimiter = cleaner.parse_table(cleaner.decode_csv(TEMPLATE.read_bytes()))
    assert delimiter == "," and table[0] == COLUMNS and len(table) == 3
    assert all(len(row) == len(COLUMNS) for row in table)
    assert [row[1] for row in table[1:]] == sorted(service.EXAMPLE_SOURCES)


@needs_node
def test_the_download_button_gives_exactly_the_template_file():
    template = browser("template")
    assert ("﻿" + template["text"]).encode("utf-8") == TEMPLATE.read_bytes()
    assert template["columns"] == COLUMNS
    assert sorted(template["examples"]) == sorted(service.EXAMPLE_SOURCES)


@needs_node
def test_the_browser_parser_opens_the_template_as_columns():
    table = browser("table", base64=base64.b64encode(TEMPLATE.read_bytes()).decode())
    assert table[0] == COLUMNS and len(table) == 3
    assert browser("columns", headers=table[0]) == ["site", "src", "target", "anchor", "link_type", "status", "placed", "due", "renewal", "cost", "mediator", "contact", "platform", "utm_source", "utm_medium", "utm_campaign", "owner", "notes"]


def test_the_template_readme_explains_it_in_plain_words():
    words = (ROOT / "templates" / "README.md").read_text(encoding="utf-8")
    for needed in [*COLUMNS, "YYYY-MM-DD", "Live", "Lost", "Planned", "en ligne", "actif", "perdu", "prévu", "en attente", "Guest post", "Directory", "Press", "Sponsored", "Forum", "Other"]:
        assert needed in words, needed


@needs_node
def test_both_sides_use_the_same_limits_and_row_cap():
    from_browser = browser("limits")
    assert from_browser["most"] == service.MAX_ROWS == 5000
    names = {"cost": "price_text", "target": "target_url"}
    assert {names.get(key, key): value for key, value in from_browser["limits"].items()} == service.LIMITS


# ---- matching a file's columns --------------------------------------------------------------------------------------------------------

@needs_node
@pytest.mark.parametrize("headers, expected", [
    (["Renewal date", "Date placed", "Due date"], ["renewal", "placed", "due"]),
    (["Date placed", "Due date", "Renewal date"], ["placed", "due", "renewal"]),
    (["Due date", "Renewal date", "Date placed"], ["due", "renewal", "placed"]),
    (["Date", "Renewal date"], ["placed", "renewal"]),
    (["Renewal date", "Date"], ["renewal", "placed"]),
    (["UTM source", "Source page"], ["utm_source", "src"]),
    (["Source page", "UTM source"], ["src", "utm_source"]),
    (["UTM source", "Source"], ["utm_source", "src"]),
    (["utm_source", "utm-medium", "UTM  Campaign", "URL"], ["utm_source", "utm_medium", "utm_campaign", "src"]),
    (["Link type", "Link"], ["link_type", "src"]),
    (["Link", "Link type", "Link status"], ["src", "link_type", "status"]),
    (["Site", "Source page"], ["site", "src"]),
    (["Our site", "Target page", "Source page"], ["site", "target", "src"]),
    (["Source URL", "Target URL", "Anchor", "Cost"], ["src", "target", "anchor", "cost"]),
    (["Mediator contact", "Mediator"], ["contact", "mediator"]),
    (["Mediator", "Mediator contact"], ["mediator", "contact"]),
    (["Date de renouvellement", "Date de pose", "Échéance"], ["renewal", "placed", "due"]),
    (["Page source", "Page cible", "Texte d'ancre", "Prix", "Intermédiaire", "Plateforme", "Responsable", "État"], ["src", "target", "anchor", "cost", "mediator", "platform", "owner", "status"]),
    (["Source UTM", "Support UTM", "Campagne UTM", "Renouvellement"], ["utm_source", "utm_medium", "utm_campaign", "renewal"]),
    (["Second renewal date", "Renewal date"], ["", "renewal"]),
    (["Renewal date", "Renewal date (old)"], ["renewal", ""]),
    (["UTM source", "UTM source 2", "Source"], ["utm_source", "", "src"]),
    (["Notes", "Notes"], ["notes", ""]),
    (["Colour", "Whatever"], ["", ""]),
])
def test_a_column_goes_to_the_right_field_whatever_the_order(headers, expected):
    assert browser("columns", headers=headers) == expected


@needs_node
def test_every_column_maps_the_same_when_shuffled():
    keys = dict(zip(COLUMNS, browser("columns", headers=COLUMNS)))
    assert "" not in keys.values() and len(set(keys.values())) == len(COLUMNS)
    for shuffled in (list(reversed(COLUMNS)), COLUMNS[9:] + COLUMNS[:9], sorted(COLUMNS), sorted(COLUMNS, key=lambda c: c[::-1])):
        assert dict(zip(shuffled, browser("columns", headers=shuffled))) == keys


@needs_node
@pytest.mark.parametrize("row, expected", [
    (COLUMNS, True), (list(reversed(COLUMNS)), True), (["Notes", "Source page"], True),
    (["https://a.example/x", "/to/", "anchor"], False), (["a.example/x", "Notes"], False), (["www.a.example", "Notes"], False), (["", "https://a.example/x", "Source"], False), (["not a link", "foo"], False),
])
def test_only_a_real_header_row_is_treated_as_one(row, expected):
    assert browser("header", row=row) is expected


# ---- the sep line, wherever a spreadsheet leaves it ------------------------------------------------------------------------------------

SEP_FILES = {
    "excel": "sep=;\r\nSource page;Notes\r\nhttps://a.example/x;été\r\n",
    "with a BOM": "﻿sep=;\r\nSource page;Notes\r\nhttps://a.example/x;été\r\n",
    "upper case": "SEP=;\nSource page;Notes\nhttps://a.example/x;été\n",
    "sheets, comma file, sep in the first cell": "sep=;,,\nSource page,Notes\nhttps://a.example/x,été\n",
    "sheets, quoted": '"sep=;",,\nSource page,Notes\nhttps://a.example/x,été\n',
    "sheets, split at the semicolon": "sep=,,\nSource page,Notes\nhttps://a.example/x,été\n",
    "excel keeping it as a row": "sep=;;;\nSource page;Notes\nhttps://a.example/x;été\n",
    "one quoted cell": '"sep=;"\nSource page,Notes\nhttps://a.example/x,été\n',
    "a blank line after it": "sep=;,,\n\nSource page,Notes\nhttps://a.example/x,été\n",
    "tabs": "sep=\t\nSource page\tNotes\nhttps://a.example/x\tété\n",
}


@pytest.mark.parametrize("name", sorted(SEP_FILES))
def test_the_server_parser_skips_the_sep_line(name):
    table, _ = cleaner.parse_table(SEP_FILES[name].removeprefix("﻿"))
    assert table == [["Source page", "Notes"], ["https://a.example/x", "été"]]


@needs_node
@pytest.mark.parametrize("name", sorted(SEP_FILES))
def test_the_browser_parser_skips_the_sep_line(name):
    table = browser("table", base64=base64.b64encode(SEP_FILES[name].encode("utf-8")).decode())
    assert table == [["Source page", "Notes"], ["https://a.example/x", "été"]]


def test_a_real_first_row_starting_with_those_letters_stays():
    table, _ = cleaner.parse_table("sep=;x;y\nhttps://a.example/;b;c\n")
    assert len(table) == 2 and table[1][0] == "https://a.example/"


@needs_node
@pytest.mark.parametrize("encoding", ["utf-8-sig", "utf-16", "cp1252"])
def test_a_file_keeps_its_accents_in_any_excel_encoding(encoding):
    data = "Source page;Anchor text\nhttps://a.example/x;créer sa société\n".encode(encoding)
    assert browser("table", base64=base64.b64encode(data).decode())[1] == ["https://a.example/x", "créer sa société"]


# ---- checking rows in the browser -----------------------------------------------------------------------------------------------------

SITES = ["site-one.example", "site-two.example"]


def check(rows_given, headers=("Our site", "Source page", "Status"), default="site-one.example", known=(), sites=SITES):
    table = {"rows": [list(r) for r in rows_given], "map": browser("columns", headers=list(headers)), "sites": list(sites), "defaultSite": default, "known": [list(k) for k in known]}
    return browser("check", table=table)


def said(row):
    return (row["state"], row["why"])


@needs_node
def test_a_row_with_an_example_source_is_never_ready():
    data = list(csv.reader(io.StringIO(TEMPLATE.read_bytes().decode("utf-8-sig"))))[1:3]
    answer = browser("check", table={"rows": data, "map": browser("columns", headers=COLUMNS), "sites": SITES, "defaultSite": SITES[0], "known": []})
    assert [said(r) for r in answer] == [("bad", "Example row: delete it")] * 2
    assert said(check([["", "https://example-blog.example/article/", ""]])[0]) == ("bad", "Example row: delete it")


@needs_node
@pytest.mark.parametrize("cell", ["site-two.example", "https://site-two.example", "https://www.site-two.example/", "www.site-two.example", "HTTP://Site-Two.Example/", "  site-two.example  "])
def test_our_site_ignores_www_https_and_a_trailing_slash(cell):
    row = check([[cell, "https://a.example/x", ""]])[0]
    assert said(row) == ("ok", "Ready") and row["site"] == "site-two.example"


@needs_node
@pytest.mark.parametrize("cell", ["rival.example", "site-two.example/blog", "other.site-two.example"])
def test_a_site_that_is_not_mine_says_so_by_the_row(cell):
    row = check([[cell, "https://a.example/x", ""]])[0]
    assert said(row) == ("bad", "Not one of your sites") and row["detail"] == cell


@needs_node
def test_a_blank_site_uses_the_default_site():
    assert check([["", "https://a.example/x", ""]], default="site-two.example")[0]["site"] == "site-two.example"
    assert check([["", "https://a.example/x", ""]], default="", sites=[])[0]["why"] == "Add your own website first"


@needs_node
def test_a_status_word_is_read_and_an_unknown_one_is_a_row_problem():
    answer = check([["", "https://a.example/1", ""], ["", "https://a.example/2", "Perdu"], ["", "https://a.example/3", "prévu"], ["", "https://a.example/4", "maybe"]])
    assert [r["status"] for r in answer[:3]] == ["live", "lost", "planned"]
    assert said(answer[3]) == ("bad", "Unknown status") and answer[3]["detail"] == "maybe"


@needs_node
def test_duplicates_are_per_site_and_a_bad_row_does_not_hide_a_good_one():
    answer = check(
        [
            ["", "https://a.example/known/", ""], ["site-two.example", "https://a.example/known", ""],
            ["", "https://a.example/1", ""], ["", "http://www.a.example/1", ""], ["site-two.example", "https://a.example/1", ""],
            ["", "https://a.example/2", "maybe"], ["", "https://a.example/2", "live"],
        ],
        known=[["site-one.example", "https://a.example/known"]],
    )
    assert [said(r) for r in answer] == [
        ("dup", "Already logged"), ("ok", "Ready"), ("ok", "Ready"), ("dup", "Twice in this file"), ("ok", "Ready"), ("bad", "Unknown status"), ("ok", "Ready"),
    ]


@needs_node
def test_addresses_are_checked_and_https_is_added():
    answer = check([["", "blog.a.example/x", ""], ["", "not a link", ""], ["", "", ""], ["", "https://a.example/b c", ""], ["", "https://localhost/", ""]])
    assert said(answer[0]) == ("ok", "https:// added") and answer[0]["record"]["src"] == "https://blog.a.example/x"
    assert [said(r)[0] for r in answer[1:]] == ["bad"] * 4


@needs_node
def test_a_cell_over_the_limit_is_a_row_problem_before_it_reaches_the_server():
    answer = check([["https://a.example/x", "x" * 5001]], headers=("Source page", "Notes"))
    assert said(answer[0]) == ("bad", "Too long") and answer[0]["detail"] == "Notes"


@needs_node
def test_every_cell_of_a_row_lands_in_the_record():
    line = ["site-one.example", "https://a.example/x", "/to/", "ancre", "Guest post", "Live", "2026-01-01", "2026-02-01", "2026-03-01", "AED 500", "Agency", "a@b.example", "Fiverr", "src", "med", "camp", "Sara", "Note"]
    row = check([line], headers=COLUMNS)[0]
    keys = browser("columns", headers=COLUMNS)
    assert said(row) == ("ok", "Ready")
    assert row["record"] == dict(zip(keys, line))


@needs_node
def test_both_sides_see_the_same_spellings_of_one_page():
    same = ["https://dup.example/page", "http://dup.example/page", "https://www.dup.example/page", "https://DUP.example/page/", "https://dup.example/page?utm_source=x", "https://dup.example/page#top"]
    assert len(set(browser("sources", values=same))) == 1
    assert len({service.source_key(value) for value in same}) == 1
    different = ["https://dup.example/a", "https://dup.example/b", "https://dup.example/a?id=1", "https://other.example/a"]
    assert len(set(browser("sources", values=different))) == 4
    assert len({service.source_key(value) for value in different}) == 4


@needs_node
def test_everything_this_screen_can_say_has_french():
    words = [
        *COLUMNS, "Link type", "Planned", "1 planned", "planned", "1 lost", "lost", "1 ready", "ready", "1 backlink added", "backlinks added", "Import 1 backlink", "Row check", "Status and type", "Details",
        "Guest post", "Directory", "Press", "Sponsored", "Forum", "Other", "Default site, for rows with no site",
        "Example row: delete it", "Not one of your sites", "Add your own website first", "Unknown status", "Use Live, Lost or Planned.", "Too long", "Not a full address", "Already logged", "Twice in this file", "https:// added", "Ready",
        "Skipped, already there", "Nothing new to add", "Already logged. Removed from In consideration.", "Nothing found yet", "Links other tools find will show here, until you log them.",
        "Excel files aren't read yet. In Excel, choose Save as, then CSV UTF-8.", "Some links could not be removed", "Backlinks removed", "Backlink saved",
        service.TOO_MANY, "This works from your own websites, not a competitor.", "That website doesn't exist.", "That doesn't look like a web address.", "That web address is too long.", "Send at least one row.", "Every row needs a source page.", "That backlink doesn't exist.",
    ]
    assert browser("french", words=words) == []


# ---- the service, called directly -----------------------------------------------------------------------------------------------------------

def test_the_table_holds_what_the_screen_shows(world):
    service.save_many(world.engine, [{"site_id": world.own, **FULL_ROW}])
    stored = rows(world.engine, "SELECT * FROM backlinks")[0]
    assert stored["cost"] == Decimal("1500.50") and stored["price_text"] == "AED 1,500.50" and stored["status"] == "planned"


def test_refusals_are_the_apps_own_kind(world):
    with pytest.raises(Refused):
        service.save_many(world.engine, [])
    with pytest.raises(NotFound):
        service.save_many(world.engine, [{"site_id": 999999, "source_url": "https://a.example/"}])
    with pytest.raises(NotFound):
        service.list_for_site(world.engine, 999999)


def test_two_uploads_at_once_cannot_save_one_page_twice(world):
    from concurrent.futures import ThreadPoolExecutor

    batch = [{"site_id": world.own, "source_url": f"https://race.example/{i}"} for i in range(50)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(pool.map(lambda _: service.save_many(world.engine, batch), range(2)))
    assert count(world) == 50
    assert sum(len(a["saved"]) for a in answers) == 50 and sum(len(a["skipped"]) for a in answers) == 50
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(DISTINCT source_url) FROM backlinks")).scalar() == 50


# ---- second UX review: nothing known about a link gets lost ----------------------------------------------

def test_placing_a_link_keeps_what_the_prospect_knew_about_the_site(world):
    with world.engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO prospects (site_id, url, domain, authority, authority_label, spam_score) VALUES (:s, 'https://blog.example/a', 'blog.example', 71, 'Authority score', 8)"
        ), {"s": world.own})
    reply = post(world, [{"site_id": world.own, "source_url": "https://blog.example/a"}])
    assert reply.status_code == 201
    saved = listed(world)[0]
    assert (saved["authority"], saved["authority_label"], saved["spam_score"]) == (71, "Authority score", 8)
    assert scalar(world.engine, "SELECT COUNT(*) FROM prospects") == 0


def test_a_found_link_can_be_ignored_kept_and_brought_back(world):
    found = service.log_one(world.engine, world.own, "https://stray.example/x", "found")
    reply = world.client.post(f"/api/backlinks/{found['id']}/ignore", json={"ignored": True})
    assert reply.status_code == 200
    assert listed(world)[0]["status"] == "ignored"  # kept, not deleted
    assert world.client.post(f"/api/backlinks/{found['id']}/ignore", json={"ignored": False}).get_json()["status"] == "found"
    world.client.post(f"/api/backlinks/{found['id']}/ignore", json={"ignored": True})
    # Logging it after all turns the same row into a real link.
    assert post(world, [{"site_id": world.own, "source_url": "https://stray.example/x"}]).status_code == 201
    assert [row["status"] for row in listed(world)] == ["live"]
    assert world.client.post(f"/api/backlinks/{found['id']}/ignore", json={"ignored": True}).status_code == 400  # a logged link can't be


def test_ignoring_needs_a_yes_or_no(world):
    found = service.log_one(world.engine, world.own, "https://stray.example/x", "found")
    assert world.client.post(f"/api/backlinks/{found['id']}/ignore", json={"ignored": "yes"}).status_code == 400
    assert world.client.post("/api/backlinks/99999/ignore", json={"ignored": True}).status_code == 404


def test_a_prospect_has_an_owner_and_a_status(world):
    with world.engine.begin() as conn:
        pid = conn.execute(text("INSERT INTO prospects (site_id, url, domain) VALUES (:s, 'https://blog.example/a', 'blog.example')"), {"s": world.own}).lastrowid
    assert world.client.patch(f"/api/prospects/{pid}", json={"owner": " Sara ", "stage": "contacted"}).status_code == 200
    row = world.client.get(f"/api/prospects?site_id={world.own}").get_json()["prospects"][0]
    assert (row["owner"], row["stage"]) == ("Sara", "contacted")
    world.client.patch(f"/api/prospects/{pid}", json={"stage": "agreed"})
    row = world.client.get(f"/api/prospects?site_id={world.own}").get_json()["prospects"][0]
    assert (row["owner"], row["stage"]) == ("Sara", "agreed")  # only what's sent changes
    assert world.client.patch(f"/api/prospects/{pid}", json={"stage": "maybe"}).status_code == 400
    assert world.client.patch(f"/api/prospects/{pid}", json={"owner": 5}).status_code == 400
    assert world.client.patch("/api/prospects/99999", json={"stage": "new"}).status_code == 404


def test_a_site_remembers_which_setup_steps_it_doesnt_use(world):
    reply = world.client.patch(f"/api/links/sites/{world.own}", json={"setup_not_used": ["clarity", "google", "clarity"]})
    assert reply.status_code == 200
    mine = [site for site in world.client.get("/api/links/sites").get_json()["sites"] if site["id"] == world.own][0]
    assert mine["setup_not_used"] == ["clarity", "google"]
    assert world.client.patch(f"/api/links/sites/{world.own}", json={"setup_not_used": ["everything"]}).status_code == 400


# ---- "doesn't use" on the setup checklist is the same choice as "Not used" in Settings ------------------------------

def setup_list(world):
    return [site for site in world.client.get("/api/links/sites").get_json()["sites"] if site["id"] == world.own][0]["setup_not_used"]


def not_used(world):
    with world.engine.connect() as conn:
        return dict(conn.execute(text("SELECT source, not_used FROM site_sources WHERE site_id = :s"), {"s": world.own}).all())


def tick(world, steps):
    reply = world.client.patch(f"/api/links/sites/{world.own}", json={"setup_not_used": steps})
    assert reply.status_code == 200
    return reply.get_json()


def test_ticking_google_and_clarity_reaches_what_settings_and_the_collectors_read(world):
    assert tick(world, ["google", "clarity", "keywords"])["setup_not_used"] == ["clarity", "google", "keywords"]
    assert not_used(world) == {"gsc": 1, "ga4": 1, "clarity": 1}
    assert setup_list(world) == ["clarity", "google", "keywords"]


def test_unticking_turns_them_back_on_and_keeps_what_was_set(world):
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source, property) VALUES (:s, 'gsc', 'sc-domain:shop.example')"), {"s": world.own})
    tick(world, ["google"])
    tick(world, [])
    assert not_used(world)["gsc"] == 0 and not_used(world)["ga4"] == 0
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT property FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": world.own}).scalar() == "sc-domain:shop.example"


def test_marking_it_not_used_in_settings_shows_on_the_checklist_and_back(world):
    assert world.client.put(f"/api/sites/{world.own}/sources/clarity", json={"not_used": True}).status_code == 200
    assert setup_list(world) == ["clarity"]
    assert world.client.put(f"/api/sites/{world.own}/sources/clarity", json={"not_used": False}).status_code == 200
    assert setup_list(world) == []


def test_google_only_counts_as_not_used_when_both_of_its_sources_are(world):
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source, property, not_used) VALUES (:s, 'gsc', 'sc-domain:shop.example', 0), (:s, 'ga4', NULL, 1)"), {"s": world.own})
    assert setup_list(world) == []


def test_ticking_something_else_leaves_a_half_used_google_alone(world):
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source, property, not_used) VALUES (:s, 'gsc', 'sc-domain:shop.example', 0), (:s, 'ga4', NULL, 1)"), {"s": world.own})
    tick(world, ["keywords"])
    assert not_used(world) == {"gsc": 0, "ga4": 1}
    assert setup_list(world) == ["keywords"]


def test_a_setting_that_changes_nothing_on_the_checklist_writes_no_source_rows(world):
    assert world.client.patch(f"/api/links/sites/{world.own}", json={"check_external": False}).status_code == 200
    assert not_used(world) == {}


def test_the_browser_reads_dates_and_keeps_them_as_a_real_day():
    rows = [["https://one.example/a", "03/10/2026"], ["https://two.example/b", "25/12/2026"], ["https://three.example/c", "12 Oct 2026"], ["https://four.example/d", "tomorrow"], ["https://five.example/e", "le 3 mars"]]
    table = {"rows": rows, "map": ["src", "placed"], "sites": ["mine.example"], "defaultSite": "mine.example", "known": []}
    day_first = browser("check", table=table)
    assert [row["record"]["placed"] for row in day_first] == ["2026-10-03", "2026-12-25", "2026-10-12", "tomorrow", "le 3 mars"]
    assert [row["oddDate"] for row in day_first] == ["", "", "", "tomorrow", ""]
    assert [row["ambiguousDate"] for row in day_first] == [True, False, False, False, False]
    month_first = browser("check", table={**table, "dayFirst": False})
    assert [row["record"]["placed"] for row in month_first][:2] == ["2026-03-10", "2026-12-25"]  # 25 can only be a day
    assert [row["state"] for row in day_first] == ["ok"] * 5  # an unreadable date is pointed out, and the row still imports



# ---- the tagged link generator ---------------------------------------------------------------------

@needs_node
def test_tagged_links_are_real_addresses():
    tags = {"source": "blog-expat", "medium": "backlink", "campaign": "bl-101"}
    tail = "utm_source=blog-expat&utm_medium=backlink&utm_campaign=bl-101"
    asked = [
        {"site": "shop.example", "target": "/page/", **tags},
        {"site": "shop.example", "target": "page", **tags},
        {"site": "shop.example", "target": "", **tags},
        {"site": "shop.example", "target": "https://www.shop.example/page/?a=1&utm_source=old#top", **tags},
        {"site": "shop.example", "target": "shop.example/page", **tags},
        {"site": "shop.example", "target": "/page/", "source": "Le Blog", "medium": "backlink", "campaign": "a&b=c"},
        {"site": "shop.example", "target": "https://other.example/page", **tags},
        {"site": "shop.example", "target": "javascript:alert(1)", **tags},
        {"site": "", "target": "/page", **tags},
    ]
    answers = browser("tagged", links=asked)
    assert answers[0]["url"] == f"https://shop.example/page/?{tail}"
    assert answers[1]["url"] == f"https://shop.example/page?{tail}"
    assert answers[2]["url"] == f"https://shop.example/?{tail}"
    assert answers[3]["url"] == f"https://www.shop.example/page/?a=1&{tail}#top"
    assert answers[4]["url"] == f"https://shop.example/page?{tail}"
    assert answers[5]["url"] == "https://shop.example/page/?utm_source=Le+Blog&utm_medium=backlink&utm_campaign=a%26b%3Dc"
    assert "another website" in answers[6]["error"]
    assert "isn't a web address" in answers[7]["error"]
    assert answers[8]["error"] == "Choose your site first"


# ---- prospects chosen from a CSV: they must still be there after a reload ------------------------------------------

def csv_add(world, rows_sent, file="links.csv", label="Domain Authority", site=None):
    return world.client.post("/api/prospects", json={"site_id": site or world.own, "rows": rows_sent, "file": file, "authority_label": label})


def test_a_prospect_from_a_csv_is_saved_with_all_it_came_with(world):
    answer = csv_add(world, [{"url": "https://blog.fresh.example/post", "authority": 42, "spam_score": 3.5}])
    assert answer.status_code == 200 and answer.get_json()["skipped"] == []
    saved = gaps.list_prospects(world.engine, world.own)
    assert len(saved) == 1 and answer.get_json()["added"] == saved
    row = saved[0]
    assert (row["url"], row["domain"], row["authority"], row["authority_label"], row["spam_score"], row["source_file"], row["source_kind"], row["stage"]) == (
        "https://blog.fresh.example/post", "fresh.example", 42, "Domain Authority", 3.5, "links.csv", "csv", "new")


def test_a_csv_prospects_status_and_owner_can_be_changed_and_it_can_be_removed(world):
    prospect = csv_add(world, [{"url": "https://fresh.example/"}]).get_json()["added"][0]
    assert world.client.patch(f"/api/prospects/{prospect['id']}", json={"stage": "agreed", "owner": "Sara"}).status_code == 200
    row = gaps.list_prospects(world.engine, world.own)[0]
    assert (row["stage"], row["owner"]) == ("agreed", "Sara")
    assert world.client.delete(f"/api/prospects/{prospect['id']}").status_code == 200
    assert gaps.list_prospects(world.engine, world.own) == []


def test_a_domain_already_in_consideration_is_skipped_and_says_why(world):
    csv_add(world, [{"url": "https://fresh.example/one"}])
    answer = csv_add(world, [{"url": "https://www.fresh.example/two"}, {"url": "https://other.example/"}, {"url": "https://other.example/again"}]).get_json()
    assert [row["domain"] for row in answer["added"]] == ["other.example"]
    assert answer["skipped"] == [{"url": "https://www.fresh.example/two", "why": "already_in_consideration"}, {"url": "https://other.example/again", "why": "already_in_consideration"}]
    assert len(gaps.list_prospects(world.engine, world.own)) == 2


def test_what_was_changed_survives_undo_by_coming_back_with_it(world):
    answer = csv_add(world, [{"url": "https://fresh.example/", "owner": "Sara", "stage": "contacted"}]).get_json()
    assert (answer["added"][0]["owner"], answer["added"][0]["stage"]) == ("Sara", "contacted")


def test_a_row_flagged_as_spam_or_with_no_address_is_never_saved(world):
    answer = csv_add(world, [{"url": "https://spammy.example/", "spam_score": 30.5}, {"url": "not an address"}, {"url": "ftp://files.example/"}, {"url": None}, "nonsense"]).get_json()
    assert answer["added"] == [] and gaps.list_prospects(world.engine, world.own) == []
    assert [row["why"] for row in answer["skipped"]] == ["spam", "no_address", "no_address", "no_address", "no_address"]


def test_exactly_thirty_is_not_flagged_like_the_import_window(world):
    assert len(csv_add(world, [{"url": "https://border.example/", "spam_score": 30}]).get_json()["added"]) == 1


@pytest.mark.parametrize("row", [{"url": "https://a.example/", "authority": "lots"}, {"url": "https://a.example/", "spam_score": "bad"}, {"url": "https://a.example/", "stage": "maybe"}, {"url": "https://a.example/", "owner": 7}])
def test_a_bad_value_is_refused_and_nothing_is_saved(world, row):
    assert csv_add(world, [{"url": "https://first.example/"}, row]).status_code == 400
    assert gaps.list_prospects(world.engine, world.own) == []


def test_only_my_own_site_and_a_sensible_request_are_accepted(world):
    rival = add_rival(world)
    assert csv_add(world, [{"url": "https://fresh.example/"}], site=rival).status_code in (400, 404)
    assert csv_add(world, []).status_code == 400
    assert csv_add(world, [{"url": f"https://d{i}.example/"} for i in range(gaps.MAX_PROSPECTS_AT_ONCE + 1)]).status_code == 400
    assert gaps.list_prospects(world.engine, world.own) == []


def test_undoing_a_large_add_removes_them_in_one_request_and_only_mine(world):
    added = csv_add(world, [{"url": f"https://d{i}.example/"} for i in range(50)]).get_json()["added"]
    answer = world.client.post("/api/prospects/remove", json={"ids": [row["id"] for row in added[:49]]})
    assert answer.status_code == 200 and answer.get_json()["removed"] == 49
    assert len(gaps.list_prospects(world.engine, world.own)) == 1
    assert world.client.post("/api/prospects/remove", json={"ids": "all"}).status_code == 400


def test_placing_a_link_removes_a_csv_prospect_on_the_same_domain(world):
    csv_add(world, [{"url": "https://blog.fresh.example/post", "authority": 42}])
    answer = post(world, [{"site_id": world.own, "source_url": "https://fresh.example/live"}]).get_json()
    assert len(answer["prospects_removed"]) == 1 and gaps.list_prospects(world.engine, world.own) == []


# ---- DA, PA and a rating from 1 to 5 on what's in consideration -------------------------------------------------------

def test_pa_and_rating_are_saved_and_read_back(world):
    prospect = csv_add(world, [{"url": "https://fresh.example/", "authority": 40, "page_authority": 22, "rating": 4}]).get_json()["added"][0]
    assert (prospect["authority"], prospect["page_authority"], prospect["rating"]) == (40, 22, 4)
    assert gaps.list_prospects(world.engine, world.own)[0]["page_authority"] == 22


def test_a_row_with_no_pa_or_rating_stays_empty_not_zero(world):
    prospect = csv_add(world, [{"url": "https://fresh.example/"}]).get_json()["added"][0]
    assert prospect["page_authority"] is None and prospect["rating"] is None


@pytest.mark.parametrize("rating", [1, 5])
def test_a_rating_can_be_set_and_cleared(world, rating):
    prospect = csv_add(world, [{"url": "https://fresh.example/"}]).get_json()["added"][0]
    assert world.client.patch(f"/api/prospects/{prospect['id']}", json={"rating": rating}).status_code == 200
    assert gaps.list_prospects(world.engine, world.own)[0]["rating"] == rating
    assert world.client.patch(f"/api/prospects/{prospect['id']}", json={"rating": None}).status_code == 200
    assert gaps.list_prospects(world.engine, world.own)[0]["rating"] is None


def test_changing_the_status_leaves_the_rating_alone(world):
    prospect = csv_add(world, [{"url": "https://fresh.example/", "rating": 3}]).get_json()["added"][0]
    assert world.client.patch(f"/api/prospects/{prospect['id']}", json={"stage": "agreed"}).status_code == 200
    assert gaps.list_prospects(world.engine, world.own)[0]["rating"] == 3


@pytest.mark.parametrize("rating", [0, 6, 2.5, "4", True])
def test_a_rating_outside_one_to_five_is_refused(world, rating):
    prospect = csv_add(world, [{"url": "https://fresh.example/"}]).get_json()["added"][0]
    assert world.client.patch(f"/api/prospects/{prospect['id']}", json={"rating": rating}).status_code == 400
    assert csv_add(world, [{"url": "https://other.example/", "rating": rating}]).status_code == 400


def test_a_placed_link_keeps_pa_and_rating(world):
    csv_add(world, [{"url": "https://fresh.example/page", "authority": 40, "page_authority": 22, "rating": 5}])
    saved = post(world, [{"site_id": world.own, "source_url": "https://fresh.example/live"}]).get_json()["saved"][0]
    listed = world.client.get(f"/api/backlinks?site_id={world.own}").get_json()["backlinks"]
    row = next(b for b in listed if b["id"] == saved["id"])
    assert (row["authority"], row["page_authority"], row["rating"]) == (40, 22, 5)


def test_two_spellings_of_a_mediator_are_one_person_with_all_their_links(world):
    from seo.backlinks import mediators

    with world.engine.begin() as conn:
        for number, name in enumerate(("John Smith", "john  smith")):
            conn.execute(
                text("INSERT INTO backlinks (site_id, source_url, domain, status, mediator) VALUES (:s, :u, 'blog.example', 'live', :m)"),
                {"s": world.own, "u": f"https://blog.example/{number}", "m": name},
            )
        mediators.ensure_from_rows(conn, [{"mediator": "John Smith"}, {"mediator": "john  smith"}])
    listed_people = mediators.list_all(world.engine)
    assert [(person["name"], person["links"]) for person in listed_people] == [("John Smith", 2)]
