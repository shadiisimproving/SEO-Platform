"""Filter a SEMrush or Ubersuggest backlinks CSV into a list of prospects.

It only reads a file: no API calls, no scraping, no ranking checks and no link tracking.
Nothing is stored here. The caller saves the rows the user chooses to keep.

The logic comes from Saas Project/app/tools/backlink_cleaner.py and is copied, not imported.
Deliberate differences from that tool:
- A blank or unreadable spam score stays unknown (None). The old one read it as 0, so the row passed as clean.
- "45,5" is a number. The old one could not read a decimal comma, so it became 0 and passed as clean.
- Filtering records nothing. The old tool saved domains during upload, so a second upload flagged every row.
- The delimiter comes from the header row, which is reliable. The old one used csv.Sniffer.
- Rows like "n/a", "localhost", an IP address or a mailto link count as no usable URL.

design/mockups/cleaner.js is the browser copy. tests/test_backlink_cleaner.py checks that both give the same result.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Mapping

UPLOAD_MAX_BYTES = 10 * 1024 * 1024
SPAM_THRESHOLD = 30.0  # one line everywhere: a spam score ABOVE 30 is spam, 30 itself is not (owner's words of 2026-11-10)


def is_spam_score(score) -> bool:
    """The only place the line is drawn (SEO review 2026-11-17, B5): Link gaps, Backlinks, tasks and files all ask here."""
    return score is not None and float(score) > SPAM_THRESHOLD
ALLOWED_EXTENSIONS = (".csv", ".tsv", ".txt")

# Logical column -> header aliases, lowercased. The first alias found in the file wins.
COLUMN_ALIASES: dict[str, list[str]] = {
    "backlink_url": ["source url", "source page url", "url from", "referring page url", "referring url", "page url", "url", "source"],
    "domain": ["source domain", "domain from", "referring domain", "root domain", "domain"],
    "authority": ["domain authority", "domain rating", "authority score", "da", "dr", "as", "domain score"],
    "page_authority": ["page authority", "page ascore", "pa", "page score", "url rating", "ur"],
    "spam_score": ["spam score", "toxic score", "spam", "ts"],
}
REQUIRED = ("backlink_url", "spam_score")
REQUIRED_WORDS = {"backlink_url": "URL", "spam_score": "spam score"}

FORMAT_HINTS: dict[str, list[str]] = {
    "semrush": ["toxic score", "authority score", "source url", "source title"],
    "ubersuggest": ["domain authority", "spam score", "page authority"],
}
SOURCE_LABELS = {"semrush": "SEMrush", "ubersuggest": "Ubersuggest", "unknown": "CSV"}

# Multi-label public suffixes, written by hand. Anything else falls back to the last two labels.
MULTI_SUFFIXES = frozenset({
    "co.uk", "org.uk", "ac.uk", "gov.uk", "net.uk", "me.uk", "ltd.uk", "plc.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
    "co.nz", "net.nz", "org.nz", "ac.nz", "govt.nz",
    "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "ad.jp", "ed.jp",
    "co.kr", "or.kr", "go.kr", "ne.kr",
    "co.in", "net.in", "org.in", "gov.in", "ac.in",
    "co.za", "net.za", "org.za", "ac.za", "gov.za",
    "co.il", "net.il", "org.il", "ac.il", "gov.il",
    "com.br", "net.br", "org.br", "gov.br",
    "com.mx", "net.mx", "org.mx", "gob.mx",
    "com.ar", "net.ar", "org.ar", "gob.ar",
    "com.tr", "net.tr", "org.tr", "gov.tr",
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
    "com.hk", "net.hk", "org.hk",
    "com.sg", "net.sg", "org.sg",
    "com.my", "net.my", "org.my",
    "com.ph", "net.ph", "org.ph",
    "com.pk", "net.pk", "org.pk",
    "com.eg", "net.eg", "org.eg",
    "com.sa", "net.sa", "org.sa",
    "com.tw", "net.tw", "org.tw",
    # Added for the markets this app works in: the Gulf, North Africa and France.
    "com.ae", "co.ae", "net.ae", "org.ae", "gov.ae", "ac.ae", "sch.ae",
    "com.qa", "net.qa", "org.qa", "gov.qa", "com.kw", "org.kw", "com.om", "co.om", "com.bh", "org.bh",
    "co.ma", "net.ma", "org.ma", "gov.ma", "com.tn", "org.tn", "com.dz", "org.dz",
    "gouv.fr", "asso.fr", "nom.fr", "com.fr", "tm.fr",
})

# Shared hosting platforms: each subdomain belongs to someone else, so the subdomain is the site (F105). Without this,
# one spam blog on blogspot.com files every blogspot link under one domain, and the disavow file disavows the platform.
# Keep in step with PLATFORM_SUFFIXES in design/mockups/cleaner.js.
PLATFORM_SUFFIXES = frozenset({
    "blogspot.com", "blogspot.fr", "blogspot.co.uk", "blogspot.be", "blogspot.ca", "blogspot.ch", "blogspot.de", "blogspot.es", "blogspot.it", "blogspot.com.au",
    "wordpress.com", "wpcomstaging.com", "tumblr.com", "medium.com", "substack.com", "ghost.io", "livejournal.com", "typepad.com",
    "wixsite.com", "weebly.com", "weeblysite.com", "squarespace.com", "webflow.io", "jimdofree.com", "jimdosite.com", "jimdo.com",
    "strikingly.com", "mystrikingly.com", "carrd.co", "godaddysites.com", "site123.me", "simplesite.com", "webnode.fr", "webnode.com",
    "github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "workers.dev", "herokuapp.com", "onrender.com", "fly.dev",
    "firebaseapp.com", "web.app", "appspot.com", "azurewebsites.net", "cloudfront.net", "glitch.me", "neocities.org", "myshopify.com", "square.site",
    # French platforms
    "over-blog.com", "overblog.com", "canalblog.com", "hautetfort.com", "e-monsite.com", "unblog.fr", "eklablog.com", "skyrock.com",
    "wifeo.com", "centerblog.net", "blog4ever.com", "free.fr", "pagesperso-orange.fr", "forumactif.com", "forumactif.org", "forumgratuit.org", "xooit.fr",
})
# Endings that are also a real website when nothing comes before them: www.gov.uk is a site, co.uk is not.
SITE_SUFFIXES = frozenset({"gov.uk", "gouv.fr", "govt.nz"})

# The same pattern holds in most countries, so an ending nobody listed above still works.
_GENERIC_SECOND_LEVEL = frozenset({"com", "co", "net", "org", "edu", "gov", "ac", "gob", "gouv", "mil"})
_PLAIN_LABEL = re.compile(r"^[a-z0-9-]+$")
_HOST_CHARS = re.compile(r"^[^\s/?#@:\\<>\"'`,;()\[\]{}|]+$")
_OTHER_SCHEME = re.compile(r"^(mailto|javascript|data|tel|ftp|file):", re.IGNORECASE)
_NUMBER = re.compile(r"^\d+(\.\d+)?$")
_DECIMAL_COMMA = re.compile(r"^\d+,\d+$")
_SEP_LINE = re.compile(r"^sep=(.)$", re.IGNORECASE)
_SEP_CELL = re.compile(r'^"?sep=.?"?[,;\t]*$', re.IGNORECASE)  # the same line kept in a first cell: Google Sheets exports sep=;,,,,


class CleanerError(Exception):
    """A problem the user can fix. `code` says which one; the message says it in words."""

    def __init__(self, code: str, message: str, missing: list[str] | None = None, headers: list[str] | None = None):
        super().__init__(message)
        self.code = code
        self.missing = missing or []
        self.headers = headers or []


@dataclass(frozen=True)
class KeptRow:
    url: str
    domain: str
    authority: int | None
    spam_score: float | None  # None means unknown, never 0
    duplicate_of: str | None  # file, or whatever the caller's `known` map says
    page_authority: int | None = None


@dataclass(frozen=True)
class CleanResult:
    source_format: str
    source_label: str
    authority_label: str | None
    headers: list[str]
    total: int
    kept: int
    removed: int
    removed_spam: int
    removed_no_url: int
    duplicates: int
    unknown_spam: int
    rows: list[KeptRow] = field(default_factory=list)


def check_upload(filename: str, size: int) -> None:
    if not filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise CleanerError("not_csv", "The file must be a .csv.")
    if size > UPLOAD_MAX_BYTES:
        raise CleanerError("too_large", f"The file is too large. The limit is {UPLOAD_MAX_BYTES // (1024 * 1024)} MB.")


def decode_csv(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):  # "Unicode text" from Excel
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8-sig")  # also strips the BOM Excel adds
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _delimiter_of(line: str) -> str:
    counts = {d: 0 for d in (",", ";", "\t")}
    quoted = False
    for ch in line:
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in counts:
            counts[ch] += 1
    return max(counts, key=lambda d: counts[d])  # a tie goes to the comma, listed first


def parse_table(text: str) -> tuple[list[list[str]], str]:
    """Read every row, with quoted commas and line breaks staying inside their cell."""
    match = re.search(r"\r\n|\r|\n", text)
    first_line = text[: match.start()] if match else text
    sep_line = _SEP_LINE.match(first_line.strip())
    if sep_line or _SEP_CELL.match(first_line.strip()):
        text = text[match.end():] if match else ""
        next_line = next((line for line in text.splitlines() if line.strip()), "")
        # What the line says only counts if the file really uses it. A spreadsheet may have saved it with another separator.
        delimiter = sep_line.group(1) if sep_line and sep_line.group(1) in next_line else _delimiter_of(next_line)
    else:
        delimiter = _delimiter_of(first_line)

    rows: list[list[str]] = []
    row: list[str] = []
    cell: list[str] = []
    quoted = False
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if quoted:
            if ch == '"':
                if i + 1 < n and text[i + 1] == '"':
                    cell.append('"')
                    i += 1
                else:
                    quoted = False
            else:
                cell.append(ch)
        elif ch == '"' and not cell:
            quoted = True
        elif ch == delimiter:
            row.append("".join(cell))
            cell = []
        elif ch in "\r\n":
            if ch == "\r" and i + 1 < n and text[i + 1] == "\n":
                i += 1
            row.append("".join(cell))
            rows.append(row)
            row, cell = [], []
        else:
            cell.append(ch)
        i += 1
    if cell or row:
        row.append("".join(cell))
        rows.append(row)
    return [r for r in rows if any(c.strip() for c in r)], delimiter


def _normalize_header(header: str) -> str:
    return re.sub(r"\s+", " ", header.strip().lower())


def _detect_columns(headers: list[str], required: tuple[str, ...] = REQUIRED) -> dict[str, int]:
    positions: dict[str, int] = {}
    for i, header in enumerate(headers):
        positions.setdefault(_normalize_header(header), i)
    mapping: dict[str, int] = {}
    for logical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in positions:
                mapping[logical] = positions[alias]
                break
    missing = [name for name in required if name not in mapping]
    if missing:
        words = " and ".join(REQUIRED_WORDS[name] for name in missing)
        plural = "columns" if len(missing) > 1 else "column"
        raise CleanerError("missing_columns", f"This CSV has no {words} {plural}. Headers found: {', '.join(headers)}.", missing, headers)
    return mapping


def _detect_format(headers: list[str]) -> str:
    lowered = {_normalize_header(h) for h in headers}
    best_score, best = 0, "unknown"
    for name, hints in FORMAT_HINTS.items():
        score = sum(1 for hint in hints if hint in lowered)
        if score > best_score:
            best_score, best = score, name
    return best


def _parse_number(raw: str) -> float | None:
    text = raw.strip().replace("%", "").strip()
    if _DECIMAL_COMMA.match(text):
        text = text.replace(",", ".")
    if not _NUMBER.match(text):
        return None
    value = float(text)
    return value if math.isfinite(value) else None


def parse_spam(raw: str) -> float | None:
    """A blank or unreadable score is unknown. It must never read as 0."""
    return _parse_number(raw)


def parse_authority(raw: str) -> int | None:
    value = _parse_number(raw)
    return None if value is None else math.floor(value + 0.5)


def hostname(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if "://" in raw:
        scheme, rest = raw.split("://", 1)
        if scheme.lower() not in ("http", "https"):
            return ""
    elif raw.startswith("//"):
        rest = raw[2:]
    elif _OTHER_SCHEME.match(raw):
        return ""
    else:
        rest = raw
    host = re.split(r"[/?#]", rest, maxsplit=1)[0]
    host = host[host.rfind("@") + 1:]
    host = re.sub(r":\d*$", "", host)
    host = host.lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def _usable_host(host: str) -> bool:
    if not host or "." not in host or not _HOST_CHARS.match(host):
        return False
    labels = host.split(".")
    if any(not label or label.startswith("-") or label.endswith("-") for label in labels):
        return False
    return len(labels[-1]) >= 2 and not labels[-1].isdigit()


def _is_suffix(name: str) -> bool:
    if name in MULTI_SUFFIXES:
        return True
    labels = name.split(".")
    return len(labels) == 2 and len(labels[1]) == 2 and bool(_PLAIN_LABEL.match(labels[1])) and labels[0] in _GENERIC_SECOND_LEVEL


def root_domain(value: str) -> str:
    """Reduce a URL or hostname to its root domain, or "" if it has no usable one.

    https://blog.example.co.uk/post -> example.co.uk
    shop.example.com                -> example.com
    https://someone.blogspot.com/p  -> someone.blogspot.com (a shared platform: the subdomain is the site)
    """
    host = hostname(value)
    if not _usable_host(host):
        return ""
    labels = host.split(".")
    for platform in PLATFORM_SUFFIXES:
        if host.endswith("." + platform):
            return ".".join(labels[-(platform.count(".") + 2):])
    return registrable_domain(host)


def registrable_domain(value: str) -> str:
    """The domain a registry knows (for its dates), shared platforms included: someone.blogspot.com -> blogspot.com."""
    host = hostname(value)
    if not _usable_host(host):
        return ""
    if host in SITE_SUFFIXES:
        return host
    if _is_suffix(host):
        return ""
    labels = host.split(".")
    if len(labels) >= 3 and _is_suffix(".".join(labels[-2:])):
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def full_url(value: str) -> str:
    raw = value.strip()
    if "://" in raw:
        return raw
    if raw.startswith("//"):
        return "https:" + raw
    return "https://" + raw


def clean_csv(data: bytes, known: Mapping[str, str] | None = None, *, need_spam: bool = True, keep_spam: bool = False) -> CleanResult:
    """Filter one file. `known` maps root domains already in use to where they are. It is only read.

    With need_spam=False a file of links to a competitor is accepted without a spam score, and a
    domain column can stand in for the URL. Blank spam scores stay unknown, as they do here.
    """
    known = known or {}
    rows, _ = parse_table(decode_csv(data))
    if not rows:
        raise CleanerError("empty", "Empty file.")
    headers = [h.strip() for h in rows[0]]
    if need_spam:
        mapping = _detect_columns(headers)
    else:
        mapping = _detect_columns(headers, required=())
        if "backlink_url" not in mapping:
            if "domain" not in mapping:
                raise CleanerError("missing_columns", f"This CSV has no URL or domain column. Headers found: {', '.join(headers)}.", ["backlink_url"], headers)
            mapping["backlink_url"] = mapping["domain"]
    source_format = _detect_format(headers)
    source_label = SOURCE_LABELS[source_format]
    authority_at = mapping.get("authority")
    page_authority_at = mapping.get("page_authority")
    authority_label = f"{headers[authority_at]} ({source_label})" if authority_at is not None else None

    url_at, spam_at = mapping["backlink_url"], mapping.get("spam_score")
    cell = lambda r, i: r[i] if i < len(r) else ""  # noqa: E731

    seen_in_file: set[str] = set()
    kept: list[KeptRow] = []
    removed_spam = removed_no_url = duplicates = unknown_spam = 0
    data_rows = rows[1:]
    if not data_rows:
        raise CleanerError("no_rows", "Only headers, no data rows.")

    for r in data_rows:
        spam = parse_spam(cell(r, spam_at)) if spam_at is not None else None
        spammy = is_spam_score(spam)
        if spammy and not keep_spam:
            removed_spam += 1
            continue
        url = cell(r, url_at).strip()
        domain = root_domain(url)
        if not domain:
            removed_no_url += 1
            continue
        if spammy:  # with keep_spam the row stays, marked by its score, so a screen can show what went and why
            removed_spam += 1
        duplicate_of = known.get(domain) or ("file" if domain in seen_in_file else None)
        if duplicate_of:
            duplicates += 1
        seen_in_file.add(domain)
        if spam is None:
            unknown_spam += 1
        kept.append(KeptRow(
            url=full_url(url),
            domain=domain,
            authority=parse_authority(cell(r, authority_at)) if authority_at is not None else None,
            page_authority=parse_authority(cell(r, page_authority_at)) if page_authority_at is not None else None,
            spam_score=spam,
            duplicate_of=duplicate_of,
        ))

    return CleanResult(
        source_format=source_format,
        source_label=source_label,
        authority_label=authority_label,
        headers=headers,
        total=len(data_rows),
        kept=len(kept),
        removed=removed_spam + removed_no_url,
        removed_spam=removed_spam,
        removed_no_url=removed_no_url,
        duplicates=duplicates,
        unknown_spam=unknown_spam,
        rows=kept,
    )


def scale_of(label: str | None) -> str:
    """Whose scale a score is on, as one key: "Authority Score (SEMrush)" and a typed "SEMrush" are both "semrush".

    A plain CSV says nothing about its tool, so its column name ("DR (CSV)") is the scale. Scores of two scales never sort
    as one (SEO review 2026-11-17, #7): Ubersuggest's DA runs higher than SEMrush's Authority Score for the same site.
    design/mockups/cleaner.js has the browser's copy.
    """
    raw = (label or "").strip()
    match = re.search(r"\(([^)]+)\)", raw)
    tool = match.group(1).strip() if match and match.group(1).strip().lower() != "csv" else raw
    return " ".join(tool.lower().split())


def scale_ranks(labels) -> dict[str, int]:
    """Each scale's place in a sort: the one most rows are scored on first (0), then the others, ties A to Z."""
    counts: dict[str, int] = {}
    for label in labels:
        key = scale_of(label)
        counts[key] = counts.get(key, 0) + 1
    return {key: at for at, key in enumerate(sorted(counts, key=lambda k: (-counts[k], k)))}


_TRUE_WORDS = {"true", "1", "yes", "y", "x", "oui", "vrai", "lost", "removed"}
_LIVE_WORDS = {"", "false", "0", "no", "n", "non", "faux", "-", "n/a", "none", "live", "active"}


def _flag(raw: str) -> bool | None:
    value = " ".join(raw.strip().lower().split())
    if value in _LIVE_WORDS:
        return False if value else None
    return True if value in _TRUE_WORDS or value else None


def _rel_of(flags: dict[str, bool | None], link_type: str) -> str | None:
    """"follow", or the attributes that make a link pass little ("nofollow ugc"), or None when the file doesn't say."""
    kinds = [name for name in ("nofollow", "sponsored", "ugc") if flags.get(name)]
    words = set(re.split(r"[^a-z]+", link_type.lower()))
    kinds += [name for name in ("nofollow", "sponsored", "ugc") if name in words and name not in kinds]
    if kinds:
        return " ".join(kinds)
    if any(flags.get(name) is False for name in ("nofollow", "sponsored", "ugc")) or words & {"dofollow", "follow"}:
        return "follow"
    return None


# Only read for competitors' files (Link gaps). clean_csv and its browser copy don't use them.
DETAIL_ALIASES: dict[str, list[str]] = {
    "anchor": ["anchor text", "anchor", "link anchor", "anchor_text"],
    "target_url": ["target url", "destination url", "target page", "link url", "url to"],
    "source_title": ["source page title", "source title", "referring page title", "page title", "title"],
    "first_seen": ["first seen", "first_seen", "first seen date"],
    "last_seen": ["last seen", "last_seen", "last seen date"],
    # SEMrush and Ahrefs exports say whether a link is followed and still there (SEO review 2026-11-17, #13).
    "nofollow": ["nofollow", "no follow", "is nofollow"],
    "sponsored": ["sponsored", "is sponsored"],
    "ugc": ["ugc", "is ugc"],
    "lost": ["lost link", "lost", "lost status", "is lost", "lost date"],
    "link_type": ["link type", "rel", "link attributes", "attributes"],
}
_ISO_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def _day(raw: str) -> str | None:
    match = _ISO_DAY.match(raw.strip())
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}" if match else None


