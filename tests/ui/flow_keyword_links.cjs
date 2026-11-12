// Keywords open their details from anywhere (asked for 2026-11-12): every screen that shows a keyword or a search makes it a
// link; a click opens Keywords with that keyword's panel, or Overview → Queries for a search nobody tracks, and never the
// row's own panel too. Also: the country under a competitor keyword is its flag, and "Ahead of you" is clickable logos.
// Needs the real app on the fake internet:
//   DB_POOL_SIZE=2 DB_MAX_OVERFLOW=6 DB_NAME_TEST=test_kwlinks_test .venv/bin/python tests/ui/app_server.py --port 8251
// Run: node tests/ui/flow_keyword_links.cjs reports/keyword-links-2026-11-12 http://127.0.0.1:8251/ [--simple]
const fs = require("fs");
const { open } = require("./pw.cjs");
const out = process.argv[2] || "reports/keyword-links";
const BASE = process.argv[3] || "http://127.0.0.1:8251/";
const SIMPLE = process.argv.includes("--simple");
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const wait = (page, ms) => page.waitForTimeout(ms);

const SCREENS = ["today", "overview", "insights", "content", "ai", "keywords", "backlinks", "competitors", "competitors/list", "competitors/pairs", "competitors/ai", "tasks", "notes"];

(async () => {
  const { browser, context, page, problems } = await open({ width: 1440, height: 950, url: `${BASE}?flow=${Date.now()}#today` });
  if (SIMPLE) { await page.evaluate(() => { try { localStorage.setItem("seocc2-simple", "1"); } catch {} }); await page.reload(); }
  await wait(page, 2500);
  const go = async (hash) => { await page.evaluate((h) => { location.hash = `#${h}`; }, hash); await wait(page, 2000); };
  const route = () => page.evaluate(() => location.hash);

  // 1. Competitors → Keywords they beat you on: the screenshot the owner sent.
  await go("competitors/summary");
  await page.waitForSelector("#cs-keywords-table", { timeout: 15000 }).catch(() => null);
  const table = await page.$("#cs-keywords-table");
  check(Boolean(table), "Competitors summary shows Keywords they beat you on");
  if (table) {
    await page.locator("#cs-keywords-table").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/competitors-keywords.png` });
    const facts = await page.evaluate(() => {
      const row = document.querySelector("#cs-keywords-table tbody tr");
      const ahead = row.querySelector(".cs-ahead");
      return {
        link: row.querySelector("a.kw-link")?.textContent.trim() || null,
        // The country shows under each keyword, or once under the table when every row was checked the same way.
        flag: (row.querySelector(".flag") || document.querySelector(".cs-kw-foot .flag"))?.getAttribute("title") || null,
        flagText: (row.querySelector(".flag") || document.querySelector(".cs-kw-foot .flag"))?.textContent || null,
        plainCode: /^[A-Z]{2}\b/.test(row.querySelector(".cs-where")?.textContent.trim() || ""),
        logos: ahead ? ahead.querySelectorAll("button.cs-ahead-logo").length : 0,
        nameShown: ahead ? [...ahead.querySelectorAll(".mono, .logo-text")].length : -1,
        fold: Boolean(row.querySelector("details.cs-rest")),
        tip: ahead?.querySelector("button")?.getAttribute("data-tip") || "",
      };
    });
    console.log("     ", JSON.stringify(facts));
    check(Boolean(facts.link), "the keyword is a link");
    check(facts.flag && /^\p{Regional_Indicator}{2}$/u.test(facts.flagText), `the country is a flag with its name on hover (${facts.flag})`);
    check(!facts.plainCode, "no bare country code left in front");
    check(facts.logos > 0 && facts.nameShown === 0, "Ahead of you: logos only, no names");
    check(!facts.fold, "Ahead of you: all of them, no Show more");
    check(/#\d+/.test(facts.tip), `a logo's hover names it and its place (${facts.tip})`);

    // A logo opens that competitor's profile.
    await page.locator("#cs-keywords-table .cs-ahead-logo").first().click();
    await wait(page, 2000);
    check((await route()).startsWith("#competitors/list"), `a logo opens the competitor's profile (${await route()})`);
    await page.screenshot({ path: `${out}/logo-opens-profile.png` });

    // The keyword opens its Keywords panel, and only that.
    await go("competitors/summary");
    await page.waitForSelector("#cs-keywords-table a.kw-link", { timeout: 15000 });
    const word = await page.locator("#cs-keywords-table a.kw-link").first().textContent();
    await page.locator("#cs-keywords-table a.kw-link").first().click();
    await page.waitForSelector("#panel", { timeout: 15000 }).catch(() => null);
    await wait(page, 1500);
    const head = await page.evaluate(() => document.querySelector("#panel h2, #panel .panel-head")?.textContent || "");
    check((await route()).startsWith("#keywords") && head.toLowerCase().includes(word.trim().toLowerCase()), `"${word.trim()}" opens Keywords with its panel (${await route()})`);
    await page.screenshot({ path: `${out}/keyword-opens-panel.png` });
    await page.keyboard.press("Escape");
  }

  // 2. Every screen: count the links, and click the first one.
  for (const screen of SCREENS) {
    await go(screen);
    const n = await page.evaluate(() => document.querySelectorAll("#main a.kw-link").length);
    console.log(`     #${screen}: ${n} keyword links`);
    await page.screenshot({ path: `${out}/screen-${screen.replace("/", "-")}.png` });
    if (!n) continue;
    const link = page.locator("#main a.kw-link").first();
    const word = (await link.getAttribute("data-kw-link")) || "";
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await wait(page, 2500);
    const r = await route();
    const panel = await page.evaluate(() => document.querySelector("#panel h2, #panel .panel-head")?.textContent || "");
    const box = await page.evaluate(() => [...document.querySelectorAll("#main input")].map((i) => i.value).join("|"));
    const ok = (r.startsWith("#keywords") && panel.toLowerCase().includes(word.toLowerCase())) || (r.startsWith("#overview") && box.toLowerCase().includes(word.toLowerCase()));
    check(ok, `#${screen}: "${word}" opens its details (${r})`);
    if (!ok) await page.screenshot({ path: `${out}/FAIL-${screen.replace("/", "-")}.png` });
    await page.keyboard.press("Escape");
  }

  // 3. A row that opens its own panel: the keyword's click opens the keyword, not the row.
  await go("overview");
  const ovLink = page.locator("#main tr a.kw-link").first();
  if (await ovLink.count()) {
    const word = await ovLink.getAttribute("data-kw-link");
    await ovLink.click(); await wait(page, 2500);
    const r = await route();
    check(!r.startsWith("#overview") || (await page.evaluate(() => [...document.querySelectorAll("#main input")].some((i) => i.value))), `Overview row: "${word}" goes to its details, not the row's panel (${r})`);
  }

  // 4. Cmd-click: a new tab on the Keywords list, searched for it.
  await go("competitors/summary");
  const any = page.locator("#main a.kw-link").first();
  if (await any.count()) {
    const [tab] = await Promise.all([context.waitForEvent("page", { timeout: 5000 }).catch(() => null), any.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] })]);
    check(Boolean(tab), "Cmd-click opens a new tab");
    if (tab) { await tab.waitForLoadState().catch(() => null); check(tab.url().includes("#keywords?"), `the new tab is on Keywords (${tab.url()})`); await tab.close(); }
    check((await route()).startsWith("#competitors"), "and this tab stays where it was");
  }

  const errs = problems.filter((p) => !/favicon|ERR_|404/.test(p));
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
