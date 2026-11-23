"""The day's topics from website feeds (RSS or Atom) and from newsletters in a mailbox kept for them.

Python's own libraries only: o2switch can't build anything (n8n failed there in July 2026). Everything read here is
written by strangers, so it is kept as plain text, cut short, and only http(s) links are kept.
"""
from __future__ import annotations

import email
import html
import imaplib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from seo.crawl.guard import is_public_url

USER_AGENT = "SEOCommandCenter/0.1 (feed reader)"
transport: httpx.BaseTransport | None = None  # tests replace this to run with no network
url_allowed = is_public_url  # tests replace this: their feeds live on made-up hosts
FEED_BYTES = 3_000_000
KEEP_HOURS = 48
PER_FEED = 15
PER_MAILBOX = 30
TITLE_CHARS = 300
SUMMARY_CHARS = 1500


class _Text(HTMLParser):
    """HTML to plain text: tags, scripts and styles gone, links remembered."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self._skip += 1
        if tag == "a":
            href = dict(attrs).get("href") or ""
            if safe_link(href):
                self.links.append(href)
        if tag in ("p", "br", "div", "li", "h1", "h2", "h3", "tr"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def plain(text: str | None, limit: int = SUMMARY_CHARS) -> str:
    if not text:
        return ""
    reader = _Text()
    try:
        reader.feed(text)
        out = "".join(reader.parts)
    except Exception:  # broken HTML from a stranger: fall back to the raw text without tags
        out = re.sub(r"<[^>]+>", " ", text)
    out = html.unescape(out)
    out = re.sub(r"[ \t\r\f\v]+", " ", out)
    out = re.sub(r"\n\s*\n+", "\n\n", out).strip()
    return out[:limit]


def safe_link(url: str | None) -> bool:
    if not url or not isinstance(url, str) or len(url) > 1000:
        return False
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.hostname)


def _when(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        moment = parsedate_to_datetime(value)  # RSS: Tue, 18 Nov 2026 08:00:00 GMT
    except (TypeError, ValueError, IndexError):
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))  # Atom
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).replace(tzinfo=None)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child(node, *names):
    for kid in node:
        if _local(kid.tag) in names:
            return kid
    return None


def _child_text(node, *names) -> str | None:
    kid = _child(node, *names)
    return (kid.text or "").strip() if kid is not None and kid.text else None


def parse_feed(body: bytes) -> list[dict]:
    """The entries of an RSS 2.0, RSS 1.0 or Atom feed, newest first as the feed gives them."""
    body = body.lstrip()  # a blank line before <?xml is common, and the parser refuses it
    if b"<!ENTITY" in body.upper():  # entity tricks have no place in a feed, however far down they are declared
        raise ValueError("The feed declares its own entities, so it wasn't read.")
    root = ET.fromstring(body)
    entries = []
    for node in root.iter():
        name = _local(node.tag)
        if name not in ("item", "entry"):
            continue
        title = plain(_child_text(node, "title"), TITLE_CHARS)
        link = None
        for kid in node:
            if _local(kid.tag) != "link":
                continue
            href = kid.get("href") or (kid.text or "").strip()
            if kid.get("rel") in (None, "alternate") and safe_link(href):
                link = href.strip()
                break
        summary = plain(_child_text(node, "description", "summary", "encoded", "content"))
        moment = _when(_child_text(node, "pubdate", "published", "updated", "date"))
        if title or summary:
            entries.append({"title": title or summary[:120], "link": link, "summary": summary, "published_at": moment})
    return entries


def read_feed(url: str, timeout: float = 30) -> list[dict]:
    if not safe_link(url) or not url_allowed(url):
        raise ValueError("That feed address isn't a public web address.")
    chunks: list[bytes] = []
    with httpx.Client(transport=transport, timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=False) as client:
        for _hop in range(4):  # redirects followed by hand, so each new address is checked as public too
            with client.stream("GET", url) as reply:
                if reply.is_redirect and reply.headers.get("location"):
                    url = str(reply.url.join(reply.headers["location"]))
                    if not safe_link(url) or not url_allowed(url):
                        raise ValueError("The feed sends readers to an address that isn't public.")
                    continue
                if reply.status_code >= 400:
                    raise ValueError(f"The feed answered {reply.status_code}.")
                size = 0
                for chunk in reply.iter_bytes():
                    size += len(chunk)
                    if size > FEED_BYTES:
                        raise ValueError("The feed is too large to read.")
                    chunks.append(chunk)
                break
        else:
            raise ValueError("The feed redirects too many times.")
    try:
        return parse_feed(b"".join(chunks))
    except ET.ParseError as error:
        raise ValueError("That address doesn't give a feed (RSS or Atom).") from error


def recent(entries: list[dict], now: datetime, limit: int) -> list[dict]:
    since = now - timedelta(hours=KEEP_HOURS)
    kept = [e for e in entries if e["published_at"] is None or e["published_at"] >= since]
    return kept[:limit]


# ---- newsletters ------------------------------------------------------------------------------------------------

def _header(value) -> str:
    try:
        return str(make_header(decode_header(value or "")))
    except Exception:
        return value or ""


def _body(message) -> tuple[str, list[str]]:
    """The newsletter's text and its links. HTML is preferred: newsletters' plain parts are often empty."""
    html_part = text_part = None
    for part in message.walk() if message.is_multipart() else [message]:
        if part.get_content_maintype() == "multipart" or part.get_filename():
            continue
        kind = part.get_content_type()
        try:
            payload = part.get_payload(decode=True) or b""
            value = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        except Exception:
            continue
        if kind == "text/html" and html_part is None:
            html_part = value
        elif kind == "text/plain" and text_part is None:
            text_part = value
    if html_part:
        reader = _Text()
        try:
            reader.feed(html_part)
        except Exception:
            pass
        return plain(html_part, 4000), reader.links[:40]
    words = plain(text_part or "", 4000)
    return words, [u for u in re.findall(r"https?://[^\s<>\"')]+", words)][:40]


def parse_mail(raw: bytes) -> dict:
    message = email.message_from_bytes(raw)
    sender = parseaddr(_header(message.get("From")))[1].lower()
    text, links = _body(message)
    view = next((u for u in links if re.search(r"view|browser|online|web-version", u, re.I)), None)
    return {
        "sender": sender,
        "subject": plain(_header(message.get("Subject")), TITLE_CHARS),
        "text": text,
        "links": links,
        "link": view or (links[0] if links else None),
        "published_at": _when(message.get("Date")),
        "message_id": (message.get("Message-ID") or "").strip()[:300],
    }


def is_confirmation(subject: str, text: str) -> bool:
    """A "please confirm your subscription" mail: shown to the owner to click once, never used as a topic."""
    words = f"{subject} {text[:600]}".lower()
    return any(w in words for w in ("confirm your", "confirm subscription", "verify your", "please confirm", "activate your subscription", "double opt"))


def read_mailbox(host: str, user: str, password: str, since: datetime, limit: int = PER_MAILBOX) -> list[dict]:
    """Newsletters received since `since`, newest first. Read only: nothing is deleted or marked in the mailbox."""
    box = imaplib.IMAP4_SSL(host, 993, timeout=20)
    try:
        box.login(user, password)
        box.select("INBOX", readonly=True)
        status, found = box.search(None, "SINCE", since.strftime("%d-%b-%Y"))
        if status != "OK":
            return []
        ids = (found[0] or b"").split()[-limit:][::-1]
        mails = []
        for number in ids:
            status, data = box.fetch(number, "(BODY.PEEK[])")
            if status != "OK" or not data or not isinstance(data[0], tuple):
                continue
            mails.append(parse_mail(data[0][1]))
        return mails
    finally:
        try:
            box.logout()
        except Exception:
            pass
