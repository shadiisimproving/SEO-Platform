"""Notes, 2026-11-10: a deleted note can't be written into (F121), two people saving the same note (Keep mine / Use theirs,
as Tasks do), and who made and last changed a note. Made-up sites only."""
import io

import pytest

from seo.competitors import notes
from seo.core.errors import NotFound
from tests.test_competitors_backend import world  # noqa: F401  (a fixture)


def test_writing_into_a_note_someone_deleted_answers_404_and_saves_nothing(world):
    note = notes.create(world.engine, "all", "first words")
    notes.delete(world.engine, note["id"])
    with pytest.raises(NotFound, match="deleted"):
        notes.update(world.engine, note["id"], "typed after it was deleted")
    with pytest.raises(NotFound):
        notes.add_file(world.engine, note["id"], "a.txt", io.BytesIO(b"hello"))
    got = world.client.patch(f"/api/notes/{note['id']}", json={"body": "more"})
    assert got.status_code == 404
    assert notes.restore(world.engine, note["id"])["body"] == "first words"  # Undo still works


def test_a_deleted_notes_files_cant_be_downloaded(world, tmp_path, monkeypatch):
    monkeypatch.setenv("SEO_NOTE_FILES", str(tmp_path))
    note = notes.create(world.engine, "all", "with a file")
    file_id = notes.add_file(world.engine, note["id"], "a.txt", io.BytesIO(b"hello"))["files"][0]["id"]
    assert notes.get_file(world.engine, file_id)["name"] == "a.txt"
    notes.delete(world.engine, note["id"])
    with pytest.raises(NotFound):
        notes.get_file(world.engine, file_id)


def test_a_save_on_an_older_version_is_refused_with_their_copy(world):
    note = notes.create(world.engine, "all", "ours", by="Anna")
    seen = note["updated_at"]
    import time
    time.sleep(1.1)  # versions are to the second
    theirs = notes.update(world.engine, note["id"], "their words", expected=seen, by="Ben")
    with pytest.raises(notes.Changed) as clash:
        notes.update(world.engine, note["id"], "my words", expected=seen, by="Anna")
    assert clash.value.note["body"] == "their words" and clash.value.note["updated_by"] == "Ben"
    # Keep mine: sent again on their version, it goes through.
    mine = notes.update(world.engine, note["id"], "my words", expected=theirs["updated_at"], by="Anna")
    assert mine["body"] == "my words" and mine["updated_by"] == "Anna" and mine["created_by"] == "Anna"
    # The same words as theirs isn't a clash; no version (a page closing) saves as before.
    assert notes.update(world.engine, note["id"], "my words", expected="2000-01-01T00:00:00Z")["body"] == "my words"
    assert notes.update(world.engine, note["id"], "last", by="Anna")["body"] == "last"


def test_the_route_answers_409_with_the_note_as_it_is(world):
    note = world.client.post("/api/notes", json={"scope": "all", "body": "v1"}).get_json()
    assert note["created_by"] is None  # no login on this test app: nobody to name, so nothing is shown
    import time
    time.sleep(1.1)
    world.client.patch(f"/api/notes/{note['id']}", json={"body": "v2", "expected_updated_at": note["updated_at"]})
    got = world.client.patch(f"/api/notes/{note['id']}", json={"body": "v3", "expected_updated_at": note["updated_at"]})
    assert got.status_code == 409 and got.get_json()["note"]["body"] == "v2" and "while you were writing" in got.get_json()["error"]
    listed = world.client.get("/api/notes?scope=all").get_json()["notes"][0]
    assert {"created_by", "updated_by"} <= set(listed)
