// AI search → AI traffic like Mickaz's (plan-seo-command-center-mickaz-missing-features-geo-keywords-2026-11-20.md, track B),
// driven by hand like a normal user on the simpler screens: What AI says is the first tab and opens first, "What AI says about
// you ›" under the answer opens it, the Assistants tab has a donut with shares and an Engaged column with its change, Page
// types groups the AI visits with their assistants and opens Landing pages filtered, Landing pages shows Google clicks beside
// AI visits, and a page scrolled a little snaps back so the answer is never half under the sticky head. Then the old screen
// (?simple=0), 390 px, dark mode and French. Made-up sites only (tests/ui/seed_ai_search.py).
// Needs: DB_NAME_TEST=test_mzaitrafficui_test .venv/bin/python tests/ui/app_server.py --port 8302 --slow 0
// Usage: DB_NAME_TEST=test_mzaitrafficui_test SCREENS_URL=http://127.0.0.1:8302/ node tests/ui/flow_ai_traffic.cjs [folder for screenshots]
const path = require("path");
const { execFileSync } = require("child_process");
const { open, menu } = require("./pw.cjs");

const ROOT = (process.env.SCREENS_URL || "http://127.0.0.1:8302/").replace(/[?#].*$/, "");
const SHOTS = process.argv[2];
const REPO = path.join(__dirname, "..", "..");
const seed = (mode) => execFileSync(path.join(REPO, ".venv", "bin", "python"), [path.join(__dirname, "seed_ai_search.py"), mode], { cwd: REPO, env: process.env, stdio: "pipe" });
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const shot = async (page, name, sel = null) => { if (!SHOTS) return; if (sel) await page.locator(sel).first().screenshot({ path: path.join(SHOTS, name) }); else await page.screenshot({ path: path.join(SHOTS, name) }); };
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");

async function start({ width = 1440, height = 1000, theme = "light", lang = "en", simple = "1" } = {}) {
  const run = await open({ width: Math.max(width, 1200), height });
  const { page } = run;
  await page.goto("about:blank"); await page.goto(`${ROOT}?simple=${simple}#ai`); await settle(page, 1800);
  if (theme === "dark") { await menu(page, "theme"); await settle(page, 300); await page.keyboard.press("Escape"); }
  if (lang === "fr") { await menu(page, "lang"); await settle(page, 300); await page.keyboard.press("Escape"); }
  await page.click("#site-switch"); await settle(page, 300);
  await page.locator("[data-pick-site]", { hasText: "site-one.example" }).first().click();
  if (width < 1200) { await page.setViewportSize({ width, height }); await settle(page, 600); }
  await settle(page, 2500);
  return run;
}
const tab = async (page, id) => { await page.click(`[data-ai-tab="${id}"]`); await settle(page, 600); };

(async () => {
  seed("serpback"); seed("normal");
  let run = await start();
  let { page } = run;

  // What AI says first, and opened first
  const order = await page.$$eval(".ai-tabs-card [role=tab]", (els) => els.map((e) => e.dataset.aiTab));
  check(order[0] === "brand", `What AI says is the first tab (${order.join(", ")})`);
  check((await page.getAttribute(".ai-tabs-card [role=tab][aria-selected=true]", "data-ai-tab")) === "brand", "and it is the one open");
  await shot(page, "traffic-top.png");

  // the answer's jump link: Assistants first, then "What AI says about you ›" brings the brand tab back, in view
  await tab(page, "assistants");
  await page.evaluate(() => { document.querySelector("main.main").scrollTop = 0; }); await settle(page, 300);
  await page.click("[data-ai-jump]"); await settle(page, 1200);
  check((await page.getAttribute(".ai-tabs-card [role=tab][aria-selected=true]", "data-ai-tab")) === "brand", "What AI says about you › opens that tab");
  const cardTop = await page.evaluate(() => document.querySelector(".ai-tabs-card").getBoundingClientRect().top);
  const headBottom = await page.evaluate(() => document.querySelector(".topbar").getBoundingClientRect().bottom);
  const atEnd = await page.evaluate(() => { const m = document.querySelector("main.main"); return m.scrollHeight - m.clientHeight - m.scrollTop < 2; });
  check(cardTop >= headBottom - 1 && (cardTop < 140 || atEnd), `and scrolls it into view below the head (card ${Math.round(cardTop)}, head ${Math.round(headBottom)}${atEnd ? ", page end" : ""})`);
  check(await page.evaluate(() => document.activeElement?.dataset?.aiTab === "brand"), "its tab has the focus");

  // the headline is never left half under the sticky head
  await page.evaluate(() => { document.querySelector("main.main").scrollTo({ top: 0, behavior: "auto" }); }); await settle(page, 600);
  await page.mouse.move(800, 500); await page.mouse.wheel(0, 30); await settle(page, 1200);
  const after = await page.evaluate(() => document.querySelector("main.main").scrollTop);
  const lead = await page.evaluate(() => document.querySelector(".ai-answer .today-lead").getBoundingClientRect().top);
  check(lead >= headBottom, `a small scroll snaps back: the answer starts at ${Math.round(lead)}, under the head at ${Math.round(headBottom)} (scrollTop ${after})`);
  await page.mouse.wheel(0, 900); await settle(page, 1200);
  check((await page.evaluate(() => document.querySelector("main.main").scrollTop)) > 200, "a real scroll still scrolls");
  await page.evaluate(() => { document.querySelector("main.main").scrollTo({ top: 0, behavior: "auto" }); }); await settle(page, 600);

  // Assistants: donut + engaged
  await tab(page, "assistants");
  check(await page.locator(".ai-donut svg circle.ai-donut-arc").count() >= 2, "a donut of visits per assistant");
  const keys = await page.$$eval(".ai-donut-keys li", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  check(keys.length >= 2 && keys.every((k) => /\d+(\.\d)?%$/.test(k)), `each assistant with its share: ${keys.join(" | ")}`);
  check((await page.locator(".ai-donut-keys .site-logo").count()) >= 2, "logos beside the assistants' names");
  const total = await text(page, ".ai-donut-mid b");
  const tile = await text(page, '[data-card="ai-visits"] .fig, .ai-tiles .tile .fig');
  check(total && tile && total.replace(/\D/g, "") === tile.replace(/\D/g, ""), `the donut's total (${total}) is the AI visits card's (${tile})`);
  check((await page.locator(".ai-tabs-card th", { hasText: "Engaged" }).count()) === 1, "an Engaged column");
  const engaged = await page.$$eval("#main .ai-tabs-card tbody tr", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")));
  check(engaged.some((r) => /\d+% [+−±]\d+ pts/.test(r)), `engaged % with its change in points: ${engaged[0]}`);
  check(engaged.some((r) => /\d+ [+−±]\d+%/.test(r)), "visits with their change");
  await shot(page, "traffic-assistants.png", ".ai-tabs-card");

  // Page types → Landing pages filtered
  await tab(page, "types");
  const heads = await page.$$eval(".ai-tabs-card th", (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
  // Until lead events are picked in Settings the columns say "Key events" (Google Analytics review 2026-11-17, W1).
  check(["Page type", "AI visits", "Share", "Assistants"].every((h) => heads.includes(h)) && (["Leads", "Lead rate"].every((h) => heads.includes(h)) || ["Key events", "Key event rate, at most"].every((h) => heads.includes(h))), `page types columns: ${heads.join(", ")}`);
  const types = await page.$$eval("[data-ai-type]", (els) => els.map((e) => e.dataset.aiType));
  check(types.includes("/blog/") && types.includes("Home page"), `types from the first folder: ${types.join(", ")}`);
  check((await page.locator(".ai-tabs-card .ai-by .site-logo").count()) > 0, "which assistants, with logos");
  await shot(page, "traffic-page-types.png", ".ai-tabs-card");
  await page.click('[data-ai-type="/blog/"]'); await settle(page, 700);
  check((await page.getAttribute(".ai-tabs-card [role=tab][aria-selected=true]", "data-ai-tab")) === "pages", "a type opens Landing pages");
  const paths = await page.$$eval(".ai-tabs-card tbody .lv-url", (els) => els.map((e) => e.innerText.trim()));
  check(paths.length > 0 && paths.every((p) => p.startsWith("/blog/")), `filtered to that type: ${paths.join(", ")}`);
  await shot(page, "traffic-pages-blog.png", ".ai-tabs-card");
  await page.click("[data-ai-type-clear]"); await settle(page, 600);
  check((await page.locator(".ai-tabs-card tbody tr").count()) > paths.length, "× shows every page again");

  // Landing pages: Google clicks beside AI visits, and every page a link
  check((await page.locator(".ai-tabs-card th", { hasText: "Google clicks" }).count()) === 1, "a Google clicks column");
  const home = await page.$$eval(".ai-tabs-card tbody tr", (rows) => rows.map((r) => [...r.querySelectorAll("td")].map((td) => td.innerText.trim())));
  // Since the pages-image-title work (20 Nov) a page cell is its picture, its title, then its path on a line of its own.
  const homeRow = home.find((cells) => cells.some((c) => c.split("\n").some((line) => line.trim() === "/")));
  check(homeRow && homeRow.some((c) => /^\d[\d,]+$/.test(c)), `the home page has its Google clicks: ${homeRow && homeRow.join(" | ")}`);
  check((await page.locator(".ai-tabs-card tbody a.lv-url, .ai-tabs-card tbody .lv-url a, .ai-tabs-card tbody a[href]").count()) > 0, "pages are links");
  await shot(page, "traffic-pages.png", ".ai-tabs-card");
  check(!run.problems.filter((p) => !p.includes("404")).length, `no page errors: ${run.problems.join(" | ")}`);
  await run.browser.close();

  // the old screen, 390 px, dark, French
  for (const [opts, name] of [[{ simple: "0" }, "traffic-old-screen.png"], [{ width: 390, height: 2400 }, "traffic-390.png"], [{ theme: "dark" }, "traffic-dark.png"], [{ lang: "fr" }, "traffic-fr.png"]]) {
    run = await start(opts); page = run.page;
    await tab(page, "assistants");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(wide <= 1, `${name}: no sideways scroll (${wide})`);
    check(await page.locator(".ai-donut").count() === 1, `${name}: the donut is there`);
    if (opts.lang === "fr") {
      check((await text(page, "[data-ai-jump]")).includes("Ce que l'IA dit de vous"), "French: the jump link");
      check((await page.locator(".ai-tabs-card th", { hasText: "Engagées" }).count()) === 1, "French: Engagées");
      await tab(page, "types");
      check((await text(page, '[data-ai-tab="types"]')).includes("Types de page"), "French: Types de page");
      check((await page.locator("[data-ai-type]", { hasText: "Page d'accueil" }).count()) === 1, "French: Page d'accueil");
      await tab(page, "pages");
      check((await page.locator(".ai-tabs-card th", { hasText: "Clics Google" }).count()) === 1, "French: Clics Google");
      await tab(page, "assistants");
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: opts.width === 390 });
    if (SHOTS) await page.locator(".ai-tabs-card").screenshot({ path: path.join(SHOTS, name.replace(".png", "-tabs.png")) });
    check(!run.problems.filter((p) => !p.includes("404")).length, `${name}: no page errors: ${run.problems.join(" | ")}`);
    await run.browser.close();
  }

  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
