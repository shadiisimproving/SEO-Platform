"""Where each site's data comes from: Google connections, and which site uses what.

A site that doesn't use a source says so, and that's fine: no alert, the data just doesn't show.
"""
from __future__ import annotations

import json
import re
from urllib.parse import quote

from sqlalchemy import Engine, text

from seo.collectors import http
from seo.collectors.http import SourceError
from seo.core import crypto
from seo.core.errors import NotFound, Refused
from seo.sources import credentials

SOURCES = ("gsc", "ga4", "clarity", "bing", "yandex", "pagespeed")
GOOGLE_SOURCES = ("gsc", "ga4")
# Keys kept once for the whole app, in the connections table with the search tools.
APP_KEYS = {"bing": "Bing Webmaster", "yandex": "Yandex Webmaster", "pagespeed": "PageSpeed Insights", "openpagerank": "Open PageRank", "moz": "Moz", "cloudflare": "Cloudflare Radar", "indexnow": "IndexNow", "openrouter": "OpenRouter"}


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


def _seal(value: str, key_path=None) -> str:
    try:
        return crypto.encrypt(value, key_path)
    except (crypto.MissingKey, crypto.UnsafeKeyFile) as exc:
        raise Refused(str(exc)) from exc


def _google_row(row) -> dict:
    return {
        "id": row["id"], "label": row["label"], "kind": row["kind"], "last4": row["last4"], "robot_email": row["robot_email"],
        "last_ok_at": _iso(row["last_ok_at"]), "last_error": row["last_error"],
    }