def _text(raw: str, limit: int) -> str | None:
    value = re.sub(r"\s+", " ", raw).strip()
    return value[:limit] if value and value != "-" else None


def link_rows(data: bytes) -> list[dict]:
    """Every link of a competitor's backlink file, one dict each, spam included: the page it's on, the page it points to, anchor text and scores.

    Rows with no usable URL are left out, as clean_csv leaves them out. A file with only a domain column has no links to give.
    """
    rows, _ = parse_table(decode_csv(data))
    if len(rows) < 2:
        return []
    headers = [h.strip() for h in rows[0]]
    mapping = _detect_columns(headers, required=())
    if "backlink_url" not in mapping:
        return []
    positions: dict[str, int] = {}
    for i, header in enumerate(headers):
        positions.setdefault(_normalize_header(header), i)
    for logical, aliases in DETAIL_ALIASES.items():
        for alias in aliases:
            if alias in positions and positions[alias] not in mapping.values():
                mapping[logical] = positions[alias]
                break
    cell = lambda r, name: r[mapping[name]] if name in mapping and mapping[name] < len(r) else ""  # noqa: E731
    found: list[dict] = []
    for r in rows[1:]:
        url = cell(r, "backlink_url").strip()
        domain = root_domain(url)
        if not domain:
            continue
        target = cell(r, "target_url").strip()
        found.append({
            "domain": domain,
            "source_url": full_url(url),
            "source_title": _text(cell(r, "source_title"), 500),
            "target_url": full_url(target) if target and root_domain(target) else None,
            "anchor": _text(cell(r, "anchor"), 500),
            "authority": parse_authority(cell(r, "authority")),
            "page_authority": parse_authority(cell(r, "page_authority")),
            "spam_score": parse_spam(cell(r, "spam_score")),
            "first_seen": _day(cell(r, "first_seen")),
            "last_seen": _day(cell(r, "last_seen")),
            "rel": _rel_of({name: _flag(cell(r, name)) if name in mapping else None for name in ("nofollow", "sponsored", "ugc")}, cell(r, "link_type")),
            "lost": _flag(cell(r, "lost")) if "lost" in mapping else None,
        })
    return found
