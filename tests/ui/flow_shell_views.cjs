// The shell, the way a hurried person uses it (fixes of 2026-11-10, agent C): one date range for every dated screen, the view
// kept in the address, Keywords' search and pages, metric definitions, the not-found page, and how few requests a load sends.
// Needs the demo app with Search Console connected for its site and 120 keywords (made-up data only):
//   DB_NAME_TEST=test_fixc_test .venv/bin/python tests/ui/app_server.py --port 8283
//   then connect the fake Google for site-one.example (POST /api/google-connections, PUT /api/sites/1/sources/gsc and ga4,
//   POST /api/sites/1/collect) and upload 110 made-up keywords (POST /api/keywords/upload), as this file's notes did.
// Run: node tests/ui/flow_shell_views.cjs reports/shell-views http://127.0.0.1:8283/
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/shell-views";
const BASE = process.argv[3] || "http://127.0.0.1:8283/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 2000 }).catch(() => "");
  const asked = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search); });
  await page.goto(`${BASE}#overview`);
  await page.evaluate(() => { try { localStorage.removeItem("seocc2-range"); } catch { /* fresh */ } });
  await page.goto(`${BASE}?fresh=${Date.now()}#overview`);
  await page.waitForTimeout(2500);

  await step("one range, everywhere", async () => {
    check((await text("#period")).includes("28"), "the default period is the last 28 days");
    check(/vs /.test(await text("#compare")), "the comparison says its dates");
    await page.click("#period"); await page.waitForTimeout(300);
    await shot("01-picker");
    check(!(await page.locator(".error, .empty h3").filter({ hasText: /isn't a date/ }).count()), "opening the picker shows no date error");
    await page.click('[data-preset="7d"]'); await page.waitForTimeout(1500);
    check(page.url().includes("range=7d"), "the address keeps the period");
    check(asked.some((a) => a.startsWith("/api/search/overview") && a.includes("range=7d")), "Overview asks for 7 days");
    await page.click('[data-go="channels"]'); await page.waitForTimeout(1500);
    check((await text("#period")).includes("7"), "Channels shows the same 7 days");
    check(asked.some((a) => a.startsWith("/api/metrics/channels") && /from=\d{4}-\d\d-\d\d&to=/.test(a)), "Channels asks for dates");
    await page.reload(); await page.waitForTimeout(2000);
    check((await text("#period")).includes("7"), "a reload keeps 7 days");
    await page.click("#compare"); await page.waitForTimeout(200);
    await page.click('[data-compare="none"]'); await page.waitForTimeout(1200);
    check(page.url().includes("cmp=none"), "the comparison goes in the address");
    check((await text("#compare")).length > 0 && !/vs \d/.test(await text("#compare")), "No comparison shows no dates");
  });

  await step("custom dates", async () => {
    await page.click('[data-go="overview"]'); await page.waitForTimeout(1500);
    await page.click("#period"); await page.waitForTimeout(300);
    const days = page.locator(".dp-day:not([disabled])");
    const n = await days.count();
    await days.nth(Math.max(0, n - 20)).click(); await days.nth(Math.max(0, n - 6)).click();
    await page.click("#dp-apply"); await page.waitForTimeout(1800);
    check(/from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d/.test(page.url()), "custom dates go in the address");
    check(!(await page.getByText("isn't a date").count()), "no date error after custom dates");
    check((await page.locator(".ov-card").count()) === 4, "Overview draws its four numbers for custom dates");
    await shot("02-custom");
    // back to the default for what follows
    await page.click("#period"); await page.waitForTimeout(200); await page.click('[data-preset="28d"]'); await page.waitForTimeout(500);
    await page.click("#compare"); await page.waitForTimeout(200); await page.click('[data-compare="prev"]'); await page.waitForTimeout(1200);
  });

  await step("Overview's tab and filter in the address", async () => {
    await page.click('[data-ov-tab="page"]'); await page.waitForTimeout(1200);
    check(page.url().includes("tab=page"), "the Pages tab is in the address");
    await page.fill('[data-ov-f="q"]', "/"); await page.waitForTimeout(1500);
    check(page.url().includes("q=%2F") || page.url().includes("q=/"), "the filter is in the address");
    await page.reload(); await page.waitForTimeout(2500);
    check((await page.getAttribute('[data-ov-tab="page"]', "aria-selected")) === "true", "a reload keeps Pages");
    check((await page.inputValue('[data-ov-f="q"]').catch(() => "")) === "/", "a reload keeps the filter");
    await page.click('[data-ov-tab="query"]'); await page.waitForTimeout(800);
  });

  await step("Keywords: search, pages, an open keyword", async () => {
    await page.click('[data-go="keywords"]'); await page.waitForTimeout(2000);
    // Keywords pages like every long table since 2026-11-10 (table-pages.js): 25 a page to start, its foot and search are TP's.
    const KW_FOOT = '[data-tp-foot="kw"]', KW_SEARCH = '[data-tp-search][data-tp-key="kw"]';
    const rows = await page.locator("#kw-table tbody tr").count();
    const total = Number((await text(`${KW_FOOT} .tp-range`)).replace(/\D+$/, "").split(/\D+/).pop());
    check(total > 100, `the world has over 100 keywords (${total})`);
    check(rows === 25, `one page of 25 rows (saw ${rows})`);
    check((await text(`${KW_FOOT} .tp-range`)).includes(String(total)), "the foot says how many in all");
    await page.click(`${KW_FOOT} .tp-num[data-tp-page="1"]`); await page.waitForTimeout(500);
    check(page.url().includes("page=2"), "page 2 is in the address");
    await page.selectOption(`${KW_FOOT} [data-tp-per]`, "50"); await page.waitForTimeout(500);
    check((await page.locator("#kw-table tbody tr").count()) === 50, "50 per page");
    await page.fill(KW_SEARCH, "lyon"); await page.waitForTimeout(700);
    const found = await page.locator("#kw-table tbody tr").count();
    check(found > 0 && found < 50 && (await page.locator("#kw-table tbody tr").allInnerTexts()).every((r) => /lyon/i.test(r)), `the search keeps only "lyon" (${found})`);
    check(page.url().includes("q=lyon"), "the search is in the address");
    check(await page.evaluate(() => document.activeElement?.matches?.('[data-tp-search][data-tp-key="kw"]')), "the search box keeps the focus while typing");
    await page.click("#kw-table [data-kwr-open]"); await page.waitForTimeout(1200);
    check(page.url().includes("kw="), "the open keyword is in the address");
    check((await page.getAttribute("#panel", "aria-labelledby")) === "panel-title", "the side panel is named after its title");
    await shot("03-keyword-open");
    await page.reload(); await page.waitForTimeout(3000);
    check(Boolean(await page.$("#panel")), "a reload opens the same keyword");
    check((await page.inputValue(KW_SEARCH)) === "lyon", "a reload keeps the search");
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    check(!page.url().includes("kw="), "closing the panel takes it out of the address");
    await page.fill(KW_SEARCH, "zzzz"); await page.waitForTimeout(700);
    check((await text("#page .empty h3")).length > 0 && Boolean(await page.$("[data-kwr-search-clear]")), "a search with nothing says so and offers to clear it");
    await page.click("[data-kwr-search-clear]"); await page.waitForTimeout(500);
    check((await page.locator("#kw-table tbody tr").count()) === 50, "clearing the search brings the rows back");
    await page.click('[data-filter="none"]'); await page.waitForTimeout(500);
    check(page.url().includes("chip=none"), "the chip is in the address");
    await page.click('[data-go="overview"]'); await page.waitForTimeout(1200);
    await page.goBack(); await page.waitForTimeout(1500);
    check(page.url().includes("#keywords") && page.url().includes("chip=none"), "Back returns to Keywords with its chip");
    await page.click('[data-filter="all"]'); await page.waitForTimeout(400);
  });

  await step("definitions one hover or focus away", async () => {
    const icons = await page.locator("#kw-tiles .def-i").count();
    check(icons >= 3, `the Keywords boxes have definitions (${icons})`);
    await page.focus("#kw-tiles .def-i"); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); await page.waitForTimeout(600);
    check(Boolean(await page.$(".tooltip")), "focus shows the definition");
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    check(!(await page.$(".tooltip")), "Esc closes it");
    check(Boolean(await page.$("#panel")) === false, "Esc on a tooltip doesn't close anything else");
    await menu(page, "lang"); await page.waitForTimeout(800);
    await page.hover("#kw-tiles .def-i"); await page.waitForTimeout(700);
    check(/mots-clés|Mots-clés|suivis/i.test(await text(".tooltip")), "the definition is in French too");
    await menu(page, "lang"); await page.waitForTimeout(500);
  });

  await step("a wrong address", async () => {
    const reply = await page.goto(`${BASE}no-such-page`);
    check(reply.status() === 404, "a wrong address answers 404");
    check((await text("h1")).includes("doesn't exist"), "it says the page doesn't exist");
    check(Boolean(await page.$("a#home")), "with a way home");
    await shot("04-not-found");
    const api = await page.goto(`${BASE}api/no-such-thing`);
    check(api.status() === 404 && (await api.json()).error.length > 5, "a wrong API address answers JSON with a sentence");
  });

  await step("requests on one load", async () => {
    for (const route of ["today", "overview", "keywords"]) {
      asked.length = 0;
      await page.goto(`${BASE}?n=${Date.now()}#${route}`); await page.waitForTimeout(4000);
      console.log(`     ${route}: ${asked.length} API requests`);
      check(asked.length <= 30, `${route} sends at most 30 API requests (${asked.length}; 96 on Today before 2026-11-10)`);
      check(asked.filter((a) => a.startsWith("/api/links/sites")).length <= 1, `${route} asks for the site list once`);
    }
  });

  const real = problems.filter((p) => !/auth\/me|status of 404/.test(p));
  check(!real.length, `no script errors (${real.slice(0, 3).join(" | ")})`);
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
