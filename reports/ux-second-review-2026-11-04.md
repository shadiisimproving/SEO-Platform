# SEO Command Center: second UX review

4 Nov 2026. Reviewer: Opus 5.5, working independently without reading the earlier critiques.
Screenshots are in `ux-second-review-opus-2026-11-04/`. The app was driven by hand and judged from what was on screen, on the real API with a fake internet (port 8215) and on sample data (port 8201).

The code changed while this review ran (about 19:05 to 19:18, plus one CSS file at 19:33). I restarted the server after that and reproduced every finding below on the current screens, apart from the exceptions listed in section 5. One thing I had first noted, that a backlink couldn't be edited or deleted, is now fixed, so I dropped it.

## 1. Verdict

It's ready for a careful pilot, not yet for the whole team. Competitors, Site health, the links checker and Tasks are well made, and nothing blocks a core task outright. A hurried teammate can get through most flows without help. The exception is the Google panel, which a non-technical teammate shouldn't be asked to do alone.

**The single biggest problem is that work disappears without any warning.** A second note silently replaces the first. When two people have the same task open, the later Save wipes the earlier person's work, and the app says "Task saved". A CSV import silently drops rows and turns a "Lost" link into "Live". I would fix this before a second person starts using the app, because people stop trusting a shared tool quickly once it loses their work.

## 2. What works

- **Site health:** a check row shows the problem, the fix and a task button. "Go to the finding" opens the exact check again.
- **Links checker:** it shows the page, the broken target, the status and the reason, with a Task button on each row, and it can run in the background ([f-links-result](ux-second-review-opus-2026-11-04/f-links-result.png)).
- **Find competitors:** it's the best flow in the app. Paste keywords, watch it run, then see suggestions with evidence behind them ("Ranks for 7 of 10", and each keyword's position) ([g-find-evidence](ux-second-review-opus-2026-11-04/g-find-evidence.png)). "Check again" says what it will use before it runs.
- **Add a competitor:** the errors are specific and useful, for example "site-one.example is part of your own websites" and "already one of this website's competitors".
- **CSV column matching:** it matched 8 of my 9 oddly named columns on its own, including "Agency" to Mediator and "Referring page URL" to Source page. Row checks are clear and sit beside each row.
- **Mediator spend:** mixed currencies are shown honestly, as "AED 1,000 + 300 € + 500", not added into a false total.
- **Tasks:** drag works, one finding keeps one open task, Delete has Undo, and Esc keeps a draft with "Draft kept · Reopen". The Sara and sara owner spellings merge in the filter.
- **Keyboard:** the skip link, visible focus, a working ⌘K and panels that open with focus on the first field all held up. I created a task, commented and moved between screens without a mouse. Unbuilt menu items are correctly skipped.
- **Narrow widths:** I found no sideways page scroll at 390, 640, 860 or 1100 px, and tables turn into readable cards ([99d-compare-390](ux-second-review-opus-2026-11-04/99d-compare-390.png), [g-tasks-390](ux-second-review-opus-2026-11-04/g-tasks-390.png)).

## 3. Findings, ranked by impact

Counts: **0 Critical, 12 Major, 8 Minor.** Effort: S = hours, M = a day or two, L = several days.

### Major

#### 1. A second note silently replaces the first (Competitors → Notes)
- **Steps:** type a note and wait for "Saved". Then clear the box and type a different note, the way you would with any "write a note" box. Reload.
- **What happens:** the saved note doesn't appear in the list, which still says "All notes 3", and the box keeps its text. The second note overwrites the first, so "First thought" was gone after the reload and only "Second thought" remained. With "One competitor", the picker also defaults to the first name in the list, which was the blocked cafe-monde.example. My note about Rival One saved against the wrong competitor, and nothing warned me.
- **Why it hurts:** this is silent data loss, and "Saved" tells the user everything is fine.
- **Recommendation:** add the note to the list as soon as it saves, then empty the box. Make the competitor picker start blank and require a choice.
- **Effort:** S
- **Evidence:** [f-notes-after-first](ux-second-review-opus-2026-11-04/f-notes-after-first.png), [f-notes-after-reload](ux-second-review-opus-2026-11-04/f-notes-after-reload.png)

