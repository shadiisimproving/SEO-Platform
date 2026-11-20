# Fixes: links and competitor numbers, round 2 (2026-11-18)

Branch `fix-links2-2026-11-18` (from `fix-all-2026-11-17` d621cd8). Evidence: `accuracy/links.md` + critique, `accuracy/competitors-exports.md` W4 and W14 + critique.

Live figures come from `test_live_links2_test`. It is a copy of the 2026-11-17 16:30 live snapshot, read from `test_live_snap_test` because the `.sql.gz` in the scratchpad had been cleaned away. It was migrated to this branch's head. Each "before" was measured on d621cd8 code and matches the reviewers' figures. Screenshots use the made-up demo world only.

The owner's rule of 10 Nov is unchanged: **the file's spam score still decides** on Link gaps. Nothing a file scores 30 or less is moved to "Flagged".

| # | Item | Status | Before → after (live copy) |
|---|---|---|---|
| 1 | App's flag kept on the row | **Fixed** | Site 1: 320 of 733 "Good ones" carried the app's flag, with no trace on the row. Now each of those 320 shows "The app saw: …", the header says "320 App flagged", and an "App flagged" chip filters them. 95 of the 320 are the weaker "site down", which shows its date. Site 2: 178 (22 site down). Site 3: 1,028 (441 site down; 449 of them in the 2,000 listed). |
| 2 | "Followed links only" with no follow column | **Fixed** | Before, the box was ticked and hid 0 of 733 (every status unknown). Now it is not ticked and is disabled, with the note "This file doesn't say which links are followed". Unknown ones are counted apart: `follow_unknown` 733 / 487 / 4,416. |
| 3 | Stale links | **Fixed** | "Good ones" for site 1 drop from 733 to **402**, with "331 Old links, left out". Site 2: 487 → 429 (58 old). Site 3: 4,416 → 3,495 (921 old). The "Include old links" chip brings them back, each tagged "Old link (last seen …)". |
| 4 | Anchor type from the page | **Fixed** (see the owner note) | lavoixdunord.fr and paris-normandie.fr: before, "Brand · set by hand", from the typed "Créer Société Dubai". Now the type comes from the anchor read on the page, "Always Improving", and is no longer marked set by hand. The tip says "On the page: “Always Improving”. Your type (Brand) is used only when the page can't be read." Site 1 mix: Exact 4 · Brand 2 · Partial 5 → Exact 3 · Brand 2 · Partial 6. |
| 5 | One spam line at 30 | **Fixed** | One rule everywhere: **above 30 is spam, 30 is not**. These are the owner's words of 10 Nov ("File spam score above 30"). Backlinks (`>=`) and the task pickers (`>= 30`) now ask `cleaner.is_spam_score` / `BacklinkCleaner.isSpamScore`. The Backlinks wording now says "a spam score above 30". On the live copy, 20 competitor domains score exactly 30 (7 of them in site 1's Good ones). They are now "not spam" on every screen; before, the task picker called them spam. No backlink or prospect scores exactly 30. |
| 6 | Competitors export tiles (W4) | **Fixed** | Site 1: Keywords shared **445 → 108**, Where I am ahead **156 → 18**, Where they are ahead **289 → 129**. 129 equals the rows of the export's second sheet. |
| 7 | Pair "N shared keywords" (W14) | **Fixed** | Pair 128: **31 → 6**, beside "they ahead 6, me 0". Pairs whose count differed from their ranking: 78 of 168 → 0. |

## What changed, per item

1. **App's flag** (`seo/competitors/quality.py` `app_flag`, `seo/competitors/gaps.py`, `design/mockups/comp-gaps.js`).
   - Each good row the file's score lets through carries `app_flag`: reason, words, the site it leads to, weak, and the check date.
   - The row's Status shows "The app saw: redirects to link-shop.example" in warning colour.
   - Site down is muted, with a clock and its day: "The app saw: site down on 11 Nov 2026". It isn't re-checked here; its date shows instead.
   - The new column `link_domains.redirect_to` (migration `f7a9b1c3d5e7`) stores where a home page led. Only checks run from now on fill it. The 90 older "redirects" on site 1 say "redirects to another site" until their next check.
   - The funnel has `app_flagged` and `app_flagged_weak`. The header shows "N App flagged" with a tooltip, and the Spam filter has an "App flagged" chip.
   - The Link gaps export gains the tiles "App flagged" and "Old links", plus the columns "The app saw", "Leads to", "Checked" and "Old link, last seen".
   - A row a person kept ("Not spam") shows no app note.
