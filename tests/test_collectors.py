"""Collectors on a fake Google, Bing, Yandex, Clarity and PageSpeed. The real ones have not been called: no keys exist yet."""
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, ga4, gsc, http, jobs, others
from seo.collectors.http import SourceError
from seo.core.errors import NotFound, Refused
from seo.sources import credentials, service
from seo.worker import queue
from seo.worker.runner import RunAgain, tick


@pytest.fixture
def key(tmp_path, monkeypatch):
    from seo.core import crypto
    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)
    return path


@pytest.fixture
def world(engine, key, monkeypatch, tmp_path):
    calls = []
    answers = {}

    def fake(request: httpx.Request):
        calls.append(request)
        for marker, answer in answers.items():
            if marker in str(request.url):
                return answer(request) if callable(answer) else answer
        return httpx.Response(404, json={"error": {"message": "unknown " + str(request.url)}})

    monkeypatch.setattr(http, "transport", httpx.MockTransport(fake))
    monkeypatch.setattr(credentials, "transport", httpx.MockTransport(fake))
    monkeypatch.setattr(credentials, "token_override", lambda connection_id: "fake-token")
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('mine.example', 'https://mine.example/', 'own')")).lastrowid
    class W: pass
    w = W(); w.calls = calls; w.answers = answers; w.site = site_id; w.engine = engine; w.lock = tmp_path / "locks"
    return w


def _google(w):
    connection = service.add_google(w.engine, "Team", "robot", {"client_email": "robot@x.iam.gserviceaccount.com", "private_key": "k", "private_key_id": "abcd1234"})
    service.save_site_source(w.engine, w.site, "gsc", {"connection_id": connection["id"], "property": "sc-domain:mine.example"})
    service.save_site_source(w.engine, w.site, "ga4", {"connection_id": connection["id"], "property": "123456"})
    return connection


def _gsc_answer(request):
    import json
    body = json.loads(request.content)
    dims = body["dimensions"]
    if dims == ["date"]:
        return httpx.Response(200, json={"rows": [{"keys": [body["endDate"]], "clicks": 10, "impressions": 100, "ctr": .1, "position": 7.5}]})
    if dims == ["page"]:
        return httpx.Response(200, json={"rows": [{"keys": ["https://mine.example/a/"], "clicks": 6, "impressions": 60, "position": 5}]})
    if dims == ["query"]:
        return httpx.Response(200, json={"rows": [{"keys": ["créer société"], "clicks": 4, "impressions": 40, "position": 3.2}, {"keys": ["creer societe"], "clicks": 1, "impressions": 5, "position": 9}]})
    if dims == ["country"]:
        return httpx.Response(200, json={"rows": [{"keys": ["fra"], "clicks": 8, "impressions": 80, "position": 6.0}, {"keys": ["esp"], "clicks": 2, "impressions": 20, "position": 12.0}]})
    if dims == ["device"]:
        return httpx.Response(200, json={"rows": [{"keys": ["MOBILE"], "clicks": 7, "impressions": 70, "position": 7.0}, {"keys": ["DESKTOP"], "clicks": 3, "impressions": 30, "position": 8.7}]})
    return httpx.Response(200, json={"rows": [{"keys": ["créer société", "https://mine.example/a/"], "clicks": 4, "impressions": 40, "position": 3.2}]})


def _ga4_answer(request, thresholded=False):
    import json
    body = json.loads(request.content)
    names = [d["name"] for d in body["dimensions"]]
    rows = {
        "sessionDefaultChannelGroup": [["Organic Search", "google", "organic", "50", "40", "2"], ["Referral", "blog.example", "referral", "7", "6", "1"]],
        "landingPage": [["/a/", "30", "25", "2"]],
        "sessionManualSource": [["blog", "backlink", "bl-1", "/a/", "3", "1"], ["(not set)", "(not set)", "(not set)", "/a/", "99", "9"]],
        "sessionGoogleAdsCampaignName": [["Brand", "12", "34.5", "12", "1"]],
    }
    if names[0] == "sessionSource":
        table = [["blog.example", "referral", "/a/", "(not set)", "4", "1"], ["blog.example", "referral", "/a/", "bl-1", "3", "1"], ["google", "organic", "/a/", "(not set)", "9", "0"]]
    else:
        table = rows[names[0]]
    cut = len(names)
    return httpx.Response(200, json={"rows": [{"dimensionValues": [{"value": v} for v in r[:cut]], "metricValues": [{"value": v} for v in r[cut:]]} for r in table], "rowCount": len(table), "metadata": {"currencyCode": "EUR", "subjectToThresholding": thresholded}})


