// Pages and a search on the long lists of a competitor's profile, the live screens and Search → Overview's chart table
// (2026-11-10): the same pager as the query table (25 / 50 / 100, Previous / Next, the real total), a search that keeps focus,
// sortable figures, French, and a phone. Long lists are made up in the browser (page.route), on made-up sites only.
//   DB_NAME_TEST=seo_cc_h_test .venv/bin/python tests/ui/app_server.py --port 8284
//   node tests/ui/flow_table_pages_profile.cjs http://127.0.0.1:8284/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8284/";
const OUT = path.resolve("var/ui-table-pages-profile") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

/* 300 more of their pages that rank for my keywords, and 80 pages of questions on my topics plus 40 on others. */
function longInsights(d, host) {
  for (let i = 0; i < 300; i++) {
    d.best_pages.push({ url: `https://${host}/made-up/page-${i}`, title: `Made-up page ${i}`, keywords: 1 + (i % 9), best_position: 1 + ((i * 7) % 60), my_url: i % 3 ? null : `https://site-one.example/mine-${i}`, my_title: null, pair_id: null });
  }
  const groups = [];
  for (let i = 0; i < 80; i++) groups.push({ url: `https://${host}/guides/q-${i}`, title: `Guide ${i}`, questions: [`How does trick ${i} work?`, `Why choose option ${i}?`], other: [], related: true, score: 2 });
  for (let i = 0; i < 40; i++) groups.push({ url: `https://${host}/blog/off-${i}`, title: `Off-topic ${i}`, questions: [`Where to travel in month ${i}?`], other: [], related: false, score: 0 });
  d.questions = { judged: true, dropped: 0, groups, related: 160, total: 200 };
  return d;
}

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const call = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), BASE + "api/" + p);
  await page.goto(BASE + "#today"); await settle(1500);
  const site = (await call("links/sites")).sites[0];
  const rivals = (await call(`competitors?site_id=${site.id}`)).competitors;
  const one = rivals.find((c) => c.host === "rival-one.example") || rivals[0], two = rivals.find((c) => c.id !== one.id);
  await page.route(/\/api\/competitors\/\d+\/insights\?/, async (route) => {
    const res = await route.fetch(), d = await res.json();
    const id = Number(route.request().url().match(/competitors\/(\d+)\//)[1]);
    await route.fulfill({ response: res, json: longInsights(d, (rivals.find((c) => c.id === id) || one).host) });
  });
  const openProfile = async (id) => {
    await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle(1500);
    if (await page.$("#comp-site")) { await page.selectOption("#comp-site", String(site.id)); await settle(); }
    await page.click(`[data-cs-open="${id}"]`); await settle(1500);
    await page.click('[data-pt-tab="pages"]'); await settle();
  };
  const range = (scope) => page.locator(`${scope} .tp-range`).first().textContent().then((x) => (x || "").replace(/\s+/g, " ").trim());
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.dataset.tpStep || (a.hasAttribute("data-tp-search") ? "search" : a.hasAttribute("data-tp-per") ? "per" : a.dataset.ptBestSort || a.dataset.lvSort || a.getAttribute("aria-current") || a.tagName)) : ""; });

  // ---- a competitor's strongest pages ----
  await openProfile(one.id);
  const best = "#pt-best tbody tr", bestFoot = '[data-tp-foot="pt-best"]';
  const total = (await call(`competitors/${one.id}/insights?site_id=${site.id}`)).best_pages.length; // the made-up 300 included: the page's own fetch goes through page.route too
  check("their strongest pages open on 25 rows", (await page.locator(best).count()) === 25);
  check("the footer gives the real total", (await range(bestFoot)) === `1–25 of ${total} pages`, await range(bestFoot));
  await page.screenshot({ path: OUT + "1-best-pages.png" });
  await page.click(`${bestFoot} [data-tp-step="next"]`); await settle();
  check("Next shows the next 25", (await range(bestFoot)).startsWith("26–50"), await range(bestFoot));
  check("focus stays on Next", (await focused()) === "next");
  await page.click(`${bestFoot} .tp-num[data-tp-page="2"]`); await settle();
  check("a page number opens that page", (await range(bestFoot)).startsWith("51–75"), await range(bestFoot));
  await page.selectOption(`${bestFoot} [data-tp-per]`, "100"); await settle();
  check("100 per page shows 100 rows", (await page.locator(best).count()) === 100);
  check("focus stays on the rows-per-page box", (await focused()) === "per");
  await page.selectOption(`${bestFoot} [data-tp-per]`, "25"); await settle();
  const box = '[data-tp-search][data-tp-key="pt-best"]';
  await page.click(box); await page.keyboard.type("made-up page 12", { delay: 30 }); await settle();
  const found = await page.locator(`${best} td.head-cell .t`).allTextContents();
  check("search finds the pages by title, every word of it", found.length === 13 && found.every((x) => /^Made-up page \d*12\d*$/.test(x)), found.length);
  check("focus stays in the search box while typing", (await focused()) === "search");
  await page.fill(box, "/made-up/page-299"); await settle();
  check("search finds a page by its address", (await page.locator(best).count()) === 1);
  await page.fill(box, "nothing like this"); await settle();
  check("no match says so", /No page matches the search/.test(await page.locator("#pt-panel").textContent()));
  await page.click('[data-tp-clear][data-tp-key="pt-best"]'); await settle();
  check("clearing the search brings every page back", (await range(bestFoot)) === `1–25 of ${total} pages`);
  await page.click('[data-pt-best-sort="keywords"]'); await settle();
  const kw = await page.locator(`${best} td:nth-child(3)`).allTextContents();
  check("Keywords sorts the most first", Number(kw[0]) === 9 && kw.every((x, i) => !i || Number(kw[i - 1]) >= Number(x)), kw.slice(0, 4).join(","));
  check("the sorted heading says so", (await page.locator('th:has([data-pt-best-sort="keywords"])').getAttribute("aria-sort")) === "descending");
  check("focus stays on the heading", (await focused()) === "keywords");
  await page.click('[data-pt-best-sort="position"]'); await settle();
  const pos = await page.locator(`${best} td:nth-child(4)`).allTextContents();
  const posN = pos.map((x) => Number(x.replace(/\D/g, "")));
  check("Best position sorts the best first", posN[0] === 1 && posN.every((x, i) => !i || posN[i - 1] <= x), pos.slice(0, 3).join(","));
  await page.click('[data-pt-best-sort="position"]'); await page.click('[data-pt-best-sort="position"]'); await settle(); // a third click goes back
  check("a third click goes back to the usual order", (await page.locator('th:has([data-pt-best-sort="position"])').getAttribute("aria-sort")) === "none");

  // The footer stays at the bottom while the table is in view, and the Notes button doesn't cover its buttons.
  await page.click(`${bestFoot} [data-tp-step="next"]`); await settle();
  await page.locator(best).nth(5).scrollIntoViewIfNeeded(); await settle(300);
  const geo = await page.evaluate((sel) => {
    const foot = document.querySelector(sel), fab = document.querySelector("#nb-fab");
    const f = foot.getBoundingClientRect(), b = fab?.getBoundingClientRect();
    const overlap = b && [...foot.querySelectorAll("button, select")].some((x) => { const r = x.getBoundingClientRect(); return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom; });
    return { stuck: Math.abs(f.bottom - window.innerHeight) < 2, overlap: Boolean(overlap) };
  }, bestFoot);
  check("the footer sticks to the bottom of the screen", geo.stuck);
  check("the Notes button covers no footer control", !geo.overlap);
  await page.screenshot({ path: OUT + "2-best-pages-sticky.png" });

  // ---- their questions ----
  const qFoot = '[data-tp-foot="pt-q"]';
  await page.locator("#pt-questions").scrollIntoViewIfNeeded();
  check("their questions open on 25 pages", (await page.locator("#pt-questions > li").count()) === 25);
  check("the questions footer gives the total", (await range(qFoot)) === "1–25 of 80 pages", await range(qFoot));
  check("no Show more button is left", (await page.locator("[data-pt-q-more]").count()) === 0);
  await page.click(`${qFoot} [data-tp-step="next"]`); await settle();
  check("Next shows the next pages of questions", (await range(qFoot)).startsWith("26–50") && (await page.locator("#pt-questions > li .t").first().textContent()).trim() === "Guide 25");
  const qBox = '[data-tp-search][data-tp-key="pt-q"]';
  await page.click(qBox); await page.keyboard.type("trick 42", { delay: 30 }); await settle();
  check("search reads the questions too", (await page.locator("#pt-questions > li").count()) === 1 && (await focused()) === "search");
  await page.click('[data-tp-clear][data-tp-key="pt-q"]'); await settle();
  await page.click("[data-pt-q-others]"); await settle();
  const oFoot = '[data-tp-foot="pt-q-other"]';
  check("questions on other topics open in pages too", (await page.locator(".pt-qpages-other > li").count()) === 25 && (await range(oFoot)) === "1–25 of 40 pages", await range(oFoot));
  await page.screenshot({ path: OUT + "3-questions.png", fullPage: true });

  // ---- another competitor starts on page 1, unsearched ----
  // Leave this one on page 5 with a search, then open another from the list, in the same visit.
  await page.fill(box, "page 1"); await settle(); await page.click(`${bestFoot} [data-tp-step="next"]`); await settle();
  if (two) {
    await page.evaluate(() => window.COMP.open("summary")); await settle(1500); // back to the list in the same visit, so the pages state is still in memory
    await page.click(`[data-cs-open="${two.id}"]`); await settle(1500); await page.click('[data-pt-tab="pages"]'); await settle();
    check("another competitor's pages start on page 1 with no search", (await range(bestFoot)).startsWith("1–25") && (await page.inputValue(box)) === "");
  }

  // ---- French ----
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await settle(1200);
  if (!(await page.$(bestFoot))) { await page.click('[data-pt-tab="pages"]'); await settle(); }
  const frFoot = await range(bestFoot), frBox = await page.getAttribute(box, "placeholder");
  check("French: the footer and the search read in French", / sur /.test(frFoot) && frBox === "Rechercher une de leurs pages", `${frFoot} | ${frBox}`);
  check("French: the Next button reads Suivant", /Suivant/.test(await page.locator(`${bestFoot} [data-tp-step="next"]`).textContent()));
  await page.screenshot({ path: OUT + "4-french.png" });
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render(); }); await settle(800);

  // ---- a phone ----
  await page.setViewportSize({ width: 390, height: 844 }); await settle(800);
  if (!(await page.$(bestFoot))) { await page.click('[data-pt-tab="pages"]'); await settle(); }
  check("390px: no sideways scroll on the Pages tab", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.locator(bestFoot).scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "5-phone-best.png" });
  await page.locator(qFoot).scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "6-phone-questions.png" });
  await page.setViewportSize({ width: 1440, height: 950 });

  // ---- Content: every page of the site, 300 more made up ----
  await page.route(/\/api\/metrics\/content\?/, async (route) => {
    const res = await route.fetch(), d = await res.json();
    const base = d.pages[0] || { host: "site-one.example", category: "Other pages", sessions: 1, leads: 0, clicks: 1, impressions: 10, position: 9, ai: 0 };
    for (let i = 0; i < 300; i++) d.pages.push({ ...base, path: `/made-up/article-${i}/`, sessions: i * 3, clicks: (i * 13) % 200, position: 1 + (i % 40) });
    d.total_pages = d.pages.length;
    await route.fulfill({ response: res, json: d });
  });
  await page.goto("about:blank"); await page.goto(BASE + "#content"); await settle(2500);
  const cFoot = '[data-tp-foot="lv-content"]', cRows = `section:has(${cFoot}) tbody tr`;
  check("Content: All pages opens on 25 rows with the total", (await page.locator(cRows).count()) === 25 && /^1–25 of \d{3}$/.test(await range(cFoot)), await range(cFoot));
  check("Content: no Show more is left", (await page.locator("[data-lv-more]").count()) === 0);
  await page.screenshot({ path: OUT + "7-content.png" });
  await page.click(`${cFoot} [data-tp-step="next"]`); await settle();
  check("Content: Next shows 26–50, focus on Next", (await range(cFoot)).startsWith("26–50") && (await focused()) === "next");
  await page.selectOption(`${cFoot} [data-tp-per]`, "50"); await settle();
  check("Content: 50 per page", (await page.locator(cRows).count()) === 50 && (await focused()) === "per");
  await page.selectOption(`${cFoot} [data-tp-per]`, "25"); await settle();
  await page.click('[data-lv-sort="content"][data-key="sessions"]'); await settle();
  const visits = await page.locator(`${cRows} td:nth-child(3)`).allTextContents();
  check("Content: sorting by Visits goes back to page 1 with the most first", (await range(cFoot)).startsWith("1–25") && Number(visits[0].replace(/\D/g, "")) === 897, visits[0]);
  check("Content: focus stays on the sorted heading", (await focused()) === "content");
  const cBox = '[data-tp-search][data-tp-key="lv-content"]';
  await page.click(cBox); await page.keyboard.type("article-29", { delay: 30 }); await settle();
  check("Content: search finds pages by address, focus kept", (await page.locator(cRows).count()) === 11 && (await focused()) === "search", await page.locator(cRows).count());
  await page.fill(cBox, "zzz-none"); await settle();
  check("Content: no match says so", /Nothing matches the search/.test(await page.locator("#page").textContent()));
  await page.fill(cBox, ""); await settle();
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await settle(800);
  check("Content: French footer and search", / sur /.test(await range(cFoot)) && (await page.getAttribute(cBox, "placeholder")) === "Rechercher une page");
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render(); }); await settle(600);
  await page.setViewportSize({ width: 390, height: 844 }); await settle(800);
  check("Content 390px: no sideways scroll", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.locator(cFoot).scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "8-content-phone.png" });
  await page.setViewportSize({ width: 1440, height: 950 }); await settle(600);

  // ---- Channels: 60 referring sites, and the chart as a table ----
  await page.route(/\/api\/metrics\/channels\?/, async (route) => {
    const res = await route.fetch(), d = await res.json();
    d.state = "ok"; // the made-up world has no Google Analytics connected: show its saved numbers as if it had
    for (let i = 0; i < 60; i++) d.referrers.push({ domain: `made-up-referrer-${i}.example`, sessions: 600 - i, leads: i % 4, rate: 0.01 });
    await route.fulfill({ response: res, json: d });
  });
  await page.goto("about:blank"); await page.goto(BASE + "#channels"); await settle(2500);
  const rFoot = '[data-tp-foot="lv-referrers"]';
  check("Channels: referring sites in pages of 25", /^1–25 of 60$/.test(await range(rFoot)), await range(rFoot));
  await page.fill('[data-tp-search][data-tp-key="lv-referrers"]', "referrer-5"); await settle();
  check("Channels: search a referring site", (await page.locator(`section:has([data-tp-key="lv-referrers"]) tbody tr`).count()) === 11);
  await page.click('[data-lv-table="channels"]'); await settle();
  const chFoot = '[data-tp-foot="lv-chart-channels"]';
  check("Channels: the chart's table has pages too", (await page.locator(".lv-chart-table tbody tr").count()) === 25 && /^1–25 of \d+$/.test(await range(chFoot)), await range(chFoot));
  check("Channels: focus stays on Show as a table", (await page.evaluate(() => document.activeElement?.dataset?.lvTable)) === "channels");
  await page.click(`${chFoot} [data-tp-step="next"]`); await settle();
  check("Channels: Next on the chart's table", (await range(chFoot)).startsWith("26–"));
  await page.screenshot({ path: OUT + "9-channels.png", fullPage: true });

  // ---- Search → Overview: the chart as a table ----
  await page.goto("about:blank"); await page.goto(BASE + "#overview"); await settle(2500);
  if (await page.$("[data-ov-table]")) {
    await page.click("[data-ov-table]"); await settle();
    const rows = await page.locator(".ov-chart-table tbody tr").count();
    const foot = await page.$('[data-tp-foot="ov-chart-table"]');
    check("Overview: the chart's table shows at most 25 rows, with the pager", rows > 0 && rows <= 25 && Boolean(foot), rows);
    check("Overview: focus stays on Show as a table", (await page.evaluate(() => document.activeElement?.hasAttribute("data-ov-table"))));
    if (foot && (await page.$('[data-tp-foot="ov-chart-table"] [data-tp-step="next"]'))) {
      await page.click('[data-tp-foot="ov-chart-table"] [data-tp-step="next"]'); await settle();
      check("Overview: Next on the chart's table", (await range('[data-tp-foot="ov-chart-table"]')).startsWith("26–"));
    }
    await page.screenshot({ path: OUT + "10-overview-chart-table.png" });
  } else check("Overview: Show as a table is offered", false);

  const real = problems.filter((p) => !/Failed to load resource/.test(p));
  check("no script errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
