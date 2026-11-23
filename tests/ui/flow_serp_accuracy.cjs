// Rank checks made true (2026-11-18): the keyword panel greys suspect checks with their reason, the AI Overview watch names
// the tool that looked and says Not checked, Rank and clicks raises no alert from a disputed check. Desktop and phone, EN and FR.
//   DB_NAME_TEST=<your>_test .venv/bin/python tests/ui/app_server.py --port 8312 --keep   (a copy of real data: keep the shots out of git)
//   SEOCC_REAL_DEFAULT=1 node tests/ui/flow_serp_accuracy.cjs http://127.0.0.1:8312/ <host> <keyword> <out dir>
const { open } = require("./pw.cjs");
const fs = require("fs");
const [BASE = "http://127.0.0.1:8312/", HOST = "site-one.example", WORD = "", OUT = "var/ui-serp"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (ok, name) => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const french = async (page, lang) => { if (lang === "fr") { await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await settle(page); } };

async function run(width, lang) {
  const tag = `${width}-${lang}`, fr = lang === "fr";
  const { browser, page, problems } = await open({ width, height: width < 500 ? 844 : 900 });
  await page.goto(`${BASE}?flow=${Date.now()}#keywords?site=${HOST}`);
  await page.waitForSelector("#kw-table tbody tr", { timeout: 30000 });
  await french(page, lang); await settle(page, 1200);
  await page.screenshot({ path: `${OUT}/${tag}-keywords.png` });
  if (WORD) {
    await page.locator("#kw-table tbody tr", { hasText: WORD }).first().click();
    await page.waitForSelector("#panel", { timeout: 15000 }); await settle(page, 1500);
    const panel = await page.locator("#panel").innerText();
    check((fr ? /Résultat (suspect|douteux)/.test(panel) : panel.includes("Suspect result")), `${tag}: the panel lists the suspect check`);
    check(panel.includes(fr ? "Les autres outils ont vu d'autres sites" : "Other tools saw other sites"), `${tag}: and says why, in ${lang}`);
    check(await page.locator("#panel .kw-row-suspect").count() > 0, `${tag}: its row is greyed`);
    check(!(await page.locator("#tool-table").innerText()).includes(fr ? "jamais" : "never") || !panel.includes("SerpApi"), `${tag}: a tool whose checks are all suspect never reads "never"`);
    await page.screenshot({ path: `${OUT}/${tag}-panel.png` });
    await page.locator("#panel .kw-row-suspect").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${tag}-panel-suspect.png` });
    await page.keyboard.press("Escape");
  }
  await page.goto("about:blank"); await page.goto(`${BASE}?flow=${Date.now()}#ai?site=${HOST}`); await settle(page, 2500); await french(page, lang); await settle(page, 1200);
  const ai = await page.locator("main").innerText();
  check(ai.includes(fr ? "relevés avec SerpApi" : "checked with SerpApi"), `${tag}: AI search names the tool that looked`);
  await page.screenshot({ path: `${OUT}/${tag}-ai-search.png` });
  await page.goto("about:blank"); await page.goto(`${BASE}?flow=${Date.now()}#competitors/ai?site=${HOST}`); await settle(page, 2500); await french(page, lang); await settle(page, 1200);
  const watch = await page.locator("main").innerText();
  check((fr ? /Non (relevé|contrôlé)/.test(watch) : watch.includes("Not checked")) && !watch.includes(fr ? "Non capté" : "Not captured"), `${tag}: the watch says Not checked`);
  await page.screenshot({ path: `${OUT}/${tag}-ai-watch.png` });
  await page.goto("about:blank"); await page.goto(`${BASE}?flow=${Date.now()}#insights?site=${HOST}&tab=mix`); await settle(page, 2500); await french(page, lang); await settle(page, 1200);
  const mixTab = page.locator('[data-in-tab="mix"], [data-tab="mix"]').first();
  if (await mixTab.count()) { await mixTab.click(); await settle(page, 1200); }
  const mix = await page.locator("main").innerText();
  check(!/ouvrir societe dubai/i.test(mix.split("\n").filter((l) => /(drop|baisse|chute)/i.test(l)).join(" ")), `${tag}: no rank drop for ouvrir societe dubai`);
  await page.screenshot({ path: `${OUT}/${tag}-rank-and-clicks.png`, fullPage: width > 500 });
  const real = problems.filter((p) => !/404 \(NOT FOUND\)/.test(p)); // the harness has no login, so /api/auth/me answers 404
  check(!real.length, `${tag}: no page errors ${real.slice(0, 2).join(" | ")}`);
  await browser.close();
}
(async () => {
  for (const [w, l] of [[1440, "en"], [1440, "fr"], [390, "en"], [390, "fr"]]) await run(w, l);
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
