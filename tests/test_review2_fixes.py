"""Code review round 2 of fix-all-2026-11-17 (2026-11-18): each finding with a known answer worked out by hand.

Made-up sites only (the product is for other accounts too).
"""
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from seo.collectors import common, ga4, http
from seo.metrics import ga4_checks, leads, service
from tests.test_collectors import _google, key, world  # noqa: F401 - fixtures
from tests.test_ga4_numbers import _day, _scope, site  # noqa: F401 - fixtures

END = date(2026, 11, 16)
ORGANIC = {"channel": "Organic Search", "source": "google", "medium": "organic", "manual_source": "google", "manual_medium": "organic", "campaign": "(organic)", "page": "/contact/", "host": "mine.example"}


def _answer(groups):
    from tests import ga4_fake

    return lambda request: ga4_fake.answer(request, groups)


def _stored_leads(engine, site_id, day=None):
    with engine.connect() as conn:
        where = "AND day = :d" if day else ""
        return {table: conn.execute(text(f"SELECT SUM(leads) FROM {table} WHERE site_id = :s {where}"), {"s": site_id, "d": day}).scalar()
                for table in ("ga4_source_daily", "ga4_page_daily")}


# ---- 1: a visit with two ticked lead events is one lead ---------------------------------------------------------------


def test_three_enquiries_firing_form_submit_and_generate_lead_are_three_leads(world):
    _google(world)
    # 10 visits; 3 of them sent the form, and each of those 3 fired both form_submit and generate_lead.
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 10, "users": 10, "events": {"form_submit": (3, 3), "generate_lead": (3, 3)},
                                           "visits_with": [{"form_submit", "generate_lead"}] * 3}])
    day = common.today(world.engine) - timedelta(days=1)
    leads.set_events(world.engine, world.site, ["form_submit", "generate_lead"])
    ga4._one_day(world.engine, world.site, "t", "123456", day)
    assert _stored_leads(world.engine, world.site) == {"ga4_source_daily": 3.0, "ga4_page_daily": 3.0}  # was 6
    # Ticked again, the day's stored "any ticked event" sessions give the same 3.
    leads.recompute(world.engine, world.site)
    assert _stored_leads(world.engine, world.site)["ga4_source_daily"] == 3.0


def test_after_a_tick_change_a_day_counts_its_biggest_event_until_it_is_read_again(world):
    _google(world)
    # form_submit on 3 visits, generate_lead on 2, one visit had both: 4 visits with a lead.
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 10, "users": 10, "events": {"form_submit": (3, 3), "generate_lead": (2, 2)},
                                           "visits_with": [{"form_submit"}, {"form_submit"}, {"form_submit", "generate_lead"}, {"generate_lead"}]}])
    day = common.today(world.engine) - timedelta(days=1)
    ga4._one_day(world.engine, world.site, "t", "123456", day)  # read before any tick
    leads.set_events(world.engine, world.site, ["form_submit", "generate_lead"])
    assert _stored_leads(world.engine, world.site)["ga4_source_daily"] == 3.0  # the bigger event: never more than the truth (was 5)
    assert ga4.days_to_reread(world.engine, world.site) == 1  # that day's leads are read again
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE coverage SET saved_at = UTC_TIMESTAMP(3)"))
    assert ga4.collect(world.engine, world.site) is True  # (it also reads the window's other days, never read yet)
    assert _stored_leads(world.engine, world.site, day)["ga4_source_daily"] == 4.0
    assert ga4.days_to_reread(world.engine, world.site) == 0
    leads.set_events(world.engine, world.site, ["form_submit"])  # one tick: that event's own sessions, exact at once
    assert _stored_leads(world.engine, world.site, day)["ga4_source_daily"] == 3.0 and ga4.days_to_reread(world.engine, world.site) == 0


# ---- 5 and 11: the history read again reaches 0 and goes a batch a run ------------------------------------------------


def test_days_older_than_the_window_are_not_counted_as_left_to_read(world):
    _google(world)
    newest = common.today(world.engine) - timedelta(days=1)
    with world.engine.begin() as conn:  # 3 days inside the window, 10 older ones collect() never reads
        for n in list(range(3)) + list(range(ga4.HISTORY_DAYS + 1, ga4.HISTORY_DAYS + 11)):
            conn.execute(text("INSERT INTO coverage (site_id, source, day, `rows`, saved_at) VALUES (:s, 'ga4', :d, 3, UTC_TIMESTAMP(3))"), {"s": world.site, "d": newest - timedelta(days=n)})
    assert ga4.days_to_reread(world.engine, world.site) == 3  # was 13, and it never went below 10
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 5, "users": 5, "events": {}}])
    assert ga4.collect(world.engine, world.site) is True
    assert ga4.days_to_reread(world.engine, world.site) == 0


