"""The test app for flow_video_transcripts.cjs: tests/ui/app_server.py with yt-dlp and Groq faked, so no video site and
no Groq server is reached and nothing is spent.

  DB_NAME_TEST=test_x_test DB_POOL_SIZE=2 .venv/bin/python tests/ui/transcripts_server.py --port 8233 --slow 0

The fake videos: a TikTok video whose number ends in 1 has captions; any other TikTok video has only sound, which the fake
Groq writes out (once a key is saved, as the real one needs); an Instagram video is refused as needing a sign-in, as
Instagram does from a server. A TikTok account lists 30 made-up videos. Every other option is app_server.py's.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from seo.social import transcripts  # noqa: E402
from tests.ui import app_server  # noqa: E402


def read_video(url: str, platform: str, folder: str, cookies: str | None):
    if platform == "instagram":
        raise Exception("ERROR: [Instagram] AbC123xyz: Requested content is not available, rate-limit reached or login required")
    number = url.rstrip("/").rsplit("/", 1)[-1]
    info = {"title": f"Made-up video {number[-2:]}", "uploader": "maker.test", "duration": 42, "description": "A made-up caption #test"}
    if number.endswith("1"):
        return info, ("en", "Hello, this is what the video says, from its own captions."), None
    media = Path(folder) / "v.m4a"
    media.write_bytes(b"made-up sound")
    return info, None, media


def groq(engine, media: Path) -> dict:
    from seo.sources import service as sources

    if not sources.app_key(engine, "groq"):
        raise transcripts.Refused("Connect Groq first: paste its free key in this tab.")
    return {"text": "Bonjour, voici ce que dit la vidéo, écrit par la fausse Groq.", "language": "french"}


def account_videos(url: str, count: int) -> list[dict]:
    return [{"url": f"https://www.tiktok.com/@maker.test/video/77000000000000001{n:02d}", "platform": "tiktok", "title": f"Made-up video {n}", "duration": 30 + n}
            for n in range(30)][:count]


def main() -> None:
    transcripts._read_video = read_video
    transcripts._groq = groq
    transcripts.account_videos = account_videos
    app_server.main()


if __name__ == "__main__":
    main()
