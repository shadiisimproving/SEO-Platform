# Fixes: Google Analytics numbers (2026-11-18)

Branch `fix-ga4-2026-11-18` (from fix-all-2026-11-17 d621cd8). Not pushed, not merged, not deployed.
Evidence: `accuracy/analytics.md` and `accuracy/analytics-critique.md` (W1, W2, W3, W5, W6, W8, W9, W10, W11).
Screenshots on made-up sites: `reports/seo-expert-2026-11-17/fixes/ga4-shots/` (desktop 1440 and phone 390, English and French).
Screenshots on the live-data copy stay out of git (real data): `/private/tmp/claude-501/-Users-alwaysimproving/2dc79d4d-aef7-4f01-b370-eabc9d54a4a7/scratchpad/shots4/live-*.png`.

## Per item

| # | Item | Result | Proof |
|---|---|---|---|
| W1 | "Leads" are every GA4 key event | **Fixed** (owner ticks after deploy) | `tests/test_ga4_numbers.py::test_a_referral_without_campaign_is_stored_and_another_sites_visits_are_left_out`, `::test_ticked_key_events_are_the_leads_on_every_table_and_past_days`; flow `tests/ui/flow_ga4_numbers.cjs` |
| W1 | Lead tracking changed (19 Jan stop, 2 Mar one per visit, 19 Jun end) | **Fixed** | `::test_the_days_ga4_changed_how_it_counts_are_found`, `::test_a_leads_change_across_a_tracking_change_is_left_out` |
| W1 | Insights "leads at stake" | **Fixed** | `test_insights_catalogue.py::test_leads_rank_a_lead_page_first...` (kind), window starts after a tracking change |
| W2 | Another website's visits counted | **Fixed** (needs the history re-read, automatic) | `::test_a_referral_without_campaign...` (57 own of 77), `::test_other_hosts_warn_when_they_are_a_tenth_of_the_visits`, `::test_own_host_takes_www_and_subdomains` |
| W2 | Re-read of history, resumable | **Fixed** | `::test_old_days_are_read_again_newest_first_and_empty_ones_are_skipped` |
| W3 | `ga4_referral_daily` always empty | **Fixed** (fills on the re-read) | `::test_a_referral_without_campaign...` (`blog.example /a/ 4` stored), `test_ai_search.py::test_landing_pages_take_tagged_visits_once` |
| W5 | Copilot card misses Bing | **Fixed**: Copilot and Bing search are two columns | `::test_copilot_card_shows_bing_search_apart_from_copilot`, `test_ai_search.py::test_copilot_citations_are_set_against_copilot_and_bing_visits_only_on_the_files_days` |
| W9 | AI list misses perplexity, copilot.com | **Fixed** | `::test_perplexity_and_copilot_com_count_as_ai` |
| W6 | +24,100% against an empty past | **Fixed** | `::test_no_change_against_a_period_with_almost_no_data` |
| W8 | Lead rate over 100%, "didn't become a lead" negative | **Fixed** | `::test_lead_rate_is_visits_with_a_key_event_never_over_100_percent` |
| W10 | Clarity card one day off | **Fixed** | `::test_the_clarity_card_reads_the_day_a_read_covers`, `test_extras.py::test_clarity_totals...` |
| W11 | Bursts drive long-period changes | **Fixed** on Today and Channels (Overview has no GA4 chart) | `::test_a_burst_of_visits_is_marked_and_the_change_is_given_without_it` |

## What changed

**Collector** (`seo/collectors/ga4.py`, migration `a3c5e7f9b1d4`):
- Every report also asks for `hostName`. Rows on another website's host are kept out of every table; `ga4_host_daily` keeps each host's visits per day (own or not). www and subdomains are the site's; "(not set)" stays the site's.
- Four more reports per day split key events by `eventName` (filtered on `isKeyEvent = true`), for the source, page, referral and campaign rows: `ga4_key_event_daily` (key events and the sessions they happened in, per row and event).
- "(referral)", "(organic)", "(direct)" count as "no campaign" (`NO_CAMPAIGN`), so plain referrals reach `ga4_referral_daily` (W3).
- Coverage source `ga4_v2` marks a day read this way. Every day the old layout read is read again, newest first, by the same resumable loop as a first connection (a stopped run carries on; a limit reached stops for the day). Days the old layout found empty are not read again.

