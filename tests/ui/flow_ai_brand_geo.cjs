// What AI says, GEO round, driven by hand like a normal user on the harness's fake Bright Data, Semscraper and Claude
// (tests/ui/fake_ai_brand.py, fake_claude.py): nothing leaves the Mac and nothing is spent.
// The name is still a guess: one prompt says so and saves the real one. Suggest questions offers one head-to-head question
// per followed competitor, tagged "You or them"; Add all. Ask the AIs shows the count, says how many are head-to-head, and the
// price, first. When the answers are in: "On your site?" marks on every point (a Said point links its page, a Missing point has
// a Task), the ring with Said / Hinted / Missing; "You or them?" has one row per competitor with its logo, who the AIs pick,
// "1st reading", x / y; a row opens both sides in a wide panel with real source links and the answers. Check again re-checks.
// A second run: the trend says Same. The AI switch changes the pick to that AI's. 1600 px and 390 px, English and French,
// no console errors, no sideways scroll.
// Needs: DB_NAME_TEST=test_mzgeoui_test .venv/bin/python tests/ui/app_server.py --port 8301 --slow 0 --fake-claude
// Usage: SCREENS_URL=http://127.0.0.1:8301/ node tests/ui/flow_ai_brand_geo.cjs [folder for screenshots]
const path = require("path");
const { open, menu } = require("./pw.cjs");

const ROOT = (process.env.SCREENS_URL || "http://127.0.0.1:8301/").replace(/[?#].*$/, "");
const SHOTS = process.argv[2];
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");
const one = (s) => String(s || "").replace(/\s+/g, " ").trim();
const sideways = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, (document.querySelector("#main")?.scrollWidth || 0) - (document.querySelector("#main")?.clientWidth || 0)));

async function start({ width = 1600, height = 1200, lang = "en" } = {}) {
  const run = await open({ width: Math.max(width, 1200), height });
  const { page } = run;
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
  if (h > size.height) { await page.setViewportSize({ width: size.width, height: Math.min(h + 40, 7000) }); await settle(page, 600); }
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  await page.setViewportSize(size); await settle(page, 300);
};
const apiCall = (page, method, url, body) => page.evaluate(([m, u, b]) => window.COMP.api(m, u, b), [method, url, body]);
async function waitForAnswers(page, label, after = 0) {
  const ok = await page.waitForFunction((n) => (window.AIBrand?.data?.last?.id || 0) > n && !window.AIBrand.data.running, after, { timeout: 240000, polling: 1000 }).then(() => true).catch(() => false);
  check(ok, `${label}: the answers arrived`);
  await settle(page, 1500);
}
async function ask(page, label) {
  const before = await page.evaluate(() => window.AIBrand.data.last?.id || 0);
  await page.click("[data-ab-ask]"); await settle(page, 1800);
  for (const e of ["ai_mode", "ai_overview"]) { if (await page.locator(`[data-ab-pick="${e}"]:checked`).count()) { await page.uncheck(`[data-ab-pick="${e}"]`); await settle(page, 300); } }
  const price = one(await text(page, ".ab-confirm"));
  await page.click("[data-ab-go]"); await settle(page, 1500);
  await waitForAnswers(page, label, before);
  return price;
}

