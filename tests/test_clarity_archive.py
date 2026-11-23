"""The old Clarity archive: a counts-only file made on the Mac, then uploaded once into the app."""
import hashlib
import io
import json
import sqlite3
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from seo.accounts import service as accounts
from seo.core.errors import Refused
from seo.imports import clarity_archive as archive
from seo.metrics import service as metrics
from seo.web import create_app

PASSWORD = "correct horse battery"


def _fact(db, site, day, slice_key, metric, measure, value, dim="{}", source="api"):
    db.execute(
        "INSERT INTO daily_fact (site_id, logical_date, slice_key, dim_hash, metric, measure, value, dim_json, source, derivation, confidence, truncated, import_id, derived_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'direct', 1.0, 0, 1, '2026-08-10')",
        (site, day, slice_key, hashlib.sha256(dim.encode()).hexdigest(), metric, measure, value, dim, source),
    )


@pytest.fixture
def old_db(tmp_path):
    """The real archive's tables, with secrets and personal details in the places the real one has them."""
    path = tmp_path / "clarity.db"
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE site (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, url TEXT, api_token_enc TEXT);
        CREATE TABLE day_coverage (site_id INT, logical_date TEXT, status TEXT, sources TEXT, slices_covered INT, slices_expected INT, first_observed_at TEXT, note TEXT);
        CREATE TABLE daily_fact (site_id INT, logical_date TEXT, slice_key TEXT, dim_hash TEXT, metric TEXT, measure TEXT, value REAL, dim_json TEXT, source TEXT, derivation TEXT, confidence REAL, truncated INT, import_id INT, derived_at TEXT);
        CREATE TABLE session_row (id INTEGER PRIMARY KEY, site_id INT, clarity_session_id TEXT, clarity_user_id TEXT, recording_link TEXT, logical_date TEXT);
        """
    )
    db.execute("INSERT INTO site VALUES (1, 'mine', 'Mine', 'https://www.Mine.example', 'SECRET-TOKEN-VALUE')")
    db.execute("INSERT INTO site VALUES (2, 'other', 'Other', 'https://other.example', NULL)")
    db.execute("INSERT INTO session_row VALUES (1, 1, 'SESSION-ID-VALUE', 'USER-ID-VALUE', 'https://clarity.ms/RECORDING-LINK', '2026-07-02')")
    # A day from the recordings export: sessions and referrers, nothing else.
    db.execute("INSERT INTO day_coverage VALUES (1, '2026-07-02', 'partial', 'csv_recordings', 6, 7, '', 'session-level rollup; no scroll depth or frustration metrics')")
    _fact(db, 1, "2026-07-02", "totals", "session_rollup", "sessions", 18, source="csv_recordings")
    _fact(db, 1, "2026-07-02", "totals", "session_rollup", "clicks", 47, source="csv_recordings")
    _fact(db, 1, "2026-07-02", "referrer_host", "session_rollup", "sessions", 4, '{"Referrer": "google.com"}', "csv_recordings")
    _fact(db, 1, "2026-07-02", "referrer_host", "session_rollup", "sessions", 9, '{"Referrer": "(direct)"}', "csv_recordings")
    _fact(db, 1, "2026-07-02", "url", "session_rollup", "sessions", 5, '{"URL": "/private-page/"}', "csv_recordings")
    # The edge of the export window: only part of the day.
    db.execute("INSERT INTO day_coverage VALUES (1, '2026-08-01', 'clipped', 'csv_recordings', 6, 7, '', 'export window boundary')")
    _fact(db, 1, "2026-08-01", "totals", "session_rollup", "sessions", 3, source="csv_recordings")
    # A day from the API, with everything.
    db.execute("INSERT INTO day_coverage VALUES (1, '2026-08-09', 'complete', 'api', 7, 7, '', 'collected from the Data Export API')")
    _fact(db, 1, "2026-08-09", "totals", "traffic", "sessions", 513)
    _fact(db, 1, "2026-08-09", "totals", "scroll_depth", "scroll_depth_pct", 68.16)
    _fact(db, 1, "2026-08-09", "totals", "rage_clicks", "metric_events", 1)
    _fact(db, 1, "2026-08-09", "totals", "rage_clicks", "sessions_with_metric", 477)
    _fact(db, 1, "2026-08-09", "totals", "dead_clicks", "metric_events", 2)
    _fact(db, 1, "2026-08-09", "totals", "dead_clicks", "sessions_with_metric", 477)
    _fact(db, 1, "2026-08-09", "source_medium", "traffic", "sessions", 434, '{"Medium": "", "Source": ""}')
    _fact(db, 1, "2026-08-09", "source_medium", "traffic", "sessions", 6, '{"Medium": "organic", "Source": "google"}')
    _fact(db, 1, "2026-08-09", "source_medium", "traffic", "sessions", 2, '{"Medium": "cpc", "Source": "google"}')
    db.execute("INSERT INTO day_coverage VALUES (2, '2026-08-09', 'partial', 'api', 2, 7, '', 'collected from the Data Export API')")
    _fact(db, 2, "2026-08-09", "totals", "traffic", "sessions", 0)
    db.commit()
    db.close()
    return path


def _day(export, host, day):
    site = next(s for s in export["sites"] if s["host"] == host)
    return next(d for d in site["days"] if d["day"] == day)


# ---- making the file, on the Mac ------------------------------------------------------------------
def test_a_recordings_day_keeps_unknown_numbers_unknown(old_db):
    row = _day(archive.read_archive(old_db), "mine.example", "2026-07-02")
    assert row["sessions"] == 18
    assert row["scroll_depth"] is None and row["rage_clicks"] is None and row["dead_clicks"] is None
    assert row["status"] == "partial"
    assert {"source": "google.com", "sessions": 4} in row["referrers"]
    assert {"source": "(direct)", "sessions": 9} in row["referrers"]


def test_an_api_day_reads_the_same_fields_the_live_collector_reads(old_db):
    row = _day(archive.read_archive(old_db), "mine.example", "2026-08-09")
    assert row["sessions"] == 513 and row["scroll_depth"] == 68.16
    assert row["rage_clicks"] == 1 and row["dead_clicks"] == 2, "events, not sessions_with_metric"
    assert row["status"] == "ok"
    assert row["referrers"] == [{"source": "google", "sessions": 8}], "summed by source, and a blank source dropped, as the collector does"


def test_a_day_at_the_edge_of_the_export_says_it_is_only_part_of_a_day(old_db):
    row = _day(archive.read_archive(old_db), "mine.example", "2026-08-01")
    assert row["status"] == "partial" and "part of" in row["note"].lower()


def test_the_file_holds_counts_only(old_db):
    dumped = json.dumps(archive.read_archive(old_db))
    for private in ("SECRET-TOKEN-VALUE", "SESSION-ID-VALUE", "USER-ID-VALUE", "RECORDING-LINK", "/private-page/"):
        assert private not in dumped


def test_reading_never_changes_the_old_database(old_db):
    before = old_db.read_bytes()
    archive.read_archive(old_db)
    assert old_db.read_bytes() == before


def test_something_else_is_not_read_as_an_archive(tmp_path):
    other = tmp_path / "other.db"
    sqlite3.connect(other).close()
    with pytest.raises(Refused):
        archive.read_archive(other)
    with pytest.raises(Refused):
        archive.read_archive(tmp_path / "missing.db")


def test_the_export_script_writes_a_file_the_app_accepts(engine, site, old_db, tmp_path, capsys):
    from scripts import clarity_archive_export

    out = tmp_path / "clarity-archive.json"
    assert clarity_archive_export.main(["--db", str(old_db), "--out", str(out)]) == 0
    assert "mine.example: 3 days" in capsys.readouterr().out
    result = archive.import_archive(engine, json.loads(out.read_text(encoding="utf-8")))
    assert result["sites"][0]["added"] == 3


# ---- loading the file, in the app -----------------------------------------------------------------
@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid


def _rows(engine):
    with engine.connect() as conn:
        return {r["day"].isoformat(): dict(r) for r in conn.execute(text("SELECT * FROM clarity_daily")).mappings()}


def test_days_go_in_with_their_coverage(engine, site, old_db):
    result = archive.import_archive(engine, archive.read_archive(old_db))
    rows = _rows(engine)  # under the day of the read that covers each visit day: one day on
    assert rows["2026-08-10"]["sessions"] == 513 and rows["2026-08-10"]["rage_clicks"] == 1
    assert rows["2026-07-03"]["sessions"] == 18 and rows["2026-07-03"]["rage_clicks"] is None and rows["2026-07-03"]["scroll_depth"] is None
    assert result["sites"][0] == {"host": "mine.example", "added": 3, "kept": 0, "first_day": "2026-07-02", "last_day": "2026-08-09"}, "the summary names the visit days"
    with engine.connect() as conn:
        status = dict(conn.execute(text("SELECT day, status FROM coverage WHERE source = 'clarity'")).all())
    assert status[date(2026, 8, 10)] == "ok" and status[date(2026, 7, 3)] == "partial"


def test_a_site_not_in_the_app_is_named_and_never_created(engine, site, old_db):
    result = archive.import_archive(engine, archive.read_archive(old_db))
    assert result["missing_sites"] == [{"host": "other.example", "days": 1}]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM sites")).scalar() == 1


def test_a_competitor_is_never_given_my_clarity_data(engine, old_db):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'competitor')"))
    result = archive.import_archive(engine, archive.read_archive(old_db))
    assert _rows(engine) == {}
    assert {"host": "mine.example", "days": 3} in result["missing_sites"]


def test_uploading_twice_changes_nothing(engine, site, old_db):
    export = archive.read_archive(old_db)
    archive.import_archive(engine, export)
    first = _rows(engine)
    result = archive.import_archive(engine, export)
    assert result["sites"][0]["added"] == 0 and result["sites"][0]["kept"] == 3
    assert _rows(engine) == first


def test_a_day_the_app_collected_itself_is_never_replaced(engine, site, old_db):
    with engine.begin() as conn:  # the app's read of 10 Aug covers 9 Aug
        conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions) VALUES (:s, '2026-08-10', 999)"), {"s": site})
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status, `rows`) VALUES (:s, 'clarity', '2026-08-10', 'ok', 1)"), {"s": site})
    result = archive.import_archive(engine, archive.read_archive(old_db))
    assert _rows(engine)["2026-08-10"]["sessions"] == 999
    assert result["sites"][0]["kept"] == 1 and result["sites"][0]["added"] == 2


def test_a_preview_writes_nothing_and_gives_the_same_counts(engine, site, old_db):
    export = archive.read_archive(old_db)
    preview = archive.import_archive(engine, export, preview=True)
    assert preview["sites"][0]["added"] == 3 and preview["preview"] is True
    assert _rows(engine) == {}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM coverage")).scalar() == 0


def test_old_data_does_not_pretend_clarity_is_connected(engine, site, old_db):
    """Today's "Clarity data lost in N h" and Settings read this row: an upload is not a pull."""
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source) VALUES (:s, 'clarity')"), {"s": site})
    archive.import_archive(engine, archive.read_archive(old_db))
    with engine.connect() as conn:
        row = conn.execute(text("SELECT last_ok_at, data_through, secret FROM site_sources")).mappings().one()
    assert row["last_ok_at"] is None and row["data_through"] is None and row["secret"] is None


