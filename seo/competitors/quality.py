"""Is a domain worth a link? Spam is flagged first, and only the good ones can be added. No AI and no paid data.

Three steps, cheapest first:
1. Its name: spam words, a domain ending known for abuse, a name no real site would pick.
2. Its place on the web, from Common Crawl: whether it links out like a link farm. A low rank alone proves nothing: on the
   first real run (38 domains, 2026-11-04), small real sites in the same market sat at 70-90%, so rank is shown, not judged.
3. Its home page, read once: gone, down, parked, spam words, almost empty, or hidden from search engines.

A site that doesn't let the app read its home page isn't spam, so it stays good, with a note. A rule can be wrong, so a
flagged domain is never removed: it stays in the list with its reason, and a person's decision always wins. The numbers
were set against that first real run, which is a small sample, so keep checking them.
"""
from __future__ import annotations

import time

from sqlalchemy import Engine, text

from seo.backlinks import logos
from seo.backlinks.cleaner import root_domain
from seo.competitors import pages
from seo.core import budget
from seo.crawl.extract import extract
from seo.links import service as links_service
from seo.links.urls import host_key
from seo.worker import queue
from seo.worker.runner import handler

PENDING, GOOD, SPAM = "pending", "good", "spam"
JOB_KIND = "linkgaps.check"
LANE = "crawl"
CHUNK_SECONDS = 40.0
MAX_ATTEMPTS = 2  # a site that's down once may only be having a bad day
RETRY_AFTER_HOURS = 6  # and trying again a minute later says nothing new

# Step 2. Common Crawl ranks about 135 million domains.
TRUSTED_SHARE = 0.01  # the top 1% are big sites, which do link out a lot, have many hosts, and may refuse a bot's connection
FARM_OUTLINKS = 3000  # a real network of link directories sat at 5,000-9,600, and real blogs at 2,000-2,700
FARM_HOSTS = 1000

# Step 3.
TOO_MANY_OUTSIDE_LINKS = 200
ALMOST_EMPTY_CHARACTERS = 200

# Plain words for why a domain was filtered out. The screen shows these.
REASONS = {
    "spam_score": "Its spam score is above 30",
    "name_words": "Spam words in its name",
    "free_tld": "A free domain ending that spammers favour",
    "abused_tld": "A domain ending known for abuse",
    "odd_name": "A name no real site would pick",
    "link_farm": "Links out to thousands of sites, like a link farm",
    "many_hosts": "Thousands of subdomains, like a link farm",
    "no_home_page": "Its home page doesn't exist",
    "site_down": "The site is down",
    "leads_elsewhere": "Its home page leads to another website",
    "parked": "Parked or for sale",
    "spam_words": "Spam words on its home page",
    "many_outside_links": "Its home page is mostly links to other sites",
    "almost_empty": "Almost nothing on its home page",
    "noindex": "Its home page is hidden from search engines",
    "my_choice": "You marked it as spam",
}

FREE_TLDS = frozenset({"tk", "ml", "ga", "cf", "gq"})
ABUSED_TLDS = frozenset({
    "top", "click", "loan", "work", "men", "date", "download", "stream", "gdn", "bid", "win", "racing", "review", "party",
    "trade", "science", "cricket", "faith", "accountant", "kim", "country", "rest", "icu", "buzz", "monster", "cyou", "sbs", "cfd",
})
NAME_WORDS = (
    "casino", "poker", "betting", "togel", "slotgacor", "bahis", "porn", "xxx", "viagra", "cialis", "escort", "hentai",
    "payday", "backlink", "linkfarm", "buylinks", "seolinks", "pharmacy-online", "replica-",
)
# Gambling, adult and pharmacy words in the languages spam sites use most. Whole words only, so "slot" isn't found in "slotted".
PAGE_WORDS = (
    "casino", "online casino", "poker online", "slot gacor", "sports betting", "betting tips", "paris sportifs", "apuestas", "kasino", "togel", "judi online",
    "bahis", "porn", "porno", "xxx", "escort", "viagra", "cialis", "buy backlinks", "казино", "порно", "ставки на спорт", "كازينو", "مراهنات", "赌场", "博彩", "娱乐城", "カジノ", "카지노", "토토",
)
PARKED_WORDS = (
    "domain is for sale", "domain for sale", "buy this domain", "this domain may be for sale", "domain parking", "parked free", "parked domain",
    "domaine est à vendre", "domaine à vendre", "dominio en venta", "dominio está en venta", "domain steht zum verkauf", "domain kaufen",
    "этот домен продается", "هذا النطاق للبيع", "域名出售", "このドメインは販売中",
)


