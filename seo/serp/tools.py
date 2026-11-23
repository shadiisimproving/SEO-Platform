"""Search tools: each one turns a keyword into what a search engine showed.

A tool says what it really searched from. It reports a bot check, a captcha or an empty account
instead of working around it, and the caller moves to the next free tool. Nothing here pays.
"""
from __future__ import annotations

import re
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
from lxml import etree, html as lxml_html

from seo.backlinks.cleaner import root_domain

BOT_NAME = "PageChangeBot/0.1"
PRESENT, ABSENT, NOT_CAPTURED = "present", "absent", "not_captured"
TIMEOUT = 45.0


@dataclass
class Found:
    position: int
    url: str  # "" when Google hid the result's link: the page is unknown, and never guessed
    title: str = ""
    host: str = ""  # only then: the site Google showed under the title (shown_site), so the result still counts for that site


@dataclass
class Answer:
    tool: str
    real_location: str
    depth: int
    results: list[Found] = field(default_factory=list)
    ai_state: str = NOT_CAPTURED
    ai_citations: list[str] = field(default_factory=list)
    charged: int = 1
    asked: dict = field(default_factory=dict)  # what the tool says it searched with (SerpApi's search_parameters), kept with the check
    query_shown: str = ""  # the query the results page showed (SerpApi's search_information.query_displayed); "" when not said


class ToolStopped(Exception):
    """This tool can't be used right now: a bot check, a captcha, a bad key, or no free credits left.

    bot_check: the site asked for proof of a person. The app rests the tool for a while (connections.BLOCK_HOURS)
    rather than hit the same check on every Refresh.
    """

    charged = 0  # credits the pages before this one already used: a failure on page 3 doesn't give back pages 1 and 2

    def __init__(self, message: str = "", *, bot_check: bool = False):
        super().__init__(message)
        self.bot_check = bot_check


class HiddenAddresses(ToolStopped):
    """Google hid where a result leads and didn't show its site either, so the answer can't say who isn't on the page.
    A ToolStopped, so every caller already moves to the next tool, as at a bot check."""


class SearchFailed(Exception):
    """This one search failed. The tool itself may still work."""

    charged = 0


class TimedOut(SearchFailed):
    """No answer in time. The tool may already have charged for it, so this search is never tried again."""


@contextmanager
def _so_far(charged: int):
    """Whatever stops a search part-way says what the pages before it already used."""
    try:
        yield
    except (ToolStopped, SearchFailed) as exc:
        exc.charged = charged
        raise


