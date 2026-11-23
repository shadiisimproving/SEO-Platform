"""A fake Google, Bing, Yandex, Clarity, PageSpeed and Wayback Machine for trying the screens by hand. Nothing leaves the machine.

Numbers are worked out from the date, so a day always gives the same answer, and they go through the real collectors.
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta

import httpx

from seo.collectors import http
from seo.competitors import history
from seo.sources import credentials

PROPERTIES = lambda: ["sc-domain:mine-one.test", "sc-domain:mine-two.test", "https://mine-three.test/"]  # noqa: E731
KEYS = {"gsc_fail": False}


def _gsc_refuses() -> bool:
    """Search Console answers 403 while KEYS["gsc_fail"] is set, or while the file FAKE_GSC_FAIL_FILE names exists, so a
    browser flow can make Google refuse halfway through (tests/ui/flow_today_fixes.cjs)."""
    flag = os.environ.get("FAKE_GSC_FAIL_FILE")
    return KEYS["gsc_fail"] or bool(flag and os.path.exists(flag))


def _wave(day: str, base: int, salt: int = 0) -> int:
    value = date.fromisoformat(day).toordinal() + salt
    return max(0, base + (value * 7919 % 41) - 20 + (2 if date.fromisoformat(day).weekday() < 5 else -base // 4))


def _gsc_page(body: dict, rows: list[dict], **extra) -> httpx.Response:
    """Like Google: rowLimit and startRow cut the answer, and metadata only comes with fresh data."""
    start_row, limit = int(body.get("startRow", 0)), int(body.get("rowLimit", 1000))
    return httpx.Response(200, json={"rows": rows[start_row:start_row + limit], **extra})


def _gsc(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    dims, start, end = body["dimensions"], body["startDate"], body["endDate"]
    fresh = body.get("dataState") in ("all", "hourly_all")
    if dims == ["date"]:
        # Final data stops 3 days back; fresh data reaches the end date, and its last 2 days aren't final yet.
        first, last = date.fromisoformat(start).toordinal(), date.fromisoformat(end).toordinal() - (0 if fresh else 2)
        rows = []
        for ordinal in range(max(first, last - 480), last + 1):
            day = date.fromordinal(ordinal).isoformat()
            rows.append({"keys": [day], "clicks": _wave(day, 120), "impressions": _wave(day, 120) * 22, "position": 6 + (ordinal % 9) / 3})
        extra = {"metadata": {"firstIncompleteDate": date.fromordinal(last - 1).isoformat()}} if fresh and rows else {}
        return _gsc_page(body, rows, **extra)
    pages = [("https://mine-one.test/visa/", 60, 4.2), ("https://mine-one.test/creer-societe/", 35, 7.5), ("https://mine-one.test/", 20, 3.1), ("https://mine-one.test/blog/zone-franche-seville/", 9, 14.0)]
    queries = [("créer société seville", 40, 5.1), ("visa seville prix", 30, 3.4), ("titre de séjour", 18, 5.2), ("zone franche séville", 11, 12.0), ("loyer a seville", 6, 23.0), ("coût de la vie séville", 3, 44.0), ("ouvrir un compte", 1, 61.0)]
    if dims == ["hour"]:
        # Hours of the last two days, Pacific time, as Google writes them.
        last = date.fromisoformat(end)
        rows = []
        for back in (1, 0):
            day = date.fromordinal(last.toordinal() - back).isoformat()
            rows += [{"keys": [f"{day}T{h:02d}:00:00-08:00"], "clicks": max(0, _wave(day, 6, h) // 2), "impressions": _wave(day, 6, h) * 11, "position": 6 + h % 5 / 2} for h in range(24)]
        return _gsc_page(body, rows, metadata={"firstIncompleteHour": f"{last.isoformat()}T20:00:00-08:00"})
    countries = [("fra", 70, 6.0), ("esp", 20, 9.5), ("bel", 8, 7.1), ("che", 4, 8.0)]
    devices = [("MOBILE", 60, 7.2), ("DESKTOP", 40, 5.9), ("TABLET", 3, 8.4)]
    table = {"page": pages, "query": queries, "country": countries, "device": devices}.get(dims[0] if len(dims) == 1 else "", queries)
    if dims in (["country"], ["device"]):
        # Like Google: a day's countries, and its devices, add up to its total (the daily answer above).
        total, shown = _wave(start, 120), _wave(start, 120) * 22
        shares = {"country": (0.62, 0.22, 0.1), "device": (0.6, 0.37)}[dims[0]]
        rows, left_c, left_i = [], total, shown
        for n, (key, _base, pos) in enumerate(table):
            c, i = (int(total * shares[n]), int(shown * shares[n])) if n < len(shares) else (left_c, left_i)
            left_c, left_i = left_c - c, left_i - i
            rows.append({"keys": [key], "clicks": c, "impressions": i, "position": pos})
            if n >= len(shares):
                break
    elif len(dims) == 1 and dims[0] in ("page", "query", "country", "device"):
        rows = [{"keys": [key], "clicks": _wave(start, base, n), "impressions": _wave(start, base, n) * 20, "position": pos} for n, (key, base, pos) in enumerate(table)]
    else:
        rows = [{"keys": [text, pages[n % len(pages)][0]], "clicks": _wave(start, base, n), "impressions": _wave(start, base, n) * 20, "position": pos} for n, (text, base, pos) in enumerate(queries)]
    return _gsc_page(body, rows)


def _ga4(request: httpx.Request) -> httpx.Response:
    """Visit groups for the day (tests/ga4_fake.py answers any report from them). Key events by name: generate_lead is an
    enquiry, page_view_booking fires on every booking page view. Visits are on host "(not set)", which counts as the
    site's own. Property 444555666 also records other-site.example's visits, as a property with a second data stream
    would, so Settings and Today show the warning."""
    from tests import ga4_fake

    body = json.loads(request.content)
    if not body.get("dimensions"):  # Test's small check that the Data API is on
        return httpx.Response(200, json={"rows": [{"metricValues": [{"value": "42"}]}], "rowCount": 1})
    day = body["dateRanges"][0]["startDate"]
    w = lambda base, salt=0: _wave(day, base, salt)  # noqa: E731
    prop = str(request.url).split("properties/")[1].split(":")[0]
    host = "(not set)"

    def g(channel, source, medium, page, sessions, events=None, manual=None, campaign=None, on=None):
        manual_source, manual_medium = manual or (source, medium)
        default = {"organic": "(organic)", "referral": "(referral)", "(none)": "(direct)"}.get(medium, "(not set)")
        return {"channel": channel, "source": source, "medium": medium, "manual_source": manual_source, "manual_medium": manual_medium,
                "campaign": campaign or default, "page": page, "host": on or host, "sessions": sessions, "users": max(0, sessions - 2), "events": events or {}}

    groups = [
        g("Organic Search", "google", "organic", "/visa/", w(90), {"generate_lead": (w(3, 1), w(3, 1)), "page_view_booking": (w(6, 1), w(5, 1))}),
        g("Organic Search", "google", "organic", "/creer-societe/", w(50, 2), {"generate_lead": (w(2, 2), w(2, 2))}),
        g("Direct", "(direct)", "(none)", "/", w(40, 3), {"page_view_booking": (w(4, 3), w(3, 3))}),
        g("Direct", "(direct)", "(none)", "/contact/", w(20, 9), {"generate_lead": (w(2, 5), w(2, 5))}),
        g("Referral", "blog-expat.test", "referral", "/visa/", w(12, 1), {"generate_lead": (w(1, 1), w(1, 1))}),
        g("Referral", "blog-expat.test", "referral", "/visa/", w(3, 2), manual=("blog-expat", "backlink"), campaign="bl-1"),
        g("Referral", "chatgpt.com", "referral", "/creer-societe/", w(12, 3), {"generate_lead": (w(1, 3), w(1, 3))}),
        g("Organic Social", "facebook.com", "social", "/blog/zone-franche-seville/", w(18, 5)),
        g("Paid Search", "google", "cpc", "/visa/", w(30, 6), {"page_view_booking": (w(2, 6), w(2, 6))}),
        g("Email", "newsletter", "email", "/", w(8, 7)),
        g("Organic Search", "bing", "organic", "/visa/", w(9, 8)),
    ]
    if prop == "444555666":
        groups.append(g("Direct", "(direct)", "(none)", "/rdv/", w(60, 4), on="other-site.example"))
    ads = [["Brand FR", str(w(14, 1)), str(w(30, 1)), str(w(14, 1)), str(w(1, 1))], ["Visa UAE", str(w(9, 2)), str(w(22, 2)), str(w(9, 2)), str(w(1, 2))]]
    return ga4_fake.answer(request, groups, ads=ads, thresholded=date.fromisoformat(day).toordinal() % 11 == 0)


def _inspect(request: httpx.Request) -> httpx.Response:
    """URL Inspection: a page with "subscription" in its address isn't indexed yet, every other page is."""
    page = json.loads(request.content)["inspectionUrl"]
    if "subscription" in page:
        found = {"verdict": "NEUTRAL", "coverageState": "Crawled - currently not indexed", "lastCrawlTime": "2026-10-12T06:00:00Z"}
    else:
        found = {"verdict": "PASS", "coverageState": "Submitted and indexed", "lastCrawlTime": "2026-10-27T06:00:00Z", "googleCanonical": page}
    return httpx.Response(200, json={"inspectionResult": {"indexStatusResult": found}})


