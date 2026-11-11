// Competitors fixes of 2026-11-10 (agent E), driven as a person would on the demo app:
//  1. Competitors when its first call fails: what failed, and Try again that works.
//  2. The table: search box, sortable headers, a search that survives a reload, row order kept after a tracking change.
//  3. Keyword check: an empty box in words, a repeat Check that spends nothing, Add to my keywords firing keywords:changed,
//     Remove with Undo.
//  4. Notes: two people on one note get Keep mine / Use theirs; a note deleted by someone else says so and keeps the words.
//  5. The Firecrawl box follows a run on competitors/<id>/reading, never by reloading the profile.
// Plus French, dark and 390 px screenshots of what changed. Made-up sites only.
//   node tests/ui/flow_competitors_fixes.cjs [http://127.0.0.1:8285/] [out dir]
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8285/";
const OUT = path.resolve(process.argv[3] || "var/fixe-e/shots") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${typeof extra === "string" ? extra : JSON.stringify(extra)}]` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) })), [method, BASE + "api/" + p, body]);
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  const until = async (test, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await page.waitForTimeout(400); } return false; };
  const text = (sel) => page.textContent(sel).catch(() => "");
  const texts = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);

  await page.goto(BASE + "#today"); await settle();
  const site = (await call("GET", "links/sites")).sites.find((s) => s.kind === "own" || s.kind === undefined);
  const q = `site=${site.host}`;

  // ---- 1. a failed first call ---------------------------------------------------------------------------
  let failOnce = true;
  await page.route("**/api/links/sites", (route) => { if (failOnce) { failOnce = false; return route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" }); } return route.continue(); });
  await page.goto("about:blank"); await page.goto(BASE + `#competitors/summary?${q}`); await settle(1800);
  const failed = await text("#comp-load-failed");
  check("1a. a failed load says what failed, in words", /didn't load/.test(failed) && /list of sites/.test(failed) && !/Internal Server Error|Error 500/.test(failed), failed.trim().slice(0, 140));
  check("1b. and offers Try again", Boolean(await page.$("#comp-load-failed [data-comp-retry]")));
  await page.screenshot({ path: OUT + "1-load-failed.png" });
  await page.click("#comp-load-failed [data-comp-retry]"); await settle(2500);
  check("1c. Try again loads the screen", Boolean(await page.$("#cs-rivals-table")) && !(await page.$("#comp-load-failed")));
  await page.unroute("**/api/links/sites");

  // ---- 2. search and sort ---------------------------------------------------------------------------------
  const listed = (await call("GET", `competitors?site_id=${site.id}`)).competitors || [];
  for (let n = listed.length; n < 11; n += 1) await call("POST", "competitors", { site_id: site.id, address: `find-me-${n}.example` }); // the search box shows past 10 rows (FIND_FROM in comp-summary.js)
  await page.goto("about:blank"); await page.goto(BASE + `#competitors/summary?${q}`); await until(() => page.$("#cs-rivals-table"));
  await settle(1500);
  const names = () => texts("#cs-rivals-table tbody tr[data-cs-row] .logo-text");
  const all = await names();
  check("2a. a search box shows with this many competitors", Boolean(await page.$("#cs-find")), all.length);
  const cols = (await texts("#cs-rivals-table thead th:not(.tt-pick)")).length;
  check("2b. the table keeps its columns", cols === 7, cols);
  const target = all.find((n) => /find-me-3/.test(n)) || all[all.length - 1];
  const part = target.slice(0, 9);
  await page.fill("#cs-find", part.toUpperCase()); await settle(500);
  const found = await names();
  check("2c. typing part of a name, any case, narrows the table", found.length >= 1 && found.length < all.length && found.every((n) => n.toLowerCase().includes(part.toLowerCase())), found);
  check("2d. the box keeps the focus while typing", await page.evaluate(() => document.activeElement?.id === "cs-find"));
  check("2e. the search is in the address", /find=/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash));
  await page.reload(); await until(() => page.$("#cs-rivals-table")); await settle(1500);
  check("2f. a reload keeps the search", (await page.inputValue("#cs-find").catch(() => "")).toLowerCase() === part.toLowerCase() && (await names()).length === found.length);
  await page.fill("#cs-find", "zzz-nothing"); await settle(400);
  check("2g. no match says so, with a way back", /No competitor matches/.test(await text("#cs-rivals-list")) && Boolean(await page.$("[data-cs-find-clear]")));
  await page.screenshot({ path: OUT + "2-find-none.png" });
  await page.click("[data-cs-find-clear]"); await settle(400);
  check("2h. Show all brings every row back", (await names()).length === all.length);
  await page.click('[data-cs-sort="name"]'); await settle(400);
  const az = await names();
  check("2i. the name header sorts A to Z", JSON.stringify(az) === JSON.stringify([...az].sort((a, b) => a.localeCompare(b))), az);
  const sortState = await page.evaluate(() => { const b = document.querySelector('[data-cs-sort="name"]'); return [b.classList.contains("on"), b.closest("th").getAttribute("aria-sort")]; });
  check("2j. and says so to screen readers", sortState[0] && sortState[1] === "ascending", sortState);
  await page.click('[data-cs-sort="name"]'); await settle(400);
  const za = await names();
  check("2k. a second press sorts Z to A", JSON.stringify(za) === JSON.stringify([...az].reverse()), za);
  // A tracking change keeps every row where it was (F12).
  const before = await names();
  const second = await page.$("#cs-rivals-table tbody tr[data-cs-row]:nth-child(3)"); // the second competitor: my own site's You row is first
  const options = second ? await second.$$("[data-ct-set], .ct-switch button, [role=radio]") : [];
  if (options.length >= 2) {
    await options[1].click(); await settle(2500);
    check("2l. a tracking change keeps the rows in place", JSON.stringify(await names()) === JSON.stringify(before), await names());
  } else check("2l. a tracking switch is in the row", false, "no switch found");
  await page.screenshot({ path: OUT + "2-sorted.png", fullPage: true });

  // ---- 3. Keyword check ----------------------------------------------------------------------------------
  let changed = 0;
  await page.exposeFunction("__kwChanged", () => { changed += 1; });
  await page.evaluate(() => document.addEventListener("keywords:changed", () => window.__kwChanged()));
  await page.click('[data-comp-tab="check"]'); await settle();
  await page.fill("[data-kc-words]", "   "); await page.click("[data-kc-add]"); await settle(400);
  const empty = await text("[data-kc-add-error]");
  check("3a. an empty box is said in a sentence", /Type at least one keyword/.test(empty) && !/required/.test(empty), empty);
  const word = `fixes check ${Date.now() % 100000}`;
  await page.fill("[data-kc-words]", word); await page.click("[data-kc-add]"); await settle();
  const row = () => page.$(`xpath=//table[contains(@class,"kc-table")]//tr[.//span[contains(@class,"kw") and normalize-space(.)="${word}"]]`);
  check("3b. the keyword is added", Boolean(await row()));
  await (await (await row()).$("[data-kc-one]")).click(); await until(() => page.$("[data-kc-go]")); await page.click("[data-kc-go]");
  await until(async () => /ago|instant|just now/.test((await (await row())?.textContent()) || ""), 60000); await settle(1500);
  await (await (await row()).$("[data-kc-one]")).click(); await until(async () => /Nothing to check|Check 1/.test(await text(".kc-confirm"))); await settle(300);
  const again = await text(".kc-confirm");
  check("3c. Check again right after says nothing is spent", /Nothing to check now/.test(again) && !(await page.$("[data-kc-go]")), again.trim().slice(0, 160));
  await page.screenshot({ path: OUT + "3-repeat.png" });
  await page.click("[data-kc-cancel]"); await settle(300);
  const track = await (await row()).$("[data-kc-track]");
  if (track) { await track.click(); await settle(); check("3d. Add to my keywords tells Keywords at once (keywords:changed)", changed >= 1, changed); }
  else check("3d. Add to my keywords is offered", false);
  await (await (await row()).$("[data-kc-remove]")).click(); await settle(600);
  const toastText = await text("#toasts");
  check("3e. Remove says so and offers Undo", toastText.includes(`“${word}” removed.`) && Boolean(await page.$("#toasts [data-undo]")), toastText.trim().slice(0, 120));
  check("3f. the row is gone", !(await row()));
  await page.click("#toasts [data-undo]"); await settle(1800);
  check("3g. Undo puts it back", Boolean(await row()));

  // ---- 4. Notes: a clash, and a note deleted meanwhile ------------------------------------------------------
  const note = await call("POST", "notes", { scope: "all", body: "Shared note, first words." });
  await page.goto("about:blank"); await page.goto(BASE + `#competitors/notes?${q}`); await settle(2000);
  const fieldFor = async (body) => { for (const el of await page.$$("textarea[data-note-field]:not([data-note-composer])")) { if ((await el.inputValue()).startsWith(body)) return el; } return null; };
  let mine = await fieldFor("Shared note, first words.");
  check("4a. the note shows", Boolean(mine));
  if (mine) {
    await page.waitForTimeout(1100);
    await call("PATCH", `notes/${note.id}`, { body: "A teammate rewrote it." }); // someone else saves first
    await mine.click(); await mine.press("End"); await mine.type(" And mine."); await settle(2500);
    const status = (await texts("[data-note-status]")).join(" | ");
    check("4b. two people on one note: nothing is overwritten, Keep mine / Use theirs offered", /Someone else changed this note/.test(status) && Boolean(await page.$("[data-note-keep-mine]")) && Boolean(await page.$("[data-note-use-theirs]")), status.slice(0, 200));
    check("4c. the server still has the teammate's words", (await call("GET", "notes?scope=all")).notes.find((n) => n.id === note.id)?.body === "A teammate rewrote it.");
    await page.screenshot({ path: OUT + "4-clash.png" });
    await page.click("[data-note-keep-mine]"); await settle(2500);
    check("4d. Keep mine saves mine over theirs", (await call("GET", "notes?scope=all")).notes.find((n) => n.id === note.id)?.body === "Shared note, first words. And mine.");
    // Deleted by someone else while typing (F121).
    await call("DELETE", `notes/${note.id}`);
    mine = await fieldFor("Shared note, first words. And mine.");
    if (mine) {
      await mine.click(); await mine.press("End"); await mine.type(" Still typing."); await settle(2500);
      const said = await text("#toasts");
      check("4e. a note deleted meanwhile says so", /Someone deleted this note/.test(said), said.trim().slice(0, 140));
      const kept = (await call("GET", "notes?scope=all")).notes.find((n) => n.body === "Shared note, first words. And mine. Still typing.");
      check("4f. and the words are kept in a new note", Boolean(kept) && kept.id !== note.id);
      if (kept) await call("DELETE", `notes/${kept.id}`);
    } else check("4e. the field is still there", false);
  }

  // ---- 5. the Firecrawl box polls the small route ---------------------------------------------------------
  const asked = [];
  page.on("request", (r) => { const u = r.url(); if (/\/api\/competitors\/\d+\/(profile|reading)/.test(u)) asked.push(u.replace(/.*\/api\//, "")); });
  await call("PUT", "app-keys/firecrawl", { key: "fc-demo-key-1234" });
  await call("POST", "app-keys/firecrawl/test");
  // As a person would: open a competitor whose box offers Firecrawl, press it, read the cost, confirm.
  // The demo internet's JavaScript-only site, which only Firecrawl can read.
  if (!(await call("GET", `competitors?site_id=${site.id}`)).competitors.some((c) => c.host === "spa-rival.example")) await call("POST", "competitors", { site_id: site.id, address: "spa-rival.example" });
  await until(async () => { const c = (await call("GET", `competitors?site_id=${site.id}`)).competitors.find((x) => x.host === "spa-rival.example"); return c && ["ok", "blocked", "failed"].includes(c.crawl?.status); }, 90000);
  const rivals = (await call("GET", `competitors?site_id=${site.id}`)).competitors.filter((c) => c.tracking !== "off").sort((a, b) => (b.host === "spa-rival.example") - (a.host === "spa-rival.example"));
  let pressed = false;
  for (const c of rivals) {
    await page.goto("about:blank"); await page.goto(BASE + `#competitors/summary?${q}`); await until(() => page.$(`[data-cs-open="${c.id}"]`));
    await page.click(`[data-cs-open="${c.id}"]`); await settle(1800);
    // Since 2026-11-10 the first reading note says how the site is followed; Firecrawl's offer folds under it.
    await page.locator(".rd-fold").evaluateAll((folds) => folds.forEach((d) => { d.open = true; }));
    const ask = await page.$('[data-rd-ask]:not([disabled]):not([data-rd-ask="weekly"])');
    if (!ask) continue;
    await ask.click(); await until(() => page.$("[data-rd-go]:not([disabled])"), 15000);
    const go = await page.$("[data-rd-go]:not([disabled])");
    if (!go) continue;
    const opened = asked.length;
    await go.click(); pressed = true;
    await settle(3000);
    await until(async () => !/Firecrawl (starting|is reading|listing)/.test(await text("[data-rd-box]")), 90000);
    await settle(1000);
    const during = asked.slice(opened);
    check("5a. after Confirm, the box follows the run on the reading route, never the whole profile", during.length > 0 && during.every((u) => u.includes("/reading")), during.slice(0, 6));
    check("5b. and shows how it ended", /Firecrawl (read|listed)/.test(await text("[data-rd-box]")), (await text("[data-rd-box]")).trim().slice(0, 160));
    await page.screenshot({ path: OUT + "5-firecrawl-done.png" });
    break;
  }
  if (!pressed) check("5. a demo competitor offers Firecrawl", false);

  // ---- French, dark, 390 px --------------------------------------------------------------------------------
  await menu(page, "lang"); await settle(600);
  await page.goto("about:blank"); await page.goto(BASE + `#competitors/summary?${q}&find=find`); await until(() => page.$("#cs-rivals-table")); await settle(1500);
  check("FR. the search box is in French", (await page.getAttribute("#cs-find", "placeholder")) === "Chercher un concurrent");
  await page.screenshot({ path: OUT + "fr-find.png", fullPage: true });
  await page.click('[data-comp-tab="check"]'); await settle();
  await page.fill("[data-kc-words]", ""); await page.click("[data-kc-add]"); await settle(300);
  check("FR. the empty box sentence is French", /Tapez au moins un mot-clé/.test(await text("[data-kc-add-error]")));
  await page.screenshot({ path: OUT + "fr-keyword-check.png", fullPage: true });
  await menu(page, "lang"); await settle(300); await menu(page, "theme"); await settle(600);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("about:blank"); await page.goto(BASE + `#competitors/summary?${q}`); await until(() => page.$("#cs-rivals-table")); await settle(1500);
  const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector("#main")?.scrollWidth || 0) - window.innerWidth);
  check("390. no sideways scroll", wide <= 1, wide);
  await page.screenshot({ path: OUT + "dark-390-competitors.png", fullPage: true });
  await page.click('[data-comp-tab="check"]'); await settle();
  await page.screenshot({ path: OUT + "dark-390-keyword-check.png", fullPage: true });

  const errors = problems.filter((p) => !/auth\/me|404 \(NOT FOUND\)|Failed to load resource/.test(p));
  check("no page errors", errors.length === 0, errors.slice(0, 4));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
