"""A fake Google, Bing, Yandex, Clarity and PageSpeed for trying the screens by hand. Nothing leaves the machine.

Numbers are worked out from the date, so a day always gives the same answer, and they go through the real collectors.
"""
from __future__ import annotations

import json
from datetime import date

import httpx

from seo.collectors import http
from seo.sources import credentials

PROPERTIES = lambda: ["sc-domain:mine-one.test", "sc-domain:mine-two.test", "https://mine-three.test/"]  # noqa: E731
KEYS = {"gsc_fail": False}


def _wave(day: str, base: int, salt: int = 0) -> int:
    value = date.fromisoformat(day).toordinal() + salt
    return max(0, base + (value * 7919 % 41) - 20 + (2 if date.fromisoformat(day).weekday() < 5 else -base // 4))


def _gsc(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    dims, start, end = body["dimensions"], body["startDate"], body["endDate"]
    if dims == ["date"]:
        first, last = date.fromisoformat(start).toordinal(), date.fromisoformat(end).toordinal()
        rows = []
        for ordinal in range(max(first, last - 480), last + 1):
            day = date.fromordinal(ordinal).isoformat()
            rows.append({"keys": [day], "clicks": _wave(day, 120), "impressions": _wave(day, 120) * 22, "position": 6 + (ordinal % 9) / 3})
        return httpx.Response(200, json={"rows": rows})
    pages = [("https://mine-one.test/visa/", 60, 4.2), ("https://mine-one.test/creer-societe/", 35, 7.5), ("https://mine-one.test/", 20, 3.1), ("https://mine-one.test/blog/freezone-dubai/", 9, 14.0)]
    queries = [("créer société dubai", 40, 5.1), ("visa dubai prix", 30, 3.4), ("emirates id", 18, 5.2), ("freezone dubai", 11, 12.0), ("loyer a dubai", 6, 23.0), ("coût de la vie dubaï", 3, 44.0), ("ouvrir un compte", 1, 61.0)]
    if dims == ["page"]:
        rows = [{"keys": [url], "clicks": _wave(start, base, n), "impressions": _wave(start, base, n) * 20, "position": pos} for n, (url, base, pos) in enumerate(pages)]
    elif dims == ["query"]:
        rows = [{"keys": [text], "clicks": _wave(start, base, n), "impressions": _wave(start, base, n) * 20, "position": pos} for n, (text, base, pos) in enumerate(queries)]
    else:
        rows = [{"keys": [text, pages[n % len(pages)][0]], "clicks": _wave(start, base, n), "impressions": _wave(start, base, n) * 20, "position": pos} for n, (text, base, pos) in enumerate(queries)]
    return httpx.Response(200, json={"rows": rows})


def _ga4(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    names = [d["name"] for d in body["dimensions"]]
    day = body["dateRanges"][0]["startDate"]
    w = lambda base, salt=0: str(_wave(day, base, salt))  # noqa: E731
    if names[0] == "sessionDefaultChannelGroup":
        table = [["Organic Search", "google", "organic", w(140), w(120), w(5, 1)], ["Direct", "(direct)", "(none)", w(60, 2), w(50, 2), w(3, 2)], ["Referral", "blog-expat.test", "referral", w(22, 3), w(20, 3), w(2, 3)], ["Referral", "chatgpt.com", "referral", w(12, 4), w(11, 4), w(1, 4)], ["Organic Social", "facebook.com", "social", w(18, 5), w(16, 5), "0"], ["Paid Search", "google", "cpc", w(30, 6), w(28, 6), w(2, 6)], ["Email", "newsletter", "email", w(8, 7), w(8, 7), "0"]]
    elif names[0] == "landingPage":
        table = [["/visa/", w(90), w(80), w(4, 1)], ["/creer-societe/", w(60, 2), w(50, 2), w(5, 2)], ["/", w(40, 3), w(35, 3), "0"], ["/blog/freezone-dubai/", w(25, 4), w(22, 4), w(1, 4)], ["/contact/", w(10, 5), w(10, 5), w(3, 5)]]
    elif names[0] == "sessionSource":
        table = [["blog-expat.test", "referral", "/visa/", "(not set)", w(12, 1), w(1, 1)], ["blog-expat.test", "referral", "/visa/", "bl-1", w(3, 2), "0"], ["chatgpt.com", "referral", "/creer-societe/", "(not set)", w(12, 3), w(1, 3)], ["google", "organic", "/visa/", "(not set)", w(90, 4), w(3, 4)]]
    elif names[0] == "sessionManualSource":
        table = [["blog-expat", "backlink", "bl-1", "/visa/", w(4, 1), w(1, 1)], ["(not set)", "(not set)", "(not set)", "/visa/", w(90, 2), w(3, 2)]]
    else:
        table = [["Brand FR", w(14, 1), w(30, 1), w(14, 1), w(1, 1)], ["Visa UAE", w(9, 2), w(22, 2), w(9, 2), w(1, 2)]]
    cut = len(names)
    return httpx.Response(200, json={"rows": [{"dimensionValues": [{"value": v} for v in row[:cut]], "metricValues": [{"value": v} for v in row[cut:]]} for row in table], "rowCount": len(table), "metadata": {"currencyCode": "EUR", "subjectToThresholding": date.fromisoformat(day).toordinal() % 11 == 0}})


def _answer(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if "searchAnalytics" in url:
        return _gsc(request)
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
        return httpx.Response(200, json={"d": [{"Query": "visa dubai prix", "Date": "/Date(1793000000000)/", "Clicks": 4, "Impressions": 60, "AvgImpressionPosition": 6.0}]})
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
    if "openpagerank" in url:
        return httpx.Response(200, json={"data": []})
    return httpx.Response(404, json={"error": {"message": f"The fake doesn't know {url}"}})


def install() -> None:
    fake = httpx.MockTransport(_answer)
    http.transport = fake
    credentials.transport = fake
    credentials.token_override = lambda connection_id: "fake-token"
