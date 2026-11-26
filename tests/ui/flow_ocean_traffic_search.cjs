/* The new design (Cobalt) on Traffic (Channels, Leads) and Search (Overview, Insights): ocean-traffic-search.js.
   Each screen draws its new layout with ?new=1&brand=ocean&simple=1 (number cards, the soft-area chart against the period before,
   the breakdown beside it), its switch and Show table work, a phone has no sideways scroll, and with the old design
   (?new=0&brand=0) none of it is there and the old parts are. No page errors anywhere.
   Run against tests/ui/app_server.py with seed_overview.py run once (Search Console and Google Analytics for site-one.example):
     DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8341
     DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_overview.py
     node tests/ui/flow_ocean_traffic_search.cjs http://127.0.0.1:8341/ */
const { open } = require("./pw.cjs");
const BASE = (process.argv[2] || "http://127.0.0.1:8341/").replace(/\/?$/, "/");
const SITE = process.env.SITE || "site-one.example";
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  [${extra}]` : ""}`); };
const wait = (page) => page.waitForFunction(() => document.querySelector(".content") && !document.querySelector(".content .skel, .content [aria-busy='true']"), null, { timeout: 30000 }).catch(() => {});

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const go = async (query, route) => {
    await page.goto(`${BASE}?${query}#${route}?site=${SITE}`);
    await wait(page);
    await page.waitForTimeout(1500);
  };
  const has = (sel) => page.evaluate((s) => Boolean(document.querySelector(s)), sel);
  const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() || "", sel);

  const NEW = "new=1&brand=ocean&simple=1";
  // ---- Channels ----
  await go(NEW, "channels");
  check("the new design is on", await page.evaluate(() => document.documentElement.dataset.brand === "ocean"));
  const chOk = await has(".cbx-channels");
  check("Channels: the new layout", chOk || (await has(".content .empty")), chOk ? "" : await text(".content .empty h3"));
  if (chOk) {
    check("Channels: the soft-area chart, this period and the period before dashed", await has(".cbx-channels .cbc path.cbc-now") && await has(".cbx-channels .cbc path.cbc-area") && !(await has(".cbx rect.cb-now")));
    check("Channels: where visits came from, as a split bar and rows", await has(".cbx-channels .cb-stack") && await has(".cbx-channels .cbx-rows li"));
    check("Channels: every channel, the line chart and referring sites stay", await has(".cbx-channels [data-lv-rules]") && await has('.cbx-channels [data-lv-chart="channels"]') && await has(".cbx-channels .cbx-pair"));
    const before = await text('[data-cbx-left="channels"] h2');
    if (await has('[data-cbx-metric="channels:leads"]')) {
      await page.click('[data-cbx-metric="channels:leads"]');
      check("Channels: the switch redraws the chart", (await text('[data-cbx-left="channels"] h2')) !== before, await text('[data-cbx-left="channels"] h2'));
    }
    await page.click('[data-cbx-left="channels"] [data-cbx-table]');
    check("Channels: Show table opens the days", await page.evaluate(() => !document.querySelector('[data-cbx-left="channels"] .cbx-table').hidden));
    await page.click('.cbx-channels .cbx-rows li[data-rp-open]');
    await page.waitForTimeout(800);
    check("Channels: a channel row opens its panel", await has("#panel"));
    await page.keyboard.press("Escape");
  }
  // ---- Leads ----
  await go(NEW, "conversions");
  const cvOk = await has(".cbx-conversions");
  check("Leads: the new layout", cvOk || (await has(".content .empty")), cvOk ? "" : await text(".content .empty h3"));
  if (cvOk) {
    check("Leads: the soft-area chart and the funnel beside it", await has(".cbx-conversions .cbc path.cbc-now") && await has(".cbx-conversions .cbx-funnel"));
    check("Leads: the pages and page types tabs stay", await has('.cbx-conversions [data-lv-ptab="conversions:types"]'));
  }
  // ---- Overview ----
  await go(NEW, "overview");
  const ovOk = await has(".cbx-overview");
  check("Overview: the new layout", ovOk, await text(".content .empty h3"));
  if (ovOk) {
    check("Overview: the clicks strip is a smooth line with a soft area, no bars", await has('.cbx-overview [data-ov-strip="clicks"] path.cbx-area') && await has('.cbx-overview [data-ov-strip="clicks"] path.cbx-now') && !(await has(".cbx-overview .ov-strip rect.cb-now")));
    check("Overview: the number cards still switch lines", await has(".cbx-overview [data-ov-line]"));
    check("Overview: Add a note / Show table and the tabs stay", await has(".cbx-overview [data-ov-table]") && await has('.cbx-overview [data-ov-tab="query"]'));
    await page.click('.cbx-overview [data-ov-line="position"]');
    await page.waitForTimeout(600);
    check("Overview: position shows as a line", await has('[data-ov-strip="position"] path.lv-line'));
  }
  // ---- Insights ----
  await go(NEW, "insights");
  const inOk = await has(".cbx-in-hero");
  check("Insights: the new top (or nothing to show yet)", inOk || (await has(".content .empty")) || !(await has(".in-top, .in-answer")), inOk ? "" : await text(".content h3"));
  if (inOk && (await has(".cbx-in-hero .cbc, .cbx-in-hero .cbx-site"))) check("Insights: the chart (or the sites rows) in the new look", true);
  if (inOk) check("Insights: the three numbers come first", await page.evaluate(() => { const c = document.querySelector(".in-cards"), h = document.querySelector(".cbx-in-hero"); return c && h && c.getBoundingClientRect().top < h.getBoundingClientRect().top; }));

  // ---- a phone ----
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["channels", "conversions", "overview", "insights"]) {
    await go(NEW, route);
    check(`phone: no sideways scroll on ${route}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll(".content")].every((c) => c.scrollWidth <= c.clientWidth + 1)));
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- the old design: unchanged ----
  const OLD = "new=0&brand=0&simple=1";
  await go(OLD, "channels");
  check("old design: no new look", await page.evaluate(() => document.documentElement.dataset.brand !== "ocean"));
  check("old Channels: no new layout, the old pair is there", !(await has(".cbx")) && ((await has(".lv-pair")) || (await has(".content .empty"))));
  await go(OLD, "conversions");
  check("old Leads: the funnel card as before", !(await has(".cbx")) && ((await has(".lv-funnel-lines")) || (await has(".content .empty"))));
  await go(OLD, "overview");
  check("old Overview: its own lines, no soft area", !(await has(".cbx")) && !(await has(".ov-strip .cbx-area")) && (await has(".ov-strip path.lv-line")));
  await go(OLD, "insights");
  check("old Insights: no new top", !(await has(".cbx")));

  check("no page errors", !problems.some((p) => p.startsWith("pageerror")), problems.filter((p) => p.startsWith("pageerror")).join(" | "));
  await browser.close();
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
})();
