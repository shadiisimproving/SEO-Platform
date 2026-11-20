"""Social → Video transcripts: links found in text and files, a TikTok account's videos, batches, captions first then
Groq, and the downloads. yt-dlp and Groq are faked: no test reaches TikTok, Instagram or Groq. Made-up accounts only."""
import io
import json
import zipfile

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import http
from seo.core.errors import Refused
from seo.social import transcripts
from seo.sources import service as sources
from seo.web import create_app
from seo.worker import queue

TT = "https://www.tiktok.com/@maker.test/video/7700000000000000001"
TT2 = "https://www.tiktok.com/@maker.test/video/7700000000000000002"
IG = "https://www.instagram.com/reel/AbC123xyz/"


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid


@pytest.fixture
def client(engine):
    return create_app(engine=engine, auth=False).test_client()


@pytest.fixture
def groq(engine, monkeypatch):
    """A Groq key, and a fake Groq that hears Arabic. calls counts what reached it."""
    sources.save_app_key(engine, "groq", "gsk_test_key_1234")
    calls = []

    def answer(request):
        calls.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": []})
        return httpx.Response(200, json={"text": "  مرحبا بكم   في دبي ", "language": "Arabic", "duration": 12.0})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(answer))
    return calls


def fake_video(monkeypatch, *, captions=None, info=None, error=None):
    """Stands in for yt-dlp: the video's facts, its captions or a sound file, or yt-dlp's error."""

    def read(url, platform, folder, cookies):
        if error:
            raise Exception(error)
        facts = {"title": "Opening a company", "uploader": "maker.test", "duration": 42.4, "description": "Caption under the video #dubai", **(info or {})}
        if captions:
            return facts, captions, None
        sound = transcripts.Path(folder) / "v.m4a"
        sound.write_bytes(b"\0" * 1000)
        return facts, None, sound

    monkeypatch.setattr(transcripts, "_read_video", read)


# ---- links ----

def test_links_are_found_in_any_text_once_each_and_accounts_apart():
    words = f"""look {TT}?is_from_webapp=1&sender_device=pc, and {TT} again
    {IG.replace('/reel/', '/reels/')}?igsh=abc. Also https://www.instagram.com/p/Zz9_-k/ and https://vm.tiktok.com/ZMabc123/
    an account https://www.tiktok.com/@maker.test and https://example.com/not-a-video"""
    found = transcripts.find_links(words)
    assert [v["url"] for v in found["videos"]] == [TT, IG, "https://www.instagram.com/p/Zz9_-k/", "https://vm.tiktok.com/ZMabc123/"]
    assert [a["url"] for a in found["accounts"]] == ["https://www.tiktok.com/@maker.test"]
    assert found["too_many"] is False


def test_links_are_found_in_an_excel_file_whatever_the_column():
    from openpyxl import Workbook

    book = Workbook()
    book.active.append(["Name", "Notes", "Where"])
    book.active.append(["One", "seen it", TT])
    book.active.append(["Two", f"also {IG}", ""])
    book.active["D4"] = "click"
    book.active["D4"].hyperlink = TT2
    out = io.BytesIO()
    book.save(out)
    found = transcripts.links_in_file("list.xlsx", out.getvalue())
    assert {v["url"] for v in found["videos"]} == {TT, IG, TT2}


def test_links_are_found_in_csv_and_utf16_text():
    assert len(transcripts.links_in_file("a.csv", f"url\n{TT}\n{IG}\n".encode())["videos"]) == 2
    assert len(transcripts.links_in_file("a.txt", f"{TT}\n".encode("utf-16"))["videos"]) == 1


def test_an_old_office_file_or_a_huge_one_is_refused_plainly():
    with pytest.raises(Refused, match="old Office"):
        transcripts.links_in_file("list.xls", b"\xd0\xcf\x11\xe0")
    with pytest.raises(Refused, match="5 MB"):
        transcripts.links_in_file("list.txt", b"x" * (transcripts.MAX_FILE_BYTES + 1))


def test_an_instagram_account_cannot_be_listed():
    with pytest.raises(Refused, match="Instagram doesn't let"):
        transcripts.account_videos("https://www.instagram.com/maker.test/", 10)
    with pytest.raises(Refused, match="10, 25 or 50"):
        transcripts.account_videos("https://www.tiktok.com/@maker.test", 7)


def test_a_tiktok_accounts_videos_come_back_for_ticking(monkeypatch):
    import yt_dlp

    class Fake:
        def __init__(self, options):
            assert options["playlistend"] == 10 and options["extract_flat"] == "in_playlist"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download):
            assert url == "https://www.tiktok.com/@maker.test" and download is False
            return {"entries": [{"url": TT, "title": "First", "duration": 31}, {"url": TT2, "description": "Second"}]}

    monkeypatch.setattr(yt_dlp, "YoutubeDL", Fake)
    videos = transcripts.account_videos("https://www.tiktok.com/@maker.test/", 10)
    assert videos == [{"url": TT, "platform": "tiktok", "title": "First", "duration": 31}, {"url": TT2, "platform": "tiktok", "title": "Second", "duration": None}]


