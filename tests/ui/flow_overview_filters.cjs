// Search → Overview filters, by hand: the text box (contains, doesn't contain, exactly, regex) keeps the cursor while it
// redraws, More filters cuts by clicks, impressions and position, Clear filters, a bad regex says so, the Pages tab has
// its own box; and a new search in the bell opens Overview → Queries on that search.
// DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8247, then
// DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_new_queries.py, then node tests/ui/flow_overview_filters.cjs http://127.0.0.1:8247/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8247/";
const OUT = path.resolve("var/ui-overview-filters") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const names = () => page.$$eval(".ov-tabs-card .ov-table tbody .ov-name", (els) => els.map((e) => e.textContent.trim()));
  const settle = async () => { await page.waitForTimeout(450); await page.waitForFunction(() => !document.querySelector(".ov-tabs-card [aria-busy]"), null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(250); };
  const inPage = (fn) => page.evaluate(fn);

  await page.goto(BASE + "#overview");
  await page.waitForSelector("#ov-f-q", { timeout: 15000 });
  await settle();
  const all = await names();
  check("Queries has rows to filter", all.length > 1, all.length);
  await page.screenshot({ path: OUT + "1-queries.png" });

  const fold = (x) => x.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const word = all[0].split(" ")[0];
  await page.click("#ov-f-q");
  await page.keyboard.type(word, { delay: 60 });
  await settle();
  const kept = await names();
  check(`"${word}" keeps only queries that contain it`, kept.length > 0 && kept.every((n) => fold(n).includes(fold(word))), kept.join(" | "));
  check("the cursor stays in the box while it redraws", await inPage(() => document.activeElement?.id === "ov-f-q" && document.activeElement.selectionStart === document.activeElement.value.length));
  await page.screenshot({ path: OUT + "2-contains.png" });

  await page.selectOption("#ov-f-mode", "not");
  await settle();
  const without = await names();
  check("Doesn't contain flips it", without.every((n) => !fold(n).includes(fold(word))), without.join(" | "));

  await page.selectOption("#ov-f-mode", "exact");
  await page.fill("#ov-f-q", all[0].toUpperCase());
  await settle();
  check("Exactly finds one, any case", JSON.stringify(await names()) === JSON.stringify([all[0]]), (await names()).join(" | "));

  await page.selectOption("#ov-f-mode", "regex");
  await page.fill("#ov-f-q", "(");
  await settle();
  check("a broken regex says so", /pattern isn't valid/.test(await page.textContent(".ov-tabs-card")));
  await page.screenshot({ path: OUT + "3-bad-regex.png" });

  await page.click(".ov-tabs-card .empty [data-ov-filter-clear]");
  await settle();
  check("Clear filters brings every row back", (await names()).length === all.length && (await page.inputValue("#ov-f-q")) === "");

  await page.click("[data-ov-more-filters]");
  check("More filters opens the number boxes, first one focused", await inPage(() => document.activeElement?.dataset?.ovF === "min_clicks"));
  await page.fill('[data-ov-f="min_impressions"]', "10");
  await page.keyboard.press("Enter");
  await settle();
  const shownImpr = await page.$$eval(".ov-tabs-card .ov-table tbody tr", (trs) => trs.map((tr) => Number((tr.querySelector('td[data-label="Impressions"]')?.firstChild?.textContent || "").replace(/\D/g, ""))));
  check("Impressions at least 10 drops the small ones", shownImpr.length > 0 && shownImpr.every((n) => n >= 10), shownImpr.join(","));
  check("the button counts the number filter", (await page.textContent("[data-ov-more-filters] .ov-filter-count").catch(() => "")) === "1");
  await page.screenshot({ path: OUT + "4-numbers.png" });
  await page.click(".ov-filter [data-ov-filter-clear]");
  await settle();

  await page.click('[data-ov-tab="page"]');
  await settle();
  check("Pages has its own box", (await page.getAttribute("#ov-f-q", "placeholder")) === "Filter pages");
  await page.click('[data-ov-tab="query"]');
  await settle();

  // The bell
  await page.goto(BASE + "#today");
  await page.waitForSelector("#bell-open", { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.click("#bell-open");
  // New searches come as one row per site and day, each search its own button (since 10 Nov 2026).
  await page.waitForSelector("#bell-pop .bell-group .bell-go");
  const query = (await page.textContent("#bell-pop .bell-group .bell-go span")).trim();
  await page.screenshot({ path: OUT + "5-bell.png" });
  await page.click("#bell-pop .bell-group .bell-go");
  await page.waitForSelector("#ov-f-q", { timeout: 15000 });
  await settle();
  await page.waitForTimeout(600);
  check("the bell opens Overview", (await inPage(() => location.hash)).startsWith("#overview"));
  check("on the Queries tab", (await page.getAttribute('[data-ov-tab="query"]', "aria-selected")) === "true");
  check("filtered to exactly that search", (await page.inputValue("#ov-f-q")) === query && (await page.inputValue("#ov-f-mode")) === "exact", query);
  const shown = await names();
  check("its row is the one shown", shown.length === 1 && shown[0] === query, shown.join(" | "));
  // A new search is often only in days Google hasn't made final; the table then says so (since 2026-11-10).
  const freshNote = await page.locator(".ov-fresh-note").count() ? await page.textContent(".ov-fresh-note") : "";
  check("the table says when it includes days not final yet", /Includes days not final yet \(/.test(freshNote) || !(await inPage(() => /fresh=1/.test(location.hash))), freshNote);
  check("the address keeps that exact search with its fresh days", await inPage(() => /qm=exact/.test(location.hash) && /fresh=1/.test(location.hash)));
  check("the table is in view", await inPage(() => { const r = document.querySelector(".ov-tabs-card").getBoundingClientRect(); return r.top >= -2 && (r.top < innerHeight / 2 || r.bottom <= innerHeight); }));
  check("the bell closed", !(await page.$("#bell-pop")));
  await page.screenshot({ path: OUT + "6-from-bell.png" });

  await page.click("#bell-open");
  await page.waitForSelector("#bell-pop .bell-go");
  const second = (await page.$$eval("#bell-pop .bell-group .bell-go span", (els) => els.map((e) => e.textContent.trim())))[1];
  await page.focus("#bell-pop .bell-group li:nth-of-type(2) .bell-go");
  await page.keyboard.press("Enter");
  await settle();
  await page.waitForTimeout(400);
  check("Enter on a search opens it too", JSON.stringify(await names()) === JSON.stringify([second]) && !(await page.$("#bell-pop")), `${second} → ${(await names()).join(" | ")}`);

  // Expected: the 400 for the broken regex above, and auth/me's 404 when sign-in is off.
  const real = problems.filter((p) => !/status of (400|404)/.test(p));
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
