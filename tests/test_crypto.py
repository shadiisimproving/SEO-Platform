"""API keys are encrypted with a key file kept away from the code and from .env."""
import os
import stat

import pytest

from seo.core import crypto


def test_round_trip(tmp_path):
    path = tmp_path / "cfg" / "key"
    crypto.init_key(path)
    secret = "sk_live_abc123"
    token = crypto.encrypt(secret, path)
    assert token != secret
    assert secret not in token
    assert crypto.decrypt(token, path) == secret


def test_missing_key_gives_a_plain_instruction(tmp_path):
    with pytest.raises(crypto.MissingKey) as err:
        crypto.encrypt("x", tmp_path / "nope")
    assert "python -m seo.core.crypto init" in str(err.value)


def test_new_key_is_readable_only_by_the_owner(tmp_path):
    path = tmp_path / "cfg" / "key"
    crypto.init_key(path)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(path.parent).st_mode) == 0o700


def test_key_readable_by_others_is_refused(tmp_path):
    path = tmp_path / "cfg" / "key"
    crypto.init_key(path)
    os.chmod(path, 0o644)
    with pytest.raises(crypto.UnsafeKeyFile):
        crypto.encrypt("x", path)


def test_init_never_overwrites_an_existing_key(tmp_path):
    # Overwriting would make every stored API key unreadable.
    path = tmp_path / "cfg" / "key"
    crypto.init_key(path)
    before = path.read_bytes()
    crypto.init_key(path)
    assert path.read_bytes() == before


def test_decrypting_with_another_key_says_so(tmp_path):
    first = tmp_path / "a" / "key"
    second = tmp_path / "b" / "key"
    crypto.init_key(first)
    crypto.init_key(second)
    token = crypto.encrypt("x", first)
    with pytest.raises(crypto.BadKey):
        crypto.decrypt(token, second)


def test_default_key_is_outside_documents_and_the_project():
    path = str(crypto.default_key_path())
    assert "/Documents/" not in path
    assert path.endswith(".config/seo-command-center/key")


def test_last_four_shows_only_the_tail():
    assert crypto.last_four("sk_live_abc123") == "…c123"
    assert crypto.last_four("abc") == "…"
