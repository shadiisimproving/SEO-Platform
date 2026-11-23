// How each competitor's site is followed (2026-11-10): the one line on the profile, the weekly Firecrawl check that
// needs a yes and stops with one click, and a small text edit that says so on the timeline. Made-up sites only.
//   DB_NAME_TEST=test_reading_test .venv/bin/python tests/ui/app_server.py --port 8271
//   DB_NAME_TEST=test_reading_test .venv/bin/python tests/ui/seed_follow.py
//   node tests/ui/flow_competitor_follow.cjs http://127.0.0.1:8271/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8271/";
const OUT = path.resolve("var/ui-competitor-follow") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) failed.push(`${r.status()} ${r.url()}`); });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  const settle = () => page.waitForTimeout(1200);
  const until = async (test, ms = 90000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await page.waitForTimeout(800); } return false; };
  await page.goto(BASE + "#today");
  const site = (await call("GET", "links/sites")).sites.find((s) => s.kind === "own" || s.kind === undefined) || {};
  const have = (await call("GET", `competitors?site_id=${site.id}`)).competitors;
  const spa = have.find((c) => c.host === "spa-rival.example") || (await call("POST", "competitors", { site_id: site.id, address: "spa-rival.example" }));
  const rivalOne = have.find((c) => c.host === "rival-one.example");
  const profileOf = (id) => call("GET", `competitors/${id}/profile?site_id=${site.id}`);
  check("the made-up JavaScript-only rival was read", await until(async () => ["ok", "blocked", "failed"].includes(((await profileOf(spa.id)).crawl || {}).status)));

  const openProfile = async (id) => {
    await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle();
    if (await page.$("#comp-site")) { await page.selectOption("#comp-site", String(site.id)); await settle(); }
    await page.click(`[data-cs-open="${id}"]`); await settle();
    await page.locator(".rd-fold").evaluateAll((folds) => folds.forEach((d) => { d.open = true; }));
  };

  // The line that answers "would I see their edits?"
  await openProfile(spa.id);
  const box = page.locator(`[data-rd-box="${spa.id}"]`);
  // It rides on the profile's "Last read" line, with the full sentence on hover, so it takes no room.
  const how = page.locator(".cl-follow").first();
  const short = ((await how.textContent().catch(() => "")) || "").trim(), tip = (await how.getAttribute("data-tip").catch(() => "")) || "";
  check("the Last read line says every page is read daily", short === "all pages daily" && /All \d+ pages read daily/.test(tip), `${short} | ${tip}`);

  // Firecrawl reads the JavaScript pages (its own flow tests the confirm step), then the weekly check is offered.
  await call("PUT", "app-keys/firecrawl", { key: "fc-demo-key-1234" });
  await call("POST", `competitors/${spa.id}/firecrawl/weekly`, { site_id: site.id, on: false }); // a second run starts from off
  if (((await profileOf(spa.id)).crawl?.firecrawl?.pages || 0) < 4) await call("POST", `competitors/${spa.id}/firecrawl`, { site_id: site.id, action: "read" });
  check("Firecrawl read the pages", await until(async () => ((await profileOf(spa.id)).crawl?.firecrawl?.pages || 0) >= 4));
  const before = (await call("POST", "app-keys/firecrawl/test")).left;
  await openProfile(spa.id);
  const weekly = box.locator('[data-rd-ask="weekly"]');
  check("Check every week is offered", (await weekly.count()) === 1);
  await weekly.click(); await settle();
  const confirm = box.locator(".rd-confirm");
  const asked = (await confirm.textContent()) || "";
  check("the confirm step says what it costs a week", /weekly with Firecrawl/.test(asked) && /1 page, ~1 credit a week/.test(asked), asked.trim().slice(0, 200));
  await page.screenshot({ path: OUT + "1-weekly-confirm.png", fullPage: true });
  await confirm.locator("[data-rd-cancel]").click(); await settle();
  check("Cancel leaves it off", (await profileOf(spa.id)).crawl?.firecrawl?.weekly === false);
  await weekly.click(); await settle();
  await confirm.locator('[data-rd-go="weekly"]').click(); await settle();
  check("Yes turns it on", (await profileOf(spa.id)).crawl?.firecrawl?.weekly === true);
  check("the box says it's checked every week", await until(async () => /checked weekly/.test((await page.locator(`[data-rd-box="${spa.id}"]`).textContent().catch(() => "")) || ""), 8000));
  check("saying yes spent nothing", (await call("POST", "app-keys/firecrawl/test")).left === before);
  check("the notes stay open after the click", await page.locator(`[data-rd-box="${spa.id}"] .rd-fold`).evaluateAll((folds) => folds.every((d) => d.open)));
  await page.screenshot({ path: OUT + "2-weekly-on.png", fullPage: true });
  await page.locator(`[data-rd-box="${spa.id}"] [data-rd-weekly-off]`).click(); await settle();
  check("Stop the weekly check turns it off", (await profileOf(spa.id)).crawl?.firecrawl?.weekly === false);
  check("and the box offers it again", (await page.locator(`[data-rd-box="${spa.id}"] [data-rd-ask="weekly"]`).count()) === 1);

  // A small text edit says so on the timeline.
  if (rivalOne) {
    await openProfile(rivalOne.id);
    await page.click('[data-pt-tab="changes"]'); // the timeline moved from Activity to the Changes tab (2026-11-20)
    await page.waitForSelector("#cl-timeline", { timeout: 8000 }); await settle();
    const timeline = (await page.textContent("#cl-timeline")) || "";
    check("a small edit says how many words changed", /small edit, 2 words/.test(timeline));
    await page.screenshot({ path: OUT + "3-small-edit.png", fullPage: true });
  } else {
    check("the demo rival rival-one.example exists", false);
  }

  // French and a phone.
  await openProfile(spa.id);
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render?.(); }); await settle();
  check("French words", /toutes les pages chaque jour/.test(await page.textContent("body")));
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.screenshot({ path: OUT + "4-narrow-fr.png", fullPage: true });
  check("no sideways scroll at phone width", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

  const real = problems.filter((p) => !/Failed to load resource/.test(p));
  check("no script errors and no failed request", real.length === 0 && failed.length === 0, [...real, ...failed].slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
