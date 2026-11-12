// Backlinks after the UI critique of 2026-11-12. The simpler screen (?simple=1): the answer first, four number cards, one tab
// tier, one Filter, at most five columns with the rest under More columns (empty ones hide by themselves), and the imports
// behind the Add backlink arrow. The default screen: one Lost chip among the other filters, the Lost number in the ordinary
// colour, and on a phone the tabs wrap instead of hiding one off the edge. Made-up sites only (the demo world).
//   DB_NAME_TEST=<your>_test DB_POOL_SIZE=2 DB_MAX_OVERFLOW=6 .venv/bin/python tests/ui/app_server.py --port 8270
//   node tests/ui/flow_backlinks_simple.cjs http://127.0.0.1:8270/ [folder for screenshots]
const { open, menu } = require("./pw.cjs");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8270/";
const OUT = path.resolve(process.argv[3] || "var/ui-backlinks-simple") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

async function start({ width = 1440, height = 900, simple = 1 } = {}) {
  const run = await open({ width, height });
  run.failed = [];
  run.page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) run.failed.push(`${r.status()} ${r.url()}`); });
  await run.page.goto(`${BASE}?simple=${simple}#backlinks?site=site-one.example`);
  await run.page.waitForSelector("#bl-tiles", { timeout: 30000 });
  await run.page.waitForTimeout(1200);
  if (await run.page.$('[data-bl-section="done"][aria-selected="false"]')) { await run.page.click('[data-bl-section="done"]'); await run.page.waitForTimeout(700); }
  // one(sel, fn): fn on the first match; all(sel, fn): fn on the list of matches.
  run.one = (sel, fn) => run.page.locator(sel).first().evaluate(fn);
  run.all = (sel, fn) => run.page.locator(sel).evaluateAll(fn);
  return run;
}
const focusedId = (page) => page.evaluate(() => document.activeElement?.id || "");

