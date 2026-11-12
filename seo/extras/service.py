"""The optional extras. Each is written from its documentation and tested on a fake: none has run on a real key yet.

Moz and Cloudflare run on the Important domains list. Since 2026-11-09 the owner wants every website on it: my own sites
and each competitor that's On are added and looked up once a month by `seo.extras.auto`, within Moz's free rows.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.accounts import access
from seo.collectors import http
from seo.collectors.http import SourceError
from seo.competitors import tracking
from seo.core.errors import Refused
from seo.sources import service as sources

MOZ_URL = "https://api.moz.com/jsonrpc"
MOZ_FREE_ROWS = 50
RADAR_URL = "https://api.cloudflare.com/client/v4/radar/ranking/domain/{domain}"
INDEXNOW_URL = "https://api.indexnow.org/indexnow"
INDEXNOW_MOST = 10000
SUGGEST_URL = "https://suggestqueries.google.com/complete/search"
_DOMAIN = re.compile(r"^(?=.{1,190}$)([a-z0-9-]+\.)+[a-z]{2,}$")


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


def clean_domain(value) -> str:
    raw = value.strip().lower() if isinstance(value, str) else ""
    host = (urlsplit(raw).hostname if "://" in raw else raw.split("/")[0]) or ""
    host = host.removeprefix("www.")
    if not _DOMAIN.match(host):
        raise Refused("Enter a domain, such as example.com.")
    return host


# ---- Important domains ---------------------------------------------------------------------------


def moz_rows_used(engine: Engine) -> int:
    """One row per domain fetched this calendar month, counted from what's stored, so nothing can drift."""
    with engine.connect() as conn:
        return int(conn.execute(text("SELECT COUNT(*) FROM moz_metrics WHERE fetched_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01')")).scalar())


def list_important(engine: Engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT m.*, (SELECT a.score FROM authority_monthly a WHERE a.domain = m.target ORDER BY a.month DESC LIMIT 1) AS authority "
                "FROM moz_metrics m WHERE m.important = 1 ORDER BY m.created_at DESC"
            )
        ).mappings().all()
    used = moz_rows_used(engine)
    return {
        "rows_left": max(0, MOZ_FREE_ROWS - used), "rows_used": used, "rows_free": MOZ_FREE_ROWS,
        "moz_connected": sources.app_key_status(engine, "moz")["connected"], "radar_connected": sources.app_key_status(engine, "cloudflare")["connected"],
        "domains": [{
            "domain": r["target"], "authority": r["authority"], "domain_authority": r["domain_authority"], "linking_domains": r["linking_domains"], "external_links": r["external_links"],
            "fetched_at": _iso(r["fetched_at"]), "popularity": r["popularity"],
        } for r in rows],
    }


def mark(engine: Engine, domain, important: bool = True) -> dict:
    host = clean_domain(domain)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO moz_metrics (target, important) VALUES (:t, :i) ON DUPLICATE KEY UPDATE important = :i"), {"t": host, "i": important})
    return list_important(engine)


