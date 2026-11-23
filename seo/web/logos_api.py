"""Website icons for the screens. They come from other people's servers, so they're never trusted as anything but pictures."""
from __future__ import annotations

from flask import Blueprint, Response, abort, current_app, jsonify
from sqlalchemy import text

from seo.accounts import access

from seo.backlinks import logos
from seo.serp.store import to_ascii_host, to_display_host

logos_api = Blueprint("logos_api", __name__, url_prefix="/api")


@logos_api.get("/logos")
def known():
    # Screens write a domain as people read it, so accented ones are listed under both spellings.
    engine = current_app.config["ENGINE"]
    found = logos.known(engine)
    if not access.current().full:
        # Someone with chosen access doesn't learn the names of the owner's other sites from this list.
        with engine.connect() as conn:
            mine = set(access.own_site_ids(conn))
            hidden = {host for site_id, host in conn.execute(text("SELECT id, host FROM sites WHERE kind = 'own'")) if site_id not in mine}
        found = [d for d in found if d.removeprefix("www.") not in hidden]
    return jsonify(domains=sorted({*found, *(to_display_host(d) for d in found)}))


@logos_api.get("/logos/<domain>")
def image(domain: str):
    found = logos.image_of(current_app.config["ENGINE"], to_ascii_host(domain))
    if found is None:
        abort(404)
    data, kind = found
    return Response(data, mimetype=kind, headers={
        "X-Content-Type-Options": "nosniff",
        # An SVG can hold a script. Inside an <img> it can't run, and these stop it if someone opens the address directly.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "max-age=86400",
    })
