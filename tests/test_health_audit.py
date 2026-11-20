"""The rules of the health test on their own: what counts as a problem, and the score. No database, no network."""
import pytest

from seo.crawl.extract import extract
from seo.crawl.fetch import FetchResult
from seo.health import audit
from seo.links.checker import BROKEN, REDIRECT, SLOW, UNVERIFIED, Issue, ScanResult

START = "https://shop.example/"
TEXT = "An ordinary paragraph of readable text about coffee, how it is roasted and how it gets delivered. " * 3


def page(title="A title", description="A description", h1=("A heading",), text=TEXT, head="", body="", lang="en", charset=None) -> str:
    return (
        f'<!doctype html><html lang="{lang}"><head>' + (f'<meta charset="{charset}">' if charset else "") + f"<title>{title}</title>"
        + (f'<meta name="description" content="{description}">' if description else "") + head + "</head><body><main>"
        + "".join(f"<h1>{h}</h1>" for h in h1) + f"<p>{text}</p>{body}</main></body></html>"
    )


def look(found: audit.Findings, url: str, html: str, final: str | None = None, start: str = START, encoding: str = "utf-8") -> None:
    body = html.encode(encoding)
    result = FetchResult(url=url, status="ok", http_status=200, body=body, final_url=final or url)
    audit.look_at_page(found, url, result, extract(body, final or url), start)


def findings_for(html: str, url: str = "https://shop.example/a", **options) -> dict:
    found = audit.Findings()
    look(found, url, html, **options)
    return audit.finish(found)


# ---- the score ------------------------------------------------------------------------------

def test_nothing_found_is_100():
    assert audit.score({}, [], 10) == 100


SCORED = {code: check for code, check in audit.CHECKS.items() if check[1]}  # robots_blocked is listed, never scored


@pytest.mark.parametrize("code", SCORED)
def test_each_kind_of_problem_lowers_the_score(code):
    assert audit.score({code: ["https://shop.example/a"]}, [], 10) < 100


@pytest.mark.parametrize("code,check", SCORED.items())
def test_a_problem_on_every_page_costs_its_full_weight(code, check):
    urls = [f"https://shop.example/{n}" for n in range(10)]
    assert audit.score({code: urls}, [], 10) == 100 - check[1]


def test_more_pages_with_a_problem_cost_more():
    scores = [audit.score({"broken_pages": [f"u{n}" for n in range(count)]}, [], 100) for count in (1, 10, 50, 100)]
    assert scores == sorted(scores, reverse=True) and len(set(scores)) == 4


def test_a_few_bad_pages_cost_more_than_their_share():
    assert audit.score({"broken_pages": ["u"]}, [], 100) == 97  # 1 % of the pages, 3 points of a possible 28


def test_100_is_kept_for_nothing_found_even_on_a_big_site():
    assert audit.score({"many_h1": ["u"]}, [], 2000) == 99


def test_empty_lists_and_unknown_codes_cost_nothing():
    assert audit.score({"no_title": [], "not_a_check": ["u"]}, [], 10) == 100


@pytest.mark.parametrize("code,check", audit.SITE_CHECKS.items())
def test_a_whole_site_problem_has_its_fixed_cost(code, check):
    assert audit.score({}, [code], 10) == 100 - check[1]
    assert audit.score({}, [code], 1000) == 100 - check[1]


def test_a_whole_site_problem_is_charged_once():
    assert audit.score({}, ["ssl_expiring", "ssl_expiring"], 10) == 85


def test_the_score_is_never_below_zero():
    everything = {code: ["u"] for code in audit.CHECKS}
    assert audit.score(everything, list(audit.SITE_CHECKS), 1) == 0


def test_a_score_needs_no_pages_to_work():
    assert audit.score({}, ["start_page_down"], 0) == 40


# ---- pages the crawl skipped lower nothing ---------------------------------------------------

