"""Is each of my websites up, and when do its certificate and domain name run out.

Cron queues a check every 15 minutes through enqueue_due(); on the Mac it only runs from the button. A check that's too old
reads as unknown, never as up, so a stopped scheduler can't look like a healthy site. Only a site whose kind is `own` is checked.
"""
from __future__ import annotations

import json
import socket
import ssl
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable
from urllib.parse import urlsplit

import httpx
from cryptography import x509
from sqlalchemy import Engine, text

from seo.backlinks.cleaner import root_domain
from seo.core import budget
from seo.core.errors import NotOwnSite, Refused, UnknownSite
from seo.crawl.fetch import USER_AGENT
from seo.crawl.guard import is_public_url
from seo.health import service as health_service
from seo.links import service as links_service
from seo.worker import queue
from seo.worker.runner import handler

LANE = "crawl"
JOB_KIND = "uptime.check"
CHECK_EVERY_MINUTES = 15
STALE_AFTER_MINUTES = 45  # three checks missed: from here on nobody knows
CERT_EVERY_HOURS = 20
DOMAIN_EVERY_DAYS = 7
EXPIRY_ALERT_DAYS = 14
HISTORY_DAYS = 30
CONFIRM_AFTER_SECONDS = 20  # a single failed read is often nothing. A site only counts as down if it fails twice.
UP, DOWN, UNKNOWN = "up", "down", "unknown"
RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json"
RDAP_MAX_BYTES = 1_000_000
RDAP_REDIRECTS = 3
BOOTSTRAP_KEEP_SECONDS = 86_400
CERTIFICATE_HAS_EXPIRED = 10  # OpenSSL's code for it

# What a read of the start page says about the site.
_DOWN_REASONS = {"gone": "page_error", "http_error": "page_error", "server_error": "server_error", "too_many_redirects": "redirect_loop"}
_NOT_KNOWN_REASONS = {"robots": "robots", "blocked": "turned_away", "rate_limited": "rate_limited", "refused": "refused"}


@dataclass
class Probe:
    state: str
    reason: str | None = None
    http_status: int | None = None


@dataclass
class Certificate:
    expires_at: datetime | None = None
    problem: str | None = None  # untrusted: it can't be verified, so no date from it means anything


class NoRdap(Exception):
    """The domain's ending has no RDAP server. Its date is entered by hand."""


class RdapFailed(Exception):
    """The server exists but gave no usable date this time."""


def internet_works() -> bool:
    """A failed read says nothing about a site if this computer is offline. It only opens a connection, and sends nothing."""
    try:
        with socket.create_connection(("1.1.1.1", 443), timeout=5):
            return True
    except OSError:
        return False


def read_certificate(host: str) -> Certificate:
    """When the certificate runs out. A connection that fails raises OSError, because that says nothing about the certificate."""
    context = ssl.create_default_context()
    try:
        with socket.create_connection((host, 443), timeout=10) as raw, context.wrap_socket(raw, server_hostname=host) as tls:
            return Certificate(datetime.fromtimestamp(ssl.cert_time_to_seconds(tls.getpeercert()["notAfter"]), tz=timezone.utc).replace(tzinfo=None))
    except ssl.SSLCertVerificationError as exc:
        if exc.verify_code != CERTIFICATE_HAS_EXPIRED:
            return Certificate(problem="untrusted")
    except (ssl.SSLError, KeyError, TypeError, ValueError):
        return Certificate(problem="untrusted")
    # Refused because it has expired. Its date is still worth showing, and is only used for that.
    unverified = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    unverified.check_hostname = False
    unverified.verify_mode = ssl.CERT_NONE
    with socket.create_connection((host, 443), timeout=10) as raw, unverified.wrap_socket(raw, server_hostname=host) as tls:
        return Certificate(x509.load_der_x509_certificate(tls.getpeercert(binary_form=True)).not_valid_after_utc.replace(tzinfo=None))


_bootstrap: tuple[float, dict[str, str]] | None = None


def _read_json(client: httpx.Client, url: str) -> dict:
    """Redirects one at a time, with the private address check on each, as the crawler does."""
    for _ in range(RDAP_REDIRECTS + 1):
        if not is_allowed(url):
            raise RdapFailed("refused")
        with client.stream("GET", url) as reply:
            if reply.status_code in (301, 302, 303, 307, 308) and reply.headers.get("location"):
                url = str(httpx.URL(url).join(reply.headers["location"]))
                continue
            if reply.status_code != 200:
                raise RdapFailed(f"http_{reply.status_code}")
            body = b""
            for chunk in reply.iter_bytes():
                body += chunk
                if len(body) > RDAP_MAX_BYTES:
                    raise RdapFailed("too_large")
        try:
            answer = json.loads(body)
        except ValueError as exc:
            raise RdapFailed("not_json") from exc
        if not isinstance(answer, dict):
            raise RdapFailed("not_json")
        return answer
    raise RdapFailed("too_many_redirects")