GOOD_DAY = {"day": "2026-07-02", "sessions": 1, "scroll_depth": None, "rage_clicks": None, "dead_clicks": None, "referrers": [], "status": "partial", "note": "x"}


@pytest.mark.parametrize(
    "bad",
    [
        {"day": "2026-13-40"},
        {"day": "not a day"},
        {"day": (date.today() + timedelta(days=3)).isoformat()},
        {"sessions": -1},
        {"sessions": "12"},
        {"sessions": True},
        {"scroll_depth": 101},
        {"rage_clicks": -2},
        {"status": "great"},
        {"note": 5},
        {"referrers": "google"},
        {"referrers": [{"source": 5, "sessions": 1}]},
        {"referrers": [{"source": "a", "sessions": -1}]},
    ],
)
def test_a_bad_day_refuses_the_whole_file(engine, site, bad):
    good = {**GOOD_DAY, "day": "2026-07-01"}
    file = {"format": archive.FORMAT, "version": 1, "sites": [{"host": "mine.example", "days": [good, {**GOOD_DAY, **bad}]}]}
    with pytest.raises(Refused):
        archive.import_archive(engine, file)
    assert _rows(engine) == {}, "the good day before it must not stay behind"


@pytest.mark.parametrize("bad", [None, [], {"format": "other", "version": 1, "sites": []}, {"format": archive.FORMAT, "version": 99, "sites": []}, {"format": archive.FORMAT, "version": 1, "sites": "x"}, {"format": archive.FORMAT, "version": 1, "sites": [{"host": 5, "days": []}]}])
def test_a_file_that_is_not_this_format_is_refused(engine, bad):
    with pytest.raises(Refused):
        archive.import_archive(engine, bad)


