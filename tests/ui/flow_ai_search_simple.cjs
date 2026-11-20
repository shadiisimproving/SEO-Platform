// AI search on the simpler screens (?simple=1; plan-seo-command-center-simplify-screens-like-mickaz.md, section 2, track T7),
// driven by hand like a normal user. The same ground as flow_ai_search.cjs, where each thing now lives: the head's sources
// chip and its Sources panel (per-source refresh, Check now, Google's AI report upload), four number cards, the weekly chart
// with its small print behind (i)s, next actions with Task on hover, one tabs card with Edit the AI list and Filter in its head
// and rows that open their panel, Google's AI report as a fifth tab, one AI Overviews line, Google Analytics failing then fixed
// by Refresh data, an old Clarity download, rows of 1, no AI Overview checks, 390 px, dark mode and French.
// Then the switch off again: the old screen comes back. Made-up sites only (tests/ui/seed_ai_search.py).
// Needs: DB_NAME_TEST=test_t7_p2_ai_test .venv/bin/python tests/ui/app_server.py --port 8461 --slow 0
// Usage: DB_NAME_TEST=test_t7_p2_ai_test SCREENS_URL=http://127.0.0.1:8461/ node tests/ui/flow_ai_search_simple.cjs [folder for screenshots]
const path = require("path");
const { execFileSync } = require("child_process");
const { open, menu } = require("./pw.cjs");