**Leads** (`seo/metrics/leads.py`): a site's leads are the key events ticked "Counts as a lead" (site_rules kind `key_event`, which existed and was never read). Each GA4 row's new `leads` column is the visits of that row with a ticked key event, at most its visits, worked out again for all past days when the ticks change. Until a site ticks one, screens count GA4's key events and say **Key events**, with one line: "Counting every Google Analytics key event, not only enquiries. Pick which are leads in Settings → Sites." A scope's SQL writes `{leads}` / `{conv}`; `Scope.fetch` fills in the column, so every screen uses one rule.

**Checks** (`seo/metrics/ga4_checks.py`), one place for every screen:
- `tracking_changes`: weeks where key events per visit stop (≥ 5 expected a week, 2 weeks running), start, or jump ×3 to or from about one per visit; unusual (burst) days left out; the exact day found within the week. A change across one blanks the leads change and says the day. A stop still raises the "leads fell" to-do (a broken form and a broken tag both need the owner); a jump never does.
- `little_before`: the earlier period has data on fewer than half as many days as the period: no change, "Too little data before".
- `unusual_days`: a day ≥ 5× the median of the 91 days around it and ≥ 50 visits more. Dots on Today's visits graph (this period and the period before) and on Channels' chart, a line naming the run, and the change without those days.
- `other_hosts`: other hosts ≥ 10% of the last 28 days' visits: warning in Settings → Sites and on Today.

**Rates**: a lead rate is visits with a lead (or with a key event: `LEAST(key_events, sessions)` per row) over visits, so never over 100%; "visits didn't become a lead" is never below 0 (`service.conversions`, panels, AI search, Insights).

**Screens**: Today, Channels, Conversions, Content, AI search, the row panels and the exports say Key events / Key event rate until leads are picked (`design/mockups/ga4-words.js`, `exports/views_traffic._lead_words`), in English and French. Settings → Sites has a "Leads from Google Analytics" card: each site's key events with a tick box, counts and last day, Save (admin only), the other-website warning and the days still to re-read. AI search's Copilot table has "Copilot visits" and "Bing search visits"; "Cited, no visit" only when both are 0. The Clarity card reads the day each read covers (`day + 1`), as AI search does.

## Before → after on the live-data copy (`test_live_ga4_test`, the 17 Nov snapshot)

"Before" is the live code's figure from `accuracy/analytics.md` (same snapshot). "After" was worked out with this branch.

| Number | Before | After |
|---|---|---|
| Today, site 1, 3 months: leads | "Leads 294, −1,959" | "Key events 294", change blank, "GA4 stopped counting a key event on most visits on 19 Jun 2026. So no change is shown." |
| Lead tracking changes found, site 1 | none | 19 Jan 2026 stopped, 2 Mar 2026 started at ~1.06 per visit, 19 Jun 2026 fell (1.37 → 0.43): the report's days |
| Conversions, site 1, 3 months | leads −87%, "before" rate 28% | leads change and rate change blank, lead check names 19 Jun |
| Today, site 1, 3 months: visits | −79% with nothing said | −79%, plus "Unusual days 1 Aug – 15 Aug 2026: 6,209 visits, about 14 a day usually" and "Visits change without those days: −8%" (Channels −9.7%, Conversions −11.6% on their own periods) |
| Today, business-setup-dubai.com, 28 days | +24,100% (242 against 1) | 242, no change, "too little before" |
| Today, All sites visits change | −0.6% | −19% (like with like: sites with a fair earlier period only) |
| Conversions, Paid Other, 28 days | rate 200%, lost −2 | 2 visits, 4 key events, rate 100%, lost 0 |
| Copilot card (31 Jul – 6 Nov file) | "Copilot and Bing visits" 0 everywhere, 37 pages "cited, no visit" | Copilot visits 0, Bing search visits 38, 29 pages "cited, no visit" |
| AI visits, site 1, 12 months | 167 | 179 (perplexity 9 + copilot.com 3) |
| Content › Clarity card, site 1, 28 days | 147 sessions | 165 sessions, through 16 Nov |
| Insights site lead rate (90 days) | 18.17% (key events per visit) | 13.5% (visits with a key event); labelled key events |
| Today to-do | "Leads fell 45%: 116 → 64" | "Key events fell 45%: 116 → 64" (28 days cross no change) |
| `ga4_referral_daily` rows | 0 | 0 on the copy (no GA4 access here); filled by the re-read after deploy. Content AI visits, page panel and referrer landing pages read it |
| comptabilite-dubai.com visits, 28 days | 565 | 565 on the copy until the re-read; then only its own host: about 255 by the report's page split (310 visits land on creer-societe-dubai.fr-only pages), and Settings and Today warn "also records creer-societe-dubai.fr" |