def test_a_key_is_checked_whole_before_it_is_saved(world):
    with pytest.raises(Refused):
        service.add_google(world.engine, "", "robot", "{not json")
    with pytest.raises(Refused):
        service.add_google(world.engine, "", "robot", {"client_email": "x"})
    with pytest.raises(Refused) as err:
        service.add_google(world.engine, "", "oauth", {"client_id": "a"})
    assert "client secret" in str(err.value) and "refresh token" in str(err.value)
    assert service.list_google(world.engine) == []


def test_keys_are_encrypted_and_never_listed(world):
    connection = _google(world)
    with world.engine.connect() as conn:
        stored = conn.execute(text("SELECT secret FROM google_connections")).scalar()
    assert "robot@" not in stored and "private_key" not in stored
    shown = str(service.overview(world.engine))
    assert "private_key" not in shown and "secret" not in shown.replace("has_secret", "")
    assert connection["robot_email"] == "robot@x.iam.gserviceaccount.com" and connection["last4"] == "…1234"


def test_properties_are_checked_with_a_helpful_answer(world):
    connection = service.add_google(world.engine, "T", "robot", {"client_email": "r@x.y", "private_key": "k"})
    with pytest.raises(Refused) as err:
        service.save_site_source(world.engine, world.site, "ga4", {"property": "G-ABC123"})
    assert "isn't the G-XXXX" in str(err.value)
    with pytest.raises(Refused):
        service.save_site_source(world.engine, world.site, "gsc", {"property": "mine.example"})
    with pytest.raises(NotFound):
        service.save_site_source(world.engine, world.site, "gsc", {"connection_id": 99999})
    assert service.save_site_source(world.engine, world.site, "gsc", {"property": "sc-domain:mine.example", "connection_id": connection["id"]})["property"] == "sc-domain:mine.example"


def test_saving_a_property_keeps_a_pasted_token(world):
    service.save_site_source(world.engine, world.site, "clarity", {"token": "tok-12345678"})
    saved = service.save_site_source(world.engine, world.site, "clarity", {"not_used": False})
    assert saved["has_secret"] and saved["last4"] == "…5678"


def test_test_button_checks_search_console_and_ga4_separately(world):
    connection = _google(world)
    world.answers["webmasters/v3/sites"] = httpx.Response(200, json={"siteEntry": [{"siteUrl": "sc-domain:mine.example"}]})
    world.answers["accountSummaries"] = httpx.Response(403, json={"error": {"message": "Google Analytics Admin API has not been used in project"}})
    answer = service.test_google(world.engine, connection["id"])
    assert answer["search_console"] == {"ok": True, "properties": ["sc-domain:mine.example"]}
    assert answer["ga4"]["ok"] is False and "Turn on the Analytics Admin API" in answer["ga4"]["error"]
    assert service.get_google(world.engine, connection["id"])["last_ok_at"]


def test_test_button_catches_the_data_api_being_off(world):
    """Listing properties (Admin API) can work while the pull's Data API is off: Test must not say it works."""
    connection = _google(world)
    world.answers["webmasters/v3/sites"] = httpx.Response(200, json={"siteEntry": []})
    world.answers["accountSummaries"] = httpx.Response(200, json={"accountSummaries": [{"propertySummaries": [{"property": "properties/999", "displayName": "Other"}]}]})
    world.answers["runReport"] = httpx.Response(403, json={"error": {"message": "Google Analytics Data API has not been used in project 4242 before or it is disabled."}})
    answer = service.test_google(world.engine, connection["id"])
    assert answer["ga4"]["ok"] is False
    assert answer["ga4"]["error"] == "Turn on the Google Analytics Data API in your Google Cloud project 4242, then press Test again."
    assert answer["ga4"]["properties"] == [{"id": "999", "name": "Other", "account": None}]  # the lists still fill
    assert "properties/123456:runReport" in str(world.calls[-1].url)  # the site's own property, not the first one listed

    world.answers["runReport"] = httpx.Response(200, json={"rows": []})
    assert service.test_google(world.engine, connection["id"])["ga4"]["ok"] is True