# ---- what the screens read ------------------------------------------------------------------------
def _clarity(engine, site, start="2026-07-01", end="2026-08-31"):
    return metrics.clarity(metrics.Scope(engine, site, start, end))


def test_unknown_clicks_are_not_shown_as_zero(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions) VALUES (:s, '2026-07-03', 18)"), {"s": site})
    answer = _clarity(engine, site)
    assert answer["sessions"] == 18
    assert answer["rage_clicks"] is None and answer["dead_clicks"] is None and answer["scroll_depth"] is None
    assert answer["sessions_only_days"] == 1


def test_a_period_with_both_kinds_of_day_counts_only_what_is_known(engine, site, old_db):
    archive.import_archive(engine, archive.read_archive(old_db))
    answer = _clarity(engine, site)
    assert answer["sessions"] == 534 and answer["rage_clicks"] == 1 and answer["dead_clicks"] == 2
    assert answer["scroll_depth"] == 68.2, "weighted only by days that have a scroll depth"
    assert answer["days"] == 3 and answer["sessions_only_days"] == 2


def test_an_old_day_counts_on_its_own_visit_day_not_the_day_before(engine, site, old_db):
    """The file's days are the visits' days: the old project dated a recordings session by its start and an API pull by
    the middle of its 24 hours. The app's read on D covers D-1 (W10), so a file day must not be moved back a day."""
    archive.import_archive(engine, archive.read_archive(old_db))
    assert _clarity(engine, site, "2026-08-09", "2026-08-09")["sessions"] == 513
    assert _clarity(engine, site, "2026-08-08", "2026-08-08") == {"has_data": False}
    july = _clarity(engine, site, "2026-07-02", "2026-07-02")
    assert july["sessions"] == 18 and july["through"] == "2026-07-02"
    assert _clarity(engine, site, "2026-07-01", "2026-07-31")["days"] == 1, "1 Aug is August's, not July's"


