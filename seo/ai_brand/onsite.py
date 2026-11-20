""""On your site?": does the owner's own site say what the AIs say about the company?

Every point the AIs make (a strength, a weak point, an argument in a head-to-head answer) gets one mark:

- said    ✓  a page of the site says it;
- hinted  ◐  a page touches on it, but doesn't quite say it;
- missing ✗  no page says it.

The texts are the site's own pages as the app last read them (pages + page_versions: what Refresh data and the nightly read
fill). Nothing is fetched here.

How a mark is found:

1. Word match, always, and the only check when no AI is chosen in Settings → AI (or the AI refuses, or the monthly cap is
   reached). The point's words are folded (case, accents), common words and the company's own name are dropped, and each
   word is cut to its first 5 letters so "livré" finds "livrée" and "prices" finds "price". A page's score is the share of
   the point's words found on it. The best page wins.
     - said:    the whole point is on the page word for word, or the score is at least SAID_AT (0.75) with 2 words or more;
     - hinted:  the score is at least HINT_AT (0.4);
     - missing: below that, or no page was read.
2. AI, when one is chosen: one request for up to BATCH points, each sent with its 3 best pages by word match (title and the
   passage that matches best). The AI's mark replaces the word match; its page must be one of those 3. A point with no
   candidate page is missing without asking.

The result is kept with the run (brand_runs.onsite), so a run is never checked twice unless the owner asks again.
"""
from __future__ import annotations

import gzip
import re
from datetime import datetime, timezone

from sqlalchemy import Engine, text

from seo.competitors.pages import words_of
from seo.core.errors import Refused

SAID_AT = 0.75
HINT_AT = 0.4
STEM = 5
MAX_PAGES = 400
MAX_TEXT = 60_000  # characters of one page kept for the check
BATCH = 30
CANDIDATES = 3
EXCERPT = 420
MARKS = ("said", "hinted", "missing")

STOP = set("""
a an and are as at be been being but by can could do does for from had has have how in into is it its just more most much no
not of on only or our out over so some such than that the their them then there these they this those to too under up very
was we were what when where which while who why will with would you your yours also about after again all any because before
between both each few further here off once other own same should through until via well yet often sometimes very really
au aux avec ce ces cet cette dans de des du elle elles en est et eux il ils je la le les leur leurs lui ma mais me meme mes
moi mon ne nos notre nous on ou par pas pour qu que qui sa sans se ses son sur ta te tes toi ton tu un une vos votre vous
tres plus moins aussi bien tout tous toute toutes etre avoir fait faire sont ont peu peut parfois souvent comme dont chez
ainsi alors donc car cela ceci celle celui ici la-bas sous entre vers selon lors avant apres encore deja toujours jamais
""".split())


def stems(words: str, drop: set[str] = frozenset()) -> list[str]:
    """The words of a point that carry its meaning, each cut to its first STEM letters."""
    out = []
    for word in words_of(words):
        if word in STOP or word in drop or (len(word) < 3 and not word.isdigit()):
            continue
        cut = word[:STEM]
        if cut not in out:
            out.append(cut)
    return out


def name_words(*names: str) -> set[str]:
    """The company's (and the competitor's) own words, left out of the match: every page of the site names the company."""
    found: set[str] = set()
    for name in names:
        for word in words_of(name or ""):
            found.add(word)
            found.add(word[:STEM])
    return found


# ---- the site's pages -------------------------------------------------------------------------------------------------

def site_pages(conn, host: str) -> list[dict]:
    """The site's pages the app has read, with their latest text: {url, title, text, stems, read_at}."""
    rows = conn.execute(
        text(
            "SELECT p.id, p.url, p.title, p.meta_description, p.headings, p.last_checked_at, "
            "(SELECT v.text_gz FROM page_versions v WHERE v.page_id = p.id ORDER BY v.id DESC LIMIT 1) AS text_gz "
            "FROM pages p JOIN domains d ON d.id = p.domain_id WHERE d.host IN (:h, :w) AND p.content_hash IS NOT NULL "
            "AND (p.http_status IS NULL OR p.http_status < 400) ORDER BY p.id LIMIT :n"
        ),
        {"h": host, "w": f"www.{host}", "n": MAX_PAGES},
    ).mappings().all()
    out = []
    for row in rows:
        body = gzip.decompress(row["text_gz"]).decode("utf-8", "replace")[:MAX_TEXT] if row["text_gz"] else ""
        whole = " ".join(x for x in (row["title"] or "", row["meta_description"] or "", body) if x)
        if not whole.strip():
            continue
        words = words_of(whole)
        out.append({"url": row["url"], "title": row["title"] or "", "text": whole, "flat": f" {' '.join(words)} ", "stems": {w[:STEM] for w in words},
                    "read_at": row["last_checked_at"]})
    return out


