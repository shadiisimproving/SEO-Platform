# Fixes: Search Console screen numbers, round 2 (2026-11-18)

Branch `fix-gsc2-2026-11-18` (from `fix-all-2026-11-17` d621cd8). Not pushed, not merged, not deployed.

Commits:

| Commit | What |
|---|---|
| c35a6f4 | Jump links |
| ba4449c | Alert |
| e4a6ca8 | Why order |
| e300fc5 | Exports |
| efc5602 | Saved 24 h |
| 368678c | 16 months |
| 25f9c45 | Tests and flow |

Evidence: `accuracy/search-console.md` 3.3, 3.5, 3.6, 3.8, 3.9 and 4b, with its critique, and `accuracy/competitors-exports.md` W12, W13 and W15.

**Live-data copy.** The dump `live-2026-11-17.sql.gz` was gone from the scratchpad (the temp folder was cleared at 09:28). I loaded `test_live_gsc2_test` from `test_live_snap_test` instead. That database is the same dump, loaded unchanged and only ever read. I then ran `upgrade_to_head` on it and added an empty `jobs` table, which the snapshot lacks. Real data stays in that database. Nothing from it is in git.

Every "before" figure below comes from this branch's base code on the copy. Every "after" figure comes from the fixed code on the same copy. Site 3 is business-setup-dubai.com and site 1 is creer-societe-dubai.fr. The period is 28 days, 19 Oct – 15 Nov, against 21 Sep – 18 Oct.

## Per item

### 1. `#section` jump links (3.3): **Fixed**

- **Cause:** `_path()` drops the `#…` part, so Content, Pages, the page profile and the page panel added every jump-link URL into its page.
- **Fix:** one rule, `metrics.service.is_jump_link()`.
  - A page's clicks, impressions, click rate and position now come from its own address.
  - Jump-link impressions are kept apart, as `jump_impressions` (Content, Pages, profile) and `jump` (panel).
  - Pages' "clicks before" leaves jump links out too.
  - "Two pages compete" (`search._competing`) treats a page and its `#…` URLs as one page. The page's own address speaks for it.
- **On screen:** "Jump links: N impressions" / "Liens vers une section : N impressions".
  - It shows under the page on Content and on the Pages list.
  - On the page view it is under Position.
  - In the page panel it is on the line under the page name.
  - It only appears when a page has jump links.
- **Exports:** Content and Pages get a "Jump-link impressions" column. The single-page export gets a tile.

| Live copy, passport page, 28 d | Before | After | Truth (Search Console URL) |
|---|---|---|---|
| Content / Pages / profile / panel: impressions | 12,113 | **5,436** (+ jump links 6,677) | 5,436 |
| Click rate | 0.38% | **0.85%** | 0.85% |
| Position | 8.1 | **7.0** | 7.0 |
| Clicks | 46 | 46 | 46 |
| Panel, "lost passport in uae fees" | 1 / 170 / 8.4 | 1 / 28 / 8.1 (the other 142 impressions are jump-link pairs, checked in SQL) | own address 1 / 28 / 8.1 |
| "Two pages compete", site 3 | 4 rows, 3 of them a page against its own anchors (couples, single woman, lost passport) | **1 row** (business setup services dubai: /services/ 56%, / 23%, consultants 21%) | 1 |
| "Two pages compete", site 1 | 52 | 52 | 52, no fragments |

- **Tests:**
  - `tests/test_gsc_screen_numbers.py::test_content_and_pages_count_a_page_from_its_own_address_and_jump_links_apart`
  - `::test_page_profile_and_panel_count_the_page_from_its_own_address`
  - `::test_two_pages_compete_never_pits_a_page_against_its_own_jump_links`
  - The golden numbers are 280 / 2,800 / 5.0, a 10% click rate, and 2,800 jump-link impressions. The old code gave 5,600 and 7.0.
- **Screenshots:** `gsc2-shots/01-content-*`, `01b-content-panel-*`, `02-pages-list-*`, `03-page-view-*`.

### 2. Today's big-drop alert (3.5): **Fixed**

