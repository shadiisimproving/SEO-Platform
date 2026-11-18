// Today, Overview's See page and Refresh failing, driven by hand like a normal user (SEO review fixes, 2026-11-17).
// Seeded demo world, with Search Console refusing on demand through a flag file (tests/ui/fake_google.py):
//   FAKE_GSC_FAIL_FILE=<file> DB_NAME_TEST=test_fix_ui_today_test .venv/bin/python tests/ui/app_server.py --port 8292
// Run: FAKE_GSC_FAIL_FILE=<same file> BASE=http://127.0.0.1:8292 SEOCC_REAL_DEFAULT=1 node tests/ui/flow_today_fixes.cjs [folder for screenshots]
const fs = require("fs");
const { open, menu } = require("./pw.cjs");

const BASE = (process.env.BASE || "http://127.0.0.1:8292").replace(/\/$/, "");
const OUT = process.argv[2] || "";
const FAIL = process.env.FAKE_GSC_FAIL_FILE || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${String(extra).slice(0, 240)}]` : ""}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
async function shot(page, name) {
  if (!OUT) return;
  const size = page.viewportSize();
  const tall = await page.evaluate(() => Math.max(document.querySelector("#main")?.scrollHeight || 0, document.body.scrollHeight));
  await page.setViewportSize({ width: size.width, height: Math.min(Math.max(tall, size.height), 6000) });
  await settle(page, 300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.setViewportSize(size);
}
const text = (page) => page.textContent("#page");
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const toasts = (page) => page.$$eval(".toast", (t) => t.map((x) => x.textContent.trim()));
const clicksFig = (page) => page.$eval('[data-card="clicks"] .fig, [data-ov-line="clicks"] .fig', (e) => e.textContent.trim()).catch(() => "");

async function today(page, lang = "en", width = 1440) {
  await page.goto(`${BASE}/#today?site=site-one.example`); await settle(page, 2500);
  if (lang === "fr") { await menu(page, "lang"); await settle(page, 1500); await page.keyboard.press("Escape"); } // the account menu is on the wide side menu
  if (width < 1440) { await page.setViewportSize({ width, height: 900 }); await settle(page, 1200); }
}

