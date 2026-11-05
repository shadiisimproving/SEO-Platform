# UX critique: SEO Command Center (2026-11-04)

Independent review, driven by hand with Playwright at 1440×900, then 1100, 820 and 390 px wide. Screens with a real backend (Competitors, Link gaps, Links checker, Monthly health test) were judged on `tests/ui/app_server.py` (port 8215, fake internet). Everything else on `design/serve.py` sample data (port 8201). Screenshots are in `ux-critique-2026-11-04/`. Nothing was edited.

Owner decisions (glass look, hand-pasted Google keys, Refresh-only rankings, $0, in-app alerts, admin-made accounts) are treated as fixed. "Not built in this mockup" screens and the missing login are not reported.

---

## 1. Verdict

For the owner, who already knows SEO and knows this plan, the app works: Today says what is wrong, Keywords shows which tool said what and when, the Refresh preview protects credits, and the Links checker and health test run end to end with honest progress. A non-technical teammate will struggle more than they should. **The single biggest problem is that the app is good at *telling* and weak at *letting you act*: the acknowledge button on Today is invisible until you hover, the "Add to In consideration" bar on Link gaps sits 1,400 px below the fold, a failing health check shows a URL and nothing else, a task made from a keyword drop carries no information about the drop, and adding a website leaves you exactly where you were.** Fix the "act" step and the rest of the design mostly holds. Below that sit a handful of wording and hierarchy problems that would trip a first-time user, and one onboarding wall: the Google connection panel cannot be completed by anyone who does not already know what a refresh token is.

---

## 2. What works (protect these)

- **Today's "Needs attention" list** reads correctly in under five seconds: severity icon + word, plain-English title, the source ("Monthly health test"), one clear button per row (Fix / Review / Run now). The Today badge counts only critical and warnings, as planned. (`01-today-first-arrival.png`)
- **Keywords table, two tools per row.** Showing `#7 Bright Data · 2 d` and `#12 Searlo · 3 d` on two lines with a "Tools disagree" icon is exactly the honesty an SEO wants. `>10` with "Check deeper" instead of a fake number is right. (`09-keywords.png`)
- **Refresh preview dialog.** Engines, depth, "Automatic: free first", credits left per tool, "Paid use is off" in the footer, then a progress tray that says "Finished · 2 saved". Nobody will spend money by accident. (`17-refresh-preview.png`, `18-refresh-tray.png`)
- **Keyword side panel "Results · France" table** with a Check/Recheck button per tool: the "see it with another tool" flow is two clicks and the row updates in place. (`12-keyword-panel-check.png`)
- **Links checker long-running state**: "5 read, 6 still to read · You can leave this page: the check keeps going", a Stop button, a history row that says Running, then four result cards. This is the best long-running state in the app. (`29-links-checker-running.png`, `31-links-checker-result.png`)
- **Drafts.** Esc on a half-typed backlink gives "Draft kept · Reopen"; Mark as seen gives "Marked as seen · Undo". (`21-backlink-esc-draft.png`, `43-today-mark-seen.png`)
- **Plain wording in Health and Competitors**: "Pages that answer with an error", "They're 2 places ahead", "This site doesn't allow automated visitors, so its edits can't be tracked. The app doesn't try to get past that." Keep this voice everywhere.
- **Narrow widths** hold: no sideways scroll at 390 px, tables become cards, the menu becomes a rail then a drawer. (`34-today-390.png`, `35-keywords-390.png`)
- Dark mode and French both render cleanly with no clipped labels at 1440. (`36-keywords-dark.png`, `37-today-fr.png`)

---

## 3. Findings, ranked by user impact

Severity: Critical = blocks a core task for one of the two user types; Major = a hurried user will fail or do the wrong thing; Minor = friction. Effort: S < half a day, M = a day or two, L = more.

### F1. Google connection cannot be completed by a non-technical teammate — Critical, M