The last two can't be shown on the copy: they need GA4's `hostName` and the fixed referral report, which only the re-read brings. The tests prove them on a fake GA4 with a known answer (57 own visits of 77; `blog.example /a/ 4`).

## Tests run

- `DB_NAME_TEST=test_fix_ga4_test .venv/bin/pytest`: all green on commit cf4fb19 (exit 0, every test passed, including `test_text_all_scripts.py`). Tests changed on purpose: the Clarity card's day (W10), "Key events" labels while no lead event is picked, the `converted` total beside leads, the Copilot/Bing split, and the name-driven GA4 fake.
- `node --test tests/js`: 5 / 5 pass.
- `tests/ui/flow_ga4_numbers.cjs` on the harness (`tests/ui/seed_ga4.py` reads the fake GA4 through the real collector) and on the live copy served read-only: all checks pass, desktop 1440 and phone 390, English and French, no script errors. Screenshots looked at: Settings card, Today (key events, leads picked, other-website warning, notes box, burst dots), Conversions, Channels, AI search.

## Files touched

`seo/collectors/ga4.py`, `seo/core/models.py`, `migrations/versions/20261118_a3c5e7f9b1d4_ga4_key_events_and_hosts.py`, `seo/metrics/leads.py` (new), `seo/metrics/ga4_checks.py` (new), `seo/metrics/service.py`, `seo/metrics/today.py`, `seo/metrics/ai_search.py`, `seo/metrics/backlink_traffic.py`, `seo/insights/value.py`, `seo/exports/views_traffic.py`, `seo/exports/words.py`, `seo/web/metrics_api.py`, `seo/accounts/endpoints.py`; `design/mockups/ga4-words.js` (new), `index.html`, `screens-live.js`, `today-view.js`, `today-live.js`, `ai-search-view.js`, `row-panel.js`, `settings-live.js`, `shared-ui.js`, `screen-parts.css`, `screens-live.css`; tests `tests/ga4_fake.py` (new), `tests/test_ga4_numbers.py` (new), `tests/test_collectors.py`, `tests/test_ai_search.py`, `tests/test_extras.py`, `tests/test_metrics.py`, `tests/test_metrics_detail.py`, `tests/test_insights_catalogue.py`, `tests/test_one_period.py`, `tests/test_today_fixes.py`, `tests/ui/fake_google.py`, `tests/ui/seed_ga4.py` (new), `tests/ui/flow_ga4_numbers.cjs` (new).

## Left as it is, and why

- Google Ads keeps all key events (its screen is "Soon", not shown); its report has no host either (ad clicks can't be split by host).
- Overview shows Search Console only, so there is no GA4 chart there to mark.
- 12-month views: the Sep 2025 – Feb 2026 YouTube ads traffic is real paid traffic, not a burst, so it isn't marked (report: Explained).

## What the owner must do after deploy

1. Run the migration (the release does). The GA4 collector then reads the whole history again, newest first, 9 reports a day per property; it carries on by itself across runs. Settings → Sites shows the days left.
2. When it has read the last weeks, open **Settings → Sites → Leads from Google Analytics** and tick the key events that are real enquiries, per site (for site 1, check which event fired on every visit from 2 Mar to 18 Jun; the report's GA4 export 1 settles it). Until then every screen says "Key events".
3. If Settings or Today warns that comptabilite-dubai.com's property "also records creer-societe-dubai.fr", check that property's data streams in GA4 (Admin → Data streams). Its visits from the other site are already left out.
4. Optional, in GA4: add calendly.com and typeform.com to "List unwanted referrals" (report E3).
