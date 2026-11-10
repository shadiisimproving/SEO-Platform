"""The Overview, traffic, AI search, Google Ads, Today and Resources APIs."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from seo.core.errors import Refused
from seo.extras import auto as extras_auto, service as extras, summaries  # noqa: F401 - auto registers its job handler here too
from seo.imports import clarity_reports
from seo.metrics import backlink_traffic, service, today as today_view
from seo.resources import service as resources

metrics_api = Blueprint("metrics_api", __name__, url_prefix="/api")


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


def _scope() -> service.Scope:
    args = request.args
    return service.Scope(_engine(), args.get("site_id"), args.get("from"), args.get("to"), args.get("compare_from"), args.get("compare_to"))


@metrics_api.get("/metrics/overview")
def overview():
    return jsonify(service.overview(_scope()))


@metrics_api.get("/metrics/channels")
def channels():
    return jsonify(service.channels(_scope()))


@metrics_api.get("/metrics/conversions")
def conversions():
    return jsonify(service.conversions(_scope()))


@metrics_api.get("/metrics/content")
def content():
    return jsonify(service.content(_scope()))


@metrics_api.get("/metrics/ai")
def ai_search():
    return jsonify(service.ai_search(_scope()))


@metrics_api.get("/metrics/ads")
def ads():
    return jsonify(service.ads(_scope()))


@metrics_api.get("/today")
def today():
    site = request.args.get("site_id")
    try:
        site_id = int(site) if site not in (None, "", "all") else None
    except ValueError as exc:
        raise Refused("That site isn't one of yours.") from exc
    period = {key: request.args.get(key) for key in ("range", "compare", "from", "to") if request.args.get(key)}
    return jsonify(today_view.today(_engine(), site_id, period))


@metrics_api.get("/today/attention")
def today_attention():
    """What Today's badge in the side menu counts, asked once per load on the other screens: a fraction of /api/today."""
    site = request.args.get("site_id")
    try:
        site_id = int(site) if site not in (None, "", "all") else None
    except ValueError as exc:
        raise Refused("That site isn't one of yours.") from exc
    keep = ("id", "severity", "kind", "host", "title", "words", "detail")
    return jsonify(todo=[{k: row.get(k) for k in keep} for row in today_view.attention(_engine(), site_id)])


@metrics_api.post("/today/seen")
def today_seen():
    body = request.get_json(silent=True) or {}
    today_view.mark_drop_seen(_engine(), body.get("key"), bool(body.get("seen", True)))
    return jsonify(ok=True)


@metrics_api.post("/rules")
def add_rule():
    body = _body()
    return jsonify(service.add_rule(_engine(), body.get("kind"), body.get("pattern"), body.get("value"), body.get("site_id"))), 201


@metrics_api.delete("/rules/<int:rule_id>")
def delete_rule(rule_id: int):
    service.delete_rule(_engine(), rule_id)
    return jsonify(ok=True)


@metrics_api.get("/backlinks/traffic")
def backlink_visits():
    args = request.args
    try:
        site_id = int(args.get("site_id", ""))
    except ValueError as exc:
        raise Refused("Pick a site.") from exc
    return jsonify(backlink_traffic.traffic(_engine(), site_id, args.get("from"), args.get("to")))


@metrics_api.get("/backlinks/<int:backlink_id>/before-after")
def backlink_before_after(backlink_id: int):
    return jsonify(backlink_traffic.before_after(_engine(), backlink_id))


@metrics_api.get("/resources")
def list_resources():
    return jsonify(resources=resources.list_resources(_engine()))


@metrics_api.post("/resources")
def create_resource():
    author = g.user["name"] if g.get("user") else None
    return jsonify(resources.create(_engine(), _body(), author)), 201


@metrics_api.put("/resources/<int:resource_id>")
def update_resource(resource_id: int):
    return jsonify(resources.update(_engine(), resource_id, _body()))


@metrics_api.delete("/resources/<int:resource_id>")
def delete_resource(resource_id: int):
    resources.delete(_engine(), resource_id)
    return jsonify(ok=True)


@metrics_api.post("/resources/<int:resource_id>/restore")
def restore_resource(resource_id: int):
    return jsonify(resources.restore(_engine(), resource_id))


@metrics_api.get("/metrics/speed")
def speed():
    return jsonify(runs=service.page_speed(_scope()))


@metrics_api.get("/metrics/clarity")
def clarity():
    return jsonify(service.clarity(_scope()))


@metrics_api.get("/metrics/clarity-reports")
def clarity_reports_latest():
    """The newest Clarity download per site. Its period is the file's own, not the one picked on the screen."""
    return jsonify(clarity_reports.latest(_engine(), _scope().site_ids))


@metrics_api.get("/important-domains")
def important_domains():
    return jsonify(extras.list_important(_engine()))


@metrics_api.post("/important-domains")
def mark_important():
    body = _body()
    return jsonify(extras.mark(_engine(), body.get("domain"), body.get("important", True) is not False))


@metrics_api.post("/important-domains/moz")
def get_moz():
    domains = _body().get("domains")  # a profile asks for just its two domains; Settings asks for all of them
    return jsonify(extras.fetch_moz(_engine(), domains if isinstance(domains, list) and domains else None))


@metrics_api.post("/important-domains/popularity")
def get_popularity():
    return jsonify(extras.fetch_popularity(_engine()))


@metrics_api.post("/indexnow")
def push_indexnow():
    body = _body()
    return jsonify(extras.indexnow(_engine(), body.get("site_id"), body.get("urls")))


@metrics_api.post("/changes/<int:event_id>/summary")
def summarise_change(event_id: int):
    return jsonify(summaries.summarise(_engine(), event_id, _body().get("language", "en")))


@metrics_api.get("/keyword-ideas")
def ideas():
    args = request.args
    return jsonify(ideas=extras.keyword_ideas(args.get("q"), args.get("language", ""), args.get("country", "")))
