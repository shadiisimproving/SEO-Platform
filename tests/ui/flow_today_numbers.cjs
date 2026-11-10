// Today after the review fixes (10 Nov 2026): the number on Today is the one its link opens, the period follows the app's
// one date range, the to-do rows are in French too, links land on what they name, a slow or failing /api/today doesn't
// loop, and a phone has no sideways scroll. Then Insights: first-run state and What to do in a finding's panel.
// DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8281, then node tests/ui/flow_today_numbers.cjs http://127.0.0.1:8281/
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8281/";
const OUT = path.resolve("var/ui-today-numbers") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
const digits = (s) => Number(String(s || "").replace(/[^\d]/g, "")) || null;

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const call = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), BASE + "api/" + p);
  const range = (preset) => page.evaluate((p) => window.UI.range.set({ preset: p }), preset);
  await page.goto(BASE + "#today?site=site-one.example");
  await page.waitForSelector(".today-num", { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "1-today.png", fullPage: true });

  // ---- one number, two screens ----
  const todayClicks = digits(await page.textContent(".today-num:nth-child(3) .fig"));
  const caption = await page.textContent(".today-caption");
  check("the caption names the range and its dates", /Last 28 days/.test(caption) && /–/.test(caption), caption.trim());
  await page.click(".today-num:nth-child(3) .today-num-link");
  await page.waitForTimeout(2500);
  const ovText = await page.textContent("#main");
  check("Google clicks on Today is the number Overview opens with", Boolean(todayClicks) && ovText.replace(/[\s  ,.]/g, "").includes(String(todayClicks)), todayClicks);
  await page.screenshot({ path: OUT + "2-overview.png" });

  // ---- the range follows: 7 days → Today's 7 days ----
  await range("7d");
  await page.waitForTimeout(800);
  const ov7 = await call("search/overview?site_id=1&range=7d&compare=prev");
  await page.goto(BASE + "#today?site=site-one.example"); await page.waitForSelector(".today-num"); await page.waitForTimeout(1500);
  const today7 = digits(await page.textContent(".today-num:nth-child(3) .fig"));
  check("Today follows the app's range: 7 days, the same total as Overview's", today7 === ov7.totals.clicks, `${today7} / ${ov7.totals.clicks}`);
  check("and says so", /Last 7 days/.test(await page.textContent(".today-caption")));
  await range("28d");
  await page.waitForTimeout(800);

  // ---- links land on what they name ----
  const seePage = await page.$("[data-today-page]");
  check("a page drop has See page", Boolean(seePage));
  if (seePage) {
    const wanted = await seePage.getAttribute("data-today-page");
    await seePage.click(); await page.waitForTimeout(1800);
    const filter = await page.evaluate(() => ({ tab: window.OV?.tab, q: window.OV?.filters?.page?.q, route: window.UI.state.route, range: window.UI.range.get().preset }));
    check("See page opens Overview → Pages filtered to that page, over 7 days", filter.route === "overview" && filter.tab === "page" && filter.q === wanted && filter.range === "7d", JSON.stringify(filter));
    await page.screenshot({ path: OUT + "3-see-page.png" });
    await range("28d");
  }
  await page.goto(BASE + "#today?site=site-one.example"); await page.waitForSelector(".today-num"); await page.waitForTimeout(1200);
  const kw = await page.$("[data-today-keyword]");
  if (kw) {
    const q = await kw.getAttribute("data-today-keyword"), id = await kw.getAttribute("data-today-keyword-id");
    await kw.click(); await page.waitForTimeout(1800);
    const where = await page.evaluate(() => ({ route: window.UI.state.route, q: window.OV?.filters?.query?.q, panel: Boolean(document.querySelector("#panel")) }));
    check("a keyword in Going up/down opens that keyword", id ? where.route === "keywords" : where.route === "overview" && where.q === q, JSON.stringify({ q, id, ...where }));
    await page.screenshot({ path: OUT + "3b-keyword.png" });
    await range("28d");
  } else check("a keyword in Going up/down is a link to it", true, "no keyword move in this world");

  // ---- French ----
  await page.goto(BASE + "#today?site=site-one.example"); await page.waitForSelector(".today-num"); await page.waitForTimeout(800);
  await menu(page, "lang"); await page.waitForTimeout(1200);
  const rows = await page.$$eval("[data-row] .t", (els) => els.map((x) => x.textContent.trim()));
  const buttons = await page.$$eval("[data-row] .acts .btn", (els) => els.map((x) => x.textContent.trim()));
  const english = rows.filter((r) => /\b(lost|clicks|stake|no longer|now shows|cites you|health fell)\b/i.test(r));
  check("the to-do rows are in French", english.length === 0, english.join(" | "));
  check("and their buttons", !buttons.some((b) => /^(See why|See page|See it|Open)$/.test(b)), buttons.join(", "));
  await page.screenshot({ path: OUT + "4-today-fr.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  check("390 px phone: no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: OUT + "5-today-phone-fr.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  await menu(page, "lang"); await page.waitForTimeout(500);

  // ---- a slow /api/today: one load at a time, no loop (F5) ----
  let asked = 0;
  await page.route(/\/api\/today/, async (route) => { asked += 1; await new Promise((r) => setTimeout(r, 12000)); await route.continue(); });
  await page.goto("about:blank"); await page.goto(BASE + "#today?site=site-one.example");
  await page.waitForTimeout(30000);
  check("a 12-second answer is asked for twice at most in 30 s", asked <= 2, asked);
  await page.unroute(/\/api\/today/);
  asked = 0;
  await page.route(/\/api\/today/, (route) => { asked += 1; route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server down for the test" }) }); });
  await page.goto("about:blank"); await page.goto(BASE + "#today?site=site-one.example");
  await page.waitForTimeout(6000);
  const atStart = asked;
  await page.waitForTimeout(20000);
  check("a failure is not asked again by itself", asked === atStart && atStart <= 3, `${atStart} while the screen started, ${asked - atStart} after`);
  check("and offers Try again", Boolean(await page.$("[data-today-retry]")));
  await page.screenshot({ path: OUT + "6-today-failed.png" });
  await page.unroute(/\/api\/today/);
  await page.click("[data-today-retry]"); await page.waitForSelector(".today-num", { timeout: 15000 });
  check("Try again brings Today back", Boolean(await page.$(".today-num")));

  // ---- Insights: first run, then a finding's What to do ----
  await page.goto(BASE + "#insights?site=site-one.example"); await page.waitForTimeout(2000);
  const first = await page.textContent("#main"), ran = (await call("insights?site_id=1")).summary?.ran_at;
  check("Insights before any run says Run, not Run again", ran ? /Run again/.test(first) : /\bRun\b/.test(first) && !/Run again/.test(first), ran ? "already ran" : "never ran");
  await page.screenshot({ path: OUT + "7-insights-first.png" });
  await page.evaluate((u) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site_id: 1 }) }), BASE + "api/insights/run");
  await page.goto("about:blank"); await page.goto(BASE + "#insights?site=site-one.example"); await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + "8-insights.png", fullPage: true });
  const open1 = await page.$("tr[data-in-open]");
  if (open1) {
    await open1.click(); await page.waitForTimeout(1500);
    check("a finding's panel says what to do", /What to do/.test(await page.textContent("#panel")));
    await page.screenshot({ path: OUT + "9-insight-panel.png" });
    await page.keyboard.press("Escape");
  } else check("Insights has findings to open", false, "none in this world");
  check("Insights names the site's target countries with Change", Boolean(await page.$("[data-in-countries]")));

  const real = problems.filter((p) => !/Failed to load resource|api\/auth\/me|500/.test(p));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
