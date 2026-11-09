// A competitor's Wayback history and the Their site tab, filled as soon as it's added. Made-up sites only.
// Run against the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8233
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8233/";
const OUT = path.resolve("var/ui-competitor-history") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(r.url()); });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  const settle = () => page.waitForTimeout(1200);
  const tab = async (id) => { await page.click(`[data-pt-tab="${id}"]`); await page.waitForTimeout(400); };
  await page.goto(BASE + "#today");
  const site = (await call("GET", "links/sites")).sites.find((s) => s.kind === "own" || s.kind === undefined) || {};

  // A new competitor: its history is asked for straight away, and fills in without a monthly wait.
  const host = `new-rival-${Date.now() % 100000}.example`;
  const added = await call("POST", "competitors", { site_id: site.id, address: host });
  check("a new competitor can be added", Boolean(added.id), JSON.stringify(added).slice(0, 120));
  const first = await call("GET", `competitors/${added.id}/insights?site_id=${site.id}`);
  check("its history is on its way the moment it's added", ["queued", "running", "ok"].includes(first.facts?.history?.status), first.facts?.history?.status);
  let ins = first;
  for (let i = 0; i < 30 && ins.facts?.history?.status !== "ok"; i++) { await page.waitForTimeout(1000); ins = await call("GET", `competitors/${added.id}/insights?site_id=${site.id}`); }
  check("within a minute it has its first archive date", ins.facts?.history?.status === "ok" && Boolean(ins.facts.first_capture), `${ins.facts?.history?.status} ${ins.facts?.first_capture}`);
  check("and its years", (ins.rhythm?.by_year || []).length >= 3, (ins.rhythm?.by_year || []).length);

  await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle();
  await page.click(`[data-cl-open="${added.id}"]`); await settle();
  check("the header says since when they're online", /Online since/.test(await page.locator(".pt-facts").innerText().catch(() => "")));
  await tab("activity");
  const grew = page.locator("section.card", { hasText: "How their site grew" });
  const grewText = await grew.innerText();
  check("Activity shows how their site grew, by year", (await grew.locator(".pt-years li").count()) >= 3, grewText.slice(0, 100));
  check("no 'waiting' text once it's known", !/Looking them up|Waiting for/.test(grewText));
  check("the domain's dates show", /Domain registered/.test(grewText));
  await page.screenshot({ path: OUT + "1-activity.png", fullPage: true });

  await tab("site");
  const siteText = await page.locator("#pt-panel").innerText();
  check("Their site loads, with no 'didn't load' line", !/didn't load/.test(siteText), siteText.slice(0, 120));
  check("Their site shows how strong they are", /How strong they are/.test(siteText) && /Domain registered/.test(siteText));
  await page.screenshot({ path: OUT + "2-their-site.png", fullPage: true });
  await tab("pages");
  check("Pages loads too", !/didn't load/.test(await page.locator("#pt-panel").innerText()));
  await page.screenshot({ path: OUT + "3-pages.png", fullPage: true });

  // An older competitor of the demo, with pages read: the Their site tables fill in.
  const rows = (await call("GET", `competitors?site_id=${site.id}`)).competitors.filter((c) => c.id !== added.id && c.crawl?.status !== "blocked");
  await page.click("[data-cl-back]").catch(() => {}); await settle();
  await page.click(`[data-cl-open="${rows[0].id}"]`); await settle();
  await tab("site");
  await page.screenshot({ path: OUT + "4-their-site-read.png", fullPage: true });
  check("a competitor whose pages were read shows the build table", (await page.locator("#pt-panel table").count()) >= 2);

  // Phone width.
  await page.setViewportSize({ width: 390, height: 860 }); await settle();
  await tab("activity");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no sideways scroll at phone width", !wide);
  await page.screenshot({ path: OUT + "5-phone-activity.png", fullPage: true });

  const real = problems.filter((p) => !/status of 404/.test(p)); // 404s are checked by address below
  check("the only missing address is auth/me, which the demo serves without login", missing.every((u) => /api\/auth\/me/.test(u)), missing.join(" "));
  check("no console errors", real.length === 0, real.slice(0, 3).join(" | "));
  await call("DELETE", `competitors/${added.id}?site_id=${site.id}`).catch(() => {});
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "all passed");
  process.exit(bad ? 1 : 0);
})();
