"""Address handling for the link checker.

The crawl scope is the exact host, ignoring www. Nothing here guesses at domain endings, so
a site on .co.ae can never pull another .co.ae site into its crawl.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

# Parameters that only say how someone arrived. The page is the same without them.
TRACKING_PREFIXES = ("utm_",)
TRACKING_NAMES = {"gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid", "yclid", "igshid", "mc_cid", "mc_eid", "_ga", "_gl", "ref_src"}
DEFAULT_PORTS = {"http": 80, "https": 443}


def _is_tracking(name: str) -> bool:
    lowered = name.lower()
    return lowered in TRACKING_NAMES or lowered.startswith(TRACKING_PREFIXES)


def normalize_url(url: str) -> str:
    """One spelling for one address: no fragment, no tracking parameters, sorted query. "" if unusable."""
    try:
        parts = urlsplit((url or "").strip())
        port = parts.port
    except ValueError:
        return ""
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower().rstrip(".")
    if scheme not in DEFAULT_PORTS or not host:
        return ""
    netloc = host if port in (None, DEFAULT_PORTS[scheme]) else f"{host}:{port}"
    query = urlencode(sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _is_tracking(k)))
    return urlunsplit((scheme, netloc, parts.path or "/", query, ""))


def host_key(url: str) -> str:
    """The host, lowercased, without www. This is what decides whether an address is on a site."""
    try:
        host = (urlsplit((url or "").strip()).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def page_key(url: str) -> str:
    """Identifies a page: http and https, www and non-www, and /café and /caf%C3%A9 count as the same one."""
    normal = normalize_url(url)
    if not normal:
        return ""
    parts = urlsplit(normal)
    port = f":{parts.port}" if parts.port else ""
    return f"{host_key(normal)}{port}{unquote(parts.path)}{'?' + parts.query if parts.query else ''}"
