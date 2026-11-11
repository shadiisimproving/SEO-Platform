// The Notes panel's "Or about" row: a note on any page, keyword or competitor, picked from a list or typed, and on all my sites.
// Run against the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8263
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8263/";
const OUT = path.resolve("var/ui-notes-pickers") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const RUN = Date.now().toString(36);
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1400, height: 900 });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  await page.goto(BASE + "#today");
  await call("POST", "tasks", { title: `Rewrite the guide ${RUN}` }); // for all sites, so it's listed on each
  const site = { host: process.argv[3] || "site-one.example" }; // the demo world's first site
  await page.goto("about:blank"); await page.goto(`${BASE}#keywords?site=${site.host}`); await page.waitForTimeout(2200);

  await page.keyboard.press("n"); await page.waitForTimeout(800);
  const chips = await page.$$eval("#panel [data-note-panel-pick]", (els) => els.map((e) => e.textContent.trim()));
  check("the panel offers a page, a keyword, a competitor and all my sites", ["A page", "A keyword", "A competitor", "All my sites"].every((c) => chips.includes(c)), chips.join(", "));
  await page.getByRole("button", { name: "A keyword" }).click(); await page.waitForTimeout(700);
  check("no note field before a keyword is picked", !(await page.$("#nb-pick-target textarea")));
  check("the keyword list is filled from the site", (await page.locator("#nb-pick-list option").count()) > 0);

  const word = `Picked Keyword ${RUN}`;
  await page.fill("#nb-pick", `  picked   keyword ${RUN} `); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  await page.keyboard.type(`Keyword note ${RUN}`); await page.waitForTimeout(1500);
  check("Enter opens the note field and it saves", /Saved/.test(await page.textContent("#nb-pick-target [data-note-status]")));

  await page.getByRole("button", { name: "A page" }).click(); await page.waitForTimeout(700);
  await page.fill("#nb-pick", `/picked-${RUN}`); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  check("a path becomes the site's full address", (await page.inputValue("#nb-pick")) === `https://${site.host}/picked-${RUN}`, await page.inputValue("#nb-pick"));
  await page.keyboard.type(`Page note ${RUN}`); await page.waitForTimeout(300);

  await page.getByRole("button", { name: "A competitor" }).click(); await page.waitForTimeout(800);
  await page.fill("#nb-pick", `nobody-${RUN}.example`); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  check("an unknown competitor is refused with a reason", /No such competitor\. Pick one/.test(await page.textContent("#nb-pick-target")));
  await page.screenshot({ path: OUT + "1-unknown-competitor.png" });

  await page.getByRole("button", { name: "All my sites" }).click(); await page.waitForTimeout(600);
  await page.keyboard.type(`Everywhere ${RUN}`); await page.waitForTimeout(300);

  await page.getByRole("button", { name: "All notes" }).click(); await page.waitForTimeout(1500);
  const rows = await page.$$eval("#panel .nb-row textarea", (els) => els.map((e) => e.value));
  for (const text of [`Keyword note ${RUN}`, `Page note ${RUN}`, `Everywhere ${RUN}`]) check(`"${text}" is in All notes right after switching`, rows.includes(text));
  await page.screenshot({ path: OUT + "2-all-notes.png" });

  const saved = (await call("GET", `notes?scope=keyword&keyword=${encodeURIComponent(word.toUpperCase())}`)).notes || [];
  check("the server finds the keyword note whatever the case and spacing", saved.some((n) => n.body === `Keyword note ${RUN}`));
  const everywhere = ((await call("GET", "notes?scope=site")).notes || []).find((n) => n.body === `Everywhere ${RUN}`);
  check("the All my sites note has no site", Boolean(everywhere) && everywhere.site_id === null);

  // A day: it shows on the Overview chart.
  await page.getByRole("button", { name: "A date" }).click(); await page.waitForTimeout(600);
  check("a date is picked with a date field", (await page.getAttribute("#nb-pick", "type")) === "date");
  const today = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10); // inside the chart's days, which end a few days back
  await page.fill("#nb-pick", today); await page.waitForTimeout(600);
  await page.locator("#nb-pick-target textarea[data-note-composer]").click();
  await page.keyboard.type(`Changed the menu ${RUN}`); await page.waitForTimeout(1500);
  const dayNotes = (await call("GET", `notes?scope=date&day=${today}`)).notes || [];
  check("the day note is saved on that day", dayNotes.some((n) => n.body === `Changed the menu ${RUN}`));

  // A group of pages: shows on a page inside it.
  await page.getByRole("button", { name: "A group of pages" }).click(); await page.waitForTimeout(700);
  await page.fill("#nb-pick", "/"); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  check("the whole website is refused as a group", /whole website/.test(await page.textContent("#nb-pick-target")));
  await page.fill("#nb-pick", `/guide-${RUN}`); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  check("a group always ends in a slash", (await page.inputValue("#nb-pick")) === `https://${site.host}/guide-${RUN}/`, await page.inputValue("#nb-pick"));
  await page.keyboard.type(`Every guide needs a date ${RUN}`); await page.waitForTimeout(300);
  await page.getByRole("button", { name: "A page" }).click(); await page.waitForTimeout(700);
  await page.fill("#nb-pick", `/guide-${RUN}/brew`); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  const onPage = await page.$$eval("#nb-pick-target .nb-row textarea", (els) => els.map((e) => e.value));
  check("a page inside the group shows the group's note", onPage.includes(`Every guide needs a date ${RUN}`), onPage.join(" | "));

  // A linking website and a task.
  await page.getByRole("button", { name: "A linking website" }).click(); await page.waitForTimeout(700);
  await page.fill("#nb-pick", `https://www.Seller-${RUN}.example/write-for-us`); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  check("a linking website is kept as its plain name", (await page.inputValue("#nb-pick")) === `seller-${RUN}.example`, await page.inputValue("#nb-pick"));
  await page.keyboard.type(`Asked a price ${RUN}`); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "A task" }).click(); await page.waitForTimeout(900);
  const taskTitles = await page.$$eval("#nb-pick-list option", (els) => els.map((o) => o.value));
  check("the task list is filled", taskTitles.length > 0);
  await page.fill("#nb-pick", `No such task ${RUN}`); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  check("an unknown task is refused", /No such task\. Pick one/.test(await page.textContent("#nb-pick-target")));
  if (taskTitles[0]) {
    await page.fill("#nb-pick", taskTitles[0]); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    await page.keyboard.type(`On the task ${RUN}`); await page.waitForTimeout(1500);
  }
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);

  // The day note is a marker on the Overview chart (the demo world may have no Search Console data: then there's no chart to check).
  await page.goto("about:blank"); await page.goto(`${BASE}#overview?site=${site.host}`); await page.waitForTimeout(3000);
  const chart = await page.$(".ov-chart");
  if (chart) check("the day note is on the Overview chart", (await page.textContent(".ov-marks").catch(() => "")).includes(`Changed the menu ${RUN}`));
  else console.log("SKIP  the Overview chart: no chart in this world");

  // The row pencil on Backlinks counts the linking website's notes.
  await page.goto("about:blank"); await page.goto(`${BASE}#backlinks?site=${site.host}`); await page.waitForTimeout(2500);
  const badges = await page.locator("#bl-table .nb-badge").count();
  check("Backlinks rows have a notes pencil", badges > 0, String(badges));
  if (badges) {
    await page.locator("#bl-table .nb-badge").first().click(); await page.waitForTimeout(800);
    check("the pencil opens Notes on that linking website", (await page.textContent("#panel [aria-pressed=true]")).includes("."));
    await page.keyboard.type(`From the row ${RUN}`); await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
    await page.goto("about:blank"); await page.goto(`${BASE}#backlinks?site=${site.host}`); await page.waitForTimeout(2500);
    check("the pencil shows a count after a note", (await page.locator("#bl-table .nb-badge .nb-count:not([hidden])").count()) > 0);
    await page.screenshot({ path: OUT + "4-backlinks-pencil.png" });
  }

  // The task panel shows the task's notes.
  if (taskTitles[0]) {
    await page.goto("about:blank"); await page.goto(`${BASE}#tasks`); await page.waitForTimeout(2500);
    await page.getByText(taskTitles[0], { exact: true }).first().click(); await page.waitForTimeout(1200);
    const inTask = await page.$$eval("#panel .task-notes .nb-row textarea", (els) => els.map((e) => e.value));
    check("the task panel shows the task's notes", inTask.includes(`On the task ${RUN}`), inTask.join(" | "));
    await page.screenshot({ path: OUT + "5-task-panel.png" });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  }

  await page.goto("about:blank"); await page.goto(`${BASE}#keywords?site=${site.host}`); await page.waitForTimeout(2000);
  await page.keyboard.press("n"); await page.waitForTimeout(800);
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(400);
  check("no sideways scroll at phone width", await page.evaluate(() => { const p = document.querySelector("#panel"); return p.scrollWidth <= p.clientWidth; }));
  await page.screenshot({ path: OUT + "3-phone.png" });

  const real = problems.filter((p) => !/status of 404/.test(p)); // /api/auth/me answers 404 when the harness runs without --login
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