# ---- captions ----

def test_vtt_captions_become_plain_lines_without_repeats():
    vtt = "WEBVTT\n\n00:00.000 --> 00:01.000\n<c>Hello</c> there\n\n00:01.000 --> 00:02.000\nHello there\n\n2\n00:02.000 --> 00:03.000\nمرحبا &amp; أهلا\n"
    assert transcripts._caption_text(vtt, "vtt") == "Hello there\nمرحبا & أهلا"


def test_the_uploaders_captions_win_and_the_owners_languages_go_first():
    info = {
        "automatic_captions": {"ar": [{"ext": "vtt", "url": "https://c.test/auto-ar"}]},
        "subtitles": {"de": [{"ext": "vtt", "url": "https://c.test/de"}], "en-US": [{"ext": "json3", "url": "https://c.test/en.json"}, {"ext": "srt", "url": "https://c.test/en.srt"}]},
    }
    assert transcripts._pick_caption(info) == ("en", {"ext": "srt", "url": "https://c.test/en.srt"})
    assert transcripts._pick_caption({"subtitles": {}, "automatic_captions": {}}) is None


# ---- batches and the job ----

def jobs(engine):
    with engine.connect() as conn:
        return conn.execute(text("SELECT kind, lane, payload FROM jobs WHERE kind = :k ORDER BY id"), {"k": transcripts.JOB_KIND}).mappings().all()


def test_a_batch_queues_one_job_per_new_video(engine, site):
    made = transcripts.create_batch(engine, site, "  Rival – Nov ", "paste", [TT, f"{TT}?x=1", IG, "https://example.com"])
    assert made["name"] == "Rival – Nov" and made["counts"] == {"queued": 2, "working": 0, "done": 0, "failed": 0, "total": 2}
    assert [j["lane"] for j in jobs(engine)] == ["collectors", "collectors"]
    listed = transcripts.batches(engine, site)
    assert listed["groq"] is False and listed["batches"][0]["counts"]["total"] == 2


def test_a_batch_with_no_videos_or_too_many_is_refused(engine, site):
    with pytest.raises(Refused, match="No Instagram or TikTok"):
        transcripts.create_batch(engine, site, "x", "paste", ["https://example.com"])
    many = [f"https://www.tiktok.com/@m/video/{n}" for n in range(201)]
    with pytest.raises(Refused, match="Up to 200"):
        transcripts.create_batch(engine, site, "x", "file", many)


def test_captions_are_used_first_and_groq_is_not_called(engine, site, groq, monkeypatch):
    fake_video(monkeypatch, captions=("fr", "Bonjour à tous"))
    item = transcripts.create_batch(engine, site, "b", "paste", [TT])["items"][0]
    transcripts.transcribe(engine, item["id"])
    done = transcripts.batch(engine, made_id(engine))["items"][0]
    assert (done["status"], done["method"], done["lang"], done["transcript"]) == ("done", "captions", "fr", "Bonjour à tous")
    assert done["title"] == "Opening a company" and done["duration"] == 42 and done["caption"].startswith("Caption under")
    assert [c for c in groq if c.url.path.endswith("/transcriptions")] == []


def made_id(engine):
    with engine.connect() as conn:
        return conn.execute(text("SELECT MAX(id) FROM social_transcript_batches")).scalar()


def test_with_no_captions_groq_writes_the_words(engine, site, groq, monkeypatch):
    fake_video(monkeypatch)
    item = transcripts.create_batch(engine, site, "b", "paste", [TT])["items"][0]
    transcripts.transcribe(engine, item["id"])
    done = transcripts.batch(engine, made_id(engine))["items"][0]
    assert (done["status"], done["method"], done["lang"], done["transcript"]) == ("done", "groq", "ar", "مرحبا بكم في دبي")
    sent = [c for c in groq if c.url.path.endswith("/transcriptions")][0]
    assert sent.headers["Authorization"] == "Bearer gsk_test_key_1234" and b"whisper-large-v3-turbo" in sent.content
    transcripts.transcribe(engine, item["id"])  # a second run leaves a done video alone
    assert len([c for c in groq if c.url.path.endswith("/transcriptions")]) == 1


def test_no_groq_key_says_how_to_connect(engine, site, monkeypatch):
    fake_video(monkeypatch)
    item = transcripts.create_batch(engine, site, "b", "paste", [TT])["items"][0]
    transcripts.transcribe(engine, item["id"])
    failed = transcripts.batch(engine, made_id(engine))["items"][0]
    assert failed["status"] == "failed" and "Connect Groq" in failed["error"]


