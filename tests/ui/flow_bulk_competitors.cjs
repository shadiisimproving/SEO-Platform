// Adding many competitors at once: from Competitors the first time (All my sites, so it asks which site), and from one site's Competitors tab (Summary and My competitors were merged on 2026-11-10).
// Run against an empty world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8247 --empty
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8247/";
const OUT = path.resolve("var/ui-bulk-competitors") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const RUN = Date.now().toString(36);
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  const settle = () => page.waitForTimeout(900);
  await page.goto(BASE + "#today");
  const one = await call("POST", "sites", { address: `shop-one-${RUN}.example`, kind: "own" });
  const two = await call("POST", "sites", { address: `acme-store-${RUN}.example`, kind: "own" });
  check("two own sites made", Boolean(one.id && two.id));

  // The first time: Summary at All my sites offers both ways.
  await page.goto("about:blank"); await page.goto(BASE + "#competitors"); await page.waitForTimeout(1800);
  if (await page.$("#comp-site")) { await page.selectOption("#comp-site", "all"); await settle(); }
  await page.screenshot({ path: OUT + "1-summary-empty.png" });
  check("Summary empty state has Find competitors", (await page.locator("#comp-body [data-cl-go-find]").count()) === 1);
  check("Summary empty state has Add competitors", (await page.locator("#comp-body #cl-add-open").count()) === 1);

  await page.click("#comp-body #cl-add-open");
  await page.waitForSelector("#cl-add-address");
  check("the panel asks which site, from All my sites", (await page.locator("#cl-add-site option").count()) === 2);
  await page.selectOption("#cl-add-site", String(two.id));
  const pasted = [`https://rival-a-${RUN}.example/pricing`, `rival-b-${RUN}.example`, `www.rival-c-${RUN}.example`, `rival-a-${RUN}.example`, `acme-store-${RUN}.example`, "not-an-address"].join("\n");
  await page.fill("#cl-add-address", pasted);
  check("the button counts what will be added", /5/.test(await page.textContent("#cl-add-save")), await page.textContent("#cl-add-save"));
  await page.screenshot({ path: OUT + "2-panel-filled.png" });
  await page.click("#cl-add-save");
  await page.waitForSelector("#cl-add-result .note.crit", { timeout: 15000 }); await settle();
  await page.screenshot({ path: OUT + "3-partly-added.png" });
  const left = await page.inputValue("#cl-add-address");
  check("only the refused addresses are left in the box", left === `acme-store-${RUN}.example\nnot-an-address`, JSON.stringify(left));
  check("each says why", /part of your own websites/.test(await page.textContent("#cl-add-result")) && /Not a website (address|domain)/.test(await page.textContent("#cl-add-result")));
  const saved = (await call("GET", `competitors?site_id=${two.id}`)).competitors.map((c) => c.host).sort();
  check("three saved on the site picked", saved.join() === [`rival-a-${RUN}.example`, `rival-b-${RUN}.example`, `rival-c-${RUN}.example`].join(), saved.join());
  check("none saved on the other site", (await call("GET", `competitors?site_id=${one.id}`)).competitors.length === 0);
  check("a toast says how many", /3 competitors added/.test(await page.textContent("#toasts").catch(() => "")) || /3 competitors added/.test(await page.textContent("body")));

  // Esc keeps the draft; then the Summary behind shows the competitors.
  await page.keyboard.press("Escape"); await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + "4-summary-after.png" });
  check("Summary is no longer empty", (await page.locator("#comp-body [data-cl-go-find]").count()) === 0 && (await page.locator("#cs-rivals-table tbody tr").count()) === 3, await page.locator("#cs-rivals-table tbody tr").count()); // since the merge the table's own head carries "Add competitors", so the empty box is told by its Find button

  // My competitors, one site: no site question, one address keeps the single-add toast with Open.
  await page.selectOption("#comp-site", String(one.id)); await settle();
  await page.click('[data-comp-tab="summary"]'); await settle();
  await page.click("#cl-add-open"); await page.waitForSelector("#cl-add-address");
  check("no site question for one site", (await page.locator("#cl-add-site").count()) === 0);
  await page.fill("#cl-add-address", `solo-${RUN}.example`);
  check("one address: the button just says Add", (await page.textContent("#cl-add-save")).trim() === "Add");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await page.waitForSelector("#panel", { state: "detached", timeout: 15000 }).catch(() => {});
  await settle();
  await page.screenshot({ path: OUT + "5-list-one-added.png" });
  check("panel closed after a clean add", (await page.locator("#cl-add-address").count()) === 0);
  check("it's in the list", (await page.locator(`#cs-rivals-table >> text=solo-${RUN}.example`).count()) > 0);

  // Pasting only ones already there says so and adds nothing.
  await page.click("#cl-add-open"); await page.waitForSelector("#cl-add-address");
  await page.fill("#cl-add-address", `solo-${RUN}.example, https://solo-${RUN}.example/about`);
  check("same site twice counts once", (await page.textContent("#cl-add-save")).trim() === "Add");
  await page.click("#cl-add-save"); await page.waitForSelector("#cl-add-result .note", { timeout: 15000 });
  check("already there is said, not an error", /Already your competitors/.test(await page.textContent("#cl-add-result")));

  // French and a narrow screen.
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await page.screenshot({ path: OUT + "6-narrow.png" });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no sideways scroll at phone width", !sideways);

  const real = problems.filter((p) => !/status of 404/.test(p)); // /api/auth/me answers 404 when the harness runs without --login
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
