# Fixes: one period rule everywhere (2026-11-17)

Branch `fix-periods-2026-11-17` (worktree `seo-cc-fix-periods`), from origin/main d7ac5ad. Not pushed, merged or deployed.
Area: SUMMARY section 1 items #2, #3, #4, #5, #8, #20, and section 4 patterns 1 (one period rule), 2 (one "is there earlier data?" check per table) and 4 (units carried with numbers, for exports).

## The shared code

`seo/metrics/period.py` (new) is now the only code that decides a Search Console period and what it is compared with:

- `resolve()` (moved from `search.py`, which keeps the old names as aliases): ends every preset on Google's last final day; "vs last year" is **364 days** back (same weekdays, what the browser always printed); a comparison whose earlier days aren't stored is left out with a reason, `compare_unavailable: "history"` (with `history_from`, the day stored data starts) or `"google"` (further back than Google's 16 months).
- `history()` / `rows_compare` / `rows_from`: one "is there earlier data?" check **per table** (daily totals, page, query, country, device). A day-by-day table counts as reaching back when its first row or its first read day (`coverage`) is on or before the earlier period's first day.
- `for_site()` (Insights, a page's 28 days), `scope_for()` (Today, Overview, exports), `search_scope()` (Pages, Content, a page's panel, their exports: the screen now sends `range`/`compare` beside its dates through `UI.range.days()`).
- `weeks()`: long periods are bucketed in weeks counted **back from the last day**; a short first week, and weeks before stored data starts, are counted in the totals but not drawn (`week_left_out`).
- Browser: `UI.range.served(route, window)` makes the head print the server's own dates and comparison; `UI.range.noCompareWhy()` says why there is none, in words, in the head line.

## Per item

| # | Item | Status | Proof |
|---|---|---|---|
| 2 | Head prints a comparison never made; "vs last year" 364 vs calendar | **Fixed** | `test_one_period.py::test_last_year_is_52_weeks_back_so_weekdays_line_up`, `::test_a_comparison_never_made_is_never_printed_and_says_why`; Playwright `flow_one_period.cjs` checks 1–4 |
| 3 | Exports disagree with the screen | **Fixed** | `::test_today_export_uses_the_period_on_screen_and_leads_change_is_a_count`, `::test_overview_export_gives_click_rate_in_points_and_position_in_places` |
| 4 | Same site, different 28-day clicks (Today/Overview vs Insights vs Pages/Content) | **Fixed** | `::test_the_same_28_days_give_the_same_clicks_on_every_screen` (280 everywhere), `::test_without_a_range_…`; Playwright "Pages has Today's days" |
| 5 | Gains made up from missing history | **Fixed** | `::test_page_and_search_tables_that_start_later_make_no_gains`, `::test_a_table_read_further_back_than_its_first_row_still_compares`; Playwright "page table says it is too soon to compare" |
| 8 | Long charts end in a false cliff | **Fixed** | `::test_weeks_count_back_from_the_last_day_and_a_short_first_week_is_not_drawn`; Playwright "6-month chart draws whole weeks only" |
| 20 | Chart dates under the wrong points; 2 and 9 Nov vanish | **Fixed** | `tests/js/chart_axis.test.cjs` (node --test); Playwright "last date under the last point" on Overview and AI search |

### #2 Header prints a comparison period that was never compared (daily F1)
Confirmed: the head summed its own "vs …" in the browser (`mockup.js rangeGet`) while the server returned `compare_unavailable: "history"`; yoy was 364 days in the browser and calendar dates on the server.
- One last-year rule: 364 days (`period.YOY_DAYS`), on the server and in Today's GA4 windows. Owner decision taken by the review's recommendation (weekdays line up, suits B2B sites).
- The head now prints the server's window (`UI.range.served`, called by Overview, Today, Pages). No comparison → the head reads "no comparison: Google keeps 16 months" / "no comparison: data from 16 Sept" (FR "sans comparaison : Google garde 16 mois" / "données depuis le 16 sept."), never "vs …".
- The wrong reason "Search Console doesn't keep that far back" is gone: the app now says either Google's 16 months or the day its own stored data starts (Overview line, its (i), Today's old head).
- Screens: `fixes/periods-shots/02-overview-16m-*.png`, `04-overview-yoy-*.png`, `01-overview-28d-*.png`.

### #3 Exports disagree with the screen (daily F2, ai)
Confirmed: `views_traffic.today` never passed the period (28 days always); leads change (a count) went into a % tile; Overview's click rate and position changes were % of a %.
- Today export takes the screen's `range/compare` (`export.js` now sends `UI.range.search()`), prints the shared Search Console period and comparison in its header, and says GA4's own days in a note when they differ (EN + FR pattern in `sentences.py`).
- `Tile.change_kind` carries the unit: `change` (%), `delta` (Leads +2), `points` (click rate, "−2 pts"), `places` (position, "1.3 places worse" / "recul de 1,3 place"). PDF and Excel both honour it (Excel number formats per unit). The Sites sheet's "Leads change" column is now `delta`.
- The mixed list is titled "Pages and searches going up/down" (FR added).
- Today's header range vs its own charts on screen: the head now prints the server's Search Console window; each card says its own days when GA4 ends on another day (`05-today-*.png`).