def test_the_history_is_read_again_a_batch_a_run_and_a_quota_stop_is_not_a_failure(world):
    from seo.collectors import jobs
    from seo.worker.runner import RunAgain

    _google(world)
    world.answers["runReport"] = _answer([{**ORGANIC, "sessions": 5, "users": 5, "events": {}}])
    newest = common.today(world.engine) - timedelta(days=1)
    with world.engine.begin() as conn:
        for n in range(100):
            conn.execute(text("INSERT INTO coverage (site_id, source, day, `rows`, saved_at) VALUES (:s, 'ga4', :d, 3, UTC_TIMESTAMP(3))"), {"s": world.site, "d": newest - timedelta(days=n)})
    # The 4 recent days are always read; then 30 old ones, and the job waits an hour.
    assert ga4.collect(world.engine, world.site, budget_seconds=600) == ga4.LATER
    assert ga4.days_to_reread(world.engine, world.site) == 100 - ga4.REREAD_DAYS - ga4.BACKLOG_DAYS_PER_RUN
    job = type("Job", (), {"payload": {"site_id": world.site, "source": "ga4"}})()
    with pytest.raises(RunAgain) as again:
        jobs.run(job, world.engine)
    assert again.value.delay_seconds == ga4.BACKLOG_PAUSE_SECONDS  # was RunAgain(0), back to back
    # Google's quota runs out during the re-read: what was saved stays, the source isn't shown as failing.
    world.answers["runReport"] = httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED", "message": "Exhausted property tokens per hour."}})
    with world.engine.begin() as conn:
        conn.execute(text("UPDATE coverage SET saved_at = UTC_TIMESTAMP(3)"))
    assert ga4.collect(world.engine, world.site) == ga4.LATER
    assert common.source_row(world.engine, world.site, "ga4")["last_error"] is None


# ---- 2: visits change without the unusual days, a day against a day ---------------------------------------------------


def test_a_steady_100_a_day_with_a_5_day_burst_is_no_change(engine, site):
    from seo.metrics import today as today_view

    start = END - timedelta(days=27)
    for n in range(-120, 28):  # 100 a day in both periods; 1,000 a day on the first 5 days of this one
        _day(engine, site, start + timedelta(days=n), 1000 if 0 <= n < 5 else 100)
    got = ga4_checks.unusual_change(engine, [site], start, END, start - timedelta(days=28), start - timedelta(days=1))
    assert (got["visits"], got["visits_before"]) == (2300, 2800)  # 23 kept days x 100, 28 x 100
    assert got["change"] == 0.0  # was -17.9%
    row = today_view.today(engine, site, {"range": "28d"})
    assert row["results"]["visits"]["unusual"]["change"] == 0


def test_a_normal_day_between_two_bursts_stays_in(engine, site):
    start = END - timedelta(days=27)
    for n in range(-120, 28):  # bursts on days 0 and 2 (one run: 2 days apart); day 1 is a normal 100
        _day(engine, site, start + timedelta(days=n), 1000 if n in (0, 2) else 100)
    got = ga4_checks.unusual_change(engine, [site], start, END, start - timedelta(days=28), start - timedelta(days=1))
    assert [(r["from"], r["to"], r["days"], r["visits"]) for r in got["runs"]] == [(start.isoformat(), (start + timedelta(days=2)).isoformat(), 2, 2000)]
    assert got["visits"] == 2600 and got["change"] == 0.0  # 26 kept days, day 1 among them (was 2,500 over 25)


# ---- 3: a row's panel gives the row's lead rate ------------------------------------------------------------------------