#### 2. Two people on one task: the last Save wipes the other's work (Tasks)
- **Steps:** Malik and Sara both open the same task. Malik sets himself as owner, writes a description and saves. Sara, still on her old copy, changes priority to High and saves.
- **What happens:** Sara sees "Task saved". Malik's owner and description are gone, with no warning to either of them. Separately, a board left open doesn't update: 40 seconds after another person moved a card, it still showed the old counts.
- **Why it hurts:** a team board has to survive two people. Combined with free-text owners and no list of people, nobody can be sure who holds what.
- **Recommendation:** check the task's last-changed time on Save, and if it changed, show "Malik changed this at 14:02" with a choice to reload or keep yours. Save only the fields that changed. Refresh the board when the tab regains focus.
- **Effort:** M
- **Evidence:** [before Malik saves](ux-second-review-opus-2026-11-04/f-team-1-malik-before-save.png), [Sara's old copy](ux-second-review-opus-2026-11-04/f-team-2-sara-stale-form.png), [Sara's Save](ux-second-review-opus-2026-11-04/f-team-3-sara-saved.png), [Malik's work gone](ux-second-review-opus-2026-11-04/f-team-4-malik-work-gone.png)

#### 3. The browser's Back button leaves the app, and no screen has a link you can share (everywhere)
- **Steps:** open the app, click Competitors, click Backlinks, press Back.
- **What happens:** I left the app entirely (`about:blank` in my test). The URL only ever holds the screen name, such as `#competitors`, and never the tab, site or pair. Reloading a Compare or Notes view returned me to the first tab. A site chosen in the picker was also lost: it went back to All sites.
- **Why it hurts:** "Go to the finding" and "Connect" take you somewhere else, and Back is what people press to return. A teammate also can't be sent "look at this comparison" as a link.
- **Recommendation:** add a history entry for each screen, and put the site, tab and pair in the URL.
- **Effort:** M. The cause, `history.replaceState` at `mockup.js:1426`, is confirmed in code.
- **Evidence:** the result is a blank page, so the proof is the test itself. [f-compare-top](ux-second-review-opus-2026-11-04/f-compare-top.png) is an example of a view with no link of its own.

#### 4. CSV import drops problem rows and then forgets them (Backlinks → Import CSV)
- **Steps:** import my 7-row file. The preview says "3 ready, 1 to skip, 3 with a problem". Press Import 3 backlinks.
- **What happens:** the panel closes with "3 backlinks added". The 3 problem rows aren't mentioned again, and the only other message is about the 1 skipped row. There's no list to fix and no file to download. A wrong row can't be corrected in the preview either: you must fix the sheet and upload it all again.
- **Why it hurts:** a hurried person sees success and believes the whole sheet went in. Their sheet and the app then quietly disagree.
- **Recommendation:** after import, keep a result view: "3 added, 3 not added", with each row and its reason, and a "Download rows not added" button. Let a row be fixed in place.
- **Effort:** M
- **Evidence:** [f-import-preview](ux-second-review-opus-2026-11-04/f-import-preview.png), [f-import-result](ux-second-review-opus-2026-11-04/f-import-result.png)

#### 5. A "Lost" link imports as "Live", and dates are never checked (Backlinks → Import CSV)
- **Steps:** import a sheet with a "Link state" column, and put text like "tomorrow" in a date column.
- **What happens:** "Link state" wasn't recognised, so it was set to Ignore with no highlight, and both rows still said "Ready". A link marked Lost and one marked Pending both arrived as green Live, which raised the Live count. Separately, "tomorrow", "next spring" and "not a date" all passed as Ready and are stored as typed. Dates like `03/10/2026` are stored as text, so it's unclear which month they mean.
- **Why it hurts:** the app now states something false about paid links. A renewal reminder can't work from free text (inferred from the stored values, because the Today counts are still sample data).
- **Recommendation:** highlight every column set to Ignore, and ask "Which column is the status?" Check dates in the preview, ask once whether the sheet uses day or month first, and flag anything unreadable.
- **Effort:** M
- **Evidence:** [f-import-status-ignored](ux-second-review-opus-2026-11-04/f-import-status-ignored.png), [f-import-lost-became-live](ux-second-review-opus-2026-11-04/f-import-lost-became-live.png), [100-import-dates](ux-second-review-opus-2026-11-04/100-import-dates.png), [103-backlink-bad-dates-panel](ux-second-review-opus-2026-11-04/103-backlink-bad-dates-panel.png)

#### 6. The prospect filter refuses a file with no spam column, and removes spam rows (Backlinks → In consideration → Filter a backlink CSV)
- **Steps:** upload a CSV with typical Semrush backlink headers (Page ascore, Source url, Target url and so on).
- **What happens:** a red error says "This CSV has no spam score column", with no column matching and no way forward except a sample file. Yet rows with a blank spam score are accepted and shown as "unknown", so a whole file with no scores could be treated the same way. When a score is present, the panel says it "Removes rows with a spam score above 30".
- **Why it hurts:** as far as I know, Semrush's normal backlink export has no spam score column. That's from my memory, not tested on a real file, so please try one of your own. If I'm right, the panel names SEMrush as a source and then refuses its export. Removing rows also doesn't match the "flagged, never removed" decision, which Link gaps follows correctly with a "Flagged as spam" filter ([f-link-gaps](ux-second-review-opus-2026-11-04/f-link-gaps.png)).
- **Recommendation:** reuse the column matching from Import CSV. Accept a file with no spam column and show every score as unknown. Keep over-limit rows, flagged and unticked.
- **Effort:** M
- **Evidence:** [f-filter-refused](ux-second-review-opus-2026-11-04/f-filter-refused.png)

#### 7. Backlinks show 0 visits and 0 leads when nothing was measured (Backlinks, Mediators, backlink panel)
- **Steps:** open Backlinks on the real API, where no Google data is connected.
- **What happens:** the cards, every row, the panel and the Mediators table all show Visits 0 and Leads 0. The panel's explanation is "No visits counted yet".
- **Why it hurts:** the owner sees AED 2,000 spent with an agency and 0 visits, and may reasonably drop that agency. The app doesn't actually know. This breaks your own rule that unknown stays unknown. Google not being built yet isn't the issue. The issue is how "no data source" looks, and it will stay wrong for any site marked Not used.
- **Recommendation:** show "—" plus "GA4 not connected for this site", which a code path in `backlinkPanel` already has (not reached by rows from the server, inferred from code). Also leave Cost per visit blank.
- **Effort:** S
- **Evidence:** [g-backlinks-1100](ux-second-review-opus-2026-11-04/g-backlinks-1100.png), [102-mediators-mixed](ux-second-review-opus-2026-11-04/102-mediators-mixed.png)

#### 8. "Mark as done" means something else, and loses data (Backlinks → In consideration)
- **Steps:** on a prospect, press Mark as done, then Save.
- **What happens:** it opens the Add backlink form with Status preset to Live. After Save, the Authority of 71 and the Spam score of 8 from the file are gone: the row shows "—". The list also has no owner, status or notes, so a team can't track who is talking to which site. Under the table sits the line "Not built yet, so these never count in the cards above", which doesn't say what isn't built.
- **Why it hurts:** "done" reads as "finished looking at this". A hurried user presses it to tidy the list and creates a Live backlink that was never placed, which inflates the Live and New counts.
- **Recommendation:** rename it "Link placed", leave the status for the user to choose, and carry Authority and Spam score across. Add an owner and a short status (Not contacted, Contacted, Agreed, Refused). Replace the footnote with "Prospects aren't counted in the cards above."
- **Effort:** M
- **Evidence:** [g-in-consideration](ux-second-review-opus-2026-11-04/g-in-consideration.png), [g-after-mark-done](ux-second-review-opus-2026-11-04/g-after-mark-done.png)

#### 9. Compare can point people to the wrong conclusion (Competitors → Page vs page → Compare)
- **Steps:** open Compare for `/abonnement` against rival-one's `/subscription`.
- **What happens:** two problems stack up.
  - **Language warning buried:** this pair is French against English. The top of the screen says "They're 1 place ahead", and the table says "They have 1,104 more words". The warning, "comparing their words means little", sits more than a screen lower, under Headings.
  - **Sides flip:** every table up to that point has Mine on the left and Theirs on the right. The Headings section puts "only they have" on the left and "only you have" on the right, with no change in layout to signal it.
- **Why it hurts:** someone could brief a writer to add 1,100 words on the strength of a comparison the app itself considers close to meaningless, or read their own headings as the rival's.
- **Recommendation:** put the language warning directly under the verdict, and in the pair list too, and offer a same-language page if one exists. Keep Mine on the left everywhere.
- **Effort:** S
- **Evidence:** [f-compare-top](ux-second-review-opus-2026-11-04/f-compare-top.png), [f-compare-headings](ux-second-review-opus-2026-11-04/f-compare-headings.png)

#### 10. The places where you decide to act have no Task button (Compare detail, competitor Timeline, AI Overview "What changed")
- **Steps:** open each of those screens and look for a way to make a task.
- **What happens:** there isn't one. "You're no longer cited for how to brew coffee" and "Meta description changed" are dead ends. On Compare, you must go back to All pairs to find the Task button, by which point you've lost your place. Today, the pair list, health checks, the links checker and the backlink panel all have one, and your design rules say every finding should.
- **Why it hurts:** you're told what changed, but what to do next is left to memory.
- **Recommendation:** add `UI.taskButton` to the Compare header, and on each timeline and AI Overview change row. On Compare, include the keyword and the main gap in the task's description.
- **Effort:** S
- **Evidence:** [f-competitor-timeline](ux-second-review-opus-2026-11-04/f-competitor-timeline.png), [f-ai-watch-changes](ux-second-review-opus-2026-11-04/f-ai-watch-changes.png)

#### 11. The new-site checklist gets its own progress wrong, then disappears (Add a website → Today)
- **Steps:** add a website, press Add on the Add keywords step, upload keywords and return to Today. Then reload.
- **What happens:**
  - **Wrong route:** Add keywords lands on "My competitors", with no upload panel in sight. Upload is three clicks away: Find competitors, then Upload your keyword list.
  - **Wrong tick:** after uploading 3 keywords, the card on Today still shows step 3 with its Add button. The panel opened from the same card correctly says Done, and the card stays wrong afterwards.
  - **Vanishes:** after a reload, the site goes back to All sites and the card is gone. Nothing says where to find it, and Settings → Sites isn't built.
  - **"Not used" lives in one browser:** after the test database was wiped and I re-added the same site name, Connect Google and Connect Clarity still said Not used (setup choices are in `localStorage`, confirmed in code). A teammate would see a different checklist.
  - **Missing steps:** the first health test and link check aren't on the list, though a new site has no score until someone runs them on this Mac version.
- **Why it hurts:** the card is how a new site gets finished. If it's wrong or gone, sites stay half set up.
- **Recommendation:** make Add open the upload panel directly, reload the card's progress when Today opens, and keep the card visible in All sites until finished ("newsite-demo: 2 of 5 done"). Store Not used on the server. Add a step saying the first health test and link check run by themselves, or a button to start them.
- **Effort:** M
- **Evidence:** [f-setup-panel](ux-second-review-opus-2026-11-04/f-setup-panel.png), [f-setup-add-keywords-lands](ux-second-review-opus-2026-11-04/f-setup-add-keywords-lands.png), [f-setup-card-stale](ux-second-review-opus-2026-11-04/f-setup-card-stale.png), [f-setup-panel-after](ux-second-review-opus-2026-11-04/f-setup-panel-after.png)

#### 12. A non-technical teammate can't get through the Google panel (Settings → Google)
- **Steps:** press Connect, as someone who has never opened Google Cloud.
- **What happens:** the writing is clear and the five deep links help, but it's still seven steps across Cloud Console, Search Console and Analytics, repeated for each website. Three things make it harder than it needs to be:
  - **Late warning:** the fact that this connection isn't built yet appears only after a key has been pasted. Nothing near the top says so, so someone could spend 20 minutes in Google Cloud before finding out. The empty-key Test only says "Paste the key first".
  - **Numbers without names:** "Which site uses what" shows bare GA4 IDs such as 3120417, already filled in, with no property names to check them against. A wrong guess looks the same as a right one.
  - **No focus:** arriving from the new site's checklist, you get every site's settings, with the new one at the bottom.
- **Why it hurts:** this is the step that makes the Traffic data work. The owner already decided on pasted keys, so the realistic plan is that the owner does it, and the panel should say so.
- **Recommendation:** put "Not built yet: nothing you paste here is kept" at the very top for now. Add "Usually done once by an admin, about 20 minutes". Show property names beside IDs once the connection exists, and leave them blank until someone chooses. Coming from a checklist, show only that site.
- **Effort:** S for the warning and wording, M for the rest.
- **Evidence:** [g-google-top](ux-second-review-opus-2026-11-04/g-google-top.png), [g-google-mapping-test](ux-second-review-opus-2026-11-04/g-google-mapping-test.png)

### Minor

#### 13. Page vs page doesn't put the worst gap first
- **Steps:** Competitors → Page vs page, with All selected.
- **What happens:** the tip says "furthest behind first", but it's sorted by my page. The biggest gap, 3 places on best coffee beans, is in the sixth group, after a page that's only 1 behind. All is the default, so 8 of 15 rows are not losses. The explanation now hides behind an "i" icon.
- **Recommendation:** default to "They're ahead", and sort groups by their largest gap.
- **Effort:** S
- **Evidence:** [f-pairs](ux-second-review-opus-2026-11-04/f-pairs.png)

#### 14. "Go to the finding" is excellent from health and weak elsewhere
- **Steps:** open a task from each source and press Go to the finding.
- **What happens:** from a health check it opens the exact check. From a pair it lands on the whole list with nothing marked, not on Compare. From a backlink it lands on the list, with no panel open. From a Today alert it goes back to Today, not to Site health, and if someone has pressed Mark as seen the alert may no longer be on show. There's also no route back to the task except Tasks in the menu.
- **Recommendation:** open the actual pair or backlink. Send Today alerts to their source screen. Add "Back to the task" to the toast, which already offers "Reopen" for a draft.
- **Effort:** M
- **Evidence:** [f-goto-pair](ux-second-review-opus-2026-11-04/f-goto-pair.png), [f-goto-backlink](ux-second-review-opus-2026-11-04/f-goto-backlink.png), [f-goto-cert](ux-second-review-opus-2026-11-04/f-goto-cert.png)

#### 15. New tasks need tidying, and carry-over hides the date
- **Steps:** create a task from a critical alert on Today. Then view a late task in Month or Table, and mark it Done.
- **What happens:** on a site-two alert, Site still says "All sites" and Priority says Normal. Pair tasks get a title like "site-one.example/abonnement / rival-one.example/subscription", which isn't a job. "Carried over from October 2026" replaces the due date, so you can't see that it was 20 Oct. It also stays on a task that's already Done, as a warning. Owner is free text with no list and no "Unassigned" filter, so tasks with no owner can't be found.
- **Recommendation:** fill in the site and raise priority from the finding, and write titles as actions ("Close the gap on abonnement café against Rival One"). Show "Late · 20 Oct", and no warning once it's Done. Add an Unassigned filter.
- **Effort:** S
- **Evidence:** [f-task-from-today](ux-second-review-opus-2026-11-04/f-task-from-today.png), [f-tasks-month-done-carried](ux-second-review-opus-2026-11-04/f-tasks-month-done-carried.png), [39-tasks-table](ux-second-review-opus-2026-11-04/39-tasks-table.png)

#### 16. Mediators and Found but never logged are dead ends
- **Steps:** Backlinks → Mediators, then Found but never logged.
- **What happens:** you can't click a mediator to see their links, and there's no cost per visit, though that's the question this table exists to answer. In Found, the only action is Log it. A link you don't want stays there forever and keeps the count up, and there's no Task.
- **Recommendation:** make a mediator row filter All backlinks and add cost per visit. Add "Not ours / ignore" and a Task button to Found, with ignored links still kept and shown under a filter.
- **Effort:** S
- **Evidence:** [g-mediators-sample](ux-second-review-opus-2026-11-04/g-mediators-sample.png), [g-found-sample](ux-second-review-opus-2026-11-04/g-found-sample.png)

#### 17. Moving between sites loses or changes your context
- **Steps:** pick site-two on Today. Press Tasks due this week. Separately, reload and open Competitors after adding a new site.
- **What happens:** Today's Needs attention keeps listing site-one's health alert while site-two is picked (the health alerts are real data). "Tasks due this week" opens Tasks on All dates, not This week. With All sites selected, Competitors and Site health default to the alphabetically first site, so newsite-demo.example, which has no data, took over from site-one for everyone.
- **Recommendation:** filter alerts by the chosen site and say "Showing site-two only", apply This week from that link, and default to the last site used or the first with data.
- **Effort:** S
- **Evidence:** [g-today-site-two](ux-second-review-opus-2026-11-04/g-today-site-two.png), [96-pairs-390](ux-second-review-opus-2026-11-04/96-pairs-390.png)

#### 18. Keyboard users lose their place after saving
- **Steps:** open a task from the board with Enter, edit it and save with Enter. Separately, add a comment and press Esc.
- **What happens:** focus drops to the top of the page (`BODY`), so the next Tab starts again from the Mockup bar. Plain Esc returns focus correctly. On Competitors, Left and Right arrows don't move between the tabs, though they are marked up as tabs, so a screen-reader user will expect them to. Tab does reach every one.
- **Recommendation:** after the board redraws, return focus to the card by its id. Add arrow keys on those tabs.
- **Effort:** S
- **Evidence:** keyboard log only. [92b-card-status-focus](ux-second-review-opus-2026-11-04/92b-card-status-focus.png) shows the card's focus state.

#### 19. Times don't agree: some are UTC, some local
- **What happens:** at 19:32 Dubai time, a just-finished link check was stamped "4 Nov 2026, 15:32" with no label. On the same app, a note says "Saved 19:22" and a task says "Created 4 Nov, 19:33". Compare's "Last changed" also shows UTC.
- **Recommendation:** show local time everywhere. Keep UTC in the database only.
- **Effort:** S
- **Evidence:** [f-links-result](ux-second-review-opus-2026-11-04/f-links-result.png), [f-notes-after-first](ux-second-review-opus-2026-11-04/f-notes-after-first.png)

#### 20. Developer leftovers and one contradictory number
- **What happens:** the "Mockup · Colour · Data · Sample data" bar sits on top of real screens, adds 13 tab stops, and says "Sample data" above real backlinks. On a competitor, "New pages in 30 days: 9" sits above a timeline saying "New pages 1", because a first read seems to count every page as new (inferred). "Pages known" is also 9.
- **Recommendation:** hide the bar outside design mode, and don't count the first read as new pages.
- **Effort:** S
- **Evidence:** [f-today](ux-second-review-opus-2026-11-04/f-today.png), [g-competitor-detail](ux-second-review-opus-2026-11-04/g-competitor-detail.png)

## 4. What I'd change first

1. **Stop the silent overwrites (findings 1 and 2).** Fix the notes box and add a conflict check on task Save. This is a small amount of work and it's what makes team use safe.
2. **Make imports honest (findings 4, 5 and 6).** Report rows not added, highlight ignored columns, check dates, and accept files with no spam column, with spam rows flagged rather than removed.
3. **Don't let the numbers mislead (findings 7, 8 and 9).** Show unknown instead of 0, stop "Mark as done" creating Live links and dropping Authority, and move the language warning to the top of Compare.
4. **Make Back and links work (finding 3).** The app is otherwise easy to move around, and this is the one thing that throws people out of it.
5. **Connect "what changed" to "what to do" (findings 10 and 11).** Add Task buttons on Compare, the timeline and AI Overview changes, and make the setup checklist correct and persistent.

## 5. What I didn't test

**Findings not fully re-checked after the 19:18 code change:**
- **Finding 12:** I saw the "isn't built yet" message after pasting a key at 19:14. At 19:35 I confirmed the panel doesn't mention it before that, and the wording is still in `mockup.js`, but I didn't paste a key again.
- **Finding 18:** the arrow-key test ran at about 19:19 and focus loss was re-confirmed at 19:35. The arrow-key test wasn't repeated, and `mockup.js:358` has arrow handling, though it didn't move these tabs when I tried it.
- **What works:** "Go to the finding" opening the exact health check was last seen at about 19:14. The keyboard pass and 390/640/860 px widths ran between about 19:17 and 19:20. I re-checked 390 and 1100 px at 19:36.
- **`mockup.css`** changed again at 19:33 and I didn't investigate what changed, so the earlier screenshots may differ slightly.

**Not tested at all:**
- Any real external service, real Google data, or a real Semrush or Ubersuggest file. My Semrush headers in finding 6 come from memory.
- A screen reader, French, dark mode and other looks, and reduced motion.
- Long lists. The demo world has about 10 keywords and a few links, so I can't say how these tables feel with hundreds of rows.
- Link gaps beyond a quick look. Also Keywords and Refresh, which are sample data, and the OAuth path in the Google panel.
- Saving a changed pair, Hide this pair, removing a competitor, the OAuth keys route, and the custom Dates range on Tasks.
- Whether a task notices when its finding gets fixed. I'd check this next, because stale tasks are the next team risk.
- Touch dragging on a phone.

**How the test run differed from the brief:**
- The shared Playwright MCP browser changed under me early on, so I used it only for the first few screens. After that I drove a private headless Chrome by hand, using the project's own `tests/ui/pw.cjs`, one step at a time with screenshots.
- `seo_command_center_test` was wiped twice by another session's test run. This caused a false lead (a Run check that showed nothing), which I dropped. Later, my server on that database disrupted that session's test run, as the coordinator told me. I restarted the server at about 19:32 and stopped it at about 19:37.
