// AI search, driven by hand like a normal user: the answer, the chips, the tabs, folded rows of 1, the sources panel, the
// split Refresh, the AI list, Make a task then Open task, Google Analytics failing then fixed with Refresh, an old Clarity
// download, no AI Overview checks, 390 px, dark mode and French. Made-up sites only (tests/ui/seed_ai_search.py).
// Needs: DB_NAME_TEST=test_aisearch2ui_test .venv/bin/python tests/ui/app_server.py --port 8247 --slow 0
// Usage: DB_NAME_TEST=test_aisearch2ui_test SCREENS_URL=http://127.0.0.1:8247/ node tests/ui/flow_ai_search.cjs [folder for screenshots]
const path = require("path");
const { execFileSync } = require("child_process");
const { open, menu } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8247/";
const SHOTS = process.argv[2];
const REPO = path.join(__dirname, "..", "..");
const seed = (mode) => execFileSync(path.join(REPO, ".venv", "bin", "python"), [path.join(__dirname, "seed_ai_search.py"), mode], { cwd: REPO, env: process.env, stdio: "pipe" });
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);

async function start({ width = 1440, height = 1000, theme = "light", lang = "en", host = "site-one.example" } = {}) {
  const run = await open({ width: Math.max(width, 1200), height }); // the site menu is picked wide, then the window narrows
  const { page } = run;
  await page.goto("about:blank"); await page.goto(`${ROOT}#ai`); await settle(page, 1800);
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
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: full }); };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");

