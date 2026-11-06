"""Calls to data sources. A reply is sorted into the three things a collector does about it."""
from __future__ import annotations

import httpx

USER_AGENT = "SEOCommandCenter/0.1"
# Tests and the local harness replace this to run with no network.
transport: httpx.BaseTransport | None = None


class SourceError(Exception):
    """kind: auth (a person must fix the key or access), quota (stop for today), temporary (try again later)."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def client(timeout: float = 45) -> httpx.Client:
    return httpx.Client(transport=transport, timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=False)


def _message(reply: httpx.Response) -> str:
    try:
        body = reply.json()
    except ValueError:
        return reply.text[:200]
    error = body.get("error") if isinstance(body, dict) else None
    errors = body.get("errors") if isinstance(body, dict) else None
    if isinstance(errors, list) and errors and all(isinstance(e, dict) for e in errors):  # Cloudflare's shape
        return "; ".join(f"{e.get('message') or 'error'}" + (f" (code {e['code']})" if e.get("code") is not None else "") for e in errors)[:300]
    if isinstance(error, dict):
        return str(error.get("message") or error)[:300]
    if isinstance(body, dict) and body.get("message"):
        return str(body["message"])[:300]
    return str(error or body)[:300]


def check(reply: httpx.Response, source: str) -> httpx.Response:
    if reply.status_code in (401, 403):
        raise SourceError("auth", f"{source} refused access: {_message(reply)}")
    if reply.status_code == 404:
        raise SourceError("auth", f"{source} doesn't know this property: {_message(reply)}")
    if reply.status_code == 429:
        raise SourceError("quota", f"{source} says the limit is reached for now.")
    if reply.status_code >= 500:
        raise SourceError("temporary", f"{source} answered with an error ({reply.status_code}).")
    if reply.status_code >= 400:
        raise SourceError("auth", f"{source} refused the request: {_message(reply)}")
    return reply


def request(method: str, url: str, source: str, timeout: float = 45, **kwargs) -> httpx.Response:
    try:
        with client(timeout) as http:
            return check(http.request(method, url, **kwargs), source)
    except httpx.HTTPError as exc:
        raise SourceError("temporary", f"Couldn't reach {source}: {exc}") from exc
