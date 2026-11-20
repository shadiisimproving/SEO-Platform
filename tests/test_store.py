"""Saving crawl results: a version and events only when something really changed."""
import gzip

from sqlalchemy import text

from seo.crawl import store
from seo.crawl.extract import extract
from seo.crawl.fetch import FetchResult

URL = "https://www.example.com/page/"


def page(title="Titre", body="Texte de la page", h1="Un titre"):
    html = f"<html><head><title>{title}</title></head><body><main><h1>{h1}</h1><p>{body}</p></main></body></html>"
    return extract(html.encode(), URL)


def ok(etag='"a"'):
    return FetchResult(url=URL, status="ok", http_status=200, etag=etag, seconds=0.1, bytes=10)


def setup_domain(engine):
    return store.get_or_create_domain(engine, "www.example.com")


def rows(engine, table):
    with engine.connect() as conn:
        return conn.execute(text(f"SELECT * FROM {table}")).mappings().all()


def test_get_or_create_domain_returns_the_same_id(engine):
    assert setup_domain(engine) == setup_domain(engine)
    assert len(rows(engine, "domains")) == 1


def test_first_sight_saves_a_baseline_version_and_no_change_events(engine):
    domain = setup_domain(engine)
    result = store.save_fetch(engine, domain, URL, ok(), page())
    assert result == "baseline"
    assert len(rows(engine, "pages")) == 1
    assert len(rows(engine, "page_versions")) == 1
    assert rows(engine, "change_events") == []


def test_same_page_again_saves_nothing_new_but_updates_last_checked(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page())
    with engine.begin() as conn:
        conn.execute(text("UPDATE pages SET last_checked_at = '2020-01-01'"))
    assert store.save_fetch(engine, domain, URL, ok(), page()) == "unchanged"
    assert len(rows(engine, "page_versions")) == 1
    assert rows(engine, "pages")[0]["last_checked_at"].year > 2020


def test_title_change_records_before_and_after(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page(title="Ancien"))
    assert store.save_fetch(engine, domain, URL, ok(), page(title="Nouveau")) == "changed"
    events = rows(engine, "change_events")
    assert [e["kind"] for e in events] == ["title"]
    assert events[0]["before_value"] == "Ancien"
    assert events[0]["after_value"] == "Nouveau"
    assert len(rows(engine, "page_versions")) == 2


def test_text_change_records_a_content_event_and_keeps_the_text(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page(body="Prix 1000"))
    store.save_fetch(engine, domain, URL, ok(), page(body="Prix 2000"))
    assert [e["kind"] for e in rows(engine, "change_events")] == ["content"]
    versions = rows(engine, "page_versions")
    assert "Prix 1000" in gzip.decompress(versions[0]["text_gz"]).decode()
    assert "Prix 2000" in gzip.decompress(versions[1]["text_gz"]).decode()


def test_several_changes_give_one_event_each(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page(title="A", h1="B", body="C"))
    store.save_fetch(engine, domain, URL, ok(), page(title="X", h1="Y", body="Z"))
    assert sorted(e["kind"] for e in rows(engine, "change_events")) == ["content", "h1", "title"]


def test_304_only_updates_last_checked(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page())
    result = FetchResult(url=URL, status="not_modified", http_status=304, seconds=0.1, bytes=0)
    assert store.save_fetch(engine, domain, URL, result, None) == "not_modified"
    assert len(rows(engine, "page_versions")) == 1


def test_validators_are_returned_for_the_next_request(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(etag='"v9"'), page())
    assert store.validators(engine, URL) == ('"v9"', None)


def test_unknown_page_has_no_validators(engine):
    assert store.validators(engine, URL) == (None, None)


def test_blocked_fetch_keeps_the_last_good_data(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page(title="Bon"))
    blocked = FetchResult(url=URL, status="blocked", http_status=403, seconds=0.1, bytes=0)
    assert store.save_fetch(engine, domain, URL, blocked, None) == "blocked"
    row = rows(engine, "pages")[0]
    assert row["title"] == "Bon"
    assert row["last_status"] == "blocked"


def test_long_url_is_stored_by_its_hash(engine):
    domain = setup_domain(engine)
    long_url = URL + "x" * 1500
    store.save_fetch(engine, domain, long_url, ok(), page())
    assert rows(engine, "pages")[0]["url"] == long_url


def test_arabic_is_stored_intact(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page(title="تأسيس شركة"))
    assert rows(engine, "pages")[0]["title"] == "تأسيس شركة"


def test_very_long_title_is_cut_not_rejected(engine):
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, ok(), page(title="x" * 5000))
    assert len(rows(engine, "pages")[0]["title"]) <= 1000


def test_a_first_reading_is_no_edit_and_leaves_no_last_changed_date(engine):
    """"Updated, 12 months" read 100% because the first reading stamped last_changed_at (SEO review 2026-11-17, #11)."""
    domain = setup_domain(engine)
    store.save_fetch(engine, domain, URL, FetchResult(url=URL, status="robots", http_status=None, etag=None, seconds=0.1, bytes=0), None)  # a page known before it's read
    assert store.save_fetch(engine, domain, URL, ok(), page()) == "baseline"
    assert rows(engine, "pages")[0]["last_changed_at"] is None
    assert store.save_fetch(engine, domain, URL, ok(), page(title="Nouveau")) == "changed"
    assert rows(engine, "pages")[0]["last_changed_at"] is not None
