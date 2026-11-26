/* The new side menu (new-menu.js, ?new=1): nine areas, area tabs, the three Competitors tabs that moved, old addresses,
   and the switch off leaving the old menu exactly as it was.
   Run against tests/ui/app_server.py: BASE=http://127.0.0.1:8331 node tests/ui/flow_new_menu.cjs */
const assert = require("assert");
const { open } = require("./pw.cjs");
const BASE = process.env.BASE || "http://127.0.0.1:8210";
(async () => {
  const { browser, page } = await open({ url: `${BASE}/?new=1&simple=1` });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.waitForSelector('#sidebar [data-area="today"]');
  const lit = () => page.$eval("#sidebar [aria-current=page]", (e) => e.dataset.area).catch(() => null);
  const tabs = () => page.$$eval(".area-tabs .page-tab", (els) => els.map((e) => (e.getAttribute("aria-current") ? "*" : "") + e.textContent.trim()));
  const areas = await page.$$eval("#sidebar .nav-item[data-area]", (els) => els.map((e) => e.dataset.area));
  assert.deepStrictEqual(areas, ["today", "traffic", "search", "keywords", "pages", "competitors", "links", "ai", "work"]);
  const want = { traffic: ["*Channels", "Leads"], search: ["*Overview", "Insights"], keywords: ["*Positions", "Check any keyword", "AI Overview watch"], pages: ["*Pages", "Content", "Site map", "Site health"], links: ["*Backlinks", "Link gaps"], work: ["*Tasks", "Notes", "Resources", "Social"], competitors: [], ai: [] };
  for (const [a, t] of Object.entries(want)) {
    await page.click(`#sidebar [data-area="${a}"]`);
    await page.waitForFunction((x) => document.querySelector("#sidebar [aria-current=page]")?.dataset.area === x, a);
    await page.waitForTimeout(400);
    assert.deepStrictEqual(await tabs(), t, `tabs of ${a}`);
  }
  // A tab that moved out of Competitors: its area stays lit, it carries the area's name, and Competitors' own row is gone.
  await page.click('#sidebar [data-area="keywords"]');
  await page.click('.area-tabs [data-nm-comp="check"]');
  await page.waitForFunction(() => location.hash.startsWith("#competitors/check"));
  await page.waitForTimeout(1200);
  assert.strictEqual(await lit(), "keywords");
  assert.strictEqual(await page.$eval("#topbar h1", (e) => e.textContent.trim()), "Keywords");
  assert.strictEqual(await page.$$eval(".comp-tabs", (e) => e.length), 0);
  await page.click('#sidebar [data-area="links"]');
  await page.click('.area-tabs [data-nm-comp="gaps"]');
  await page.waitForFunction(() => location.hash.startsWith("#competitors/gaps"));
  await page.waitForTimeout(1200);
  assert.strictEqual(await lit(), "links");
  await page.click('#sidebar [data-area="competitors"]');
  await page.waitForFunction(() => location.hash.startsWith("#competitors/summary"));
  await page.waitForTimeout(1200);
  const row = await page.$$eval(".comp-tabs .page-tab, .comp-tabs .tab", (els) => els.map((e) => e.textContent.trim()));
  assert.ok(!row.some((x) => /Keyword check|Link gaps|AI Overview watch/.test(x)), `moved tabs left Competitors: ${row}`);
  // An old address opens in its new area.
  await page.goto(`${BASE}/#health/links`); await page.waitForTimeout(2000);
  assert.strictEqual(await lit(), "pages");
  // The new look (Cobalt, data-brand ocean) comes with the new menu: Today's three number cards pick the big chart, and Do these first sits beside it.
  await page.goto(`${BASE}/?new=1&simple=1#today`); await page.waitForTimeout(3000);
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.brand), "ocean");
  assert.ok((await page.$$eval(".cb-kpi", (e) => e.length)) >= 3, "the number cards");
  assert.ok(await page.$("#cb-hero .cb-plot svg rect"), "the big chart has bars");
  assert.ok(await page.$("#cb-todo"), "Do these first is drawn");
  await page.click('[data-cb-metric="visits"]'); await page.waitForTimeout(300);
  assert.match(await page.$eval("#cb-hero h2", (e) => e.textContent), /Visits/);
  assert.strictEqual(await page.$eval('[data-cb-metric="visits"]', (e) => e.getAttribute("aria-pressed")), "true");
  // ?brand=0: the old look and the old Today layout.
  await page.goto(`${BASE}/?new=1&brand=0&simple=1#today`); await page.waitForTimeout(2500);
  assert.strictEqual(await page.$$eval(".cb-kpi", (e) => e.length), 0);
  await page.goto(`${BASE}/?brand=ocean`); await page.waitForTimeout(500);
  // The way back: the account menu switches to the old design and back, and it stays after a reload.
  await page.goto(`${BASE}/?new=1&brand=ocean&simple=1#today`); await page.waitForTimeout(2500);
  await page.click("#acct-btn"); await page.click('#popover [data-design="old"]');
  await page.waitForLoadState("load"); await page.waitForTimeout(2500);
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.newmenu || ""), "");
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.brand || ""), "");
  assert.strictEqual(await page.$$eval(".cb-kpi", (e) => e.length), 0);
  await page.reload(); await page.waitForTimeout(2500);
  assert.strictEqual(await page.$$eval(".cb-kpi", (e) => e.length), 0, "the old design stays after a reload");
  await page.click("#acct-btn"); await page.click('#popover [data-design="new"]');
  await page.waitForLoadState("load"); await page.waitForTimeout(3000);
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.brand), "ocean");
  assert.ok((await page.$$eval(".cb-kpi", (e) => e.length)) >= 3, "the new design is back");
  // Switched off: the old menu, all seven Competitors tabs, no area tabs.
  await page.goto(`${BASE}/?new=0&simple=1#competitors/summary?site=site-one.example`); await page.waitForTimeout(2500);
  assert.strictEqual(await page.$$eval("#sidebar .nav-item[data-area]", (e) => e.length), 0);
  assert.strictEqual(await page.$$eval(".area-tabs", (e) => e.length), 0);
  assert.strictEqual((await page.$$eval(".comp-tabs .page-tab, .comp-tabs .tab", (els) => els.length)), 7);
  assert.deepStrictEqual(errs, []);
  console.log("flow_new_menu: all checks passed");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
