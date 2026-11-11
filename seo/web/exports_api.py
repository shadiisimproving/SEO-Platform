"""Exports: GET /api/export/<view>.<pdf|xlsx|csv>, with the same arguments the screen's own data route takes.

Being under /api/, it is behind the login guard like every other route (seo/web/auth.py refuses by default). Each
view calls the screen's own service functions, so a site that isn't mine is refused by the same code, and the rows
are the screen's rows. See seo/exports/.
"""
from __future__ import annotations

from flask import Blueprint, Response, current_app, jsonify, request

from seo.core.errors import NotFound, Refused
from seo.exports import registry
from seo.exports.safe import filename

exports_api = Blueprint("exports_api", __name__, url_prefix="/api/export")

MIMES = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@exports_api.get("/views")
def views():
    return jsonify(views=registry.listing(), formats=registry.formats())


def _asked() -> dict:
    """What the screen sent. A GET carries it in the address. A POST carries the same in JSON, plus what a long address
    can't hold: `seen` (the rows on screen, by table) and `seen_words` (its filters in words). Everything else is text,
    exactly as a query string would give it, so the services check it the same way."""
    if request.method == "GET":
        return request.args.to_dict()
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    asked = {}
    for key, value in body.items():
        if key in ("seen", "seen_words"):
            asked[key] = value
        elif isinstance(value, (str, int, float)) and not isinstance(value, bool):
            asked[str(key)] = str(value)
    return asked


@exports_api.route("/<view_id>.<fmt>", methods=["GET", "POST"])
def export(view_id: str, fmt: str):
    if fmt not in registry.FORMATS:
        raise NotFound("Exports are PDF, Excel or CSV.")
    if fmt not in registry.formats():
        raise Refused("This file type isn't available here. Pick another.")
    args = _asked()
    lang = "fr" if args.get("lang") == "fr" else "en"
    report = registry.build(current_app.config["ENGINE"], view_id, args, lang)
    if fmt == "pdf":
        from seo.exports import pdf_out

        body, mime, ext = pdf_out.write(report), MIMES["pdf"], "pdf"
    elif fmt == "xlsx":
        from seo.exports import xlsx_out

        body, mime, ext = xlsx_out.write(report), MIMES["xlsx"], "xlsx"
    else:
        from seo.exports import csv_out

        body, mime, ext = csv_out.write(report, args.get("table") or None)
    table = report.table(args.get("table")) if fmt == "csv" and args.get("table") else None
    # The name says which screen, which site and which days, so two downloads are told apart in a folder.
    days = f"{report.period[0]:%Y-%m-%d}-to-{report.period[1]:%Y-%m-%d}" if report.period else report.made_at.strftime("%Y-%m-%d")
    name = filename(view_id, table.id if table and len(report.tables) > 1 else "", report.subject or "", report.site or "all-sites", days, ext=ext)
    reply = Response(body, mimetype=mime)
    reply.headers["Content-Disposition"] = f'attachment; filename="{name}"'
    reply.headers["Cache-Control"] = "no-store"
    reply.headers["X-Export-Rows"] = str(sum(t.count for t in report.tables))
    if report.capped:
        reply.headers["X-Export-Capped"] = "1"
    return reply
