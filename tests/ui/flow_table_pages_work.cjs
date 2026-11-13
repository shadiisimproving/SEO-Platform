// Long tables page and search the same way everywhere (2026-11-10): Tasks (table view), Keywords and its Queries view,
// Search → Insights, Google's AI report on AI search, and Settings → Important domains. Each is fed a long made-up list
// through page.route on its own API call, then driven by hand: Next, a page number, 100 a page, the search (the box keeps
// its focus), each filter, a sorted heading, French, and a 390px phone (no sideways scroll, Notes never over the pages).
// Made-up sites and rows only. Needs the demo app:
//   DB_NAME_TEST=seo_cc_g_test .venv/bin/python tests/ui/app_server.py --port 8283
// Run: node tests/ui/flow_table_pages_work.cjs [http://127.0.0.1:8283/]   Screenshots: var/ui-table-pages-work/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8283/";
const OUT = path.resolve("var/ui-table-pages-work") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

const pad = (n) => String(n).padStart(2, "0");
const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/* 300 made-up tasks: three owners, four types, every status and priority, some with no date. */
const madeUpTasks = () => Array.from({ length: 300 }, (_, i) => ({
  id: 9000 + i, title: `Made-up task ${i + 1}${i % 10 === 0 ? " lemon" : ""}`, description: "", status: ["todo", "doing", "done"][i % 3], priority: ["low", "medium", "high"][i % 3 === 0 ? 2 : i % 2],
  due: i % 7 === 0 ? "" : dayFrom((i % 60) - 20), owner_label: ["Ana", "Ben", "Cleo", ""][i % 4], kind: ["Content", "Technical", "Links", "UX"][i % 4],
  site_id: 1, site_host: "site-one.example", pages: [], keywords: [], comments: [], source: null, completed_on: i % 3 === 2 ? dayFrom(-1) : "", created_at: new Date().toISOString(), version: 1,
  hypothesis: "", impact: null, hours_estimate: null, hours_spent: null, note: "",
}));

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const shot = (name, full = false) => page.screenshot({ path: OUT + name + ".png", fullPage: full });
  const range = (key) => page.locator(`[data-tp-foot="${key}"] .tp-range`).textContent().then((s) => s.trim()).catch(() => "");
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}|${a.id}|${a.dataset.tpKey || ""}|${a.dataset.tpStep || a.dataset.tpPage || (a.hasAttribute("data-tp-search") ? "search" : "")}` : ""; });
  const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  /* The floating Notes button must not sit on any of the footer's buttons or its size list. */
  const notesClear = (key) => page.evaluate((k) => {
    const fab = document.querySelector(".nb-fab"); const foot = document.querySelector(`[data-tp-foot="${k}"]`);
    if (!fab || !foot) return true;
    const f = fab.getBoundingClientRect();
    return [...foot.querySelectorAll("button, select")].every((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || r.right <= f.left || r.left >= f.right || r.bottom <= f.top || r.top >= f.bottom; });
  }, key);
  const french = async () => { await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await settle(); };
  const english = async () => { await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render(); }); await settle(); };
  const typeSearch = async (key, words) => { const box = page.locator(`[data-tp-search][data-tp-key="${key}"]`); await box.click(); await box.fill(""); await box.type(words, { delay: 40 }); await settle(); };
  await page.addInitScript(() => { try { Object.keys(localStorage).filter((k) => k.startsWith("tp-per:")).forEach((k) => localStorage.removeItem(k)); } catch { /* fine */ } });

  // ---- Tasks --------------------------------------------------------------------------------------
  const tasks = madeUpTasks();
  await page.route(/\/api\/tasks(\?.*)?$/, (route) => (route.request().method() === "GET" ? route.fulfill({ json: { tasks } }) : route.continue()));
  await page.goto(BASE + "#tasks"); await settle(2500);
  await page.click('[data-task-view="table"]'); await settle();
  const tkRows = () => page.locator("#tk-table tbody tr").count();
  check("Tasks: one page of 25 rows", (await tkRows()) === 25, await tkRows());
  check("Tasks: the foot says 1–25 of 300 tasks", (await range("tk")) === "1–25 of 300 tasks", await range("tk"));
  await shot("tasks-1-first-page");
  await page.click('[data-tp-foot="tk"] [data-tp-step="next"]'); await settle();
  check("Tasks: Next shows 26–50", (await range("tk")).startsWith("26–50"), await range("tk"));
  check("Tasks: focus stays on Next", (await focused()).endsWith("|tk|next"), await focused());
  await page.click('[data-tp-foot="tk"] .tp-num[data-tp-page="2"]'); await settle();
  check("Tasks: page number 3 shows 51–75", (await range("tk")).startsWith("51–75"), await range("tk"));
  check("Tasks: focus moves to the page pressed", (await focused()).endsWith("|tk|2"), await focused());
  await page.selectOption('[data-tp-foot="tk"] [data-tp-per]', "100"); await settle();
  check("Tasks: 100 a page", (await tkRows()) === 100 && (await range("tk")).startsWith("1–100"), await range("tk"));
  await page.selectOption('[data-tp-foot="tk"] [data-tp-per]', "25"); await settle();
  await page.click('[data-tp-foot="tk"] [data-tp-step="next"]'); await settle();
  // The Filter box is the table's one search: typing keeps the focus and goes back to page 1.
  if (await page.locator("[data-task-filters]").isVisible()) { await page.click("[data-task-filters]"); await settle(300); } // a phone folds the filters away
  check("Tasks: one search box only", (await page.locator("#tk-query").count()) === 1 && (await page.locator('[data-tp-search][data-tp-key="tk"]').count()) === 0);
  await page.locator("#tk-query").click(); await page.locator("#tk-query").type("lemon", { delay: 40 }); await settle();
  check("Tasks: the search keeps only lemon tasks, from page 1", (await range("tk")) === "1–25 of 30 tasks", await range("tk"));
  check("Tasks: focus stays in the search box", (await focused()).startsWith("INPUT|tk-query"), await focused());
  await page.locator("#tk-query").fill(""); await settle();
  await page.click('[data-tp-foot="tk"] [data-tp-step="next"]'); await settle();
  await page.selectOption("#tk-status", "doing"); await settle();
  check("Tasks: the status filter starts again on page 1", (await range("tk")) === "1–25 of 100 tasks", await range("tk"));
  check("Tasks: only In progress rows", (await page.locator("#tk-table tbody tr .tk-move").evaluateAll((s) => s.every((x) => x.value === "doing"))));
  await page.selectOption("#tk-kind", "Links"); await settle();
  check("Tasks: type filter narrows it", /of \d+ tasks/.test(await range("tk")) && (await page.locator('#tk-table td[data-label="Type"]').allTextContents()).every((x) => x.trim() === "Links"), await range("tk"));
  await page.selectOption("#tk-owner", "Ben"); await settle();
  check("Tasks: owner filter narrows it", (await page.locator('#tk-table td[data-label="Assigned to"]').allTextContents()).every((x) => x.trim() === "Ben"), await range("tk"));
  await page.selectOption("#tk-status", ""); await page.selectOption("#tk-kind", ""); await page.selectOption("#tk-owner", ""); await settle();
  await page.click('[data-tk-sort="due"]'); await settle();
  const dues = await page.locator('#tk-table tbody tr').evaluateAll((rows) => rows.map((r) => r.dataset.taskRow));
  const want = [...tasks].filter((x) => x.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  check("Tasks: Due date sorts the soonest first", tasks.find((x) => String(x.id) === dues[0])?.due === want.due, dues[0]);
  check("Tasks: the sorted heading keeps focus", (await focused()).includes("BUTTON"), await focused());
  await page.click('[data-tk-sort="priority"]'); await settle();
  check("Tasks: Priority sorts the most urgent first", (await page.locator('#tk-table tbody tr td[data-label="Priority"]').first().textContent()).includes("High"));
  await shot("tasks-2-sorted-by-priority");
  await french();
  check("Tasks: French foot", /sur 300 tâches/.test(await range("tk")), await range("tk"));
  await shot("tasks-3-french");
  await english();
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  check("Tasks: no sideways scroll at 390px", await noSideways());
  await page.locator('[data-tp-foot="tk"]').scrollIntoViewIfNeeded(); await settle(300);
  check("Tasks: Notes button clear of the pages at 390px", await notesClear("tk"));
  await shot("tasks-4-phone");
  await page.setViewportSize({ width: 1440, height: 950 }); await settle();
  await page.evaluate(() => (document.querySelector("main") || document.scrollingElement).scrollTo(0, 0)); await settle(300);
  check("Tasks: Notes button clear of the pages on a computer", await notesClear("tk"));
  // The foot sticks to the bottom of the screen while the table is in view.
  const stuck = await page.evaluate(() => { const r = document.querySelector('[data-tp-foot="tk"]').getBoundingClientRect(); return Math.abs(r.bottom - window.innerHeight) < 2; });
  check("Tasks: the pages stay at the bottom of the screen", stuck);
  await shot("tasks-5-sticky-foot");
  await page.unroute(/\/api\/tasks(\?.*)?$/);

  // ---- Keywords -----------------------------------------------------------------------------------
  await page.route(/\/api\/rankings$/, async (route) => {
    const res = await route.fetch(); const d = await res.json(); const base = d.rows[0];
    for (let i = 0; i < 280; i++) {
      const g = JSON.parse(JSON.stringify(base.engines.google));
      g.main = g.main ? { ...g.main, p: 1 + (i % 40) } : g.main; g.change = (i % 5) - 2;
      d.rows.push({ ...base, id: `made-up:${i}`, keyword_id: 100000 + i, keyword: `made-up keyword ${i}${i % 9 === 0 ? " lyon" : ""}`, page: `https://site-one.example/made-up-${i}/`, engines: { ...base.engines, google: g } });
    }
    await route.fulfill({ response: res, json: d });
  });
  await page.route(/\/api\/rankings\/queries\?engine=google$/, async (route) => {
    const rows = Array.from({ length: 240 }, (_, i) => ({ query: `made-up query ${i}${i % 8 === 0 ? " orange" : ""}`, site: "site-one.example", clicks: (i * 13) % 97, impressions: 100 + ((i * 37) % 900), position: 1 + ((i * 7) % 300) / 10 }));
    rows.sort((a, b) => b.clicks - a.clicks);
    await route.fulfill({ json: { rows } });
  });
  await page.goto("about:blank"); await page.goto(BASE + "#keywords"); await settle(2500);
  const kwRows = () => page.locator("#kw-table tbody tr").count();
  const kwTotal = Number(((await range("kw")).match(/of ([\d,\s]+)/) || [])[1]?.replace(/\D/g, ""));
  check("Keywords: one page of 25 rows", (await kwRows()) === 25, await kwRows());
  check("Keywords: the foot gives the real total", kwTotal >= 280, await range("kw"));
  await shot("keywords-1-first-page");
  await page.click('[data-tp-foot="kw"] [data-tp-step="next"]'); await settle();
  check("Keywords: Next shows 26–50", (await range("kw")).startsWith("26–50"), await range("kw"));
  check("Keywords: page 2 is in the address", page.url().includes("page=2"));
  check("Keywords: focus stays on Next", (await focused()).endsWith("|kw|next"), await focused());
  await page.locator('[data-tp-foot="kw"] .tp-num').last().click(); await settle();
  check("Keywords: the last page number", (await range("kw")).endsWith(`of ${kwTotal} keywords`) && !(await range("kw")).startsWith("1–"), await range("kw"));
  await page.selectOption('[data-tp-foot="kw"] [data-tp-per]', "100"); await settle();
  check("Keywords: 100 a page", (await kwRows()) === 100);
  check("Keywords: the size is in the address", page.url().includes("per=100"));
  await page.selectOption('[data-tp-foot="kw"] [data-tp-per]', "25"); await settle();
  check("Keywords: one search box only", (await page.locator("[data-tp-search]").count()) === 1);
  await page.click('[data-tp-foot="kw"] [data-tp-step="next"]'); await settle();
  await typeSearch("kw", "lyon");
  const lyon = await page.locator("#kw-table tbody tr").allInnerTexts();
  check("Keywords: the search keeps only lyon, from page 1", lyon.length > 0 && lyon.every((r) => /lyon/i.test(r)) && (await range("kw")).startsWith("1–"), await range("kw"));
  check("Keywords: focus stays in the search box", (await focused()).includes("|kw|search"), await focused());
  check("Keywords: the search is in the address", page.url().includes("q=lyon"));
  await page.reload(); await settle(2500);
  check("Keywords: a reload keeps the search", (await page.inputValue('[data-tp-search][data-tp-key="kw"]')) === "lyon");
  await page.click('[data-tp-key="kw"][data-tp-clear]'); await settle();
  check("Keywords: clearing the search brings every row back", (await range("kw")).includes(String(kwTotal)), await range("kw"));
  // Picks: the header box takes this page only.
  await page.click('[data-tp-foot="kw"] [data-tp-step="next"]'); await settle();
  await page.check("#kwr-select-all"); await settle();
  check("Keywords: Select all picks the 25 on this page only", (await page.locator(".selbar b").textContent()).startsWith("25"), await page.locator(".selbar b").textContent());
  check("Keywords: the header box keeps focus", (await focused()).includes("kwr-select-all"), await focused());
  await page.evaluate(() => (document.querySelector("main") || document.scrollingElement).scrollTo(0, 0)); await settle(300);
  const clash = await page.evaluate(() => { const a = document.querySelector('[data-tp-foot="kw"]').getBoundingClientRect(), b = document.querySelector(".selbar").getBoundingClientRect(); return !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1); });
  check("Keywords: the selection bar doesn't cover the pages", !clash);
  await shot("keywords-2-picked-page");
  await page.click('[data-tp-foot="kw"] [data-tp-step="next"]'); await settle();
  check("Keywords: another page lets the picks go", (await page.locator(".selbar").count()) === 0);
  await page.click('[data-tp-foot="kw"] [data-tp-step="next"]'); await settle();
  await page.click('[data-filter="top3"]'); await settle();
  check("Keywords: a chip starts again on page 1", (await range("kw")).startsWith("1–"), await range("kw"));
  await page.click('[data-filter="all"]'); await settle();
  await page.click('[data-tp-foot="kw"] [data-tp-step="next"]'); await settle();
  await page.click('[data-sort="pos"]'); await settle();
  check("Keywords: a sorted heading starts again on page 1", (await range("kw")).startsWith("1–"), await range("kw"));
  await french();
  check("Keywords: French foot", /sur [\d\s ]+ mots-clés/.test(await range("kw")), await range("kw"));
  await shot("keywords-3-french");
  await english();
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  check("Keywords: no sideways scroll at 390px", await noSideways());
  await page.locator('[data-tp-foot="kw"]').scrollIntoViewIfNeeded(); await settle(300);
  check("Keywords: Notes button clear of the pages at 390px", await notesClear("kw"));
  await shot("keywords-4-phone");
  await page.setViewportSize({ width: 1440, height: 950 }); await settle();
  await page.evaluate(() => (document.querySelector("main") || document.scrollingElement).scrollTo(0, 400)); await settle(300);
  check("Keywords: Notes button clear of the pages on a computer", await notesClear("kw"));
  await shot("keywords-5-sticky-foot");

  // Keywords → Queries
  await page.evaluate(() => (document.querySelector("main") || document.scrollingElement).scrollTo(0, 0));
  await page.click('[data-view="queries"]'); await settle(1500);
  const qRows = () => page.locator("#kwq-table tbody tr").count();
  check("Queries: one page of 25", (await qRows()) === 25, await qRows());
  check("Queries: the foot says 1–25 of 240 queries", (await range("kwq")) === "1–25 of 240 queries", await range("kwq"));
  await page.click('[data-tp-foot="kwq"] [data-tp-step="next"]'); await settle();
  check("Queries: Next", (await range("kwq")).startsWith("26–50"), await range("kwq"));
  await page.click('[data-tp-foot="kwq"] .tp-num[data-tp-page="9"]'); await settle();
  check("Queries: the last page number", (await range("kwq")) === "226–240 of 240 queries", await range("kwq"));
  await page.selectOption('[data-tp-foot="kwq"] [data-tp-per]', "100"); await settle();
  check("Queries: 100 a page", (await qRows()) === 100);
  await typeSearch("kwq", "orange");
  check("Queries: the search keeps only orange", (await range("kwq")) === "1–30 of 30 queries" && (await page.locator("#kwq-table tbody tr").allInnerTexts()).every((r) => /orange/.test(r)), await range("kwq"));
  check("Queries: focus stays in the search box", (await focused()).includes("|kwq|search"), await focused());
  await typeSearch("kwq", "zzzz");
  check("Queries: a search with nothing says so", (await page.locator("[data-kwq-search-clear]").count()) === 1 && (await page.locator('[data-tp-search][data-tp-key="kwq"]').count()) === 1);
  await page.click("[data-kwq-search-clear]"); await settle();
  await page.click('[data-kwq-sort="position"]'); await settle();
  const pos = await page.locator('#kwq-table tbody tr td[data-label="Position"]').evaluateAll((c) => c.slice(0, 5).map((x) => Number(x.textContent.replace(",", "."))));
  check("Queries: Position sorts best first", pos.every((p, i) => !i || p >= pos[i - 1]) && pos[0] === 1, JSON.stringify(pos));
  await page.click('[data-kwq-sort="impressions"]'); await settle();
  const imp = await page.locator('#kwq-table tbody tr td[data-label="Impressions"]').evaluateAll((c) => c.slice(0, 5).map((x) => Number(x.textContent.replace(/\D/g, ""))));
  check("Queries: Impressions sorts biggest first", imp.every((p, i) => !i || p <= imp[i - 1]), JSON.stringify(imp));
  check("Queries: the sorted heading keeps focus", (await focused()).startsWith("BUTTON"), await focused());
  await shot("queries-1-sorted");
  await french();
  check("Queries: French foot", /sur 240 requêtes/.test(await range("kwq")), await range("kwq"));
  await english();
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  check("Queries: no sideways scroll at 390px", await noSideways());
  await shot("queries-2-phone");
  await page.setViewportSize({ width: 1440, height: 950 }); await settle();
  await page.click('[data-view="positions"]'); await settle();
  await page.unroute(/\/api\/rankings$/); await page.unroute(/\/api\/rankings\/queries\?engine=google$/);

  // ---- Search → Insights ------------------------------------------------------------------------
  await page.route(/\/api\/insights\?/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/insights") return route.continue();
    const group = url.searchParams.get("group");
    const rows = group === "wins" ? Array.from({ length: 140 }, (_, i) => ({
      id: 7000 + i, kind: "almost", group: "wins", query: `made-up search ${i}${i % 7 === 0 ? " plum" : ""}`, host: "site-one.example", page: `https://site-one.example/p-${i}/`,
      at_stake: 400 - i * 2.5, severity: "normal", status: "open", key: `k${i}`, evidence: { position: 11 + (i % 9), impressions: 900 - i, clicks: i % 30 },
    })) : [];
    await route.fulfill({ json: { counts: { wins: { open: 140 } }, group, rows, status: url.searchParams.get("status"), summary: { at_stake: 9000, changes: [], fixed: 0, needs: {}, open: 140, ran_at: new Date().toISOString(), sites: 3 } } });
  });
  await page.goto("about:blank"); await page.goto(BASE + "#insights"); await settle(2500);
  await page.click('[data-in-tab="wins"]'); await settle(1500);
  const inRows = () => page.locator(".in-table tbody tr").count();
  check("Insights: one page of 25", (await inRows()) === 25, await inRows());
  check("Insights: the foot says 1–25 of 140 findings", (await range("in")) === "1–25 of 140 findings", await range("in"));
  check("Insights: no Show more any more", (await page.locator("[data-in-more]").count()) === 0);
  await shot("insights-1-first-page");
  await page.click('[data-tp-foot="in"] [data-tp-step="next"]'); await settle();
  check("Insights: Next", (await range("in")).startsWith("26–50"), await range("in"));
  check("Insights: focus stays on Next", (await focused()).endsWith("|in|next"), await focused());
  await page.click('[data-tp-foot="in"] .tp-num[data-tp-page="5"]'); await settle();
  check("Insights: the last page", (await range("in")) === "126–140 of 140 findings", await range("in"));
  await page.selectOption('[data-tp-foot="in"] [data-tp-per]', "100"); await settle();
  check("Insights: 100 a page", (await inRows()) === 100);
  await typeSearch("in", "plum");
  check("Insights: the search keeps only plum", (await range("in")) === "1–20 of 20 findings" && (await page.locator(".in-table tbody tr").allInnerTexts()).every((r) => /plum/.test(r)), await range("in"));
  check("Insights: focus stays in the search box", (await focused()).includes("|in|search"), await focused());
  await page.click('[data-tp-key="in"][data-tp-clear]'); await settle();
  await page.click('[data-tp-foot="in"] [data-tp-step="next"]'); await settle();
  await page.click("[data-in-sort]"); await settle();
  const stakes = await page.locator('.in-table tbody tr td[data-label="Clicks a month"]').evaluateAll((c) => c.slice(0, 4).map((x) => Number(x.textContent.replace(/\D/g, ""))));
  check("Insights: the heading turns it to smallest first, from page 1", (await range("in")).startsWith("1–") && stakes.every((p, i) => !i || p >= stakes[i - 1]), JSON.stringify(stakes));
  check("Insights: the sorted heading keeps focus", (await focused()).startsWith("BUTTON"), await focused());
  await page.click("[data-in-sort]"); await settle();
  await page.click('[data-tp-foot="in"] [data-tp-step="next"]'); await settle();
  await page.selectOption("[data-in-status]", "dismissed"); await settle(1200);
  await page.selectOption("[data-in-status]", "open"); await settle(1200);
  check("Insights: the Show filter starts again on page 1", (await range("in")).startsWith("1–"), await range("in"));
  await french();
  check("Insights: French foot", /sur 140 constats/.test(await range("in")), await range("in"));
  await shot("insights-2-french");
  await english();
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  check("Insights: no sideways scroll at 390px", await noSideways());
  await page.locator('[data-tp-foot="in"]').scrollIntoViewIfNeeded(); await settle(300);
  check("Insights: Notes button clear of the pages at 390px", await notesClear("in"));
  await shot("insights-3-phone");
  await page.setViewportSize({ width: 1440, height: 950 }); await settle();
  await page.unroute(/\/api\/insights\?/);

  // ---- AI search: Google's AI report, one site --------------------------------------------------
  await page.route(/\/api\/search\/ai-report(\?.*)?$/, (route) => (route.request().method() !== "GET" ? route.continue() : route.fulfill({ json: { sites: [{
    host: "site-one.example", period_start: dayFrom(-90), period_end: dayFrom(-3), period_known: true, impressions: 51234, pages_count: 180, uploaded_at: new Date().toISOString(), before: null,
    countries: [{ key: "FR", impressions: 30000 }], pages: Array.from({ length: 180 }, (_, i) => ({ key: `https://site-one.example/made-up-page-${i}${i % 6 === 0 ? "-pear" : ""}/`, impressions: 2000 - i * 10 })),
  }] } })));
  await page.goto("about:blank"); await page.goto(BASE + "#ai"); await settle(2000);
  await page.evaluate(() => { window.UI.pickSite("site-one.example"); window.UI.render(); }); await settle(2000);
  check("AI report: one page of 25 pages", (await range("gai")) === "1–25 of 180 pages", await range("gai"));
  await page.locator('[data-tp-foot="gai"]').scrollIntoViewIfNeeded();
  await page.click('[data-tp-foot="gai"] [data-tp-step="next"]'); await settle();
  check("AI report: Next", (await range("gai")).startsWith("26–50"), await range("gai"));
  await page.selectOption('[data-tp-foot="gai"] [data-tp-per]', "100"); await settle();
  check("AI report: 100 a page", (await range("gai")).startsWith("1–100"), await range("gai"));
  await typeSearch("gai", "pear");
  check("AI report: the search keeps only pear pages", (await range("gai")) === "1–30 of 30 pages", await range("gai"));
  check("AI report: focus stays in the search box", (await focused()).includes("|gai|search"), await focused());
  await shot("ai-report-1-search", true);
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  check("AI report: no sideways scroll at 390px", await noSideways());
  await page.locator('[data-tp-foot="gai"]').scrollIntoViewIfNeeded(); await settle(300);
  check("AI report: Notes button clear of the pages at 390px", await notesClear("gai"));
  await shot("ai-report-2-phone");
  await page.setViewportSize({ width: 1440, height: 950 }); await settle();
  await page.unroute(/\/api\/search\/ai-report(\?.*)?$/);

  // ---- Settings → Important domains ---------------------------------------------------------------
  await page.route(/\/api\/important-domains$/, (route) => (route.request().method() !== "GET" ? route.continue() : route.fulfill({ json: {
    rows_left: 40, rows_used: 10, rows_free: 50, moz_connected: false, radar_connected: false,
    domains: Array.from({ length: 70 }, (_, i) => ({ domain: `made-up-${i}${i % 10 === 0 ? "-kiwi" : ""}.example`, authority: i % 60, domain_authority: null, linking_domains: null, external_links: null, fetched_at: null, popularity: null })),
  } })));
  await page.goto("about:blank"); await page.goto(BASE + "#settings"); await settle(2000);
  await page.click('[data-lv-tab="domains"]'); await settle(1500);
  check("Domains: one page of 25", (await range("imp-domains")) === "1–25 of 70 domains", await range("imp-domains"));
  await page.click('[data-tp-foot="imp-domains"] [data-tp-step="next"]'); await settle();
  check("Domains: Next", (await range("imp-domains")).startsWith("26–50"), await range("imp-domains"));
  await typeSearch("imp-domains", "kiwi");
  check("Domains: the search keeps only kiwi", (await range("imp-domains")) === "1–7 of 7 domains", await range("imp-domains"));
  check("Domains: focus stays in the search box", (await focused()).includes("|imp-domains|search"), await focused());
  await shot("domains-1-search");
  await french();
  check("Domains: French foot", /sur 7 domaines/.test(await range("imp-domains")), await range("imp-domains"));
  await english();
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  check("Domains: no sideways scroll at 390px", await noSideways());
  await shot("domains-2-phone");

  const real = problems.filter((p) => !/Failed to load resource/.test(p));
  check("no script errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
