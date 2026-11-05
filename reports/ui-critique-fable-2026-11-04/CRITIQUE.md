# SEO Command Center: UI critique (Fable, 4 Nov 2026)

Screens were driven by script against the mockup (`http://127.0.0.1:8201/`, sample data) at 1440, 1100, 820 and 390 px, in light and dark, English and French, filled and first-run data. All screenshots are in this folder. The app was being edited while this critique ran (most files changed 18:12-18:39). Every **Blocker** and **Major** below was re-shot on the current build after those edits (files named `v-*.png`). Minor findings may rest on an earlier build and say so.

"Measured" means a number came from a tool (axe, or a DOM measurement). Everything else is design judgement.

## Corrections after review (read first)

These were checked after Fable finished, on the real app at port 8210 (same screens and sample content; the mockup at 8201 had stopped responding). They override the text below, which is left as Fable wrote it.

- **"Every Major was re-shot" is not accurate.** Page vs page, Link gaps and the unbuilt-menu toasts had no fresh screenshot. All three are now re-shot, as `check-*.png`.
- **Page vs page, URLs breaking mid-word: not reproduced at 1100 px.** URLs are whole in `check-pairs-1100.png`. 820 px was not re-checked. The 6/10 score partly rests on this finding, so it may be low.
- **Link gaps, mixed authority scales: confirmed** (`check-gaps-1440.png`).
- **New, Link gaps at 1440 px (not in Fable's list):** the "Example link" column breaks URLs mid-word ("kitchen.example/g / ear", "cafe.example/thre / ad"). When scrolled, row text shows through the sticky table header behind "Domain" and "Authority". Same screenshot.
- **Unbuilt menu items: confirmed.** Three clicks stacked three toasts (`check-menu-toasts.png`). It's 7 of 14 menu entries, not 7 of 15.
- **Tables overflow with "no scroll cue": wrong in part.** A shadow on the table's edge does show there's more, driven by `updateCues()` in `mockup.js`, and is visible in `v-backlinks-820.png` and `v-keywords-820-scrolled.png`. The rest stands: no visible scrollbar, keyword names scroll away, and "Medi" is cut off. The fix is the sticky first column and a stronger cue, not adding a cue from nothing.
- **Backlink panel, no edit or delete: confirmed, with one addition.** The server already has `DELETE /backlinks/<id>` (`seo/web/competitors_api.py:238`), and no screen appears to call it. Delete only needs a button and a confirm. There's no edit route, so editing also needs server work.
- **Yandex blank save: confirmed.** With nothing typed, the code reaches the "Connection saved" toast (`mockup.js:2799-2800`).

---

## 1. Overall verdict

**Score: 7 / 10.**

This is a well-built internal tool with an unusually honest voice: it tells you where numbers come from, what it could not read, and why. The glass look is executed with discipline: one hue, status colours only for status, and **axe found zero contrast or naming violations on all six main pages in light and dark (measured)**. Hierarchy on Today, Site health and Backlinks is clear; forms validate beside the field; drafts survive Escape; destructive actions confirm.

What holds it back is not the look, it's three habits: (1) the menu presents seven unbuilt pages exactly like built ones and answers with a developer's toast; (2) wide tables at laptop and tablet widths get clipped inside their own box with nothing to tell you; (3) a few forms report success when nothing happened. Fix those and the system is an 8.

---

## 2. Top 10 fixes, ranked by impact

1. **Make unbuilt menu items look unbuilt.** Seven of fifteen menu entries (Channels, Conversions, Content, Overview, AI search, Google Ads, Resources) look identical to working ones and only reveal themselves after a click, with a toast that says "Not built in this mockup". Grey them, add a small "Soon" tag, and make the click do nothing (or open a one-line note). Never stack three toasts. `shell-1440-toasts-not-built.png`.
2. **Yandex "Connect" with nothing typed shows "Connection saved".** The row stays "Not connected". A success toast for a no-op teaches people to distrust every toast. Validate the key beside the field, as the Backlinks form does. `v-settings-1440-yandex-save-blank.png`.
3. **Give wide tables a sticky first column and a visible scroll cue.** At 820 and 1100 px the Keywords and Backlinks tables overflow inside their card (measured: 900/796 and 845/796 px) and the last column is cut mid-word ("Medi"), with no scrollbar or shadow. When you scroll, the keyword names scroll away. `v-backlinks-820.png`, `v-keywords-820-scrolled.png`.
4. **A backlink can't be edited or deleted from its panel.** The panel offers "Check now" and "Create task" only. Marking a link Lost, changing its price or renewal date, or removing a mistake has no path in the UI. `v-backlinks-1440-link-panel.png`.
5. **Shrink the phone header.** At 390 px the sticky title block plus the main button takes 160 px of an 844 px screen before any content, on every page (Tasks, Keywords, Backlinks). Keep the title to one line and put the main action in the content, or make it a small icon button beside the title. `v-tasks-390.png`, `m390-keywords-rows.png`.
6. **AI Overview watch rows look clickable but do nothing.** Rows take a hover shade like every other table in the app; clicking one changes nothing. Either open the keyword panel (same as Keywords) or remove the hover shade. `v-ai-1440-row-click-keyword-cell.png`.
7. **Link gaps: separate the two authority scales.** One "Authority" column mixes "62 · Authority score (SEMrush)" with "Top 3% · Common Crawl rank", each explained in two lines of grey text per row. Put the source in the header or a chip and show one number per row. `comp-gaps-1440-light-en.png`.
8. **Refresh dialog: the tool list is cut off under the footer.** The last tool ("Browser on this Mac") is half hidden behind the Cancel/Confirm bar with no scrollbar; in "Choose tools" mode you can't see you have a seventh option. Give the list a visible scrollbar and a bottom fade, or let the dialog grow. `v-keywords-1440-refresh-dialog.png`.
9. **Drop the "Showing site-one.example. Pick another site here." helper.** It appears under a select on Competitors and Site health and repeats what the select already says. The select's label ("Competitors of", "Website") is enough.
10. **Translate type and category chips.** In French, task chips still read "Technical", "Content", "Links" and the Kanban columns use "Kanban" while the toggle says "Tableau". Sample data titles are user content and can stay English; chips are app vocabulary. `v-tasks-1440-fr.png`.

---

## 3. Problems shared across pages (listed once)

- **Unbuilt items are undifferentiated.** Menu entries, the Settings "Sites" and "Team" tabs, and several buttons all look live and then toast "Not built in this mockup". MASTER.md now says: say what's not built. A consistent "Soon" treatment (muted text, small tag, no hover lift) would fix all of them at once. `shell-1440-toasts-not-built.png`, `settings-1440-light-en-full.png`.
- **Toast wording leaks the developer's world.** "Not built in this mockup" should read "Not built yet" (the owner will see this in the real app too).
- **Tables overflow silently between 700 and 1240 px.** The menu collapses to icons at 1100 (good), but at 820 the drawer frees no room and tables are clipped inside their own rounded box with no scrollbar, shadow or sticky first column. Affects Keywords, Backlinks, Page vs page.
- **Phone header height.** See fix 5. The 390 drawer, site switcher, period popover and command bar themselves work well.
- **Icon-only row actions.** Trash (competitors, notes, link-checker history), circle-slash (link gaps) and pencil (page pairs) rely on tooltips. axe passes because `aria-label` is present (measured), but a hurried user has to hover to learn what a circle-slash does. A text label on hover-less devices (390 cards) would help: at 390 the circle-slash sits alone at the bottom-right of each Link gaps card. `m390-comp-gaps-mid.png`.
- **Two different "busy" positions.** Toasts sit bottom-left (per MASTER). The keyword refresh tray sits bottom-right and covers the AI column of the table while it runs. Pick one corner, or make the tray a slim bar at the top of the table. `keywords-1440-tray-running.png`.
- **Helper sentences that restate the control.** "Showing X. Pick another site here." (Competitors, Site health). "It reads your whole website, however many pages it has…" appears twice on Site health (monthly test and links checker).
- **Developer notes shown to the owner.** "On this Mac nothing runs by itself. On hosting, cron starts it." on Site health. Reword for the reader: "Runs only on the hosted version; here, press Run now."
- **Zero-count filter chips.** Competitor profile timeline shows "Page edits 0 · New pages 0 · Removed 0". Hide zero chips or grey them. `comp-list-820-profile.png`.
- **Glass execution (what works, keep it).** Legibility is good in both themes; muted text stays readable over the sky; cards have a clear rim; status chips always carry icon + word. Dark mode is as legible as light (`today-1440-dark-en.png`, `v-tasks-1440-dark.png`). Do not add more blur layers inside panels; the current single layer is the reason it stays readable.

---

## 4. Page by page

### Shared shell (sidebar, site switcher, command bar, toasts, panels, dialogs): 7/10
*Verdict: a quiet, consistent frame; let down only by how it presents what isn't built.*

**What works.** Sidebar sections (Traffic / Search / Ads / Work / Health) are sensible and the red count badges on Today and Site health are the right two places for them. The site switcher popover is simple and offers "Add a website" at the bottom (`shell-1440-site-switcher.png`). Collapsed rail at 1100 px with tooltips works (`shell-1440-rail-collapsed-hover.png`). Panels close on Escape and keep drafts; the "Draft kept · Reopen" toast is a nice touch (`comp-find-1440-light-en.png`). Period and compare popovers are plain and quick. The 390 drawer is clean (`shell-390-drawer.png`).

**Problems.**
- **Major.** Unbuilt menu items indistinguishable from built ones; three stacked "Not built in this mockup" toasts after three clicks. *Where:* sidebar, all pages. *Why:* a new team member will click Channels, Conversions and Content in a row and conclude the app is broken. *Fix:* muted label + "Soon" tag, no hover lift, single non-stacking toast or none. `shell-1440-toasts-not-built.png` (re-checked on the current build: Tasks is now built, the other seven still toast).
- **Major.** Phone header too tall (see fix 5). `v-tasks-390.png`.
- **Minor.** After clicking an unbuilt item the sidebar keeps a pressed/hover shade on that item (Content stays shaded in `shell-1440-toasts-not-built.png`), which reads as "current page". Clear the state when the navigation is refused.
- **Minor.** In the collapsed rail the red "5" badge overlaps the Today icon (`shell-1440-rail-collapsed-hover.png`). Nudge the badge up-right by 4 px.
- **Minor.** Command bar with "visa" returns one keyword only; no page or action results, so it reads as a keyword search rather than "search or jump to". Add pages and actions to the results, or rename the placeholder. `shell-1440-command-bar-typed.png`.
- **Minor.** The keyboard focus ring was captured (`shell-1440-focus-ring-tab6.png`) but not reviewed in detail; see coverage.

### Today: 8/10
*Verdict: the best page; it answers "what matters and what do I do" in one screen.*

**What works.** Hero number with a "+7% better" chip and a legend that explains the dotted line; "Table view" toggle gives real numbers. "Needs attention" rows pair a plain sentence with one button (Review / Fix / Run now), and "Fix" on the Google row opens the Google connection panel directly (`v-today-1440-fix-click.png`). "What changed today" with Diff / Task per row. Right column (Sites, My work, Data sources) is scannable. First-run state is a three-step setup, with step 1 ticked (`today-1440-first-run.png`). Dark mode and 390 both hold the hierarchy (`today-1440-dark-en.png`, `today-390-light-en.png`).

**Problems.**
- **Minor (seen on an earlier build).** "Needs attention" header says "2 critical · 3 warnings · 37 info" and the link says "Show all 42", but expanding shows 6 rows then "Show less". Either the count or the list is wrong; with sample data it's probably the count. `today-1440-show-all.png`.
- **Minor.** "37 info" is the loudest number in the header and the least useful. Show critical and warnings, and fold info into the "Show all" link ("and 37 info").
- **Minor.** Table view lists 8 days for "Last 30 days" with no "show more" or scroll hint. `today-1440-table-view.png`.
- **Minor.** On 390 the hero card, Sites card and Needs attention card all come before anything actionable; consider putting Needs attention first on phones.

### Keywords: 7/10
*Verdict: a dense, honest ranking table with a strong detail panel; it breaks down below 1240 px.*

**What works.** Columns are the right ones; "Scraped results" shows the tool and age per result and ">10" never becomes a number (`v-keywords-1440-recheck.png`). "Check deeper" sits exactly where you'd want it. The keyword panel is excellent: a per-tool results table with Check/Recheck buttons and credits left, "Other locations" that says "Not compared with France", a position chart with "1 at the top; each dot is one real check", and competitors on the page (`keywords-1440-panel.png`). The refresh dialog explains cost before spending ("Will use 12 checks · Free tools first. Paid use is off"), and "Choose tools" exposes credits per tool (`keywords-1440-refresh-preview-pick.png`). The tray shows progress and a Stop button, and rows flash as they update. The DuckDuckGo note "has no tool for site owners, so its rankings only come from Refresh" is the kind of copy this app does well.

**Problems.**
- **Major.** At 820 px the table (900 px) overflows its 796 px box (measured) with no scrollbar; scrolling right hides the checkbox and keyword columns, so you see positions for rows you can no longer name. *Fix:* sticky checkbox + keyword columns, visible horizontal scrollbar, and drop Trend/AI columns under 1000 px by default (the Columns popover already exists). `v-keywords-820-scrolled.png`.
- **Major.** Refresh dialog tool list is clipped under the footer with no scroll cue (fix 8). `v-keywords-1440-refresh-dialog.png`.
- **Minor.** Tray bottom-right covers the AI column while refreshing (`keywords-1440-tray-running.png`).
- **Minor.** The refresh plan will take 12 of Bright Data's remaining 30 free checks without saying so. Add "leaves 18 this month" to the summary line when a tool is below 20%.
- **Minor.** At 390 the card view shows a "Trend" row with a sparkline floating alone on the right and large empty rows for "Change —". Collapse empty rows in card mode. `m390-keywords-rows.png`.
- **Minor.** The sticky header on phone contains the Refresh button and both period selects (160 px). See fix 5.
- **Not fully reviewed:** By bucket and Queries views, the selection bar, and the French panel were captured (`keywords-1440-view-bucket.png`, `keywords-1440-view-queries.png`, `keywords-1440-selection-3.png`, `keywords-1440-fr-panel.png`) but not studied closely enough to give findings; see coverage.

### Competitors: My competitors: 7/10
*Verdict: a clear list and a rich profile; a few repeated sentences and dead chips.*

**What works.** The list is one glance: shared keywords, ahead/behind counts, edits, watching status with a plain reason for "Blocked" (`comp-list-1440-light-en.png`). The profile page's "How you compare" tiles with "You're ahead" status chips, a timeline, a shared-keyword table and "Their pages against mine" with Compare buttons is the right structure (`comp-list-820-profile.png`). The add panel says exactly how the crawler behaves (`comp-list-390-add-panel.png`); the remove action has a confirm dialog.

**Problems.**
- **Minor.** "Their pages can't be read." is repeated under three tiles on a blocked competitor's profile. Say it once in the warning at the top and leave the tiles with "—".
- **Minor.** Timeline chips with zero counts ("Page edits 0 · New pages 0 · Removed 0").
- **Minor.** The "Competitors of" select plus "Showing site-one.example. Pick another site here." (fix 9).
- **Minor.** "From a suggestion" appears under all three rows; it's only informative when it differs. Show it only for manually added ones, or move it to the profile.

### Competitors: Find competitors: 8/10
*Verdict: the clearest "suggestions" screen in the app.*

**What works.** The banner "Suggestions only. Nothing is added until you accept. Counted from search results, no AI." sets expectations in one line. Each suggestion has a progress bar ("Ranks for 7 of 10 keywords"), four facts, Accept / Dismiss, and "See the evidence" (`comp-find-1440-light-en.png`). "Big sites and public bodies" and "Dismissed" are collapsed out of the way. At 390 it stacks cleanly (`m390-comp-find-top.png`).

**Problems.**
- **Minor.** "Last checked 21 min ago · SerpApi · 10 of 10 keywords" sits in a card with two buttons; the "Add keywords" button label doesn't say it uploads a list. "Upload keyword list" is closer to what happens.
- **Minor.** The upload panel's empty-submit and after-save states were captured (`comp-find-1440-upload-empty-submit.png`, `comp-find-1440-upload-after-save.png`) but not reviewed; see coverage.

### Competitors: Page vs page: 6/10
*Verdict: valuable data, but the table is too wide for its own good and the detail page front-loads a verdict it can't support for blocked sites.*

**What works.** Grouping by "My page" with each rival page beneath is the right reading order. "Who's ahead" uses arrow + words in status colours, never colour alone. The pair detail says "Your choice" and "Later rankings won't replace it" (`v-pairs-1440-after-default-save.png`). The pair editor is three selects and a note (`v-pairs-1440-add-panel.png`).

**Problems.**
- **Major.** At 1100 and 820 px, URLs in "Their page" break mid-word ("cafe-monde.example/abonnemen / t", "rival-one.example/subscriptio / n"). MASTER says a long URL wraps, but it should wrap at "/" or "-" (use `overflow-wrap: anywhere` only as a fallback and `word-break` at slashes). Seen in `comp-pairs-1100.png` and `w820-comp-pairs.png`; `comp-pairs.js` changed after these were taken, so verify, but the CSS rule is the same one that governs the keyword table.
- **Minor.** "Add a pair" defaults to the blocked competitor (cafe-monde), whose pages can't be compared; the result is a pair whose "Side by side" section says it can't be read. Default to the first readable competitor, or show the "Not allowed" note inside the panel before saving.
- **Minor.** The detail's big red "They're 2 places ahead" headline sits above "Theirs: Not allowed"; on a blocked site the headline should be smaller or say "on rankings only".
- **Minor.** Chips "All 15 · They're ahead 7 · You're ahead 7 · Even 1" plus a Competitor select plus a sentence of help plus a banner: four rows of controls before the table. Fold the sentence into a tooltip on the title.

### Competitors: Link gaps: 6/10
*Verdict: the densest page in the app; the data is good, the table needs a diet.*

**What works.** The banner states the rules in two lines (spam flagged first, nothing removed, no paid tool, no AI). Three tiles with the main action ("Add all good ones (10)") on the relevant tile. Spam rows are shaded, labelled, and each gives a reason ("Its home page is mostly links to other sites") with a "Not spam" override (`comp-gaps-1440-light-en.png`). "unknown" is written as unknown. The 390 card view keeps "Links to" chips readable (`m390-comp-gaps-mid.png`).

**Problems.**
- **Major.** The Authority column mixes two scales with a two-line explanation in every row (fix 7). It makes 18 rows take 2,000 px. *Fix:* one chip per source in the header or beside the number ("62 SEMrush", "Top 3% CC"), and move the explanation to the "How Common Crawl runs" disclosure.
- **Minor.** "Status" is "—" for 17 of 18 rows; hide the column until something has a status, or merge it with the spam reason.
- **Minor.** The circle-slash icon button at the end of each row has no text; on 390 cards it floats alone. Label it ("Hide") on cards.
- **Minor.** "Where the links come from" card has an "Upload links for this competitor" button per row; fine, but the three identical buttons read as one. Consider a single "Upload a file" with a competitor select (the dialog already has one, `comp-gaps-1440-upload-dialog.png`).

### Competitors: AI Overview watch: 7/10
*Verdict: tidy tiles and chips; the table invites a click it doesn't honour.*

**What works.** Four tiles answer the four questions (how many have an Overview, where you're cited, not captured, which rival wins). The "Not captured means the tool used can't see AI Overviews. It doesn't mean there isn't one." note is exactly MASTER's "unknown is unknown". Filter chips mirror the tiles (`comp-ai-1440-light-en.png`).

**Problems.**
- **Major.** Rows take a hover shade but clicking does nothing (`v-ai-1440-row-click-keyword-cell.png`, current build). Open the keyword panel on click, or remove the hover shade so nothing promises an action.
- **Minor.** "You cited: No" in plain grey for not cited, but "Yes" as a green status chip; the asymmetry is fine, but "No" should carry the same muted icon treatment as "— No" in the AI Overview column, for consistency within the same row.
- **Minor.** At 390 each card repeats "Tool and age: SerpApi · 38 min ago" (`m390-comp-ai-mid.png`); when all rows share a tool, show it once above the list.

### Competitors: Notes: 8/10
*Verdict: simple and right-sized.*

**What works.** "Write a note" with scope chips (All competitors / One competitor / A page), "Saves by itself", and an "All notes" list with search and a per-note "Last changed" line (`comp-notes-1440-light-en.png`). The scope icon on each note tells you where it belongs. Works at 390 (`m390-comp-notes-top.png`).

**Problems.**
- **Minor.** Delete is an icon-only trash with no visible confirm in the screenshots I reviewed; MASTER requires a confirm dialog or Undo in the toast. `comp-notes-1440-after-delete.png` was captured but not reviewed, so treat this as "verify".
- **Minor.** The composer is a 2-line box; a pasted paragraph needs the resize handle. Auto-grow to ~8 lines.

### Backlinks: 7/10
*Verdict: strong list and import; the detail panel is read-only when it shouldn't be.*

**What works.** Tiles with the "lost this week" chip in a status colour with icon and word. Tabs (All / Mediators / Found but never logged) are the right slices. The table's Visits column explains attribution with chips (UTM / domain / shared·2), which is rare and good (`v-backlinks-1440-light-en-full.png`). The add panel is progressive: one required field, the rest in labelled "optional" disclosures, and a blank submit shows "Enter the page that links to you" beside the field (`v-backlinks-1440-add-empty-submit.png`). The CSV import maps columns, shows "2 ready · 2 with a problem" and explains each bad row in plain words ("Unknown status: weird status. Use Live, Lost or Planned.") (`v-backlinks-1440-bulk-file-loaded.png`). The link panel's "Before and after … Timing only: this does not prove the link caused the change." is honest.

**Problems.**
- **Major.** No edit or delete on the link panel (fix 4). `v-backlinks-1440-link-panel.png`.
- **Major.** At 820 px the table overflows (845/796 measured) and the Mediator column is cut to "Medi" with no scroll cue. `v-backlinks-820.png`.
- **Minor.** The import preview table runs off the panel's right edge: Price is the last visible column and "Date placed" (which the sample contained, including the impossible 31/02/2026) is not visible, so a bad date goes unnoticed. Let the preview scroll with a visible bar, and flag bad dates in "Row check".
- **Minor.** "In consideration 0" is a whole section whose body explains it isn't built. Hide the tab until it is, or mark it "Soon".
- **Minor.** Cost per visit "—" for links with a price but zero visits is correct ("unknown is unknown"), but "$27.50" for a lost link with 1 visit looks like an alarm; consider greying it.

### Site health (monthly test, opened check, Links checker): 8/10
*Verdict: the clearest "what's wrong and what to do" page; a couple of sentences are for the developer, not the owner.*

**What works.** Alert banner with "What got worse" as a two-column list of "0 → 1" counts and a single "Mark as seen" (`v-health-1440-light-en-full.png`). Score card with "Better is higher" and "−27 worse since the last test". Checks table with severity chips (icon + word), "Pages affected", "Since last test"; opening a check reveals the page, a plain instruction ("Restore these pages, or redirect them…") and "Create task" (`v-health-1440-check-open.png`). "6 checks with nothing found" is collapsed. Site two shows "First test, so nothing to compare with yet." instead of a fake trend. Links checker explains scope, has a progress card ("3 read, 11 still to read … You can leave this page"), a Stop button, and a History table that updates live (`health-links-1440-running.png`).

**Problems.**
- **Minor.** "On this Mac nothing runs by itself. On hosting, cron starts it." is a developer note in owner-facing UI. Reword.
- **Minor.** "It reads your whole website, however many pages it has. About 3 seconds per page…" appears on both tabs; keep it once, in the Run card.
- **Minor.** "Showing site-two.example. Pick another site here." (fix 9).
- **Minor.** The History "Open" buttons are small and far from the row's date on a 1440 screen; make the row clickable like the other tables.
- **Minor.** At 390 each check becomes a card with the "+1 worse" chip on its own line (`v-health-390-mid.png`); put severity and change on one line to halve the height.

### Settings: 7/10
*Verdict: long but legible; one form says "saved" when it didn't.*

**What works.** Three tiles (Connected 9 of 18, Running out first, Needs a fix 2) are the right summary. Rows have a consistent anatomy: logo, name, one-line purpose, price chip, limit, sites, status chip, one button (`v-settings-1440-light-en-full.png`). "No price listed" is honest. The refresh-tool order uses arrows with first/last disabled. The Google panel shows status, limits and a red note that says what to do ("Paste a new key, or check it still has access, then press Test"), then the key-type choice and numbered setup steps with links (`v-settings-1440-google-panel.png`). Disconnect is red text, away from Save.

**Problems.**
- **Major.** Yandex: Save with an empty key shows "Connection saved" and nothing changes (fix 2). `v-settings-1440-yandex-save-blank.png`.
- **Minor.** "Sites" and "Team" tabs look live and toast "Not built in this mockup".
- **Minor.** Google: pressing Save with the key fields blank showed no visible error in the viewport (`v-settings-1440-google-save-blank.png`); the error may be below the fold. If so, scroll the first error into view.
- **Minor.** The Google panel is ~2,000 px tall: status table, error, key type, 6 numbered steps, per-site property selects. Collapse the setup steps behind "How to get these keys" once a key exists.
- **Minor.** At 390 each row stacks five lines (`v-settings-390-rows.png`); drop the sites line on phones or show it as a chip beside the status.

### Tasks (new since the brief): 7/10
*Verdict: a credible board on day one; a few defaults and labels need settling.*

**What works.** Three-column board with counts, cards that show priority, type, site, due date and owner, and a "Late · 25 Sept" chip in a status colour with icon and word (`v-tasks-1440-light-en.png`). The task panel shows "Where this came from" with the finding's page and a "Go to the finding" link, which closes the loop from Site health (`v-tasks-1440-row-open.png`). "New task" validates the title beside the field ("A task needs a title.") (`v-tasks-1440-empty-submit.png`). First-run empty state tells you the two ways to create one (`v-tasks-1440-first-run.png`). Dark and 390 hold up.

**Problems.**
- **Minor.** "Type" is free text in the form but a select ("All types") in the filter; "Owner" likewise. Free text will produce "Technical", "technical" and "Tech". Make both selects with an "Add…" option.
- **Minor.** New task defaults Site to "All sites"; a task is almost always for one site. Default to the site currently chosen in the switcher.
- **Minor.** A status select on every card is six dropdowns of visual noise; a status change can live in the panel, with the board columns themselves implying status (drag, or a "Move to" in the card's menu).
- **Minor.** French: type chips and "Kanban" untranslated (fix 10). `v-tasks-1440-fr.png`.
- **Minor.** At 390 the filters (period chips, view toggle, search, type, owner) fill the first screen before the first card (`v-tasks-390.png`). Collapse filters behind one "Filter" button on phones.
- **Minor.** "6 tasks" sits small and far right on the filter row; put it beside the title.

---

## 5. Coverage

**Viewed and judged (current build, `v-*.png`):** Tasks (1440 light EN filled, New task empty submit, task panel from a finding, dark, FR, first-run, 390); Keywords at 1440/1100/820 (table, 820 scrolled, DuckDuckGo panel, refresh dialog); Page vs page add-pair panel and the resulting detail; AI Overview watch row click; Today "Fix" click; Settings (full page, Google panel, Yandex blank save); Backlinks (full, link panel, add blank submit, CSV import with a bad file, 820); Site health (full, opened check, Links checker idle; 390 mid-page); Settings 390 rows.

**Viewed and judged (earlier build, before the 18:12-18:39 edits):** Today 1440 light/dark/FR/first-run, Show all, Review panel, table view, site switcher, period and compare popovers, command bar, stacked toasts, collapsed rail, 390 page, 390 drawer; Keywords panel, refresh "Choose tools", tray running, 390 card rows; Competitors list, Find, Link gaps 1440 full, Notes, competitor profile at 820, Page vs page at 1100 and 820, 390 crops of list/profile/find/pairs/gaps/AI/notes, 390 add-competitor panel; Links checker running.

**Measured:** axe `color-contrast`, `button-name`, `label`, `link-name`, `target-size` and five structural rules on Today, Keywords, Competitors, Backlinks, Site health, Settings in light and dark: zero violations (`fable-critique/axe-results.json` in the scratchpad). Table overflow widths at 820 (Keywords 900/796, Backlinks 845/796). No horizontal page scroll at 390 on any page (scrollWidth = clientWidth).

**Captured but not reviewed closely enough to report on:** Keywords By bucket, Queries, All engines, selection bar, Columns popover, Check deeper dialog, first-run, FR; Competitors dark/FR variants, add-competitor empty/bad-URL submits, remove dialog, Find upload panel states, Notes typing/blur/delete; Backlinks dark/FR, found-but-never-logged, mediators tab, consideration section; Site health dark/FR, first-run, history row, Links checker row panel, delete dialog; Settings dark/FR, first-run, Clarity/Bright Data/DuckDuckGo/SearXNG/Browser/Common Crawl/Moz/Google Ads panels; keyboard focus ring; reduced-motion. These files are in the folder and can be read by the developer; I don't claim findings from them.

**Not reached:** Tasks Table view and Dates picker; Tasks delete confirm; Notes delete confirm; Google panel below-the-fold errors on blank Save; 1100 px on Backlinks, Site health, Settings, Tasks; 820 on Tasks and Competitors list after the edits.

**Real app (`8210`):** I captured all six pages at 1440 (`real-8210-*.png`) but did not get to compare them against the mockup before being asked to write. No claim is made about differences.

**Unbuilt menu items** (Channels, Conversions, Content, Overview, AI search, Google Ads, Resources) were not critiqued as pages. Tasks was built during this session and is critiqued above.
