// AI search → What AI says, driven by hand like a normal user, on the harness's fake Bright Data and Semscraper
// (tests/ui/fake_ai_brand.py) and fake Claude: nothing leaves the Mac and nothing is spent.
// No key: the tab says which key to paste and opens Settings. Keys pasted: no questions yet, so Suggest questions; the panel
// adds them, edits one, unticks one. Ask the AIs shows the count and the price first; unticking an AI changes it; Ask now.
// The answers arrive (the job comes back every 30 s): one line per AI, sources with yours marked You, the raw answers
// with "Pick an AI in Settings". Then Claude picked for the site, a second run: summaries, tone, pros and cons, and Since
// the last run. A line opens the AI's answers. 1600 px and 390 px (one card per AI), English and French, no console errors,
// no sideways scroll.
// Needs: DB_NAME_TEST=seo_cc_f_test .venv/bin/python tests/ui/app_server.py --port 8471 --slow 0 --fake-claude
// Usage: SCREENS_URL=http://127.0.0.1:8471/ node tests/ui/flow_ai_brand.cjs [folder for screenshots]
const path = require("path");
const { open, menu } = require("./pw.cjs");

const ROOT = (process.env.SCREENS_URL || "http://127.0.0.1:8471/").replace(/[?#].*$/, "");
const SHOTS = process.argv[2];
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");
const sideways = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, (document.querySelector("#main")?.scrollWidth || 0) - (document.querySelector("#main")?.clientWidth || 0)));

async function start({ width = 1600, height = 1200, lang = "en" } = {}) {
  const run = await open({ width: Math.max(width, 1200), height });
  const { page } = run;
  // The harness has no login, so /api/auth/me answers 404 on every page: that one is expected. Any other failure counts.
  run.bad = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me") && !/favicon|\/logos\//.test(r.url())) run.bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${ROOT}?simple=1#ai`); await settle(page, 1800);
  if (lang === "fr") { await menu(page, "lang"); await settle(page, 300); await page.keyboard.press("Escape"); }
  await page.click("#site-switch"); await settle(page, 300);
  await page.locator("[data-pick-site]", { hasText: "site-one.example" }).first().click(); await settle(page, 1500);
  if (width < 1200) { await page.setViewportSize({ width, height }); await settle(page, 600); }
  await page.click('[data-ai-tab="brand"]'); await settle(page, 1800);
  return run;
}
const shot = async (page, name, sel = null) => {
  if (!SHOTS) return;
  if (sel) { await page.locator(sel).first().screenshot({ path: path.join(SHOTS, name) }).catch(() => {}); return; }
  const size = page.viewportSize();
  const h = await page.evaluate(() => document.querySelector("#main")?.scrollHeight || 0);
  if (h > size.height) { await page.setViewportSize({ width: size.width, height: Math.min(h + 40, 6000) }); await settle(page, 600); }
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  await page.setViewportSize(size); await settle(page, 300);
};
const apiCall = (page, method, url, body) => page.evaluate(([m, u, b]) => window.COMP.api(m, u, b), [method, url, body]);
async function waitForAnswers(page, label) {
  const ok = await page.waitForFunction(() => window.AIBrand?.data?.last && !window.AIBrand.data.running, null, { timeout: 180000, polling: 1000 }).then(() => true).catch(() => false);
  check(ok, `${label}: the answers arrived`);
  await settle(page, 1500);
}