# ---- a rival page that changes between two days, and the Wayback Machine's copy of it ------------------
# Made up: rival-guide.test is no real site. Before RIVAL_CHANGED_ON it's the 2025 guide; from that day on, the 2026 rewrite
# with a new heading, two FAQ questions, FAQ structured data and more words. The archive holds one copy, from 20 Oct 2025.

RIVAL_URL = "https://rival-guide.test/guide/"
RIVAL_CHANGED_ON = date.today() - timedelta(days=3)
ARCHIVED_AT = "20251020120000"


def rival_html(day: date) -> str:
    new = day >= RIVAL_CHANGED_ON
    year = 2026 if new else 2025
    filler = " ".join(["Setting up a company takes a few clear steps and some paperwork."] * (60 if new else 30))
    faq = "<h3>How long does it take?</h3><p>About two weeks.</p><h3>What does it cost?</h3><p>From 4,000 a year.</p>" if new else "<h3>How long does it take?</h3><p>About a month.</p>"
    schema = '{"@context": "https://schema.org", "@graph": [{"@type": "Article", "datePublished": "2024-03-01", "dateModified": "%s"}%s]}' % (
        "2026-11-01" if new else "2025-10-01", ', {"@type": "FAQPage"}' if new else "")
    links = '<a href="/visa/">Visa</a><a href="/costs/">Costs</a><a href="https://gov.example/rules">Rules</a>' if new else '<a href="/costs/">Costs</a>'
    visa = "<h2>Visa options</h2><p>Each partner can get a residence visa through the company.</p>" if new else ""
    return (
        f'<html lang="en"><head><title>Company setup guide {year}</title><meta name="description" content="Everything about company setup in {year}.">'
        f'<script type="application/ld+json">{schema}</script></head><body><main><h1>Company setup guide {year}</h1>'
        f"<h2>Costs</h2><p>{filler}</p>{visa}<h2>Steps</h2><p>Updated for {year}.</p>{faq}{links}</main></body></html>"
    )


