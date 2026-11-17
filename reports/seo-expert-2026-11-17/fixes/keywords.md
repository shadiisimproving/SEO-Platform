# Fixes: keywords and rank checks (2026-11-17)

Branch `fix-keywords-2026-11-17` (worktree `seo-cc-fix-keywords`), from origin/main d7ac5ad. Not pushed, merged or deployed.
Screenshots: `fixes/keywords-shots/` (1440 and 390, English and French).

## Per item

| # | Item | Result | Test that proves it |
|---|---|---|---|
| 1 | Drop out of / into the checked depth never counted; Top 10 tile stuck at 0; tray "Nothing moved"; false "First check" | **Fixed** | `tests/test_keyword_fixes.py` (5 tests, hand-counted: 4→out is Down and −1 Top 10; out→6 is Up and +1; out→out is "Still out", neither; one check has no move; 5 mixed keywords add up to up 3, down 2, Top 10 change 0). Flow `tests/ui/flow_keyword_fixes.cjs`, `tests/ui/flow_keyword_refresh_skip.cjs`. Shots `1440-en-google.png`, `refresh-en-tray.png` |
| 6 | French accents: "café"/"cafe" never joined, "Worth tracking" duplicates, Track duplicates | **Fixed**, with a migration | `test_the_keyword_key_folds_latin_accents_and_case_but_not_other_scripts`, `test_search_console_spellings_add_up_under_the_tracked_keyword` (560 + 40 impressions = 600, position (6.5·560 + 8·40)/600), `test_track_on_an_unaccented_query_does_not_make_a_second_keyword`, `test_the_migration_merges_accent_twins_without_losing_a_check_and_is_safe_twice` |
| 9 | Bing, DuckDuckGo, Yandex tabs show Google's impressions, page and AI; All engines shows Google tiles | **Fixed** | Flow checks: no AI column or AI card on Bing, the head line doesn't name Search Console there, Yandex with no tool is one card, All engines' cards say "Google only". Shots `*-bing.png`, `*-yandex.png`, `*-all.png` |
| 10 | DuckDuckGo saves depth 20/30/50 after reading one page | **Fixed** | `test_depth_read_rounds_down_to_a_depth_the_app_offers`, `test_duckduckgo_direct_asked_for_top_30_with_one_page_of_10_saves_top_10`, `test_serpapi_duckduckgo_reads_one_page_and_saves_what_it_read` |
| 15 | "Page" is Search Console's most-shown page, not the URL that ranked | **Fixed** | `test_the_page_column_is_the_ranking_url_and_search_consoles_page_is_named_apart`, `test_a_ranking_url_swap_between_two_like_for_like_checks_is_marked`. Shots `*-panel.png`, `*-panel-results.png` |
| 16 | The main tool's result wins however old | **Fixed** (owner's rule kept, age limit added) | `test_the_main_tools_result_wins_while_it_is_14_days_old_or_less`, `test_a_main_tool_result_older_than_14_days_gives_way_to_a_newer_one_and_says_so`, `test_an_old_main_result_with_nothing_newer_stays_and_is_marked_old`. Shot `1440-en-google.png` ("120 d" on best coffee beans) |
| S2 | One engine with no tool stops the Refresh; a stopped run hides what moved | **Fixed** | `test_an_engine_with_no_tool_is_skipped_with_a_sentence_and_the_run_finishes`; flow `flow_keyword_refresh_skip.cjs`. Shots `refresh-*-dialog.png`, `refresh-*-tray.png` |

### What changed, item by item

**#1 Movement.** `seo/serp/rankings.py`: `movement()` gives each like-for-like pair a state: `up`, `down`, `same`, `lost` (found → beyond the depth), `new` (beyond → found), `out` (beyond both times). Each engine view carries `move` and `was`. `tiles()` counts `lost` in Down and `new` in Up, and `top10_step()` counts entering/leaving the top 10 (so at depth 10 a drop-out is −1, no longer always 0). `change` stays a number only when both positions are known, so no number of places is invented. The screen (`keywords-real.js`) uses the same rule everywhere: Down/Up chips, sorting, the Top 10 card, and the end-of-Refresh tray ("2 down · 2 dropped out of top 10"), which no longer mixes tools. Change cell says "Dropped out" (was #N), "New", "Still out"; "First check" only when there really is one check.

**#6 Accents.** One key in `seo/serp/store.py`: `keyword_key()` = cleaned text, casefold, Latin accents folded (œ → oe, æ → ae); other scripts keep their marks (Japanese dakuten, Hindi vowel signs change the word). `keyword_hash` uses it, so a new "cafe" lands on the tracked "café" (no duplicate). Search Console, Bing and Yandex numbers for every spelling now add up under the tracked keyword (impressions-weighted position) in `rankings._own_tools`; `insights/mix.py`, `insights/aio.py`, `metrics/search.py` (`_match` only, as agreed with fix-periods), competitor notes and the upload de-duplication all use the same key. The screen's Track, "Already tracked" in Keyword ideas use the same fold. The text shown stays as typed. Impressions show a small "²" with "includes 2 spellings" as its tip.
Migration `migrations/versions/20261117_c5e7a9b1d3f2_keywords_one_key_for_accents.py` recomputes the stored hashes and merges keyword twins in the same market into the older one: sites, Keyword check entries, every rank check (moved onto one target per engine and device, so one history line), Refresh items, credit lines and tasks' ranking refs move over; only the emptied duplicate rows are deleted. It is idempotent (tested twice). **Not run on live.**