@pytest.mark.parametrize("status,code", [
    ("blocked", 401), ("blocked", 403), ("blocked", 200), ("rate_limited", 429), ("rate_limited", None),
    ("not_html", 200), ("too_large", 200), ("too_large", 403), ("refused", None), ("left_scope", 301), ("network_error", None),
    ("too_many_redirects", None), ("http_error", 301), ("not_modified", 304),
])
def test_a_page_the_crawl_skipped_lowers_nothing(status, code):
    found = audit.Findings()
    audit.look_at_page(found, "https://shop.example/a", FetchResult(url="https://shop.example/a", status=status, http_status=code), None, START)
    assert found.pages_seen == 0
    assert audit.finish(found) == {}
    assert found.site_codes == []
    assert audit.score({}, found.site_codes, found.pages_seen) == 100


@pytest.mark.parametrize("status,code,check", [
    ("gone", 404, "broken_pages"), ("gone", 410, "broken_pages"), ("http_error", 400, "broken_pages"), ("http_error", 405, "broken_pages"),
    ("server_error", 500, "server_errors"), ("server_error", 502, "server_errors"), ("server_error", 503, "server_errors"),
])
def test_a_page_answering_with_an_error_counts_once(status, code, check):
    found = audit.Findings()
    url = "https://shop.example/a"
    audit.look_at_page(found, url, FetchResult(url=url, status=status, http_status=code, final_url=url), None, START)
    assert found.pages_seen == 1
    assert audit.finish(found) == {check: [url]}
    assert found.site_codes == []


# ---- a page reached by a redirect ---------------------------------------------------------------

def test_a_page_read_directly_then_through_a_redirect_counts_once():
    found = audit.Findings()
    html = page(title="", description="")
    look(found, "https://shop.example/a", html)
    look(found, "https://shop.example/old", html, final="https://shop.example/a")
    assert found.pages_seen == 1
    assert audit.finish(found) == {"no_title": ["https://shop.example/a"], "no_meta": ["https://shop.example/a"]}


def test_a_redirect_is_not_a_duplicate_title_or_meta():
    found = audit.Findings()
    look(found, "https://shop.example/a", page())
    look(found, "https://shop.example/old", page(), final="https://shop.example/a")
    assert audit.finish(found) == {}


def test_problems_are_listed_under_the_address_the_redirect_led_to():
    issues = findings_for(page(title=""), url="https://shop.example/old", final="https://shop.example/a")
    assert issues == {"no_title": ["https://shop.example/a"]}


def test_a_broken_page_reached_directly_and_by_a_redirect_counts_once():
    found = audit.Findings()
    gone = "https://shop.example/gone"
    audit.look_at_page(found, gone, FetchResult(url=gone, status="gone", http_status=404, final_url=gone), None, START)
    audit.look_at_page(found, "https://shop.example/old", FetchResult(url="https://shop.example/old", status="gone", http_status=404, final_url=gone), None, START)
    assert found.pages_seen == 1
    assert audit.finish(found) == {"broken_pages": [gone]}


def test_a_start_page_that_redirects_is_still_the_start_page():
    found = audit.Findings()
    look(found, START, page(head='<meta name="robots" content="noindex">'), final="https://shop.example/fr/")
    assert found.site_codes == ["start_page_noindex"]
    assert audit.finish(found) == {"noindex": ["https://shop.example/fr/"]}


# ---- the start page ------------------------------------------------------------------------------

@pytest.mark.parametrize("status,code", [("gone", 404), ("gone", 410), ("http_error", 400), ("server_error", 500), ("server_error", 503), ("network_error", None), ("refused", None), ("too_many_redirects", None)])
def test_a_start_page_that_does_not_load_is_a_whole_site_problem(status, code):
    found = audit.Findings()
    audit.look_at_page(found, START, FetchResult(url=START, status=status, http_status=code), None, START)
    assert found.site_codes == ["start_page_down"]


@pytest.mark.parametrize("url", ["http://shop.example/", "https://www.shop.example/", "https://shop.example/?utm_source=x"])
def test_any_spelling_of_the_start_page_is_the_start_page(url):
    found = audit.Findings()
    audit.look_at_page(found, url, FetchResult(url=url, status="network_error"), None, START)
    assert found.site_codes == ["start_page_down"]


