# Code audit, 2026-11-05

Three read-only Fable reviews: platform and security, SEO logic, front end and API. No code was changed.

**Result: 43 findings: 1 high, 15 medium, 27 lower. None is a crash or data loss in normal use.** The biggest risk is wrong numbers shown without warning.

**Marks:** ✔ = re-read in the code after the review. "Likely" = the reviewer couldn't fully prove it from the code. Everything else was traced by the reviewer but not re-read.

## Fix status, 2026-11-05

**39 of the 43 are fixed, none committed or uploaded.** The full test suite passes (2,128 tests, one run on `seo_cc_h_test`), and `tests/ui/flow_audit_screen_fixes.cjs` passes 18 of 18. New migration: `b0c0d0e0f0a0` (`login_failures`), which runs by itself on the next upload.

**Not changed, on purpose:**

- **19:** not a bug after all. A CSV that lists a domain added by hand really does report it, so "By hand" no longer describes it. Typed scores and hand removals still survive. The re-read mark below only meant the code does this.
- **31:** the upload script can't be tested without the server, and the risk is low.
- **42:** the polls stop by themselves within 90 s, and the result is useful wherever you are.
- **Part of 41:** the page picker hiding its errors. You can still type an address.

**16 is a documentation fix:** `deploy/DEPLOY.md` now has the recovery steps.

**Behaviour that changed, worth knowing:**

- **Signing out** now ends that person's other sessions too (finding 29).
- **Login lock (13):** 5 wrong passwords lock that address out of that account for 15 minutes, and 50 from anywhere lock the account. Team's "Locked for now" now only shows the second kind. It relies on `request.remote_addr`, which hasn't been checked on o2switch: if every visitor shows the same address there, it behaves as it did before.
- **Yandex through Bright Data or SerpApi (2)** now fills the keyword row with no set country, because those tools can't pick one.
- **Collector jobs (27)** now retry through a temporary outage, up to 100 tries. Scans still stop after their usual few tries when the database keeps failing, as a test requires.
- **Link-gap sites that are down (25)** get their second try at least 6 hours later.
- **"Not ranked" (18)** no longer counts keywords nobody has checked.

**Limits of the testing:**

- The tests for 13, 22, 28 and 29 were never run against the old code, so they weren't seen failing first. The tests for 21 and for the average in 24 first failed for a test-setup reason, not the bug.
- These have no test of their own: 32 (prospect rollback), 35, 36, 37, 38, 43, the Try again buttons in 41, `comp-ai.js` in 8, `link-extras.js` in 34, and 39 for delete task, spam decision and change password.
- 4 still needs checking against real GA4 data. No real API has been called.

**Existing screen tests re-run:** Collective competitors (85), link edits (30), task cards (32), setup, CSV prospects, backlink To do, Today and no-sample-buttons all pass. Keywords passes everything except "no console errors", which comes from its test server having no login routes.

## What was run

| Check | Result |
|---|---|
| Full pytest suite, on idle database `seo_cc_h_test` | Passed, one run, about 2,100 tests |
| Syntax of all 30 JS files and all Python | Clean |
| Migrations | 16, one head (`a9b9c9d9e9f9`), and they match the models |
| Permissions and every route | No hole found: default-deny login, CSRF, admin gates, secrets never returned |
| API paths and fields used by the JS | All match a Flask route |

## What this audit doesn't prove

- **No real API has been called.** Google, Bing, SerpApi, Bright Data and the others have only run against fakes. Finding 4 depends on this.
- The Playwright UI flows in `tests/ui/` were not run.
- Not read closely: `seo/crawl/spike.py`, `cleaner.js`, `comp-sample-data.js`, `data.js` lines 204-330, all CSS, and how Common Crawl parsing behaves on real files.
- `design/mockups/data.js`, `keywords-real.js`, `mockup.css` and `mockup.js` had uncommitted changes from another session, and were reviewed as they stood.

## High

1. ✔ **Today can show one site's numbers under another site's name.** `today-live.js:33-45`. A slow answer for site A lands after site B's, with no check that B is still selected. Fix: compare the query before saving the answer.

## Medium: wrong or missing numbers