def test_an_expired_token_says_what_to_do(world, monkeypatch):
    def refuse(connection_id):
        raise credentials.CredentialsFailed(credentials._hint("invalid_grant: Token has been expired"))
    monkeypatch.setattr(credentials, "token_override", refuse)
    connection = _google(world)
    answer = service.test_google(world.engine, connection["id"])
    assert "Google stopped this token" in answer["search_console"]["error"]
    assert "Google stopped this token" in service.get_google(world.engine, connection["id"])["last_error"]


def test_search_console_saves_a_day_and_keeps_accents_apart(world):
    _google(world)
    world.answers["searchAnalytics"] = _gsc_answer
    with world.engine.begin() as conn:  # only one day is left to read
        newest = common.google_today(world.engine)
        for n in range(1, gsc.HISTORY_DAYS + 1):
            conn.execute(text("INSERT INTO coverage (site_id, source, day) VALUES (:s, 'gsc', :d)"), {"s": world.site, "d": newest - timedelta(days=n)})
            if n >= gsc.REREAD_DAYS:
                continue
        conn.execute(text("UPDATE coverage SET saved_at = UTC_TIMESTAMP(3)"))
    assert gsc.collect(world.engine, world.site) is True
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT clicks, impressions, position FROM gsc_daily")).one() == (10, 100, 7.5)
        assert conn.execute(text("SELECT COUNT(*) FROM gsc_query")).scalar() == 2  # "créer société" and "creer societe" stay two queries
        assert conn.execute(text("SELECT COUNT(*) FROM gsc_page")).scalar() == 1
        assert conn.execute(text("SELECT COUNT(*) FROM gsc_query_page")).scalar() == 1
    source = next(row for row in service.site_sources(world.engine, world.site) if row["source"] == "gsc")
    assert source["data_through"] == newest.isoformat() and source["last_error"] is None


def test_search_console_stops_after_its_share_and_a_rerun_carries_on(world):
    _google(world)
    world.answers["searchAnalytics"] = _gsc_answer
    assert gsc.collect(world.engine, world.site, budget_seconds=0) is False
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM coverage WHERE source = 'gsc'")).scalar() == 0
    newest = common.google_today(world.engine)
    days = common.pending_days(world.engine, world.site, "gsc", newest, newest - timedelta(days=9), gsc.REREAD_DAYS)
    assert days[0] == newest and len(days) == 10


def test_pending_days_rereads_recent_days_but_not_old_ones(world):
    newest = common.today(world.engine)
    with world.engine.begin() as conn:
        for n in range(6):
            conn.execute(text("INSERT INTO coverage (site_id, source, day, saved_at) VALUES (:s, 'gsc', :d, UTC_TIMESTAMP(3) - INTERVAL 2 DAY)"), {"s": world.site, "d": newest - timedelta(days=n)})
    days = common.pending_days(world.engine, world.site, "gsc", newest, newest - timedelta(days=6), reread_days=2)
    assert days == [newest, newest - timedelta(days=1), newest - timedelta(days=6)]


def test_ga4_never_counts_a_utm_session_by_domain_too(world):
    _google(world)
    world.answers["runReport"] = _ga4_answer
    src = common.source_row(world.engine, world.site, "ga4")
    day = common.today(world.engine) - timedelta(days=1)
    ga4._one_day(world.engine, world.site, "t", src["property"], day)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT domain, path, sessions FROM ga4_referral_daily")).all() == [("blog.example", "/a/", 4)]
        assert conn.execute(text("SELECT source, medium, campaign, sessions FROM ga4_campaign_daily")).all() == [("blog", "backlink", "bl-1", 3)]
        assert conn.execute(text("SELECT SUM(sessions) FROM ga4_source_daily")).scalar() == 57
        assert conn.execute(text("SELECT campaign, clicks, cost, currency FROM ga4_ads_daily")).one()[:2] == ("Brand", 12)
        assert conn.execute(text("SELECT currency FROM ga4_ads_daily")).scalar() == "EUR"
        assert conn.execute(text("SELECT hid_rows FROM coverage WHERE source = 'ga4'")).scalar() == 0


