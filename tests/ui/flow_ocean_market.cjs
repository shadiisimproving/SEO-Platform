/* The market screens in the new design (Cobalt, html[data-brand="ocean"]): Competitors (summary cards, you vs them, who moved,
   the competitor page), Page vs page, Check any keyword, AI Overview watch, Link gaps and Backlinks each draw their new
   layout with ?new=1&brand=ocean&simple=1, with no page errors; with ?new=0&brand=0 none of it is drawn (the old design).
   Run against tests/ui/app_server.py: BASE=http://127.0.0.1:8343 node tests/ui/flow_ocean_market.cjs */
const { open } = require("./pw.cjs");
const BASE = (process.env.BASE || "http://127.0.0.1:8343").replace(/\/$/, "");
const SITE = process.env.SITE || "site-one.example"; // one site: Check any keyword and AI Overview watch need one
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
async function waitFor(page, test, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(test).catch(() => false)) return true; await page.waitForTimeout(300); }
  return false;
}
async function go(page, query, route) {
  await page.goto(`${BASE}/?${query}#${route}${route.includes("?") ? "" : `?site=${SITE}`}`);
  await page.waitForTimeout(800);
}
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const NEW = "new=1&brand=ocean&simple=1", OLD = "new=0&brand=0&simple=1";

  // ---- Competitors: the summary tab ----
  await go(page, NEW, "competitors");
  check("brand is ocean", await page.evaluate(() => document.documentElement.dataset.brand === "ocean"));
  const top = await waitFor(page, () => document.querySelectorAll("#cbm-top .cbm-kpi").length === 4 && !/Loading|Chargement/.test(document.querySelector("#cbm-vs")?.textContent || "Loading"));
  check("Competitors: four number cards", top, await count(page, "#cbm-top .cbm-kpi"));
  check("Competitors: You vs them card", (await count(page, "#cbm-vs")) === 1);
  check("Competitors: Competitors moved card", (await count(page, "#cbm-moved")) === 1);
  // Charts: time graphs in the soft-area look (cb-chart.js), no bars over time and no striped bars anywhere (owner 2026-11-26).
  check("Competitors: Changes over time is a soft-area line, not bars", (await count(page, '#cbm-top [data-cs-jump="moves"] .cbc-mini .cbc-now')) === 1 && (await count(page, "#cbm-top .cb-mini i")) === 0);
  const striped = () => page.evaluate(() => [...document.querySelectorAll('[class*="cbm-"], [class*="cbm-"] *, .cs-vs-bar, .cl-meter')].filter((el) => /repeating-linear-gradient/.test(getComputedStyle(el).backgroundImage)).length);
  check("Competitors: no striped bars", (await striped()) === 0);
  check("Competitors: the bench is still under the cards", (await count(page, "#cs-lower .cs-low-tabs [data-cs-low]")) === 3);
  // A number card opens its tab of the bench.
  await page.click('#cbm-top [data-cs-jump="keywords"]');
  await page.waitForTimeout(500);
  check("Competitors: the card opens They beat you on", await page.evaluate(() => document.querySelector('[data-cs-low="keywords"]')?.getAttribute("aria-selected") === "true"));
  const vsRows = await count(page, "#cbm-vs .cbm-vs li");
  check("Competitors: a split bar per competitor", vsRows > 0 && (await count(page, "#cbm-vs .cbm-vs li .cbm-split")) === vsRows, vsRows);
  // A competitor's name opens its page, which shows the you-vs-them bar.
  const opener = await page.$("#cbm-vs [data-cs-open], #cbm-moved [data-cs-open]");
  if (opener) {
    await opener.click();
    const profile = await waitFor(page, () => /#competitors\/list\/\d+/.test(location.hash) && document.querySelector(".pt-tabs, .cp-tabs"));
    check("Competitor page opens from the summary", profile, await page.evaluate(() => location.hash));
    const verdict = await count(page, ".pt-answer-verdict");
    check("Competitor page: you vs them bar beside the verdict", verdict === 0 || (await count(page, ".cbm-pvs .cbm-split")) === 1, `verdicts ${verdict}`);
  } else check("Competitors: something to open", false);

  // ---- Page vs page ----
  await go(page, NEW, "competitors/pairs");
  await waitFor(page, () => document.querySelector(".cp-tools, .empty"));
  const chips = await count(page, ".cp-chips [data-cp-verdict]");
  check("Page vs page: the split bar card when there are pairs", chips === 0 || (await count(page, ".cbm-pairs-top .cbm-split")) === 1, `chips ${chips}`);

  // ---- Check any keyword ----
  await go(page, NEW, "competitors/check");
  const kc = await waitFor(page, () => document.querySelector("[data-kc-words]") && document.querySelector(".cbm-steps, #comp-body > .cb-grid.cbm-kpis, #comp-body .kc-band ~ .cbm-kpis, #comp-body .cbm-kpis:not(#cbm-top *)"));
  check("Check any keyword: steps or number cards", kc, kc ? "" : await page.evaluate(() => `${location.hash} ${(document.querySelector(".content")?.textContent || "").replace(/\s+/g, " ").slice(0, 160)}`));
  check("Check any keyword: the form is still there", (await count(page, "[data-kc-words]")) === 1);

  // ---- AI Overview watch ----
  await go(page, NEW, "competitors/ai");
  const ai = await waitFor(page, () => !document.querySelector("#cbm-top") && document.querySelector("#cbm-ai-who, #comp-body .empty"));
  check("AI Overview watch: number cards (or its empty state)", ai);
  if (!(await count(page, "#comp-body .empty"))) check("AI Overview watch: who the overviews cite", (await count(page, "#cbm-ai-who")) === 1);

  if (await count(page, "#ca-chart")) check("AI Overview watch: Over time drawn smooth with a soft fade", await waitFor(page, () => document.querySelector("#ca-chart .cbm-ca-area")), "");
  // ---- Link gaps ----
  await go(page, NEW, "competitors/gaps");
  const gaps = await waitFor(page, () => document.querySelector(".cbm-gap-top, #comp-body .empty, #comp-body table"));
  check("Link gaps: drawn", gaps);
  const oldLine = await count(page, ".cg-summary:not(.cbm-gap-extra) .cg-stat b");
  check("Link gaps: the numbers are a split bar, not the old line", oldLine === 0, oldLine);
  check("Link gaps: no striped bars", (await striped()) === 0);

  // ---- Backlinks ----
  await go(page, NEW, "backlinks");
  const bl = await waitFor(page, () => document.querySelector("#cbm-bl-pipe"));
  check("Backlinks: where your links stand", bl);
  check("Backlinks: no striped bars", (await striped()) === 0);
  check("Backlinks: four parts, one per stage", (await count(page, "#cbm-bl-pipe .cbm-pipe-b")) === 4);
  await page.click('#cbm-bl-pipe [data-bl-section="todo"]');
  await page.waitForTimeout(600);
  check("Backlinks: a stage opens its section", await page.evaluate(() => document.querySelector('.tabs.sections [data-bl-section="todo"]')?.getAttribute("aria-selected") === "true"));

  // ---- Phone width: no page wider than the screen ----
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["competitors", "backlinks", "competitors/gaps", "competitors/ai"]) {
    await go(page, NEW, route);
    await page.waitForTimeout(3000);
    const wide = await page.evaluate(() => { const m = document.querySelector(".main") || document.body; return m.scrollWidth - m.clientWidth; });
    check(`Phone: ${route} has no sideways scroll`, wide <= 1, wide);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- The old design draws none of it ----
  for (const route of ["competitors", "competitors/pairs", "competitors/check", "competitors/ai", "competitors/gaps", "backlinks"]) {
    await go(page, OLD, route);
    await page.waitForTimeout(3500);
    const brand = await page.evaluate(() => document.documentElement.dataset.brand || "");
    const parts = await count(page, '[class*="cbm-"], [id^="cbm-"]');
    check(`Old design: ${route} unchanged`, brand !== "ocean" && parts === 0, `brand ${brand || "none"}, new parts ${parts}`);
  }

  const errors = problems.filter((p) => p.startsWith("pageerror"));
  check("No page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
