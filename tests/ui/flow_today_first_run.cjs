// The first run, before and after the first read (SEO review fixes, 2026-11-17): no "All clear" with nothing connected,
// "Waiting for first data" with Refresh data, no "real zero" on AI search, the Search Console property pre-picked for a
// www address. Needs an empty app:
//   DB_NAME_TEST=test_fix_ui_today_test .venv/bin/python tests/ui/app_server.py --port 8292 --empty --slow 0
// Run: BASE=http://127.0.0.1:8292 SEOCC_REAL_DEFAULT=1 node tests/ui/flow_today_first_run.cjs [folder for screenshots]
const fs = require("fs");
const { open, menu } = require("./pw.cjs");

const BASE = (process.env.BASE || "http://127.0.0.1:8292").replace(/\/$/, "");
const OUT = process.argv[2] || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${String(extra).slice(0, 240)}]` : ""}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const shot = (page, name) => (OUT ? page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }) : null);
const text = (page) => page.textContent("#page");

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/#today`); await settle(page, 1500);
  await page.click("#site-switch"); await settle(page, 300);
  await page.click("#popover [data-add-site]"); await page.waitForSelector("#site-form");
  await page.fill("#site-address", "https://www.mine-one.test/");
  await page.click("#site-save"); await settle(page, 2500);
  await page.keyboard.press("Escape"); await settle(page, 400);
  await page.goto(`${BASE}/#today`); await settle(page, 2500);
  let body = await text(page);
  check(!/All clear/.test(body), "nothing connected: no All clear", body.slice(0, 200));
  check(/Not set up yet/.test(body), "says Not set up yet");
  check(Boolean(await page.$(".today-answer [data-today-connect]")), "with Connect Google under the answer");
  await shot(page, "first-1-today-nothing");

  await page.click(".today-answer [data-today-connect]"); await page.waitForSelector("#conn-form");
  await page.check('input[name="google-type"][value="robot"]');
  await page.fill("#conn-json", JSON.stringify({ client_email: "robot@team.iam.gserviceaccount.com", private_key: "-----BEGIN KEY-----x", private_key_id: "abcd9999" }));
  await page.click("#conn-test"); await page.waitForFunction(() => /works/.test(document.getElementById("conn-test-result")?.textContent || ""));
  await settle(page, 400);
  const sc = await page.$eval('[data-prop="sc"]', (e) => e.value);
  const ga = await page.$eval('[data-prop="ga4"]', (e) => e.value);
  check(sc === "sc-domain:mine-one.test", "a www address gets its domain property pre-picked", sc);
  check(ga === "111222333", "and its GA4 property by name", ga);
  check(!(await page.$("[data-prop-missing]")), "no red warning when the property is found");
  await shot(page, "first-2-tested");
  await page.click("#conn-save"); await settle(page, 1500);
  check((await page.$$eval(".toast", (t) => t.map((x) => x.textContent))).some((x) => /Fetch my first numbers/.test(x)), "Save offers Fetch my first numbers");
  await page.$$eval(".toast [data-dismiss]", (b) => b.forEach((x) => x.click()));

  for (const lang of ["en", "fr"]) {
    if (lang === "fr") { await menu(page, "lang"); await settle(page, 800); await page.keyboard.press("Escape"); }
    await page.goto(`${BASE}/#today`); await settle(page, 2500);
    body = await text(page);
    check(!/All clear|Rien d'urgent/.test(body), `${lang}: waiting: no All clear`);
    check(lang === "en" ? /Waiting for first data/.test(body) : /En attente des premières données/.test(body), `${lang}: says Waiting for first data`);
    check(Boolean(await page.$(".today-answer [data-lv-collect]")), `${lang}: with Refresh data right there`);
    await shot(page, `first-3-today-waiting-${lang}`);
    await page.goto(`${BASE}/#ai`); await settle(page, 2500);
    body = await page.textContent("body");
    check(!/real zero|vrai zéro/.test(body), `${lang}: AI search says no "real zero" before the first read`);
    check(!/Source up to date|sources up to date|Source à jour/.test(body), `${lang}: nor "up to date"`);
    check(lang === "en" ? /Waiting for data|waiting for data/.test(body) : /attente/.test(body), `${lang}: it says waiting`);
    await shot(page, `first-4-ai-waiting-${lang}`);
    await page.setViewportSize({ width: 390, height: 900 }); await settle(page, 800);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${lang}: AI search phone: no sideways scroll`);
    await shot(page, `first-4-ai-waiting-phone-${lang}`);
    await page.goto(`${BASE}/#today`); await settle(page, 2000);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${lang}: Today phone: no sideways scroll`);
    await shot(page, `first-3-today-waiting-phone-${lang}`);
    await page.setViewportSize({ width: 1440, height: 1000 }); await settle(page, 500);
  }
  await page.goto(`${BASE}/#today`); await settle(page, 2000);
  await page.click(".today-answer [data-lv-collect]");
  await page.waitForFunction(() => !/En attente des premières données/.test(document.querySelector("#page")?.textContent || ""), null, { timeout: 120000 }).catch(() => {});
  await settle(page, 3000);
  body = await text(page);
  check(!/En attente des premières données/.test(body), "after Refresh data the first numbers arrive");
  await shot(page, "first-5-today-after-read-fr");
  check(!problems.filter((p) => !/Failed to load resource/.test(p)).length, "no page errors", problems.join(" | "));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall ok");
  process.exit(fails.length ? 1 : 0);
})();
