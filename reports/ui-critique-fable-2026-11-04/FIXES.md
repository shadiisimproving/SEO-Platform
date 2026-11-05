# Fixes from the Fable critique (4 Nov 2026)

What was changed from `CRITIQUE.md`, what was deliberately left alone and why, and what wasn't checked. Nothing is committed or uploaded.

To go back: `var/backups/before-critique-fixes-2026-11-04-1858.tgz` holds `design`, `seo`, `templates`, `migrations`, `README.md` and the tests as they were before these changes. The project isn't tracked in git, so this is the only undo.

## Fixed

**Across the app**
- Unbuilt menu items and the Settings "Sites" and "Team" tabs are muted with a "Soon" tag, and there's nothing to click.
- The same toast no longer stacks. "Not built in this mockup" now reads "Not built yet".
- Keywords and Backlinks: the row's name stays in place while the table scrolls sideways, with a visible scrollbar and a stronger edge shadow.
- Phone header: 50 px, or 88 px on pages with date pickers (was 160 px). The page's main button becomes an icon beside the title.
- Row text no longer shows through a sticky table header.
- In the collapsed menu, count badges no longer sit on the icon.

**Today**
- "Show all" now matches the rows it opens (6, not a made-up 42). Info items no longer lead the header.
- Table view shows the whole period in a scrolling box, not just 8 days.

**Keywords**
- The refresh dialog no longer cuts off the last tool, and it names a tool the run would nearly empty ("Bright Data: 18 left after this").
- Phone cards hide empty dash lines. A real "0" stays.

**Competitors**
- My competitors: "From a suggestion" is gone from the rows and stays on the profile. Zero-count timeline chips are hidden. "Their pages can't be read" no longer repeats under three tiles.
- Find competitors: the button now says "Upload keyword list".
- Page vs page: "Add a pair" starts on a competitor that can be read. A blocked site's verdict says "On rankings only". The help sentence moved to an info icon.
- Link gaps: one line per row for authority, with the scale on a tag ("62 SEMrush", "Top 3% Common Crawl"). URLs break after a slash or hyphen, not mid-word. On phones the spam button has a word.
- AI Overview watch: rows no longer look clickable. "No" matches the other column. On phones a tool shared by every row is named once.

**Backlinks**
- A link can now be edited and deleted from its panel. Measured visits stay when it's edited, it can't become a page already logged on that site, and delete asks first. This adds `PUT /api/backlinks/<id>` and `update_one` in `seo/backlinks/service.py`, with new tests.
- Import flags an impossible date (31/02/2026). The row still imports, because dates are kept as typed. The preview has a visible scrollbar.

**Site health**
- The developer note now reads "The monthly test runs on the hosted version. Here, press Run now."
- A whole history row opens its test.
- On phones, severity, count and change share one line.

**Settings**
- Saving a tool that isn't connected with no key says "Paste the key first." beside the field, and never "Connection saved". This covers Yandex and every other tool that needs a key.
- Google's setup steps fold away once a connection exists, and stay open when it doesn't.
- Phone rows drop the sites line.

**Tasks**
- Type chips are translated. "technical", "Technical" and "Technique" count as one type, and "NOUR" joins "Nour".
- With a mouse, a card's status appears on hover or keyboard focus. Touch screens keep it always visible, since a finger can't drag or hover.
- On phones, filters fold behind a "Filter" button.
- The task count moved beside the title.

## Left alone, and why

| Fable said | Why it wasn't changed |
|---|---|
| Remove "Showing X. Pick another site here." | It's the deliberate fix for F8 in `reports/ux-critique-2026-11-04-followup.md`: the sidebar and the page's own list can disagree. |
| Force authority into one format | F13 decided each value keeps its own scale because the scales really differ. It's shortened to one line, not merged. |
| "Kanban" is untranslated next to "Tableau" | Not a bug. Board→Kanban and Table→Tableau are both right. |
| Grey the cost on lost links | Already done (F18). |
| Hide "In consideration" because it isn't built | It's a working feature: Filter a backlink CSV lives there. |
| The Link gaps Status column is empty for 17 of 18 rows | The count was wrong: the spam rows use it, with their reasons. |
| Command bar only finds keywords | It already lists pages and actions. "visa" just matched only a keyword. |
| Composer needs auto-grow; check that Notes delete confirms | Both already work: the box grows as you type, and delete offers Undo. |
| New task should default to the current site | It already does. "All sites" only shows when the switcher says All sites. |
| Needs attention first on phones | Already first (F9). |
| Whole-site sentence appears twice | The two copies are on separate tabs, and each describes that tab's own scan. |
| One upload button on Link gaps | Fable itself called the current buttons fine, so this wasn't worth the change. |

**Done differently from what Fable suggested**
- Refresh tray: it stays bottom-right, with room added under the table so it never sits on the last rows for good. Moving it to the left would cover keyword names while they update.
- AI Overview rows: the hover was removed instead of opening the keyword panel, because that panel only knows sample keywords.
- Type and Owner: typed values are matched to existing ones instead of becoming selects, so a new type can still be typed.
- Backlink delete: it asks first instead of offering Undo, because restoring a deleted link's full record isn't built.
- Keywords columns: Trend and AI aren't dropped by default below 1000 px, because the sticky name and scrollbar solve the same problem.

## How it was checked

- Full test suite: all pass on `seo_cc_snap_test`. An earlier run on the default test database showed false failures because another session's server wiped that database mid-run. See below.
- Driven by hand with Playwright, like a hurried user, on the sample mockup: 58 of 58 checks, including Esc mid-form, double clicks and blank saves. One of those is a placeholder that always passes; its behaviour was checked separately on an emulated touch phone.
- On a private copy of the real app, on a fake internet: add, edit, reload, refused bad address, delete, reload, and blank save. 10 of 10.
- axe scan, WCAG A and AA: no failures on 7 pages, in light English and dark French.
- Screenshots were read by eye, and that caught what the checks missed: a sticky header dropping over the first row (fixed).

## Not checked

- Not every combination of page, width, mode and language was viewed by eye. Dark French was viewed on Tasks. The other dark French screens were covered by the scan only. Screenshots at 1100 px were viewed for Keywords. First-run screens were checked for errors, not looked at closely.
- Real Safari and Firefox weren't tried, and neither was a real phone (only Chrome's touch emulation). Firefox has no custom scrollbar styling, so it relies on the edge shadow and its own scrollbar.
- Reduced motion and keyboard-only paths weren't re-tested, and neither were the secondary Settings panels beyond Yandex and Google.
- The Tasks page wasn't tested against the real server, because the demo world has no tasks.

## Things to know

- A running server keeps its old code. Port 8210 (and `scripts/run_local.py` if it's running) needs a restart before Edit can save a backlink. The screens update on reload, but the new route doesn't exist until then, so Save would fail with an error.
- `design/serve.py` can reset connections when a fresh browser loads every script at once, leaving a blank or half-loaded page. A longer queue (`request_queue_size`) stopped it in testing. That file wasn't changed.
- Don't run pytest on the default test database while another `app_server.py` uses it. Each wipes the other's data. Use `DB_NAME_TEST=seo_cc_snap_test` for pytest.
- `seo_cc_snap_test` was emptied and used for this testing. `design/build_comp_sample.py` rebuilds it when needed. `comp-sample-data.js` wasn't touched.
