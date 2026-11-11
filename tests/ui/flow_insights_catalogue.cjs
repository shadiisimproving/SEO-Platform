// Search → Insights, the rest of the catalogue (built 2026-11-09): the Leads, Technical and Did it work tabs and the new
// kinds' rows and panels, driven the way a person uses them, with screenshots to look at.
// Needs the test app with made-up shop-one.test data that sets off every kind, worked out once, which this does:
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/insights_server.py --port 8233 --catalogue   (tests/ui/seed_insights.py)
// Run: node tests/ui/flow_insights_catalogue.cjs reports/insights-catalogue http://127.0.0.1:8233/
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/insights-catalogue";
const BASE = process.argv[3] || "http://127.0.0.1:8233/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900, url: `${BASE}?flow=${Date.now()}#insights` });
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 2000 }).catch(() => "");
  const count = (sel) => page.locator(sel).count();
  const shot = (name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "/")}`); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "shop-one.test"); if (s) { window.UI.state.site = s.id; window.UI.render(); } });
  await page.waitForTimeout(1500);
  const tab = async (id) => { await page.click(`[data-in-tab="${id}"]`); await page.waitForTimeout(900); };
  const rowsText = async () => (await page.locator(".in-table tbody tr").allInnerTexts()).join("\n");
  const openRow = async (kindName) => {
    await page.locator(".in-table tbody tr", { hasText: kindName }).first().click();
    await page.waitForSelector("#panel .panel-body .rows, #panel .panel-body .in-how, #panel .panel-body p", { timeout: 4000 });
    await page.waitForTimeout(500);
  };
  const closePanel = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(450); };

  await step("all eight tabs", async () => {
    const tabs = await page.locator("[data-in-tab]").allInnerTexts();
    check(tabs.length === 8, `eight tabs (${tabs.map((x) => x.split(" ")[0]).join(", ")})`);
  });

  await step("What changed", async () => {
    await tab("changed");
    await shot("01-changed", true);
    const body = await rowsText();
    check(body.includes("Query losing places") && body.includes("blue shoes"), "a query losing places, with its query");
    check(body.includes("Unstable ranking"), "an unstable ranking");
    check(body.includes("Brand hides a loss"), "brand hiding a non-brand loss");
    await openRow("Query losing places");
    await shot("02-query-down-panel");
    check((await text("#panel .in-how")).includes("old position"), "the panel says how its clicks at stake were worked out");
    check((await count("#panel [data-in-track]")) === 1, "it can be tracked as a keyword");
    await closePanel();
  });

  await step("Slow decline", async () => {
    await tab("decline");
    await shot("03-decline", true);
    check((await rowsText()).includes("sliding hats"), "the slow slide is listed");
  });

  await step("Quick wins", async () => {
    await tab("wins");
    await shot("04-wins", true);
    const body = await rowsText();
    for (const name of ["No page of its own", "Near page 1 on many searches", "Topic without a strong page"]) check(body.includes(name), `${name} is listed`);
    check(body.includes("Searches with “umbrella”"), "the topic is named by its word");
    await openRow("Topic without a strong page");
    await shot("05-topic-panel");
    check((await text("#panel")).includes("Its biggest searches"), "the topic lists its biggest searches");
    await closePanel();
    await page.selectOption('[data-tp-foot="in"] [data-tp-per]', "100").catch(() => {}); // pages since 2026-11-10 (table-pages.js), was Show more
    await page.waitForTimeout(500);
    const all = await rowsText();
    check(all.includes("Question searches") && !all.includes("Worth tracking"), "questions are there, and worth tracking moved to Rank and clicks");
  });

  await step("Leads", async () => {
    await tab("leads");
    await shot("06-leads", true);
    const body = await rowsText();
    check(body.includes("Page that brings leads") && body.includes("/blue/"), "the lead page losing clicks is first");
    check(body.includes("Clicks but no leads"), "a page with clicks but no leads");
    await openRow("Page that brings leads");
    await shot("07-lead-panel");
    check(/leads a month/.test(await text("#panel")), "the panel says the leads a month at stake");
    await closePanel();
  });

  await step("Technical", async () => {
    await tab("technical");
    await shot("08-technical", true);
    const body = await rowsText();
    for (const name of ["One page, several addresses", "Shown but broken", "Data gaps"]) check(body.includes(name), `${name} is listed`);
    await openRow("One page, several addresses");
    await shot("09-duplicate-panel");
    check((await count("#panel .rows li")) >= 2 && (await text("#panel")).includes("redirect or a canonical"), "the addresses are listed with the fix");
    await closePanel();
  });

  await step("Did it work", async () => {
    await tab("impact");
    await shot("10-impact", true);
    const body = await rowsText();
    check(body.includes("Rewrote the ski page title"), "the done task is listed by its title");
    check(/result is ready on/.test(body), "a recent task says when its result is ready");
    check(body.includes("Moved to a faster host"), "the dated note is listed");
    await openRow("Rewrote the ski page title");
    await shot("11-task-panel");
    check((await text("#panel")).includes("28 days before"), "the panel shows before and after");
    await closePanel();
  });

  await step("To do first", async () => {
    await tab("first");
    await shot("12-first", true);
    const titles = await page.locator(".in-table tbody tr .t").allTextContents();
    check(titles.length > 0 && new Set(titles).size === titles.length, `each subject once (${titles.length} rows)`);
    check(!(await rowsText()).includes("Worth tracking"), "information rows stay out of To do first");
  });

  await step("French", async () => {
    await menu(page, "lang");
    await page.waitForTimeout(800);
    await tab("wins");
    await shot("13-fr-wins", true);
    const body = await rowsText();
    check(body.includes("Pas de page à elle") && body.includes("Recherches avec « umbrella »"), "the new rows are in French");
    await tab("impact");
    check((await page.locator("[data-in-tab=impact]").innerText()).includes("Ça a marché"), "the tab is in French");
    await menu(page, "lang");
    await page.waitForTimeout(500);
  });

  await step("phone width", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab("technical");
    await page.waitForTimeout(600);
    await shot("14-phone", true);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!wide, "no sideways scroll at phone width");
  });

  const errors = problems.filter((x) => !/status of 404/.test(x)); // the harness's /api/auth/me, counted under failed requests
  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