def _rdap_servers(client: httpx.Client) -> dict[str, str]:
    """IANA's list of which server answers for which ending. It rarely changes, so it's kept for a day."""
    global _bootstrap
    if _bootstrap and time.monotonic() - _bootstrap[0] < BOOTSTRAP_KEEP_SECONDS:
        return _bootstrap[1]
    servers: dict[str, str] = {}
    for entry in _read_json(client, RDAP_BOOTSTRAP).get("services", []):
        endings, addresses = entry[0], entry[1]
        address = next((a for a in addresses if a.startswith("https://")), None)
        if address:
            servers.update({ending.lower(): address for ending in endings})
    _bootstrap = (time.monotonic(), servers)
    return servers


def rdap_expiry(domain: str) -> date:
    """The registry's expiry date, free and with no key. Raises NoRdap for an ending with no server, such as .ae."""
    try:
        with httpx.Client(follow_redirects=False, timeout=15.0, trust_env=False, headers={"User-Agent": USER_AGENT, "Accept": "application/rdap+json, application/json"}) as client:
            server = _rdap_servers(client).get(domain.rsplit(".", 1)[-1].lower())
            if server is None:
                raise NoRdap(domain)
            answer = _read_json(client, f"{server.rstrip('/')}/domain/{domain}")
    except httpx.HTTPError as exc:
        raise RdapFailed("network") from exc
    for event in answer.get("events") or []:
        if isinstance(event, dict) and event.get("eventAction") == "expiration":
            try:
                return datetime.fromisoformat(str(event.get("eventDate")).replace("Z", "+00:00")).date()
            except ValueError as exc:
                raise RdapFailed("bad_date") from exc
    raise RdapFailed("no_date")


# Tests and the local harness replace these to run on a fake internet.
is_allowed: Callable[[str], bool] = is_public_url
certificate_read: Callable[[str], Certificate] = read_certificate
rdap_lookup: Callable[[str], date] = rdap_expiry
internet_ok: Callable[[], bool] = internet_works


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def _require_own(conn, site_id) -> dict:
    row = conn.execute(text("SELECT * FROM sites WHERE id = :i"), {"i": site_id}).mappings().first()
    if row is None:
        raise UnknownSite("That website doesn't exist.")
    if row["kind"] != links_service.OWN:
        raise NotOwnSite("Uptime is only watched on your own websites.")
    return dict(row)


def _ensure_monitor(conn, site_id: int) -> None:
    conn.execute(text("INSERT IGNORE INTO site_monitors (site_id) VALUES (:s)"), {"s": site_id})


# ---- reading the site ------------------------------------------------------------------------------

def probe(fetcher, url: str) -> Probe:
    answer = fetcher.get(url, any_type=True)
    if answer.status in ("ok", "not_html", "too_large", "not_modified"):
        return Probe(UP, http_status=answer.http_status)
    if answer.status in _DOWN_REASONS:
        return Probe(DOWN, _DOWN_REASONS[answer.status], answer.http_status)
    if answer.status == "network_error":
        return Probe(DOWN, "no_answer") if internet_ok() else Probe(UNKNOWN, "our_connection")
    return Probe(UNKNOWN, _NOT_KNOWN_REASONS.get(answer.status, answer.status), answer.http_status)


