"""Clarity's dashboard downloads: totals for a period, kept as one snapshot per site, kind and period.

The CSVs here copy the layout of Clarity's real exports (Dashboard → Export, November 2026) with made-up numbers.
"""
import io
from datetime import date

import pytest
from sqlalchemy import text

from seo.accounts import service as accounts
from seo.core.errors import Refused
from seo.imports import clarity_reports as reports
from seo.links import service as links
from seo.web import create_app

PASSWORD = "correct horse battery"

DASHBOARD = '''﻿"Project name","Mine Project"
"Date range","07/31/2026 12:00 AM - 11/06/2026 11:59 PM"


"Metric","Sessions"
"","Total sessions","1000"
"","Bot sessions","400"

"Metric","Pages per session"
"","Average","1.5"

"Metric","Scroll depth"
"","Average","44.34"

"Metric","Active time spent"
"","Active time","90"
"","Total time","200"

"Metric","Users overview"
"","Unique users","900"
"","Sessions with new users","950"
"","Sessions with returning users","50"

"Metric","Insights","No. of sessions","% of sessions"
"","Rage clicks","7","0.70%"
"","Dead click","47","4.70%"
"","Excessive scrolling","0","0%"
"","Quick back click","11","1.10%"

"Metric","Browsers","No. of sessions","% of sessions"
"","Chrome","600","60.00%"
"","MobileSafari","400","40.00%"

"Metric","Top pages","No. of sessions"
"","https://www.mine.example/","300"
"","https://www.mine.example/contact/","20"

"Metric","Smart events","No. of sessions","% of sessions"
"","Contact us","17","1.70%"

"Metric","Referrer","No. of sessions"
"","www.mine.example","210"
"","www.google.com","60"
"","spam-crm.example","9"

"Metric","JavaScript errors"
"","Sessions with JavaScript errors"
""," total JavaScript errors","3"
"","","No. of sessions","% of sessions"
"","script error.","2","66%"

"Metric","Performance overview"
"","Score","72.8"
"","LCP (Largest Contentful Paint)","6.741s"
"","INP (Interaction to Next Paint)","320ms"
"","CLS (Cumulative Layout Shift)","0.025s"

"Metric","Google Ads"
"","Campaign name","Status","number of sessions","Intent","High intent sessions","Medium intent sessions","Low intent sessions"

"Metric","Bot traffic"
"webScraperBotSessions","0"
"suspiciousDeviceBotSessions","120"
"suspiciousInteractionBotSessions","400"
"__typename","BotTypes"
'''

AI_WITH_QUESTIONS = '''﻿"Project name","Mine Project"
"Date range","07/31/2026 12:00 AM - 11/06/2026 11:59 PM"


"Metric","Share of authority (SoA)","24.09"

"Query","Citations","SoA"
"open a company","53","36.30%"
"vat rate","17","47.22%"

"Page URL","Citations"
"https://www.mine.example/guide/","239"
"https://www.mine.example/","132"

"Metric","Page citations","371"

"Metric","AI referral traffic","6"
'''

AI_WITHOUT_QUESTIONS = AI_WITH_QUESTIONS.replace('"Query","Citations","SoA"\n"open a company","53","36.30%"\n"vat rate","17","47.22%"\n\n', "").replace('"371"', '"380"')

AI_SHARE_TABLE = '''﻿"Project name","Other"
"Date range","07/31/2026 12:00 AM - 11/06/2026 11:59 PM"


"Metric","Share of authority (SoA)","Citations","Percentage"
"","You","354","13.76%"
"","All other domains","2218","86.24%"


"Page URL","Citations"
"https://www.mine.example/zones/","120"

"Metric","Page citations","354"

"Metric","AI referral traffic","4"
'''


@pytest.fixture
def site(engine):
    return links.add_site(engine, "https://www.mine.example/", "own", is_allowed=lambda _: True)["id"]


def _files(*bodies):
    return [(f"Clarity_Mine_Dashboard_{i}.csv", body.encode("utf-8")) for i, body in enumerate(bodies)]


def _stored(engine):
    with engine.connect() as conn:
        return conn.execute(text("SELECT site_id, kind, period_start, period_end FROM clarity_reports ORDER BY kind")).all()