# ---- word match -------------------------------------------------------------------------------------------------------

def _score(point_stems: list[str], page: dict) -> tuple[float, int]:
    found = sum(1 for s in point_stems if s in page["stems"])
    return (found / len(point_stems) if point_stems else 0.0), found


def ranked_pages(point: str, pages: list[dict], drop: set[str]) -> list[tuple[float, int, dict, bool]]:
    """Pages by how much of the point they hold: (score, words found, page, word for word)."""
    wanted = stems(point, drop)
    whole = words_of(point)
    needle = f" {' '.join(whole)} "
    ranked = []
    for page in pages:
        exact = len(whole) >= 2 and needle in page.get("flat", "")
        score, found = (1.0, len(wanted)) if exact else _score(wanted, page)
        if score > 0:
            ranked.append((score, found, page, exact))
    ranked.sort(key=lambda x: (-x[0], not x[3], len(x[2]["url"]), x[2]["url"]))
    return ranked


def mark_of(score: float, found: int, exact: bool) -> str:
    if exact or (score >= SAID_AT and found >= 2):
        return "said"
    if score >= HINT_AT and found >= 1:
        return "hinted"
    return "missing"


def by_words(point: str, pages: list[dict], drop: set[str]) -> dict:
    """The word-match mark of one point, and its best page."""
    if not stems(point, drop):
        return {"mark": "missing", "url": None, "score": 0.0, "by": "words"}
    ranked = ranked_pages(point, pages, drop)
    if not ranked:
        return {"mark": "missing", "url": None, "score": 0.0, "by": "words"}
    score, found, page, exact = ranked[0]
    mark = mark_of(score, found, exact)
    return {"mark": mark, "url": page["url"] if mark != "missing" else None, "score": round(score, 2), "by": "words"}


def excerpt(page: dict, point: str, drop: set[str]) -> str:
    """The passage of the page that holds most of the point's words, about EXCERPT characters."""
    wanted = set(stems(point, drop))
    parts = re.split(r"(?<=[.!?…])\s+|\n+", page["text"])
    best, best_n = "", -1
    for n in range(len(parts)):
        window = " ".join(parts[n:n + 3])[:EXCERPT]
        hits = len(wanted & {w[:STEM] for w in words_of(window)})
        if hits > best_n:
            best, best_n = window, hits
    return best[:EXCERPT]


# ---- checking a list of points ---------------------------------------------------------------------------------------------

def check(engine: Engine, site_id: int, host: str, points: dict[str, str], names: tuple[str, ...], lang: str = "en", use_ai: bool = True) -> dict:
    """Marks for {key: point}. Returns {"pages": n, "by": "ai" | "words", "note": str | None, "points": {key: {mark, url, score, by}}}."""
    from seo.extras import ai

    with engine.connect() as conn:
        pages = site_pages(conn, host)
    drop = name_words(*names)
    found = {key: by_words(point, pages, drop) for key, point in points.items()}
    result = {"pages": len(pages), "by": "words", "note": None, "points": found, "at": datetime.now(timezone.utc).isoformat()}
    if not pages or not use_ai or ai.provider_of(engine, site_id) not in ("openrouter", "claude"):
        return result
    asked = []
    for key, point in points.items():
        ranked = ranked_pages(point, pages, drop)[:CANDIDATES]
        if ranked:
            asked.append({"key": key, "point": point, "pages": [{"url": r[2]["url"], "title": r[2]["title"], "excerpt": excerpt(r[2], point, drop)} for r in ranked]})
    used_ai = False
    for start in range(0, len(asked), BATCH):
        part = asked[start:start + BATCH]
        try:
            marks = ai.check_points_on_site(engine, site_id, [{"point": x["point"], "pages": x["pages"]} for x in part], lang)
        except Refused as exc:
            result["note"] = str(exc)
            break
        used_ai = True
        for n, item in enumerate(part):
            got = marks.get(n)
            if not got:
                continue
            page = item["pages"][got["page"]]["url"] if got.get("page") is not None and got["page"] < len(item["pages"]) else None
            words = found[item["key"]]
            found[item["key"]] = {"mark": got["mark"], "url": (page or words["url"] or item["pages"][0]["url"]) if got["mark"] != "missing" else None,
                                  "score": words["score"], "by": "ai"}
    if used_ai:
        result["by"] = "ai"
    return result


def counts(marks: list[str | None]) -> dict:
    return {m: sum(1 for x in marks if x == m) for m in MARKS}
