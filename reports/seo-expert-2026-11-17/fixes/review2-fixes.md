# Code review round 2 fixes (2026-11-18)

Branch `fix-review2-2026-11-18` (from fix-all-2026-11-17 ecfe200). Nothing pushed, merged or deployed.
Golden tests: `tests/test_review2_fixes.py` unless said otherwise. Each new test was run against the old code first and failed.

| # | Finding | Result | Commit | Proof |
|---|---------|--------|--------|-------|
| 1 | A visit with two ticked lead events counted twice | Fixed | 544e8bc | `test_three_enquiries_firing_form_submit_and_generate_lead_are_three_leads` (3 enquiries, both events: 3, was 6); `test_after_a_tick_change_a_day_counts_its_biggest_event_until_it_is_read_again` (3 then 4 after the re-read) |
| 2 | "Visits change without those days" compared different numbers of days | Fixed | 19bdf3d | `test_a_steady_100_a_day_with_a_5_day_burst_is_no_change` (0%, was -17.9%); old test in test_ga4_numbers now 0.0 (was -16.1, the bug) |
| 3 | Panel lead rate disagreed with its row; sources/mediums rate 0 | Fixed | 62c29c1 | `test_the_channel_panel_rate_is_the_rows_and_its_sources_have_one` (0.5 everywhere, panel said 1.0, sources 0.0); `test_the_assistant_row_and_panel_give_the_same_rate` |
| 4 | "Leads" meant different things on Today and the other screens | Fixed | 28008b2, 4f081b3 | `test_all_sites_count_the_same_leads_on_today_and_channels_when_only_one_site_picked` (28 x (2 + 4) on both); `test_a_site_without_google_analytics_does_not_make_the_total_mixed` |
| 5 | GA4 "days left" never reached 0 | Fixed | 544e8bc | `test_days_older_than_the_window_are_not_counted_as_left_to_read` (3, was 13; then 0) |
| 6 | Competitor with a cut sitemap never finished its first read | Fixed | a238528 | `tests/test_competitor_noise.py::test_a_sitemap_file_that_keeps_failing_ends_the_first_read_after_a_few_days_and_says_why`, `::test_more_sitemap_files_than_the_app_reads_does_not_hold_the_first_read` |
| 7 | Reclassify hid price/year edits in the main text | Fixed | ccf2026 | `test_a_price_moving_in_the_article_stays_an_edit_and_a_year_in_the_template_doesnt` |
| 8 | Reclassify took any canonical change for a redirect, marked old pages moved | Fixed | ccf2026 | `test_a_canonical_change_alone_is_an_edit_and_an_old_redirect_does_not_mark_the_page_moved_now` |
| 9 | A member could change lead events through POST/DELETE /api/rules | Fixed | 98e0fd6 | `test_a_member_cannot_change_lead_events_through_the_rules_route` (chosen-access and full-access members: 403; another site's rule: 403; admin: 201) |
| 10 | Two glitched answers of one tool marked another tool's check suspect | Fixed | b37b9ae | `tests/test_serp_accuracy.py::test_one_tools_two_glitched_answers_never_mark_another_tools_check` |
| 11 | GA4 re-read ran back to back until Google refused | Fixed | 544e8bc | `test_the_history_is_read_again_a_batch_a_run_and_a_quota_stop_is_not_a_failure`; `test_old_days_are_read_again...` now 4 runs of 30 |
| 12 | Reclassify held one transaction over every domain | Fixed | ccf2026 | `test_the_reclassify_run_keeps_each_sites_work_in_its_own_transaction` |
| 13 | Extra version per page / disk check undocumented | Fixed | 083028f | `deploy/DEPLOY.md`, section "One-time costs of the November 2026 accuracy fixes" |
| S1 | Burst runs swallowed normal days between two bursts | Fixed | 19bdf3d | `test_a_normal_day_between_two_bursts_stays_in` |
| S2 | AI search said "Not set up" when ticked events didn't fire | Fixed | 28008b2 | `test_ticked_events_that_did_not_fire_say_no_leads_not_not_set_up`; card says "No leads in this period" |
| S3 | Settings didn't warn while history is read | Fixed | 28008b2 | `review2-shots/settings-reread-*.png` |
| + | Overview "Week by week" axis cut on a phone (coordinator) | Fixed | 9260506 | `review2-shots/overview-chart-*.png`, flow check "the chart's axis numbers fit" |

## How each fix works

1. **Leads once per visit.** With two or more ticked events, `_one_day` runs one more report per table, filtered on
   `eventName IN (ticked)` with no eventName dimension, so GA4 counts each session once. Those rows are stored in
   `ga4_key_event_daily` under report `L-<table>` and the hash of the ticked set (no new table, no migration);
   coverage `ga4_leads` (note = set hash) records which set a day was read for. `leads.recompute` uses them when the
   set matches, else the biggest ticked event's sessions (a lower bound, exact with one tick). A tick change queues a
   union-only re-read (4 calls a day) through the same batched backlog. With one tick nothing extra is read.
2. **Per day.** `ga4_checks.unusual_change` compares visits a day: each site's kept visits over its kept days with
   data, added across sites. Today's total uses the same per-day figures. Runs keep their own day list, so only marked
   days are left out.
3. **Panels.** Every panel adds up `conv` (LEAST(key events, visits) row by row, or leads) as the row does: channel
   (with its sources and mediums), referrer, page, assistant. AI search's own rows use it too (`ai_search._rate`).
4. **One rule.** `leads.kind` is now `leads` / `key_events` / `mixed` (only sites with GA4 rows count). In a mixed
   scope `Scope.lead_sql` writes `IF(site_id IN (picked), leads, key_events)` (and the LEAST form for conv), the same
   rule Today uses per site. Mixed totals read "Leads and key events" / "Leads et événements clés", with a note naming
   the sites still counting every key event (screens and exports, EN/FR).
5. `days_to_reread` counts only days inside the 425-day window collect() reads. Days older than that keep the old layout
   (they aren't re-read or pruned: pruning would delete the owner's data).
6. More sitemap files than MAX_SITEMAPS is treated like a capped list (it is the same every day). A failed file holds the
   first read at most `FIRST_PASS_WAIT_DAYS` (3) from the domain's first page seen. The reading box says
   "Part of the sitemap didn't load. The first read waits a few days for the whole list." while it waits and
   "Sitemap incomplete: new pages may be missed." after (EN/FR, with a tip). No migration: the state is the crawl message.
7. Words are compared with their numbers; numbers are only normalised to find the site's repeated runs.
8. Redirect = canonical change plus at least one other event of the page within 5 s. The page gets `moved` only if no
   later version or event of it exists.
9. `POST /api/rules` with kind key_event goes through `require_admin()` and `leads.set_events`; `service.add_rule`
   refuses key_event. `DELETE /api/rules/<id>` needs an admin for key_event and checks the rule's site
   (`require_site_or_every`).
10. A backing check must be another tool, or the same tool on the same keyword at least 12 h later; a same-tool accent
    twin never backs. **Dry run of `scripts/mark_contradicted_checks.py` on `test_live_new_test` (read only): before
    36 (31 SerpApi, 3 Searlo, 2 HasData), after 34 (30 SerpApi, 3 Searlo, 1 HasData).** The earlier "38 of 79" was on an
    older copy; this copy has 75 ok SerpApi checks and 7 already suspect.
11. At most `BACKLOG_DAYS_PER_RUN` (30) old days per run, then `RunAgain(3600)` (collect returns `ga4.LATER`). New and
    recent days are read as before. A quota refusal during the backlog returns LATER without `last_error`.
12. `reclassify.run(engine, apply)` opens one transaction per domain and commits or rolls back at once.
13. Deploy notes: disk check commands, DB copy, GA4 re-read time (about 15 hours for 425 days), reclassify order.

Overview axis: from 1,000 on the left axis uses compact numbers (2.8K, FR 2,8 k) and labels never wrap.

## Tests run

- Full pytest on `test_fix_rv2_test`: all green (exit 0, about 3,150 tests, no failure or error; `test_text_all_scripts.py` passed too).
- `node --test tests/js`: 6 pass, 0 fail.
- Playwright (port 8306, `test_fix_ui_rv2_test`):
  - `flow_ga4_numbers.cjs`: all passed (desk/phone, EN/FR).
  - `flow_review2_fixes.cjs` (new): Settings history warning, Overview axis fit, competitor cut sitemap; EN/FR, 1440/390.
  - `flow_competitor_reading.cjs`: all passed. `flow_links_numbers_true.cjs`: all passed.
  - `flow_today_numbers.cjs`: 1 fail, "Insights before any run says Run, not Run again": depends on whether the harness
    worker already ran Insights; not touched here.
  - `flow_row_panels.cjs`: lead and rate checks pass; 6 fails on the page panel's Google clicks chart, foot order and
    French search-section title, which need the Search Console read the flow's header asks for (not done on this
    harness). Not related to these fixes.

Screenshots: `review2-shots/` (Settings warning, Overview chart, competitor reading box, Today with the mixed total).
Known look issue: on a 390 px phone, the Today card label "Leads et événements clés" is cut with an ellipsis (its (i)
and the note under the cards say it whole).
