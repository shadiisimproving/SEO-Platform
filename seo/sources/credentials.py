"""The only code that knows a Google connection's kind. Robot key or OAuth keys, the rest of the app sees a bearer token."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Callable

import httpx
from google.auth import exceptions as google_errors
from google.auth.transport import Request as GoogleRequest, Response as GoogleResponse
from google.oauth2 import credentials as oauth2_credentials, service_account
from sqlalchemy import Engine, text

from seo.core import crypto
from seo.core.errors import NotFound, Refused

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/analytics.readonly"]
TOKEN_URI = "https://oauth2.googleapis.com/token"

# Tests and the local harness replace this to run with no Google.
token_override: Callable[[int], str] | None = None
transport: httpx.BaseTransport | None = None

_cache: dict[int, tuple[str, float]] = {}


class CredentialsFailed(Exception):
    """Google refused these keys. The message says what to do."""


class _Reply(GoogleResponse):
    def __init__(self, reply: httpx.Response):
        self._reply = reply

    @property
    def status(self):
        return self._reply.status_code

    @property
    def headers(self):
        return self._reply.headers

    @property
    def data(self):
        return self._reply.content


class _HttpxRequest(GoogleRequest):
    """google-auth asks for a request function. This uses httpx, so there's no second HTTP library to install."""

    def __call__(self, url, method="GET", body=None, headers=None, timeout=30, **kwargs):
        try:
            with httpx.Client(transport=transport, timeout=timeout) as client:
                return _Reply(client.request(method, url, content=body, headers=headers))
        except httpx.HTTPError as exc:
            raise google_errors.TransportError(str(exc)) from exc


@dataclass
class ParsedKey:
    kind: str
    secret: dict
    last4: str
    robot_email: str | None = None


def parse_key(kind, payload) -> ParsedKey:
    """Checks a pasted key is whole before anything is saved. The error says which part is missing."""
    if kind == "robot":
        try:
            info = json.loads(payload) if isinstance(payload, str) else payload
        except (TypeError, ValueError) as exc:
            raise Refused("That isn't the whole key file. Paste everything in the file, from the first { to the last }.") from exc
        if not isinstance(info, dict) or not isinstance(info.get("client_email"), str) or "@" not in info["client_email"] or not info.get("private_key"):
            raise Refused("That isn't the whole key file. Paste everything in the file, from the first { to the last }.")
        return ParsedKey("robot", info, crypto.last_four(info.get("private_key_id") or info["client_email"]), info["client_email"])
    if kind == "oauth":
        fields = payload if isinstance(payload, dict) else {}
        values = {name: (fields.get(name) or "").strip() if isinstance(fields.get(name), str) else "" for name in ("client_id", "client_secret", "refresh_token")}
        missing = [name.replace("_", " ") for name, value in values.items() if not value]
        if missing:
            raise Refused(f"Paste the {', '.join(missing)} as well.")
        return ParsedKey("oauth", values, crypto.last_four(values["refresh_token"]))
    raise Refused("A Google connection is a robot key or OAuth keys.")


def _hint(error: str) -> str:
    low = error.lower()
    if "invalid_grant" in low:
        return "Google stopped this token. It happens after 7 days if the Google project is left in Testing, after 6 months unused, or when access is removed. Make a new refresh token and paste it here."
    if "invalid_client" in low or "unauthorized_client" in low:
        return "Google doesn't recognise these OAuth keys. Check the client ID and secret are from the same project."
    if "invalid_scope" in low:
        return "This token wasn't given the Search Console and Analytics scopes. Make a new one with both."
    return f"Google refused these keys: {error[:200]}"


def access_token(engine: Engine, connection_id: int, key_path=None) -> str:
    if token_override is not None:
        return token_override(connection_id)
    cached = _cache.get(connection_id)
    if cached and cached[1] > time.time() + 60:
        return cached[0]
    with engine.connect() as conn:
        row = conn.execute(text("SELECT kind, secret FROM google_connections WHERE id = :i"), {"i": connection_id}).mappings().first()
    if row is None:
        raise NotFound("That Google connection doesn't exist.")
    try:
        info = json.loads(crypto.decrypt(row["secret"], key_path))
    except (crypto.MissingKey, crypto.UnsafeKeyFile, crypto.BadKey) as exc:
        raise CredentialsFailed(str(exc)) from exc
    try:
        if row["kind"] == "robot":
            creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        else:
            creds = oauth2_credentials.Credentials(None, refresh_token=info["refresh_token"], client_id=info["client_id"], client_secret=info["client_secret"], token_uri=TOKEN_URI, scopes=SCOPES)
        creds.refresh(_HttpxRequest())
    except (google_errors.RefreshError, ValueError, KeyError) as exc:
        raise CredentialsFailed(_hint(str(exc))) from exc
    except google_errors.TransportError as exc:
        raise ConnectionError(f"Couldn't reach Google: {exc}") from exc
    _cache[connection_id] = (creds.token, time.time() + 3000)
    return creds.token


def forget(connection_id: int) -> None:
    _cache.pop(connection_id, None)