def test_the_channel_panel_rate_is_the_rows_and_its_sources_have_one(engine, site):
    d0 = END - timedelta(days=1)
    _day(engine, site, d0, 10, key_events=30.0)  # 30 key events in 10 visits: at most 10 visits with one
    _day(engine, site, END, 10, key_events=0.0)
    _day(engine, site, d0, 10, key_events=30.0, channel="Referral", source="blog.example", medium="referral")
    _day(engine, site, END, 10, key_events=0.0, channel="Referral", source="blog.example", medium="referral")
    rows = {c["channel"]: c for c in service.channels(_scope(engine, site, d0, END))["channels"]}
    assert rows["Organic Search"]["rate"] == 0.5  # 10 of 20 visits
    panel = service.channel_detail(_scope(engine, site, d0, END), "Organic Search")
    assert panel["totals"]["rate"] == 0.5  # was 1.0
    assert [s["rate"] for s in panel["sources"]] == [0.5] and [m["rate"] for m in panel["mediums"]] == [0.5]  # was 0.0
    referrer = service.referrer_detail(_scope(engine, site, d0, END), "blog.example")
    assert referrer["totals"]["rate"] == 0.5


def test_the_assistant_row_and_panel_give_the_same_rate(engine, site):
    from seo.metrics import ai_search

    d0 = END - timedelta(days=1)
    _day(engine, site, d0, 30, key_events=90.0, channel="Referral", source="chatgpt.com", medium="referral")
    _day(engine, site, END, 30, key_events=0.0, channel="Referral", source="chatgpt.com", medium="referral")
    row = next(r for r in ai_search.build(_scope(engine, site, d0, END))["sources"] if r["source"] == "chatgpt.com")
    panel = service.assistant_detail(_scope(engine, site, d0, END), "chatgpt.com")
    assert row["rate"] == panel["totals"]["rate"] == 0.5  # 30 of 60 visits; both said 1.0


# ---- 4: one lead rule per site on every screen -------------------------------------------------------------------------