@pytest.mark.parametrize("status,code", [("blocked", 403), ("blocked", 200), ("rate_limited", 429), ("robots", None), ("left_scope", 301), ("not_html", 200)])
def test_a_start_page_the_crawl_could_not_judge_is_not_called_down(status, code):
    found = audit.Findings()
    audit.look_at_page(found, START, FetchResult(url=START, status=status, http_status=code), None, START)
    assert found.site_codes == []


def test_a_failing_robots_txt_on_the_way_to_the_start_page_is_a_whole_site_problem():
    found = audit.Findings()
    audit.look_at_page(found, START, FetchResult(url=START, status="robots", error="robots.txt answered with a server error"), None, START)
    assert found.site_codes == ["robots_down"]
    assert "robots_down" in audit.SITE_CHECKS


def test_a_page_robots_txt_blocks_is_listed_but_lowers_nothing():
    """Expert review 2026-11-17: a service page hidden by a wrong Disallow line appeared nowhere. It is now listed under
    "Blocked by robots.txt", without lowering the score (blocking /admin is often meant)."""
    found = audit.Findings()
    url = "https://shop.example/services"
    audit.look_at_page(found, url, FetchResult(url=url, status="robots"), None, START)
    audit.look_at_page(found, url, FetchResult(url=url, status="robots"), None, START)
    issues = audit.finish(found)
    assert issues == {"robots_blocked": [url]} and found.pages_seen == 0
    assert audit.score(issues, found.site_codes, 10) == 100
    assert audit.CHECKS["robots_blocked"][2] == audit.INFO


@pytest.mark.parametrize("header,head", [
    ("noindex", ""), ("googlebot: noindex, nofollow", ""), ("none", ""),
    (None, '<meta name="googlebot" content="noindex">'), (None, '<meta name="robots" content="NOINDEX, follow">'),
])
def test_noindex_counts_from_the_header_and_from_a_googlebot_tag(header, head):
    found = audit.Findings()
    url = "https://shop.example/a"
    body = page(head=head).encode()
    audit.look_at_page(found, url, FetchResult(url=url, status="ok", http_status=200, body=body, final_url=url, x_robots_tag=header), extract(body, url), START)
    assert "noindex" in audit.finish(found)


@pytest.mark.parametrize("header,head", [("bingbot: noindex", ""), ("max-snippet: 50", ""), (None, '<meta name="bingbot" content="noindex">')])
def test_a_rule_for_another_crawler_is_not_noindex(header, head):
    found = audit.Findings()
    url = "https://shop.example/a"
    body = page(head=head).encode()
    audit.look_at_page(found, url, FetchResult(url=url, status="ok", http_status=200, body=body, final_url=url, x_robots_tag=header), extract(body, url), START)
    assert "noindex" not in audit.finish(found)


def test_a_failing_robots_txt_elsewhere_lowers_nothing():
    found = audit.Findings()
    url = "https://shop.example/a"
    audit.look_at_page(found, url, FetchResult(url=url, status="robots", error="robots.txt answered with a server error"), None, START)
    assert found.site_codes == [] and found.pages_seen == 0


def test_a_broken_page_that_is_not_the_start_page_is_not_a_whole_site_problem():
    found = audit.Findings()
    url = "https://shop.example/a"
    audit.look_at_page(found, url, FetchResult(url=url, status="server_error", http_status=500), None, START)
    assert found.site_codes == []


# ---- what is read from a page ----------------------------------------------------------------

def test_a_good_page_has_no_problems():
    found = audit.Findings()
    look(found, "https://shop.example/a", page())
    assert found.pages_seen == 1
    assert audit.finish(found) == {}


@pytest.mark.parametrize("content,hidden", [
    ("noindex", True), ("NOINDEX, follow", True), ("follow,noindex", True), ("none", True), ("nofollow, none", True),
    ("index, follow", False), ("nofollow", False), ("", False),
])
def test_noindex(content, hidden):
    issues = findings_for(page(head=f'<meta name="robots" content="{content}">'))
    assert ("noindex" in issues) is hidden


