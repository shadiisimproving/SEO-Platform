// Keyword check: type keywords, confirm the searches, see each competitor's position. Made-up sites and a demo search tool only.
// Run against a freshly started demo world:
//   DB_NAME_TEST=test_reading_test .venv/bin/python tests/ui/app_server.py --port 8271
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8271/";
const OUT = path.resolve("var/ui-keyword-check") + "/";
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
  // Searches used so far, from the demo tool's free allowance that the app counts down.
  const searches = async () => { const row = ((await call("GET", "tools")).tools || []).find((x) => x.name === "SerpApi"); return row ? row.of - row.left : NaN; };

  await page.goto(BASE + "#today");
  const site = (await call("GET", "links/sites")).sites.find((s) => s.kind === "own" || s.kind === undefined) || {};
  await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle();
  if (await page.$("#comp-site")) { await page.selectOption("#comp-site", String(site.id)); await settle(); }
  await page.click('[data-comp-tab="check"]'); await settle();
  check("the tab is there and starts empty", /No keywords yet/.test(await page.textContent("#comp-body, body")));
  await page.screenshot({ path: OUT + "1-empty.png", fullPage: true });

  const used0 = await searches();
  await page.fill("[data-kc-words]", "dubai company setup cost\nfree zone visa price\nmainland licence");
  await page.click("[data-kc-add]"); await settle();
  check("three keywords are listed, not checked", (await page.locator(".kc-table tbody tr").count()) === 3 && /Not checked/.test(await page.textContent(".kc-table")));
  check("adding spent no search", (await searches()) === used0, `${used0} → ${await searches()}`);
  const own = (await call("GET", `rankings?site_id=${site.id}`).catch(() => ({})));
  check("they don't join my own keyword list", !JSON.stringify(own).includes("free zone visa price"));

  await page.click("[data-kc-all]"); await settle();
  const confirm = page.locator(".kc-confirm");
  check("the confirm step says how many searches and the free checks left", /Check 3 keywords on Google/.test(await confirm.textContent()) && /SerpApi/.test(await confirm.textContent()), (await confirm.textContent()).replace(/\s+/g, " "));
  check("opening it spent nothing", (await searches()) === used0);
  await page.screenshot({ path: OUT + "2-confirm.png", fullPage: true });
  await page.click("[data-kc-cancel]"); await settle();
  check("Cancel closes it", (await page.locator(".kc-confirm").count()) === 0 && (await searches()) === used0);

  await page.click("[data-kc-all]"); await settle();
  await page.click("[data-kc-go]");
  const done = await until(async () => !/Not checked|Checking:/.test(await page.textContent(".kc-table, .content").catch(() => "")));
  check("after the check every row has its result", done);
  const ranks = await page.locator(".kc-rival").count();
  check("competitors that rank are listed with their position", ranks >= 3 && /#1/.test(await page.textContent(".kc-ranks")), ranks);
  check("my own position shows", /#3/.test(await page.textContent(".kc-table tbody")));
  check("3 searches were used", (await searches()) === used0 + 3, `${used0} → ${await searches()}`);
  await page.screenshot({ path: OUT + "3-checked.png", fullPage: true });

  // Checking a keyword again minutes later spends nothing (2026-11-10: the 12-hour rule Refresh uses).
  const repeat = await searches();
  await page.locator("[data-kc-one]").first().click(); await settle();
  check("a keyword checked minutes ago isn't checked again", /Nothing to check now/.test(await page.textContent(".kc-confirm")) && (await page.locator("[data-kc-go]").count()) === 0 && (await searches()) === repeat);
  await page.click("[data-kc-cancel]"); await settle();
  // One keyword's own button checks only that one: a keyword added now, listed first.
  await page.fill("[data-kc-words]", "visa renewal"); await page.click("[data-kc-add]"); await settle();
  const before = await searches();
  await page.locator("[data-kc-one]").first().click(); await settle();
  check("one keyword's confirm says 1 keyword", /Check 1 keyword on Google/.test(await page.textContent(".kc-confirm")));
  await page.click("[data-kc-go]");
  await until(async () => (await searches()) === before + 1, 30000);
  check("it used exactly one search", (await searches()) === before + 1);

  // Add to my keywords: no search, and it shows as tracked.
  const beforeTrack = await searches();
  await page.locator("[data-kc-track]").first().click(); await settle();
  check("Add to my keywords marks the row", (await page.locator(".kc-tracked").count()) === 1);
  check("adding it to my keywords spent no search", (await searches()) === beforeTrack);
  check("it is now in my tracked keywords", JSON.stringify(await call("GET", `rankings?site_id=${site.id}`)).includes("visa renewal"));
  await page.screenshot({ path: OUT + "3b-tracked.png", fullPage: true });

  // A competitor's chip opens its profile.
  await settle();
  await page.locator(".kc-rival").first().click(); await settle();
  check("a competitor opens its profile", (await page.locator(".cl-head").count()) === 1);

  // Remove, French, narrow.
  await page.goto("about:blank"); await page.goto(BASE + "#competitors/check"); await settle();
  if ((await page.locator(".kc-table").count()) === 0) { await page.click('[data-comp-tab="check"]'); await settle(); }
  await page.locator("[data-kc-remove]").first().click(); await settle();
  check("remove takes a keyword out", (await page.locator(".kc-table tbody tr").count()) === 3);
  check("and says so, with Undo", /” removed\./.test(await page.textContent("#toasts")) && (await page.locator("#toasts [data-undo]").count()) === 1);
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render?.(); }); await settle();
  check("French words", /Vérifier des mots-clés/.test(await page.textContent("body")) && /Concurrents classés/.test(await page.textContent("body")));
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.screenshot({ path: OUT + "4-narrow-fr.png", fullPage: true });
  check("no sideways scroll at phone width", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render?.(); });

  const real = problems.filter((p) => !/Failed to load resource/.test(p));
  check("no script errors and no failed request", real.length === 0 && failed.length === 0, [...real, ...failed].slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