**#9 Each engine's own numbers.** On Bing and Yandex the Impressions column is that webmaster tool's own (headed "Bing Webmaster"/"Yandex Webmaster"); DuckDuckGo has no Impressions column. The AI column and the Cited by AI card show on Google only; on All engines the cards say "Google only". The head line names Search Console only on Google and All engines, and "Last check … with" reads only that tab's engine. An engine no connected tool can search, with no checks and no webmaster numbers, shows one card ("Yandex isn't checked: no tool can search it. Connect one in Settings, then press Refresh.") instead of rows of "Not checked".

**#10 DuckDuckGo depth.** `seo/serp/tools.py` `depth_read()`: the depth saved is what one page answered, rounded down to a depth the app offers (10/20/30/50) so checks stay comparable. Applied to DuckDuckGo direct, SerpApi's DuckDuckGo and Bright Data's DuckDuckGo. Old checks already saved with a false depth are left as they are (there's no way to know what they read).

**#15 Ranking URL.** Rows carry `ranking_url` (our check's URL) and `gsc_page` (Search Console's most-shown, 28 days). `page` is now the ranking URL first. The Page column shows the ranking URL; on Google, when Search Console's page differs, a second line says "Search Console /that-page". "URL changed" shows when the last two like-for-like checks found different pages. The panel shows "Ranking now" and "Most shown in Search Console" apart, and All results has a URL column and the tool's name.

**#16 Age limit.** `store.pick_main()` is the one rule, used by Keywords and by every other screen (`store._by_main_tool`): the main tool (Bright Data) still wins, unless its result is older than 14 days (`MAIN_MAX_AGE_DAYS`, like `MIX_FRESH_DAYS`) and another tool has a newer one. Then the newer one is shown with an amber age badge whose tip says "Bright Data's check is 120 days old, so this newer one is shown". Any row whose check is over 14 days old gets the amber age badge, simple mode included.

**Section 2.** `seo/serp/refresh.py`: an engine with no tool at all is left out when the run is created; the run note says "No tool can search Yandex, so it was skipped. Connect one in Settings." and the run ends Finished. The preview no longer counts those searches as "runs out after N", and the dialog says "It will be skipped." The tray now shows what moved for any run that saved checks (a stopped one too, titled "Stopped · …"), and keeps the skip sentence.

## Tests run

- `DB_NAME_TEST=test_fix_keywords_test .venv/bin/pytest`: all green, no failures (full suite, run after the last code change). Two older tests asserted the old rules and were updated: `test_search.py` (two keywords differing only by accents can no longer both exist) and `test_search_countries.py` (own-country numbers keep their three fields).
- `tests/test_refresh.py::test_beyond_the_depth_is_not_a_drop` asserted the old wrong rule; renamed to `test_beyond_the_depth_is_out_of_the_top_n_a_drop_with_no_made_up_number` and now asserts the drop.
- `node --test tests/js`: the three files there are helpers called by pytest, not node tests; they run inside the pytest suite.
- Playwright, on the demo world plus a seed (one #2 → out, one out → #7, a 120-day-old Bright Data check with Bright Data as main tool, a Search Console page differing from the ranking page): `tests/ui/flow_keyword_fixes.cjs` (1440/390 × en/fr, 14 checks each) and `tests/ui/flow_keyword_refresh_skip.cjs` (en/fr). All checks passed; the only console error is the harness's known `/api/auth/me` 404.
- Impeccable detector on `keywords-real.css`: no findings.

## Files touched

`seo/serp/store.py`, `seo/serp/rankings.py`, `seo/serp/tools.py`, `seo/serp/refresh.py`, `seo/insights/mix.py`, `seo/insights/aio.py`, `seo/metrics/search.py` (one line: `_match`), `seo/competitors/keywords.py`, `seo/competitors/notes.py`, `design/mockups/keywords-real.js`, `design/mockups/keywords-real.css`, `migrations/versions/20261117_c5e7a9b1d3f2_keywords_one_key_for_accents.py`, `tests/test_keyword_fixes.py`, `tests/test_refresh.py`, `tests/ui/flow_keyword_fixes.cjs`, `tests/ui/flow_keyword_refresh_skip.cjs`.

## For the owner / whoever merges

- **Migration chain:** this migration revises `a7b1c2d3e4f5`. The fix-pages branch also adds one on `a7b1c2d3e4f5` (`b2c4d6e8f0a1`), so whichever merges second must set its `down_revision` to the other's revision (or add an alembic merge revision). Run `alembic upgrade head` on live only after a backup; it merges accent twins (e.g. "abonnement café" FR/fr and "abonnement cafe" FR/fr) into the older keyword.
- **`row["page"]` meaning changed** from "Search Console's most-shown page" to "the page our check found (Search Console's as fallback)". The page view's Rankings tab (`seo/pages/service.py`, pages agent) reads it, so it now lists the keywords that actually rank with that page.
- Left for later (not in this task): Check deeper splitting history by depth (F7), the export's "Searches a month" label (F18), a "next automatic DuckDuckGo check" time (F11, part).
