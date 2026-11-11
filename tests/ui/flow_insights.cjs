// Search → Insights the way a person uses it, with screenshots to look at (built 2026-11-09).
// Needs the test app with made-up Search Console days for shop-one.test and insights worked out once, which this does:
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/insights_server.py --port 8231   (seeds with tests/ui/seed_insights.py)
// Run: node tests/ui/flow_insights.cjs reports/insights http://127.0.0.1:8231/
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/insights";
const BASE = process.argv[3] || "http://127.0.0.1:8231/";
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
  // The harness runs without sign-in, so /api/auth/me answers 404 on every screen: not this one's doing.
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "/")}`); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "shop-one.test"); if (s) { window.UI.state.site = s.id; window.UI.render(); } });
  await page.waitForTimeout(1500);

  await step("top of the page", async () => {
    await shot("01-insights", true);
    check((await text(".in-answer")).match(/Clicks (fell|rose|are steady)/) !== null, "a sentence says why clicks moved");
    check((await count(".in-bar-row")) >= 2, "the parts of the change are listed");
    check((await count(".in-fig")) === 3, "three numbers");
    const rows = await page.locator(".in-table tbody tr").count();
    check(rows > 0 && rows <= 15, `To do first has rows (${rows})`);
    const titles = await page.locator(".in-table tbody tr .t").allTextContents();
    check(new Set(titles).size === titles.length, "each query or page shows once in To do first");
    const stakes = (await page.locator(".in-table tbody tr td.in-stake-col").allTextContents()).map((x) => Number(x.replace(/[^\d]/g, "")) || 0);
    check(stakes.every((v, i) => i === 0 || v <= stakes[i - 1]), "ranked by clicks at stake");
  });

  await step("tabs", async () => {
    for (const [id, name] of [["changed", "02-what-changed"], ["decline", "03-slow-decline"], ["wins", "04-quick-wins"]]) {
      await page.click(`[data-in-tab="${id}"]`);
      await page.waitForTimeout(900);
      await shot(name, true);
      check((await page.locator(`[data-in-tab="${id}"]`).getAttribute("aria-selected")) === "true", `${id} tab is picked`);
    }
    check((await text(".in-need")).includes("brand words"), "Quick wins says low click rates need brand words");
  });

  await step("one finding", async () => {
    await page.click('[data-in-tab="first"]');
    await page.waitForTimeout(800);
    await page.locator(".in-table tbody tr:not(:has(.in-task))").first().click();
    await page.waitForSelector("#panel .in-stake", { timeout: 4000 });
    await page.waitForTimeout(400);
    await shot("05-panel");
    check((await count("#panel .in-spark svg")) >= 1, "the panel has a chart");
    check((await text("#panel .in-how")).length > 20, "the panel says how clicks at stake were worked out");
    check((await count("#panel [data-in-task]")) === 1, "Create a task is there");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    check((await count("#panel")) === 0, "Esc closes the panel");
  });

  await step("not useful, then back", async () => {
    const first = await page.locator(".in-table tbody tr .t").first().innerText();
    await page.locator(".in-table tbody tr").first().click();
    await page.waitForSelector("#panel [data-in-dismiss]", { timeout: 4000 });
    await page.click("#panel [data-in-dismiss]");
    await page.waitForTimeout(700);
    const now = await page.locator(".in-table tbody tr .t").allTextContents();
    console.log("     first was:", first, "| now:", now.slice(0, 3).join(" / "));
    check(!now.includes(first), "a finding marked not useful leaves the list");
    await page.selectOption("[data-in-status]", "dismissed");
    await page.waitForTimeout(1000);
    check((await page.locator(".in-table tbody tr .t").allTextContents()).includes(first), "it shows under Not useful");
    await shot("06-not-useful");
    await page.locator(".in-table tbody tr").first().click();
    await page.waitForSelector("#panel [data-in-undismiss]", { timeout: 4000 });
    await page.click("#panel [data-in-undismiss]");
    await page.waitForTimeout(1000);
    await page.selectOption("[data-in-status]", "open");
    await page.waitForTimeout(1000);
    check((await page.locator(".in-table tbody tr .t").allTextContents()).includes(first), "Bring it back puts it in the open list again");
  });

  await step("the change breakdown", async () => {
    await page.click(".in-see[data-in-open]");
    await page.waitForSelector("#panel .ov-split", { timeout: 4000 });
    await page.waitForTimeout(400);
    await shot("07-change-panel");
    check((await count("#panel .ov-h3")) >= 1, "it lists the queries behind each part");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  });

  await step("create a task", async () => {
    await page.locator(".in-table tbody tr:not(:has(.in-task))").first().click();
    await page.waitForSelector("#panel [data-in-task]", { timeout: 4000 });
    await page.click("#panel [data-in-task]");
    await page.waitForTimeout(800);
    await shot("08-task-form");
    const title = await page.locator("#task-title").inputValue().catch(() => "");
    check(title.length > 3, `the task form is filled in (${title})`);
    const save = page.locator('#task-form button[type="submit"], #panel button[form="task-form"], #panel .panel-foot .btn-main').first();
    await save.click();
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}?flow=${Date.now()}b#insights`);
    await page.waitForTimeout(2500);
    check((await count(".in-table .in-task")) >= 1, "the finding shows its open task");
  });

  await step("Today", async () => {
    await page.goto(`${BASE}?flow=${Date.now()}c#today`);
    await page.waitForTimeout(3000);
    await shot("09-today", true);
    const body = await page.locator("main").innerText();
    check(/clicks a month at stake/.test(body), "Today lists insights with clicks at stake");
  });

  await step("French and dark", async () => {
    await page.goto(`${BASE}?flow=${Date.now()}d#insights`);
    await page.waitForTimeout(2000);
    await menu(page, "lang");
    await page.waitForTimeout(500);
    await menu(page, "theme");
    await page.waitForTimeout(1200);
    await shot("10-fr-dark", true);
    check((await text(".topbar h1, h1")).includes("Analyses"), "the title is in French");
    check((await text(".in-answer")).match(/Les clics/) !== null, "the sentence is in French");
  });

  await step("phone width", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await shot("11-phone", true);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!wide, "no sideways scroll at phone width");
  });

  const real = problems.filter((p) => !p.includes("404 (NOT FOUND)"));
  check(real.length === 0, `no script errors${real.length ? `: ${real.slice(0, 3).join(" | ")}` : ""}`);
  check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
