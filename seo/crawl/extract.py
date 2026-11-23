"""Read the fields we track from a page, and hash its main text.

The hash covers the main content only. Navigation, header, footer and sidebars are
left out, so one menu edit doesn't flag every page on a competitor's site as changed.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from urllib.parse import urljoin, urlsplit

from lxml import etree, html as lxml_html

from seo.crawl.noise import BLOCK_SEP, TEXT_FORMAT
from seo.links.urls import page_key

SCRIPTED = ("script", "style", "noscript", "template", "svg", "iframe")
CHROME = ("nav", "footer", "aside")
BLOCK = {
    "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr", "td", "th", "table", "section",
    "article", "blockquote", "pre", "dd", "dt", "dl", "figure", "figcaption", "address", "hr", "main", "header",
}
_BLOCK_MARK = "\ue000"  # a private-use character: where a block starts or ends, before the text is split into blocks
APP_ROOT_IDS = {"root", "app", "__next", "__nuxt", "app-root"}
JS_ONLY_WORDS = 50
_META_CHARSET = re.compile(rb"""<meta[^>]+charset=["']?\s*([a-zA-Z0-9_\-]+)""", re.I)
_SPACE = re.compile(r"\s+")
# Characters XML can't hold. lxml parses them but refuses them when text is written back, so one
# stray vertical tab pasted from Word ended a whole health test. They become a space, NULL vanishes.
_NOT_XML = re.compile("[\x01-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]")
# Chinese and Japanese are written without spaces, so each character counts as a word.
# Thai, Lao, Khmer and Burmese have no spaces either and can't be split without a dictionary,
# which is why the page's character count is kept beside the word count.
_NO_SPACE_SCRIPT = re.compile("[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_QUESTION_END = ("?", "\u061f", "\uff1f", "\u037e", "\u1367")  # Latin, Arabic, full-width, Greek, Ethiopic
_VIDEO_HOSTS = ("youtube.com", "youtube-nocookie.com", "youtu.be", "vimeo.com", "wistia", "dailymotion.com")


def count_words(text: str) -> int:
    total = 0
    for token in text.split():
        script_chars = len(_NO_SPACE_SCRIPT.findall(token))
        if not script_chars:
            total += 1
        else:
            rest = _NO_SPACE_SCRIPT.sub("", token)
            total += script_chars + (1 if any(c.isalnum() for c in rest) else 0)
    return total


@dataclass
class PageFields:
    title: str = ""
    meta_description: str = ""
    canonical: str = ""
    robots_meta: str = ""
    lang: str = ""
    h1: list[str] = field(default_factory=list)
    headings: list[list[str]] = field(default_factory=list)
    word_count: int = 0
    schema_types: list[str] = field(default_factory=list)
    internal_links: int = 0
    external_links: int = 0
    content_hash: str = ""
    js_only: bool = False
    text: str = ""
    extras: dict = field(default_factory=dict)
    links: list[str] = field(default_factory=list)  # pages of the same site this page links to, in the page's order (page_key form)

    def as_dict(self) -> dict:
        data = asdict(self)
        data.pop("text")
        data["text_format"] = TEXT_FORMAT
        data.pop("links")  # kept in page_links, never in a version: one menu edit would bloat every page's history
        return data

    @property
    def flat_text(self) -> str:
        """The main text on one line, as it was hashed and counted before blocks were kept."""
        return self.text.replace(BLOCK_SEP, " ")


def _clean(value: str | None) -> str:
    return _SPACE.sub(" ", value or "").strip()


def _decode(body: bytes, charset: str | None) -> str:
    declared = _META_CHARSET.search(body[:4096])
    candidates = [charset, declared.group(1).decode("ascii", "ignore") if declared else None, "utf-8"]
    for name in candidates:
        if not name:
            continue
        try:
            return body.decode(name)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode("cp1252", errors="replace")


def _schema_types(root) -> list[str]:
    found: set[str] = set()

    def take(node) -> None:
        if isinstance(node, list):
            for item in node:
                take(item)
        elif isinstance(node, dict):
            kind = node.get("@type")
            if isinstance(kind, str):
                found.add(kind)
            elif isinstance(kind, list):
                found.update(k for k in kind if isinstance(k, str))
            take(node.get("@graph"))

    for script in root.iterfind(".//script[@type='application/ld+json']"):
        try:
            take(json.loads(script.text or ""))
        except (ValueError, RecursionError):  # a deeply nested ld+json script is as unreadable as a broken one (F97)
            continue
    return sorted(found)


def _host(value: str | None) -> str:
    host = (value or "").lower()
    host = host[4:] if host.startswith("www.") else host
    if host.isascii():
        return host
    try:  # an accented host has two spellings, and a page can link to itself in the other one
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return host


def _count_links(root, url: str) -> tuple[int, int]:
    own = _host(urlsplit(url).hostname)
    internal = external = 0
    for anchor in root.iterfind(".//a[@href]"):
        href = (anchor.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        try:
            target = _host(urlsplit(urljoin(url, href)).hostname)
        except ValueError:
            continue
        if not target:
            continue
        if target == own:
            internal += 1
        else:
            external += 1
    return internal, external


MAX_PAGE_LINKS = 300
_NOT_A_PAGE = (
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".avif", ".pdf", ".zip", ".rar", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".mp3", ".mp4", ".mov", ".avi", ".webm", ".css", ".js", ".json", ".xml", ".rss", ".txt", ".csv", ".woff", ".woff2", ".ttf",
)


def _page_links(root, url: str) -> list[str]:
    """The site's own pages this page links to, menu and footer included, once each and in the page's order.

    Each is a page_key (host without www, path, query), so http or https and www or not are one page. The site map's
    "By links" view is built from these (seo/pages/sitemap_tree.py)."""
    own = _host(urlsplit(url).hostname)
    me = page_key(url)
    found: dict[str, None] = {}
    for anchor in root.iterfind(".//a[@href]"):
        href = (anchor.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        try:
            target = urljoin(url, href)
            if _host(urlsplit(target).hostname) != own:
                continue
        except ValueError:
            continue
        key = page_key(target)
        if not key or key == me or key.split("?", 1)[0].lower().endswith(_NOT_A_PAGE):
            continue
        found.setdefault(key)
        if len(found) >= MAX_PAGE_LINKS:
            break
    return list(found)


def _schema_dates(root) -> dict:
    """Dates a page states about itself, from structured data first, then meta tags."""
    dates: dict = {}

    def take(node) -> None:
        if isinstance(node, list):
            for item in node:
                take(item)
        elif isinstance(node, dict):
            for key, name in (("datePublished", "published"), ("dateModified", "modified")):
                value = node.get(key)
                if isinstance(value, str) and name not in dates:
                    dates[name] = value[:30]
            take(node.get("@graph"))

    for script in root.iterfind(".//script[@type='application/ld+json']"):
        try:
            take(json.loads(script.text or ""))
        except (ValueError, RecursionError):  # a deeply nested ld+json script is as unreadable as a broken one (F97)
            continue
    for meta in root.iterfind(".//meta[@property]"):
        prop = (meta.get("property") or "").lower()
        content = _clean(meta.get("content"))
        if prop == "article:published_time" and content:
            dates.setdefault("published", content[:30])
        elif prop == "article:modified_time" and content:
            dates.setdefault("modified", content[:30])
    return dates


_SHARE_IMAGE = ("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")


def _share_image(root, url: str) -> str:
    """The picture the page picks for itself when shared (og:image, else twitter:image), as a full address. "" if none."""
    found: dict[str, str] = {}
    for meta in root.iter("meta"):
        name = (meta.get("property") or meta.get("name") or "").strip().lower()
        content = (meta.get("content") or "").strip()
        if name in _SHARE_IMAGE and content and name not in found:
            found[name] = content
    for name in _SHARE_IMAGE:
        if name not in found:
            continue
        try:
            address = urljoin(url, found[name])
        except ValueError:
            continue
        if address.startswith(("https://", "http://")) and len(address) <= 1000 and not _SPACE.search(address):
            return address
    return ""


def _extras(root, url: str = "") -> dict:
    """Plain counts about a page. They work the same in any language."""
    images = [el for el in root.iter("img")]
    embeds = [el for el in root.iter("iframe", "video") if el.tag == "video" or any(host in (el.get("src") or "") for host in _VIDEO_HOSTS)]
    return {
        "images": len(images),
        "images_no_alt": sum(1 for el in images if not (el.get("alt") or "").strip()),
        "tables": sum(1 for _ in root.iter("table")),
        "lists": sum(1 for _ in root.iter("ul", "ol")),
        "videos": len(embeds),
        "forms": sum(1 for _ in root.iter("form")),
        "image": _share_image(root, url),
        "hreflang": sorted({(el.get("hreflang") or "").lower() for el in root.iterfind(".//link[@hreflang]") if el.get("hreflang")})[:60],
        **_schema_dates(root),
    }


def _drop(root, tags: tuple[str, ...]) -> None:
    for tag in tags:
        for element in list(root.iter(tag)):
            if element.getparent() is not None:
                element.drop_tree()


def _main_text(root) -> str:
    body = root.find(".//body")
    scope = root.find(".//main")
    if scope is None:
        scope = next(iter(root.xpath(".//*[@role='main']")), None)
    if scope is None:
        scope = body if body is not None else root
        _drop(scope, ("header",))
    for element in scope.iter():
        if isinstance(element.tag, str) and element.tag in BLOCK:
            # Cleaned again here: the parser turns &#11; into the real character, which lxml then refuses to write back (F97).
            element.text = _BLOCK_MARK + _NOT_XML.sub(" ", (element.text or "").replace(_BLOCK_MARK, " "))
            element.tail = _BLOCK_MARK + _NOT_XML.sub(" ", (element.tail or "").replace(_BLOCK_MARK, " "))
    # One block a line (seo.crawl.noise): joined with spaces it's exactly the text this used to return, so its hash is the same.
    return BLOCK_SEP.join(block for block in (_clean(part) for part in scope.text_content().split(_BLOCK_MARK)) if block)


def extract(body: bytes, url: str, charset: str | None = None) -> PageFields:
    page = PageFields()
    if not body or not body.strip():
        page.content_hash = hashlib.sha256(b"").hexdigest()
        return page

    source = _NOT_XML.sub(" ", _decode(body, charset).replace("\x00", ""))
    try:
        parser = lxml_html.HTMLParser(encoding="utf-8", remove_comments=True)
        root = lxml_html.fromstring(source.encode("utf-8"), parser=parser)
    except (etree.ParserError, etree.XMLSyntaxError, ValueError):
        page.content_hash = hashlib.sha256(b"").hexdigest()
        return page

    title = root.find(".//head/title")
    if title is None:
        title = root.find(".//title")
    page.title = _clean(title.text_content()) if title is not None else ""
    page.lang = _clean(root.get("lang"))[:20]
    googlebot = ""  # <meta name="googlebot">: a rule for Google alone, kept in extras for the health test
    for meta in root.iterfind(".//meta[@name]"):
        name = (meta.get("name") or "").lower()
        if name == "description" and not page.meta_description:
            page.meta_description = _clean(meta.get("content"))
        elif name == "robots" and not page.robots_meta:
            page.robots_meta = _clean(meta.get("content"))
        elif name == "googlebot" and not googlebot:
            googlebot = _clean(meta.get("content"))
    for link in root.iterfind(".//link[@rel]"):
        if "canonical" in (link.get("rel") or "").lower().split():
            page.canonical = _clean(link.get("href"))
            break

    page.schema_types = _schema_types(root)
    page.extras = _extras(root, url)
    if googlebot:
        page.extras["googlebot"] = googlebot[:255]
    page.internal_links, page.external_links = _count_links(root, url)
    page.links = _page_links(root, url)
    has_app_root = any((el.get("id") or "") in APP_ROOT_IDS for el in root.iter() if isinstance(el.tag, str))

    _drop(root, SCRIPTED)
    _drop(root, CHROME)

    for element in root.iter("h1", "h2", "h3", "h4", "h5", "h6"):
        text = _clean(element.text_content())
        if not text:
            continue
        if element.tag == "h1":
            page.h1.append(text)
        else:
            page.headings.append([element.tag, text])

    page.text = _main_text(root)
    page.word_count = count_words(page.text)
    page.extras["characters"] = len(page.text)
    page.extras["questions"] = [text for _, text in page.headings if text.endswith(_QUESTION_END)][:50]
    page.content_hash = hashlib.sha256(page.flat_text.encode("utf-8")).hexdigest()
    page.js_only = page.word_count < JS_ONLY_WORDS and has_app_root
    return page
