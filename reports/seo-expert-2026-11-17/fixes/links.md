# Fixes: links, link gaps, competitors (2026-11-17)

Branch `fix-links-2026-11-17` (from origin/main d7ac5ad). Not pushed, not merged, not deployed.
Commits: `818330e` (#7 Link gaps/Shared links, #13, migration), `cf02027` (#11, Rival passed you, phone layout, Open Link gaps in Shared links), `1dd1e5c` (#7 Backlinks, #12, #14, paid links weekly, moved links, Find prospects, ⌘K).
Screenshots: `reports/seo-expert-2026-11-17/fixes/links-shots/` (desktop 1440 and phone 390, English and French).

## Section 1

| # | Item | Result | Proof |
|---|---|---|---|
| 7 | Scores of different tools sorted as one | **Fixed** | `tests/test_links_numbers_true.py::test_link_gaps_never_rank_an_ubersuggest_70_above_a_semrush_54`, `::test_shared_links_on_competitors_sort_the_same_way`, `tests/js/score_scales.test.cjs`, `flow_link_gap_links.cjs` |
| 11 | Competitor figures | **Fixed** (all four parts) | `test_store.py::test_a_first_reading_is_no_edit...`, `test_links_numbers_true.py::test_updated_share...`, `::test_edit_counts_count_pages_not_change_rows`, `::test_their_linking_sites_leave_spam_out...` |
| 12 | "Counted by Google?" with Google's logo, three names for one verdict | **Fixed** | `flow_backlink_seo.cjs`, `flow_links_numbers_true.cjs`; shots `*-5-link-panel.png` |
| 13 | Link gaps ignore nofollow / sponsored / UGC / lost | **Fixed** | `test_links_numbers_true.py::test_the_reader_keeps_rel_and_lost...`, `::test_lost_links_are_no_gap...`, `::test_a_link_the_next_file_says_is_lost_leaves_the_list` |
| 14 | Exact-match anchors called "Brand" | **Fixed** | `test_backlink_seo.py::test_an_exact_match_domain_does_not_hide_money_anchors_as_brand` |

**#7.** One rule, in one place: `cleaner.scale_of(label)` names the tool a score belongs to ("Authority Score (SEMrush)" and a typed "SEMrush" are both `semrush`). `cleaner.scale_ranks` puts the tool most rows use first. The browser has a copy of both in `cleaner.js`, plus `compareScored` for `[group, value]` sort keys.
- **Link gaps and Shared links** (`gaps.pick_scores`, `gaps.order_by_scale`, used by `collective.links` too):
  - A domain scored by several tools shows the leading tool's score, not the biggest number from any tool.
  - The list sorts by competitor count, then the leading tool's scores, then the other tools' scores, each on its own scale.
  - Each row carries `scale_rank`. The Strength sort keeps the leading tool first whichever way it runs.
  - When the list mixes tools, a line under the table says so.
  - Known answer in the test: SEMrush 60 and 54 come before Ubersuggest 70, and follow.example shows SEMrush 54, not Ubersuggest 80.
- **Backlinks:**
  - The Authority cell now always names its tool (logo or tag).
  - The column sorts within one tool. Open PageRank always comes last, so an OPR 8 never sits beside a DA 8.
  - The same applies to the By site table and to In consideration's DA.

**#11.**
- **Updated in the last 12 months.** `crawl/store.save_fetch` no longer sets `last_changed_at` on a page's first reading, only when an edit is recorded. A migration clears the first-read stamp from pages with no recorded edit.
  - Demo note: the demo still shows 100% for both sides. In the demo, only the edited pages carry a date, and they are recent. Pages with no date are now left out of the share, as they should be.
  - "Last changed" in Change details is now "Last edit seen". A page never edited shows "None since the first read".
- **Edits count pages, not change rows.**
  - The cards' "edited in 30 days" (`collective._card_facts`) and the edits chart (`insights._edits_by_month`) use `COUNT(DISTINCT page_id)`.
  - The profile shows "Pages edited", with a distinct total for the whole window (`edited_pages`).
  - Rival One now reads "2 edited": 3 edits on 2 pages.
- **Spam never counts.** "Linking sites" leaves out flagged domains and shows "+N flagged as spam" under their number.
- **Different sources.**
  - When Moz has both sides, both numbers come from Moz and a winner can be named.
  - Otherwise my number comes from my Backlinks list and theirs from their files or Common Crawl. Each side names its source, the row says "Different sources: no winner", and this row no longer counts as a vote in "They're ahead on n of total".

**#12.**
- The panel row is now "Does it pass value?". It has no Google logo, and its (i) says: "The app's own check of the linking page... Not data from Google."
- The verdict on top now uses the badge's words: Useful, Barely useful, Not useful. "Weak link", "Working" and "Google doesn't count it" are gone.
- No tooltip or sentence about this verdict says "Google counts it" any more.

**#13.**
- `cleaner.link_rows` reads Nofollow / Sponsored / Ugc / Lost link (and `link type` / `rel` text) into `rel` and `lost`.
- `gaps.import_referrers` leaves out lost rows. A link that a newer file marks lost is deleted from the saved links.
- Each domain gets `followed`: true, false, or unknown when the file doesn't say.
- Link gaps has "Followed links only", on by default. Domains with only nofollow, sponsored or UGC links are hidden behind one line: "N domains ... are hidden · Show them".
- Files that don't say anything about follow status are never hidden.
- Migration columns: `competitor_referrers.followed`, `competitor_referrer_links.rel`.

**#14.**
- New anchor type "Brand + keyword" (`brand_kw`). An anchor that matches only brand words which themselves contain a tracked keyword gets this type. Example: creer-societe-dubai.fr with "créer société dubai" tracked.
- `anchors.EXACT_LIKE` groups it with Exact for any future anchor mix. Today the app has no anchor mix that counts it.
- It can be set by hand, and from the CSV ("brand keyword", "marque mot clé"), in the server and in `bulk-links.js`.
- A brand without a keyword stays Brand.

## Section 2

| Item | Result | Proof |
|---|---|---|
| A lost paid link found up to ~31 days late | **Fixed** | `test_backlink_live.py::test_a_paid_link_is_read_weekly_and_a_free_one_monthly` |
| A link moved to another page of my site stays "Useful" | **Fixed** (badge + alert + filter) | `test_backlink_live.py::test_a_link_moved_to_another_page...` |
| "Rival passed you" on a one-place swap, or when only I fell | **Fixed** | `test_insights_mix.py::test_a_one_place_swap...`, `::test_when_only_i_fell...`, `::test_a_search_nobody_makes...` |
| Competitors on a phone: Changes about 60 px wide | **Fixed** | `flow_competitor_cards.cjs` (new 390 px check), `flow_links_numbers_true.cjs`; shots `en-390-1-competitors.png`, `fr-390-1-competitors.png` |

- **Paid links are read weekly.** A link with a price, a mediator or a renewal date is now checked weekly (`live.PAID_CHECK_EVERY_DAYS = 7`, in `_DUE`); the others stay monthly. The panel says "Paid links are read weekly". Same polite fetcher and daily budget.
- **Moved links are tracked.** `backlinks.to_target` is saved on each reading.
  - When a link that pointed at the logged target now points elsewhere on my site, `_changes` adds `{"what": "target"}`, which raises the existing `backlink_changed` alert.
  - The row gets a "Points elsewhere" badge, there is a "Points elsewhere" filter chip, and the panel headline warns.
  - The verdict word itself (Useful) is unchanged: it's about whether the link passes value at all.
- **"Rival passed you" is stricter.**
  - The rival must have climbed, or I must have fallen, at least `MIX_PASS_PLACES` = 2 places.
  - The search must have at least `MIX_MIN_IMPRESSIONS` impressions.
  - When only I moved, the row is marked `you_fell`. Insights then says "You fell below {rival}, still at position {p}", and the finding is named "You fell below a rival".
- **Phone layout.** `comp-summary.css`: the 1440 px two-column rule now applies only from 901 px. Below that, the cards stack over Changes, which gets the full width (366 of 390 px).

## COMPARISON lost places 3 and 5

- **Place 3, Link gaps are hard to find. Fixed.**
  - Shared links' header always has "Open Link gaps"; it no longer shows only when something is spam.
  - ⌘K: "Link gaps: find link prospects" is found by "link gaps", "link prospects", "backlink gap" and "prospects", in English and French.
  - Backlinks' header has "Find prospects".
  - The Link gaps head line says "Sites linking to your competitors, not to you".
- **Place 5, Competitors on a phone. Fixed** (above).

## Tests run

- **Full pytest** on `test_fix_links_test`: everything passes after the 4 expectation updates below. The 4 failures before them were old assertions of the behaviour these fixes change (events → pages, spam counted, the funnel's new key), and they are now updated:
  - `test_competitors_backend::test_competitor_cards_get_their_home_page_words_and_added_edited_counts`
  - `test_site_history::test_edits_are_counted_per_month_apart_from_new_and_removed_pages`
  - `test_site_history::test_insights_show_their_best_pages_and_who_links_to_them`
  - `test_link_quality::test_spam_goes_first_and_only_the_good_ones_can_be_added`
- **`node --test tests/js`:** 3/3 pass.
- **Playwright, on the demo server (port 8294):**
  - All pass: `flow_links_numbers_true.cjs` (new: 1440 and 390, EN and FR), `flow_competitor_cards.cjs`, `flow_backlink_seo.cjs`, `flow_backlinks_simple.cjs`, `flow_edits_chart.cjs`, `flow_link_gap_links.cjs` (Strength sort check rewritten for the one-tool rule), `flow_consideration_filters.cjs`.
  - Also failing on main d7ac5ad, checked there: `flow_collective_competitors.cjs` "fits" checks (cut 213 on main, 217 here), and `flow_competitors_simple.cjs` (waits for `#cs-rivals-table`, gone since the cards redesign).
  - Not run: `flow_insights_mix.cjs`, which needs `insights_server.py --mix`.
- **Impeccable detector** on the changed CSS: no findings.

## Files touched

- **Python:**
  - `seo/backlinks/{anchors,cleaner,live,service}.py`
  - `seo/competitors/{gaps,collective,insights}.py`
  - `seo/crawl/store.py`, `seo/insights/{mix,rules}.py`, `seo/core/models.py`
  - migration `20261117_b8c2d4e6f1a3_links_numbers_true.py`
- **JS/CSS:** `design/mockups/{cleaner,backlinks-seo,bulk-links,link-extras,mockup,comp-gaps,comp-summary,comp-profile-tabs,comp-list,insights-view}.js`, `comp-summary.css`
- **Tests:**
  - New: `tests/test_links_numbers_true.py`, `tests/js/score_scales.test.cjs`, `tests/ui/flow_links_numbers_true.cjs`
  - Updated: `tests/test_{store,backlink_live,backlink_seo,insights_mix,competitors_backend,site_history,link_quality}.py`, `tests/ui/flow_{competitor_cards,backlink_seo,link_gap_links}.cjs`

## For the owner

- **Migration.** The new migration `b8c2d4e6f1a3` revises `a7b1c2d3e4f5`. If another fix branch also adds a migration from the same head, the two need to be chained when merging.
- **Weekly checks for paid links.** These cost about 4× the requests for those links, which are few. Say if you'd rather check daily, or only near a renewal date.
- **"Followed links only" is on by default** in Link gaps. Say if nofollow-only domains should show by default instead.
