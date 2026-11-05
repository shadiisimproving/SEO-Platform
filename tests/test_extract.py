"""What we read from a page, and when two versions count as the same."""
from seo.crawl.extract import extract

PAGE = """<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title> Créer une société à Dubaï </title>
  <meta name="description" content="Démarches, coûts et délais.">
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="https://www.example.com/societe/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>
  <script type="application/ld+json">
    {"@graph":[{"@type":"FAQPage"},{"@type":["Organization","LocalBusiness"]}]}
  </script>
  <script type="application/ld+json">{ broken json </script>
  <style>.hidden { color: red }</style>
</head>
<body>
  <nav><a href="/menu">Menu principal</a></nav>
  <main>
    <h1>Créer une société</h1>
    <h2>Les coûts</h2>
    <p>Le coût total dépend de la zone franche choisie.</p>
    <h3>Licence</h3>
    <p>Voir <a href="/licence">la licence</a> et <a href="https://www.example.com/visa">le visa</a>,
       puis <a href="https://gov.ae/guide">le guide officiel</a>.</p>
    <a href="mailto:a@b.c">écrire</a>
    <a href="#haut">haut</a>
    <h4>Détail</h4>
    <h6>Note</h6>
    <script>var ignored = "these words must not count";</script>
  </main>
  <footer>Mentions légales</footer>
</body>
</html>"""


def fields(html=PAGE, url="https://www.example.com/societe/", charset=None):
    body = html.encode("utf-8") if isinstance(html, str) else html
    return extract(body, url, charset=charset)


def test_reads_title_description_canonical_and_robots():
    page = fields()
    assert page.title == "Créer une société à Dubaï"
    assert page.meta_description == "Démarches, coûts et délais."
    assert page.canonical == "https://www.example.com/societe/"
    assert page.robots_meta == "noindex, follow"
    assert page.lang == "fr"


def test_reads_h1_and_every_heading_level_in_order():
    page = fields()
    assert page.h1 == ["Créer une société"]
    assert page.headings == [["h2", "Les coûts"], ["h3", "Licence"], ["h4", "Détail"], ["h6", "Note"]]


def test_schema_types_include_graph_and_lists_and_survive_broken_json():
    assert fields().schema_types == ["Article", "FAQPage", "LocalBusiness", "Organization"]


def test_link_counts_split_internal_and_external_and_skip_non_links():
    page = fields()
    assert page.internal_links == 3  # /menu, /licence, www.example.com/visa
    assert page.external_links == 1  # gov.ae


def test_www_and_bare_domain_count_as_internal():
    html = '<html><body><a href="https://example.com/a">a</a></body></html>'
    page = fields(html, url="https://www.example.com/")
    assert page.internal_links == 1
    assert page.external_links == 0


def test_word_count_is_the_main_content_without_scripts_or_navigation():
    page = fields()
    assert "ignored" not in page.text
    assert "Menu principal" not in page.text
    assert "Mentions légales" not in page.text
    assert page.word_count == len(page.text.split())
    assert 15 < page.word_count < 40


def test_without_main_element_nav_and_footer_are_still_left_out():
    html = "<html><body><nav>navigation words</nav><div>body words here</div><footer>foot</footer></body></html>"
    page = fields(html)
    assert page.text == "body words here"


def test_same_text_with_different_whitespace_gives_the_same_hash():
    one = "<html><body><main><p>Le   coût\n total</p></main></body></html>"
    two = "<html><body><main><p>Le coût total</p></main></body></html>"
    assert fields(one).content_hash == fields(two).content_hash


def test_navigation_change_does_not_count_as_a_content_change():
    # Otherwise one menu edit would flag every page on a competitor's site.
    one = "<html><body><nav>Accueil</nav><main><p>Texte stable</p></main></body></html>"
    two = "<html><body><nav>Accueil Blog</nav><main><p>Texte stable</p></main></body></html>"
    assert fields(one).content_hash == fields(two).content_hash


def test_real_text_change_changes_the_hash():
    one = "<html><body><main><p>Prix 1000 AED</p></main></body></html>"
    two = "<html><body><main><p>Prix 2000 AED</p></main></body></html>"
    assert fields(one).content_hash != fields(two).content_hash


def test_arabic_and_french_survive_without_a_declared_charset():
    html = "<html><body><main><p>تأسيس شركة في دبي — société</p></main></body></html>"
    page = fields(html)
    assert "تأسيس شركة في دبي" in page.text
    assert "société" in page.text


def test_declared_latin1_is_decoded_correctly():
    html = '<html><head><meta charset="iso-8859-1"></head><body><main>société</main></body></html>'
    assert "société" in fields(html.encode("latin-1")).text


def test_header_charset_wins_over_guessing():
    html = "<html><body><main>société</main></body></html>"
    assert "société" in fields(html.encode("latin-1"), charset="iso-8859-1").text


def test_xml_declaration_does_not_break_parsing():
    html = '<?xml version="1.0" encoding="UTF-8"?><html><head><title>Titré</title></head><body>x</body></html>'
    assert fields(html).title == "Titré"


def test_short_page_with_an_app_root_is_flagged_as_javascript_only():
    html = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'
    assert fields(html).js_only is True


def test_ordinary_page_is_not_flagged_as_javascript_only():
    assert fields().js_only is False


def test_short_page_without_app_markers_is_not_flagged():
    assert fields("<html><body><main>Page courte</main></body></html>").js_only is False


def test_empty_and_broken_documents_do_not_raise():
    assert fields(b"").word_count == 0
    assert fields("<<<<not html").title in ("", None)
    assert fields(b"\xff\xfe\x00\x00garbage").word_count >= 0


def test_as_dict_is_json_friendly_and_leaves_out_the_text():
    data = fields().as_dict()
    assert data["title"] == "Créer une société à Dubaï"
    assert "text" not in data
    assert data["word_count"] > 0