def test_noindex_on_the_start_page_is_a_whole_site_problem():
    found = audit.Findings()
    look(found, START, page(head='<meta name="robots" content="noindex">'))
    assert found.site_codes == ["start_page_noindex"]


def test_noindex_elsewhere_is_not_a_whole_site_problem():
    found = audit.Findings()
    look(found, "https://shop.example/a", page(head='<meta name="robots" content="noindex">'))
    assert found.site_codes == []


@pytest.mark.parametrize("canonical", [
    "https://shop.example/a", "http://shop.example/a", "https://www.shop.example/a", "https://shop.example/a?utm_source=x", "https://shop.example/a#top",
    "/a", "a", "//shop.example/a", "", "http://[broken", "mailto:someone@shop.example",
])
def test_a_canonical_pointing_at_the_page_itself_is_fine(canonical):
    assert findings_for(page(head=f'<link rel="canonical" href="{canonical}">')) == {}


@pytest.mark.parametrize("canonical", ["https://shop.example/b", "/b", "b", "https://other.example/a", "https://shop.example/a?page=2"])
def test_a_canonical_pointing_elsewhere_is_found(canonical):
    assert findings_for(page(head=f'<link rel="canonical" href="{canonical}">')) == {"canonical_elsewhere": ["https://shop.example/a"]}


def test_a_canonical_is_compared_with_where_the_redirect_landed():
    assert findings_for(page(head='<link rel="canonical" href="https://shop.example/a">'), url="https://shop.example/old", final="https://shop.example/a") == {}


@pytest.mark.parametrize("title", ["", "   ", "　", "\xa0\n"])
def test_no_title(title):
    assert findings_for(page(title=title)) == {"no_title": ["https://shop.example/a"]}


def test_a_page_with_no_title_tag_at_all():
    html = '<html><head><meta name="description" content="d"></head><body><main><h1>h</h1><p>' + TEXT + "</p></main></body></html>"
    assert findings_for(html) == {"no_title": ["https://shop.example/a"]}


def test_no_meta_description():
    assert findings_for(page(description="")) == {"no_meta": ["https://shop.example/a"]}


def test_no_h1_and_many_h1():
    assert findings_for(page(h1=())) == {"no_h1": ["https://shop.example/a"]}
    assert findings_for(page(h1=("One", "Two"))) == {"many_h1": ["https://shop.example/a"]}


def test_images_without_alt():
    assert findings_for(page(body='<img src="a.png" alt="Beans">')) == {}
    assert findings_for(page(body='<img src="a.png">')) == {"images_no_alt": ["https://shop.example/a"]}


def test_almost_no_text():
    assert findings_for(page(text="Hello.")) == {"almost_no_text": ["https://shop.example/a"]}
    assert findings_for(page(text=TEXT)) == {}


def test_an_empty_page_has_every_page_level_problem_and_still_counts_as_seen():
    found = audit.Findings()
    audit.look_at_page(found, "https://shop.example/a", FetchResult(url="https://shop.example/a", status="ok", http_status=200, body=b"", final_url="https://shop.example/a"), extract(b"", "https://shop.example/a"), START)
    assert found.pages_seen == 1
    assert set(audit.finish(found)) == {"no_title", "no_meta", "no_h1", "almost_no_text"}


def test_duplicate_titles_and_metas_ignore_case_and_list_every_page():
    found = audit.Findings()
    look(found, "https://shop.example/a", page(title="Coffee", description="Fresh"))
    look(found, "https://shop.example/b", page(title="COFFEE", description="FRESH"))
    look(found, "https://shop.example/c", page(title="coffee", description="fresh"))
    look(found, "https://shop.example/d", page(title="Tea", description="Green"))
    pages = ["https://shop.example/a", "https://shop.example/b", "https://shop.example/c"]
    assert audit.finish(found) == {"duplicate_title": pages, "duplicate_meta": pages}