- **Where:** Settings → Connections → Google: Search Console and GA4 → Manage (also reached from Today → "Fix" and from the first-run "Connect" button).
- **What happens:** The panel opens on "Connection type: OAuth keys / Robot key", then three masked fields: Client ID, Client secret, Refresh token. "How to connect · 5 steps" is collapsed at the very bottom, after the fields and after the per-site dropdowns. Step 3 says "create an OAuth client, then copy the client ID, client secret and refresh token" — Google Cloud Console does not give you a refresh token to copy; it needs a separate consent flow. Step 4 then describes a completely different method ("Robot key: service account… JSON key") as if it were step 4 of the same procedure. Test says "Works." while the status line above still says "Failing, 2 h ago".
- **Why it hurts:** This connection feeds Today, Overview, Keywords (the Search Console column), Channels, Conversions and backlink traffic. It is the one setup task a teammate will be asked to do when it "expires", and the panel assumes they already know OAuth. The pasted-by-hand decision is fine; the panel just does not teach the paste.
- **Recommendation:** Put the steps *above* the fields, as a numbered walkthrough that matches the chosen type (pick OAuth or Robot first, then show only that path). For OAuth, spell out where the refresh token actually comes from (the exact page and button) or offer the Robot key as the recommended path with "add this email as a user in Search Console and GA4" shown as a copyable string. Rename "Robot key" to "Service account key (JSON)" with a one-line explanation, or keep "Robot key" but say what it is. Make Test update the Status row.
- **Screenshots:** `03-settings-after-connect.png`, `04-google-panel-how-to.png`

### F2. "Add a website" dead-ends — Major, M

- **Where:** Site switcher → Add a website → type `newsite.example` → Add. Same from Site health → "Add a website". Reproduced on both sample data (08) and the real backend (48).
- **What happens:** The panel closes, a toast says "newsite.example: added as your own website", and nothing else changes. The site switcher still says "All sites". You stay on Settings → Connections (or on Site health). No checklist, no "now connect Google / add keywords", no way to know what the new site needs.
- **Why it hurts:** The plan promised "domain → checklist; each missing item connects in a side panel". Without it, the user who just added a site has to guess that the next steps are in three different places (Settings, Keywords, Competitors). The first-run card on Today partly does this job, but only on first run.
- **Recommendation:** After Add, switch the site switcher to the new site and open the per-site checklist panel (Google, keywords, Clarity, competitors, with "Not used" as a valid answer for each). Reuse the first-run "three steps" card as that checklist. Also validate the address as typed (no scheme → show what will be saved).
- **Screenshots:** `07-add-site-panel.png`, `08-add-site-after.png`, `48-real-add-site-after.png`

### F3. Link gaps: the action for a selection is 1,400 px below the fold — Major, S

- **Where:** Competitors → Link gaps → tick two domains.
- **What happens:** Nothing visible changes except the checkboxes. The "2 selected · Add 2 to In consideration" bar exists but is a static element at the bottom of a long table (measured at y = 2,278 on a 900 px viewport). On Keywords, the same action bar floats under the table and is visible immediately, so the user has learned to expect it.
- **Why it hurts:** This is the one decision the screen exists for ("which links to pursue"). A hurried user ticks rows, sees nothing happen, and either gives up or clicks "Add all good ones (10)" at the top, which is the opposite of choosing.
- **Recommendation:** Make the selection bar sticky to the bottom of the viewport on every table (one CSS rule). Show the count in it the moment the first row is ticked.
- **Screenshots:** `25-link-gaps-selected.png` (nothing visible after ticking), `47-link-gaps-action-bar-below-fold.png` (where the bar actually is)

### F4. Link gaps: the table itself starts below the fold — Major, S

- **Where:** Competitors → Link gaps.
- **What happens:** Order on screen: a three-line explanation banner, three KPI tiles, a "Where the links come from" card with three rows and an upload button each, a "How Common Crawl runs" disclosure, *then* the filter row and the table. The first domain appears at about y = 860.
- **Why it hurts:** The thing to scan (domains, who they link to, spam flag) is the last thing you see. The sources card is setup information, not daily work.
- **Recommendation:** Table first, under a one-line summary ("18 found · 8 flagged as spam · 10 good"). Move "Where the links come from" and the Common Crawl note into a collapsed "Sources" section or the right-hand column.
- **Screenshot:** `24-link-gaps.png`

### F5. Health test and Links checker results offer no action — Major, M