def judge_name(domain: str) -> str | None:
    labels = domain.lower().split(".")
    if labels[-1] in FREE_TLDS:
        return "free_tld"
    if any(word in domain.lower() for word in NAME_WORDS):
        return "name_words"
    if labels[-1] in ABUSED_TLDS:
        return "abused_tld"
    name = labels[0] if len(labels) < 3 else labels[-3] if len(labels[-2]) <= 3 else labels[-2]
    # French and other languages write whole phrases in a name, such as des-livres-pour-changer-de-vie, so a few hyphens prove nothing.
    if not name.startswith("xn--") and (name.count("-") >= 7 or len(name) >= 40 or sum(c.isdigit() for c in name) >= 5):
        return "odd_name"
    return None


def judge_graph(rank: int | None, total: int | None, outlinks: int | None, hosts: int | None) -> str | None:
    """Only for domains that came from Common Crawl. A low rank isn't spam, so it only decides who is big enough not to be judged."""
    if not total or (rank is not None and rank <= total * TRUSTED_SHARE):
        return None
    if (outlinks or 0) >= FARM_OUTLINKS:
        return "link_farm"
    if (hosts or 0) >= FARM_HOSTS:
        return "many_hosts"
    return None


def is_big_site(rank: int | None, total: int | None) -> bool:
    return bool(rank and total and rank <= total * TRUSTED_SHARE)


def judge_page(result, fields, big_site: bool = False) -> tuple[str, str | None, str | None]:
    """Returns the quality, the reason if it's spam, and a note. `retry` means it couldn't tell yet."""
    status = result.status
    # A site as big as middleeasteye.net isn't down: it just wouldn't answer the app. An address that doesn't lead to a public server is.
    if status == "network_error" and big_site:
        return GOOD, None, "unread"
    if status == "left_scope":
        return SPAM, "leads_elsewhere", None
    if status == "gone":
        return SPAM, "no_home_page", None
    if status in ("network_error", "server_error", "too_many_redirects", "refused"):
        return "retry", "site_down", None
    if status != "ok" or fields is None:
        return GOOD, None, "unread"  # it turned the app away, or isn't a web page. Neither says it's spam.
    if "noindex" in (fields.robots_meta or "").lower():
        return SPAM, "noindex", None
    top = " ".join([fields.title, fields.meta_description, *fields.h1])
    if any(pages.contains_phrase(top, word) for word in PAGE_WORDS):
        return SPAM, "spam_words", None
    if any(pages.contains_phrase(f"{top} {fields.text[:3000]}", word) for word in PARKED_WORDS):
        return SPAM, "parked", None
    if fields.external_links >= TOO_MANY_OUTSIDE_LINKS:
        return SPAM, "many_outside_links", None
    if fields.js_only:
        return GOOD, None, "unread"  # its text needs JavaScript, so there's nothing to judge
    if fields.extras.get("characters", len(fields.text)) < ALMOST_EMPTY_CHARACTERS:
        return SPAM, "almost_empty", None
    return GOOD, None, None


def note_domains(engine: Engine, rows: list[dict]) -> None:
    """Steps 1 and 2. Each row has a domain, and from Common Crawl also rank, total, outlinks and hosts. A domain already judged keeps its page check."""
    with engine.begin() as conn:
        for row in rows:
            reason = judge_name(row["domain"]) or judge_graph(row.get("rank"), row.get("total"), row.get("outlinks"), row.get("hosts"))
            conn.execute(
                text(
                    "INSERT INTO link_domains (domain, quality, reason, cc_rank, cc_total, cc_outlinks, cc_hosts) VALUES (:d, :q, :r, :rank, :total, :out, :hosts) "
                    "ON DUPLICATE KEY UPDATE cc_rank = COALESCE(VALUES(cc_rank), cc_rank), cc_total = COALESCE(VALUES(cc_total), cc_total), cc_outlinks = COALESCE(VALUES(cc_outlinks), cc_outlinks), "
                    "cc_hosts = COALESCE(VALUES(cc_hosts), cc_hosts), reason = IF(VALUES(quality) = 'spam', VALUES(reason), reason), quality = IF(VALUES(quality) = 'spam', 'spam', quality)"
                ),
                {"d": row["domain"][:190], "q": SPAM if reason else PENDING, "r": reason, "rank": row.get("rank"), "total": row.get("total"), "out": row.get("outlinks"), "hosts": row.get("hosts")},
            )


