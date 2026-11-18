"""Last rankings and links fixes before the deploy (accuracy/final-rankings-links.md, 2026-11-18).

Every expected number is worked out by hand in the test. The sites are made up (.example): real data stays in the live database.
"""
from seo.backlinks import anchors


# ---- 5. a curly apostrophe or a non-breaking space never changes an anchor's kind ------------------------------------


def test_curly_quotes_and_non_breaking_spaces_fold_before_matching():
    keywords = [anchors.clean("création d'entreprise à dubaï")]
    assert keywords == ["creation d entreprise a dubai"]
    assert anchors.clean("création d’entreprise à Dubai") == "creation d entreprise a dubai"
    for mark in ("’", "‘", "ʼ", "'"):
        assert anchors.kind(f"création d{mark}entreprise à Dubai", [], keywords) == anchors.EXACT
    assert anchors.clean("“créer société dubai”") == "creer societe dubai"
    assert anchors.kind("“créer société dubai”", [], ["creer societe dubai"]) == anchors.EXACT
