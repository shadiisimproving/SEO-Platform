# Fixes: rank checks (SerpApi, cross-tool check, tool order, AI Overviews, Search Console columns, DuckDuckGo depth, two pages)

Branch `fix-serp-2026-11-18` (from fix-all-2026-11-17 d621cd8). Not pushed, merged or deployed. No search credits spent.

Evidence: `accuracy/rankings.md` 3.1–3.8 and its critique, `accuracy/analytics.md` W4, `accuracy/search-console.md` 3.2.
Figures are from `test_live_serp_test`, a copy of the 17 Nov live snapshot (`test_live_snap_test`; the dump file in the
scratchpad was gone, so the copy was taken from that database), migrated to this branch. Before = this branch's base code
on the copy; after = this branch with the migration and `scripts/mark_contradicted_checks.py --apply` run on the copy.

## Per item

| # | Item | Result | Commit |
|---|---|---|---|
| 1 | SerpApi: save what it searched, suspect when the query shown differs, harden, de-duplicate | **Fixed** (cause still unknown: needs one run with a real key, below) | db73ad4 |
| 2 | Cross-tool check: suspect, never shown, greyed with reason, no Insights alerts | **Fixed**, with a stronger rule than "fewer than 2" (why below) | db73ad4, 38de553, f0b87ee |
| 3 | One rule for the shown check, newest when no main tool | **Fixed** | db73ad4 |
| 4 | AI Overview watch: newest check from a tool that sees them, named; "Not checked" | **Fixed** | 393d75a |
| 5 | Keywords' Search Console columns (world and France): the shared period | **Fixed** (Queries tab too) | 38de553, 79d097c |
| 6 | Old false-depth DuckDuckGo checks | **Fixed** (migration) | db73ad4 |
| 7 | "Two pages compete" needs a real second page | **Fixed** | 38de553 |

### 1. SerpApi
- `tools.SerpApi.search` (Google) now sends `location` and `google_domain` from the keyword's country (`GOOGLE_PLACES`, 48 countries; others send `gl` alone as before), and **no `num`**. Pages go through `_rows(..., seen)` like HasData and Searlo, so an address on two pages counts once and the rows under it move up.
- Each check keeps `asked` (SerpApi's `search_parameters`, never the key) and `query_shown` (`search_information.query_displayed`) in two new `serp_checks` columns (migration `f2a4c6e8b0d1`).
- `store.save_check`: when the page showed another query (accents, case and spacing ignored, so Google writing "créer société dubaï" is the same search), the check is saved **suspect** with "SerpApi's page showed results for "vivre", not for this keyword."
- Tests: `tests/test_serp_accuracy.py` (`test_serpapi_searches_from_the_keywords_country_with_its_google_domain_and_no_num`, `..._keeps_what_it_searched_with...`, `test_an_address_on_two_serpapi_pages_counts_once...`, `test_a_page_that_showed_another_query_is_suspect...`, `test_the_same_query_with_other_accents...`). The first three fail on the base code.
- Stored checks have no `query_displayed`, so this part only judges new checks; the old ones are judged by item 2.

### 2. Cross-tool check
**Why not "fewer than 2 shared domains"**: on the live copy the wrong SerpApi answers mostly share **exactly 2** of their top-10 sites with HasData/Searlo (investindubai.gov.ae and meyranpartners.fr show for every Dubai company search). "Fewer than 2" caught only 2 of the 8 disputed keywords. Honest same-morning pairs share 4–9 of 10. HasData and Searlo also disagree honestly or not (32 of 122 pairs share ≤ 3), so a plain two-way rule would grey good checks too.

The rule (`store.odd_one_out`, one place, used at save time and by the script):
- A check is suspect when it shares **fewer than 4** of its top-10 sites with **every** other tool's check of the same keyword, from the same place, within **48 h**;
- and its own tool doesn't back it from another run (≥ 12 h apart: a batch can share one glitch, as SerpApi's 08:36 and 09:48 runs did);
- and a check it disagrees with is backed by a third check (any tool but its own).
- Witnesses include the same keyword spelt with other accents (same country and language) and checks marked suspect only because Google hid addresses (their sites are known). Google's own `google.com` redirect rows are never a site. A check this rule or "another query" marked is never a witness.
- Two tools that only disagree with each other prove nothing: neither is marked. Never un-marks.
- New checks: `store.save_check` → `cross_check` (also re-judges older checks within 48 h, so a SerpApi check becomes suspect when two later tools agree against it).
- Stored checks: `scripts/mark_contradicted_checks.py` (dry run; `--apply` marks, rebuilds pairs, queues Insights; a second run marks nothing).
- Suspect checks already never win the shown position (Keywords `good` list; `store.latest_checks` reads `ok` only; Rank and clicks reads `ok` mains only).
- **Panel**: the suspect row is greyed, its position badge outlined grey, and the reason is written under "Suspect result" in English and French ("Other tools saw other sites: fewer than 4 of its top 10 in common with Searlo (11 Nov 2026)." / "Les autres outils ont vu d'autres sites : …"; "Its page showed results for "…"…"). A tool whose newest checks are all suspect shows its newest one greyed, never "never".
- **Insights (Rank and clicks)**: besides suspect checks giving nothing, a rank drop, page switch or rival gap is not raised while two tools of the same 48 h disagree on my place (`view["disagree"]`, the Keywords "Tools disagree" sign). That covers the one pair conflict the rule can't settle ("ouvrir entreprise dubai").
- Tests: `test_a_check_two_other_tools_contradict_together_is_suspect_and_never_shown`, `test_an_older_check_becomes_suspect_when_two_later_tools_agree_against_it`, `test_two_tools_that_only_disagree_with_each_other_are_both_kept`, `test_a_check_its_own_tool_backs_is_kept_and_checks_two_days_apart...`, `test_the_same_keyword_spelt_with_accents_is_a_witness...`, `test_the_script_marks_stored_checks...`; `tests/test_insights_mix.py::test_a_drop_or_page_switch_another_tool_of_the_same_days_does_not_see_is_not_raised` (fails on the base code).