# ---- reading ---------------------------------------------------------------------------------------
def test_a_dashboard_file_is_read_whole():
    report = reports.parse(DASHBOARD.encode())
    assert report["period_start"] == date(2026, 7, 31) and report["period_end"] == date(2026, 11, 6)
    assert report["project_name"] == "Mine Project"
    d = report["sections"]["dashboard"]
    assert d["sessions"] == 1000 and d["bot_sessions"] == 400 and d["scroll_depth"] == 44.34
    assert d["insights"]["dead_clicks"] == {"sessions": 47, "share": 4.7}
    assert d["performance"] == {"score": 72.8, "lcp_ms": 6741, "inp_ms": 320, "cls": 0.025}
    assert d["js_errors"] == {"total": 3, "top": [{"message": "script error.", "sessions": 2}]}
    assert d["bots"] == {"web_scraper": 0, "suspicious_device": 120, "suspicious_interaction": 400}
    assert [r["source"] for r in d["referrers"]] == ["www.mine.example", "www.google.com", "spam-crm.example"]
    assert "ai" not in report["sections"]


def test_both_ways_clarity_writes_the_share_of_authority():
    one = reports.parse(AI_WITH_QUESTIONS.encode())["sections"]["ai"]
    assert one["share_of_authority"] == 24.09 and one["citations"] == 371 and one["ai_referral_sessions"] == 6
    assert one["queries"][0] == {"query": "open a company", "citations": 53, "share": 36.3}
    table = reports.parse(AI_SHARE_TABLE.encode())["sections"]["ai"]
    assert table["share_of_authority"] == 13.76 and table["your_citations"] == 354 and table["others_citations"] == 2218
    assert "queries" not in table, "a file without the questions table says nothing about questions"


@pytest.mark.parametrize("body", [b"", b"just,some\ncsv,data\n", b"\xff\xfe\x00junk", '"Project name","X"\n"Date range","yesterday"\n\n"Metric","Sessions"\n'.encode(),
                                  '"Project name","X"\n"Date range","13/45/2026 12:00 AM - 11/06/2026 11:59 PM"\n'.encode(),
                                  '"Project name","X"\n"Date range","11/06/2026 12:00 AM - 07/31/2026 11:59 PM"\n\n"Metric","Sessions"\n"","Total sessions","1"\n'.encode(),
                                  '"Project name","X"\n"Date range","07/31/2026 12:00 AM - 11/06/2026 11:59 PM"\n\n"Something","else"\n'.encode()])
def test_files_that_arent_clarity_downloads_are_refused(body):
    with pytest.raises(Refused):
        reports.parse(body)


# ---- saving ----------------------------------------------------------------------------------------
def test_the_site_is_found_from_the_page_addresses(engine, site):
    answer = reports.import_files(engine, _files(DASHBOARD, AI_WITH_QUESTIONS))
    assert [f.get("error") for f in answer["files"]] == [None, None]
    assert {f["host"] for f in answer["files"]} == {"mine.example"}
    assert _stored(engine) == [(site, "ai", date(2026, 7, 31), date(2026, 11, 6)), (site, "dashboard", date(2026, 7, 31), date(2026, 11, 6))]


def test_a_preview_writes_nothing(engine, site):
    answer = reports.import_files(engine, _files(DASHBOARD), preview=True)
    assert answer["files"][0]["kinds"] == [{"kind": "dashboard", "replaces": False, "summary": {"sessions": 1000, "bot_sessions": 400}}]
    assert _stored(engine) == []


def test_a_file_for_a_site_not_in_the_app_is_refused_and_the_others_still_go_in(engine, site):
    stranger = DASHBOARD.replace("www.mine.example/", "www.stranger.example/")
    answer = reports.import_files(engine, _files(stranger, DASHBOARD))
    assert "stranger.example" in answer["files"][0]["error"] and "error" not in answer["files"][1]
    assert len(_stored(engine)) == 1


def test_a_competitor_is_never_given_my_clarity_numbers(engine, site):
    links.add_site(engine, "https://rival.example/", "competitor", is_allowed=lambda _: True)
    answer = reports.import_files(engine, _files(DASHBOARD.replace("www.mine.example/", "rival.example/")))
    assert "isn't one of your sites" in answer["files"][0]["error"]
    assert _stored(engine) == []