(async () => {
  // ---- no key yet ----
  let run = await start();
  let { page } = run;
  const siteId = await page.evaluate(() => window.UI.siteIdPicked());
  // Start clean: a harness kept from an earlier try has questions and runs.
  const before = await apiCall(page, "GET", `ai-brand?site_id=${siteId}`);
  for (const q of before.questions) await apiCall(page, "DELETE", `ai-brand/questions/${q.id}`);
  for (const k of ["brightdata_ai", "semscraper"]) await apiCall(page, "DELETE", `app-keys/${k}`).catch(() => {});
  await apiCall(page, "PUT", "insights/ai", { sites: [{ id: siteId, provider: "none" }] });
  check(await page.locator('[data-ai-tab="brand"]').count() === 1, "a fifth tab: What AI says");
  if (!before.last) {
    await page.reload(); await settle(page, 1500);
    await page.click("#site-switch"); await settle(page, 300);
    await page.locator("[data-pick-site]", { hasText: "site-one.example" }).first().click(); await settle(page, 1500);
    await page.click('[data-ai-tab="brand"]'); await settle(page, 1800);
    const empty = await text(page, ".ab-empty");
    check(empty.includes("Bright Data AI scrapers") && empty.includes("Semscraper"), `no key: says which key to paste: ${empty.replace(/\s+/g, " ").slice(0, 120)}`);
    check(await page.locator('.ab-empty [data-lv-connect="brightdata_ai"]').count() === 1 && await page.locator('.ab-empty [data-lv-connect="semscraper"]').count() === 1, "and links Settings for each");
    await shot(page, "brand-no-key.png", ".ai-tabs-card");
    await page.click('.ab-empty [data-lv-connect="semscraper"]'); await settle(page, 1200);
    check((await text(page, "#panel")).includes("Semscraper"), "Connect opens Semscraper's connection panel");
    await shot(page, "brand-semscraper-settings.png", "#panel");
    await page.keyboard.press("Escape"); await settle(page, 600);
    if (await page.evaluate(() => window.UI.state.route) !== "ai") { await page.goBack(); await settle(page, 1500); }
    if (!(await page.locator('[data-ai-tab="brand"][aria-selected="true"]').count())) { await page.click('[data-ai-tab="brand"]'); await settle(page, 1000); }
  }

  // ---- keys pasted (the fake accepts any), no questions ----
  await apiCall(page, "PUT", "app-keys/brightdata_ai", { key: "fake-bright-key-1234" });
  await apiCall(page, "PUT", "app-keys/semscraper", { key: "fake-sem-key-1234" });
  await page.evaluate(() => window.AIBrand.load({ force: true })); await settle(page, 1500);
  check((await text(page, ".ai-tabs-card")).includes("Add the questions to ask"), "no questions: asks for some");
  await page.click("[data-ab-suggest-first]"); await settle(page, 1800);
  const sugs = await page.locator("#panel .ab-sug li").count();
  check(sugs >= 4, `Suggest questions offers ${sugs}`);
  check((await text(page, "#panel .ab-sug")).includes("Site One"), "suggestions name the brand");
  await shot(page, "brand-suggestions.png", "#panel");
  await page.click("#panel [data-ab-sug-all]"); await settle(page, 2500);
  check(await page.locator("#panel .ab-q").count() === sugs, "Add all puts them in the list");
  await page.fill("#panel [data-ab-add] input", "Which coffee subscription would you pick in France?");
  await page.click("#panel [data-ab-add] button"); await settle(page, 1500);
  check(await page.locator("#panel .ab-q").count() === sugs + 1, "an own question is added");
  // keep the run short: three questions asked
  const boxes = page.locator("#panel [data-ab-q-active]");
  for (let i = (await boxes.count()) - 1; i >= 2; i -= 1) { await boxes.nth(i).uncheck(); await settle(page, 700); }
  const first = page.locator("#panel [data-ab-q-text]").first();
  await first.fill("Que pensez-vous de Site One ?"); await first.press("Tab"); await settle(page, 1200);
  check((await page.locator("#panel [data-ab-q-text]").first().inputValue()) === "Que pensez-vous de Site One ?", "a question is edited in place");
  await page.click("#panel [data-close-panel]"); await settle(page, 1200);
  const headWords = await text(page, ".ab-head");
  check(/2 questions/.test(headWords), `the tab says what's asked: ${headWords.replace(/\s+/g, " ")}`);

  // ---- the price first ----
  await page.click("[data-ab-ask]"); await settle(page, 1800);
  const price = await text(page, ".ab-confirm");
  check(/This asks 2 questions to 5 AIs: 10 answers/.test(price) && price.includes("$0.0120") && price.includes("€0.0006"), `the count and price show first: ${price.replace(/\s+/g, " ")}`);
  await shot(page, "brand-confirm.png", ".ai-tabs-card");
  await page.uncheck('[data-ab-pick="perplexity"]'); await settle(page, 500);
  check((await text(page, ".ab-confirm")).includes("8 answers") && (await text(page, ".ab-confirm")).includes("$0.0090"), "unticking an AI changes the price");
  await page.click("[data-ab-go]"); await settle(page, 1500);
  check(await page.locator(".ab-head .ai-chip.busy").count() === 1, "asking: the tab shows progress");
  await shot(page, "brand-asking.png", ".ai-tabs-card");
  await waitForAnswers(page, "first run");
  const lines = await page.locator(".ab-ais > li").count();
  check(lines === 4, `one line per AI asked: ${lines}`);
  check((await text(page, ".ab-ais")).includes("Names you"), "a line says the AI names you");
  check((await text(page, ".ab-reader")).includes("Pick an AI in Settings"), "no AI chosen: one line says to pick one");
  check(await page.locator(".ab-ai-said.muted").count() > 0, "the raw answer shows instead of a summary");
  const you = await page.locator("#ab-sources-table .who-you, .ab-sec .who-you").count();
  check(you >= 1, "my site is marked You in the sources");
  check(await page.locator(".ab-sec a.ab-src-link[href^='https://']").count() >= 3, "each source is a link");
  check((await text(page, ".ab-note")).includes("read signed out on"), "the signed-out note");
  await shot(page, "brand-first-run-1600.png");

  // ---- Claude reads the answers; a second run ----
  await apiCall(page, "PUT", "app-keys/anthropic", { key: "sk-ant-fake-1234" });
  await apiCall(page, "PUT", "insights/ai", { sites: [{ id: siteId, provider: "claude" }] });
  await page.evaluate(() => window.AIBrand.load({ force: true })); await settle(page, 1500);
  await page.click("[data-ab-ask]"); await settle(page, 1800);
  await page.uncheck('[data-ab-pick="perplexity"]'); await settle(page, 400);
  await page.click("[data-ab-go]"); await settle(page, 1500);
  await waitForAnswers(page, "second run");
  await page.waitForFunction(() => (window.AIBrand.data.last?.id || 0) > 1 && document.querySelector(".ab-ai-said:not(.muted)"), null, { timeout: 30000 }).catch(() => {});
  check(!(await page.locator(".ab-reader").count()), "with an AI chosen, the line goes");
  check((await text(page, ".ab-ais")).match(/Positive|Negative|Mixed/), "a tone shows");
  check(await page.locator(".ab-pc-card").count() >= 1, "pros and cons per AI");
  check((await text(page, ".ab-sec:last-of-type, .ab-sec")).length > 0 && /Since the last run/.test(await text(page, ".ai-tabs-card")), "since the last run");
  check(await sideways(page) <= 1, "1600 px: no sideways scroll");
  await shot(page, "brand-1600.png");
  await page.locator('[data-ab-open="chatgpt"]').click(); await settle(page, 1200);
  const panel = await text(page, "#panel");
  check(panel.includes("ChatGPT") && panel.includes("The full answer") && panel.includes("Read signed out"), "a line opens the AI's answers");
  check(await page.locator("#panel .who-you").count() >= 1, "the panel marks my source You too");
  await shot(page, "brand-panel-chatgpt.png", "#panel");
  await page.keyboard.press("Escape"); await settle(page, 600);
  const problems = [...run.problems.filter((p) => !/status of 404/.test(p)), ...run.bad];
  check(!problems.length, `no console errors: ${problems.join(" | ")}`);
  await run.browser.close();

  // ---- a phone, and French ----
  for (const [opts, name] of [[{ width: 390, height: 2400 }, "brand-390.png"], [{ lang: "fr", height: 1600 }, "brand-fr-1600.png"], [{ width: 390, height: 2400, lang: "fr" }, "brand-fr-390.png"]]) {
    run = await start(opts); page = run.page;
    await settle(page, 1500);
    check(await sideways(page) <= 1, `${name}: no sideways scroll (${await sideways(page)})`);
    if (opts.width === 390) {
      const cards = await page.locator(".ab-ais > li").evaluateAll((els) => els.map((el) => getComputedStyle(el).borderTopWidth));
      check(cards.length === 4 && cards.every((w) => w !== "0px"), `${name}: one card per AI`);
    }
    if (opts.lang === "fr") {
      const all = await text(page, ".ai-tabs-card");
      check(all.includes("Ce que dit l'IA") && all.includes("Ce que dit chaque IA") && all.includes("Les sources citées par les IA") && all.includes("lue sans compte"), `${name}: French words`);
      check(!/What each AI says|Sources the AIs cite|Ask again|read signed out/.test(all), `${name}: no English left`);
    }
    const problems2 = [...run.problems.filter((p) => !/status of 404/.test(p)), ...run.bad];
    check(!problems2.length, `${name}: no console errors ${problems2.join(" | ")}`);
    await shot(page, name);
    await run.browser.close();
  }
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