def fetch_moz(engine: Engine, domains: list | None = None) -> dict:
    """Only domains marked important with nothing stored this month. It stops at the free rows, and never pays."""
    key = sources.app_key(engine, "moz")
    if not key:
        raise Refused("Connect Moz in Settings first.")
    with engine.connect() as conn:
        waiting = [row[0] for row in conn.execute(
            text("SELECT target FROM moz_metrics WHERE important = 1 AND (fetched_at IS NULL OR fetched_at < DATE_FORMAT(UTC_DATE(), '%Y-%m-01')) ORDER BY created_at")
        ).all()]
        # A competitor no site has on never uses Moz rows, even free ones.
        paused = {host.removeprefix("www.").lower() for host in tracking.hosts_not_on(conn)}
    skipped = [d for d in waiting if d in paused]
    waiting = [d for d in waiting if d not in paused]
    if domains is not None:
        order = {d: n for n, d in enumerate(dict.fromkeys(clean_domain(d) for d in domains))}
        waiting = sorted((d for d in waiting if d in order), key=order.get)  # in the order asked: auto puts my own sites first
        skipped = [d for d in skipped if d in order]
    left = max(0, MOZ_FREE_ROWS - moz_rows_used(engine))
    done, failed = 0, None
    for domain in waiting[:left]:
        # Claimed before the call (F79): a profile click and the nightly job at the same moment fetch it once, and a
        # call that dies half-way still counts as this month's row. Only a clear refusal gives the row back.
        with engine.begin() as conn:
            before = conn.execute(text("SELECT fetched_at FROM moz_metrics WHERE target = :t"), {"t": domain}).scalar()
            claimed = conn.execute(
                text("UPDATE moz_metrics SET fetched_at = UTC_TIMESTAMP(3) WHERE target = :t AND (fetched_at IS NULL OR fetched_at < DATE_FORMAT(UTC_DATE(), '%Y-%m-01'))"),
                {"t": domain},
            ).rowcount
        if not claimed:
            continue  # someone else is fetching it right now
        give_back = lambda: _unclaim(engine, domain, before)  # noqa: E731
        try:
            reply = http.request(
                "POST", MOZ_URL, "Moz", headers={"x-moz-token": key},
                json={"jsonrpc": "2.0", "id": f"seo-cc-{domain}", "method": "data.site.metrics.fetch", "params": {"data": {"site_query": {"query": domain, "scope": "domain"}}}},
            ).json()
        except SourceError as exc:
            failed = str(exc)
            if exc.kind in ("auth", "quota"):  # refused before anything was looked up
                give_back()
            sources.note_app_key(engine, "moz", failed)
            break
        if isinstance(reply, dict) and reply.get("error"):
            failed = str(reply["error"].get("message") if isinstance(reply["error"], dict) else reply["error"])[:300]
            give_back()
            break
        metrics = ((reply.get("result") or reply).get("site_metrics") or {}) if isinstance(reply, dict) else {}
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE moz_metrics SET domain_authority = :a, linking_domains = :l, external_links = :x, fetched_at = UTC_TIMESTAMP(3) WHERE target = :t"),
                {"t": domain, "a": metrics.get("domain_authority"), "l": metrics.get("root_domains_to_root_domain"), "x": metrics.get("external_pages_to_root_domain")},
            )
        done += 1
    if done and not failed:
        sources.note_app_key(engine, "moz", None)
    return {**list_important(engine), "fetched": done, "held_back": max(0, len(waiting) - left), "skipped_competitors": len(skipped), "error": failed}


def _unclaim(engine: Engine, domain: str, before) -> None:
    with engine.begin() as conn:
        conn.execute(text("UPDATE moz_metrics SET fetched_at = :b WHERE target = :t"), {"t": domain, "b": before})


def fetch_popularity(engine: Engine, only: list | None = None, stale_only: bool = False) -> dict:
    """Cloudflare's rank bucket for each important domain. `only` narrows it; `stale_only` skips what was read this month."""
    key = sources.app_key(engine, "cloudflare")
    if not key:
        raise Refused("Connect Cloudflare Radar in Settings first.")
    stale = " AND (popularity_at IS NULL OR popularity_at < DATE_FORMAT(UTC_DATE(), '%Y-%m-01'))" if stale_only else ""
    with engine.connect() as conn:
        domains = [row[0] for row in conn.execute(text(f"SELECT target FROM moz_metrics WHERE important = 1{stale} ORDER BY created_at")).all()]
    if only is not None:
        wanted = {clean_domain(d) for d in only}
        domains = [d for d in domains if d in wanted]
    failed = None
    for domain in domains:
        try:
            body = http.request("GET", RADAR_URL.format(domain=domain), "Cloudflare Radar", headers={"Authorization": f"Bearer {key}"}).json()
        except SourceError as exc:
            if "doesn't know" in str(exc):  # not in its ranking at all: a real answer, shown as such
                with engine.begin() as conn:
                    conn.execute(text("UPDATE moz_metrics SET popularity = 'Not ranked', popularity_at = UTC_TIMESTAMP(3) WHERE target = :t"), {"t": domain})
                continue
            failed = str(exc)
            sources.note_app_key(engine, "cloudflare", failed)
            break
        details = (body.get("result") or {}).get("details_0") or {}
        rank = details.get("rank")
        word = details.get("bucket") or (f"Rank {rank}" if rank else "Not ranked")
        with engine.begin() as conn:
            conn.execute(text("UPDATE moz_metrics SET popularity = :p, popularity_at = UTC_TIMESTAMP(3) WHERE target = :t"), {"t": domain, "p": str(word)[:40]})
    if not failed:
        sources.note_app_key(engine, "cloudflare", None)
    return {**list_important(engine), "error": failed}