2. ✔ **Yandex rankings through Bright Data or SerpApi never fill the keyword row.** `serp/tools.py:234,386`, `serp/rankings.py:100-116`. They save an empty location, so `same_place` treats every check as "away", and the keyword stays unranked. Fix: send and store a real region, or accept "unlocated" for Yandex with a label.
3. ✔ **SerpApi deeper checks stop early.** `serp/tools.py:252-254`. Google returning 9 results on page 1 ends the loop, the check saves as depth 20 with 9 rows, a site at 12 reads "not in top 20", and `_just_checked` blocks "Check deeper" for 12 h. Fix: stop only on an empty page.
4. Likely: **Backlinks on a subdomain show 0 visits.** `metrics/backlink_traffic.py:56`, `backlinks/service.py:151`. Only `example.com` and `www.example.com` are looked up, while GA4 probably reports `blog.example.com`. Check against real GA4 data. Fix: compare root domains.
5. ✔ **A backlink with a UTM source but no campaign shows 0 visits for good.** `backlinks/live.py:332`, `metrics/backlink_traffic.py:46`, `collectors/ga4.py:103-104`. Those sessions land in neither GA4 table. Fix: match on source and medium, and keep those rows.
6. ✔ **"All sites" Content and Conversions merge pages from different sites.** `metrics/service.py:280-283,325-337`. `/contact/` on sites A and B becomes one row, with summed numbers and a blended position. Fix: key on site and path.
7. ✔ **Settings can show sample statuses in the real app.** `settings-live.js:59-62,436`, `data.js:159-167`. If `GET /api/sources` is slow or fails, it shows Google "failing", Bing "Connected ••c41d" and "Used by: site-one, site-two". Fix: reset them at load when served, and show a loading or error state.
8. ✔ **Link gaps and Page vs page keep a slow answer from the previous site.** `comp-gaps.js:644-650`, `comp-pairs.js:821-828`, `comp-ai.js:206-207`. The review found "Add N to In consideration" can then post site 1's domains under site 2. Fix: compare the site before saving the answer.
9. ✔ **Health test has the same race.** `health.js:168-182`. Site A's score shows on B's page, and Create task files A's problems under B. Fix: re-check the site after the second request.
10. **Health alert and card compare against different tests.** `health.js:230-240`, `health/service.py:434-440,507-530`. With tests of 100, 30 and 100 pages, the alert says "80 to 70" while the card says "can't be compared". Fix: have the server say which test it compared.

## Medium: reliability and security

11. ✔ **The job heartbeat dies on one database hiccup.** `worker/runner.py:137-141`. The job then runs twice, and enough repeats mark a healthy job dead. Applies once the crontab is installed. Fix: catch the error and retry on the next beat.
12. ✔ **The robots.txt redirect skips the private-address check.** `crawl/fetch.py:143`. A competitor's site can make the server call an internal address. It can't read the answer, but this breaks the README's rule. Fix: follow redirects by hand through `is_allowed`.
13. ✔ **Anyone who knows a username can keep an account locked.** `accounts/service.py:124-128`. Five wrong passwords lock it for 15 minutes, with no limit per address, and the correct password is refused too. Sign-in by username makes the name easier to guess. Fix: throttle by address as well. This is separate from the decision against two-step login.
14. ✔ **Saving Google settings again after a partial failure creates a duplicate connection.** `settings-live.js:143-166`, `sources/service.py:54`. Fix: clear the key after the first successful save.
15. "Read again" stops watching after one failed poll, and "Reading…" keeps spinning. ✔ `comp-pairs.js:509,530,537`. Fix: `catch { keepWatching(); return; }`.
16. Likely: **A migration that fails halfway blocks every later deploy.** `deploy/server_release.sh:32`. MariaDB can't undo table changes, so the rerun fails on "table already exists". Fix: document the recovery with `alembic stamp`, and make data steps safe to rerun.

## Lower: logic