def test_ga4_says_when_it_hid_rows(world):
    _google(world)
    world.answers["runReport"] = lambda request: _ga4_answer(request, thresholded=True)
    ga4._one_day(world.engine, world.site, "t", "123456", common.today(world.engine) - timedelta(days=1))
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT hid_rows FROM coverage WHERE source = 'ga4'")).scalar() == 1


def test_running_a_ga4_day_twice_changes_nothing(world):
    _google(world)
    world.answers["runReport"] = _ga4_answer
    day = common.today(world.engine) - timedelta(days=1)
    ga4._one_day(world.engine, world.site, "t", "123456", day)
    ga4._one_day(world.engine, world.site, "t", "123456", day)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT SUM(sessions) FROM ga4_source_daily")).scalar() == 57


def test_a_property_with_no_ads_link_still_saves_its_day(world):
    _google(world)
    def answer(request):
        if b"sessionGoogleAdsCampaignName" in request.content:
            return httpx.Response(403, json={"error": {"message": "no ads link"}})
        return _ga4_answer(request)
    world.answers["runReport"] = answer
    ga4._one_day(world.engine, world.site, "t", "123456", common.today(world.engine) - timedelta(days=1))
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM ga4_ads_daily")).scalar() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM ga4_source_daily")).scalar() == 2


def test_refused_access_alerts_once_and_a_later_success_clears_it(world):
    _google(world)
    world.answers["searchAnalytics"] = httpx.Response(403, json={"error": {"message": "User does not have sufficient permission"}})
    jobs.enqueue_one(world.engine, world.site, "gsc")
    tick(world.engine, jobs.LANE, lock_dir=world.lock, db_wait_seconds=1)
    jobs.enqueue_one(world.engine, world.site, "gsc")
    tick(world.engine, jobs.LANE, lock_dir=world.lock, db_wait_seconds=1)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM alerts WHERE kind = 'source_failing'")).scalar() == 1
        assert "sufficient permission" in conn.execute(text("SELECT last_error FROM site_sources WHERE source = 'gsc'")).scalar()
        assert conn.execute(text("SELECT COUNT(*) FROM jobs WHERE status = 'dead'")).scalar() == 0
    world.answers["searchAnalytics"] = _gsc_answer
    jobs.enqueue_one(world.engine, world.site, "gsc")
    with world.engine.begin() as conn:  # nothing left to read, so one tick finishes it
        conn.execute(text("UPDATE site_sources SET last_error = NULL"))
    tick(world.engine, jobs.LANE, lock_dir=world.lock, db_wait_seconds=1, budget_seconds=3)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM alerts WHERE kind = 'source_failing'")).scalar() == 0


def test_a_limit_reached_stops_quietly_for_today(world):
    _google(world)
    world.answers["runReport"] = httpx.Response(429, json={"error": {"message": "Exhausted property tokens"}})
    jobs.enqueue_one(world.engine, world.site, "ga4")
    result = tick(world.engine, jobs.LANE, lock_dir=world.lock, db_wait_seconds=1)
    assert result.processed == 1 and result.failed == 0
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM alerts")).scalar() == 0
        assert "limit" in conn.execute(text("SELECT last_error FROM site_sources WHERE source = 'ga4'")).scalar()


def test_a_passing_outage_tries_again_later_without_an_alert(world):
    _google(world)
    world.answers["searchAnalytics"] = httpx.Response(503, text="down")
    jobs.enqueue_one(world.engine, world.site, "gsc")
    tick(world.engine, jobs.LANE, lock_dir=world.lock, db_wait_seconds=1)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM alerts")).scalar() == 0
        assert conn.execute(text("SELECT status FROM jobs")).scalar() == "queued"


