// What the audit found: choices that looked saved on the real app but weren't. Every check reloads the page first.
const { open } = require("./pw.cjs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8232/";
const OUT = path.resolve("var/ui-csv-prospects") + "/";
let bad = 0;
const RUN = Date.now().toString(36), NEW_SITE = `new-${RUN}.example`, NEW_RIVAL = `rival-${RUN}.example`;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950, url: BASE + "#today" });
  const api = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), BASE + "api/" + p);
  const settle = () => page.waitForTimeout(800);
  const reload = async (hash = "today") => { await page.goto("about:blank"); await page.goto(BASE + "#" + hash); await page.waitForTimeout(1500); };
  const site = async () => (await api("links/sites")).sites.find((s) => s.host === "site-one.example");
  const source = async (id, name) => (await api("sources")).site_sources.find((r) => r.site_id === id && r.source === name);
  const openPanel = async () => page.evaluate(() => { const b = document.querySelector('[data-setup-panel]'); if (b) b.click(); return Boolean(b); });

  const openSetup = async () => {
    await page.goto("about:blank"); await page.goto(BASE + "#today"); await page.waitForTimeout(1500);
    await page.click("#site-switch"); await settle();
    await page.locator("#popover button", { hasText: NEW_SITE }).click(); await settle();
    const button = page.locator(`[data-setup-panel="${NEW_SITE}"]`);
    const there = (await button.count()) > 0;
    check("the setup panel can be opened on Today", there);
    if (there) { await button.first().click(); await page.waitForSelector('[data-setup-none="keywords"]'); }
    return there;
  };

  // A new site gets the checklist, as a person would: add it.
  await page.waitForTimeout(1500);
  await page.click("#site-switch"); await settle();
  await page.click("[data-add-site]");
  await page.fill("#site-address", NEW_SITE);
  await page.click("#site-save");
  await page.waitForSelector('[data-setup-none="clarity"]', { timeout: 15000 }); await settle();
  await page.screenshot({ path: OUT + "5-setup-panel.png" });
  const sites = (await api("links/sites")).sites, mine = sites.find((s) => s.host === NEW_SITE);
  check("new site saved", Boolean(mine));

  // Tick Clarity and Google, reload, and Settings' own data must agree
  await page.check('[data-setup-none="clarity"]'); await settle();
  await page.check('[data-setup-none="google"]'); await settle();
  await reload();
  let now = (await api("links/sites")).sites.find((s) => s.id === mine.id);
  check("checklist remembers both after reload", now.setup_not_used.includes("clarity") && now.setup_not_used.includes("google"), now.setup_not_used);
  const sources = async () => (await api("sources")).site_sources.filter((r) => r.site_id === mine.id && r.not_used).map((r) => r.source).sort().join();
  check("Settings' data says Not used for Clarity, GSC and GA4", (await sources()) === "clarity,ga4,gsc", await sources());

  // Untick one
  const opened = await openSetup();
  if (opened) {
    await page.waitForSelector('[data-setup-none="clarity"]'); await page.uncheck('[data-setup-none="clarity"]'); await settle();
    await reload();
    check("unticking Clarity sticks", (await sources()) === "ga4,gsc", await sources());
  }

  // Failure: the tick goes back and says so
  const again = await openSetup();
  if (again) {
    await page.waitForSelector('[data-setup-none="keywords"]');
    await page.route(`**/api/links/sites/${mine.id}`, (r) => r.request().method() === "PATCH" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"The server had a problem."}' }) : r.continue());
    await page.click('[data-setup-none="keywords"]'); await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT + "6-tick-failed.png" });
    check("a tick the server refused goes back", !(await page.isChecked('[data-setup-none="keywords"]')));
    check("and says so", (await page.locator(".toast").last().innerText().catch(() => "")).includes("problem"));
    await page.unroute(`**/api/links/sites/${mine.id}`);
  }

  // Add a competitor from the same panel; it must show under My competitors after a reload
  await page.goto("about:blank"); await page.goto(BASE + "#today"); await page.waitForTimeout(1500);
  await page.click("#site-switch"); await settle();
  await page.click("[data-add-site]");
  check("no site picker until it's a competitor", await page.locator("#site-rival-of").isHidden());
  await page.check('input[name="site-kind"][value="competitor"]');
  check("site picker appears for a competitor", await page.locator("#site-rival-site").isVisible());
  await page.screenshot({ path: OUT + "7-add-competitor.png" });
  await page.selectOption("#site-rival-site", NEW_SITE);
  await page.click("#site-save"); await settle();
  check("empty address is explained in the form", (await page.locator("#site-error").innerText()).length > 3, await page.locator("#site-error").innerText());
  await page.fill("#site-address", NEW_RIVAL);
  await page.click("#site-save"); await settle();
  const rivals = await api(`competitors?site_id=${mine.id}`);
  check("competitor is linked to that site", rivals.competitors.some((c) => c.host === NEW_RIVAL), rivals.competitors.map((c) => c.host).join());
  await reload(`competitors`);
  await page.screenshot({ path: OUT + "8-competitors-after-reload.png" });

  // Settings: the other session's fix for keys that are for the whole app
  await reload("settings");
  const panelOf = async (name) => {
    const row = page.locator("button, [role=button], tr, .conn-row, .conn").filter({ hasText: name }).first();
    await row.click(); await page.waitForSelector("#conn-form", { timeout: 8000 }); await page.waitForTimeout(300);
    const scope = await page.locator('input[name="conn-scope"]').count();
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    return scope;
  };
  try {
    check("Moz doesn't offer a choice it can't save", (await panelOf("Moz")) === 0);
    check("Bing still offers it", (await panelOf("Bing")) > 0);
  } catch (err) { console.log("settings check skipped:", err.message.split("\n")[0]); bad += 1; }

  const real = problems.filter((p) => p.startsWith("pageerror"));
  console.log("page errors:", real.length ? real : "none");
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
