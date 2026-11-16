"""Each request's time is written to the timings log and sent as Server-Timing (2026-11-16, "the app is very slow")."""
from seo.web import create_app, timings


def test_a_request_gets_its_line_and_its_header(engine, tmp_path, monkeypatch):
    log = tmp_path / "logs" / "timings.log"
    monkeypatch.setattr(timings, "LOG", log)
    monkeypatch.setattr(timings, "on", lambda: True)
    client = create_app(engine=engine, auth=False).test_client()
    create_app(engine=engine, auth=False)  # a second app on the same engine must not count queries twice
    reply = client.get("/api/tasks?site_id=1")
    assert reply.status_code == 200
    header = reply.headers["Server-Timing"]
    assert header.startswith("app;dur=") and "db;dur=" in header
    when, method, path, status, total, db, queries, size = log.read_text().strip().split("\t")
    assert (method, path, status) == ("GET", "/api/tasks?site_id=1", "200")
    assert int(total) >= int(db) >= 0 and int(queries) >= 1 and size == str(len(reply.data))
    assert f'"{queries} queries"' in header


def test_nothing_is_written_when_it_is_off(engine, tmp_path, monkeypatch):
    log = tmp_path / "timings.log"
    monkeypatch.setattr(timings, "LOG", log)
    client = create_app(engine=engine, auth=False).test_client()
    assert "Server-Timing" in client.get("/api/tasks").headers and not log.exists()  # on() is off under pytest
