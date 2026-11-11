"""Link gaps flag spam first, never removing it, and only good domains can be added. Common Crawl is read from small files made here."""
import gzip

import httpx
import pytest
from sqlalchemy import text

from seo.competitors import commoncrawl as cc
from seo.competitors import gaps, quality, suggest
from seo.crawl.extract import extract
from seo.crawl.fetch import FetchResult, PoliteFetcher
from seo.links import service as links
from seo.worker.runner import tick

ALLOW = lambda url: True  # noqa: E731
LONG_TEXT = " ".join(["A real article about coffee beans and how they are roasted."] * 12)


def page(title="Coffee news", body=LONG_TEXT, extra=""):
    return f'<html><head><title>{title}</title>{extra}</head><body><main><h1>{title}</h1><p>{body}</p></main></body></html>'


HOME_PAGES = {
    "fine.example": page(),
    "parked.example": page("parked.example", "This domain is for sale. Buy this domain today. " * 8),
    "gamble.example": page("Best online casino bonus", "Play now. " * 60),
    "kasino-ru.example": page("Лучшее казино онлайн", "Играть сейчас. " * 60),
    "empty.example": page("Hello", "Hi."),
    "hidden.example": page(extra='<meta name="robots" content="noindex">'),
    "farm.example": page(body=LONG_TEXT + "".join(f'<a href="https://site{i}.example/">x</a>' for i in range(250))),
    "arabic.example": page("قهوة طازجة", "قهوة طازجة تصلك كل شهر من أفضل المزارع. " * 30),
    "japanese.example": page("コーヒー豆の専門店", "新鮮なコーヒー豆を毎月お届けします。" * 40),
}


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    sites = dict(HOME_PAGES)

    def internet(request):
        host = request.url.host.removeprefix("www.")
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if host == "moved.example":
            return httpx.Response(301, headers={"location": "https://elsewhere.example/"})
        if host == "shy.example":
            return httpx.Response(403, text="no")
        if host == "down.example":
            raise httpx.ConnectError("no answer")
        found = sites.get(host)
        return httpx.Response(200, html=found) if found else httpx.Response(404, text="nope")

    monkeypatch.setattr(links, "fetcher_factory", lambda: PoliteFetcher(delay=0, is_allowed=ALLOW, transport=httpx.MockTransport(internet)))

    class World:
        pass

    w = World()
    w.engine = engine
    w.own = links.add_site(engine, "https://me.example/", "own", is_allowed=ALLOW)["id"]
    w.rival = suggest.add_competitor(engine, w.own, "rival.example", "manual", ALLOW)["id"]
    w.check = lambda: tick(engine, "crawl", lock_dir=tmp_path, budget_seconds=20, db_wait_seconds=1)
    w.gaps = lambda: gaps.link_gaps(engine, w.own)
    return w


def csv_of(domains, spam=None):
    """A blank score means the file doesn't know, so the app's own checks judge that domain."""
    lines = ["Source url,Toxic score"] + [f"https://{d}/post,{(spam or {}).get(d, '')}" for d in domains]
    return "\n".join(lines).encode()


def filtered(world):
    return {g["domain"]: g["reason"] for g in world.gaps()["filtered"]}


def good(world):
    return [g["domain"] for g in world.gaps()["gaps"]]


# ---- step 1: the name ------------------------------------------------------------------------------

@pytest.mark.parametrize("domain, reason", [
    ("online-casino-bonus.example", "name_words"), ("cheapviagra.example", "name_words"), ("buy-backlinks-now.example", "name_words"),
    ("something.tk", "free_tld"), ("nice-name.top", "abused_tld"), ("a-b-c-d-e-f-g-h.example", "odd_name"), ("shop12345.example", "odd_name"),
    ("a" * 41 + ".example", "odd_name"),
    # Real domains from the first Common Crawl run: a French phrase in a name is normal.
    ("des-livres-pour-changer-de-vie.com", None), ("soirees-cocktail-luxury-vip-jetset.com", None), ("comptable-seville.com", None),
    ("barista-mag.example", None), ("coffee.co.uk", None), ("alphabet.com", None), ("xn--mnchen-3ya.de", None), ("web.de", None), ("shop.com.sa", None),
])
def test_a_name_can_give_it_away(domain, reason):
    assert quality.judge_name(domain) == reason


# ---- step 2: its place on the web --------------------------------------------------------------------

