# Final competitor fixes (2026-11-18)

Branch `final-comp-2026-11-18` (from fix-all-2026-11-17 d650b76). Not pushed, merged or deployed.
Source report: `accuracy/final-competitors-exports.md` (W0, W1, W6, N1, N3, N4, N5, N6, N8, N9).

**Commits**
- `f929acf`: noise rules, at read time and in the reclassify script; redirects and duplicates; N9.
- `b4e2fea`: N1, N3, N6, N8, and the same on-screen words.
- `750b98a`: tests and flows.

## Per item

| # | Item | Result | Proof |
|---|---|---|---|
| 1 | W0/W1 noise left | **Fixed.** Numbers below. | `test_competitor_final.py`: office list, see-also teaser, words that change by themselves, listings, stored noise |
| 2 | W6 redirects (and N9) | **Fixed** | `test_a_page_whose_canonical_is_another_page_has_no_edits_of_its_own`, `test_a_moved_page_is_one_moved_event_even_when_the_script_recorded_it_first`, `test_a_moved_page_that_answers_again_is_a_new_start_not_an_edit`, stored test (part 6) |
| 3 | N3 moved isn't edited | **Fixed** | `test_a_move_is_not_an_edit_on_the_cards_the_list_or_your_edits` |
| 4 | N4 listings | **Fixed** | `test_lists_of_posts_are_listings`, stored test (part 5) |
| 5 | N1 one "added in 30 days" | **Fixed** | `test_added_in_30_days_is_one_number_on_the_card_and_the_profile`; `flow_final_competitors.cjs` |
| 6 | N6 dates | **Fixed** | `test_page_dates_in_more_forms_and_never_in_the_future` |
| 7 | N8 Today's day | **Fixed** | `test_todays_rival_line_says_seen_unless_the_page_dates_its_change`, `test_last_fixes.py`, `flow_last_fixes.cjs` |

### What changed