def test_an_old_day_and_the_apps_read_of_the_next_day_are_both_counted(engine, site, old_db):
    with engine.begin() as conn:  # the app's read of 11 Aug covers 10 Aug: a different visit day from the file's 9 Aug
        conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions, rage_clicks, dead_clicks) VALUES (:s, '2026-08-11', 40, 0, 0)"), {"s": site})
    result = archive.import_archive(engine, archive.read_archive(old_db))
    assert result["sites"][0]["added"] == 3
    answer = _clarity(engine, site, "2026-08-09", "2026-08-10")
    assert answer["sessions"] == 553 and answer["days"] == 2 and answer["through"] == "2026-08-10"


def test_old_days_already_uploaded_move_to_their_read_day_and_the_apps_reads_stay(engine, site):
    """The migration for rows uploaded before the fix: archive rows (no raw) move one day on; the app's reads never move."""
    import importlib.util
    from pathlib import Path

    path = next(Path(__file__).resolve().parent.parent.glob("migrations/versions/*_clarity_archive_read_day.py"))
    spec = importlib.util.spec_from_file_location("clarity_read_day", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as conn:
        for day, sessions in (("2026-07-01", 10), ("2026-07-02", 11), ("2026-08-09", 513)):  # uploaded the old way
            conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions) VALUES (:s, :d, :n)"), {"s": site, "d": day, "n": sessions})
            conn.execute(text("INSERT INTO coverage (site_id, source, day, status, `rows`) VALUES (:s, 'clarity', :d, 'partial', 1)"), {"s": site, "d": day})
        # The app's own read of 10 Aug, which covers 9 Aug: it wins over the old copy, as the importer decides.
        conn.execute(text("INSERT INTO clarity_daily (site_id, day, sessions, raw) VALUES (:s, '2026-08-10', 999, '[]')"), {"s": site})
        conn.execute(text("INSERT INTO coverage (site_id, source, day, status, `rows`) VALUES (:s, 'clarity', '2026-08-10', 'ok', 1)"), {"s": site})
        migration.move(conn, 1)
    assert {day: row["sessions"] for day, row in _rows(engine).items()} == {"2026-07-02": 10, "2026-07-03": 11, "2026-08-10": 999}
    with engine.connect() as conn:
        coverage = {r[0].isoformat(): r[1] for r in conn.execute(text("SELECT day, status FROM coverage WHERE source = 'clarity'"))}
    assert coverage == {"2026-07-02": "partial", "2026-07-03": "partial", "2026-08-10": "ok"}
    assert _clarity(engine, site, "2026-07-01", "2026-07-01")["sessions"] == 10, "1 July counts on 1 July"


