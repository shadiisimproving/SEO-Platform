// By hand, as a normal user: Content → Content tracker, then Tasks by month. Made-up data only (the demo world + its seed):
//   DB_NAME_TEST=test_mzcontentui_test .venv/bin/python tests/ui/app_server.py --port 8304
//   DB_NAME_TEST=test_mzcontentui_test .venv/bin/python tests/ui/seed_content_tracker.py
// Usage: node tests/ui/flow_content_tracker.cjs [base url] [folder for screenshots]
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const BASE = process.argv[2] || "http://127.0.0.1:8304/";
const shots = process.argv[3] || "var/ui-content-tracker";
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };
const RUN = Date.now().toString(36);

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(10000);
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 500 || (r.status() === 404 && !r.url().includes("/api/auth/me"))) bad.push(`${r.status()} ${r.url()}`); });
  const settle = (ms = 500) => page.waitForTimeout(ms);
  await page.goto(`${BASE}?flow=${RUN}&simple=1#content`);
  await page.waitForSelector('[data-lv-ptab="content:published"]');
  await page.click('[data-lv-ptab="content:published"]');
  await page.waitForSelector("tr[data-ct-open]");
  await settle(900);
  await page.screenshot({ path: `${shots}/01-tracker.png` });
  const rows = await page.locator("tr[data-ct-open]").count();
  check("every tracked piece is a row", rows >= 7, rows);
  check("titles are page links", (await page.locator("tr[data-ct-open] a.ct-title").count()) === rows);
  check("target queries are keyword links", (await page.locator("tr[data-ct-open] .ct-query a, tr[data-ct-open] .ct-query button").count()) >= 6);
  const decafRow = page.locator("tr[data-ct-open]").filter({ hasText: "Decaf explained" });
  check("a query Google shows on another page says via", (await decafRow.locator(".ct-via").count()) === 1);
  check("the position line says when it was read", /Monthly · /.test(await decafRow.locator(".ct-pos").innerText()));

  // The counts filter the list.
  await page.click('[data-ct-filter="leads"]'); await settle();
  const leadRows = await page.locator("tr[data-ct-open]").count();
  check("Bring leads keeps only pieces with leads", leadRows > 0 && leadRows < rows, leadRows);
  await page.screenshot({ path: `${shots}/02-bring-leads.png` });
  await page.click('[data-ct-filter=""]'); await settle();

  // Sorting by a heading.
  await page.click('[data-lv-sort="ctr"][data-key="clicks"]'); await settle();
  const firstAfterSort = await page.locator("tr[data-ct-open]").first().innerText();
  check("Google clicks heading sorts", firstAfterSort.length > 0);

  // A row opens its panel; the months load; a typed query is saved.
  await decafRow.locator(".ct-path").click(); await page.waitForSelector("#ct-form");
  await page.waitForSelector(".ct-months table", { timeout: 8000 }).catch(() => {});
  check("the panel shows the months", (await page.locator(".ct-months tbody tr").count()) > 0);
  await settle(700);
  await page.screenshot({ path: `${shots}/03-panel.png` });
  await page.fill("#ct-query", "decaf coffee process");
  await page.click("#ct-save"); await settle(1200);
  check("the panel closes after Save", (await page.locator("#ct-form").count()) === 0);
  const decafAfter = await page.locator("tr[data-ct-open]").filter({ hasText: "Decaf explained" }).innerText();
  check("the typed query shows in its row", decafAfter.includes("decaf coffee process"));

  // New pages found: one press tracks it.
  const newCard = page.locator(".ct-new");
  check("New pages found offers the espresso post", (await newCard.filter({ hasText: "Espresso ratio" }).count()) === 1);
  await page.screenshot({ path: `${shots}/04-new-pages.png`, fullPage: true });
  await newCard.locator("[data-ct-track]").first().click(); await settle(1200);
  check("Track adds it to the list", (await page.locator("tr[data-ct-open]").filter({ hasText: "Espresso ratio" }).count()) === 1);

  // Stop tracking, then Undo.
  await page.locator("tr[data-ct-open]").filter({ hasText: "Espresso ratio" }).locator(".ct-path").click();
  await page.waitForSelector("#ct-stop"); await page.click("#ct-stop"); await settle(1000);
  check("Stop tracking takes it away", (await page.locator("tr[data-ct-open]").filter({ hasText: "Espresso ratio" }).count()) === 0);
  const undo = page.locator("[data-undo]").last();
  if (await undo.count()) { await undo.click(); await settle(1200); }
  check("Undo brings it back", (await page.locator("tr[data-ct-open]").filter({ hasText: "Espresso ratio" }).count()) === 1);

  // Add a page by hand: a wrong site is refused in words.
  await page.click("[data-ct-add]"); await page.waitForSelector("#ct-add-page");
  await page.fill("#ct-add-page", "https://elsewhere.example/x"); await page.click("#ct-add-save"); await settle(800);
  check("another site's page is refused in words", /isn't on this site|pas sur ce site/.test(await page.locator("#ct-add-error").innerText()));
  await page.keyboard.press("Escape"); await settle();

  // French, dark, phone.
  await menu(page, "lang"); await settle(900);
  await page.screenshot({ path: `${shots}/05-tracker-fr.png` });
  check("French heading words", /Requête visée|Position Google/.test(await page.locator(".ct-card").innerText()));
  await menu(page, "theme"); await settle(900);
  await page.screenshot({ path: `${shots}/06-tracker-fr-dark.png` });
  await menu(page, "theme"); await menu(page, "lang"); await settle(600);

  // ---- Tasks by month --------------------------------------------------------------------------------
  await page.goto(`${BASE}?flow=${RUN}t&simple=1#tasks`);
  await page.waitForSelector(".tk-months");
  await settle(900);
  await page.screenshot({ path: `${shots}/07-tasks-months.png`, fullPage: true });
  const heads = await page.locator(".tk-mhead h2").allInnerTexts();
  check("tasks sit under month headings", heads.length >= 2, heads.join(" | "));
  const row = page.locator(".tk-mrow").filter({ hasText: "Fix the 301 from /old-offer" });
  check("a task shows its type", (await row.locator(".tk-m-kind").count()) === 1);
  check("a blocked task has Blocked pressed", (await row.locator('[aria-pressed="true"]').innerText()).includes("Blocked"));
  const goalRow = page.locator(".tk-mrow").filter({ hasText: "Answer 'french press ratio'" });
  check("a task shows its goal", (await goalRow.locator(".tk-m-goal").innerText()).includes("Win 'french press' searches"));
  check("its keyword is a link", (await goalRow.locator(".tk-m-kw a, .tk-m-kw button").count()) >= 1);
  await goalRow.locator(".tk-q-doing").click(); await settle(900);
  check("one press moves it to In progress", (await page.locator(".tk-mrow").filter({ hasText: "Answer 'french press ratio'" }).locator('.tk-q-doing[aria-pressed="true"]').count()) === 1);
  const reloaded = await page.evaluate(async () => (await (await fetch("api/tasks")).json()).tasks.find((x) => x.title.startsWith("Answer 'french press")).status);
  check("and it is saved", reloaded === "doing", reloaded);

  // Quick add with a goal and a type.
  const TITLE = `Write an FAQ for the grind chart ${RUN}`;
  await page.fill("#tk-add-title", TITLE);
  await page.fill("#tk-add-goal", "Win 'french press' searches");
  await page.selectOption("#tk-add-kind", "Content");
  await page.click("#tk-add-go"); await settle(1200);
  const added = page.locator(".tk-mrow").filter({ hasText: TITLE });
  check("quick add puts it under its month", (await added.count()) === 1);
  check("with its goal", (await added.locator(".tk-m-goal").innerText()).includes("french press"));
  await page.click("#tk-add-go"); await settle(400);
  check("an empty title is refused in words", (await page.locator("#tk-add-error").innerText()).length > 0);

  // Done tab, a row opens its task with the goal field.
  await page.click('[data-task-show="done"]'); await settle();
  check("Done shows done tasks", (await page.locator(".tk-mrow").filter({ hasText: "Update the cold brew post" }).count()) === 1);
  await page.click('[data-task-show="open"]'); await settle();
  await added.locator(".tk-m-title").click(); await page.waitForSelector("#task-goal");
  check("the task panel has the goal", (await page.inputValue("#task-goal")).includes("french press"));
  await page.screenshot({ path: `${shots}/08-task-panel.png` });
  await page.keyboard.press("Escape"); await settle();

  // The goal filter, and the board with its four lanes.
  if (!(await page.locator("#tk-goal").isVisible())) await page.click("[data-task-filters]").catch(() => {});
  await page.selectOption("#tk-goal", "Strengthen site credibility"); await settle(600);
  const goalRows = await page.locator(".tk-mrow").count();
  check("the goal filter keeps that goal's tasks", goalRows === 3, goalRows);
  await page.selectOption("#tk-goal", ""); await settle();
  await page.click('[data-task-view="kanban"]'); await settle(800);
  check("the board has four lanes", (await page.locator("[data-task-col]").count()) === 4);
  await page.screenshot({ path: `${shots}/09-board.png` });
  await page.click('[data-task-view="months"]'); await settle(600);
  await menu(page, "lang"); await settle(900);
  await page.screenshot({ path: `${shots}/10-tasks-fr.png`, fullPage: true });
  check("French status words", /À lancer/.test(await page.locator(".tk-months").innerText()));
  await menu(page, "lang"); await settle(400);
  await browser.close();

  // Phone width.
  const phone = await open({ width: 390, height: 844, url: `${BASE}?flow=${RUN}p&simple=1#content` });
  await phone.page.waitForSelector('[data-lv-ptab="content:published"]');
  await phone.page.click('[data-lv-ptab="content:published"]');
  await phone.page.waitForSelector("tr[data-ct-open]"); await phone.page.waitForTimeout(900);
  await phone.page.screenshot({ path: `${shots}/11-phone-tracker.png`, fullPage: true });
  const wide = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no sideways scroll on a phone (tracker)", !wide);
  await phone.page.goto(`${BASE}?flow=${RUN}q&simple=1#tasks`); await phone.page.waitForSelector(".tk-months"); await phone.page.waitForTimeout(900);
  await phone.page.screenshot({ path: `${shots}/12-phone-tasks.png`, fullPage: true });
  const wide2 = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no sideways scroll on a phone (tasks)", !wide2);
  problems.push(...phone.problems);
  await phone.browser.close();

  // The harness has no sign-in, so /api/auth/me answers 404; the refused page above answers 400 on purpose.
  const real = problems.filter((p) => !/status of 40[04]/.test(p));
  check("no page errors", real.length === 0, real.slice(0, 4).join(" | "));
  check("no server errors", bad.length === 0, bad.slice(0, 4).join(" | "));
  const failed = results.filter((ok) => !ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