def test_due_skips_not_used_and_unset_sites_with_no_alert(world):
    connection = service.add_google(world.engine, "T", "robot", {"client_email": "r@x.y", "private_key": "k"})
    service.save_site_source(world.engine, world.site, "gsc", {"connection_id": connection["id"], "property": "sc-domain:mine.example", "not_used": True})
    service.save_site_source(world.engine, world.site, "ga4", {"connection_id": connection["id"]})  # no property yet
    queued = jobs.enqueue_due(world.engine)
    assert queued == [(world.site, "pagespeed")]  # needs no setup
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM alerts")).scalar() == 0


def test_clarity_goes_once_per_utc_day_even_from_the_button(world):
    service.save_site_source(world.engine, world.site, "clarity", {"token": "tok-12345678"})
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE source = 'clarity'"))
    assert "clarity" not in jobs.collect_now(world.engine, world.site)
    assert (world.site, "clarity") not in jobs.enqueue_due(world.engine)


def test_clarity_reads_its_own_spelling_of_things(world):
    service.save_site_source(world.engine, world.site, "clarity", {"token": "tok-12345678"})
    def answer(request):
        assert request.headers["Authorization"] == "Bearer tok-12345678"
        if "dimension1=Source" in str(request.url):
            return httpx.Response(200, json=[{"metricName": "Traffic", "information": [{"totalSessionCount": "5", "Source": "chatgpt.com"}]}])
        return httpx.Response(200, json=[
            {"metricName": "Traffic", "information": [{"totalSessionCount": "9554", "distantUserCount": "8000"}]},
            {"metricName": "ScrollDepth", "information": [{"averageScrollDepth": "47.5"}]},
            {"metricName": "RageClickCount", "information": [{"sessionsCount": "3", "subTotal": "11"}]},
            {"metricName": "DeadClickCount", "information": [{"sessionsCount": "2", "subTotal": "6"}]},
        ])
    world.answers["clarity.ms"] = answer
    others.collect_clarity(world.engine, world.site)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT sessions, scroll_depth, rage_clicks, dead_clicks FROM clarity_daily")).one() == (9554, 47.5, 11, 6)


def test_bing_keeps_the_newest_week_of_a_query(world):
    service.save_app_key(world.engine, "bing", "bing-key-1234")
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source) VALUES (:s, 'bing')"), {"s": world.site})
    world.answers["GetRankAndTrafficStats"] = httpx.Response(200, json={"d": [{"Date": "/Date(1730000000000-0700)/", "Clicks": 4, "Impressions": 50}]})
    world.answers["GetQueryStats"] = httpx.Response(200, json={"d": [
        {"Query": "seville", "Date": "/Date(1720000000000)/", "Clicks": 1, "Impressions": 9, "AvgImpressionPosition": 9.0},
        {"Query": "seville", "Date": "/Date(1730000000000)/", "Clicks": 3, "Impressions": 30, "AvgImpressionPosition": 4.0},
    ]})
    others.collect_bing(world.engine, world.site)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT query, clicks, position FROM bing_query")).all() == [("seville", 3, 4.0)]
        assert conn.execute(text("SELECT clicks FROM bing_daily")).scalar() == 4


def test_yandex_pages_through_its_queries(world):
    service.save_app_key(world.engine, "yandex", "ya-token-1234")
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source) VALUES (:s, 'yandex')"), {"s": world.site})
    world.answers["/v4/user/7/hosts"] = lambda request: httpx.Response(200, json={"count": 1, "queries": [{"query_text": "запрос", "indicators": {"TOTAL_SHOWS": 20, "TOTAL_CLICKS": 2, "AVG_SHOW_POSITION": 6.5}}]})
    world.answers["/v4/user"] = httpx.Response(200, json={"user_id": 7})
    others.collect_yandex(world.engine, world.site)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT query, shows, position FROM yandex_query")).all() == [("запрос", 20, 6.5)]
    assert any("https:mine.example:443" in str(call.url) for call in world.calls)


