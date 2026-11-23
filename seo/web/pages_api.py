"""The Pages screen: my pages, and one page with everything the app knows about it."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from seo.core.errors import Refused
from seo.metrics import service as metrics
from seo.pages import service

pages_api = Blueprint("pages_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


@pages_api.get("/site-pages")
def listing():
    args = request.args
    scope = metrics.Scope(_engine(), args.get("site_id"), args.get("from"), args.get("to"), args.get("compare_from"), args.get("compare_to"))
    scope.search_args = metrics.search_args(args)  # Search Console numbers on the shared period (seo/metrics/period.py)
    return jsonify(service.listing(scope))


@pages_api.get("/site-pages/profile")
def profile():
    raw = request.args.get("site_id", "")
    if not raw.isdigit():
        raise Refused("site_id must be a number.")
    return jsonify(service.profile(_engine(), int(raw), request.args.get("url", "")))
