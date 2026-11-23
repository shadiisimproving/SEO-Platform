// Export on every screen, as a person would: press Export, pick a format, get a file.
//   node tests/ui/flow_exports.cjs <out-dir> [http://127.0.0.1:8270/]
// Needs the demo app (tests/ui/app_server.py). Saves each download and screenshots of the menu into <out-dir>.
const fs = require("fs"), path = require("path");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "/tmp/flow-exports";
const BASE = process.argv[3] || "http://127.0.0.1:8270/";
fs.mkdirSync(out, { recursive: true });

let failures = 0, checks = 0;
const check = (ok, what) => { checks++; if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${what}`); };
const MAGIC = { pdf: "%PDF", xlsx: "PK", zip: "PK" };

async function exportAs(page, fmt, name) {
  await page.click("#export-btn");
  await page.waitForSelector("#export-menu");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click(`#export-menu [data-export-fmt="${fmt}"]`)]);
  const file = download.suggestedFilename();
  const saved = path.join(out, `${name}--${file}`);
  await download.saveAs(saved);
  const ext = file.split(".").pop();
  const head = fs.readFileSync(saved);
  const starts = ext === "csv" ? head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf : head.slice(0, MAGIC[ext].length).toString("latin1") === MAGIC[ext];
  check(starts && head.length > 40, `${name}: ${fmt} downloads as ${file} (${head.length} bytes)`);
  check(/^[a-z0-9.-]+$/.test(file), `${name}: the file name is plain (${file})`);
  await page.waitForTimeout(250);
  return saved;
}
async function go(page, hash, wait = 1400) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(wait);
}