def test_pagespeed_prefers_real_visitors_and_works_with_no_key(world):
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO site_sources (site_id, source) VALUES (:s, 'pagespeed')"), {"s": world.site})
    world.answers["pagespeedonline"] = httpx.Response(200, json={
        "lighthouseResult": {"categories": {"performance": {"score": 0.83}}, "audits": {"largest-contentful-paint": {"numericValue": 9000}}},
        "loadingExperience": {"metrics": {"LARGEST_CONTENTFUL_PAINT_MS": {"percentile": 2100}, "INTERACTION_TO_NEXT_PAINT": {"percentile": 180}, "CUMULATIVE_LAYOUT_SHIFT_SCORE": {"percentile": 7}}},
    })
    others.collect_pagespeed(world.engine, world.site)
    with world.engine.connect() as conn:
        rows = conn.execute(text("SELECT strategy, performance, lcp_ms, inp_ms, cls, field_data FROM cwv_runs ORDER BY strategy")).all()
    assert rows[1] == ("mobile", 83, 2100, 180, 0.07, 1) and len(rows) == 2
    assert "key=" not in str(world.calls[0].url)


def test_authority_skips_what_this_month_already_has(world):
    service.save_app_key(world.engine, "openpagerank", "opr-key-1234")
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO authority_monthly (domain, month, score) VALUES ('old.example', '2026-11', 3)"))
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('old.example', 'https://old.example/', 'competitor')"))
    world.answers["openpagerank"] = httpx.Response(200, json={"data": [{"domain": "mine.example", "page_rank_decimal": 4.2}]})
    assert others.collect_authority(world.engine, "2026-11") == 1
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT score FROM authority_monthly WHERE domain = 'mine.example'")).scalar() == 4.2


