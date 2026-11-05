"""Requests the app says no to. `http` is the status the API answers with."""
from __future__ import annotations


class Refused(Exception):
    http = 400


class UnknownSite(Refused):
    http = 404


class NotOwnSite(Refused):
    http = 403


class Conflict(Refused):
    http = 409


class NotFound(Refused):
    http = 404


class Forbidden(Refused):
    http = 403
