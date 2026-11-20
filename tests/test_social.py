"""Social: the morning's sources (feeds, newsletters, Grok), the helpers' token, the drafts inbox, and the owner's screen.
Made-up sites only (seo-command-center-no-own-data-in-repo)."""
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import io
import zipfile

import httpx
import pytest
from sqlalchemy import text

from seo.social import gather, grok, service, skill
from seo.web import create_app

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def site(engine):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-one.test', 'https://shop-one.test/', 'own')")).lastrowid


@pytest.fixture
def other_site(engine):
    with engine.begin() as conn:
        return conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('shop-two.test', 'https://shop-two.test/', 'own')")).lastrowid


@pytest.fixture
def client(engine):
    return create_app(engine=engine, auth=False).test_client()


def rss(items):
    entries = "".join(f"<item><title>{t}</title><link>{l}</link><description>&lt;p&gt;{d} &lt;script&gt;bad()&lt;/script&gt;&lt;/p&gt;</description><pubDate>{p}</pubDate></item>" for t, l, d, p in items)
    return f'<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>{entries}</channel></rss>'.encode()


def rfc(moment):
    return moment.strftime("%a, %d %b %Y %H:%M:%S GMT")


@pytest.fixture
def web(monkeypatch):
    """Feeds and X's oEmbed on made-up addresses."""
    pages = {}

    def answer(request):
        found = pages.get(str(request.url).split("?")[0])
        if found is None:
            return httpx.Response(404)
        status, body, headers = found
        return httpx.Response(status, content=body, headers=headers)

    monkeypatch.setattr(gather, "transport", httpx.MockTransport(answer))
    monkeypatch.setattr(gather, "url_allowed", lambda url: "internal" not in url)
    return pages


# ---- feeds -------------------------------------------------------------------------------------------------------

def test_a_feed_gives_plain_text_topics_once_and_skips_old_ones(engine, site, web):
    web["https://news.test/feed"] = (200, rss([
        ("New visa rules", "https://news.test/visa", "The rules change", rfc(NOW - timedelta(hours=3))),
        ("Old story", "https://news.test/old", "Last month", rfc(NOW - timedelta(days=9))),
    ]), {})
    service.add_source(engine, site, "rss", "https://news.test/feed")
    first = service.gather_feeds(engine, site, service.today())
    again = service.gather_feeds(engine, site, service.today())
    assert first["added"] == 1 and again["added"] == 0
    with engine.connect() as conn:
        row = conn.execute(text("SELECT title, link, summary FROM social_topics WHERE site_id = :s"), {"s": site}).mappings().one()
    assert row["title"] == "New visa rules" and row["link"] == "https://news.test/visa"
    assert "script" not in row["summary"] and "bad()" not in row["summary"] and "<" not in row["summary"]


def test_an_atom_feed_is_read_too():
    body = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Tax news</title><link rel="alternate" href="https://news.test/tax"/><updated>2026-11-19T08:00:00Z</updated><summary>Short</summary></entry></feed>'
    [entry] = gather.parse_feed(body)
    assert entry["title"] == "Tax news" and entry["link"] == "https://news.test/tax" and entry["published_at"] == datetime(2026, 11, 19, 8)


def test_a_feed_redirecting_to_a_private_address_is_refused(engine, site, web):
    web["https://news.test/moved"] = (302, b"", {"location": "http://internal.test/admin"})
    service.add_source(engine, site, "rss", "https://news.test/moved")
    done = service.gather_feeds(engine, site, service.today())
    assert done["added"] == 0 and "isn't public" in done["errors"][0]
    with engine.connect() as conn:
        assert "isn't public" in conn.execute(text("SELECT last_error FROM social_sources")).scalar()


