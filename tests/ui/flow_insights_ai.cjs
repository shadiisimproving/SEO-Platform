// Search → Insights with AI (built 2026-11-10), the way a person uses it: Settings → AI, then Explain, a brief, the weekly
// summary, a kept answer, the monthly cap, French. Claude is faked (tests/ui/fake_claude.py): nothing reaches Anthropic.
// Needs the test app with made-up shop-one.test findings and the fake Claude installed, which this does:
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/insights_server.py --port 8233 --catalogue
// Each site starts on "none" (no AI chosen); the flow picks OpenRouter for every site first (PUT /api/insights/ai).
// Run: node tests/ui/flow_insights_ai.cjs reports/insights-ai http://127.0.0.1:8233/
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/insights-ai";
const BASE = process.argv[3] || "http://127.0.0.1:8233/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900, url: `${BASE}?flow=${Date.now()}#settings` });
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 3000 }).then((x) => x.replace(/\s+/g, " ")).catch(() => ""); // brand logos sit inside the words
  const count = (sel) => page.locator(sel).count();
  const shot = (name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me") && !r.url().includes("/ai")) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "/")}`); });
  const call = (method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(`/api/${p}`, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, path, body]);
  await page.waitForTimeout(2000);
  // A fresh start: no key, the free models, no spend this month.
  await call("DELETE", "app-keys/anthropic");
  const sites = (await call("GET", "insights/ai")).body.sites;
  await call("PUT", "insights/ai", { sites: sites.map((s) => ({ id: s.id, provider: "openrouter" })), cap: 5 });
  const pickShop = () => page.evaluate(() => { const s = window.SITES.find((x) => x.host === "shop-one.test"); if (s) { window.UI.state.site = s.id; window.UI.render(); } });

  await step("Settings → AI", async () => {
    await page.goto(`${BASE}?flow=${Date.now()}b#settings`);
    await page.waitForTimeout(2500);
    await page.locator("#ai-settings").scrollIntoViewIfNeeded();
    await shot("01-settings-ai");
    check((await text("#ai-settings")).includes("AI on Search insights"), "the AI card is in Settings");
    check((await text("#ai-settings")).includes("OpenRouter isn't connected yet"), "it says the free models need OpenRouter");
    check((await count("#ai-settings [data-ai-site]")) >= 1, "each site has its own choice");
    const anth = await text('[data-conn="anthropic"], #set-extra, main');
    check(/Anthropic/.test(anth), "Anthropic is listed under Extras");
  });

  await step("pick Claude, paste a key", async () => {
    const saved = await call("PUT", "app-keys/anthropic", { key: "sk-ant-test-0000-1234" });
    check(saved.status < 300, `the key is saved (${saved.status})`);
    const tested = await call("POST", "app-keys/anthropic/test");
    check(tested.body?.ok === true, "Test says it works, without spending");
    await page.goto(`${BASE}?flow=${Date.now()}c#settings`);
    await page.waitForTimeout(2500);
    const picker = page.locator("#ai-settings [data-ai-site]").first();
    await picker.scrollIntoViewIfNeeded();
    await picker.selectOption("claude");
    await page.waitForTimeout(1200);
    await shot("02-claude-picked");
    check((await page.locator("#ai-settings [data-ai-site]").first().inputValue()) === "claude", "Claude is picked for the site");
    check(!(await text("#ai-settings")).includes("Anthropic isn't connected"), "it knows the Anthropic key is there");
    check(/Claude this month \$[\d.]+ of \$5\.00/.test(await text("#ai-settings .ai-spend")), "the month's Claude spend and its cap show");
  });

  await step("explain a finding", async () => {
    await page.goto(`${BASE}?flow=${Date.now()}d#insights`);
    await page.waitForTimeout(2000);
    await pickShop();
    await page.waitForTimeout(1500);
    await page.click('[data-in-tab="changed"]');
    await page.waitForTimeout(900);
    await page.locator(".in-table tbody tr", { hasText: "Query losing places" }).first().click();
    await page.waitForSelector("#panel [data-in-ai]", { timeout: 5000 });
    await page.locator("#panel [data-in-ai-wrap]").scrollIntoViewIfNeeded();
    await shot("03-panel-before");
    check((await text("#panel [data-in-ai-wrap]")).includes("Claude, from your Anthropic key"), "the panel says which AI writes");
    await page.click('#panel [data-in-ai="explain"]');
    await page.waitForSelector("#panel .in-ai-answer", { timeout: 5000 });
    await page.waitForTimeout(300);
    await shot("04-explained");
    const box = await text("#panel .in-ai-answer");
    check(box.includes("Written by AI") && box.includes("Claude Haiku 5.5") && /\$0\.0/.test(box), `the answer is labelled with its model and cost (${box.split("\n")[0]})`);
    check(box.includes("Ranking for this search slipped"), "the answer is shown");
    check((await count('#panel [data-in-ai="explain"]:not([data-in-ai-again])')) === 0, "its button gives way to the answer");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.locator(".in-table tbody tr", { hasText: "Query losing places" }).first().click();
    await page.waitForSelector("#panel .in-ai-answer", { timeout: 5000 });
    check((await text("#panel .in-ai-answer")).includes("Ranking for this search slipped"), "opened again, the answer is kept");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  await step("a content brief", async () => {
    await page.click('[data-in-tab="wins"]');
    await page.waitForTimeout(900);
    await page.locator(".in-table tbody tr", { hasText: "No page of its own" }).first().click();
    await page.waitForSelector('#panel [data-in-ai="brief"]', { timeout: 5000 });
    await page.click('#panel [data-in-ai="brief"]');
    await page.waitForSelector("#panel .in-ai-answer", { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.locator("#panel .in-ai-answer").scrollIntoViewIfNeeded();
    await shot("05-brief");
    check((await text("#panel .in-ai-answer")).includes("Claude Sonnet 5.5"), "a brief is written by Sonnet");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  await step("weekly summary", async () => {
    await page.click("[data-in-weekly]");
    await page.waitForSelector(".in-weekly .in-ai-answer", { timeout: 5000 });
    await shot("06-weekly");
    check((await text(".in-weekly")).includes("Clicks fell this month"), "the weekly summary shows under the sentence on top");
  });

  await step("spend in Settings", async () => {
    await page.goto(`${BASE}?flow=${Date.now()}e#settings`);
    await page.waitForTimeout(2500);
    await page.locator("#ai-settings").scrollIntoViewIfNeeded();
    await shot("07-spend");
    const spend = await text("#ai-settings .ai-spend");
    const answers = Number((spend.match(/(\d+) answers?/) || [])[1] || 0);
    check(answers >= 1 && !/\$0\.00 of/.test(spend), `the month's Claude spend shows, with its answers (${spend})`); // kept answers from an earlier run aren't paid twice
  });

  await step("the cap", async () => {
    await page.fill("[data-ai-cap]", "0");
    await page.click("[data-ai-save-cap]");
    await page.waitForTimeout(800);
    await page.goto(`${BASE}?flow=${Date.now()}f#insights`);
    await page.waitForTimeout(2000);
    await pickShop();
    await page.waitForTimeout(1500);
    await page.click('[data-in-tab="wins"]');
    await page.waitForTimeout(900);
    await page.locator(".in-table tbody tr", { hasText: "Topic without a strong page" }).first().click();
    await page.waitForSelector('#panel [data-in-ai="explain"]', { timeout: 5000 });
    await page.click('#panel [data-in-ai="explain"]');
    await page.waitForTimeout(1200);
    await shot("08-cap");
    check(/cap is reached/.test(await page.locator(".toast, #toasts, [role=status]").allInnerTexts().then((x) => x.join(" "))), "past the cap, nothing is sent and it says why");
    check((await count("#panel .in-ai-answer")) === 0, "no answer appears");
    await page.keyboard.press("Escape");
    await call("PUT", "insights/ai", { cap: 5 });
  });

  await step("French", async () => {
    await menu(page, "lang");
    await page.waitForTimeout(800);
    await page.click('[data-in-tab="changed"]');
    await page.waitForTimeout(900);
    await page.locator(".in-table tbody tr").first().click();
    await page.waitForSelector("#panel [data-in-ai-wrap]", { timeout: 5000 });
    await page.locator("#panel [data-in-ai-wrap]").scrollIntoViewIfNeeded();
    await shot("09-fr");
    check((await text("#panel [data-in-ai-wrap]")).includes("Avec l'IA"), "the AI part is in French");
    await page.keyboard.press("Escape");
    await menu(page, "lang");
  });

  const errors = problems.filter((x) => !/status of (404|400)/.test(x));
  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