- **Cause:** `insights/engine.py` `_alerts`. When an alert was already raised for the same open finding, it hit `continue` and never refreshed the alert.
- **Fix:** every run now updates the alert's title and its "~N clicks/month at stake" from the finding's numbers in that run. Today ranks on that stake.

| Live copy, alert 9, site 1 | Before | After (one insights run) | Finding 27 |
|---|---|---|---|
| Alert title | "/liste-des-medicaments-interdits-a-dubai/ lost 60% of its Google clicks" | "/liste-des-medicaments-interdits-a-dubai/: −57% Google clicks" | −57% (101 → 43) |
| Today detail / stake it ranks on | ~80 clicks/month, stake 80 | **~62 clicks/month, stake 62** | at_stake 62.1 |

- **Test:** `::test_a_raised_alert_takes_the_findings_new_numbers_and_today_ranks_on_them`

### 3. Insights "Why" list (3.6): **Fixed**

- **Server:** `movement.py` stores no `main` when hidden searches are more than half of the change.
- **Screen:** `insights-view.js` `moveLists`.
  - When hidden searches are more than half of the change, they are listed first, at full strength rather than greyed, with their tip.
  - Otherwise the order is as before.
  - The head and the "Main cause" badge never name a part over a fall led by hidden searches. That also covers findings stored before the fix.

| Live copy, site 1, clicks 501 → 411 (−90) | Before | After |
|---|---|---|
| Stored `main` | "appeal" (lower click rate −24) | **none** |
| "Why" order | +29 more searches, −24, −14, −7, +6, then −80 hidden, greyed | **−80 hidden first**, not greyed, then +29, −24, −14, −7, +6 |
| Parts (unchanged, they add up) | demand 29, ranking −14, appeal −24, new 6, lost −7, hidden −80 | same |

- **Test:** `::test_when_hidden_searches_are_most_of_the_change_no_main_cause_is_named`. A −140 fall with hidden −112 now has `main` None; it used to be "appeal".
- **Playwright:** the first "Why" row is "Hidden searches −80" and has no `quiet` class.
- **Screenshot:** `gsc2-shots/04-insights-why-*`.

### 4. Exports: **Fixed**

- **Pages and Content (3.8, W13):** when Google's dates differ from the dates picked, the header gives them as a separate row: "Google numbers: 19 Oct – 15 Nov 2026" / "Chiffres Google".
  - The Pages export also gets "Clicks before" and "Change", as on the screen, whenever a comparison exists.
  - Both exports get "Jump-link impressions".
- **Overview charts (W12):** only the counted days are drawn. When provisional days were left out, a note says so (EN and FR).
- **Overview Excel position (W15):** the change now uses the Keywords sign, where + means places gained.
  - The format is `+0.0" places better";-0.0" places worse";"same place"`, or in French `places gagnées / places perdues / même place`.
  - The tile keeps now − before, so the PDF's words ("6.7 places worse") are unchanged.

| Live copy, site 3 | Before | After |
|---|---|---|
| Pages / Content export header | period 20 Oct – 16 Nov only | period 20 Oct – 16 Nov, plus **Google numbers 19 Oct – 15 Nov** |
| Pages export columns | no Change | **Clicks before, Change** (passport 53 → 46, −7), Jump-link impressions |
| Overview export chart | 30 points, 19 Oct – 17 Nov, 207 clicks, under a 28-day header (tile 201) | **28 points, 19 Oct – 15 Nov, 201 clicks**, plus a note: "The last 2 days aren't final yet…" |
| Overview Excel, position change | 6.7 shown as "+6.7 places" | **−6.7 "places worse"** |

- **Tests:**
  - `::test_pages_and_content_exports_say_googles_own_days[pages|content]`
  - `::test_overview_export_charts_only_the_counted_days_and_writes_places_better_or_worse`

### 5. "Last 24 hours" without a live connection (3.9): **Fixed**

- **What changed:** in saved mode the server now returns `saved_days` (from, to, days).
- **On screen:**
  - The period picker says "Last 2 saved days" / "2 jours enregistrés".
  - The head prints the dates instead of "Last 24 hours".
  - A note says "Hours need the live connection to Google. These are the last 2 saved days, 16 Nov – 17 Nov 2026, not final yet." "Not final yet" is only added when those days really are not final.