(async () => {
  seed("serpback"); seed("normal");

  // ---- normal data, as a person reads it ----
  let run = await start({ height: 1700 });
  let { page } = run;
  const lead = await text(page, ".ai-answer .today-lead");
  check(/AI assistants sent \d+ visits( \([^)]*\))? and \d+ leads/.test(lead) && lead.includes("chatgpt.com"), `answer first: ${lead}`);
  check((await page.locator(".ai-tiles .tile").count()) === 4, "four numbers");
  check((await text(page, '[data-ai-half="ga4"] h3')).includes("Google Analytics") && (await text(page, '[data-ai-half="clarity"] h3')).includes("Clarity"), "the weekly card has one part per source");
  check(await page.locator('[data-ai-half="ga4"] [data-lv-chart="ai-weeks"]').count() === 1 && await page.locator('[data-ai-half="clarity"] [data-lv-chart="ai-weeks-clarity"]').count() === 1, "each part draws its own chart");
  check(await page.locator('[data-lv-chart="ai-weeks-clarity"] .lv-lone').count() >= 1, "a Clarity week alone between gaps still shows as a dot");
  check(/so far/.test(await text(page, '[data-ai-half="clarity"] .ai-half-foot')), "Clarity says how many days it has read");
  check(!(await page.locator("text=Share of all visits").count()), "share of all visits is gone");
  check((await page.locator(".ai-actions .rows > li").count()) <= 3, "at most three next actions");
  check((await text(page, ".ai-sources-line")).includes("All 4 sources up to date"), "sources line says all is well");
  check((await page.getAttribute(".ai-tabs-card [role=tab][aria-selected=true]", "data-ai-tab")) === "brand", "What AI says opens first (track B, 2026-11-20)");
  await page.click('[data-ai-tab="assistants"]'); await settle(page, 500);
  check((await page.locator("th", { hasText: "Engaged" }).count()) === 1, "an engaged visits column (GA4 engagedSessions, track B)");
  await shot(page, "after.png");

  for (const [tab, name] of [["pages", "after-tab-pages.png"], ["cited", "after-tab-cited.png"], ["questions", "after-tab-questions.png"]]) {
    await page.click(`[data-ai-tab="${tab}"]`); await settle(page, 500);
    const most = tab === "pages" ? 5 : 4; // Landing pages: Google clicks beside AI visits (track B)
    check((await page.locator(".ai-tabs-card th:not(.tt-pick)").count()) <= most, `${tab}: ${most} columns at most`);
    await page.locator(".ai-tabs-card").screenshot({ path: SHOTS ? path.join(SHOTS, name) : undefined }).catch(() => {});
  }
  check((await page.locator(".ai-tabs-card .lv-url").count()) > 0 && (await page.locator(".ai-tabs-card a.lv-url, .ai-tabs-card .lv-url a, a.lv-url").count()) > 0, "page paths are links");
  // keyboard: arrows move between tabs
  await page.focus('[data-ai-tab="brand"]'); await page.keyboard.press("ArrowRight"); await settle(page, 300);
  check((await page.getAttribute('[data-ai-tab="assistants"]', "aria-selected")) === "true", "arrow keys move between tabs");

  // the split Refresh: its menu, then Escape
  await page.click("[data-ai-menu]"); await settle(page, 300);
  check(await page.locator("#ai-refresh-menu").isVisible(), "Refresh menu opens");
  check((await text(page, "#ai-refresh-menu")).includes("Clarity live"), "menu lists Clarity live");
  check(await page.locator('#ai-refresh-menu [data-lv-collect-sources="clarity"]').isDisabled(), "Clarity live is off until 00:00 UTC once read today");
  await shot(page, "after-refresh-menu.png", false);
  await page.keyboard.press("Escape"); await settle(page, 300);
  check(!(await page.locator("#ai-refresh-menu").count()), "Escape closes the menu");

  // the sources panel
  await page.locator("[data-ai-sources]:visible").first().click(); await settle(page, 700);
  check((await page.locator("#panel .ai-src").count()) === 4, "sources panel: one row per source");
  await shot(page, "after-sources-panel.png", false);
  await page.click("#panel [data-close-panel]"); await settle(page, 400);

  // the AI list, behind its link: add one, take it off again
  await page.click("[data-ai-list]"); await settle(page, 600);
  await page.fill('#panel [name="f_pattern"]', "assistant-one.example"); await page.keyboard.press("Enter"); await settle(page, 1500);
  check((await text(page, "#ai-list-body")).includes("assistant-one.example"), "a site added to the AI list shows");
  await shot(page, "after-ai-list.png", false);
  await page.click('#panel [aria-label="Take assistant-one.example off the list"]'); await settle(page, 1500);
  check(!(await text(page, "#ai-list-body")).includes("assistant-one.example"), "and goes again");
  await page.click("#panel [data-close-panel]"); await settle(page, 400);

  // Make a task, then Open task
  const first = page.locator(".ai-actions [data-task-find]").first();
  const before = await first.innerText();
  await first.click(); await settle(page, 700);
  check(await page.locator("#task-form").isVisible(), `"${before}" opens a filled task`);
  await page.click("#task-save"); await settle(page, 1500);
  const after = await page.locator(".ai-actions [data-task-find]").first().innerText();
  check(after === "Open task", `then the button says ${after}`);
  await page.locator(".ai-actions [data-task-find]").first().click(); await settle(page, 800);
  await shot(page, "after-open-task.png", false);
  check(await page.locator("#panel").isVisible(), "Open task opens it");
  check(!run.problems.filter((p) => !p.includes("404")).length, `no page errors: ${run.problems.join(" | ")}`);
  await run.browser.close();

  // ---- narrow, dark, French ----
  for (const [opts, name] of [[{ width: 390, height: 2600 }, "after-390.png"], [{ theme: "dark", height: 1700 }, "after-dark.png"], [{ lang: "fr", height: 1700 }, "after-fr.png"]]) {
    run = await start(opts); page = run.page;
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(wide <= 1, `${name}: no sideways scroll (${wide})`);
    if (opts.lang === "fr") check((await text(page, ".ai-answer .today-lead")).startsWith("Les assistants IA"), "French answer");
    if (opts.width === 390) check(await page.locator(".ai-only-narrow").first().isVisible(), "390: sources line is one chip");
    await shot(page, name);
    await run.browser.close();
  }

  // ---- Google Analytics failing, then Refresh fixes it without a reload ----
  seed("ga4fail");
  run = await start({ height: 1500 }); page = run.page;
  check((await page.locator(".ai-chip.crit").count()) > 0, "failing: a red chip");
  check((await text(page, ".ai-sources-line")).includes("stopped working"), "the sources line says what stopped");
  check((await page.locator(".ai-tiles .tile").count()) === 4 && /\d/.test(await text(page, ".ai-tiles .tile .fig")), "the cards keep their last good numbers");
  await shot(page, "after-ga4-failing.png");
  await page.click(".ai-split > [data-lv-collect]");
  await page.waitForFunction(() => window.LV.reading, null, { timeout: 15000, polling: 100 }).catch(() => {});
  check(/Reading \d of \d/.test(await text(page, ".ai-split [data-lv-collect-word]")), "Refresh says Reading N of M");
  await page.waitForFunction(() => document.querySelector('[data-ai-chip-run="ga4"]')?.textContent, null, { timeout: 15000, polling: 200 }).catch(() => {});
  check(/queued|reading|✓/.test(await text(page, '[data-ai-chip-run="ga4"]')), `the chip follows the read: ${await text(page, '[data-ai-chip-run="ga4"]')}`);
  await page.waitForFunction(() => !window.LV.reading, null, { timeout: 180000, polling: 1000 }).catch(() => {});
  await settle(page, 2500);
  check(!(await page.locator(".ai-chip.crit").count()), "after Refresh the red chip is gone, with no reload");
  await shot(page, "after-ga4-fixed.png", false);
  await run.browser.close();

  // ---- an old Clarity download, and Clarity live read 55 h ago ----
  seed("normal"); seed("oldclarity");
  run = await start({ height: 1500 }); page = run.page;
  check((await page.locator(".ai-sources-line .ai-chip.warn").count()) >= 2, "old download and old live read: amber chips");
  check((await text(page, ".ai-sources-line")).includes("data lost in"), "Clarity live says when its data is lost");
  await shot(page, "after-old-clarity.png");
  await run.browser.close();

  // ---- every cited page cited once ----
  seed("ones");
  run = await start({ height: 1300 }); page = run.page;
  await page.click('[data-ai-tab="cited"]'); await settle(page, 500);
  const sentence = await text(page, ".ai-fold-all");
  check(/Copilot cited \d+ pages once each; none stands out yet/.test(sentence), `rows of 1 become a sentence: ${sentence}`);
  await page.locator(".ai-tabs-card").screenshot({ path: SHOTS ? path.join(SHOTS, "after-rows-of-one.png") : undefined });
  await page.click(".ai-fold-all [data-ai-fold]"); await settle(page, 400);
  check((await page.locator(".ai-tabs-card tbody tr").count()) > 0, "Show them shows the rows");
  await run.browser.close();

  // ---- no AI Overview checks ----
  seed("normal"); seed("noserp");
  run = await start({ height: 1300 }); page = run.page;
  const aio = await text(page, ".ai-aio");
  check(aio.includes("No keywords tracked, so no AI Overview checks yet"), `no checks: ${aio.replace(/\s+/g, " ")}`);
  await page.locator(".ai-aio").screenshot({ path: SHOTS ? path.join(SHOTS, "after-no-serpapi.png") : undefined });
  await run.browser.close();
  seed("serpback");

  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
