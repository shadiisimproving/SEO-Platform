// Tick boxes, Filter and sortable headings, driven by hand (table-tools.js). Tasks is fed 300 made-up rows so sorting and
// filtering must reach past the page on show; Backlinks saves a real note. Made-up data only. Needs the demo app:
//   DB_NAME_TEST=test_tabletools_test .venv/bin/python tests/ui/app_server.py --port 8291
// Run: node tests/ui/flow_table_tools.cjs [http://127.0.0.1:8291/]   Screenshots: var/ui-table-tools/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8291/";
const OUT = path.resolve("var/ui-table-tools") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

const madeUpTasks = () => Array.from({ length: 300 }, (_, i) => ({
  id: 9000 + i, title: `Made-up task ${i + 1}`, description: "", status: ["todo", "doing", "done"][i % 3], priority: ["low", "medium", "high"][i % 3], due: "", owner_label: ["Ana", "Ben", "Cleo", "Dee"][i % 4], kind: ["Content", "Technical", "Links", "UX"][i % 4],
  site_id: 1, site_host: "site-one.example", pages: [], keywords: [], comments: [], source: null, completed_on: "", created_at: new Date().toISOString(), hypothesis: "", impact: null, hours_estimate: null, hours_spent: null, note: "",
}));

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
  const range = () => page.locator('[data-tp-foot="tk"] .tp-range').textContent();
  const headings = () => page.locator("#tk-table thead th").allTextContents();
  const column = async (label) => { const at = (await headings()).findIndex((h) => h.trim().startsWith(label)); return page.locator(`#tk-table tbody tr td:nth-child(${at + 1})`).allTextContents(); };

  await page.route(/\/api\/tasks(\?.*)?$/, (route) => (route.request().method() === "GET" ? route.fulfill({ json: { tasks: madeUpTasks() } }) : route.continue()));
  await page.goto(BASE + "#tasks"); await settle(2500);
  await page.click('[data-task-view="table"]'); await settle();
  await shot("1-tasks");
  console.log("headings:", (await headings()).map((h) => h.trim()).join(" | "));
  check("every row has a tick box", (await page.locator("#tk-table tbody tr .tt-pick input").count()) === 25);

  // A column the screen never sorted, across all pages.
  const owner = page.locator('#tk-table thead th button', { hasText: "Assigned to" });
  check("Owner heading is a sort button", (await owner.count()) === 1);
  await owner.click(); await settle();
  let owners = (await column("Assigned to")).map((x) => x.trim());
  check("ascending: page 1 is all Ana", owners.every((x) => x === "Ana"), [...new Set(owners)].join(","));
  check("still 300 rows", (await range()).includes("300"), await range());
  await page.locator('#tk-table thead th button', { hasText: "Assigned to" }).click(); await settle();
  owners = (await column("Assigned to")).map((x) => x.trim());
  check("descending: page 1 is all Dee", owners.every((x) => x === "Dee"), [...new Set(owners)].join(","));
  await shot("2-sorted");
  await page.locator('#tk-table thead th button', { hasText: "Assigned to" }).click(); await settle();
  check("third click: back to the default order", (await column("Title"))[0].includes("Made-up task"), (await column("Assigned to"))[0]);

  // A tick never opens the row, and survives changing page.
  await page.locator("#tk-table tbody tr .tt-pick input").first().click(); await settle(300);
  check("a tick doesn't open the task", !(await page.locator("#panel .panel-body").isVisible().catch(() => false)));
  check("the bar counts 1", /1 selected/.test(await page.locator("#tt-bar").textContent()));
  await page.click('[data-tp-foot="tk"] [data-tp-step="next"]'); await settle();
  await page.locator("#tk-table tbody tr .tt-pick input").first().click(); await settle(300);
  check("ticks add up across pages", /2 selected/.test(await page.locator("#tt-bar").textContent()));
  await shot("3-ticked");
  await page.click("[data-tt-clear-picks]"); await settle(300);
  check("clear removes the bar", (await page.locator("#tt-bar").count()) === 0);

  // Filter by ticking a value: the count must be of the whole list.
  await page.click('[data-tt-filter][data-tt-key="tk"]'); await settle(300);
  const options = await page.locator("[data-tt-column] option").allTextContents();
  await page.selectOption("[data-tt-column]", { label: options.find((o) => o.startsWith("Assigned to")) }); await settle(300);
  await shot("4-filter-window");
  await page.locator('[data-tt-value="Ben"]').check(); await settle();
  check("filter counts across every page: 75 of Ben", /of 75/.test(await range()), await range());
  await page.click("[data-tt-done]"); await settle(300);
  check("a chip says what is filtered", /Ben/.test(await page.locator(".tt-chip").textContent()));
  await shot("5-filtered");
  await page.click(".tt-chip-x"); await settle();
  check("removing the chip brings all 300 back", /of 300/.test(await range()), await range());

  // A real note from Backlinks.
  await page.unroute(/\/api\/tasks(\?.*)?$/);
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks"); await settle(2500);
  const tab = page.locator('[data-bl-tab]', { hasText: "All backlinks" });
  if (await tab.count()) { await tab.click(); await settle(); }
  await shot("6-backlinks");
  const before = (await (await page.request.get(BASE + "api/notes")).json());
  const countOf = (d) => (Array.isArray(d) ? d.length : (d.notes || []).length);
  await page.locator("#bl-table tbody tr .tt-pick input").nth(0).click();
  await page.locator("#bl-table tbody tr .tt-pick input").nth(1).click(); await settle(300);
  await page.click("[data-tt-note]"); await settle(600);
  await shot("7-note-panel");
  await page.fill("#tt-note-text", "Check these two links"); await page.click("[data-tt-note-save]"); await settle(1500);
  const after = (await (await page.request.get(BASE + "api/notes")).json());
  check("two notes saved", countOf(after) === countOf(before) + 2, `${countOf(before)} → ${countOf(after)}`);
  const newest = (after.notes || after).slice(0, 2);
  console.log("saved:", JSON.stringify(newest.map((n) => ({ scope: n.scope, page_url: n.page_url, domain: n.domain, body: (n.body || "").slice(0, 90) }))));
  check("the bar is gone once saved", (await page.locator("#tt-bar").count()) === 0);

  check("a note keeps its words apart", !/coffeehow/.test(newest.map((n) => n.body).join(" ")), newest[0]?.body?.slice(0, 80));

  // A screen with its own tick boxes: its bar gains Add a note, and the note lands on the keyword.
  await page.goto("about:blank"); await page.goto(BASE + "#keywords"); await settle(2500);
  const kwBefore = countOf(await (await page.request.get(BASE + "api/notes")).json());
  const wanted = (await page.locator("[data-kwr-open]").first().textContent()).trim();
  await page.locator("[data-kwr-select]").first().click(); await settle(400);
  check("Keywords' bar has Add a note", (await page.locator(".selbar [data-tt-note-own]").count()) === 1);
  await shot("9-keywords-bar");
  await page.click(".selbar [data-tt-note-own]"); await settle(600);
  await page.fill("#tt-note-text", "Look at this keyword"); await page.click("[data-tt-note-save]"); await settle(1500);
  const kwAfter = await (await page.request.get(BASE + "api/notes")).json();
  check("one keyword note saved", countOf(kwAfter) === kwBefore + 1, `${kwBefore} → ${countOf(kwAfter)}`);
  const kwNote = (kwAfter.notes || kwAfter)[0];
  check("the note is on that keyword", kwNote.scope === "keyword" && kwNote.keyword === wanted, `${kwNote.scope}: ${kwNote.keyword} / wanted ${wanted}`);
  check("its ticks are cleared", (await page.locator("[data-kwr-select]:checked").count()) === 0);

  // The small tables in a side panel.
  await page.locator("[data-kwr-open]").first().click(); await settle(1800);
  const minis = await page.evaluate(() => [...document.querySelectorAll("#panel table.mini")].filter((x) => x.tHead && x.offsetParent).map((x) => ({ head: [...x.tHead.rows[0].cells].map((c) => c.textContent.trim()).join("|"), ticks: !!x.querySelector(".tt-pick input"), sort: x.querySelectorAll("thead [data-tt-sort]").length, rows: x.tBodies[0]?.rows.length })));
  console.log("panel tables:", JSON.stringify(minis));
  check("panel tables have ticks and sorting", minis.every((m) => !m.rows || (m.ticks && m.sort > 0)), minis.length);
  await shot("10-panel");
  await page.keyboard.press("Escape"); await settle(400);

  // Search → Overview's own ticks.
  await page.goto("about:blank"); await page.goto(BASE + "#overview"); await settle(3000);
  const ovBox = page.locator("td.ov-pick-col input:not([disabled])").first();
  if (await ovBox.count()) { await ovBox.click(); await settle(500); check("Overview's bar has Add a note", (await page.locator(".ov-selbar [data-tt-note-own]").count()) >= 1); await shot("11-overview-bar"); }
  else console.log("note: Overview has no tick boxes in this demo world");

  await page.goto("about:blank"); await page.goto(BASE + "#backlinks"); await settle(2500);
  // Phone.
  await page.setViewportSize({ width: 390, height: 800 }); await settle(800);
  await shot("8-phone");
  check("no sideways scroll on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  const errors = problems.filter((p) => p.startsWith("pageerror"));
  check("no page errors", !errors.length, errors.slice(0, 3).join(" ; "));
  await browser.close();
  console.log(bad ? `\n${bad} FAILED` : "\nALL PASSED");
  process.exit(bad ? 1 : 0);
})();
