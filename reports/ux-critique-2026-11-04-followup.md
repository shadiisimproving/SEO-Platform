# UX critique follow-up: what changed (2026-11-04)

Each finding from `ux-critique-2026-11-04.md`, after the work in `~/.claude/plans/plan-seo-command-center-ux-improvements.md`. Screenshots are in `ux-critique-2026-11-04-followup/`. Nothing here is committed or uploaded.

**Result:** all 19 findings were addressed: 17 in full and 2 in part (F1 and F5). The full test suite passes, including 45 checks across the new task tests and the schema tests. Accessibility scans found no WCAG A or AA failures on the 7 screens, in light English and dark French.

## Findings

| # | Finding | Status | What changed | Evidence |
|---|---|---|---|---|
| F1 | Google panel can't be completed | **Partly** | The kind of key comes first, then only that path, with steps above the boxes. Robot key is suggested. The OAuth steps say where the refresh token really comes from. **The connection itself is still not built (Phase 1):** on the real app, Test and Save now say so instead of the old false "Works." | `f1-google-robot.png`, `f1-google-oauth.png` |
| F2 | Add a website dead-ends | Fixed | The sidebar moves to the new site and a checklist opens. The form shows what will be saved. | `f2-checklist.png` |
| F3 | Selection bar far below the fold | Fixed | The bar stays on screen, and no longer replays its animation on each tick. | `f3-f4-link-gaps-selected.png` |
| F4 | Link gaps table below the fold | Fixed | First domain moved from about y=860 to y=453 at 1440×900. Sources is folded, and open when there's nothing else to do. | same |
| F5 | Health and links results offer no action | **Partly** | Every check and broken link has Create task, and health checks say what to do. The status code wasn't added, because the health test doesn't store one per page. | `f5-health-task.png`, `f5-links-task-button.png` |
| F6 | Keyword task has no context | Fixed | "coût de la vie dubaï fell #5 → #11 on Google", with a link back. It only states a move when the two checks can be compared. Location isn't included, because rows don't carry one yet. | `f6-keyword-task.png` |
| F7 | Mark as seen invisible | Fixed | Always visible, in a quieter tone. | `f9-today-and-date-picker.png` |
| F8 | Site selectors disagree | Fixed | Page lists and the sidebar now move each other. The Links checker follows too, and a note says what's shown when they differ. | `f8-showing-note.png` |
| F9 | Today leads with a chart | Fixed | Needs attention and What changed come first, and the date picker moved onto the chart. | `f9-today-390.png` |
| F10 | No site in All-sites tables | Fixed | The site shows under each row on Keywords and Backlinks. | `f10-f11-keywords.png` |
| F11 | Headers without units | Fixed | "Search Console / avg position", and a tooltip on "tool changed". | same |
| F12 | Check spends a credit silently | Fixed | "64 left" beside each button, and it asks first when under 10 are left. The competitor table has headers. | |
| F13 | Authority mixes scales | Fixed | One word, "unknown", for unknown. Each value keeps its own scale label: the scales really differ, so they aren't forced into one format. | |
| F14 | Same problem, two names | Fixed | "Server error: the page failed to answer" in both places. The category stays, because that split is deliberate and tested. | |
| F15 | Refresh cost below the fold | Fixed | "Will use 1 check" is in the footer. | `f15-refresh-footer.png` |
| F16 | Credits added up | Fixed | "Running out first: 30 of 5,000, Bright Data". | |
| F17 | Engine tabs clip on phones | Fixed | They wrap. | `f17-tabs-390.png` |
| F18 | Visits chips unexplained | Fixed | Tooltips already existed on these chips, so nothing was added there. Cost per visit is now greyed on lost links, with a note saying why. | |
| F19 | First run only on Today | Fixed | The card uses the same checklist, and "Add a site" only ticks once a site exists. Keywords gained an empty state for a site with none, and on first run Settings only counts the tools that need no key as connected. | `f19-today-card.png` |

## Tasks (new)

Built like the CRM's SEO board, with no link to the CRM: `seo/tasks/service.py`, `seo/web/tasks_api.py`, `design/mockups/tasks.js`.

- Table and Kanban views, shared by the team and filtered by the sidebar's site. Search, type and owner filters, plus a status filter in the Table view. Period: all, week, month or dates.
- Open work from an earlier period shows as "Carried over from September". Undated tasks hidden by a period are counted, as in the CRM.
- Tasks can come from keywords, health checks, broken links, Today's alerts, competitor changes, page pairs and backlinks. They keep where they came from, with a link back.
- One finding has one open task: a second attempt opens the first, and a double click makes one task.
- Comments, delete with Undo, and drafts on Esc.

## Limits to know about

- **Not confirmed by Google's own pages:** that a service account's email is accepted in Search Console's Add user form. Third-party guides say it works, and Google's page only says "a valid Google Account". Check this when the Google connection is built in Phase 1. Google's help pages were checked on 2026-11-04.
- **Owner is a typed name** until accounts exist.
- **"Not used" choices** on the setup checklist are remembered in that browser only, and in Settings until the page reloads, because Settings is still mostly sample.
- **Sample screens stay sample:** Today's alerts and Keywords rows, so tasks made from them point at sample data.
- **Added beyond the plan:**
  - Test and Save on the other not-yet-connected tools are now honest too, not only Google's.
  - The French "Change" column read "Modifier" because of a clash in `comp-pairs.js`. It's fixed and reads "Évol." again.

## Test notes

Tested on the real API with a fake internet and on plain-file sample data, at 1440, 1101, 1100, 820, 641, 640 and 390 px, in English, French, light and dark. Also tested: keyboard paths, reduced motion, Esc mid-form, double-click Save, and another person creating the same task first.