(async () => {
  const { browser, page, problems } = await open({ url: BASE });
  const failed = [];
  const other = [];
  page.on("response", (r) => { if (r.status() >= 400) (r.url().includes("/api/export") ? failed : other).push(`${r.status()} ${r.url().replace(BASE, "/")}`); });
  await page.waitForTimeout(1500);
  // A fresh demo has no tasks or resources: add a few made-up ones, so the filters below have something to narrow.
  const seeded = await page.evaluate(async () => {
    window.UI.state.site = window.SITES.find((x) => x.host === "site-one.example").id;
    const s = { id: window.UI.siteIdPicked() };
    const call = (method, url, body) => fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    const soon = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
    const made = [];
    if (!((await call("GET", "api/tasks")).tasks || []).some((x) => x.title === "Fix the broken link on /contact")) {
      for (const [title, due, status] of [["Fix the broken link on /contact", soon(2), "todo"], ["Write the coffee grinder guide", soon(5), "doing"], ["Ask barista-mag.example for a link", soon(9), "todo"]]) made.push((await call("POST", "api/tasks", { title, due, status, site_id: s.id })).id);
    }
    if (!((await call("GET", "api/resources")).resources || []).length) {
      for (const [title, tags] of [["Grinder guide brief", ["brief"]], ["Subscription page brief", ["brief", "pricing"]], ["Brand colours", ["design"]]]) made.push((await call("POST", "api/resources", { title, tags, url: "https://site-one.example/", site_id: s.id })).id);
    }
    return made.length;
  });
  if (seeded) console.log(`made ${seeded} demo tasks and resources`);
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "site-one.example"); window.UI.state.site = s.id; window.UI.render(); });
  await page.waitForTimeout(800);

  const screens = [
    ["today", "#today"], ["overview", "#overview"], ["insights", "#insights"], ["keywords", "#keywords"], ["channels", "#channels"], ["conversions", "#conversions"],
    ["content", "#content"], ["ai", "#ai"], ["ads", "#ads"], ["backlinks-done", "#backlinks/all"], ["backlinks-todo", "#backlinks/todo"], ["backlinks-consideration", "#backlinks/consideration"],
    ["health-test", "#health/test"], ["health-uptime", "#health/uptime"], ["health-links", "#health/links"], ["tasks", "#tasks"], ["notes", "#notes"], ["resources", "#resources"],
    ["competitors-summary", "#competitors/summary"], ["competitors-check", "#competitors/check"], ["competitors-pairs", "#competitors/pairs"], ["competitors-gaps", "#competitors/gaps"], ["settings", "#settings"],
  ];
  for (const [name, hash] of screens) {
    await go(page, `${hash}?site=site-one.example`);
    const buttons = await page.locator("#topbar .tools [data-export-open]").count();
    check(buttons === 1, `${name}: one Export button in the top bar`);
    if (buttons !== 1) continue;
    const others = await page.evaluate(() => [...document.querySelectorAll("#page button, #page a")].filter((el) => /download csv|export csv|télécharger le csv/i.test(el.textContent + " " + (el.getAttribute("aria-label") || ""))).length);
    check(others === 0, `${name}: no second download control (${others})`);
    for (const fmt of ["pdf", "xlsx", "csv"]) await exportAs(page, fmt, name);
  }

  // The menu itself: words, keyboard, clicking away.
  await go(page, "#overview?site=site-one.example");
  await page.click("#export-btn");
  const words = await page.locator("#export-menu").innerText();
  check(words.includes("PDF report") && words.includes("Excel workbook") && words.includes("CSV file"), "the menu offers PDF, Excel and CSV");
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/menu-light-en.png` });
  await page.keyboard.press("Escape");
  check((await page.locator("#export-menu").count()) === 0, "Esc closes the menu");
  check(await page.evaluate(() => document.activeElement?.id === "export-btn"), "and the keyboard is back on the button");
  await page.click("#export-btn"); await page.mouse.click(300, 500);
  check((await page.locator("#export-menu").count()) === 0, "clicking away closes the menu");

  // A filtered and sorted Overview table goes into the file as it is on screen.
  await page.evaluate(() => { window.OV.tab = "query"; window.OV.filters.query.q = "grains"; window.OV.sort = { table: "query", id: "impressions", dir: "asc" }; window.UI.render(); });
  await page.waitForTimeout(1200);
  const filtered = fs.readFileSync(await exportAs(page, "csv", "overview-filtered"), "utf8");
  const lines = filtered.trim().split("\r\n");
  check(lines.length >= 2 && lines.slice(1).every((l) => l.includes("grains")), `the CSV holds only the filtered rows (${lines.length - 1})`);
  await page.evaluate(() => { window.OV.filters.query.q = "zzzz-nothing"; window.UI.render(); });
  await page.waitForTimeout(1000);
  const empty = fs.readFileSync(await exportAs(page, "csv", "overview-empty"), "utf8");
  check(empty.trim().split("\r\n").length === 1, "an empty table gives a CSV with its heading row only");
  await exportAs(page, "pdf", "overview-empty");
  await page.evaluate(() => { window.OV.filters.query.q = ""; window.OV.sort = null; window.UI.render(); });

  // What you see is what you export: screens that filter and sort in the browser.
  const csvRows = (file) => fs.readFileSync(file, "utf8").replace(/^﻿/, "").trim().split("\r\n").slice(1);
  const firstCells = (file) => csvRows(file).map((line) => (line.startsWith('"') ? line.slice(1, line.indexOf('",')) : line.split(",")[0]));
  const about = (file) => require("child_process").execFileSync(path.join(__dirname, "..", "..", ".venv", "bin", "python"), ["-c", "import sys, openpyxl; s = openpyxl.load_workbook(sys.argv[1]).worksheets[0]; print(' | '.join(str(c.value) for r in s.iter_rows() for c in r if c.value is not None))", file]).toString();

  // Up/Down follow Search Console's 7-day move by default since 2026-11-20; the demo's keywords have no daily Search Console
  // positions, so the chips read our checks here, as the "Our checks" switch on the Keywords by ranking card does.
  await page.evaluate(() => localStorage.setItem("seocc2-kwb-source", "checks"));
  await go(page, "#keywords?site=site-one.example");
  await page.click('#page [data-filter="down"]'); await page.waitForTimeout(400);
  await page.click('#page [data-sort="k"]'); await page.waitForTimeout(400);
  const kwOnScreen = await page.evaluate(() => [...document.querySelectorAll("#page tbody tr")].map((r) => r.querySelector(".kw")?.textContent.trim()).filter(Boolean));
  const kwCsv = firstCells(await exportAs(page, "csv", "keywords-filtered"));
  check(kwOnScreen.length > 0 && kwOnScreen.length < 10 && JSON.stringify(kwCsv) === JSON.stringify(kwOnScreen), `Keywords: the CSV holds the ${kwOnScreen.length} filtered rows in the order on screen (${kwCsv.join(" · ")})`);
  const kwAbout = about(await exportAs(page, "xlsx", "keywords-filtered"));
  check(kwAbout.includes("Filter | Down") && kwAbout.includes("Sorted by | Keyword"), `Keywords: the file's header says the filter and the sort (${kwAbout.slice(0, 160)})`);
  await exportAs(page, "pdf", "keywords-filtered");
  check((await page.locator("#kwr-export").count()) === 0, "Keywords: the old CSV icon is gone, one download control");
  await page.click('#page [data-filter="all"]');

  await go(page, "#backlinks/all?site=site-one.example");
  await page.click('#page [data-bl-filter="lost"]'); await page.waitForTimeout(400);
  const blOnScreen = await page.evaluate(() => document.querySelectorAll("#page tr[data-bl]").length);
  const blFile = await exportAs(page, "csv", "backlinks-lost");
  check(blOnScreen > 0 && csvRows(blFile).length === blOnScreen, `Backlinks: the CSV holds the ${blOnScreen} lost links on screen, not all of them (${csvRows(blFile).length})`);
  check(about(await exportAs(page, "xlsx", "backlinks-lost")).includes("Filter | "), "Backlinks: the header says the filter");
  await page.click('#page [data-bl-filter="all"]');
  await go(page, "#backlinks/todo?site=site-one.example");
  check(csvRows(await exportAs(page, "csv", "backlinks-todo-seen")).length === (await page.evaluate(() => window.LinkTodo.seen().ids.length)), "Backlinks, To do: the CSV holds the rows on screen");
  await go(page, "#backlinks/mediators?site=site-one.example");
  const mediators = fs.readFileSync(await exportAs(page, "csv", "backlinks-mediators"), "utf8");
  check(mediators.includes("LinkAgency") && mediators.includes("Nour Media"), "Backlinks, Mediators tab: the CSV is the mediators list");

  await go(page, "#tasks?site=site-one.example");
  const allTasks = csvRows(await exportAs(page, "csv", "tasks-all")).length;
  await page.evaluate(() => { const box = document.getElementById("tk-query"); box.value = "broken"; box.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(600);
  const taskCards = await page.evaluate(() => document.querySelectorAll("#page [data-task-card], #page [data-task-row]").length);
  const taskFile = await exportAs(page, "csv", "tasks-search");
  check(taskCards === 1 && csvRows(taskFile).length === 1 && allTasks > 1 && csvRows(taskFile)[0].includes("broken link"), `Tasks: searching leaves ${taskCards} task on the board and ${csvRows(taskFile).length} in the CSV (of ${allTasks})`);
  check(about(await exportAs(page, "xlsx", "tasks-search")).includes("broken"), "Tasks: the header says what was searched");
  await page.evaluate(() => { const box = document.getElementById("tk-query"); box.value = "zzzz-nothing"; box.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(600);
  check(csvRows(await exportAs(page, "csv", "tasks-none")).length === 0, "Tasks: a search that matches nothing gives a file with no tasks, not all of them");
  await page.evaluate(() => { const box = document.getElementById("tk-query"); box.value = ""; box.dispatchEvent(new Event("input", { bubbles: true })); });

  await go(page, "#resources?site=site-one.example");
  if (await page.locator('#page [data-rs-filter="brief"]').count()) {
    await page.click('#page [data-rs-filter="brief"]'); await page.waitForTimeout(300);
    const resOnScreen = await page.evaluate(() => document.querySelectorAll("#page tbody tr").length);
    const resFile = await exportAs(page, "csv", "resources-tag");
    check(resOnScreen > 0 && csvRows(resFile).length === resOnScreen && csvRows(resFile).every((l) => l.includes("brief")), `Resources: the tag filter is in the CSV (${csvRows(resFile).length} of ${resOnScreen} on screen)`);
    await page.click('#page [data-rs-filter=""]');
  } else console.log("skip Resources tag filter: this database has no tagged resource");

  await go(page, "#notes");
  await page.fill("#nv-search", "prices"); await page.waitForTimeout(600);
  const notesOnScreen = await page.evaluate(() => document.querySelectorAll("#nv-list [data-note-row]").length);
  const notesFile = await exportAs(page, "csv", "notes-search");
  check(notesOnScreen > 0 && csvRows(notesFile).length === notesOnScreen, `Notes: the search is in the CSV (${csvRows(notesFile).length} of ${notesOnScreen} on screen)`);
  await page.fill("#nv-search", ""); await page.waitForTimeout(300);
  const kindChip = page.locator('#nv-kinds [data-nv-kind="competitor"]');
  if (await kindChip.count()) {
    await kindChip.click(); await page.waitForTimeout(500);
    const kindOnScreen = await page.evaluate(() => document.querySelectorAll("#nv-list [data-note-row]").length);
    const kindFile = await exportAs(page, "xlsx", "notes-kind");
    check(about(kindFile).includes("Notes about | Competitors"), "Notes: the kind chip is in the header");
    check(csvRows(await exportAs(page, "csv", "notes-kind")).length === kindOnScreen && kindOnScreen > 0, `Notes: the kind chip is in the CSV (${kindOnScreen} on screen)`);
    await page.click('#nv-kinds [data-nv-kind=""]'); await page.waitForTimeout(300);
  } else console.log("skip Notes kind chip: no note about a competitor here");

  // Channels: the days and the comparison picked in the top bar.
  await go(page, "#channels?site=site-one.example");
  await page.evaluate(() => window.UI.range.set({ preset: "7d", compare: "prev" })); // the app's one date range (2026-11-10)
  await page.waitForTimeout(1500);
  const win = await page.evaluate(() => window.UI.periodWindow());
  const chFile = await exportAs(page, "xlsx", "channels-7-days");
  // The server ends the days on Google Analytics' last day, so the end may come before the picker's.
  check(path.basename(chFile).includes(`${win.from}-to-`) && path.basename(chFile).includes("2026") , `Channels: the file is for the 7 days on screen (${path.basename(chFile)})`);
  const chAbout = about(chFile);
  check(chAbout.includes("Period |") && chAbout.includes("Compared with |"), `Channels: the header says the days and the comparison (${chAbout.slice(0, 120)})`);
  await page.evaluate(() => window.UI.range.set({ preset: "28d", compare: "prev" }));

  // Insights: the tab and the status picked.
  await go(page, "#insights?site=site-one.example");
  await page.evaluate(() => { window.INSIGHTS.tab = "technical"; window.INSIGHTS.status = "dismissed"; window.UI.render(); });
  await page.waitForTimeout(1200);
  const inAbout = about(await exportAs(page, "xlsx", "insights-tab"));
  check(inAbout.includes("Group | Technical") && inAbout.includes("Status | Dismissed"), `Insights: the tab and the status are in the header (${inAbout.slice(0, 120)})`);
  await page.evaluate(() => { window.INSIGHTS.tab = "first"; window.INSIGHTS.status = "open"; window.UI.render(); });

  await go(page, "#content?site=site-one.example");
  await page.click('#page [data-lv-sort="content"][data-key="clicks"]'); await page.waitForTimeout(300);
  await page.click('#page [data-lv-sort="content"][data-key="clicks"]'); await page.waitForTimeout(300);
  const contentOnScreen = await page.evaluate(() => [...document.querySelectorAll("#page tbody tr")].map((r) => r.querySelector(".lv-url")?.textContent.trim()).filter(Boolean));
  const contentCsv = firstCells(await exportAs(page, "csv", "content-sorted"));
  check(contentOnScreen.length > 1 && contentCsv.length === contentOnScreen.length && contentCsv.every((u, i) => u.endsWith(contentOnScreen[i].replace(/^https?:\/\/[^/]+/, "")) || u.includes(contentOnScreen[i])), `Content: the CSV follows the sort on screen (${contentCsv.join(" · ")})`);
  check((await page.locator("[data-lv-csv]").count()) === 0, "Content: no second download control in the table's footer");

  // Competitors: a profile, AI Overview watch and its Notes tab each have their own export.
  await go(page, "#competitors/summary?site=site-one.example", 2200);
  await page.click("#page [data-cs-open]"); await page.waitForTimeout(2200);
  const profile = path.basename(await exportAs(page, "pdf", "competitor-profile"));
  check(/--competitor-[a-z0-9.-]+\.example-site-one\.example-\d{4}-\d\d-\d\d\.pdf$/.test(profile), `Competitors: an open profile exports that competitor, named in the file (${profile})`);
  const profileCsv = path.basename(await exportAs(page, "csv", "competitor-profile"));
  check(profileCsv.includes("competitor-"), `and its CSV too (${profileCsv})`);
  await exportAs(page, "xlsx", "competitor-profile");
  await go(page, "#competitors/ai?site=site-one.example", 1800);
  check(path.basename(await exportAs(page, "pdf", "competitors-ai")).includes("--ai-watch-"), "Competitors, AI Overview watch has its own export");
  await go(page, "#competitors/notes?site=site-one.example", 1800);
  check(path.basename(await exportAs(page, "xlsx", "competitors-notes")).includes("--competitor-notes-"), "Competitors, Notes has its own export");

  // Links checker and Site health: the scan and the test on screen.
  await go(page, "#health/links?site=site-one.example", 2500);
  check((await page.locator("#lc-export").count()) === 0, "Links checker: one download control");
  if (!(await page.evaluate(() => window.UI.exportSeen?.().scan))) {
    // A fresh demo has never been checked: run a real check, on the fake internet, as a person would.
    await page.click("#lc-run");
    await page.waitForFunction(() => window.UI.exportSeen?.().scan && !document.querySelector(".lc-progress"), null, { timeout: 120000, polling: 1000 });
    await page.waitForTimeout(800);
  }
  const asked = [];
  const listen = (r) => { if (r.url().includes("/api/export/")) asked.push(r.url()); };
  page.on("request", listen);
  const scanId = await page.evaluate(() => window.UI.exportSeen().scan);
  const scanXlsx = await exportAs(page, "xlsx", "links-scan");
  const scanAbout = about(scanXlsx);
  check(scanAbout.includes("Pages read") && scanAbout.includes("Links checked") && scanAbout.includes("Checked on"), `Links checker: the export is the scan on screen (${scanAbout.slice(0, 160)})`);
  check(asked.some((u) => u.includes(`scan_id=${scanId}`)), `Links checker: the export asks for scan ${scanId}, the one open`);
  const issues = await page.evaluate(() => [...document.querySelectorAll("#page .card h2, #page .card-head h2")].length);
  const scanRows = csvRows(await exportAs(page, "csv", "links-scan"));
  check(scanRows.length >= 2 && scanRows.some((l) => l.includes("old-offer") && l.includes("404")), `Links checker: the CSV holds the broken link the scan found (${scanRows.length} rows, ${issues} groups on screen)`);
  await exportAs(page, "pdf", "links-scan");
  await go(page, "#health/test?site=site-one.example", 2500);
  if (!(await page.evaluate(() => window.HealthTest?.shownAudit?.()))) {
    await page.click("#ht-run");
    await page.waitForFunction(() => window.HealthTest?.shownAudit?.() && !document.querySelector(".ht-progress"), null, { timeout: 120000, polling: 1000 });
  }
  const auditId = await page.evaluate(() => window.HealthTest.shownAudit());
  const testAbout = about(await exportAs(page, "xlsx", "health-test"));
  const score = await page.evaluate(() => document.getElementById("ht-score")?.textContent.trim());
  check(asked.some((u) => u.includes(`audit_id=${auditId}`)) && testAbout.includes("Tested on") && testAbout.includes(`Health score | ${score}`), `Site health: the export is test ${auditId} on screen, score ${score} (${testAbout.slice(0, 160)})`);
  await exportAs(page, "pdf", "health-test");
  page.off("request", listen);

  // The file's name says the screen, the site and the days.
  await go(page, "#overview?site=site-one.example");
  const named = path.basename(await exportAs(page, "pdf", "name")).split("--")[1];
  check(/^overview-site-one\.example-\d{4}-\d\d-\d\d-to-\d{4}-\d\d-\d\d\.pdf$/.test(named), `the file name has the site and the days (${named})`);

  // French, and dark.
  await menu(page, "lang"); await page.waitForTimeout(700);
  check((await page.locator("#export-btn").innerText()).trim() === "Exporter", "in French the button says Exporter");
  await page.click("#export-btn");
  check((await page.locator("#export-menu").innerText()).includes("Rapport PDF"), "and the menu is in French");
  await page.keyboard.press("Escape");
  const frPdf = await exportAs(page, "pdf", "overview-fr");
  check(fs.statSync(frPdf).size > 5000, "the French PDF downloads");
  await exportAs(page, "xlsx", "overview-fr");
  await menu(page, "theme"); await page.waitForTimeout(500);
  await page.click("#export-btn");
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/menu-dark-fr.png` });
  const colours = await page.evaluate(() => { const m = getComputedStyle(document.getElementById("export-menu")), b = getComputedStyle(document.querySelector("#export-menu b")); return { bg: m.backgroundColor, text: b.color }; });
  check(colours.bg !== "rgb(255, 255, 255)", `dark mode: the menu is dark (${colours.bg}, words ${colours.text})`);
  await page.keyboard.press("Escape");
  await menu(page, "theme"); await menu(page, "lang"); await page.waitForTimeout(400);

  // A phone.
  await page.setViewportSize({ width: 390, height: 800 });
  await go(page, "#overview?site=site-one.example");
  await page.click("#export-btn");
  const box = await page.locator("#export-menu").boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390, `on a phone the menu stays on screen (${box ? Math.round(box.x) + "…" + Math.round(box.x + box.width) : "none"})`);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/menu-phone.png` });
  await page.keyboard.press("Escape");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "and the page doesn't scroll sideways");
  await exportAs(page, "pdf", "phone-overview");
  await go(page, "#backlinks/all?site=site-one.example");
  await page.screenshot({ path: `${out}/phone-backlinks.png` });
  const overlap = await page.evaluate(() => {
    const mine = document.getElementById("export-btn").getBoundingClientRect();
    return [...document.querySelectorAll("#topbar button, #topbar .pick")].filter((el) => el.id !== "export-btn" && el.offsetParent).some((el) => { const r = el.getBoundingClientRect(); return !(r.right <= mine.left || r.left >= mine.right || r.bottom <= mine.top || r.top >= mine.bottom); });
  });
  check(!overlap, "on a phone the Export button sits on nothing else");
  for (const screen of ["#backlinks/all", "#overview", "#keywords", "#tasks", "#today"]) {
    await go(page, `${screen}?site=site-one.example`, 1100);
    const bar = await page.evaluate(() => {
      const b = document.getElementById("export-btn"), top = document.getElementById("topbar");
      const withIt = top.offsetHeight, box = b.getBoundingClientRect();
      b.style.display = "none"; const without = top.offsetHeight; b.style.display = "";
      const others = [...top.querySelectorAll("button, .pick, h1")].filter((el) => el !== b && el.offsetParent);
      const on = others.filter((el) => { const r = el.getBoundingClientRect(); return !(r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom); }).map((el) => el.id || el.tagName);
      const title = top.querySelector("h1"), cut = title.scrollWidth > title.clientWidth + 1;
      return { withIt, without, width: Math.round(box.width), name: b.getAttribute("aria-label"), on, cut };
    });
    check(bar.withIt === bar.without && bar.width <= 36 && bar.name && bar.on.length === 0, `phone ${screen}: Export is an icon with a name, adds no row and covers nothing (bar ${bar.withIt}px, with or without; ${bar.width}px wide; on ${bar.on.join(",") || "nothing"})`);
  }

  check(failed.length === 0, `no export request failed ${failed.join(", ")}`);
  // A screen's own failed request (say, an icon the demo has none of) is that screen's business, and is printed, not counted.
  const mine = problems.filter((p) => !p.includes("Failed to load resource"));
  check(mine.length === 0, `no errors in the browser ${mine.slice(0, 3).join(" | ")}`);
  if (other.length) console.log(`note: ${other.length} other failed request(s), not from exports: ${[...new Set(other)].slice(0, 4).join(", ")}`);
  console.log(`\n${checks - failures} of ${checks} checks pass`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
