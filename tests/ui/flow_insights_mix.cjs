// Search → Insights → Rank and clicks, and the clearer top of the page, the way a person uses them.
// Needs: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/insights_server.py --port 8297 --mix
// Run: node tests/ui/flow_insights_mix.cjs reports/insights-mix http://127.0.0.1:8297/
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/insights-mix";
const BASE = process.argv[3] || "http://127.0.0.1:8297/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(`${BASE}api/insights?group=mix`); const d = await r.json(); if (d.coverage?.tracked && d.summary?.ran_at) break; } catch { /* still starting */ }
    await wait(1000);
  }
  const { browser, page, problems } = await open({ width: 1440, height: 900, url: `${BASE}?flow=${Date.now()}#insights` });
  const shot = (name, full = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  const count = (sel) => page.locator(sel).count();
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 3000 }).catch(() => "");
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.url().replace(BASE, "/")}`); });
  const pickSite = async () => { await page.waitForTimeout(1500); await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "shop-one.test"); if (s) { window.UI.state.site = s.id; window.UI.render(); } }); await page.waitForTimeout(1500); };
  await pickSite();

  await step("top of the page", async () => {
    await shot("01-top");
    const sentence = await text(".in-answer");
    check(/Clicks (fell|rose)/.test(sentence), `a sentence on top (${sentence.slice(0, 120)})`);
    check(!/Mostly: searches google/i.test(sentence) && !/Rare searches/i.test(sentence), "it never blames searches Google doesn't name");
    check((await count(".in-graph .lv-chart")) === 1, "a small graph");
    check((await count(".in-lists .in-bar-row")) >= 3, "bars for pages and reasons");
    check((await text(".in-figs")).includes("To recover"), "To recover and To win");
    check(!(await text(".ov-trust")).includes("1 d"), "the update time reads in words");
  });

  await step("columns", async () => {
    const heads = await page.locator(".in-table thead th").allInnerTexts();
    check(["Impressions", "Clicks", "Position", "Change"].every((h) => heads.some((x) => x.includes(h))), `real columns (${heads.join(" | ")})`);
    check(!heads.join(" ").includes("Key number"), "no Key number");
    check((await count(".in-table tbody tr .btn")) === 0, "no repeated Open button");
    await page.click('[data-in-tab="wins"]');
    await page.waitForTimeout(900);
    const rows = await page.locator(".in-table tbody tr").evaluateAll((trs) => trs.slice(0, 40).map((tr) => { const pos = tr.querySelector("td.in-pos .pos")?.textContent.trim(); const fact = tr.querySelector(".s")?.textContent || ""; return { pos, fact }; }));
    check(rows.length > 0 && rows.every((r) => !r.pos || !new RegExp(`position ${r.pos}\\b`).test(r.fact)), "a position in its column isn't said again under the name");
    await shot("02-quick-wins");
  });

  await step("the new tab", async () => {
    await page.click('[data-in-tab="mix"]');
    await page.waitForTimeout(1000);
    await shot("03-mix-all");
    check(/Of \d+ tracked keywords, \d+ have Search Console data/.test(await text(".in-mix-answer")), "a sentence on top of the tab");
    check(/Rankings checked: \d+ of \d+/.test(await text(".in-mix-head .small")), "how much rests on real checks");
    const kinds = await page.locator(".in-mix-table .in-kind").allInnerTexts();
    console.log("     kinds:", kinds.join(" / "));
    for (const k of ["Just dropped", "Rival passed you", "Almost there, both agree", "Ranked, not clicked", "Another page shown", "Rivals lead, people search it", "Tracked, no searches"]) check(kinds.includes(k), `${k} is listed`);
    const names = await page.locator(".in-mix-table tbody .t").allInnerTexts();
    check(new Set(names).size === names.length, "each keyword shows once");
    check((await page.locator(".in-mix-table .in-season").allInnerTexts()).includes("Check it"), "a drop seen once says Check it");
    check((await page.locator(".in-mix-table .pos-none").allInnerTexts()).some((x) => x.includes(">10")), "beyond the depth shows >10");
  });

  await step("chips", async () => {
    for (const [id, head, name] of [["moved", "Before", "04-just-moved"], ["rivals", "Who's above", "05-rivals"], ["clicks", "AI Overview", "06-not-clicked"], ["page", "Pages", "07-wrong-page"]]) {
      await page.click(`[data-in-mix="${id}"]`);
      await page.waitForTimeout(500);
      await shot(name);
      check((await page.locator(".in-mix-table thead").innerText()).includes(head), `${id} shows ${head}`);
    }
    await page.click('[data-in-mix="tracking"]');
    await page.waitForTimeout(400);
    check((await page.locator(".in-mix-table .in-kind").allInnerTexts()).includes("Worth tracking"), "Worth tracking moved here");
    await page.click('[data-in-tab="wins"]');
    await page.waitForTimeout(800);
    check(!(await page.locator(".in-table .in-kind").allInnerTexts()).includes("Worth tracking"), "and left Quick wins");
    await page.click('[data-in-tab="mix"]');
    await page.waitForTimeout(800);
    await page.click('[data-in-mix="all"]');
    await page.waitForTimeout(400);
  });

  await step("search and sort", async () => {
    await page.fill(`[data-tp-search][data-tp-key="in"]`, "boot polish");
    await page.waitForTimeout(600);
    check((await page.locator(".in-mix-table tbody tr").count()) === 1, "search finds one keyword");
    await page.fill(`[data-tp-search][data-tp-key="in"]`, "");
    await page.waitForTimeout(600);
    await page.click("[data-in-sort]");
    await page.waitForTimeout(400);
    const v = (await page.locator(".in-mix-table td.in-stake-col").allTextContents()).map((x) => Number(x.replace(/[^\d]/g, "")) || 0);
    check(v.every((x, i) => i === 0 || x >= v[i - 1]), "the heading turns the order round");
    await page.click("[data-in-sort]");
    await page.waitForTimeout(400);
  });

  await step("one keyword", async () => {
    await page.locator(".in-mix-table tbody tr", { hasText: "shoe laces" }).first().click();
    await page.waitForSelector("#panel .in-serp", { timeout: 4000 });
    await page.waitForTimeout(400);
    await shot("08-panel", false);
    check((await text("#panel .in-serp")).includes("rival-one.test"), "the panel lists who ranks");
    check((await count("#panel .in-serp li.mine")) === 1, "you are marked");
    check((await count("#panel [data-in-track]")) === 0, "already tracked: no Track button");
    check((await count("#panel [data-in-task]")) === 1, "Create a task is there");
    check((await text("#panel .in-do")).length > 20, "what to do");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    check((await count("#panel")) === 0, "Esc closes it");
  });

  await step("the AI answer depends on what was read", async () => {
    await page.locator(".in-mix-table tbody tr", { hasText: "red shoes" }).first().click();
    await page.waitForSelector("#panel .in-do", { timeout: 4000 });
    check((await text("#panel .in-do")).includes("AI Overview takes these clicks"), "AI Overview named as the cause");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  await step("not useful, then keyboard", async () => {
    const before = await page.locator(".in-mix-table tbody .t").allInnerTexts();
    await page.locator(".in-mix-table tbody tr", { hasText: "boot polish" }).first().click();
    await page.waitForSelector("#panel [data-in-dismiss]", { timeout: 4000 });
    await page.click("#panel [data-in-dismiss]");
    await page.waitForTimeout(1000);
    const after = await page.locator(".in-mix-table tbody .t").allInnerTexts();
    check(before.includes("boot polish") && !after.includes("boot polish"), "Not useful takes it off the list");
    await page.locator(".in-mix-table tbody tr").first().focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("#panel .panel-body", { timeout: 4000 });
    await page.waitForTimeout(400);
    check((await count("#panel")) === 1, "Enter opens a row");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  await step("French and dark", async () => {
    await page.goto(`${BASE}?flow=${Date.now()}d#insights`);
    await pickSite();
    await menu(page, "lang");
    await page.waitForTimeout(500);
    await menu(page, "theme");
    await page.waitForTimeout(800);
    await page.click('[data-in-tab="mix"]');
    await page.waitForTimeout(1000);
    await shot("09-fr-dark");
    check(/Sur \d+ mots-clés suivis/.test(await text(".in-mix-answer")), "the sentence is in French");
    check((await text('[data-in-tab="mix"]')).includes("Positions et clics"), "the tab is in French");
    check(!(await text(".ov-trust")).includes("Variation"), "the link beside the countries isn't turned into the column's word");
    await menu(page, "lang");
    await page.waitForTimeout(400);
    await menu(page, "theme");
    await page.waitForTimeout(400);
  });

  for (const [width, name] of [[1000, "10-medium"], [641, "11-small"], [390, "12-phone"]]) {
    await step(`width ${width}`, async () => {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(700);
      await shot(name);
      check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `no sideways scroll at ${width}`);
    });
  }

  const real = problems.filter((p) => !p.includes("404 (NOT FOUND)"));
  check(real.length === 0, `no script errors${real.length ? `: ${real.slice(0, 3).join(" | ")}` : ""}`);
  check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