def _archive(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if "/cdx/search/cdx" in url:
        params = request.url.params
        wanted, until = params.get("url", ""), params.get("to", "99999999")
        if params.get("matchType") == "domain":
            return httpx.Response(200, text="")
        if history.page_key(wanted) == history.page_key(RIVAL_URL) and until >= ARCHIVED_AT[:8]:
            return httpx.Response(200, text=f"{ARCHIVED_AT} {RIVAL_URL}\n")
        return httpx.Response(200, text="")
    stamp, _, original = url.removeprefix(history.ARCHIVE_URL).partition("id_/")
    if history.page_key(original) == history.page_key(RIVAL_URL) and stamp.isdigit():
        return httpx.Response(200, html=rival_html(date(int(stamp[:4]), int(stamp[4:6]), int(stamp[6:8]))))
    return httpx.Response(404, text="Wayback Machine doesn't have that page archived.")


def rival_site(today=date.today):
    """The rival's own website, as a transport for the polite reader: the page as it is today()."""
    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if history.page_key(str(request.url)) == history.page_key(RIVAL_URL):
            return httpx.Response(200, html=rival_html(today()))
        return httpx.Response(404, html="<html><body>Not found</body></html>")

    return httpx.MockTransport(answer)


def _answer(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if url.startswith("https://web.archive.org/"):
        return _archive(request)
    if "searchAnalytics" in url:
        if _gsc_refuses():
            return httpx.Response(403, json={"error": {"code": 403, "message": "User does not have sufficient permission for site. See also: https://support.google.com/webmasters/answer/2451999.", "status": "PERMISSION_DENIED"}})
        return _gsc(request)
    if "urlInspection/index:inspect" in url:
        return _inspect(request)
    if "api.ahrefs.com/v3/site-explorer/metrics" in url:  # a made-up traffic per website, the same every time
        target = request.url.params.get("target", "")
        return httpx.Response(200, json={"metrics": {"org_traffic": sum(map(ord, target)) * 97, "org_keywords": 40}})
    if "api.ahrefs.com/v3/site-explorer/domain-rating" in url:
        return httpx.Response(200, json={"domain_rating": {"domain_rating": 91.0, "ahrefs_rank": 3}})
    if "webmasters/v3/sites" in url:
        return httpx.Response(200, json={"siteEntry": [{"siteUrl": prop} for prop in PROPERTIES()]})
    if "accountSummaries" in url:
        return httpx.Response(200, json={"accountSummaries": [{"displayName": "Team", "propertySummaries": [{"property": "properties/111222333", "displayName": "Mine one"}, {"property": "properties/444555666", "displayName": "Mine two"}]}]})
    if "runReport" in url:
        return _ga4(request)
    if "clarity.ms" in url:
        return httpx.Response(200, json=[{"metricName": "Traffic", "information": [{"totalSessionCount": "320"}]}, {"metricName": "ScrollDepth", "information": [{"averageScrollDepth": "48.2"}]}, {"metricName": "RageClickCount", "information": [{"subTotal": "4"}]}, {"metricName": "DeadClickCount", "information": [{"subTotal": "9"}]}])
    if "GetUserSites" in url:
        return httpx.Response(200, json={"d": []})
    if "GetRankAndTrafficStats" in url:
        return httpx.Response(200, json={"d": [{"Date": "/Date(1793000000000)/", "Clicks": 14, "Impressions": 300}]})
    if "GetQueryStats" in url:
        return httpx.Response(200, json={"d": [{"Query": "visa seville prix", "Date": "/Date(1793000000000)/", "Clicks": 4, "Impressions": 60, "AvgImpressionPosition": 6.0}]})
    if url.endswith("/v4/user"):
        return httpx.Response(200, json={"user_id": 7})
    if "search-queries/popular" in url:
        return httpx.Response(200, json={"count": 1, "queries": [{"query_text": "виза дубай", "indicators": {"TOTAL_SHOWS": 40, "TOTAL_CLICKS": 3, "AVG_SHOW_POSITION": 7.5}}]})
    if "pagespeedonline" in url:
        return httpx.Response(200, json={"lighthouseResult": {"categories": {"performance": {"score": .82}}}, "loadingExperience": {"metrics": {"LARGEST_CONTENTFUL_PAINT_MS": {"percentile": 2300}, "INTERACTION_TO_NEXT_PAINT": {"percentile": 170}, "CUMULATIVE_LAYOUT_SHIFT_SCORE": {"percentile": 6}}}})
    if "openrouter.ai/api/v1/key" in url:
        return httpx.Response(200, json={"data": {"free_model_daily_requests": {"used": 3, "limit": 50, "remaining": 47}}})
    if "openrouter.ai/api/v1/chat" in url:
        return httpx.Response(200, json={"model": "fake/free-model:free", "choices": [{"message": {"content": "The page title now leads with the price. The old wording about gifts was removed."}}]})
    if "status.search.google.com/incidents.json" in url:  # Google's list of ranking updates, dated from today so the demo always has some
        from datetime import date, timedelta
        day = lambda n: f"{(date.today() - timedelta(days=n)).isoformat()}T16:00:00+00:00"  # noqa: E731
        return httpx.Response(200, json=[
            {"id": "fakecore3", "begin": day(7), "external_desc": "This month's core update", "service_name": "Ranking", "uri": "incidents/fakecore3"},
            {"id": "fakespam2", "begin": day(45), "end": day(38), "external_desc": "Spam update", "service_name": "Ranking", "uri": "incidents/fakespam2"},
            {"id": "fakecore1", "begin": day(95), "end": day(80), "external_desc": "Earlier core update", "service_name": "Ranking", "uri": "incidents/fakecore1"},
            {"id": "fakecrawl", "begin": day(20), "external_desc": "Crawling issue", "service_name": "Crawling"},
        ])
    if "openpagerank" in url:
        return httpx.Response(200, json={"data": []})
    if "api.brightdata.com/datasets" in url or "api.semscraper.com" in url:  # What AI says (tests/ui/fake_ai_brand.py)
        from tests.ui import fake_ai_brand
        return fake_ai_brand.answer(request)
    return httpx.Response(404, json={"error": {"message": f"The fake doesn't know {url}"}})


def install() -> None:
    fake = httpx.MockTransport(_answer)
    http.transport = fake
    credentials.transport = fake
    credentials.token_override = lambda connection_id: "fake-token"
    history.transport = fake  # the Wayback Machine's copy of one page; the archive's index for a whole site stays demo_world's
    history.is_allowed = lambda url: url.startswith("https://web.archive.org/")