def test_a_file_with_no_addresses_needs_the_site_picked(engine, site):
    bare = AI_SHARE_TABLE.replace('"Page URL","Citations"\n"https://www.mine.example/zones/","120"\n\n', "")
    assert "Pick the site" in reports.import_files(engine, _files(bare))["files"][0]["error"]
    assert "error" not in reports.import_files(engine, _files(bare), site_id=site)["files"][0]
    with pytest.raises(Refused):
        reports.import_files(engine, _files(bare), site_id=site + 999)


def test_uploading_the_same_period_again_replaces_it_and_keeps_what_the_new_file_left_out(engine, site):
    reports.import_files(engine, _files(AI_WITH_QUESTIONS))
    answer = reports.import_files(engine, _files(AI_WITHOUT_QUESTIONS))
    assert answer["files"][0]["kinds"][0]["replaces"] is True
    assert len(_stored(engine)) == 1
    ai = reports.latest(engine, [site])["sites"][0]["ai"]
    assert ai["citations"] == 380, "the newer file's numbers win"
    assert len(ai["queries"]) == 2, "the questions from the first file stay"


def test_wrong_names_too_many_and_oversized_files(engine, site):
    assert "csv" in reports.import_files(engine, [("export.xlsx", DASHBOARD.encode())])["files"][0]["error"]
    assert "too large" in reports.import_files(engine, [("big.csv", b"x" * (reports.MAX_BYTES + 1))])["files"][0]["error"]
    with pytest.raises(Refused):
        reports.import_files(engine, _files(*[DASHBOARD] * (reports.MAX_FILES + 1)))
    with pytest.raises(Refused):
        reports.import_files(engine, [])


# ---- reading back ----------------------------------------------------------------------------------
def test_the_newest_period_shows_and_the_site_itself_isnt_a_referrer(engine, site):
    older = DASHBOARD.replace("07/31/2026 12:00 AM - 11/06/2026", "05/01/2026 12:00 AM - 07/30/2026").replace('"1000"', '"10"')
    reports.import_files(engine, _files(older, DASHBOARD))
    shown = reports.latest(engine, [site])["sites"][0]["dashboard"]
    assert shown["sessions"] == 1000 and shown["period_start"] == "2026-07-31" and shown["older"] == 1
    assert [r["source"] for r in shown["referrers"]] == ["www.google.com", "spam-crm.example"]
    assert shown["own_referrals"] == 210
    assert reports.latest(engine, []) == {"sites": []}


# ---- the routes ------------------------------------------------------------------------------------
@pytest.fixture
def app(engine):
    return create_app(engine=engine, secret_key="test-secret-key")


def _signed_in(app, engine, role="admin", email="boss@example.com"):
    accounts.create_user(engine, email, "Boss", role, password=PASSWORD, must_change=False)
    client = app.test_client()
    reply = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    return client, {"X-CSRF-Token": reply.get_json()["csrf"]}


def _upload(client, headers, *bodies, preview=False):
    data = {"file": [(io.BytesIO(body.encode()), f"Clarity_{i}.csv") for i, body in enumerate(bodies)]}
    if preview:
        data["preview"] = "1"
    return client.post("/api/clarity-reports", data=data, headers=headers, content_type="multipart/form-data")


def test_an_admin_uploads_several_files_and_the_screen_reads_them(app, engine, site):
    client, headers = _signed_in(app, engine)
    assert _upload(client, headers, DASHBOARD, AI_WITH_QUESTIONS, preview=True).get_json()["preview"] is True
    assert _stored(engine) == []
    reply = _upload(client, headers, DASHBOARD, AI_WITH_QUESTIONS)
    assert reply.status_code == 200 and len(reply.get_json()["files"]) == 2
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM clarity_reports WHERE uploaded_by IS NOT NULL")).scalar() == 2
    shown = client.get(f"/api/metrics/clarity-reports?from=2026-10-01&to=2026-10-31&site_id={site}").get_json()
    assert shown["sites"][0]["dashboard"]["sessions"] == 1000 and shown["sites"][0]["ai"]["citations"] == 371


def test_a_member_cannot_upload_and_signed_out_is_refused(app, engine, site):
    client, headers = _signed_in(app, engine, role="member", email="member@example.com")
    assert _upload(client, headers, DASHBOARD).status_code == 403
    assert _upload(app.test_client(), {}, DASHBOARD).status_code == 401
    assert _stored(engine) == []