@pytest.mark.parametrize("rank, outlinks, hosts, reason", [
    (5_000_000, 40, 1, None),
    (74_000_000, 14, 2, None),  # a small real site in the market: a low rank isn't spam
    (None, 40, 1, None),
    (2_100_000, 7960, 2, "link_farm"),  # a real directory network sat here
    (6_800_000, 2087, 3, None),  # and a real blog here
    (5_000_000, 40, 5000, "many_hosts"),
    (500, 90000, 90000, None),  # a big site links out a lot, and that's fine
])
def test_common_crawl_shows_weak_sites_and_link_farms(rank, outlinks, hosts, reason):
    assert quality.judge_graph(rank, 100_000_000, outlinks, hosts) == reason


def test_a_domain_from_a_file_has_no_rank_to_judge():
    assert quality.judge_graph(None, None, None, None) is None


# ---- step 3: its home page -----------------------------------------------------------------------------

def judged(status, html=None):
    fields = extract(html.encode(), "https://x.example/") if html else None
    return quality.judge_page(FetchResult(url="https://x.example/", status=status), fields)


def test_a_normal_page_is_good_in_any_language():
    for name in ("fine.example", "arabic.example", "japanese.example"):
        assert judged("ok", HOME_PAGES[name]) == ("good", None, None), name


@pytest.mark.parametrize("name, reason", [
    ("parked.example", "parked"), ("gamble.example", "spam_words"), ("kasino-ru.example", "spam_words"), ("empty.example", "almost_empty"),
    ("hidden.example", "noindex"), ("farm.example", "many_outside_links"),
])
def test_a_home_page_can_give_it_away(name, reason):
    assert judged("ok", HOME_PAGES[name])[:2] == ("spam", reason)


def test_a_word_inside_another_word_is_not_spam():
    html = page("Casinoterrace hotel: the sexton's walk", LONG_TEXT)
    assert judged("ok", html)[0] == "good"


def test_a_big_site_that_wont_answer_is_not_called_down():
    assert quality.judge_page(FetchResult(url="https://x.example/", status="network_error"), None, big_site=True) == ("good", None, "unread")
    assert quality.judge_page(FetchResult(url="https://x.example/", status="network_error"), None)[0] == "retry"


def test_an_address_that_leads_to_no_public_server_counts_as_down():
    assert quality.judge_page(FetchResult(url="https://x.example/", status="refused"), None)[:2] == ("retry", "site_down")


def test_a_site_that_turns_the_app_away_is_not_called_spam():
    for status in ("blocked", "robots", "rate_limited", "http_error"):
        assert judged(status) == ("good", None, "unread"), status


def test_a_page_that_needs_javascript_is_not_called_empty():
    html = '<html><head><title>App</title></head><body><div id="root"></div></body></html>'
    assert judged("ok", html) == ("good", None, "unread")


# ---- the whole flow -------------------------------------------------------------------------------------

def test_spam_goes_first_and_only_the_good_ones_can_be_added(world):
    domains = ["fine.example", "arabic.example", "parked.example", "gamble.example", "online-casino.example", "empty.example", "hidden.example", "farm.example", "missing.example", "moved.example", "toxic.example", "shy.example"]
    report = gaps.import_referrers(world.engine, world.own, world.rival, csv_of(domains, {"toxic.example": 88}), "links.csv")
    assert report["removed_spam"] == 1
    before = world.gaps()
    assert before["gaps"] == []  # nothing is on offer until it has been checked
    assert before["funnel"]["checking"] == 10 and before["funnel"]["filtered"] == 2
    assert gaps.add_to_prospects(world.engine, world.own, ["fine.example"]) == {"added": [], "skipped": ["fine.example"]}

    world.check()
    after = world.gaps()
    assert sorted(good(world)) == ["arabic.example", "fine.example", "shy.example"]
    assert filtered(world) == {
        "parked.example": "parked", "gamble.example": "spam_words", "online-casino.example": "name_words", "empty.example": "almost_empty", "hidden.example": "noindex",
        "farm.example": "many_outside_links", "missing.example": "no_home_page", "moved.example": "leads_elsewhere", "toxic.example": "spam_score",
    }
    assert after["funnel"] == {"found": 12, "filtered": 9, "checking": 0, "good": 3}
    assert next(g for g in after["gaps"] if g["domain"] == "shy.example")["page_note"] == "unread"
    assert all(g["reason_words"] for g in after["filtered"])

    added = gaps.add_to_prospects(world.engine, world.own, ["fine.example", "gamble.example", "toxic.example", "nowhere.example"])
    assert added == {"added": ["fine.example"], "skipped": ["gamble.example", "toxic.example", "nowhere.example"]}
    assert [p["domain"] for p in gaps.list_prospects(world.engine, world.own)] == ["fine.example"]