def test_all_sites_count_the_same_leads_on_today_and_channels_when_only_one_site_picked(engine, site):
    from seo.metrics import today as today_view

    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('other.example', 'https://other.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_sources (site_id, source, connection_id, property, data_through) VALUES (:s, 'ga4', 1, '2', :d)"), {"s": other, "d": END})
    start = END - timedelta(days=27)
    for n in range(56):
        day = start - timedelta(days=28) + timedelta(days=n)
        _day(engine, site, day, 10, key_events=5.0, lead_visits=2)  # picked: 2 leads a day (5 key events)
        _day(engine, other, day, 10, key_events=4.0)  # not picked: its 4 key events a day
    leads.set_events(engine, site, ["generate_lead"])
    with engine.begin() as conn:  # set_events works leads out from stored events: put the day's 2 back
        conn.execute(text("UPDATE ga4_source_daily SET leads = 2 WHERE site_id = :s"), {"s": site})
    channels = service.channels(service.Scope(engine, "all", start.isoformat(), END.isoformat()))
    assert channels["lead_kind"] == "mixed" and channels["key_event_hosts"] == ["other.example"]
    assert channels["total"]["leads"] == 28 * (2 + 4)  # was 28 x 2: the other site counted no lead
    assert channels["total"]["converted"] == 28 * (2 + 4)
    shown = today_view.today(engine, None, {"range": "28d"})["results"]["leads"]
    assert shown["value"] == 28 * (2 + 4) and shown["kind"] == "mixed" and shown["key_event_hosts"] == ["other.example"]
    one = service.channels(_scope(engine, site, start, END))
    assert one["lead_kind"] == "leads" and one["total"]["leads"] == 56


def test_ticked_events_that_did_not_fire_say_no_leads_not_not_set_up(engine, site):
    from seo.metrics import ai_search

    _day(engine, site, END, 30, key_events=0.0, channel="Referral", source="chatgpt.com", medium="referral")
    assert ai_search.build(_scope(engine, site, END, END))["key_events_set_up"] is False
    leads.set_events(engine, site, ["generate_lead"])
    answer = ai_search.build(_scope(engine, site, END, END))
    assert answer["key_events_set_up"] is True and answer["leads"] == 0  # the screen says "No leads in this period"
    assert service.conversions(_scope(engine, site, END, END))["key_events_set_up"] is True


# ---- 9: only an admin changes which key events are leads ---------------------------------------------------------------


def test_a_member_cannot_change_lead_events_through_the_rules_route(engine):
    from tests.test_user_access import PASSWORD, _person, _signed_in
    from seo.accounts import service as accounts
    from seo.web import create_app

    app = create_app(engine=engine, secret_key="test-secret-key")
    with engine.begin() as conn:
        one = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('one.example', 'https://one.example/', 'own')")).lastrowid
        two = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('two.example', 'https://two.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern) VALUES (:s, 'key_event', 'generate_lead')"), {"s": one})
        lead_rule = conn.execute(text("SELECT id FROM site_rules WHERE kind = 'key_event'")).scalar()
        conn.execute(text("INSERT INTO site_rules (site_id, kind, pattern, value) VALUES (:s, 'channel', '*/x', 'Spam')"), {"s": two})
        other_rule = conn.execute(text("SELECT id FROM site_rules WHERE site_id = :s"), {"s": two}).scalar()
    accounts.create_user(engine, "boss@example.com", "Boss", "admin", password=PASSWORD, must_change=False)
    _person(engine, {"channels": "edit", "conversions": "edit"}, [one])  # chosen access: Edit on Channels, site one
    accounts.create_user(engine, "full@example.com", "Full", "member", password=PASSWORD, must_change=False)  # full access, not admin
    for email in ("helper@example.com", "full@example.com"):
        client, headers = _signed_in(app, email)
        assert client.post("/api/rules", json={"kind": "key_event", "site_id": one, "pattern": "page_view"}, headers=headers).status_code == 403
        assert client.delete(f"/api/rules/{lead_rule}", headers=headers).status_code == 403
    helper, headers = _signed_in(app, "helper@example.com")
    assert helper.delete(f"/api/rules/{other_rule}", headers=headers).status_code == 403  # another site's rule
    assert leads.ticked(engine, one) == ["generate_lead"]
    boss, headers = _signed_in(app, "boss@example.com")
    assert boss.post("/api/rules", json={"kind": "key_event", "site_id": one, "pattern": "form_submit"}, headers=headers).status_code == 201
    assert leads.ticked(engine, one) == ["generate_lead", "form_submit"]


# ---- 7, 8, 12: stored competitor events looked at again ----------------------------------------------------------------


def _rival_pages(engine, host="rival.example", n=5):
    import gzip

    from seo.crawl import store

    domain = store.get_or_create_domain(engine, host)
    footer = "copyright {y} rival cabinet de conseil tous droits réservés mentions légales"
    ids = []
    with engine.begin() as conn:
        for k in range(n):
            url = f"https://{host}/p{k}"
            conn.execute(text("INSERT INTO pages (domain_id, url, url_hash, title, content_hash, first_seen_at, extras) VALUES (:d, :u, SHA2(:u, 256), 'T', 'h', UTC_TIMESTAMP(3) - INTERVAL 90 DAY, '{}')"), {"d": domain, "u": url})
            ids.append(conn.execute(text("SELECT id FROM pages WHERE url = :u"), {"u": url}).scalar())

    def version(page, words, minutes_ago):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO page_versions (page_id, fields, text_gz, taken_at) VALUES (:p, '{}', :t, UTC_TIMESTAMP(3) - INTERVAL :m MINUTE)"),
                         {"p": page, "t": gzip.compress(words.encode()), "m": minutes_ago})

    def event(page, kind, before=None, after=None, minutes_ago=0):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO change_events (page_id, domain_id, kind, before_value, after_value, detected_at) VALUES (:p, :d, :k, :b, :a, UTC_TIMESTAMP(3) - INTERVAL :m MINUTE)"),
                         {"p": page, "d": domain, "k": kind, "b": before, "a": after, "m": minutes_ago})
    return domain, ids, footer, version, event


def _shown(engine, domain):
    with engine.connect() as conn:
        return [tuple(r) for r in conn.execute(text("SELECT e.kind, p.url FROM change_events e JOIN pages p ON p.id = e.page_id WHERE e.domain_id = :d AND e.hidden = 0 ORDER BY e.id"), {"d": domain})]


