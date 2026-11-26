// The new design (Cobalt, html[data-brand="ocean"]) on the Keywords and Pages areas: each screen draws its new top
// (number cards, ladder, moves, split bars, problem bars) with ?new=1&brand=ocean&simple=1, with no page error, and with
// ?new=0&brand=0 the old screens come back with none of it (ocean-keywords-pages.js, look-ocean-keywords-pages.css).
//   DB_NAME_TEST=test_cb2_test DB_POOL_SIZE=2 DB_MAX_OVERFLOW=6 .venv/bin/python tests/ui/app_server.py --port 8342
//   node tests/ui/flow_ocean_keywords_pages.cjs http://127.0.0.1:8342/ [folder for screenshots]
const base = process.argv[2] || "http://127.0.0.1:8342/";
const shots = process.argv[3] || "/tmp";
const { open } = require("./pw.cjs");
let failed = 0;
const check = (ok, words) => { console.log(`${ok ? "ok  " : "FAIL"} ${words}`); if (!ok) failed += 1; };
const has = (page, sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
async function waitFor(page, sel, ms = 20000) { try { await page.waitForSelector(sel, { timeout: ms }); return true; } catch { return false; } }

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  await page.goto(`${base}?new=1&brand=ocean&simple=1#today`);
  await page.waitForTimeout(1500);
  const site = await page.evaluate(() => (window.SITES || []).find((s) => s.realId)?.host || "");
  check(Boolean(site), `a site to look at (${site})`);
  const q = `?site=${encodeURIComponent(site)}`;
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(1200); };
  check(await page.evaluate(() => document.documentElement.dataset.brand === "ocean"), "the new design is on");

  // Keywords: four number cards, the position ladder and the biggest moves, then the table as before.
  await go(`#keywords${q}`);
  check(await waitFor(page, "#okp-ladder"), "Keywords: the position ladder");
  check(await has(page, "#okp-moves"), "Keywords: the biggest moves");
  check(await count(page, "#kw-tiles.okp-kpis .okp-kpi") >= 3, "Keywords: the number cards");
  check(await waitFor(page, "#kw-table"), "Keywords: the table is still there");
  check(await has(page, "[data-filter]") && await has(page, "#kw-filter") && await has(page, "#kwr-refresh"), "Keywords: chips, Filter and Refresh are still there");
  await page.screenshot({ path: `${shots}/ocean-keywords.png` });
  await page.click('[data-view="bucket"]'); await page.waitForTimeout(1200);
  check(!(await has(page, "#okp-ladder")) && await has(page, "[data-view='bucket'][aria-pressed='true']"), "Keywords: By bucket keeps its own view");
  await page.click('[data-view="positions"]'); await page.waitForTimeout(800);

  // Pages: number cards that filter, the pages moving most, the same chips and table.
  await go(`#pages${q}`);
  check(await waitFor(page, ".okp-pg-kpis"), "Pages: the number cards");
  check(await has(page, ".pg-counts") && await has(page, "#pg-table"), "Pages: the chips and table are still there");
  await page.click('.okp-pg-kpis [data-pg-filter="noindex"]'); await page.waitForTimeout(800);
  check(await has(page, '.pg-counts [data-pg-filter="noindex"][aria-pressed="true"]'), "Pages: a number card filters the table");
  await page.screenshot({ path: `${shots}/ocean-pages.png` });

  // Content: its own screen, with the new top on All pages once it has pages.
  await go(`#content${q}`);
  await page.waitForTimeout(2500);
  const pagesRows = await count(page, "table.data tbody tr");
  check(pagesRows === 0 || await has(page, ".okp-content-top"), `Content: the new top on All pages (${pagesRows} rows)`);
  await page.screenshot({ path: `${shots}/ocean-content.png` });

  // Site map: the numbers and where the pages sit, above the map.
  await go(`#map${q}`);
  check(await waitFor(page, ".okp-sm-row"), "Site map: the numbers above the map");
  check(await waitFor(page, "[data-sm-root] .sm-head"), "Site map: the map's toolbar is still there");
  await page.screenshot({ path: `${shots}/ocean-map.png` });

  // Site health: number cards and problem bars, the Links checker and Uptime.
  await go(`#health/test${q}`);
  await waitFor(page, "#okp-ht-kpis, .ht-score, #ht-empty", 20000);
  check(await has(page, "#okp-ht-kpis") && await has(page, "#okp-ht-bars") && await has(page, "#ht-run"), "Health test: number cards, problem bars and Refresh");
  if (await has(page, "[data-okp-check]")) {
    const code = await page.evaluate(() => document.querySelector("[data-okp-check]").dataset.okpCheck);
    await page.click("[data-okp-check]"); await page.waitForTimeout(600);
    check(await page.evaluate((c) => document.querySelector(`details.ht-check[data-ht-check="${c}"]`)?.open === true, code), "Health test: a problem bar opens its check");
  }
  await page.screenshot({ path: `${shots}/ocean-health.png` });
  await go(`#health/uptime${q}`);
  check(await waitFor(page, ".okp-up-kpis"), "Uptime: the number cards");
  await go(`#health/links${q}`);
  await waitFor(page, ".lc-tiles, #lc-run", 20000);
  check(!(await has(page, ".lc-tiles")) || await waitFor(page, ".lc-tiles[data-okp]", 5000), "Links checker: its counts are decorated");

  // A phone: no sideways scroll on any of them.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const h of ["#keywords", "#pages", "#content", "#map", "#health/test"]) {
    await go(`${h}${q}`); await page.waitForTimeout(1200);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!wide, `${h}: no sideways scroll on a phone`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // The old design: none of the new parts.
  await page.goto(`${base}?new=0&brand=0&simple=1#keywords${q}`);
  await waitFor(page, "#kw-table");
  check(await page.evaluate(() => !document.documentElement.dataset.brand), "old design: the new look is off");
  check(!(await has(page, "[class*='okp-'], [id^='okp-']")) && await has(page, "#kw-tiles.tiles"), "old design: Keywords as before");
  for (const h of ["#pages", "#content", "#map", "#health/test", "#health/uptime", "#health/links"]) {
    await go(`${h}${q}`); await page.waitForTimeout(2000);
    check(!(await has(page, "[class*='okp-'], [id^='okp-'], [data-okp]")), `old design: ${h} as before`);
  }
  await page.screenshot({ path: `${shots}/old-health.png` });

  const errors = problems.filter((p) => p.startsWith("pageerror"));
  check(!errors.length, `no page errors${errors.length ? ` (${errors.join(" | ")})` : ""}`);
  await browser.close();
  console.log(failed ? `${failed} FAILED` : "ALL OK");
  process.exit(failed ? 1 : 0);
})();
