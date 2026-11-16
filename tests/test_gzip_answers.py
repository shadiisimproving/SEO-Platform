"""Text answers go gzipped when the browser asks for it (2026-11-16, the owner: "the app is very slow"): Competitors' moves
went raw, 5 to 8 MB a site, on every start. Small answers, images, a browser that doesn't ask, and 304s are left alone."""
import gzip
import json

from pathlib import Path

from seo.web import create_app
from seo.web.__init__ import SQUEEZE_FROM

SCREENS = Path(__file__).resolve().parent.parent / "design" / "mockups"
GZ = {"Accept-Encoding": "gzip, deflate, br"}


def test_a_script_goes_gzipped_and_opens_to_the_same_file(engine):
    client = create_app(engine=engine, auth=False, screens_dir=SCREENS).test_client()
    plain = client.get("/mockup.js").data
    squeezed = client.get("/mockup.js", headers=GZ)
    assert squeezed.status_code == 200 and squeezed.headers["Content-Encoding"] == "gzip"
    assert "Accept-Encoding" in squeezed.headers["Vary"]
    assert gzip.decompress(squeezed.data) == plain and len(squeezed.data) < len(plain) / 3


def test_a_json_answer_goes_gzipped_and_keeps_its_no_store(engine):
    client = create_app(engine=engine, auth=False, screens_dir=SCREENS).test_client()
    plain = client.get("/api/tools")
    squeezed = client.get("/api/tools", headers=GZ)
    if len(plain.data) >= SQUEEZE_FROM:
        assert squeezed.headers["Content-Encoding"] == "gzip"
        assert json.loads(gzip.decompress(squeezed.data)) == plain.get_json()
    assert squeezed.headers["Cache-Control"] == "no-store"


def test_nothing_is_squeezed_for_a_browser_that_does_not_ask(engine):
    client = create_app(engine=engine, auth=False, screens_dir=SCREENS).test_client()
    reply = client.get("/mockup.js")
    assert reply.status_code == 200 and "Content-Encoding" not in reply.headers
    assert reply.data[:2] != b"\x1f\x8b"  # not gzip bytes


def test_a_small_answer_and_an_unchanged_file_stay_as_they_are(engine):
    client = create_app(engine=engine, auth=False, screens_dir=SCREENS).test_client()
    small = client.get("/api/tasks", headers=GZ)
    assert len(small.data) < SQUEEZE_FROM and "Content-Encoding" not in small.headers
    first = client.get("/mockup.js", headers=GZ)
    again = client.get("/mockup.js", headers={**GZ, "If-None-Match": first.headers["ETag"]})
    assert again.status_code == 304 and "Content-Encoding" not in again.headers
