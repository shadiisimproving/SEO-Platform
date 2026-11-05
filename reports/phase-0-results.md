# Phase 0 results (2026-11-04)

Measured from this Mac. Raw data is in `reports/raw/`. The passing SearXNG results were a hand check, saved as `searxng-hand-check-20261104T075754Z.txt`.

## Crawl: 3 competitor sites, 250 pages, 2 passes

| Site | Pages in sitemap | Pages read | Sitemap dates | Seconds per page | Blocked | JavaScript only |
|---|---|---|---|---|---|---|
| societe-emirats.com | 382 | 150 | 100% | 3.4-3.8 | 0% | 0% |
| creation-societe-dubai.fr | 12 | 12 | 0% | 3.2 | 0% | 0% |
| dubai-investissement.com | 88 | 88 | 100% | 3.2-3.3 | 0% | 0% |

| Measure | Result |
|---|---|
| Answered 304 on the second pass | **0 of 250** |
| Hash unchanged on the second pass | 250 of 250, so no false "changed" results |
| CPU per page | About 14 ms, of which parsing is 5-7 ms |
| Peak memory | 66 MB for 3 sites at once |
| Download per page | 95-205 KB, about 161 KB on average |
| Database after the first pass | 12.7 MB per 1,000 pages (10.5 KB per saved version) |

**What this changes:**
- **Conditional requests save nothing on these sites.** They stay in the code because they are free, but the real saving has to come from sitemap dates: 2 of the 3 sites date every page. Whether those dates are honest needs watching over time.
- **CPU is not the limit; time and bandwidth are.**

| 40,000 pages a day (20 sites of 2,000), every page read | Estimate from these numbers |
|---|---|
| Crawl time, 4 domains at once | About 9.2 hours for a repeat pass, 10 hours the first time |
| CPU | About 9 minutes |
| Download | About 6.6 GB |
| Database, first crawl | About 510 MB once |
| Database, later | About 250 MB a month, **if 2% of pages change daily (a guess)** |

**Limits of this test:** only 3 sites, both passes on the same day, from this Mac's connection. Blocks and speed may differ from o2switch's IP, so the upload phase measures again.

## Job queue

- 4 workers claiming 100 jobs: every job claimed once.
- `kill -9` mid-job: the job is recovered and finishes, exactly one row exists, and it does not count as a failed attempt.
- All 142 automated tests pass on the real MariaDB 11.4.13.

## Search engines from this Mac

| Source | Google | Bing | Yandex | DuckDuckGo |
|---|---|---|---|---|
| Plain request | Failed: needs JavaScript | Failed: 0 results | Failed: captcha | **Passed: 10 results** |
| Real browser | Passed, 4 loads; first hit a captcha that cleared | **Passed:** 10 results, no captcha | Passed, 2 loads; first hit a captcha that cleared | Not needed |
| SearXNG (local) | **Failed:** access denied on the one search that reached it | **Passed:** 10 results, 2 of 2 | **Passed:** 10 results, 1 of 1 | 1 passed, then a captcha |

**DuckDuckGo direct changed its answer later the same day.** That afternoon a GET and a form POST, 20 s apart, with the declared bot name, both got HTTP 202 and a bot-check page (`anomaly` in the page). Its `robots.txt` allows crawling. The tool stops at a bot check and says so, with no evasion, so it can't be counted on as the free source. Whether it was temporary is unknown. Only these 2 requests and 2 reads of `robots.txt` were sent.

**SearXNG decision:** added as a free backup for Bing and Yandex, labelled by engine; DuckDuckGo direct is the better source for DuckDuckGo. Not for Google. One denial is thin evidence on its own, but it matches `deploy/searxng/README.md` and public reports. SearXNG needed a 15 s time limit; the default gave only timeouts. **The real test is from o2switch's IP, at upload.**

**A mistake to record:** a wrong engine name made SearXNG fall back to its defaults, so a Google search went out on the same day as the browser tests, which the plan meant to avoid. The run asked 3 times. Google denied the first, and SearXNG then suspended that engine, so the other 2 show `Suspended` and sent nothing. `scripts/test_searxng.py` now refuses unknown engines.

