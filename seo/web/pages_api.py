"""The Pages screen: my pages, and one page with everything the app knows about it."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from seo.core.errors import Refused
from seo.metrics import service as metrics
from seo.pages import service, sitemap_tree

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


def _map_site() -> int:
    """The website a site map is asked for: one of mine (site_id) or a competitor (competitor_id). Access checks both names."""
    raw = request.args.get("competitor_id") or request.args.get("site_id") or ""
    if not raw.isdigit():
        raise Refused("Pick a website.")
    return int(raw)


@pages_api.get("/site-map")
def site_map():
    return jsonify(sitemap_tree.site_map(_engine(), _map_site(), request.args.get("view") or "folders"))


@pages_api.get("/site-map/reading")
def site_map_reading():
    return jsonify(sitemap_tree.reading(_engine(), _map_site()))


@pages_api.post("/site-map/read")
def site_map_read():
    return jsonify(sitemap_tree.read_again(_engine(), _map_site())), 202


@pages_api.get("/site-map/page")
def site_map_page():
    return jsonify(sitemap_tree.page_card(_engine(), _map_site(), request.args.get("url", "")))
