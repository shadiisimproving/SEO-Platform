// Link gaps and Backlinks, second round of the links fixes (SEO expert review 2026-11-17), by hand at 1440 and 390, EN and FR.
// node tests/ui/flow_links2_fixes.cjs <demo address>
// Needs the demo world (DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8304) with, made up:
// local-news.example flagged by the app as redirecting to link-shop.example, coffee-review.example as site down,
// home-kitchen.example's links last seen in Feb 2025, and backlink 3 set to Brand by hand while the page reads another anchor.
// Checks: the app's flag stays on a good row; the App flagged chip narrows to them; an old link is left out until its chip;
// "Followed links only" isn't ticked and says the file doesn't tell; the anchor type comes from the page.
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8304/").replace(/\/?$/, "/");
const OUT = path.resolve(process.argv[3] || "var/ui-links2") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

async function run(lang, width, height, simple) {
  const tag = `${lang}-${width}${simple ? "-simple" : ""}`;
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(r.url().replace(BASE, "")); });
  await page.goto(`${BASE}?simple=${simple ? 1 : 0}#competitors/gaps?site=site-one.example`);
  await page.waitForSelector("#cg-table", { timeout: 20000 });
  if (lang === "fr") { await menu(page, "lang"); await settle(1200); await page.waitForSelector("#cg-table", { timeout: 20000 }); }
  if (width !== 1440) { await page.setViewportSize({ width, height }); await settle(800); }
  await settle(1000);
  const rowText = (d) => page.evaluate((d) => document.querySelector(`[data-cg-row="${d}"]`)?.textContent.replace(/\s+/g, " ").trim() || null, d);
  const moved = await rowText("local-news.example");
  check(`${tag}: a good row keeps the app's flag with the site it leads to`, moved && /link-shop\.example/.test(moved) && (lang === "fr" ? /L'appli a vu/.test(moved) : /The app saw/.test(moved)), moved);
  const down = await rowText("coffee-review.example");
  check(`${tag}: site down is shown with its day`, down && /11/.test(down) && (lang === "fr" ? /le 11/.test(down) : /on 11|Nov 11/.test(down)), down);
  check(`${tag}: the old link is left out by default`, (await rowText("home-kitchen.example")) === null);
  const summary = await page.evaluate(() => document.querySelector(".cg-summary")?.textContent.replace(/\s+/g, " ").trim());
  check(`${tag}: the header counts app-flagged and old links`, lang === "fr" ? /Signalés par l'appli/.test(summary) && /Anciens liens, écartés/.test(summary) : /App flagged/.test(summary) && /Old links, left out/.test(summary), summary);
  await page.screenshot({ path: `${OUT}${tag}-1-link-gaps.png`, fullPage: width < 800 });

  // The filters: in the toolbar, or behind Filter on the simpler screens.
  const openFilters = async () => { if (simple) { await page.click("#cg-filters"); await page.waitForSelector(".cg-filter-pop", { timeout: 5000 }); await settle(300); } };
  await openFilters();
  const box = await page.evaluate(() => { const b = document.querySelector("#cg-followed"); return b ? { checked: b.checked, disabled: b.disabled, note: document.querySelector("#cg-followed-note")?.textContent || "" } : null; });
  check(`${tag}: Followed links only isn't ticked and says the file doesn't tell`, box && !box.checked && (lang === "fr" ? /ne dit pas/.test(box.note) : /doesn't say/.test(box.note)), JSON.stringify(box));
  if (simple) await page.screenshot({ path: `${OUT}${tag}-2-filters.png` });
  await page.click(simple ? "#popover [data-cg-old]" : ".cg-tools [data-cg-old]");
  await settle(700);
  check(`${tag}: Include old links brings it back, marked Old link`, /Old link|Ancien lien/.test((await rowText("home-kitchen.example")) || ""), await rowText("home-kitchen.example"));
  if (simple && !(await page.isVisible("#popover.cg-filter-pop"))) await openFilters();
  console.log(`      filter box open: ${await page.isVisible("#popover.cg-filter-pop")}`);
  {
    await page.click('[data-cg-quality="app"]');
    await settle(700);
    if (simple) { await page.keyboard.press("Escape"); await settle(300); }
    const rows = await page.evaluate(() => [...document.querySelectorAll("#cg-table tbody tr[data-cg-row]")].map((r) => r.dataset.cgRow));
    check(`${tag}: App flagged shows only the rows the app flagged`, rows.length === 2 && rows.includes("local-news.example") && rows.includes("coffee-review.example"), rows.join(","));
  }
  await page.screenshot({ path: `${OUT}${tag}-3-app-flagged.png`, fullPage: width < 800 });
  const scroll = await page.evaluate(() => ({ page: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  check(`${tag}: no sideways page scroll`, scroll.scroll <= scroll.page + 1, JSON.stringify(scroll));

  // ---- Backlinks: the anchor type comes from the page ---------------------------------------------------------------
  await page.goto(`${BASE}?simple=${simple ? 1 : 0}#backlinks`);
  await page.waitForSelector("#bl-table, .bl-list", { timeout: 20000 });
  await settle(1500);
  const tags = await page.evaluate(() => [...document.querySelectorAll(".vd-anchor")].map((t) => `${t.textContent.trim()}: ${t.dataset.tip}`));
  console.log(`      anchor tags: ${tags.join(" | ")}`);
  check(`${tag}: no anchor read on the page says "set by hand"`, !tags.some((x) => /best coffee club|how to brew/.test(x) && /Set by hand|Choisi à la main/.test(x)), tags.join(" | "));
  check(`${tag}: the tip names the anchor on the page`, tags.some((x) => /best coffee club/.test(x)), tags.join(" | "));
  await page.screenshot({ path: `${OUT}${tag}-4-backlinks.png`, fullPage: width < 800 });
  // A logo the demo world has no file for answers 404 by design; anything else missing is a fault.
  const real = problems.filter((p) => !/status of 404/.test(p));
  check(`${tag}: no page errors`, real.length === 0 && missing.every((u) => /logos?\/|api\/auth\/me/.test(u)), [...real, ...missing].join(" / "));
  await browser.close();
}

(async () => {
  for (const [lang, width, height, simple] of [["en", 1440, 950, false], ["en", 1440, 950, true], ["fr", 1440, 950, true], ["en", 390, 844, true], ["fr", 390, 844, true]]) await run(lang, width, height, simple);
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