def test_finish_lists_each_page_once():
    found = audit.Findings()
    found.add("broken_links", "https://shop.example/a")
    found.add("broken_links", "https://shop.example/a")
    assert audit.finish(found) == {"broken_links": ["https://shop.example/a"]}


# ---- what the links part of the scan adds -----------------------------------------------------

def on_site(url: str) -> bool:
    return url.startswith("https://shop.example/")


def results(*issues) -> dict:
    found = audit.Findings()
    audit.add_link_results(found, ScanResult(issues=list(issues)), on_site)
    return audit.finish(found)


def test_broken_links_counts_pages_not_links():
    first = Issue(BROKEN, "https://shop.example/x", 404, "Page not found", pages=["https://shop.example/a", "https://shop.example/b"])
    second = Issue(BROKEN, "https://shop.example/y", 404, "Page not found", pages=["https://shop.example/a"])
    assert results(first, second) == {"broken_links": ["https://shop.example/a", "https://shop.example/b"]}


def test_a_broken_start_page_has_no_page_containing_the_link():
    assert results(Issue(BROKEN, "https://shop.example/", 404, "Page not found", pages=[])) == {}


def test_a_broken_link_is_counted_on_every_page_even_past_the_listing_limit():
    pages = [f"https://shop.example/{n}" for n in range(audit.MAX_PAGES_LISTED + 50)]
    assert len(results(Issue(BROKEN, "https://shop.example/x", 404, "Page not found", pages=pages))["broken_links"]) == audit.MAX_PAGES_LISTED + 50


@pytest.mark.parametrize("category", [BROKEN, REDIRECT, SLOW, UNVERIFIED])
def test_addresses_on_other_websites_never_appear(category):
    issue = Issue(category, "https://far.example/x", 404, "No", hops=4, seconds=9.0, pages=["https://shop.example/a"])
    assert results(issue) == {}


def test_only_more_than_two_redirects_is_a_chain():
    assert results(Issue(REDIRECT, "https://shop.example/x", 301, "3 redirects", hops=3)) == {"redirect_chains": ["https://shop.example/x"]}
    assert results(Issue(REDIRECT, "https://shop.example/x", 301, "too many", hops=6)) == {"redirect_chains": ["https://shop.example/x"]}


def test_one_redirect_to_another_website_is_not_a_chain():
    assert results(Issue(REDIRECT, "https://shop.example/x", 302, "Redirects to another website", hops=1, final_url="https://far.example/")) == {}


def test_slow_pages_and_unverified_links():
    assert results(Issue(SLOW, "https://shop.example/x", 200, "Took 6 s", seconds=6.0)) == {"slow_pages": ["https://shop.example/x"]}
    assert results(Issue(UNVERIFIED, "https://shop.example/x", 403, "Blocked by site", pages=["https://shop.example/a"])) == {}


# ---- any language -----------------------------------------------------------------------------

FRENCH = "Votre café torréfié livré chaque mois à votre porte, sans engagement. Choisissez votre mouture, changez quand vous voulez et découvrez de nouvelles origines toute l'année."
ARABIC = "قهوة طازجة مختصة تصلك كل شهر إلى باب منزلك من دون أي التزام. اختر الطحن الذي تفضله وغيّره متى شئت واكتشف مصادر جديدة على مدار العام مع محمصتنا المحلية."
JAPANESE = "毎月、焙煎したてのコーヒーをご自宅へお届けします。挽き方はいつでも変更でき、一年を通じて新しい産地をお楽しみいただけます。"
CHINESE = "每个月把新鲜烘焙的咖啡送到您家门口。您可以随时更改研磨方式，全年都能品尝到来自不同产地的咖啡。"
THAI = "กาแฟคั่วสดส่งถึงบ้านคุณทุกเดือนโดยไม่มีข้อผูกมัด เลือกระดับการบดที่คุณชอบและเปลี่ยนได้ตลอดเวลา พร้อมค้นพบแหล่งปลูกใหม่ตลอดทั้งปีจากโรงคั่วของเรา ไม่ว่าคุณจะชอบกาแฟแบบไหนเราก็มีให้เลือกมากมาย ทั้งคั่วอ่อน คั่วกลาง และคั่วเข้ม พร้อมคำแนะนำการชงจากทีมงานของเรา"


