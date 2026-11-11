// How well the app reads a competitor's site, and Firecrawl as the asked-for backup. Made-up sites and a fake Firecrawl only.
// Run against a freshly started demo world (it spends fake credits and saves a key, so restart it before each run):
//   DB_NAME_TEST=test_reading_test .venv/bin/python tests/ui/app_server.py --port 8271
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8271/";
const OUT = path.resolve("var/ui-competitor-reading") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const failed = []; // the harness runs without login, so /api/auth/me answers 404 by design
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) failed.push(`${r.status()} ${r.url()}`); });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  const settle = () => page.waitForTimeout(1200);
  const until = async (test, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await page.waitForTimeout(800); } return false; };
  // What a box says: its short lines and the full sentences behind their (i) tips (data-tip), since 2026-11-11.
  const said = (loc) => loc.evaluate((n) => `${n.textContent} ${[...n.querySelectorAll("[data-tip]")].map((e) => e.getAttribute("data-tip")).join(" ")}`).catch(() => "");
  await page.goto(BASE + "#today");
  const site = (await call("GET", "links/sites")).sites.find((s) => s.kind === "own" || s.kind === undefined) || {};
  const have = (await call("GET", `competitors?site_id=${site.id}`)).competitors;
  const add = async (host) => have.find((c) => c.host === host) || call("POST", "competitors", { site_id: site.id, address: host });
  const spa = await add("spa-rival.example"), nomap = await add("nomap-rival.example");
  const profileOf = (id) => call("GET", `competitors/${id}/profile?site_id=${site.id}`);
  const readDone = (id) => until(async () => { const c = (await profileOf(id)).crawl || {}; return c.status === "ok" || c.status === "blocked" || c.status === "failed"; });
  check("both made-up rivals were read", (await readDone(spa.id)) && (await readDone(nomap.id)));

  const openProfile = async (id) => {
    await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle();
    if (await page.$("#comp-site")) { await page.selectOption("#comp-site", String(site.id)); await settle(); }
    await page.click(`[data-cs-open="${id}"]`); await settle();
    await page.$$eval(".rd-fold", (folds) => folds.forEach((d) => { d.open = true; })); // since 2026-11-10 the second and later reading notes fold under the first
  };

  // No Firecrawl yet: the hints say what's missing, and where to fix it.
  await openProfile(spa.id);
  const box = page.locator(`[data-rd-box="${spa.id}"]`);
  check("a JavaScript-only site gets the box", (await box.count()) === 1);
  check("the confirm step stays hidden until a click", await box.locator(".rd-confirm").isHidden());
  check("it says how many pages need JavaScript", /4 pages only show their text with JavaScript/.test(await said(box)));
  check("without a key it points to Settings and offers no paid button", (await box.locator('[data-go="settings"]').count()) >= 1 && (await box.locator("[data-rd-ask]").count()) === 0);
  await page.screenshot({ path: OUT + "1-spa-no-key.png", fullPage: true });

  await openProfile(nomap.id);
  const nbox = page.locator(`[data-rd-box="${nomap.id}"]`);
  check("a site with no sitemap is flagged", /has no sitemap/.test(await said(nbox)));

  // Settings has the Firecrawl card.
  await page.goto("about:blank"); await page.goto(BASE + "#settings"); await settle();
  check("Settings lists Firecrawl", /Firecrawl/.test(await page.textContent("body")));
  await page.screenshot({ path: OUT + "2-settings.png", fullPage: true });
  const saved = await call("PUT", "app-keys/firecrawl", { key: "fc-demo-key-1234" });
  check("the key is saved", saved.connected === true);
  const tested = await call("POST", "app-keys/firecrawl/test");
  check("Test shows the credits, free", tested.ok === true && tested.left === 936, JSON.stringify(tested));

  // With a key: nothing runs until the person confirms, and the cost is shown first.
  await openProfile(spa.id);
  const ask = box.locator('[data-rd-ask="read"]');
  check("the paid button shows its cost", (await ask.count()) === 1 && /~4 credits/.test(await ask.textContent()));
  const before = (await call("POST", "app-keys/firecrawl/test")).left;
  await ask.click(); await settle();
  const confirm = box.locator(".rd-confirm");
  check("the confirm step shows the credits left", /936 of 1,000 credits left/.test(await confirm.textContent()), await confirm.textContent());
  check("opening it spent nothing", (await call("POST", "app-keys/firecrawl/test")).left === before);
  await page.screenshot({ path: OUT + "3-spa-confirm.png", fullPage: true });
  await confirm.locator("[data-rd-cancel]").click(); await settle();
  check("Cancel closes it and spends nothing", (await confirm.isHidden()) && (await call("POST", "app-keys/firecrawl/test")).left === before);

  await ask.click(); await settle();
  await confirm.locator("[data-rd-go]").click();
  const finished = await until(async () => /pages were read with Firecrawl/.test(await said(page.locator(`[data-rd-box="${spa.id}"]`))));
  check("after the run the box says the pages were read with Firecrawl", finished);
  const after = (await profileOf(spa.id)).crawl;
  check("no JavaScript-only page is left unread", after.js_only === 0 && after.firecrawl.pages === 4, JSON.stringify(after.firecrawl));
  check("4 credits were used", (await call("POST", "app-keys/firecrawl/test")).left === before - 4);
  check("Check for edits is offered", (await page.locator(`[data-rd-box="${spa.id}"] [data-rd-ask="reread"]`).count()) === 1);
  await page.screenshot({ path: OUT + "4-spa-read.png", fullPage: true });

  // No sitemap: Firecrawl lists the pages, and the free daily reader reads them.
  await openProfile(nomap.id);
  await page.locator(`[data-rd-box="${nomap.id}"] [data-rd-ask="map"]`).click(); await settle();
  await page.locator(`[data-rd-box="${nomap.id}"] [data-rd-go="map"]`).click();
  // The box swaps "only finds the 3 pages its home page links to" for the list Firecrawl made, with how many pages are now watched.
  const listed = await until(async () => /Firecrawl listed its pages .*watches all 6\b/.test(await said(page.locator(`[data-rd-box="${nomap.id}"]`))));
  check("after the list run the box says Firecrawl listed the pages, and how many are watched now", listed, ((await page.locator(`[data-rd-box="${nomap.id}"]`).textContent().catch(() => "")) || "").trim().slice(0, 160));
  const deep = await until(async () => ((await profileOf(nomap.id)).crawl?.pages_tried || 0) >= 6); // 3 linked from home, 3 only Firecrawl found
  check("the daily reader then read the deeper pages", deep, (await profileOf(nomap.id)).crawl?.pages_tried);
  await page.screenshot({ path: OUT + "5-nomap-listed.png", fullPage: true });

  // French and a narrow screen.
  await openProfile(spa.id);
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render?.(); }); await settle();
  check("French words", /Ce que l'appli arrive à lire|lues avec Firecrawl/.test(await page.textContent("body")));
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.screenshot({ path: OUT + "6-narrow-fr.png", fullPage: true });
  check("no sideways scroll at phone width", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render?.(); });

  const real = problems.filter((p) => !/Failed to load resource/.test(p));
  check("no script errors and no failed request", real.length === 0 && failed.length === 0, [...real, ...failed].slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
