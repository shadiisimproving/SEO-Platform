// Insights → What changed after the 2026-11-17 rework (part 1, no AI): Pages then Searches, the folded "Small or uncertain",
// and a page row's panel with every section, in English and French, at desktop and phone width. Screenshots to look at.
//   DB_NAME_TEST=test_x_test DB_POOL_SIZE=2 .venv/bin/python tests/ui/what_changed_server.py --port 8291
// Run: node tests/ui/flow_insights_what_changed.cjs reports/what-changed http://127.0.0.1:8291/
const fs = require("fs");
const { open } = require("./pw.cjs");
const out = process.argv[2] || "reports/what-changed";
const BASE = process.argv[3] || "http://127.0.0.1:8291/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

async function run(width, height, tag) {
  const { browser, page, problems } = await open({ width, height, url: `${BASE}?simple=1&flow=${Date.now()}#insights` });
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 3000 }).catch(() => "");
  const count = (sel) => page.locator(sel).count();
  const shot = (name, full = false) => page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: full });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.url().replace(BASE, "/")}`); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "shop-one.test"); if (s) { window.UI.state.site = s.id; window.UI.render(); } });
  await page.waitForTimeout(1500);

  // The account menu sits in the side menu, closed at phone width: pressed from the page itself.
  const setLang = async () => { await page.evaluate(() => document.querySelector("#acct-btn")?.click()); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('#popover [data-mock="lang"]')?.click()); };
  const openTab = async () => { await page.click('[data-in-tab="changed"]'); await page.waitForTimeout(1000); };
  const pageRow = (name) => page.locator('[data-in-block="pages"] tbody tr', { hasText: name }).first();

  await step(`${tag}: the two blocks`, async () => {
    await openTab();
    await shot("01-what-changed", true);
    const blocks = await page.locator("[data-in-block]").evaluateAll((els) => els.map((e) => e.dataset.inBlock));
    check(blocks[0] === "pages" && blocks[1] === "searches", `Pages first, then Searches (${blocks.join(", ")})`);
    const pages = await page.locator('[data-in-block="pages"] tbody tr').allInnerTexts();
    check(pages.some((r) => r.includes("/banned-drugs/") && /Ranking|Classement/.test(r)), "the 6.5 → 7.9 page says Ranking");
    check(pages.some((r) => r.includes("/visa/") && /Not indexed|Non indexée/.test(r)), "the page Google doesn't index says so");
    check(pages.some((r) => r.includes("/boots/") && /Since|Depuis/.test(r)), "the page that fell on a day says since when");
    check(pages.some((r) => /−\d+%/.test(r) && /\d+ → \d+/.test(r)), "clicks as −N% with before → now under it");
    const heads = await page.locator('[data-in-block="pages"] thead th').allInnerTexts();
    check(heads.some((h) => /Lost \/ month|Perdus \/ mois/.test(h)), "the stake column says Lost / month");
    const searches = await page.locator('[data-in-block="searches"] tbody tr').allInnerTexts();
    check(searches.some((r) => r.includes("visa price") && /top 3/.test(r)), "a search out of the top 3");
    check(searches.some((r) => r.includes("what is a free zone") && /fewer clicks|moins de clics/i.test(r)), "fewer clicks at the same place");
    check(searches.filter((r) => /company setups? dubai|dubai company setup/.test(r)).length === 1 && searches.some((r) => /\+ 2/.test(r)), "three alike searches are one row, + 2 alike");
    check(!searches.some((r) => r.includes("winter boots")), "a search whose page is listed above isn't said twice");
    const all = (await text(".in-wc")) || "";
    check(!all.includes("scarves") , "the chance drop is folded away");
    check((await count("[data-in-fold]")) === 1 && /Small or uncertain|Petits ou incertains/.test(await text("[data-in-fold]")), "one fold: gains, small or uncertain");
  });

  await step(`${tag}: the fold`, async () => {
    await page.click("[data-in-fold]");
    await page.waitForTimeout(500);
    check((await page.locator("[data-in-fold]").getAttribute("aria-expanded")) === "true", "the fold says it's open");
    const small = await text('[data-in-block="small"]');
    check(small.includes("/scarves/") && /Could be chance|Peut-être le hasard/.test(small), "the scarves drop is there, marked Could be chance");
    check((await text('[data-in-block="gains"]')).includes("/gloves/"), "the gain is there");
    await page.locator('[data-in-block="small"]').scrollIntoViewIfNeeded();
    await shot("02-folded");
    await page.click("[data-in-fold]");
    await page.waitForTimeout(400);
  });

  await step(`${tag}: a page row's panel`, async () => {
    await pageRow("/banned-drugs/").click();
    await page.waitForSelector("#panel.rp .rp-sec", { timeout: 6000 });
    await page.waitForTimeout(700);
    await shot("03-panel");
    const body = (await text("#panel .rp-body")).replace(/\s+/g, " "); // brand logos (brands.js) split "Google index" with spaces
    for (const [en, fr] of [["Why", "Pourquoi"], ["Searches behind it", "Les recherches derrière"], ["Google index", "Index Google"], ["Did my page change?", "Ma page a-t-elle changé ?"], ["What to do", "Que faire"], ["Open in", "Ouvrir dans"]]) {
      check(body.includes(en) || body.includes(fr), `the panel has ${en}`);
    }
    check((await count("#panel .in-bar-row")) >= 3, "Why: Ranking, Click rate, Searches rows");
    check((await count("#panel .in-behind li")) >= 2, "its searches, each with a tag");
    check(/Indexed|Indexée/.test(await text("#panel .in-google")), "Google says indexed");
    check((await count("#panel .in-edits li")) === 3, "my edit: title, headings, text");
    const link = await page.locator("#panel a.in-console").getAttribute("href");
    check((link || "").startsWith("https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Ashop-one.test&page=!"), "Open in Search Console, filtered to the page");
    check(/average of all its searches|moyenne de toutes ses recherches/.test(body), "Why says the position is the average of all its searches");
    await page.locator("#panel .in-edits").scrollIntoViewIfNeeded();
    await shot("04-panel-lower");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  await step(`${tag}: the not-indexed panel`, async () => {
    await pageRow("/visa/").click();
    await page.waitForSelector("#panel.rp .in-google", { timeout: 6000 });
    await page.waitForTimeout(500);
    const g = await text("#panel .in-google");
    check(/Not indexed|Non indexée/.test(g) && g.includes("Crawled - currently not indexed"), "Google's own words");
    check(/another address|autre adresse/.test(g), "Google chose another address, as a link");
    await shot("05-panel-not-indexed");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  await step(`${tag}: the AI Overview tag`, async () => {
    await pageRow("/hats/").click();
    await page.waitForSelector("#panel.rp .in-behind", { timeout: 6000 });
    await page.waitForTimeout(500);
    check((await count("#panel .in-qtag.q-aio")) === 1, "its tracked search shows the AI Overview");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  await step(`${tag}: French`, async () => {
    await setLang();
    await page.waitForTimeout(1200);
    await openTab();
    await shot("06-fr", true);
    const all = await text(".in-wc");
    check(/Pages/.test(all) && /Recherches/.test(all) && /Perdus \/ mois/.test(all) && /Depuis le/.test(all), "French blocks, columns and since");
    await pageRow("/banned-drugs/").click();
    await page.waitForSelector("#panel.rp .rp-sec", { timeout: 6000 });
    await page.waitForTimeout(600);
    const body = (await text("#panel .rp-body")).replace(/\s+/g, " ");
    check(body.includes("Pourquoi") && body.includes("Index Google") && body.includes("Ma page a-t-elle changé ?") && body.includes("Que faire"), "the panel in French");
    check(!/\b(Lost places|Did my page|Searches behind)\b/.test(body), "no English left in the panel");
    await shot("07-fr-panel");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await setLang();
    await page.waitForTimeout(800);
  });

  if (width < 500) {
    await step(`${tag}: no sideways scroll`, async () => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(wide <= 1, `the phone page doesn't scroll sideways (${wide}px)`);
    });
  }
  check(!failed.length, `no failed requests${failed.length ? `: ${failed.join(", ")}` : ""}`);
  // Without sign-in /api/auth/me answers 404 on every screen, and the browser logs it: not this screen's doing.
  const real = problems.filter((p) => !(p.includes("404") && !failed.length));
  check(!real.length, `no page errors${real.length ? `: ${real.join(" | ")}` : ""}`);
  await browser.close();
}

(async () => {
  await run(1440, 900, "desktop");
  await run(390, 844, "phone");
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
