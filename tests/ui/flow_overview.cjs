// Search → Overview the way a person uses it, with screenshots to look at (redesign of 2026-11-09).
// Needs the real app on the fake internet, with Search Console connected for site-one.example:
//   DB_NAME_TEST=test_overview_ui_test .venv/bin/python tests/ui/app_server.py --port 8231
//   then connect it once (Settings, or the two INSERTs in the plan's notes) and press Refresh data.
// Run: node tests/ui/flow_overview.cjs reports/overview-2026-11-09 http://127.0.0.1:8231/
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/overview-redesign";
const BASE = process.argv[3] || "http://127.0.0.1:8231/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900, url: `${BASE}?flow=${Date.now()}#overview` });
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 1500 }).catch(() => "");
  const value = (sel) => page.locator(sel).first().inputValue({ timeout: 1500 }).catch(() => "");
  const texts = (sel) => page.locator(sel).allTextContents();
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "/")}`); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "site-one.example"); window.UI.state.site = s.id; window.UI.render(); });
  await page.waitForTimeout(2000);

  await step("top of the page", async () => {
    await shot("01-overview");
    check((await text(".ov-trust")).includes("Search Console"), "the trust line says where the numbers come from");
    // Since 2026-11-12 the line on top says only what the cards don't: who drove the change (rows), or nothing.
    const answer = await text(".ov-answer");
    check(!/^Clicks\b/m.test(answer) && !/\d → \d/.test(answer.split("\n")[0] || ""), "the line on top doesn't repeat the Clicks card");
    check((await page.locator(".ov-card").count()) === 4, "four numbers");
    check((await page.locator(".ov-card[aria-pressed=true]").count()) === 2, "clicks and impressions are on the chart at first");
    const before = await page.locator(".ov-chart path.lv-line").count();
    await page.click('[data-ov-line="position"]'); await page.waitForTimeout(400);
    check((await page.locator(".ov-chart path.lv-line").count()) > before, "pressing Average position adds its line");
    await page.click('[data-ov-line="position"]'); await page.waitForTimeout(300);
    const box = await page.locator(".ov-chart svg").first().boundingBox(); // one strip per number since 2026-11-12
    await page.mouse.move(box.x + box.width * 0.6, box.y + 60); await page.waitForTimeout(200);
    check((await text(".ov-chart .lv-tip")).includes("Clicks"), "hovering the chart reads the day out");
    await shot("02-hover");
  });

  await step("track one query from its row", async () => {
    await page.locator(".ov-tabs-card").scrollIntoViewIfNeeded();
    const row = page.locator(".ov-row:has([data-ov-track])").first();
    const name = (await row.locator(".ov-name").innerText()).trim();
    await row.hover();
    await row.locator("[data-ov-track]").click(); await page.waitForTimeout(500);
    check((await value("#kwr-add-text")) === name, "the add-keywords panel opens with the query in it");
    await shot("03-track-panel");
    await page.click("#kwr-add-save"); await page.waitForTimeout(2500);
    const tracked = await page.locator(".ov-row", { hasText: name }).locator(".ov-tracked").count();
    check(tracked === 1, `"${name}" now says Tracked`);
  });

  await step("track three at once, then Esc half way", async () => {
    // A database reused across runs has fewer untracked queries left, so it picks what there is (tracked rows can't be picked).
    const free = Math.min(3, await page.locator("[data-ov-pick]:not([disabled])").count());
    if (free < 2) { console.log("skip bulk Track: fewer than 2 untracked queries left in this database"); return; }
    for (let i = 0; i < free; i++) { await page.locator("[data-ov-pick]:not([disabled]):not(:checked)").first().click(); await page.waitForTimeout(250); }
    check((await text(".ov-selbar")).startsWith(String(free)), `the bar says ${free} queries picked`);
    await page.click("[data-ov-track-picked]"); await page.waitForTimeout(500);
    check((await value("#kwr-add-text")).split("\n").length === free, "they're all in the panel, one per line");
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
    check((await page.locator("#panel:not(.closing)").count()) === 0, "Esc closes the panel");
    await page.click("[data-ov-pick-clear]"); await page.waitForTimeout(300);
  });

  await step("open a query", async () => {
    await page.locator(".ov-row td.ov-n").first().click(); await page.waitForTimeout(1800); // not the name: a query is a keyword link
    const panel = await text("#panel");
    check(panel.includes("Pages") && panel.includes("Countries"), "the panel shows its pages and countries");
    await shot("04-query-panel");
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  });

  await step("a note on the chart", async () => {
    await page.locator(".ov-chart-card").scrollIntoViewIfNeeded();
    const before = await page.locator(".ov-marks li").count();
    await page.click("[data-ov-note-add]"); await page.waitForTimeout(300);
    await page.click("[data-ov-note-save]"); await page.waitForTimeout(500);
    check((await text("#ov-note-error")).length > 0, "an empty note is refused with a reason");
    await page.fill("#ov-note-form [name=f_text]", "New titles on the main page");
    await page.click("[data-ov-note-save]"); await page.waitForTimeout(2500);
    check((await page.locator(".ov-marks li").count()) === before + 1, "the note shows under the chart, and the page didn't stay on Loading");
    await page.locator(".ov-marks li", { hasText: "New titles on the main page" }).locator("[data-ov-note-del]").click(); await page.waitForTimeout(2000);
    check((await page.locator(".ov-marks li").count()) === before, "× deletes it, so the test leaves nothing behind");
  });

  await step("brand words and the Brand switch", async () => {
    await page.locator(".ov-tabs-card").scrollIntoViewIfNeeded();
    await page.click("[data-ov-brand-edit]"); await page.waitForTimeout(700);
    await page.fill("#ov-brand-form [name=f_word]", `brand${Date.now() % 1000}`);
    await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
    await page.keyboard.press("Escape"); await page.waitForTimeout(1500);
    check((await page.locator('[data-ov-brand="non_brand"]').count()) === 1, "Brand / Non-brand appears once a brand word exists");
  });

  await step("Show, tabs and opportunities", async () => {
    await page.selectOption("[data-ov-show]", "losing"); await page.waitForTimeout(1500);
    check((await text("[data-ov-show]")).length > 0, "the Show list keeps counts");
    for (const tab of ["page", "country", "device", "opportunities"]) {
      await page.click(`[data-ov-tab="${tab}"]`); await page.waitForTimeout(1300);
      check((await page.locator(".ov-tabs-card .table-wrap, .ov-tabs-card .empty").count()) > 0, `${tab} tab shows a table or says why not`);
    }
    for (const kind of ["almost", "low_ctr", "compete", "lost"]) {
      await page.selectOption("[data-ov-opp]", kind); await page.waitForTimeout(1200);
      await shot(`05-opportunity-${kind}`);
    }
    await page.click('[data-ov-tab="query"]'); await page.waitForTimeout(1000);
  });

  await step("ranges like Search Console", async () => {
    // Since 2026-11-10 the dates are the app's one picker in the top bar (UI.range), not Overview's own boxes.
    const pick = async (preset) => { await page.click("#period"); await page.waitForTimeout(250); await page.click(`[data-preset="${preset}"]`); await page.waitForTimeout(2500); };
    await page.click("#period"); await page.waitForTimeout(250);
    // By id: with the simpler screens on (?simple=1) four of them are buttons in the head and the menu holds the rest.
    const wanted = ["24h", "7d", "28d", "3m", "6m", "12m", "16m"];
    const shown = await page.evaluate(() => [...document.querySelectorAll(".dp-presets [data-preset], .head-period [data-preset]")].map((b) => b.dataset.preset));
    check(wanted.every((w) => shown.includes(w)) && Boolean(await page.$("#dp-from")), `the same ranges as Search Console, and custom dates (${shown.join(", ")})`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    await pick("6m");
    check((await text(".ov-chart-card h2")) === "Week by week", "6 months is drawn week by week");
    await pick("24h");
    check((await text(".ov-chart-card h2")) === "Hour by hour", "24 hours is hour by hour");
    await shot("06-24-hours");
    await pick("28d");
    await page.click("#compare"); await page.waitForTimeout(200); await page.click('[data-compare="none"]'); await page.waitForTimeout(2000);
    check((await page.locator('#ov-show option[value="gaining"], [data-ov-show] option[value="gaining"]').count()) === 0, "with no comparison, Gaining and Losing go away");
    await page.click("#compare"); await page.waitForTimeout(200); await page.click('[data-compare="prev"]'); await page.waitForTimeout(1500);
  });

  await step("French, dark, phone", async () => {
    await menu(page, "lang"); await page.waitForTimeout(800);
    await menu(page, "theme"); await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelector(".content")?.scrollTo(0, 0));
    const said = await text(".ov-answer");
    check(!said || /clics/i.test(said), "the line on top is in French");
    await shot("07-french-dark");
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1200);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll on a phone");
    await shot("08-phone");
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(600);
    await menu(page, "lang"); await page.waitForTimeout(300); await menu(page, "theme");
  });

  // The empty note is refused on purpose (400), and /api/auth/me is 404 when login is off. Anything else is a bug.
  const unexpected = failed.filter((f) => !/^400 POST \/api\/search\/notes/.test(f) && !f.includes("/api/auth/me"));
  check(!unexpected.length, `no failed requests${unexpected.length ? `: ${unexpected.join(" | ")}` : ""}`);
  const errors = problems.filter((p) => p.startsWith("pageerror"));
  check(!errors.length, `no script errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
