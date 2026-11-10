"""Words in searches, for the detectors that read them: question searches (C8), topics (C9) and "no page of its own" (C7).

Plain rules, no language model: accents and case folded, very short words and the commonest little words left out, a
trailing plural s or x dropped. Good enough to group "créer société séville" with "creer societe seville".
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import unquote, urlsplit

STOPWORDS = frozenset("""
a an and are as at be by can de do does for from how i in is it le la les of on or the to un une des du et en est
what when where which who why will with you your au aux ce ces dans par pour sur son sa ses que qui quoi quel quelle quels quelles
comment pourquoi combien quand ou il elle on nous vous ils mon ma mes ton ta tes leur leurs pas plus avec sans etre avoir faire
el los las y con por para como que del al se es una unos unas der die das und mit fur von zu ist ein eine
vs best top meilleur meilleure prix price cost cout 2024 2025 2026 2027
""".split())

# Words that make a search a question, folded. The first word, or anywhere for the ones that rarely mean anything else.
QUESTION_START = frozenset("""
how what why when where which who whom whose can could should would is are does do did will
comment pourquoi quel quelle quels quelles quoi combien quand qui peut peuton fautil estce est
como que porque cuanto cuanta cuantos cuando donde cual quien
wie was warum wann wo welche welcher kann
""".split())
QUESTION_ANYWHERE = ("how much", "how many", "how to", "est ce que", "est-ce que", "qu est ce", "qu'est-ce", "combien coute", "faut il", "peut on")

_WORD = re.compile(r"[\w]+", re.UNICODE)


def fold(value: str) -> str:
    text = unicodedata.normalize("NFKD", (value or "").casefold().replace("œ", "oe").replace("æ", "ae"))
    return "".join(c for c in text if not unicodedata.combining(c))


def stem(word: str) -> str:
    """A trailing plural s or x off a word long enough to have one: "societes" → "societe", "prix" stays (a stopword anyway)."""
    return word[:-1] if len(word) > 4 and word[-1] in "sx" else word


def tokens(value: str) -> list[str]:
    """The words that carry meaning, folded and stemmed, in order, each once."""
    seen, out = set(), []
    for word in _WORD.findall(fold(value).replace("_", " ")):
        if len(word) < 3 or word in STOPWORDS or word.isdigit():
            continue
        word = stem(word)
        if word not in seen:
            seen.add(word)
            out.append(word)
    return out


def is_question(query: str) -> bool:
    folded = fold(query).strip()
    if folded.endswith("?"):
        return True
    flat = folded.replace("-", " ").replace("'", " ")
    if any(phrase.replace("-", " ").replace("'", " ") in flat for phrase in QUESTION_ANYWHERE):
        return True
    first = _WORD.findall(flat)
    return bool(first) and first[0] in QUESTION_START


def page_words(url: str, title: str | None = None) -> set[str]:
    """The words of a page's address and title, as a search would use them."""
    path = unquote(urlsplit(url or "").path or "")
    return set(tokens(re.sub(r"[/\-_.]+", " ", path))) | set(tokens(title or ""))


def is_home(url: str) -> bool:
    path = urlsplit(url or "").path or "/"
    return path.strip("/") in ("", "index.html", "index.php", "fr", "en", "es", "de", "ar")


PREFIX = 5  # "comptable" and "comptabilite", "creation" and "creations": the same word for a page's subject


def same(a: str, b: str) -> bool:
    return a == b or (len(a) >= PREFIX and len(b) >= PREFIX and a[:PREFIX] == b[:PREFIX])


def share(these, those) -> bool:
    """Whether two lists of words have one in common, the same word written two ways counting as one."""
    return any(same(a, b) for a in these for b in those)