def test_a_person_can_overrule_the_filter_both_ways(world):
    gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["fine.example", "gamble.example"]), "links.csv")
    world.check()
    gaps.decide(world.engine, world.own, "gamble.example", "keep")
    gaps.decide(world.engine, world.own, "fine.example", "spam")
    assert good(world) == ["gamble.example"]
    assert world.gaps()["gaps"][0]["kept"] is True
    assert filtered(world) == {"fine.example": "my_choice"}
    assert gaps.add_to_prospects(world.engine, world.own, ["gamble.example", "fine.example"]) == {"added": ["gamble.example"], "skipped": ["fine.example"]}
    gaps.decide(world.engine, world.own, "fine.example", "auto")
    assert "fine.example" in good(world)
    with pytest.raises(gaps.Refused):
        gaps.decide(world.engine, world.own, "fine.example", "maybe")


def test_a_decision_is_per_site_and_a_later_import_doesnt_undo_it(world):
    other = links.add_site(world.engine, "https://other-own.example/", "own", is_allowed=ALLOW)["id"]
    suggest.add_competitor(world.engine, other, "rival.example", "manual", ALLOW)
    gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["gamble.example"]), "links.csv")
    world.check()
    gaps.decide(world.engine, world.own, "gamble.example", "keep")
    gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["gamble.example"]), "again.csv")
    world.check()
    assert good(world) == ["gamble.example"]
    assert [g["domain"] for g in gaps.link_gaps(world.engine, other)["gaps"]] == []


def test_a_site_that_is_down_gets_a_second_try_before_it_goes(world):
    gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["down.example"]), "links.csv")
    world.check()
    assert world.gaps()["funnel"]["checking"] == 1  # one failure says little
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET checked_at = checked_at - INTERVAL :h HOUR"), {"h": quality.RETRY_AFTER_HOURS + 1})
    quality.queue_checks(world.engine, part=99)
    world.check()
    assert filtered(world) == {"down.example": "site_down"}


def test_a_page_check_stops_at_the_daily_budget(world, monkeypatch):
    monkeypatch.setattr(quality.budget, "has_room", lambda engine, limit=0: False)
    gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["fine.example"]), "links.csv")
    world.check()
    assert world.gaps()["funnel"]["checking"] == 1


# ---- Common Crawl ------------------------------------------------------------------------------------

VERTICES = "0\tae.co.farm\t9000\n1\tcom.rival\t3\n2\tcom.blog\t1\n3\tfr.news\t2\n4\torg.weak\t1\n5\tde.other\t1\n"
# 2 links to rival and to 2 others. 3 links to rival. 4 links to rival. 5 doesn't. 0 links to rival and to many.
EDGES = "".join(f"0\t{n}\n" for n in range(1, 5)) + "2\t1\n2\t3\n2\t4\n3\t1\n4\t1\n5\t2\n"
RANKS = "#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts\n1\t9.0\t1\t0.1\tcom.blog\t1\n2\t8.0\t2\t0.1\tfr.news\t2\n3\t7.0\t3\t0.1\tcom.rival\t3\n4\t6.0\t4\t0.1\tde.other\t1\n5\t5.0\t5\t0.1\tae.co.farm\t9000\n6\t4.0\t6\t0.1\torg.weak\t1\n"


def blocks(text_value):
    return list(cc.whole_lines(cc.gunzip_blocks([gzip.compress(text_value.encode())])))


def test_reverse_names():
    assert cc.reverse_domain("example.co.ae") == "ae.co.example"


def test_gzip_in_several_parts_and_blocks_cut_anywhere_are_read_whole():
    data = gzip.compress(b"1\tone\n2\ttw") + gzip.compress(b"o\n3\tthree")
    pieces = [data[:10], data[10:]]
    assert b"".join(cc.whole_lines(cc.gunzip_blocks(pieces))) == b"1\tone\n2\ttwo\n3\tthree\n"