def pages_for(depth: int) -> int:
    """Each tool returns about 10 results a page, and each extra page is another request."""
    return max(1, (int(depth) + 9) // 10)


READ_STEPS = (10, 20, 30, 50)  # the depths a Refresh offers (refresh.DEPTHS): a saved depth is always one of them


def depth_read(asked: int, read: int) -> int:
    """The depth one page of results really answers. DuckDuckGo has no page 2 here (its next page needs a token from this
    one), so a Top 30 asked for and one page of about 10 read answers Top 10, never ">30". Rounded down to a depth the app
    offers, so checks stay comparable with each other. A page with fewer than 10 results is the whole list: Top 10.
    The results kept are cut to the same depth, so a #23 is never saved inside a "Top 20" check."""
    steps = [step for step in READ_STEPS if step <= min(int(asked), max(int(read), 10))]
    return steps[-1] if steps else int(asked)


def most_cost(tool, depth: int = 10) -> int:
    """The most credits one search at this depth can use. A tool with no credits to run out of costs nothing."""
    if getattr(tool, "free_monthly", None) is None and getattr(tool, "free_once", None) is None and getattr(tool, "paid_per", None) is None:
        return 0
    per_page = getattr(tool, "credits_per_page", 1)
    return pages_for(depth) * per_page + max(0, getattr(tool, "most_per_search", per_page) - per_page)


def same_place(country: str, real_location: str, language: str = "") -> bool:
    """Whether a check really searched from the keyword's country. A keyword with no country takes any."""
    wanted, real = (country or "").upper(), (real_location or "")
    if not wanted:
        return True
    return real.upper() == wanted or (real == ddg_region(wanted, language) and real != "wt-wt")


def counts_for_keyword(engine: str, country: str, real_location: str, language: str = "") -> bool:
    """Whether a check can fill a keyword's row. Bright Data and SerpApi can't pick a country on Yandex, so a blank there
    means "no set location", not "somewhere else". Comparisons still stay within one tool, location and depth."""
    return same_place(country, real_location, language) or (engine == "yandex" and not real_location)


# ---- DuckDuckGo direct: no key, no credits ----------------------------------------------------

# DuckDuckGo names its regions itself. Countries it doesn't list search worldwide, and say so.
_DDG_REGIONS = {
    "AR": "ar-es", "AU": "au-en", "AT": "at-de", "BE": "be-fr", "BR": "br-pt", "BG": "bg-bg", "CA": "ca-en", "CL": "cl-es",
    "CN": "cn-zh", "CO": "co-es", "HR": "hr-hr", "CZ": "cz-cs", "DK": "dk-da", "EE": "ee-et", "FI": "fi-fi", "FR": "fr-fr",
    "DE": "de-de", "GR": "gr-el", "HK": "hk-tzh", "HU": "hu-hu", "IN": "in-en", "ID": "id-id", "IE": "ie-en", "IL": "il-he",
    "IT": "it-it", "JP": "jp-jp", "KR": "kr-kr", "LV": "lv-lv", "LT": "lt-lt", "MY": "my-ms", "MX": "mx-es", "NL": "nl-nl",
    "NZ": "nz-en", "NO": "no-no", "PE": "pe-es", "PH": "ph-en", "PL": "pl-pl", "PT": "pt-pt", "RO": "ro-ro", "RU": "ru-ru",
    "SG": "sg-en", "SK": "sk-sk", "SI": "sl-sl", "ZA": "za-en", "ES": "es-es", "SE": "se-sv", "CH": "ch-de", "TW": "tw-tzh",
    "TH": "th-th", "TR": "tr-tr", "UA": "ua-uk", "GB": "uk-en", "US": "us-en", "VN": "vn-vi",
    # DuckDuckGo groups the Arabic-speaking countries under one region.
    **{code: "xa-ar" for code in ("AE", "SA", "QA", "KW", "BH", "OM", "EG", "JO", "LB", "MA", "DZ", "TN", "IQ", "YE", "LY", "SD", "SY", "PS")},
}


def ddg_region(country: str, language: str = "") -> str:
    region = _DDG_REGIONS.get((country or "").upper(), "wt-wt")
    if region == "xa-ar" and language and language.lower() != "ar":
        return "xa-en"
    return region


_DDG_PLAIN = "//a[contains(concat(' ', normalize-space(@class), ' '), ' result__a ')]"  # html.duckduckgo.com
_DDG_DRAWN = "//article[@data-testid='result']//a[@data-testid='result-title-a']"  # duckduckgo.com once its script has run
_DDG_AD = "ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' result--ad ') or @data-testid='ad' or @data-layout='ad']"


def parse_ddg(body: bytes) -> list[Found]:
    """Normal results only: adverts and DuckDuckGo's own links are left out. Reads both of DuckDuckGo's layouts: the plain
    HTML page DuckDuckGo direct asks for, and the drawn page a service that runs its script (Bright Data) sends back."""
    try:
        doc = lxml_html.document_fromstring(body)
    except (etree.ParserError, ValueError, TypeError):  # an empty or broken page has no results to read
        return []
    found: list[Found] = []
    for anchor in doc.xpath(_DDG_PLAIN) or doc.xpath(_DDG_DRAWN):
        if anchor.xpath(_DDG_AD):
            continue
        href = (anchor.get("href") or "").strip()
        if href.startswith("//"):
            href = "https:" + href
        try:
            parts = urlsplit(href)
            host = parts.hostname or ""
        except ValueError:
            continue
        if not host or host == "duckduckgo.com" or host.endswith(".duckduckgo.com"):  # its own redirect, which names the real page
            target = parse_qs(parts.query).get("uddg", [""])[0]
            if not target:
                continue
            href = target
        if not href.startswith(("http://", "https://")):
            continue
        found.append(Found(len(found) + 1, href, anchor.text_content().strip()[:500]))
    return found


# Bright Data's DuckDuckGo page as Markdown (data_format "markdown"): each result's title is a level-2 heading that links to
# the page, in order, as DuckDuckGo shows them. Sub-links are level 3, and related searches are plain links, so neither counts.
_DDG_MD_RESULT = re.compile(r"^[ \t]*##[ \t]+\[(?P<title>[^\]\n]*)\]\((?P<url>https?://[^\s)]+)\)", re.MULTILINE)


def parse_ddg_markdown(text: str) -> list[Found]:
    """Normal results only: a heading that links back to DuckDuckGo (its adverts go through duckduckgo.com/y.js) is left out."""
    found: list[Found] = []
    seen: set[str] = set()
    for match in _DDG_MD_RESULT.finditer(text or ""):
        url = match.group("url")
        try:
            host = urlsplit(url).hostname or ""
        except ValueError:
            continue
        if not host or host == "duckduckgo.com" or host.endswith(".duckduckgo.com") or url in seen:
            continue
        seen.add(url)
        found.append(Found(len(found) + 1, url, match.group("title").replace("**", "").strip()[:500]))
    return found


class DuckDuckGoDirect:
    name = "DuckDuckGo direct"
    engines = ("duckduckgo",)
    free_monthly = None  # no credits
    gap_seconds = 4.0
    BOT_CHECK = "DuckDuckGo asked for a bot check, so this tool stopped. The app does not try to get past it."

    def __init__(self, client: httpx.Client | None = None, sleep=time.sleep):
        self.client = client or httpx.Client(timeout=TIMEOUT, headers={"User-Agent": BOT_NAME}, follow_redirects=True)
        self.sleep = sleep
        self.last_at = 0.0

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        wait = self.gap_seconds - (time.monotonic() - self.last_at)
        if self.last_at and wait > 0:
            self.sleep(wait)
        self.last_at = time.monotonic()
        region = ddg_region(country, language)
        try:
            reply = self.client.get("https://html.duckduckgo.com/html/", params={"q": keyword, "kl": region})
        except httpx.TimeoutException as exc:
            raise TimedOut(f"The request failed: {type(exc).__name__}") from exc
        except httpx.HTTPError as exc:
            raise SearchFailed(f"The request failed: {type(exc).__name__}") from exc
        # It answers 202 with a challenge page when it wants proof of a person. That is a no: stop, don't try again.
        if reply.status_code in (202, 403):
            raise ToolStopped(self.BOT_CHECK, bot_check=True)
        if reply.status_code == 429:
            raise ToolStopped("DuckDuckGo asked us to slow down, so this tool stopped.")
        if reply.status_code != 200:
            raise SearchFailed(f"DuckDuckGo answered {reply.status_code}")
        every = parse_ddg(reply.content)
        results = every[:depth]
        if not results:
            # The word alone proves nothing on a page of results: "anomaly detection" is a fine keyword.
            says_none = b"no-results" in reply.content
            if b"anomaly" in reply.content[:60000] and not says_none:
                raise ToolStopped(self.BOT_CHECK, bot_check=True)
            if not says_none:  # a page we can't read must not pass as "nobody ranks"
                raise SearchFailed("DuckDuckGo's page had no results the app could read.")
        saved = depth_read(depth, len(every)) if every else depth
        return Answer(self.name, region, saved, results[:saved], NOT_CAPTURED, [], 0)  # position and depth always agree


# ---- SerpApi: all four engines, AI Overview on Google. Written from its documentation: no key has been tried yet --------

# SerpApi's own location names and Google's domain per country, so a search never runs from SerpApi's default place.
# A country not listed sends gl alone, as before.
GOOGLE_PLACES = {
    "FR": ("France", "google.fr"), "BE": ("Belgium", "google.be"), "CH": ("Switzerland", "google.ch"), "LU": ("Luxembourg", "google.lu"),
    "MC": ("Monaco", "google.mc"), "CA": ("Canada", "google.ca"), "US": ("United States", "google.com"), "GB": ("United Kingdom", "google.co.uk"),
    "IE": ("Ireland", "google.ie"), "DE": ("Germany", "google.de"), "AT": ("Austria", "google.at"), "NL": ("Netherlands", "google.nl"),
    "ES": ("Spain", "google.es"), "PT": ("Portugal", "google.pt"), "IT": ("Italy", "google.it"), "PL": ("Poland", "google.pl"),
    "SE": ("Sweden", "google.se"), "NO": ("Norway", "google.no"), "DK": ("Denmark", "google.dk"), "FI": ("Finland", "google.fi"),
    "GR": ("Greece", "google.gr"), "TR": ("Turkey", "google.com.tr"), "RU": ("Russia", "google.ru"), "AE": ("United Arab Emirates", "google.ae"),
    "SA": ("Saudi Arabia", "google.com.sa"), "QA": ("Qatar", "google.com.qa"), "KW": ("Kuwait", "google.com.kw"), "BH": ("Bahrain", "google.com.bh"),
    "OM": ("Oman", "google.com.om"), "EG": ("Egypt", "google.com.eg"), "JO": ("Jordan", "google.jo"), "LB": ("Lebanon", "google.com.lb"),
    "MA": ("Morocco", "google.co.ma"), "DZ": ("Algeria", "google.dz"), "TN": ("Tunisia", "google.tn"), "SN": ("Senegal", "google.sn"),
    "CI": ("Cote d'Ivoire", "google.ci"), "ZA": ("South Africa", "google.co.za"), "IN": ("India", "google.co.in"), "SG": ("Singapore", "google.com.sg"),
    "HK": ("Hong Kong", "google.com.hk"), "JP": ("Japan", "google.co.jp"), "KR": ("South Korea", "google.co.kr"), "AU": ("Australia", "google.com.au"),
    "NZ": ("New Zealand", "google.co.nz"), "BR": ("Brazil", "google.com.br"), "MX": ("Mexico", "google.com.mx"), "AR": ("Argentina", "google.com.ar"),
}


class SerpApi:
    name = "SerpApi"
    engines = ("google", "duckduckgo", "bing", "yandex")
    free_monthly = 250
    per_hour = 50
    gives_ai = True
    most_per_search = 2  # the page, then the AI Overview when Google sends it through a second request

    def __init__(self, key: str, client: httpx.Client | None = None):
        self.key = key
        self.client = client or httpx.Client(timeout=TIMEOUT, headers={"User-Agent": BOT_NAME})

    def _get(self, params: dict) -> dict:
        try:
            reply = self.client.get("https://serpapi.com/search.json", params={**params, "api_key": self.key})
        except httpx.TimeoutException as exc:
            raise TimedOut(f"The request failed: {type(exc).__name__}") from exc
        except httpx.HTTPError as exc:
            raise SearchFailed(f"The request failed: {type(exc).__name__}") from exc
        if reply.status_code in (401, 403):  # whatever the body says, or if it says nothing readable
            raise ToolStopped("SerpApi refused the key.")
        if reply.status_code == 429:
            raise ToolStopped("SerpApi has no free searches left for now.")
        try:
            data = reply.json()
        except ValueError as exc:
            raise SearchFailed(f"SerpApi answered {reply.status_code} without data") from exc
        if not isinstance(data, dict):
            raise SearchFailed(f"SerpApi answered {reply.status_code} without data")
        error = str(data.get("error") or "")
        lowered = error.lower()
        if "api key" in lowered:
            raise ToolStopped("SerpApi refused the key.")
        if "run out" in lowered or "limit" in lowered:
            raise ToolStopped("SerpApi has no free searches left for now.")
        if error and "hasn't returned any results" not in lowered:
            raise SearchFailed(error[:300])
        if reply.status_code >= 400 and not error:
            raise SearchFailed(f"SerpApi answered {reply.status_code}")
        return data

    def _other_engine(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        """Bing, DuckDuckGo and Yandex: each extra page is another search. AI Overviews are Google's, so "not captured"."""
        found: list[Found] = []
        charged = 0
        for page in range(pages_for(depth)):
            if engine == "bing":
                params = {"engine": "bing", "q": keyword, "first": page * 10 + 1}
                if country:
                    params["cc"] = country.lower()
            elif engine == "yandex":
                params = {"engine": "yandex", "text": keyword, "p": page}
            else:
                params = {"engine": "duckduckgo", "q": keyword, "kl": ddg_region(country, language)}
            with _so_far(charged):
                data = self._get(params)
            charged += 1
            rows = [item for item in data.get("organic_results") or [] if isinstance(item, dict) and item.get("link")]
            found += [Found(len(found) + i + 1, item["link"], str(item.get("title") or "")[:500]) for i, item in enumerate(rows)]
            if not rows or engine == "duckduckgo":  # its next page needs a token from this one, so it stops at the first page
                break
        location = country.upper() if engine == "bing" and country else ddg_region(country, language) if engine == "duckduckgo" else ""
        # DuckDuckGo read one page only: the depth saved is what that page answers. An empty list is the end of the results.
        read = depth_read(depth, len(found)) if engine == "duckduckgo" and found else depth
        return Answer(self.name, location, read, found[:read], NOT_CAPTURED, [], charged)  # nothing kept past the depth saved

    @staticmethod
    def google_params(keyword: str, country: str, language: str, device: str) -> dict:
        """The market from the keyword's country: gl, and also location and google_domain, so SerpApi never falls back to a
        default place. No num: Google stopped honouring it in September 2025, so a deeper check reads page after page."""
        params = {"engine": "google", "q": keyword, "device": device}
        code = (country or "").upper()
        if code:
            params["gl"] = code.lower()
            if code in GOOGLE_PLACES:
                params["location"], params["google_domain"] = GOOGLE_PLACES[code]
        if language:
            params["hl"] = language.lower()
        return params

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        if engine != "google":
            return self._other_engine(keyword, engine, country, language, device, depth)
        params = self.google_params(keyword, country, language, device)
        data = self._get(params)
        seen: set[str] = set()  # the same address on two pages counts once, as with every other tool (_rows)
        results = _rows(data.get("organic_results"), 0, seen)
        charged = 1
        _refuse_hidden(self.name, results, charged)
        asked = {k: v for k, v in (data.get("search_parameters") or {}).items() if k != "api_key"} if isinstance(data.get("search_parameters"), dict) else {}
        information = data.get("search_information") if isinstance(data.get("search_information"), dict) else {}
        shown = str(information.get("query_displayed") or "")[:300]
        # A page can hold 9 results and still have a next one, so only an empty page means the end.
        last_page_had_rows = bool(data.get("organic_results"))
        for page in range(1, pages_for(depth)):
            if len(results) >= depth or not last_page_had_rows:
                break
            with _so_far(charged):
                more = self._get({**params, "start": page * 10})
            charged += 1
            found = _rows(more.get("organic_results"), len(results), seen)
            _refuse_hidden(self.name, found, charged)
            results += found
            last_page_had_rows = bool(more.get("organic_results"))
        results = results[:depth]
        location = country.upper() if country else ""

        def answer(state: str, cited: list[str] | None = None) -> Answer:
            return Answer(self.name, location, depth, results, state, cited or [], charged, asked, shown)

        overview = data.get("ai_overview")
        # Google may send the overview through a second request. Its token lasts one minute, so use it now.
        if isinstance(overview, dict) and overview.get("page_token") and not overview.get("references"):
            try:
                overview = self._get({"engine": "google_ai_overview", "page_token": overview["page_token"]}).get("ai_overview")
            except (SearchFailed, ToolStopped):
                # The page was read and counts. An overview showed, but we can't say who it cites: that's not a "no".
                return answer(NOT_CAPTURED)
            charged += 1
            if not overview:
                return answer(NOT_CAPTURED)
        if not isinstance(overview, dict) or not overview:
            return answer(ABSENT)
        if overview.get("error"):
            return answer(NOT_CAPTURED)
        cited = [result_address(str(ref["link"])) for ref in overview.get("references") or [] if isinstance(ref, dict) and ref.get("link")]
        if any(hidden for _, hidden in cited):  # Google hid a source: who it cites can't be said, and that's not a "no"
            return answer(NOT_CAPTURED)
        return answer(PRESENT, [address for address, _ in cited])

    def test(self) -> int | None:
        """Asks SerpApi how many searches are left. This call uses no credit."""
        try:
            reply = self.client.get("https://serpapi.com/account.json", params={"api_key": self.key})
        except httpx.HTTPError as exc:
            raise SearchFailed(f"The request failed: {type(exc).__name__}") from exc
        if reply.status_code in (401, 403):
            raise ToolStopped("SerpApi refused the key.")
        try:
            data = reply.json()
        except ValueError as exc:
            raise SearchFailed(f"SerpApi answered {reply.status_code} without data") from exc
        if reply.status_code != 200 or not isinstance(data, dict) or data.get("error"):
            raise ToolStopped("SerpApi refused the key.")
        return data.get("total_searches_left")


# ---- Google's hidden result links -------------------------------------------------------------------
# Since June 2026 Google may put its own redirect, https://www.google.com/goto?url=CAES…, where a result's address should be.
# The token can't be decoded: only a request to Google turns it into an address, and the app never sends one (Google slows
# those down per results page, and it may count as a click on the site). A rank check needs the site, not the page, and
# Google still writes the site under the title. So a hidden result counts for that site, at its own place, with its page
# unknown. One whose site isn't shown either is unknown, and an answer holding one is refused (_refuse_hidden).

_GOOGLE = re.compile(r"^(?:www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$")  # google.com, google.fr, google.co.uk; not support.google.com
# Where each tool puts the address Google shows under a title: Searlo, Bright Data, SerpApi, HasData.
_SHOWN = ("domain", "display_link", "displayed_link", "displayedLink")
# A post on a big platform shows numbers there ("Plus de 1,7 k abonnés", "3 \"J'aime\" · il y a 7 mois") and its source names the
# platform. Only these names are trusted, each for its own domain: any other source is a site's own name, and stays unknown.
_PLATFORMS = {
    "instagram": "instagram.com", "facebook": "facebook.com", "quora": "quora.com", "reddit": "reddit.com", "youtube": "youtube.com",
    "linkedin": "linkedin.com", "tiktok": "tiktok.com",
}


def google_redirect(link: str) -> bool:
    """Google's own redirect (/goto or /url on google.com, google.fr…) where a result's address should be."""
    try:
        parts = urlsplit(str(link or "").strip())
        host = (parts.hostname or "").lower()
    except ValueError:
        return False
    return bool(_GOOGLE.match(host)) and parts.path in ("/goto", "/url")


def result_address(link: str) -> tuple[str, bool]:
    """(the result's address, hidden?). /url?q=https://shop.example/a still names the page; /goto?url=CAES… doesn't."""
    if not google_redirect(link):
        return link, False
    query = parse_qs(urlsplit(str(link).strip()).query)
    for name in ("q", "url"):
        value = (query.get(name) or [""])[0]
        if value.startswith(("http://", "https://")) and not google_redirect(value):
            return value, False
    return "", True


def _shown_host(value) -> str:
    """The host in an address Google writes under a title: "https://www.shop.example › blog › a-post-cut-sh..." gives
    www.shop.example. Words ("Plus de 30 réponses · il y a 3 ans", "17M+ views"), Google itself, or a host cut short give ""."""
    words = str(value or "").split("›", 1)[0].split()
    if not words or "…" in words[0] or "..." in words[0]:
        return ""
    try:
        host = (urlsplit(words[0] if "://" in words[0] else f"https://{words[0]}").hostname or "").rstrip(".")
    except ValueError:
        return ""
    labels = host.split(".")
    ending = labels[-1]
    if len(labels) < 2 or not ((ending.isalpha() and len(ending) >= 2) or ending.startswith("xn--")) or _GOOGLE.match(host):
        return ""
    return host if root_domain(host) else ""


def shown_site(item: dict) -> str:
    """The site of a result whose link Google hid, from what Google shows under its title, "" when that isn't known."""
    for name in _SHOWN:
        host = _shown_host(item.get(name))
        if host:
            return host
    return _PLATFORMS.get(str(item.get("source") or "").split("·", 1)[0].strip().casefold(), "")


def _found(position: int, item: dict, link: str) -> Found:
    """One result. One whose link Google hid keeps its place, with its site and no page."""
    title = str(item.get("title") or "")[:500]
    url, hidden = result_address(link)
    return Found(position, "", title, shown_site(item)) if hidden else Found(position, url, title)


def _refuse_hidden(tool: str, rows: list[Found], charged: int) -> None:
    """A result with neither its address nor its site means the answer can't say who isn't on the page, so none of it is
    used. The tool stops for Google as at a bot check, the next one is asked, and the page that came back stays counted."""
    unknown = sum(1 for row in rows if not row.url and not row.host)
    if unknown:
        exc = HiddenAddresses(
            f"Google hid the address of {unknown} of the {len(rows)} results in {tool}'s answer and didn't show their site either, "
            f"so {tool} can't be used for Google right now. Nothing from that answer was saved."
        )
        exc.charged = charged  # the page came back and may have been billed
        raise exc


# ---- Shared by the tools below -------------------------------------------------------------------

def _what_came_back(reply: httpx.Response) -> str:
    """A reply that isn't data, in a few words for the check's error: its type and size, the vendor's own headers about it,
    and its first words. The key never comes back: it only goes out, in the request."""
    kind = (reply.headers.get("content-type") or "no content type").split(";")[0].strip()
    said = sorted(((name.lower(), value) for name, value in reply.headers.items() if name.lower().startswith(("x-brd-", "x-luminati-"))), key=lambda pair: ("error" not in pair[0], "status" not in pair[0], pair[0]))
    parts = [kind, f"{len(reply.content)} bytes" if reply.content else "empty", *[f"{name}: {value[:80]}" for name, value in said[:3]]]
    words = " ".join(reply.text[:2000].split())[:120] if reply.content else ""
    return f"({'; '.join(parts)})" + (f": {words}" if words else "")


def _json_or_fail(reply: httpx.Response, who: str) -> dict:
    try:
        data = reply.json()
    except ValueError as exc:
        raise SearchFailed(f"{who} answered {reply.status_code} without data {_what_came_back(reply)}") from exc
    if not isinstance(data, dict):
        raise SearchFailed(f"{who} answered {reply.status_code} without data {_what_came_back(reply)}")
    return data


def _rows(items, offset: int, seen: set[str]) -> list[Found]:
    """The rows of one page, numbered from the top of the whole search. The same address twice counts once. A row whose
    link Google hid keeps its place, so the rows under it keep theirs, and two hidden rows never merge into one."""
    found: list[Found] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        link = str(item.get("link") or item.get("url") or "").strip()
        if not link.startswith(("http://", "https://")):
            continue
        row = _found(offset + len(found) + 1, item, link)
        if (row.url or link) in seen:
            continue
        seen.add(row.url or link)
        found.append(row)
    return found


def _request(call, who: str) -> httpx.Response:
    try:
        return call()
    except httpx.TimeoutException as exc:
        raise TimedOut(f"The request failed: {type(exc).__name__}") from exc
    except httpx.HTTPError as exc:
        raise SearchFailed(f"The request failed: {type(exc).__name__}") from exc


# ---- Bright Data ---------------------------------------------------------------------------------
# Written from docs.brightdata.com (checked 2026-11-05): POST /request with a zone and the search page's address, and
# brd_json=1 for parsed JSON. NEVER RUN ON A REAL KEY. Yandex's and DuckDuckGo's parameters are the least documented.

class BrightData:
    name = "Bright Data"
    engines = ("google", "duckduckgo", "bing", "yandex")
    free_monthly = 5000
    paid_per = 0.0015  # dollars per credit: $1.50 per 1,000

    def __init__(self, key: str, zone: str, client: httpx.Client | None = None):
        self.key, self.zone = key, zone
        self.client = client or httpx.Client(timeout=TIMEOUT, headers={"User-Agent": BOT_NAME})

    @staticmethod
    def page_address(keyword: str, engine: str, country: str, language: str, device: str, page: int) -> str:
        mobile = {"brd_mobile": "1"} if device == "mobile" else {}
        if engine == "google":
            base, params = "https://www.google.com/search", {"q": keyword, "start": page * 10, **({"gl": country.lower()} if country else {}), **({"hl": language.lower()} if language else {})}
        elif engine == "bing":
            base, params = "https://www.bing.com/search", {"q": keyword, "first": page * 10 + 1, **({"cc": country.lower()} if country else {}), **({"setLang": language.lower()} if language else {})}
        elif engine == "duckduckgo":
            # The address Bright Data's own DuckDuckGo examples use, without brd_json: there's no parsed JSON for DuckDuckGo
            # (live, 2026-11-11: brd_json=1 "No parser found", brd_json=0 "JSON output is not supported"). _duckduckgo asks
            # for it as Markdown, the one way that answered. html.duckduckgo.com was refused too, so it isn't asked for.
            return f"https://duckduckgo.com/?{urlencode({'q': keyword, 'kl': ddg_region(country, language), **mobile})}"
        else:
            base, params = "https://yandex.com/search/", {"text": keyword, "p": page}
        return f"{base}?{urlencode({**params, **mobile, 'brd_json': '1'})}"

    def _reply(self, address: str, **extra) -> httpx.Response:
        reply = _request(lambda: self.client.post(
            "https://api.brightdata.com/request",
            headers={"Authorization": f"Bearer {self.key}"},
            json={"zone": self.zone, "url": address, "format": "raw", **extra},
        ), self.name)
        if reply.status_code in (401, 403):
            raise ToolStopped("Bright Data refused the key or the zone name.")
        if reply.status_code in (402, 429):
            raise ToolStopped("Bright Data has no free searches left for now.")
        if reply.status_code != 200:
            raise SearchFailed(f"Bright Data answered {reply.status_code}")
        return reply

    def _page(self, address: str) -> dict:
        """A parsed results page (Google, Bing, Yandex). DuckDuckGo's HTML page reads its own refusal, in _duckduckgo."""
        reply = self._reply(address)
        # It answers 200 even when it couldn't get the page, and says why in its own headers. Seen on 2026-11-11: an empty body,
        # x-brd-error-code "captcha", x-brd-error "redirect location was rejected", x-brd-status-code 502. A failed search,
        # never "not ranked", and one more toward dropping the tool.
        why = f"{reply.headers.get('x-brd-error-code', '')} {reply.headers.get('x-brd-error', '')}".strip()
        if "captcha" in why.lower():
            engine = "Bing" if "bing.com" in address else "Yandex" if "yandex." in address else "Google"
            raise SearchFailed(f"{engine} showed Bright Data a captcha, so this search failed. The app doesn't try to get past it.")
        if why:
            raise SearchFailed(f"Bright Data couldn't get the results page {_what_came_back(reply)}")
        return _json_or_fail(reply, self.name)

    def _duckduckgo(self, keyword: str, country: str, language: str, device: str, depth: int) -> Answer:
        """DuckDuckGo's page as Markdown, one heading per result. One page, one credit.

        DuckDuckGo shows the hosting server a bot check (live, 2026-11-11), so this is how the server gets DuckDuckGo's
        results without SerpApi (owner, 2026-11-11). Live that day, the owner's zone answered "No parser found for this
        resource" (parse_no_parser) to DuckDuckGo as raw HTML or with brd_json, and the page itself once asked for as
        Markdown. A page with nothing readable is one failed search: it was still billed. An empty answer with Bright
        Data's own error code is a refusal, not a page: it stops the tool, and isn't counted as a credit.
        """
        with _so_far(0):
            reply = self._reply(self.page_address(keyword, "duckduckgo", country, language, device, 0), data_format="markdown")
            refused = reply.headers.get("x-brd-error-code")
            if refused and not reply.content:
                raise ToolStopped(f"Bright Data can't read DuckDuckGo with this zone: {reply.headers.get('x-brd-error') or refused}.")
        body = reply.content
        text = body.decode("utf-8", "replace")
        every = parse_ddg_markdown(text) or parse_ddg(body)  # an HTML page, should the zone ever send one
        results = every[:depth]
        if not results and b"no-results" not in body and "No results found" not in text:
            failed = SearchFailed("Bright Data's DuckDuckGo page had no results the app could read.")
            failed.charged = 1
            raise failed
        saved = depth_read(depth, len(every)) if every else depth
        return Answer(self.name, ddg_region(country, language), saved, results[:saved], NOT_CAPTURED, [], 1)  # position and depth agree

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        if engine == "duckduckgo":
            return self._duckduckgo(keyword, country, language, device, depth)
        found: list[Found] = []
        seen: set[str] = set()
        charged = 0
        for page in range(pages_for(depth)):
            with _so_far(charged):
                data = self._page(self.page_address(keyword, engine, country, language, device, page))
            charged += 1
            rows = _rows(data.get("organic"), len(found), seen)
            _refuse_hidden(self.name, rows, charged)  # before a deeper page is asked for, so nothing more is spent
            found += rows
            if not rows:
                break
        location = country.upper() if country and engine != "yandex" else ""
        # brd_ai_overview exists, but its answer's fields aren't documented, so nothing is claimed about AI Overviews yet.
        return Answer(self.name, location, depth, found[:depth], NOT_CAPTURED, [], charged)


# ---- HasData -------------------------------------------------------------------------------------
# Written from docs.hasdata.com and hasdata.com (checked 2026-11-05). NEVER RUN ON A REAL KEY. Its docs show Google and
# Bing only, at 10 credits a request, so DuckDuckGo isn't claimed here even though an earlier note listed it.

class HasData:
    name = "HasData"
    engines = ("google", "bing")
    free_monthly = 1000
    credits_per_page = 10
    most_per_search = 10
    paid_per = 0.00083

    def __init__(self, key: str, client: httpx.Client | None = None):
        self.key = key
        self.client = client or httpx.Client(timeout=TIMEOUT, headers={"User-Agent": BOT_NAME})

    def _page(self, engine: str, params: dict) -> dict:
        reply = _request(lambda: self.client.get(f"https://api.hasdata.com/scrape/{engine}/serp", params=params, headers={"x-api-key": self.key}), self.name)
        if reply.status_code in (401, 403):
            raise ToolStopped("HasData refused the key.")
        if reply.status_code in (402, 429):
            raise ToolStopped("HasData has no free searches left for now.")
        if reply.status_code != 200:
            raise SearchFailed(f"HasData answered {reply.status_code}")
        return _json_or_fail(reply, self.name)

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        found: list[Found] = []
        seen: set[str] = set()
        charged = 0
        for page in range(pages_for(depth)):
            params: dict = {"q": keyword, "deviceType": device}
            if engine == "bing":
                params["first"] = page * 10 + 1
                if country:
                    params["cc"] = country.lower()
                if language:
                    params["setLang"] = language.lower()
            else:
                params["start"] = page * 10
                if country:
                    params["gl"] = country.lower()
                if language:
                    params["hl"] = language.lower()
            with _so_far(charged):
                data = self._page(engine, params)
            charged += self.credits_per_page
            rows = _rows(data.get("organicResults"), len(found), seen)
            _refuse_hidden(self.name, rows, charged)
            found += rows
            if not rows:
                break
        return Answer(self.name, country.upper() if country else "", depth, found[:depth], NOT_CAPTURED, [], charged)


# ---- Searlo --------------------------------------------------------------------------------------
# Written from searlo.tech/docs (checked 2026-11-05). NEVER RUN ON A REAL KEY. /search/web is 1 credit a page. /serp has the
# AI Overview at 3 credits, but its answer's fields aren't documented, so this stays on /search/web and says "not captured".

class Searlo:
    name = "Searlo"
    engines = ("google",)
    free_monthly = None
    free_once = 3000  # never refills
    paid_per = 0.0008

    def __init__(self, key: str, client: httpx.Client | None = None):
        self.key = key
        self.client = client or httpx.Client(timeout=TIMEOUT, headers={"User-Agent": BOT_NAME})

    def _page(self, params: dict) -> dict:
        reply = _request(lambda: self.client.get("https://api.searlo.tech/api/v1/search/web", params=params, headers={"x-api-key": self.key}), self.name)
        if reply.status_code in (401, 403):
            raise ToolStopped("Searlo refused the key.")
        if reply.status_code == 402:
            raise ToolStopped("Searlo has no credits left.")
        if reply.status_code == 429:
            raise ToolStopped("Searlo asked us to slow down, so this tool stopped.")
        if reply.status_code != 200:
            data = {}
            try:
                data = reply.json()
            except ValueError:
                pass
            code = data.get("code") or data.get("errorCode") if isinstance(data, dict) else None
            raise SearchFailed(f"Searlo answered {reply.status_code}{f' ({code})' if code else ''}")
        return _json_or_fail(reply, self.name)

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        found: list[Found] = []
        seen: set[str] = set()
        charged = 0
        for page in range(pages_for(depth)):
            params: dict = {"q": keyword, "limit": 10, "page": page + 1}
            if country:
                params["gl"] = country.lower()
            if language:
                params["hl"] = language.lower()
            with _so_far(charged):
                data = self._page(params)
            charged += 1
            rows = _rows(data.get("organic"), len(found), seen)  # on a hidden row its link stays Google's, and its domain names the site
            _refuse_hidden(self.name, rows, charged)
            found += rows
            if not rows:
                break
        return Answer(self.name, country.upper() if country else "", depth, found[:depth], NOT_CAPTURED, [], charged)


# ---- SearXNG -------------------------------------------------------------------------------------
# Tested on 2026-11-04 by scripts/test_searxng.py against a local instance, not through this class. Bing and Yandex only:
# Google denied it, and DuckDuckGo direct is better for DuckDuckGo. It's an address, not a key, and nothing is charged.

class SearXNG:
    name = "SearXNG"
    engines = ("bing", "yandex")
    free_monthly = None
    time_limit = 15

    def __init__(self, address: str, client: httpx.Client | None = None):
        self.address = address.rstrip("/")
        self.client = client or httpx.Client(timeout=self.time_limit + 5, headers={"User-Agent": BOT_NAME})

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        if engine not in self.engines:  # an unknown engine makes SearXNG fall back to its defaults, which include Google
            raise SearchFailed(f"SearXNG isn't used for {engine}.")
        locale = f"{language.lower()}-{country.upper()}" if language and country else (language or "all")
        found: list[Found] = []
        seen: set[str] = set()
        for page in range(pages_for(depth)):
            reply = _request(lambda: self.client.get(f"{self.address}/search", params={"q": keyword, "format": "json", "language": locale, "engines": engine, "pageno": page + 1, "timeout_limit": self.time_limit}), self.name)
            if reply.status_code in (403, 429):
                raise ToolStopped(f"SearXNG answered {reply.status_code}, so this tool stopped.")
            if reply.status_code != 200:
                raise SearchFailed(f"SearXNG answered {reply.status_code}")
            data = _json_or_fail(reply, self.name)
            rows = _rows(data.get("results"), len(found), seen)
            found += rows
            if not rows:
                if not found and data.get("unresponsive_engines"):
                    # An engine it suspended, for a captcha or a denial. That's not "nobody ranks".
                    raise ToolStopped(f"{engine} isn't answering SearXNG for now, so this tool stopped.")
                break
        return Answer(self.name, country.upper() if language and country else "", depth, found[:depth], NOT_CAPTURED, [], 0)

    def test(self) -> None:
        self.search("test", "bing", "", "", "desktop", 10)


# ---- A real browser on the Mac -------------------------------------------------------------------
# The owner's exception to the bot-name rule, for the backup only. It waits a moment for a captcha to clear by itself, then
# stops. It never solves one, and uses no proxies or IP rotation. It sees results from the Mac's own country, whatever is asked,
# so its checks stay on their own line unless the target is that country. Tried by hand on 2026-11-04 (phase 0), but this class
# has only run on hand-written pages: the readers below need a real run.

_CAPTCHA_ADDRESSES = ("google.com/sorry", "/showcaptcha", "/captcha")
_CAPTCHA_WORDS = (b"g-recaptcha", b'id="captcha', b"smartcaptcha", b"b_captcha", b"cf-turnstile")  # markup, not words a results page could show


def looks_like_captcha(final_url: str, page: bytes) -> bool:
    lowered = (final_url or "").lower()
    if any(mark in lowered for mark in _CAPTCHA_ADDRESSES):
        return True
    return any(word in page[:200000].lower() for word in _CAPTCHA_WORDS)


def read_browser_page(engine: str, page: bytes) -> list[Found]:
    """Normal results only, in the order shown. Adverts sit outside the areas read here."""
    try:
        doc = lxml_html.document_fromstring(page)
    except (etree.ParserError, ValueError, TypeError):
        return []
    if engine == "google":
        anchors = doc.xpath("//div[@id='search']//a[.//h3]")
    elif engine == "bing":
        anchors = doc.xpath("//li[contains(concat(' ', normalize-space(@class), ' '), ' b_algo ')]//h2/a")
    else:
        anchors = doc.xpath("//li[contains(concat(' ', normalize-space(@class), ' '), ' serp-item ')]//a[contains(@class, 'organic__url') or contains(@class, 'OrganicTitle-Link')]")
    items = []
    for anchor in anchors:
        item = {"link": (anchor.get("href") or "").strip(), "title": anchor.text_content().strip()}
        if engine == "google":
            if item["link"].startswith(("/goto?", "/url?")):  # Google's redirect, written relative: kept in its place, never dropped
                item["link"] = "https://www.google.com" + item["link"]
            item["display_link"] = " ".join(anchor.xpath("string(.//cite)").split())  # the address shown under the title
        items.append(item)
    return _rows(items, 0, set())


class BrowserBackup:
    name = "Browser on this Mac"
    engines = ("google", "bing", "yandex")
    free_monthly = None
    manual_only = True  # only when ticked in Refresh: never down the automatic order, and never on an upload
    gap_seconds = 20.0  # one keyword at a time, spaced out
    MISSING = "The browser backup needs Playwright. Install it: .venv/bin/pip install playwright"
    CAPTCHA = "A captcha appeared and didn't clear, so the browser backup stopped. The app doesn't try to get past it."

    def __init__(self, country: str, open_page=None, sleep=time.sleep, clear_wait: float = 15.0):
        self.country = (country or "").upper()
        self.open_page = open_page  # tests give a function: address -> (final address, page bytes)
        self.sleep = sleep
        self.clear_wait = clear_wait
        self.last_at = 0.0
        self._driver = None

    def _start(self):
        try:
            from playwright.sync_api import Error as PlaywrightError, sync_playwright
        except ImportError as exc:
            raise ToolStopped(self.MISSING) from exc
        try:
            driver = sync_playwright().start()
            browser = driver.chromium.launch(channel="chrome", headless=False)
            self._driver = (driver, browser, browser.new_page())
        except PlaywrightError as exc:
            raise ToolStopped(f"The browser backup couldn't start Chrome: {str(exc)[:200]}") from exc

    def _read(self, address: str) -> tuple[str, bytes]:
        if self.open_page:
            return self.open_page(address)
        if self._driver is None:
            self._start()
        page = self._driver[2]
        page.goto(address, wait_until="domcontentloaded", timeout=int(TIMEOUT * 1000))
        page.wait_for_timeout(2000)
        return page.url, page.content().encode("utf-8")

    def close(self) -> None:
        if self._driver:
            driver, browser, _ = self._driver
            self._driver = None
            browser.close()
            driver.stop()

    @staticmethod
    def page_address(keyword: str, engine: str, country: str, language: str, page: int) -> str:
        if engine == "google":
            params = {"q": keyword, "start": page * 10, **({"gl": country.lower()} if country else {}), **({"hl": language.lower()} if language else {})}
            return f"https://www.google.com/search?{urlencode(params)}"
        if engine == "bing":
            params = {"q": keyword, "first": page * 10 + 1, **({"cc": country.lower()} if country else {}), **({"setLang": language.lower()} if language else {})}
            return f"https://www.bing.com/search?{urlencode(params)}"
        return f"https://yandex.com/search/?{urlencode({'text': keyword, 'p': page})}"

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        if engine not in self.engines:
            raise SearchFailed(f"The browser backup isn't used for {engine}.")
        found: list[Found] = []
        for page in range(pages_for(depth)):
            wait = self.gap_seconds - (time.monotonic() - self.last_at)
            if self.last_at and wait > 0:
                self.sleep(wait)
            self.last_at = time.monotonic()
            try:
                final, body = self._read(self.page_address(keyword, engine, country, language, page))
                if looks_like_captcha(final, body):  # it may clear by itself. Nothing is clicked.
                    self.sleep(self.clear_wait)
                    final, body = self._read(self.page_address(keyword, engine, country, language, page))
                    if looks_like_captcha(final, body):
                        raise ToolStopped(self.CAPTCHA)
            except (ToolStopped, SearchFailed):
                raise
            except Exception as exc:  # noqa: BLE001 - a browser failing is a failed search, not a crash
                if "Timeout" in type(exc).__name__:
                    raise TimedOut(f"The request failed: {type(exc).__name__}") from exc
                raise SearchFailed(f"The browser failed: {type(exc).__name__}") from exc
            rows = read_browser_page(engine, body)
            _refuse_hidden(self.name, rows, 0)
            if not rows:
                if not found:
                    raise SearchFailed("The page had no results the app could read.")
                break
            found += [Found(len(found) + i + 1, row.url, row.title, row.host) for i, row in enumerate(rows)]
        return Answer(self.name, self.country, depth, found[:depth], NOT_CAPTURED, [], 0)


# ---- Semscraper ----------------------------------------------------------------------------------
# Written from semscraper.com/en/documentation (checked 2026-11-23). NEVER RUN ON A REAL KEY in tests. Google only. One task
# per search: POST /v1/serp bills it when it's created (€0.30 per 1,000 for the first page, €0.20 per 1,000 for each more),
# then GET /v1/serp?ids= (never billed) is asked every few seconds until it says done. It reads the AI Overview and who it
# cites, so it can stand in for SerpApi there. Its key is the app's Semscraper key (Settings → Semscraper), the same one
# What AI says uses. It has no free allowance the app can count on (the first 1,000 SERPs are the account's, and What AI says
# spends from them too), so every search is paid use: only with its paid switch on, and the price is shown first.

SEMSCRAPER_BASE = "https://api.semscraper.com/v1"
_AI_BLOCKS = ("ai_overview_citation", "ai_overview_panel", "ai_overview_citation_source")


def _money(value) -> "Decimal | None":
    from decimal import Decimal, InvalidOperation  # noqa: PLC0415 - only Semscraper's prices need it here

    try:
        found = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return found if found.is_finite() and found >= 0 else None


def semscraper_price(pages: int):
    """Euros for one search of this many pages: €0.0003 for the first, €0.0002 for each more. Negative or zero: nothing."""
    from decimal import Decimal  # noqa: PLC0415

    pages = int(pages or 0)
    if pages <= 0:
        return Decimal("0")
    return Decimal("0.0003") + Decimal("0.0002") * (pages - 1)


def read_semscraper(row: dict, depth: int) -> tuple[list[Found], str, list[str]]:
    """(organic results, AI Overview state, the addresses it cites) from one finished SERP.

    Organic rows come in Google's order (page, then rank_type). A row whose link Google hid (url_approx) keeps its place,
    with the site Semscraper shows and no page. The AI Overview mirrors SerpApi's rules: none shown is a "no"; one cut short,
    unreadable, or citing a hidden source is "not captured", never a "no".
    """
    blocks = [block for block in row.get("results") or [] if isinstance(block, dict)]
    items = []
    for block in blocks:
        if block.get("type") != "organic":
            continue
        for item in block.get("items") or []:
            if isinstance(item, dict):
                items.append(item)

    def place(item: dict) -> tuple:
        def whole(value, default):
            try:
                return int(value)
            except (TypeError, ValueError):
                return default
        return whole(item.get("page"), 1), whole(item.get("rank_type"), 10**6), whole(item.get("rank_serp"), 10**6)

    shaped = []
    for item in sorted(items, key=place):  # a stable sort: rows without numbers keep the order they came in
        link = str(item.get("url") or "").strip()
        if item.get("url_approx"):  # Google hid the address: Semscraper's url is a guess, so the page stays unknown
            goto = str(item.get("goto_url") or "").strip()
            link = goto if google_redirect(goto) else "https://www.google.com/goto?url=hidden"
        shaped.append({"link": link, "title": item.get("title"), "domain": item.get("domain")})
    results = _rows(shaped, 0, set())[:depth]

    info = row.get("serp_info") if isinstance(row.get("serp_info"), dict) else {}
    overview = info.get("ai_overview")
    ai_blocks = [block for block in blocks if block.get("type") in _AI_BLOCKS]
    kind = str(overview.get("type") or "").lower() if isinstance(overview, dict) else ""
    if not isinstance(overview, dict) or kind == "none" or (not kind and not overview.get("text") and not ai_blocks):
        if ai_blocks:  # sources drawn without an overview to go with them: something's off, and that's not a "no"
            return results, NOT_CAPTURED, []
        return results, ABSENT, []
    if not str(overview.get("text") or "").strip() or overview.get("complete") is False:
        return results, NOT_CAPTURED, []  # it showed, but couldn't be read, or Google hadn't finished writing it
    cited: list[str] = []
    for block in ai_blocks:
        for item in block.get("items") or []:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or "").strip()
            if item.get("url_approx"):
                return results, NOT_CAPTURED, []  # a hidden source: who it cites can't be said
            if not url.startswith(("http://", "https://")):
                continue  # a brand named in the text, with no link (ai_overview_citation often has only `brand`)
            address, hidden = result_address(url)
            if hidden:
                return results, NOT_CAPTURED, []
            if address not in cited:
                cited.append(address)
    return results, PRESENT, cited


class Semscraper:
    name = "Semscraper"
    engines = ("google",)
    gives_ai = True
    always_paid = True  # no free allowance the app counts: every search needs its paid switch, and shows its price first
    free_monthly = None
    paid_per = 0.0003  # euros for the first page; each more page is €0.0002 (price_of)
    currency = "EUR"
    free_serps = 1000  # the account's first 1,000 SERPs are free; the app counts what it has sent against them
    poll_seconds = 3.0
    wait_limit = 120.0

    def __init__(self, key: str, client: httpx.Client | None = None, sleep=time.sleep, clock=time.monotonic):
        self.key = key
        self.client = client or httpx.Client(timeout=TIMEOUT, headers={"User-Agent": BOT_NAME})
        self.sleep, self.clock = sleep, clock

    @staticmethod
    def price_of(pages: int):
        return semscraper_price(pages)

    def _call(self, method: str, path: str, **kwargs) -> httpx.Response:
        reply = _request(lambda: self.client.request(method, f"{SEMSCRAPER_BASE}{path}", headers={"Authorization": f"Bearer {self.key}"}, **kwargs), self.name)
        if reply.status_code in (401, 403):
            raise ToolStopped("Semscraper refused the key.")
        if reply.status_code == 402:
            raise ToolStopped("Semscraper has no credit left.")
        if reply.status_code == 429:
            raise ToolStopped("Semscraper asked us to slow down, so this tool stopped.")
        if reply.status_code != 200:
            said = ""
            try:
                data = reply.json()
                said = str(data.get("message") or data.get("error") or "") if isinstance(data, dict) else ""
            except ValueError:
                pass
            if re.search(r"credit|balance|insufficient|fund", said, re.IGNORECASE):
                raise ToolStopped("Semscraper has no credit left.")
            raise SearchFailed(f"Semscraper answered {reply.status_code}{f': {said[:200]}' if said else ''}")
        return reply

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        if engine != "google":
            raise SearchFailed("Semscraper is only used for Google.")
        pages = min(10, pages_for(depth))
        location = (country or "us").lower()
        task = {"search_engine": "google_search", "keyword": keyword, "device": device if device in ("desktop", "mobile") else "desktop",
                "depth": pages, "location": location, "language": (language or "en").lower(), "priority": 5}
        sent = _json_or_fail(self._call("POST", "/serp", json=[task]), self.name)
        rows = sent.get("data")
        first = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}
        task_id = str(first.get("id") or "")
        if not task_id:
            raise SearchFailed("Semscraper didn't take the search.")  # nothing was created, so nothing was billed
        cost = _money(first.get("cost"))
        started = self.clock()
        while True:
            # The task exists and is billed from here on: whatever stops it now keeps what it cost.
            with _so_far(pages):
                if self.clock() - started > self.wait_limit:
                    raise TimedOut(f"Semscraper didn't finish the search within {int(self.wait_limit)} seconds.")
                got = _json_or_fail(self._call("GET", "/serp", params={"ids": task_id, "output": "json"}), self.name)
            found = got.get("data")
            row = next((r for r in found if isinstance(r, dict) and str(r.get("id")) == task_id), None) if isinstance(found, list) else None
            status = str((row or {}).get("status") or "").lower()
            if row is not None and status == "done":
                break
            if row is not None and status not in ("pending", "processing", ""):
                failed = SearchFailed(f"Semscraper couldn't do this search ({status}).")
                failed.charged = 0  # a failed request isn't billed
                raise failed
            self.sleep(self.poll_seconds)
        if cost is None:
            cost = _money(row.get("cost"))
        billed = pages
        if cost is not None and cost > 0:  # only found pages are billed: the price says how many
            extra = semscraper_price(2) - semscraper_price(1)
            billed = max(1, min(pages, 1 + int(((cost - semscraper_price(1)) / extra).to_integral_value())))
        results, state, cited = read_semscraper(row, depth)
        _refuse_hidden(self.name, results, billed)  # the page came back and was billed
        answer = Answer(self.name, location.upper(), depth, results, state, cited, billed)
        answer.real_cost = cost  # what Semscraper said it cost: €0 while the account's free SERPs last
        return answer

    def test(self):
        """Its balance, which costs nothing. No credit left stops it."""
        data = _json_or_fail(self._call("GET", "/billing/credit"), self.name)
        rows = data.get("data")
        first = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else rows if isinstance(rows, dict) else {}
        balance = _money(first.get("balance")) if isinstance(first, dict) else None
        if balance is None:
            raise SearchFailed("Semscraper didn't say what credit is left.")
        if balance <= 0:
            raise ToolStopped("Semscraper has no credit left.")
        return float(balance)