## Mockups: tested by hand with Playwright

3 screens, 3 looks, light and dark, English and French, plus open panels, dialogs, errors and first run.

| Check | Result |
|---|---|
| JavaScript errors across every flow | None |
| Accessibility (axe, WCAG AA) | 168 screens: 3 looks × 2 modes × 2 languages × 14 states. Clean, except one flagged because the scan caught it mid fade-in; settled, it is clean 3 of 3 |
| Page scrolling sideways | Never: 29 widths from 320 to 1,920 px, 3 pages, 2 languages (174 checks) |
| Tables | Every column shows from 1,024 px up. Narrower, the table scrolls inside its box with a soft edge. At 640 px and below, tables become cards |
| Tiles | Rows always full at every width tested |
| Geist aligned digits | **Confirmed:** 111111, 000000 and 888888 have the same width |
| French accents, `œ`, Arabic fallback | **Confirmed by the browser's own report:** Geist for `œ`, accents and digits; Noto Sans Arabic for Arabic |
| Keyboard only, reduced motion | Work, including the collapsed menu and restored drafts |
| Opening the file directly | Works, console clean |

**Bugs found by using it, all fixed:**
1. Clicking away to close a menu also pressed what was underneath, which opened a keyword panel.
2. Double-clicking Confirm sent the second click through to the table.
3. Toasts covered the side panel's title and close button, so they moved to the bottom left.
4. At 1280 px the Keywords table pushed the page sideways.
5. Small grey text on selected rows failed contrast in looks B and C.
6. In dark mode, checkboxes nearly disappeared.
7. Changing a Refresh option moved keyboard focus.
8. Two bright Refresh buttons competed; only one is bright now.
9. The progress tray overlapped the selection bar.
10. On a phone, "#19" was split from its "Bright Data · 2 d" line.
11. Unclear or wrong text: "2 h" with no meaning in Data sources, "1 warnings", "1 result pages", and the wrong empty message on first run.
12. Going back could leave a side panel open.
13. **Lost work:** Esc, ✕, clicking another row or changing page threw away everything typed in a form. These now keep a draft and say so. Cancel still clears the form, with 8 s to undo.
14. Between about 1,024 and 1,210 px the last Keywords column was cut off with no sign the table scrolled. The menu now collapses to icons by itself at 1,240 px and below; its toggle still wins.
15. Tiles left stranded: Backlinks split 5+1 at 1,280 px and 4+2 at 1,024 and 768 px, Keywords 3+1 at about 700 px.
16. Long source URLs sometimes stopped dead with no ellipsis.
17. On a phone, the "Top 10 · Résultats relevés" label broke into two columns.
18. French period labels were clipped on phones and at 480 px.
19. Tooltips in the collapsed menu covered the icon above.

**Limits of this test:** Chromium only, at simulated sizes, with sample data. Not yet tried on a real phone or with real volumes of data.

## Competitor edits: sitemap or RSS (the owner's question)

Both. The sitemap and reading pages find the edits, and an RSS or Atom feed, where a site declares one, spots new posts sooner. Of the 3 sites tested, only 1 has a real feed, so RSS can't be the main method.

## Common Crawl, checked on the real files (2026-11-04)

Newest release `cc-main-2026-aug-sep-oct`: 134,979,706 domains, 1,817,202,146 links. Domain list 988 MB, links 7.6 GB, ranking 2.5 GB. A small piece of each file was read to confirm its format. S3 answered 503 SlowDown to some of those small reads, so the reader backs off and resumes. No full run yet.

## Still waiting

| Item | Needs |
|---|---|
| Search tool probes: real engine coverage, credit use, AI Overview on French keywords | Accounts on Bright Data, HasData and Searlo; the existing SerpApi key |
| Browser backup compared with an API tool | The same keys |
| Whether captchas cleared with no click from the owner | The owner |
| A clean SearXNG Google test | Can wait until hosting, where it actually matters |
