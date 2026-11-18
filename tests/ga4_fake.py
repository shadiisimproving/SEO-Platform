"""A fake GA4 Data API that answers any report from a list of visit groups, as GA4 would: it groups them by the dimensions
asked for and adds up the metrics. With eventName in the dimensions, each key event of a group is its own row, and
keyEvents / sessions are that event's count and the sessions it happened in. A report is only rows with a metric above 0.

A visit group: {channel, source, medium, manual_source, manual_medium, campaign, page, host, sessions, users,
events: {name: (count, sessions)}}.
"""
from __future__ import annotations

import json
from collections import defaultdict

import httpx

DIMENSION = {
    "sessionDefaultChannelGroup": "channel", "sessionSource": "source", "sessionMedium": "medium",
    "sessionManualSource": "manual_source", "sessionManualMedium": "manual_medium", "sessionManualCampaignName": "campaign",
    "landingPage": "page", "hostName": "host",
}


def _value(group: dict, name: str, event: str | None) -> str:
    if name == "eventName":
        return event or ""
    if name == "isKeyEvent":
        return "true"
    return str(group.get(DIMENSION[name], "(not set)"))


def answer(request: httpx.Request, groups: list[dict], ads: list[list[str]] | None = None, currency: str = "EUR", thresholded: bool = False) -> httpx.Response:
    body = json.loads(request.content)
    dims = [d["name"] for d in body.get("dimensions") or []]
    metrics = [m["name"] for m in body.get("metrics") or []]
    if not dims:  # Test's small check that the Data API is on
        return httpx.Response(200, json={"rows": [{"metricValues": [{"value": "42"}]}], "rowCount": 1})
    meta = {"currencyCode": currency, "subjectToThresholding": thresholded}
    if dims[0] == "sessionGoogleAdsCampaignName":
        rows = ads or []
        return httpx.Response(200, json={"rows": [{"dimensionValues": [{"value": r[0]}], "metricValues": [{"value": v} for v in r[1:]]} for r in rows], "rowCount": len(rows), "metadata": meta})
    by_event = "eventName" in dims
    totals: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))
    for group in groups:
        events = group.get("events") or {}
        if by_event:
            for name, (count, sessions) in events.items():
                key = tuple(_value(group, d, name) for d in dims)
                totals[key]["keyEvents"] += count
                totals[key]["sessions"] += sessions
        else:
            key = tuple(_value(group, d, None) for d in dims)
            totals[key]["sessions"] += group.get("sessions", 0)
            totals[key]["totalUsers"] += group.get("users", group.get("sessions", 0))
            totals[key]["keyEvents"] += sum(count for count, _ in events.values())
    rows = [
        {"dimensionValues": [{"value": v} for v in key], "metricValues": [{"value": str(int(values[m]) if float(values[m]).is_integer() else values[m])} for m in metrics]}
        for key, values in totals.items() if any(values[m] for m in metrics)
    ]
    return httpx.Response(200, json={"rows": rows, "rowCount": len(rows), "metadata": meta})
