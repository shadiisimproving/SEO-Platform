// Walks every screen and tab and lists each table with what it offers: tick boxes, sortable headings, the Filter button.
// A table missing one of them is printed as GAP, and the run fails. Made-up data only. Needs the demo app:
//   DB_NAME_TEST=test_tabletools_test .venv/bin/python tests/ui/app_server.py --port 8291
// Run: node tests/ui/flow_table_tools_inventory.cjs [http://127.0.0.1:8291/]
const { open } = require("./pw.cjs");
const BASE = process.argv[2] || "http://127.0.0.1:8291/";

const inventory = () => [...document.querySelectorAll("table.data, table.lc-table, table.mini")].filter((table) => table.offsetParent !== null).map((table) => {
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return { name: table.id || table.className, skipped: "no heading row" };
  if (table.matches(".cp-facts, .pt-vs, [data-tt-off]")) return { name: table.id || table.className, skipped: "fixed comparison" };
  const cells = [...head.cells].filter((c) => !c.classList.contains("tt-pick") && !c.querySelector("input"));
  const text = (c) => { const x = c.cloneNode(true); x.querySelectorAll(".sr, svg, img").forEach((e) => e.remove()); return x.textContent.trim(); };
  const labelled = cells.filter(text), sortable = labelled.filter((c) => c.querySelector("button:not(.icon-btn)"));
  const rows = [...table.tBodies].flatMap((b) => [...b.rows]).filter((r) => ![...r.cells].some((c) => c.colSpan > 1)).length; // a "nothing here" line isn't a row
  const wrap = table.closest(".table-wrap, .cl-scroll") || table;
  return {
    name: table.id || labelled.slice(0, 3).map(text).join(" / "), rows,
    ticks: !!head.querySelector("input[type=checkbox]"),
    sortable: sortable.length, columns: labelled.length, unsorted: labelled.filter((c) => !sortable.includes(c)).map(text),
    filter: !!wrap.previousElementSibling?.querySelector?.("[data-tt-filter]"),
  };
});

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  for (let i = 0; i < 90; i += 1) { try { await page.goto(BASE); break; } catch { await new Promise((r) => setTimeout(r, 2000)); } }
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  await settle(2500);
  const seen = new Map();
  const note = async (where) => { for (const row of await page.evaluate(inventory)) { const id = `${where} › ${row.name}`; if (!seen.has(id)) seen.set(id, row); } };
  const tabsOn = () => page.evaluate(() => [...document.querySelectorAll("#page .tabs .tab, #main .tabs .tab, #page .seg button, #main .seg button")].filter((b) => b.offsetParent !== null).map((b, i) => ({ i, name: b.textContent.trim().slice(0, 24) })));

  const routes = await page.evaluate(() => [...document.querySelectorAll("[data-go]")].map((b) => b.dataset.go).filter((v, i, a) => a.indexOf(v) === i));
  routes.push("settings");
  const siteIds = await page.evaluate(() => window.SITES.map((s) => s.id));
  for (const site of ["all", siteIds[0]]) {
    await page.evaluate((id) => { window.UI.state.site = id; window.UI.render(); }, site);
    await settle();
    for (const route of [...new Set(routes)]) {
      await page.evaluate((r) => { location.hash = `#${r}`; }, route);
      await settle(1800);
      await note(`${site === "all" ? "all" : "site"}:${route}`);
      const tabs = await tabsOn();
      for (const tab of tabs) {
        await page.evaluate((i) => [...document.querySelectorAll("#page .tabs .tab, #main .tabs .tab, #page .seg button, #main .seg button")].filter((b) => b.offsetParent !== null)[i]?.click(), tab.i);
        await settle(1300);
        await note(`${site === "all" ? "all" : "site"}:${route}/${tab.name}`);
      }
    }
  }

  // Tasks as a table, a keyword's side panel, each Competitors tab for one site, then a competitor's profile and its tabs.
  await page.goto("about:blank"); await page.goto(BASE + "#tasks"); await settle(2500);
  await page.click('[data-task-view="table"]').catch(() => {}); await settle(); await note("tasks/table");
  await page.goto("about:blank"); await page.goto(BASE + "#keywords"); await settle(2500);
  // The keyword's own name opens its panel (the middle of its wide cell can miss it): the run stops if no panel table shows.
  await page.locator("#kw-table tbody tr [data-kwr-open]").first().click(); await page.waitForSelector("#panel table", { timeout: 10000 }); await settle(1500); await note("keywords/panel"); console.log("tables in the keyword panel:", await page.evaluate(() => document.querySelectorAll("#panel table").length));
  await page.goto("about:blank"); await page.goto(BASE + "#competitors"); await settle(3000);
  const compSite = await page.evaluate(() => window.COMP.sites[0].id);
  const compTabs = await page.evaluate(() => window.COMP.tabs.filter((x) => !x.hidden).map((x) => x.id));
  console.log("competitor tabs:", compTabs.join(", "));
  for (const tab of compTabs) { await page.evaluate(([x, s]) => window.COMP.open(x, {}, s), [tab, compSite]); await settle(2500); await note(`comp:${tab}`); }
  await page.goto("about:blank"); await page.goto(BASE + "#competitors/summary"); await page.waitForSelector("#cs-rivals-table tbody tr", { timeout: 20000 }); await settle(2500);
  await page.locator("#cs-rivals-table tbody tr[data-cs-row] td:nth-child(3)").first().click(); await page.waitForSelector("[data-pt-tab]", { timeout: 20000 }); await settle(2500);
  for (const tab of ["keywords", "pages", "activity", "site"]) { await page.click(`[data-pt-tab="${tab}"]`).catch(() => {}); await settle(2000); await note(`profile:${tab}`); }

  let gaps = 0;
  for (const [where, row] of seen) {
    if (row.skipped) { console.log(`skip  ${where}  (${row.skipped})`); continue; }
    const missing = [!row.ticks && row.rows ? "ticks" : "", row.sortable < row.columns ? `sort(${row.unsorted.join(", ")})` : "", !row.filter && row.rows >= 2 ? "filter" : ""].filter(Boolean);
    if (missing.length) gaps += 1;
    console.log(`${missing.length ? "GAP " : "ok  "}  ${where}  rows=${row.rows} sort=${row.sortable}/${row.columns}${missing.length ? `  missing: ${missing.join(" ")}` : ""}`);
  }
  console.log(`\n${seen.size} tables seen, ${gaps} with gaps. Page errors: ${problems.filter((p) => p.startsWith("pageerror")).length}`);
  problems.filter((p) => p.startsWith("pageerror")).slice(0, 10).forEach((p) => console.log(p));
  await browser.close();
  process.exit(gaps ? 1 : 0);
})();
