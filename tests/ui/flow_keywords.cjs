// Keywords and Refresh on the real app, the way a person uses them, with screenshots to look at.
// Needs: DB_NAME_TEST=seo_cc_refresh_test .venv/bin/python tests/ui/keywords_server.py --port 8222
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8222/";
const note = (...a) => console.log(...a);
const fails = [];
const check = (ok, what) => { note(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
const settle = (page, ms = 500) => page.waitForTimeout(ms);
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) note(`   ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}login`); await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go"); await page.waitForTimeout(800);
  await page.goto(`${BASE}#keywords`); await page.waitForSelector("#kw-table", { timeout: 15000 }); await settle(page);
  await shot(page, "01-list");
  const bodyText = await page.textContent("#page");
  check(!/coût de la vie|visa séville|titre de séjour/.test(bodyText), "no sample keyword on the real screen");
  check((await page.$$("#kw-table tbody tr")).length >= 10, "real rows show");
  check(/Scraped results/.test(bodyText), "the Top 10 tile says its source");
  check(await page.$("#period") === null, "no period picker that wouldn't do anything");

  // Each engine tab, and the views
  for (const id of ["duckduckgo", "bing", "yandex", "all", "google"]) { await page.click(`[data-engine="${id}"]`); await settle(page, 200); if (id === "all" || id === "duckduckgo") await shot(page, `02-engine-${id}`); }
  await page.click('[data-view="bucket"]'); await settle(page, 200); await shot(page, "03-bucket");
  await page.click('[data-view="queries"]'); await settle(page, 300); await shot(page, "04-queries");
  { const stored = await page.evaluate(async () => (await (await fetch("api/rankings/queries?engine=google")).json()).rows || []);
    const words = await page.textContent("#page");
    check(stored.length ? stored.every((row) => words.includes(row.query)) : /No Search Console data yet/.test(words), "Queries shows exactly what's stored, or says why it's empty"); }
  await page.click('[data-view="positions"]'); await settle(page, 200);
  for (const f of ["top3", "top10", "up", "down", "none", "cited", "two", "all"]) { await page.click(`[data-filter="${f}"]`); await settle(page, 80); }
  await page.click('[data-sort="pos"]'); await settle(page, 80); await page.click('[data-sort="chg"]'); await settle(page, 80); await page.click('[data-sort="k"]'); await settle(page, 80);
  await page.click("#density"); await settle(page, 80); await page.click("#density");

  // The panel, with Esc
  await page.click("[data-kwr-open]"); await page.waitForSelector("#tool-table", { timeout: 8000 }); await settle(page, 400);
  await shot(page, "05-panel");
  await page.evaluate(() => { document.querySelector("#panel .panel-body").scrollTop = 99999; }); await settle(page, 200); await shot(page, "06-panel-end");
  await page.keyboard.press("Escape"); await settle(page, 300);
  check(await page.$("#panel") === null, "Esc closes the panel");

  // Refresh: dialog, change options, cancel, open again, double click on Confirm
  await page.click("#kwr-refresh"); await page.waitForSelector("#kwr-summary p", { timeout: 8000 }); await settle(page, 400);
  await shot(page, "07-dialog");
  const leftOut = await page.textContent("#kwr-summary");
  note("   summary:", leftOut.replace(/\s+/g, " ").slice(0, 200));
  await page.selectOption("#kwr-depth", "20"); await settle(page, 400); await shot(page, "08-dialog-depth20");
  await page.click('[data-kwr-mode="pick"]'); await settle(page, 300); await shot(page, "09-dialog-pick");
  check(await page.$eval("#kwr-confirm", (b) => b.disabled), "Choose tools with nothing ticked can't be confirmed");
  await page.click('[data-kwr-mode="auto"]'); await settle(page, 300);
  await page.keyboard.press("Escape"); await settle(page, 200);
  check(!(await page.$eval("#dlg", (d) => d.open)), "Esc closes the dialog");
  const before = await page.evaluate(async () => (await (await fetch("api/tools")).json()).tools.find((t) => t.name === "Bright Data").left);
  await page.click("#kwr-refresh"); await page.waitForSelector("#kwr-recent", { timeout: 8000 }); await page.check("#kwr-recent"); await page.waitForFunction(() => { const b = document.querySelector("#kwr-confirm"); return b && !b.disabled; }, null, { timeout: 8000 });
  check(await page.evaluate(() => document.activeElement?.id === "kwr-recent"), "ticking Check them again keeps the keyboard there");
  await page.dblclick("#kwr-confirm"); await page.waitForSelector("#tray", { timeout: 8000 }); await settle(page, 700);
  await shot(page, "10-tray-running");
  check(await page.$eval("#kwr-refresh", (b) => b.disabled), "Refresh can't be pressed again while one runs");
  const runs = await page.evaluate(async () => (await (await fetch("api/refresh/runs")).json()).runs.length);
  check(runs === 1, `a double click makes one run (saw ${runs})`);
  await page.waitForFunction(() => /saved|enregistr/.test(document.querySelector("#tray .top")?.textContent || ""), null, { timeout: 60000 });
  await settle(page, 800); await shot(page, "11-tray-finished");
  note("   tray:", (await page.textContent("#tray")).replace(/\s+/g, " "));
  const after = await page.evaluate(async () => (await (await fetch("api/tools")).json()).tools.find((t) => t.name === "Bright Data").left);
  note("   Bright Data left:", before, "->", after);
  // On Google, SerpApi (the only tool that reads AI Overviews) goes ahead of the saved order while it has free searches,
  // so Bright Data, first in the saved order, isn't touched.
  check(after === before, `SerpApi goes first for Google, so Bright Data isn't used (${before} -> ${after})`);
  await settle(page, 600); await shot(page, "12-after-refresh");

  // The order moving on: with "SerpApi first" switched off, Bright Data leads, runs out of its 12 free checks part way,
  // and the run moves to the next tool. A row now read by another tool says "tool changed".
  await page.evaluate(() => window.COMP.api("PATCH", "tools/settings", { ai_first: "0" }));
  await page.click("#kwr-refresh"); await page.waitForSelector("#kwr-recent", { timeout: 8000 }); await page.check("#kwr-recent"); await page.waitForFunction(() => { const b = document.querySelector("#kwr-confirm"); return b && !b.disabled; }, null, { timeout: 8000 });
  await page.click("#kwr-confirm"); await page.waitForSelector("#tray", { timeout: 8000 }); await settle(page, 700);
  await page.waitForFunction(async () => !(await (await fetch("api/refresh/runs")).json()).runs.length, null, { timeout: 90000, polling: 1000 }); // this run, not the last one's tray
  await page.waitForFunction(() => /saved|enregistr/.test(document.querySelector("#tray .top")?.textContent || ""), null, { timeout: 30000 });
  await settle(page, 800); await shot(page, "12b-after-order-moved");
  note("   tray:", (await page.textContent("#tray")).replace(/\s+/g, " "));
  const spent = await page.evaluate(async () => (await (await fetch("api/tools")).json()).tools.find((t) => t.name === "Bright Data").left);
  note("   Bright Data left:", after, "->", spent);
  check(spent < after, `with SerpApi first switched off, the saved order leads with Bright Data (${after} -> ${spent})`);
  const changed = await page.$$eval("#kw-table .second", (els) => els.map((e) => e.textContent).filter((x) => x.includes("tool changed")).length);
  check(changed > 0, `a tool switch shows "tool changed" (${changed} rows)`);
  await page.evaluate(() => window.COMP.api("PATCH", "tools/settings", { ai_first: "1" }));

  // Recheck with another tool from the panel
  await page.click("[data-kwr-open]"); await page.waitForSelector("#tool-table [data-kwr-check]", { timeout: 8000 }); await settle(page, 300);
  const tools = await page.$$eval("#tool-table [data-kwr-check]", (b) => b.map((x) => x.dataset.kwrCheck));
  note("   panel tools:", tools.join(", "));
  await page.click('#tool-table [data-kwr-check="Browser on this Mac"]'); await settle(page, 300);
  await page.waitForFunction(() => /saved|enregistr/.test(document.querySelector("#tray .top")?.textContent || ""), null, { timeout: 30000 }); await settle(page, 900);
  await shot(page, "13-panel-after-browser");
  check(/AE|Emirats|Emirates/.test(await page.textContent("#panel")), "the browser's result stays on its own line, by location");
  const browserRow = await page.$$eval("#tool-table tr", (rows) => rows.map((r) => r.textContent).find((x) => x.includes("Browser")));
  check(/Another location/.test(browserRow) && !/never/.test(browserRow), "the tool row doesn't say never for a tool that just checked from elsewhere");
  check(await page.$eval('#tool-table [data-kwr-check="Bright Data"]', (b) => b.disabled), "a tool with no free checks left can't be pressed");
  await page.keyboard.press("Escape"); await settle(page, 300);
  check(await page.$("#kw-table tr.open") === null || (await page.$$eval("#kw-table tr.open", (r) => r.length)) === 0, "no row stays highlighted once the panel closes");
  await page.goto(`${BASE}?z=1#keywords`); await page.waitForSelector("#kw-table", { timeout: 15000 }); await settle(page, 400);
  check(!/No Refresh yet/.test(await page.textContent("#topbar")), "the last Refresh shows");

  // Selection, and Add keywords with a hurried mistake
  await page.click("[data-kwr-select]"); await settle(page, 200); await shot(page, "14-selection");
  await page.click("#kwr-sel-clear"); await settle(page, 150);
  await page.click("#kwr-add"); await settle(page, 300);
  await page.click("#kwr-add-save"); await settle(page, 200); await shot(page, "15-add-empty-error");
  check(/at least one keyword/.test(await page.textContent("#panel")), "an empty Add says what's missing");
  await page.fill("#kwr-add-text", "coffee from the fake tool\nnew keyword two"); await page.keyboard.press("Escape"); await settle(page, 300);
  check(/Draft kept|Reopen/.test(await page.textContent("#toasts")), "Esc in the form keeps a draft");
  await page.click("#kwr-add"); await settle(page, 300);
  check((await page.inputValue("#kwr-add-text")).includes("new keyword two"), "the draft comes back");
  await page.click("#kwr-add-save"); await settle(page, 1200); await shot(page, "16-added");

  // Settings
  await page.goto(`${BASE}?x=1#settings`); await page.waitForSelector(".conn-row", { timeout: 15000 }); await settle(page, 800);
  await page.evaluate(() => document.querySelector('[data-kwr-order]')?.scrollIntoView({ block: "center" })); await settle(page, 200); await shot(page, "17-settings");
  const orderBefore = await page.$$eval("[data-tool-move]", (b) => [...new Set(b.map((x) => x.dataset.tool))]);
  await page.click('[data-kwr-order="bing"]'); await settle(page, 200);
  const list = await page.$$eval("[data-tool-move]", (b) => [...new Set(b.map((x) => x.dataset.tool))]);
  note("   order for Bing:", list.join(", "));
  check(orderBefore.join() !== list.join(), "each engine has its own order");
  await page.click('[data-conn="brightdata"]'); await settle(page, 300); await shot(page, "18-conn-panel");
  check(!/Not built yet/.test(await page.textContent("#panel")), "a tool's panel doesn't say Not built");
  await page.click("#conn-save"); await settle(page, 500);
  check(/Nothing changed/.test(await page.textContent("#toasts")), "Save with nothing typed doesn't claim it saved");
  await page.click('[data-conn="serpapi"]'); await settle(page, 300);
  await page.click("#conn-test"); await settle(page, 500);
  note("   test on a tool:", (await page.textContent("#conn-test-result")).trim().slice(0, 120));
  check(!/Allow paid use/.test(await page.textContent("#panel")), "SerpApi has no pay-as-you-go switch");
  await page.keyboard.press("Escape"); await settle(page, 300);

  // French, dark, narrow
  await page.goto(`${BASE}?y=1#keywords`); await page.waitForSelector("#kw-table", { timeout: 15000 });
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.state.theme = "dark"; window.UI.render(); }); await settle(page, 500);
  await shot(page, "19-fr-dark");
  await page.click("#kwr-refresh"); await page.waitForSelector("#kwr-summary p", { timeout: 8000 }); await settle(page, 400); await shot(page, "20-fr-dark-dialog");
  await page.keyboard.press("Escape"); await settle(page, 200);
  await page.click("[data-kwr-open]"); await page.waitForSelector("#tool-table", { timeout: 8000 }); await settle(page, 400); await shot(page, "21-fr-dark-panel");
  await page.keyboard.press("Escape"); await settle(page, 300);
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.state.theme = "light"; window.UI.render(); });
  await page.setViewportSize({ width: 390, height: 800 }); await settle(page, 500); await shot(page, "22-narrow");
  check(await page.$eval("#kwr-add-small", (b) => b.offsetParent !== null), "Add keywords can be reached at phone width");
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(sideways <= 1, `no sideways scroll at 390 px (${sideways})`);
  await page.setViewportSize({ width: 1024, height: 800 }); await settle(page, 400); await shot(page, "23-1024");
  note("problems:", JSON.stringify(problems.slice(0, 12)));
  check(!problems.length, "no console errors");
  await browser.close();
  note(fails.length ? `FAILED ${fails.length}` : "ALL OK");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
