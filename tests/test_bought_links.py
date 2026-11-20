"""Bought links (seo/backlinks/bought.py), Boost URL (seo/backlinks/boosts.py), the billed price and the overall budget.
Made-up sites only."""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.backlinks import boosts, bought, protect, service
from seo.collectors.common import digest
from seo.core.errors import Refused
from seo.links import service as links
from seo.serp import store
from seo.web import create_app

ME = "me.example"
ALLOW = lambda url: True  # noqa: E731


@pytest.fixture
def site(engine):
    return links.add_site(engine, f"https://{ME}/", "own", is_allowed=ALLOW)["id"]


def gsc(engine, site, query, start, days, position, impressions=5):
    with engine.begin() as conn:
        for n in range(days):
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :q, 0, :i, :p)"),
                         {"s": site, "d": start + timedelta(days=n), "h": digest(query), "q": query, "i": impressions, "p": position})


def final_through(engine, site, day):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through) VALUES (:s, 'gsc', :d) ON DUPLICATE KEY UPDATE data_through = :d"), {"s": site, "d": day})


def save(engine, site, **row):
    return service.save_many(engine, [{"site_id": site, "source_url": f"https://{row.pop('domain', 'blog.example')}/post", **row}])


def test_billed_price_is_saved_beside_the_real_cost(engine, site):
    save(engine, site, price_text="870 €", billed_text="1 131 €", keyword="sofa repair", placed="2026-09-01")
    with engine.connect() as conn:
        got = conn.execute(text("SELECT price_text, cost, billed_text, billed FROM backlinks WHERE site_id = :s"), {"s": site}).mappings().one()
    assert (got["price_text"], float(got["cost"]), got["billed_text"], float(got["billed"])) == ("870 €", 870.0, "1 131 €", 1131.0)


def test_cards_group_by_keyword_with_both_prices_and_never_found_links(engine, site):
    save(engine, site, domain="a.example", keyword="Sofa repair", placed="2026-09-01", price_text="100 €", billed_text="150 €")
    save(engine, site, domain="b.example", keyword="sofa repair", placed="2026-09-20", price_text="200 €", status="planned")
    save(engine, site, domain="c.example", keyword="chairs", placed="2026-09-05", billed_text="40 €")
    with engine.begin() as conn:
        conn.execute(text("UPDATE backlinks SET status = 'found' WHERE domain = 'c.example'"))  # seen by a tool, never bought
    answer = bought.bought(engine, site)
    assert [c["keyword"].casefold() for c in answer["cards"]] == ["sofa repair"]
    [card] = answer["cards"]
    assert (card["count"], card["billed"], card["cost"]) == (2, 150.0, 300.0)
    assert answer["totals"] == {"links": 2, "billed": 150.0, "cost": 300.0} and answer["currency"] == "EUR"


def test_position_before_and_after_each_link_from_search_console(engine, site):
    placed = date(2026, 9, 1)
    gsc(engine, site, "sofa repair", placed - timedelta(days=28), 28, 14)
    gsc(engine, site, "sofa repair", placed, 28, 4)
    save(engine, site, domain="a.example", keyword="sofa repair", placed=str(placed))
    save(engine, site, domain="b.example", keyword="sofa repair", placed="2026-11-10")  # its 28 days after aren't final yet
    save(engine, site, domain="c.example", keyword="sofa repair", placed="in September")  # no real date
    final_through(engine, site, date(2026, 11, 17))
    links_by = {x["domain"]: x["effect"] for x in bought.bought(engine, site)["cards"][0]["links"]}
    assert links_by["a.example"]["state"] == "ok" and (links_by["a.example"]["before"], links_by["a.example"]["after"]) == (14.0, 4.0)
    assert links_by["b.example"]["state"] == "waiting" and links_by["b.example"]["ready_on"] > "2026-12-07"
    assert links_by["c.example"] == {"state": "no_date"}


def test_too_few_impressions_is_not_a_number(engine, site):
    placed = date(2026, 9, 1)
    gsc(engine, site, "sofa repair", placed - timedelta(days=3), 3, 14, impressions=1)
    gsc(engine, site, "sofa repair", placed, 3, 4, impressions=1)
    gsc(engine, site, "chairs", date(2026, 11, 17), 1, 9)  # Search Console's data runs to 17 Nov
    save(engine, site, keyword="sofa repair", placed=str(placed))
    final_through(engine, site, date(2026, 11, 17))
    assert bought.bought(engine, site)["cards"][0]["links"][0]["effect"]["state"] == "few"