- **Where:** Site health → Monthly health test → open "Pages that answer with an error". Site health → Links checker → Broken.
- **What happens:** The expanded check shows one line: `site-one.example/old-offer`. No status code, no "what this means / what to do", no Create task. The Links checker's broken row has the status (404) and reason, but again no action. Meanwhile keyword rows and competitor changes get a Task button.
- **Why it hurts:** The plan says "Create task from anything… an audit issue". The health screens are where the fix-it work actually comes from, and they are the only screens without the button. A teammate cannot hand the finding to someone.
- **Recommendation:** Add "Create task" (and "Mark as seen" where it fits) on each check group and each broken-link row, prefilled with the check name, the URL, the status and the test date. Show the status code in the health check too (it is already known by the links checker).
- **Screenshots:** `27-health-check-open.png`, `31-links-checker-result.png`

### F6. Task created from a keyword carries no context — Major, S

- **Where:** Keywords → open "coût de la vie dubaï" (down 6) → Create task.
- **What happens:** Title is "Keyword: coût de la vie dubaï". Site, owner, due date, nothing else. No description, no "fell from #5 to #11 on Google France since 12 Sep", no link back to the keyword, no priority.
- **Why it hurts:** The person assigned the task opens it and has to redo the investigation. The plan's own example was "Competitor A changed title on /visa/", which is the standard to hit.
- **Recommendation:** Prefill the title with the fact ("coût de la vie dubaï fell #5 → #11 on Google · France") and add a read-only "Source" block linking back to the keyword panel. Same for tasks from alerts and competitor edits.
- **Screenshot:** `14-create-task-from-keyword.png`

### F7. "Mark as seen" is invisible until hover — Major, S

- **Where:** Today → Needs attention.
- **What happens:** Each row has a check-mark button, but it is rendered at `opacity: 0` and only appears on row hover (or keyboard focus). In the first-arrival screenshot there is no sign the action exists. Once found, it works well (toast with Undo, badge drops from 5 to 4).
- **Why it hurts:** Acknowledging is how the list stays short; the plan's "with acknowledge" is the mechanism that keeps Today usable after week one. A new teammate will not discover it, and on a trackpad people rarely hover before deciding.
- **Recommendation:** Show the button at reduced opacity always (not zero), or make it a small text button "Seen". Keep the hover emphasis.
- **Screenshots:** `01-today-first-arrival.png` (not visible), `43-today-mark-seen.png` (visible on the hovered row)

### F8. Two site selectors on one screen that disagree — Major, M

- **Where:** Competitors, Site health, Links checker.
- **What happens:** The sidebar says "All sites". The page has its own "Competitors of: site-one.example" or "Website: site-one.example" dropdown. Changing one does not change the other. Keywords and Backlinks, by contrast, obey the sidebar.
- **Why it hurts:** The user has to learn which selector matters on which screen. After F2 is fixed (switcher follows the new site), the duplicate dropdown will actively contradict it.
- **Recommendation:** One rule: the sidebar switcher drives every screen. On screens that cannot show "All sites" (Competitors, Site health), auto-select the first site and show an inline note "Showing site-one.example · pick a site in the menu", or make the page dropdown a mirror of the switcher.
- **Screenshots:** `22-competitors-real.png`, `26-site-health.png`

### F9. Today leads with a 30-day traffic chart, not with what changed — Major, S

- **Where:** Today at any width.
- **What happens:** The headline is "Today", the period picker says "Last 30 days", and the hero is a big visits chart. "Needs attention" is second, "What changed today" is at y ≈ 750 and mostly below the fold at 1440×900; at 820 and 390 px it is several screens down.
- **Why it hurts:** The morning check is "what changed, is it urgent". The chart answers neither. The title "Today" next to "Last 30 days" is also contradictory.
- **Recommendation:** Order: Needs attention → What changed today → Sites strip → chart (smaller) → My work / Data sources. Or keep the chart but make it a one-line sparkline tile. Decouple the Today title from the period picker, or hide the picker on Today.
- **Screenshots:** `01-today-first-arrival.png`, `33-today-820.png`

### F10. Keywords at "All sites" does not say which site a row belongs to — Major, S