17. "Just checked" counts checks that don't fill the row, blocking Refresh. `serp/refresh.py:114-127`
18. Never-checked keywords count as "Not ranked". `serp/rankings.py:255-263`
19. ✔ A CSV upload overwrites the "By hand" label, so the row loses its hand-added flags and "Back to automatic data" no longer removes it. Typed scores survive. `competitors/gaps.py:55-58`
20. With spam kept, a spam row with no URL counts twice, and "kept" can go negative. `competitors/gaps.py:63-77`
21. Search Console's "data through" is set before the per-day tables are read. `collectors/gsc.py:80-85`
22. Likely: the Open PageRank month is skipped if the first run stops partway. `collectors/jobs.py:154-155`
23. Mediator counts and renames miss spelling variants such as a double space. `backlinks/mediators.py:44-46,91`
24. Competitor screens count a keyword once per engine and average positions across tools, against the no-mixing rule in `collective.py`. `competitors/pairs.py:128-156`, `competitors/suggest.py:116`
25. A site that's down gets its final retry within the same minute, then is flagged as spam. `competitors/quality.py:190-201`
26. SerpApi's hourly cap is reported as "none left this month", and the list waits a day. `competitors/keywords.py:316-318`
27. ✔ Temporary errors count as attempts: a 45-minute outage kills a collector job for about 20 h. `worker/queue.py:150-151`
28. ✔ Uploads have no overall size limit, and two are read into memory before any check. `web/competitors_api.py:69,220`, `web/__init__.py`
29. ✔ Log out doesn't end the session on the server: a copied cookie works for up to 14 days. `web/auth.py:108-111`
30. Likely: a backup can hang if the database dump writes a lot of warnings. `scripts/backup_db.py:39-43`
31. Likely: a job running during an upload can mix old and new code. `deploy/server_release.sh:34`

## Lower: screens

32. ✔ Prospect edits and removals aren't undone on screen when the save fails. `mockup.js:3215-3221,3314-3320`, `comp-gaps.js:47-54,100-106,450-455`
33. One failed background refresh replaces the whole task board with "That didn't load". `tasks.js:168-182,618,815-828`
34. Error toasts show the green success icon. `link-extras.js:176,185`, `uptime.js:163,173`
35. ✔ One failed Backlinks load keeps the error until a full page reload. `mockup.js:628-642,801`
36. Link gaps totals and buttons disagree past 2,000 domains, and "Select all shown" picks rows that aren't shown. `comp-gaps.js:122,139,146,250,255,592`
37. The timeline can show two groups with the same date in Dubai. `comp-list.js:405,412`
38. Stop test can stay on "Stopping…" after a refused request. `health.js:476-482`
39. Double clicks send two requests: add site (`mockup.js:2835-2860`), delete task (`tasks.js:529-542`), spam decision (`comp-gaps.js:462-473`), change password (`login.js:34-37`).
40. The table's task total ignores the status filter: "12 tasks" over 3 rows. `tasks.js:599-600,656-657,851`
41. No retry after a failed first load on Health and Uptime; the page picker hides its errors; a focus target doesn't exist. `health.js:184-192`, `uptime.js:138-146,232`, `comp-pairs.js:541,647`
42. Uptime polls keep running on other screens, for up to 90 s. `uptime.js:150-181`
43. Likely: Notes can offer the previous site's competitors after a fast switch; the server refuses and the text is kept. `comp-notes.js:773-780`

Leftover in the uncommitted files: a no-op `${tool.manual_only ? "" : ""}` at `keywords-real.js:594`.

## Owner rules checked and respected

- Ranking comparisons in the Keywords view, competitor timelines, Collective and AI watch stay within one tool, location and depth. Findings 17 and 24 are the exceptions.
- The browser backup counts only for the Mac's country.
- Nothing runs scraped rankings automatically except the first upload of a keyword list.
- Spam is flagged, never removed, and a low rank isn't spam.
- Links Checker and health test read the whole site, resume, and pause on the budget.
- HasData is Google and Bing only; SearXNG is Bing and Yandex only.
- Typed scores and hand removals survive uploads. Finding 19 is the one gap.

## Suggested fix order

1. **Wrong numbers:** 1 to 10, plus 19. Mostly one-line guards and small query changes.
2. **Before installing the crontab:** 11, 27, 22, 25.
3. **Security:** 12, 13, 28.
4. **The rest**, starting with 14, 15, 32 and 35.