**1. Noise: the same rules at read time (`seo/crawl/store.py`, `seo/crawl/noise.py`) and in the script (`seo/competitors/reclassify.py`)**
- **Blocks that come back.** A block or heading that comes onto a page was already there in an earlier read: the list is rotating (meyranpartners' office list). The blocks are learned as unstable. Edits hidden in the last two days are hidden again (recheck). The script does the same with words, for small changes on pages with an earlier read.
- **Other pages' titles.** A page's title, its title without the site name, and its H1 are kept as the site's template (`site_boilerplate` kind `title`). This catches "see also" teasers and "newest posts" sidebars. The script also counts words inside those titles as template.
- **Headings that come and go.** A heading that showed up and left again within 7 days, on any page, is unstable for the whole site. This covers meyranpartners' random DFSA and DIFC Courts boxes.
- **Form labels.** A slot of 1 to 3 words that changes on 3 or more reads across the site is a label picked at random (clemenceaugroup: Phone / Company / URL). This rule runs in the script only. At read time, the second read already catches it.
- **Words that change by themselves.** These no longer count as changed words:
  - a price glued to a short word ("de306");
  - Arabic month stamps ("29 أكتوبر");
  - punctuation at a word's edge (a stray "<" or ".").
- **Not hidden.** Real one-word fixes stay shown: "authorise" → "authorize", and a price in the article.

**2. W6 and N9**
- **Canonical elsewhere.** When a page names another page as its canonical, both before and after the read, its edits are hidden as `duplicate`. Example: e.zone `/dubai-free-zone-company-formation/`, all 4 events. A canonical change itself stays shown.
- **After a move.** Once a page has a Moved event, anything read later at the old address is hidden as `redirect`. That covers the 5 pages with form-label "edits" after their move. A moved page that answers again becomes a new starting point, never an edit.
- **N9.** `save_moved` records no second Moved event when the newest redirect event already points to the same page.

**3. N3**
- `redirect` is never counted as an edit. This applies to the cards (they now get a separate `moved_30d`), "Page changes, 30 days", "Your edits", the edits chart, last-edit dates and the script's counts.

**4. N4**
- `is_listing(url, title)` now also catches:
  - blog, news and insights indexes, `/services/all`, `/blog.php`;
  - a language's home page (`/ar`, `/en-gb/`);
  - titles with "Archives" or "أرشيف".
- The home page `/` is **not** a listing. Owner's call (see below).

**5. N1**
- The cards, the Activity tab and the profile's tile now use one rule (`insights.added_counts` / `added_since`):
  - a page counts when its own date (published, else its first Wayback copy) falls in the last 30 days, on or after the day watching began;
  - with no own date, the day the app reported it new is used.
- This includes pages published after watching began that were found during the first read.
- The words are the same everywhere: "Added in 30 days" / "Ajoutées en 30 j".
- It takes two queries for any number of sites.

**6. N6**
- These forms are now read: `21-05-2019`, "17 novembre 2026", Arabic month names, Arabic-Indic digits.
- A publish date after today never counts as published.
- For the "found later" check, such a date is capped at today.

**7. N8**
- The line uses the page's own `dateModified` when it is on or before the day the app saw the change. It then reads "Rival changed /x N days before".
- Otherwise it reads "Rival changed /x, seen N days before" ("…, vu N jours avant").

## Before → after (copy of the live snapshot, `test_live_fc_test`)

The script was run once with `--apply` on a fresh copy of `test_live_final_test`. A second dry run hid nothing more (it is safe to run again).

**Competitor edits shown (all competitors):**

| State | Pages edited | Events |
|---|---|---|
| No script | 929 | 3,227 |
| Old code + script | 154 | 404 |
| **New code + script** | **105** | **290** |

**Per site (pages edited / events), old code + script → new code + script:**

| Site | Old | New |
|---|---|---|
| meyranpartners | 3 / 11 | **0 / 0** (target met) |
| takween | 44 / 179 | 33 / 132 (left: real rewrites in EN and AR) |
| e.zone | 21 / 51 | 10 / 29 |
| clemenceau | 2 / 5 | 0 / 0 |
| dmcc | 6 / 10 | 3 / 4 |
| virtuzone | 6 / 9 | 3 / 6 |
| commitbiz | 13 / 28 | 6 / 19 |
| aaconsultancy | 12 / 22 | 7 / 17 |
| societe-emirats | 4 / 4 | 2 / 2 |
| dubaimadame | 12 / 15 | 10 / 12 |
| g12 | 18 / 34 | 18 / 34 (real sections removed; dated the day before) |
| bonjourdubai | 10 / 30 | 10 / 29 |
| "Your edits" (business-setup-dubai) | 131 | 122 (9 moves out) |

The "old" pages-edited figures for e.zone, commitbiz and aaconsultancy count moved pages as edited.

**Today, Competitor changes, all sites, 7 days**
- Before: 3 rows, 2 of them meyranpartners noise.
- After: 1 row, the real dubaimadame experts-list edit (dateModified 12 Nov).
- No drop row names a rival change, which is right on this data.

**"Added in 30 days": card = Activity tab = profile tile, on every site**

| Site | Was (card / profile) | Now |
|---|---|---|
| takween | 8 / 99 | 14 |
| dubaimadame | 0 / 22 | 4 |
| societe-emirats | 7 / 27 | 9 |
| aaconsultancy | 2 / 31 | 3 |
| dmcc | 3 / 19 | 4 |
| well-tax | 10 / 40 | 10 |
| businessetup | 9 / 20 | 10 |

The auditor's counts of pages published since watching began were: takween 16, dubaimadame 4, societe-emirats 9, aaconsultancy 3.

## Re-fetch sample (noise share)

**How it was done**
- 10 pages picked at random (seed 20261118) from the 105 pages with shown edits.
- Each fetched twice, about 60 s apart, one request at a time, 4 s between requests, with a normal Chrome user agent.
- The app's `extract.py` was run on each and compared with the stored versions.
- Files are in the scratchpad: `fc/fetch/`, `fc/judge.txt`.

**Result: 10 of 10 real, so 0% noise in the sample.**
- For every page, the live text equals the stored "after" version: the edit is still there.
- For every page, the two GETs are identical.
- 8 of the 10 carry a dateModified 1–3 days before the day the app saw the change.
- On the 3 g12 pages, 48–72 words of real sections were removed. Only the form label differs (1 word, already learned).

**Overall estimate**
- Reading every shown edit left after the rules, about 6–7 of 105 pages (about 6%) and about 8 of 290 events (about 3%) still look like noise:
  - dubaimadame "newest posts" sidebars with titles cut short by "…" (about 3 pages);
  - the bonjourdubai home page's newest posts (1 page);
  - 2 takween Arabic posts.
- Before, it was about 30% of pages and 25% of events.

## Tests and screens

**Automated tests**
- `pytest` on `test_fin_fc_test`: full suite green, 3,166 passed in 6 min 53 s.
- `node --test tests/js`: 0 failures.

**Screens**
- `tests/ui/flow_competitor_cards.cjs`: all pass.
- `tests/ui/flow_final_competitors.cjs` (new: cards and Activity, EN/FR, 1440/390): all pass.
- `tests/ui/flow_last_fixes.cjs`: Today rival line, EN/FR, desk and phone: all pass.
- Screenshots in the worktree:
  - `var/ui-final-competitors/1-cards-*.png`, `2-activity-*.png`;
  - `var/ui-final-competitors/today/today-rival-row-*.png`.

**Files touched**
- `seo/crawl/noise.py`, `seo/crawl/store.py`, `seo/crawl/pagedates.py`
- `seo/competitors/reclassify.py`, `seo/competitors/insights.py`, `seo/competitors/collective.py`, `seo/competitors/profile.py`, `seo/competitors/crawl.py`
- `seo/metrics/today.py`
- `design/mockups/comp-profile-tabs.js`, `design/mockups/comp-list.js`, `design/mockups/today-view.js`
- Tests: `tests/test_competitor_final.py` (new), `tests/test_competitors_backend.py`, `tests/test_last_fixes.py`, `tests/ui/flow_final_competitors.cjs` (new), `tests/ui/flow_last_fixes.cjs`

## For the owner

1. **Deploy step.** The script must still run on live, `python -m scripts.reclassify_competitor_events --apply`, as already in `deploy/DEPLOY.md`. It now takes about 70 s on the snapshot. The new rules also apply to new reads from the first daily crawl on.
2. **The home page `/` is not treated as a list of posts.** Its newest-posts block (for example bonjourdubai's) still shows as an edit. Treating `/` as a listing would also hide real home-page rewrites in the text (title, meta and H1 changes would still show). That is your decision.
3. **Moves are now counted apart (`moved_30d`)** but not shown on the cards, to keep them simple. They can be added as a third small count if you want.