| Live copy, site 3, 24 h, Google unreachable | Before | After |
|---|---|---|
| Label | "Last 24 hours" over 16–17 Nov (6 clicks / 1,711 impressions) | "Last 2 saved days", 16 – 17 Nov, same 6 / 1,711, with the note |

- **Test:** `::test_24_hours_without_google_says_it_shows_the_last_saved_days`
- **Playwright:** the head no longer says 24 hours.
- **Screenshot:** `gsc2-shots/05-overview-24h-saved-*`.

### 6. Pruning: 16 months were 3 days short (4b): **Fixed**

- **Fix:** `gsc.HISTORY_DAYS` goes from 486 to 490, counted from Google's today.
  - That keeps every 16 months whole, whatever the months' lengths: at most 487 days back from the last final day.
  - It also keeps the days Google still has. Google's own export made on 15 Nov started on 14 Jul.
- **Missing days fill in by themselves:** the next pull reads them, because `pending_days` reads uncovered days inside the window.
- **Comparisons:** the "google" no-comparison check uses the same constant.

| | Before | After |
|---|---|---|
| Oldest day kept, run on 17 Nov 2026 | 19 Jul 2025 (the 16 m preset starts 16 Jul, so 3 days short; 1,569 impressions on site 3) | **15 Jul 2025** |
| Oldest day kept, run on 15 Nov 2026 | 17 Jul 2025 | **13 Jul 2025** (export starts 14 Jul) |

- **Test:** `::test_the_collector_keeps_16_full_months_and_the_days_google_still_has`
- **Still to do after merge:** the stored rows for 16–18 Jul arrive with the next Search Console pull on live. Nothing needs doing by hand.

## Tests

- `tests/test_gsc_screen_numbers.py`: 10 tests. All failed before the fix, for the reason they name, and all pass now.
- Full pytest on `test_fix_gsc2_test`: **3,081 passed, 0 failed** (12 min 38 s). The collation test known to fail on the base passes here too.
  - One existing test changed on purpose: `test_exports.py::test_overview_export_has_the_screens_numbers_filters_and_order`. It asserted that the export chart had as many points as the screen, provisional days included. That is exactly what W12 removes, so it now counts the counted days only.
- `node --test tests/js`: 5 / 5 pass.
- Playwright `tests/ui/flow_gsc_screen_numbers.cjs`: desktop 1440 and phone 390, English and French, all checks ok.
  - It ran on the demo world: made-up `site-one.example` with two jump links added to `/abonnement`, a −90 change finding led by hidden searches, and Google refusing through `FAKE_GSC_FAIL_FILE`.
  - The harness's `/api/auth/me` 404 is left out of the error check, because the harness has no sign-in.
  - I looked at every screenshot. One fix came from that: the French period chip was cut off on phone, so its label was shortened to "2 jours enregistrés".

## Files touched

- `seo/metrics/service.py`, `seo/pages/service.py`, `seo/metrics/search.py`
- `seo/insights/engine.py`, `seo/insights/movement.py`
- `seo/exports/views_traffic.py`, `views_search.py`, `xlsx_out.py`, `fmt.py`, `words.py`, `sentences.py`
- `seo/collectors/gsc.py`
- `design/mockups/screens-live.js`, `pages-view.js`, `row-panel.js`, `insights-view.js`, `overview-view.js`, `mockup.js`, `shared-ui.js`
- `tests/test_gsc_screen_numbers.py`, `tests/ui/flow_gsc_screen_numbers.cjs`

## For the owner

- **Jump links on Overview's own Pages table.** That table still lists each jump-link URL as its own row, the way Search Console's page report does. Its numbers were already right per URL, so this was left as it is.
- **The 2 jump-link clicks over 16 months on site 3.** These are no longer counted in the page's clicks. They are kept in the data (`jump_clicks`, `jump.clicks`) but not shown on screen, because there are so few. Nothing else needs a decision.
