# Fixes: competitor edits and new pages nobody made, and text in every script (2026-11-17)

Branch `fix-comp-noise-2026-11-17` (from `fix-all-2026-11-17`). Not pushed, merged or deployed.
Evidence: `accuracy/competitors-exports.md` W0, W1, W2, W3, W6, W7, W10, W11 (plus W5), and its critique.

Commits:
- `f1d9a4e`: competitor edits and new pages nobody made are no longer shown (items 1, 2, 3b, 4, 5, 6, 7).
- `a18abeb`: utf8mb4 migration, conversion script and the all-scripts tests (item 3).
- `b913a4b`: screens. A moved page says "Moved" and where it went. An Arabic search keeps its icon and clear button apart.
- `c328f0d`: "Updated, 12 months" shows a dash when too few pages carry a date (W11).
- The report commit.

## Numbers on the live copy (test_live_comp_test, dump of 2026-11-17)

Stored events, before and after `scripts/reclassify_competitor_events.py` (dry run, then `--apply`; a second run hides nothing more):

| Site | Edit events | Pages edited | New pages | Hidden by rule |
|---|---|---|---|---|
| meyranpartners.fr | 1,710 → 11 | 486 → **3** | 0 → 0 | template 1,699 |
| takweenadvisory.ae | 837 → 178 | 158 → 44 | 8 → 8 | listing 164, same text ("?") 369, template 126 |
| business-setup-dubai.com (mine) | 555 → 463 | 131 → 131 | 7 → 4 | redirect 59 (+9 "moved" events), template 42, found later 3 |
| e.zone | 113 → 51 | 24 → 21 | 6 → 0 | redirect 55 (+8 moved), template 15, found later 6 |
| bonjourdubai.fr | 101 → 29 | 65 → **10** | 0 | template 72 (the affiliate price) |
| g12.ae | 80 → 34 | 56 → 18 | 28 → **0** | template 46, found later 28 |
| clemenceaugroup.com | 78 → 5 | 24 → 2 | 0 | template 73 |
| commitbiz.com | 74 → 28 | 13 → 13 | 1 → 0 | redirect 50 (+7 moved) |
| aaconsultancy.ae | 61 → 22 | 18 → 12 | 20 → 2 | redirect 27 (+4 moved), found later 18, template 16 |
| creersocietedubai.com | 35 → 0 | 6 → **0** | 0 | template 35 (form labels) |
| dubaimadame.com | 33 → 15 | 27 → 12 | 0 | listing 12, template 6 |
| dmcc.ae | 31 → 10 | 22 → 6 | 1,647 → **3** | found later 1,419, first read 225 |
| creer-societe-dubai.fr (mine) | 24 → **0** | 4 → 0 | 0 | same text ("?" for emoji) 24 |
| maj.ae | 18 → 0 | 3 → 0 | 0 | same text 18 |
| societe-emirats.com | 18 → 4 | 8 → 4 | 7 → 7 | template 14 |
| businessetup.com | 15 → 0 | 8 → 0 | 19 → 9 | found later 10, template 15 (one 140-word block changed on 7 pages at once) |
| virtuzone.com | 15 → 9 | 7 → 6 | 1 → 1 | template 6 |
| well-tax.com | 6 → 4 | 3 → 2 | 2,097 → **10** | found later 2,087; its first read is reopened (backlog still running) |
| efirst.ae | 2 → 2 | 1 → 1 | 0 | none |

Targets:
- **meyranpartners.fr:** 3 pages, not 0. What is left: 2 pages whose random "see also" h2 titles appear on fewer than 3 pages, and the home page's office list (one shuffle that also drops a city). New reads hide these at the source (item 2).
- **well-tax.com:** 10 new pages. **dmcc.ae:** 3, the pages dated after watching began. **My creer-societe-dubai.fr:** 0 fake edits.
- **The real edits the reviewers confirmed are still shown:**
  - takween `/en/degree-attestation-dubai` (title, meta, H1, headings, text);
  - bonjourdubai `/mall-of-the-emirates/` and `/marathon/` (title, meta, text);
  - takween `/en/iso-certification-dubai` (rewrite on 11-12);
  - e.zone crypto-licence rewrite (11-11 and 11-15).