def test_real_token_exchange_failure_reads_as_a_hint(world, monkeypatch, tmp_path):
    """OAuth keys, the real google-auth code, on a fake token endpoint."""
    monkeypatch.setattr(credentials, "token_override", None)
    connection = service.add_google(world.engine, "O", "oauth", {"client_id": "a", "client_secret": "b", "refresh_token": "c-1234"})
    world.answers["oauth2.googleapis.com/token"] = httpx.Response(400, json={"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
    with pytest.raises(credentials.CredentialsFailed) as err:
        credentials.access_token(world.engine, connection["id"])
    assert "Google stopped this token" in str(err.value)


def test_real_token_exchange_success_gives_a_token_and_caches_it(world, monkeypatch):
    monkeypatch.setattr(credentials, "token_override", None)
    connection = service.add_google(world.engine, "O", "oauth", {"client_id": "a", "client_secret": "b", "refresh_token": "c-1234"})
    credentials.forget(connection["id"])
    world.answers["oauth2.googleapis.com/token"] = httpx.Response(200, json={"access_token": "real-looking", "expires_in": 3600, "token_type": "Bearer"})
    assert credentials.access_token(world.engine, connection["id"]) == "real-looking"
    before = len(world.calls)
    assert credentials.access_token(world.engine, connection["id"]) == "real-looking"
    assert len(world.calls) == before
    credentials.forget(connection["id"])


def test_ga4_keeps_utm_rows_that_have_no_campaign(world):
    import json

    def answer(request):
        if json.loads(request.content)["dimensions"][0]["name"] != "sessionManualSource":
            return _ga4_answer(request)
        table = [["blog-expat", "backlink", "(not set)", "/a/", "12", "1"], ["(not set)", "(not set)", "(not set)", "/a/", "99", "9"]]
        return httpx.Response(200, json={"rows": [{"dimensionValues": [{"value": v} for v in r[:4]], "metricValues": [{"value": v} for v in r[4:]]} for r in table], "rowCount": 2, "metadata": {}})

    world.answers["runReport"] = answer
    ga4._one_day(world.engine, world.site, "t", "123456", common.today(world.engine) - timedelta(days=1))
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT source, medium, campaign, sessions FROM ga4_campaign_daily")).all() == [("blog-expat", "backlink", "(not set)", 12)]


def test_authority_is_queued_while_any_domain_is_missing_this_month(world):
    service.save_app_key(world.engine, "openpagerank", "opr-key-1234")
    month = common.today(world.engine).strftime("%Y-%m")
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('old.example', 'https://old.example/', 'competitor')"))
        conn.execute(text("INSERT INTO authority_monthly (domain, month, score) VALUES ('old.example', :m, 3)"), {"m": month})
    assert jobs.enqueue_authority(world.engine) is not None  # mine.example hasn't been scored, though old.example has


def test_authority_isnt_queued_again_for_a_domain_with_no_answer(world):
    service.save_app_key(world.engine, "openpagerank", "opr-key-1234")
    month = common.today(world.engine).strftime("%Y-%m")
    world.answers["openpagerank"] = httpx.Response(200, json={"data": []})
    others.collect_authority(world.engine, month)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE jobs SET status = 'done', active_key = NULL"))
    assert jobs.enqueue_authority(world.engine) is None


def test_search_console_says_data_through_only_for_days_it_has_read(world):
    _google(world)
    world.answers["searchAnalytics"] = _gsc_answer
    assert gsc.collect(world.engine, world.site, budget_seconds=0) is False  # the daily totals, and no per-page or per-query day yet
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": world.site}).scalar() is None
    assert gsc.collect(world.engine, world.site) is True
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": world.site}).scalar() is not None


# ---- Search Console like the real screen: fresh days, Pacific time, revisions, countries, devices, limits, pruning -----


def _fresh_answer(final_lag=2, clicks=10, extra_days=()):
    """Days up to today in Pacific time; the last final_lag days aren't final yet, as Google says in metadata."""
    import json
    from datetime import date

    def answer(request):
        body = json.loads(request.content)
        dims, end = body["dimensions"], date.fromisoformat(body["endDate"])
        if dims == ["date"]:
            days = [end - timedelta(days=n) for n in range(4)] + list(extra_days)
            rows = [{"keys": [d.isoformat()], "clicks": clicks, "impressions": 100, "position": 7.5} for d in days]
            meta = {"metadata": {"firstIncompleteDate": (end - timedelta(days=final_lag - 1)).isoformat()}} if final_lag else {}
            return httpx.Response(200, json={"rows": rows, **meta})
        return _gsc_answer(request)
    return answer


def test_search_console_asks_for_fresh_data_on_every_request(world):
    _google(world)
    world.answers["searchAnalytics"] = _fresh_answer()
    assert gsc.collect(world.engine, world.site) is True
    import json
    bodies = [json.loads(r.content) for r in world.calls if "searchAnalytics" in str(r.url)]
    assert bodies and all(b["dataState"] == "all" and b["type"] == "web" and b["rowLimit"] == gsc.ROW_LIMIT for b in bodies)
    assert {tuple(b["dimensions"]) for b in bodies} == {("date",), ("page",), ("query",), ("query", "page"), ("country",), ("device",)}


def test_search_console_keeps_final_and_fresh_days_apart(world):
    _google(world)
    world.answers["searchAnalytics"] = _fresh_answer(final_lag=2)
    assert gsc.collect(world.engine, world.site) is True
    today = common.google_today(world.engine)
    with world.engine.connect() as conn:
        row = conn.execute(text("SELECT data_through, fresh_from, fresh_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": world.site}).one()
        assert row == (today - timedelta(days=2), today - timedelta(days=1), today)
        assert conn.execute(text("SELECT COUNT(*) FROM gsc_daily WHERE site_id = :s"), {"s": world.site}).scalar() == 4


def test_search_console_rereads_days_that_are_not_final_after_50_minutes(world):
    _google(world)
    world.answers["searchAnalytics"] = _fresh_answer(final_lag=2)
    assert gsc.collect(world.engine, world.site) is True
    today = common.google_today(world.engine)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE coverage SET saved_at = UTC_TIMESTAMP(3) - INTERVAL 51 MINUTE WHERE site_id = :s"), {"s": world.site})
    fresh_from = today - timedelta(days=1)
    days = common.pending_days(world.engine, world.site, "gsc", today, today - timedelta(days=3), gsc.REREAD_DAYS, hot_from=fresh_from, hot_minutes=gsc.HOT_MINUTES)
    assert days == [today, today - timedelta(days=1)]  # final days read 51 minutes ago wait for the daily re-read


def test_search_console_replaces_a_fresh_day_when_google_revises_it(world):
    _google(world)
    world.answers["searchAnalytics"] = _fresh_answer(clicks=10)
    gsc.collect(world.engine, world.site)
    world.answers["searchAnalytics"] = _fresh_answer(clicks=14)
    gsc.collect(world.engine, world.site)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT SUM(clicks) FROM gsc_daily WHERE site_id = :s"), {"s": world.site}).scalar() == 4 * 14


def test_search_console_with_no_rows_never_claims_a_day(world):
    _google(world)
    world.answers["searchAnalytics"] = lambda request: httpx.Response(200, json={})
    assert gsc.collect(world.engine, world.site) is True
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT data_through FROM site_sources WHERE site_id = :s AND source = 'gsc'"), {"s": world.site}).scalar() is None
        assert conn.execute(text("SELECT COUNT(*) FROM coverage WHERE source = 'gsc'")).scalar() == 0


def test_search_console_days_are_pacific_time():
    from datetime import date, datetime
    assert common.google_today(None, now=datetime(2026, 11, 9, 2, 0)) == date(2026, 11, 8)  # 2 a.m. UTC is 6 p.m. the day before in California
    assert common.google_today(None, now=datetime(2026, 11, 9, 9, 0)) == date(2026, 11, 9)
    assert common.google_today(None, now=datetime(2026, 7, 9, 6, 59)) == date(2026, 7, 8)  # summer time: UTC-7


def test_search_console_saves_countries_and_devices(world):
    _google(world)
    world.answers["searchAnalytics"] = _fresh_answer()
    gsc.collect(world.engine, world.site)
    today = common.google_today(world.engine)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT country, clicks FROM gsc_country WHERE site_id = :s AND day = :d ORDER BY clicks DESC"), {"s": world.site, "d": today}).all() == [("fra", 8), ("esp", 2)]
        assert conn.execute(text("SELECT device, clicks FROM gsc_device WHERE site_id = :s AND day = :d ORDER BY clicks DESC"), {"s": world.site, "d": today}).all() == [("MOBILE", 7), ("DESKTOP", 3)]


def test_search_console_marks_a_day_partial_only_when_google_fills_a_report(world, monkeypatch):
    _google(world)
    world.answers["searchAnalytics"] = _fresh_answer()
    monkeypatch.setattr(gsc, "ROW_LIMIT", 2)  # the query report gives 2 rows: a full page
    gsc.collect(world.engine, world.site)
    with world.engine.connect() as conn:
        assert {row[0] for row in conn.execute(text("SELECT status FROM coverage WHERE source = 'gsc'")).all()} == {"partial"}
    monkeypatch.setattr(gsc, "ROW_LIMIT", 3)
    with world.engine.begin() as conn:
        conn.execute(text("DELETE FROM coverage"))
    gsc.collect(world.engine, world.site)
    with world.engine.connect() as conn:
        assert {row[0] for row in conn.execute(text("SELECT status FROM coverage WHERE source = 'gsc'")).all()} == {"ok"}


def test_search_console_deletes_days_older_than_16_months(world):
    _google(world)
    old = common.google_today(world.engine) - timedelta(days=gsc.HISTORY_DAYS + 3)
    with world.engine.begin() as conn:
        conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions) VALUES (:s, :d, 1, 1)"), {"s": world.site, "d": old})
        conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions) VALUES (:s, :d, 'h', 'q', 1, 1)"), {"s": world.site, "d": old})
        conn.execute(text("INSERT INTO gsc_country (site_id, day, country, clicks, impressions) VALUES (:s, :d, 'fra', 1, 1)"), {"s": world.site, "d": old})
        conn.execute(text("INSERT INTO coverage (site_id, source, day) VALUES (:s, 'gsc', :d)"), {"s": world.site, "d": old})
    world.answers["searchAnalytics"] = _fresh_answer()
    gsc.collect(world.engine, world.site)
    with world.engine.connect() as conn:
        for table in ("gsc_daily", "gsc_query", "gsc_country", "coverage"):
            assert conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE site_id = :s AND day < :o"), {"s": world.site, "o": old + timedelta(days=1)}).scalar() == 0, table


def test_search_console_is_due_every_hourly_run(world):
    _google(world)
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE site_sources SET last_attempt_at = UTC_TIMESTAMP(3) - INTERVAL 55 MINUTE WHERE source = 'gsc'"))
    assert (world.site, "gsc") in jobs.enqueue_due(world.engine)