def test_a_price_moving_in_the_article_stays_an_edit_and_a_year_in_the_template_doesnt(engine):
    from seo.competitors import reclassify

    domain, ids, footer, version, event = _rival_pages(engine)
    words = ["licence commerciale en zone franche", "visa de résident pour investisseur", "compte bancaire pour une entreprise", "bureau virtuel avec adresse", "comptabilité et déclaration fiscale"]
    tails = ["délai trois semaines environ", "dossier complet sous dix jours", "rendez-vous avec la banque inclus", "courrier scanné chaque matin", "bilan annuel préparé par nos experts"]
    article = lambda k, price: f"notre offre {words[k]} {price} {tails[k]}"  # noqa: E731 - each page's own text, its own price
    for k, page in enumerate(ids):
        version(page, f"{article(k, '12,500')} {footer.format(y=2025)}", 60)
    version(ids[0], f"{article(0, '9,900')} {footer.format(y=2025)}", 10)
    event(ids[0], "content", "a", "b", minutes_ago=10)  # the price in the article: an edit
    version(ids[1], f"{article(1, '12,500')} {footer.format(y=2026)}", 5)
    event(ids[1], "content", "a", "b", minutes_ago=5)  # only the year in the footer every page shows
    with engine.begin() as conn:
        result = reclassify.classify(conn, domain)
    assert _shown(engine, domain) == [("content", "https://rival.example/p0")]  # was hidden as template too
    assert result["hidden"] == {"template": 1}


def test_a_canonical_change_alone_is_an_edit_and_an_old_redirect_does_not_mark_the_page_moved_now(engine):
    from seo.competitors import reclassify

    domain, ids, footer, version, event = _rival_pages(engine)
    for page in ids:
        version(page, f"texte {footer.format(y=2025)}", 60 * 24 * 100)
    event(ids[0], "canonical", "https://rival.example/p0", "https://rival.example/p4", minutes_ago=60 * 24 * 60)  # consolidated: a real edit
    event(ids[1], "canonical", "https://rival.example/p1", "https://rival.example/p3", minutes_ago=60 * 24 * 60)  # a redirect, 60 days ago:
    event(ids[1], "title", "T", "Target title", minutes_ago=60 * 24 * 60)  # its title moved with it
    version(ids[1], f"texte revenu {footer.format(y=2025)}", 60 * 24 * 10)  # read again 10 days ago, back to normal
    with engine.begin() as conn:
        result = reclassify.classify(conn, domain)
    assert result["redirects"] == 1
    assert _shown(engine, domain) == [("canonical", "https://rival.example/p0"), ("redirect", "https://rival.example/p1")]
    with engine.connect() as conn:
        status = dict(conn.execute(text("SELECT id, last_status FROM pages WHERE id IN :i").bindparams(__import__("sqlalchemy").bindparam("i", expanding=True)), {"i": ids[:2]}).all())
    assert status[ids[0]] != "moved" and status[ids[1]] != "moved"  # p1 was "moved" now, 60 days on


def test_the_reclassify_run_keeps_each_sites_work_in_its_own_transaction(engine, monkeypatch):
    from seo.competitors import reclassify

    one, ids, _, _, event = _rival_pages(engine, "one.example", 1)
    two, ids2, _, _, event2 = _rival_pages(engine, "two.example", 1)
    event(ids[0], "title", "Même", "Même")
    event2(ids2[0], "title", "Pareil", "Pareil")
    before, report, after = reclassify.run(engine, apply=False, log=None)  # dry run: says what, keeps nothing
    assert before["one.example"]["edit_events"] == 1 and after.get("one.example", {}).get("edit_events", 0) == 0 and len(_shown(engine, one)) == 1
    real = reclassify.classify

    def second_fails(conn, domain_id):
        if domain_id == two:
            raise RuntimeError("stopped")
        return real(conn, domain_id)

    monkeypatch.setattr(reclassify, "classify", second_fails)
    with pytest.raises(RuntimeError):
        reclassify.run(engine, apply=True, log=None)
    assert _shown(engine, one) == [] and len(_shown(engine, two)) == 1  # the first site's work was kept on its own


def test_a_site_without_google_analytics_does_not_make_the_total_mixed(engine, site):
    from seo.metrics import today as today_view

    with engine.begin() as conn:
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('no-ga.example', 'https://no-ga.example/', 'own')"))
    for n in range(56):
        _day(engine, site, END - timedelta(days=n), 10, key_events=5.0)
    leads.set_events(engine, site, ["generate_lead"])
    start = END - timedelta(days=27)
    answer = service.channels(service.Scope(engine, "all", start.isoformat(), END.isoformat()))
    assert answer["lead_kind"] == "leads" and answer["key_event_hosts"] == []
    assert today_view.today(engine, None, {"range": "28d"})["results"]["leads"]["kind"] == "leads"
