# Final fixes: Google Analytics, Search Console screens, export notes, deploy steps (2026-11-18)

Branch `final-ga-2026-11-18` (from fix-all-2026-11-17 d650b76), worktree `seo-cc-final-ga`. Nothing pushed, merged or deployed.
Sources: `accuracy/final-search-console-analytics.md` (W2b, N1, N3, N4, N6, 4c, section 5) and `accuracy/final-competitors-exports.md` (N2, N7).

Before → after are the app's own routes on `test_live_final_test` (read-only harness, Google's day fixed at 17 Nov 12:30 UTC).
GA4 28 d = 20 Oct – 16 Nov vs 22 Sep – 19 Oct (Today's own window). 3 m = 18 Aug – 16 Nov vs 17 May – 16 Aug (the review's window); "Today's window" = 17 Aug – 16 Nov vs 17 May – 16 Aug.

## Per item

| # | Item | Verdict | Before → after (live copy) | Commit | Test |
|---|---|---|---|---|---|
| 1 | W2b All sites lead rate | **Fixed** | Channels / Conversions All sites 28 d: **4.39 % (58 / 1,322) → 11.26 % (58 / 515)**; 3 m: 6.5 % → 15.4 % (Today's window 14.9 %). The two sites without key events are named: "Left out of the rate, no key events recorded: business-setup-dubai.com, comptabilite-dubai.com". A site alone with none: rate "—", not 0 %. Funnel "didn't become a lead" counts only the rate's visits. Side panels give the row's rate. Today has no rate; its Leads card already counted only sites with key events ("1 of 3 sites"). | 24ab5eb, 014ffe7, b4ccdc0 | `test_the_lead_rate_leaves_out_sites_that_record_no_key_event` (golden: 280 / 2,800 = 10 %, not 280 / 11,200 = 2.5 %), `test_the_exports_say_which_sites_are_left_out_of_the_rate` |
| 2 | N1 near-empty earlier periods | **Fixed** | business-setup-dubai.com 3 m: Visits **244 vs 26, +838.5 % → 244, no change, "Too little data before"** (Channels, Conversions, Today). All sites 28 d visits change: Channels / Conversions **−0.6 % → −18.7 %**, Today −19 % (same 1,080 vs 1,329, the two sites with a fair period). All sites 3 m: −64.1 % → −79.9 % (site 1 only; on Today's window −79.1 %, Today −79 %); "without unusual days" **+27.7 % → −23.7 %** (on Today's window −21.3 %, Today −21 %). | 24ab5eb | `test_too_little_data_before_is_judged_by_the_periods_length`, `test_all_sites_compare_only_the_sites_with_a_fair_period_before` (old code: late site +1,100 %, All sites +73.3 %; now 0 % on 1 of 2 sites) |
| 3 | N2 Overview export Countries / Devices | **Fixed** | About sheet had no note → "Countries: Country data starts on 2026-11-05: days before aren't counted." and the same for Devices (FR: "Les données par pays commencent le 5 nov. 2026 : …"). 16 months file: adds "No comparison: Google keeps 16 months of data." Goes away by itself once the backfill passes the period's start. | 014ffe7 | `test_the_overview_export_says_when_country_and_device_data_start` |
| 4 | N3 Today All sites visits card | **Fixed** | "1,322 −19 %" said nothing → "−19 % · Change on 2 of 3 sites", and the note "Visits change on 2 of 3 sites: too little data before on business-setup-dubai.com." Same note in the Today export. | 24ab5eb, b4ccdc0 | same test as 2 (`visits["compared"] == 1`, `left_out`), `test_the_exports_say_the_change_covers_fewer_sites`, `tests/js/ga4_words.test.cjs` |
| 5 | N4 "Key event rate" | **Fixed** (labelled; GA4's own per-session rate can't be computed: `ga4_key_event_daily` is empty on live and only ticked sets are read as "any of these" sessions) | "Key event rate" → **"Key event rate, at most"** (FR card "Taux évts clés (max)", export "Taux d'événements clés, au plus"), with a tip / export note: each key event counts as one visit, never more than the visits; GA4's own rate can be lower. Mixed sites: "Lead rate, at most". Never "Lead rate" while key events are counted. | 014ffe7, b4ccdc0 | `test_a_key_event_rate_is_labelled_at_most_and_points_to_settings_sites`, `ga4_words.test.cjs` |
| 6 | N6 exports' Settings path | **Fixed** | "Settings → Google Analytics" → "Settings → Sites" (EN / FR), as the screens. | 014ffe7 | `test_no_export_points_to_settings_google_analytics_any_more` |
| 7 | N7 Pages export comparison days | **Fixed** | Header had "Compared with 22 Sep – 19 Oct" (GA4) only → adds "Google numbers before: 21 Sep – 18 Oct 2026" (FR "Chiffres Google, période précédente"). | 014ffe7 | `test_the_pages_export_gives_googles_own_comparison_days` |
| 8 | "?" text already stored (4c) | **Fixed** (optional owner step) | New `scripts/reread_gsc_text.py`: dry run by default; `--apply` reads the query, page and pair reports (and queries per country when that day is kept) again for days whose stored text holds a "?", 60 days per site a run, 0.5 s between calls, recorded under coverage `gsc_text` (resumable, a second run reads nothing), refuses before utf8mb4. Dry run on the live copy: **374 days (creer-societe-dubai.fr), 408 (business-setup-dubai.com), 6 (comptabilite-dubai.com)**; `--all`: 487 / 487 / 126. About 13 runs of ~3 min. | 2c09fb5 | `test_the_days_holding_question_marks_are_read_again_once` (Arabic query and page come back, only the broken day, 3 calls, numbers untouched, second run reads nothing), `test_reading_again_refuses_before_the_conversion` |
| 9 | Deploy steps | **Fixed** | `server_release.sh`, after `alembic upgrade head`, before the switch: `python -m scripts.reclassify_competitor_events --apply` and `python scripts/mark_contradicted_checks.py --apply`, counts to screen and `var/logs/release-data-steps.log`; a failure stops with "Not switched", old code live. Rollback runs neither. Both idempotent (read + `test_competitor_noise` "again … hidden == {}", `test_serp_accuracy` "second run marks nothing"). `deploy.sh --go` ends by asking the server, reading only (`convert_utf8mb4 --pending`, exit 3 = left), and prints the exact backup → check → convert → re-read loop. DEPLOY.md "After an upload": the owner's steps in order. | 354372c | `test_a_release_runs_the_data_steps_after_its_migrations_and_logs_them`, `test_a_failed_data_step_leaves_the_old_code_running`, `test_going_back_runs_no_data_step`, `test_the_upload_reminds_of_the_utf8mb4_step_with_its_exact_commands` |

Found while testing the screens, fixed (b4ccdc0): Channels and Conversions asked Google Analytics for 21 Oct – 17 Nov
(picker's guess: yesterday), the server trimmed to 21 Oct – 16 Nov (27 days), and the head then said 20 Oct – 16 Nov. So
the screen showed 1,249 visits −20 % while Today showed 1,322 −19 % for "the same" 28 days. `UI.range.days()` now uses the
screen's learnt last day and the screen asks again once it learns it: Channels 1,322 −19 %, as Today.

All 9 new pytest tests failed on d650b76 (checked in a throw-away worktree) and pass now.

## How each rule works now

- **Lead rate:** `leads.recording()` = sites with any stored lead (ticked) or key event (unticked). SQL `{rated}` = their
  visits; `_conv_rate` divides by it. Rows, totals, days (for the card graph), page types, pages, panels.
- **Fair period before:** `ga4_checks.little_before` = days with data in the earlier period < half of its length (it
  compared with the days with data now, so 12 against 12 passed). `service.compared_sites` splits the sites;
  Channels / Conversions compare only the fair ones (`compared` = their totals now, `before` = theirs then) and send
  `little_hosts`; all little → no change, as before. The "without unusual days" change uses the same sites.
- **Today:** `_total` adds `compared` and `left_out` (host and why).

## Tests run

- Full pytest on `test_fin_ga_test`: **green** (exit 0, no failures; baseline on d650b76 also green). Changed expectations,
  all intentional: day rows and totals carry `converted` / `rated` (test_metrics, test_metrics_detail, test_ga4_numbers);
  `test_today_results_count_back…` stores GA4 on 2 days of the 28 before, now "too little before" (change blank).
- `node --test tests/js`: 12 / 12.
- Playwright `tests/ui/flow_final_ga.cjs` on a copy of the live data (`test_fin_ui_ga_test`, port 8312): Today, Channels,
  Conversions (All sites 28 d, business-setup-dubai.com 3 m) and Overview, 1440 and 390, EN and FR: **all ok**, screenshots
  looked at. Only harness noise: `/api/auth/me` 404 (no login in the harness), and Overview's live fresh days come from
  the fake Google (9,456 clicks on screen; the API on the stored data gives 622), the same on d650b76.
- Screenshots (not committed, they show real data): `/private/tmp/claude-501/-Users-alwaysimproving/2dc79d4d-aef7-4f01-b370-eabc9d54a4a7/scratchpad/fin-ga/shots/`
  (`today-28d-*`, `channels-28d-*`, `conversions-28d-*`, `channels-late-3m-*`, `overview-28d-*`, each `desk|phone`-`en|fr`).

## Files touched

`seo/metrics/{leads,service,ga4_checks,today}.py`, `seo/exports/{views_traffic,views_search,words,sentences}.py`,
`seo/collectors/gsc.py`, `scripts/reread_gsc_text.py` (new), `scripts/convert_utf8mb4.py` (`--pending`),
`design/mockups/{ga4-words,screens-live,today-view,mockup}.js`, `deploy/{server_release.sh,deploy.sh,DEPLOY.md}`, `README.md`,
tests: `tests/test_final_ga.py` (new), `tests/js/ga4_words.test.cjs` (new), `tests/ui/flow_final_ga.cjs` (new),
`tests/test_deploy.py`, `tests/test_metrics.py`, `tests/test_metrics_detail.py`, `tests/test_ga4_numbers.py`.

## For the owner

- After the next upload: back up, `convert_utf8mb4`, then the `reread_gsc_text` loop (deploy.sh prints the commands).
  Convert soon after the upload: the GA4 history re-read starts by itself and saves "?" again for non-Latin text until then.
- Then tick the lead events in Settings → Sites; the "at most" label goes once every site has leads.
- AI search's own lead rate (30-visit minimum) wasn't in this list and still counts every AI visit of All sites.