def _store(engine: Engine, site_id: int, host: str, seen: Probe) -> None:
    column = {UP: "up_checks", DOWN: "down_checks", UNKNOWN: "unknown_checks"}[seen.state]
    opened = closed = None
    with engine.begin() as conn:
        _ensure_monitor(conn, site_id)
        before = conn.execute(text("SELECT state FROM site_monitors WHERE site_id = :s FOR UPDATE"), {"s": site_id}).scalar()
        conn.execute(
            text(
                "UPDATE site_monitors SET state = :st, reason = :r, http_status = :h, last_checked_at = UTC_TIMESTAMP(3), "
                "state_since = IF(state <=> :st, state_since, UTC_TIMESTAMP(3)) WHERE site_id = :s"
            ),
            {"st": seen.state, "r": seen.reason, "h": seen.http_status, "s": site_id},
        )
        conn.execute(text(f"INSERT INTO uptime_days (site_id, day, {column}) VALUES (:s, UTC_DATE(), 1) ON DUPLICATE KEY UPDATE {column} = {column} + 1"), {"s": site_id})
        open_row = conn.execute(text("SELECT id, TIMESTAMPDIFF(MINUTE, started_at, UTC_TIMESTAMP(3)) AS minutes FROM uptime_incidents WHERE site_id = :s AND ended_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE"), {"s": site_id}).mappings().first()
        if seen.state == DOWN and open_row is None:
            conn.execute(text("INSERT INTO uptime_incidents (site_id, reason, http_status) VALUES (:s, :r, :h)"), {"s": site_id, "r": seen.reason, "h": seen.http_status})
            opened = True
        elif seen.state == UP and open_row is not None:  # an unknown read leaves it open: nobody can say it's over
            conn.execute(text("UPDATE uptime_incidents SET ended_at = UTC_TIMESTAMP(3) WHERE id = :i"), {"i": open_row["id"]})
            closed = open_row["minutes"]
    if opened:
        health_service._alert(engine, site_id, None, "uptime_down", "crit", f"{host} is down", {"reason": seen.reason, "http_status": seen.http_status, "state": "down"})
    elif closed is not None:
        health_service._alert(engine, site_id, None, "uptime_down", "warn", f"{host} was down for {closed} min and is back up", {"minutes": closed, "state": "back"})


def _alert_once(engine: Engine, site_id: int, kind: str, severity: str, title: str, detail: dict) -> None:
    """Once for each date and state. Someone who marked it as seen isn't told again every day, but is told again if it gets worse."""
    with engine.connect() as conn:
        known = conn.execute(
            text("SELECT 1 FROM alerts WHERE site_id = :s AND kind = :k AND JSON_VALUE(detail, '$.expires') = :e AND JSON_VALUE(detail, '$.state') = :st LIMIT 1"),
            {"s": site_id, "k": kind, "e": detail["expires"], "st": detail["state"]},
        ).first()
    if not known:
        health_service._alert(engine, site_id, None, kind, severity, title, detail)


