# Final fixes: rankings and links (2026-11-18)

Branch `final-rl-2026-11-18` (from fix-all-2026-11-17 d650b76), worktree `seo-cc-final-rl`. Source: `accuracy/final-rankings-links.md`.
Not pushed, not merged, not deployed. No search credits spent, nothing fetched.

**Data used:**
- "pre-script" = `test_live_final_test` (read-only);
- "final" = `test_live_finalrc_test` (after `mark_contradicted_checks.py --apply`, read-only);
- the migration was run on copies of both (`test_fin_rlfinal_test`, `test_fin_rlfinalrc_test`).

All tests with known answers are in `tests/test_final_rl.py`. Each one was run against d650b76 in a separate worktree, and each failed there before its fix.

## Per item

### 1. "Tools disagree" also for found vs not found: Fixed (a169326)

**What changed:**
- `store.clash` is now the single disagreement rule.
- When both tools found us, it is a disagreement if they are more than the gap apart.
- When one tool found us and the other didn't, it is a disagreement if the other read at least that deep and either:
  - our position was in the top 10, or
  - the gap between the depth + 1 and our position is larger than the gap setting.
- `engine_view` and `mix` both read it.
- A place beyond the other tool's depth is not a disagreement. Example: #18 against "not in top 10".

**Rank and clicks (pre-script):**
- Before: rank_drop 1, rival_gap 9, striking 4.
- After: rank_drop 0, rival_gap 6, striking 3.
- Gone:
  - rank_drop "emirates id";
  - rival_gap "vivre à dubai", "cout de la vie dubai", "créer société llc dubaï", "création entreprise dubai";
  - striking "creer son entreprise a dubai" (now HasData #4, backed by SerpApi).
- The final copy shows the same.

**Rows marked "Tools disagree":**

| | Before | After | Settled by a third tool | Both answers shown |
|---|---|---|---|---|
| Pre-script | 16 | 36 | 24 | 12 |
| Final | 10 | 22 | 9 | 13 |

The 7 rows from report 3.2, final copy, before → after:

| Keyword | Before | After |
|---|---|---|
| emirates id | SerpApi >10 | **HasData #2** (Bright Data and Searlo agree) |
| societe dubai free zone | Searlo >20 | **HasData #7** (SerpApi agrees) |
| créer société llc dubaï | Searlo >20 | **HasData #2** (Bright Data agrees) |
| condition pour vivre a dubai | Searlo >20 | **>20 / #4** |
| cout de la vie dubai | HasData >10 | **>10 / #9** |
| Création société zone libre Dubaï | HasData >10 | **>10 / #6** |
| vivre à dubai | Searlo >20 | **>20 / #7** |

Tests:
- `test_found_in_one_tools_top_10_and_missing_from_anothers_is_a_disagreement`
- `test_a_place_past_the_other_tools_depth_is_no_disagreement`
- `test_a_miss_another_tool_of_the_same_days_contradicts_raises_no_drop_and_no_rival_gap`

### 2. The newest check no longer wins a dispute on its own: Fixed (a169326)

**The rule (`store.settle`, which both Keywords and Competitors use):**
- A third tool's check decides. It must be another tool, within 48 h, and it must agree with one answer and clash with the other.
- That third check can be a usable one or an unmarked suspect one. A check with hidden addresses counts only when it found us: its "not found" says nothing.
- A check marked by the cross-tool rule or by "another query" never backs anything (`store.can_witness`).
- A tool repeating itself never settles a dispute. Searlo misses us often, so its own second run must not count.
- With no third tool, the newest check stays and the cell shows both answers ("#33 / #4"), with the ⚠ "Tools disagree" icon. Its tip says either "No third tool to settle it: both answers shown." or "{tool} sides with the one shown." (EN and FR).
- The owner's main tool setting still wins. If it picked the check, that check stays and the other answer is shown beside it.

**Consistency checks:**
- Keywords and Competitors pick the same check: 0 of 156 differ, pre-script and final.

**Keywords tiles (Google):**

| | Ranked | Top 10 | Not ranked |
|---|---|---|---|
| Pre-script, before | 111 | 57 | 45 |
| Pre-script, after | 113 | 62 | 43 |
| Final, before | 113 | 63 | 42 |
| Final, after | 114 | 65 | 41 |

**The four keywords you asked about (final copy, after the migration):**

| Keyword | Before | After | Fresh Google check (truth) |
|---|---|---|---|
| prix creation societe dubai | Searlo #18 | **#18 / #6** (SerpApi), no third tool | 2 |
| tva dubai | Searlo #13 | **#13 / #7** (HasData), no third tool | 3 |
| ouvrir entreprise dubai | SerpApi #37 | **#33 / #4** (Searlo), no third tool. #33 comes from item 7 | 1 |
| vivre à dubai | Searlo "not in top 20" | **>20 / #7** (HasData), no third tool | 5 |

- In every one of these rows, the true place is now on screen, as one of the two answers.
- Pre-script, "vivre à dubai" shows ">20 backed by SerpApi". That SerpApi check is still unmarked before the script runs. After the script, the row shows both answers.

Tests:
- `test_a_third_tool_settles_it_and_the_newest_miss_is_not_shown`
- `test_two_tools_apart_with_no_third_show_both_positions`
- `test_a_tool_repeating_itself_never_settles_a_dispute`
- `test_a_check_that_may_have_missed_me_backs_only_a_find`
- `test_the_owners_main_tool_still_wins_and_shows_the_other_answer_beside_it`

### 3. Old links leave the good ones in Shared links and competitor profiles: Fixed (d6f5231)

**Shared links (`collective.links`):**
- A domain counts as good only when it is good for a site and is not an old link there.
- Domains that are good only through old links are counted apart. They are listed behind the same "Include old links N" chip as on Link gaps, and each one is tagged "Old link (last seen …)" on its site line.

| Shared links | Before | After |
|---|---|---|
| Good | 4,965 | **3,840** |
| Old (counted apart) | – | **1,125** |
| Shared (2+) | 768 | **560** |

**Competitor profile (`insights._links`):**
- It uses the same per-competitor test as Link gaps (`gaps.is_old` / `gaps.old_link`).
- Old links now show as "+N old links" next to "+N flagged as spam". In "Who links to them" they sort after the current ones, with an "Old link" tag.

| Competitor | Linking sites before | Linking sites after |
|---|---|---|
| 4 | 41 | **40** (+1 old) |
| 8 | 46 | **35** (+11 old) |

- The report counted 10 old links for competitor 8. The 11th domain has a recent link to another competitor, so Link gaps doesn't call it old. Its link to competitor 8, though, is old.
- "N of these don't link to you" follows the same rule.

Tests:
- `test_shared_links_leave_old_links_out_of_good_and_count_them_apart`
- `test_a_competitor_profile_counts_old_links_apart`

### 4. Link gaps counts match the table and the export: Fixed (7fc337f)

**What changed:**
- The funnel now also gives `current` and `app_flagged_current`.
- The "App flagged" count in the header counts only rows the table can show. It falls back to the full count once old links are included.
- The server fills its 2,000 rows with current domains first. Old domains are added only if they sit in the top 2,000 of all domains, in the server's order.
- The cap note divides by the good ones shown (`f.good − oldOut`).
- The export:
  - "Worth a look" is the current good ones;
  - "App flagged" counts only current ones;
  - "Old links, left out" is a tile, and the old domains get their own table after the good ones.

| | Site 1 | Site 2 | Site 3 |
|---|---|---|---|
| Header "App flagged" | 224 → **55** | 91 → **70** | 841 → **554** |
| Cap note | – | – | "1,578 of 4,229" → **"2,000 of 3,348"** |
| Export "Worth a look" | 637 → **322** | 400 → **348** | 4,229 → **3,348** |

- Every new count equals what the screen shows.
- Site 3's table holds 2,000 of its 3,348 good rows, so its "App flagged" chip filter counts 213 rows on screen. That is the same cap the note states.

Test: `test_link_gaps_app_flagged_and_the_cap_count_current_rows_and_the_export_matches_the_screen`.

### 5. Curly apostrophes and non-breaking spaces in anchors: Fixed (15cd23b)

- `anchors.clean` now turns every mark into a space *before* the ASCII fold. Letter-like apostrophes (ʼ, which Python counts as a letter) are mapped to a space first.
- lemessager.fr, "création d’entreprise à Dubai": **Partial → Exact**.
- Anchor mix on site 1: Exact 3 · Brand 2 · Partial 6 → **Exact 4 · Brand 2 · Partial 5**.

Test: `test_curly_quotes_and_non_breaking_spaces_fold_before_matching`.

### 6. Exports: Fixed (e278ada)

**Keywords export:**
- "Searches a month" is gone.
  - On Google it was the same number as Impressions, so the column is dropped. The own-tool columns are now named "Impressions, 28 days" and "Clicks, 28 days".
  - On the other engines it stays, named "Google impressions, 28 days".
- Position is empty for a suspect check, as on screen.
- New "Check status" column: "Suspect" or "Tools disagree".
- New "Also seen" column: the suspect check's own reading, or the other tool's answer (for example "Searlo #4").
- "Ranking page" is only the URL that ranked. "Most shown in Search Console" is its own column.

**Backlinks export:**
- "Link text" is the anchor read on the page.
- "Link text typed in" appears when the typed anchor differs from what the page says.
- New "Anchor type" column.
- All new headings have French.

Tests:
- `test_keywords_export_names_impressions_leaves_suspects_unplaced_and_keeps_two_pages_apart`
- `test_backlinks_export_gives_the_anchor_read_on_the_page_and_the_typed_one_apart`

### 7. Stored SerpApi checks with repeated URLs: Fixed (60a0ddf, migration `b8d0f2a4c6e9`)

- Migration `20261118_b8d0f2a4c6e9_serp_results_without_repeats` does to every stored check what `tools._rows` does to new ones:
  - the first row of each address is kept and later repeats are deleted;
  - the remaining rows are numbered 1, 2, 3 … again;
  - rows whose address Google hid keep their place and are never merged with each other;
  - running it a second time changes nothing.
- On the live copies it touched 18 checks (7 "ok" and 11 suspect on the final copy).

| Keyword | Before | After |
|---|---|---|
| ouvrir entreprise dubai | **#37** | **#33** |
| creer societe dubai (pre-script) | #36 | #29 |
| creer une entreprise a dubai (pre-script) | #46 | #45 |

- Keywords tiles: unchanged.

Test: `test_a_stored_check_with_repeats_reads_its_place_without_them`.

## Tests run
- Full pytest on `test_fin_rl_test`: 3,169 passed, 0 failed (exit 0). One existing test, `test_link_quality.py:176`, compared the whole funnel dict. It was updated for the two new keys.
- `node --test tests/js`: 9 of 9 pass.
- Playwright, on a copy of the live data (`test_fin_ui_rl_test`, port 8311):
  - 6 runs: EN and FR at 1440, EN and FR at 390, simple mode, and the full screens at EN 1440 and FR 390.
  - Screens: Keywords cells and the ⚠ tip, the keyword panel, Link gaps for sites 1 and 3, Shared links with the old-links chip, and competitor 8's profile.
  - Every check passed, with no page errors and no sideways scroll.
  - The screenshots show live data, so they stay outside the repo: `/private/tmp/claude-501/-Users-alwaysimproving/2dc79d4d-aef7-4f01-b370-eabc9d54a4a7/scratchpad/frl/shots/`.

## Files touched
- `seo/serp/store.py`
- `seo/serp/rankings.py`
- `seo/backlinks/anchors.py`
- `seo/competitors/gaps.py`
- `seo/competitors/collective.py`
- `seo/competitors/insights.py`
- `seo/exports/views_search.py`
- `seo/exports/views_links.py`
- `seo/exports/views_competitors.py`
- `seo/exports/words.py`
- `design/mockups/keywords-real.js`
- `design/mockups/keywords-real.css`
- `design/mockups/comp-gaps.js`
- `design/mockups/comp-summary.js`
- `design/mockups/comp-profile-tabs.js`
- `migrations/versions/20261118_b8d0f2a4c6e9_serp_results_without_repeats.py`
- `tests/test_final_rl.py`
- `tests/test_link_quality.py`

## For the owner / the merge
- **Migration head:** `b8d0f2a4c6e9` revises `a3c5e7f9b1d4`. If another branch adds a migration on `a3c5e7f9b1d4` (the GA4 / deploy agent might), one of them must move its `down_revision` onto the other, or alembic will see two heads.
- **Unsettled rows:** with no third tool, a disputed row keeps its newest check for the tiles. Example: ">20 / #7" counts as not ranked. Fresh free checks of those keywords settle them. On the final copy that is 13 keywords.
- **Edge of the top 10:** a check at #10 against another tool's "not in top 10" now counts as tools disagreeing. That is the rule as written: found in one tool's top 10, missing from another's. Two such rows on the final copy are settled by a third tool.