def queue_checks(engine: Engine, part: int = 0) -> None:
    with engine.connect() as conn:
        waiting = conn.execute(text("SELECT 1 FROM link_domains WHERE quality = 'pending' LIMIT 1")).first()
    if waiting:
        queue.enqueue(engine, LANE, JOB_KIND, payload={"part": part}, dedupe_key=f"linkgaps:{part}", max_attempts=2)


def read_home_page(domain: str, fetcher, charge) -> tuple:
    """Tries the address a site most likely answers on. Stays on the domain, and goes through the polite fetcher, so robots.txt applies."""
    def on_domain(url: str) -> bool:
        return (root_domain(host_key(url)) or host_key(url)) == domain

    result = None
    for address in (f"https://{domain}/", f"https://www.{domain}/", f"http://{domain}/"):
        before = fetcher.requests
        result = fetcher.get(address, stay_on=on_domain)
        charge(fetcher.requests - before)
        if result.status != "network_error":
            break
    fields = extract(result.body, result.final_url or domain, charset=result.charset) if result.status == "ok" and result.body is not None else None
    return result, fields


@handler(JOB_KIND)
def run_checks(job, engine: Engine) -> None:
    part = (job.payload or {}).get("part", 0)
    started = time.monotonic()
    fetcher = links_service.fetcher_factory()
    seen: set[str] = set()
    try:
        while time.monotonic() - started < CHUNK_SECONDS and budget.has_room(engine):
            with engine.connect() as conn:
                batch = [(row[0], is_big_site(row[1], row[2])) for row in conn.execute(text(
                    "SELECT domain, cc_rank, cc_total FROM link_domains WHERE quality = 'pending' "
                    "AND (check_attempts = 0 OR checked_at < UTC_TIMESTAMP(3) - INTERVAL :wait HOUR) ORDER BY cc_rank IS NULL, cc_rank, domain LIMIT 25"
                ), {"wait": RETRY_AFTER_HOURS})]
            batch = [item for item in batch if item[0] not in seen]
            if not batch:
                break
            for domain, big_site in batch:
                if time.monotonic() - started >= CHUNK_SECONDS or not budget.has_room(engine):
                    break
                seen.add(domain)
                result, fields = read_home_page(domain, fetcher, lambda n: budget.charge(engine, n))
                quality, reason, note = judge_page(result, fields, big_site)
                title = (fields.title or "")[:300] if fields else None
                with engine.begin() as conn:
                    if quality == "retry":
                        conn.execute(
                            text(
                                "UPDATE link_domains SET check_attempts = check_attempts + 1, checked_at = UTC_TIMESTAMP(3), "
                                "quality = IF(check_attempts >= :most, 'spam', 'pending'), reason = IF(check_attempts >= :most, :r, NULL) WHERE domain = :d"
                            ),
                            {"most": MAX_ATTEMPTS, "r": reason, "d": domain},
                        )
                    else:
                        conn.execute(
                            text("UPDATE link_domains SET quality = :q, reason = :r, page_note = :n, page_title = :t, checked_at = UTC_TIMESTAMP(3) WHERE domain = :d"),
                            {"q": quality, "r": reason, "n": note, "t": title, "d": domain},
                        )
                if quality == GOOD:
                    logos.queue_for(engine, [domain])
    finally:
        fetcher.close()
    # A site that was down gets another try on a later run, not straight away. Anything not reached yet carries on now.
    with engine.connect() as conn:
        left = conn.execute(text("SELECT 1 FROM link_domains WHERE quality = 'pending' AND check_attempts = 0 LIMIT 1")).first()
    if left and budget.has_room(engine):
        queue_checks(engine, part + 1)


def reason_words(code: str | None) -> str:
    return REASONS.get(code or "", "Flagged as spam")