def _clear_alert(engine: Engine, site_id: int, kind: str) -> None:
    """Renewed: an open alert about it would now be wrong. Nobody saw it, so it isn't kept as if they had."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM alerts WHERE site_id = :s AND kind = :k AND acknowledged_at IS NULL"), {"s": site_id, "k": kind})


def _judge_expiry(engine: Engine, site_id: int, kind: str, what: str, host: str, expires: date | None) -> None:
    if expires is None:
        return
    left = (expires - _today(engine)).days
    if left > EXPIRY_ALERT_DAYS:
        _clear_alert(engine, site_id, kind)
    elif left < 0:
        _alert_once(engine, site_id, kind, "crit", f"{host}: the {what} has expired", {"expires": expires.isoformat(), "state": "expired", "days": left})
    else:
        _alert_once(engine, site_id, kind, "warn", f"{host}: the {what} expires on {expires.isoformat()}", {"expires": expires.isoformat(), "state": "expiring", "days": left})


def _today(engine: Engine) -> date:
    with engine.connect() as conn:
        return conn.execute(text("SELECT UTC_DATE()")).scalar()


def check_certificate(engine: Engine, site: dict, force: bool = False) -> None:
    parts = urlsplit(site["start_url"])
    if parts.scheme != "https":
        return
    with engine.connect() as conn:
        due = conn.execute(text("SELECT ssl_checked_at IS NULL OR ssl_checked_at < UTC_TIMESTAMP(3) - INTERVAL :h HOUR FROM site_monitors WHERE site_id = :s"), {"h": CERT_EVERY_HOURS, "s": site["id"]}).scalar()
    if not (due or force) or not is_allowed(site["start_url"]):
        return
    try:
        found = certificate_read(parts.hostname or site["host"])
    except OSError:
        return  # couldn't connect, which says nothing about the certificate: the last date stays, and its age shows
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_monitors SET ssl_expires_at = :e, ssl_problem = :p, ssl_checked_at = UTC_TIMESTAMP(3) WHERE site_id = :s"), {"e": found.expires_at, "p": found.problem, "s": site["id"]})
    _judge_expiry(engine, site["id"], "ssl_expiry", "security certificate", site["host"], found.expires_at.date() if found.expires_at else None)


def check_domain(engine: Engine, site: dict, force: bool = False) -> None:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT domain_source, domain_expires_on, domain_checked_at IS NULL OR domain_checked_at < UTC_TIMESTAMP(3) - INTERVAL :d DAY AS due FROM site_monitors WHERE site_id = :s"), {"d": DOMAIN_EVERY_DAYS, "s": site["id"]}).mappings().first()
    if row["domain_source"] != "manual" and (row["due"] or force):  # a date entered by hand is never replaced
        domain = root_domain(site["host"])
        expires, problem = None, None
        try:
            if not domain:
                raise RdapFailed("no_domain")
            expires = rdap_lookup(domain)
        except NoRdap:
            problem = "no_rdap"
        except RdapFailed:
            problem = "rdap_failed"
            expires = row["domain_expires_on"]  # the last date known is still the best one, and its age shows
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE site_monitors SET domain_expires_on = :e, domain_source = :o, domain_problem = :p, domain_checked_at = UTC_TIMESTAMP(3) WHERE site_id = :s"),
                {"e": expires, "o": "rdap" if expires else None, "p": problem, "s": site["id"]},
            )
        row = {"domain_expires_on": expires}
    _judge_expiry(engine, site["id"], "domain_expiry", "domain name", site["host"], row["domain_expires_on"])


@handler(JOB_KIND)
def run_check(job, engine: Engine) -> None:
    payload = job.payload or {}
    site_id = payload.get("site_id")
    with engine.begin() as conn:
        try:
            site = _require_own(conn, site_id)  # the API said so, and the worker checks again
        except (UnknownSite, NotOwnSite):
            return
        _ensure_monitor(conn, site_id)
        watching = conn.execute(text("SELECT watching FROM site_monitors WHERE site_id = :s"), {"s": site_id}).scalar()
    force = bool(payload.get("force"))
    if not watching and not force:
        return
    if not budget.has_room(engine):
        return  # nothing read, so nothing recorded: the screen shows unknown
    fetcher = links_service.fetcher_factory()
    used = 0
    try:
        seen = probe(fetcher, site["start_url"])
        if seen.state == DOWN:
            time.sleep(CONFIRM_AFTER_SECONDS)
            seen = probe(fetcher, site["start_url"])
        used = fetcher.requests
    finally:
        fetcher.close()
        budget.charge(engine, used)
    _store(engine, site_id, site["host"], seen)
    check_certificate(engine, site, force)
    check_domain(engine, site, force)


def enqueue_due(engine: Engine) -> list[int]:
    with engine.connect() as conn:
        due = [row[0] for row in conn.execute(text(
            "SELECT s.id FROM sites s LEFT JOIN site_monitors m ON m.site_id = s.id WHERE s.kind = 'own' AND COALESCE(m.watching, 1) = 1 "
            "AND (m.last_checked_at IS NULL OR m.last_checked_at < UTC_TIMESTAMP(3) - INTERVAL :m MINUTE) ORDER BY s.id"
        ), {"m": CHECK_EVERY_MINUTES - 1})]
    queued = []
    for site_id in due:
        if queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": site_id}, dedupe_key=f"uptime:{site_id}", max_attempts=2) is not None:
            queued.append(site_id)
    return queued


def check_now(engine: Engine, site_id: int) -> bool:
    with engine.begin() as conn:
        _require_own(conn, site_id)
        _ensure_monitor(conn, site_id)
    return queue.enqueue(engine, LANE, JOB_KIND, payload={"site_id": site_id, "force": True}, dedupe_key=f"uptime:{site_id}", max_attempts=2) is not None


# ---- what the screen shows -------------------------------------------------------------------------

def _expiry(expires: date | None, today: date) -> dict:
    if expires is None:
        return {"expires": None, "days_left": None, "state": "unknown"}
    left = (expires - today).days
    return {"expires": expires.isoformat(), "days_left": left, "state": "expired" if left < 0 else "expiring" if left <= EXPIRY_ALERT_DAYS else "ok"}


def _site_answer(conn, site, row, today: date) -> dict:
    site_id = site["id"]
    watching = bool(row["watching"]) if row else True
    checked = row["last_checked_at"] if row else None
    stale = checked is None or conn.execute(text("SELECT :c < UTC_TIMESTAMP(3) - INTERVAL :m MINUTE"), {"c": checked, "m": STALE_AFTER_MINUTES}).scalar()
    state = row["state"] if row and row["state"] and not stale else UNKNOWN
    if not watching:
        state = UNKNOWN
    reason = (row["reason"] if row and not stale else None) or ("not_watching" if not watching else "never_checked" if checked is None else "too_old" if stale else None)
    days = {d["day"]: d for d in conn.execute(text("SELECT day, up_checks, down_checks, unknown_checks FROM uptime_days WHERE site_id = :s AND day > :f"), {"s": site_id, "f": today - timedelta(days=HISTORY_DAYS)}).mappings()}
    strip = []
    ups = downs = 0
    for back in range(HISTORY_DAYS - 1, -1, -1):
        day = today - timedelta(days=back)
        found = days.get(day)
        up, down = (found["up_checks"], found["down_checks"]) if found else (0, 0)
        ups += up
        downs += down
        strip.append({"day": day.isoformat(), "state": DOWN if down else UP if up else UNKNOWN, "up": up, "down": down})
    incidents = conn.execute(text("SELECT id, started_at, ended_at, reason, http_status, TIMESTAMPDIFF(MINUTE, started_at, COALESCE(ended_at, UTC_TIMESTAMP(3))) AS minutes FROM uptime_incidents WHERE site_id = :s ORDER BY id DESC LIMIT 10"), {"s": site_id}).mappings().all()
    is_https = urlsplit(site["start_url"]).scheme == "https"
    ssl_expires = row["ssl_expires_at"] if row else None
    return {
        "id": site_id, "host": site["host"], "watching": watching, "state": state, "reason": reason,
        "http_status": row["http_status"] if row and not stale else None, "since": _iso(row["state_since"]) if row and not stale else None, "last_checked_at": _iso(checked),
        "uptime_percent": round(ups * 100 / (ups + downs), 2) if ups + downs else None, "days": strip, "days_not_watched": sum(1 for d in strip if d["state"] == UNKNOWN),
        "certificate": {**_expiry(ssl_expires.date() if ssl_expires else None, today), "https": is_https, "problem": row["ssl_problem"] if row else None, "checked_at": _iso(row["ssl_checked_at"]) if row else None},
        "domain": {**_expiry(row["domain_expires_on"] if row else None, today), "source": row["domain_source"] if row else None, "problem": row["domain_problem"] if row else None, "checked_at": _iso(row["domain_checked_at"]) if row else None, "name": root_domain(site["host"]) or site["host"]},
        "incidents": [{"id": i["id"], "started_at": _iso(i["started_at"]), "ended_at": _iso(i["ended_at"]), "reason": i["reason"], "http_status": i["http_status"], "minutes": i["minutes"]} for i in incidents],
    }


def sites(engine: Engine) -> dict:
    with engine.connect() as conn:
        today = conn.execute(text("SELECT UTC_DATE()")).scalar()
        rows = conn.execute(text("SELECT * FROM sites WHERE kind = 'own' ORDER BY host")).mappings().all()
        monitors = {m["site_id"]: m for m in conn.execute(text("SELECT * FROM site_monitors")).mappings()}
        answer = [_site_answer(conn, site, monitors.get(site["id"]), today) for site in rows]
    return {"sites": answer, "every_minutes": CHECK_EVERY_MINUTES, "unknown_after_minutes": STALE_AFTER_MINUTES, "alert_days": EXPIRY_ALERT_DAYS}


def update(engine: Engine, site_id: int, body: dict) -> dict:
    """Whether a site is watched, and a domain date entered by hand. Null puts a domain back on the registry's date."""
    with engine.begin() as conn:
        site = _require_own(conn, site_id)
        _ensure_monitor(conn, site_id)
        if "watching" in body:
            if type(body["watching"]) is not bool:
                raise Refused("watching must be true or false.")
            conn.execute(text("UPDATE site_monitors SET watching = :w WHERE site_id = :s"), {"w": body["watching"], "s": site_id})
        if "domain_expires_on" in body:
            raw = body["domain_expires_on"]
            if raw in (None, ""):
                conn.execute(text("UPDATE site_monitors SET domain_expires_on = NULL, domain_source = NULL, domain_problem = NULL, domain_checked_at = NULL WHERE site_id = :s"), {"s": site_id})
            else:
                try:
                    expires = date.fromisoformat(raw) if isinstance(raw, str) else None
                except ValueError:
                    expires = None
                if expires is None:
                    raise Refused("Enter the date as YYYY-MM-DD.")
                conn.execute(text("UPDATE site_monitors SET domain_expires_on = :e, domain_source = 'manual', domain_problem = NULL, domain_checked_at = UTC_TIMESTAMP(3) WHERE site_id = :s"), {"e": expires, "s": site_id})
    if body.get("domain_expires_on"):
        _judge_expiry(engine, site_id, "domain_expiry", "domain name", site["host"], date.fromisoformat(body["domain_expires_on"]))
    elif "domain_expires_on" in body:
        _clear_alert(engine, site_id, "domain_expiry")
    with engine.connect() as conn:
        today = conn.execute(text("SELECT UTC_DATE()")).scalar()
        monitor = conn.execute(text("SELECT * FROM site_monitors WHERE site_id = :s"), {"s": site_id}).mappings().first()
        return _site_answer(conn, site, monitor, today)