(async () => {
  for (const [width, lang] of [[1440, "en"], [390, "en"], [1440, "fr"], [390, "fr"]]) {
    const { browser, page, problems } = await open({ width: 1440, height: 900 });
    const tag = `${width}-${lang}`;
    const missing404 = [];
    page.on("response", (r) => { if (r.status() === 404) missing404.push(r.url().replace(BASE, "")); });
    await today(page, lang, width);
    if (await page.$("#show-all")) { await page.click("#show-all"); await settle(page, 400); } // every row, the 28-day findings too
    const body = await text(page);
    const todo = await page.$$eval(".rows li[data-row] .what .t", (e) => e.map((x) => x.textContent.trim()));
    if (lang === "en") {
      // "Key events" once the harness's worker has read the fake Google Analytics, whose sites count every key event.
      check(/(Leads|Key events) fell 50%: 28 → 14/.test(body), `${tag}: leads halving is a to-do`);
      check(/^(Leads|Key events) fell/.test(todo[0] || ""), `${tag}: lost leads come first`, todo[0]);
      check(/Likely cause: lower click rate at the same place/.test(body), `${tag}: a drop row says its likely cause`);
      check(/This week: avg pos 8 → 12/.test(body), `${tag}: "close to the top 3" says the search fell this week`);
      check(/avg pos 4 → 9/.test(body) && !/#4 → #9/.test(body), `${tag}: Going down says avg pos, not a rank`);
      // The two weeks are the harness's own (its data ends the day before yesterday), said as the card says them.
      const w = await page.evaluate(() => fetch("/api/today?site_id=1").then((r) => r.json()).then((d) => d.moves_window));
      const d = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));
      const weeks = w ? `${d(w.from)} – ${d(w.to)} vs ${d(w.before_from)} – ${d(w.before_to)}` : "(no window)";
      check(body.includes(weeks), `${tag}: the moves cards say their two weeks`, weeks);
      check(!/All clear/.test(body), `${tag}: with to-dos, no All clear`);
    } else {
      check(/Les (leads|événements clés) ont baissé de 50 % : 28 → 14/.test(body), `${tag}: leads halving in French`);
      check(/Cause probable : taux de clic plus bas/.test(body), `${tag}: likely cause in French`);
      check(/Cette semaine : pos\. moy\. 8 → 12/.test(body), `${tag}: this week in French`);
      check(/pos\. moy\. 4 → 9/.test(body), `${tag}: avg pos in French`);
    }
    check(await noSideways(page), `${tag}: Today has no sideways scroll`);
    await shot(page, `today-${tag}`);
    // See page on the drop row: Overview's numbers and chart are that page only.
    await page.click("[data-today-page]"); await settle(page, 3500);
    const ov = await text(page);
    check(lang === "en" ? /Numbers and chart for this page only/.test(ov) : /Chiffres et graphique pour cette page seulement/.test(ov), `${tag}: See page says the numbers are for this page only`);
    await shot(page, `overview-see-page-${tag}`);
    check(await noSideways(page), `${tag}: Overview has no sideways scroll`);
    if (width === 1440 && lang === "en") {
      const shown = await clicksFig(page);
      await page.click("[data-ov-only-clear]"); await settle(page, 2500);
      const whole = await clicksFig(page);
      check(shown && whole && shown !== whole, "Show the whole site brings back the site's clicks", `${shown} vs ${whole}`);
      check(!/this page only/.test(await text(page)), "and the page-only note goes");
      await page.goto(`${BASE}/#insights?site=site-one.example`); await settle(page, 2500);
      const ins = await text(page);
      check(!/The same list as Do these first/.test(ins), "Insights no longer claims to be Today's list");
      check(/Search findings only/.test(ins), "Insights says what its list is");
      await shot(page, "insights-first");
    }
    check(!problems.filter((p) => !/Failed to load resource/.test(p)).length, `${tag}: no page errors`, problems.join(" | "));
    if (missing404.length) console.log(`     404s: ${[...new Set(missing404)].join(", ")}`);
    await browser.close();
  }

  // Refresh failing on Overview: connect site-two to the fake Google, read once, then make Google refuse.
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#settings`); await settle(page, 2000);
  await page.evaluate(() => window.UI.openConnection("google"));
  await page.waitForSelector("#conn-form");
  await page.check('input[name="google-type"][value="robot"]');
  await page.fill("#conn-json", JSON.stringify({ client_email: "robot@team.iam.gserviceaccount.com", private_key: "-----BEGIN KEY-----x", private_key_id: "abcd9999" }));
  await page.click("#conn-test"); await page.waitForFunction(() => /works/.test(document.getElementById("conn-test-result")?.textContent || ""));
  await settle(page, 400);
  const missing = await page.$$eval("[data-prop-missing]", (e) => e.map((x) => x.textContent.trim()));
  check(missing.some((m) => /site-two\.example isn't shared with robot@team/.test(m)), "Test names each site the key can't see, in red", missing.join(" | "));
  await shot(page, "settings-google-tested");
  const site2 = await page.$eval('.prop-row:has-text("site-two.example") [data-prop="sc"]', (e) => e.dataset.site);
  await page.selectOption(`[data-prop="sc"][data-site="${site2}"]`, "sc-domain:mine-two.test");
  await page.click("#conn-save"); await settle(page, 2000);
  const saved = await toasts(page);
  check(saved.some((x) => /no Search Console or GA4 property picked/.test(x)), "Save says which sites read nothing", saved.join(" | "));
  check(saved.some((x) => /Fetch my first numbers/.test(x)), "Save offers Fetch my first numbers", saved.join(" | "));
  await shot(page, "settings-google-saved");
  const needs = await page.textContent("#set-tiles");
  check(/Site not linked/.test(needs), "Needs a fix counts a site linked to nothing", needs.replace(/\s+/g, " "));
  await page.locator(".toast button[data-undo]", { hasText: "Fetch my first numbers" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /Updated|read\./.test(t.textContent)), null, { timeout: 120000 }).catch(() => {});
  check((await toasts(page)).some((x) => /Updated/.test(x)), "Fetch my first numbers reads them and says so", (await toasts(page)).join(" | "));

  await page.goto(`${BASE}/#overview?site=site-two.example`); await settle(page, 3000);
  await shot(page, "overview-site2-live");
  if (FAIL) fs.writeFileSync(FAIL, "403");
  const started = Date.now();
  await page.click("[data-ov-refresh]");
  await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /of \d+ read/.test(t.textContent)), null, { timeout: 90000 }).catch(() => {});
  const waited = Math.round((Date.now() - started) / 1000);
  const failToast = (await toasts(page)).find((x) => /of \d+ read/.test(x)) || "";
  check(Boolean(failToast), `a refused Refresh says so on Overview (after ${waited} s)`, failToast);
  check(/Fix it/.test(failToast), "with Fix it");
  await settle(page, 2500);
  const after = await text(page);
  check(!/Search Console · live/.test(await page.textContent("body")), "the head no longer says live");
  check(/These are the last saved numbers/.test(after), "Overview shows the last saved numbers and the fix");
  await shot(page, "overview-site2-refused");
  if (FAIL) fs.rmSync(FAIL, { force: true });
  check(!problems.filter((p) => !/403|FORBIDDEN|Failed to load resource/i.test(p)).length, "refresh flow: no page errors", problems.join(" | "));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall ok");
  process.exit(fails.length ? 1 : 0);
})();