def test_finding_who_links_to_a_competitor():
    ids = cc.find_ids(blocks(VERTICES), ["rival.com", "absent.com"])
    assert ids == {"rival.com": 1}
    found = cc.find_referrers(blocks(EDGES), {1: "rival.com"})["rival.com"]
    assert sorted(found) == [0, 2, 3, 4]
    assert found[2] == 3 and found[3] == 1  # how many domains each one links to
    assert cc.names_for(blocks(VERTICES), {2, 3}) == {2: ("blog.com", 1), 3: ("news.fr", 2)}


def test_ranks_stop_at_the_cut_off():
    assert cc.ranks_for(blocks(RANKS), {"blog.com", "weak.org", "farm.co.ae"}, stop_after=5) == {"blog.com": 1, "farm.co.ae": 5}


def test_a_dropped_download_carries_on_where_it_stopped():
    data = gzip.compress(VERTICES.encode())
    seen = []

    def server(request):
        seen.append(request.headers.get("range"))
        if len(seen) == 1:
            return httpx.Response(503, text="<Error><Code>SlowDown</Code></Error>")
        start = int(request.headers["range"].split("=")[1].split("-")[0]) if request.headers.get("range") else 0
        return httpx.Response(206 if start else 200, stream=httpx.ByteStream(data[start:]))

    client = httpx.Client(transport=httpx.MockTransport(server))
    waits = []
    assert b"".join(cc.download_chunks(client, "https://x.example/f", sleep=waits.append)) == data
    assert waits == [15]  # it slowed down when told to


def test_it_gives_up_rather_than_pushing_on():
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503, text="SlowDown")))
    waits = []
    with pytest.raises(httpx.TransportError):
        list(cc.download_chunks(client, "https://x.example/f", sleep=waits.append))
    assert len(waits) == cc.TRIES - 1 and max(waits) <= 600


def test_common_crawl_results_go_through_the_same_filter(world):
    rows = [
        {"domain": "fine.example", "rank": 1000, "total": 100_000_000, "outlinks": 12, "hosts": 1},
        {"domain": "arabic.example", "rank": 74_000_000, "total": 100_000_000, "outlinks": 2, "hosts": 1},
        {"domain": "farm-site.example", "rank": 5_000_000, "total": 100_000_000, "outlinks": 9000, "hosts": 1},
        {"domain": "bet365-casino.example", "rank": 1000, "total": 100_000_000, "outlinks": 2, "hosts": 1},
    ]
    report = gaps.import_common_crawl(world.engine, world.rival, rows, "cc-main-test")
    assert report == {"domains": 4, "filtered": 2, "to_check": 2}
    world.check()
    answer = world.gaps()
    assert good(world) == ["fine.example", "arabic.example"]  # a low rank stays in, with its rank shown
    assert filtered(world) == {"farm-site.example": "link_farm", "bet365-casino.example": "name_words"}
    assert answer["gaps"][1]["top_percent"] == 74 and answer["gaps"][1]["title"] == "قهوة طازجة"
    row = answer["gaps"][0]
    assert row["sources"] == ["Common Crawl"] and row["top_percent"] == 0.01  # never "top 0%"
    assert row["authority"] is None and row["spam_score"] is None  # it has neither, and must not pretend
    source = answer["competitors"][0]
    assert source["common_crawl"] == "cc-main-test" and source["common_crawl_domains"] == 4 and source["has_file"] is False


def test_common_crawl_never_wipes_what_a_file_said(world):
    gaps.import_referrers(world.engine, world.own, world.rival, b"Source url,Authority score,Toxic score\nhttps://fine.example/post,62,3\n", "links.csv")
    gaps.import_common_crawl(world.engine, world.rival, [{"domain": "fine.example", "rank": 1000, "total": 100_000_000, "outlinks": 3, "hosts": 1}], "cc-main-test")
    world.check()
    row = world.gaps()["gaps"][0]
    assert row["authority"] == 62 and row["spam_score"] == 3 and row["sample_url"] == "https://fine.example/post"
    assert set(row["sources"]) == {"Common Crawl", "SEMrush"}


def test_the_file_the_script_writes_can_be_uploaded(world):
    header = ",".join(gaps.CC_HEADERS)
    data = f"{header}\nfine.example,1000,100000000,12,1,cc-main-test\nbig-farm.example,5000000,100000000,9000,1,cc-main-test\n".encode()
    report = gaps.import_referrers(world.engine, world.own, world.rival, data, "rival.csv")
    assert report["source_label"] == "Common Crawl" and report["filtered"] == 1
    world.check()
    assert good(world) == ["fine.example"] and filtered(world) == {"big-farm.example": "link_farm"}