# ---- the upload --------------------------------------------------------------------------------------
@pytest.fixture
def app(engine):
    return create_app(engine=engine, secret_key="test-secret-key")


def _signed_in(app, engine, role="admin", email="boss@example.com"):
    accounts.create_user(engine, email, "Boss", role, password=PASSWORD, must_change=False)
    client = app.test_client()
    reply = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    return client, {"X-CSRF-Token": reply.get_json()["csrf"]}


def _upload(client, headers, export, preview=False, name="clarity-archive.json"):
    data = {"file": (io.BytesIO(json.dumps(export).encode() if not isinstance(export, bytes) else export), name)}
    if preview:
        data["preview"] = "1"
    return client.post("/api/clarity-archive", data=data, headers=headers, content_type="multipart/form-data")


def test_an_admin_previews_then_imports(app, engine, site, old_db):
    client, headers = _signed_in(app, engine)
    export = archive.read_archive(old_db)
    assert _upload(client, headers, export, preview=True).get_json()["preview"] is True
    assert _rows(engine) == {}
    reply = _upload(client, headers, export)
    assert reply.status_code == 200 and reply.get_json()["sites"][0]["added"] == 3
    assert len(_rows(engine)) == 3


def test_a_member_cannot_import(app, engine, site, old_db):
    client, headers = _signed_in(app, engine, role="member", email="member@example.com")
    assert _upload(client, headers, archive.read_archive(old_db)).status_code == 403
    assert _rows(engine) == {}


def test_signed_out_and_no_token_are_refused(app, engine, site, old_db):
    export = archive.read_archive(old_db)
    assert _upload(app.test_client(), {}, export).status_code == 401
    client, _ = _signed_in(app, engine)
    assert _upload(client, {}, export).status_code == 403
    assert _rows(engine) == {}


def test_junk_and_oversized_files_get_a_plain_answer(app, engine, site):
    client, headers = _signed_in(app, engine)
    assert _upload(client, headers, b"not json at all").status_code == 400
    assert _upload(client, headers, b"\xff\xfe\x00").status_code == 400
    assert _upload(client, headers, {"format": archive.FORMAT, "version": 1, "sites": []}, name="old.csv").status_code == 400
    assert _upload(client, headers, b"x" * (archive.MAX_BYTES + 1)).status_code == 400
    assert client.post("/api/clarity-archive", data={}, headers=headers, content_type="multipart/form-data").status_code == 400
