"""Search tools: each one turns a keyword into what a search engine showed.

A tool says what it really searched from. It reports a bot check, a captcha or an empty account
instead of working around it, and the caller moves to the next free tool. Nothing here pays.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
from lxml import etree, html as lxml_html

BOT_NAME = "PageChangeBot/0.1"
PRESENT, ABSENT, NOT_CAPTURED = "present", "absent", "not_captured"
TIMEOUT = 45.0


@dataclass
class Found:
    position: int
    url: str
    title: str = ""


@dataclass
class Answer:
    tool: str
    real_location: str
    depth: int
    results: list[Found] = field(default_factory=list)
    ai_state: str = NOT_CAPTURED
    ai_citations: list[str] = field(default_factory=list)
    charged: int = 1


class ToolStopped(Exception):
    """This tool can't be used right now: a bot check, a captcha, a bad key, or no free credits left."""

    charged = 0  # credits the pages before this one already used: a failure on page 3 doesn't give back pages 1 and 2


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


def parse_ddg(body: bytes) -> list[Found]:
    """Normal results only: adverts and DuckDuckGo's own links are left out."""
    try:
        doc = lxml_html.document_fromstring(body)
    except (etree.ParserError, ValueError, TypeError):  # an empty or broken page has no results to read
        return []
    found: list[Found] = []
    for anchor in doc.xpath("//a[contains(concat(' ', normalize-space(@class), ' '), ' result__a ')]"):
        if anchor.xpath("ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' result--ad ')]"):
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
            raise ToolStopped(self.BOT_CHECK)
        if reply.status_code == 429:
            raise ToolStopped("DuckDuckGo asked us to slow down, so this tool stopped.")
        if reply.status_code != 200:
            raise SearchFailed(f"DuckDuckGo answered {reply.status_code}")
        results = parse_ddg(reply.content)[:depth]
        if not results:
            # The word alone proves nothing on a page of results: "anomaly detection" is a fine keyword.
            says_none = b"no-results" in reply.content
            if b"anomaly" in reply.content[:60000] and not says_none:
                raise ToolStopped(self.BOT_CHECK)
            if not says_none:  # a page we can't read must not pass as "nobody ranks"
                raise SearchFailed("DuckDuckGo's page had no results the app could read.")
        return Answer(self.name, region, depth, results, NOT_CAPTURED, [], 0)


# ---- SerpApi: all four engines, AI Overview on Google. Written from its documentation: no key has been tried yet --------

def _position(item: dict, index: int) -> int:
    try:
        return int(item.get("position") or index + 1)
    except (TypeError, ValueError):
        return index + 1


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
        return Answer(self.name, location, depth, found[:depth], NOT_CAPTURED, [], charged)

    def search(self, keyword: str, engine: str, country: str, language: str, device: str, depth: int) -> Answer:
        if engine != "google":
            return self._other_engine(keyword, engine, country, language, device, depth)
        params = {"engine": "google", "q": keyword, "num": depth, "device": device}
        if country:
            params["gl"] = country.lower()
        if language:
            params["hl"] = language.lower()
        data = self._get(params)
        results = [
            Found(_position(item, i), item["link"], str(item.get("title") or "")[:500])
            for i, item in enumerate(data.get("organic_results") or []) if isinstance(item, dict) and item.get("link")
        ]
        charged = 1
        # Google stopped honouring num in September 2025, so a deeper check reads further pages, each one a search.
        # A page can hold 9 results and still have a next one, so only an empty page means the end.
        last_page_had_rows = bool(results)
        for page in range(1, pages_for(depth)):
            if len(results) >= depth or not last_page_had_rows:
                break
            with _so_far(charged):
                more = self._get({**params, "start": page * 10})
            charged += 1
            rows = [item for item in more.get("organic_results") or [] if isinstance(item, dict) and item.get("link")]
            results += [Found(len(results) + i + 1, item["link"], str(item.get("title") or "")[:500]) for i, item in enumerate(rows)]
            last_page_had_rows = bool(rows)
        results = results[:depth]
        location = country.upper() if country else ""
        overview = data.get("ai_overview")
        # Google may send the overview through a second request. Its token lasts one minute, so use it now.
        if isinstance(overview, dict) and overview.get("page_token") and not overview.get("references"):
            try:
                overview = self._get({"engine": "google_ai_overview", "page_token": overview["page_token"]}).get("ai_overview")
            except (SearchFailed, ToolStopped):
                # The page was read and counts. An overview showed, but we can't say who it cites: that's not a "no".
                return Answer(self.name, location, depth, results, NOT_CAPTURED, [], charged)
            charged += 1
            if not overview:
                return Answer(self.name, location, depth, results, NOT_CAPTURED, [], charged)
        if not isinstance(overview, dict) or not overview:
            return Answer(self.name, location, depth, results, ABSENT, [], charged)
        if overview.get("error"):
            return Answer(self.name, location, depth, results, NOT_CAPTURED, [], charged)
        cited = [ref["link"] for ref in overview.get("references") or [] if isinstance(ref, dict) and ref.get("link")]
        return Answer(self.name, location, depth, results, PRESENT, cited, charged)

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