def test_a_feed_with_its_own_entities_is_not_read():
    with pytest.raises(ValueError):
        gather.parse_feed(b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa">]><rss><channel><item><title>&a;</title></item></channel></rss>')


def test_one_broken_feed_does_not_stop_the_others(engine, site, web):
    web["https://news.test/good"] = (200, rss([("Good one", "https://news.test/g", "x", rfc(NOW))]), {})
    service.add_source(engine, site, "rss", "https://news.test/broken")
    service.add_source(engine, site, "rss", "https://news.test/good")
    done = service.gather_feeds(engine, site, service.today())
    assert done["added"] == 1 and len(done["errors"]) == 1
    assert service.day_view(engine, site)["stages"]["rss"]["ok"] is True


# ---- newsletters -------------------------------------------------------------------------------------------------

def mail(sender, subject, html_body):
    message = EmailMessage()
    message["From"], message["Subject"], message["Date"] = sender, subject, rfc(NOW)
    message["Message-ID"] = f"<{subject.replace(' ', '')}@mail.test>"
    message.set_content("plain")
    message.add_alternative(html_body, subtype="html")
    return gather.parse_mail(message.as_bytes())


def test_only_newsletters_from_allowed_senders_become_topics(engine, site):
    service.add_source(engine, site, "mail", "Letters@News.test")
    service.save_mailbox(engine, site, {"host": "imap.mail.test", "user": "box@mail.test", "password": "secret"})
    mails = [
        mail("News <letters@news.test>", "This week in tax", '<p>Big change</p><a href="https://news.test/web-version">View online</a>'),
        mail("Spam <deals@spam.test>", "Buy now", "<p>cheap</p>"),
        mail("News <letters@news.test>", "Please confirm your subscription", '<a href="https://news.test/confirm">Confirm</a>'),
    ]
    seen = {}

    def read(host, user, password, since):
        seen.update(host=host, password=password)
        return mails

    done = service.gather_mail(engine, site, service.today(), read=read)
    assert seen == {"host": "imap.mail.test", "password": "secret"}
    assert done == {"added": 1, "confirmations": 1}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT title, link FROM social_topics")).one() == ("This week in tax", "https://news.test/web-version")
    stages = service.day_view(engine, site)["stages"]
    assert stages["mail"]["confirmations"][0]["links"] == ["https://news.test/confirm"]


def test_the_mailbox_password_is_sealed(engine, site):
    service.save_mailbox(engine, site, {"host": "imap.mail.test", "user": "box@mail.test", "password": "secret"})
    with engine.connect() as conn:
        assert "secret" not in conn.execute(text("SELECT mail_secret FROM social_settings")).scalar()
    assert service.settings(engine, site)["mail"] == {"host": "imap.mail.test", "user": "box@mail.test", "set": True}


# ---- Grok ---------------------------------------------------------------------------------------------------------

GROK_ANSWER = """Here you go:
```json
{"trends": [{"topic": "Visa news", "why": "Many posts", "links": ["https://twitter.com/a_user/status/123456789", "https://evil.test/x"]}],
 "targets": [
   {"url": "https://x.com/real_one/status/111111", "author": "@real_one", "text": "What do you think?", "lang": "en", "posted_at": "%s"},
   {"url": "https://x.com/made_up/status/222222", "author": "@made_up", "text": "Invented", "lang": "ar", "posted_at": "%s"},
   {"url": "https://x.com/old_one/status/333333", "author": "@old_one", "text": "Old", "lang": "en", "posted_at": "%s"},
   {"url": "https://evil.test/status/444444", "author": "x", "text": "Not X", "lang": "en"},
   {"url": "https://x.com/arabic/status/555555", "author": "@arabic", "text": "سؤال", "lang": "Arabic", "posted_at": "%s"}
 ]}
```"""


def answer_now():
    stamp = (NOW - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    old = (NOW - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return GROK_ANSWER % (stamp, stamp, old, stamp)


def test_grok_targets_keep_only_real_recent_x_posts():
    found = grok.research("tax", NOW, run=lambda prompt: answer_now(), check=lambda url: "made_up" not in url)
    assert [t["url"] for t in found["targets"]] == ["https://x.com/real_one/status/111111", "https://x.com/arabic/status/555555"]
    assert [t["lang"] for t in found["targets"]] == ["en", "ar"]
    assert found["trends"][0]["links"] == ["https://x.com/a_user/status/123456789"]


def test_grok_never_runs_with_an_api_key(monkeypatch):
    seen = {}

    def fake(cmd, **kw):
        seen["env"] = kw["env"]
        return type("Done", (), {"returncode": 0, "stdout": "{}", "stderr": ""})()

    monkeypatch.setenv("XAI_API_KEY", "paid")
    monkeypatch.setenv("GROK_CODE_XAI_API_KEY", "paid")
    monkeypatch.setattr(grok.subprocess, "run", fake)
    grok.ask("hi")
    assert "XAI_API_KEY" not in seen["env"] and "GROK_CODE_XAI_API_KEY" not in seen["env"]


def test_a_signed_out_grok_says_how_to_sign_in(monkeypatch):
    monkeypatch.setattr(grok.subprocess, "run", lambda cmd, **kw: type("Done", (), {"returncode": 1, "stdout": "", "stderr": "Error: not logged in"})())
    with pytest.raises(grok.GrokFailed, match="grok login --device-auth"):
        grok.ask("hi")


def test_a_failed_grok_run_is_shown_and_the_day_goes_on(engine, site):
    def broken(niche, now):
        raise grok.GrokFailed("Grok is signed out. On the server, run: grok login --device-auth")

    service.gather_grok(engine, site, service.today(), research=broken)
    stage = service.day_view(engine, site)["stages"]["grok"]
    assert stage["ok"] is False and "grok login" in stage["error"]


def test_grok_results_become_comment_targets_and_trends(engine, site):
    found = grok.clean(grok.parse(answer_now()), NOW, check=lambda url: True)
    service.gather_grok(engine, site, service.today(), research=lambda niche, now: found)
    view = service.day_view(engine, site)
    assert view["waiting_comments"] == 3 and view["comments"] == []  # no words yet: they wait for the writing
    assert view["trends"][0]["topic"] == "Visa news"


# ---- the helpers' token and the inbox ------------------------------------------------------------------------------

def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_the_helper_routes_need_the_sites_token(client, engine, site, other_site):
    token = service.new_token(engine, site)["token"]
    service.new_token(engine, other_site)
    assert client.get("/api/social/bot/brief").status_code == 401
    assert client.get("/api/social/bot/brief", headers=bearer("scs_wrong")).status_code == 401
    brief = client.get("/api/social/bot/brief", headers=bearer(token)).get_json()
    assert brief["date"] == service.today().isoformat() and brief["posts_wanted"] == {"x": 2, "linkedin": 2}
    with engine.connect() as conn:
        assert token not in str(conn.execute(text("SELECT token_hash FROM social_settings")).all())


def test_a_new_token_stops_the_old_one(client, engine, site):
    old = service.new_token(engine, site)["token"]
    new = service.new_token(engine, site)["token"]
    assert client.get("/api/social/bot/brief", headers=bearer(old)).status_code == 401
    assert client.get("/api/social/bot/brief", headers=bearer(new)).status_code == 200


def test_the_helper_routes_work_with_login_on_and_no_session(engine, site):
    app = create_app(engine=engine, auth=True, secret_key="test").test_client()
    token = service.new_token(engine, site)["token"]
    assert app.get("/api/social/bot/brief", headers=bearer(token)).status_code == 200
    assert app.get("/api/social/day?site_id=%d" % site).status_code == 401  # the owner's screen still needs signing in
    assert app.post("/api/social/bot/inbox", headers=bearer(token), json={"posts": []}).status_code == 200  # no CSRF: no cookie to ride


def test_a_large_upload_is_refused(client, engine, site):
    token = service.new_token(engine, site)["token"]
    reply = client.post("/api/social/bot/inbox", headers=bearer(token), data="x" * (600 * 1024), content_type="application/json")
    assert reply.status_code == 413


def topic(engine, site, title="New visa rules", link="https://news.test/visa"):
    with engine.begin() as conn:
        service._save_topic(conn, site, "rss", None, title, link, "summary", NOW)
        return conn.execute(text("SELECT id FROM social_topics WHERE link = :l"), {"l": link}).scalar()


def test_drafts_arrive_once_with_the_bell_and_sending_again_changes_nothing(client, engine, site):
    token = service.new_token(engine, site)["token"]
    topic_id = topic(engine, site)
    service.add_targets(engine, site, [{"url": "https://x.com/someone/status/999999", "text": "Question?", "lang": "en"}])
    target = service.brief(engine, site)["comments_wanted"][0]
    body = {"posts": [{"platform": "x", "topic_id": topic_id, "text": "منشور عن التأشيرات"}, {"platform": "linkedin", "topic_id": topic_id, "text": "منشور أطول"}],
            "comments": [{"item_id": target["id"], "text": "Great question: it depends on the visa."}]}
    first = client.post("/api/social/bot/inbox", headers=bearer(token), json=body).get_json()
    again = client.post("/api/social/bot/inbox", headers=bearer(token), json=body).get_json()
    assert (first["posts"], first["comments"]) == (2, 1) and (again["posts"], again["comments"]) == (0, 0)
    view = service.day_view(engine, site)
    assert [p["platform"] for p in view["posts"]] == ["linkedin", "x"] and view["posts"][0]["topic_link"] == "https://news.test/visa"
    assert view["comments"][0]["lang"] == "en" and view["comments"][0]["text"].startswith("Great question")
    with engine.connect() as conn:
        bell = conn.execute(text("SELECT kind, title FROM notifications WHERE site_id = :s"), {"s": site}).all()
    assert bell == [("social_ready", "2 posts and 1 comment ready to check")]
    assert service.brief(engine, site)["topics"] == []  # a topic already posted about isn't offered again


def test_a_comment_keeps_the_language_of_its_post(engine, site):
    service.add_targets(engine, site, [{"url": "https://x.com/someone/status/1234567", "lang": "ar"}, {"url": "https://www.linkedin.com/posts/someone-activity-1", "lang": "en", "text": "Post"}])
    wanted = service.brief(engine, site)["comments_wanted"]
    assert sorted((w["platform"], w["lang"]) for w in wanted) == [("linkedin", "en"), ("x", "ar")]


def test_only_x_and_linkedin_posts_can_be_comment_targets(engine, site):
    added = service.add_targets(engine, site, [{"url": "https://evil.test/status/1"}, {"url": "javascript:alert(1)"}, {"url": "https://x.com/ok_one/status/77777"}])
    assert added == 1


def test_an_owner_edit_is_never_overwritten_by_the_helper(client, engine, site):
    token = service.new_token(engine, site)["token"]
    service.add_targets(engine, site, [{"url": "https://x.com/someone/status/999999"}])
    item_id = service.brief(engine, site)["comments_wanted"][0]["id"]
    client.post("/api/social/bot/inbox", headers=bearer(token), json={"comments": [{"item_id": item_id, "text": "first"}]})
    service.update_item(engine, item_id, {"text": "mine"})
    client.post("/api/social/bot/inbox", headers=bearer(token), json={"comments": [{"item_id": item_id, "text": "second"}]})
    assert service.day_view(engine, site)["comments"][0]["text"] == "mine"


def test_a_rewrite_with_my_angle_goes_back_to_the_helper(client, engine, site):
    token = service.new_token(engine, site)["token"]
    topic_id = topic(engine, site)
    client.post("/api/social/bot/inbox", headers=bearer(token), json={"posts": [{"platform": "x", "topic_id": topic_id, "text": "draft"}]})
    item_id = service.day_view(engine, site)["posts"][0]["id"]
    service.update_item(engine, item_id, {"angle": "Talk about the cost", "status": "rewrite"})
    [wanted] = service.brief(engine, site)["rewrites_wanted"]
    assert wanted["id"] == item_id and wanted["angle"] == "Talk about the cost"
    client.post("/api/social/bot/inbox", headers=bearer(token), json={"comments": [{"item_id": item_id, "text": "better"}]})
    post = service.day_view(engine, site)["posts"][0]
    assert post["status"] == "new" and post["text"] == "better"


def test_the_helper_can_say_its_step_failed(client, engine, site):
    token = service.new_token(engine, site)["token"]
    client.post("/api/social/bot/inbox", headers=bearer(token), json={"error": "Claude couldn't read the brief"})
    assert service.day_view(engine, site)["stages"]["writing"] == {**service.day_view(engine, site)["stages"]["writing"], "ok": False, "error": "Claude couldn't read the brief"}


# ---- what the guide learns ------------------------------------------------------------------------------------------

def test_only_posted_items_and_skips_with_a_reason_teach_the_guide(client, engine, site):
    token = service.new_token(engine, site)["token"]
    ids = [topic(engine, site, f"Topic {n}", f"https://news.test/{n}") for n in range(4)]
    client.post("/api/social/bot/inbox", headers=bearer(token), json={"posts": [{"platform": "x", "topic_id": i, "text": f"draft {n}"} for n, i in enumerate(ids)]})
    items = sorted(service.day_view(engine, site)["posts"], key=lambda p: p["text"])
    service.update_item(engine, items[0]["id"], {"text": "my words", "status": "posted"})
    service.update_item(engine, items[1]["id"], {"status": "posted"})
    service.update_item(engine, items[2]["id"], {"text": "approved only", "status": "approved"})
    service.update_item(engine, items[3]["id"], {"status": "skipped", "reason": "Too formal"})
    learned = service.brief(engine, site)["examples"]
    assert [(e["draft"], e["final"]) for e in learned["edited"]] == [("draft 0", "my words")]
    assert [e["text"] for e in learned["posted_as_written"]] == ["draft 1"]
    assert [(e["draft"], e["reason"]) for e in learned["skipped"]] == [("draft 3", "Too formal")]


def test_rules_and_suggestions(client, engine, site):
    token = service.new_token(engine, site)["token"]
    service.add_rule(engine, site, "Never start with a question")
    client.post("/api/social/bot/inbox", headers=bearer(token), json={"proposals": [{"text": "Shorter openings", "why": "You cut 4 of 5"}]})
    settings = service.settings(engine, site)
    assert [r["text"] for r in settings["rules"]] == ["Never start with a question"] and settings["guide_version"] == 2
    service.answer_proposal(engine, site, settings["proposals"][0]["id"], accept=True)
    assert service.brief(engine, site)["rules"] == ["Never start with a question", "Shorter openings"]


def test_saving_the_same_guide_keeps_its_version(engine, site):
    service.save_guide(engine, site, {"guide": "Write warm"})
    service.save_guide(engine, site, {"guide": "Write warm"})
    assert service.settings(engine, site)["guide_version"] == 2


# ---- the owner's screen ---------------------------------------------------------------------------------------------

def test_the_screen_routes(client, engine, site):
    assert client.get(f"/api/social/day?site_id={site}").get_json()["set_up"] == {"token": False, "sources": 0}
    reply = client.post("/api/social/targets", json={"site_id": site, "url": "https://x.com/someone/status/42424242?s=20", "lang": "ar"})
    assert reply.status_code == 200 and reply.get_json()["waiting_comments"] == 1
    assert client.post("/api/social/targets", json={"site_id": site, "url": "https://example.test/post"}).status_code == 400
    assert client.post("/api/social/sources", json={"site_id": site, "kind": "rss", "address": "not a link"}).status_code == 400
    assert client.post("/api/social/rules", json={"site_id": site, "text": "Short"}).get_json()["rules"][0]["text"] == "Short"
    assert client.patch("/api/social/items/999999", json={"status": "posted"}).status_code == 404


def test_a_draft_with_no_words_cannot_be_approved(engine, site):
    service.add_targets(engine, site, [{"url": "https://x.com/someone/status/999999"}])
    item_id = service.brief(engine, site)["comments_wanted"][0]["id"]
    with pytest.raises(Exception, match="no words"):
        service.update_item(engine, item_id, {"status": "approved"})


def test_the_cron_reads_every_site_with_social_set_up(engine, site, other_site, web):
    web["https://news.test/feed"] = (200, rss([("One", "https://news.test/1", "x", rfc(NOW))]), {})
    service.add_source(engine, site, "rss", "https://news.test/feed")
    done = service.gather_day(engine, with_grok=False)
    assert [d["site_id"] for d in done] == [site] and done[0]["rss"]["added"] == 1


# ---- the owner's own writing skill ----------------------------------------------------------------------------------

SKILL_MD = "---\nname: warm-writer\ndescription: Writes posts.\n---\n\n# Warm writer\n\nOpen with a number."


def zipped(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for path, body in files.items():
            archive.writestr(path, body)
    return out.getvalue()


def test_a_zipped_skill_becomes_the_guide_with_skill_md_first():
    name, guide = skill.read("warm-writer.zip", zipped({
        "warm-writer/examples/liked.md": "Liked post",
        "warm-writer/SKILL.md": SKILL_MD,
        "warm-writer/references/style.md": "Never use hashtags.",
        "warm-writer/scripts/run.py": "print('not read')",
        "__MACOSX/warm-writer/._SKILL.md": "junk",
        "warm-writer/.hidden.md": "hidden",
    }))
    assert name == "warm-writer"
    assert guide.startswith("# Skill: warm-writer\n\n---\nname: warm-writer")
    assert guide.index("Open with a number") < guide.index("## File: examples/liked.md") < guide.index("## File: references/style.md")
    assert "not read" not in guide and "junk" not in guide and "hidden" not in guide


def test_a_skill_md_alone_works_and_bad_files_say_why():
    assert skill.read("SKILL.md", SKILL_MD.encode())[0] == "warm-writer"
    for filename, data, why in [
        ("notes.zip", zipped({"notes/readme.md": "x"}), "no SKILL.md"),
        ("photo.png", b"\x89PNG", "or as a .zip"),
        ("big.zip", b"x" * (skill.MAX_UPLOAD + 1), "over 2 MB"),
        ("broken.zip", b"not a zip", "isn't a zip"),
        ("long.md", ("y" * (skill.GUIDE_LIMIT + 10)).encode(), "holds up to"),
    ]:
        with pytest.raises(service.Refused, match=why):
            skill.read(filename, data)


def test_uploading_a_skill_replaces_the_guide_and_keeps_the_rules(client, engine, site):
    service.add_rule(engine, site, "Say we, not I")
    before = service.settings(engine, site)["guide_version"]
    reply = client.post("/api/social/skill", data={"site_id": str(site), "file": (io.BytesIO(SKILL_MD.encode()), "SKILL.md")},
                        content_type="multipart/form-data")
    view = reply.get_json()
    assert reply.status_code == 200 and view["skill"] == "warm-writer"
    assert view["guide"].startswith("# Skill: warm-writer") and view["guide_version"] == before + 1
    assert [r["text"] for r in view["rules"]] == ["Say we, not I"]
    assert client.post("/api/social/skill", data={"site_id": str(site)}, content_type="multipart/form-data").status_code == 400