# ---- IndexNow ------------------------------------------------------------------------------------


def indexnow(engine: Engine, site_id, urls) -> dict:
    """Pushes new pages to Bing, Yandex and others. Google doesn't take part. Only addresses on this site go."""
    key = sources.app_key(engine, "indexnow")
    if not key:
        raise Refused("Connect IndexNow in Settings first.")
    if not re.fullmatch(r"[0-9a-zA-Z-]{8,128}", key):
        raise Refused("An IndexNow key is 8 to 128 letters, digits or dashes. Paste it again in Settings.")
    with engine.connect() as conn:
        access.require_site_or_every(site_id, conn)  # chosen access: one of their sites
        host = conn.execute(text("SELECT host FROM sites WHERE id = :i AND kind = 'own'"), {"i": site_id}).scalar()
    if not host:
        raise Refused("That site isn't one of yours.")
    lines = urls.splitlines() if isinstance(urls, str) else urls if isinstance(urls, list) else []
    clean = [u.strip() for u in lines if isinstance(u, str) and u.strip()]
    if not clean:
        raise Refused("Paste at least one address.")
    if len(clean) > INDEXNOW_MOST:
        raise Refused(f"At most {INDEXNOW_MOST} addresses at a time.")
    wrong = [u for u in clean if (urlsplit(u).hostname or "").removeprefix("www.") != host or urlsplit(u).scheme not in ("http", "https")]
    if wrong:
        raise Refused(f"Not on {host}: {wrong[0]}")
    sent_host = urlsplit(clean[0]).hostname
    try:
        reply = http.request("POST", INDEXNOW_URL, "IndexNow", json={"host": sent_host, "key": key, "urlList": clean})
    except SourceError as exc:
        hint = f"Check the key file is at https://{sent_host}/{key}.txt, then try again." if exc.kind == "auth" else str(exc)
        sources.note_app_key(engine, "indexnow", hint)
        raise Refused(hint) from exc
    sources.note_app_key(engine, "indexnow", None)
    return {"sent": len(clean), "pending_key_check": reply.status_code == 202}


# ---- Keyword ideas -------------------------------------------------------------------------------


def keyword_ideas(query, language: str = "", country: str = "") -> list[str]:
    """What people really type, from Google's autocomplete. Free and unofficial, so it can break, and it says so."""
    text_value = query.strip() if isinstance(query, str) else ""
    if not text_value:
        raise Refused("Type a word or two first.")
    if len(text_value) > 120:
        raise Refused("That's too long.")
    params = {"client": "firefox", "q": text_value}
    if language:
        params["hl"] = language[:5]
    if country:
        params["gl"] = country[:2]
    try:
        body = http.request("GET", SUGGEST_URL, "Google Autocomplete", timeout=15, params=params).json()
    except (SourceError, ValueError) as exc:
        raise Refused("Google Autocomplete didn't answer. Try again later.") from exc
    if not isinstance(body, list) or len(body) < 2 or not isinstance(body[1], list):
        raise Refused("Google Autocomplete changed; no ideas for now.")
    return [str(item) for item in body[1]][:20]
