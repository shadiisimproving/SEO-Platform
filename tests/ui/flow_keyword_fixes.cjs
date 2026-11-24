// Keywords after the expert review fixes (2026-11-17), driven by hand with screenshots: Lost / New / Still out in
// Change, the Down chip and the Top 10 change counting them, the amber age badge when the main tool's check is too old,
// the ranking URL with Search Console's most-shown page said apart, each engine tab showing only its own numbers, one card
// for an engine no tool can search, and the panel's All results with each check's URL. English and French, 1440 and 390.
// Needs the demo world plus the extra checks of the fix (see reports/seo-expert-2026-11-17/fixes/keywords.md):
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8293 &
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_keyword_fixes.py
//   node tests/ui/flow_keyword_fixes.cjs <folder for screenshots> http://127.0.0.1:8293/
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8293/";
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const rowText = (page, words) => page.locator("#kw-table tbody tr", { hasText: words }).first().innerText();

async function run(width, lang) {
  const tag = `${width}-${lang}`;
  const r = await open({ width, height: width < 500 ? 844 : 900 });
  const { page } = r;
  await r.context.addInitScript(() => { try { localStorage.setItem("seocc2-kwb-source", "checks"); } catch { /* no storage */ } }); // Up / Down from our checks
  await page.goto(`${BASE}?flow=${Date.now()}&simple=1#keywords?site=site-one.example`);
  await page.waitForSelector("#kw-table tbody tr", { timeout: 20000 });
  if (lang === "fr") { await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await settle(page); }
  await settle(page, 1200);
  const fr = lang === "fr";
  const sub = await rowText(page, "coffee subscription");
  check(sub.includes(fr ? "Perdu" : "Lost"), `${tag}: a #2 that fell out of the top 10 says Lost (the one Up / Down rule, 2026-11-23: lost counts as Down)`);
  check(!sub.includes(fr ? "Premier contrôle" : "First check"), `${tag}: never First check on a keyword checked many times`);
  const spec = await rowText(page, "specialty coffee online");
  check(spec.includes(fr ? "Nouveau" : "New"), `${tag}: out → #7 says New`);
  const jp = await rowText(page, "コーヒー");
  check(jp.includes(fr ? "Toujours hors" : "Still out"), `${tag}: out twice says Still out`);
  const best = await rowText(page, "best coffee beans");
  check(best.includes("120"), `${tag}: the passed-over main tool's age shows on the row`);
  // The simpler screens fold Impressions into Columns since Track C (2026-11-20): tick it, as a person would, to see the mark.
  await page.evaluate(() => { window.UI.state.cols.vol = true; window.UI.render(); }); await settle(page);
  const grains = await page.locator("#kw-table tbody tr", { hasText: "café en grains" }).first().locator(".kw-spell").count();
  await page.evaluate(() => { window.UI.state.cols.vol = false; window.UI.render(); }); await settle(page);
  check(grains === 1, `${tag}: café en grains (tracked once) marks its impressions as including other spellings`);
  const tile = await page.locator('[data-card="kw-top10"]').innerText();
  console.log("   top10 tile:", tile.replace(/\s+/g, " "));
  await page.screenshot({ path: `${out}/${tag}-google.png`, fullPage: true });
  // Down chip counts the drop out
  await page.click("#kw-filter"); await settle(page);
  const down = await page.locator('[data-filter="down"]').innerText();
  // Up / Down follow Search Console's 7 days by default since 2026-11-20; with "Our checks" chosen they count our checks,
  // a drop out of the depth included, the same count as the server's tile.
  const tileDown = await page.evaluate(async () => (await (await fetch(`api/rankings?site_id=${window.UI.state.site}`)).json()).tiles.google.down);
  check(tileDown >= 2 && new RegExp(`(^|\\D)${tileDown}(\\D|$)`).test(down.trim()), `${tag}: the Down chip counts the places lost and the drop out (${tileDown}): ${down.replace(/\s+/g, " ")}`);
  await page.click("#kw-filter-close").catch(() => {}); await settle(page);
  // Queries: Track on "abonnement cafe" when "abonnement café" is tracked says so first, then offers this spelling too
  await page.click("#kw-filter"); await page.click('[data-view="queries"]'); await settle(page, 1500);
  const track = page.locator('[data-kwr-follow="abonnement cafe"]');
  check(await track.count() === 1, `${tag}: Track is offered on the unaccented spelling`);
  if (await track.count()) {
    await track.click(); await settle(page);
    const said = await page.locator(".kw-twin").innerText().catch(() => "");
    check(said.includes("abonnement café"), `${tag}: Track first says "${said}"`);
    check(await page.locator('[data-kwr-follow="abonnement cafe"][data-sure]').count() === 1, `${tag}: and offers Track this spelling too`);
    await page.screenshot({ path: `${out}/${tag}-track-twin.png`, fullPage: false });
  }
  await page.evaluate(() => { window.UI.state.view = "positions"; window.UI.render(); }); await settle(page, 900);
  if (await page.locator("#kw-filter-close").count()) { await page.click("#kw-filter-close"); await settle(page); }
  // An engine other than Google shows only its own numbers: no Google impressions, AI column or Search Console in the head.
  // Bing, which a tool could search but nothing was checked on, has no tab (owner, 2026-11-24).
  const tabs = await page.$$eval("[data-engine]", (els) => els.map((el) => el.dataset.engine));
  check(!tabs.includes("bing"), `${tag}: Bing, never checked, has no tab (tabs: ${tabs.join(",") || "none"})`);
  const other = tabs.find((id) => id !== "google" && id !== "all");
  if (other) {
    await page.click(`[data-engine="${other}"]`); await settle(page, 900);
    const otherHead = await page.locator("#kw-table thead").innerText().catch(() => "");
    check(!/\bAI\b|\bIA\b/.test(otherHead), `${tag}: ${other} has no AI column`);
    check(!(await page.locator('[data-card="kw-cited"]').count()), `${tag}: ${other} has no Cited by AI card`);
    const line = await page.locator(".head-src").allInnerTexts();
    check(!line.join(" ").includes("Search Console"), `${tag}: ${other}'s head doesn't name Search Console`);
    await page.screenshot({ path: `${out}/${tag}-${other}.png`, fullPage: true });
  }
  // Yandex: no tool can search it and nothing was checked on it, so it has no tab and isn't named (owner, 2026-11-24).
  check(!(await page.locator('[data-engine="yandex"]').count()), `${tag}: Yandex, never checked, has no tab`);
  check(!/Yandex/.test(await page.locator("#page").innerText()), `${tag}: and isn't named on the screen`);
  if (tabs.includes("all")) {
    await page.click('[data-engine="all"]'); await settle(page, 900);
    const cited = await page.locator('[data-card="kw-cited"]').innerText().catch(() => "");
    check(cited.includes(fr ? "Google uniquement" : "Google only"), `${tag}: All engines' AI card says Google only`);
    check(!/Bing|Yandex/.test(await page.locator("#kw-table thead").innerText().catch(() => "")), `${tag}: All engines has no Bing or Yandex column`);
    await page.screenshot({ path: `${out}/${tag}-all.png`, fullPage: true });
  }
  // Panel of "how to brew coffee": ranking now vs most shown in Search Console, URL per check
  if (tabs.includes("google")) { await page.click('[data-engine="google"]'); await settle(page, 900); }
  await page.locator("#kw-table tbody tr", { hasText: "how to brew coffee" }).first().click(); await settle(page, 1500);
  const panel = await page.locator("#panel").innerText();
  check(panel.includes(fr ? "Classée maintenant" : "Ranking now") && panel.includes("/guide/brew"), `${tag}: panel names the page that ranked`);
  check(panel.includes(fr ? "La plus affichée dans Search Console" : "Most shown in Search Console") && panel.includes("/blog/brewing"), `${tag}: and Search Console's page, said apart`);
  await page.screenshot({ path: `${out}/${tag}-panel.png` });
  await page.locator("#panel .panel-body").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await settle(page);
  await page.screenshot({ path: `${out}/${tag}-panel-results.png` });
  r.problems = r.problems.filter((p) => !/status of 404/.test(p)); // the harness has no login: /api/auth/me answers 404
  if (r.problems.length) check(false, `${tag}: page errors ${r.problems.join(" | ")}`);
  await r.browser.close();
}

(async () => {
  for (const width of [1440, 390]) for (const lang of ["en", "fr"]) await run(width, lang);
  console.log(fails.length ? `${fails.length} FAILED` : "all ok");
  process.exit(fails.length ? 1 : 0);
})();
