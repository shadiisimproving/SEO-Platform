"""The Overview, traffic, AI search, Google Ads, Today and Resources APIs."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from seo.backlinks import live as backlinks_live, logos
from seo.backlinks.cleaner import registrable_domain
from seo.core.errors import Refused
from seo.extras import auto as extras_auto, service as extras, summaries  # noqa: F401 - auto registers its job handler here too
from seo.imports import clarity_reports
from seo.metrics import backlink_traffic, leads, service, today as today_view
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
    scope = service.Scope(_engine(), args.get("site_id"), args.get("from"), args.get("to"), args.get("compare_from"), args.get("compare_to"))
    scope.search_args = service.search_args(args)  # the Search Console side ends on Google's last final day (seo/metrics/period.py)
    return scope


def _include(*allowed: str) -> set[str]:
    """?include=a,b folds into one answer what a simpler screen would otherwise ask for one by one (plan change 7).
    Without it an answer is exactly what it always was, so the screens as they are pay nothing for it."""
    asked = {part.strip() for part in (request.args.get("include") or "").split(",") if part.strip()}
    unknown = sorted(asked - set(allowed))
    if unknown:
        raise Refused(f"include takes {', '.join(allowed)}; not {', '.join(unknown)}.")
    return asked


def _queue_logos(names) -> None:
    """A row panel lists sites (sources, assistants): their icons are asked for, as the Channels list does for its own."""
    names = [name for name in names if isinstance(name, str) and "." in name]
    if names:
        logos.queue_missing(_engine(), [*names, *filter(None, map(registrable_domain, names))])


@metrics_api.get("/metrics/overview")
def overview():
    return jsonify(service.overview(_scope()))


@metrics_api.get("/metrics/channels")
def channels():
    wanted = _include("logos")
    answer = service.channels(_scope())
    # A subdomain may have no icon of its own (ps.popcash.net), so the site it belongs to is asked for as well.
    names = [row["domain"] for row in answer.get("referrers") or []]
    logos.queue_missing(_engine(), [*names, *map(registrable_domain, names)])
    if "logos" in wanted:  # which of these have an icon already, instead of a second call to /api/logos
        answer["logos"] = service.known_logos(_engine(), names)
    return jsonify(answer)


@metrics_api.get("/metrics/conversions")
def conversions():
    return jsonify(service.conversions(_scope()))


@metrics_api.get("/metrics/content")
def content():
    wanted = _include("clarity", "speed", "clarity_reports")
    scope = _scope()
    answer = service.content(scope)
    # Each in the shape its own route answers (/metrics/clarity, /metrics/speed, /metrics/clarity-reports), for the same days.
    if "clarity" in wanted:
        answer["clarity"] = service.clarity(scope)
    if "speed" in wanted:
        answer["speed"] = {"runs": service.page_speed(scope)}
    if "clarity_reports" in wanted:
        answer["clarity_reports"] = clarity_reports.latest(_engine(), scope.site_ids)
    return jsonify(answer)


# ---- One table row's side panel (simpler screens): the row's own numbers, its days and what is inside it ----------


@metrics_api.get("/metrics/channel")
def channel_detail():
    answer = service.channel_detail(_scope(), request.args.get("name"))
    _queue_logos([row["source"] for row in answer["sources"]])
    return jsonify(answer)


@metrics_api.get("/metrics/referrer")
def referrer_detail():
    answer = service.referrer_detail(_scope(), request.args.get("domain"))
    _queue_logos([answer["domain"]])
    return jsonify(answer)


@metrics_api.get("/metrics/page")
def page_detail():
    args = request.args
    answer = service.page_detail(_scope(), args.get("path"), args.get("host"))
    _queue_logos([row["source"] for row in answer["ai_sources"]])
    return jsonify(answer)


@metrics_api.get("/metrics/assistant")
def assistant_detail():
    answer = service.assistant_detail(_scope(), request.args.get("source"))
    _queue_logos([answer["source"]])
    return jsonify(answer)


@metrics_api.get("/metrics/ai")
def ai_search():
    return jsonify(service.ai_search(_scope()))


@metrics_api.get("/metrics/ads")
def ads():
    return jsonify(service.ads(_scope()))


@metrics_api.get("/today")
def today():
    wanted = _include("setup", "backlinks")
    site = request.args.get("site_id")
    try:
        site_id = int(site) if site not in (None, "", "all") else None
    except ValueError as exc:
        raise Refused("That site isn't one of yours.") from exc
    period = {key: request.args.get(key) for key in ("range", "compare", "from", "to") if request.args.get(key)}
    answer = today_view.today(_engine(), site_id, period)
    # The setup line's facts and the backlinks numbers, which Today asked for in four more calls (plan change 7).
    if "setup" in wanted:
        answer["setup"] = service.setup_facts(_engine(), site_id)
    if "backlinks" in wanted:
        answer["backlinks"] = backlinks_live.summary(_engine(), site_id)
    return jsonify(today_view.for_person(answer))


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
    if body.get("kind") == leads.RULE:
        # Which key events are leads changes every GA4 screen's leads: admins only, as PUT /ga4/key-events (code review
        # 2026-11-18, #9). The old rules route used to let any member with Edit on Channels do it.
        from seo.web.auth import require_admin

        require_admin()
        site_id = _site_id(body.get("site_id"))
        pattern = body.get("pattern").strip() if isinstance(body.get("pattern"), str) else ""
        leads.set_events(_engine(), site_id, leads.ticked(_engine(), site_id) + [pattern])
        return jsonify({"site_id": site_id, "kind": leads.RULE, "pattern": pattern, "value": None}), 201
    return jsonify(service.add_rule(_engine(), body.get("kind"), body.get("pattern"), body.get("value"), body.get("site_id"))), 201


@metrics_api.delete("/rules/<int:rule_id>")
def delete_rule(rule_id: int):
    if service.rule_kind(_engine(), rule_id) == leads.RULE:
        from seo.web.auth import require_admin

        require_admin()  # unticking a lead event: admins only (#9)
    service.delete_rule(_engine(), rule_id)
    return jsonify(ok=True)


def _site_id(value) -> int:
    from seo.accounts import access

    try:
        site_id = int(value)
    except (TypeError, ValueError) as exc:
        raise Refused("Pick a site.") from exc
    access.require_site(site_id)
    return site_id


@metrics_api.get("/ga4/key-events")
def ga4_key_events():
    """Settings: a site's GA4 key events, which count as leads, other websites its property records, and the days of
    history still to be read again."""
    from seo.collectors import ga4
    from seo.metrics import ga4_checks, leads

    site_id = _site_id(request.args.get("site_id"))
    return jsonify({**leads.events(_engine(), site_id), "other_hosts": ga4_checks.other_hosts(_engine(), site_id), "reread_days": ga4.days_to_reread(_engine(), site_id)})


@metrics_api.put("/ga4/key-events")
def ga4_set_key_events():
    from seo.metrics import leads
    from seo.web.auth import require_admin

    require_admin()
    body = _body()
    site_id = _site_id(body.get("site_id"))
    return jsonify(leads.set_events(_engine(), site_id, body.get("names")))


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