- **Where:** Keywords and Backlinks with the switcher on "All sites".
- **What happens:** Rows show `/creer-societe-dubai/` and `/visa/` with no site. Two sites can own `/visa/`. Backlinks has the same gap even though "Our site" is a required field on the form.
- **Why it hurts:** The owner runs several sites; a drop on `/visa/` is a different task depending on the site.
- **Recommendation:** When "All sites" is selected, add a Site column (or show the host as a muted prefix in the Page/Target cell) and group by site in CSV export.
- **Screenshots:** `09-keywords.png`, `19-backlinks.png`

### F11. Column headers without units: "Search Console 19.8" next to "Scraped results #19" — Minor, S

- **Where:** Keywords table.
- **What happens:** One column is an average position (19.8, 8, 10.8), the next is a scraped rank (#19). Only the panel explains "10.8 average". "Change" shows a bare "0" for no change and "— tool changed" with no tooltip.
- **Why it hurts:** A non-technical teammate reads 19.8 as "nineteen point eight what?". The SEO knows, the teammate doesn't.
- **Recommendation:** Header "Search Console · avg position" (or a sublabel "avg"), and a tooltip on "tool changed" ("The last two checks used different tools, so the change isn't comparable").
- **Screenshot:** `09-keywords.png`

### F12. A single "Check" spends a credit with no preview; the panel's competitor table has an unlabelled column — Minor, S

- **Where:** Keyword panel → Results · France → Check on HasData; then scroll to "Competitors on this page".
- **What happens:** Check runs immediately (HasData was at 64 of 100). No credit count near the button, no confirmation, unlike the Refresh dialog. Below, "Competitors on this page" lists `#1 rival-one.example 0`, `#2 rival-two.example ↑1` — the last column has no header.
- **Why it hurts:** Small, but the $0 rule depends on people knowing when a click costs something. The unlabelled column reads as noise.
- **Recommendation:** Show "64 left" next to each tool's button; confirm only when under 10 left. Head the column "Change".
- **Screenshots:** `12-keyword-panel-check.png`, `13-keyword-panel-bottom.png`

### F13. Link gaps "Authority" column mixes two scales; "unknown" and "—" both mean unknown — Minor, S

- **Where:** Competitors → Link gaps table.
- **What happens:** One row says "62 · Authority score (SEMrush)", the next "Top 3% · Common Crawl rank". Spam score shows "3", "unknown" or "—" depending on the row; Status shows "—" or "You lost this link".
- **Why it hurts:** You cannot sort or compare the column by eye. Two words for the same unknown contradict the "unknown is unknown" rule.
- **Recommendation:** Two columns (Authority, Popularity) or one column with a consistent format ("62/100 · SEMrush", "Top 3% · Common Crawl"). One token for unknown everywhere.
- **Screenshot:** `24-link-gaps.png`

### F14. Same problem, two names: "Could not verify · 500 · Server error" vs "Pages the server failed to answer · Critical" — Minor, S

- **Where:** Site health → Links checker result vs Monthly health test checks.
- **What happens:** A 500 is filed under "Could not verify" in the links checker, and under a Critical check in the health test.
- **Why it hurts:** A teammate will think they are two different problems and may dismiss the first as a glitch.
- **Recommendation:** Use the health test's wording in both places, and make "Could not verify" mean only timeouts/blocked.
- **Screenshots:** `31-links-checker-result.png`, `26-site-health.png`

### F15. Refresh dialog: the cost line is below the fold inside the dialog — Minor, S

- **Where:** Keywords → select → Refresh.
- **What happens:** "This will use 2 checks (2 keywords × 1 engine × 1 result page)" sits under the seven-tool list and is cut off at 900 px high. The footer says "Free tools first. Paid use is off." but not the number.
- **Recommendation:** Put "Will use 2 checks · Bright Data" in the footer next to Confirm; collapse the tool list in Automatic mode.
- **Screenshot:** `17-refresh-preview.png`

### F16. Settings tile "Free credits left 3,186" adds unlike units — Minor, S

- **Where:** Settings header tiles.
- **What happens:** 3,186 is Bright Data credits + SerpApi searches + HasData credits + Searlo credits. One Searlo credit is not one Bright Data credit.
- **Recommendation:** Replace with "Lowest: Bright Data 30 of 5,000" or show the tool closest to running out.
- **Screenshot:** `05-settings-sites.png`

### F17. Engine tabs clip at 390 px — Minor, S

- **Where:** Keywords at phone width.
- **What happens:** The engine tab row shows "Google · DuckDuckGo · Bing · Yan…" and clips; MASTER says tabs wrap and never scroll sideways.
- **Recommendation:** Let the tablist wrap, or show logos only under 480 px with the name in a tooltip.
- **Screenshot:** `35-keywords-390.png`

### F18. Backlinks "Visits" chips and "Cost per visit" need a key — Minor, S

- **Where:** Backlinks table.
- **What happens:** "42 UTM", "12 domain", "5 shared · 2" with no explanation; "$27.50" cost per visit on a Lost link.
- **Why it hurts:** The plan's "what each number means" section exists, but none of it reaches the table.
- **Recommendation:** Tooltips on the chip ("UTM: counted from the tagged link", "domain: all visits from this site", "shared: this page sends visits to 2 of your links"), and grey out cost-per-visit on Lost links.
- **Screenshot:** `19-backlinks.png`

### F19. First-run state only exists on Today (sample-data finding) — Minor, M

- **Where:** Mockup → Data: First run → Connect → Settings.
- **What happens:** Today correctly shows the three-step card with "Add a site" ticked (even though the switcher says "All sites" and no site exists), but clicking Connect lands on a Settings page showing 9 connected tools, two failing, three sites. "Show all 42" on filled data expands to six rows.
- **Why it hurts:** Only as evidence: the empty states for Settings, Keywords, Backlinks and Competitors have not been designed, and step 1 of the card cannot be "done" before a site exists.
- **Recommendation:** Design the empty state for each screen now (the Health and Links checker ones already exist and are good models), and make the first-run card the per-site checklist from F2.
- **Screenshots:** `02-today-first-run.png`, `03-settings-after-connect.png`, `44-today-show-all.png`

---

## 4. The five changes I would make first

1. **One sticky selection bar for every table** (F3) and **table-first on Link gaps** (F4). Two small CSS/ordering changes, and the Link gaps screen goes from unusable to fine.
2. **"Create task" with context on every finding** (F5, F6): health checks, broken links, keyword drops, alerts. This is the "what to do next" the users are here for, and the task form already exists.
3. **Finish the Add-a-website flow** (F2): switch to the new site, open its checklist, and let that same checklist replace the first-run card (F19). This is the onboarding path for every new teammate and every new client site.
4. **Rewrite the Google panel as a walkthrough** (F1): steps first, one path at a time, exact source of each value, plain names. Without it a teammate cannot repair the most important connection.
5. **Make the sidebar switcher the only site selector and show the site in All-sites tables** (F8, F10). Removes the one piece of navigation a user has to "learn".

Then F7 (visible Mark as seen) and F9 (reorder Today), both small, both about the morning check.

---

## 5. What I did not test, and what I could not reach

- **Screens not built in the mockup:** Channels, Conversions, Content, Overview, AI search, Google Ads, Tasks, Resources. Their nav items show the toast "Not built in this mockup" and the URL hash falls back to Today. Settings → Sites and Team tabs likewise.
- **Competitors → AI Overview watch, Notes, the Compare (diff) view and Add a competitor panel** (my selector for the Add button did not match and I did not retry). Find competitors "See the evidence" not expanded.
- **Backlinks CSV import** (column matching preview), Mediators tab, Found-but-never-logged tab, and the backlink detail panel.
- **Reduced motion, reduced transparency, screen reader**, and the other colour looks (Emerald, Violet, Amber, Rose, Graphite). Keyboard was spot-checked only: focus rings are visible (2 px outline), Esc closes panels and the command bar, ⌘K opens.
- **Real external services**: nothing was sent anywhere; the real-backend screens ran on the fake internet only.
- **Login, roles, team**: not built.
- Two environment notes, not findings: my first `app_server.py` run on `seo_cc_e_test` lost its database grant mid-session (another session narrowed `seo_app`'s grants to `seo_cc_b_test`, `seo_cc_snap_test` and the two standard databases), so the real-backend screens were tested on `seo_command_center_test` instead. And the mockup logs a harmless 404 for `/api/links/sites` on every load because it probes for the real API before falling back to sample data.