# ---- Shared by the tools below -------------------------------------------------------------------

def _json_or_fail(reply: httpx.Response, who: str) -> dict:
    try:
        data = reply.json()
    except ValueError as exc:
        raise SearchFailed(f"{who} answered {reply.status_code} without data") from exc
    if not isinstance(data, dict):
        raise SearchFailed(f"{who} answered {reply.status_code} without data")
    return data


def _rows(items, offset: int, seen: set[str]) -> list[Found]:
    """The rows of one page, numbered from the top of the whole search. The same address twice counts once."""
    found: list[Found] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("link") or item.get("url") or "").strip()
        if not url.startswith(("http://", "https://")) or url in seen:
            continue
        seen.add(url)
        found.append(Found(offset + len(found) + 1, url, str(item.get("title") or "")[:500]))
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
            # duckduckgo.com/?q= is a JavaScript page with no results in it, and Bright Data has no parsed JSON for it: live
            # on 2026-11-11 it "answered 200 without data" 3 times out of 3. The plain HTML page lists them (_duckduckgo).
            return f"https://html.duckduckgo.com/html/?{urlencode({'q': keyword, 'kl': ddg_region(country, language)})}"
        else:
            base, params = "https://yandex.com/search/", {"text": keyword, "p": page}
        return f"{base}?{urlencode({**params, **mobile, 'brd_json': '1'})}"

    def _reply(self, address: str) -> httpx.Response:
        reply = _request(lambda: self.client.post(
            "https://api.brightdata.com/request",
            headers={"Authorization": f"Bearer {self.key}"},
            json={"zone": self.zone, "url": address, "format": "raw"},
        ), self.name)
        if reply.status_code in (401, 403):
            raise ToolStopped("Bright Data refused the key or the zone name.")
        if reply.status_code in (402, 429):
            raise ToolStopped("Bright Data has no free searches left for now.")
        if reply.status_code != 200:
            raise SearchFailed(f"Bright Data answered {reply.status_code}")
        return reply

    def _page(self, address: str) -> dict:
        return _json_or_fail(self._reply(address), self.name)

    def _duckduckgo(self, keyword: str, country: str, language: str, device: str, depth: int) -> Answer:
        """DuckDuckGo's plain HTML page, read the same way DuckDuckGo direct reads it. One page, one credit.

        DuckDuckGo shows the hosting server a bot check (live, 2026-11-11), so this is how the server gets DuckDuckGo's
        results without SerpApi (owner, 2026-11-11). A page with nothing readable is one failed search: it was still billed.
        """
        with _so_far(0):
            body = self._reply(self.page_address(keyword, "duckduckgo", country, language, device, 0)).content
        results = parse_ddg(body)[:depth]
        if not results and b"no-results" not in body:
            failed = SearchFailed("Bright Data's DuckDuckGo page had no results the app could read.")
            failed.charged = 1
            raise failed
        return Answer(self.name, ddg_region(country, language), depth, results, NOT_CAPTURED, [], 1)

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
            rows = _rows(data.get("organic"), len(found), seen)
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
    items = [{"link": anchor.get("href"), "title": anchor.text_content().strip()} for anchor in anchors]
    return _rows(items, 0, set())


class BrowserBackup:
    name = "Browser on this Mac"
    engines = ("google", "bing", "yandex")
    free_monthly = None
    manual_only = True  # only when ticked in Refresh: never down the automatic order, and never on an upload
    gap_seconds = 20.0  # one keyword at a time, spaced out
    MISSING = "The browser backup needs Playwright, which isn't installed. Install it with: .venv/bin/pip install playwright"
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
            if not rows:
                if not found:
                    raise SearchFailed("The page had no results the app could read.")
                break
            found += [Found(len(found) + i + 1, row.url, row.title) for i, row in enumerate(rows)]
        return Answer(self.name, self.country, depth, found[:depth], NOT_CAPTURED, [], 0)
