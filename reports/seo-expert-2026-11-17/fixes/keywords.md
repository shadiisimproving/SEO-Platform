# Fixes: keywords and rank checks (2026-11-17)

Branch `fix-keywords-2026-11-17` (worktree `seo-cc-fix-keywords`), from origin/main d7ac5ad. Not pushed, merged or deployed.
Screenshots: `fixes/keywords-shots/` (1440 and 390, English and French).

## Per item

| # | Item | Result | Test that proves it |
|---|---|---|---|
| 1 | Drop out of / into the checked depth never counted; Top 10 tile stuck at 0; tray "Nothing moved"; false "First check" | **Fixed** | `tests/test_keyword_fixes.py` (5 tests, hand-counted: 4→out is Down and −1 Top 10; out→6 is Up and +1; out→out is "Still out", neither; one check has no move; 5 mixed keywords add up to up 3, down 2, Top 10 change 0). Flow `tests/ui/flow_keyword_fixes.cjs`, `tests/ui/flow_keyword_refresh_skip.cjs`. Shots `1440-en-google.png`, `refresh-en-tray.png` |
| 6 | French accents: "café"/"cafe" never joined, "Worth tracking" duplicates, Track duplicates | **Fixed** (reworked 2026-11-17: matching only, no merge) | `test_one_spelling_tracked_gets_every_spelling_added_up_and_says_so` (560 + 40 = 600, position (6.5·560 + 8·40)/600), `test_both_spellings_tracked_each_gets_only_its_own_query_and_nothing_counts_twice` (560 and 40), `test_rank_and_clicks_follows_the_same_rule`, `test_worth_tracking_never_suggests_a_spelling_of_a_tracked_keyword`, `test_tracking_another_spelling_on_purpose_keeps_both_with_their_own_history`, `test_the_kept_no_op_migration_upgrades_cleanly_and_changes_nothing`. Shot `1440-en-track-twin.png` |
| 9 | Bing, DuckDuckGo, Yandex tabs show Google's impressions, page and AI; All engines shows Google tiles | **Fixed** | Flow checks: no AI column or AI card on Bing, the head line doesn't name Search Console there, Yandex with no tool is one card, All engines' cards say "Google only". Shots `*-bing.png`, `*-yandex.png`, `*-all.png` |
| 10 | DuckDuckGo saves depth 20/30/50 after reading one page | **Fixed** | `test_depth_read_rounds_down_to_a_depth_the_app_offers`, `test_duckduckgo_direct_asked_for_top_30_with_one_page_of_10_saves_top_10`, `test_serpapi_duckduckgo_reads_one_page_and_saves_what_it_read`, `test_top_30_asked_25_read_saves_top_20_and_never_a_position_past_it` (review case: 25 read, me at #23 → saved Top 20, 20 results kept, so it reads ">20") |
| 15 | "Page" is Search Console's most-shown page, not the URL that ranked | **Fixed** | `test_the_page_column_is_the_ranking_url_and_search_consoles_page_is_named_apart`, `test_a_ranking_url_swap_between_two_like_for_like_checks_is_marked`. Shots `*-panel.png`, `*-panel-results.png` |
| 16 | The main tool's result wins however old | **Fixed** (owner's rule kept, age limit added) | `test_the_main_tools_result_wins_while_it_is_14_days_old_or_less`, `test_a_main_tool_result_older_than_14_days_gives_way_to_a_newer_one_and_says_so`, `test_an_old_main_result_with_nothing_newer_stays_and_is_marked_old`. Shot `1440-en-google.png` ("120 d" on best coffee beans) |
| S2 | One engine with no tool stops the Refresh; a stopped run hides what moved | **Fixed** | `test_an_engine_with_no_tool_is_skipped_with_a_sentence_and_the_run_finishes`; flow `flow_keyword_refresh_skip.cjs`. Shots `refresh-*-dialog.png`, `refresh-*-tray.png` |

### What changed, item by item

**#1 Movement.** `seo/serp/rankings.py`: `movement()` gives each like-for-like pair a state: `up`, `down`, `same`, `lost` (found → beyond the depth), `new` (beyond → found), `out` (beyond both times). Each engine view carries `move` and `was`. `tiles()` counts `lost` in Down and `new` in Up, and `top10_step()` counts entering/leaving the top 10 (so at depth 10 a drop-out is −1, no longer always 0). `change` stays a number only when both positions are known, so no number of places is invented. The screen (`keywords-real.js`) uses the same rule everywhere: Down/Up chips, sorting, the Top 10 card, and the end-of-Refresh tray ("2 down · 2 dropped out of top 10"), which no longer mixes tools. Change cell says "Dropped out" (was #N), "New", "Still out"; "First check" only when there really is one check.

**#6 Accents (reworked after the live-data check).** A first version merged accent twins into one keyword. On a copy of the live data that would have merged 156 keywords into 131, but Google ranks the spellings differently (29 of 92 same-day, same-tool pairs differed, e.g. 46 against 7), and the owner tracks both on purpose. So:
- A keyword's identity is unchanged from d7ac5ad: `keyword_hash` is the exact cleaned text, any case. "café" and "cafe" are two keywords with their own histories.
- `store.keyword_key` (case and Latin accents folded; other scripts keep their marks) is used **for matching only**, through `store.match_key`. A keyword the site tracks under one spelling gets Search Console's, Bing's and Yandex's numbers for every spelling, added up, with the position weighted by impressions. The screen marks the impressions with "*", and the tooltip says "Includes other spellings of it, such as without accents." (French too). When the site tracks two spellings, each one gets only its own exact query (any case), so nothing counts twice. Rank and clicks (`insights/mix.py`) uses the same rule.
- "Worth tracking" and the Queries "tracked" flag compare on the folded key (`metrics/search.py` `_match`), so a spelling of a tracked keyword is never suggested.
- Queries → Track on "abonnement cafe" while "abonnement café" is tracked first says "You already track “abonnement café”." and offers "Track this spelling too". The button isn't hidden and doesn't silently add a second keyword. Keyword ideas mark only the exact spelling as "Already tracked".
- The merge migration is gone. Revision `c5e7a9b1d3f2` (down_revision `a7b1c2d3e4f5`) is kept as a no-op, with a docstring saying why, so the links migration that points at it keeps a clean chain.

