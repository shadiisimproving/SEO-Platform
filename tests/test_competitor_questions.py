"""The questions on a competitor's profile: listing pages left out, questions grouped by page, my topics first."""
from collections import Counter

import pytest

from seo.competitors import insights
from seo.insights import words


def page(url, h1, questions, title=None):
    return {"url": url, "title": title or h1, "headings": [["h1", h1]] + [["h2", q] for q in questions], "extras": {"questions": questions}}


@pytest.fixture
def topics(monkeypatch):
    """My site's words, as Search Console would give them: company setup in a city."""
    def fake(conn, site_id, mine):
        counts = Counter()
        for q in ["creer societe ville", "creation societe ville prix", "licence commerciale ville", "visa investisseur ville", "licence freezone ville", "visa resident ville"]:
            counts.update(set(words.tokens(q)))
        return counts
    monkeypatch.setattr(insights, "_topic_counts", fake)


@pytest.mark.parametrize("url, listing", [
    ("https://rival.example/author/admin/", True),
    ("https://rival.example/tag/visa/", True),
    ("https://rival.example/category/guides/page/2/", True),
    ("https://rival.example/2024/05/", True),
    ("https://rival.example/?s=visa", True),
    ("https://rival.example/", True),
    ("https://rival.example/visa-guide/", False),
    ("https://rival.example/blog/authority-of-a-page/", False),
])
def test_listing_pages(url, listing):
    assert insights._is_listing(url) is listing


def test_listing_questions_move_to_their_own_page_or_go(topics):
    theirs = [
        page("https://rival.example/author/admin/", "Admin", ["Comment créer une société à Ville ?", "Où dormir à Ville ?"]),
        page("https://rival.example/creer-societe/", "Comment créer une société à Ville ?", ["Quel prix pour une licence commerciale ?"]),
    ]
    out = insights._questions(None, 1, theirs, [])
    urls = {g["url"]: g for g in out["groups"]}
    assert "https://rival.example/author/admin/" not in urls
    # The author page's teaser is the other page's own title: it lands there, as the row's name, not repeated as a question.
    mine = urls["https://rival.example/creer-societe/"]
    assert mine["title"] == "Comment créer une société à Ville ?"
    assert mine["questions"] == ["Quel prix pour une licence commerciale ?"]
    assert out["dropped"] == 1  # "Où dormir" has no page of its own that was read


def test_my_topics_come_first_and_the_rest_fold(topics):
    theirs = [page(f"https://rival.example/tourisme-{i}/", f"Tourisme {i}", [f"Où dormir à Ville quartier {i} ?", f"Que manger à Ville {i} ?"]) for i in range(6)]
    theirs.append(page("https://rival.example/visa/", "Visa", ["Combien coûte un visa investisseur à Ville ?", "Où manger près du consulat ?"]))
    out = insights._questions(None, 1, theirs, [])
    assert out["judged"] is True
    first = out["groups"][0]
    assert first["url"] == "https://rival.example/visa/" and first["related"]
    assert first["questions"] == ["Combien coûte un visa investisseur à Ville ?"]
    assert first["other"] == ["Où manger près du consulat ?"]
    assert out["related"] == 1
    assert not any(g["related"] for g in out["groups"][1:])


def test_a_word_in_most_of_their_questions_is_not_a_match(topics):
    # "ville" is in my searches, but it's in every question of theirs: it's their whole site's subject.
    theirs = [page(f"https://rival.example/p{i}/", f"Page {i}", [f"Que voir à Ville numéro {i} ?"]) for i in range(12)]
    out = insights._questions(None, 1, theirs, [])
    assert out["related"] == 0
    assert not any(g["related"] for g in out["groups"])


def test_a_question_i_already_ask_is_left_out(topics):
    theirs = [page("https://rival.example/visa/", "Visa", ["Combien coûte un visa investisseur ?"])]
    mine = [page("https://me.example/visa/", "Visa", ["Combien coute un visa investisseur ?"])]
    assert insights._questions(None, 1, theirs, mine)["groups"] == []


def test_without_my_topics_nothing_is_judged(monkeypatch):
    monkeypatch.setattr(insights, "_topic_counts", lambda conn, site_id, mine: Counter())
    theirs = [page("https://rival.example/visa/", "Visa", ["Combien coûte un visa ?", "Qui peut le demander ?"])]
    out = insights._questions(None, 1, theirs, [])
    assert out["judged"] is False
    assert out["groups"][0]["questions"] == ["Combien coûte un visa ?", "Qui peut le demander ?"]


def test_a_page_that_answers_one_question_keeps_it(topics):
    theirs = [page("https://rival.example/visa-investisseur/", "Comment obtenir un visa investisseur ?", ["Comment obtenir un visa investisseur ?"])]
    out = insights._questions(None, 1, theirs, [])
    assert out["groups"][0]["questions"] == ["Comment obtenir un visa investisseur ?"]


class _NoPairs:
    """A connection with the given rows in page_pairs."""
    def __init__(self, rows=()):
        self.rows = list(rows)

    def execute(self, *_):
        rows = self.rows

        class Result:
            def mappings(self):
                return rows
        return Result()


def group(url, title):
    return {"url": url, "title": title, "questions": ["Une question ?"], "other": [], "related": True, "score": 1}


MY_VISA = page("https://mine.example/visa-investisseur/", "Visa investisseur à Ville", ["Quel prix pour ce visa ?", "Qui peut le demander ?"])
MY_PRICE = page("https://mine.example/prix/", "Tarifs comptables", ["Combien ça coûte ?"])


def test_a_saved_pair_wins_and_brings_my_questions():
    groups = [group("https://rival.example/a/", "Tout autre sujet")]
    conn = _NoPairs([{"my_url": MY_PRICE["url"], "their_url": "https://rival.example/a/"}])
    best = [{"url": "https://rival.example/a/", "my_url": MY_VISA["url"]}]
    insights._attach_my_pages(conn, 1, 2, groups, best, [MY_VISA, MY_PRICE])
    mine = groups[0]["mine"]
    assert (mine["url"], mine["how"], mine["read"]) == (MY_PRICE["url"], "paired", True)
    assert mine["questions"] == ["Combien ça coûte ?"]


def test_same_keyword_comes_before_a_guess():
    groups = [group("https://rival.example/a/", "Visa investisseur à Ville")]
    insights._attach_my_pages(_NoPairs(), 1, 2, groups, [{"url": "https://rival.example/a/", "my_url": MY_PRICE["url"]}], [MY_VISA, MY_PRICE])
    assert (groups[0]["mine"]["url"], groups[0]["mine"]["how"]) == (MY_PRICE["url"], "keyword")


def test_closest_heading_needs_two_shared_words_and_says_it_is_a_guess():
    close, loose = group("https://rival.example/a/", "Obtenir un visa investisseur"), group("https://rival.example/b/", "Visa touristique pour enfants")
    insights._attach_my_pages(_NoPairs(), 1, 2, [close, loose], [], [MY_VISA, MY_PRICE])
    assert (close["mine"]["url"], close["mine"]["how"]) == (MY_VISA["url"], "topic")
    assert loose["mine"] is None


def test_a_compared_page_not_read_yet_says_so():
    groups = [group("https://rival.example/a/", "Sujet")]
    insights._attach_my_pages(_NoPairs([{"my_url": "https://mine.example/unread/", "their_url": "https://rival.example/a/"}]), 1, 2, groups, [], [MY_VISA])
    assert groups[0]["mine"] == {"url": "https://mine.example/unread/", "how": "paired", "read": False, "title": None, "questions": []}
