"""Encrypt API keys with a key file kept outside the code and outside ~/Documents.

The key is never in .env, git or the database dump folder, so a stray dump or
commit holds only ciphertext. Losing the key means re-pasting every API key; no
other data is affected.

    python -m seo.core.crypto init     # creates the key once, never prints it
"""
from __future__ import annotations

import hashlib
import hmac
import os
import stat
import sys
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class MissingKey(Exception):
    pass


class UnsafeKeyFile(Exception):
    pass


class BadKey(Exception):
    pass


def default_key_path() -> Path:
    return Path.home() / ".config" / "seo-command-center" / "key"


def init_key(path: Path | None = None) -> bool:
    """Create the key if there is none. True if one was created."""
    path = Path(path) if path else default_key_path()
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    # O_EXCL: two simultaneous runs can never overwrite each other's key.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(Fernet.generate_key())
    return True


def _fernet(path: Path | None) -> Fernet:
    path = Path(path) if path else default_key_path()
    if not path.exists():
        raise MissingKey(f"No encryption key at {path}. Create one with: python -m seo.core.crypto init")
    if stat.S_IMODE(os.stat(path).st_mode) & 0o077:
        raise UnsafeKeyFile(f"{path} can be read by other users. Fix it with: chmod 600 '{path}'")
    return Fernet(path.read_bytes().strip())


def encrypt(secret: str, path: Path | None = None) -> str:
    return _fernet(path).encrypt(secret.encode()).decode()


def decrypt(token: str, path: Path | None = None) -> str:
    try:
        return _fernet(path).decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise BadKey("This value was encrypted with a different key. Re-paste the API key.") from exc


def derived_secret(purpose: str, path: Path | None = None) -> str:
    """A second secret from the same key file, so session cookies need no extra file to look after."""
    fernet_key = (Path(path) if path else default_key_path())
    _fernet(fernet_key)  # says plainly if the file is missing or unsafe
    return hmac.new(fernet_key.read_bytes().strip(), purpose.encode(), hashlib.sha256).hexdigest()


def last_four(secret: str) -> str:
    """What the Connections page may show of a key."""
    return "…" + secret[-4:] if len(secret) > 4 else "…"


if __name__ == "__main__":
    if sys.argv[1:] == ["init"]:
        created = init_key()
        print(f"{'Created' if created else 'Already exists:'} {default_key_path()}")
        if created:
            print("Copy this file to your password manager once. Losing it means re-pasting every API key.")
    else:
        print("usage: python -m seo.core.crypto init", file=sys.stderr)
        sys.exit(2)