2. **Follow unknown** (`comp-gaps.js`).
   - `S.followed` starts as "auto": ticked only when some row's follow status is known.
   - With none known, the box is unticked and disabled, with the note. With a mix, it says "N not known: their file doesn't say".
   - The funnel has `follow_unknown`.
3. **Old links** (`gaps.py` `months_before`, `is_old`, `old_link`).
   - A link is old when it was last seen more than 6 calendar months before its file's upload date (`competitor_referrers.last_seen_at`, as no export carries its own date).
   - A domain is old only when every one of its links is old and no competitor lists it without a dated link (Common Crawl, by hand).
   - Old ones are left out of Good ones, the table and "Add all good ones" until the "Include old links" chip is pressed. A help line under the table says how many are left out and has a "Show them" link.
4. **Anchor** (`seo/backlinks/service.py`, `backlinks-seo.js`, `mockup.js`).
   - The rows now carry `anchor_read` and `anchor_by_hand`. "Set by hand" shows only when nothing was read.
   - Editing a link keeps the anchor that was read, unless the address changed.
5. **Spam line** (`seo/backlinks/cleaner.py` `is_spam_score`, `protect.suggested`, `seo/tasks/options.py`, `quality.verdict`, `cleaner.js` `isSpamScore`, `backlinks-seo.js`, `mockup.js`).
6. **W4** (`seo/competitors/collective.py` `totals`, `seo/exports/views_competitors.py`).
   - Each keyword is counted once.
   - Shared: I and at least one followed rival rank.
   - I am ahead: above every rival there.
   - They are ahead: a rival above me, or ranking where I don't. This is the same rule as the second sheet.
7. **W14** (`seo/competitors/pairs.py`).
   - The stored count is `ranking_summary(...)["shared"]`: one check per keyword, both pages in it. The pair is still chosen by its neighbour on any engine.
   - The list, profile and export show today's ranking count, not the count saved at the last refresh.

## Tests
- New: `tests/test_links2_fixes.py`. It has 13 tests, each with a hand-worked answer: app flag, site down weak, kept by a person, follow unknown, old link and its 6 months from the file, calendar months, anchor from the page, the 30 line, W4 tiles 3 / 1 / 3 against summed 6 / 3 / 3, and pair 2 against 3 across engines.
- New: `tests/js/spam_line.test.cjs`.
- Changed: `tests/test_link_quality.py`, where the funnel has new keys and a redirect target is stored.
- 12 of the 13 failed before the fix and pass now. The 13th, a 30 score staying Good on Link gaps, guards the owner's line and already passed.
- Full pytest on `test_fix_links2_test`: green, about 3,080 tests, exit 0. `tests/test_text_all_scripts.py` was run on its own and passed too (3 of 3), including the collation test that fails on d621cd8.
- `node --test tests/js`: all pass.
- Playwright: `tests/ui/flow_links2_fixes.cjs` drove Link gaps and Backlinks at 1440 (full and simpler screens) and 390, in English and French. ALL PASS. Screenshots are in `fixes/links2-shots/`, and each one was looked at: the app note under Lost link, the old-link tag, the disabled follow box with its note, the App flagged chip, the phone cards and no sideways scroll.

## For the owner
- **"Always Improving" counts as Brand on every site**, because the brand rule "always improving" is set for all sites (`site_rules`, `site_id` NULL). So the anchor on lavoixdunord.fr and paris-normandie.fr is now read from the page and is still Brand. The reviewer counted it as "Other": your agency's name, not creer-societe-dubai.fr's brand. If you agree, limit that rule to the agency's own site in Search settings. Both rows will then say Other.
- **Redirect targets:** only home pages checked from now on name the site they lead to. A one-off re-check of the 342 older "redirects to another site" domains (90 / 82 / 170) would fill them in. Say if you want it run.
- **A migration** (`f7a9b1c3d5e7`, after `e4f6a8b0c2d5`) adds a column. If other fix branches also add a migration after `e4f6a8b0c2d5`, the merge needs an Alembic merge revision.
- **Hard flags overriding the file score:** this round does not change your 10 Nov rule. It only shows the app's flag on the row. Whether "redirects elsewhere", "parked" and "no home page" (96 on site 1) should move to Flagged is still your call.
