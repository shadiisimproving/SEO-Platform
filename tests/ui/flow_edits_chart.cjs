// The Activity tab: new pages and edits as two separate charts, each with its own hover label. Made-up sites only.
// Run against the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8231
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8231/";
const OUT = path.resolve("var/ui-edits-chart") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const call = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), BASE + "api/" + p);
  const settle = () => page.waitForTimeout(1200);
  await page.goto(BASE + "#today");
  const rival = { id: Number(process.argv[3] || 4) }; // rival-one.example in the demo world
  await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle();
  await page.click(`[data-cs-open="${rival.id}"]`); await settle();
  await page.click(`[data-pt-tab="activity"]`); await page.waitForTimeout(500);

  const pages = page.locator("section.card", { hasText: "How fast they publish" });
  const edits = page.locator("section.card", { hasText: "How often they edit" });
  check("the new-pages card is there", await pages.count() === 1);
  check("the edits card is there, its own card", await edits.count() === 1);
  const lead = await edits.locator(".pt-lead").innerText().catch(() => "");
  check("the edits card says how many edits, and since when", /since.*edits?/i.test(lead), lead);
  check("the edits card has bars", await edits.locator(".pt-bar-them").count() > 0);
  check("each chart has its own hover label", await page.locator(".pt-tip").count() === await page.locator(".pt-chart-wrap").count());

  const busy = edits.locator(".pt-month").last();
  await busy.hover(); await page.waitForTimeout(200);
  const tip = await edits.locator(".pt-tip").innerText().catch(() => "");
  check("hovering an edits month shows that month's edits", /Them\s*\d+/.test(tip) && !(await edits.locator(".pt-tip").isHidden()), tip.replace(/\s+/g, " "));
  await edits.screenshot({ path: OUT + "1-edits-hover.png" });
  await page.mouse.move(0, 0); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + "2-activity.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no sideways scroll on a phone", !overflow);
  await edits.screenshot({ path: OUT + "3-phone-edits.png" });

  check("no page errors", problems.filter((x) => !/404/.test(x)).length === 0, problems.slice(0, 3).join(" | "));
  console.log(bad ? `${bad} FAILED` : "ALL PASS", "→", OUT);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
