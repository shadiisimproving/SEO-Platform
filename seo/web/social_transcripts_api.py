"""Social → Video transcripts: Instagram and TikTok videos turned into text, in named batches. See seo/social/transcripts.py."""
from __future__ import annotations

from flask import Blueprint, Response, current_app, g, jsonify, request

from seo.core.errors import Refused
from seo.social import transcripts

social_transcripts_api = Blueprint("social_transcripts_api", __name__, url_prefix="/api/social/transcripts")


def _engine():
    return current_app.config["ENGINE"]


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise Refused("Send a JSON object.")
    return body


def _site(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise Refused("Pick one of your websites first.") from None


@social_transcripts_api.get("")
def listing():
    return jsonify(transcripts.batches(_engine(), _site(request.args.get("site_id"))))


@social_transcripts_api.post("/find")
def find():
    """The video links in pasted text, before anything starts: how many, and any account links among them."""
    words = _body().get("text")
    if not isinstance(words, str) or len(words) > 2_000_000:
        raise Refused("Paste the links as text.")
    return jsonify(transcripts.find_links(words))


@social_transcripts_api.post("/file")
def from_file():
    upload = request.files.get("file")
    if upload is None:
        raise Refused("Choose a file.")
    return jsonify(transcripts.links_in_file(upload.filename or "", upload.read(transcripts.MAX_FILE_BYTES + 1)))


@social_transcripts_api.post("/account")
def account():
    body = _body()
    _site(body.get("site_id"))
    count = body.get("count")
    return jsonify(videos=transcripts.account_videos(body.get("url"), count if isinstance(count, int) else 10))


@social_transcripts_api.post("/batches")
def create():
    body = _body()
    user = (g.get("user") or {}).get("id")
    return jsonify(transcripts.create_batch(_engine(), body.get("site_id"), body.get("name"), body.get("origin"), body.get("urls"), user))


@social_transcripts_api.get("/batches/<int:transcript_batch_id>")
def one(transcript_batch_id: int):
    return jsonify(transcripts.batch(_engine(), transcript_batch_id))


@social_transcripts_api.patch("/batches/<int:transcript_batch_id>")
def rename(transcript_batch_id: int):
    return jsonify(transcripts.rename_batch(_engine(), transcript_batch_id, _body().get("name")))


@social_transcripts_api.delete("/batches/<int:transcript_batch_id>")
def remove(transcript_batch_id: int):
    transcripts.delete_batch(_engine(), transcript_batch_id)
    return jsonify(ok=True)


@social_transcripts_api.post("/batches/<int:transcript_batch_id>/retry")
def retry_batch(transcript_batch_id: int):
    return jsonify(transcripts.retry_failed(_engine(), transcript_batch_id))


@social_transcripts_api.post("/items/<int:transcript_id>/retry")
def retry_one(transcript_id: int):
    return jsonify(transcripts.retry(_engine(), transcript_id))


@social_transcripts_api.get("/batches/<int:transcript_batch_id>/download")
def download(transcript_batch_id: int):
    data, name, kind = transcripts.download(_engine(), transcript_batch_id, request.args.get("format", "txt"))
    return Response(data, mimetype=kind, headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})
