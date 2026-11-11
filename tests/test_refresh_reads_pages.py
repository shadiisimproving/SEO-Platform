"""Refresh data also reads my own site's pages now, instead of waiting for the nightly read (owner, 2026-11-10)."""
from __future__ import annotations

from sqlalchemy import text

from seo.web import create_app


def _site(engine, host: str, kind: str) -> int:
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES (:h, :u, :k)"), {"h": host, "u": f"https://{host}/", "k": kind}).lastrowid


def _reads(engine, site_id: int) -> tuple[int, str | None]:
    with engine.connect() as conn:
        jobs = conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = 'competitors.crawl' AND JSON_EXTRACT(payload, '$.competitor_id') = :s"), {"s": site_id}).scalar()
        status = conn.execute(text("SELECT status FROM competitor_crawls WHERE competitor_id = :s"), {"s": site_id}).scalar()
    return int(jobs), status


def test_refresh_data_queues_a_read_of_my_sites_pages(engine):
    mine = _site(engine, "mine.example", "own")
    client = create_app(engine=engine, auth=False).test_client()
    answer = client.post(f"/api/sites/{mine}/collect", json={})
    assert answer.status_code == 202
    assert answer.get_json()["pages"] is True
    assert _reads(engine, mine) == (1, "queued")
    # Pressing it again while the read waits doesn't stack a second one.
    client.post(f"/api/sites/{mine}/collect", json={})
    assert _reads(engine, mine) == (1, "queued")


def test_refresh_this_one_stays_a_data_read_only(engine):
    mine = _site(engine, "mine.example", "own")
    client = create_app(engine=engine, auth=False).test_client()
    answer = client.post(f"/api/sites/{mine}/collect", json={"sources": ["ga4"]}).get_json()
    assert answer["pages"] is False
    assert _reads(engine, mine) == (0, None)


def test_a_competitor_is_not_read_by_refresh_data(engine):
    rival = _site(engine, "rival.example", "competitor")
    client = create_app(engine=engine, auth=False).test_client()
    assert client.post(f"/api/sites/{rival}/collect", json={}).get_json()["pages"] is False
    assert _reads(engine, rival) == (0, None)
