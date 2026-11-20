"""What kind of anchor a link has: brand, brand + keyword, bare address, exact keyword, partial keyword, generic, or other.

Brand words are the site's own (Search settings, the brand rules) plus its domain name. Keywords are the site's tracked
keywords. Case, accents and punctuation don't matter. Order matters: an address is an address even when it holds the brand.

An exact-match domain (creer-societe-dubai.fr, with "creer societe dubai" tracked) makes its name a money keyword. An anchor
holding only such a brand is "brand + keyword", never plain Brand: it is the over-optimisation an SEO watches, and it counts
with Exact in any mix (SEO review 2026-11-17, links F8).
"""
from __future__ import annotations

import re
import unicodedata

from sqlalchemy import text

BRAND, BRAND_KW, URL, EXACT, PARTIAL, GENERIC, OTHER = "brand", "brand_kw", "url", "exact", "partial", "generic", "other"
EXACT_LIKE = frozenset({EXACT, BRAND_KW})  # what an anchor mix counts as exact match
GENERIC_WORDS = {
    "click here", "here", "this", "this site", "this website", "website", "site", "link", "this link", "source", "read more", "learn more",
    "more", "more info", "see more", "visit", "visit site", "homepage", "home page", "official site", "this page", "page", "article",
    "ici", "cliquez ici", "cliquer ici", "en savoir plus", "lire la suite", "voir", "voir plus", "ce site", "le site", "lien", "ce lien", "plus", "source", "plus d info",
    "aqui", "haga clic aqui", "mas informacion", "leer mas", "hier", "mehr", "weiterlesen", "hier klicken",
}
_URLISH = re.compile(r"^(https?://|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(/\S*)?$")


_APOSTROPHES = str.maketrans({mark: " " for mark in "\u02bc\u02bb\u02b9\u02bd"})  # letter-like apostrophes (ʼ): isalnum() says yes


def clean(value: str | None) -> str:
    """Lower case, no accents, every mark a space. Marks become spaces *before* the ASCII fold: folding first dropped a
    curly apostrophe (d’entreprise → "dentreprise"), so a French anchor typed in a CMS stopped matching its keyword."""
    decomposed = unicodedata.normalize("NFKD", value or "").translate(_APOSTROPHES)
    letters = "".join(ch if ch.isalnum() else (" " if not unicodedata.combining(ch) else "") for ch in decomposed)
    folded = letters.encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", folded).split())


def words_for_site(conn, site_id: int, host: str) -> tuple[list[str], list[str]]:
    """(brand words, keywords), cleaned."""
    brand = {clean(host.split(".")[0])} | {clean(r[0]) for r in conn.execute(
        text("SELECT pattern FROM site_rules WHERE kind = 'brand' AND (site_id IS NULL OR site_id = :s)"), {"s": site_id})}
    keywords = {clean(r[0]) for r in conn.execute(
        text("SELECT k.keyword FROM site_keywords sk JOIN keywords k ON k.id = sk.keyword_id WHERE sk.site_id = :s"), {"s": site_id})}
    return [b for b in brand if len(b) >= 3], [k for k in keywords if k]


def _holds_keyword(brand: str, keywords: list[str]) -> bool:
    padded = f" {brand} "
    return any(f" {k} " in padded for k in keywords)


def kind(anchor: str | None, brand: list[str], keywords: list[str]) -> str | None:
    raw = (anchor or "").strip()
    if not raw:
        return None
    if _URLISH.match(raw.lower()):
        return URL
    words = clean(raw)
    if not words:
        return None
    padded = f" {words} "
    brands = [b for b in brand if f" {b} " in padded]
    if brands:
        # A brand that holds a tracked keyword is an exact-match name: the anchor is a keyword anchor too.
        if all(_holds_keyword(b, keywords) for b in brands):
            return BRAND_KW
        return BRAND
    if words in keywords:
        return EXACT
    if any(f" {k} " in padded for k in keywords):
        return PARTIAL
    mine = set(words.split())
    for keyword in keywords:
        parts = [w for w in keyword.split() if len(w) > 2]
        if len(parts) >= 2 and sum(w in mine for w in parts) / len(parts) >= 0.6:
            return PARTIAL
    if words in GENERIC_WORDS:
        return GENERIC
    return OTHER