**#9 Each engine's own numbers.** On Bing and Yandex the Impressions column is that webmaster tool's own (headed "Bing Webmaster"/"Yandex Webmaster"); DuckDuckGo has no Impressions column. The AI column and the Cited by AI card show on Google only; on All engines the cards say "Google only". The head line names Search Console only on Google and All engines, and "Last check … with" reads only that tab's engine. An engine no connected tool can search, with no checks and no webmaster numbers, shows one card ("Yandex isn't checked: no tool can search it. Connect one in Settings, then press Refresh.") instead of rows of "Not checked".

**#10 DuckDuckGo depth.** `seo/serp/tools.py` `depth_read()`: the depth saved is what one page answered, rounded down to a depth the app offers (10/20/30/50) so checks stay comparable. Applied to DuckDuckGo direct, SerpApi's DuckDuckGo and Bright Data's DuckDuckGo. The results kept are cut to that same depth (code review, 2026-11-17), so a position is never saved outside its check's depth. Old checks already saved with a false depth are left as they are (there's no way to know what they read).

**#15 Ranking URL.** Rows carry `ranking_url` (our check's URL) and `gsc_page` (Search Console's most-shown, 28 days). `page` is now the ranking URL first. The Page column shows the ranking URL; on Google, when Search Console's page differs, a second line says "Search Console /that-page". "URL changed" shows when the last two like-for-like checks found different pages. The panel shows "Ranking now" and "Most shown in Search Console" apart, and All results has a URL column and the tool's name.

**#16 Age limit.** `store.pick_main()` is the one rule, used by Keywords and by every other screen (`store._by_main_tool`): the main tool (Bright Data) still wins, unless its result is older than 14 days (`MAIN_MAX_AGE_DAYS`, like `MIX_FRESH_DAYS`) and another tool has a newer one. Then the newer one is shown with an amber age badge whose tip says "Bright Data's check is 120 days old, so this newer one is shown". Any row whose check is over 14 days old gets the amber age badge, simple mode included.

**Section 2.** `seo/serp/refresh.py`: an engine with no tool at all is left out when the run is created; the run note says "No tool can search Yandex, so it was skipped. Connect one in Settings." and the run ends Finished. The preview no longer counts those searches as "runs out after N", and the dialog says "It will be skipped." The tray now shows what moved for any run that saved checks (a stopped one too, titled "Stopped · …"), and keeps the skip sentence.

## Tests run

- `DB_NAME_TEST=test_fix_keywords_test .venv/bin/pytest`: all green, no failures (full suite, run after the last code change). `test_search.py` is back to how it was at d7ac5ad, since two spellings can be tracked side by side again. `test_search_countries.py` is unchanged.
- `tests/test_refresh.py::test_beyond_the_depth_is_not_a_drop` asserted the old wrong rule; renamed to `test_beyond_the_depth_is_out_of_the_top_n_a_drop_with_no_made_up_number` and now asserts the drop.
- `node --test tests/js`: the three files there are helpers called by pytest, not node tests; they run inside the pytest suite.
- Playwright, on the demo world plus a seed (one #2 → out, one out → #7, a 120-day-old Bright Data check with Bright Data as main tool, a Search Console page differing from the ranking page): `tests/ui/flow_keyword_fixes.cjs` (1440/390 × en/fr, 14 checks each) and `tests/ui/flow_keyword_refresh_skip.cjs` (en/fr). All checks passed; the only console error is the harness's known `/api/auth/me` 404.
- Impeccable detector on `keywords-real.css`: no findings.

## Files touched

`seo/serp/store.py`, `seo/serp/rankings.py`, `seo/serp/tools.py`, `seo/serp/refresh.py`, `seo/insights/mix.py`, `seo/insights/aio.py`, `seo/metrics/search.py` (one line: `_match`), `design/mockups/keywords-real.js`, `design/mockups/keywords-real.css`, `migrations/versions/20261117_c5e7a9b1d3f2_keywords_one_key_for_accents.py` (no-op), `tests/test_keyword_fixes.py`, `tests/test_refresh.py`, `tests/ui/flow_keyword_fixes.cjs`, `tests/ui/flow_keyword_refresh_skip.cjs`.

## For the owner / whoever merges

- **Migration chain:** `c5e7a9b1d3f2` is a no-op that stays, so the links migration `b8c2d4e6f1a3` can follow it. Nothing to back up or merge for keywords.
- **`row["page"]` meaning changed** from "Search Console's most-shown page" to "the page our check found (Search Console's as fallback)". The page view's Rankings tab (`seo/pages/service.py`, pages agent) reads it, so it now lists the keywords that actually rank with that page.
- Left for later (not in this task): Check deeper splitting history by depth (F7), the export's "Searches a month" label (F18), a "next automatic DuckDuckGo check" time (F11, part).
