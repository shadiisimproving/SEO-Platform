# Code review fixes on fix-all-2026-11-17 (2026-11-17)

Source: the review of `git diff origin/main...fix-all-2026-11-17` (items 1-6, 9, 10; items 7 and 8 are in keyword files another agent owns and weren't touched).
Every item was reproduced first: the new tests in `tests/test_review_fixes.py` were run against the commit before the fixes (10ebb1d) and all 13 bug tests failed there for the reason the review gives. They pass now.

| # | Item | Result | Commit | Test (tests/test_review_fixes.py) |
|---|------|--------|--------|------|
| 1 | Overview "See page" on saved data compared a page table that starts late (+250% made up) | Fixed | 2a43f1f | `test_see_page_on_saved_data_makes_no_gain_from_a_page_table_that_starts_late` |
| 2 | Today: every page "New" under Going up while the page table fills; partial earlier week = fake gains | Fixed | d87ccdd | `test_today_names_no_page_new_while_the_page_table_holds_only_this_week`, `test_today_makes_no_gain_from_an_earlier_week_stored_in_part`, `test_today_says_new_when_the_earlier_week_was_read_and_the_page_had_nothing` |
| 3 | Link gaps: a domain a newer file marks all lost stayed; a live link on a page with a lost one was dropped | Fixed | 829bee5 | `test_a_domain_whose_links_the_newer_file_marks_lost_leaves_link_gaps`, `test_a_live_link_on_the_same_page_as_a_lost_one_is_kept`, `test_a_domain_also_in_common_crawl_stays_but_loses_the_files_old_numbers` |
| 4 | Insights > Technical "N problems on pages Google didn't show" counted listed pages and double counted | Fixed | d910036 | `test_technical_counts_only_pages_not_already_listed_and_each_once` |
| 5 | Pages: a page that fell to 0 clicks and was never read wasn't under Losing clicks | Fixed | 194d97f | `test_a_page_that_fell_to_nothing_and_was_never_read_is_listed_as_losing` |
| 6 | Leads drop: Mark seen lasted one day; a "warn" leads drop sat under every "crit" page drop | Fixed | d87ccdd | `test_a_leads_drop_marked_seen_stays_hidden_when_ga4_adds_a_day`, `test_a_warn_leads_drop_goes_above_a_crit_page_drop` |
| 9 | period.for_site crashed for lengths other than 7/28; weeks() could draw the two lines a week apart | Fixed | 2a43f1f | `test_for_site_works_for_any_number_of_days`, `test_both_chart_lines_leave_out_the_same_weeks` |
| 10 | Today's `todo_drops` / `moves_window` leaked drops a limited login can't see | Fixed | d87ccdd | `test_today_counts_for_a_limited_login_leave_out_rows_it_cannot_see` |

## What changed

1. `seo/metrics/search.py` `overview()`: on saved data, one page is compared only when `period.rows_compared(scope, "page")`. When it isn't, the answer has no `before`, no `compare_series`, no comparison in the sentence, and `compare_unavailable: "rows_history"`, `compare_from/to: null`, and `history_from` set to the page table's first day. The head then says "No comparison: stored data starts on 8 Nov" ("Sans comparaison … commencent le 8 nov" in French), as in the other no-comparison cases (`overview-view.js` `noCompareWhy` now reads `rows_history` too; the head picker already did). The live branch is unchanged (Google answers for 16 months).
2. `seo/metrics/today.py` `_page_moves()`: a site is compared only when the page table's first day (stored rows or days read in `coverage`, the period rule's own check) is on or before the first day of the week before. So no page is "New", and no gain comes from a half-stored week. "New" now always means the week before was read and the page truly had 0. Test helpers in `test_today_fixes.py` / `test_metrics.py` now also mark their two weeks as read, as the real pull does.
3. `seo/competitors/gaps.py` `import_referrers()`: lost is read per link (the file's rows and its links line up one to one), so a live link on the same page as a lost one is kept. A domain whose rows in this file are all lost is deleted from `competitor_referrers` if it came only from a file. If it is also in Common Crawl, the row stays but loses the file's sample URL, score, spam score and followed flag. Rows added by hand are never touched.
4. `seo/insights/service.py` `technical_elsewhere()`: one set of pages (site + path, where /a and /a/ are one page): pages flagged by the last health test, plus pages URL Inspection says aren't on Google, minus pages Google showed in the last 7 days (Technical lists those already). Each page is counted once. The note now counts pages: "2 pages Google didn't show this week have a problem." / "2 pages que Google n'a pas montrées cette semaine ont un problème." **NEUTRAL decision:** "Excluded" still counts as not on Google (crawled/discovered not indexed, noindex, 404 are real problems). Two exclusions are on purpose and are no longer counted: "Alternate page with proper canonical tag" and "Page with redirect". PARTIAL (indexed, with warnings) counts as on Google. This one rule (`movement.NOT_ON_GOOGLE`) is shared with Technical's own rows.
5. `seo/pages/service.py` `listing()`: for a site that is compared, a page with clicks only in the earlier period gets its row, with 0 clicks now and its earlier clicks, so a deindexed or 404 page is first under Losing clicks.
6. Leads drop: the "Mark seen" key is one per site (as a page drop has one per page). It hides for 7 days, then comes back if the drop is still there. **Order chosen:** leads drops get their own place at the top of "what is being lost", whatever their severity. Then come severity and clicks at stake, as before for everything else. Clicks and leads can't be weighed on one scale, and the existing docstring and test say leads go first.
9. `period.for_site(days)` builds any other length as a custom period ending on the last final day. The new `period.weeks_pair()` buckets both lines and drops the same number of short first weeks from each. `overview()` uses it when there is a comparison. `weeks()` keeps its old results.
10. `today.for_person()` works out `todo_drops` again from the rows the person may see. `moves_window` is cleared when Going up and down were emptied for them.

## Tests run
- Full pytest on `test_fix_merge_test`: 3038 passed, 0 failed.
- `node --test tests/js`: 5/5 pass.
- UI on `test_fix_ui_merge_test`, port 8296:
  - `flow_today_fixes.cjs`: all ok.
  - `flow_links_numbers_true.cjs`: ALL PASS.
  - `flow_pages_screen.cjs`: 28/28.
  - `flow_one_period.cjs`: all pass except 4 checks, "AI chart's last date under the last point" (desk/phone × en/fr). These 4 fail the same way on 10ebb1d, the commit before these fixes, run against the same seeded world, so the fixes didn't cause them. The AI search chart was not touched.
- Changed screens checked by hand at 1440 and 390, English and French. The screenshots are in `review-fixes-shots/`:
  - Overview "See page" with no page history: the head says "No comparison", with "stored data starts on 8 Nov" in its explanation.
  - Insights > Technical's note counts pages.
  - No sideways scroll.

## Files touched
`seo/metrics/search.py`, `seo/metrics/period.py`, `seo/metrics/today.py`, `seo/competitors/gaps.py`, `seo/insights/service.py`, `seo/insights/movement.py`, `seo/pages/service.py`, `design/mockups/overview-view.js`, `design/mockups/insights-view.js`, `tests/test_review_fixes.py` (new), `tests/test_today_fixes.py`, `tests/test_metrics.py`, `tests/test_insights_catalogue.py` (expected count is now the union: 4 pages, not 3 + 1 added on screen).
