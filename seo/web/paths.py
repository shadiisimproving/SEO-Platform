"""Passenger on o2switch hands the app the address with %20 and other escapes still in it, against the WSGI rule.

So /api/connections/Bright%20Data reached the route as "Bright%20Data", which matched no tool, and Bright Data
could never be saved on the live site while every name without a space worked. Werkzeug's own server, used on the
Mac, decodes the address first, which is why it only showed up live.

This decodes the path once, and only when it is still exactly what the browser sent, so a server that already
decodes it is left alone and a real "%" in a name is never decoded twice.
"""
from __future__ import annotations

from urllib.parse import unquote_to_bytes


def decoded_paths(app):
    def wrapped(environ, start_response):
        path = environ.get("PATH_INFO", "")
        if "%" in path:
            sent = environ.get("REQUEST_URI", "").split("?", 1)[0]
            if not sent or sent.endswith(path):
                environ["PATH_INFO"] = unquote_to_bytes(path).decode("latin-1")  # WSGI carries the bytes as latin-1
        return app(environ, start_response)

    return wrapped
