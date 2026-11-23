"""Video transcripts: Instagram and TikTok videos turned into text, like saveto.ai, inside the Social section.

How one video becomes text (the owner's order, 2026-11-20: captions first, then Groq):
  1. yt-dlp reads the video's facts. If it has captions (the uploader's first, then automatic ones; Arabic, French,
     English first), their words are the transcript: free, nothing downloaded, Groq not used.
  2. Otherwise yt-dlp downloads the smallest file that still has the sound (never kept: a temporary folder), and
     Groq's free Whisper (whisper-large-v3-turbo) writes out what is said, in the language it hears.
  3. The words, how they were got, the caption written under the video, its title, author and length are saved.

Captions alone were tried (2026-11-20): none of 15 real TikTok videos had any yt-dlp could read, from o2switch or the
Mac, so most videos will go to Groq; captions still go first because they cost nothing when they're there. Instagram refuses servers often: it then needs the owner's own
Instagram cookies (a cookies.txt), kept sealed like every other key.

Three ways in, all ending as one named batch: pasted links, links found in a file (txt, csv, Excel, Word), or one TikTok
account's latest videos. One job per video in the collectors lane, so a long batch never holds up a short one for long.
"""
from __future__ import annotations

import hashlib
import html
import io
import os
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Engine, text

from seo.collectors import http
from seo.collectors.http import SourceError
from seo.core.errors import NotFound, Refused
from seo.worker import queue
from seo.worker.runner import Retry, handler

JOB_KIND = "social-transcript"
LANE = "collectors"
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"
GROQ_MAX_BYTES = 25 * 1024 * 1024  # the free plan's file limit
MAX_SECONDS = 20 * 60  # longer videos would eat the free plan's hour of audio on their own
MAX_LINKS = 200
MAX_FILE_BYTES = 5 * 1024 * 1024
ACCOUNT_COUNTS = (10, 25, 50)
ORIGINS = ("paste", "file", "account")

_HOSTS = r"(?:[a-z0-9-]+\.)?(?:tiktok\.com|instagram\.com)"
LINK_RE = re.compile(rf"https?://{_HOSTS}/[^\s\"'<>,;|\\\]\[(){{}}]+", re.I)
_TIKTOK_VIDEO = re.compile(r"^/@[\w.\-]+/(?:video|photo)/\d+", re.I)
_TIKTOK_SHORT = re.compile(r"^/(?:t/)?[A-Za-z0-9]{6,}/?$")  # vm.tiktok.com/ZMabc, tiktok.com/t/ZMabc
_TIKTOK_ACCOUNT = re.compile(r"^/@[\w.\-]+/?$")
_INSTAGRAM_VIDEO = re.compile(r"^/(?:[\w.]+/)?(?:reel|reels|p|tv)/[\w\-]+", re.I)
_INSTAGRAM_ACCOUNT = re.compile(r"^/[\w.]+/?(?:reels/?)?$")
_LANGS = {"arabic": "ar", "french": "fr", "english": "en", "spanish": "es", "german": "de", "italian": "it", "portuguese": "pt", "turkish": "tr", "russian": "ru", "hindi": "hi", "urdu": "ur", "persian": "fa", "chinese": "zh", "dutch": "nl"}


# ---- links -----------------------------------------------------------------------------------------------------