@pytest.mark.parametrize("lang,title,description,heading,text", [
    ("fr", "Abonnement café", "Votre café livré chaque mois.", "Abonnement café", FRENCH * 2),
    ("ar", "قهوة مختصة", "قهوة طازجة تصلك كل شهر.", "قهوة مختصة", ARABIC * 2),
    ("ja", "コーヒー定期便", "毎月新鮮なコーヒーをお届けします。", "コーヒー定期便", JAPANESE),
    ("zh", "咖啡订阅", "每月新鲜咖啡送到家。", "咖啡订阅", CHINESE * 2),
    ("th", "กาแฟสด", "กาแฟคั่วสดส่งถึงบ้าน", "กาแฟสด", THAI),
])
def test_an_ordinary_page_in_any_language_has_no_problems(lang, title, description, heading, text):
    assert findings_for(page(title, description, (heading,), text, lang=lang)) == {}


@pytest.mark.parametrize("lang,title,text,encoding", [
    ("fr", "Café moulu", FRENCH * 2, "iso-8859-1"),
    ("ar", "قهوة", ARABIC * 2, "windows-1256"),
    ("ja", "コーヒー", JAPANESE, "shift_jis"),
    ("ja", "コーヒー", JAPANESE, "euc-jp"),
])
def test_old_encodings_give_the_same_answer(lang, title, text, encoding):
    html = page(title, title, (title,), text, lang=lang, charset=encoding)
    assert findings_for(html, encoding=encoding) == {}


@pytest.mark.parametrize("lang,title,text", [("fr", "Café", "Bonjour."), ("ar", "قهوة", "مرحبا بكم."), ("ja", "コーヒー", "ようこそ。"), ("zh", "咖啡", "欢迎。"), ("th", "กาแฟ", "ยินดีต้อนรับ")])
def test_a_nearly_empty_page_is_found_in_any_language(lang, title, text):
    assert findings_for(page(title, title, (title,), text, lang=lang)) == {"almost_no_text": ["https://shop.example/a"]}


@pytest.mark.parametrize("lang,title", [("en", "Coffee"), ("fr", "Café"), ("ar", "قهوة"), ("ja", "コーヒー")])
def test_structure_problems_read_the_same_in_any_language(lang, title):
    found = audit.Findings()
    look(found, "https://shop.example/a", page(title, title, (), TEXT, lang=lang))
    look(found, "https://shop.example/b", page(title, title, (title, title), TEXT, lang=lang))
    assert audit.finish(found) == {
        "no_h1": ["https://shop.example/a"], "many_h1": ["https://shop.example/b"],
        "duplicate_title": ["https://shop.example/a", "https://shop.example/b"], "duplicate_meta": ["https://shop.example/a", "https://shop.example/b"],
    }


@pytest.mark.parametrize("address,canonical", [
    ("https://shop.example/قهوة", "https://shop.example/%D9%82%D9%87%D9%88%D8%A9"),
    ("https://shop.example/%D9%82%D9%87%D9%88%D8%A9", "https://shop.example/قهوة"),
    ("https://shop.example/%d9%82%d9%87%d9%88%d8%a9", "https://shop.example/%D9%82%D9%87%D9%88%D8%A9"),
    ("https://shop.example/コーヒー", "/%E3%82%B3%E3%83%BC%E3%83%92%E3%83%BC"),
    ("https://shop.example/caf%C3%A9", "https://shop.example/café"),
])
def test_a_non_latin_address_and_its_percent_spelling_are_the_same_page(address, canonical):
    assert findings_for(page(head=f'<link rel="canonical" href="{canonical}">'), url=address) == {}