- **Cards after the run:** meyran "3 edited", well-tax "10 added", dmcc "3 added", bonjourdubai "10 edited", creersocietedubai "0 edited". "Updated, 12 months" for meyran now shows a dash (3 of 486 pages dated), where it said 100%. takween's "Added, 30 days" is 99, by the pages' own dates; the reviewer counted 101.
- **Today, "Competitor changes" (W0):**

  | | All sites | Site 1 |
  |---|---|---|
  | Old code | 0 rows ("No competitor changed a watched page") | 5 rows |
  | New code, before the reclassify run | 5 paired rows | 5 paired rows |
  | New code, after the run | 3 rows | 3 rows |

  The 5 rows before the run were all noise: meyran blocks and the bonjourdubai price. The 3 rows after it are 2 residual meyran rows and 1 dubaimadame edit. "Other edits" went from 3,146 to 397.

## Per item

1. **Ignore what changes by itself: Fixed.**
   - `seo/crawl/extract.py` keeps the main text one block a line. Joined with spaces it is the old text, so the hash is unchanged and nothing fires on deploy.
   - `seo/crawl/noise.py` learns each site's template from its own pages:
     - a block on at least 3 pages and 2% of the read pages ("repeated");
     - a block that differed between two reads ("unstable").
   - Compared without the template: block order (a shuffled list, form fields) and numbers inside template blocks (prices, counters). A number in the article text is still an edit.
   - Text and heading changes on listing pages (category, tag, author, `/page/N`) are kept hidden.
   - At the end of each day's read the template is refreshed. Recent edits made only of blocks now known as template are hidden. Example: a newsletter label changed on every page.
   - Tests:
     - `test_a_related_list_picked_at_random_on_every_request_is_never_an_edit[12-repeated|31-unstable]`
     - `test_a_newsletter_label_that_rotates_across_the_whole_site_is_not_an_edit`
     - `test_a_list_in_a_new_order_or_a_price_in_the_template_is_not_an_edit`
     - `test_text_is_kept_one_block_a_line_and_hashes_as_before`
     - `test_learned_template_is_refreshed_from_the_sites_own_pages`
     - `test_listing_pages_are_known`
2. **Confirm a change with a second read: Fixed.**
   - `pages.read_page` reads the page again when a visible edit would be recorded. An event is kept only when both reads show it.
   - Blocks that differ between the two reads are learned as unstable. That read compares no text, so new noise is never recorded.
   - If the second read fails, nothing is saved and the next read looks again.
   - Test: `test_a_real_edit_on_a_page_with_a_random_list_is_still_seen_once`. The 9 behaviour tests fail on the old code, checked in a worktree of `57c3da5`.
