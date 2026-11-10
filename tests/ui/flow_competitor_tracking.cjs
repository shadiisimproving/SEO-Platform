// Tracking per competitor: On, Pages only, Off, from the list and the profile. Made-up sites only.
// Run against the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8243
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8243/";
const OUT = path.resolve("var/ui-competitor-tracking") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  const settle = () => page.waitForTimeout(1200);
  await page.goto(BASE + "#today");
  const site = (await call("GET", "links/sites")).sites.find((s) => s.kind === "own" || s.kind === undefined) || {};
  const rows = (await call("GET", `competitors?site_id=${site.id}`)).competitors;
  check("the demo site has at least two competitors", rows.length >= 2, rows.length);
  const [first, second] = rows;
  for (const c of [first, second]) await call("PUT", `competitors/${c.id}/tracking`, { site_id: site.id, tracking: "on" }); // a rerun starts clean

  await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle();
  if (await page.$("#comp-site")) { await page.selectOption("#comp-site", String(site.id)); await settle(); }
  check("every row has the three choices", (await page.locator("#cs-rivals-table [data-ct-set]").count()) === rows.length * 3);
  check("new competitors start On", (await page.getAttribute(`[data-ct-id="${first.id}"][data-ct-set="on"]`, "aria-pressed")) === "true");

  await page.click(`[data-ct-id="${first.id}"][data-ct-set="pages"]`); await settle();
  const pagesRow = page.locator(`[data-cs-row="${first.id}"]`);
  check("Pages only blanks the keyword numbers", (await pagesRow.locator("td.c").first().textContent()).trim() === "—");
  check("Pages only keeps the reading state", !/Paused/.test(await pagesRow.textContent()));
  check("the choice is kept", (await page.getAttribute(`[data-ct-id="${first.id}"][data-ct-set="pages"]`, "aria-pressed")) === "true");
  check("focus stays on the choice after the redraw", await page.evaluate((id) => document.activeElement?.dataset?.ctId === String(id), first.id));

  await page.click(`[data-ct-id="${second.id}"][data-ct-set="off"]`); await settle();
  check("Off shows Paused", /Paused/.test(await page.locator(`[data-cs-row="${second.id}"]`).textContent()));
  await page.screenshot({ path: OUT + "1-list.png" });
  const saved = (await call("GET", `competitors?site_id=${site.id}`)).competitors;
  check("the server kept both", saved.find((c) => c.id === first.id)?.tracking === "pages" && saved.find((c) => c.id === second.id)?.tracking === "off");

  // A double click must not flip it twice or fail.
  await page.dblclick(`[data-ct-id="${second.id}"][data-ct-set="pages"]`); await settle();
  check("a double click lands on one choice", (await call("GET", `competitors?site_id=${site.id}`)).competitors.find((c) => c.id === second.id)?.tracking === "pages");

  // The profile: the switch is in the header, and the keyword tab says why it's empty.
  await page.click(`[data-cs-open="${first.id}"]`); await settle();
  await page.screenshot({ path: OUT + "2-profile-pages.png", fullPage: true });
  check("the profile shows the switch", (await page.locator(`#comp-body [data-ct-id="${first.id}"][data-ct-set]`).count()) === 3);
  check("the profile says the keywords are hidden", (await page.locator("#comp-body .ct-note").count()) >= 1);
  await page.click(`#comp-body [data-ct-id="${first.id}"][data-ct-set="on"]`); await settle();
  check("On brings the keywords back", (await page.locator("#comp-body .ct-note").count()) === 0);

  // French and a narrow screen.
  await page.click('[data-comp-tab="summary"]'); await settle();
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render?.(); }); await settle();
  check("French words", /Pages seulement/.test(await page.textContent("#cs-rivals-table")) && /Niveau de suivi/.test(await page.textContent("#cs-rivals-table")));
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.screenshot({ path: OUT + "3-narrow-fr.png", fullPage: true });
  check("no sideways scroll at phone width", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

  for (const c of [first, second]) await call("PUT", `competitors/${c.id}/tracking`, { site_id: site.id, tracking: "on" });
  const real = problems.filter((p) => !/status of 404/.test(p)); // /api/auth/me answers 404 without --login
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