def test_groq_at_its_limit_waits_and_tries_again_then_gives_up(engine, site, monkeypatch):
    from seo.worker.runner import Retry

    sources.save_app_key(engine, "groq", "gsk_test_key_1234")
    monkeypatch.setattr(http, "transport", httpx.MockTransport(lambda r: httpx.Response(429, json={"error": {"message": "rate"}})))
    fake_video(monkeypatch)
    item = transcripts.create_batch(engine, site, "b", "paste", [TT])["items"][0]
    with pytest.raises(Retry):
        transcripts.transcribe(engine, item["id"])
    assert transcripts.batch(engine, made_id(engine))["items"][0]["status"] == "queued"
    transcripts.transcribe(engine, item["id"], last_try=True)
    assert transcripts.batch(engine, made_id(engine))["items"][0]["status"] == "failed"


def test_instagram_asking_for_a_sign_in_says_to_add_cookies(engine, site, groq, monkeypatch):
    fake_video(monkeypatch, error="ERROR: [Instagram] AbC123xyz: Requested content is not available, rate-limit reached or login required")
    item = transcripts.create_batch(engine, site, "b", "paste", [IG])["items"][0]
    transcripts.transcribe(engine, item["id"])
    failed = transcripts.batch(engine, made_id(engine))["items"][0]
    assert failed["status"] == "failed" and "Instagram cookies" in failed["error"]


def test_a_failed_video_can_be_tried_again(engine, site, groq, monkeypatch):
    fake_video(monkeypatch, error="ERROR: [TikTok] 1: This video is private")
    item = transcripts.create_batch(engine, site, "b", "paste", [TT])["items"][0]
    transcripts.transcribe(engine, item["id"])
    assert "private" in transcripts.batch(engine, made_id(engine))["items"][0]["error"]
    again = transcripts.retry(engine, item["id"])
    assert again["items"][0]["status"] == "queued" and again["items"][0]["error"] is None


def test_deleting_a_batch_drops_its_waiting_jobs(engine, site):
    made = transcripts.create_batch(engine, site, "b", "paste", [TT, TT2])
    transcripts.delete_batch(engine, made["id"])
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM social_transcripts")).scalar() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM jobs WHERE kind = :k AND status = 'queued'"), {"k": transcripts.JOB_KIND}).scalar() == 0


# ---- downloads ----

def test_the_batch_downloads_as_text_excel_and_word(engine, site, groq, monkeypatch):
    fake_video(monkeypatch)
    made = transcripts.create_batch(engine, site, "Rival Nov", "paste", [TT, TT2])
    transcripts.transcribe(engine, made["items"][0]["id"])
    words, name, _ = transcripts.download(engine, made["id"], "txt")
    assert name == "Rival-Nov.txt" and "مرحبا بكم في دبي" in words.decode("utf-8-sig") and "[Not written out yet.]" in words.decode("utf-8-sig")
    from openpyxl import load_workbook

    sheet = load_workbook(io.BytesIO(transcripts.download(engine, made["id"], "xlsx")[0])).active
    assert sheet["G2"].value == "مرحبا بكم في دبي" and sheet["I3"].value == "Not written out yet."
    with zipfile.ZipFile(io.BytesIO(transcripts.download(engine, made["id"], "docx")[0])) as box:
        doc = box.read("word/document.xml").decode()
    assert "مرحبا بكم في دبي" in doc and "<w:bidi/>" in doc


# ---- routes ----

def test_the_routes_make_list_and_download_a_batch(client, engine, site):
    found = client.post("/api/social/transcripts/find", json={"text": f"{TT} {IG}"}).get_json()
    assert len(found["videos"]) == 2
    made = client.post("/api/social/transcripts/batches", json={"site_id": site, "name": "N", "origin": "paste", "urls": [v["url"] for v in found["videos"]]}).get_json()
    assert made["counts"]["total"] == 2
    assert client.get(f"/api/social/transcripts?site_id={site}").get_json()["batches"][0]["id"] == made["id"]
    upload = client.post("/api/social/transcripts/file", data={"file": (io.BytesIO(f"{TT2}\n".encode()), "l.txt")}, content_type="multipart/form-data").get_json()
    assert upload["videos"][0]["url"] == TT2
    reply = client.get(f"/api/social/transcripts/batches/{made['id']}/download?format=xlsx")
    assert reply.status_code == 200 and "N.xlsx" in reply.headers["Content-Disposition"]
    assert client.patch(f"/api/social/transcripts/batches/{made['id']}", json={"name": "New"}).get_json()["name"] == "New"
    assert client.delete(f"/api/social/transcripts/batches/{made['id']}").get_json() == {"ok": True}


def test_the_groq_key_test_lists_models(engine, groq):
    assert sources.test_app_key(engine, "groq") == {"ok": True, "note": "Works."}
    assert groq[-1].url.path == "/openai/v1/models"