def list_google(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM google_connections ORDER BY id")).mappings().all()
    return [_google_row(row) for row in rows]


def add_google(engine: Engine, label, kind, payload, key_path=None) -> dict:
    parsed = credentials.parse_key(kind, payload)
    name = label.strip()[:120] if isinstance(label, str) and label.strip() else (parsed.robot_email or "OAuth keys")[:120]
    sealed = _seal(json.dumps(parsed.secret), key_path)
    with engine.begin() as conn:
        new_id = conn.execute(
            text("INSERT INTO google_connections (label, kind, secret, last4, robot_email) VALUES (:l, :k, :s, :f, :e)"),
            {"l": name, "k": parsed.kind, "s": sealed, "f": parsed.last4, "e": parsed.robot_email},
        ).lastrowid
    return get_google(engine, new_id)


def get_google(engine: Engine, connection_id: int) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM google_connections WHERE id = :i"), {"i": connection_id}).mappings().first()
    if row is None:
        raise NotFound("That Google connection doesn't exist.")
    return _google_row(row)


def remove_google(engine: Engine, connection_id: int) -> None:
    """Sites keep their data and their property. They just wait for another connection."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM google_connections WHERE id = :i"), {"i": connection_id})
    credentials.forget(connection_id)


def _note_google(engine: Engine, connection_id: int, error: str | None) -> None:
    with engine.begin() as conn:
        if error is None:
            conn.execute(text("UPDATE google_connections SET last_ok_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = :i"), {"i": connection_id})
        else:
            conn.execute(text("UPDATE google_connections SET last_error = :e WHERE id = :i"), {"e": error[:500], "i": connection_id})


def test_google(engine: Engine, connection_id: int) -> dict:
    """Checks Search Console and GA4 separately, because a key can work for one and not the other. Lists what it can see, to pick from."""
    get_google(engine, connection_id)
    answer = {"search_console": {"ok": False, "properties": []}, "ga4": {"ok": False, "properties": []}}
    try:
        token = credentials.access_token(engine, connection_id)
    except (credentials.CredentialsFailed, ConnectionError) as exc:
        message = str(exc)
        answer["search_console"]["error"] = answer["ga4"]["error"] = message
        _note_google(engine, connection_id, message)
        return answer
    headers = {"Authorization": f"Bearer {token}"}
    try:
        body = http.request("GET", "https://www.googleapis.com/webmasters/v3/sites", "Search Console", headers=headers).json()
        answer["search_console"] = {"ok": True, "properties": sorted(entry["siteUrl"] for entry in body.get("siteEntry", []) if entry.get("siteUrl"))}
    except SourceError as exc:
        answer["search_console"]["error"] = _api_hint(str(exc), "Search Console API")
    try:
        body = http.request("GET", "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", "Google Analytics", headers=headers).json()
        found = []
        for account in body.get("accountSummaries", []):
            for prop in account.get("propertySummaries", []):
                number = str(prop.get("property", "")).replace("properties/", "")
                if number:
                    found.append({"id": number, "name": prop.get("displayName") or number, "account": account.get("displayName")})
        answer["ga4"] = {"ok": True, "properties": found}
    except SourceError as exc:
        answer["ga4"]["error"] = _api_hint(str(exc), "Analytics Admin API")
    # Listing properties uses the Admin API, but the daily pull reads numbers through the Data API, a separate switch in
    # Google Cloud. Without this one small report, Test said "works" while every pull failed.
    prop = _ga4_property_for(engine, connection_id) or (answer["ga4"]["properties"][0]["id"] if answer["ga4"]["properties"] else None)
    if answer["ga4"]["ok"] and prop:
        try:
            http.request(
                "POST", f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", "Google Analytics", headers=headers,
                json={"dateRanges": [{"startDate": "yesterday", "endDate": "yesterday"}], "metrics": [{"name": "sessions"}], "limit": 1},
            )
        except SourceError as exc:
            answer["ga4"]["ok"] = False
            answer["ga4"]["error"] = _api_hint(str(exc), "Google Analytics Data API")
    ok = answer["search_console"]["ok"] or answer["ga4"]["ok"]
    problem = None if ok else (answer["search_console"].get("error") or answer["ga4"].get("error"))
    _note_google(engine, connection_id, problem)
    answer["reading"] = _read_again_after_test(engine, connection_id, [s for s, k in (("gsc", "search_console"), ("ga4", "ga4")) if answer[k]["ok"]])
    return answer


def _read_again_after_test(engine: Engine, connection_id: int, working: list[str]) -> int:
    """A passing Test means an old "stopped working" is out of date: it was only cleared by the next good pull, up to 20 h
    later. Its sites are read again now instead. If that read still fails, the error comes back within the minute,
    so nothing is hidden. Returns how many reads were queued.
    """
    if not working:
        return 0
    from seo.collectors import jobs  # jobs imports this module

    marks = ", ".join(f":c{n}" for n in range(len(working)))
    values = {"i": connection_id, **{f"c{n}": s for n, s in enumerate(working)}}
    with engine.begin() as conn:
        rows = conn.execute(
            text(f"SELECT site_id, source FROM site_sources WHERE connection_id = :i AND source IN ({marks}) AND not_used = 0 AND last_error IS NOT NULL"), values
        ).all()
        conn.execute(
            text(f"UPDATE site_sources SET last_error = NULL, last_attempt_at = NULL WHERE connection_id = :i AND source IN ({marks}) AND not_used = 0 AND last_error IS NOT NULL"),
            values,
        )
    return sum(1 for site_id, source in rows if jobs.enqueue_one(engine, site_id, source))


def _ga4_property_for(engine: Engine, connection_id: int) -> str | None:
    """A property a site really pulls with this connection, so Test reads what the pull will read."""
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT property FROM site_sources WHERE source = 'ga4' AND connection_id = :i AND not_used = 0 AND property IS NOT NULL AND property <> '' ORDER BY site_id LIMIT 1"),
            {"i": connection_id},
        ).scalar()


_PROJECT = re.compile(r"project (\d+)")


def _api_hint(message: str, api_name: str) -> str:
    if "has not been used" in message or "is disabled" in message:
        project = _PROJECT.search(message)
        return f"Turn on the {api_name} in your Google Cloud project{f' {project.group(1)}' if project else ''}, then press Test again."
    return message


# ---- Which site uses what ----------------------------------------------------------------------


def _source_row(row) -> dict:
    return {
        "site_id": row["site_id"], "source": row["source"], "connection_id": row["connection_id"], "property": row["property"],
        "last4": row["last4"], "not_used": bool(row["not_used"]), "data_through": row["data_through"].isoformat() if row["data_through"] else None,
        "last_attempt_at": _iso(row["last_attempt_at"]), "last_ok_at": _iso(row["last_ok_at"]), "last_error": row["last_error"],
        "has_secret": bool(row["secret"]),
    }


def _site_exists(engine: Engine, site_id) -> None:
    with engine.connect() as conn:
        if not isinstance(site_id, int) or not conn.execute(text("SELECT 1 FROM sites WHERE id = :i AND kind = 'own'"), {"i": site_id}).first():
            raise NotFound("That site doesn't exist.")


def site_sources(engine: Engine, site_id: int | None = None) -> list[dict]:
    clause, values = ("WHERE site_id = :s", {"s": site_id}) if site_id is not None else ("", {})
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT * FROM site_sources {clause} ORDER BY site_id, source"), values).mappings().all()
    return [_source_row(row) for row in rows]


def save_site_source(engine: Engine, site_id, source, body: dict, key_path=None) -> dict:
    """Only what's sent changes, so choosing a property doesn't lose a pasted token."""
    if source not in SOURCES:
        raise Refused("That isn't a data source.")
    _site_exists(engine, site_id)
    prop = body.get("property")
    if prop is not None and not isinstance(prop, str):
        raise Refused("A property is text.")
    prop = prop.strip()[:255] if isinstance(prop, str) else None
    connection_id = body.get("connection_id")
    if connection_id is not None:
        if source not in GOOGLE_SOURCES:
            raise Refused("Only Search Console and GA4 use a Google connection.")
        get_google(engine, connection_id) if isinstance(connection_id, int) else (_ for _ in ()).throw(Refused("Pick a Google connection."))
    if source == "gsc" and prop and not (prop.startswith("sc-domain:") or prop.startswith(("https://", "http://"))):
        raise Refused("A Search Console property looks like sc-domain:example.com or https://example.com/.")
    if source == "ga4" and prop and not prop.isdigit():
        raise Refused("A GA4 property is its number, such as 123456789. It isn't the G-XXXX measurement ID.")
    token = body.get("token")
    if token is not None and (not isinstance(token, str) or not token.strip()):
        raise Refused("Paste the token first.")
    if token and source != "clarity":
        raise Refused("Only Clarity has a token per site.")
    values = {"s": site_id, "c": source}
    sets = []
    if "property" in body:
        sets.append("property = :p")
        values["p"] = prop or None
    if "connection_id" in body:
        sets.append("connection_id = :g")
        values["g"] = connection_id
    if "not_used" in body:
        if not isinstance(body["not_used"], bool):
            raise Refused("Not used is yes or no.")
        sets.append("not_used = :n")
        values["n"] = body["not_used"]
    if token:
        sets.extend(["secret = :x", "last4 = :f", "last_error = NULL"])
        values["x"] = _seal(token.strip(), key_path)
        values["f"] = crypto.last_four(token.strip())
    if not sets:
        raise Refused("Nothing to change.")
    with engine.begin() as conn:
        conn.execute(text("INSERT IGNORE INTO site_sources (site_id, source) VALUES (:s, :c)"), {"s": site_id, "c": source})
        conn.execute(text(f"UPDATE site_sources SET {', '.join(sets)} WHERE site_id = :s AND source = :c"), values)
        row = conn.execute(text("SELECT * FROM site_sources WHERE site_id = :s AND source = :c"), {"s": site_id, "c": source}).mappings().first()
    return _source_row(row)


# ---- Keys kept once for the app ------------------------------------------------------------------


def _app_tool(source: str) -> str:
    if source not in APP_KEYS:
        raise Refused("That isn't one of the app's keys.")
    return APP_KEYS[source]


def save_app_key(engine: Engine, source: str, key, key_path=None) -> dict:
    tool = _app_tool(source)
    secret = key.strip() if isinstance(key, str) else ""
    if not secret:
        raise Refused("Paste the key first.")
    sealed = _seal(secret, key_path)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO connections (tool, secret, last4) VALUES (:t, :s, :l) ON DUPLICATE KEY UPDATE secret = :s, last4 = :l, last_error = NULL"),
            {"t": tool, "s": sealed, "l": crypto.last_four(secret)},
        )
    return app_key_status(engine, source)


def app_key_status(engine: Engine, source: str) -> dict:
    tool = _app_tool(source)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT last4, last_ok_at, last_error FROM connections WHERE tool = :t"), {"t": tool}).mappings().first()
    if row is None:
        return {"id": source, "tool": tool, "connected": False}
    return {"id": source, "tool": tool, "connected": True, "last4": row["last4"], "last_ok_at": _iso(row["last_ok_at"]), "last_error": row["last_error"]}


def remove_app_key(engine: Engine, source: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM connections WHERE tool = :t"), {"t": _app_tool(source)})


def app_key(engine: Engine, source: str, key_path=None) -> str | None:
    """The key itself, for a collector. None when there isn't one."""
    with engine.connect() as conn:
        sealed = conn.execute(text("SELECT secret FROM connections WHERE tool = :t"), {"t": _app_tool(source)}).scalar()
    if not sealed:
        return None
    try:
        return crypto.decrypt(sealed, key_path)
    except (crypto.MissingKey, crypto.UnsafeKeyFile, crypto.BadKey) as exc:
        note_app_key(engine, source, str(exc))
        return None


def note_app_key(engine: Engine, source: str, error: str | None) -> None:
    with engine.begin() as conn:
        if error is None:
            conn.execute(text("UPDATE connections SET last_ok_at = UTC_TIMESTAMP(3), last_error = NULL WHERE tool = :t"), {"t": _app_tool(source)})
        else:
            conn.execute(text("UPDATE connections SET last_error = :e WHERE tool = :t"), {"e": error[:500], "t": _app_tool(source)})


def test_app_key(engine: Engine, source: str) -> dict:
    """{ok, note}. ok is None when the only way to check a key would spend what it's for, and it says so."""
    tool = _app_tool(source)
    key = app_key(engine, source)
    if not key:
        return {"ok": False, "note": "Paste the key first."}
    try:
        if source == "bing":
            http.request("GET", "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites", tool, params={"apikey": key})
        elif source == "yandex":
            http.request("GET", "https://api.webmaster.yandex.net/v4/user", tool, headers={"Authorization": f"OAuth {key}"})
        elif source == "pagespeed":
            http.request("GET", "https://www.googleapis.com/pagespeedonline/v5/runPagespeed", tool, timeout=120, params={"url": "https://example.com/", "category": "best-practices", "key": key})
        elif source == "openpagerank":
            http.request("POST", "https://openpagerank.keywordseverywhere.com/v1/domains/bulk", tool, headers={"Authorization": f"Bearer {key}"}, json={"domains": ["example.com"]})
        elif source == "openrouter":
            daily = http.request("GET", "https://openrouter.ai/api/v1/key", tool, headers={"Authorization": f"Bearer {key}"}).json().get("data", {}).get("free_model_daily_requests") or {}
            note_app_key(engine, source, None)
            return {"ok": True, "note": "Works.", "left": daily.get("remaining"), "of": daily.get("limit")}
        elif source == "cloudflare":
            # Radar itself, not /user/tokens/verify: that one rejects account API tokens as "Invalid API Token",
            # though they read Radar fine. This also proves the token has Radar access. It costs nothing.
            http.request("GET", "https://api.cloudflare.com/client/v4/radar/ranking/top", tool, params={"limit": 1}, headers={"Authorization": f"Bearer {key}"})
        else:
            return {"ok": None, "note": "This key can't be checked until it's first used."}
    except SourceError as exc:
        message = str(exc)
        if source == "cloudflare" and exc.kind == "auth":
            message = message.rstrip(".") + ". Use an API token with Account, Radar, Read access, made under API Tokens. The Global API Key and the Origin CA key don't work here."
        note_app_key(engine, source, message)
        return {"ok": False, "note": message}
    note_app_key(engine, source, None)
    return {"ok": True, "note": "Works."}


def overview(engine: Engine) -> dict:
    """Everything the Connections page shows. Secrets never leave this module: only the last 4 characters do."""
    with engine.connect() as conn:
        sites = conn.execute(text("SELECT id, host FROM sites WHERE kind = 'own' ORDER BY host")).mappings().all()
    return {
        "google": list_google(engine),
        "sites": [dict(row) for row in sites],
        "site_sources": site_sources(engine),
        "keys": [app_key_status(engine, source) for source in APP_KEYS],
    }


def encode_property(prop: str) -> str:
    return quote(prop, safe="")
