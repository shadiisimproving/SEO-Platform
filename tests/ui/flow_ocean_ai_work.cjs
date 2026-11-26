/* The new design (Cobalt, ?brand=ocean) on the ai-work screens: AI search, Tasks, Notes, Resources, Social, Settings each
   draw their new layout with no page errors, at 1440 and 390 wide; with the old design on (?new=0&brand=0) none of it shows.
   Run against tests/ui/app_server.py (demo world):
     DB_NAME_TEST=test_cb4_test .venv/bin/python tests/ui/app_server.py --port 8344 --fake-claude
     node tests/ui/flow_ocean_ai_work.cjs http://127.0.0.1:8344/ */
const assert = require("assert");
const { open } = require("./pw.cjs");
const BASE = (process.argv[2] || "http://127.0.0.1:8344/").replace(/\/?$/, "/");
const NEW = "?new=1&simple=1&brand=ocean", OLD = "?new=0&brand=0&simple=1";

// Each route: what the new design must show (and the old one must not).
const ROUTES = [
  ["ai", [".ow-ai", ".ow-ai .cb-kpis .cb-kpi", ".ow-ai-hero", ".ow-vs", ".ai-tabs-card"]],
  ["tasks?view=kanban", ["#ow-tk-sum .cb-kpi", ".tk-board"]],
  ["tasks?view=table", ["#ow-tk-sum"]],
  ["notes", [".nv-card", "#page[data-ow=notes]"]],
  ["resources", ["#page[data-ow=resources]"]],
  ["social", [".so-stages", "#page[data-ow=social]"]],
  ["settings", ["#set-tiles .ow-set-share", ".conn-row .ow-pill"]],
];
const OCEAN_ONLY = [".ow-ai", "#ow-tk-sum", ".ow-pill", ".ow-set-share", ".so-setup-prog", "#page[data-ow]", ".ow-res-logo"];

async function seed() {
  // A few tasks in each column and a resource, so the board and the list have something to show.
  const api = async (method, path, body) => (await fetch(`${BASE}api/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
  const have = (await api("GET", "tasks")).tasks || [];
  if (have.length < 4) {
    for (const [i, status] of ["todo", "doing", "blocked", "done"].entries()) {
      const task = await api("POST", "tasks", { title: `Cobalt check task ${i + 1}`, kind: "Content", due: "2026-11-20", owner_label: "Sam" });
      if (status !== "todo") await api("PATCH", `tasks/${task.id}`, { status });
    }
  }
  if (!((await api("GET", "resources")).resources || []).length) await api("POST", "resources", { title: "Brand guide", url: "https://example.com/guide", tags: ["brief"] });
}

(async () => {
  await seed();
  let passed = 0;
  for (const width of [1440, 390]) {
    const { browser, page, problems } = await open({ width, height: 900 });
    const pageErrors = () => problems.filter((p) => p.startsWith("pageerror"));
    for (const [route, want] of ROUTES) {
      await page.goto(`${BASE}${NEW}#${route}`);
      for (const sel of want) await page.waitForSelector(sel, { timeout: 15000, state: "attached" }).catch(() => assert.fail(`${route} @${width}: ${sel} missing`));
      assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.brand), "ocean");
      // No page wider than the window.
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(wide <= 1, `${route} @${width}: page scrolls sideways by ${wide}px`);
      assert.deepStrictEqual(pageErrors(), [], `${route} @${width}: page errors`);
      passed++;
    }
    // Social: the Writing guide's cards are numbered steps (CSS counters), the set-up card says how many steps are done.
    if (width === 1440) {
      await page.goto(`${BASE}${NEW}#social`);
      await page.waitForSelector(".so-stages");
      if (await page.$(".so-setup")) { assert.ok(await page.$(".so-setup-prog"), "set-up progress"); passed++; }
      await page.click('[data-so-tab="guide"]');
      await page.waitForSelector("#so-niche");
      const step = await page.evaluate(() => getComputedStyle(document.querySelector("#so-body > .card > .card-head h2"), "::before").content);
      assert.ok(step && step !== "none" && step !== "normal", `guide step number: ${step}`);
      passed++;
      // AI search: the chart's switch goes to Clarity live and back without errors.
      await page.goto(`${BASE}${NEW}#ai`);
      await page.waitForSelector(".ow-ai-hero");
      // Time charts are the soft-area look (cb-chart.js): no bars, and a drawn chart is a .cbc.
      assert.strictEqual(await page.$$eval(".ow-ai rect.cb-now, .ow-ai rect.cb-was, .ow-ai rect.cb-best, .ow-ai .cb-mini i", (e) => e.length), 0, "no bar charts left");
      const drawn = await page.$$eval(".ow-ai-hero .cb-plot", (els) => els.map((e) => e.classList.contains("cbc")));
      assert.ok(drawn.every(Boolean), "the weekly chart is a soft-area chart");
      passed++;
      const clarity = await page.$('[data-ow-ai-chart="clarity"]');
      if (clarity) { await clarity.click(); await page.waitForSelector('[data-ow-ai-chart="clarity"][aria-pressed="true"]'); await page.click('[data-ow-ai-chart="ga4"]'); passed++; }
      // Resources: Add a resource from the empty state or the head opens the same panel.
      await page.goto(`${BASE}${NEW}#resources`);
      await page.waitForSelector("#page[data-ow=resources]");
      await page.click('[data-lv-resource="new"]');
      await page.waitForSelector("#panel");
      passed++;
      assert.deepStrictEqual(pageErrors(), [], "page errors after clicks");
    }
    // The old design: none of the new parts, on every route.
    for (const [route] of ROUTES) {
      await page.goto(`${BASE}${OLD}#${route}`);
      await page.waitForTimeout(2500);
      assert.notStrictEqual(await page.evaluate(() => document.documentElement.dataset.brand), "ocean", `${route}: old design asked`);
      for (const sel of OCEAN_ONLY) assert.strictEqual(await page.$(sel), null, `${route} @${width} old design shows ${sel}`);
      passed++;
    }
    // And back on: the new design returns.
    await page.goto(`${BASE}${NEW}#tasks`);
    await page.waitForSelector("#ow-tk-sum");
    assert.deepStrictEqual(pageErrors(), [], "page errors");
    passed++;
    await browser.close();
  }
  console.log(`flow_ocean_ai_work: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
