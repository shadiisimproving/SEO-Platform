"""A site's logo keeps its own one-day cache header (2026-11-11, simpler screens, track E). The API's no-store rule used to
override it, so every redraw downloaded each logo again. Nothing else about caching changes: the list of known logos,
a logo not found, a refusal and every other API answer are still never kept."""
from pathlib import Path

from sqlalchemy import text

from seo.accounts import service as accounts
from seo.web import create_app

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
PASSWORD = "correct horse battery"
SCREENS = Path(__file__).resolve().parent.parent / "design" / "mockups"


def stored(engine, domain="logo-one.example"):
    """A logo as the logo job keeps it, written straight in: these tests are about the answer's headers, not the fetching."""
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO site_logos (domain, status, image, content_type, checked_at) VALUES (:d, 'found', :i, 'image/png', UTC_TIMESTAMP(3))"),
            {"d": domain, "i": PNG},
        )
    return domain


def test_a_logo_keeps_its_own_one_day_header(engine):
    client = create_app(engine=engine, auth=False).test_client()
    reply = client.get(f"/api/logos/{stored(engine)}")
    assert reply.status_code == 200 and reply.data == PNG and reply.mimetype == "image/png"
    assert reply.headers["Cache-Control"] == "max-age=86400"
    # Its other headers are untouched: an SVG still can't run a script.
    assert reply.headers["X-Content-Type-Options"] == "nosniff" and "sandbox" in reply.headers["Content-Security-Policy"]


def test_an_accented_domain_keeps_the_header_under_either_spelling(engine):
    client = create_app(engine=engine, auth=False).test_client()
    stored(engine, "xn--caf-du-matin-deb.example")
    for name in ("café-du-matin.example", "xn--caf-du-matin-deb.example"):
        reply = client.get(f"/api/logos/{name}")
        assert reply.status_code == 200 and reply.headers["Cache-Control"] == "max-age=86400", name


def test_the_list_of_logos_a_missing_logo_and_the_rest_of_the_api_are_never_kept(engine):
    client = create_app(engine=engine, auth=False).test_client()
    stored(engine)
    listed = client.get("/api/logos")
    assert listed.get_json() == {"domains": ["logo-one.example"]} and listed.headers["Cache-Control"] == "no-store"
    missing = client.get("/api/logos/nothing.example")
    assert missing.status_code == 404 and missing.headers["Cache-Control"] == "no-store"
    assert client.get("/api/tasks").headers["Cache-Control"] == "no-store"


def test_signed_in_the_logo_is_kept_and_signed_out_the_refusal_is_not(engine):
    app = create_app(engine=engine, auth=True, secret_key="test-only-secret")
    domain = stored(engine)
    refused = app.test_client().get(f"/api/logos/{domain}")
    assert refused.status_code == 401 and refused.headers["Cache-Control"] == "no-store"
    accounts.create_user(engine, "boss@example.com", "Boss", "admin", password=PASSWORD, must_change=False)
    client = app.test_client()
    assert client.post("/api/auth/login", json={"email": "boss@example.com", "password": PASSWORD}).status_code == 200
    reply = client.get(f"/api/logos/{domain}")
    assert reply.status_code == 200 and reply.headers["Cache-Control"] == "max-age=86400"
    assert client.get("/api/logos").headers["Cache-Control"] == "no-store"


def test_with_the_screens_served_the_other_rules_are_as_before(engine):
    client = create_app(engine=engine, screens_dir=SCREENS, auth=False).test_client()
    assert client.get(f"/api/logos/{stored(engine)}").headers["Cache-Control"] == "max-age=86400"
    assert client.get("/").headers["Cache-Control"] == "no-store"
    assert client.get("/boot.js").headers["Cache-Control"] == "no-store"
    assert "immutable" in client.get("/mockup.js?v=abc").headers["Cache-Control"]
    assert client.get("/mockup.js").headers["Cache-Control"] == "no-cache"
    # A carried logo file (not the API) is checked each time, as before.
    assert client.get("/logos/google.svg").headers["Cache-Control"] == "no-cache"
