# Link gaps: hard facts beat the file's spam score (owner decision, 2026-11-18)

Branch `fix-spamfacts-2026-11-18` (from `fix-all-2026-11-17`). Not pushed, merged or deployed.

## The rule now
1. A person's choice (Not spam / Mark as spam) beats everything.
2. The file says spam (score above 30): spam, reason "File spam score above 30".
3. The file says good, but the app's own check found a **hard fact**: the site redirects to another website (`leads_elsewhere`), the domain is parked (`parked`), or there is no home page (`no_home_page`). Then it goes under Flagged, "Flagged by the system" (cog) and the reason.
4. Otherwise the file's score decides. "Site down" (and the other checks: spam words, noindex, etc.) only leave the note on a good row, as before.
5. No file score: the app's checks decide, as before.

One place: `quality.verdict()` with `quality.HARD_FACTS` (`seo/competitors/quality.py`). Link gaps, the all-sites list (collective), the competitor card's "+N flagged" and the import's flagged count all use it, so they follow.

## Fixed
- **Rule** (commit 547ccb3). `verdict()` changed as above; `app_flag()` now also returns the note on a row a hard fact flagged though the file said good, with `over_file` = the score it overruled. Gaps rows carry `redirect_to` when flagged for a redirect.
- **Screen** (commit 658076f, `design/mockups/comp-gaps.js`). Such a row shows, in every view (also under "Flagged as spam", where the reasons line only gives the general reason): cog "Flagged by the system" + "Redirects to cvgorilla.com · file score 5 overruled" (FR "Redirige vers … · score du fichier (5) écarté"); its tooltip gives the check date and says Not spam puts it back. The Not spam button sits on the row as before; on any row the app flagged its tip says "Overrides the app's check: back to Good ones." (FR "Passe avant le contrôle de l'appli : retour parmi les bons."). The header counts come from the server, so they follow. No new CSS.
- README has no text on the spam rule, so nothing to change there. The module docstring of `quality.py` states the new rule.

## Tests (known answers)
`tests/test_spam_facts.py` (failed first, then passed): redirect + file score 5 → flagged (system, leads_elsewhere, `over_file` 5, target kept); parked + 10 → flagged; no home page + 3 → flagged; site down + 5 → good with the weak note; spam words + 5 → good with note; Not spam on the redirect → good, kept, no note; file score 50 + redirect → reason stays the file's; competitor card 3 good / 3 flagged.
Updated for the new rule: `tests/test_links2_fixes.py` (moved.example with score 3 + redirect is now flagged; app-flagged count 2 → 1) and `tests/test_link_quality.py` (parked.example with score 3 is now flagged).

- Full pytest on `test_fix_spamf_test` (minus the known `tests/test_text_all_scripts.py`): **3145 passed, 0 failed**.
- `node --test tests/js`: 9/9.
- Playwright `tests/ui/flow_spam_facts.cjs` (demo world, made-up domains: local-news.example redirect + score 2, home-kitchen.example parked + score 6 and In To do, coffee-review.example site down + score 3): 1440 simple, 1440 full, 390, in EN and FR. **ALL PASS**. Screenshots in `fixes/spamfacts-shots/`, each one looked at: the redirect row under Flagged with its target and overruled score, the Not spam tooltip, the phone card with Not spam, the row back in Good ones with "Kept by you" and counts 10 → 9 flagged.

## Before → after on the live copy (`test_live_new_test`, read-only session, computed with the functions)
| Site | Good | Flagged | Moved to Flagged |
|---|---|---|---|
| 1 creer-societe-dubai.fr | 733 → 637 | 213 → 309 | 96 (90 redirect, 3 parked, 3 no home page) |
| 2 comptabilite-dubai.com | 487 → 400 | 105 → 192 | 87 (82 redirect, 2 parked, 3 no home page) |
| 3 business-setup-dubai.com | 4,416 → 4,229 | 758 → 945 | 187 (170 redirect, 14 no home page, 3 parked) |

Good rows still carrying the app's note after the change: 224 / 91 / 841 (site down and the softer checks).

## For the owner
- On the live data, none of the 266 redirecting domains has its target saved yet (`redirect_to` came with the links2 fixes, not live). Until each is checked again they read "Redirects to another site", without the site's name.
- A domain in Consideration or To do that a hard fact flags stays the person's (as any flagged one did): it shows the note with the overruled score, but it's counted in "Flagged as spam" like before.