(async () => {
  let run = await start();
  let { page } = run;
  const siteId = await page.evaluate(() => window.UI.siteIdPicked());
  // Start clean, with the fake keys and the fake Claude as the site's AI.
  const before = await apiCall(page, "GET", `ai-brand?site_id=${siteId}`);
  for (const q of before.questions) await apiCall(page, "DELETE", `ai-brand/questions/${q.id}`);
  await apiCall(page, "PUT", "app-keys/brightdata_ai", { key: "fake-bright-key-1234" });
  await apiCall(page, "PUT", "app-keys/semscraper", { key: "fake-sem-key-1234" });
  await apiCall(page, "PUT", "app-keys/anthropic", { key: "sk-ant-fake-1234" });
  await apiCall(page, "PUT", "insights/ai", { sites: [{ id: siteId, provider: "claude" }] });
  await page.evaluate(() => window.AIBrand.load({ force: true })); await settle(page, 1500);

  // ---- the name is still a guess ----
  if (!before.brand_saved) {
    const asked = one(await text(page, ".ab-name-ask"));
    check(/Is “Site One” your company's real name\?/.test(asked) && /guessed from your/.test(asked), `one prompt to set the real name: ${asked}`);
    await shot(page, "geo-name-prompt.png", ".ai-tabs-card");
    check((await text(page, ".ab-name-ask")).includes("Also known as"), "the prompt has the Also known as field");
    await page.fill(".ab-name-ask input[name=f_brand]", "Site One Coffee");
    await page.fill(".ab-name-ask input[name=f_aliases]", "Coffee Holdings Ltd, site-one-coffee.example");
    await page.click(".ab-name-ask button[type=submit]"); await settle(page, 1800);
    check(!(await page.locator(".ab-name-ask").count()) && one(await text(page, ".ab-brand")).includes("Site One Coffee"), "saved: the prompt goes, the tab names the real company");
    const kept = await page.evaluate(() => window.AIBrand.data.aliases);
    check(JSON.stringify(kept) === JSON.stringify(["Coffee Holdings Ltd", "site-one-coffee.example"]), `the other names are saved: ${JSON.stringify(kept)}`);
  } else {
    check(!(await page.locator(".ab-name-ask").count()), "a saved name: no prompt");
  }

  // ---- head-to-head questions come from the suggestions ----
  await page.click("[data-ab-questions]"); await settle(page, 1000);
  check((await page.locator("#panel [data-ab-brand-form] input[name=f_aliases]").count()) === 1, "the questions panel edits the other names beside the name");
  await shot(page, "geo-questions-panel-aka.png", "#panel");
  await page.click("#panel [data-ab-suggest]"); await settle(page, 1800);
  const vsSug = await page.locator("#panel .ab-sug li .ab-vs-tag").count();
  check(vsSug === 3, `one head-to-head suggestion per followed competitor: ${vsSug}`);
  check(/Choisir plutôt Site One Coffee ou Rival One \?|Should I choose Site One Coffee or Rival One\?/.test(one(await text(page, "#panel .ab-sug"))), `worded "<brand> or <competitor>?": ${one(await text(page, "#panel .ab-sug")).slice(0, 200)}`);
  await shot(page, "geo-suggestions.png", "#panel");
  await page.click("#panel [data-ab-sug-all]"); await settle(page, 3500);
  check(await page.locator("#panel .ab-q .ab-vs-tag").count() === 3, "added: tagged You or them in the list");
  // keep the run short: the first brand question and the three head-to-head ones
  const rows = page.locator("#panel .ab-q");
  for (let i = (await rows.count()) - 1; i >= 1; i -= 1) {
    const row = rows.nth(i);
    if (await row.locator(".ab-vs-tag").count()) continue;
    const box = row.locator("[data-ab-q-active]");
    if (await box.isChecked()) { await box.uncheck(); await settle(page, 700); }
  }
  await page.click("#panel [data-close-panel]"); await settle(page, 1200);
  check(/4 questions/.test(one(await text(page, ".ab-head"))), `four questions asked: ${one(await text(page, ".ab-head"))}`);

  // ---- asking: the price first, the head-to-head count said ----
  const price = await ask(page, "first run");
  check(/This asks 4 questions to 3 AIs: 12 answers\. Including 3 head-to-head questions\./.test(price) && /\$0\.0180/.test(price), `the count, the head-to-head count and the price show first: ${price}`);

  // ---- On your site? ----
  const card = one(await text(page, ".ab-site-card"));
  check(/On your site\?/.test(card) && /Said \d+/.test(card) && /Hinted \d+/.test(card) && /Missing \d+/.test(card), `the ring card: ${card}`);
  check(/Checked against \d+ pages? of your site, read by your AI\./.test(card), "it says how many pages and that the AI read them");
  check(await page.locator(".ab-ring svg .ab-ring-arc").count() >= 2, "the ring has one arc per mark");
  const marks = await page.locator(".ab-pts .ab-mark").count(), points = await page.locator(".ab-pts > li").count();
  check(marks === points && points > 0, `a mark on every point: ${marks} of ${points}`);
  check(await page.locator('.ab-pts .ab-mark[data-mark="said"]').count() >= 1 && await page.locator('.ab-pts .ab-mark[data-mark="missing"]').count() >= 1, "said and missing points");
  const saidLink = page.locator('.ab-pts .ab-mark-row:has(.ab-mark[data-mark="said"]) a.page-link').first();
  check(((await saidLink.getAttribute("href")) || "").startsWith("https://site-one.example/"), `a Said point links its page: ${await saidLink.getAttribute("href")}`);
  check(await page.locator('.ab-pts .ab-mark-row:has(.ab-mark[data-mark="missing"]) [data-task-find]').count() >= 1, "a Missing point has a Task button");
  check(!(await page.locator('.ab-pts .ab-mark-row:has(.ab-mark[data-mark="said"]) [data-task-find]').count()), "a Said point has none");
  await shot(page, "geo-on-your-site.png", ".ab-sec:has(.ab-site-card)");

  // ---- You or them? ----
  const vsRows = await page.locator(".ab-vs-table tbody tr").count();
  check(vsRows === 3, `one row per followed competitor: ${vsRows}`);
  const table = one(await text(page, ".ab-vs-table"));
  check(/The AIs pick/.test(table) && /Your points on your site/.test(table) && /Their points you cover/.test(table) && /1st reading|Same/.test(table), `the table's columns: ${table.slice(0, 260)}`);
  check(await page.locator(".ab-vs-table tbody tr .ab-rival .site-logo, .ab-vs-table tbody tr .ab-rival img").count() >= 3, "a logo beside each competitor");
  check(/\d+ \/ \d+/.test(table), "x / y coverage");
  await shot(page, "geo-you-or-them.png", ".ab-vs");
  await shot(page, "geo-1600.png");
  // a click opens both sides
  await page.locator(".ab-vs-table tbody tr").first().click(); await settle(page, 1200);
  check(await page.locator("#panel.wide .ab-vs-cols .ab-vs-col").count() === 2, "a row opens both sides in a wide panel");
  const panel = one(await text(page, "#panel"));
  check(/ or .+\?/.test(panel) && /by the AIs/.test(panel) && /Sources the AIs used/.test(panel) && /The answers/.test(panel), `the panel: ${panel.slice(0, 200)}`);
  check(await page.locator("#panel .ab-vs-col .ab-mark").count() >= 2, "both sides' points carry their marks");
  const hrefs = await page.locator("#panel .ab-p-src a").evaluateAll((els) => els.map((a) => a.getAttribute("href")));
  check(hrefs.length >= 2 && hrefs.every((h) => /^https:\/\/[^/]+\//.test(h)), `every source is a real link: ${hrefs.slice(0, 4).join(" ")}`);
  check(!/lien introuvable|link not found/i.test(panel), "no 'link not found'");
  await page.locator("#panel .ab-vs-raw details summary").first().click(); await settle(page, 400);
  check(await page.locator("#panel .ab-vs-raw details[open] .ab-p-text").count() === 1, "a raw answer opens");
  await shot(page, "geo-vs-panel.png", "#panel");
  await page.keyboard.press("Escape"); await settle(page, 600);
  // keyboard: Enter on a row opens it too
  await page.locator(".ab-vs-table tbody tr").nth(1).focus(); await page.keyboard.press("Enter"); await settle(page, 1000);
  check(await page.locator("#panel .ab-vs-cols").count() === 1, "Enter on a row opens it");
  await page.keyboard.press("Escape"); await settle(page, 600);

  // ---- Check again ----
  await page.click(".ab-site-card [data-ab-check]"); await settle(page, 2500);
  check(await page.locator(".ab-site-card").count() === 1 && !(await page.locator(".ab-site-card [data-ab-check][disabled]").count()), "Check again re-checks and comes back");

  // ---- a Task from a Missing point ----
  await page.locator('.ab-pts .ab-mark-row:has(.ab-mark[data-mark="missing"]) [data-task-find]').first().click(); await settle(page, 1200);
  const taskPanel = one(await text(page, "#panel"));
  check(/Say on your site/.test(taskPanel), `Task opens a task about the point: ${taskPanel.slice(0, 120)}`);
  await page.keyboard.press("Escape"); await settle(page, 600);

  // ---- the AI switch: one AI's pick ----
  await page.locator('[data-ab-pick-ai="perplexity"]').click(); await settle(page, 800);
  const perplexity = one(await text(page, ".ab-vs-table tbody"));
  check(/Them/.test(perplexity) && !/1st reading/.test(perplexity), `Perplexity alone picks them: ${perplexity.slice(0, 160)}`);
  await page.locator('[data-ab-pick-ai=""]').click(); await settle(page, 800);

  // ---- a second run: the trend ----
  await ask(page, "second run");
  check(/Same/.test(one(await text(page, ".ab-vs-table"))), `since the last run: ${one(await text(page, ".ab-vs-table tbody")).slice(0, 200)}`);
  check(await sideways(page) <= 1, "1600 px: no sideways scroll");
  await shot(page, "geo-second-run-1600.png");
  const problems = [...run.problems.filter((p) => !/status of 404/.test(p)), ...run.bad];
  check(!problems.length, `no console errors: ${problems.join(" | ")}`);
  await run.browser.close();

  // ---- a phone, and French ----
  for (const [opts, name] of [[{ width: 390, height: 2400 }, "geo-390.png"], [{ lang: "fr", height: 1600 }, "geo-fr-1600.png"], [{ width: 390, height: 2400, lang: "fr" }, "geo-fr-390.png"]]) {
    run = await start(opts); page = run.page;
    await settle(page, 1500);
    check(await sideways(page) <= 1, `${name}: no sideways scroll (${await sideways(page)})`);
    if (opts.lang === "fr") {
      const all = one(await text(page, ".ai-tabs-card"));
      // on a phone the column names are drawn from data-label, so they aren't in the text: look for them there
      const labels = await page.locator(".ab-vs-table tbody tr").first().evaluate((tr) => [...tr.querySelectorAll("[data-label]")].map((c) => c.dataset.label).join(" | ")).catch(() => "");
      check(all.includes("Sur votre site ?") && all.includes("Vous ou eux ?") && `${all} ${labels}`.includes("Le choix des IA") && `${all} ${labels}`.includes("Leurs points traités chez vous"), `${name}: French words`);
      check(!/On your site\?|You or them\?|The AIs pick|Their points you cover|1st reading|Checked against|Check again/.test(all), `${name}: no English left`);
    }
    if (opts.width === 390) {
      const cards = await page.locator(".ab-vs-table tbody tr").evaluateAll((els) => els.map((el) => getComputedStyle(el).borderTopWidth));
      check(cards.length === 3 && cards.every((w) => w !== "0px"), `${name}: one card per competitor`);
    }
    await shot(page, name);
    await page.locator(".ab-vs-table tbody tr").first().click(); await settle(page, 1200);
    check(await sideways(page) <= 1, `${name}: the panel fits`);
    await shot(page, name.replace(".png", "-panel.png"), "#panel");
    const problems2 = [...run.problems.filter((p) => !/status of 404/.test(p)), ...run.bad];
    check(!problems2.length, `${name}: no console errors ${problems2.join(" | ")}`);
    await run.browser.close();
  }
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
