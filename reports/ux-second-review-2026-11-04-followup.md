# Second UX review follow-up: what changed (5 Nov 2026)

Each finding from `ux-second-review-2026-11-04.md`, with its status. Screenshots are in `ux-second-review-2026-11-04-followup/`. Nothing here is committed or uploaded.

**Result:** all 20 findings were addressed: 15 in full and 5 in part (F6, F7, F11, F12 and F16). In F20, another session removed the Mockup bar, and this work fixed the new-pages count. Each fix was tested in the browser using the review's own steps.

## Findings

| # | Finding | Status | What changed |
|---|---|---|---|
| 1 | A second note replaces the first | Fixed | Clearing the box or typing over a note starts a new one, and the saved note moves to the list. "New note" appears after each save. The competitor picker starts blank and asks first. |
| 2 | Last Save wipes the other person's work | Fixed | Only changed fields are sent. Changes to different fields are merged. The same field shows who-changed-what with Keep mine or Use theirs. The board catches up when you return to its tab. |
| 3 | Back leaves the app, no shareable links | Fixed | Back and Forward work. The address holds the screen, tab, pair and site, for example `#competitors/pairs/12?site=shop.example`, and survives a reload. |
| 4 | Import drops rows silently | Fixed | A result panel lists rows not added with the reason, plus a download. A bad address, status or site can be fixed in the preview. |
| 5 | "Lost" imports as Live, dates unchecked | Fixed | Ignored columns are marked, and one that looks like the status is named with a warning. Readable dates are stored as year-month-day, the file says day or month first, and unreadable dates are counted and listed. They still import, as typed. |
| 6 | Filter refuses files, removes spam | **Partly** | Files with no spam column are accepted, spam is flagged and can't be picked, and it asks which column holds the link if it can't tell. It only asks for that one column, not full matching like Import. Not yet tried on a real Semrush file. |
| 7 | 0 visits when nothing was measured | **Partly** | Real data shows "—" and "GA4 not connected". It will need a real rule once GA4 is connected, because today every server row is unknown. |
| 8 | "Mark as done" misleads and loses data | Fixed | It's now "Link placed". Authority and spam score carry over. Prospects have an owner and a status. The footnote is plain. |
| 9 | Compare can mislead | Fixed | The language warning is at the top, and Mine is on the left in Headings too. It isn't yet in the pair list, and no same-language page is suggested. |
| 10 | No Task buttons where you decide | Fixed | Added to Compare, the competitor timeline and AI Overview changes. |
| 11 | Checklist wrong, then disappears | **Partly** | Add keywords opens the upload. Progress re-reads when Today opens. The card survives a reload and shows at All sites. Not used is stored on the server. The first health test is a step. Clarity and Google "Not used" on Settings stay session-only until Settings is real. |
| 12 | Google panel too hard | **Partly** | "Not built yet" is at the top, with a note that an admin usually does this once. No made-up GA4 numbers, and only the site you came from. Property names need the real connection. |
| 13 | Page vs page hides the worst gap | Fixed | Opens on They're ahead, furthest behind first. |
| 14 | Go to the finding is weak | Fixed | Opens the exact pair or backlink. Alerts go to their source screen. A toast offers Back to the task. |
| 15 | New tasks need tidying | Fixed | Site and priority come from the finding, titles are jobs, the late date always shows, finished work isn't a warning, and there's an Unassigned filter. |
| 16 | Mediators and Found are dead ends | **Partly** | A mediator filters the list and has cost per visit, which stays "—" until visits are measured. Found has Ignore (kept and reversible) and Task. |
| 17 | Moving between sites loses context | Fixed | Alerts follow the site, Tasks due this week opens on This week, and with no site chosen a screen uses the last one, or the oldest, not a new empty one. |
| 18 | Keyboard loses its place | Fixed | Focus returns to the card after saving, and arrow keys move between tabs. |
| 19 | Times disagree | Fixed | Stamps use local time. Plain calendar days stay that day. |
| 20 | Developer bar, contradictory number | Fixed | Another session removed the bar. New pages now counts what the timeline counts, so a first read isn't "9 new". |

## Limits to know about

- **A board updates every 30 seconds** while it's open, and at once when you return to its tab. It isn't instant.
- **Only health and link tasks can tell when their finding has gone.** A newer full check shows "Looks fixed" on the task, or "Found again" on a finished one, and a person still decides. Keyword, competitor and backlink tasks don't do this yet, because the app has no real keyword data and those findings have no later check to compare with.
- **Owners are typed names** until accounts exist.
- **Prospects added by Filter a backlink CSV** keep their owner and status only in the browser, if they have no server copy.

## New in the database

Migration `e9f3b5d7a2c4` adds `sites.setup_not_used`, `prospects.owner` and `stage`, and `backlinks.authority`, `authority_label` and `spam_score`. `scripts/run_local.py` applies it by itself. A found link can now also have the status `ignored`.

## How it was tested

Every finding was reproduced with the review's steps on the real API with a fake internet. Then 16 screens and tabs were swept in light English and dark French with an accessibility scan (WCAG A and AA), checks for broken images, sideways scroll and console errors. Six screens were checked at 390 px, plain-file sample mode was run through, and the full test suite of 1,544 tests passed on a test database nothing else was using.

- **Not tested:** a real Semrush or Ubersuggest file, real Google data, a screen reader, long lists, and touch dragging.