def test_overall_budget_sits_beside_the_monthly_one(engine, site):
    assert protect.set_budget(engine, site, {"amount": 500, "currency": "EUR", "total": "22500"}) == {"amount": 500.0, "currency": "EUR", "total": 22500.0}
    assert protect.get_budget(engine, site)["total"] == 22500.0
    assert protect.set_budget(engine, site, {"amount": 500, "currency": "EUR"})["total"] is None
    with pytest.raises(Refused):
        protect.set_budget(engine, site, {"amount": 500, "currency": "EUR", "total": "lots"})


def test_boost_is_checked_saved_and_shows_what_it_did(engine, site):
    with pytest.raises(Refused):
        boosts.add(engine, {"site_id": site, "url": "https://other.example/x", "started": "2026-10-05"})  # not my site
    with pytest.raises(Refused):
        boosts.add(engine, {"site_id": site, "url": f"https://{ME}/x", "started": "2026-10-05", "ended": "2026-10-01"})
    with engine.begin() as conn:
        for n, sessions in ((-3, 1), (-2, 1), (-1, 2), (0, 9), (1, 9), (2, 10)):
            conn.execute(text("INSERT INTO ga4_page_daily (site_id, day, page_hash, path, sessions, users, key_events) VALUES (:s, :d, :h, '/x/', :n, :n, 0)"),
                         {"s": site, "d": date(2026, 10, 5) + timedelta(days=n), "h": digest("/x/"), "n": sessions})
    made = boosts.add(engine, {"site_id": site, "url": f"https://www.{ME}/x", "keywords": "sofa repair, Sofa repair\nchairs", "started": "2026-10-05", "ended": "2026-10-07",
                               "source": "social", "billed_text": "300 €", "cost_text": "200 €"}, "Sam")
    assert made["keywords"] == ["sofa repair", "chairs"] and made["billed"] == 300.0 and made["cost"] == 200.0 and made["created_by"] == "Sam"
    assert made["result"]["visits"] == {"during": 28, "before": 4, "days": 3, "through": "2026-10-07"}
    assert [p["keyword"] for p in made["result"]["positions"]] == ["sofa repair", "chairs"]
    edited = boosts.update(engine, made["id"], {"site_id": site, "url": f"https://{ME}/x", "started": "2026-10-05", "keywords": []})
    assert edited["ended"] is None and edited["result"]["running"]
    boosts.delete(engine, made["id"])
    assert boosts.listing(engine, site)["boosts"] == []


def test_a_boost_is_a_band_on_its_keyword_chart(engine, site):
    from seo.metrics import keyword_timeline

    with engine.begin() as conn:
        conn.execute(text("INSERT INTO keywords (keyword, keyword_hash, country, language) VALUES ('sofa repair', :h, 'FR', 'fr')"), {"h": store.keyword_hash("sofa repair")})
        kid = conn.execute(text("SELECT id FROM keywords WHERE keyword_hash = :h"), {"h": store.keyword_hash("sofa repair")}).scalar_one()
        conn.execute(text("INSERT INTO site_keywords (site_id, keyword_id) VALUES (:s, :k)"), {"s": site, "k": kid})
    boosts.add(engine, {"site_id": site, "url": f"https://{ME}/x", "keywords": ["sofa repair"], "started": "2026-10-05", "ended": "2026-10-07"})
    boosts.add(engine, {"site_id": site, "url": f"https://{ME}/y", "keywords": ["chairs"], "started": "2026-10-05"})  # another keyword's page
    bands = keyword_timeline.timeline(engine, site, kid, date(2026, 8, 20), date(2026, 11, 17))["bands"]
    assert [(b["kind"], b["day"], b["end"]) for b in bands] == [("boost", "2026-10-05", "2026-10-07")]


def test_routes(engine, site):
    client = create_app(engine=engine, url_allowed=ALLOW, auth=False).test_client()
    assert client.get(f"/api/backlinks/bought?site_id={site}").status_code == 200
    made = client.post("/api/backlinks/boosts", json={"site_id": site, "url": f"https://{ME}/x", "started": "2026-10-05"})
    assert made.status_code == 201
    boost_id = made.get_json()["id"]
    assert client.put(f"/api/backlinks/boosts/{boost_id}", json={"site_id": site, "url": f"https://{ME}/x", "started": "bad"}).status_code == 400
    assert client.get(f"/api/backlinks/boosts?site_id={site}").get_json()["boosts"][0]["id"] == boost_id
    assert client.delete(f"/api/backlinks/boosts/{boost_id}").status_code == 200
    assert client.delete(f"/api/backlinks/boosts/{boost_id}").status_code == 404