def test_only_the_most_useful_are_listed_when_there_are_thousands(world, monkeypatch):
    monkeypatch.setattr(gaps, "MAX_LISTED", 2)
    rows = [{"domain": f"site{i}.example", "rank": 1000 + i, "total": 100_000_000, "outlinks": 1, "hosts": 1} for i in range(4)]
    gaps.import_common_crawl(world.engine, world.rival, rows, "cc-main-test")
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'good'"))
    answer = world.gaps()
    assert [g["domain"] for g in answer["gaps"]] == ["site0.example", "site1.example"]
    assert answer["funnel"]["good"] == 4


def test_spam_is_flagged_never_removed(world):
    report = gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["fine.example", "gamble.example", "online-casino.example", "toxic.example"], {"toxic.example": 88}), "links.csv")
    assert report["domains"] == 4 and report["flagged"] == 2  # the name and the spam score are known at once. The page comes next.
    world.check()
    answer = world.gaps()
    assert sorted(g["domain"] for g in answer["gaps"]) == ["fine.example"]
    flagged = {g["domain"]: g for g in answer["filtered"]}
    assert sorted(flagged) == ["gamble.example", "online-casino.example", "toxic.example"]
    # Each keeps everything known about it, so it can be judged by eye.
    assert flagged["toxic.example"]["spam_score"] == 88 and flagged["toxic.example"]["sample_url"] == "https://toxic.example/post"
    assert all(g["quality"] == "spam" and g["reason_words"] and g["competitors"] for g in flagged.values())
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM competitor_referrers")).scalar() == 4


def test_a_site_that_is_down_isnt_tried_again_straight_away(world):
    gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["down.example"]), "links.csv")
    world.check()
    quality.queue_checks(world.engine, part=99)
    world.check()  # a minute later, the site is as down as it was: this says nothing new
    assert world.gaps()["funnel"]["checking"] == 1 and filtered(world) == {}
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET checked_at = checked_at - INTERVAL :h HOUR"), {"h": quality.RETRY_AFTER_HOURS + 1})
    quality.queue_checks(world.engine, part=100)
    world.check()
    assert filtered(world) == {"down.example": "site_down"}


# ---- the file's spam score decides --------------------------------------------------------------------

def test_the_files_spam_score_decides_over_the_apps_own_checks(world):
    # betmatecasino.com had a score of 3 in an Ubersuggest file and was flagged by its name (2026-11-10).
    scores = {"bet-casino.example": 3, "parked.example": 3, "toxic.example": 52}
    report = gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["bet-casino.example", "parked.example", "toxic.example", "gamble-casino.example"], scores), "links.csv")
    assert report["flagged"] == 2  # the file's 52, and a spam name the file has no score for
    world.check()
    answer = world.gaps()
    assert sorted(good(world)) == ["bet-casino.example", "parked.example"]  # a low score wins over a spam name and a parked page
    flagged = {g["domain"]: g for g in answer["filtered"]}
    assert (flagged["toxic.example"]["reason"], flagged["toxic.example"]["flagged_by"]) == ("spam_score", "file")
    assert flagged["toxic.example"]["reason_words"] == "Spam score above 30 in the uploaded file"
    assert (flagged["gamble-casino.example"]["reason"], flagged["gamble-casino.example"]["flagged_by"]) == ("name_words", "system")


def test_a_file_score_is_not_kept_as_the_systems_verdict(world):
    gaps.import_referrers(world.engine, world.own, world.rival, csv_of(["toxic.example"], {"toxic.example": 88}), "links.csv")
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT reason FROM link_domains WHERE domain = 'toxic.example'")).scalar() != "spam_score"
    # One stored that way by an older version goes back to be checked.
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE link_domains SET quality = 'spam', reason = 'spam_score' WHERE domain = 'toxic.example'"))
    quality.queue_checks(world.engine)
    with world.engine.connect() as conn:
        assert conn.execute(text("SELECT quality FROM link_domains WHERE domain = 'toxic.example'")).scalar() == "pending"


def test_a_persons_decision_beats_the_file():
    assert quality.verdict(88, None, None, "keep") == ("good", None, None)
    assert quality.verdict(3, "good", None, "spam") == ("spam", "my_choice", "you")
    assert quality.verdict(None, "spam", "parked") == ("spam", "parked", "system")
    assert quality.verdict(30, "spam", "name_words") == ("good", None, None)  # 30 itself isn't above 30
