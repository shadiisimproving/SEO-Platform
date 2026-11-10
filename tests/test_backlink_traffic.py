"""Backlink numbers that must add up (F10, F11, F113), on the real test database with made-up GA4 and Search Console rows."""
from datetime import date, timedelta

from sqlalchemy import text

from seo.backlinks import service
from seo.metrics import backlink_traffic
from tests.test_metrics import D1, _campaign, _gsc, _link, _referral, site  # noqa: F401 - site is a fixture


def test_three_links_sharing_40_visits_carry_one_group_so_a_total_counts_40(engine, site):
    """F10: each row says 40 and "shared 3"; the screen's total summed them to 120."""
    ids = [_link(engine, site, source_url=f"https://blog.example/post-{n}") for n in range(3)]
    _referral(engine, site, D1, "blog.example", "/page/", 40, 2)
    found = backlink_traffic.for_backlink_list(engine, site)
    assert {found[i]["visits"] for i in ids} == {40} and {found[i]["shared"] for i in ids} == {3}
    groups = {found[i]["group"] for i in ids}
    assert len(groups) == 1
    total = sum(found[i]["visits"] for i in {found[i]["group"]: i for i in ids}.values())
    assert total == 40


def test_two_links_with_the_same_utm_say_they_share_it(engine, site):
    a = _link(engine, site, source_url="https://blog.example/a", utm_source="blog", utm_medium="backlink", utm_campaign="same")
    b = _link(engine, site, source_url="https://news.example/b", domain="news.example", utm_source="blog", utm_medium="backlink", utm_campaign="same")
    alone = _link(engine, site, source_url="https://other.example/c", domain="other.example", utm_source="x", utm_medium="y", utm_campaign="own")
    _campaign(engine, site, D1, "blog", "backlink", "same", "/page/", 10, 1)
    found = backlink_traffic.for_backlink_list(engine, site)
    assert found[a]["shared"] == 2 and found[a]["group"] == found[b]["group"] and found[a]["label"] == "shared"
    assert found[alone] == {"visits": 0, "leads": 0, "label": "utm", "shared": None}


def test_before_and_after_waits_until_the_after_days_are_final(engine, site):
    """F11: a link placed 10 days ago on a steady page read -71% (28 days against 8)."""
    with engine.connect() as conn:
        today = conn.execute(text("SELECT UTC_DATE()")).scalar()
    placed = today - timedelta(days=10)
    link = _link(engine, site, placed=placed.isoformat())
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET data_through = :d WHERE site_id = :s AND source = 'gsc'"), {"d": today - timedelta(days=2), "s": site})
        for back in range(40):
            day = today - timedelta(days=back + 2)
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'h', 'https://mine.example/page', 10, 100, 5)"), {"s": site, "d": day})
            _gsc(engine, site, day, 10, 100, 5)
    answer = backlink_traffic.before_after(engine, link)
    assert answer["state"] == "waiting"
    assert answer["ready_on"] == (placed + timedelta(days=27) + timedelta(days=2)).isoformat()


def test_before_and_after_once_complete_compares_like_with_like(engine, site):
    placed = date(2026, 9, 1)
    link = _link(engine, site, placed=placed.isoformat())
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET data_through = '2026-11-01' WHERE site_id = :s AND source = 'gsc'"), {"s": site})
        for back in range(-28, 28):
            day = placed + timedelta(days=back)
            conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, 'h', 'https://mine.example/page', 10, 100, 5)"), {"s": site, "d": day})
    answer = backlink_traffic.before_after(engine, link)
    assert answer["state"] == "ok" and answer["before"]["clicks"] == answer["after"]["clicks"] == 280 and answer["page_change"] == 0


def test_an_edit_keeps_the_measured_fields(engine, site, monkeypatch):
    """F113: saving a typo fix answered the bare row, so visits, leads and index marks went blank on screen."""
    monkeypatch.setattr(service.logos, "queue_for", lambda engine, domains: None)
    backlink_traffic.install()
    link = _link(engine, site)
    _referral(engine, site, D1, "blog.example", "/page/", 12, 1)
    listed = next(b for b in service.list_for_site(engine, site) if b["id"] == link)
    saved = service.update_one(engine, link, {"site_id": site, "source_url": "https://blog.example/post", "target_url": "https://mine.example/page", "status": "live", "notes": "fixed a typo"})["saved"]
    assert saved["notes"] == "fixed a typo"
    for field in ("visits", "leads", "traffic_label", "target_index", "source_index", "anchor_auto", "opr"):
        assert saved.get(field) == listed.get(field), field
    assert saved["visits"] == 12