### #4 Same 28-day clicks differ between screens (daily F5, pages)
Confirmed three windows: Insights ended on its own last stored day and left out row-limited days (and their twins) from the **site total**; Pages/Content used the browser's dates ending yesterday (26 days of data against 28); a page's "28 days" ran to `date.today()`.
- Insights (`insights/data.py`) now takes `period.for_site()`. Site totals count every day; a row-limited day is still left out of the per-search split only (with its twin), listed in `split_left_out`, and what it leaves lands in "hidden".
- Content, Pages, the page panel (`page_detail`) and their exports use `period.search_scope()`; the page profile's "28 days" uses `for_site()`.
- Golden test: 10 clicks a day → 280 on Overview, Today, Insights, Pages, Content, the page profile and the page panel; before, Insights gave 270 and Pages compared 26 days with 28.

### #5 Gains made up from missing history (pages, daily F19)
Confirmed: comparison was decided on daily totals only.
- Overview: `breakdown()` only compares a table that reaches back (`compare_unavailable: "rows_history"`, `rows_from`), gaining/losing/new/lost counts are left out, the answer names no driver from such a table, `queries_before` is blank. The table says "Page data starts on 1 Nov: too soon to compare pages." (FR too).
- Insights: a period only counts as compared when the totals AND the page and search tables reach back, so no "+406 page gains" or "New queries +126".
- Pages list: `clicks_before` only when the page table reaches back.
- Demo (site-one, page tables from 1 Nov): the Overview answer now names no driver (it said "/abonnement +154").

### #8 Long charts end in a false cliff (daily F3)
Confirmed: `_group` cut weeks from the range's first day, so the last point held 1–6 days.
- `period.weeks()` counts back from the last day: the newest week is always whole. The short first week, and weeks before stored data starts, are not drawn; the (i) says "Drawn in whole weeks ending on the last day. The first N days are counted in the totals, not drawn." The export adds the same note.
- Screen: `03-overview-6m-*.png` (the demo's 6 months: 9 whole weeks, the last ending 14 Nov).

### #20 Chart date labels under the wrong points (ai)
Confirmed: up to 6 dates picked by index, then spread with `space-between`.
- `LV.axisTicks()` picks evenly spaced points counted back from the last; `LV.axisHtml()` places each date at its point's share of the width. Used by every `LV.lineChart` (AI search, Channels, Insights…) and Overview's own chart.
- Screens: `06-ai-*.png` (2 Nov and 16 Nov under their points), `01-overview-28d-phone-en.png`.

## Tests run
- `DB_NAME_TEST=test_fix_periods_test .venv/bin/pytest`: full suite green (no failures, no errors). The affected files were run again after the last change (whole-week drawing): green.
- New: `tests/test_one_period.py` (9 tests, golden numbers worked out by hand), `tests/js/chart_axis.test.cjs` (`node --test tests/js`: 2 pass).
- Updated to the new rule (each says why in the test): `test_search.py` (yoy 364 days; the fixture records that the day-by-day tables were read back far enough), `test_insights.py` (totals count the row-limited day: 280, the split still leaves it out), `test_numbers_audit.py` (16 months / 12 months prev now say "google"), `test_metrics_detail.py` (the page table reaches back to the earlier period).
- Playwright: `tests/ui/flow_one_period.cjs`, 1440 and 390 wide, English and French, on port 8291 (demo world + `seed_ai_search.py normal`): all ok. Screenshots in `reports/seo-expert-2026-11-17/fixes/periods-shots/` (not in git: `reports/` is ignored).

## Files touched
`seo/metrics/period.py` (new), `seo/metrics/search.py`, `seo/metrics/service.py`, `seo/metrics/today.py` (window keys only), `seo/pages/service.py`, `seo/insights/data.py`, `seo/insights/movement.py`, `seo/web/metrics_api.py`, `seo/web/pages_api.py`, `seo/exports/{model,fmt,pdf_out,xlsx_out,views_traffic,views_search,sentences,words}.py`, `design/mockups/{mockup,overview-view,today-view,today-live,pages-view,screens-live,export}.js`, `design/mockups/screens-live.css`, `README.md` (the rule), tests above.

## For the owner
- **"vs last year" is now 364 days** (same weekdays) everywhere, as the review recommended; it was calendar dates on the server and 364 days in the head. Say if you want calendar dates instead: it is one constant, `period.YOY_DAYS`.
- Insights waits ("needs history") while page and search tables are still being read after a new connection, instead of showing causes made up from empty days. Overview still shows the site's total change at once.
- Demo-only, not a bug: `seed_ai_search.py` marks site-one's Search Console as through 16 Nov while its daily totals stop on 14 Nov, so Today shows 26 days of clicks in a 28-day window after that seed.

## Commits
4c7f766 (shared period, Insights, Pages, Content, per-table check, weeks), 8427f34 (exports and units), 5909e40 (head, Today cards, chart dates, flows), and this report.