3. **Text format: Fixed. Not run on live (owner's decision, after a backup).**
   - Migration `e4f6a8b0c2d5` (`seo/core/charset.py`) does the following:
     - converts the database default and every non-utf8mb4 column to utf8mb4_unicode_ci, column by column, keeping type, NULL, default and comment;
     - leaves JSON (utf8mb4_bin) and binary columns alone;
     - stops before any change if an index would pass 3,072 bytes.
   - It is re-runnable. Downgrade does nothing on purpose, because going back would turn Arabic into "?" again.
   - On live it runs only with `SEO_CONVERT_UTF8MB4=yes`, or later with `python -m scripts.convert_utf8mb4`. The script prints the row count of every table before and after. Test databases (`*_test`) are always converted.
   - **Live copy:** 97 tables and 343 columns converted.
     - Time: **15.8 s** on a fresh load; a first run took 23.3 s. `pages` was the slowest table (5.7 s), then `gsc_query_page` (3.2 s).
     - Row counts are equal in all 97 tables (1,414,364 rows).
     - Column definitions (type, NULL, default, extra, comment) are identical, and so are all 316 index entries.
     - **No index issue:** the longest text index is 190 characters (760 bytes); all tables are DYNAMIC.
   - Text already saved as "?" can't be recovered. Only new reads are right.
   - **Also:**
     - An event whose before equals after is never saved.
     - A stored "?" against a letter latin1 can't hold counts as the same text, so it is not an edit.
     - A real Arabic title change is still an edit.
   - Tests:
     - `test_a_title_a_latin1_table_saved_as_question_marks_is_not_an_edit_every_day`
     - `test_same_value_rules`
     - `test_the_conversion_keeps_types_defaults_indexes_and_rows_and_json_stays_as_it_was`
     - `test_an_index_too_long_for_utf8mb4_stops_the_conversion_before_any_change`
     - `test_every_script_and_emoji_goes_through_every_path_after_the_conversion`. It puts the tables back in latin1, shows "تأسيس…" saved as "?", converts, then round-trips "Créer société à Dubaï", "تأسيس شركة في دبي" and "🏆 test" through: keyword add plus Search Console query match, a competitor page's title and meta read by the crawler (and no edit on the next read), a backlink file plus bulk save, a competitor link file (anchor and title), a note and a task title.
   - **Screens:** Arabic shows right to left inside its cell, with no spill and no sideways scroll, on Keywords, Overview queries, the Competitors changes and a competitor profile. Checked desktop 1440 and phone 390, EN and FR: `tests/ui/flow_all_scripts.cjs`, 72 checks, all pass.
     - One fix: an Arabic search on Overview flipped the whole box, and the browser's clear button sat on the search icon. Fixed in `mockup.css`. See `competitor-noise-shots/arabic-search-box-after.png`.
4. **Redirects: Fixed.**
   - A read that lands on another page of the site stores `pages.final_url` and `last_status = 'moved'`.
   - It records one "redirect" event, shown as "Moved to another address" / "Déplacée vers une autre adresse", with "→ /new-path". It is recorded once, and only for a page read before.
   - The target's text is never saved under the old address.
   - Test: `test_a_page_that_now_redirects_is_one_moved_event_never_a_rewrite`. Screens: `competitor-noise-shots/*-competitors-changes.png` and `*-competitor-profile.png`.
5. **New pages: Fixed.**
   - **The first read ends only when the list is whole.** A failed or too-large sitemap file means it isn't (`complete_list` now honours `cut`). Feed and link lists keep the old rule.
   - **A page is new only when found after the first read, and its own date is after watching began.** The date used:
     1. the page's datePublished;
     2. else the earliest of its sitemap date and first Wayback copy;
     3. else the day it was found.
   - An older page is kept hidden as "found later".
   - Dates are read in the forms sites write: ISO, "May 26, 2020, 11:26:50 AM", "26 mai 2020", "26/05/2020", e-mail form (`seo/crawl/pagedates.py`).
   - **Charts:** they use the page's own date, else a shown "new page" day, and never put an undated old page in this month.
   - "Added, 30 days" (W10) counts pages by their own dates.
   - Tests:
     - `test_the_first_read_does_not_end_while_a_sitemap_file_failed`
     - `test_a_page_found_later_is_new_only_when_its_own_date_is_after_watching_began`
     - `test_page_dates_in_the_forms_sites_write_them`
     - `test_the_new_pages_chart_never_puts_an_undated_old_page_in_this_month`
6. **Today's competitor changes (W0): Fixed.**
   - Pages paired with mine are picked first. The SQL then reads only their events (`page_id IN …`) before the 500 cap.
   - Hidden events and new pages are left out.
   - Test: `test_today_finds_a_paired_rival_page_edit_behind_600_newer_changes_elsewhere`.
7. **Existing data: Fixed (script).**
   - `scripts/reclassify_competitor_events.py` (rules in `seo/competitors/reclassify.py`) is a dry run by default; `--apply` keeps the changes. It takes about 40 s on the live copy. It is re-runnable, and nothing is deleted: `hidden = 1` with `hidden_reason`.
   - **Rules:**
     - **same_text:** before = after, an HTML entity apart, or "?" text;
     - **listing:** a change on a listing page;
     - **redirect:** the canonical moved to another page, and the same read's events become one moved event;
     - **template:** the changed words sit in 5-word runs found on at least 3 of the site's pages across all saved versions, or a few labels moved;
     - **found_later / first_read:** for new pages.
   - It also:
     - resets each page's last edit date from the shown edits (W11);
     - sets `final_url` on moved pages;
     - reopens the first read of a site whose backlog is still running (well-tax.com).
   - Test: `test_stored_events_are_hidden_by_the_rules_and_real_edits_stay`, with a known answer for every rule and a second run.

**Also fixed, same cause:**
- **W5:** "Page changes, 30 days" in the Competitors list and export now counts pages edited, without new or removed pages, as the cards do (`profile.edits_last_30_days`).
- **W11:** "Updated, 12 months" shows a dash when under 10% of pages (or 5) carry a date. Test: `test_updated_in_12_months_is_not_shown_when_few_pages_carry_a_date`.

## Tests run

- **Full pytest** on `test_fix_comp_test`: green, 0 failures, after the last commit.
- **JS:** `node --test tests/js` passes.
- **New tests:**
  - `tests/test_competitor_noise.py` (18) and `tests/test_text_all_scripts.py` (3).
  - The behaviour tests among them fail on the old code for the right reason: 9 of 9, run in a worktree of `57c3da5`.
- **Playwright** (made-up demo world plus `tests/ui/seed_all_scripts.py`):
  - `flow_all_scripts.cjs`: ALL PASS.
  - `flow_competitor_cards.cjs`: ALL PASSED, after dating the demo's new page today. Its sitemap date was 2 weeks before watching began, so the new rule rightly called it "found later".
  - `flow_edits_chart.cjs`: ALL PASS.
  - `flow_who_is_moving.cjs` and `flow_competitor_follow.cjs` fail the same way on the old code: they need their own server or seed.
- **Screenshots:** `reports/seo-expert-2026-11-17/fixes/competitor-noise-shots/` (made-up sites only): Keywords, Overview queries, Competitors changes and competitor profile, at 1440 and 390, in EN and FR.

## Files

- **New:**
  - `seo/crawl/noise.py`, `seo/crawl/pagedates.py`, `seo/core/charset.py`, `seo/competitors/reclassify.py`;
  - migrations `d1e3f5a7b9c2` (hidden events, `pages.final_url`, `pages.blocks`, `site_boilerplate`) and `e4f6a8b0c2d5` (utf8mb4);
  - `scripts/convert_utf8mb4.py`, `scripts/reclassify_competitor_events.py`;
  - tests and the UI flow and seed.
- **Changed:**
  - crawler: `seo/crawl/extract.py`, `seo/crawl/store.py`, `seo/competitors/pages.py`, `seo/competitors/crawl.py`, `seo/core/models.py`;
  - readers of `change_events` (every one now keeps `hidden = 0`): `insights.py`, `collective.py`, `profile.py`, `change_facts.py`, `seo/pages/service.py`, `seo/metrics/today.py`;
  - export labels; `comp-list.js`, `today-live.js`, `mockup.css`; `README.md` rules.

## For the owner

1. **utf8mb4:** back up (`python -m scripts.backup_db`), then run `python -m scripts.convert_utf8mb4`.
   - It took about 16–23 s on this Mac for 541 MB. o2switch may be a few times slower, and the tables are locked while each converts.
   - Until it runs, "?" text no longer makes fake edits, but Arabic and emoji are still saved as "?".
2. **After deploying:** run `python -m scripts.reclassify_competitor_events` to see the counts, then the same with `--apply`. It hides 6,766 events (2,969 edits and 3,797 new pages) and adds 28 "moved" events. It also restarts well-tax.com's first read, which was still taking in its backlog: its pages found during that read aren't news.
3. **Costs and limits:**
   - Each edit found now costs one more page request, for the confirming read.
   - On the first read after deploy, a page saved in the old one-line format is saved again block by block. A text edit made exactly then is not reported; title, meta and other field changes still are.
   - A block shared by 3 or more pages of a site is treated as its template. An edit made only inside such a block, on every page at once, isn't shown.
