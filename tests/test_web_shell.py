"""The app's shell (2026-11-10, agent C): static files kept by the browser until a deploy changes them, the API never kept,
one plain sentence for every API error, and a real page for a wrong address."""
from pathlib import Path

import pytest

from seo.web import create_app

SCREENS = Path(__file__).resolve().parent.parent / "design" / "mockups"


@pytest.fixture
def client(engine):
    app = create_app(engine=engine, screens_dir=SCREENS, auth=False)

    @app.get("/api/test-boom")
    def boom():  # stands in for any route that breaks on odd input (F166)
        raise ValueError("a programmer's words, never shown")

    return app.test_client()


def test_the_page_names_each_script_with_its_version_and_is_never_kept(client):
    reply = client.get("/")
    html = reply.get_data(as_text=True)
    assert reply.headers["Cache-Control"] == "no-store"
    assert 'src="mockup.js?v=' in html and 'href="mockup.css?v=' in html
    assert 'src="shared-ui.js?v=' in html


def test_a_versioned_file_is_kept_and_a_bare_one_is_checked(client):
    kept = client.get("/mockup.js?v=abc")
    assert kept.status_code == 200 and "immutable" in kept.headers["Cache-Control"]
    bare = client.get("/mockup.js")
    assert bare.headers["Cache-Control"] == "no-cache" and bare.headers.get("ETag")


def test_the_api_is_never_kept(client):
    reply = client.get("/api/tasks")
    assert reply.headers["Cache-Control"] == "no-store"


def test_a_wrong_address_shows_a_page_with_a_way_home(client):
    reply = client.get("/no-such-page")
    html = reply.get_data(as_text=True)
    assert reply.status_code == 404 and reply.mimetype == "text/html"
    assert "This page doesn't exist" in html and 'id="home"' in html and "Aller à Aujourd'hui" in html
    assert reply.headers["Cache-Control"] == "no-store"


def test_a_wrong_api_address_answers_json_in_words(client):
    reply = client.get("/api/no-such-thing")
    assert reply.status_code == 404 and reply.get_json() == {"error": "That address isn't part of the app."}
    wrong_method = client.delete("/api/tasks")
    assert wrong_method.status_code == 405 and "error" in wrong_method.get_json()


def test_a_broken_route_answers_a_sentence_not_a_trace(client):
    reply = client.get("/api/test-boom")
    body = reply.get_json()
    assert reply.status_code == 500 and body["error"].startswith("Something went wrong on the server")
    assert "programmer" not in reply.get_data(as_text=True)


def test_a_refusal_keeps_its_own_words(client):
    reply = client.post("/api/tasks", json={"title": ""})
    assert reply.status_code == 400 and "title" in reply.get_json()["error"].lower()