(async () => {
  // ---- the simpler screen, wide ----
  let { browser, page, problems, failed, one, all } = await start();
  const wait = (ms = 600) => page.waitForTimeout(ms);
  const shownHeads = () => all("#bl-table thead th", (els) => els.filter((e) => getComputedStyle(e).display !== "none" && !e.querySelector("input")).map((e) => e.textContent.trim()));
  const linkRows = () => all("#bl-table tbody tr[data-bl]", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
  check("simple: the answer comes first, above the cards", await one(".bl-top", (top) => top.firstElementChild.matches(".bl-answer")));
  const cards = await page.locator("#bl-tiles > *").count();
  check("simple: at most four number cards", cards <= 4, cards);
  const needs = await all(".bl-need", (els) => els.map((e) => e.dataset.need));
  check("simple: the answer lists the lost links with one action", needs.includes("lost") && (await page.locator('.bl-need[data-need="lost"] button').count()) === 1, needs.join(","));
  check("simple: the lost number is the ordinary colour; the pill carries the colour", await one('.bl-need[data-need="lost"]', (row) => getComputedStyle(row.querySelector(".bl-need-n")).color !== getComputedStyle(row.querySelector(".status")).color));
  check("simple: one tab tier (the sections)", (await page.locator("#page .content > .tabs").count()) === 1 && (await page.locator("[data-bl-tab]").count()) === 0);
  check("simple: one Filter, not table-tools' as well", (await page.locator("#bl-filter-btn").count()) === 1 && (await page.locator(".tt-tools, [data-tt-filter]").count()) === 0);
  check("simple: no import buttons on the screen itself", (await page.locator("#page .content #bulk-open, #page .content #gsc-open").count()) === 0);
  const heads = await shownHeads();
  check("simple: at most five columns", heads.length <= 5 && heads[0] === "Source page", heads.join(" | "));
  // Every column on show has something in it; every column holding only "—" is hidden (the demo's Visits, Leads, Cost per visit).
  const emptyShown = await page.evaluate(() => {
    const table = document.querySelector("#bl-table"), out = [];
    table.querySelectorAll("thead th[data-bl-col]").forEach((th) => {
      if (getComputedStyle(th).display === "none") return;
      const label = th.textContent.trim(), cells = [...table.querySelectorAll(`tbody td[data-label="${CSS.escape(label)}"]`)];
      if (cells.length && cells.every((td) => /^[\s—–-]*$/.test(td.textContent))) out.push(label);
    });
    return out;
  });
  check("simple: columns of only — hide by themselves", emptyShown.length === 0 && !heads.includes("Visits") && !heads.includes("Leads"), emptyShown.join(" | ") || heads.join(" | "));
  await page.screenshot({ path: OUT + "1-simple.png" });

  // More columns lists the hidden ones, the empty ones say so, and a tick shows one
  await page.click("#bl-cols-btn"); await wait(300);
  const colsText = (await page.locator("#popover").innerText()).replace(/\s+/g, " ");
  check("More columns: lists every column, empty ones marked", /Keyword/.test(colsText) && /Mediator/.test(colsText) && /empty here/.test(colsText), colsText);
  await page.check('#popover [data-bl-col-pick="mediator"]'); await wait(300);
  check("More columns: ticking Mediator shows it", (await shownHeads()).some((h) => /^(Mediator|Mediator)$/.test(h)), (await shownHeads()).join(" | "));
  await page.screenshot({ path: OUT + "2-columns.png" });
  await page.keyboard.press("Escape"); await wait(300);
  check("More columns: Escape gives the keyboard back to the button", (await focusedId(page)) === "bl-cols-btn");
  await page.click("#bl-cols-btn"); await wait(300); await page.uncheck('#popover [data-bl-col-pick="mediator"]'); await page.keyboard.press("Escape"); await wait(300);

  // Filter: what to show, the answers, the view; the ones in use show as chips with ×
  await page.click("#bl-filter-btn"); await wait(300);
  const popText = (await page.locator("#popover").innerText()).replace(/\s+/g, " ");
  check("Filter holds Show, the link answers and the view", /All links/.test(popText) && /Mediators/.test(popText) && /Links you didn't add/.test(popText) && /Lost/.test(popText) && /Useful/.test(popText) && /By site/.test(popText), popText);
  await page.screenshot({ path: OUT + "3-filter.png" });
  await page.click('#popover [data-bl-filter="lost"]'); await wait(700);
  const lostRows = await linkRows();
  check("Filter → Lost: only lost links", lostRows.length >= 1 && lostRows.every((r) => /Lost/.test(r)), lostRows.length);
  check("Filter → Lost: a Lost chip shows beside Filter, and the keyboard is on Filter", (await page.locator('.bl-on[data-bl-filter="all"]').count()) === 1 && (await focusedId(page)) === "bl-filter-btn");
  await page.click('.bl-on[data-bl-filter="all"]'); await wait(700);
  check("the chip's × puts every link back", (await linkRows()).length > lostRows.length && (await page.locator(".bl-on").count()) === 0);
  await page.click("#bl-filter-btn"); await wait(300);
  await page.click('#popover [data-bl-tab="mediators"]'); await wait(1400);
  check("Filter → Mediators shows the mediators' table", (await page.locator("#md-table").count()) === 1 && /Mediator/.test(await page.locator("#md-table thead").innerText()));
  check("the keyboard stays on Filter after the list loads", (await focusedId(page)) === "bl-filter-btn");
  await page.click('.bl-on[data-bl-tab="all"]'); await wait(700);

  // The answer's action shows those links
  await page.click('[data-bl-go="lost"]'); await wait(700);
  check("the answer's Show them filters to the lost links", (await linkRows()).every((r) => /Lost/.test(r)) && (await page.locator('.bl-on[data-bl-filter="all"]').count()) === 1);
  await page.click('.bl-on[data-bl-filter="all"]'); await wait(700);

  // The imports sit behind the Add backlink arrow; closing what they open gives the keyboard back to the arrow
  await page.click("#bl-add-more"); await wait(300);
  const items = await all("#popover [data-bl-add]", (els) => els.map((e) => e.dataset.blAdd));
  check("the arrow holds the imports and the template", items.join(",") === "bulk-open,gsc-open,bulk-template", items.join(","));
  await page.screenshot({ path: OUT + "4-add-menu.png" });
  await page.click('#popover [data-bl-add="bulk-open"]'); await wait(800);
  check("Import a CSV file opens its panel", (await page.locator("#panel").count()) === 1);
  await page.keyboard.press("Escape"); await wait(500);
  check("closing it puts the keyboard back on the arrow", (await focusedId(page)) === "bl-add-more");
  await page.click("#bl-add-more"); await wait(300); await page.click('#popover [data-bl-add="gsc-open"]'); await wait(600);
  check("Import from Search Console opens its dialog", await page.evaluate(() => document.querySelector("#dlg")?.open === true));
  await page.keyboard.press("Escape"); await wait(300);

  // French
  await menu(page, "lang"); await wait(800);
  check("French: Filtrer and Plus de colonnes", /Filtrer/.test(await page.locator("#bl-filter-btn").innerText()) && /Plus de colonnes/.test(await page.locator("#bl-cols-btn").innerText()));
  await menu(page, "lang"); await wait(500);
  check("simple: no page errors", problems.filter((p) => !/status of 404/.test(p)).length === 0, problems.join(" / "));
  check("simple: no failed requests", failed.length === 0, failed.join(" / "));
  await browser.close();

  // ---- the simpler screen on a phone ----
  ({ browser, page, one, all } = await start({ width: 390, height: 844 }));
  const firstRow = await one("#bl-table tbody tr[data-bl]", (tr) => tr.getBoundingClientRect().top);
  check("phone, simple: a link row shows on the first screen", firstRow < 844 - 40, Math.round(firstRow));
  check("phone, simple: at most three answer rows before Show more", (await all(".bl-need", (els) => els.filter((e) => getComputedStyle(e).display !== "none").length)) <= 3);
  check("phone, simple: no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: OUT + "5-phone-simple.png" });
  await browser.close();

  // ---- the default screen ----
  ({ browser, page, one, all } = await start({ simple: 0 }));
  const lostChips = await all('#page .chips [data-bl-filter="lost"]', (els) => els.map((e) => e.textContent.trim()));
  check("default: one Lost chip, written like the others", lostChips.length === 1 && /^Lost\s*\d+$/.test(lostChips[0]), lostChips.join(" | "));
  check("default: the type tabs and the six cards stay", (await page.locator("[data-bl-tab]").count()) >= 3 && (await page.locator("#bl-tiles > *").count()) === 6);
  check("default: the Lost number is the ordinary colour", await one("#bl-tiles", (t) => { const n = t.querySelector(".fig .serious"); return !n || getComputedStyle(n).color === getComputedStyle(t.querySelector(".fig")).color; }));
  const pill = await one("#bl-table .status", (s) => getComputedStyle(s).backgroundColor);
  check("default: a status pill has its own solid background", /^color\(srgb [\d.]+ [\d.]+ [\d.]+\)$|^rgb\(/.test(pill), pill);
  const badge = await one("#bl-table .nb-badge", (b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
  check("default: the Notes badge is at least 24 px", badge[0] >= 24 && badge[1] >= 24, badge.join("x"));
  await browser.close();
  ({ browser, page, all } = await start({ simple: 0, width: 390, height: 844 }));
  const clipped = await all(".tabs:has(> [data-bl-tab]) > .tab, .tabs:has(> [data-bl-section]) > .tab", (tabs) => tabs.filter((tab) => { const r = tab.getBoundingClientRect(), box = tab.parentElement.getBoundingClientRect(); return r.right > box.right + 1 || r.right > innerWidth; }).map((tab) => tab.textContent.trim()));
  check("phone, default: no tab hides off the edge", clipped.length === 0, clipped.join(" | "));
  await page.screenshot({ path: OUT + "6-phone-default.png" });
  await browser.close();

  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