const ROOT = (process.env.SCREENS_URL || "http://127.0.0.1:8461/").replace(/[?#].*$/, "");
const SHOTS = process.argv[2];
const REPO = path.join(__dirname, "..", "..");
const seed = (mode) => execFileSync(path.join(REPO, ".venv", "bin", "python"), [path.join(__dirname, "seed_ai_search.py"), mode], { cwd: REPO, env: process.env, stdio: "pipe" });
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);

async function start({ width = 1440, height = 1000, theme = "light", lang = "en", host = "site-one.example", simple = "1", before = null } = {}) {
  const run = await open({ width: Math.max(width, 1200), height });
  const { page } = run;
  if (before) await before(page);
  await page.goto("about:blank"); await page.goto(`${ROOT}?simple=${simple}#ai`); await settle(page, 1800);
  if (theme === "dark") { await menu(page, "theme"); await settle(page, 300); await page.keyboard.press("Escape"); }
  if (lang === "fr") { await menu(page, "lang"); await settle(page, 300); await page.keyboard.press("Escape"); }
  if (host) {
    await page.click("#site-switch"); await settle(page, 300);
    await page.locator("[data-pick-site]", { hasText: host }).first().click();
  }
  if (width < 1200) { await page.setViewportSize({ width, height }); await settle(page, 600); }
  await settle(page, 2500);
  return run;
}
const shot = async (page, name, full = true) => {
  if (!SHOTS) return;
  if (full) { // #main scrolls inside the window: grow the window to the screen's height first
    const size = page.viewportSize();
    const h = await page.evaluate(() => document.querySelector("#main")?.scrollHeight || 0);
    if (h > size.height) { await page.setViewportSize({ width: size.width, height: Math.min(h + 40, 6000) }); await settle(page, 600); }
    await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    await page.setViewportSize(size); await settle(page, 300);
  } else await page.screenshot({ path: path.join(SHOTS, name) });
};
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");
const tip = (page, sel) => page.locator(sel).first().getAttribute("data-tip").then((v) => v || "").catch(() => "");
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
// A Google AI report, made up, answered instead of the server's.
const REPORT = (days) => ({ sites: [{ host: "site-one.example", period_start: days(-60), period_end: days(-3), period_known: true, impressions: 4321, pages_count: 3, uploaded_at: new Date().toISOString(), before: null,
  countries: [{ key: "FR", impressions: 3000 }], pages: [1, 2, 3].map((i) => ({ key: `https://site-one.example/made-up-page-${i}/`, impressions: 900 - i * 100 })) }] });
const dayFrom = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  seed("serpback"); seed("normal");

  // ---- normal data, as a person reads it ----
  let run = await start({ height: 1700 });
  let { page } = run;
  const calls = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) calls.push(r.url()); });
  const lead = await text(page, ".ai-answer .today-lead");
  check(/AI assistants sent \d+ visits and \d+ leads/.test(lead) && lead.includes("chatgpt.com"), `answer first: ${lead}`);
  check(await page.locator("#topbar.head").count() === 1, "the simpler head");
  const chip = await text(page, "#topbar [data-ai-sources]");
  check(chip.includes("4 sources up to date"), `the head's sources chip: ${chip}`);
  check(!(await visible(page, ".ai-sources-line")), "no sources line under the answer");
  check((await tip(page, "#topbar .head-line .info-i")).includes("Do AI assistants send you leads"), "the screen's sentence is behind the head's (i)");
  check(await page.locator(".ai-tiles .ncard").count() === 4, "four number cards");
  check((await text(page, '[data-card="ai-rate"] .ncard-sub')).includes("organic search"), "Lead rate says organic search under it");
  check(await page.locator('[data-card="ai-visits"] .ncard-graph').count() === 1, "AI visits has its weekly graph");
  check(await page.locator('[data-ai-half="ga4"] [data-lv-chart="ai-weeks"]').count() === 1 && await page.locator('[data-ai-half="clarity"] [data-lv-chart="ai-weeks-clarity"]').count() === 1, "each source draws its own chart");
  check((await tip(page, '[data-ai-half="clarity"] .ai-half-head .info-i')).includes("so far"), "Clarity's days read are behind its (i)");
  check(!(await page.locator(".ai-chart-foot, .ai-half-foot .ai-second").count()), "no small print under the charts");
  check((await tip(page, ".ai-chart .card-head .info-i")).includes("Second opinion"), "the second opinion is behind the chart's (i)");
  check((await page.locator(".ai-actions .rows > li").count()) <= 3, "at most three next actions");
  check(!(await page.locator(".ai-actions .rows .d").count()), "no grey second line in next actions");
  const taskOpacity = await page.locator(".ai-actions .row-act").first().evaluate((el) => getComputedStyle(el).opacity);
  check(taskOpacity === "0", `Task waits for hover (${taskOpacity})`);
  await page.locator(".ai-actions .rows > li").first().hover(); await settle(page, 400);
  check(await page.locator(".ai-actions .row-act").first().evaluate((el) => getComputedStyle(el).opacity) === "1", "Task shows on hover");
  check(!(await page.locator("[data-ai-menu]").count()) && await page.locator(".ai-split > [data-lv-collect]").count() === 1, "Refresh data is one button");
  check(!(await page.locator(".gai-upload").count()), "Google's AI report upload left the screen");
  check(!(await page.locator(".ai-limits").count()), "the closing note left the screen");
  check((await page.getAttribute(".ai-tabs-card [role=tab][aria-selected=true]", "data-ai-tab")) === "brand", "What AI says opens first (2026-11-20, track B)");
  await page.click('[data-ai-tab="assistants"]'); await settle(page, 500);
  check((await tip(page, ".ai-tabs-head .info-i")).includes("AI apps often send no referrer"), "the AI list's caveat is behind the tabs' (i)");
  check(await page.locator(".ai-tabs-head [data-ai-list]").count() === 1, "Edit the AI list sits in the tabs card's head");
  check(await page.locator(".ai-tabs-head .tt-in-head").count() === 1, "Filter sits in the tabs card's head");
  check(!(await page.locator(".ai-tab-lead").count()), "no line above the table");
  check(!(await visible(page, ".ai-tabs-card .tp-foot")), "no 1–5 of 5 under one page of rows");
  check((await text(page, '[data-ai-tab="assistants"]')).match(/\d/), "the tab carries its count");
  const aio = await text(page, ".ai-aio");
  check(/AI Overviews on \d+ of \d+ keywords checked/.test(aio) && !(await page.locator(".ai-aio [data-ai-aio-check], .ai-aio .ai-chip").count()), `one AI Overviews line: ${aio.replace(/\s+/g, " ")}`);
  check(!calls.some((u) => /refresh\/preview/.test(u)), "the check's price isn't asked until Check now");
  const count = await page.evaluate(() => {
    const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false; let o = 1; for (let n = el; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden") return false; o *= Number(s.opacity); } return o > 0.05; };
    // A row's tick box stays faintly visible since 2026-11-12 (UI critique: hidden ones weren't discovered); it isn't counted here.
    const rowTick = (el) => el.matches('tbody :is(.tt-pick, .tt-own-pick) input[type="checkbox"]');
    return [...document.querySelector("#main").querySelectorAll("button,select,input,textarea,a[href],summary,[role=button],[role=tab]")].filter((el) => !rowTick(el)).filter(shown).length;
  });
  // 29 on 4bab519 already (one over); What AI says adds its tab (2026-11-20); Page types its tab and "What AI says about you ›" its link (track B).
  check(count <= 32, `about 30 controls at rest: ${count}`);
  await shot(page, "simple.png");

  for (const tab of ["pages", "cited", "questions"]) {
    await page.click(`[data-ai-tab="${tab}"]`); await settle(page, 500);
    const most = tab === "pages" ? 5 : 4; // Landing pages: Google clicks beside AI visits (track B)
    check((await page.locator(".ai-tabs-card th:not(.tt-pick)").count()) <= most, `${tab}: ${most} columns at most`);
    check(!(await page.locator(".ai-tab-lead:not(.ai-cnv-line)").count()) || tab === "pages", `${tab}: its small print is behind the (i)`);
    if (SHOTS) await page.locator(".ai-tabs-card").screenshot({ path: path.join(SHOTS, `simple-tab-${tab}.png`) }).catch(() => {});
  }
  check((await page.locator(".ai-tabs-card a.lv-url, .ai-tabs-card .lv-url a").count()) > 0, "page paths are links");
  await page.focus('[data-ai-tab="brand"]'); await page.keyboard.press("ArrowRight"); await settle(page, 300); // from the last tab, What AI says (2026-11-20)
  check((await page.getAttribute('[data-ai-tab="assistants"]', "aria-selected")) === "true", "arrow keys move between tabs");

  // a row opens its panel: an assistant, then a landing page; Escape gives the row its focus back
  await page.locator('.ai-tabs-card tr[data-rp-open="assistant"] td:nth-child(3)').first().click(); await settle(page, 2000);
  check(await page.locator('#panel[data-rp="assistant"], #panel [data-rp="assistant"]').count() > 0 && (await text(page, "#panel")).includes("chatgpt.com"), "an assistant's row opens its panel");
  await shot(page, "simple-assistant-panel.png", false);
  await page.keyboard.press("Escape"); await settle(page, 500);
  check(!(await page.locator("#panel").count()) || !(await visible(page, "#panel")), "Escape closes it");
  check(await page.evaluate(() => document.activeElement?.matches?.('tr[data-rp-open="assistant"]')), "focus goes back to the row");
  await page.click('[data-ai-tab="pages"]'); await settle(page, 500);
  await page.locator('.ai-tabs-card tr[data-rp-open="page"] td:nth-child(3)').first().click(); await settle(page, 2000);
  check((await text(page, "#panel")).includes("/"), "a landing page's row opens its panel");
  await page.keyboard.press("Escape"); await settle(page, 500);
  await page.click('[data-ai-tab="assistants"]'); await settle(page, 400);

  // the sources panel, from the head's chip: each source, its own refresh, and Google's AI report upload
  await page.click("#topbar [data-ai-sources]"); await settle(page, 1200);
  check((await page.locator("#panel .ai-src").count()) === 5, "sources panel: one row per source, and Google's AI report");
  check(await page.locator('#panel [data-lv-collect-sources="ga4,gsc"]').count() === 1, "Google Analytics can be read again from Sources");
  check(await page.locator('#panel [data-lv-collect-sources="clarity"]').isDisabled(), "Clarity live is off until 00:00 UTC once read today");
  check((await text(page, "#gai-src")).includes("Generative AI"), "how to export Google's AI report is in Sources");
  check(await page.locator("#gai-src [data-gai-file]").count() === 1, "and its upload");
  await shot(page, "simple-sources-panel.png", false);
  // Check now: the line asks before spending
  await page.click("#panel [data-ai-aio-focus]"); await settle(page, 3500);
  const asked = await text(page, ".ai-aio");
  check(calls.some((u) => /refresh\/preview/.test(u)), "Check now asks the price");
  check(/Check now · |All checked in the last/.test(asked) || await page.locator("[data-ai-aio-go]").count() === 1, `the AI Overviews line shows the check with its price: ${asked.replace(/\s+/g, " ")}`);
  if (await page.locator("[data-ai-aio-cancel]").count()) { await page.click("[data-ai-aio-cancel]"); await settle(page, 400); }

  // the AI list, from the tabs card's head: add one, take it off again
  await page.click(".ai-tabs-head [data-ai-list]"); await settle(page, 600);
  await page.fill('#panel [name="f_pattern"]', "assistant-one.example"); await page.keyboard.press("Enter"); await settle(page, 1500);
  check((await text(page, "#ai-list-body")).includes("assistant-one.example"), "a site added to the AI list shows");
  await page.click('#panel [aria-label="Take assistant-one.example off the list"]'); await settle(page, 1500);
  check(!(await text(page, "#ai-list-body")).includes("assistant-one.example"), "and goes again");
  await page.click("#panel [data-close-panel]"); await settle(page, 600);

  // Make a task, then Open task
  await page.locator(".ai-actions .rows > li").first().hover();
  const first = page.locator(".ai-actions [data-task-find]").first();
  const before = await first.innerText();
  await first.click(); await settle(page, 700);
  check(await page.locator("#task-form").isVisible(), `"${before}" opens a filled task`);
  await page.click("#task-save"); await settle(page, 1500);
  const after = await page.locator(".ai-actions [data-task-find]").first().innerText();
  check(after === "Open task", `then the button says ${after}`);
  check(!run.problems.filter((p) => !p.includes("404")).length, `no page errors: ${run.problems.join(" | ")}`);
  await run.browser.close();

  // ---- Google's AI report, once uploaded: a fifth tab ----
  run = await start({ height: 1300, before: (p) => p.route(/\/api\/search\/ai-report(\?.*)?$/, (route) => (route.request().method() !== "GET" ? route.fulfill({ json: { period_start: dayFrom(-60), period_end: dayFrom(-3), replaced: false } }) : route.fulfill({ json: REPORT(dayFrom) }))) });
  page = run.page;
  await page.waitForSelector('[data-ai-tab="report"]', { timeout: 8000 }).catch(() => {});
  check(await page.locator('[data-ai-tab="report"]').count() === 1, "an uploaded report is a fifth tab");
  await page.click('[data-ai-tab="report"]'); await settle(page, 600);
  check((await text(page, ".ai-tabs-card [role=tabpanel]")).includes("4,321"), "the tab shows the report");
  if (SHOTS) await page.locator(".ai-tabs-card").screenshot({ path: path.join(SHOTS, "simple-tab-report.png") }).catch(() => {});
  await page.click("#topbar [data-ai-sources]"); await settle(page, 1200);
  check((await text(page, "#gai-src")).includes("4,321"), "Sources says what is in");
  await page.setInputFiles("#gai-src [data-gai-file]", { name: "report.zip", mimeType: "application/zip", buffer: Buffer.from("made up") }); await settle(page, 1500);
  check(await visible(page, "#panel") && (await text(page, "#gai-src")).length > 0, "an upload keeps the panel open");
  check(!run.problems.filter((p) => !p.includes("404")).length, `no page errors: ${run.problems.join(" | ")}`);
  await run.browser.close();

  // ---- narrow, dark, French ----
  for (const [opts, name] of [[{ width: 390, height: 2600 }, "simple-390.png"], [{ theme: "dark", height: 1700 }, "simple-dark.png"], [{ lang: "fr", height: 1700 }, "simple-fr.png"], [{ width: 390, height: 2600, theme: "dark", lang: "fr" }, "simple-390-dark-fr.png"]]) {
    run = await start(opts); page = run.page;
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(wide <= 1, `${name}: no sideways scroll (${wide})`);
    if (opts.width === 390) {
      check(await visible(page, ".ai-answer [data-ai-sources]"), `${name}: the head's line is cut, so the sources chip shows under the answer`);
      await page.click(".ai-answer [data-ai-sources]"); await settle(page, 900);
      check((await page.locator("#panel .ai-src").count()) >= 4, `${name}: and opens Sources`);
      await shot(page, name.replace(".png", "-sources.png"), false);
      await page.click("#panel [data-close-panel]"); await settle(page, 600);
    }
    if (opts.lang === "fr") {
      check((await text(page, ".ai-answer .today-lead")).startsWith("Les assistants IA"), `${name}: French answer`);
      check((await text(page, "#topbar [data-ai-sources]")).includes("sources à jour"), `${name}: French sources chip`);
      await page.click('[data-ai-tab="assistants"]'); await settle(page, 500); // What AI says opens first and has no AI list
      check((await text(page, ".ai-tabs-head [data-ai-list]")).includes("Modifier la liste IA"), `${name}: French Edit the AI list`);
    }
    await shot(page, name);
    await run.browser.close();
  }

  // ---- Google Analytics failing, then Refresh fixes it without a reload ----
  seed("ga4fail");
  run = await start({ height: 1500 }); page = run.page;
  const bad = await text(page, "#topbar [data-ai-sources]");
  check(await page.locator("#topbar .head-status.crit[data-ai-sources]").count() === 1 && bad.includes("stopped working"), `failing: a red chip in the head: ${bad}`);
  check((await page.locator(".ai-tiles .ncard").count()) === 4 && /\d/.test(await text(page, ".ai-tiles .ncard .ncard-fig")), "the cards keep their last good numbers");
  await shot(page, "simple-ga4-failing.png");
  await page.click(".ai-split > [data-lv-collect]");
  await page.waitForFunction(() => window.LV.reading, null, { timeout: 15000, polling: 100 }).catch(() => {});
  check(/Reading \d of \d/.test(await text(page, ".ai-split [data-lv-collect-word]")), "Refresh says Reading N of M");
  await page.waitForFunction(() => document.querySelector('[data-ai-chip-run="ga4"]')?.textContent, null, { timeout: 15000, polling: 200 }).catch(() => {});
  check(/queued|reading|✓/.test(await text(page, '[data-ai-chip-run="ga4"]')), `the chart's chip follows the read: ${await text(page, '[data-ai-chip-run="ga4"]')}`);
  await page.waitForFunction(() => !window.LV.reading, null, { timeout: 180000, polling: 1000 }).catch(() => {});
  await settle(page, 3500);
  check(!(await page.locator("#topbar .head-status.crit, .ai-chip.crit").count()), "after Refresh the red chip is gone, with no reload");
  await shot(page, "simple-ga4-fixed.png", false);
  await run.browser.close();

  // ---- an old Clarity download, and Clarity live read 55 h ago ----
  seed("normal"); seed("oldclarity");
  run = await start({ height: 1500 }); page = run.page;
  const old = await text(page, "#topbar [data-ai-sources]");
  check(await page.locator("#topbar .head-status.warn[data-ai-sources]").count() === 1 && old.includes("2 sources need you"), `old download and old live read: an amber chip: ${old}`);
  await page.click("#topbar [data-ai-sources]"); await settle(page, 1000);
  check((await text(page, "#panel")).includes("data lost in"), "Sources says when Clarity live's data is lost");
  await shot(page, "simple-old-clarity.png", false);
  await run.browser.close();

  // ---- every cited page cited once ----
  seed("ones");
  run = await start({ height: 1300 }); page = run.page;
  await page.click('[data-ai-tab="cited"]'); await settle(page, 500);
  const sentence = await text(page, ".ai-fold-all");
  check(/Copilot cited \d+ pages once each; none stands out yet/.test(sentence), `rows of 1 become a sentence: ${sentence}`);
  await page.click(".ai-fold-all [data-ai-fold]"); await settle(page, 400);
  check((await page.locator(".ai-tabs-card tbody tr").count()) > 0, "Show them shows the rows");
  await run.browser.close();

  // ---- no AI Overview checks ----
  seed("normal"); seed("noserp");
  run = await start({ height: 1300 }); page = run.page;
  const none = await text(page, ".ai-aio");
  check(none.includes("No keywords tracked, so no AI Overview checks yet"), `no checks: ${none.replace(/\s+/g, " ")}`);
  if (SHOTS) await page.locator(".ai-aio").screenshot({ path: path.join(SHOTS, "simple-no-serpapi.png") }).catch(() => {});
  await run.browser.close();
  seed("serpback");

  // ---- the switch off: the old screen, as it was ----
  run = await start({ height: 1300, simple: "0" }); page = run.page;
  const back = await page.evaluate(() => [".ai-sources-line", "[data-ai-menu]", ".ai-limits"].map((sel) => document.querySelectorAll(sel).length));
  check(back.every((n) => n === 1), `switch off: the sources line, the split Refresh and the closing note are back (${back})`);
  check(!(await page.locator(".ncard, tr[data-rp-open]").count()), "switch off: no number cards or row panels");
  await run.browser.close();

  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