### 3. One rule for the shown check
- `store.pick_main(candidates, main_tool, now, …)`: the main tool's result while ≤ 14 days old (owner's rule and age limit unchanged); otherwise, or with no main tool, **the newest usable check**. The order now only says which tool a Refresh tries first.
- Keywords (`rankings.engine_view`) and every other screen (`store.latest_checks` → `_by_main_tool`: Competitors, pairs, profile, collective) call it with the same inputs: each tool's newest usable check from the keyword's own country (`latest_checks` now picks the newest per tool **and place**, so a UAE check can't hide the French one).
- `tests/test_refresh.py`: the old "first tool in your order speaks for the row" test encoded the old rule; replaced by `test_with_no_main_tool_the_newest_check_speaks_for_the_row_whatever_the_order` (the main tool still wins). New: `test_keywords_and_competitors_show_the_same_check`.

### 4. AI Overview watch
- `store.latest_ai_checks`: per keyword, the newest `ok` Google check that really looked (`ai_state` present or absent), from the keyword's country. `ai_watch.watch` lists every tracked keyword; one with no such check is "Not checked" (`not_checked: true`, no tool). Summary gains `tools` and `checked_at`.
- Screens: the watch tile reads "35 of 35 checked with SerpApi" and "Not checked 121 of 156"; the filter chip and cells say Not checked (FR "Non contrôlé"); AI search's line names the tool ("…keywords checked with SerpApi…" / "…relevés avec SerpApi…").
- Suspect SerpApi checks are left out on purpose: their page was another search, so its overview is too.
- Test: `test_the_ai_overview_watch_uses_the_newest_check_that_looked_and_names_its_tool`.

### 5. Search Console columns
- `rankings._own_tools` and `rankings.queries` take their window from `period.for_site` (`search_windows`): the last 28 of Google's **final** days, `BETWEEN first AND last`, for `gsc_query`, `gsc_query_page` and `gsc_query_country`. `data_through` is that last final day.
- Test with golden numbers: 30 final days of 10 clicks + 2 fresh days of 1 → 280 / 2,800 world, 56 / 560 France (base code: 262).

### 6. Old DuckDuckGo depth
- Migration `f2a4c6e8b0d1`: a DuckDuckGo check saved deeper than 10 that holds ≤ 10 results is set to depth 10 (results untouched). Live copy: **66 → 0**. They now compare with the newer Top 10 checks, and the panel says ">10", not "not in the top 20/30".
- Test: `test_old_duckduckgo_checks_that_read_one_page_answer_top_10` (a check with 15 results stays Top 20).

### 7. Two pages compete
- `rankings.second_page_counts`: the second page holds ≥ 20% of the keyword's Search Console impressions, **or** both pages ranked in the check shown (the shown check, no longer whichever check came last).
- Test: `test_two_pages_compete_only_with_a_real_second_page_or_both_ranked` (41/1 no, 60/20 yes, 99/1 but both ranked yes).

## Before → after on the live copy (creer-societe-dubai.fr, 156 Google keywords)

| Figure | Before | After |
|---|---|---|
| SerpApi Google checks suspect | 7 of 79 | **38 of 79** (31 by the cross-tool rule). The rule also greys 2 HasData and 3 Searlo checks |
| Rows shown from SerpApi | 66 | 13 |
| Keywords tiles: ranked / top 10 / not ranked | 85 / 54 / 71 | 113 / 63 / 42 |
| Keywords vs Competitors: same check | 108 of 156 (48 differ, 35 with another position) | **155 of 156**: the 1 left ("créer entreprise dubai") has only a suspect check, shown greyed on Keywords and left out of Competitors |
| AI Overview watch | "17 of 17 checked, cited in 2" (Searlo's blind checks hid SerpApi's) | **"35 of 35 checked with SerpApi, cited in 5"; 121 not checked**. 24 more keywords have only a SerpApi AI check that is now suspect (the review's "55 of 56, cited in 9" counted those) |
| "creer societe dubai", Search Console world | 35 / 316 (10-21…11-17) | **46 / 338** (19 Oct–15 Nov) = truth |
| "creer societe dubai", France | 15 / 122 | **18 / 124**, position 10.3 = truth |
| DuckDuckGo checks saved deeper than read | 66 | 0 |
| "Two pages compete" | 118 | **70** (48 go) |
| Rank and clicks: rank drop / page switch / rival gap | 4 / 1 / 10 | 1 (emirates id, not disputed) / 0 / 12. The 3 false drops, the false page switch and the 2 false gaps of rankings 3.2 are gone; the new gaps are keywords now shown with their real (lower) position |

Disputed keywords (shown on Keywords; "fresh" = Firecrawl 17 Nov from rankings.md):

| Keyword | Before | After | Fresh |
|---|---|---|---|
| créer société dubai | SerpApi, not in top 10 | HasData #1 | 1 |
| creer societe dubai | SerpApi #36 | Searlo #1 | 1 |
| creer une societe a dubai | SerpApi #44 | HasData #2 | 2 |
| ouvrir societe dubai | SerpApi #46 | SerpApi #3 (its d10 check) | 1 |
| creer une entreprise a dubai | SerpApi #46 | Searlo #5 | 2 |
| création entreprise dubai | SerpApi, not in top 20 | HasData #7 | 2 |
| vivre à dubai | SerpApi, not in top 10 | Searlo, not in top 20 | 5 |
| vivre a dubai | SerpApi, not in top 10 | Searlo #11 | 9 |
| ecole francaise dubai | SerpApi, not in top 10 | HasData #10 | 5 |
| ouvrir entreprise dubai | SerpApi #37 | **SerpApi #37, still** (only Searlo checked it; a pair conflict) with "Tools disagree" and no Insights alert | 1 |

## Tests
- `tests/test_serp_accuracy.py` (17 tests) and the new mix test. Each new rule test was run against the base code first and failed there.
- Full pytest on `test_fix_serp_test` (after 79d097c): **green except the known `tests/test_text_all_scripts.py::test_every_script_and_emoji_goes_through_every_path_after_the_conversion`** (collation, another agent's fix). The first full run also caught a nested connection (`test_db_pool`) and 4 old tests that stored Search Console rows on today, a day the shared period rightly leaves out; fixed in 79d097c (tests now store them 5 days back). One `test_backlink_seo` failure seen once on the untouched base did not come back.
- `node --test tests/js`: 5 / 5 pass.
- Browser: `tests/ui/flow_serp_accuracy.cjs` on the live copy (server on port **8312**: 8302 was taken by the GA4 agent's server), Keywords + panel, AI search, AI Overview watch, Rank and clicks at 1440 and 390, English and French: **ALL PASS**. The screenshots hold real data, so they are not in git: `/private/tmp/claude-501/-Users-alwaysimproving/2dc79d4d-aef7-4f01-b370-eabc9d54a4a7/scratchpad/serp/shots/` (`1440-en-panel-suspect.png`, `390-en-panel-suspect.png`, `1440-fr-ai-watch.png`, `1440-en-rank-and-clicks.png`, …). Run the flow again to make them.

## For the owner / whoever merges
1. **One SerpApi test with a real key** (about 12 searches): on "ouvrir societe dubai", "creer societe dubai" and "vivre à dubai", FR/fr, run SerpApi at depth 10 and at depth 50 next to HasData (Keywords panel → Refresh per tool). Look at each SerpApi check's saved `asked` and `query_shown` (`SELECT asked, query_shown FROM serp_checks ORDER BY id DESC LIMIT 6`). If `query_shown` is the keyword and the top 10 matches HasData's, the cause was the missing location/num and it is fixed; if `query_shown` is one word ("vivre"), the query is being cut and the check is now greyed automatically, and SerpApi should stay off Google until SerpApi support explains it.
2. After deploying: back up, then `.venv/bin/python scripts/mark_contradicted_checks.py` (dry run), then `--apply`. The migration runs the DuckDuckGo depth fix by itself.
3. The migration `f2a4c6e8b0d1` revises `e4f6a8b0c2d5`; if another branch also adds one on `e4f6a8b0c2d5`, chain one after the other when merging (two heads stop `upgrade head`).
4. Judgement calls made here: the 4-of-10 line (data above), and leaving pure two-tool conflicts unmarked. Lower `AGREE_SITES` in `seo/serp/store.py` to make the rule gentler.
5. Not changed: the AI search "Connect SerpApi" button still shows while keywords are not checked, though SerpApi is connected (it opens the connection settings).

## Files
`seo/serp/tools.py`, `seo/serp/store.py`, `seo/serp/rankings.py`, `seo/competitors/ai_watch.py`, `seo/insights/mix.py`, `seo/core/models.py`, `migrations/versions/20261118_f2a4c6e8b0d1_rank_checks_true.py`, `scripts/mark_contradicted_checks.py`, `design/mockups/keywords-real.js`, `keywords-real.css`, `comp-ai.js`, `ai-search-view.js`, `fr-short.js`, `tests/test_serp_accuracy.py`, `tests/test_refresh.py`, `tests/test_insights_mix.py`, `tests/ui/flow_serp_accuracy.cjs`.