def _hash(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()


def classify(raw: str) -> tuple[str, str, str] | None:
    """(kind, platform, clean url) for an Instagram or TikTok address: kind is video or account. None for anything else."""
    match = re.match(rf"^https?://({_HOSTS})(/[^?#]*)", raw.strip(), re.I)
    if not match:
        return None
    host, path = match.group(1).lower(), re.sub(r"/{2,}", "/", match.group(2))
    if host.endswith("tiktok.com"):
        if _TIKTOK_VIDEO.match(path):
            return "video", "tiktok", "https://www.tiktok.com" + _TIKTOK_VIDEO.match(path).group(0)
        if host.split(".")[0] in ("vm", "vt") and _TIKTOK_SHORT.match(path):
            return "video", "tiktok", f"https://{host}{path.rstrip('/')}/"
        if _TIKTOK_SHORT.match(path) and path.startswith("/t/"):
            return "video", "tiktok", f"https://www.tiktok.com{path.rstrip('/')}/"
        if _TIKTOK_ACCOUNT.match(path):
            return "account", "tiktok", "https://www.tiktok.com" + path.rstrip("/")
        return None
    found = _INSTAGRAM_VIDEO.match(path)
    if found:
        kind_id = re.search(r"/(reel|reels|p|tv)/([\w\-]+)", found.group(0), re.I)
        kind = "reel" if kind_id.group(1).lower() == "reels" else kind_id.group(1).lower()
        return "video", "instagram", f"https://www.instagram.com/{kind}/{kind_id.group(2)}/"
    if _INSTAGRAM_ACCOUNT.match(path) and path.strip("/").split("/")[0] not in ("explore", "accounts", "stories", "direct"):
        return "account", "instagram", "https://www.instagram.com/" + path.strip("/").split("/")[0]
    return None


def find_links(words: str) -> dict:
    """Every Instagram and TikTok video in any text, once each, in the order found. Accounts are counted apart."""
    videos, accounts, seen = [], [], set()
    other = 0
    for raw in LINK_RE.findall(html.unescape(words or "")):
        found = classify(raw.rstrip(".)!?"))
        if found is None:
            other += 1
            continue
        kind, platform, url = found
        if url in seen:
            continue
        seen.add(url)
        (videos if kind == "video" else accounts).append({"url": url, "platform": platform})
    return {"videos": videos, "accounts": accounts, "other": other, "too_many": len(videos) > MAX_LINKS}


def _decode(data: bytes) -> str:
    for codec in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(codec)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def links_in_file(name: str, data: bytes) -> dict:
    """The links in a .txt, .csv, Excel (.xlsx) or Word (.docx) file, wherever they sit. Both Office kinds are zips of XML."""
    if len(data) > MAX_FILE_BYTES:
        raise Refused("That file is over 5 MB. Split it, or paste the links instead.")
    suffix = Path(name or "").suffix.lower()
    if suffix in (".xlsx", ".xlsm", ".docx") or data[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as box:
                parts = [n for n in box.namelist() if n.endswith(".xml") or n.endswith(".rels")]
                if sum(box.getinfo(n).file_size for n in parts) > 50 * 1024 * 1024:
                    raise Refused("That file is too big inside to read.")
                words = "\n".join(box.read(n).decode("utf-8", "replace") for n in parts)
        except Refused:
            raise
        except Exception:  # noqa: BLE001 - not a zip, damaged, or locked with a password
            raise Refused("That file can't be opened. Save it as .xlsx, .csv or .txt and try again.") from None
        # Hyperlinks live in .rels files as Target="..."; cell text in sharedStrings. Tags end a link, so drop them.
        targets = re.findall(r'Target="([^"]+)"', words)
        words = re.sub(r"<[^>]+>", " ", words) + "\n" + "\n".join(targets)
    elif suffix in (".xls", ".doc"):
        raise Refused("That's an old Office file. Save it as .xlsx or .docx, or as .csv, and try again.")
    else:
        words = _decode(data)
    return find_links(words)


# ---- one TikTok account's latest videos --------------------------------------------------------------------------


def _ydl_options(**extra) -> dict:
    return {"quiet": True, "no_warnings": True, "noprogress": True, "socket_timeout": 30, "retries": 2, **extra}


def account_videos(url: str, count: int) -> list[dict]:
    """The newest videos of a TikTok account, for ticking. Instagram doesn't let a server list an account."""
    found = classify(url or "")
    if found is None or found[0] != "account":
        raise Refused("Paste an account's address, like https://www.tiktok.com/@name.")
    if found[1] == "instagram":
        raise Refused("Instagram doesn't let the app list an account's videos. Paste the video links instead.")
    if count not in ACCOUNT_COUNTS:
        raise Refused("Pick 10, 25 or 50 videos.")
    import yt_dlp

    try:
        with yt_dlp.YoutubeDL(_ydl_options(extract_flat="in_playlist", playlistend=count, skip_download=True)) as ydl:
            info = ydl.extract_info(found[2], download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise Refused(_plain_error(str(exc), "tiktok")) from None
    out = []
    for entry in (info or {}).get("entries") or []:
        link = classify(entry.get("url") or entry.get("webpage_url") or "")
        if link and link[0] == "video":
            out.append({"url": link[2], "platform": "tiktok", "title": (entry.get("title") or entry.get("description") or "")[:200], "duration": _seconds(entry.get("duration"))})
    if not out:
        raise Refused("No videos found on that account. Is it private, or spelled differently?")
    return out[:count]


def _seconds(value) -> int | None:
    try:
        return int(round(float(value))) if value is not None else None
    except (TypeError, ValueError):
        return None


# ---- batches -----------------------------------------------------------------------------------------------------


def _site(conn, site_id) -> int:
    if not isinstance(site_id, int) or conn.execute(text("SELECT 1 FROM sites WHERE id = :s"), {"s": site_id}).scalar() is None:
        raise Refused("Pick one of your websites first.")
    return site_id


def create_batch(engine: Engine, site_id, name, origin, urls, user_id=None) -> dict:
    if origin not in ORIGINS:
        raise Refused("Say where the links came from.")
    if not isinstance(urls, list):
        raise Refused("Send the links as a list.")
    found = find_links("\n".join(u for u in urls if isinstance(u, str)))
    videos = found["videos"]
    if not videos:
        raise Refused("No Instagram or TikTok video links in that.")
    if len(videos) > MAX_LINKS:
        raise Refused(f"That's {len(videos)} videos. Up to {MAX_LINKS} at a time: split them into two batches.")
    label = (name or "").strip()[:120] if isinstance(name, str) else ""
    if not label:
        label = "Videos " + datetime.now().strftime("%d %b %H:%M")
    with engine.begin() as conn:
        _site(conn, site_id)
        batch_id = conn.execute(
            text("INSERT INTO social_transcript_batches (site_id, name, origin, created_by) VALUES (:s, :n, :o, :u)"),
            {"s": site_id, "n": label, "o": origin, "u": user_id},
        ).lastrowid
        for video in videos:
            conn.execute(
                text("INSERT INTO social_transcripts (batch_id, site_id, url, url_hash, platform) VALUES (:b, :s, :u, :h, :p)"),
                {"b": batch_id, "s": site_id, "u": video["url"], "h": _hash(video["url"]), "p": video["platform"]},
            )
        ids = conn.execute(text("SELECT id FROM social_transcripts WHERE batch_id = :b ORDER BY id"), {"b": batch_id}).scalars().all()
    for transcript_id in ids:
        _enqueue(engine, transcript_id)
    return batch(engine, batch_id)


def _enqueue(engine: Engine, transcript_id: int) -> None:
    queue.enqueue(engine, LANE, JOB_KIND, {"id": transcript_id}, dedupe_key=f"{JOB_KIND}:{transcript_id}", max_attempts=3)


def _counts(rows) -> dict:
    counts = {"queued": 0, "working": 0, "done": 0, "failed": 0}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + int(row["n"])
    counts["total"] = sum(counts[k] for k in ("queued", "working", "done", "failed"))
    return counts


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


def batches(engine: Engine, site_id) -> dict:
    with engine.connect() as conn:
        _site(conn, site_id)
        rows = conn.execute(
            text("SELECT b.id, b.name, b.origin, b.created_at, u.name AS by_name FROM social_transcript_batches b LEFT JOIN users u ON u.id = b.created_by WHERE b.site_id = :s ORDER BY b.created_at DESC, b.id DESC"),
            {"s": site_id},
        ).mappings().all()
        counts = conn.execute(
            text("SELECT batch_id, status, COUNT(*) AS n FROM social_transcripts WHERE site_id = :s GROUP BY batch_id, status"), {"s": site_id}
        ).mappings().all()
    by_batch: dict[int, list] = {}
    for row in counts:
        by_batch.setdefault(row["batch_id"], []).append(row)
    return {
        "site_id": site_id,
        "groq": _groq_connected(engine),
        "batches": [{"id": r["id"], "name": r["name"], "origin": r["origin"], "created_at": _iso(r["created_at"]), "by": r["by_name"], "counts": _counts(by_batch.get(r["id"], []))} for r in rows],
    }


def _batch_row(conn, batch_id) -> dict:
    row = conn.execute(text("SELECT * FROM social_transcript_batches WHERE id = :b"), {"b": batch_id}).mappings().first()
    if row is None:
        raise NotFound("That batch is gone.")
    return dict(row)


def _item(row) -> dict:
    return {
        "id": row["id"], "url": row["url"], "platform": row["platform"], "status": row["status"], "title": row["title"], "author": row["author"],
        "duration": row["duration"], "lang": row["lang"], "method": row["method"], "transcript": row["transcript"], "caption": row["caption"], "error": row["error"],
        "done_at": _iso(row["done_at"]),
    }


def batch(engine: Engine, batch_id: int) -> dict:
    with engine.connect() as conn:
        b = _batch_row(conn, batch_id)
        rows = conn.execute(text("SELECT * FROM social_transcripts WHERE batch_id = :b ORDER BY id"), {"b": batch_id}).mappings().all()
    items = [_item(r) for r in rows]
    counts = {"queued": 0, "working": 0, "done": 0, "failed": 0}
    for item in items:
        counts[item["status"]] += 1
    counts["total"] = len(items)
    return {"id": b["id"], "site_id": b["site_id"], "name": b["name"], "origin": b["origin"], "created_at": _iso(b["created_at"]), "counts": counts, "items": items}


def rename_batch(engine: Engine, batch_id: int, name) -> dict:
    label = name.strip()[:120] if isinstance(name, str) else ""
    if not label:
        raise Refused("Give the batch a name.")
    with engine.begin() as conn:
        _batch_row(conn, batch_id)
        conn.execute(text("UPDATE social_transcript_batches SET name = :n WHERE id = :b"), {"n": label, "b": batch_id})
    return batch(engine, batch_id)


def delete_batch(engine: Engine, batch_id: int) -> None:
    with engine.begin() as conn:
        _batch_row(conn, batch_id)
        ids = conn.execute(text("SELECT id FROM social_transcripts WHERE batch_id = :b AND status = 'queued'"), {"b": batch_id}).scalars().all()
        conn.execute(text("DELETE FROM social_transcript_batches WHERE id = :b"), {"b": batch_id})
    for transcript_id in ids:
        queue.cancel_queued(engine, f"{JOB_KIND}:{transcript_id}")


def retry(engine: Engine, transcript_id: int) -> dict:
    with engine.begin() as conn:
        row = conn.execute(text("SELECT batch_id, status FROM social_transcripts WHERE id = :t"), {"t": transcript_id}).mappings().first()
        if row is None:
            raise NotFound("That video is gone.")
        if row["status"] != "failed":
            raise Refused("Only a video that failed can be tried again.")
        conn.execute(text("UPDATE social_transcripts SET status = 'queued', error = NULL WHERE id = :t"), {"t": transcript_id})
    _enqueue(engine, transcript_id)
    return batch(engine, row["batch_id"])


def retry_failed(engine: Engine, batch_id: int) -> dict:
    with engine.begin() as conn:
        _batch_row(conn, batch_id)
        ids = conn.execute(text("SELECT id FROM social_transcripts WHERE batch_id = :b AND status = 'failed'"), {"b": batch_id}).scalars().all()
        conn.execute(text("UPDATE social_transcripts SET status = 'queued', error = NULL WHERE batch_id = :b AND status = 'failed'"), {"b": batch_id})
    for transcript_id in ids:
        _enqueue(engine, transcript_id)
    return batch(engine, batch_id)


# ---- the job: one video ------------------------------------------------------------------------------------------


def _groq_connected(engine: Engine) -> bool:
    with engine.connect() as conn:
        return conn.execute(text("SELECT 1 FROM connections WHERE tool = 'Groq'")).scalar() is not None


def _plain_error(message: str, platform: str) -> str:
    """yt-dlp's words, said the way the owner can act on."""
    low = message.lower()
    if platform == "instagram" and any(w in low for w in ("login", "log in", "429", "rate-limit", "rate limit", "cookies", "not available", "empty media")):
        return "Instagram wants a sign-in before it shares this video. Add your Instagram cookies under 'Instagram sign-in' at the foot of this tab, then try again."
    # TikTok says "Your IP address is blocked from accessing this post" for a video that doesn't exist (tried 2026-11-20 on
    # a made-up link, from the Mac): the same words as a deleted one, not a block on the server.
    if any(w in low for w in ("private", "this video is unavailable", "removed", "not found", "404", "does not exist", "ip address is blocked")):
        return "This video is private, removed, or the link is wrong."
    if "429" in low or "too many" in low:
        return f"{platform.title()} says too many requests. It will be tried again later."
    if "unsupported url" in low:
        return "That link isn't a video."
    return "Couldn't download this video. " + re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?", "", message).strip()[:160]


CAPTION_LANGS = ("ar", "fr", "en")  # the owner's languages first, then whatever the video has
CAPTION_FORMATS = ("vtt", "srt", "json3")


def _caption_text(raw: str, ext: str) -> str:
    """Plain words from a WebVTT, SRT or YouTube-style json3 caption file: no timings, no tags, no repeated lines."""
    if ext == "json3":
        import json

        try:
            events = json.loads(raw).get("events") or []
        except ValueError:
            return ""
        lines = ["".join(seg.get("utf8", "") for seg in e.get("segs") or []).strip() for e in events]
    else:
        lines = []
        for line in raw.splitlines():
            line = line.strip()
            if not line or line == "WEBVTT" or line.isdigit() or "-->" in line or re.match(r"^(NOTE|STYLE|REGION|Kind:|Language:)", line):
                continue
            lines.append(re.sub(r"<[^>]+>|\{[^}]*\}", "", html.unescape(line)).strip())
    out: list[str] = []
    for line in lines:
        if line and (not out or out[-1] != line):  # captions that scroll repeat each line two or three times
            out.append(line)
    return "\n".join(out).strip()


def _pick_caption(info: dict) -> tuple[str, dict] | None:
    """(language, track) of the best caption: written by the uploader over automatic ones, the owner's languages first."""
    for pool in (info.get("subtitles") or {}, info.get("automatic_captions") or {}):
        if not pool:
            continue
        codes = sorted(pool, key=lambda c: next((n for n, want in enumerate(CAPTION_LANGS) if c.lower().split("-")[0] == want), 99))
        for code in codes:
            tracks = [t for t in pool[code] or [] if t.get("url") and t.get("ext") in CAPTION_FORMATS]
            if tracks:
                tracks.sort(key=lambda t: CAPTION_FORMATS.index(t["ext"]))
                return code.split("-")[0].lower()[:10], tracks[0]
    return None


def _ydl_for(platform: str, folder: str, cookies: str | None):
    import yt_dlp

    options = _ydl_options(
        outtmpl=os.path.join(folder, "v.%(ext)s"),
        format=f"bestaudio[filesize<{GROQ_MAX_BYTES}]/bestaudio[filesize_approx<{GROQ_MAX_BYTES}]/worst[filesize<{GROQ_MAX_BYTES}]/worst",
        noplaylist=True,
        overwrites=True,
    )
    if cookies and platform == "instagram":
        jar = os.path.join(folder, "cookies.txt")
        Path(jar).write_text(cookies if cookies.startswith("# ") else "# Netscape HTTP Cookie File\n" + cookies)
        options["cookiefile"] = jar
    return yt_dlp.YoutubeDL(options)


def _read_video(url: str, platform: str, folder: str, cookies: str | None) -> tuple[dict, tuple[str, str] | None, Path | None]:
    """yt-dlp's facts about the video, then its captions when it has any (nothing downloaded), and otherwise the
    smallest file with its sound, for Groq. The facts come once and the download reuses them."""
    with _ydl_for(platform, folder, cookies) as ydl:
        info = ydl.extract_info(url, download=False) or {}
        picked = _pick_caption(info)
        if picked:
            code, track = picked
            try:
                words = _caption_text(ydl.urlopen(track["url"]).read().decode("utf-8", "replace"), track["ext"])
            except Exception:  # noqa: BLE001 - a caption that won't load: Groq writes the words instead
                words = ""
            if words:
                return info, (code, words), None
        if (info.get("duration") or 0) > MAX_SECONDS:
            raise Refused(f"This video has no captions and is over {MAX_SECONDS // 60} minutes. Only shorter ones go to Groq, to keep within its free hour.")
        ydl.process_ie_result(info, download=True)
    files = [p for p in Path(folder).iterdir() if p.name.startswith("v.") and p.suffix not in (".part", ".ytdl")]
    if not files:
        raise Refused("Couldn't download this video.")
    return info, None, files[0]


def _groq(engine: Engine, media: Path) -> dict:
    from seo.sources import service as sources

    key = sources.app_key(engine, "groq")
    if not key:
        raise Refused("Connect Groq first: paste its free key in this tab.")
    if media.stat().st_size > GROQ_MAX_BYTES:
        raise Refused("This video's sound is over 25 MB, Groq's free limit. Try a shorter video.")
    with media.open("rb") as handle:
        reply = http.request(
            "POST", GROQ_URL, "Groq", timeout=180, headers={"Authorization": f"Bearer {key}"},
            files={"file": (media.name, handle, "application/octet-stream")},
            data={"model": GROQ_MODEL, "response_format": "verbose_json", "temperature": "0"},
        )
    sources.note_app_key(engine, "groq", None)
    return reply.json()


def _lang(value) -> str | None:
    if not value:
        return None
    word = str(value).strip().lower()
    return _LANGS.get(word, word[:10])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _save(engine: Engine, transcript_id: int, **values) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in values)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE social_transcripts SET {sets} WHERE id = :id"), {**values, "id": transcript_id})


def _fail(engine: Engine, transcript_id: int, message: str) -> None:
    _save(engine, transcript_id, status="failed", error=message[:300], done_at=_utcnow())


def transcribe(engine: Engine, transcript_id: int, last_try: bool = False) -> None:
    """One video, start to finish. Safe to run twice: a done video is left alone."""
    from seo.sources import service as sources

    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, url, platform, status FROM social_transcripts WHERE id = :t"), {"t": transcript_id}).mappings().first()
    if row is None or row["status"] == "done":
        return
    _save(engine, transcript_id, status="working", error=None)
    cookies = sources.app_key(engine, "instagram") if row["platform"] == "instagram" else None
    try:
        with tempfile.TemporaryDirectory(prefix="seo-video-") as folder:
            try:
                info, captions, media = _read_video(row["url"], row["platform"], folder, cookies)
            except Refused as exc:
                return _fail(engine, transcript_id, str(exc))
            except Exception as exc:  # noqa: BLE001 - yt-dlp raises its own kinds; each is told plainly
                message = _plain_error(str(exc), row["platform"])
                if "tried again later" in message and not last_try:
                    _save(engine, transcript_id, status="queued", error=message)
                    raise Retry(message, backoff_seconds=600) from None
                return _fail(engine, transcript_id, message)
            facts = {
                "title": (info.get("title") or "")[:300] or None,
                "author": (info.get("uploader") or info.get("channel") or info.get("uploader_id") or "")[:150] or None,
                "duration": _seconds(info.get("duration")),
                "caption": (info.get("description") or "")[:20000] or None,
            }
            if captions:
                return _save(engine, transcript_id, **facts, status="done", method="captions", lang=captions[0], transcript=captions[1], error=None, done_at=_utcnow())
            _save(engine, transcript_id, **facts)
            try:
                answer = _groq(engine, media)
            except Refused as exc:
                return _fail(engine, transcript_id, str(exc))
            except SourceError as exc:
                sources.note_app_key(engine, "groq", str(exc))
                if exc.kind == "auth":
                    return _fail(engine, transcript_id, "Groq refused the key. Paste it again in this tab.")
                if last_try:
                    return _fail(engine, transcript_id, "Groq is busy or its free limit for now is used up. Try again later.")
                _save(engine, transcript_id, status="queued", error="Waiting for Groq: its free limit for now is used up.")
                raise Retry(str(exc), backoff_seconds=900 if exc.kind == "quota" else 120, patient=exc.kind == "quota") from None
    except Retry:
        raise
    words = re.sub(r"[ \t]+", " ", str(answer.get("text") or "")).strip()
    _save(
        engine, transcript_id, status="done", method="groq", transcript=words, lang=_lang(answer.get("language")), done_at=_utcnow(),
        error=None if words else "No words are spoken in this video.",
    )


@handler(JOB_KIND)
def run_job(job, engine: Engine) -> None:
    transcript_id = (job.payload or {}).get("id")
    if not isinstance(transcript_id, int):
        return
    last_try = job.attempts >= 2
    try:
        transcribe(engine, transcript_id, last_try=last_try)
    except Retry:
        raise
    except Exception:  # noqa: BLE001 - anything unforeseen: the video must not stay "working" on screen for ever
        if last_try:
            return _fail(engine, transcript_id, "Something went wrong writing this video out. Try it again.")
        _save(engine, transcript_id, status="queued")
        raise


# ---- downloads ---------------------------------------------------------------------------------------------------


def _minutes(seconds) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}" if isinstance(seconds, int) else ""


def download(engine: Engine, batch_id: int, kind: str) -> tuple[bytes, str, str]:
    """(file, its name, its type) for the whole batch: text, Excel or Word."""
    b = batch(engine, batch_id)
    done = [i for i in b["items"] if i["status"] == "done"]
    safe = re.sub(r"[\s\-]+", "-", re.sub(r"[^\w\- ]+", "", b["name"])).strip("-")[:60] or "transcripts"
    if kind == "txt":
        parts = []
        for n, item in enumerate(b["items"], 1):
            head = f"{n}. {item['title'] or item['url']}\n{item['url']}" + (f"\n{item['author']} · {_minutes(item['duration'])}" if item["author"] else "")
            body = item["transcript"] if item["status"] == "done" and item["transcript"] else f"[{item['error'] or 'Not written out yet.'}]"
            parts.append(f"{head}\n\n{body}")
        return ("\n\n" + "─" * 40 + "\n\n").join(parts).encode("utf-8-sig"), f"{safe}.txt", "text/plain; charset=utf-8"
    if kind == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font

        book = Workbook()
        sheet = book.active
        sheet.title = "Transcripts"
        sheet.append(["Video", "Platform", "Author", "Title", "Length", "Language", "Transcript", "Caption", "Note"])
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for item in b["items"]:
            sheet.append([
                item["url"], item["platform"].title(), item["author"] or "", item["title"] or "", _minutes(item["duration"]), item["lang"] or "",
                (item["transcript"] or "")[:32000], (item["caption"] or "")[:32000], "" if item["status"] == "done" and item["transcript"] else (item["error"] or "Not written out yet."),
            ])
        for col, width in zip("ABCDEFGHI", (40, 10, 18, 30, 8, 9, 80, 40, 30)):
            sheet.column_dimensions[col].width = width
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        out = io.BytesIO()
        book.save(out)
        return out.getvalue(), f"{safe}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if kind == "docx":
        return _docx(b["name"], done), f"{safe}.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    raise Refused("Pick text, Excel or Word.")


def _docx(title: str, items: list[dict]) -> bytes:
    """A plain Word file by hand: a heading per video, then its words. Arabic paragraphs run right to left."""
    from xml.sax.saxutils import escape

    def para(words: str, style: str | None = None, rtl: bool = False, small: bool = False) -> str:
        props = (f'<w:pStyle w:val="{style}"/>' if style else "") + ("<w:bidi/>" if rtl else "")
        run = ("<w:rPr>" + ("<w:rtl/>" if rtl else "") + ('<w:sz w:val="18"/><w:color w:val="666666"/>' if small else "") + "</w:rPr>") if (rtl or small) else ""
        return f'<w:p><w:pPr>{props}</w:pPr><w:r>{run}<w:t xml:space="preserve">{escape(words)}</w:t></w:r></w:p>'

    body = [para(title, "Title")]
    for item in items:
        rtl = item["lang"] in ("ar", "fa", "ur", "he")
        body.append(para(item["title"] or item["url"], "Heading1", rtl=rtl))
        body.append(para(" · ".join(x for x in (item["url"], item["author"], _minutes(item["duration"])) if x), small=True))
        for line in (item["transcript"] or "").split("\n"):
            if line.strip():
                body.append(para(line.strip(), rtl=rtl))
    if not items:
        body.append(para("No video in this batch has been written out yet."))
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + "".join(body) + "</w:body></w:document>"
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="360"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
        "</w:styles>"
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as box:
        box.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
        box.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        box.writestr("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        box.writestr("word/document.xml", document)
        box.writestr("word/styles.xml", styles)
    return out.getvalue()
